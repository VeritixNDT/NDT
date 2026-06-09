// ══════════════════════════════════════════════════════════════════════════
// VERITIX FLANGE — auth + boot. Minimal LOCAL login (no cloud): users live in
// localStorage, password compared in the clear (local prototype only). A
// default admin is seeded on first run so the app is usable immediately.
// ══════════════════════════════════════════════════════════════════════════

function seedDefaults(){
  var users = ls(KEYS.users, null);
  if(!users || !users.length){
    users = [{ id: vxNewId(), name: 'Administrator', email: 'admin@flange.local', pwd: 'admin', role: 'Admin', createdAt: new Date().toISOString() }];
    lss(KEYS.users, users);
  }
  if(!ls(KEYS.company, null)){
    lss(KEYS.company, { name: 'Demo Joint Integrity Co.' });
  }
}

function bootApp(){
  applyTheme();
  seedDefaults();
  // Stamp build into any footer slots.
  document.querySelectorAll('.fm-build-stamp').forEach(function(s){ s.textContent = 'build ' + FM_BUILD; });
  document.querySelectorAll('.fm-copyright-year').forEach(function(s){ s.textContent = String(new Date().getFullYear()); });

  var sess = ls(KEYS.session, null);
  var user = sess && (ls(KEYS.users, []) || []).find(function(u){ return u.id === sess.id; });
  if(user){ enterApp(user); }
  else { showLogin(); }
}

function showLogin(){
  var ls0 = el('login-screen'); if(ls0) ls0.classList.remove('hidden');
}

function enterApp(user){
  CURRENT_USER = user;
  var ls0 = el('login-screen'); if(ls0) ls0.classList.add('hidden');
  // Profile chrome
  set('fm-user-name', user.name || '—');
  set('fm-user-role', user.role || '—');
  var av = el('fm-avatar'); if(av) av.textContent = initials(user.name);
  showPage('dashboard', el('tn-dashboard'));
}

function doLogin(){
  var email = (el('li-email') && el('li-email').value || '').trim().toLowerCase();
  var pwd   = (el('li-pwd') && el('li-pwd').value || '');
  var errEl = el('li-err'); if(errEl) errEl.textContent = '';
  var user = (ls(KEYS.users, []) || []).find(function(u){ return (u.email || '').toLowerCase() === email; });
  if(!user || user.pwd !== pwd){
    if(errEl) errEl.textContent = 'Incorrect email or password.';
    return;
  }
  lss(KEYS.session, { id: user.id, at: new Date().toISOString() });
  enterApp(user);
  toast('Welcome back, ' + (user.name.split(' ')[0] || 'there') + '.', 'success');
}

function togglePwdVis(btn){
  var inp = btn && btn.parentElement && btn.parentElement.querySelector('input');
  if(inp) inp.type = inp.type === 'password' ? 'text' : 'password';
}

async function signOut(){
  if(!await fmConfirm({ title: 'Sign out', message: 'Sign out of Veritix Flange?', okLabel: 'Sign out' })) return;
  localStorage.removeItem(KEYS.session);
  CURRENT_USER = null;
  showLogin();
  var pd = el('fm-profile-menu'); if(pd) pd.style.display = 'none';
}

function toggleProfileMenu(){
  var pd = el('fm-profile-menu'); if(!pd) return;
  pd.style.display = pd.style.display === 'block' ? 'none' : 'block';
}
document.addEventListener('click', function(e){
  var pd = el('fm-profile-menu'); if(!pd || pd.style.display !== 'block') return;
  if(e.target.closest('#fm-profile-menu') || e.target.closest('#fm-avatar-btn')) return;
  pd.style.display = 'none';
});

// Boot once the DOM is parsed (defer scripts run before DOMContentLoaded).
window.addEventListener('DOMContentLoaded', bootApp);
