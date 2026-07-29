// ══════════════════════════════════════════════════════════════════════════
// Gating — what the user is allowed to see, by device class and by role.
// ══════════════════════════════════════════════════════════════════════════
// Split out of js/platform.js (eighth slice). Two related concerns: hiding
// desktop-only features on touch/small screens, and role-based access to the
// admin-only settings sections.
//
// Its one top-level statement publishes vxDiagnostics on window for console
// use; the function is hoisted, so the assignment carries no ordering
// dependency. Consumers span boot, ui, settings, reports, dashboard, planner,
// admin, cad-editor and workspace — this is a widely used seam, which is why
// it deserves its own file rather than sitting inside the platform core.
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

