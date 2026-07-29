// ══════════════════════════════════════════════════════════════════════════
// API client — every network call the app makes, behind one object.
// ══════════════════════════════════════════════════════════════════════════
// Split out of js/platform.js (fourth slice, after storage.js, auth.js and
// platform-ui.js). The cleanest cut of the series: a single declaration,
// vxApi, with no top-level executable statements at all.
//
// Loads after platform.js because it calls into the Supabase glue there
// (_vxSupabase, session handling). Consumers: auth.js, settings.js,
// platform-ui.js and the rest of platform.js.
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
        // Provision via the SECURITY DEFINER RPC (same as _vxCreateOrgForUser —
        // a direct orgs INSERT hits the orgs_insert RLS anomaly). Then fetch the
        // org details for the response. Logs the error for diagnostics.
        var prov = await sb.rpc('vx_provision_org', {
          p_name: payload.company || (payload.name ? (payload.name + "'s team") : 'New team'),
        });
        if(!prov.error && prov.data){
          vxPlatformSet({ orgId: prov.data, role: 'admin' });
          var orgFetch2 = await sb.from('orgs')
            .select('id, name, plan_tier, trial_ends_at')
            .eq('id', prov.data)
            .maybeSingle();
          if(!orgFetch2.error && orgFetch2.data) newOrg = orgFetch2.data;
        } else {
          console.warn('vx: org provisioning fallback failed', prov.error);
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
   * V45: Fetch all per-report HTML rows for the org as a map
   * { reportId: { sealedHtml, frozenHtml } }. Used to re-attach the heavy
   * snapshots onto the light vx-reports-v1 blob after a pull. null on error.
   */
  async hydrateReportHtml(){
    if(!vxIsAuthenticated()) return null;
    var sb = _vxSupabase();
    if(!sb) return null;
    var cfg = vxPlatformConfig();
    if(!cfg.orgId) return null;
    try {
      var r = await sb.from('entities')
        .select('key,value')
        .eq('org_id', cfg.orgId)
        .like('key', VX_HTML_PREFIX + '%');
      if(r.error){ console.warn('vx: hydrateReportHtml', r.error.message); return null; }
      var map = {};
      (r.data || []).forEach(function(row){
        var id = String(row.key).slice(VX_HTML_PREFIX.length);
        if(id) map[id] = row.value || {};
      });
      return map;
    } catch(e){ console.warn('vx: hydrateReportHtml failed', e); return null; }
  },

  /**
   * V48: Fetch all per-report METADATA rows for the org as a map
   * { reportKey: lightReport }. The merge in vxPullReports unions these with
   * the local array. null on error (so the caller leaves local untouched).
   */
  async hydrateReports(){
    if(!vxIsAuthenticated()) return null;
    var sb = _vxSupabase();
    if(!sb) return null;
    var cfg = vxPlatformConfig();
    if(!cfg.orgId) return null;
    try {
      var r = await sb.from('entities')
        .select('key,value')
        .eq('org_id', cfg.orgId)
        .like('key', VX_REPORT_PREFIX + '%');
      if(r.error){ console.warn('vx: hydrateReports', r.error.message); return null; }
      var map = {};
      (r.data || []).forEach(function(row){
        var id = String(row.key).slice(VX_REPORT_PREFIX.length);
        if(id) map[id] = row.value || null;
      });
      return map;
    } catch(e){ console.warn('vx: hydrateReports failed', e); return null; }
  },

  /** V49 (Portal v2): read the customer-submitted events (write-once
   *  vx-portal-event::<id> rows written by the portal-submit function).
   *  Returns { id: event } or null on error (caller leaves local untouched). */
  async hydratePortalEvents(){
    if(!vxIsAuthenticated()) return null;
    var sb = _vxSupabase();
    if(!sb) return null;
    var cfg = vxPlatformConfig();
    if(!cfg.orgId) return null;
    try {
      var r = await sb.from('entities')
        .select('key,value')
        .eq('org_id', cfg.orgId)
        .like('key', VX_PORTAL_EVENT_PREFIX + '%');
      if(r.error){ console.warn('vx: hydratePortalEvents', r.error.message); return null; }
      var map = {};
      (r.data || []).forEach(function(row){
        var id = String(row.key).slice(VX_PORTAL_EVENT_PREFIX.length);
        if(id) map[id] = row.value || null;
      });
      return map;
    } catch(e){ console.warn('vx: hydratePortalEvents failed', e); return null; }
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

  // Invoke the send-email Edge Function with a server-side template.
  // The function (supabase/functions/send-email) renders the HTML itself
  // from a whitelist of template types — the client only names the type
  // and passes structured data, never raw HTML. Returns {ok, id?, error?}.
  // Best-effort by design: callers treat a failure here as non-fatal so a
  // mail outage never blocks the underlying action (e.g. recording an
  // invite). Soft-fails to {ok:false} when Supabase isn't configured.
  async sendEmail(type, to, data){
    if(!vxIsAuthenticated()) return { ok: false, error: 'not signed in' };
    var sb = _vxSupabase();
    if(!sb || !sb.functions) return { ok: false, error: 'email backend unavailable' };
    try {
      // Always carry the caller's orgId — the function now requires it and
      // verifies org membership (data may override, e.g. invite's target org).
      var _org = (typeof vxPlatformConfig === 'function' && vxPlatformConfig().orgId) || '';
      var body = Object.assign({ type: type, to: to, orgId: _org }, data || {});
      var r = await sb.functions.invoke('send-email', { body: body });
      if(r.error){
        // The SDK wraps non-2xx as a FunctionsHttpError whose .context is
        // the raw Response — dig out the function's JSON {error} if present.
        var detail = r.error.message || 'send failed';
        try {
          if(r.error.context && typeof r.error.context.json === 'function'){
            var j = await r.error.context.json();
            if(j && j.error) detail = j.error;
          }
        } catch(_){}
        return { ok: false, error: detail };
      }
      return { ok: true, id: (r.data && r.data.id) || null };
    } catch(e){ return { ok: false, error: String(e.message || e) }; }
  },

  // Record a pending invite, then send the invite email (best-effort).
  // The invitee signs up at the app's URL with this email and the
  // handle_pending_invites_on_signup trigger (migration 0002) auto-joins
  // them to the org with this role. Returns {ok, emailSent, emailError?}:
  // a failed email never fails the invite — the row is recorded either way
  // and the admin can re-send or share the URL manually.
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
      // Invite recorded. Fire the email — non-fatal if it fails.
      var mail = await this.sendEmail('invite', normEmail, {
        orgId: cfg.orgId,
        role:  normRole,
      });
      return { ok: true, emailSent: mail.ok, emailError: mail.ok ? null : mail.error };
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

