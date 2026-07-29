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
  // Capture the identity this device was last associated with BEFORE the patch
  // below overwrites userId. Used to detect a user *switch* (signing in with a
  // different account / provider on a browser that still holds the previous
  // user's orgId+role): a stale cross-user orgId is the "phantom admin" masking
  // bug, and must never survive into the new session.
  var prevUserId = (function(){ try { return vxPlatformConfig().userId || null; } catch(e){ return null; } })();
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
  // Remember that a real Supabase session has existed on this device. Lets
  // renderTrialBanner tell apart "never signed in to cloud" (genuine trial)
  // from "has a cloud account here but is now on a stale local-only session"
  // — the latter gets a clear reconnect banner instead of being silently
  // left at local Inspector privilege (which is what masked Carl's admin).
  try { localStorage.setItem('vx-sb-cloud-seen', '1'); } catch(e){}
  // Resolve orgId / role from the CURRENT cloud user's membership — the single
  // source of truth. A previous user's orgId/role must NEVER be inherited:
  // signing in with a different account/provider on a browser that still holds
  // the old config was showing "phantom admin" of a workspace the new user has
  // no membership in (Carl's Google login appeared admin of org ecabfac4). And
  // a genuinely new OAuth user must be provisioned an org of their own rather
  // than left org-less. _vxResolveOrgMembership handles both, robustly against
  // the supabase-js token-commit race.
  try {
    var sb = _vxSupabase();
    if(sb && session.user && session.user.id){
      var res = await _vxResolveOrgMembership(sb, session, prevUserId);
      if(res.status === 'member' || res.status === 'reconciled'){
        // V44.3: server-trusted orgId + role. bootApp syncs role down to the
        // legacy CURRENT_USER record so admin tools unhide correctly.
        vxPlatformSet({ orgId: res.orgId, role: res.role });
      } else if(res.status === 'none'){
        // The user genuinely belongs to no org and reconcile could not create
        // one. Clear any inherited orgId/role so the UI reflects cloud truth
        // (org-less) instead of masking it with a previous user's config.
        vxPlatformSet({ orgId: null, role: null });
      } else {
        // status === 'error' — a transient lookup failure (network / TLS /
        // RLS). Leave orgId/role as-is so we don't drop a valid admin or spawn
        // a duplicate org on a flaky connection — BUT only if they belong to
        // THIS user. If the device last held a *different* user's org, that
        // value is never right, so clear it.
        if(prevUserId && prevUserId !== session.user.id){
          vxPlatformSet({ orgId: null, role: null });
        }
      }
    }
  } catch(e){ console.warn('vx: org membership resolution failed', e); }
}

