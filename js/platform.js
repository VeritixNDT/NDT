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

// Set of localStorage keys that represent core entity data (user-content) and
// must sync to the server. Everything else (UI prefs) stays per-device.
var VX_ENTITY_KEYS = new Set([
  'vx-users-v1', 'vx-company-v1', 'vx-settings-v1', 'vx-numbering-v1',
  'vx-reports-v1', 'vx-defects-v1', 'vx-procedures-v1', 'vx-inspectors-v1',
  'vx-equipment-v1',
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
]);
// Auth-sensitive keys handled specially (never naively synced — derive from token instead)
var VX_AUTH_KEYS = new Set(['vx-session-v1']);

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

// ── V44 SUPABASE GLUE ─────────────────────────────────────────────────────
// The Supabase JS SDK is loaded via the UMD bundle in the HTML head, exposing
// `window.supabase`. We init a singleton client lazily from the two
// <meta> tags. If either is absent (or the SDK didn't load), every
// _vxSupabase() call returns null and the app stays in pre-config trial
// mode (localStorage + IndexedDB only) — this preserves the local-first
// behaviour the user-facing spec requires.
//
// One singleton per tab is important: each createClient() instance spins
// up its own auth state listener, GoTrue refresh timer, and realtime
// websocket. Multiple instances can race on token refresh.
function _vxReadMetaSupabaseUrl(){
  try {
    const m = document.querySelector('meta[name="vx-supabase-url"]');
    const v = m && m.getAttribute('content');
    return (v && v.trim()) ? v.trim().replace(/\/+$/, '') : null;
  } catch(e){ return null; }
}
function _vxReadMetaSupabaseAnonKey(){
  try {
    const m = document.querySelector('meta[name="vx-supabase-anon-key"]');
    const v = m && m.getAttribute('content');
    return (v && v.trim()) ? v.trim() : null;
  } catch(e){ return null; }
}

var _vxSupabaseClient = null;
function _vxSupabase(){
  if(_vxSupabaseClient) return _vxSupabaseClient;
  // SDK loaded? (the UMD bundle exposes window.supabase with .createClient)
  if(typeof window === 'undefined' || !window.supabase || !window.supabase.createClient) return null;
  var url = _vxReadMetaSupabaseUrl();
  var key = _vxReadMetaSupabaseAnonKey();
  if(!url || !key) return null;
  try {
    _vxSupabaseClient = window.supabase.createClient(url, key, {
      auth: {
        // PKCE flow is recommended for SPAs; persists session in localStorage
        // under sb-<project-ref>-auth-token so a hard reload keeps the user
        // signed in (matches our previous accessToken-in-localStorage UX).
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: 'vx-sb-auth-v1',
      },
      // NOTE: no custom global headers. A custom request header (the old
      // 'x-vx-client') makes every call a CORS-preflighted request and
      // has to be echoed back in Access-Control-Allow-Headers — if the
      // auth endpoint or a network security layer doesn't, the browser
      // kills the request as "TypeError: Failed to fetch". Dropping it
      // keeps the SDK's requests on the standard, well-supported path.
    });
    // Catch the password-recovery flow. When the user clicks the link
    // in a reset email they return here with a recovery token in the
    // URL hash; detectSessionInUrl processes it and fires this event,
    // at which point we prompt for the new password.
    try {
      _vxSupabaseClient.auth.onAuthStateChange(function(event){
        if(event === 'PASSWORD_RECOVERY' && typeof vxPromptNewPassword === 'function'){
          vxPromptNewPassword();
        }
      });
    } catch(e){ console.warn('vx: auth listener attach failed', e); }
  } catch(e){
    console.warn('vx: supabase init failed', e);
    _vxSupabaseClient = null;
  }
  return _vxSupabaseClient;
}

// Tear down a Supabase client before discarding it. The critical step
// is stopAutoRefresh() — without it the old client's GoTrue token-
// refresh timer keeps running after _vxSupabaseClient is replaced, and
// two clients racing on Supabase's *rotating* refresh tokens can
// invalidate the session (one refresh rotates the token, the other
// then presents a stale one and gets logged out). Also closes the
// realtime socket / channels so they don't leak. Every step is
// individually guarded — SDK minor versions differ on which of these
// methods exist.
function _vxDisposeSupabaseClient(client){
  if(!client) return;
  try { if(client.auth && typeof client.auth.stopAutoRefresh === 'function') client.auth.stopAutoRefresh(); } catch(e){}
  try { if(typeof client.removeAllChannels === 'function') client.removeAllChannels(); } catch(e){}
  try { if(client.realtime && typeof client.realtime.disconnect === 'function') client.realtime.disconnect(); } catch(e){}
}

/** True iff the Supabase SDK is loaded AND both meta tags are populated. */
function vxSupabaseConfigured(){
  return !!_vxSupabase();
}
// Expose for diagnostics / external callers
window.vxSupabaseConfigured = vxSupabaseConfigured;

// Helper: after a Supabase auth call returns a session, copy the bits we
// care about into vxPlatformConfig so the rest of the app (which reads
// vxPlatformConfig().accessToken, .userId, .orgId, etc.) keeps working
// unchanged. orgId is resolved separately via the membership lookup
// because Supabase auth doesn't know about our orgs/org_members tables.
async function _vxApplySupabaseSession(session){
  if(!session){
    vxPlatformSet({ accessToken: null, refreshToken: null, tokenExpiry: null });
    try {
      var sbOut = _vxSupabase();
      if(sbOut && sbOut.realtime && typeof sbOut.realtime.setAuth === 'function'){
        sbOut.realtime.setAuth(null);
      }
    } catch(e){}
    return;
  }
  var patch = {
    accessToken:  session.access_token  || null,
    refreshToken: session.refresh_token || null,
    tokenExpiry:  session.expires_at ? session.expires_at * 1000 : null,
    userId:       session.user?.id     || null,
    emailVerified: !!session.user?.email_confirmed_at,
    emailVerifiedAt: session.user?.email_confirmed_at || null,
  };
  // Push the JWT into the Realtime client BEFORE vxPlatformSet fires the
  // vx:platform-change event (which calls vxRealtimeConnect). Without this,
  // the very first realtime channel join at boot uses the anon token; the
  // channel reports SUBSCRIBED but RLS filters out every row event so
  // nothing ever reaches the handler. See the post-mortem for V44.4.
  try {
    var sbAuth = _vxSupabase();
    if(sbAuth && sbAuth.realtime && typeof sbAuth.realtime.setAuth === 'function'){
      sbAuth.realtime.setAuth(session.access_token);
    }
  } catch(e){ console.warn('vx: realtime setAuth failed', e); }
  vxPlatformSet(patch);
  // Resolve orgId via the membership table. If the user has no membership
  // (signed up under email-confirm-on so vxApi.register returned early
  // without provisioning, or invitation pending), reconcile by creating
  // an org for them right now. This closes the half-provisioned-account
  // gap that the Phase 1 audit flagged.
  try {
    var sb = _vxSupabase();
    if(sb && session.user?.id){
      var r = await sb.from('org_members')
        .select('org_id, role')
        .eq('user_id', session.user.id)
        .order('joined_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if(r && r.error){
        // The membership query FAILED (network drop, TLS interception,
        // RLS error, …). This is NOT the same as "user has no org" —
        // reconciling here would spawn a spurious duplicate org and
        // make the user admin of the wrong (empty) workspace. Leave
        // orgId / role untouched and let a later session-apply (on a
        // healthy connection) resolve them correctly.
        console.warn('vx: org membership lookup failed — skipping reconcile', r.error.message || r.error);
      } else if(r && r.data){
        // V44.3: stash the server-trusted role into vxPlatformConfig so
        // bootApp can sync it down to CURRENT_USER (the legacy local user
        // record) after loadSession runs. Without this, a user who signed
        // up under email-confirm-on ends up with CURRENT_USER.role =
        // 'Inspector' (local-fallback default) despite being admin server-
        // side, and the Settings nav gate hides their own admin tools.
        vxPlatformSet({ orgId: r.data.org_id || null, role: r.data.role || null });
      } else {
        // V44.1: No org → reconcile. Trigger orgs_add_creator_as_admin
        // bootstraps the org_members row inside the same transaction, so
        // the very next read of membership succeeds.
        var meta = session.user?.user_metadata || {};
        var userEmail = session.user?.email || '';
        var displayName = meta.name || (userEmail ? userEmail.split('@')[0] : 'New user');
        var orgInsert = await sb.from('orgs')
          .insert({
            name: meta.company || (displayName + "'s team"),
            created_by: session.user.id,
            plan_tier: 'trial',
            trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          })
          .select('id')
          .single();
        if(!orgInsert.error && orgInsert.data){
          // Creator becomes admin via the orgs_add_creator_as_admin trigger.
          vxPlatformSet({ orgId: orgInsert.data.id, role: 'admin' });
          console.log('vx: reconciled missing org for user', session.user.id);
        } else {
          console.warn('vx: org reconciliation failed', orgInsert.error);
        }
      }
    }
  } catch(e){ console.warn('vx: org membership lookup failed', e); }
}

