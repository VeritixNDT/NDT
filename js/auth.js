// ══════════════════════════════════════════════════════════════════════════
// Authentication & account — sign-in/up, password reset, SSO, MFA, plan UI.
// ══════════════════════════════════════════════════════════════════════════
// Split out of js/platform.js (second slice; the first was js/storage.js).
// Both blocks were pure declarations with no top-level executable statements,
// so moving them cannot change evaluation order.
//
// This layer sits ON TOP of the Supabase glue — since the tenth slice that is
// its own file, js/supabase.js — and calls into it (_vxSupabase,
// _vxApplySupabaseSession) as well as vxPlatformSet. That direction of
// dependency is the point: supabase.js owns the client, this owns what the user
// does with it — which is why it loads after both.
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
    // V48: reports migrate as per-report rows, not one blob. Enqueue them and
    // let the post-migration vxSyncFlush() drain the queue.
    if(key === 'vx-reports-v1'){
      try { vxSyncEnqueueReports(ls('vx-reports-v1', [])); _vxClearDirty('vx-reports-v1'); migrated++; }
      catch(e){ failed++; }
      continue;
    }
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
  try { await vxNumberPendingDrafts(); } catch(e){}   // V48: number any offline drafts
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

// ── SSO (OAuth) + MFA (TOTP), via Supabase Auth ──────────────────────────────
async function doOAuth(provider){
  const sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
  const err = el('li-err');
  if(!sb || !sb.auth || typeof sb.auth.signInWithOAuth !== 'function'){ if(err){ err.textContent = 'Cloud sign-in is unavailable.'; err.classList.add('show'); } return; }
  try {
    const r = await sb.auth.signInWithOAuth({ provider: provider, options: { redirectTo: location.origin + location.pathname } });
    if(r.error){ if(err){ err.textContent = r.error.message; err.classList.add('show'); } }
    // On success the browser redirects to the provider; the callback lands back
    // here and the boot path picks up the session.
  } catch(e){ if(err){ err.textContent = String(e.message || e); err.classList.add('show'); } }
}

