// Playwright verification harness for the Veritix NDT Inspect app.
//
// The app is a static SPA gated behind a login screen, with a blocking
// Supabase CDN <script> that stalls boot when offline. This harness captures
// the working recipe so UI changes can be driven reliably:
//   1. start the local static server (tools/serve.mjs)
//   2. block the jsDelivr / Supabase CDN so the deferred app scripts execute
//      in pure localStorage mode (no network)
//   3. wait for the app's globals to be defined
//   4. seed an Admin CURRENT_USER and open the requested page/section
//   5. wait for that page to actually render, then ASSERT it did
//
// Step 5 is the point. This harness used to report ok:true on a page where
// nothing had rendered — it activated no page at all unless given a section,
// routed every section through the Settings shell (so top-level pages like
// Reports were unreachable), accepted unknown section names silently, and
// screenshotted before the first paint. A green run meant "the scripts loaded
// without throwing", not "the app works".
//
// Library use:
//   import { withApp } from './tools/verify.mjs';
//   await withApp(async (page) => { ... assertions ... }, { section: 'reports' });
//
// CLI use:
//   node tools/verify.mjs                      # overview (dashboard), screenshot
//   node tools/verify.mjs reports              # a top-level page
//   node tools/verify.mjs emailtemplates       # a Settings subsection
//   node tools/verify.mjs settings:billing     # disambiguate — see BOTH below
//   node tools/verify.mjs billing --locale nl-NL --shot .verify-out/billing.png
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './serve.mjs';

// Third-party origins blocked so the sweep runs offline and deterministically:
// the jsDelivr UMD bundle and every *.supabase.co call the app would make.
//
// Matched against the HOSTNAME, not the whole URL. It used to be
// /jsdelivr\.net|supabase/i tested against request.url(), which also aborted
// the app's own same-origin js/supabase.js the moment that file was split out
// of platform.js — the script failed to load, every `typeof _vxSupabase ===
// 'function'` guard took its null branch, and the app silently ran as an
// unconfigured trial. A blocklist of remote origins has no business matching a
// local path, so scope it to the host.
const CDN_BLOCK = /(^|\.)jsdelivr\.net$|(^|\.)supabase\.(co|com|io)$/i;

// Two disjoint namespaces the harness used to conflate: top-level pages are
// `#page-<id>` reached with showPage(), Settings subsections are `#sni-<id>`
// reached with showSS() after showPage('settings').
export const PAGES = [
  'overview', 'inspector', 'admin', 'jobs', 'planner',
  'billing', 'reports', 'defects', 'inbox', 'settings',
];
export const SETTINGS_SECTIONS = [
  'company', 'inspectors', 'equipment', 'customers', 'billing', 'emailtemplates',
  'users', 'methods', 'numbering', 'templates', 'pdfeditor', 'drawing',
  'procedures', 'appearance', 'subscription', 'database', 'notifications',
  'portal', 'api', 'system',
];
// `billing` exists in BOTH. A bare name prefers the top-level page; use
// `settings:billing` to force the subsection.
function resolveTarget(section) {
  if (!section) return { kind: 'page', id: 'overview' };
  const m = /^settings:(.+)$/.exec(section);
  if (m) {
    if (!SETTINGS_SECTIONS.includes(m[1])) throw new Error(`unknown section: settings:${m[1]}`);
    return { kind: 'settings', id: m[1] };
  }
  if (PAGES.includes(section)) return { kind: 'page', id: section };
  if (SETTINGS_SECTIONS.includes(section)) return { kind: 'settings', id: section };
  throw new Error(
    `unknown section: ${section}\n  pages:    ${PAGES.join(', ')}\n  settings: ${SETTINGS_SECTIONS.join(', ')}`,
  );
}

// Console noise the harness causes on purpose by blocking the CDN, plus the
// service-worker registration that cannot succeed off a throwaway origin.
// Anything else is a real page error and must fail the run.
const EXPECTED_NOISE = [
  /Failed to load resource/i,
  /bad HTTP response code \(404\)/i,
  /ServiceWorker/i,
];
export const realErrors = (errors) => errors.filter((e) => !EXPECTED_NOISE.some((rx) => rx.test(e)));

// Open the app in a fresh page with CDN blocked, app JS ready, admin seeded.
// opts: { port, section, locale, headless, block }
//
// `block` is a same-origin path substring to abort as well (e.g. 'js/qrcode.min.js').
// It exists to test the global error handler's coverage: the only way to prove
// the handler catches a failed script load is to fail one on purpose. Kept
// separate from CDN_BLOCK, which is about remote origins — conflating the two is
// what made CDN_BLOCK match a local path in the first place.
export async function openApp(opts = {}) {
  // Port 0 = let the OS pick a free one. node --test runs test FILES in
  // parallel, so a fixed 8000 made the second browser suite die with
  // EADDRINUSE the moment a second one existed.
  const { port = 0, section = null, locale = null, headless = true, block = null } = opts;
  // Resolve first: an unknown section must fail before a server and browser
  // are started, not leak them behind a rejected promise.
  const target = resolveTarget(section);
  const { server, url } = await startServer(port);
  const browser = await chromium.launch({ headless });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.route('**/*', (route) => {
    const reqUrl = route.request().url();
    // An unparseable URL is not a blocked origin — continue rather than abort,
    // so a malformed request surfaces as itself instead of as a missing script.
    let host = '';
    try { host = new URL(reqUrl).hostname; } catch { /* not a blockable origin */ }
    if (CDN_BLOCK.test(host)) return route.abort();
    if (block && reqUrl.includes(block)) return route.abort();
    return route.continue();
  });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof showPage === 'function' && typeof showSS === 'function' && typeof i18nApply === 'function',
    null, { timeout: 30000 },
  );

  if (locale) await page.evaluate((loc) => { try { vxSetLocale(loc); } catch (e) {} }, locale);

  // Reveal the app shell. The admin seed lives in gotoTarget — see there.
  await page.evaluate(() => {
    const ls = document.getElementById('login-screen'); if (ls) ls.classList.add('hidden');
  });

  await gotoTarget(page, section);

  const close = async () => { await browser.close(); await new Promise((r) => server.close(r)); };
  return { browser, ctx, page, url, errors, target, close };
}

