// ══════════════════════════════════════════════════════════════════════════
// Platform boot — starting the platform layer, and deep links.
// ══════════════════════════════════════════════════════════════════════════
// Split out of js/platform.js (thirteenth slice). Two things that run at or near
// startup rather than serving the storage seam the rest of platform.js is: the
// hash router for mobile deep links, and vxPlatformBoot().
//
// boot.js:76 calls this behind `typeof vxPlatformBoot === 'function'`, so losing
// this file throws nothing. The consequences are entirely invisible to a render
// check: the sync sweep never starts (vxSyncStart), realtime never connects, and
// deep links stop resolving. Every page still draws. tools/verify.test.mjs
// asserts the wiring for that reason.
//
// ── NO SERVICE WORKER, and why (2026-07-30) ───────────────────────────────
// This file used to carry vxRegisterServiceWorker() and a ~90-line inlined
// worker body. Both are gone, along with a second registration in export.js.
// Measured in Chromium before deleting anything:
//
//   registrations after a full boot           0, no controller
//   register(blob:…)   — this file's path     TypeError: The URL protocol of
//                                             the script ('blob:…') is not
//                                             supported
//   register('sw.js')  — export.js's path     404 in dev; in production the
//                                             Netlify SPA fallback returns
//                                             index.html, so SecurityError:
//                                             unsupported MIME type 'text/html'
//
// So the app had two service-worker registrations and zero service workers,
// since 2026-05-15. sw.js has never existed in the repo and is not in the
// Netlify publish dir. The old comments here claimed the Blob approach "works in
// all modern browsers" and that "Chromium permits" it; both were false.
//
// Nothing caught it because both paths failed quietly — export.js used
// `.catch(() => {})`, this one console.warn'd — and tools/verify.mjs listed
// /ServiceWorker/i in EXPECTED_NOISE, discarding exactly that signal. That
// filter has been removed, so a future service-worker error fails the run.
//
// What this costs: no offline COLD START, and no Background Sync. Offline *work*
// is unaffected — it runs on localStorage/IndexedDB with the 30s sweep and the
// `online` listener in sync.js. The user docs never overclaimed: help.js:536 says
// "every feature works offline once the page is loaded", which is exactly right
// without a worker. Deploy freshness comes from netlify.toml's no-cache headers,
// not from a worker.
//
// If a real service worker is ever wanted, it needs a genuine /sw.js in the
// publish dir, a redirect exception so the SPA fallback does not swallow it, and
// ONE registration site. Weigh it against this being an audit tool whose stated
// policy is that a browser must never run stale code — a caching worker is
// precisely what can serve stale assets, and a bad one is hard to recall.
//
// LOAD POSITION. It sits at the end of the platform group, after platform-ui.js,
// rather than where the block used to execute inside platform.js. That is a
// change in when `window.addEventListener('hashchange', …)` attaches, and it is
// safe for a specific reason rather than by assumption: every app script is
// `defer`, so they run back-to-back with no chance for the user to interact and
// no hashchange to miss. The initial route is not read by the listener anyway —
// vxPlatformBoot() calls vxRouteFromHash() explicitly on a timer once bootApp
// has placed the nav buttons.
//
// Reading it here also matches what it does: it is the thing that starts the
// platform, so it belongs after the platform it starts.

// ── Deep linking via URL hash (mobile bridge friendly) ────────────────────
// Phone wrapper apps (Capacitor / Cordova / native shell) can navigate to
// specific records by setting `location.hash = '#/reports/SV-2026-00042'`.
// We parse this once at boot and on hashchange; the routes map fragments to
// app navigation actions.
function vxRouteFromHash() {
  const h = (location.hash || '').replace(/^#/, '').split('?')[0];
  if(!h || h === '/') return;
  const parts = h.split('/').filter(Boolean);
  // /reports, /reports/REPORT_NO, /defects, /inbox, /help, /help/CHAPTER, /settings/SECTION
  try {
    if(parts[0] === 'reports') {
      showPage('reports', document.getElementById('tn-reports'));
      // Specific report deep-link: filter by report no.
      if(parts[1]) setTimeout(() => { const f = el('rpt-f-repno'); if(f) { f.value = parts[1]; if(typeof rptRender === 'function') rptRender(); } }, 100);
    } else if(parts[0] === 'defects') {
      showPage('defects', document.getElementById('tn-defects'));
    } else if(parts[0] === 'inbox') {
      showPage('inbox', document.getElementById('tn-inbox'));
    } else if(parts[0] === 'home' || parts[0] === 'dashboard') {
      showPage('overview', document.querySelector('.tn'));
    } else if(parts[0] === 'help') {
      if(typeof helpOpen === 'function') helpOpen(parts[1] || 'welcome');
    } else if(parts[0] === 'settings') {
      showPage('settings', el('tn-settings'));
      if(parts[1]) setTimeout(() => { if(typeof showSS === 'function') showSS(parts[1], el('sni-' + parts[1])); }, 100);
    }
  } catch(e){ console.warn('vxRouteFromHash', e); }
}
window.addEventListener('hashchange', vxRouteFromHash);

// ── Boot the platform layer ───────────────────────────────────────────────
function vxPlatformBoot() {
  vxSyncStart();
  // NO SERVICE WORKER IS REGISTERED, deliberately. vxRegisterServiceWorker()
  // was called here and registered a Blob-URL worker; it was deleted on
  // 2026-07-30 because it had never once succeeded. Chromium rejects `blob:`
  // as a script protocol outright ("The URL protocol of the script ('blob:…')
  // is not supported"), so the ~90 lines of inlined worker body it carried had
  // never run in any browser. See the file header for the full measurement.
  // V14: if signed in at boot, open the realtime channel
  if(vxIsAuthenticated()) {
    try { vxRealtimeConnect(); } catch(e){}
  }
  // Run the deep-link router after bootApp has placed nav buttons
  setTimeout(() => vxRouteFromHash(), 100);
}
