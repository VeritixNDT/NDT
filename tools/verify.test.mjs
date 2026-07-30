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

test('realtime and the photo wrapper survive the split', opts, async () => {
  // boot.js calls vxRealtimeConnect/Disconnect behind `typeof === 'function'`
  // guards (boot.js:194, :221), so losing realtime.js throws nothing — live
  // cross-device updates would just silently stop, with all 30 pages passing.
  // vxUploadPhoto moved the other way, into storage.js beside vxPhotos.
  //
  // vxRealtimeDisconnect() guards on _vxWs being set, so calling it while
  // disconnected is a safe no-op — a real check that the body came across, not
  // just the name.
  const app = await openApp({ section: 'overview' });
  try {
    const r = await app.page.evaluate(() => {
      const missing = ['vxRealtimeConnect', 'vxRealtimeDisconnect', '_vxDispatchEntityChange', 'vxUploadPhoto']
        .filter((n) => typeof window[n] !== 'function');
      let disconnectOk;
      try { vxRealtimeDisconnect(); disconnectOk = true; } catch (e) { disconnectOk = 'threw: ' + e.message; }
      return { missing, disconnectOk, pingInterval: typeof VX_WS_PING_INTERVAL_MS };
    });
    assert.deepEqual(r.missing, [], 'realtime/photo functions missing — did realtime.js load?');
    assert.equal(r.disconnectOk, true, 'vxRealtimeDisconnect() threw when idle');
    assert.equal(r.pingInterval, 'number', 'VX_WS_PING_INTERVAL_MS did not travel with the block');
  } finally { await app.close(); }
});

test('device and role gating survive the split', opts, async () => {
  // Security-adjacent, and the failure would be silent in the worst way:
  // boot.js reads `typeof vxIsAdmin === 'function' ? vxIsAdmin() : CURRENT_USER
  // ?.role === 'Admin'`, so losing gating.js does not throw — it quietly falls
  // back to the weaker check, with all 30 pages still passing.
  //
  // The harness seeds CURRENT_USER.role = 'Admin', and vxIsAdmin() returns true
  // on that alone (gating.js), so this exercises the real body. Asserting the
  // Set proves the constant travelled with the functions rather than being left.
  const app = await openApp({ section: 'overview' });
  try {
    const r = await app.page.evaluate(() => {
      const missing = ['vxIsAdmin', 'vxIsSeniorOrAdmin', 'vxRequireAdmin', 'vxApplyRoleGating',
        'vxApplyDeviceGating', 'vxIsDesktopClass']
        .filter((n) => typeof window[n] !== 'function');
      // Seed here, not relying on the harness's: the app's async auth init
      // clears CURRENT_USER once it finds no session, so by the time this
      // evaluate runs it is gone again. Asserting vxIsAdmin() without setting
      // it tests that race, not the function. (Same cause as the settings-target
      // flakiness that made gotoTarget re-seed on every navigation.)
      let isAdmin, sections;
      try {
        CURRENT_USER = { id: 'verify', name: 'Verify Admin', role: 'Admin' };
        isAdmin = vxIsAdmin();
      } catch (e) { isAdmin = 'threw: ' + e.message; }
      try { sections = VX_ADMIN_ONLY_SECTIONS instanceof Set ? VX_ADMIN_ONLY_SECTIONS.size : 'not a Set'; }
      catch (e) { sections = 'threw: ' + e.message; }
      return { missing, isAdmin, sections };
    });
    assert.deepEqual(r.missing, [], 'gating functions missing — did gating.js load?');
    assert.equal(r.isAdmin, true, 'vxIsAdmin() did not recognise the seeded Admin user');
    assert.ok(typeof r.sections === 'number' && r.sections > 10,
      `VX_ADMIN_ONLY_SECTIONS did not travel with the block: ${r.sections}`);
  } finally { await app.close(); }
});

test('the global error net survives being split into errors.js', opts, async () => {
  // The net that catches everything else cannot be checked by "does the page
  // render" — a page renders perfectly with no error handler attached. And the
  // failure is worse than silent: losing errors.js removes the thing that makes
  // OTHER silent failures visible. It is what surfaced the aborted js/supabase.js
  // load in the tenth slice.
  //
  // So this does not check for the function. It dispatches a real ErrorEvent and
  // asserts the listener ran, which is the only assertion that covers the two
  // top-level addEventListener calls rather than the hoisted declaration.
  const app = await openApp({ section: 'overview' });
  try {
    const r = await app.page.evaluate(() => {
      const before = _vxErrorCount;
      // Capture-phase listener on window; dispatching directly on window fires
      // it in the at-target phase regardless of the capture flag.
      window.dispatchEvent(new ErrorEvent('error', { error: new Error('synthetic — errors.js split test') }));
      return {
        fn: typeof window.vxReportError,
        countBefore: before,
        countAfter: _vxErrorCount,
        window: typeof _vxErrorWindow,
        max: _vxErrorMaxPerWindow,
      };
    });
    assert.equal(r.fn, 'function', 'vxReportError missing — did errors.js load?');
    assert.equal(r.countAfter, r.countBefore + 1,
      'the window error listener did not fire — the top-level addEventListener did not travel');
    assert.equal(r.window, 'number', '_vxErrorWindow did not travel with the block');
    assert.equal(r.max, 3, '_vxErrorMaxPerWindow did not travel with the block');
  } finally { await app.close(); }
});