// Map Supabase lowercase enum role → display role used by the existing
// CURRENT_USER materialisation in doLogin / doRegister / etc.
function _vxRoleToDisplay(role){
  switch(role){
    case 'admin':     return 'Admin';
    case 'senior':    return 'Senior';
    case 'inspector': return 'Inspector';
    case 'observer':  return 'Viewer';
    default:          return 'Inspector';
  }
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

// ── Device-class detection for feature gating ────────────────────────
// The PDF template editor uses precision drag-and-drop, a properties
// panel, undo/redo, and multi-page navigation that work poorly on touch.
// We gate it to "desktop-class" devices: viewport ≥1100px AND mouse-grade
// pointer. Mobile and small tablets get the report-making side of the
// app, which is forms-heavy and works well on touch.
//
// "Desktop-class" rules:
// - Viewport width must be ≥ 1100px (covers laptop, desktop, iPad Pro
//   12.9" in landscape with keyboard, etc).
// - matchMedia('(pointer: fine)') must match — i.e. the primary input
//   is a mouse or trackpad. Phones and tablets-without-keyboard report
//   'coarse'. iPads with Magic Keyboard correctly report 'fine'.
// - localStorage `vx-force-desktop=1` overrides the above (for users who
//   want to attempt template editing on a borderline device anyway).
//
// The check runs each call, so window resize, device rotation, and
// external monitor connect/disconnect all flow through naturally.
function vxIsDesktopClass(){
  try {
    if(localStorage.getItem('vx-force-desktop') === '1') return true;
  } catch(e){}
  if(typeof window === 'undefined') return true;          // SSR safety
  if(window.innerWidth < 1100) return false;
  if(window.matchMedia && window.matchMedia('(pointer: fine)').matches) return true;
  return false;
}

// Render a friendly explanation panel inside the PDF editor section when
// a non-desktop device tries to open it. The panel takes over the whole
// section so the user isn't confused by a half-rendered editor UI, and
// gives them a clear path to the reports flow which IS available on
// their device.
function cvShowDesktopOnly(){
  const pdfSec = document.getElementById('ss-pdfeditor');
  if(!pdfSec) return;
  pdfSec.innerHTML = `
    <div class="sh">
      <div class="sh-left">
        <div class="sh-title" data-i18n="sh.pdf_editor">PDF layout editor</div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:48px 24px;min-height:480px;gap:18px;background:var(--panel);border:1px solid var(--border2);border-radius:8px">
      <div style="font-size:56px;line-height:1" aria-hidden="true">🖥️</div>
      <div style="font-size:22px;font-weight:600;color:var(--t1)" data-i18n="pe.desktop_only.title">Template editing is desktop-only</div>
      <div style="max-width:520px;color:var(--t2);line-height:1.55" data-i18n="pe.desktop_only.body">The template editor uses precision drag-and-drop that works best with a mouse on a larger screen. To design a report template, open Veritix on a desktop or laptop browser. You can still create and fill out reports right here on this device.</div>
      <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;justify-content:center">
        <button class="btn btn-primary" data-action="showSS" data-pass-el="1" data-args="'reports'" data-i18n="pe.desktop_only.go_reports">Make a report instead</button>
      </div>
    </div>
  `;
  try { if(typeof i18nApply === 'function') i18nApply(pdfSec); } catch(e){}
}

// Apply device gating to the sidebar. On non-desktop devices, dim the
// PDF editor entry and tag it with a small "Desktop" badge so users
// understand it exists but isn't usable here. Don't fully hide it —
// hiding entry points to features confuses users who heard about a
// feature from a colleague and can't find it.
function vxApplyDeviceGating(){
  const navItem = document.getElementById('sni-pdfeditor');
  if(!navItem) return;
  const desktop = vxIsDesktopClass();
  if(desktop){
    navItem.style.opacity = '';
    navItem.removeAttribute('title');
    const badge = navItem.querySelector('.vx-desktop-badge');
    if(badge) badge.remove();
    return;
  }
  // Non-desktop: dim and badge
  navItem.style.opacity = '.62';
  navItem.title = (typeof t === 'function')
    ? t('nav.desktop_only_hint', 'Available on desktop')
    : 'Available on desktop';
  if(!navItem.querySelector('.vx-desktop-badge')){
    const badge = document.createElement('span');
    badge.className = 'vx-desktop-badge';
    badge.textContent = (typeof t === 'function') ? t('nav.desktop_badge', 'Desktop') : 'Desktop';
    badge.style.cssText = 'margin-left:auto;font-size:9px;padding:2px 6px;border-radius:3px;background:var(--hover-bg);border:1px solid var(--border);color:var(--t3);font-weight:500;letter-spacing:.4px;text-transform:uppercase;flex-shrink:0';
    navItem.appendChild(badge);
  }
}

// One-time welcome toast on first mobile/tablet sign-in. Sets expectation
// that the touch experience is reports-only, so users don't go hunting
// for template editing.
function vxMobileWelcome(){
  if(vxIsDesktopClass()) return;
  try {
    if(localStorage.getItem('vx-mobile-welcomed-v1') === '1') return;
    localStorage.setItem('vx-mobile-welcomed-v1', '1');
  } catch(e){ return; }
  setTimeout(() => {
    try {
      if(typeof toast === 'function'){
        toast(t('toast.mobile_welcome', 'Welcome! Template editing is on desktop — reports are right here.'), 'info', 6500);
      }
    } catch(e){}
  }, 1200);
}

// ── Role-based access control ────────────────────────────────────────
// Single source of truth for "who can do what". Roles in this app:
//   Admin    — full access; can configure company, users, templates, etc
//   Senior   — Inspector + can approve reports
//   Inspector— make and edit their own reports
//   Viewer   — read-only (rarely used today, kept for future)
// The first registered user is automatically Admin; subsequent users
// default to Inspector.
//
// IMPORTANT: this is CLIENT-SIDE gating only. A determined user can edit
// localStorage to flip their own role and unlock any UI. When the backend
// lands it must enforce these same rules on every write path. The client
// gating exists for UX clarity — don't show users buttons that won't
// work for them — not for security.
// V44.3: role gates consult the legacy CURRENT_USER first (fast path,
// avoids reading localStorage on every gate check), then fall back to
// the server-trusted role stashed in vxPlatformConfig. This closes the
// gap where a user authenticated via Supabase has correct membership
// server-side but a stale CURRENT_USER from the local-fallback signup.
function vxIsAdmin()        {
  if(CURRENT_USER?.role === 'Admin') return true;
  try { return vxPlatformConfig().role === 'admin'; } catch(e){ return false; }
}
function vxIsSeniorOrAdmin(){
  if(CURRENT_USER?.role === 'Admin' || CURRENT_USER?.role === 'Senior') return true;
  try { var r = vxPlatformConfig().role; return r === 'admin' || r === 'senior'; } catch(e){ return false; }
}

// Every Settings sub-section is admin-only. The settings page itself is
// already hidden from non-admins via the top-nav button + showPage guard;
// this list provides defense-in-depth at the sub-section level in case
// any future code path routes a non-admin into the settings shell.
var VX_ADMIN_ONLY_SECTIONS = new Set([
  'company','inspectors','equipment','users','methods','numbering','templates',
  'pdfeditor','procedures','appearance','subscription','database',
  'notifications','system'
]);

// Action-level guard. Call from any handler that performs an admin
// operation (saveCompany, inboxApprove, etc). Returns true if the
// caller should proceed, false if they should abort. Emits a toast on
// denial so the user knows why nothing happened.
function vxRequireAdmin(actionLabel){
  if(vxIsAdmin()) return true;
  try {
    if(typeof toast === 'function'){
      const msg = actionLabel
        ? t('toast.admin_required_action', 'Admin access required: {action}.').replace('{action}', actionLabel)
        : t('toast.admin_required', 'Admin access required.');
      toast(msg, 'error');
    }
  } catch(e){}
  return false;
}

// Render the friendly "admin required" panel inside a settings section
// when a non-admin tries to navigate there. Mirrors the desktop-only
// panel pattern so the visual language is consistent.
function vxShowAdminRequired(sectionId){
  const sec = document.getElementById('ss-' + sectionId);
  if(!sec) return;
  sec.innerHTML = `
    <div class="sh"><div class="sh-left"><div class="sh-title" data-i18n="rbac.admin_required.title">Admin access required</div></div></div>
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:48px 24px;min-height:480px;gap:18px;background:var(--panel);border:1px solid var(--border2);border-radius:8px">
      <div style="font-size:56px;line-height:1" aria-hidden="true">🔒</div>
      <div style="font-size:22px;font-weight:600;color:var(--t1)" data-i18n="rbac.admin_required.title">Admin access required</div>
      <div style="max-width:520px;color:var(--t2);line-height:1.55" data-i18n="rbac.admin_required.body">This section is reserved for users with the Admin role. To make changes here, ask an administrator. You can still create reports and view your inbox from the top navigation.</div>
      <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;justify-content:center">
        <button class="btn btn-primary" data-action="showPage" data-pass-el="1" data-args="'reports'" data-i18n="rbac.admin_required.go_reports">Go to reports</button>
      </div>
    </div>
  `;
  try { if(typeof i18nApply === 'function') i18nApply(sec); } catch(e){}
}

// Apply role-based gating to the sidebar nav. Hides every admin-only
// sub-section entry for non-admin users. Combined with the existing
// top-nav settings button hide, non-admins simply don't see admin
// surfaces at all. Called at boot and after any role change.
function vxApplyRoleGating(){
  const admin = vxIsAdmin();
  VX_ADMIN_ONLY_SECTIONS.forEach(secId => {
    const navItem = document.getElementById('sni-' + secId);
    if(!navItem) return;
    navItem.style.display = admin ? '' : 'none';
  });
}

// V28 — Support-facing diagnostics. Call from the browser console:
//   await vxDiagnostics()
// to get a structured snapshot of platform config (with secrets redacted),
// connection state, sync queue depth, storage usage, and recent activity.
// Useful when a customer reports "sync isn't working" — ask them to run
// this and paste the output. The function is safe to call: it doesn't
// modify state or transmit anything.
async function vxDiagnostics() {
  const cfg = vxPlatformConfig();
  const redacted = (s) => s ? (s.slice(0, 8) + '…' + s.slice(-4)) : null;
  // V44: _vxWs is a Supabase RealtimeChannel under the new transport; its
  // .state property is one of 'closed' | 'errored' | 'joined' | 'joining' |
  // 'leaving'. Map onto the same vocab the old WebSocket-based version
  // returned so support scripts that grep these strings keep working.
  const _wsState = _vxWs && _vxWs.state;
  const realtimeStatus =
    !_vxWs              ? 'disconnected' :
    _wsState === 'joined'  ? 'connected'    :
    _wsState === 'joining' ? 'connecting'   :
    _wsState === 'leaving' ? 'closing'      :
                             'closed';
  const queueDepth = (() => {
    try { return (JSON.parse(localStorage.getItem('vx-sync-queue-v1')) || []).length; }
    catch { return -1; }
  })();
  let storage = null;
  try {
    if(vxStore && typeof vxStore.stats === 'function') storage = await vxStore.stats();
  } catch(e){}
  const result = {
    timestamp: new Date().toISOString(),
    appVersion: 'v3.0',
    appBuild:   'i18n-complete',
    platform: {
      apiBase: cfg.apiBase,
      apiBaseSource: _vxReadMetaApiBase() ? 'meta-tag' : 'default',
      authState: vxAuthState(),
      orgId: cfg.orgId,
      userId: cfg.userId,
      accessTokenPreview: redacted(cfg.accessToken),
      tokenExpiry: cfg.tokenExpiry ? new Date(cfg.tokenExpiry).toISOString() : null,
      lastSyncAt: cfg.lastSyncAt ? new Date(cfg.lastSyncAt).toISOString() : null,
      syncErrorCount: cfg.syncErrorCount || 0,
    },
    realtime: {
      status: realtimeStatus,
      reconnectAttempt: _vxWsReconnectAttempt || 0,
      pingIntervalMs: VX_WS_PING_INTERVAL_MS,
    },
    syncQueue: { depth: queueDepth },
    storage,
    browser: {
      userAgent: navigator.userAgent,
      online: navigator.onLine,
      language: navigator.language,
      cookieEnabled: navigator.cookieEnabled,
    },
  };
  console.log('vx diagnostics:', result);
  return result;
}
window.vxDiagnostics = vxDiagnostics;

// ── Sync queue ────────────────────────────────────────────────────────────
// Each entry records a single mutation that should be replayed against the
// server. We replay in insertion order and on success mark the entry delivered.
// Failed entries stay in the queue for the periodic retry sweep.
// V14: sync queue robustness — per-key dedup, size cap, circuit breaker.
//
// Dedup: if a 'put' for the same key is already pending, replace its value
// rather than adding another op. Most user activity is rapid edits to the
// same record; without this, a 30-second editing session can leave 50
// pending ops for one report. Last write wins, which matches the server's
// semantics anyway.
//
// Size cap: queue is bounded to 5000 ops. If we exceed, oldest delivered/
// failed ops get evicted. Failed ops past N retries are dropped with a
// telemetry event (the user is in a bad state and we want to surface it).
//
// Circuit breaker: if the last 5 sync attempts all failed, stop trying for
// 60 seconds. Prevents hammering an unhealthy server. The next manual sync
// or successful request resets the breaker.

var VX_SYNC_QUEUE_MAX     = 5000;
var VX_SYNC_OP_MAX_RETRIES = 8;
var VX_BREAKER_FAIL_THRESHOLD = 5;
var VX_BREAKER_COOLDOWN_MS    = 60 * 1000;
var _vxBreakerRecentFails = 0;
var _vxBreakerOpenUntil = 0;
// Count of consecutive breaker trips (resets on the first successful
// op). When the SDK client wedges into a bad state, every request fails
// with TypeError: Failed to fetch — the breaker opens, cools down, then
// trips again the moment retries resume. After two such trips we null
// out the cached _vxSupabaseClient so the next call rebuilds it from
// scratch with a fresh fetch wrapper, websocket, and auth listener.
var _vxBreakerTripCount = 0;
var VX_BREAKER_TRIPS_BEFORE_SDK_RESET = 2;

function vxBreakerIsOpen() { return Date.now() < _vxBreakerOpenUntil; }
function _vxBreakerRecordResult(ok) {
  if(ok) {
    _vxBreakerRecentFails = 0;
    _vxBreakerOpenUntil = 0;
    _vxBreakerTripCount = 0;
  } else {
    _vxBreakerRecentFails++;
    if(_vxBreakerRecentFails >= VX_BREAKER_FAIL_THRESHOLD) {
      _vxBreakerOpenUntil = Date.now() + VX_BREAKER_COOLDOWN_MS;
      _vxBreakerRecentFails = 0;   // reset so the *next* burst counts cleanly toward another trip
      _vxBreakerTripCount++;
      console.warn('vx: sync circuit breaker open for ' + (VX_BREAKER_COOLDOWN_MS/1000) + 's (trip ' + _vxBreakerTripCount + ')');
      if(_vxBreakerTripCount >= VX_BREAKER_TRIPS_BEFORE_SDK_RESET) {
        console.warn('vx: resetting Supabase SDK singleton after ' + _vxBreakerTripCount + ' consecutive breaker trips');
        _vxDisposeSupabaseClient(_vxSupabaseClient);
        _vxSupabaseClient = null;
        _vxBreakerTripCount = 0;
      }
    }
  }
}

function vxSyncEnqueue(op) {
  if(!vxIsAuthenticated()) return;
  if(!VX_ENTITY_KEYS.has(op.key)) return;     // only sync entity keys
  try {
    let queue = JSON.parse(localStorage.getItem(VX_SYNC_QUEUE_KEY) || '[]');

    // Dedup: if there's already a pending op for this key with the same kind,
    // replace its value (and bump the timestamp) rather than appending.
    const existingIdx = queue.findIndex(o =>
      o.key === op.key && o.op === op.kind && o.status === 'pending'
    );
    if(existingIdx >= 0 && op.kind !== 'delete') {
      queue[existingIdx].value = op.value;
      queue[existingIdx].at = new Date().toISOString();
    } else {
      queue.push({
        id: 'op-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        at: new Date().toISOString(),
        op: op.kind,                            // 'put' | 'delete' | 'patch'
        key: op.key,
        value: op.value,
        tries: 0,
        status: 'pending',
      });
    }

    // Size cap: drop oldest delivered/failed ops if over the limit.
    if(queue.length > VX_SYNC_QUEUE_MAX) {
      queue.sort((a, b) => {
        // Pending > failed > delivered, then by timestamp (newest first)
        const order = { pending: 0, failed: 1, delivered: 2 };
        if(order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return new Date(b.at) - new Date(a.at);
      });
      queue = queue.slice(0, VX_SYNC_QUEUE_MAX);
    }

    try {
    localStorage.setItem(VX_SYNC_QUEUE_KEY, JSON.stringify(queue));
    } catch(e){ console.warn("ls setItem failed", e); }
    vxSyncPokeBadge();
  } catch(e) { console.warn('vxSyncEnqueue', e); }
}
function vxSyncList()   { try { return JSON.parse(localStorage.getItem(VX_SYNC_QUEUE_KEY) || '[]'); } catch { return []; } }
function vxSyncStats()  {
  const q = vxSyncList();
  return {
    total: q.length,
    pending: q.filter(o => o.status === 'pending').length,
    failed:  q.filter(o => o.status === 'failed').length,
    delivered: q.filter(o => o.status === 'delivered').length,
    droppedPermanently: vxSyncDroppedList().length,
    breakerOpen: vxBreakerIsOpen(),
  };
}
function vxSyncPokeBadge() {
  try { window.dispatchEvent(new CustomEvent('vx:sync-change', { detail: vxSyncStats() })); } catch(e){}
}
async function vxSyncFlush() {
  if(!vxIsAuthenticated()) return { skipped: true };
  if(!navigator.onLine)    return { offline: true };
  if(vxBreakerIsOpen())    return { breakerOpen: true, openUntil: _vxBreakerOpenUntil };

  const queue = vxSyncList();
  const pending = queue.filter(o => o.status === 'pending' || o.status === 'failed');
  if(!pending.length) return { empty: true };

  let delivered = 0, failed = 0, dropped = 0;
  const droppedThisRun = [];
  for(const op of pending) {
    if(vxBreakerIsOpen()) break;   // stop mid-flush if breaker trips
    op.tries = (op.tries || 0) + 1;

    // Drop ops that have exceeded the retry budget — mark them so the
    // compaction step at the end of this function evicts them from the
    // queue (instead of leaving them in 'failed' state to be re-tried
    // forever on every subsequent flush). A copy is stashed in the
    // dropped log for UI surfacing and post-mortem.
    if(op.tries > VX_SYNC_OP_MAX_RETRIES) {
      op.status = 'dropped';
      op.lastError = (op.lastError || '') + ' [exceeded retry budget]';
      op.droppedAt = new Date().toISOString();
      droppedThisRun.push({
        id: op.id, key: op.key, op: op.op, tries: op.tries,
        lastError: op.lastError, droppedAt: op.droppedAt,
      });
      dropped++;
      vxReportError(new Error('Sync op dropped after ' + op.tries + ' attempts: ' + op.key), 'sync-drop');
      continue;
    }

    try {
      // V44: route through the Supabase-backed entity helpers. The op.value
      // we stored at enqueue time is the parsed JS object (since lss()
      // hands us the JS object before JSON.stringify) — pass it through to
      // upsertEntity which writes it as jsonb.
      var r;
      if(op.op === 'delete'){
        r = await vxApi.deleteEntity(op.key);
      } else {
        r = await vxApi.upsertEntity(op.key, op.value);
      }
      if(r.ok) {
        op.status = 'delivered'; op.deliveredAt = new Date().toISOString();
        delivered++;
        _vxBreakerRecordResult(true);
      } else {
        op.status = 'failed'; op.lastError = r.error || 'sync error';
        failed++;
        _vxBreakerRecordResult(false);
      }
    } catch(e) {
      op.status = 'failed'; op.lastError = String(e.message || e);
      failed++;
      _vxBreakerRecordResult(false);
    }
  }
  // Compact:
  //   - 'dropped' ops are removed from the queue entirely (their record
  //     lives in the dropped log persisted below — without this they were
  //     left in 'failed' state and re-tried every cycle, which is how the
  //     vx-settings-v1 op reached 134 attempts before).
  //   - 'delivered' ops older than 24h are pruned to keep storage tidy.
  const cutoff = Date.now() - 24*60*60*1000;
  const next = queue.filter(o => {
    if(o.status === 'dropped') return false;
    if(o.status === 'delivered') return o.deliveredAt && new Date(o.deliveredAt).getTime() > cutoff;
    return true;
  });
  try { localStorage.setItem(VX_SYNC_QUEUE_KEY, JSON.stringify(next)); } catch(e){}
  // Persist this run's dropped ops, capped to the most recent 200 so the
  // log can't itself become a storage hog. UI consumers read this via
  // vxSyncDroppedList() to surface a "N ops dropped permanently" badge.
  if(droppedThisRun.length){
    try {
      const existing = JSON.parse(localStorage.getItem(VX_SYNC_DROPPED_KEY) || '[]');
      const combined = existing.concat(droppedThisRun).slice(-200);
      localStorage.setItem(VX_SYNC_DROPPED_KEY, JSON.stringify(combined));
    } catch(e){}
  }
  vxPlatformSet({ lastSyncAt: new Date().toISOString(), syncErrorCount: failed });
  vxSyncPokeBadge();
  return { delivered, failed, dropped, remaining: next.filter(o => o.status !== 'delivered').length };
}

// Read the persisted dropped-op log. UI / diagnostics use this to show
// "N ops dropped permanently" without scanning the live queue.
function vxSyncDroppedList() {
  try { return JSON.parse(localStorage.getItem(VX_SYNC_DROPPED_KEY) || '[]'); }
  catch { return []; }
}
// Clear the dropped log — useful for "I've seen the failures, hide the
// badge" actions or for tests.
function vxSyncDroppedClear() {
  try { localStorage.removeItem(VX_SYNC_DROPPED_KEY); }
  catch(e){}
  vxSyncPokeBadge();
}

// Periodic retry sweep — every 30s when authenticated AND online AND breaker closed
var _vxSyncTimer = null;
function vxSyncStart() {
  if(_vxSyncTimer) clearInterval(_vxSyncTimer);
  _vxSyncTimer = setInterval(() => {
    if(vxIsCloud() && navigator.onLine) vxSyncFlush().catch(() => {});
  }, 30 * 1000);
}

// ── Deployment mode pill (topbar) ─────────────────────────────────────────
var _vxModePillSyncing = false;
function updateDeployModePill() {
  const pill = document.getElementById('vx-mode-pill'); if(!pill) return;
  const cfg = vxPlatformConfig();
  const stats = vxSyncStats();
  const state = vxAuthState();
  pill.style.display = 'inline-flex';

  // V13: No more "Local" state. The pill always reflects cloud-product status.
  // ── Trial: no account yet ──
  if(state === 'trial') {
    const dirty = vxStore.dirtyKeys().length;
    pill.dataset.state = 'trial';
    pill.title = dirty
      ? `Trial mode — ${dirty} change${dirty!==1?'s':''} waiting locally. Sign up to save them to the cloud.`
      : 'Trial mode — sign up to save your work to the cloud.';
    el('vx-mode-label').innerHTML = t('sync.trial', 'Trial') + (dirty ? ' <span class="vx-mode-count">'+dirty+'</span>' : '');
    return;
  }
  // ── Signed out (lost token) ──
  if(state === 'signed_out') {
    pill.dataset.state = 'signin';
    pill.title = 'Session expired — sign in to resume syncing';
    el('vx-mode-label').textContent = t('sync.signed_out', 'Sign in');
    return;
  }
  // ── Authenticated states: offline / syncing / error / pending / synced ──
  if(!navigator.onLine) {
    pill.dataset.state = 'offline';
    pill.title = 'Offline — ' + stats.pending + ' change' + (stats.pending!==1?'s':'') + ' will sync when back online';
    el('vx-mode-label').innerHTML = t('sync.offline', 'Offline') + (stats.pending ? ' <span class="vx-mode-count">'+stats.pending+'</span>' : '');
    return;
  }
  if(_vxModePillSyncing) {
    pill.dataset.state = 'syncing';
    pill.title = 'Syncing changes…';
    el('vx-mode-label').textContent = t('sync.syncing', 'Syncing…');
    return;
  }
  if(stats.failed > 0) {
    pill.dataset.state = 'error';
    pill.title = stats.failed + ' sync failure' + (stats.failed!==1?'s':'') + ' — click to retry';
    el('vx-mode-label').innerHTML = t('sync.error', 'Sync error') + ' <span class="vx-mode-count">'+stats.failed+'</span>';
    return;
  }
  if(stats.pending > 0) {
    pill.dataset.state = 'pending';
    pill.title = stats.pending + ' change' + (stats.pending!==1?'s':'') + ' pending upload';
    el('vx-mode-label').innerHTML = t('sync.pending', 'Pending') + ' <span class="vx-mode-count">'+stats.pending+'</span>';
    return;
  }
  pill.dataset.state = 'synced';
  const last = cfg.lastSyncAt ? new Date(cfg.lastSyncAt) : null;
  pill.title = 'Synced' + (last ? ' · last ' + last.toLocaleTimeString() : '');
  el('vx-mode-label').textContent = t('sync.synced', 'Synced');
}

function vxModePillClick() {
  const state = vxAuthState();
  if(state === 'trial' || state === 'signed_out') {
    // Open the signup / signin page
    if(typeof showPage === 'function') {
      showPage('settings', el('tn-settings'));
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if(typeof showSS === 'function') showSS('subscription', el('sni-subscription'));
      }));
    }
    return;
    return;
  }
  // Cloud mode → trigger a manual sync flush, or open sync activity
  vxOpenSyncActivity();
}

