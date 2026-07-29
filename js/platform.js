// ══════════════════════════════════════════════════════════════════════════
// V11 PLATFORM LAYER — deployment mode, API client, sync queue, plan gates
// ══════════════════════════════════════════════════════════════════════════
// This block is the seam between the 100% local-storage app and the future
// server-backed product. The existing `ls()` / `lss()` API surface is preserved
// unchanged so all ~120 call sites continue to work; the cloud routing happens
// underneath them. When VX_MODE === 'local' (current production default),
// everything behaves exactly as before. When VX_MODE === 'cloud', mutations
// are queued for sync and reads can be hydrated from the server.

var VX_PLATFORM_KEY    = 'vx-platform-v1';      // mode + tokens + endpoint config
var VX_SYNC_QUEUE_KEY  = 'vx-sync-queue-v1';    // pending mutations awaiting upload
var VX_SYNC_DROPPED_KEY = 'vx-sync-dropped-v1'; // ops permanently dropped after exhausting the retry budget
var VX_DIRTY_FLAGS_KEY = 'vx-dirty-flags-v1';   // per-key last-modified-locally timestamps
var VX_PLAN_KEY        = 'vx-plan-v1';          // current subscription tier + limits
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

// ── Subscription / plan gates ─────────────────────────────────────────────
// In trial mode (unauthenticated), everything is unlocked for evaluation.
// Once authenticated, the server returns the active plan tier and Veritix
// gates feature visibility on it. This is the single chokepoint the rest of
// the app should consult before showing or invoking a paid feature.
var VX_PLAN_DEFAULTS = {
  tier: 'unlimited',                    // 'free' | 'standard' | 'pro' | 'enterprise' | 'unlimited' (local)
  startedAt: null,
  renewsAt:  null,
  cancelled: false,
  limits: {
    maxReports:   Infinity,             // per billing period
    maxUsers:     Infinity,
    maxStorageMB: Infinity,
    methods:      'all',                // 'all' | array of method ids
  },
  features: {
    webhooks: true, ics: true, api: true,
    photoAnnotation: true, voice: true, barcode: true,
    geoMap: true, advancedAnalytics: true,
    realtimeCollab: false, ssoSaml: false, customBranding: false,
  },
  usage: { reports: 0, users: 0, storageMB: 0 },
};
function vxPlanConfig() {
  try { return Object.assign({}, VX_PLAN_DEFAULTS, JSON.parse(localStorage.getItem(VX_PLAN_KEY)) || {}); }
  catch { return Object.assign({}, VX_PLAN_DEFAULTS); }
}
function vxPlanSet(patch) {
  const next = Object.assign(vxPlanConfig(), patch);
  try { localStorage.setItem(VX_PLAN_KEY, JSON.stringify(next)); } catch(e){}
  return next;
}
var vxPlan = {
  current: vxPlanConfig,
  /** Is a feature available on the current plan? Always true while in trial (unauthenticated) for evaluation. */
  has(feature) {
    if(vxAuthState() === 'trial') return true;
    const p = vxPlanConfig();
    return !!(p.features && p.features[feature]);
  },
  /** Is the current usage within the limit for this metric? */
  withinLimit(metric, additional = 0) {
    if(vxAuthState() === 'trial') return true;
    const p = vxPlanConfig();
    const lim = p.limits?.[metric];
    const use = (p.usage?.[metric] || 0) + additional;
    if(lim == null || lim === Infinity) return true;
    return use < lim;
  },
  /** Record a usage event (server is authoritative; this is for client-side gating only) */
  recordUsage(metric, delta = 1) {
    const p = vxPlanConfig();
    p.usage = Object.assign({}, p.usage || {}, { [metric]: ((p.usage?.[metric] || 0) + delta) });
    vxPlanSet(p);
  },
  /** Show a paywall modal for a feature. Returns true if the user upgraded, false otherwise. */
  showPaywall(feature, opts = {}) {
    let modal = document.getElementById('vx-paywall-modal');
    if(modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'vx-paywall-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)';
    modal.onclick = e => { if(e.target === modal) modal.remove(); };
    modal.innerHTML = `<div style="background:var(--panel);border:1px solid var(--border2);border-radius:14px;width:480px;max-width:96vw;box-shadow:var(--sh-xl);overflow:hidden">
      <div style="padding:24px 28px 20px;background:linear-gradient(135deg,rgba(0,212,255,.10),rgba(167,139,250,.06));border-bottom:1px solid var(--border)">
        <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(167,139,250,.14);border:1px solid rgba(167,139,250,.30);border-radius:14px;padding:3px 10px;font-size:10px;color:var(--violet);font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">★ Premium feature</div>
        <div style="font-size:18px;font-weight:600;color:var(--t1);margin-bottom:6px">${escapeHtml(opts.title || 'Upgrade to unlock')}</div>
        <div style="font-size:13px;color:var(--t2);line-height:1.55">${escapeHtml(opts.body || `${feature} is available on the Pro plan and above. Upgrade to unlock it for your team.`)}</div>
      </div>
      <div style="padding:18px 28px 22px;display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-sm" data-action="_wRemoveById" data-args="'vx-paywall-modal'" style="font-size:12px">Maybe later</button>
        <button class="btn btn-sm" data-action="_wOpenBilling" style="font-size:12px;background:var(--violet);color:#fff;border-color:var(--violet)">View plans →</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    openA11yModal(modal);
    return false;
  },
  openBilling() {
    if(typeof showPage === 'function') showPage('settings', el('tn-settings'));
    setTimeout(() => { if(typeof showSS === 'function') showSS('subscription', el('sni-subscription')); }, 100);
    const m = document.getElementById('vx-paywall-modal'); if(m) m.remove();
  },
};

// ── Global error handler (V14) ────────────────────────────────────────────
// Catches uncaught exceptions and unhandled promise rejections. Surfaces a
// non-blocking toast to the user and POSTs to /telemetry/error so the team
// can diagnose production issues. Rate-limited to avoid toast spam if
// something throws in a tight loop.
var _vxErrorCount = 0;
var _vxLastErrorAt = 0;
var _vxErrorWindow = 60 * 1000;    // 1 minute
var _vxErrorMaxPerWindow = 3;

function vxReportError(err, context) {
  const now = Date.now();
  if(now - _vxLastErrorAt > _vxErrorWindow) _vxErrorCount = 0;
  _vxLastErrorAt = now;
  _vxErrorCount++;

  // Always log to console so devs see it
  console.error('[vx]', context || 'error', err);

  // Toast at most N times per minute — don't bury the user
  if(_vxErrorCount <= _vxErrorMaxPerWindow) {
    const msg = (err && (err.message || err.toString())) || 'Unknown error';
    // Use the existing toast infra if available; fall back to console
    if(typeof toast === 'function') {
      toast(tf('toast.something_wrong','Something went wrong: {msg}', {msg: msg.slice(0, 90)}), 'error');
    }
  }

  // Fire-and-forget telemetry to the backend (no await — must not throw)
  if(typeof vxApi !== 'undefined' && vxApi.request && vxIsAuthenticated && vxIsAuthenticated()) {
    try {
      vxApi.request('/telemetry/error', {
        method: 'POST',
        body: {
          message:   String(err?.message || err || 'unknown').slice(0, 500),
          stack:     String(err?.stack || '').slice(0, 2000),
          context:   String(context || '').slice(0, 200),
          url:       location.href,
          userAgent: navigator.userAgent.slice(0, 200),
          at:        new Date().toISOString(),
        },
      }).catch(() => {});   // Never re-throw from the error handler
    } catch(e){}
  }
}

// Capture sync errors (script errors, resource errors)
window.addEventListener('error', (e) => {
  // Resource load failures (e.g. cdnjs offline) come through here without
  // an Error object — handle separately
  if(e.error) vxReportError(e.error, 'window.error');
  else if(e.target && e.target.tagName) vxReportError(new Error('Resource load failed: ' + e.target.tagName + ' ' + (e.target.src || e.target.href || '')), 'resource');
}, true);

// Capture promise rejections that nothing else handled
window.addEventListener('unhandledrejection', (e) => {
  vxReportError(e.reason instanceof Error ? e.reason : new Error(String(e.reason)), 'unhandledrejection');
});

// Listen for online events to flush sync queue
window.addEventListener('online', () => { if(vxIsCloud()) setTimeout(() => vxSyncFlush().catch(()=>{}), 800); });

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


function initials(n='')  { return n.trim().split(/\s+/).map(w=>w[0]||'').join('').toUpperCase().slice(0,2) || '?'; }

// V14: loading-state helpers. Use around any async action that takes >200ms.
//   const done = vxLoading(btnEl);  await doWork();  done();
function vxLoading(btnEl) {
  if(!btnEl) return () => {};
  const wasDisabled = btnEl.disabled;
  btnEl.disabled = true;
  btnEl.classList.add('btn-loading');
  btnEl.setAttribute('aria-busy', 'true');
  return () => {
    btnEl.disabled = wasDisabled;
    btnEl.classList.remove('btn-loading');
    btnEl.removeAttribute('aria-busy');
  };
}
// Wrap a click-handler with automatic loading state. Use as:
//   data-action="vxRunLoading" data-pass-el="1" data-args="async () => { ... }"
async function vxRunLoading(btnEl, fn) {
  const done = vxLoading(btnEl);
  try { return await fn(); }
  finally { done(); }
}

// V14: Undoable destructive action. Pattern:
//   1. Immediately apply the destructive change locally (e.g. splice from
//      array, save). The user sees the result instantly.
//   2. Show a toast with an "Undo" button for N seconds.
//   3. If undone before the timeout, restore the original state.
//   4. If the timeout expires, commit the change (server-side) and clean up.
//
// Used by rptDelete and defDelete so misclicks don't lose data.
var _vxUndoTimers = new Map();
function vxUndoable(opts) {
  const id = 'undo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const duration = opts.duration || 6000;
  // Apply the change immediately
  try { opts.apply(); } catch(e) { console.warn('undoable apply failed', e); return; }
  // Render the toast (longer-lived than a regular toast, with Undo button)
  const c = el('toast-container');
  if(!c) { if(opts.commit) opts.commit(); return; }
  const t = document.createElement('div');
  t.className = 'toast undo';
  t.dataset.undoId = id;
  const labelSpan = document.createElement('span');
  labelSpan.textContent = opts.message || 'Deleted';
  const btn = document.createElement('button');
  btn.className = 'toast-undo-btn';
  btn.type = 'button';
  btn.textContent = 'Undo';
  btn.onclick = () => {
    clearTimeout(_vxUndoTimers.get(id));
    _vxUndoTimers.delete(id);
    try { opts.undo(); } catch(e) { console.warn('undo failed', e); }
    t.classList.add('out');
    setTimeout(() => t.remove(), 220);
    if(typeof toast === 'function') toast(opts.undoneMessage || 'Restored.', 'success');
  };
  t.appendChild(labelSpan);
  t.appendChild(btn);
  c.appendChild(t);
  // Announce to AT
  if(typeof a11yAnnounce === 'function') a11yAnnounce((opts.message || 'Deleted') + ' — undo available.', 'polite');
  // Commit timer
  const timer = setTimeout(() => {
    _vxUndoTimers.delete(id);
    t.classList.add('out');
    setTimeout(() => t.remove(), 220);
    if(opts.commit) try { opts.commit(); } catch(e) { console.warn('undoable commit failed', e); }
  }, duration);
  _vxUndoTimers.set(id, timer);
}

// V12 perf: debounce helper for text-input-driven re-renders
// Without this, rptRender() runs on every keystroke and rebuilds the whole
// table via innerHTML — fine at 50 records, painful at 500+.
function debounce(fn, wait = 150) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}
// Lazy bindings — these renderers may be defined later in the file, so we
// late-bind at call time rather than at declaration time
var rptRenderDebounced      = debounce(() => { if(typeof rptRender      === 'function') rptRender();      }, 120);
var defRenderDebounced      = debounce(() => { if(typeof defRender      === 'function') defRender();      }, 120);
var auditLogRenderDebounced = debounce(() => { if(typeof auditLogRender === 'function') auditLogRender(); }, 150);
var helpSearchDebounced     = debounce(() => { if(typeof helpSearch     === 'function') helpSearch();     }, 100);
var _dateFmt = 'dd MMM yyyy';
var _timeFmt = '24';
function fmtDate(s) {
  if(!s) return '—';
  try {
    const settings = ls(KEYS.settings, {});
    const tz = settings.timezone && settings.timezone !== 'auto' ? settings.timezone : null;
    let d = new Date(s);
    if(tz){
      // Use Intl to get parts in the target timezone
      try {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(d);
        const obj = {}; parts.forEach(p => obj[p.type] = p.value);
        const dd = obj.day, MM = obj.month, yyyy = obj.year;
        const dN = parseInt(dd);
        const monthIdx = parseInt(MM) - 1;
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const monthsFull = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const MMM = months[monthIdx];
        const MMMM = monthsFull[monthIdx];
        switch(_dateFmt) {
          case 'dd/MM/yyyy': return `${dd}/${MM}/${yyyy}`;
          case 'MM/dd/yyyy': return `${MM}/${dd}/${yyyy}`;
          case 'yyyy-MM-dd': return `${yyyy}-${MM}-${dd}`;
          case 'dd.MM.yyyy': return `${dd}.${MM}.${yyyy}`;
          case 'dd-MM-yyyy': return `${dd}-${MM}-${yyyy}`;
          case 'd MMMM yyyy': return `${dN} ${MMMM} ${yyyy}`;
          default: return `${dd} ${MMM} ${yyyy}`;
        }
      } catch(e){ /* fall through */ }
    }
    const dd = String(d.getDate()).padStart(2,'0');
    const dN = d.getDate();
    const MM = String(d.getMonth()+1).padStart(2,'0');
    const yyyy = d.getFullYear();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthsFull = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const MMM = months[d.getMonth()];
    const MMMM = monthsFull[d.getMonth()];
    switch(_dateFmt) {
      case 'dd/MM/yyyy': return `${dd}/${MM}/${yyyy}`;
      case 'MM/dd/yyyy': return `${MM}/${dd}/${yyyy}`;
      case 'yyyy-MM-dd': return `${yyyy}-${MM}-${dd}`;
      case 'dd.MM.yyyy': return `${dd}.${MM}.${yyyy}`;
      case 'dd-MM-yyyy': return `${dd}-${MM}-${yyyy}`;
      case 'd MMMM yyyy': return `${dN} ${MMMM} ${yyyy}`;
      default: return `${dd} ${MMM} ${yyyy}`;
    }
  } catch { return s; }
}
function fmtSize(b)      { if(b<1024)return b+'B'; if(b<1048576)return(b/1024).toFixed(1)+'KB'; return(b/1048576).toFixed(2)+'MB'; }
function lsSize(k)       { return ((k.length+(localStorage.getItem(k)||'').length)*2); }
function el(id)          { return document.getElementById(id); }
function set(id,v)       { const e=el(id); if(e)e.textContent=v; }

function uaGrad(name) {
  let h=5381; for(const c of name||'?') h=(h*33^c.charCodeAt(0))>>>0;
  const palette=['linear-gradient(135deg,#2d6fd6,#4f8ef7)','linear-gradient(135deg,#0099cc,#00d4ff)',
    'linear-gradient(135deg,#7c3aed,#a78bfa)','linear-gradient(135deg,#10b981,#3ecf8e)',
    'linear-gradient(135deg,#d97706,#f5a623)','linear-gradient(135deg,#c73c3c,#f25c5c)'];
  return palette[h % palette.length];
}

function roleClass(r) {
  const m={'Admin':'role-admin','Inspector':'role-inspector','Senior Inspector':'role-senior','Viewer':'role-viewer'};
  return m[r]||'role-viewer';
}
// ══════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════
function loadUsers()    { AUTH_USERS = ls(KEYS.users, []); }
function saveUsers()    { lss(KEYS.users, AUTH_USERS); }

// Session has a 30-day idle expiry. After 30 days without activity (no
// new saveSession call), the stored session is treated as expired and
// the user gets bounced back to the login screen. This is a defensive
// measure for shared devices — a forgotten device that's been idle for
// a month shouldn't grant immediate access without re-auth.
//
// Note: client-side sessions are inherently weak (any script with
// localStorage access can read or modify them). When the backend lands,
// migrate to server-issued HttpOnly cookies or signed JWTs.
var VX_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
function loadSession()  {
  const s = ls(KEYS.session);
  if(!s?.uid) return;
  // Expiry check — sessions older than 30 days idle don't authenticate
  if(s.t && (Date.now() - s.t) > VX_SESSION_MAX_AGE_MS){
    console.log('[session] expired (idle > 30 days), clearing');
    try { localStorage.removeItem(KEYS.session); } catch(e){}
    return;
  }
  CURRENT_USER = AUTH_USERS.find(u=>u.id===s.uid)||null;
}
function saveSession(uid){ lss(KEYS.session,{uid,t:Date.now()}); }
function clearSession()  { localStorage.removeItem(KEYS.session); CURRENT_USER=null; }

function switchLoginTab(tab, btn) {
  document.querySelectorAll('.login-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  el('login-form').style.display    = tab==='login'    ? '' : 'none';
  el('register-form').style.display = tab==='register' ? '' : 'none';
}

// ── Email templates ──
function emailTemplate(body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:480px;margin:32px auto;background:#161b22;border:1px solid #30363d;border-radius:12px;overflow:hidden">
<div style="padding:24px 28px;border-bottom:1px solid #30363d;display:flex;align-items:center;gap:10px">
  <svg width="22" height="26" viewBox="0 0 52 60"><path d="M26 2 L50 14 L50 36 Q50 52 26 58 Q2 52 2 36 L2 14 Z" style="fill:rgba(79,142,247,0.15);stroke:#4f8ef7;stroke-width:1.5"/><path d="M17 30 L24 38 L36 22" style="fill:none;stroke:#f25c5c;stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round"/></svg>
  <span style="font-size:16px;font-weight:700;color:#e8edf8;letter-spacing:.04em;font-family:monospace"><span style="color:#f25c5c">V</span>ERITIX</span>
</div>
<div style="padding:28px">${body}</div>
<div style="padding:16px 28px;border-top:1px solid #30363d;text-align:center;font-size:11px;color:#5a6880">
  Veritix NDT Inspect v2.0 · This is an automated message
</div>
</div></body></html>`;
}

function showEmailModal(subject, toEmail, html, actionLabel, onAction) {
  el('email-modal-subject').textContent = subject;
  el('email-modal-to').textContent = 'To: ' + toEmail;
  const frame = el('email-modal-frame');
  frame.srcdoc = html;
  const actionBtn = el('email-modal-action');
  actionBtn.textContent = actionLabel || 'OK';
  actionBtn.onclick = () => { closeEmailModal(); if(onAction) onAction(); };
  el('email-modal').classList.add('open');
}
function closeEmailModal() { el('email-modal').classList.remove('open'); }

function showConfirmEmail(user) {
  const code = Math.random().toString(36).slice(2,8).toUpperCase();
  const html = emailTemplate(`
    <h2 style="margin:0 0 12px;font-size:20px;color:#e8edf8;font-weight:600">Confirm your email</h2>
    <p style="color:#9aaabf;font-size:14px;line-height:1.6;margin:0 0 20px">Hi <strong style="color:#e8edf8">${escapeHtml(user.name)}</strong>, thanks for signing up! Please confirm your email address to activate your account.</p>
    <div style="text-align:center;margin:24px 0">
      <div style="display:inline-block;background:#4f8ef7;color:#fff;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:700;letter-spacing:.02em">Confirm Email Address</div>
    </div>
    <p style="color:#5a6880;font-size:12px;line-height:1.5;margin:16px 0 0">Or enter this code manually:</p>
    <div style="text-align:center;margin:12px 0">
      <span style="font-family:monospace;font-size:22px;font-weight:700;color:#4f8ef7;letter-spacing:6px;background:#0d1117;padding:10px 24px;border-radius:8px;border:1px solid #30363d;display:inline-block">${code}</span>
    </div>
    <p style="color:#5a6880;font-size:11px;margin:20px 0 0;text-align:center">If you didn't create this account, you can ignore this email.</p>
  `);
  showEmailModal('Confirm your email', user.email, html, 'Confirm & Continue', () => {
    showWelcomeEmail(user);
  });
}

function showWelcomeEmail(user) {
  const html = emailTemplate(`
    <div style="text-align:center;margin-bottom:20px">
      <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#0099cc,#00d4ff);display:inline-flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#fff;font-family:monospace">${user.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:#e8edf8;font-weight:600;text-align:center">Welcome to Veritix!</h2>
    <p style="color:#9aaabf;font-size:14px;line-height:1.6;margin:0 0 20px;text-align:center">Your account has been confirmed and is ready to use.</p>
    <div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:16px;margin:16px 0">
      <table style="width:100%;font-size:13px;color:#9aaabf;border-collapse:collapse">
        <tr><td style="padding:4px 0;color:#5a6880">Name</td><td style="padding:4px 0;color:#e8edf8;text-align:right;font-weight:500">${escapeHtml(user.name)}</td></tr>
        <tr><td style="padding:4px 0;color:#5a6880">Email</td><td style="padding:4px 0;color:#e8edf8;text-align:right;font-family:monospace;font-size:12px">${escapeHtml(user.email)}</td></tr>
        <tr><td style="padding:4px 0;color:#5a6880">Role</td><td style="padding:4px 0;color:#e8edf8;text-align:right">${user.role}</td></tr>
      </table>
    </div>
    <div style="text-align:center;margin:24px 0">
      <div style="display:inline-block;background:#4f8ef7;color:#fff;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:700">Get Started</div>
    </div>
    <p style="color:#5a6880;font-size:12px;text-align:center;margin:16px 0 0">You're all set! Start by adding your company details and setting up your first inspection.</p>
  `);
  showEmailModal('Welcome to Veritix NDT Inspect', user.email, html, 'Get Started', () => {
    bootApp();
  });
}

function signOut() {
  // V13: also clear cloud token. We keep userId in vxPlatformConfig so
  // vxAuthState() returns 'signed_out' (rather than 'trial') — the trial
  // banner will say "Session expired" rather than first-run language.
  try {
    vxPlatformSet({ accessToken: null, refreshToken: null, tokenExpiry: null });
  } catch(e){}
  clearSession();
  el('login-screen').classList.remove('hidden');
  el('li-email').value=''; el('li-pwd').value=''; el('li-err').classList.remove('show');
}

// ── Dispatch registration — see vxActions in js/constants.js.
// Object shorthand keeps each data-action name tied to its function, so a
// rename that misses one is a no-undef error rather than a dead control.
vxActions({
  auditLogRenderDebounced, closeEmailModal, defRenderDebounced,
  helpSearchDebounced, rptRenderDebounced, signOut, switchLoginTab,
  vxRunLoading,
});