// Open a target in an already-running page, then wait for it to render. Shared
// by openApp and the all-targets sweep, which reuses ONE browser rather than
// launching ~30 of them.
export async function gotoTarget(page, section) {
  const target = resolveTarget(section);
  // A page is ALWAYS activated — previously, omitting `section` left no page
  // active and the run screenshotted an empty shell while reporting a dashboard.
  await page.evaluate((t) => {
    // Re-seed the admin user on EVERY navigation, in the same synchronous
    // block as the showPage call. The app's async auth init clears
    // CURRENT_USER once it finds no session, and showPage('settings') has an
    // admin guard that silently `return`s — no throw, no console error, the
    // page just never switches. Seeding once at boot raced that init and made
    // settings targets fail intermittently.
    try { CURRENT_USER = { id: 'verify', name: 'Verify Admin', role: 'Admin' }; } catch (e) { window.CURRENT_USER = { id: 'verify', name: 'Verify Admin', role: 'Admin' }; }
    if (t.kind === 'settings') {
      showPage('settings', document.getElementById('tn-settings'));
      showSS(t.id, document.getElementById('sni-' + t.id));
    } else {
      showPage(t.id, document.getElementById('tn-' + t.id));
    }
  }, target);

  // Wait for the page to actually render rather than screenshotting the frame
  // before first paint (which produced a 6KB blank PNG instead of a 21KB one).
  await page.waitForFunction(() => {
    const p = document.querySelector('.page.active');
    if (!p) return false;
    const r = p.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return target;
}

// Assert the app actually rendered. Returns { ok, failures, details } rather
// than throwing, so callers can report every problem at once.
export async function checkRendered(page, errors = []) {
  const details = await page.evaluate(() => {
    const active = document.querySelector('.page.active');
    const shell = document.querySelector('.app-body');
    const login = document.getElementById('login-screen');
    const box = active ? active.getBoundingClientRect() : null;
    return {
      activePage: active ? active.id : null,
      activeText: active ? (active.textContent || '').trim().length : 0,
      activeElements: active ? active.querySelectorAll('*').length : 0,
      activeBox: box ? { w: Math.round(box.width), h: Math.round(box.height) } : null,
      shellVisible: !!shell && getComputedStyle(shell).display !== 'none',
      loginHidden: !login || getComputedStyle(login).display === 'none',
    };
  });

  const failures = [];
  if (!details.activePage) failures.push('no .page.active — nothing was opened');
  if (!details.shellVisible) failures.push('.app-body is not visible — still on the login screen?');
  if (!details.loginHidden) failures.push('#login-screen is still showing');
  if (details.activeBox && (details.activeBox.w === 0 || details.activeBox.h === 0)) {
    failures.push(`active page has a zero-size box (${details.activeBox.w}x${details.activeBox.h})`);
  }
  if (details.activeElements < 5) failures.push(`active page has only ${details.activeElements} elements — it did not render`);
  const bad = realErrors(errors);
  if (bad.length) failures.push(`page errors: ${bad.join(' | ')}`);

  return { ok: failures.length === 0, failures, details };
}

// Run a function against a ready app, always tearing down afterwards.
export async function withApp(fn, opts = {}) {
  const app = await openApp(opts);
  try { return await fn(app.page, app); }
  finally { await app.close(); }
}

// ── CLI ───────────────────────────────────────────────────────────────────
function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('tools', 'verify.mjs'));
}
if (isMain()) {
  const args = process.argv.slice(2);
  const section = args.find((a) => !a.startsWith('--')) || null;
  const localeIdx = args.indexOf('--locale');
  const locale = localeIdx >= 0 ? args[localeIdx + 1] : null;
  const shotIdx = args.indexOf('--shot');
  const shot = shotIdx >= 0 ? args[shotIdx + 1] : '.verify-out/app.png';

  let app;
  try {
    app = await openApp({ section, locale });
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(2);
  }

  const check = await checkRendered(app.page, app.errors);
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  await app.page.screenshot({ path: shot });

  console.log(JSON.stringify({
    // `ok` now means the page rendered, not merely that scripts loaded.
    ok: check.ok,
    target: `${app.target.kind}:${app.target.id}`,
    locale: await app.page.evaluate(() => (typeof vxLocale === 'function' ? vxLocale() : 'n/a')),
    screenshot: shot,
    screenshotBytes: fs.statSync(shot).size,
    rendered: check.details,
    failures: check.failures,
    pageErrors: realErrors(app.errors).slice(0, 10),
  }, null, 2));

  await app.close();
  if (!check.ok) {
    console.error('\nVERIFY FAILED:\n  - ' + check.failures.join('\n  - '));
    process.exit(1);
  }
}
