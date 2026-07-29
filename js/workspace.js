// ══════════════════════════════════════════════════════════════════════════
// Workspace — org-level identity: the org name, its pill and sidebar block.
// ══════════════════════════════════════════════════════════════════════════
// Split out of js/platform.js (fifth slice, after storage.js, auth.js,
// platform-ui.js and api.js).
//
// The four top-level statements here attach listeners and observers only —
// a cross-tab `storage` listener, a data-theme MutationObserver, and two
// window event listeners — and every function their callbacks name is
// declared in this file. No evaluation-order dependency travels with them.
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

/** Update the topbar workspace pill (legacy — the pill is now hidden in
 *  HTML and the workspace name lives in the sidebar block instead, but
 *  the function survives for any callers that pass through here. Sidebar
 *  is updated via vxRenderSidebarOrgBlock for the new path.) */
function _vxUpdateOrgPill(name){
  var pill = document.getElementById('vx-org-pill');
  if(pill){
    var label = document.getElementById('vx-org-pill-name');
    if(name && String(name).trim()){
      if(label) label.textContent = String(name).trim();
      // Pill itself is hidden via the inline `hidden` attribute now —
      // updating textContent is harmless and keeps any debug inspection
      // showing the live workspace name on the (invisible) element.
    } else {
      if(label) label.textContent = '';
    }
  }
  // Sidebar block — the actual user-visible workspace identity now.
  if(typeof vxRenderSidebarOrgBlock === 'function') vxRenderSidebarOrgBlock(name);
}

/** Render the workspace block at the top of each sidebar — company logo
 *  on top, workspace name below. Reads the logo straight from the local
 *  company entity (so it stays in sync with Settings → Company even when
 *  offline); the name comes from the cloud workspace record and is
 *  passed in by _vxUpdateOrgPill / vxLoadOrgName.
 *
 *  When neither logo nor name is set, hides the whole block via
 *  .is-empty so the sidebar header stays clean for first-run users.
 *  Safe to call before the sidebar HTML is in the DOM — bails out
 *  quietly per element. */
function vxRenderSidebarOrgBlock(name){
  var primarySrc = '';
  var darkSrc = '';
  var invertOnDark = false;
  var useOnSystem = 'primary';
  try {
    if(typeof ls === 'function' && typeof KEYS !== 'undefined' && KEYS && KEYS.company){
      var c = ls(KEYS.company, {}) || {};
      if(c && c.logo)     primarySrc = String(c.logo);
      if(c && c.logoDark) darkSrc    = String(c.logoDark);
      invertOnDark = !!(c && c.logoInvertOnDark);
      if(c && c.logoUseOnSystem === 'dark') useOnSystem = 'dark';
    }
  } catch(e){}
  // The 'Use on system' checkbox in Settings → Company → Logo area is
  // the source of truth for which slot fills the sidebar. Falls back to
  // the other slot when the chosen one is empty, then applies the
  // invert filter on dark themes if the inspector ticked the toggle
  // (so the legacy invert-only path still works for users who haven't
  // uploaded a dark variant).
  var isLightTheme = (document.documentElement.getAttribute('data-theme') === 'light');
  var logoSrc;
  var useInvert = false;
  if(useOnSystem === 'dark' && darkSrc){
    logoSrc = darkSrc;
  } else {
    logoSrc = primarySrc || darkSrc;
    // Invert only when actually showing the primary on a dark theme
    // (a dark slot already gets the light/white variant; inverting it
    // would un-do what the user uploaded). Light theme never inverts.
    if(!isLightTheme && invertOnDark && logoSrc === primarySrc) useInvert = true;
  }
  var nameStr = (name && String(name).trim()) ? String(name).trim() : '';

  // Topbar company logo — the single, fixed-size home for brand identity,
  // grouped with the account menu and unaffected by sidebar collapse.
  // Shows the logo when one is configured, otherwise hides (the sidebar
  // header below still carries the workspace NAME as the text identifier).
  var topLogo = document.getElementById('topbar-org-logo');
  if(topLogo){
    if(logoSrc){
      if(useInvert) topLogo.classList.add('is-inverted');
      else          topLogo.classList.remove('is-inverted');
      topLogo.innerHTML = '<img src="' + logoSrc.replace(/"/g, '&quot;') + '" alt="Company logo"/>';
      topLogo.style.display = '';
    } else {
      topLogo.innerHTML = '';
      topLogo.classList.remove('is-inverted');
      topLogo.style.display = 'none';
    }
  }

  // Sidebar header now shows the workspace NAME only (the logo moved to
  // the topbar above, so it no longer gets squeezed into the 56px
  // collapsed rail). Click target unchanged — the block still routes to
  // Settings → Company. When collapsed (and name-only), the existing
  // `.snav-org-block.no-logo-mode` collapse rule hides it cleanly.
  var blockIds = ['ov-snav-org-block', 'stg-snav-org-block', 'insp-snav-org-block', 'admin-snav-org-block'];
  for(var i = 0; i < blockIds.length; i++){
    var block = document.getElementById(blockIds[i]);
    if(!block) continue;
    var logoEl = block.querySelector('.snav-org-logo');
    var nameEl = block.querySelector('.snav-org-name');
    // Name-only: clear/collapse the logo slot (logo lives in the topbar
    // now) and surface the workspace name as the sidebar identifier.
    if(logoEl){
      logoEl.innerHTML = '';
      logoEl.classList.remove('is-placeholder', 'is-inverted');
    }
    if(nameEl) nameEl.textContent = nameStr;
    block.classList.add('no-logo-mode');
    // Hide the whole block when there's no name to show — keeps the
    // sidebar header clean for first-run / signed-out users (the topbar
    // logo, if any, still carries identity). Reappears once a name is set.
    if(!nameStr) block.classList.add('is-empty');
    else         block.classList.remove('is-empty');
  }
}

// Listen for cross-tab company changes so the sidebar logo refreshes
// when the user uploads a new logo in another tab. Storage event fires
// only in OTHER tabs (not the one that wrote) so the in-tab refresh
// path is handled by settings.js calling vxRenderSidebarOrgBlock
// directly after logoSetPreview / logoRemove.
try {
  window.addEventListener('storage', function(e){
    if(!e || !e.key) return;
    if(typeof KEYS !== 'undefined' && KEYS && e.key === KEYS.company){
      var pillName = document.getElementById('vx-org-pill-name');
      var n = pillName ? pillName.textContent : '';
      vxRenderSidebarOrgBlock(n);
    }
  });
} catch(_e){}

// Theme-switch reactivity. apApplyTheme writes data-theme onto <html>
// when the user picks a non-dark theme (and removes it for dark). We
// observe that attribute so the sidebar swaps its logo source between
// the primary (light) and dark variants the moment Appearance settings
// flips themes — no reload, no re-render of the whole sidebar.
try {
  var _themeObserver = new MutationObserver(function(muts){
    for(var i = 0; i < muts.length; i++){
      if(muts[i].attributeName === 'data-theme'){
        var pillName = document.getElementById('vx-org-pill-name');
        vxRenderSidebarOrgBlock(pillName ? pillName.textContent : '');
        return;
      }
    }
  });
  _themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
} catch(_e){}

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


// ── Dispatch registration — see vxActions in js/constants.js.
// Registered here with the declarations: platform.js loads first, so
// registering these there would reference them before this file has run.
vxActions({
  vxOpenWorkspaceSettings, vxSaveOrgName,
});