window.addEventListener('vx:platform-change', () => updateDeployModePill());
window.addEventListener('vx:sync-change',     () => updateDeployModePill());
window.addEventListener('online',  () => updateDeployModePill());
window.addEventListener('offline', () => updateDeployModePill());
// V13: trial banner also reacts to auth/sync state changes
window.addEventListener('vx:platform-change', () => { if(typeof renderTrialBanner === 'function') renderTrialBanner(); });

// ── Trial banner (V13) ───────────────────────────────────────────────────
// A slim sticky banner under the topbar that surfaces "you're in trial mode,
// sign up to save your work to the cloud." Auto-hides once the user is
// authenticated. Dismissible per session (returns next page load).
function renderTrialBanner() {
  let banner = document.getElementById('vx-trial-banner');
  const state = vxAuthState();
  const cfg = vxPlatformConfig();
  const needsVerification = state === 'authenticated' && cfg.emailVerified === false;

  // Authenticated & verified → remove banner
  if(state === 'authenticated' && !needsVerification) {
    if(banner) banner.remove();
    return;
  }
  if(banner) return;   // already showing
  if(sessionStorage.getItem('vx-trial-banner-dismissed') === '1') return;
  banner = document.createElement('div');
  banner.id = 'vx-trial-banner';
  banner.className = 'vx-trial-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  const dirty = vxStore.dirtyKeys().length;
  const isSignedOut = state === 'signed_out';

  // V14: three banner states — unverified / signed_out / trial
  let bodyHtml, ctaText, ctaAction;
  if(needsVerification) {
    bodyHtml = tf('banner.verify','<strong>Confirm your email.</strong> We sent a verification link to {email}. Some features unlock after you click it.',
                  { email: escapeHtml(CURRENT_USER?.email || t('banner.your_inbox','your inbox')) });
    ctaText = t('banner.resend','Resend email');
    ctaAction = 'vxResendVerification';
  } else if(isSignedOut) {
    bodyHtml = t('banner.signed_out','<strong>Session expired.</strong> Sign in to resume syncing your work to the cloud.');
    ctaText = t('app.signin','Sign in');
    ctaAction = 'vxOpenSignup';
  } else {
    const intro = t('banner.trial_intro',"<strong>You're trying Veritix Cloud.</strong>");
    const pending = dirty>0
      ? ' ' + tf('banner.dirty_pending', '{n} change{plural} {verb} waiting locally.', {
          n: dirty,
          plural: dirty!==1 ? 's' : '',
          verb: dirty===1 ? 'is' : 'are'
        })
      : '';
    const cta = ' ' + t('banner.trial_cta','Start your free 14-day trial to sync across devices.');
    bodyHtml = intro + pending + cta;
    ctaText = t('welcome.cta','Start free trial →');
    ctaAction = 'vxOpenSignup';
  }

  banner.innerHTML = `
    <span class="vx-trial-banner-icon" aria-hidden="true">${(isSignedOut || needsVerification)
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
    }</span>
    <span class="vx-trial-banner-body">${bodyHtml}</span>
    <button class="vx-trial-banner-cta" data-action="${ctaAction}">${ctaText}</button>
    <button class="vx-trial-banner-close" data-action="vxDismissTrialBanner" aria-label="${t('ui.dismiss','Dismiss')}">✕</button>`;
  // Insert right under the topbar
  const topbar = document.querySelector('.topbar');
  if(topbar && topbar.parentNode) topbar.parentNode.insertBefore(banner, topbar.nextSibling);
}

async function vxResendVerification() {
  if(!vxIsAuthenticated()) return;
  const r = await vxApi.request('/auth/resend-verification', { method: 'POST' });
  if(r.ok) toast(t('toast.verification_sent', 'Verification email sent. Check your inbox.'), 'success');
  else toast('Couldn\'t send: ' + (r.error || 'try again later'), 'error');
}
function vxDismissTrialBanner() {
  sessionStorage.setItem('vx-trial-banner-dismissed', '1');
  const banner = document.getElementById('vx-trial-banner');
  if(banner) banner.remove();
}

// ── Welcome modal (V13) ──────────────────────────────────────────────────
// Shown on first launch for unauthenticated users. Three paths: start trial,
// sign in, or preview without an account (which is the implicit current mode).
function vxOpenWelcome() {
  let modal = document.getElementById('vx-welcome-modal');
  if(modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'vx-welcome-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99998;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);padding:24px';
  modal.onclick = e => { if(e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div style="background:var(--panel);border:1px solid var(--border2);border-radius:16px;width:480px;max-width:96vw;box-shadow:var(--sh-xl), 0 0 80px rgba(0,212,255,.10);overflow:hidden">
      <div style="padding:32px 36px 24px;text-align:center;background:linear-gradient(135deg,rgba(0,212,255,.08),rgba(167,139,250,.06));border-bottom:1px solid var(--border)">
        <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:rgba(0,212,255,.10);margin:0 auto 14px;border:1px solid rgba(0,212,255,.30)">
          <svg width="26" height="30" viewBox="0 0 52 60" aria-hidden="true">
            <path d="M26 2 L50 14 L50 36 Q50 52 26 58 Q2 52 2 36 L2 14 Z" style="fill:rgba(79,142,247,0.15);stroke:var(--blue);stroke-width:1.5"/>
            <path d="M17 30 L24 38 L36 22" style="fill:none;stroke:var(--red);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round"/>
          </svg>
        </div>
        <div style="font-size:22px;font-weight:600;color:var(--t1);margin-bottom:6px;letter-spacing:-.01em">${t('welcome.title','Welcome to Veritix')}</div>
        <div style="font-size:13px;color:var(--t2);line-height:1.55">${t('welcome.subtitle','Cloud-based NDT inspection management.')} ${t('welcome.subtitle2','Used by shops, fabricators, and asset-integrity teams worldwide.')}</div>
      </div>
      <div style="padding:24px 36px 28px">
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r2);padding:14px 16px;margin-bottom:14px">
          <div style="font-size:13px;font-weight:600;color:var(--t1);margin-bottom:6px;display:flex;align-items:center;gap:8px">
            ${t('welcome.trial_label','14-day free trial')}
          </div>
          <ul style="margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--t2);line-height:1.7">
            <li>${t('welcome.feature_1','Full feature set on the Standard plan')}</li>
            <li>${t('welcome.feature_2','Web, iOS, and Android — synced in real time')}</li>
            <li>${t('welcome.feature_3','Cancel anytime; data export always available')}</li>
          </ul>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn" data-action="vxOpenSignup" style="background:var(--cyan);color:#001;border-color:var(--cyan);font-size:13px;font-weight:600;padding:11px 16px">${t('welcome.cta','Start free trial →')}</button>
          <button class="btn btn-sm" data-action="vxOpenSignin" style="font-size:12px">${t('welcome.signin_cta','I already have an account')}</button>
          <button class="btn btn-sm" data-action="vxPreviewWithoutAccount" style="font-size:11px;color:var(--t3);background:transparent;border:none">${t('welcome.preview_cta','Preview without an account →').replace(' →','')}</button>
        </div>
        <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border);font-size:11px;color:var(--t3);line-height:1.55;text-align:center">
          ${t('welcome.security_note','Your data is encrypted in transit (TLS 1.3) and at rest (AES-256). Veritix staff cannot read your reports without your authorisation.')} <a data-action="_wCloseWelcomeOpenHelp" style="color:var(--cyan);cursor:pointer">${t('ui.learn_more','Learn more')} →</a>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  openA11yModal(modal, { label: t('welcome.title','Welcome to Veritix') });
}
function vxOpenSignup() {
  const m = document.getElementById('vx-welcome-modal'); if(m) m.remove();
  showPage('settings', el('tn-settings'));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if(typeof showSS === 'function') showSS('subscription', el('sni-subscription'));
    // Bias the form to signup tab
    requestAnimationFrame(() => { const el = document.getElementById('cloud-mode-signup'); if(el) el.click(); });
  }));
}
function vxOpenSignin() {
  const m = document.getElementById('vx-welcome-modal'); if(m) m.remove();
  showPage('settings', el('tn-settings'));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if(typeof showSS === 'function') showSS('subscription', el('sni-subscription'));
    requestAnimationFrame(() => { const el = document.getElementById('cloud-mode-signin'); if(el) el.click(); });
  }));
}
function vxPreviewWithoutAccount() {
  const m = document.getElementById('vx-welcome-modal'); if(m) m.remove();
  toast(t('msg.previewing', 'Previewing without an account. Sign up to save your work.'), 'info');
}