// Resolve (or provision) the org for a freshly-authenticated cloud user.
// Returns { status, orgId, role } where status is one of:
//   'member'     — found an existing org_members row
//   'reconciled' — the user had no org so we created one (they become admin)
//   'none'       — the user has no org AND provisioning failed (caller clears)
//   'error'      — the membership lookup itself failed transiently (caller
//                  leaves orgId/role untouched for a later, healthy apply)
//
// Robust against the supabase-js token-commit race that previously left brand-
// new OAuth users org-less: the OAuth callback reaches _vxApplySupabaseSession
// via onAuthStateChange, which fires while the SDK is still committing the
// freshly-issued token. We confirm the JWT is live with getUser() FIRST — once
// it resolves, auth.uid() is committed for PostgREST too, so (a) an existing
// member's read returns their row instead of a spurious empty (which would have
// created a DUPLICATE org), and (b) an empty read is genuinely "no org" so the
// provisioning INSERT (RLS: created_by = auth.uid()) won't 401. A single
// delayed re-read + retry covers any residual timing slack.
async function _vxResolveOrgMembership(sb, session, prevUserId){
  var userId = session.user.id;
  // Confirm the token is live server-side before trusting any read/insert.
  try { await sb.auth.getUser(); } catch(e){}

  var lookup = function(){
    return sb.from('org_members')
      .select('org_id, role')
      .eq('user_id', userId)
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle();
  };

  var r = await lookup();
  if(r && r.error){
    console.warn('vx: org membership lookup failed — leaving org unresolved', r.error.message || r.error);
    return { status: 'error' };
  }
  if(r && r.data){
    return { status: 'member', orgId: r.data.org_id || null, role: r.data.role || null };
  }

  // No membership → provision an org. The orgs_add_creator_as_admin trigger
  // inserts the admin org_members row inside the same transaction.
  var made = await _vxCreateOrgForUser(sb, session);
  if(made.ok) return { status: 'reconciled', orgId: made.orgId, role: 'admin' };

  // Insert rejected — most often the token-commit race (auth.uid() momentarily
  // null). Give the SDK a tick, re-read in case a concurrent apply already
  // provisioned the org, then try the insert one final time.
  await new Promise(function(resolve){ setTimeout(resolve, 250); });
  var r2 = await lookup();
  if(r2 && !r2.error && r2.data){
    return { status: 'member', orgId: r2.data.org_id || null, role: r2.data.role || null };
  }
  var retry = await _vxCreateOrgForUser(sb, session);
  if(retry.ok) return { status: 'reconciled', orgId: retry.orgId, role: 'admin' };

  console.warn('vx: org reconciliation failed after retry', retry.error);
  return { status: 'none' };
}

// Provision a fresh 14-day trial org for the session's user via the
// vx_provision_org RPC (migration 0006). We deliberately do NOT use a direct
// INSERT into orgs: that path is subject to the orgs_insert RLS WITH CHECK,
// which was denying brand-new SSO users even when auth.uid() == created_by and
// the policy is permissive (an environment RLS-on-insert anomaly — confirmed
// with a whoami probe showing auth.uid()/auth.role() correct yet the insert
// 42501'd). The SECURITY DEFINER RPC bypasses that while staying safe: it forces
// created_by = auth.uid(), requires a session, and is idempotent (returns the
// caller's existing org, so no duplicates on retry). Returns { ok, orgId } or
// { ok:false, error }.
async function _vxCreateOrgForUser(sb, session){
  var meta = (session.user && session.user.user_metadata) || {};
  var userEmail = (session.user && session.user.email) || '';
  var displayName = meta.name || meta.full_name || (userEmail ? userEmail.split('@')[0] : 'New user');
  var orgName = meta.company || (displayName + "'s team");
  try {
    var rpc = await sb.rpc('vx_provision_org', { p_name: orgName });
    if(!rpc.error && rpc.data){
      console.log('vx: provisioned org for user', session.user.id);
      return { ok: true, orgId: rpc.data };
    }
    return { ok: false, error: rpc.error && (rpc.error.message || rpc.error) };
  } catch(e){ return { ok: false, error: String((e && e.message) || e) }; }
}