test('the online listener moved to sync.js still flushes the queue', opts, async () => {
  // This listener spent its life inside platform.js's error-handler block, which
  // is why the ninth slice had to reason about it: it was the one apparent
  // top-level call into the sync queue. The twelfth slice moved it to sync.js,
  // beside the flush it triggers.
  //
  // Nothing else would notice if it were lost. The 30s periodic sweep also calls
  // vxSyncFlush, so queued work would still go up — just up to 30 seconds later
  // instead of ~800ms after connectivity returns. No error, no visible symptom,
  // only a slower reconnect. Stub the flush and prove the wiring.
  const app = await openApp({ section: 'overview' });
  try {
    const flushed = await app.page.evaluate(async () => {
      let calls = 0;
      vxSyncFlush = () => { calls++; return Promise.resolve({}); };
      window.dispatchEvent(new Event('online'));
      // The handler defers by 800ms so the connection can settle.
      await new Promise((r) => setTimeout(r, 1400));
      return calls;
    });
    assert.equal(flushed, 1, 'the online event did not reach vxSyncFlush — did the listener travel to sync.js?');
  } finally { await app.close(); }
});

test('plan gates survive being split into plan.js', opts, async () => {
  // Only three names are consumed outside this file — vxPlanConfig (auth.js:17),
  // vxPlanSet (5 sites in auth.js) and vxPlan.openBilling (ui.js:752) — and the
  // first two are only reached by opening Settings → Subscription. So losing
  // plan.js throws nothing at boot and the 30-page sweep still passes; the
  // subscription page would just render with no tier and the billing button
  // would die on click. Assert the surface and exercise real bodies.
  //
  // vxPlan.has()/withinLimit()/recordUsage()/showPaywall() have NO callers in
  // the app (see the file header). They are asserted here anyway: the whole
  // point of isolating the module is that its contents stay visible rather than
  // rotting inside an infrastructure file.
  const app = await openApp({ section: 'subscription' });
  try {
    const r = await app.page.evaluate(() => {
      const missing = ['vxPlanConfig', 'vxPlanSet'].filter((n) => typeof window[n] !== 'function');
      const methods = typeof vxPlan === 'object' && vxPlan
        ? ['has', 'withinLimit', 'recordUsage', 'showPaywall', 'openBilling'].filter((m) => typeof vxPlan[m] !== 'function')
        : ['(vxPlan is not an object)'];
      let tier, limitOk, currentIsConfig;
      // vxPlanConfig() merges VX_PLAN_DEFAULTS, so reading tier back proves the
      // constant travelled with the functions rather than being left behind.
      try { tier = vxPlanConfig().tier; } catch (e) { tier = 'threw: ' + e.message; }
      // Infinity limits mean withinLimit() is true for any addition. A real body
      // check that does not depend on auth state.
      try { limitOk = vxPlan.withinLimit('maxReports', 10_000); } catch (e) { limitOk = 'threw: ' + e.message; }
      // `current: vxPlanConfig` is captured by value when the object literal is
      // evaluated at load — this is the one assertion covering that.
      try { currentIsConfig = vxPlan.current === vxPlanConfig; } catch (e) { currentIsConfig = 'threw: ' + e.message; }
      return { missing, methods, tier, limitOk, currentIsConfig, planKey: typeof VX_PLAN_KEY };
    });
    assert.deepEqual(r.missing, [], 'plan functions missing — did plan.js load?');
    assert.deepEqual(r.methods, [], 'vxPlan lost methods in the split');
    assert.equal(r.tier, 'unlimited', 'VX_PLAN_DEFAULTS did not travel with the block');
    assert.equal(r.planKey, 'string', 'VX_PLAN_KEY did not travel with the block');
    assert.equal(r.limitOk, true, 'vxPlan.withinLimit() did not honour the Infinity default');
    assert.equal(r.currentIsConfig, true, 'vxPlan.current is not bound to vxPlanConfig');
  } finally { await app.close(); }
});

