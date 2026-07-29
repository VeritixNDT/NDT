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

test('cross-module hooks are registered regardless of load order', opts, async () => {
  // dashboard.js loads 14th but listens for events emitted by defects.js (21st)
  // and settings.js (12th). An earlier attempt put each registry in its emitting
  // module, so dashboard.js registered before the registry existed and threw at
  // load. The registries live in constants.js (2nd) for that reason; this asserts
  // the listeners actually attached.
  const app = await openApp({ section: 'overview' });
  try {
    const hooks = await app.page.evaluate(() => Object.fromEntries(
      ['report.stageChanged', 'defect.saved', 'db.refreshed']
        .map((e) => [e, (VX_HOOKS[e] || []).length]),
    ));
    for (const [event, n] of Object.entries(hooks)) {
      assert.ok(n > 0, `no listener registered for ${event} — the wiring was lost`);
    }
  } finally { await app.close(); }
});

test('the IndexedDB storage layer is present and functional', opts, async () => {
  // vxEntityStore/vxPhotos moved out of platform.js into storage.js. boot.js
  // calls vxEntityStore.hydrate() inside a try/catch, so losing the layer would
  // only log a warning — the page would still render and the sweep would still
  // pass. Assert the API is there and actually round-trips.
  const app = await openApp({ section: 'overview' });
  try {
    const r = await app.page.evaluate(async () => {
      const out = { entityStore: typeof vxEntityStore, photos: typeof vxPhotos, methods: [], roundTrip: null };
      if (typeof vxEntityStore !== 'object' || !vxEntityStore) return out;
      out.methods = ['hydrate', 'read', 'write', 'stats'].filter((m) => typeof vxEntityStore[m] === 'function');
      try {
        const key = 'vx-verify-probe';
        await vxEntityStore.write(key, JSON.stringify({ ok: 1 }));
        const back = await vxEntityStore.read(key);
        out.roundTrip = typeof back === 'string' ? JSON.parse(back).ok === 1 : false;
      } catch (e) { out.roundTrip = 'threw: ' + e.message; }
      return out;
    });
    assert.equal(r.entityStore, 'object', 'vxEntityStore missing');
    assert.equal(r.photos, 'object', 'vxPhotos missing');
    assert.deepEqual(r.methods, ['hydrate', 'read', 'write', 'stats'], 'the store API changed shape');
    assert.equal(r.roundTrip, true, `entity store did not round-trip: ${r.roundTrip}`);
  } finally { await app.close(); }
});

test('auth handlers moved to auth.js are still registered', opts, async () => {
  // These live on the login screen, which the harness hides — so the "every
  // rendered data-action resolves" test never sees them. They were registered
  // from platform.js before the split; platform.js loads first, so leaving the
  // registration there would have referenced them before auth.js had run.
  const app = await openApp({ section: 'overview' });
  try {
    const missing = await app.page.evaluate(() => [
      'doLogin', 'doOAuth', 'doRegister', 'liGuestMode', 'openMfaModal',
      'vxAuthTabSwitch', 'vxOpenBilling', 'vxOpenForgotPassword', 'vxRefreshPlan',
      'vxRenderSubscription', 'vxSignOut',
    ].filter((n) => typeof vxResolveAction(n) !== 'function'));
    assert.deepEqual(missing, []);
  } finally { await app.close(); }
});

test('platform chrome renders after being split into platform-ui.js', opts, async () => {
  // The mode pill, trial banner, welcome and sync modals moved out of
  // platform.js. If platform-ui.js failed to load, nothing would throw — the
  // pill simply would not update and the five window listeners would never
  // attach. Silent, and the 30-page sweep would still pass. So assert the
  // functions exist AND that calling the renderer actually fills the pill.
  const app = await openApp({ section: 'overview' });
  try {
    const r = await app.page.evaluate(() => {
      // Top-level declarations in a classic script land on window, so this is
      // a straight existence check.
      const fns = ['updateDeployModePill', 'renderTrialBanner', 'vxOpenWelcome', 'vxOpenSyncActivity']
        .filter((n) => typeof window[n] !== 'function');
      const pill = document.getElementById('vx-mode-pill');
      let rendered = null;
      if (pill) { try { updateDeployModePill(); rendered = pill.textContent.trim().length > 0; } catch (e) { rendered = 'threw: ' + e.message; } }
      return { missing: fns, pillPresent: !!pill, rendered };
    });
    assert.deepEqual(r.missing, [], 'chrome functions are missing — did platform-ui.js load?');
    assert.equal(r.pillPresent, true, '#vx-mode-pill is not in the shell');
    assert.equal(r.rendered, true, 'updateDeployModePill() left the pill empty');
  } finally { await app.close(); }
});

