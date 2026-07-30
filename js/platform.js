// ══════════════════════════════════════════════════════════════════════════
// PLATFORM — the storage seam: which keys are user data, and where reads and
// writes actually go.
// ══════════════════════════════════════════════════════════════════════════
// The seam between the offline-first local app and the server. The `ls()` /
// `lss()` surface is preserved unchanged so all ~120 call sites continue to
// work; entity routing, dirty tracking and sync enqueueing happen underneath
// them. What lives here now:
//
//   - platform config (endpoint, tokens, org/user identity) and the auth-state
//     predicates derived from it
//   - VX_ENTITY_KEYS, the registry of what counts as user data, with the boot
//     assertion that catches an unclassified key before it silently fails to
//     sync
//   - ls() / lss(), the dirty flags, and vxStore
//   - vxPullReports(), the per-report merge that stops two devices clobbering
//     each other
//
// This file was 4,658 lines and roughly twelve responsibilities. Fifteen slices
// took it to ~360 by moving each one out to a file of its own; the git log for
// js/platform.js records what went where and what was checked each time. The
// header this replaces still advertised the API client, the sync queue and the
// plan gates, all of which left in the eighth, ninth and eleventh slices.
//
// One correction while rewriting it. That header said "When VX_MODE === 'local'
// (current production default), everything behaves exactly as before." There is
// no local mode: vxIsCloud() has been `return true` since V13, and the V13 note
// below says so. The product is cloud-only with local storage as its offline
// cache.

var VX_PLATFORM_KEY    = 'vx-platform-v1';      // mode + tokens + endpoint config
var VX_SYNC_QUEUE_KEY  = 'vx-sync-queue-v1';    // pending mutations awaiting upload
var VX_SYNC_DROPPED_KEY = 'vx-sync-dropped-v1'; // ops permanently dropped after exhausting the retry budget
var VX_DIRTY_FLAGS_KEY = 'vx-dirty-flags-v1';   // per-key last-modified-locally timestamps
// V45: heavy-field offload. The big immutable HTML snapshots on each report
// (frozenHtml/sealedHtml, ~650KB each) are split OUT of the vx-reports-v1 blob
// and synced as write-once per-report rows keyed 'vx-report-html::<reportId>',
// so a routine metadata change re-uploads ~1-2KB instead of ~2MB. See the
// reports-sync-blob-size note. VX_HEAVY_FIELDS maps a collection key to the
// fields hoisted into per-item rows.
var VX_HTML_PREFIX     = 'vx-report-html::';
var VX_HTML_SIG_KEY    = 'vx-rpt-html-sig-v1'; // {reportId: sig} of HTML already synced
var VX_HEAVY_FIELDS    = { 'vx-reports-v1': ['sealedHtml', 'frozenHtml'] };
// V48: per-report metadata rows. The reports array used to sync as ONE blob
// (entities key 'vx-reports-v1', last-writer-wins) — two devices each saving a
// different new report clobbered each other and one was lost. Each report now
// syncs as its own row 'vx-report::<reportKey>' (heavy HTML still in its own
// 'vx-report-html::<reportKey>' write-once row), and pulls MERGE by key instead
// of replacing the blob. The local 'vx-reports-v1' key stays the assembled
// read cache (still IDB-backed via VX_ENTITY_KEYS) — only the sync path changed.
var VX_REPORT_PREFIX        = 'vx-report::';
var VX_REPORT_META_SIG_KEY  = 'vx-rpt-meta-sig-v1'; // {reportKey: sig} of metadata already synced

