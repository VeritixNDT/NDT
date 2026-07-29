// ══════════════════════════════════════════════════════════════════════════
// Platform chrome — the user-facing surface of the platform layer.
// ══════════════════════════════════════════════════════════════════════════
// Deployment-mode pill, trial banner, welcome modal, sync activity modal.
// Split out of js/platform.js (third slice, after storage.js and auth.js):
// four renderers had no business sitting in an infrastructure module.
//
// The five top-level statements here are all window.addEventListener calls
// that re-render on platform/sync/online events. They attach listeners and
// nothing more, so they carry no evaluation-order dependency, and every
// function they name is declared in this file.
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

  // V44.7: "Signed in locally, cloud unreachable" state. The app keeps a
  // local CURRENT_USER session that auto-restores on launch independently of
  // the Supabase session. If this device has signed in to the cloud before
  // (vx-sb-cloud-seen) but there's no live cloud session now, the user is
  // silently running at local Inspector privilege — exactly the trap where
  // admin tools vanish with no explanation. Surface it instead of masking it.
  var cloudSeen = false;
  try { cloudSeen = localStorage.getItem('vx-sb-cloud-seen') === '1'; } catch(e){}
  var cloudOffline = (typeof vxSupabaseConfigured === 'function' && vxSupabaseConfigured())
                  && cloudSeen && !!CURRENT_USER && state !== 'authenticated';
  if(banner) return;   // already showing
  if(sessionStorage.getItem('vx-trial-banner-dismissed') === '1') return;
  banner = document.createElement('div');
  banner.id = 'vx-trial-banner';
  banner.className = 'vx-trial-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  const dirty = vxStore.dirtyKeys().length;
  const isSignedOut = state === 'signed_out';

  // V14: banner states — cloud-offline / unverified / signed_out / trial
  let bodyHtml, ctaText, ctaAction;
  if(cloudOffline) {
    bodyHtml = t('banner.cloud_offline','<strong>Signed in locally.</strong> You’re not connected to Veritix Cloud, so admin tools and sync are unavailable. Sign in to reconnect.');
    ctaText = t('app.signin','Sign in');
    ctaAction = 'vxOpenSignup';
  } else if(needsVerification) {
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
    <span class="vx-trial-banner-icon" aria-hidden="true">${(isSignedOut || needsVerification || cloudOffline)
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
  let body;
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
        <button class="btn btn-sm" data-action="_wRemoveById" data-args="'vx-sync-modal'">Close</button>
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


// ── Dispatch registration — see vxActions in js/constants.js.
// Registered here with the declarations: platform.js loads first, so
// registering these there would reference them before this file has run.
vxActions({
  vxDismissTrialBanner, vxManualSync, vxModePillClick, vxOpenSignin,
  vxOpenSignup, vxOpenSyncActivity, vxPreviewWithoutAccount,
  // Reached only through a computed name: the trial banner renders
  // data-action="${ctaAction}", so no static scan finds this one.
  vxResendVerification,
});