// Build a local CURRENT_USER record from a Supabase session so the rest of
// the UI (which keys off CURRENT_USER + AUTH_USERS) works. The password path
// does this inline in doLogin; OAuth (Google/Microsoft) sign-ins instead land
// back on the boot getSession / SIGNED_IN path with NO doLogin call, so the
// session is valid server-side but no CURRENT_USER ever gets materialised —
// boot then hits `else clearSession()` and bounces straight back to the login
// screen (the "Microsoft sign-in loops back to login" symptom). Persists
// straight to KEYS.users / KEYS.session via ls/lss because this can run before
// loadUsers() populates the in-memory AUTH_USERS array. Idempotent: upserts by
// id/email and just refreshes lastLogin for a returning user.
function _vxMaterializeCloudUser(session){
  if(!session || !session.user) return null;
  var u = session.user;
  var meta = u.user_metadata || {};
  var cfgRole = (typeof vxPlatformConfig === 'function') ? vxPlatformConfig().role : null;
  var role = (typeof _vxRoleToDisplay === 'function') ? _vxRoleToDisplay(cfgRole) : 'Inspector';
  var email = (u.email || '').toLowerCase();
  var users = ls(KEYS.users, []);
  if(!Array.isArray(users)) users = [];
  var existing = users.find(function(x){ return x.id === u.id || (email && (x.email || '').toLowerCase() === email); });
  var rec = existing || {};
  rec.id = u.id;
  rec.email = email || rec.email || '';
  rec.name = rec.name || meta.name || meta.full_name || (email ? email.split('@')[0] : 'User');
  rec.role = role || rec.role || 'Inspector';
  if((meta.avatar_url || meta.picture) && !rec.photo) rec.photo = meta.avatar_url || meta.picture;
  rec.certs = rec.certs || []; rec.certAuth = rec.certAuth || ''; rec.dept = rec.dept || ''; rec.notes = rec.notes || '';
  rec.createdAt = rec.createdAt || new Date().toISOString();
  rec.lastLogin = new Date().toISOString();
  if(!existing) users.push(rec);
  try { lss(KEYS.users, users); } catch(e){}
  if(Array.isArray(AUTH_USERS)){
    var i = AUTH_USERS.findIndex(function(x){ return x.id === rec.id; });
    if(i >= 0) AUTH_USERS[i] = rec; else AUTH_USERS.push(rec);
  }
  CURRENT_USER = rec;
  try { saveSession(rec.id); } catch(e){}
  return rec;
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
  'company','inspectors','equipment','customers','billing','emailtemplates',
  'users','methods','numbering','templates',
  'pdfeditor','procedures','appearance','subscription','database',
  'notifications','system','drawing','portal','api'
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
  // The Manage group (Jobs / Customers / Planner / Billing) and the standalone
  // Home/Inbox/Reports/Defects buttons are superseded by the role workspaces —
  // keep the Manage wrap hidden for everyone (its destinations live in the Admin
  // workspace now). The four standalone buttons are hidden in the HTML.
  const manage = document.getElementById('tn-manage-wrap');
  if(manage) manage.style.display = 'none';
  _vxWireManageMenu();

  // Role-gated top-level workspace buttons. Each user sees the one for their
  // role; admins additionally get the consolidated Admin workspace.
  //   Inspector / Observer → "Inspector"; Senior → "Senior Inspector";
  //   Admin → "Admin" (+ both inspector workspaces, for oversight).
  const role = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) ? CURRENT_USER.role : null;
  const senior = (typeof vxIsSeniorOrAdmin === 'function') ? vxIsSeniorOrAdmin() : (role === 'Senior' || admin);
  const adminBtn = document.getElementById('tn-admin');
  const inspBtn  = document.getElementById('tn-inspector');
  const srBtn    = document.getElementById('tn-senior');
  if(adminBtn) adminBtn.style.display = admin ? '' : 'none';
  if(inspBtn)  inspBtn.style.display  = (admin || role === 'Inspector' || role === 'Observer') ? '' : 'none';
  if(srBtn)    srBtn.style.display    = senior ? '' : 'none';
}