// Set of localStorage keys that represent core entity data (user-content) and
// must sync to the server. Everything else (UI prefs) stays per-device.
var VX_ENTITY_KEYS = new Set([
  'vx-users-v1', 'vx-company-v1', 'vx-settings-v1', 'vx-numbering-v1',
  'vx-reports-v1', 'vx-defects-v1', 'vx-procedures-v1', 'vx-inspectors-v1',
  'vx-equipment-v1', 'vx-customers-v1', 'vx-jobs-v1',
  'vx-events-v1', 'vx-techniques-v1',
  'vx-quotes-v1', 'vx-invoices-v1',
  'vx-templates-v1', 'vx-method-order-v1',
  // V22 — PDF editor layout & per-method templates. These are heavy
  // user data (multiple pages × many blocks × potentially inline base64
  // images for signatures/logos) so the canvas-layout key in particular
  // exceeds the localStorage quota in practice. Route through IDB.
  'vx-canvas-layout-v1', 'vx-tpl-config-v1', 'vx-canvas-components-v1',
  'vx-canvas-history-v1',
  // Per-method templates (vx-method-tpl-UT, -MT, -VT, -PT, -RT, -ET, -PMI, -HT, -RFT).
  // Listed individually so the entity-store machinery picks them up.
  'vx-method-tpl-UT', 'vx-method-tpl-MT', 'vx-method-tpl-VT',
  'vx-method-tpl-PT', 'vx-method-tpl-RT', 'vx-method-tpl-ET',
  'vx-method-tpl-PMI', 'vx-method-tpl-HT', 'vx-method-tpl-RFT',
  // Billing document templates (Phase 2 — quote/invoice canvas layouts).
  'vx-method-tpl-INVOICE', 'vx-method-tpl-QUOTE',
]);
// Auth-sensitive keys handled specially (never naively synced — derive from token instead)
var VX_AUTH_KEYS = new Set(['vx-session-v1']);
// Intentionally per-device (never synced): the in-progress report draft.
var VX_LOCAL_ONLY_KEYS = new Set(['vx-session-v1', 'vx-rptdraft-v1']);
// Boot safety net: warn if any KEYS user-content value is NOT registered as an
// entity key (it would route to raw localStorage and never sync — the class of
// bug that lost PT reports on 2026-05-28, and that left planner events +
// technique sheets un-synced until 2026-06-19). Forces new KEYS entries to be
// classified. Console-only; never throws.
function _vxAssertEntityKeys(){
  try {
    if(typeof KEYS === 'undefined') return;
    Object.keys(KEYS).forEach(function(k){
      var v = KEYS[k];
      if(typeof v !== 'string' || v.indexOf('vx-') !== 0) return;
      if(VX_ENTITY_KEYS.has(v) || VX_AUTH_KEYS.has(v) || VX_LOCAL_ONLY_KEYS.has(v)) return;
      console.warn('vx: KEYS.' + k + ' ("' + v + '") is not in VX_ENTITY_KEYS — it will route to raw localStorage and never sync. Register it in VX_ENTITY_KEYS, or add it to VX_LOCAL_ONLY_KEYS if it is intentionally per-device.');
    });
  } catch(e){}
}
try { setTimeout(_vxAssertEntityKeys, 0); } catch(e){}