test('blocks the third-party CDN by origin without blocking same-origin scripts', opts, async () => {
  // CDN_BLOCK was /jsdelivr\.net|supabase/i tested against the whole request
  // URL. That blocks the jsDelivr bundle as intended — and also aborted the
  // app's own http://127.0.0.1:PORT/js/supabase.js the moment that file existed.
  // It is now matched against the hostname. Both directions are asserted here,
  // because loosening it too far is as bad as the bug: the sweep would start
  // making real network calls to Supabase and stop being deterministic.
  const app = await openApp({ section: 'overview' });
  try {
    const r = await app.page.evaluate(() => ({
      // The UMD bundle sets window.supabase. Blocked → still undefined.
      cdnLoaded: typeof window.supabase,
      // Same-origin, and its name matches the old regex. Must have loaded.
      localLoaded: typeof window._vxSupabase,
    }));
    assert.equal(r.cdnLoaded, 'undefined', 'the jsDelivr Supabase bundle was NOT blocked — the sweep is hitting the network');
    assert.equal(r.localLoaded, 'function', 'same-origin js/supabase.js was blocked — CDN_BLOCK is matching the path, not the host');
  } finally { await app.close(); }
});

test('the Supabase glue survives being split into supabase.js', opts, async () => {
  // The worst silent failure in the series. Eighteen files reach for the client
  // through `typeof _vxSupabase === 'function' ? _vxSupabase() : null`, so if
  // supabase.js failed to load every one of those guards would take the null
  // branch — no throw, all 30 pages rendering, and the app quietly behaving as
  // an unconfigured trial: no sync, no org, no realtime, work never leaving the
  // device. Exactly the class of bug the safety net exists to make visible.
  //
  // Assertions chosen to exercise real bodies, not just names:
  //   - _vxReadMetaSupabaseUrl() must return the shell's actual meta content,
  //     which proves the reader travelled AND still sees the live tag.
  //   - _vxRoleToDisplay('observer') === 'Viewer' — the one non-obvious entry
  //     in the map, so a truncated switch fails here.
  //   - window.vxSupabaseConfigured is the block's ONLY top-level statement.
  //     The hoisted declaration would satisfy a `typeof` check on its own, so
  //     this is the one assertion that actually covers that executable line.
  //
  // vxSupabaseConfigured() is deliberately NOT asserted true: it needs the CDN
  // UMD bundle, which the harness blocks on purpose (see the CDN_BLOCK test
  // above). Assert it returns a boolean without throwing instead — that checks
  // the body arrived without depending on network state.
  const app = await openApp({ section: 'overview' });
  try {
    const r = await app.page.evaluate(() => {
      const missing = ['_vxSupabase', '_vxDisposeSupabaseClient', 'vxSupabaseConfigured',
        '_vxApplySupabaseSession', '_vxResolveOrgMembership', '_vxCreateOrgForUser',
        '_vxMaterializeCloudUser', '_vxRoleToDisplay', '_vxReadMetaSupabaseUrl',
        '_vxReadMetaSupabaseAnonKey']
        .filter((n) => typeof window[n] !== 'function');
      const metaUrl = document.querySelector('meta[name="vx-supabase-url"]')?.getAttribute('content') || null;
      let readUrl, role, disposeOk, configured;
      try { readUrl = _vxReadMetaSupabaseUrl(); } catch (e) { readUrl = 'threw: ' + e.message; }
      try { role = _vxRoleToDisplay('observer'); } catch (e) { role = 'threw: ' + e.message; }
      try { _vxDisposeSupabaseClient(null); disposeOk = true; } catch (e) { disposeOk = 'threw: ' + e.message; }
      try { configured = typeof vxSupabaseConfigured(); } catch (e) { configured = 'threw: ' + e.message; }
      return {
        missing, readUrl, role, disposeOk, configured,
        metaUrl: metaUrl && metaUrl.replace(/\/+$/, ''),
        exposedOnWindow: typeof window.vxSupabaseConfigured,
      };
    });
    assert.deepEqual(r.missing, [], 'Supabase functions missing — did supabase.js load?');
    assert.equal(r.readUrl, r.metaUrl, '_vxReadMetaSupabaseUrl() did not read the shell meta tag');
    assert.equal(r.role, 'Viewer', "_vxRoleToDisplay('observer') lost its mapping in the move");
    assert.equal(r.disposeOk, true, '_vxDisposeSupabaseClient(null) threw instead of no-opping');
    assert.equal(r.configured, 'boolean', 'vxSupabaseConfigured() did not return a boolean');
    assert.equal(r.exposedOnWindow, 'function',
      'window.vxSupabaseConfigured is not set — the block\'s only top-level statement did not travel');
  } finally { await app.close(); }
});