test('the API client survives being split into api.js', opts, async () => {
  // vxApi is every network call in the app. Nothing invokes it during boot, so
  // if api.js failed to load nothing would throw — vxApi would just be
  // undefined and the first user action needing the network would die. Silent,
  // with all 30 pages still rendering. Pin the surface so a partial move is
  // caught here rather than by a user.
  const EXPECTED = [
    'request', 'refreshToken', 'login', 'register', 'logout', 'hydrate',
    'hydrateReportHtml', 'hydrateReports', 'hydratePortalEvents', 'upsertEntity',
    'deleteEntity', 'sendEmail', 'inviteMember', 'listPendingInvites', 'revokeInvite',
  ];
  const app = await openApp({ section: 'overview' });
  try {
    const r = await app.page.evaluate((expected) => ({
      type: typeof vxApi,
      missing: typeof vxApi === 'object' && vxApi
        ? expected.filter((m) => typeof vxApi[m] !== 'function') : expected,
    }), EXPECTED);
    assert.equal(r.type, 'object', 'vxApi missing — did api.js load?');
    assert.deepEqual(r.missing, [], 'API methods lost in the split');
  } finally { await app.close(); }
});

test('workspace org identity survives being split into workspace.js', opts, async () => {
  // boot.js calls vxLoadOrgName() behind a `typeof === 'function'` guard, so if
  // workspace.js failed to load nothing would throw — the org name would simply
  // never render, with all 30 pages still passing. Assert the functions exist
  // and that the renderer actually writes the sidebar org blocks.
  //
  // It writes `.snav-org-name` inside the per-page org blocks, NOT
  // #vx-org-pill-name — that element belongs to a different function. Asserting
  // the pill here failed, and the cause was this comment being wrong rather
  // than the split.
  const app = await openApp({ section: 'overview' });
  try {
    const r = await app.page.evaluate(() => {
      const fns = ['vxLoadOrgName', 'vxRenderSidebarOrgBlock', 'vxOpenWorkspaceSettings', 'vxSaveOrgName']
        .filter((n) => typeof window[n] !== 'function');
      const targets = document.querySelectorAll('.snav-org-name');
      let wrote = null;
      if (targets.length) {
        try {
          vxRenderSidebarOrgBlock('Verify Co');
          wrote = [...document.querySelectorAll('.snav-org-name')].some((e) => e.textContent === 'Verify Co');
        } catch (e) { wrote = 'threw: ' + e.message; }
      }
      return { missing: fns, targetCount: targets.length, wrote };
    });
    assert.deepEqual(r.missing, [], 'workspace functions missing — did workspace.js load?');
    assert.ok(r.targetCount > 0, 'no .snav-org-name elements in the shell');
    assert.equal(r.wrote, true, 'vxRenderSidebarOrgBlock() did not write the org name');
  } finally { await app.close(); }
});

test('portal events, webhooks and notifications survive the split', opts, async () => {
  // Consumed from five files (platform, billing, reports, ui, settings), and
  // every call site is guarded or lazy — so if portal-events.js failed to load
  // nothing would throw at boot. Portal notifications would silently stop and
  // invoice-due mail would silently never send, with all 30 pages passing.
  //
  // vxNotifySettings() merges VX_NOTIFY_DEFAULTS, so calling it also proves the
  // constants moved with the functions rather than being left behind.
  const app = await openApp({ section: 'overview' });
  try {
    const r = await app.page.evaluate(() => {
      const missing = ['vxPullPortalEvents', 'vxNotifyCheckInvoices', 'vxPortalNotifs',
        'vxPortalNotifUnread', 'vxEmitWebhook', 'vxNotifySettings']
        .filter((n) => typeof window[n] !== 'function');
      // No initialisers: both try/catch pairs below assign on every path.
      let settingsKeys, notifs;
      try { settingsKeys = Object.keys(vxNotifySettings()).sort(); } catch (e) { settingsKeys = 'threw: ' + e.message; }
      try { notifs = Array.isArray(vxPortalNotifs()); } catch (e) { notifs = 'threw: ' + e.message; }
      return { missing, settingsKeys, notifs };
    });
    assert.deepEqual(r.missing, [], 'portal/notification functions missing — did portal-events.js load?');
    assert.ok(Array.isArray(r.settingsKeys) && r.settingsKeys.includes('enabled') && r.settingsKeys.includes('invoiceDue'),
      `vxNotifySettings() lost its defaults: ${JSON.stringify(r.settingsKeys)}`);
    assert.equal(r.notifs, true, 'vxPortalNotifs() did not return an array');
  } finally { await app.close(); }
});