// V13: Cloud-first defaults. Veritix is now a cloud SaaS product;
// every account lives on Veritix's servers and every device is a sync target.
// Local-storage continues to exist as the offline-first cache, but the
// product mode is always 'cloud'. If apiBase or token are missing, the UX
// surfaces "Sign in to save your work" rather than reverting to a local product.
// ═══════════════════════════════════════════════════════════════════════════
// V28 — BACKEND DEPLOYMENT READINESS
// ═══════════════════════════════════════════════════════════════════════════
//
// THE API CONTRACT (what the backend must implement)
// ───────────────────────────────────────────────────
// All requests authenticate with Bearer <accessToken> in the Authorization
// header, EXCEPT auth endpoints. Tokens are short-lived (~1h) JWTs;
// refreshTokens are long-lived (~30d). Body / response always JSON.
//
// Auth:
//   POST   /v1/auth/signup    {email, password, name} → {accessToken, refreshToken, userId, orgId, expiresIn}
//   POST   /v1/auth/login     {email, password}      → same shape
//   POST   /v1/auth/refresh   {refreshToken}         → {accessToken, expiresIn}
//   POST   /v1/auth/logout    {}                     → 204
//   POST   /v1/auth/verify-email/<token>             → 204
//
// Entities (cloud-cache for client-side data):
//   GET    /v1/entities/<key>           → {key, value, updatedAt} | 404
//   PUT    /v1/entities/<key>  {value}  → {key, value, updatedAt}
//   key ∈ {'vx-reports-v1','vx-defects-v1','vx-inspectors-v1','vx-company-v1',
//          'vx-settings-v1','vx-canvas-layout-v1','vx-tpl-config-v1',
//          'vx-canvas-components-v1','vx-canvas-history-v1','vx-method-tpl-*'}
//
// Sync queue (mutation log for offline-first):
//   POST   /v1/sync/replay  {entries:[{id, key, op, payload, ts}]} → {accepted:[id...], conflicts:[{id, reason}]}
//
// Realtime (WebSocket):
//   WS  /ws    subprotocol: 'bearer.<accessToken>'
//   Server sends:
//     {type:'pong'}
//     {type:'entity.changed', key, actor:userId, ts}
//     {type:'sync.confirm', id}
//   Client sends:
//     {type:'ping'} every 30s
//
// Photos (large binary):
//   POST   /v1/photos/upload   multipart/form-data → {photoId, url, ts}
//   GET    /v1/photos/<id>     → image bytes
//
// Webhooks (outbound from Veritix to customer's URL):
//   POST <customer-url>  Header X-Veritix-Signature: HMAC-SHA256(secret, body)
//   Body: {event:'report.submitted'|'report.approved'|'defect.created'|..., data:{...}}
//
// DEPLOYMENT CONFIGURATION
// ───────────────────────────────────────────────────
// Three ways to set the API base URL, in order of precedence:
//   1. localStorage 'vx-platform-config-v1' → apiBase field   (admin override)
//   2. <meta name="vx-api-base" content="…">                  (deployment-time)
//   3. VX_PLATFORM_DEFAULTS.apiBase                           (compile-time)
//
// To deploy against a different backend, set the meta tag in the HTML:
//   <meta name="vx-api-base" content="https://staging.api.veritix.app/v1">
// Or via admin UI for per-user override (Settings → Advanced → API endpoint).
// ═══════════════════════════════════════════════════════════════════════════

/** Read the deployment-time API base from a <meta> tag, if present.
 *  Returns null if the tag is absent or empty. */
function _vxReadMetaApiBase(){
  try {
    const m = document.querySelector('meta[name="vx-api-base"]');
    const v = m && m.getAttribute('content');
    return (v && v.trim()) ? v.trim().replace(/\/+$/, '') : null;
  } catch(e){ return null; }
}

var VX_PLATFORM_DEFAULTS = {
  mode: 'cloud',                         // Cloud is the only product mode
  apiBase: _vxReadMetaApiBase() || 'https://api.veritix.app/v1',
  accessToken: null,                     // JWT or session token
  refreshToken: null,
  tokenExpiry: null,                     // epoch ms
  orgId: null,                           // tenant scope
  userId: null,                          // server-assigned user id
  lastSyncAt: null,
  syncErrorCount: 0,
  trialMode: true,                       // True until the user signs up / signs in
  emailVerified: true,                   // V14: false after signup until verification link clicked
  emailVerifiedAt: null,
};

function vxPlatformConfig() {
  try { return Object.assign({}, VX_PLATFORM_DEFAULTS, JSON.parse(localStorage.getItem(VX_PLATFORM_KEY)) || {}); }
  catch { return Object.assign({}, VX_PLATFORM_DEFAULTS); }
}
function vxPlatformSet(patch) {
  const cfg = Object.assign(vxPlatformConfig(), patch);
  try { localStorage.setItem(VX_PLATFORM_KEY, JSON.stringify(cfg)); } catch(e){}
  // Notify listeners so the topbar pill updates instantly
  try { window.dispatchEvent(new CustomEvent('vx:platform-change', { detail: cfg })); } catch(e){}
  return cfg;
}
function vxIsCloud() { return true; }       // Cloud-only product (kept for back-compat)
function vxIsAuthenticated() {
  const c = vxPlatformConfig();
  return !!(c.accessToken && c.userId);
}
// V13: New helpers for the cloud-first UX language
function vxIsTrial()           { return !vxIsAuthenticated(); }
function vxAuthState() {
  // 'trial'        — no account yet
  // 'signed_out'   — had a session before but token gone (refresh failed, etc)
  // 'authenticated'— actively signed in
  const c = vxPlatformConfig();
  if(c.accessToken && c.userId) return 'authenticated';
  if(c.userId) return 'signed_out';
  return 'trial';
}

