// Tests for the Playwright verification harness.
//
// The harness used to report ok:true on a page where nothing had rendered: it
// activated no page unless given a section, routed every section through the
// Settings shell (so top-level pages were unreachable), silently accepted
// unknown section names, and screenshotted before the first paint.
//
// These launch a real browser. In environments without Chromium installed
// (CI skips the download — see .github/workflows/ci.yml) they skip rather than
// fail, so `npm test` stays meaningful without a 100s-of-MB download.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { openApp, gotoTarget, checkRendered, PAGES, SETTINGS_SECTIONS } from './verify.mjs';

let reason = false;
try { if (!fs.existsSync(chromium.executablePath())) reason = 'Chromium not installed'; }
catch { reason = 'Chromium not installed'; }
const opts = reason ? { skip: reason } : {};

const activePage = (page) => page.evaluate(() => document.querySelector('.page.active')?.id || '(none)');

test('defaults to the overview page rather than activating nothing', opts, async () => {
  const app = await openApp();
  try {
    assert.equal(await activePage(app.page), 'page-overview');
  } finally { await app.close(); }
});

test('activates a top-level page directly, not via the settings shell', opts, async () => {
  const app = await openApp({ section: 'reports' });
  try {
    assert.equal(await activePage(app.page), 'page-reports');
  } finally { await app.close(); }
});

test('routes a settings subsection through the settings shell', opts, async () => {
  const app = await openApp({ section: 'appearance' });
  try {
    assert.equal(await activePage(app.page), 'page-settings');
  } finally { await app.close(); }
});

test('rejects an unknown section instead of silently rendering nothing', opts, async () => {
  await assert.rejects(
    () => openApp({ section: 'not-a-real-section' }),
    /unknown section/i,
  );
});

test('checkRendered passes on a page that actually rendered', opts, async () => {
  const app = await openApp({ section: 'reports' });
  try {
    const r = await checkRendered(app.page, app.errors);
    assert.deepEqual(r.failures, []);
    assert.equal(r.ok, true);
  } finally { await app.close(); }
});

test('checkRendered fails when the active page is emptied out', opts, async () => {
  const app = await openApp({ section: 'reports' });
  try {
    // Simulate the blank-page state the harness used to pass on.
    await app.page.evaluate(() => { document.querySelectorAll('.page.active').forEach((e) => e.classList.remove('active')); });
    const r = await checkRendered(app.page, app.errors);
    assert.equal(r.ok, false, 'a page with nothing active must not pass');
    assert.ok(r.failures.length > 0);
  } finally { await app.close(); }
});

test('exposes the page and settings-section names it accepts', opts, async () => {
  assert.ok(PAGES.includes('reports') && PAGES.includes('overview'));
  assert.ok(SETTINGS_SECTIONS.includes('appearance'));
  assert.equal(PAGES.includes('appearance'), false, 'settings subsections are not top-level pages');
});

test('gotoTarget switches targets inside one already-open page', opts, async () => {
  // The all-targets sweep reuses a single browser; without this it would launch
  // ~30 of them and take a minute and a half.
  const app = await openApp({ section: 'reports' });
  try {
    assert.equal(await activePage(app.page), 'page-reports');
    await gotoTarget(app.page, 'defects');
    assert.equal(await activePage(app.page), 'page-defects');
    await gotoTarget(app.page, 'appearance');
    assert.equal(await activePage(app.page), 'page-settings');
  } finally { await app.close(); }
});

// Handlers that still come from the window fallback rather than the registry.
// Deliberately empty: every rendered data-action is now registered, so the
// fallback in vxResolveAction is dead weight that can be removed — and the ES
// module conversion is no longer blocked by window[action]. Anything added here
// re-blocks both, so add only with a reason.
const WINDOW_ONLY = new Set([]);

test('every rendered data-action resolves, and via the registry not window', opts, async () => {
  // The router used to resolve handlers with window[action]; they are now
  // registered explicitly (see vxActions in js/constants.js). This asserts both
  // that nothing lost its handler and that the registry — not the fallback —
  // is what answers.
  const app = await openApp({ section: 'overview' });
  try {
    const bad = [];
    for (const target of ['overview', 'reports', 'jobs', 'defects', 'billing', 'planner', 'inbox', 'settings']) {
      await gotoTarget(app.page, target);
      const res = await app.page.evaluate(() => {
        const names = new Set();
        for (const el of document.querySelectorAll('[data-action],[data-on-change],[data-on-input]')) {
          for (const k of ['action', 'onChange', 'onInput']) if (el.dataset[k]) names.add(el.dataset[k]);
        }
        return [...names].map((n) => ({
          name: n,
          resolves: typeof vxResolveAction(n) === 'function',
          registered: vxActionIsRegistered(n),
        }));
      });
      for (const h of res) {
        if (!h.resolves) bad.push(`${target}: ${h.name} resolves to nothing`);
        else if (!h.registered && !WINDOW_ONLY.has(h.name)) {
          bad.push(`${target}: ${h.name} only resolves via the window fallback`);
        }
      }
    }
    assert.deepEqual(bad, []);
  } finally { await app.close(); }
});
