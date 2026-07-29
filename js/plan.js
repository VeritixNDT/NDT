// ══════════════════════════════════════════════════════════════════════════
// Plan gates — what the current subscription tier permits.
// ══════════════════════════════════════════════════════════════════════════
// Split out of js/platform.js (eleventh slice), and the third gating concern to
// get its own file after device class and role (js/gating.js), which is why it
// loads beside them.
//
// Its three top-level statements are all declarations. `var vxPlan` closes over
// vxPlanConfig by value (`current: vxPlanConfig`), which is a hoisted function
// declaration in this same file, so the object literal is safe to evaluate at
// load wherever the file sits in the order.
//
// ON THE STATE OF THIS MODULE, measured while moving it rather than assumed.
// The comment below calls vxPlan "the single chokepoint the rest of the app
// should consult before showing or invoking a paid feature". Nothing consults
// it. Grepping every js/ file and the shell for the moved names finds only:
//
//   vxPlanConfig  — auth.js:17, to render the subscription settings page
//   vxPlanSet     — auth.js, 5 sites, storing what the server returns
//   vxPlan        — ui.js:752, the _wOpenBilling delegator
//
// So vxPlan.has(), .withinLimit(), .recordUsage() and .showPaywall() have no
// callers at all: there is no paywall in the product, and the paywall modal
// showPaywall() builds has never been rendered. This is method-level dead code,
// which tools/symbols.mjs cannot see — it resolves top-level names, and `vxPlan`
// itself IS referenced.
//
// Left in place deliberately. Whether Veritix ships plan enforcement is a
// product decision, not a refactor's to make, and this file is now the whole of
// it in one place — which is the point of moving it. See
// docs/superpowers/specs/2026-07-28-orphan-triage.md for the same shape of
// finding (a feature wired everywhere except at the one call that runs it).
var VX_PLAN_KEY = 'vx-plan-v1';          // current subscription tier + limits

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