// ── Storage adapter (the seam) ────────────────────────────────────────────
// We replace ls/lss with a wrapper that:
//   1. Always reads/writes localStorage (so the app continues to work offline-first)
//   2. When in cloud mode AND the key is a sync-tracked entity, also enqueues
//      a sync op so the change reaches the server.
// This means existing call sites (~120 of them) need ZERO changes.

// V15: ls/lss raw helpers now route through vxEntityStore for entity keys.
// For non-entity keys (UI prefs, sync queue, etc.) they go straight to
// localStorage — those don't need the IDB extension because they're small.
var _vxRawLs  = (k, fb=null) => {
  try {
    const v = VX_ENTITY_KEYS.has(k) ? vxEntityStore.read(k) : localStorage.getItem(k);
    return v ? JSON.parse(v) : fb;
  } catch { return fb; }
};
var _vxRawLss = (k, v) => {
  try {
    const s = JSON.stringify(v);
    if(VX_ENTITY_KEYS.has(k)) {
      vxEntityStore.write(k, s);
    } else {
      try {
      localStorage.setItem(k, s);
      } catch(e){ console.warn("ls setItem failed", e); }
    }
  } catch(e) { console.warn('lss', e); }
};

// Mark a key as locally dirty (changed since last server sync)
function _vxMarkDirty(k) {
  try {
    const flags = JSON.parse(localStorage.getItem(VX_DIRTY_FLAGS_KEY) || '{}');
    flags[k] = new Date().toISOString();
    localStorage.setItem(VX_DIRTY_FLAGS_KEY, JSON.stringify(flags));
  } catch(e){}
}
function _vxClearDirty(k) {
  try {
    const flags = JSON.parse(localStorage.getItem(VX_DIRTY_FLAGS_KEY) || '{}');
    delete flags[k];
    localStorage.setItem(VX_DIRTY_FLAGS_KEY, JSON.stringify(flags));
  } catch(e){}
}

// Public ls/lss — backward-compatible signatures
function ls(k, fb=null) { return _vxRawLs(k, fb); }
function lss(k, v) {
  _vxRawLss(k, v);
  // V13: in cloud-only land, always mark entity writes as dirty for sync.
  // When the user signs in (or back in), the queue replays. Before then,
  // writes are local-only and dirty-tracked so a "Sign in to save N changes"
  // banner can surface their pending work.
  if(k === 'vx-reports-v1') {
    // V48: reports sync as per-report rows, not one blob. When authenticated,
    // enqueue each changed report (which marks its own per-report dirty flag).
    // When NOT authenticated (trial mode), mark the coarse key dirty so the
    // first-cloud-login migration knows there are reports to push.
    if(vxIsAuthenticated()) vxSyncEnqueueReports(v);
    else _vxMarkDirty('vx-reports-v1');
  } else if(VX_ENTITY_KEYS.has(k)) {
    _vxMarkDirty(k);
    if(vxIsAuthenticated()) vxSyncEnqueue({ kind: 'put', key: k, value: v });
  }
}

// Cloud-mode helpers exposed for views that want richer behavior
// V48: a teammate may save several reports at once (each its own row event) —
// coalesce the "Reports updated by a teammate" toast so it fires once per burst.
var _vxReportToastTimer = null;
function _vxReportTeammateToast(){
  if(typeof toast !== 'function') return;
  if(_vxReportToastTimer) clearTimeout(_vxReportToastTimer);
  _vxReportToastTimer = setTimeout(function(){
    _vxReportToastTimer = null;
    toast('Reports updated by a teammate.', 'info');
  }, 800);
}