// ── Sync activity modal ───────────────────────────────────────────────────
function vxOpenSyncActivity() {
  const cfg = vxPlatformConfig();
  const queue = vxSyncList();
  let modal = document.getElementById('vx-sync-modal');
  if(modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'vx-sync-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)';
  modal.onclick = e => { if(e.target === modal) modal.remove(); };
  let body = '';
  if(!queue.length) {
    const authed = vxIsAuthenticated();
    body = '<div style="padding:48px 30px;text-align:center;color:var(--t3);font-size:13px">' +
      (authed
        ? '<div style="font-size:32px;margin-bottom:8px;color:var(--green)">✓</div>Everything is synced with Veritix Cloud.<br>No pending changes on this device.'
        : '<div style="font-size:32px;margin-bottom:8px;color:var(--violet)">⊙</div>Sign in to sync your work to the cloud.<br>Changes you make are cached on this device until then.'
      ) + '</div>';
  } else {
    body = queue.slice().reverse().slice(0, 100).map(o => `
      <div style="padding:11px 16px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:11px">
        <div style="width:8px;height:8px;border-radius:50%;background:${o.status==='delivered'?'var(--green)':o.status==='failed'?'var(--red)':'var(--amber)'};margin-top:6px;flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:var(--t1)"><strong>${o.op.toUpperCase()}</strong> <span style="font-family:var(--mono);font-size:11px;color:var(--cyan)">${escapeHtml(o.key)}</span></div>
          ${o.lastError?`<div style="font-size:11px;color:var(--red);margin-top:3px">${escapeHtml(o.lastError)}</div>`:''}
          <div style="font-size:10px;color:var(--t3);font-family:var(--mono);margin-top:3px">${fmtDate(o.at)} · ${new Date(o.at).toLocaleTimeString()} · ${o.status}${o.tries?' · '+o.tries+' attempt'+(o.tries!==1?'s':''):''}</div>
        </div>
      </div>`).join('');
  }
  modal.innerHTML = `<div style="background:var(--panel);border:1px solid var(--border2);border-radius:14px;width:600px;max-width:96vw;max-height:75vh;display:flex;flex-direction:column;box-shadow:var(--sh-xl);overflow:hidden">
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px">
      <div>
        <div style="font-size:14px;font-weight:600;color:var(--t1)">Sync activity</div>
        <div style="font-size:11px;color:var(--t3);margin-top:2px">${queue.length} event${queue.length!==1?'s':''} · ${cfg.lastSyncAt?'last sync '+new Date(cfg.lastSyncAt).toLocaleString():'no sync yet'}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm" data-action="vxManualSync">↻ Sync now</button>
        <button class="btn btn-sm" data-action="_wRemoveById" data-args="\'vx-sync-modal\'">Close</button>
      </div>
    </div>
    <div style="overflow-y:auto;flex:1">${body}</div>
  </div>`;
  document.body.appendChild(modal);
  openA11yModal(modal);
}
async function vxManualSync() {
  if(!vxIsAuthenticated()) { toast(t('toast.signin_to_sync', 'Sign in to sync your work.'), 'warn'); return; }
  if(!navigator.onLine) { toast('You are offline. Will sync when reconnected.', 'warn'); return; }
  _vxModePillSyncing = true; updateDeployModePill();
  try {
    const result = await vxSyncFlush();
    if(result.delivered) toast(result.delivered + ' change' + (result.delivered!==1?'s':'') + ' synced.', 'success');
    else if(result.empty) toast(t('toast.nothing_to_sync', 'Nothing to sync.'), 'success');
    else if(result.failed) toast(result.failed + ' sync failure' + (result.failed!==1?'s':'') + ' — see activity log.', 'error');
  } finally {
    _vxModePillSyncing = false;
    updateDeployModePill();
    if(document.getElementById('vx-sync-modal')) vxOpenSyncActivity();
  }
}

// ── Account & plan settings page renderer ─────────────────────────────────
function vxRenderSubscription() {
  const cfg = vxPlatformConfig();
  const stats = vxSyncStats();
  const plan = vxPlanConfig();
  const authState = vxAuthState();   // 'trial' | 'signed_out' | 'authenticated'

  // ── Mode card (renamed: "Cloud sync status") ──
  const modeStatusEl = el('sub-mode-status');
  const modeBodyEl   = el('sub-mode-body');
  if(modeStatusEl) {
    const stateMap = {
      trial:         '<span style="color:var(--violet)">● ' + t('sub.state_trial','Trial mode — not signed up yet') + '</span>',
      signed_out:    '<span style="color:var(--violet)">● ' + t('sub.state_signed_out','Signed out — session expired') + '</span>',
      authenticated: '<span style="color:var(--green)">● ' + t('sub.state_authenticated','Connected to Veritix Cloud') + '</span>',
    };
    modeStatusEl.innerHTML = stateMap[authState];
  }

  if(modeBodyEl) {
    if(authState === 'trial') {
      const dirty = vxStore.dirtyKeys().length;
      const dirtyMsg = tf('sub.dirty_changes',
                          '{n} change{plural} {verb} waiting locally. Sign up to keep them — your trial data carries over.',
                          { n: dirty, plural: dirty!==1 ? 's' : '', verb: dirty===1 ? 'is' : 'are' });
      modeBodyEl.innerHTML = `
        <div style="margin-bottom:14px">
          <div style="font-size:14px;font-weight:500;color:var(--t1);margin-bottom:6px">${t('sub.previewing',"You're previewing Veritix without an account.")}</div>
          <div style="font-size:13px;color:var(--t2);line-height:1.6">
            ${dirty > 0
              ? `<strong style="color:var(--amber)">${dirtyMsg}</strong>`
              : t('sub.no_changes','Start your free 14-day trial to save your work to the cloud and sync across web, iOS, and Android.')
            }
          </div>
        </div>`;
    } else if(authState === 'signed_out') {
      modeBodyEl.innerHTML = `
        <div style="margin-bottom:14px">
          <div style="font-size:14px;font-weight:500;color:var(--t1);margin-bottom:6px">${t('sub.session_expired','Your session has expired.')}</div>
          <div style="font-size:13px;color:var(--t2);line-height:1.6">
            ${t('sub.signin_resume','Sign back in to resume syncing your work. Pending changes on this device will upload automatically.')}
          </div>
        </div>`;
    } else {
      const last = cfg.lastSyncAt ? new Date(cfg.lastSyncAt).toLocaleString(vxLocale()) : '—';
      modeBodyEl.innerHTML = `
        <div class="kvgrid" style="display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:13px">
          <div style="color:var(--t3)">${t('sub.endpoint','Endpoint')}</div><div style="font-family:var(--mono);font-size:12px;color:var(--cyan)">${escapeHtml(cfg.apiBase || '—')}</div>
          <div style="color:var(--t3)">${t('sub.organisation','Organisation')}</div><div style="font-family:var(--mono);font-size:12px">${escapeHtml(cfg.orgId || '—')}</div>
          <div style="color:var(--t3)">${t('sub.user','User')}</div><div style="font-family:var(--mono);font-size:12px">${escapeHtml(cfg.userId || '—')}</div>
          <div style="color:var(--t3)">${t('sub.last_sync','Last sync')}</div><div style="font-family:var(--mono);font-size:12px">${escapeHtml(last)}</div>
          <div style="color:var(--t3)">${t('sub.token_expires','Token expires')}</div><div style="font-family:var(--mono);font-size:12px">${cfg.tokenExpiry ? new Date(cfg.tokenExpiry).toLocaleString(vxLocale()) : '—'}</div>
        </div>`;
    }
  }

  // ── Sync card (authenticated only) ──
  const syncCard = el('sub-sync-card');
  const syncBody = el('sub-sync-body');
  if(syncCard) syncCard.style.display = authState === 'authenticated' ? 'block' : 'none';
  if(authState === 'authenticated' && syncBody) {
    const dirty = vxStore.dirtyKeys();
    syncBody.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:600;color:var(--t1)">${stats.pending}</div>
          <div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.04em;margin-top:2px">${t('sub.pending','Pending')}</div>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:600;color:${stats.failed?'var(--red)':'var(--t1)'}">${stats.failed}</div>
          <div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.04em;margin-top:2px">${t('sub.failed','Failed')}</div>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:600;color:var(--green)">${stats.delivered}</div>
          <div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.04em;margin-top:2px">${t('sub.delivered','Delivered')}</div>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:600;color:var(--t1)">${dirty.length}</div>
          <div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.04em;margin-top:2px">${t('sub.dirty_keys','Dirty keys')}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm" data-action="vxOpenSyncActivity" style="font-size:12px">${t('sub.view_activity','View activity log')}</button>
        <button class="btn btn-sm" data-action="_wCloseWelcomePullData" style="font-size:12px">↓ ${t('sub.pull_server','Pull from server')}</button>
      </div>`;
  }

  // ── Plan card (authenticated only) ──
  const planCard = el('sub-plan-card');
  const planBody = el('sub-plan-body');
  if(planCard) planCard.style.display = authState === 'authenticated' ? 'block' : 'none';
  if(authState === 'authenticated' && planBody) {
    const tierColor = { free:'var(--t3)', standard:'var(--cyan)', pro:'var(--violet)', enterprise:'var(--green)', unlimited:'var(--t1)' };
    el('sub-plan-status').innerHTML = `<span style="color:${tierColor[plan.tier]||'var(--t3)'}">${plan.tier.toUpperCase()}</span>`;
    const usageRow = (label, used, lim) => {
      const pct = (lim === Infinity || lim == null) ? 0 : Math.min(100, used / lim * 100);
      const text = (lim === Infinity || lim == null) ? `${used} (${t('sub.unlimited','unlimited')})` : `${used} / ${lim}`;
      const color = pct > 90 ? 'var(--red)' : pct > 75 ? 'var(--amber)' : 'var(--cyan)';
      return `
        <div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--t2);margin-bottom:4px"><span>${label}</span><span style="font-family:var(--mono)">${text}</span></div>
          <div style="height:5px;background:var(--bg2);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${color}"></div></div>
        </div>`;
    };
    const featureRow = (name, label) => `<div style="display:flex;align-items:center;gap:8px;padding:5px 0">
      <span style="color:${plan.features?.[name]?'var(--green)':'var(--t3)'};font-size:13px">${plan.features?.[name]?'✓':'✕'}</span>
      <span style="font-size:13px;color:${plan.features?.[name]?'var(--t1)':'var(--t3)'}">${label}</span>
    </div>`;
    planBody.innerHTML = `
      <div style="margin-bottom:18px">
        ${usageRow(t('sub.usage.reports','Reports this period'), plan.usage?.reports || 0, plan.limits?.maxReports)}
        ${usageRow(t('sub.usage.users','Users'), plan.usage?.users || 0, plan.limits?.maxUsers)}
        ${usageRow(t('sub.usage.storage','Storage (MB)'), plan.usage?.storageMB || 0, plan.limits?.maxStorageMB)}
      </div>
      <div style="border-top:1px solid var(--border);padding-top:14px">
        <div style="font-size:12px;color:var(--t2);font-weight:500;margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">${t('sub.features_inc','Features included')}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">
          ${featureRow('webhooks',         t('sub.feat.webhooks','Webhooks & integrations'))}
          ${featureRow('ics',              t('sub.feat.ics','Calendar (.ics) export'))}
          ${featureRow('api',              t('sub.feat.api','Public JSON API'))}
          ${featureRow('photoAnnotation',  t('sub.feat.photo','Photo annotation'))}
          ${featureRow('voice',            t('sub.feat.voice','Voice dictation'))}
          ${featureRow('barcode',          t('sub.feat.barcode','Barcode scanner'))}
          ${featureRow('geoMap',           t('sub.feat.geo','Geographic map'))}
          ${featureRow('advancedAnalytics',t('sub.feat.analytics','Advanced analytics'))}
          ${featureRow('realtimeCollab',   t('sub.feat.realtime','Real-time collaboration'))}
          ${featureRow('ssoSaml',          t('sub.feat.sso','SSO / SAML'))}
          ${featureRow('customBranding',   t('sub.feat.branding','Custom branding'))}
        </div>
      </div>
      <div style="margin-top:18px;display:flex;gap:8px">
        <button class="btn btn-sm" data-action="vxOpenBilling" style="background:var(--violet);color:#fff;border-color:var(--violet);font-size:12px">${t('sub.manage','Manage subscription →')}</button>
        <button class="btn btn-sm" data-action="vxRefreshPlan" style="font-size:12px">↻ ${t('sub.refresh_plan','Refresh from server')}</button>
      </div>`;
  }

  // ── Auth actions card (signup/signin tabs OR signed-in actions) ──
  const actionsBody = el('sub-actions-body');
  const actionsTitle = el('sub-actions-title');
  if(actionsBody && actionsTitle) {
    if(authState === 'authenticated') {
      actionsTitle.textContent = t('sub.account_actions','Account actions');
      actionsBody.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm" data-action="_wPullAll" style="font-size:12px">↓ ${t('sub.pull_all','Pull all from server')}</button>
          <button class="btn btn-sm" data-action="vxManualSync" style="font-size:12px">↑ ${t('sub.push_pending','Push pending changes')}</button>
          <button class="btn btn-sm btn-danger" data-action="vxSignOut" style="font-size:12px">${t('app.signout','Sign out')}</button>
        </div>
        <div style="font-size:11px;color:var(--t3);margin-top:14px;line-height:1.55">
          ${t('sub.signout_note','Signing out clears your token but keeps a local cache of your data on this device. The next sign-in will resume syncing automatically.')}
        </div>`;
    } else {
      // Trial or signed-out — show tabbed signup / signin form
      actionsTitle.textContent = authState === 'signed_out'
        ? t('sub.resume_signin','Sign in to resume syncing')
        : t('sub.get_started','Get started with Veritix Cloud');
      actionsBody.innerHTML = `
        <div style="display:flex;border-bottom:1px solid var(--border);margin-bottom:18px;gap:0">
          <button class="cloud-auth-tab ${authState==='signed_out'?'':'active'}" id="cloud-mode-signup" data-action="vxAuthTabSwitch" data-args="'signup'" type="button">${t('app.signup','Start free trial')}</button>
          <button class="cloud-auth-tab ${authState==='signed_out'?'active':''}" id="cloud-mode-signin" data-action="vxAuthTabSwitch" data-args="'signin'" type="button">${t('app.signin','Sign in')}</button>
        </div>
        <!-- Signup form -->
        <form id="cloud-form-signup" data-on-submit="_wFormSubmitSignup" data-pass-event="1" style="${authState==='signed_out'?'display:none':''}">
          <div class="fld" style="margin-bottom:10px"><label for="signup-name">${t('auth.name','Full name')}</label><input id="signup-name" autocomplete="name" required/></div>
          <div class="fld" style="margin-bottom:10px"><label for="signup-company">${t('auth.company','Company')}</label><input id="signup-company" autocomplete="organization" required/></div>
          <div class="fld" style="margin-bottom:10px"><label for="signup-email">${t('lbl.work_email','Work email')}</label><input id="signup-email" type="email" autocomplete="email" required/></div>
          <div class="fld" style="margin-bottom:14px"><label for="signup-password">${t('lbl.choose_password','Choose a password')}</label><input id="signup-password" type="password" autocomplete="new-password" minlength="8" required/><div class="fld-hint">${t('sub.pwd_hint','At least 8 characters')}</div></div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-sm" type="submit" style="background:var(--cyan);color:#001;border-color:var(--cyan);font-size:12px;font-weight:600">${t('sub.create_btn','Create account & start trial →')}</button>
            <span style="font-size:11px;color:var(--t3)">${t('sub.trial_subtitle','14-day free Standard tier')}</span>
          </div>
          <div style="font-size:10px;color:var(--t3);margin-top:14px;line-height:1.55">${t('sub.terms_note','By creating an account you agree to the Veritix Terms of Service and Privacy Policy.')}</div>
        </form>
        <!-- Signin form -->
        <form id="cloud-form-signin" data-on-submit="_wFormSubmitSignin" data-pass-event="1" style="${authState==='signed_out'?'':'display:none'}">
          <div class="fld" style="margin-bottom:10px"><label for="signin-email">${t('auth.email','Email')}</label><input id="signin-email" type="email" autocomplete="email" required/></div>
          <div class="fld" style="margin-bottom:14px"><label for="signin-password">${t('auth.password','Password')}</label><input id="signin-password" type="password" autocomplete="current-password" required/></div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-sm" type="submit" style="background:var(--cyan);color:#001;border-color:var(--cyan);font-size:12px;font-weight:600">${t('app.signin','Sign in')}</button>
            <a data-action="vxOpenForgotPassword" style="font-size:11px;color:var(--cyan);cursor:pointer">${t('auth.forgot','Forgot password?')}</a>
            <span style="flex:1"></span>
            <span style="font-size:11px;color:var(--t3)">${t('sub.sso_note','SSO sign-in via your IdP')}</span>
          </div>
        </form>`;
      // V12: associate labels for the newly-rendered form
      if(typeof a11yWireLabels === 'function') a11yWireLabels(actionsBody);
    }
  }
}

// V13: Cloud-first auth flow. The signup form creates a new account on the
// Veritix backend; signin authenticates an existing account; signout drops
// the token but keeps the local cache. There is no longer a "connect to cloud"
// step — the app is always cloud-mode; the user just needs an account.

function vxAuthTabSwitch(which) {
  const tabSignup = el('cloud-mode-signup');
  const tabSignin = el('cloud-mode-signin');
  const formSignup = el('cloud-form-signup');
  const formSignin = el('cloud-form-signin');
  if(!tabSignup || !tabSignin || !formSignup || !formSignin) return;
  const showSignup = which === 'signup';
  tabSignup.classList.toggle('active', showSignup);
  tabSignin.classList.toggle('active', !showSignup);
  formSignup.style.display = showSignup ? '' : 'none';
  formSignin.style.display = showSignup ? 'none' : '';
  // Focus the first field of the visible form
  requestAnimationFrame(() => {
    (showSignup ? el('signup-name') : el('signin-email'))?.focus();
  });
}

