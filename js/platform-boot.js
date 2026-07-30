// ══════════════════════════════════════════════════════════════════════════
// Platform boot — starting the platform layer, deep links, and the SW.
// ══════════════════════════════════════════════════════════════════════════
// Split out of js/platform.js (thirteenth slice). Three things that run at or
// near startup rather than serving the storage seam the rest of platform.js is:
// the hash router for mobile deep links, vxPlatformBoot(), and the service
// worker registration with its inlined SW body.
//
// boot.js:76 calls this behind `typeof vxPlatformBoot === 'function'`, so losing
// this file throws nothing. The consequences are entirely invisible to a render
// check: the sync sweep never starts (vxSyncStart), realtime never connects, no
// service worker registers, and deep links stop resolving. Every page still
// draws. tools/verify.test.mjs asserts the wiring for that reason.
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
  // V14: register a minimal service worker for offline shell + background
  // sync. The SW body is inlined via Blob URL because the single-file
  // architecture has no separate sw.js file. This works in all modern browsers
  // but the SW scope is limited to the current URL.
  try { vxRegisterServiceWorker(); } catch(e){ console.warn('SW registration failed', e); }
  // V14: if signed in at boot, open the realtime channel
  if(vxIsAuthenticated()) {
    try { vxRealtimeConnect(); } catch(e){}
  }
  // Run the deep-link router after bootApp has placed nav buttons
  setTimeout(() => vxRouteFromHash(), 100);
}

// V14: inline service worker registration. Service workers must come from a
// same-origin URL with a JavaScript MIME type. We construct one via Blob URL.
// Note: Blob-URL service workers have an empty scope and can't intercept
// page navigations the same way file-based SWs can — for full PWA install
// the deploy pipeline should serve a real /sw.js file.
async function vxRegisterServiceWorker() {
  if(!('serviceWorker' in navigator)) return;
  // Blob-URL SWs have known limitations across browsers (Chromium permits,
  // Firefox/Safari restrict). Detect and gracefully skip on those.
  // We register only if location is same-origin file or http(s).
  if(location.protocol !== 'http:' && location.protocol !== 'https:') return;

  const swCode = `
    // Veritix service worker — minimal shell + background sync placeholder
    // CACHE name is versioned PER BUILD (VX_BUILD is injected below), so every
    // deploy gets a fresh cache and the activate handler purges the old one —
    // no stale js/*.js can survive a deploy.
    const CACHE = 'veritix-shell-${(typeof VX_BUILD !== 'undefined' ? VX_BUILD : 'v2')}';
    self.addEventListener('install', (e) => {
      self.skipWaiting();
    });
    self.addEventListener('activate', (e) => {
      // Purge any cache that isn't the current version — this is what
      // evicts the old cache-first JS bundles from veritix-shell-v1.
      e.waitUntil(
        caches.keys()
          .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
          .then(() => self.clients.claim())
      );
    });
    self.addEventListener('fetch', (e) => {
      const url = new URL(e.request.url);
      if(url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
        // NETWORK-FIRST for the app shell. The previous cache-first
        // strategy meant a cached editor.js / dashboard.js was served
        // forever — code updates never reached the user without a
        // manual cache wipe. Now the live file always wins when online;
        // the cache is only a fallback for genuine offline use.
        e.respondWith(
          fetch(e.request).then(res => {
            if(res.ok && res.type === 'basic'){
              const clone = res.clone();
              caches.open(CACHE).then(c => c.put(e.request, clone));
            }
            return res;
          }).catch(() =>
            caches.open(CACHE).then(c => c.match(e.request).then(r => r || caches.match('/')))
          )
        );
      }
      // API calls pass through — the app's sync queue handles offline
    });
    // V14: Background Sync — replay the sync queue when connectivity returns
    self.addEventListener('sync', (e) => {
      if(e.tag === 'vx-sync-flush') {
        e.waitUntil(
          self.clients.matchAll().then(clients => {
            clients.forEach(client => client.postMessage({ type: 'sync-now' }));
          })
        );
      }
    });
    // Push notification placeholder — fires when the server sends a push
    self.addEventListener('push', (e) => {
      const data = e.data ? e.data.json() : { title: 'Veritix', body: 'New activity' };
      e.waitUntil(
        self.registration.showNotification(data.title || 'Veritix', {
          body: data.body || '',
          icon: data.icon,
          tag: data.tag,
          data: data.data || {},
        })
      );
    });
    self.addEventListener('notificationclick', (e) => {
      e.notification.close();
      const url = e.notification.data?.url || '/';
      e.waitUntil(self.clients.openWindow(url));
    });
  `;
  const blob = new Blob([swCode], { type: 'application/javascript' });
  const swUrl = URL.createObjectURL(blob);
  try {
    const reg = await navigator.serviceWorker.register(swUrl);
    console.log('vx: service worker registered', reg.scope);

    // When the SW asks us to sync (after a Background Sync event), do it
    navigator.serviceWorker.addEventListener('message', (e) => {
      if(e.data?.type === 'sync-now') {
        if(vxIsAuthenticated()) vxSyncFlush().catch(() => {});
      }
    });

    // Register for Background Sync when the queue has work
    window.addEventListener('vx:sync-change', async () => {
      if('sync' in reg) {
        const stats = vxSyncStats();
        if(stats.pending > 0 || stats.failed > 0) {
          try { await reg.sync.register('vx-sync-flush'); } catch(e){}
        }
      }
    });
  } catch(e) {
    // Some browsers refuse Blob-URL SWs (Safari, Firefox). Not a failure mode
    // the user should see — log and move on.
    console.warn('vx: SW registration via Blob URL not supported:', e.message);
  }
}