// Wire the top-nav "Manage" dropdown once: toggle on the button, close on an
// item click or an outside click. Idempotent (guarded by btn._vxWired).
function _vxWireManageMenu(){
  const btn = document.getElementById('tn-manage');
  const menu = document.getElementById('tn-manage-menu');
  if(!btn || !menu || btn._vxWired) return;
  btn._vxWired = true;
  const setOpen = (open) => { menu.style.display = open ? '' : 'none'; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
  btn.addEventListener('click', () => setOpen(menu.style.display === 'none'));
  menu.addEventListener('click', () => setOpen(false));   // any item navigates then closes
  document.addEventListener('click', (e) => {
    if(menu.style.display === 'none') return;
    if(btn.contains(e.target) || menu.contains(e.target)) return;
    setOpen(false);
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

// ── Heavy-field offload helpers (V45) ────────────────────────────────────
// Per-report HTML rows are immutable once sealed, so we sync each one exactly
// once. A persistent signature map (reportId -> sig, sig = sealedAt) records
// which have already reached the cloud, so a metadata-only change never
// re-uploads the megabytes of HTML.
function _vxHtmlSigMap(){ try { return JSON.parse(localStorage.getItem(VX_HTML_SIG_KEY) || '{}'); } catch { return {}; } }
function _vxHtmlSigSave(m){ try { localStorage.setItem(VX_HTML_SIG_KEY, JSON.stringify(m)); } catch(e){} }
function _vxHtmlSigSet(id, sig){ const m = _vxHtmlSigMap(); if(m[id] !== sig){ m[id] = sig; _vxHtmlSigSave(m); } }
function _vxHtmlSigClear(id){ const m = _vxHtmlSigMap(); if(id in m){ delete m[id]; _vxHtmlSigSave(m); } }
// V48: parallel signature map for per-report METADATA rows, so a report whose
// light metadata hasn't changed is not re-uploaded on every save of any report.
function _vxReportMetaSigMap(){ try { return JSON.parse(localStorage.getItem(VX_REPORT_META_SIG_KEY) || '{}'); } catch { return {}; } }
function _vxReportMetaSigSave(m){ try { localStorage.setItem(VX_REPORT_META_SIG_KEY, JSON.stringify(m)); } catch(e){} }
function _vxReportMetaSigSet(id, sig){ const m = _vxReportMetaSigMap(); if(m[id] !== sig){ m[id] = sig; _vxReportMetaSigSave(m); } }
function _vxReportMetaSigClear(id){ const m = _vxReportMetaSigMap(); if(id in m){ delete m[id]; _vxReportMetaSigSave(m); } }
// Signature of a light (HTML-stripped) report — any field change flips it.
function _vxReportMetaSig(lightReport){ try { return JSON.stringify(lightReport); } catch { return String(Date.now()); } }
// Stable per-seal signature: sealedAt is set once at approval and never
// changes for a given sealed report/revision. Falls back to a length tag.
function _vxReportHtmlSig(r){
  const fields = VX_HEAVY_FIELDS['vx-reports-v1'];
  const has = fields.some(f => r && r[f]);
  if(!has) return null;
  return String(r.sealedAt || (r.revision || '') + ':' + ((r.sealedHtml || r.frozenHtml || '').length));
}
// Stable per-report key for addressing its html row. Reports created before
// an `id` field existed are keyed by reportNo::revision (unique per revision).
// Returns null if neither is available — caller then must NOT strip its HTML.
function _vxReportKey(r){
  if(!r) return null;
  if(r.id) return String(r.id);
  if(r.reportNo) return String(r.reportNo) + '::' + String(r.revision || '');
  return null;
}

// V48: a stable client-side UUID for a new report, so its sync-row key is
// independent of its (later-allocated) report number.
function vxNewId(){
  try { if(typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch(e){}
  try {
    if(typeof crypto !== 'undefined' && crypto.getRandomValues){
      const b = new Uint8Array(16); crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b).map(x => x.toString(16).padStart(2, '0'));
      return h.slice(0,4).join('') + '-' + h.slice(4,6).join('') + '-' + h.slice(6,8).join('') + '-' + h.slice(8,10).join('') + '-' + h.slice(10).join('');
    }
  } catch(e){}
  return 'r-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

// V48: format a human report number from an integer sequence + the org's local
// numbering config (prefix / separator / year digits / seq digits / method
// position). Single source of truth — the new-report, editor preview and
// settings preview all call this. Mirrors the original inline algorithm.
function vxFormatReportNo(seq, method, settings){
  const s = settings || (typeof ls === 'function' ? ls('vx-settings-v1', {}) : {});
  const prefix    = s.numPrefix || 'INS';
  const sep       = s.numSep !== undefined ? s.numSep : '-';
  const yrDigits  = parseInt(s.numYear || '4', 10);
  const digits    = parseInt(s.numDigits || '3', 10);
  const methodPos = s.numMethodPos || 'none';
  const yr = yrDigits === 4 ? new Date().getFullYear() : yrDigits === 2 ? String(new Date().getFullYear()).slice(-2) : '';
  const sq = String(seq).padStart(digits, '0');
  const mCode = (method || '').toUpperCase();
  const parts = [prefix];
  if(methodPos === 'after-prefix' && mCode) parts.push(mCode);
  if(yr) parts.push(yr);
  if(methodPos === 'after-year' && mCode) parts.push(mCode);
  parts.push(sq);
  return parts.filter(Boolean).join(sep);
}

// V48: seed the server counter ONCE from the org's configured "next number",
// the first time this org allocates — so an org that set a starting number in
// Settings keeps it. No-op if the counter has already advanced (peek != 1) or
// the local start is the default 1. Best-effort; guarded server-side so it can
// never lower a counter below an already-issued number.
var _vxReportCounterSeeded = false;
async function _vxSeedReportCounterOnce(sb, orgId){
  if(_vxReportCounterSeeded) return;
  _vxReportCounterSeeded = true;
  try {
    const s = (typeof ls === 'function') ? ls('vx-settings-v1', {}) : {};
    const localNext = parseInt(s.numNext || '1', 10);
    if(!(localNext > 1)) return;
    const peek = await sb.rpc('vx_peek_report_no', { p_org: orgId });
    if(peek.error || peek.data == null) return;
    if(Number(peek.data) === 1){
      await sb.rpc('vx_set_report_no', { p_org: orgId, p_next: localNext });
    }
  } catch(e){ /* best-effort seed */ }
}

// V48: allocate a report's final number from the server — atomic, gap-free, and
// exactly-once per report id (a retry returns the same number, never skips).
// Online + authenticated only. On success sets report.reportNo + reportSeq and
// clears isDraft; on offline/error leaves it a Draft (no number) and returns
// null, so the caller can save it as a Draft to be numbered when back online.
// V48: number any Drafts that were saved offline (have a stable id but no
// reportNo yet). Runs after a sync/flush and after signin, when online. The
// allocation RPC is idempotent on report id, so this is safe to re-run. Returns
// how many it numbered.
async function vxNumberPendingDrafts(){
  try {
    if(!vxIsAuthenticated()) return 0;
    if(typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    const reports = ls('vx-reports-v1', []);
    if(!Array.isArray(reports) || !reports.length) return 0;
    let numbered = 0;
    for(const r of reports){
      if(r && r.id && !r.reportNo){
        const no = await vxAllocReportNo(r);
        if(no){ r.updatedAt = new Date().toISOString(); numbered++; }
      }
    }
    if(numbered){ lss('vx-reports-v1', reports); if(typeof rptRender === 'function') try { rptRender(); } catch(e){} }
    return numbered;
  } catch(e){ console.warn('vx: vxNumberPendingDrafts failed', e); return 0; }
}

async function vxAllocReportNo(report){
  try {
    if(!report || !report.id) return null;
    if(report.reportNo) return report.reportNo;          // already numbered (idempotent caller-side)
    if(!vxIsAuthenticated() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
    const sb  = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
    const cfg = (typeof vxPlatformConfig === 'function') ? vxPlatformConfig() : {};
    if(!sb || !sb.rpc || !cfg.orgId) return null;
    await _vxSeedReportCounterOnce(sb, cfg.orgId);
    const res = await sb.rpc('vx_alloc_report_no', { p_org: cfg.orgId, p_report_uuid: report.id });
    if(res.error || res.data == null){ console.warn('vx: alloc_report_no', res.error && res.error.message); return null; }
    const seq = res.data;
    const s = (typeof ls === 'function') ? ls('vx-settings-v1', {}) : {};
    report.reportNo  = vxFormatReportNo(seq, report.method, s);
    report.reportSeq = Number(seq);
    report.isDraft   = false;
    return report.reportNo;
  } catch(e){ console.warn('vx: vxAllocReportNo failed', e); return null; }
}

// V47: mint the report-verify URL that the report's QR code encodes. The
// signed token is minted server-side (portal-token kind:'verify') and is
// long-lived. The caller stores the URL on the report BEFORE sealing, so the
// frozen PDF's QR opens a working #/verify/<token> link. Returns the URL, or
// null when offline / not cloud-configured (the report still seals, just
// without a verify QR until re-approved online).
async function vxEnsureReportVerifyUrl(r){
  try {
    if(r && r.verifyUrl) return r.verifyUrl;
    const sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
    const cfg = (typeof vxPlatformConfig === 'function') ? vxPlatformConfig() : {};
    if(!sb || !sb.functions || !cfg.orgId) return null;
    const reportId = _vxReportKey(r);
    if(!reportId) return null;
    const res = await sb.functions.invoke('portal-token', { body: { kind: 'verify', orgId: cfg.orgId, reportId: reportId } });
    if(res.error || !res.data || !res.data.url) return null;
    return res.data.url;
  } catch(e){ console.warn('vx: verify-url mint failed', e); return null; }
}
// Return a shallow clone of the array with the heavy fields removed from each
// item (never mutates the caller's objects), plus the html put/delete ops.
// SAFETY: an item's HTML is only stripped when we have a stable key to re-home
// it in a per-report row — never strip HTML we can't address, or it'd be lost.
function _vxSplitHeavy(collectionKey, value){
  const fields = VX_HEAVY_FIELDS[collectionKey];
  if(!fields || !Array.isArray(value)) return { stripped: value, puts: [], deletes: [] };
  const sigMap = _vxHtmlSigMap();
  const liveIds = {};
  const stripped = [];
  const puts = [];
  for(const item of value){
    if(!item || typeof item !== 'object'){ stripped.push(item); continue; }
    let heavy = null;
    for(const f of fields){ if(item[f] != null){ (heavy = heavy || {})[f] = item[f]; } }
    const key = heavy ? _vxReportKey(item) : null;
    if(heavy && key){
      const clone = Object.assign({}, item);
      for(const f of fields) delete clone[f];
      stripped.push(clone);
      liveIds[key] = true;
      const sig = _vxReportHtmlSig(item);
      if(sig && sigMap[key] !== sig){ puts.push({ id: key, sig: sig, value: heavy }); }
    } else {
      // No heavy fields, or no stable key to address an html row → leave the
      // item exactly as-is (do not strip HTML we couldn't re-home).
      stripped.push(item);
    }
  }
  // Reports we've synced HTML for that are no longer present → delete their rows.
  const deletes = [];
  for(const id of Object.keys(sigMap)){ if(!liveIds[id]) deletes.push(id); }
  return { stripped, puts, deletes };
}

function vxSyncEnqueue(op) {
  if(!vxIsAuthenticated()) return;
  // V48: the reports collection ('vx-reports-v1') no longer syncs as a blob —
  // it is split into per-report rows by vxSyncEnqueueReports, which is called
  // directly from lss(). Any stray blob-level enqueue for it is ignored here.
  if(op.key === 'vx-reports-v1'){ try { vxSyncEnqueueReports(op.value); } catch(e){} return; }
  // only sync generic entity keys, per-report metadata rows, or html rows
  if(!VX_ENTITY_KEYS.has(op.key)
     && op.key.indexOf(VX_HTML_PREFIX) !== 0
     && op.key.indexOf(VX_REPORT_PREFIX) !== 0) return;
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
      if(op.htmlId){ queue[existingIdx].htmlId = op.htmlId; queue[existingIdx].htmlSig = op.htmlSig; }
      if(op.metaId){ queue[existingIdx].metaId = op.metaId; queue[existingIdx].metaSig = op.metaSig; }
    } else {
      queue.push({
        id: 'op-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        at: new Date().toISOString(),
        op: op.kind,                            // 'put' | 'delete' | 'patch'
        key: op.key,
        value: op.value,
        htmlId: op.htmlId,                      // V45: set for vx-report-html:: ops
        htmlSig: op.htmlSig,
        metaId: op.metaId,                      // V48: set for vx-report:: ops
        metaSig: op.metaSig,
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

// V48: enqueue the reports array as per-report rows instead of one blob.
// Reuses _vxSplitHeavy to peel each report's heavy HTML into its write-once
// 'vx-report-html::<key>' row (unchanged), then enqueues each CHANGED light
// report as its own 'vx-report::<key>' row (skipping reports whose metadata
// signature is unchanged, so saving one report doesn't re-upload the rest).
// Marks each changed report's per-report dirty flag so a concurrent pull keeps
// the local copy until the queue drains. There are no per-report deletes — the
// product never deletes a report (a wrong report is revised), which removes the
// whole "did a teammate's report get resurrected on pull" class of bug.
function vxSyncEnqueueReports(arr){
  if(!vxIsAuthenticated()) return;
  if(!Array.isArray(arr)) return;
  const split = _vxSplitHeavy('vx-reports-v1', arr);   // { stripped, puts, deletes } for HTML
  for(const p of split.puts){
    vxSyncEnqueue({ kind: 'put', key: VX_HTML_PREFIX + p.id, value: p.value, htmlId: p.id, htmlSig: p.sig });
  }
  for(const id of split.deletes){
    vxSyncEnqueue({ kind: 'delete', key: VX_HTML_PREFIX + id, htmlId: id });
  }
  const sigMap = _vxReportMetaSigMap();
  for(const light of split.stripped){
    const key = _vxReportKey(light);
    if(!key) continue;                                  // unkeyable draft — stays local until it has an id
    const sig = _vxReportMetaSig(light);
    if(sigMap[key] === sig) continue;                   // metadata unchanged — skip
    _vxMarkDirty(VX_REPORT_PREFIX + key);
    vxSyncEnqueue({ kind: 'put', key: VX_REPORT_PREFIX + key, value: light, metaId: key, metaSig: sig });
  }
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
        // V45: a per-report HTML row reached the cloud — record (or clear, on
        // delete) its signature so we never re-upload that immutable snapshot.
        if(op.htmlId){ if(op.op === 'delete') _vxHtmlSigClear(op.htmlId); else _vxHtmlSigSet(op.htmlId, op.htmlSig); }
        // V48: a per-report metadata row reached the cloud — record its sig so an
        // unchanged report isn't re-uploaded on the next save of another report.
        if(op.metaId){ if(op.op === 'delete') _vxReportMetaSigClear(op.metaId); else _vxReportMetaSigSet(op.metaId, op.metaSig); }
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
  // A key whose queued writes have ALL been delivered this run is no longer
  // ahead of the server — clear its dirty flag so a later pullAll may
  // refresh it again. Keys with ops still pending/failed stay dirty so
  // pullAll keeps skipping them until the queue fully drains — that is what
  // protects an in-flight save from being clobbered by a concurrent pull.
  const _stillQueued = new Set(
    queue.filter(o => o.status === 'pending' || o.status === 'failed').map(o => o.key)
  );
  pending.forEach(o => {
    if(o.status === 'delivered' && o.key && !_stillQueued.has(o.key)) _vxClearDirty(o.key);
  });
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
    if(vxIsCloud() && navigator.onLine){
      vxSyncFlush().then(() => vxNumberPendingDrafts()).catch(() => {});
    }
  }, 30 * 1000);
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
