// ══════════════════════════════════════════════════════════════════════════
// VERITIX FLANGE — core: storage helpers, data-action delegation, navigation,
// toast + confirm. Self-contained (no NDT JS), local-only (localStorage).
// Mirrors the NDT app's conventions so the same css/styles.css renders it 1:1.
// ══════════════════════════════════════════════════════════════════════════
var FM_BUILD = '2026-06-09.1';

// localStorage keys — fm- prefix keeps them fully isolated from the NDT app's
// vx- keys when both run on the same origin during local testing.
var KEYS = {
  users:    'fm-users-v1',
  session:  'fm-session-v1',
  company:  'fm-company-v1',
  settings: 'fm-settings-v1',
  joints:   'fm-joints-v1',
  tools:    'fm-tools-v1',
  techs:    'fm-techs-v1',
  punch:    'fm-punch-v1',
  counters: 'fm-counters-v1',
};

var CURRENT_USER = null;

// ── tiny utilities ──────────────────────────────────────────────────────────
function el(id){ return document.getElementById(id); }
function set(id, txt){ var e = el(id); if(e) e.textContent = txt; }
function ls(key, fb){ try { var v = JSON.parse(localStorage.getItem(key)); return (v === null || v === undefined) ? fb : v; } catch(e){ return fb; } }
function lss(key, val){ try { localStorage.setItem(key, JSON.stringify(val)); } catch(e){ console.warn('storage write failed', key, e); } }
function vxNewId(){ return 'fm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9); }
function escapeHtml(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(d){ if(!d) return '—'; var t = new Date(d); return isNaN(t) ? '—' : t.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }); }
function daysUntil(d){ if(!d) return null; var t = new Date(d).getTime(); if(isNaN(t)) return null; return Math.ceil((t - Date.now()) / 86400000); }
function initials(name){ return (name||'?').split(/\s+/).map(function(w){ return w[0]||''; }).join('').slice(0,2).toUpperCase(); }

// Gap-free per-kind counters → human ids like JNT-0001 / P-0001.
function nextNo(kind, prefix, pad){
  var c = ls(KEYS.counters, {});
  c[kind] = (c[kind] || 0) + 1;
  lss(KEYS.counters, c);
  return prefix + String(c[kind]).padStart(pad || 4, '0');
}

// ── toast ───────────────────────────────────────────────────────────────────
function toast(msg, type){
  var host = el('toast-container');
  if(!host){ host = document.createElement('div'); host.id = 'toast-container'; document.body.appendChild(host); }
  var t = document.createElement('div');
  t.className = 'toast ' + (type || 'info');
  t.innerHTML = '<span class="toast-icon"></span><span>' + escapeHtml(msg) + '</span>';
  host.appendChild(t);
  setTimeout(function(){ t.classList.add('out'); setTimeout(function(){ t.remove(); }, 220); }, 2600);
}

// ── confirm (Promise<boolean>) — reuses .modal-overlay / .modal ───────────────
function fmConfirm(opts){
  opts = opts || {};
  return new Promise(function(resolve){
    var ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML =
      '<div class="modal" style="width:420px">' +
        '<div class="modal-head"><div class="sc-title">' + escapeHtml(opts.title || 'Please confirm') + '</div></div>' +
        '<div class="modal-body" style="font-size:13.5px;color:var(--t2);line-height:1.6">' + escapeHtml(opts.message || '') + '</div>' +
        '<div class="modal-foot">' +
          '<button class="btn" data-fm="cancel">' + escapeHtml(opts.cancelLabel || 'Cancel') + '</button>' +
          '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-fm="ok">' + escapeHtml(opts.okLabel || 'Confirm') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function(){ ov.classList.add('show'); });
    function close(val){ ov.classList.remove('show'); setTimeout(function(){ ov.remove(); }, 200); resolve(val); }
    ov.addEventListener('mousedown', function(e){
      if(e.target === ov) return close(false);
      var b = e.target.closest('[data-fm]'); if(b) close(b.getAttribute('data-fm') === 'ok');
    });
  });
}

// ── data-action event delegation ─────────────────────────────────────────────
// <button data-action="fn" data-args="1,'x'" data-pass-el="1"> → window.fn(1,'x',el)
// Inputs: data-on-input / data-on-change / data-on-keydown (+ data-key for a key gate).
function _fmParseArgs(str){
  if(!str) return [];
  try { return JSON.parse('[' + str.replace(/'/g, '"') + ']'); }
  catch(e){ return str.split(',').map(function(s){ s = s.trim(); if(/^-?\d+(\.\d+)?$/.test(s)) return Number(s); if(s === 'true') return true; if(s === 'false') return false; return s.replace(/^['"]|['"]$/g, ''); }); }
}
function _fmInvoke(node, action, ev){
  var fn = window[action];
  if(typeof fn !== 'function') return;
  var args = _fmParseArgs(node.dataset.args || '');
  if(node.dataset.passEl === '1') args.push(node);
  if(node.dataset.passEvent === '1') args.push(ev);
  try { fn.apply(node, args); } catch(e){ console.error('action failed:', action, e); }
}
document.addEventListener('click', function(e){
  var n = e.target.closest('[data-action]'); if(n) _fmInvoke(n, n.dataset.action, e);
});
document.addEventListener('change', function(e){
  var n = e.target.closest('[data-on-change]'); if(n) _fmInvoke(n, n.dataset.onChange, e);
});
document.addEventListener('input', function(e){
  var n = e.target.closest('[data-on-input]'); if(n) _fmInvoke(n, n.dataset.onInput, e);
});
document.addEventListener('keydown', function(e){
  var n = e.target.closest('[data-on-keydown]'); if(!n) return;
  if(n.dataset.key && e.key !== n.dataset.key) return;
  _fmInvoke(n, n.dataset.onKeydown, e);
});

// ── navigation ────────────────────────────────────────────────────────────────
function showPage(id, btn){
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  document.querySelectorAll('.tn').forEach(function(b){ b.classList.remove('active'); b.removeAttribute('aria-current'); });
  var pg = el('page-' + id); if(pg) pg.classList.add('active');
  if(btn){ btn.classList.add('active'); btn.setAttribute('aria-current', 'page'); }
  if(id === 'dashboard' && typeof dashInit === 'function') dashInit();
  if(id === 'joints'    && typeof jointInit === 'function') jointInit();
  if(id === 'tools'     && typeof toolInit === 'function') toolInit();
  if(id === 'techs'     && typeof techInit === 'function') techInit();
  if(id === 'punch'     && typeof punchInit === 'function') punchInit();
  if(id === 'settings'  && typeof settingsInit === 'function') settingsInit();
}
function showSS(id, btn){
  document.querySelectorAll('#page-settings .ss').forEach(function(s){ s.classList.remove('active'); });
  document.querySelectorAll('#stg-snav .snav-item').forEach(function(b){ b.classList.remove('active'); });
  var sec = el('ss-' + id); if(sec) sec.classList.add('active');
  if(btn) btn.classList.add('active');
  if(id === 'company'  && typeof stgRenderCompany === 'function') stgRenderCompany();
  if(id === 'lists'    && typeof stgRenderLists === 'function') stgRenderLists();
  if(id === 'users'    && typeof stgRenderUsers === 'function') stgRenderUsers();
}

// ── company helpers ───────────────────────────────────────────────────────────
function fmCompany(){ return ls(KEYS.company, {}) || {}; }
function applyTheme(){ var s = ls(KEYS.settings, {}); document.documentElement.setAttribute('data-theme', s.theme === 'light' ? 'light' : 'dark'); }
