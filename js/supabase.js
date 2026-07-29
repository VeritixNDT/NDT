// ══════════════════════════════════════════════════════════════════════════
// Supabase glue — the client singleton, and turning a session into an identity.
// ══════════════════════════════════════════════════════════════════════════
// Split out of js/platform.js (tenth slice). Two jobs that were tangled with
// the platform's storage seam despite sharing nothing with it: owning the one
// Supabase client per tab, and resolving a freshly-authenticated session into
// {orgId, role, CURRENT_USER} that the rest of the app can read.
//
// Consumed from eighteen files — api, auth, boot, storage, sync, realtime,
// workspace, portal, portal-events, settings, ui, verify, export, dashboard,
// ai-review and ai-vision all reach for _vxSupabase(). Nearly all of them go
// through `typeof _vxSupabase === 'function' ? … : null`, which is exactly why
// losing this file would be silent: every one of those guards would take the
// null branch and the app would quietly behave as an unconfigured trial.
// tools/verify.test.mjs pins the surface for that reason.
//
// Its one top-level statement publishes vxSupabaseConfigured on window for
// diagnostics; the function is hoisted, so the assignment carries no ordering
// dependency. Every call site is inside a function body — checked across js/
// and the shell before the move — so nothing reaches into this block at load.
//
// _vxReadMetaApiBase() deliberately did NOT travel with the other meta-tag
// readers: VX_PLATFORM_DEFAULTS calls it at load, so it has to stay beside the
// defaults it populates.

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
