// ══════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════
function bootApp() {
  el('login-screen').classList.add('hidden');
  const av = el('avatar-btn');
  const ini = initials(CURRENT_USER?.name||'?');
  // Helper closure — render avatar with safe src or text fallback
  const setAvatar = (host, photo) => {
    if(!host) return;
    host.textContent = '';
    if(photo && isSafeImageUrl(photo)) {
      const img = document.createElement('img');
      img.alt = CURRENT_USER?.name || '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      img.src = photo;
      img.onerror = () => { host.textContent = ini; };
      host.appendChild(img);
    } else {
      host.textContent = ini;
    }
  };
  setAvatar(av,           CURRENT_USER?.photo);
  setAvatar(el('pd-avatar'), CURRENT_USER?.photo);
  const pdN = el('pd-name'); if(pdN) pdN.textContent = CURRENT_USER?.name || '—';
  const pdR = el('pd-role'); if(pdR) pdR.textContent = CURRENT_USER?.role || 'Inspector';
  loadSettings();
  loadMethodOrder();
  loadTemplates();
  logoLoadSaved();
  _wireLogoSection();
  renderMethodsTable();
  renderNumberingPreview();
  buildAccentGrid();
  // Device-class gating: tag the PDF editor entry on touch/small-screen
  // devices so users know it's desktop-only. Also fires on resize, in
  // case the user rotates a tablet or attaches an external monitor.
  vxApplyDeviceGating();
  // Role-based gating: hide admin-only settings sub-sections from
  // non-admin users. The top-nav settings button is already hidden via
  // the isAdmin check above, this provides defense-in-depth.
  vxApplyRoleGating();
  if(!window._vxResizeGatingWired){
    window._vxResizeGatingWired = true;
    let _resizeT;
    window.addEventListener('resize', () => {
      clearTimeout(_resizeT);
      _resizeT = setTimeout(vxApplyDeviceGating, 200);
    });
  }
  vxMobileWelcome();
  // Admin-only settings. Use vxIsAdmin() so the Supabase-side
  // org_members.role fallback applies — CURRENT_USER may be null right
  // after a cloud signup that hasn't materialised the legacy user yet.
  const isAdmin = typeof vxIsAdmin === 'function' ? vxIsAdmin() : CURRENT_USER?.role === 'Admin';
  const tnSettings = el('tn-settings');
  if(tnSettings) tnSettings.style.display = isAdmin ? '' : 'none';
  // Admins land in their own workspace on Home; everyone else on overview.
  if(isAdmin){
    if(typeof _adminCurrent !== 'undefined') _adminCurrent = 'home';   // open on Home, not a restored section
    showPage('admin', el('tn-admin'));
  } else {
    showPage('overview', document.querySelector('.tn'));
  }
  updateReportCount();
  // V6: inbox badge
  if(typeof updateInboxBadge === 'function') {
    updateInboxBadge();
    // Refresh badge every 5 minutes (cheap; just reads localStorage)
    setInterval(() => { try { updateInboxBadge(); } catch(e){} }, 5 * 60 * 1000);
  }
  // V7: field-first boot wiring
  if(typeof loadSidebarState === 'function') loadSidebarState();
  if(typeof updateOnlineStatus === 'function') updateOnlineStatus();
  // V11: platform layer (sync queue, deep-link router, deployment-mode pill)
  if(typeof vxPlatformBoot === 'function') vxPlatformBoot();
  if(typeof updateDeployModePill === 'function') updateDeployModePill();
  // V44.2: populate the workspace-name field in Settings → Company from
  // public.orgs. Fires-and-forgets; if the user isn't signed in or the
  // org lookup fails, the input just stays empty.
  if(typeof vxLoadOrgName === 'function') vxLoadOrgName();
  // V12: a11y — associate unlabeled <label>/<input> pairs across the app
  if(typeof a11yWireLabels === 'function') a11yWireLabels();
  // V13: cloud-first onboarding. Show the trial banner and (on first run only)
  // an explicit "welcome to Veritix Cloud" modal with sign-up CTA.
  try {
    if(typeof renderTrialBanner === 'function') renderTrialBanner();
    const firstRunKey = 'vx-welcome-seen-v2';
    if(!localStorage.getItem(firstRunKey) && vxAuthState() === 'trial'){
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if(typeof vxOpenWelcome === 'function') vxOpenWelcome();
        try { localStorage.setItem(firstRunKey, '1'); } catch(e){}
      }));
    }
  } catch(e){ console.warn('onboarding', e); }
}