// Small modal helper for the MFA flows. Resolves with done(v) or null.
function _vxMfaOverlay(innerHtml, onMount){
  return new Promise(function(resolve){
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:7000;background:rgba(12,18,32,.6);display:flex;align-items:center;justify-content:center;padding:18px';
    ov.innerHTML = '<div style="background:var(--panel,#fff);color:var(--t1);border-radius:14px;max-width:420px;width:100%;padding:22px;box-shadow:0 12px 40px rgba(0,0,0,.4);font-family:inherit">' + innerHtml + '</div>';
    document.body.appendChild(ov);
    var done = function(v){ try { ov.remove(); } catch(e){} resolve(v); };
    ov.addEventListener('click', function(e){ if(e.target === ov) done(null); });
    if(typeof onMount === 'function') onMount(ov, done);
  });
}
function _vxMfaCodeField(ov, done){
  var inp = ov.querySelector('#vxmfa-code');
  ov.querySelector('#vxmfa-cancel').addEventListener('click', function(){ done(null); });
  ov.querySelector('#vxmfa-ok').addEventListener('click', function(){ var v = (inp.value || '').replace(/\D/g, ''); if(v.length !== 6){ inp.style.borderColor = '#dc2626'; inp.focus(); return; } done(v); });
  inp.addEventListener('keydown', function(e){ if(e.key === 'Enter') ov.querySelector('#vxmfa-ok').click(); });
  setTimeout(function(){ try { inp.focus(); } catch(e){} }, 30);
}
var _VXMFA_INPUT = '<input id="vxmfa-code" inputmode="numeric" maxlength="6" placeholder="123456" style="width:100%;box-sizing:border-box;text-align:center;letter-spacing:4px;font-size:18px;padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:14px;background:var(--bg2);color:var(--t1)">';
var _VXMFA_BTNS = '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-sm" id="vxmfa-cancel">Cancel</button><button class="btn btn-primary btn-sm" id="vxmfa-ok">Verify</button></div>';
function _vxMfaEnrollPrompt(qrSvg, secret, uri){
  // Prefer rendering our OWN QR from the otpauth:// URI with the bundled qrcode
  // library (cvRenderQR) — clean, correctly-margined and reliably scannable.
  // Supabase's own QR is a data:image/svg+xml;utf-8,<svg…> URI with the SVG
  // UN-encoded, which frequently won't load in an <img> (and forcing it to fit
  // can distort the modules). Fall back to that inline SVG, then to <img>.
  var qrHtml = '';
  if(uri && typeof cvRenderQR === 'function' && typeof window.qrcode === 'function'){
    qrHtml = '<div style="width:200px;height:200px;line-height:0">' + cvRenderQR(uri, 200) + '</div>';
  } else if(qrSvg){
    var ci = qrSvg.indexOf(',');
    if(/^data:image\/svg\+xml/i.test(qrSvg) && ci >= 0){
      var svg = qrSvg.slice(ci + 1);
      try { if(/%3c/i.test(svg)) svg = decodeURIComponent(svg); } catch(e){}
      qrHtml = '<div style="width:180px;height:180px;line-height:0">' + svg.replace(/<svg /i, '<svg style="width:100%;height:100%" ') + '</div>';
    } else {
      qrHtml = '<img src="' + String(qrSvg).replace(/"/g, '&quot;') + '" alt="QR" style="width:180px;height:180px"/>';
    }
  }
  return _vxMfaOverlay(
    '<div style="font-size:16px;font-weight:700;margin-bottom:4px">Set up two-factor authentication</div>'
    + '<div style="font-size:12.5px;color:var(--t3);margin-bottom:12px">Scan with an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code.</div>'
    + '<div style="display:flex;justify-content:center;margin-bottom:10px;background:#fff;border-radius:10px;padding:10px">' + qrHtml + '</div>'
    + '<div style="font-size:11px;color:var(--t3);text-align:center;margin-bottom:12px">Or enter this key manually:<br><span style="font-family:var(--mono);font-size:12px;color:var(--t1);word-break:break-all">' + escapeHtml(secret || '') + '</span></div>'
    + _VXMFA_INPUT + _VXMFA_BTNS, _vxMfaCodeField);
}
function _vxMfaCodePrompt(){
  return _vxMfaOverlay(
    '<div style="font-size:16px;font-weight:700;margin-bottom:4px">Two-factor authentication</div>'
    + '<div style="font-size:12.5px;color:var(--t3);margin-bottom:14px">Enter the 6-digit code from your authenticator app.</div>'
    + _VXMFA_INPUT + _VXMFA_BTNS, _vxMfaCodeField);
}
// If the user has a verified factor but the session is only AAL1, challenge for
// the code. Returns true to proceed, false to block (cancelled/failed).
async function vxMfaEnsureAAL2(){
  var sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
  if(!sb || !sb.auth || !sb.auth.mfa) return true;
  try {
    var aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    var d = aal && aal.data;
    if(!d || d.nextLevel !== 'aal2' || d.nextLevel === d.currentLevel) return true;
    var fl = await sb.auth.mfa.listFactors();
    var totps = (fl.data && fl.data.totp) || [];
    var factor = totps.filter(function(x){ return x.status === 'verified'; })[0] || totps[0];
    if(!factor) return true;
    var code = await _vxMfaCodePrompt();
    if(!code) return false;
    var ch = await sb.auth.mfa.challenge({ factorId: factor.id });
    if(ch.error) return false;
    var v = await sb.auth.mfa.verify({ factorId: factor.id, challengeId: ch.data.id, code: code });
    if(v.error){ toast('Incorrect code.', 'error'); return false; }
    return true;
  } catch(e){ console.warn('mfa check failed', e); return true; }
}
async function vxMfaEnroll(){
  var sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
  if(!sb || !sb.auth || !sb.auth.mfa){ toast('Cloud sign-in required for 2FA.', 'error'); return; }
  var en = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator-' + Date.now().toString(36) });
  if(en.error){ toast(en.error.message, 'error'); return; }
  var factorId = en.data.id;
  var qr = en.data.totp && en.data.totp.qr_code, secret = en.data.totp && en.data.totp.secret;
  var uri = en.data.totp && en.data.totp.uri;
  var code = await _vxMfaEnrollPrompt(qr, secret, uri);
  if(!code){ try { await sb.auth.mfa.unenroll({ factorId: factorId }); } catch(e){} return; }
  var ch = await sb.auth.mfa.challenge({ factorId: factorId });
  if(ch.error){ toast(ch.error.message, 'error'); try { await sb.auth.mfa.unenroll({ factorId: factorId }); } catch(e){} return; }
  var v = await sb.auth.mfa.verify({ factorId: factorId, challengeId: ch.data.id, code: code });
  if(v.error){ toast('Incorrect code — please try again.', 'error'); try { await sb.auth.mfa.unenroll({ factorId: factorId }); } catch(e){} return; }
  toast('Two-factor authentication enabled.', 'success');
  openMfaModal();
}
async function vxMfaUnenroll(factorId){
  var sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
  if(!sb || !sb.auth || !sb.auth.mfa) return;
  if(typeof vxConfirm === 'function'){ if(!await vxConfirm({ message: 'Turn off two-factor authentication?', okLabel: 'Turn off', danger: true })) return; }
  var r = await sb.auth.mfa.unenroll({ factorId: factorId });
  if(r.error){ toast(r.error.message, 'error'); return; }
  toast('Two-factor authentication disabled.');
  openMfaModal();
}
async function openMfaModal(){
  var existing = document.getElementById('vx-mfa-modal'); if(existing) existing.remove();
  var sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
  if(!sb || !sb.auth || !sb.auth.mfa){ toast('Cloud sign-in required for 2FA.', 'error'); return; }
  var fl = await sb.auth.mfa.listFactors();
  var totps = ((fl.data && fl.data.totp) || []).filter(function(x){ return x.status === 'verified'; });
  var body;
  if(totps.length){
    body = '<div style="font-size:12.5px;color:#16a34a;font-weight:600;margin-bottom:10px">✓ Two-factor authentication is on.</div>'
      + '<div style="font-size:12px;color:var(--t3);margin-bottom:14px">You\'ll be asked for a code from your authenticator app when you sign in.</div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-sm" id="vxmfa-close">Close</button><button class="btn btn-sm btn-danger" id="vxmfa-off">Turn off</button></div>';
  } else {
    body = '<div style="font-size:12.5px;color:var(--t3);margin-bottom:14px">Add a second step at sign-in with an authenticator app — protects your account even if your password is stolen.</div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-sm" id="vxmfa-close">Close</button><button class="btn btn-primary btn-sm" id="vxmfa-on">Enable 2FA</button></div>';
  }
  var ov = document.createElement('div');
  ov.id = 'vx-mfa-modal';
  ov.style.cssText = 'position:fixed;inset:0;z-index:6500;background:rgba(12,18,32,.6);display:flex;align-items:center;justify-content:center;padding:18px';
  ov.innerHTML = '<div style="background:var(--panel,#fff);color:var(--t1);border-radius:14px;max-width:420px;width:100%;padding:22px;box-shadow:0 12px 40px rgba(0,0,0,.4)"><div style="font-size:16px;font-weight:700;margin-bottom:8px">Two-factor authentication</div>' + body + '</div>';
  document.body.appendChild(ov);
  var close = function(){ try { ov.remove(); } catch(e){} };
  ov.addEventListener('click', function(e){ if(e.target === ov) close(); });
  var cl = ov.querySelector('#vxmfa-close'); if(cl) cl.addEventListener('click', close);
  var on = ov.querySelector('#vxmfa-on'); if(on) on.addEventListener('click', function(){ close(); vxMfaEnroll(); });
  var off = ov.querySelector('#vxmfa-off'); if(off) off.addEventListener('click', function(){ close(); if(totps[0]) vxMfaUnenroll(totps[0].id); });
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
      // MFA: if a verified TOTP factor exists, require the code before entering.
      if(typeof vxMfaEnsureAAL2 === 'function'){
        const mfaOk = await vxMfaEnsureAAL2();
        if(!mfaOk){
          try { await _vxSupabase().auth.signOut(); } catch(e){}
          err.textContent = t('validation.mfa_failed','Two-factor verification was cancelled or failed.');
          err.classList.add('show');
          if(btn && origLabel){ btn.disabled = false; btn.textContent = origLabel; }
          return;
        }
      }
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

  // Local fallback for legacy trial accounts. Only reached when the cloud
  // call errored at the network/server level (status 0 or >=500) or threw —
  // genuine 401/403 already returned above. Don't masquerade as a normal
  // sign-in: a stale local account can carry lower privilege than the user's
  // real cloud role (this is what silently kept Carl at local Inspector
  // instead of cloud admin). Make the offline downgrade explicit.
  const hash = await sha256(pwd);
  const user = AUTH_USERS.find(u=>u.email===email && u.pwd===hash);
  if(!user){ err.textContent=t('validation.invalid_creds','Incorrect email or password.'); err.classList.add('show'); return; }
  CURRENT_USER = user;
  user.lastLogin = new Date().toISOString();
  saveUsers();
  saveSession(user.id);
  // If the cloud is configured, the user expected a cloud sign-in — tell them
  // plainly that they're offline/local-only so a missing admin tool or unsynced
  // change is never a silent surprise.
  if(typeof vxSupabaseConfigured === 'function' && vxSupabaseConfigured()){
    toast(t('toast.signed_in_local','Couldn\'t reach Veritix Cloud — signed in offline (local only). Admin tools and sync are unavailable until you reconnect.'), 'warn');
  }
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



// ══════════════════════════════════════════════════════════════════════════
// Local session and account email, moved out of js/platform.js (final slice).
// ══════════════════════════════════════════════════════════════════════════
// The last thing in platform.js that was not the platform: the local session
// (AUTH_USERS / KEYS.session, distinct from the Supabase session that
// supabase.js owns), the login tab switcher, signOut, and the signup / welcome
// email previews. This file already owned everything these serve.
//
// The email cluster in particular belongs nowhere else. emailTemplate(),
// showEmailModal() and showWelcomeEmail() have no callers outside the block at
// all — the only way into any of them is showConfirmEmail(), which this file
// calls from doRegister. They were four functions in an infrastructure module
// reachable solely from here.
//
// LOAD ORDER, and why this slice needed checking where the others did not. Every
// earlier slice moved code to a file loading at or before platform.js's
// position, or moved only declarations. This one moves code LATER: auth.js is
// the fifteenth app script, platform.js the eighth. A top-level call into any of
// these names from a file in between would now hit an undefined function.
//
// There are none. All thirty call sites across boot, help, settings, ui, api,
// supabase and the shell are inside function bodies or behind data-action
// attributes, which resolve through the registry at click time. Verified by
// grepping for column-0 calls, not assumed from the fact that it works.

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
// Registered here rather than in platform.js: that file loads first, so a
// registration there would reference these before this file has run. The last
// three arrived with the block above, from the call platform.js used to make.
vxActions({
  closeEmailModal, doLogin, doOAuth, doRegister, liGuestMode, openMfaModal,
  signOut, switchLoginTab, vxAuthTabSwitch, vxOpenBilling, vxOpenForgotPassword,
  vxRefreshPlan, vxRenderSubscription, vxSignOut,
});
