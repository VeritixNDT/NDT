// ══════════════════════════════════════════════════════════════════════════
// ADMIN WORKSPACE — one admin-only top button (page-admin) that consolidates
// Home (dashboard), Reports, Inbox, Defects, Jobs, Customers, Planner and
// Billing behind a single side menu. Rather than duplicate each page's markup,
// every section RELOCATES the existing page's DOM node into #admin-mount and
// calls that page's existing render fn — the render fns look their elements up
// by id (el()/getElementById), which works regardless of the node's parent.
// On leaving a section (or navigating away via showPage → adminRestore), the
// node is moved back to where it came from so the rest of the app still finds
// it. See vxApplyRoleGating (shows the button for admins) and showPage (calls
// adminRestore + adminInit).
// ══════════════════════════════════════════════════════════════════════════

var _adminCurrent = 'home';
var _adminMounted = null;   // the node currently relocated into #admin-mount

// section → { sel: node to relocate, render: () => void }
// Home and Customers relocate a sub-node (a `.ss`) rather than the whole page so
// we never nest a second side menu inside the Admin one.
function _adminMap(){
  return {
    home:      { sel: '#ov-dashboard', render: () => {
                   if(typeof ovRefreshDashboard === 'function') ovRefreshDashboard();
                   if(typeof ovRenderGettingStarted === 'function') ovRenderGettingStarted();
                   if(typeof plRenderUpcoming === 'function') plRenderUpcoming();
                 } },
    reports:   { sel: '#page-reports', render: () => { if(typeof rptInit === 'function') rptInit(); } },
    inbox:     { sel: '#page-inbox',   render: () => { if(typeof inboxRender === 'function') inboxRender('inbox'); } },
    defects:   { sel: '#page-defects', render: () => { if(typeof defInit === 'function') defInit(); } },
    jobs:      { sel: '#page-jobs',    render: () => { if(typeof jobsInit === 'function') jobsInit(); } },
    customers: { sel: '#ss-customers', render: () => { if(typeof custRender === 'function') custRender(); } },
    planner:   { sel: '#page-planner', render: () => { if(typeof plInit === 'function') plInit(); } },
    billing:   { sel: '#page-billing', render: () => { if(typeof billingInit === 'function') billingInit(); } },
  };
}

// Move the currently-mounted node back to its original parent and hide it, so
// the standalone pages (and Settings → Customers) keep working when reached by
// any other path. Called at the top of showPage and before each section swap.
function adminRestore(){
  const node = _adminMounted;
  _adminMounted = null;
  if(!node) return;
  node.classList.remove('active');
  const o = node._adminOrigin;
  if(o && o.parent){
    if(o.next && o.next.parentNode === o.parent) o.parent.insertBefore(node, o.next);
    else o.parent.appendChild(node);
  }
}

function adminShowSection(key, btn){
  const map = _adminMap();
  const entry = map[key] || map.home;
  const mount = document.getElementById('admin-mount');
  if(!mount) return;
  // Put any previously-mounted node back first.
  adminRestore();
  const node = document.querySelector(entry.sel);
  if(node){
    // Capture the node's home position once so adminRestore can return it.
    if(!node._adminOrigin) node._adminOrigin = { parent: node.parentNode, next: node.nextSibling };
    mount.appendChild(node);
    node.classList.add('active');        // .page.active{display:flex} / .ss.active{display:block}
    _adminMounted = node;
  }
  // The block-level sections (dashboard, customers) want the usual page padding;
  // the full .page sections manage their own padding/scroll, so the mount is bare.
  mount.style.padding = (key === 'home' || key === 'customers') ? '20px 24px' : '0';
  // Side-menu active state.
  document.querySelectorAll('#admin-snav .snav-item').forEach(b => b.classList.remove('active'));
  const navBtn = btn || document.getElementById('admni-' + key);
  if(navBtn) navBtn.classList.add('active');
  _adminCurrent = key;
  try { entry.render(); } catch(e){ console.error('admin section render failed:', key, e); }
  if(typeof a11yWireLabels === 'function') a11yWireLabels(mount);
}

// Entry point (showPage('admin')). Re-opens the last section.
function adminInit(){
  adminShowSection(_adminCurrent || 'home', document.getElementById('admni-' + (_adminCurrent || 'home')));
}

// New report from the admin side menu. The new-report FORM only has a host in
// the Overview / Inspector pages (not the admin mount), so switch to Overview
// first — otherwise ovNewReport activates the form inside the hidden
// #page-overview and nothing appears. Then open the method picker there.
function adminNewReport(){
  if(typeof showPage === 'function') showPage('overview', document.getElementById('tn-home'));
  if(typeof ovNewReportPicker === 'function') ovNewReportPicker('ov');
}
