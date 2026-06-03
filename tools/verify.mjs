// Playwright verification harness for the Veritix NDT Inspect app.
//
// The app is a static SPA gated behind a login screen, with a blocking
// Supabase CDN <script> that stalls boot when offline. This harness captures
// the working recipe so UI changes can be driven reliably:
//   1. start the local static server (tools/serve.mjs)
//   2. block the jsDelivr / Supabase CDN so the deferred app scripts execute
//      in pure localStorage mode (no network)
//   3. wait for the app's globals to be defined
//   4. seed an Admin CURRENT_USER and reveal the requested page/section
//
// Library use:
//   import { withApp } from './tools/verify.mjs';
//   await withApp(async (page) => { ... assertions ... }, { section: 'billing' });
//
// CLI use:
//   node tools/verify.mjs                      # load app (dashboard), screenshot
//   node tools/verify.mjs emailtemplates       # open Settings → that section
//   node tools/verify.mjs billing --locale nl-NL --shot .verify-out/billing.png
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './serve.mjs';

const CDN_BLOCK = /jsdelivr\.net|supabase/i;

// Open the app in a fresh page with CDN blocked, app JS ready, admin seeded.
// opts: { port, section, locale, headless }
export async function openApp(opts = {}) {
  const { port = 8000, section = null, locale = null, headless = true } = opts;
  const { server, url } = await startServer(port);
  const browser = await chromium.launch({ headless });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.route('**/*', (route) => CDN_BLOCK.test(route.request().url()) ? route.abort() : route.continue());

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof showPage === 'function' && typeof showSS === 'function' && typeof i18nApply === 'function',
    null, { timeout: 30000 },
  );

  if (locale) await page.evaluate((loc) => { try { vxSetLocale(loc); } catch (e) {} }, locale);

  // Seed an admin + reveal the app shell.
  await page.evaluate((sec) => {
    try { CURRENT_USER = { id: 'verify', name: 'Verify Admin', role: 'Admin' }; } catch (e) { window.CURRENT_USER = { id: 'verify', name: 'Verify Admin', role: 'Admin' }; }
    const ls = document.getElementById('login-screen'); if (ls) ls.classList.add('hidden');
    if (sec) { showPage('settings', document.getElementById('tn-settings')); showSS(sec, document.getElementById('sni-' + sec)); }
  }, section);

  const close = async () => { await browser.close(); await new Promise((r) => server.close(r)); };
  return { browser, ctx, page, url, errors, close };
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

  const app = await openApp({ section, locale });
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  await app.page.screenshot({ path: shot });
  console.log(JSON.stringify({
    ok: true,
    section: section || '(dashboard)',
    locale: await app.page.evaluate(() => (typeof vxLocale === 'function' ? vxLocale() : 'n/a')),
    screenshot: shot,
    pageErrors: app.errors.slice(0, 10),
  }, null, 2));
  await app.close();
}