// V48: pull reports as per-report rows and MERGE into the local array (never a
// whole-blob replace). Rule per report key: if the local copy has unpushed edits
// (its per-report dirty flag is set) keep local — the queue will push it; else
// take the server copy. Local-only reports (offline drafts / not yet uploaded)
// are always kept. Heavy HTML is reattached from its write-once row. This is
// what makes two devices saving DIFFERENT reports safe — neither can clobber the
// other, because each report is its own row and the merge is a union by key.
async function vxPullReports(){
  if(!vxIsAuthenticated()) return { skipped: true };
  const metaMap = await vxApi.hydrateReports();
  if(metaMap == null) return { error: true };            // network/error — leave local untouched
  const htmlMap = (await vxApi.hydrateReportHtml()) || {};
  const localArr = (() => { const a = ls('vx-reports-v1', []); return Array.isArray(a) ? a : []; })();
  const localByKey = {};
  localArr.forEach(r => { const k = _vxReportKey(r); if(k) localByKey[k] = r; });
  const metaSig = _vxReportMetaSigMap();
  const htmlSig = _vxHtmlSigMap();
  const fields  = VX_HEAVY_FIELDS['vx-reports-v1'];
  const merged = [];
  const seen = {};
  Object.keys(metaMap).forEach(key => {
    const remote = metaMap[key];
    if(!remote) return;
    const localR = localByKey[key];
    let rec;
    if(localR && vxStore.isDirty(VX_REPORT_PREFIX + key)){
      rec = localR;                                      // unpushed local edit wins (queue pushes it)
    } else {
      rec = remote;
      metaSig[key] = _vxReportMetaSig(remote);           // we just pulled it — don't re-upload
      _vxClearDirty(VX_REPORT_PREFIX + key);
    }
    const h = htmlMap[key];
    if(h){
      if(fields.some(f => rec[f] == null && h[f] != null)){
        rec = Object.assign({}, rec);
        fields.forEach(f => { if(rec[f] == null && h[f] != null) rec[f] = h[f]; });
      }
      const s = _vxReportHtmlSig(rec); if(s) htmlSig[key] = s;
    }
    merged.push(rec);
    seen[key] = true;
  });
  localArr.forEach(r => { const k = _vxReportKey(r); if(!k || !seen[k]) merged.push(r); });
  _vxReportMetaSigSave(metaSig);
  _vxHtmlSigSave(htmlSig);
  _vxRawLss('vx-reports-v1', merged);
  return { count: Object.keys(metaMap).length };
}

var vxStore = {
  get: ls,
  set: lss,
  /** Re-pull from server, replacing local state for this key — UNLESS the
   *  key has unpushed local edits. The server copy is stale precisely
   *  because our queued write hasn't landed yet; pulling it would silently
   *  roll the local change back. Keep local; the sync queue pushes it up. */
  async pull(k) {
    if(!vxIsAuthenticated()) return null;
    if(k === 'vx-reports-v1'){ await vxPullReports(); return ls(k, null); }  // V48: merge, never blob-replace
    if(vxStore.isDirty(k)) return ls(k, null);
    const remote = await vxApi.hydrate(k);
    if(remote != null) { _vxRawLss(k, remote); _vxClearDirty(k); }
    return remote;
  },
  /** Pull every entity key on demand (e.g. after login or manual refresh).
   *  Keys with unpushed local changes are skipped — overwriting them with
   *  the (stale) server copy is what made a freshly-saved PDF template
   *  revert to its old layout on the next refresh. */
  async pullAll() {
    if(!vxIsAuthenticated()) return { skipped: true };
    let count = 0, kept = 0;
    for(const k of VX_ENTITY_KEYS) {
      if(k === 'vx-reports-v1') continue;                // V48: reports merge separately (never blob-replaced)
      if(vxStore.isDirty(k)) { kept++; continue; }
      const r = await vxApi.hydrate(k);
      if(r != null) { _vxRawLss(k, r); _vxClearDirty(k); count++; }
    }
    // V48: merge the per-report rows (+ their write-once HTML rows) into the
    // local array. Replaces the old "pull the blob then reattach HTML" path.
    try { await vxPullReports(); } catch(e){ console.warn('vx: pullReports failed', e); }
    // V49: ingest any customer-submitted portal events (acks, quote decisions,
    // work requests) and surface them locally.
    try { await vxPullPortalEvents(); } catch(e){ console.warn('vx: pullPortalEvents failed', e); }
    vxPlatformSet({ lastSyncAt: new Date().toISOString() });
    return { count, kept };
  },
  isDirty(k) { try { return !!(JSON.parse(localStorage.getItem(VX_DIRTY_FLAGS_KEY) || '{}')[k]); } catch { return false; } },
  dirtyKeys() { try { return Object.keys(JSON.parse(localStorage.getItem(VX_DIRTY_FLAGS_KEY) || '{}')); } catch { return []; } },
};