// V44 — First-cloud-login migration.
// When a user signs up (or signs in for the first time on a device that's
// been holding trial-mode data), batch-upload everything in localStorage
// that's marked dirty to the freshly-created org. Returns the number of
// records actually delivered. Toasts the count so the user can see their
// pre-signup work was preserved.
async function _vxMigrateTrialDataToCloud() {
  if(!vxIsAuthenticated()) return { migrated: 0, skipped: 'not authenticated' };
  if(!vxSupabaseConfigured()) return { migrated: 0, skipped: 'supabase not configured' };
  var dirty = vxStore.dirtyKeys();
  if(!dirty.length) return { migrated: 0 };
  var migrated = 0, failed = 0;
  for(var i = 0; i < dirty.length; i++){
    var key = dirty[i];
    if(!VX_ENTITY_KEYS.has(key)) continue;
    // Read the local value (parsed) and upsert it under the new org.
    var value = ls(key, null);
    if(value == null) continue;
    var r = await vxApi.upsertEntity(key, value);
    if(r.ok){ _vxClearDirty(key); migrated++; }
    else { failed++; }
  }
  if(migrated > 0 && typeof toast === 'function'){
    toast(tf('toast.synced_n_records', 'Synced {n} record{plural} to the cloud',
            { n: migrated, plural: migrated !== 1 ? 's' : '' }), 'success');
  }
  if(failed > 0 && typeof toast === 'function'){
    toast(tf('toast.synced_n_failed', '{n} record{plural} couldn’t sync — will retry automatically',
            { n: failed, plural: failed !== 1 ? 's' : '' }), 'warn');
  }
  return { migrated: migrated, failed: failed };
}

async function vxDoSignup() {
  const name     = el('signup-name')?.value.trim() || '';
  const company  = el('signup-company')?.value.trim() || '';
  const email    = el('signup-email')?.value.trim() || '';
  const password = el('signup-password')?.value || '';
  if(!name || !company || !email || !password) { toast(t('msg.fill_all','Please fill in all fields.'), 'error'); return; }
  if(password.length < 8) { toast(t('validation.password_short','Password must be at least 8 characters.'), 'error'); return; }
  toast(t('msg.creating','Creating your account…'), 'info');
  const r = await vxApi.register({ name, company, email, password });
  if(!r.ok) {
    toast(tf('msg.create_failed',"Couldn't create account: {reason}",{reason:r.error||'unknown error'}), 'error');
    return;
  }
  // Supabase email-confirm-on path: signup returned 202, no session yet.
  if(r.data?.needsEmailConfirmation){
    toast(t('toast.signup_check_email','Account created. Check your inbox to confirm your email and finish setup.'), 'success');
    if(typeof renderTrialBanner === 'function') renderTrialBanner();
    vxRenderSubscription();
    return;
  }
  // Successful signup — auto-login. Some backends return a token immediately;
  // if not, perform a follow-up login.
  if(r.data?.accessToken) {
    // role is intentionally NOT set here — _vxApplySupabaseSession (called
    // inside vxApi.register) already stashed the server-trusted role from
    // org_members. Stomping it with a hardcoded 'admin' breaks invited
    // members (who join as inspector/senior/observer via pending_invites).
    vxPlatformSet({
      accessToken: r.data.accessToken,
      refreshToken: r.data.refreshToken || null,
      tokenExpiry:  r.data.expiresAt   || null,
      userId:       r.data.user?.id    || null,
      orgId:        r.data.org?.id     || null,
      // V14: server returns email_verified; default to false on signup so the
      // banner appears until they click the link from the welcome email.
      emailVerified: !!r.data.user?.email_verified,
      emailVerifiedAt: r.data.user?.email_verified_at || null,
    });
  } else {
    const li = await vxApi.login(email, password);
    if(!li.ok) { toast(t('msg.account_created_login_failed','Account created but auto-login failed. Please sign in.'), 'warn'); return; }
  }
  if(r.data?.plan) vxPlanSet(r.data.plan);
  toast(t('toast.signup_ok','Welcome to Veritix! Check your email to verify your address.'), 'success');
  // V44: First-cloud-login migration — push trial-mode dirty entities to
  // the newly-provisioned org. Toasts "Synced N records to the cloud" so
  // the user can see their preview work carried over.
  try { await _vxMigrateTrialDataToCloud(); } catch(e){ console.warn('trial-migration', e); }
  // Then run any remaining sync-queue ops (typically empty after the
  // migration drains the dirty list).
  try { await vxSyncFlush(); } catch(e){}
  updateDeployModePill();
  if(typeof renderTrialBanner === 'function') renderTrialBanner();
  vxRenderSubscription();
}

async function vxDoSignin() {
  const email    = el('signin-email')?.value.trim() || '';
  const password = el('signin-password')?.value || '';
  if(!email || !password) { toast(t('msg.fill_all','Enter email and password.'), 'error'); return; }
  toast(t('msg.signing_in','Signing in…'), 'info');
  const r = await vxApi.login(email, password);
  if(!r.ok) {
    toast(tf('msg.signin_failed','Sign-in failed: {reason}',{reason:r.error||'check email and password'}), 'error');
    return;
  }
  if(r.data?.plan) vxPlanSet(r.data.plan);
  toast(t('toast.signed_in','Signed in to Veritix Cloud.'), 'success');
  await vxStore.pullAll();
  try { await vxSyncFlush(); } catch(e){}
  updateDeployModePill();
  vxRenderSubscription();
}

async function vxSignOut() {
  if(!await vxConfirm({ message: t('confirm.signout','Are you sure you want to sign out of Veritix? Your data on this device will stay cached locally and sync will resume when you sign back in.'), okLabel: t('vxc.sign_out','Sign out') })) return;
  await vxApi.logout();
  // Keep userId around so we know they had an account (signed_out state vs trial)
  // Token gone; auth state becomes signed_out
  updateDeployModePill();
  vxRenderSubscription();
  if(typeof renderTrialBanner === 'function') renderTrialBanner();
  toast(t('toast.signed_out_short','Signed out.'), 'success');
}

function vxOpenBilling() {
  // Opens the Veritix billing portal (Stripe-backed) in a new tab.
  const cfg = vxPlatformConfig();
  if(cfg.apiBase) {
    window.open(cfg.apiBase.replace(/\/v\d+\/?$/, '') + '/billing', '_blank', 'noopener');
  } else {
    toast(t('toast.billing_unconfigured','Billing portal not configured. Contact support.'), 'warn');
  }
}

async function vxRefreshPlan() {
  if(!vxIsAuthenticated()) return;
  const r = await vxApi.request('/account/plan');
  if(r.ok && r.data) {
    vxPlanSet(r.data);
    vxRenderSubscription();
    toast(t('toast.plan_refreshed','Plan refreshed.'), 'success');
  } else {
    toast('Couldn\'t refresh plan: ' + (r.error || 'unknown'), 'error');
  }
}

async function vxOpenForgotPassword() {
  const email = await vxPrompt({
    title: t('auth.forgot.title', 'Reset password'),
    message: t('auth.forgot.prompt', 'Enter your account email — we\'ll send a password reset link:'),
    inputType: 'email',
    placeholder: 'you@example.com',
    okLabel: t('auth.forgot.send', 'Send link'),
  });
  if(!email || !email.trim()) return;
  const sb = _vxSupabase();
  if(!sb){ toast('Supabase not configured — cannot send a reset link.', 'error'); return; }
  try {
    // Supabase emails a recovery link back to redirectTo. When the user
    // clicks it they return here with a recovery token in the URL hash;
    // the onAuthStateChange listener (registered in _vxSupabase) catches
    // the PASSWORD_RECOVERY event and prompts for the new password.
    // NOTE: this redirect URL must be listed under Supabase → Auth →
    // URL Configuration → Redirect URLs, or the link falls back to the
    // project's Site URL.
    const r = await sb.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: location.origin + location.pathname,
    });
    if(r.error) toast("Couldn't send reset link: " + r.error.message, 'error');
    else toast(t('toast.reset_link_sent','Reset link sent. Check your inbox (and spam folder).'), 'success');
  } catch(e){
    toast("Couldn't send reset link: " + String(e.message || e), 'error');
  }
}

