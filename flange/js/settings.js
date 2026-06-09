// ══════════════════════════════════════════════════════════════════════════
// VERITIX FLANGE — Settings: Company, reference lists, local users.
// ══════════════════════════════════════════════════════════════════════════
function settingsInit(){ showSS('company', el('sni-company')); }

// ── Company ───────────────────────────────────────────────────────────────────
function stgRenderCompany(){
  var c = fmCompany();
  var s = ls(KEYS.settings, {});
  var host = el('ss-company'); if(!host) return;
  host.innerHTML =
    '<div class="sh"><div class="sh-left"><div class="sc-title" style="font-size:18px">Company</div><div style="color:var(--t3);font-size:13px;margin-top:4px">Your workspace identity and appearance.</div></div></div>' +
    '<div class="sc" style="max-width:560px"><div class="sc-body"><div class="fm-grid">' +
      '<div class="fld full"><label>Company / workspace name</label><input id="cmp-name" type="text" value="' + escapeHtml(c.name||'') + '" placeholder="e.g. Acme Joint Integrity"/></div>' +
      '<div class="fld full"><label>Logo</label><input id="cmp-logo" type="file" accept="image/*" data-on-change="stgLogoPick"/>' + (c.logo ? '<img src="' + escapeHtml(c.logo) + '" alt="logo" style="margin-top:8px;max-height:48px;max-width:180px;border:1px solid var(--border);border-radius:6px;padding:4px;background:var(--bg2)"/>' : '') + '</div>' +
      '<div class="fld"><label>Theme</label><select id="cmp-theme">' + ['dark','light'].map(function(t){ return '<option value="' + t + '"' + ((s.theme||'dark')===t?' selected':'') + '>' + (t==='dark'?'Dark':'Light') + '</option>'; }).join('') + '</select></div>' +
    '</div><div class="fm-form-actions"><button class="btn btn-primary" data-action="stgSaveCompany">Save</button></div></div></div>';
}
var _stgPendingLogo = null;
function stgLogoPick(inp){
  var f = inp.files && inp.files[0]; if(!f) return;
  var r = new FileReader(); r.onload = function(){ _stgPendingLogo = r.result; toast('Logo selected — click Save.', 'info'); }; r.readAsDataURL(f);
}
function stgSaveCompany(){
  var c = fmCompany();
  c.name = (el('cmp-name').value||'').trim();
  if(_stgPendingLogo){ c.logo = _stgPendingLogo; _stgPendingLogo = null; }
  lss(KEYS.company, c);
  var s = ls(KEYS.settings, {}); s.theme = el('cmp-theme').value; lss(KEYS.settings, s);
  applyTheme();
  set('fm-workspace-name', c.name || 'Veritix Flange');
  toast('Company settings saved.', 'success');
  stgRenderCompany();
}

// ── Reference lists ───────────────────────────────────────────────────────────
function stgRenderLists(){
  var host = el('ss-lists'); if(!host) return;
  function chips(title, arr){ return '<div class="sc" style="margin-bottom:14px"><div class="sc-head"><span class="sc-title">' + title + '</span></div><div class="sc-body"><div style="display:flex;gap:8px;flex-wrap:wrap">' + arr.map(function(v){ return '<span class="badge badge-muted" style="font-size:12px;padding:4px 10px">' + escapeHtml(v) + '</span>'; }).join('') + '</div></div></div>'; }
  host.innerHTML =
    '<div class="sh"><div class="sh-left"><div class="sc-title" style="font-size:18px">Reference lists</div><div style="color:var(--t3);font-size:13px;margin-top:4px">The standard option sets used across the joint register.</div></div></div>' +
    chips('Joint statuses', JNT_STATUSES) +
    chips('Pressure classes', JNT_RATINGS.map(function(r){ return 'Class ' + r; })) +
    chips('Flange faces', JNT_FACES) +
    chips('Gasket types', JNT_GASKETS) +
    chips('Bolt grades', JNT_GRADES) +
    chips('Tightening methods', JNT_METHODS) +
    chips('Tool types', TOOL_TYPES) +
    chips('Technician competencies', TECH_COMPS) +
    chips('Punch types', PUNCH_TYPES);
}

// ── Users ─────────────────────────────────────────────────────────────────────
function usersGetAll(){ return ls(KEYS.users, []) || []; }
function stgRenderUsers(){
  var host = el('ss-users'); if(!host) return;
  var users = usersGetAll();
  var rows = users.map(function(u){
    var isSelf = CURRENT_USER && u.id === CURRENT_USER.id;
    return '<tr><td style="font-weight:600">' + escapeHtml(u.name) + (isSelf?' <span class="badge badge-cyan" style="font-size:9px">you</span>':'') + '</td><td style="font-family:var(--mono);font-size:12px">' + escapeHtml(u.email) + '</td><td><span class="badge badge-blue">' + escapeHtml(u.role||'Admin') + '</span></td><td>' + (isSelf?'':'<button class="btn btn-sm btn-danger" data-action="userDelete" data-args="\'' + u.id + '\'">Remove</button>') + '</td></tr>';
  }).join('');
  host.innerHTML =
    '<div class="sh"><div class="sh-left"><div class="sc-title" style="font-size:18px">Users</div><div style="color:var(--t3);font-size:13px;margin-top:4px">Local accounts for this prototype (stored on this device).</div></div></div>' +
    '<div class="sc" style="margin-bottom:14px"><div class="sc-body" style="padding:0;overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
    '<div class="sc" style="max-width:560px"><div class="sc-head"><span class="sc-title">Add user</span></div><div class="sc-body"><div class="fm-grid">' +
      _fld('Full name', 'usr-name', '', 'e.g. Sam Senior') +
      _fld('Email', 'usr-email', '', 'you@company.com', 'email') +
      _fld('Password', 'usr-pwd', '', 'min 4 chars', 'password') +
      _sel('Role', 'usr-role', 'Technician', ['Admin','Senior','Technician','Viewer']) +
    '</div><div class="fm-form-actions"><button class="btn btn-primary" data-action="userAdd">Add user</button></div></div></div>';
}
function userAdd(){
  var name = (el('usr-name').value||'').trim();
  var email = (el('usr-email').value||'').trim().toLowerCase();
  var pwd = (el('usr-pwd').value||'');
  if(!name || !email || pwd.length < 4){ toast('Name, email and a 4+ char password are required.', 'error'); return; }
  var users = usersGetAll();
  if(users.some(function(u){ return (u.email||'').toLowerCase() === email; })){ toast('That email already exists.', 'error'); return; }
  users.push({ id: vxNewId(), name:name, email:email, pwd:pwd, role:el('usr-role').value, createdAt:new Date().toISOString() });
  lss(KEYS.users, users);
  toast('User added.', 'success');
  stgRenderUsers();
}
async function userDelete(id){
  var u = usersGetAll().find(function(x){ return x.id === id; });
  if(!u) return;
  if(CURRENT_USER && id === CURRENT_USER.id){ toast("You can't remove your own account.", 'error'); return; }
  if(!await fmConfirm({ title:'Remove user', message:'Remove ' + (u.name||'this user') + '?', okLabel:'Remove', danger:true })) return;
  lss(KEYS.users, usersGetAll().filter(function(x){ return x.id !== id; }));
  stgRenderUsers();
  toast('User removed.');
}
