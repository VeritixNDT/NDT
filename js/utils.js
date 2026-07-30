// ══════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════
async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// Refresh the copyright year on every `.vx-copyright-year` element in the
// DOM. Called once at boot — the year only ticks over at midnight on Jan 1
// so a per-load refresh is sufficient. Falls back gracefully if no elements
// exist (e.g. during early bootstrap before the login screen renders).
function vxSyncCopyrightYear(){
  try {
    const year = String(new Date().getFullYear());
    document.querySelectorAll('.vx-copyright-year').forEach(el => {
      el.textContent = year;
    });
  } catch(e){}
  // Stamp the running build id into any `.vx-build-stamp` element so a glance
  // at the footer confirms whether a deploy is actually live in this browser.
  try {
    const build = (typeof VX_BUILD !== 'undefined') ? VX_BUILD : '';
    document.querySelectorAll('.vx-build-stamp').forEach(el => {
      el.textContent = 'build ' + build;
    });
  } catch(e){}
}
// V12: Validate that a URL is safe to render in <img src="">. Only allow:
//   - https:// URLs (subject to CSP)
//   - data:image/(png|jpeg|jpg|webp|gif);base64,... (raster only — NOT svg, which can carry scripts)
// Anything else (javascript:, vbscript:, data:image/svg+xml, untrusted http://) is rejected.
function isSafeImageUrl(url) {
  if(typeof url !== 'string' || url.length === 0) return false;
  if(/^https:\/\//i.test(url)) return true;
  return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(url);
}
// Helper: set an img element's src safely. Use this anywhere user-supplied
// image URLs are rendered. Returns true if the src was set, false if rejected.
function setSafeImageSrc(imgEl, url, fallbackInitials) {
  if(!imgEl) return false;
  if(isSafeImageUrl(url)) { imgEl.src = url; return true; }
  // Reject silently — fall back to initials avatar if requested
  imgEl.removeAttribute('src');
  if(fallbackInitials && imgEl.parentElement) {
    imgEl.parentElement.textContent = fallbackInitials;
  }
  return false;
}


// Survey table renderer, shared by the hardness / ferrite / PMI report modules.
// All three carried a copy that was identical bar whitespace, so a fix to the
// printed table needed three edits.
//
// It extracts cleanly because it touches no module state — only its arguments
// and the global escapeHtml. Most of those three modules does NOT: measured,
// just 91 of their ~2,150 lines are genuinely duplicated, and the roles that
// merely share a NAME (Normalize, Verdict, RenderSurvey) have real per-method
// logic behind them. See docs/superpowers/specs/2026-07-28-orphan-triage.md.
function vxSurveyTableEl(headLabels, rowsData, bar, P, colWidths){
  var colgroup = '';
  if(Array.isArray(colWidths) && colWidths.length === headLabels.length){
    var tot = colWidths.reduce(function(s,w){ return s + (+w || 0); }, 0) || 1;
    colgroup = '<colgroup>' + colWidths.map(function(w){ return '<col style="width:'+((+w||0)/tot*100).toFixed(3)+'%"/>'; }).join('') + '</colgroup>';
  }
  var head = headLabels.map(function(c){ return '<th style="padding:3px 6px;text-align:left;font:600 7.5px \'Geist Mono\',monospace;color:#fff;letter-spacing:.03em;word-break:break-word">'+escapeHtml(c)+'</th>'; }).join('');
  var n = headLabels.length;
  var body = rowsData.map(function(r){
    var cells = r.cells.map(function(cell, ci){
      var br = (ci === n-1) ? '' : ('border-right:0.5px solid '+P.grid+';');
      return '<td style="padding:3px 6px;'+br+'border-bottom:0.5px solid '+P.grid+';font-size:8.5px;line-height:1.3;color:#000;vertical-align:middle;word-break:break-word;overflow:hidden;'+(cell.extra||'')+'">'+cell.v+'</td>';
    }).join('');
    return '<tr'+(r.rowStyle?(' style="'+r.rowStyle+'"'):'')+'>'+cells+'</tr>';
  }).join('');
  return '<table style="width:100%;border-collapse:separate;border-spacing:0;border-top:1px solid '+P.grid+';table-layout:'+(colgroup?'fixed':'auto')+'">'+colgroup+'<thead style="background:'+bar+'"><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table>';
}

// ══════════════════════════════════════════════════════════════════════════
// Shared helpers, moved out of js/platform.js (fourteenth slice).
// ══════════════════════════════════════════════════════════════════════════
// el(), set(), fmtDate(), debounce() and friends had no business living in the
// platform layer: they touch no platform state, and el() alone is called from
// nearly every file in the app. They sat there for the usual reason — the file
// was where things went before there were other files.
//
// This is the only slice that moves code EARLIER in the load order (utils.js is
// the fourth app script; platform.js is the eighth). That direction is the safe
// one by construction: any existing top-level caller had to already run after
// platform.js, so it still runs after utils.js. Nothing that loads in between
// (a11y, i18n, storage) calls these at load — checked, not assumed — and the
// three files ahead of utils.js could not have been calling them anyway, since
// platform.js had not run yet.
//
// The block's own top-level statements are self-contained: the four debounced
// renderers below call debounce(), which is declared above them in this same
// file, and the vxActions() registration reaches constants.js, which the shell
// loads first precisely so any file can register from anywhere in the order.
//
// On vxLoading / vxRunLoading / vxUndoable specifically: these are transient
// action feedback rather than pure helpers, and a case exists for putting them
// in a UI module instead. They are here because they depend on nothing but the
// DOM and an optional toast(), they are consumed from many modules, and keeping
// the moved block in one piece keeps one verification surface rather than two.
function initials(n='')  { return n.trim().split(/\s+/).map(w=>w[0]||'').join('').toUpperCase().slice(0,2) || '?'; }

// V14: loading-state helpers. Use around any async action that takes >200ms.
//   const done = vxLoading(btnEl);  await doWork();  done();
function vxLoading(btnEl) {
  if(!btnEl) return () => {};
  const wasDisabled = btnEl.disabled;
  btnEl.disabled = true;
  btnEl.classList.add('btn-loading');
  btnEl.setAttribute('aria-busy', 'true');
  return () => {
    btnEl.disabled = wasDisabled;
    btnEl.classList.remove('btn-loading');
    btnEl.removeAttribute('aria-busy');
  };
}
// Wrap a click-handler with automatic loading state. Use as:
//   data-action="vxRunLoading" data-pass-el="1" data-args="async () => { ... }"
async function vxRunLoading(btnEl, fn) {
  const done = vxLoading(btnEl);
  try { return await fn(); }
  finally { done(); }
}

// V14: Undoable destructive action. Pattern:
//   1. Immediately apply the destructive change locally (e.g. splice from
//      array, save). The user sees the result instantly.
//   2. Show a toast with an "Undo" button for N seconds.
//   3. If undone before the timeout, restore the original state.
//   4. If the timeout expires, commit the change (server-side) and clean up.
//
// Used by rptDelete and defDelete so misclicks don't lose data.
var _vxUndoTimers = new Map();
function vxUndoable(opts) {
  const id = 'undo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const duration = opts.duration || 6000;
  // Apply the change immediately
  try { opts.apply(); } catch(e) { console.warn('undoable apply failed', e); return; }
  // Render the toast (longer-lived than a regular toast, with Undo button)
  const c = el('toast-container');
  if(!c) { if(opts.commit) opts.commit(); return; }
  const t = document.createElement('div');
  t.className = 'toast undo';
  t.dataset.undoId = id;
  const labelSpan = document.createElement('span');
  labelSpan.textContent = opts.message || 'Deleted';
  const btn = document.createElement('button');
  btn.className = 'toast-undo-btn';
  btn.type = 'button';
  btn.textContent = 'Undo';
  btn.onclick = () => {
    clearTimeout(_vxUndoTimers.get(id));
    _vxUndoTimers.delete(id);
    try { opts.undo(); } catch(e) { console.warn('undo failed', e); }
    t.classList.add('out');
    setTimeout(() => t.remove(), 220);
    if(typeof toast === 'function') toast(opts.undoneMessage || 'Restored.', 'success');
  };
  t.appendChild(labelSpan);
  t.appendChild(btn);
  c.appendChild(t);
  // Announce to AT
  if(typeof a11yAnnounce === 'function') a11yAnnounce((opts.message || 'Deleted') + ' — undo available.', 'polite');
  // Commit timer
  const timer = setTimeout(() => {
    _vxUndoTimers.delete(id);
    t.classList.add('out');
    setTimeout(() => t.remove(), 220);
    if(opts.commit) try { opts.commit(); } catch(e) { console.warn('undoable commit failed', e); }
  }, duration);
  _vxUndoTimers.set(id, timer);
}

// V12 perf: debounce helper for text-input-driven re-renders
// Without this, rptRender() runs on every keystroke and rebuilds the whole
// table via innerHTML — fine at 50 records, painful at 500+.
function debounce(fn, wait = 150) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}
// Lazy bindings — these renderers may be defined later in the file, so we
// late-bind at call time rather than at declaration time
var rptRenderDebounced      = debounce(() => { if(typeof rptRender      === 'function') rptRender();      }, 120);
var defRenderDebounced      = debounce(() => { if(typeof defRender      === 'function') defRender();      }, 120);
var auditLogRenderDebounced = debounce(() => { if(typeof auditLogRender === 'function') auditLogRender(); }, 150);
var helpSearchDebounced     = debounce(() => { if(typeof helpSearch     === 'function') helpSearch();     }, 100);
var _dateFmt = 'dd MMM yyyy';
var _timeFmt = '24';
function fmtDate(s) {
  if(!s) return '—';
  try {
    const settings = ls(KEYS.settings, {});
    const tz = settings.timezone && settings.timezone !== 'auto' ? settings.timezone : null;
    let d = new Date(s);
    if(tz){
      // Use Intl to get parts in the target timezone
      try {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(d);
        const obj = {}; parts.forEach(p => obj[p.type] = p.value);
        const dd = obj.day, MM = obj.month, yyyy = obj.year;
        const dN = parseInt(dd);
        const monthIdx = parseInt(MM) - 1;
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const monthsFull = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const MMM = months[monthIdx];
        const MMMM = monthsFull[monthIdx];
        switch(_dateFmt) {
          case 'dd/MM/yyyy': return `${dd}/${MM}/${yyyy}`;
          case 'MM/dd/yyyy': return `${MM}/${dd}/${yyyy}`;
          case 'yyyy-MM-dd': return `${yyyy}-${MM}-${dd}`;
          case 'dd.MM.yyyy': return `${dd}.${MM}.${yyyy}`;
          case 'dd-MM-yyyy': return `${dd}-${MM}-${yyyy}`;
          case 'd MMMM yyyy': return `${dN} ${MMMM} ${yyyy}`;
          default: return `${dd} ${MMM} ${yyyy}`;
        }
      } catch(e){ /* fall through */ }
    }
    const dd = String(d.getDate()).padStart(2,'0');
    const dN = d.getDate();
    const MM = String(d.getMonth()+1).padStart(2,'0');
    const yyyy = d.getFullYear();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthsFull = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const MMM = months[d.getMonth()];
    const MMMM = monthsFull[d.getMonth()];
    switch(_dateFmt) {
      case 'dd/MM/yyyy': return `${dd}/${MM}/${yyyy}`;
      case 'MM/dd/yyyy': return `${MM}/${dd}/${yyyy}`;
      case 'yyyy-MM-dd': return `${yyyy}-${MM}-${dd}`;
      case 'dd.MM.yyyy': return `${dd}.${MM}.${yyyy}`;
      case 'dd-MM-yyyy': return `${dd}-${MM}-${yyyy}`;
      case 'd MMMM yyyy': return `${dN} ${MMMM} ${yyyy}`;
      default: return `${dd} ${MMM} ${yyyy}`;
    }
  } catch { return s; }
}
function fmtSize(b)      { if(b<1024)return b+'B'; if(b<1048576)return(b/1024).toFixed(1)+'KB'; return(b/1048576).toFixed(2)+'MB'; }
function lsSize(k)       { return ((k.length+(localStorage.getItem(k)||'').length)*2); }
function el(id)          { return document.getElementById(id); }
function set(id,v)       { const e=el(id); if(e)e.textContent=v; }

function uaGrad(name) {
  let h=5381; for(const c of name||'?') h=(h*33^c.charCodeAt(0))>>>0;
  const palette=['linear-gradient(135deg,#2d6fd6,#4f8ef7)','linear-gradient(135deg,#0099cc,#00d4ff)',
    'linear-gradient(135deg,#7c3aed,#a78bfa)','linear-gradient(135deg,#10b981,#3ecf8e)',
    'linear-gradient(135deg,#d97706,#f5a623)','linear-gradient(135deg,#c73c3c,#f25c5c)'];
  return palette[h % palette.length];
}

function roleClass(r) {
  const m={'Admin':'role-admin','Inspector':'role-inspector','Senior Inspector':'role-senior','Viewer':'role-viewer'};
  return m[r]||'role-viewer';
}

// ── Dispatch registration — see vxActions in js/constants.js.
// These five travelled from platform.js with the functions they name; the
// remaining entries in that call belong to blocks still living there.
vxActions({
  auditLogRenderDebounced, defRenderDebounced, helpSearchDebounced,
  rptRenderDebounced, vxRunLoading,
});