// ══════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════
(async function init() {
  // V15: hydrate localStorage from IndexedDB BEFORE any code reads entity
  // keys. If localStorage has been cleared but IDB still has the data
  // (browser cache cleanup, etc.), this restores the user's work.
  // If IDB itself is unavailable (private mode in some browsers, very old
  // browser), we silently fall through to localStorage-only.
  try {
    if(typeof vxEntityStore !== 'undefined') {
      const r = await vxEntityStore.hydrate();
      if(r && r.hydrated > 0) console.log('vx: hydrated', r.hydrated, 'entities from IDB');
    }
  } catch(e) { console.warn('vx: hydrate failed, continuing with localStorage', e); }

  // Phase 4: Customer portal. If the URL is a portal magic link
  // (#/portal/<token>), render the read-only customer portal instead of the
  // app/login and stop here — the customer is authenticated by the token,
  // not a session. (localStorage is already hydrated above so the local
  // preview token path can read the org's data.)
  try {
    if(typeof vxPortalActive === 'function' && vxPortalActive()){
      if(typeof vxPortalBoot === 'function'){ await vxPortalBoot(); return; }
    }
  } catch(e){ console.warn('vx: portal boot failed', e); }

  // V47: report-verify (#/verify/<token>) — a printed report's QR. Public,
  // read-only, token-authenticated; render the verify view instead of the app.
  try {
    if(typeof vxVerifyActive === 'function' && vxVerifyActive()){
      if(typeof vxVerifyBoot === 'function'){ await vxVerifyBoot(); return; }
    }
  } catch(e){ console.warn('vx: verify boot failed', e); }

  // V44: Supabase bootstrap.
  // If the meta tags are populated AND there's a persisted session in
  // localStorage (the SDK restores it automatically on createClient), copy
  // its tokens into vxPlatformConfig so the rest of the app (which reads
  // vxPlatformConfig().accessToken, .userId, .orgId) believes itself
  // signed in. Also subscribe to auth state changes so refresh, signout
  // from another tab, or magic-link callbacks flow through reactively.
  // When the meta tags are empty the app continues in pre-config trial
  // mode exactly as before.
  try {
    if(typeof vxSupabaseConfigured === 'function' && vxSupabaseConfigured()){
      const sb = _vxSupabase();
      if(sb){
        // Restore session if one exists (SDK reads it from localStorage)
        const sess = await sb.auth.getSession();
        if(sess && sess.data && sess.data.session){
          await _vxApplySupabaseSession(sess.data.session);
          // Refresh local cache from cloud for whatever org the user
          // belongs to. We do this lazily — if it fails (network, RLS),
          // the user still sees their last-known local state.
          try {
            if(typeof vxStore !== 'undefined' && vxStore.pullAll){
              vxStore.pullAll().catch(function(e){ console.warn('pullAll on boot failed', e); });
            }
          } catch(e){ console.warn('vx: pullAll dispatch failed', e); }
        } else if(typeof vxIsAuthenticated === 'function' && vxIsAuthenticated()){
          // V44.6: Session-mismatch recovery. localStorage's vx-platform-v1
          // says we're authenticated (accessToken + userId set), but the
          // Supabase SDK has no session — its own storage was wiped while
          // ours survived. Common causes:
          //   - Edge / Brave / Firefox tracking prevention sandboxing the
          //     SDK's storage between tab closes.
          //   - InPrivate / Incognito mode + tab reopen.
          //   - User manually cleared site data for *.supabase.co but not
          //     for the app's own origin.
          // Without this branch the user is stuck: vxIsAuthenticated()
          // returns true so the sign-in form is hidden, but every Supabase
          // query fails RLS because auth.uid() is null server-side. Clear
          // the local auth state so the welcome / sign-in screen renders
          // and they can recover by signing in fresh.
          console.warn('vx: session mismatch detected — clearing local auth state');
          vxPlatformSet({
            accessToken: null, refreshToken: null, tokenExpiry: null,
            userId: null, orgId: null, role: null,
          });
        }
        // Reactive auth state. SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED,
        // USER_UPDATED, USER_DELETED, PASSWORD_RECOVERY all flow here.
        sb.auth.onAuthStateChange(function(event, session){
          if(event === 'SIGNED_OUT'){
            vxPlatformSet({ accessToken: null, refreshToken: null, tokenExpiry: null });
            try { if(typeof vxRealtimeDisconnect === 'function') vxRealtimeDisconnect(); } catch(e){}
          } else if(session){
            // Defer to the next tick. supabase-js fires this callback
            // *synchronously* while it is still committing the freshly-issued
            // token to the PostgREST client. Calling _vxApplySupabaseSession
            // inline (it issues authenticated org_members / orgs queries)
            // races that commit: the requests go out with no JWT, auth.uid()
            // is null server-side, the membership read returns empty, and the
            // reconcile path then 401s inserting into orgs (RLS) — which can
            // also spawn a spurious duplicate org. setTimeout(…, 0) lets the
            // SDK finish wiring the session first. (Matches supabase-js
            // guidance: never await Supabase calls directly in this callback.)
            setTimeout(function(){
              // Use the helper so orgId gets re-resolved if it wasn't set.
              _vxApplySupabaseSession(session).catch(function(e){ console.warn('apply session', e); });
              try { if(typeof vxRealtimeConnect === 'function') vxRealtimeConnect(); } catch(e){}
            }, 0);
          }
        });
      }
    }
  } catch(e){ console.warn('vx: supabase boot failed, continuing without cloud', e); }

  // V4: Apply theme settings IMMEDIATELY before any rendering, so even login screen uses chosen theme
  try {
    const earlyS = ls(KEYS.settings, {});
    if(earlyS.theme || earlyS.contrast || earlyS.cb || earlyS.motion){
      apApplyTheme(earlyS.theme || 'dark', earlyS.contrast || 'standard', earlyS.cb || 'none', earlyS.motion || 'auto');
    }
    if(earlyS.density) apApplyDensity(earlyS.density);
    else if(earlyS.compact) apApplyDensity('compact');
    if(earlyS.font) document.documentElement.style.setProperty('--font', earlyS.font);
    if(earlyS.mono) document.documentElement.style.setProperty('--mono', earlyS.mono);
    if(earlyS.fontSize) document.documentElement.style.setProperty('font-size', earlyS.fontSize + 'px');
    if(earlyS.accent != null) applyAccent(earlyS.accent);
    if(earlyS.severity){ Object.entries(earlyS.severity).forEach(([k,v]) => document.documentElement.style.setProperty('--sev-'+k, v)); }
    apSetSidebarPos(earlyS.sidebarPos || 'left');
    apSetToastPos(earlyS.toastPos || 'bottom-right');
    if(earlyS.customCss) apApplyCustomCss(earlyS.customCss);
    apSetupIdleTimer(parseInt(earlyS.idleLogout||0), parseInt(earlyS.idleLock||0));
  } catch(e){ console.warn('Theme apply at boot failed', e); }

  loadUsers();
  loadInspectors();
  loadSession();

  // V6: ensure all reports have stage + auditLog fields
  try { migrateReportsWorkflow(); } catch(e) { console.warn('Workflow migration failed', e); }

  // V44.3: sync the server-trusted role from public.org_members down to
  // the legacy CURRENT_USER record. _vxApplySupabaseSession stashes the
  // role in vxPlatformConfig.role during boot; here we materialise it
  // into CURRENT_USER so every existing UI gate that reads
  // CURRENT_USER.role sees the correct value. Without this, users who
  // signed up under email-confirm-on get stuck on the local-fallback
  // default role and lose access to their own admin tools.
  try {
    if(CURRENT_USER && typeof vxPlatformConfig === 'function'){
      var cfgRole = vxPlatformConfig().role;
      var displayRole = (typeof _vxRoleToDisplay === 'function' && cfgRole)
        ? _vxRoleToDisplay(cfgRole) : null;
      if(displayRole && CURRENT_USER.role !== displayRole){
        CURRENT_USER.role = displayRole;
        if(Array.isArray(AUTH_USERS)){
          var idx = AUTH_USERS.findIndex(function(u){ return u.id === CURRENT_USER.id; });
          if(idx >= 0) AUTH_USERS[idx].role = displayRole;
        }
        if(typeof saveUsers === 'function'){ try { saveUsers(); } catch(e){} }
      }
    }
  } catch(e){ console.warn('vx: role sync at boot failed', e); }

  if(CURRENT_USER && AUTH_USERS.find(u=>u.id===CURRENT_USER.id)) {
    bootApp();
  } else {
    clearSession();
    // V13: brand-new visitors land on the Register tab. They can flip to Sign in
    // or click "Preview without an account →" to enter trial preview mode.
    if(AUTH_USERS.length===0 || (AUTH_USERS.length===1 && AUTH_USERS[0].id==='guest-preview')) {
      const regTab = document.querySelectorAll('.login-tab')[0];   // First tab is now "Start free trial"
      if(regTab) regTab.click();
    }
  }

  // Wire up numbering preview inputs after DOM ready
  ['num-prefix','num-sep','num-year','num-digits','num-next'].forEach(id=>{
    const e=el(id); if(e) e.addEventListener('input',renderNumberingPreview);
  });
})();