// Prompt for and apply a new password. Fired by the PASSWORD_RECOVERY
// auth event after the user clicks the emailed recovery link — at that
// point Supabase has placed a short-lived recovery session, so
// updateUser({password}) is authorised.
async function vxPromptNewPassword() {
  const pwd = await vxPrompt({
    title: t('auth.newpw.title', 'Set a new password'),
    message: t('auth.newpw.prompt', 'Enter a new password for your account (at least 8 characters):'),
    inputType: 'password',
    placeholder: '••••••••',
    okLabel: t('auth.newpw.save', 'Update password'),
  });
  if(!pwd) return;
  if(pwd.length < 8){ toast('Password must be at least 8 characters.', 'error'); return; }
  const sb = _vxSupabase();
  if(!sb){ toast('Supabase not configured.', 'error'); return; }
  try {
    const r = await sb.auth.updateUser({ password: pwd });
    if(r.error){ toast("Couldn't update password: " + r.error.message, 'error'); return; }
    toast('Password updated — you are now signed in.', 'success');
    // Strip the recovery token from the URL so a refresh doesn't re-fire.
    try { history.replaceState(null, '', location.origin + location.pathname); } catch(e){}
    updateDeployModePill();
    if(typeof vxRenderSubscription === 'function') vxRenderSubscription();
  } catch(e){
    toast("Couldn't update password: " + String(e.message || e), 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// V14 PHOTO STORE — IndexedDB-backed blob storage for defect/report photos
// ══════════════════════════════════════════════════════════════════════════
// Why: localStorage caps at ~5–10 MB total per origin. Storing photos as
// base64 strings inside defect records hits this limit fast (a 2 MB JPEG
// becomes a 2.7 MB string AND has to be JSON.stringify'd into the record).
// IndexedDB gives us gigabytes of room and stores Blobs natively.
//
// Architecture:
//   - Photos are addressed by a `photoId` (random string)
//   - The defect/report record stores { photoId, name, exifDateTime, hasGps, annotations }
//     — NOT the data itself
//   - vxPhotos.put(id, blob) stores; vxPhotos.get(id) retrieves
//   - On render, we generate a URL.createObjectURL() and revoke it later
//   - On sync to cloud, the photo binary uploads to /uploads first; the
//     returned remote URL replaces photoId in the record before the record
//     itself syncs
//
// Backwards compatibility: existing base64 photos (defect.photos[i].data)
// continue to work. vxPhotos.migrate() can move them into IDB on demand.

// ══════════════════════════════════════════════════════════════════════════
// Why: localStorage caps at ~5–10 MB per origin. For a real customer with
// hundreds of reports + an accumulating audit trail, this fills up — and the
// failure mode (QuotaExceededError) currently surfaces as a silent dropped
// write inside lss().
//
// Architecture: write-through cache.
//   - IndexedDB is the canonical store for entity keys (VX_ENTITY_KEYS).
//   - localStorage continues to serve sync reads; ls() / lss() API unchanged.
//   - On write: localStorage updated synchronously + async IDB write queued.
//   - On boot: hydrate localStorage from IDB before any code calls ls().
//   - On QuotaExceededError: drop the localStorage write, keep the IDB write,
//     and mark the key as "IDB-only". Reads for that key fall back to a small
//     in-memory cache populated lazily.
//
// IDB writes are coalesced via a 50ms debounce per-key — rapid sequential
// writes to the same key (e.g. autosaving a report form) result in one IDB
// transaction, not many.

var VX_ENTITY_DB    = 'vx-entity-v1';
var VX_ENTITY_STORE = 'entities';
var _vxEntityDbPromise = null;

function _vxEntityOpenDb() {
  if(_vxEntityDbPromise) return _vxEntityDbPromise;
  _vxEntityDbPromise = new Promise((resolve, reject) => {
    if(!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(VX_ENTITY_DB, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(VX_ENTITY_STORE)) {
        db.createObjectStore(VX_ENTITY_STORE);   // explicit keys (the entity key string)
      }
    };
  });
  return _vxEntityDbPromise;
}

// In-memory fallback for keys that overflowed localStorage. Populated lazily
// from IDB and updated on every write. Reads first try localStorage, then
// this cache.
var _vxEntityMemoryCache = new Map();
var _vxEntityIdbOnly     = new Set();   // keys that exceed localStorage quota

// Debounced IDB write per key — coalesces rapid edits to the same entity
var _vxEntityWriteTimers = new Map();
function _vxEntityScheduleWrite(key, value) {
  // Cancel any in-flight timer for this key
  const existing = _vxEntityWriteTimers.get(key);
  if(existing) clearTimeout(existing);
  const timer = setTimeout(async () => {
    _vxEntityWriteTimers.delete(key);
    try {
      const db = await _vxEntityOpenDb();
      const tx = db.transaction(VX_ENTITY_STORE, 'readwrite');
      tx.objectStore(VX_ENTITY_STORE).put(value, key);
      // Don't await tx.oncomplete — fire-and-forget. The next read from IDB
      // (next boot or lazy fetch) will pick up the latest.
    } catch(e) {
      // IDB unavailable (private mode in some browsers) — localStorage is
      // still the working store; just log
      console.warn('vx: IDB write failed for', key, e);
    }
  }, 50);
  _vxEntityWriteTimers.set(key, timer);
}

var vxEntityStore = {
  /** Synchronously read a key from localStorage or the in-memory fallback. */
  read(key) {
    // Hot path: localStorage
    try {
      const v = localStorage.getItem(key);
      if(v != null) return v;
    } catch(e){}
    // Fallback: in-memory cache (populated lazily from IDB on demand)
    if(_vxEntityMemoryCache.has(key)) {
      const v = _vxEntityMemoryCache.get(key);
      return typeof v === 'string' ? v : JSON.stringify(v);
    }
    return null;
  },

  /** Write a key. Returns true if localStorage accepted, false if it spilled to IDB-only. */
  write(key, valueString) {
    let acceptedByLs = true;
    try {
      localStorage.setItem(key, valueString);
    } catch(e) {
      // Likely QuotaExceededError. Drop the localStorage write and rely on IDB.
      acceptedByLs = false;
      _vxEntityIdbOnly.add(key);
      try { localStorage.removeItem(key); } catch(e2){}
      // Stash in memory cache so subsequent sync reads in this session still work
      try { _vxEntityMemoryCache.set(key, JSON.parse(valueString)); }
      catch { _vxEntityMemoryCache.set(key, valueString); }
      if(_vxEntityIdbOnly.size === 1) {
        console.warn('vx: localStorage quota exceeded — entity data is now IDB-canonical for', key);
      }
    }
    // Always schedule the IDB write — IDB is the canonical store
    if(VX_ENTITY_KEYS.has(key)) {
      try { _vxEntityScheduleWrite(key, valueString ? JSON.parse(valueString) : null); }
      catch { _vxEntityScheduleWrite(key, valueString); }
    }
    return acceptedByLs;
  },

  /** Async: read all entity keys from IDB and hydrate localStorage. Called once at boot. */
  async hydrate() {
    if(!window.indexedDB) return { hydrated: 0, skipped: true };
    let hydrated = 0, conflicts = 0;
    try {
      const db = await _vxEntityOpenDb();
      for(const key of VX_ENTITY_KEYS) {
        const idbValue = await new Promise((resolve, reject) => {
          const tx = db.transaction(VX_ENTITY_STORE, 'readonly');
          const req = tx.objectStore(VX_ENTITY_STORE).get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror   = () => reject(req.error);
        });
        if(idbValue == null) {
          // IDB has no entry — keep whatever's in localStorage (if anything).
          // If localStorage has data, this is a first-run-after-upgrade case:
          // mirror that data into IDB so we have a canonical record going forward.
          let lsValue = null;
          try { lsValue = localStorage.getItem(key); } catch(e){}
          if(lsValue != null) {
            try {
              const parsed = JSON.parse(lsValue);
              _vxEntityScheduleWrite(key, parsed);
            } catch(e){}
          }
          continue;
        }
        // IDB has a value — but it is NOT unconditionally newer than
        // localStorage. Every lss() writes localStorage synchronously while
        // the IDB write is debounced (50ms) and fire-and-forget, so on this
        // device localStorage is never STALER than IDB. A refresh shortly
        // after an edit can interrupt the pending IDB write, leaving IDB
        // behind. Blindly mirroring IDB → localStorage here would then
        // silently roll the edit back — e.g. PDF-editor blocks jumping to
        // their old positions on reload. So keep localStorage when it
        // already holds a value, and re-schedule an IDB write so the
        // canonical store catches up. Only pull IDB → localStorage when
        // localStorage has nothing: the genuine recovery case (localStorage
        // cleared or lost, IDB survived). Cloud-sync pulls go through
        // _vxRawLss, which writes localStorage too, so this never hides a
        // remote update.
        let lsExisting = null;
        try { lsExisting = localStorage.getItem(key); } catch(e){}
        if(lsExisting != null) {
          try { _vxEntityScheduleWrite(key, JSON.parse(lsExisting)); } catch(e){}
          hydrated++;
          continue;
        }
        try {
          const serialized = typeof idbValue === 'string' ? idbValue : JSON.stringify(idbValue);
          localStorage.setItem(key, serialized);
        } catch(e) {
          _vxEntityIdbOnly.add(key);
          _vxEntityMemoryCache.set(key, idbValue);
        }
        hydrated++;
      }
    } catch(e) {
      console.warn('vx: entity hydrate failed', e);
      return { hydrated, error: String(e.message || e) };
    }
    return { hydrated, conflicts };
  },

  /** Approximate storage usage for diagnostics. */
  async stats() {
    let lsBytes = 0, lsKeys = 0;
    try {
      for(const k of VX_ENTITY_KEYS) {
        const v = localStorage.getItem(k);
        if(v != null) { lsBytes += v.length + k.length; lsKeys++; }
      }
    } catch(e){}
    const estimate = (navigator.storage && navigator.storage.estimate)
      ? await navigator.storage.estimate().catch(() => null)
      : null;
    return {
      localStorage: { bytes: lsBytes, keys: lsKeys },
      idbOnlyKeys:  Array.from(_vxEntityIdbOnly),
      memoryCacheKeys: _vxEntityMemoryCache.size,
      browserEstimate: estimate ? { usage: estimate.usage, quota: estimate.quota } : null,
    };
  },
};

var VX_PHOTO_DB = 'vx-photo-v1';
var VX_PHOTO_STORE = 'photos';
var _vxPhotoDbPromise = null;

function _vxPhotoOpenDb() {
  if(_vxPhotoDbPromise) return _vxPhotoDbPromise;
  _vxPhotoDbPromise = new Promise((resolve, reject) => {
    if(!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(VX_PHOTO_DB, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(VX_PHOTO_STORE)) {
        db.createObjectStore(VX_PHOTO_STORE);   // keyPath = none, explicit keys
      }
    };
  });
  return _vxPhotoDbPromise;
}

var vxPhotos = {
  /** Generate a new photo ID */
  newId() { return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9); },

  /** Store a Blob (or base64 data URL) under the given ID */
  async put(id, dataOrBlob) {
    const db = await _vxPhotoOpenDb();
    let blob = dataOrBlob;
    if(typeof dataOrBlob === 'string') {
      // Convert data URL → Blob
      const m = dataOrBlob.match(/^data:([^;]+);base64,(.+)$/);
      if(!m) throw new Error('Unsupported data URL format');
      const bin = atob(m[2]);
      const arr = new Uint8Array(bin.length);
      for(let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      blob = new Blob([arr], { type: m[1] });
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VX_PHOTO_STORE, 'readwrite');
      tx.objectStore(VX_PHOTO_STORE).put(blob, id);
      tx.oncomplete = () => resolve({ id, size: blob.size, type: blob.type });
      tx.onerror = () => reject(tx.error);
    });
  },

  /** Retrieve a Blob by ID. Returns null if not found. */
  async get(id) {
    const db = await _vxPhotoOpenDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VX_PHOTO_STORE, 'readonly');
      const req = tx.objectStore(VX_PHOTO_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  /** Get an object URL for a photo. Caller is responsible for revokeObjectURL. */
  async getObjectURL(id) {
    const blob = await this.get(id);
    return blob ? URL.createObjectURL(blob) : null;
  },

  /** Delete a photo by ID */
  async delete(id) {
    const db = await _vxPhotoOpenDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VX_PHOTO_STORE, 'readwrite');
      tx.objectStore(VX_PHOTO_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /** Count photos for diagnostics */
  async count() {
    const db = await _vxPhotoOpenDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VX_PHOTO_STORE, 'readonly');
      const req = tx.objectStore(VX_PHOTO_STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  /** Approximate total bytes used (heuristic — IDB doesn't expose this directly).
   *  Uses navigator.storage.estimate() where available. */
  async storageEstimate() {
    if(navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      return { quota: e.quota, usage: e.usage };
    }
    return null;
  },

  /** Migrate a legacy base64 photo (defect.photos[i].data) into IDB.
   *  Returns the new photoId. Caller should clear .data after. */
  async migrateFromBase64(dataUrl) {
    const id = this.newId();
    await this.put(id, dataUrl);
    return id;
  },

  /**
   * V44: Upload a File/Blob (or base64 data URL) to Supabase Storage and
   * record metadata in the `photos` table.
   * @param {Blob|File|string} file  the bytes to upload
   * @param {Object} [meta]
   * @param {string} [meta.name]          original filename
   * @param {string} [meta.contentType]   MIME type override
   * @param {string} [meta.reportNo]      parent report number (for query)
   * @param {string} [meta.defectId]      parent defect id (for query)
   * @param {string} [meta.exifDateTime]  EXIF DateTimeOriginal if known
   * @param {Object} [meta.exif]          full EXIF block to store as jsonb
   * @returns {Promise<{ok: boolean, storagePath?: string, photoId?: string, error?: string, fallback?: 'idb'}>}
   *   - ok=true with storagePath when the Supabase upload succeeds.
   *   - ok=true with photoId (and fallback='idb') when we couldn't upload
   *     but cached the bytes in IndexedDB (offline / not signed in).
   *   - ok=false on hard failure.
   */
  async upload(file, meta) {
    meta = meta || {};
    // Normalise to a Blob with a known content-type
    var blob = file;
    var ext = 'jpg';
    if(typeof file === 'string'){
      var m = file.match(/^data:([^;]+);base64,(.+)$/);
      if(!m) return { ok: false, error: 'Unsupported data URL format' };
      var bin = atob(m[2]);
      var arr = new Uint8Array(bin.length);
      for(var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      blob = new Blob([arr], { type: m[1] });
    }
    var contentType = meta.contentType || (blob && blob.type) || 'image/jpeg';
    ext = (contentType.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'jpg';
    // If we can't (or shouldn't) reach Supabase, cache locally and report
    var sb = _vxSupabase();
    var cfg = vxPlatformConfig();
    if(!sb || !vxIsAuthenticated() || !cfg.orgId){
      var idLocal = this.newId();
      await this.put(idLocal, blob);
      return { ok: true, photoId: idLocal, fallback: 'idb' };
    }
    // Storage path: <org_id>/<uuid>.<ext>. The org_id prefix is what the
    // Storage RLS policies key off (_storage_org_id in 0001_init.sql).
    var photoUuid = (window.crypto && window.crypto.randomUUID)
      ? window.crypto.randomUUID()
      : ('p-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
    var storagePath = cfg.orgId + '/' + photoUuid + '.' + ext;
    try {
      var up = await sb.storage.from('photos').upload(storagePath, blob, {
        contentType: contentType,
        upsert: false,
      });
      if(up.error){
        // Upload failed (network, quota, etc) — cache locally so the user's
        // work isn't lost and the sync queue can retry on its own schedule.
        console.warn('vx: photo upload failed, caching locally', up.error);
        var idFb = this.newId();
        await this.put(idFb, blob);
        return { ok: true, photoId: idFb, fallback: 'idb', error: up.error.message };
      }
      // Insert metadata row. Failure here doesn't lose the bytes (they're
      // already in Storage) but the row WILL be orphaned — log loudly.
      try {
        await sb.from('photos').insert({
          id: photoUuid,
          org_id: cfg.orgId,
          storage_path: storagePath,
          content_type: contentType,
          size_bytes: blob.size || null,
          report_no:  meta.reportNo || null,
          defect_id:  meta.defectId || null,
          exif: meta.exif || (meta.exifDateTime ? { dateTime: meta.exifDateTime } : null),
        });
      } catch(metaErr){
        console.warn('vx: photo metadata insert failed (bytes already uploaded)', metaErr);
      }
      return { ok: true, storagePath: storagePath, photoId: photoUuid };
    } catch(e){
      // Network blew up mid-upload — cache locally
      var idFb2 = this.newId();
      await this.put(idFb2, blob);
      return { ok: true, photoId: idFb2, fallback: 'idb', error: String(e.message || e) };
    }
  },

  /**
   * V44: Get a temporary signed URL for displaying a Storage-hosted photo
   * in the UI. Default TTL is 1 hour. The `photos` bucket is private so
   * direct URLs won't load — every render needs a fresh signed URL.
   * @param {string} storagePath
   * @param {number} [ttlSeconds=3600]
   */
  async getSignedUrl(storagePath, ttlSeconds){
    var sb = _vxSupabase();
    if(!sb) return null;
    try {
      var r = await sb.storage.from('photos').createSignedUrl(storagePath, ttlSeconds || 3600);
      if(r.error) return null;
      return r.data ? r.data.signedUrl : null;
    } catch(e){ return null; }
  },
};

// ── Photo upload pipeline ────────────────────────────────────────────────
// V44: This is a thin wrapper around vxPhotos.upload() — kept so any older
// callers using `vxUploadPhoto(blob, {name, exifDateTime})` continue to
// work. Return shape preserved:
//   { photoId: <local IDB id> | null, remoteUrl: <signed URL> | null }
// New callers should prefer vxPhotos.upload() directly.
async function vxUploadPhoto(blobOrDataUrl, opts = {}) {
  var result = await vxPhotos.upload(blobOrDataUrl, {
    name:         opts.name,
    contentType:  opts.contentType,
    reportNo:     opts.reportNo,
    defectId:     opts.defectId,
    exifDateTime: opts.exifDateTime,
    exif:         opts.exif,
  });
  if(result.fallback === 'idb' || !result.storagePath){
    return { photoId: result.photoId || null, remoteUrl: null };
  }
  // Successful cloud upload — get a display URL for the caller.
  var signed = await vxPhotos.getSignedUrl(result.storagePath);
  return { photoId: result.photoId || null, remoteUrl: signed, storagePath: result.storagePath };
}

// ══════════════════════════════════════════════════════════════════════════
// V14 REALTIME — WebSocket transport for live cross-device updates
// ══════════════════════════════════════════════════════════════════════════
// Server contract: a WebSocket endpoint at /ws (auth via Sec-WebSocket-Protocol
// header containing the JWT, since browsers don't allow custom headers on WS
// upgrades). Server pushes JSON frames of shape:
//   { type: 'entity.changed', key: 'vx-reports-v1', actor: 'u_abc', ts: '...' }
//   { type: 'presence',       userId: '...', orgId: '...', status: 'online' }
//   { type: 'pong' }
//
// On entity.changed, the client either re-pulls (if the change isn't ours) or
// ignores (if actor === own userId). The reactive renderers pick up the new
// data on next render naturally.

// V44: realtime uses Supabase channels (postgres_changes). The previous
// hand-rolled WebSocket + ping loop is gone, but we keep the same module-
// level variables (_vxWs, _vxWsReconnectAttempt, etc.) so anything that
// peeked at them (e.g. vxDiagnostics) keeps working. _vxWs now holds a
// RealtimeChannel reference rather than a WebSocket — its .state property
// is used for diagnostic readState mapping.
var _vxWs = null;                       // RealtimeChannel | null
var _vxWsReconnectTimer = null;         // unused under Supabase (SDK handles reconnect) — kept for back-compat
var _vxWsReconnectAttempt = 0;
var _vxWsPingTimer = null;              // unused under Supabase — SDK has its own heartbeat
var VX_WS_PING_INTERVAL_MS = 30 * 1000;

// Re-dispatch helper: fired on every remote entity-changed event so the
// rest of the app can listen for 'vx:entity-change' without knowing or
// caring whether the transport is raw WebSocket or Supabase channels.
function _vxDispatchEntityChange(key, actor){
  try { window.dispatchEvent(new CustomEvent('vx:entity-change', { detail: { key: key, actor: actor } })); } catch(e){}
  // Back-compat: previous code listened to 'vx:remote-change' too.
  try { window.dispatchEvent(new CustomEvent('vx:remote-change',  { detail: { key: key, actor: actor } })); } catch(e){}
}

function vxRealtimeConnect() {
  if(!vxIsAuthenticated()) return;
  var sb = _vxSupabase();
  if(!sb) return;
  var cfg = vxPlatformConfig();
  if(!cfg.orgId) return;
  // Always tear down before reconnecting (V44.4). Reasons:
  //   1. An early boot subscribe may have joined the channel with the anon
  //      token before _vxApplySupabaseSession pushed the JWT into sb.realtime.
  //      Such channels report state='joined' but never receive any RLS-gated
  //      row events — the only fix is rebuild from scratch with the JWT in
  //      hand.
  //   2. Idempotent reconnect lets TOKEN_REFRESHED handlers re-bind cleanly
  //      without worrying about stale-channel state.
  if(_vxWs) {
    try {
      if(typeof sb.removeChannel === 'function') sb.removeChannel(_vxWs);
      else if(typeof _vxWs.unsubscribe === 'function') _vxWs.unsubscribe();
    } catch(e){}
    _vxWs = null;
  }

  // Per-session channel name suffix (V44.5). The naïve 'org:<orgId>' name
  // could be re-used across reconnects in a single tab; once it had been
  // joined with anon auth the broker silently rejected all RLS-gated row
  // events for that channel name even after setAuth pushed the real JWT.
  // Fresh names with a timestamp suffix sidestep the broker's per-name
  // auth context caching — verified empirically: identical bindings on a
  // fresh name deliver events; on the reused name they don't.
  var channelName = 'org:' + cfg.orgId + ':' + Date.now();
  try {
    _vxWs = sb.channel(channelName)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'entities', filter: 'org_id=eq.' + cfg.orgId },
        function(payload){
          // payload.new / payload.old / payload.eventType — we want the key
          // of the row that changed, plus the actor (updated_by) so we can
          // skip our own writes (which would cause a render loop).
          var row = payload.new || payload.old || {};
          var key = row.key;
          var actor = row.updated_by;
          if(!key) return;
          var cfgNow = vxPlatformConfig();
          if(actor && actor === cfgNow.userId) return;  // our own write — ignore
          // Re-pull this single key so the local cache catches up
          vxStore.pull(key).then(function(){
            _vxDispatchEntityChange(key, actor);
            if(typeof toast === 'function'){
              var labels = {
                'vx-reports-v1':    'Reports updated by a teammate',
                'vx-defects-v1':    'Defects updated by a teammate',
                'vx-inspectors-v1': 'Inspectors updated',
                'vx-company-v1':    'Company profile updated',
                'vx-settings-v1':   'Settings updated',
              };
              if(labels[key]) toast(labels[key] + '.', 'info');
            }
            // Re-render the active page so the user sees the new data
            var active = document.querySelector('.page.active');
            if(active && active.id){
              var pageId = active.id.replace('page-', '');
              if(pageId === 'reports'  && typeof rptRender         === 'function') rptRender();
              else if(pageId === 'defects'  && typeof defRender         === 'function') defRender();
              else if(pageId === 'overview' && typeof ovRefreshDashboard === 'function') ovRefreshDashboard();
              else if(pageId === 'inbox'    && typeof inboxRender       === 'function') inboxRender();
            }
          }).catch(function(){});
        })
      .subscribe(function(status){
        // status: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'
        if(status === 'SUBSCRIBED'){
          _vxWsReconnectAttempt = 0;
          console.log('vx: realtime subscribed (' + channelName + ')');
          try { window.dispatchEvent(new CustomEvent('vx:realtime-status', { detail: { status: 'connected' } })); } catch(e){}
        } else if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'){
          try { window.dispatchEvent(new CustomEvent('vx:realtime-status', { detail: { status: 'disconnected' } })); } catch(e){}
          // The Supabase SDK auto-reconnects internally; no manual schedule.
        }
      });
  } catch(e){
    console.warn('vx: realtime connect failed', e);
    _vxWs = null;
  }
}

function _vxRealtimeScheduleReconnect() {
  // Supabase SDK handles reconnect on its own — this stub is kept only so
  // nothing breaks if external code calls it.
}

function vxRealtimeDisconnect() {
  if(_vxWs){
    try {
      var sb = _vxSupabase();
      if(sb && typeof sb.removeChannel === 'function') sb.removeChannel(_vxWs);
      else if(typeof _vxWs.unsubscribe === 'function') _vxWs.unsubscribe();
    } catch(e){}
    _vxWs = null;
  }
}

// Connect on auth, disconnect on signout
window.addEventListener('vx:platform-change', () => {
  if(vxIsAuthenticated()) vxRealtimeConnect();
  else vxRealtimeDisconnect();
});
// V28: when the browser comes back online, reset the backoff counter so we
// reconnect promptly instead of waiting through a long backoff timer that
// started before the outage was diagnosed.
window.addEventListener('online', () => {
  if(vxIsAuthenticated()){
    _vxWsReconnectAttempt = 0;
    if(_vxWsReconnectTimer){ clearTimeout(_vxWsReconnectTimer); _vxWsReconnectTimer = null; }
    vxRealtimeConnect();
  }
});
// V28: when the browser detects going offline, surgically close so we don't
// leak a half-dead socket. Reconnect logic will fire automatically on online.
// V44: under Supabase channels the SDK handles its own offline detection,
// but we still proactively tear down our channel reference so we don't
// double-subscribe on online.
window.addEventListener('offline', () => vxRealtimeDisconnect());

// ── API client ────────────────────────────────────────────────────────────
// V44: Transport flipped to Supabase. Every public signature on vxApi is
// preserved exactly (login/register/logout/refreshToken/hydrate/request)
// so the ~14 call-sites elsewhere in the app keep working. Internally,
// auth + entity I/O routes through the Supabase SDK; `request()` stays
// as a no-op-friendly fallback for legacy paths like
//   /telemetry/error, /account/plan, /auth/resend-verification,
//   /auth/forgot-password
// — those endpoints don't exist in Phase 1 (Supabase doesn't have an
// equivalent surface), so request() returns a soft failure that the
// callers tolerate (they all already log and move on).
var vxApi = {
  /**
   * Legacy JSON request adapter. In Phase 1 (Supabase) the methods below
   * route directly through the SDK and this is only reached by callers we
   * haven't fully ported yet (telemetry, plan refresh, password reset).
   * Returns a soft-failure shape so those callers don't crash.
   * @returns {Promise<{ok: boolean, status: number, data: any, error?: string}>}
   */
  async request(path, opts = {}) {
    // Soft failure when Supabase is configured — these legacy endpoints
    // aren't part of Phase 1.
    if(vxSupabaseConfigured()){
      return { ok: false, status: 0, data: null, error: 'legacy endpoint not available in Supabase mode: ' + path };
    }
    // Pre-config mode: there is no backend yet. Return a soft failure
    // rather than firing a request that would hang.
    return { ok: false, status: 0, data: null, error: 'no backend configured' };
  },

  /** Refresh the auth session. Supabase auto-refreshes on a timer; we
   *  expose this for compatibility with the old contract. */
  async refreshToken() {
    var sb = _vxSupabase();
    if(!sb) return false;
    try {
      var r = await sb.auth.refreshSession();
      if(r.error || !r.data?.session) return false;
      await _vxApplySupabaseSession(r.data.session);
      return true;
    } catch(e){ return false; }
  },

  /**
   * Sign in with email + password.
   * @returns {Promise<{ok, status, data, error}>} — same shape as before.
   *   data.accessToken, data.refreshToken, data.user.id, data.org?.id, data.plan
   *   are populated so the existing UI code reading them keeps working.
   */
  async login(email, password) {
    var sb = _vxSupabase();
    if(!sb){
      return { ok: false, status: 0, data: null, error: 'Supabase not configured. Paste your project URL and anon key into the meta tags in veritix-ndt-inspect-v3_44.html.' };
    }
    // Retry transient network failures only. The user's link to
    // Supabase has been intermittent — a single TypeError: Failed to
    // fetch shouldn't mean "wrong password". Three attempts with a
    // short backoff (0ms / 600ms / 1200ms) lets a good moment through.
    // A genuine auth error ("Invalid login credentials") is returned
    // immediately — retrying that would never change the outcome.
    var lastErr = 'network error';
    for(var attempt = 0; attempt < 3; attempt++){
      if(attempt > 0) await new Promise(function(res){ setTimeout(res, 600 * attempt); });
      try {
        var r = await sb.auth.signInWithPassword({ email: email, password: password });
        if(r.error){
          var msg = r.error.message || 'sign-in failed';
          // Network-ish error reported by the SDK — retry.
          if(/network|fetch|timeout|connection/i.test(msg)){ lastErr = msg; continue; }
          // Genuine auth failure (bad credentials, unconfirmed email) —
          // return now, no point retrying.
          return { ok: false, status: 401, data: null, error: msg };
        }
        var session = r.data.session;
        await _vxApplySupabaseSession(session);
        var cfg = vxPlatformConfig();
        return {
          ok: true,
          status: 200,
          data: {
            accessToken:  session?.access_token  || null,
            refreshToken: session?.refresh_token || null,
            expiresAt:    session?.expires_at ? session.expires_at * 1000 : null,
            user: {
              id:    session?.user?.id    || null,
              email: session?.user?.email || email,
              role:  null,
              email_verified: !!session?.user?.email_confirmed_at,
              email_verified_at: session?.user?.email_confirmed_at || null,
            },
            org: cfg.orgId ? { id: cfg.orgId } : null,
          },
          error: null,
        };
      } catch(e){
        // Thrown TypeError: Failed to fetch lands here — treat as
        // transient and let the loop retry.
        lastErr = String(e.message || e);
      }
    }
    return { ok: false, status: 0, data: null, error: lastErr + ' (retried 3×)' };
  },

  /**
   * Register a new account. Creates the auth.users row, then — if the
   * signup returns an immediate session (email-confirm OFF in Supabase
   * Auth settings) — provisions an `orgs` row and lets the SECURITY
   * DEFINER trigger add the user as admin. The vxDoSignup / doRegister
   * wrappers further upstream then migrate any trial-mode dirty entities
   * to the new org.
   * @param {{name, company, email, password}} payload
   */
  async register(payload) {
    var sb = _vxSupabase();
    if(!sb){
      return { ok: false, status: 0, data: null, error: 'Supabase not configured. Paste your project URL and anon key into the meta tags in veritix-ndt-inspect-v3_44.html.' };
    }
    try {
      var r = await sb.auth.signUp({
        email: payload.email,
        password: payload.password,
        options: {
          data: { name: payload.name || '', company: payload.company || '' },
        },
      });
      if(r.error){
        var status = (/exists|registered|taken/i.test(r.error.message || '')) ? 409 : 400;
        return { ok: false, status: status, data: null, error: r.error.message || 'sign-up failed' };
      }
      var session = r.data.session;
      // If email confirmation is required the session is null — surface
      // that explicitly so the UI can show "check your inbox" rather
      // than blindly trying to use a non-existent token.
      if(!session){
        return {
          ok: true,
          status: 202,
          data: {
            accessToken: null, refreshToken: null, expiresAt: null,
            user: { id: r.data.user?.id || null, email: payload.email, email_verified: false },
            org: null,
            needsEmailConfirmation: true,
          },
          error: null,
        };
      }
      // Session live → resolve org membership. _vxApplySupabaseSession does
      // both halves: if the user has an existing org_members row (e.g. they
      // just claimed a pending_invites entry via the auth.users trigger), it
      // uses that; otherwise it creates a fresh org and the orgs_add_creator_as_admin
      // trigger inserts the membership. Either way, cfg.orgId + cfg.role are
      // server-trusted after this awaits.
      await _vxApplySupabaseSession(session);
      var cfg = vxPlatformConfig();
      var newOrg = null;
      if(cfg.orgId){
        var orgFetch = await sb.from('orgs')
          .select('id, name, plan_tier, trial_ends_at')
          .eq('id', cfg.orgId)
          .maybeSingle();
        if(!orgFetch.error && orgFetch.data) newOrg = orgFetch.data;
      } else {
        // Fallback: reconciliation failed inside _vxApplySupabaseSession.
        // Try once more here so the signup doesn't return a half-provisioned
        // session. Logs the original error for diagnostics.
        var orgInsert = await sb.from('orgs')
          .insert({
            name: payload.company || (payload.name ? (payload.name + "'s team") : 'New team'),
            created_by: session.user.id,
            plan_tier: 'trial',
            trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          })
          .select('id, name, plan_tier, trial_ends_at')
          .single();
        if(!orgInsert.error && orgInsert.data){
          newOrg = orgInsert.data;
          vxPlatformSet({ orgId: newOrg.id, role: 'admin' });
        } else {
          console.warn('vx: org provisioning fallback failed', orgInsert.error);
        }
      }
      return {
        ok: true,
        status: 200,
        data: {
          accessToken:  session.access_token  || null,
          refreshToken: session.refresh_token || null,
          expiresAt:    session.expires_at ? session.expires_at * 1000 : null,
          user: {
            id:    session.user.id,
            email: session.user.email,
            role:  _vxRoleToDisplay(vxPlatformConfig().role) || 'Inspector',
            email_verified: !!session.user.email_confirmed_at,
            email_verified_at: session.user.email_confirmed_at || null,
          },
          org: newOrg ? { id: newOrg.id, name: newOrg.name, plan_tier: newOrg.plan_tier } : null,
        },
        error: null,
      };
    } catch(e){
      return { ok: false, status: 0, data: null, error: String(e.message || e) };
    }
  },

  async logout() {
    var sb = _vxSupabase();
    if(sb){
      try { await sb.auth.signOut(); } catch(e){}
    }
    // Drop tokens locally regardless of remote result. Keep userId so the
    // pill reads "signed_out" rather than "trial".
    vxPlatformSet({ accessToken: null, refreshToken: null, tokenExpiry: null });
  },

  /**
   * Fetch one entity's payload from Supabase.
   * @returns {Promise<any|null>} the entity value (matching what the
   *   previous REST contract returned via {value:…}.value). null on miss
   *   or if Supabase isn't configured / user not signed in.
   */
  async hydrate(key) {
    if(!vxIsAuthenticated()) return null;
    var sb = _vxSupabase();
    if(!sb) return null;
    var cfg = vxPlatformConfig();
    if(!cfg.orgId) return null;
    try {
      var r = await sb.from('entities')
        .select('value')
        .eq('org_id', cfg.orgId)
        .eq('key', key)
        .maybeSingle();
      if(r.error){ console.warn('vx: hydrate', key, r.error.message); return null; }
      return r.data ? r.data.value : null;
    } catch(e){ console.warn('vx: hydrate failed', key, e); return null; }
  },

  /**
   * V44: Upsert one entity. Called by the sync drain and by the
   * first-cloud-login migration. value is the already-parsed JS object
   * (NOT a string) — Postgres jsonb does the JSON encoding for us.
   * @returns {Promise<{ok, error?}>}
   */
  async upsertEntity(key, value){
    if(!vxIsAuthenticated()) return { ok: false, error: 'not signed in' };
    var sb = _vxSupabase();
    if(!sb) return { ok: false, error: 'Supabase not configured' };
    var cfg = vxPlatformConfig();
    if(!cfg.orgId) return { ok: false, error: 'no org' };
    try {
      var r = await sb.from('entities')
        .upsert(
          { org_id: cfg.orgId, key: key, value: value },
          { onConflict: 'org_id,key' }
        );
      if(r.error) return { ok: false, error: r.error.message };
      return { ok: true };
    } catch(e){ return { ok: false, error: String(e.message || e) }; }
  },

  /** V44: Delete one entity. */
  async deleteEntity(key){
    if(!vxIsAuthenticated()) return { ok: false, error: 'not signed in' };
    var sb = _vxSupabase();
    if(!sb) return { ok: false, error: 'Supabase not configured' };
    var cfg = vxPlatformConfig();
    if(!cfg.orgId) return { ok: false, error: 'no org' };
    try {
      var r = await sb.from('entities').delete().eq('org_id', cfg.orgId).eq('key', key);
      if(r.error) return { ok: false, error: r.error.message };
      return { ok: true };
    } catch(e){ return { ok: false, error: String(e.message || e) }; }
  },

  // Record a pending invite. The invitee receives no email — they sign
  // up at the app's URL with this email and the handle_pending_invites_on_signup
  // trigger (migration 0002) auto-joins them to the org with this role.
  async inviteMember(email, role){
    if(!vxIsAuthenticated()) return { ok: false, error: 'not signed in' };
    var sb = _vxSupabase();
    if(!sb) return { ok: false, error: 'Supabase not configured' };
    var cfg = vxPlatformConfig();
    if(!cfg.orgId) return { ok: false, error: 'no org' };
    if(cfg.role !== 'admin') return { ok: false, error: 'admin access required' };
    var normEmail = String(email || '').trim().toLowerCase();
    if(!normEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail)) {
      return { ok: false, error: 'invalid email address' };
    }
    var allowed = { admin:1, senior:1, inspector:1, observer:1 };
    var normRole = allowed[role] ? role : 'inspector';
    try {
      var r = await sb.from('pending_invites')
        .insert({
          org_id:     cfg.orgId,
          email:      normEmail,
          role:       normRole,
          invited_by: cfg.userId,
        });
      if(r.error){
        if(/duplicate key|unique/i.test(r.error.message || '')){
          return { ok: false, error: 'already invited' };
        }
        return { ok: false, error: r.error.message };
      }
      return { ok: true };
    } catch(e){ return { ok: false, error: String(e.message || e) }; }
  },

  // List pending invites for the current org (admin-only via RLS).
  async listPendingInvites(){
    if(!vxIsAuthenticated()) return { ok: false, error: 'not signed in', data: [] };
    var sb = _vxSupabase();
    if(!sb) return { ok: false, error: 'Supabase not configured', data: [] };
    var cfg = vxPlatformConfig();
    if(!cfg.orgId) return { ok: false, error: 'no org', data: [] };
    try {
      var r = await sb.from('pending_invites')
        .select('id, email, role, invited_by, created_at')
        .eq('org_id', cfg.orgId)
        .order('created_at', { ascending: false });
      if(r.error) return { ok: false, error: r.error.message, data: [] };
      return { ok: true, data: r.data || [] };
    } catch(e){ return { ok: false, error: String(e.message || e), data: [] }; }
  },

  // Revoke a pending invite by id.
  async revokeInvite(inviteId){
    if(!vxIsAuthenticated()) return { ok: false, error: 'not signed in' };
    var sb = _vxSupabase();
    if(!sb) return { ok: false, error: 'Supabase not configured' };
    try {
      var r = await sb.from('pending_invites').delete().eq('id', inviteId);
      if(r.error) return { ok: false, error: r.error.message };
      return { ok: true };
    } catch(e){ return { ok: false, error: String(e.message || e) }; }
  },
};

// ── Workspace (org-level identity) ────────────────────────────────────────
// Two thin helpers wrapping public.orgs.name. Kept separate from the
// company profile (KEYS.company entity) on purpose — workspace name is
// the live tenant label (topbar, member invites), while the company
// profile is snapshotted into each report at print time and must not
// change retroactively when the workspace is renamed.

/** Fetch the current workspace name from Supabase and write it into
 *  both the Settings input (#vx-org-name) and the topbar pill. Returns
 *  the name or null. Safe to call before sign-in — bails out quietly
 *  when there's no org and hides the topbar pill. */
async function vxLoadOrgName(){
  var sb = _vxSupabase();
  var cfg = vxPlatformConfig();
  if(!sb || !cfg.orgId){
    _vxUpdateOrgPill(null);
    return null;
  }
  try {
    var r = await sb.from('orgs').select('name').eq('id', cfg.orgId).maybeSingle();
    if(r.error){ console.warn('vx: loadOrgName', r.error.message); return null; }
    var name = r.data ? (r.data.name || '') : '';
    var inp = (typeof el === 'function') ? el('vx-org-name') : document.getElementById('vx-org-name');
    if(inp) inp.value = name;
    _vxUpdateOrgPill(name);
    return name || null;
  } catch(e){ console.warn('vx: loadOrgName failed', e); return null; }
}

/** Update the topbar workspace pill. Pass null/empty to hide it (trial
 *  mode, signed out, no org yet). */
function _vxUpdateOrgPill(name){
  var pill = document.getElementById('vx-org-pill');
  if(!pill) return;
  var label = document.getElementById('vx-org-pill-name');
  if(name && String(name).trim()){
    if(label) label.textContent = String(name).trim();
    pill.style.display = 'inline-flex';
  } else {
    if(label) label.textContent = '';
    pill.style.display = 'none';
  }
}

/** Click handler for the topbar workspace pill — navigates to the
 *  Company settings tab where the user can rename their workspace. */
function vxOpenWorkspaceSettings(){
  if(typeof showPage !== 'function') return;
  showPage('settings', document.getElementById('tn-settings'));
  // ss-company is the default active subsection on settings page load,
  // but if the user previously navigated to a different subsection,
  // force-show it again. requestAnimationFrame waits for the page
  // transition before scrolling/focusing the workspace input.
  requestAnimationFrame(function(){
    try {
      if(typeof showSS === 'function'){
        var nav = document.getElementById('sni-company');
        showSS('company', nav);
      }
      var inp = document.getElementById('vx-org-name');
      if(inp){
        inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(function(){ try { inp.focus(); inp.select(); } catch(e){} }, 250);
      }
    } catch(e){}
  });
}

/** Persist the workspace name from the #vx-org-name input back to
 *  public.orgs. Admin-gated client-side (RLS also enforces admin server-
 *  side). Notifies via toast on success/failure. */
async function vxSaveOrgName(){
  var sb = _vxSupabase();
  var cfg = vxPlatformConfig();
  if(!sb || !cfg.orgId){
    toast(t('toast.org_no_workspace', 'Sign in to manage your workspace.'), 'warn');
    return;
  }
  if(typeof vxRequireAdmin === 'function' && !vxRequireAdmin(t('rbac.action.rename_workspace', 'rename the workspace'))) return;
  var inp = (typeof el === 'function') ? el('vx-org-name') : document.getElementById('vx-org-name');
  if(!inp) return;
  var name = (inp.value || '').trim();
  if(!name){
    toast(t('toast.org_name_required', 'Workspace name cannot be empty.'), 'error');
    return;
  }
  if(name.length > 120){
    toast(t('toast.org_name_too_long', 'Workspace name must be 120 characters or fewer.'), 'error');
    return;
  }
  try {
    var r = await sb.from('orgs').update({ name: name }).eq('id', cfg.orgId);
    if(r.error){
      toast(t('toast.org_name_save_failed', 'Could not save workspace name: ') + (r.error.message || ''), 'error');
      return;
    }
    toast(t('toast.org_name_saved', 'Workspace renamed.'), 'success');
    // Update the topbar pill immediately, then dispatch for any other
    // listeners (cross-tab via storage event handled separately below).
    _vxUpdateOrgPill(name);
    try { window.dispatchEvent(new CustomEvent('vx:org-name-change', { detail: { name: name, orgId: cfg.orgId } })); } catch(e){}
  } catch(e){
    toast('Could not save workspace name: ' + (e.message || e), 'error');
  }
}

// Reactive: when another code path renames the workspace (or another tab
// does so and emits via realtime), update the topbar pill in place.
window.addEventListener('vx:org-name-change', function(e){
  try { _vxUpdateOrgPill(e && e.detail && e.detail.name); } catch(err){}
});
// Sign-out / sign-in should also hide / re-show the pill. vx:platform-change
// fires on every vxPlatformSet so we can react cheaply.
window.addEventListener('vx:platform-change', function(){
  try {
    var cfg = vxPlatformConfig();
    if(!cfg.orgId){
      _vxUpdateOrgPill(null);
    } else if(typeof vxLoadOrgName === 'function'){
      // orgId is set but the pill might be empty (e.g. just signed in);
      // refresh the name from the server.
      var pill = document.getElementById('vx-org-pill');
      var label = document.getElementById('vx-org-pill-name');
      if(pill && label && !label.textContent) vxLoadOrgName();
    }
  } catch(err){}
});

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
  if(VX_ENTITY_KEYS.has(k)) {
    _vxMarkDirty(k);
    if(vxIsAuthenticated()) vxSyncEnqueue({ kind: 'put', key: k, value: v });
  }
}

// Cloud-mode helpers exposed for views that want richer behavior
var vxStore = {
  get: ls,
  set: lss,
  /** Force a re-pull from server, replacing local state for this key */
  async pull(k) {
    if(!vxIsAuthenticated()) return null;
    const remote = await vxApi.hydrate(k);
    if(remote != null) { _vxRawLss(k, remote); _vxClearDirty(k); }
    return remote;
  },
  /** Pull every entity key on demand (e.g. after login or manual refresh) */
  async pullAll() {
    if(!vxIsAuthenticated()) return { skipped: true };
    let count = 0;
    for(const k of VX_ENTITY_KEYS) {
      const r = await vxApi.hydrate(k);
      if(r != null) { _vxRawLss(k, r); _vxClearDirty(k); count++; }
    }
    vxPlatformSet({ lastSyncAt: new Date().toISOString() });
    return { count };
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
        <button class="btn btn-sm" data-action="_wRemoveById" data-args="\'vx-paywall-modal\'" style="font-size:12px">Maybe later</button>
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
      showPage('reports', document.querySelectorAll('.tn')[2]);
      // Specific report deep-link: filter by report no.
      if(parts[1]) setTimeout(() => { const f = el('rpt-f-repno'); if(f) { f.value = parts[1]; if(typeof rptRender === 'function') rptRender(); } }, 100);
    } else if(parts[0] === 'defects') {
      showPage('defects', document.querySelectorAll('.tn')[3]);
    } else if(parts[0] === 'inbox') {
      showPage('inbox', document.querySelectorAll('.tn')[1]);
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
    // CACHE name is versioned; bump it whenever the caching strategy
    // changes so the activate handler can purge stale caches.
    const CACHE = 'veritix-shell-v2';
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

async function doLogin() {
  const email = el('li-email').value.trim().toLowerCase();
  const pwd   = el('li-pwd').value;
  const err   = el('li-err');
  err.classList.remove('show');
  if(!email||!pwd){ err.textContent=t('validation.required','Please fill in all fields.'); err.classList.add('show'); return; }

  // V13 cloud-first auth: try Veritix Cloud first, fall back to local for legacy users
  const btn = document.querySelector('#login-form .login-btn');
  const origLabel = btn?.textContent;
  if(btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
  try {
    const r = await vxApi.login(email, pwd);
    if(r.ok) {
      // Cloud sign-in succeeded — pull user info, hydrate local state, boot
      if(r.data?.plan) vxPlanSet(r.data.plan);
      // Materialize the user locally so the UI has a CURRENT_USER to reference
      const cloudUser = r.data?.user || {};
      CURRENT_USER = {
        id:    cloudUser.id    || vxPlatformConfig().userId || 'cloud-user',
        name:  cloudUser.name  || email.split('@')[0],
        email: email,
        role:  cloudUser.role  || 'Inspector',
        photo: cloudUser.photo || null,
        certs: [], certAuth: '', dept: '', notes: '',
        createdAt: cloudUser.createdAt || new Date().toISOString(),
        lastLogin: new Date().toISOString(),
      };
      // Ensure they exist in the local AUTH_USERS array so the rest of the UI works
      if(!AUTH_USERS.find(u => u.id === CURRENT_USER.id)) {
        AUTH_USERS.push(CURRENT_USER);
        saveUsers();
      }
      saveSession(CURRENT_USER.id);
      try { await vxStore.pullAll(); } catch(e) { console.warn('pullAll', e); }
      bootApp();
      toast(t('toast.signed_in','Signed in to Veritix Cloud.'), 'success');
      return;
    }
    // Cloud failed — try local for backward compat (existing trial users)
    if(r.status === 0 || r.status >= 500) {
      // Network or server error — try local fallback silently
    } else if(r.status === 401 || r.status === 403) {
      err.textContent = r.error || t('validation.invalid_creds','Incorrect email or password.');
      err.classList.add('show');
      return;
    }
  } catch(e) { console.warn('cloud login failed', e); }
  finally {
    if(btn && origLabel) { btn.disabled = false; btn.textContent = origLabel; }
  }

  // Local fallback for legacy trial accounts
  const hash = await sha256(pwd);
  const user = AUTH_USERS.find(u=>u.email===email && u.pwd===hash);
  if(!user){ err.textContent=t('validation.invalid_creds','Incorrect email or password.'); err.classList.add('show'); return; }
  CURRENT_USER = user;
  user.lastLogin = new Date().toISOString();
  saveUsers();
  saveSession(user.id);
  bootApp();
}

async function doRegister() {
  const name    = el('ri-name').value.trim();
  const company = el('ri-company')?.value.trim() || '';
  const email   = el('ri-email').value.trim().toLowerCase();
  const pwd     = el('ri-pwd').value;
  const err     = el('ri-err');
  err.classList.remove('show');
  if(!name||!email||!pwd){ err.textContent=t('validation.required','All fields are required.'); err.classList.add('show'); return; }
  if(pwd.length<8){ err.textContent=t('validation.password_short','Password must be at least 8 characters.'); err.classList.add('show'); return; }

  const btn = document.querySelector('#register-form .login-btn');
  const origLabel = btn?.textContent;
  if(btn) { btn.disabled = true; btn.textContent = 'Creating your account…'; }
  try {
    // V13 cloud-first: try Veritix Cloud registration first
    const r = await vxApi.register({ name, company, email, password: pwd });
    if(r.ok) {
      // V44: Supabase email-confirmation-on path — no session is returned
      // until the user clicks the link. Fall through to the local
      // fallback so they see the in-app "confirm email" UX immediately.
      if(r.data?.needsEmailConfirmation){
        // Keep behaviour close to historical: register locally too so the
        // user can poke around while waiting for the confirmation email.
        // Cloud will take over on their next sign-in.
      } else {
        // Cloud signup succeeded — auto-login
        if(r.data?.accessToken) {
          vxPlatformSet({
            accessToken: r.data.accessToken,
            refreshToken: r.data.refreshToken || null,
            tokenExpiry:  r.data.expiresAt   || null,
            userId:       r.data.user?.id    || null,
            orgId:        r.data.org?.id     || null,
          });
        } else {
          await vxApi.login(email, pwd);
        }
        if(r.data?.plan) vxPlanSet(r.data.plan);
        const cloudUser = r.data?.user || {};
        CURRENT_USER = {
          id:    cloudUser.id    || vxPlatformConfig().userId || ('u_' + Date.now()),
          name, email, role: 'Admin',
          photo: null,
          certs: [], certAuth: '', dept: company, notes: '',
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
        };
        AUTH_USERS.push(CURRENT_USER);
        saveUsers();
        saveSession(CURRENT_USER.id);
        // V44: First-cloud-login migration — push trial-mode dirty entities
        // to the newly-provisioned org BEFORE the regular sync drain. Shows
        // a "Synced N records to the cloud" toast.
        try { await _vxMigrateTrialDataToCloud(); } catch(e){ console.warn('trial-migration', e); }
        try { await vxSyncFlush(); } catch(e){}
        bootApp();
        toast(t('toast.signup_ok','Welcome to Veritix! Check your email to verify your address.'), 'success');
        return;
      }
    }
    // 4xx — typically email already taken
    if(r.status >= 400 && r.status < 500) {
      err.textContent = r.error || 'Could not create account. Try a different email.';
      err.classList.add('show');
      return;
    }
    // Network or 5xx — fall through to local registration as a fallback
  } catch(e) { console.warn('cloud register failed', e); }
  finally {
    if(btn && origLabel) { btn.disabled = false; btn.textContent = origLabel; }
  }

  // Local fallback (legacy / offline preview signup)
  if(AUTH_USERS.find(u=>u.email===email)){ err.textContent=t('validation.email_exists','An account with that email already exists.'); err.classList.add('show'); return; }
  const hash = await sha256(pwd);
  const isFirst = AUTH_USERS.length===0;
  const user = {
    id: 'u_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),
    name, email, pwd: hash,
    role: isFirst?'Admin':'Inspector',
    certs:[], certAuth:'', dept:company, notes:'',
    createdAt: new Date().toISOString(), lastLogin: new Date().toISOString(),
  };
  AUTH_USERS.push(user);
  saveUsers();
  CURRENT_USER = user;
  saveSession(user.id);
  // Show confirm email first
  showConfirmEmail(user);
}

// V13: guest preview path. Bypasses the login screen with a one-shot session
// that exists only in memory + local cache. No cloud account; the trial banner
// surfaces the upgrade CTA.
function liGuestMode() {
  // Reuse a stable guest identity so toggling preview/sign-in doesn't fragment data
  let guest = AUTH_USERS.find(u => u.id === 'guest-preview');
  if(!guest) {
    guest = {
      id: 'guest-preview',
      name: 'Trial preview',
      email: 'preview@local',
      pwd: '', // never used
      role: 'Admin',
      certs:[], certAuth:'', dept:'', notes:'',
      createdAt: new Date().toISOString(), lastLogin: new Date().toISOString(),
    };
    AUTH_USERS.push(guest);
    saveUsers();
  }
  CURRENT_USER = guest;
  saveSession(guest.id);
  bootApp();
  toast(t('msg.previewing','Previewing Veritix. Sign up to save your work to the cloud.'), 'info');
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

