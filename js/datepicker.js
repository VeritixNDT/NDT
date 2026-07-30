// ════════════════════════════════════════════════════════════════════════
// CUSTOM DATE PICKER (vxDate)
// ════════════════════════════════════════════════════════════════════════
// Replaces every native <input type="date"> with a styled trigger button
// + popover calendar. Native input stays in the DOM (display:none) so
// form events, .value reads/writes, min/max attributes and existing
// data-on-change handlers all keep working without changes. Auto-enhances
// on load and via a MutationObserver, matching the vxSel pattern.
//
// Skipped: readonly inputs, anything tagged data-vxdate-skip="1", and
// inputs inside the PDF-editor canvas (cv-canvas — those own their
// own popover machinery).

var _vxDateOpenInp = null;
var _vxDateView    = null;   // {year, month} of the calendar view
var _vxDateObs     = null;
var _vxDateRaf     = 0;

const _VX_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const _VX_DAYS   = ['Mo','Tu','We','Th','Fr','Sa','Su'];

function vxDateEnhance(root){
  root = root || document.body;
  if(!root || !root.querySelectorAll) return;
  if(root.tagName === 'INPUT' && root.type === 'date'){ _vxDateTryWrap(root); return; }
  root.querySelectorAll('input[type="date"]').forEach(_vxDateTryWrap);
}

function _vxDateTryWrap(inp){
  if(!inp || inp.dataset.vxdate === '1') return;
  if(inp.readOnly || inp.dataset.vxdateSkip === '1') return;
  if(inp.closest('#cv-canvas, .cv-block, .cv-popover, .vxdate-pop')) return;
  _vxDateWrapOne(inp);
}

function _vxDateWrapOne(inp){
  inp.dataset.vxdate = '1';

  const wrap = document.createElement('div');
  wrap.className = 'vxdate-wrap';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'vxdate-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  if(inp.hasAttribute('aria-label')) trigger.setAttribute('aria-label', inp.getAttribute('aria-label'));

  const labelEl = document.createElement('span');
  labelEl.className = 'vxdate-label';
  trigger.appendChild(labelEl);

  const icon = document.createElement('span');
  icon.className = 'vxdate-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.5" width="12" height="11" rx="1.5"/><path d="M2 6.5h12"/><path d="M5.5 2v2.5M10.5 2v2.5"/></svg>';
  trigger.appendChild(icon);

  inp.parentNode.insertBefore(wrap, inp);
  wrap.appendChild(inp);
  wrap.appendChild(trigger);
  inp.style.display = 'none';

  _vxDateUpdateLabel(inp, labelEl);
  if(inp.disabled) trigger.setAttribute('disabled', 'disabled');

  trigger.addEventListener('click', e => {
    e.preventDefault();
    if(trigger.hasAttribute('disabled')) return;
    if(trigger.classList.contains('is-open')) _vxDateClose();
    else _vxDateOpen(inp);
  });

  trigger.addEventListener('keydown', e => {
    if(trigger.hasAttribute('disabled')) return;
    if(e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      _vxDateOpen(inp);
    }
  });

  inp.addEventListener('change', () => _vxDateUpdateLabel(inp, labelEl));
  inp.addEventListener('vxdate:refresh', () => {
    _vxDateUpdateLabel(inp, labelEl);
    if(inp.disabled) trigger.setAttribute('disabled', 'disabled');
    else trigger.removeAttribute('disabled');
  });
}

function _vxDateUpdateLabel(inp, labelEl){
  const v = (inp.value || '').trim();
  if(!v){
    labelEl.textContent = inp.placeholder || 'Select date';
    labelEl.classList.add('vxdate-placeholder');
    return;
  }
  // Friendly format: "15 Mar 2026". fmtDate is shared with the rest of
  // the app so the trigger label matches every other dd-Mmm-yyyy
  // rendering. Falls back to the raw ISO string if fmtDate isn't loaded.
  let pretty = v;
  try { if(typeof fmtDate === 'function') pretty = fmtDate(v); } catch(e){}
  labelEl.textContent = pretty;
  labelEl.classList.remove('vxdate-placeholder');
}

function _vxDateOpen(inp){
  if(_vxDateOpenInp) _vxDateClose();
  _vxDateOpenInp = inp;
  const wrap = inp.parentNode;
  const trigger = wrap.querySelector('.vxdate-trigger');
  trigger.classList.add('is-open');
  trigger.setAttribute('aria-expanded', 'true');

  // Seed the view from the current value, today, or the min if pre-min.
  let initial;
  if(inp.value){
    initial = _vxParseISO(inp.value);
  } else {
    initial = new Date();
  }
  _vxDateView = { year: initial.getFullYear(), month: initial.getMonth() };

  const pop = document.createElement('div');
  pop.className = 'vxdate-pop';
  pop.setAttribute('role', 'dialog');
  pop.tabIndex = -1;
  _vxDateRenderPop(inp, pop);

  wrap.appendChild(pop);

  const rect = pop.getBoundingClientRect();
  if(rect.bottom > window.innerHeight - 16) pop.classList.add('is-up');

  pop.focus();
  pop.addEventListener('keydown', _vxDateHandleKey);
  setTimeout(() => document.addEventListener('mousedown', _vxDateOutsideClick, true), 0);
}

function _vxDateRenderPop(inp, pop){
  const view = _vxDateView;
  const selected = inp.value ? _vxParseISO(inp.value) : null;
  const today = _vxStartOfDay(new Date());
  const min = inp.min ? _vxParseISO(inp.min) : null;
  const max = inp.max ? _vxParseISO(inp.max) : null;

  // Build header
  pop.innerHTML = `
    <div class="vxdate-head">
      <button type="button" class="vxdate-nav" data-vxdate-action="prev" aria-label="Previous month">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="10,3 5,8 10,13"/></svg>
      </button>
      <div class="vxdate-title">
        <span class="vxdate-month">${_VX_MONTHS[view.month]}</span>
        <span class="vxdate-year">${view.year}</span>
      </div>
      <button type="button" class="vxdate-nav" data-vxdate-action="next" aria-label="Next month">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,3 11,8 6,13"/></svg>
      </button>
    </div>
    <div class="vxdate-dnames">${_VX_DAYS.map(d => `<span>${d}</span>`).join('')}</div>
    <div class="vxdate-grid"></div>
    <div class="vxdate-foot">
      <button type="button" class="vxdate-btn" data-vxdate-action="today">Today</button>
      <button type="button" class="vxdate-btn vxdate-btn-ghost" data-vxdate-action="clear">Clear</button>
    </div>`;

  // First day of the visible grid — Monday before (or equal to) day 1 of month.
  const first = new Date(view.year, view.month, 1);
  const dow = (first.getDay() + 6) % 7; // 0 = Monday
  const start = new Date(first); start.setDate(1 - dow);

  const grid = pop.querySelector('.vxdate-grid');
  let html = '';
  for(let i = 0; i < 42; i++){
    const d = new Date(start); d.setDate(start.getDate() + i);
    const isOtherMonth = d.getMonth() !== view.month;
    const isToday = d.getTime() === today.getTime();
    const isSelected = selected && d.getTime() === selected.getTime();
    const disabled = (min && d < min) || (max && d > max);
    const iso = _vxToISO(d);
    const cls = [
      'vxdate-day',
      isOtherMonth ? 'is-other' : '',
      isToday ? 'is-today' : '',
      isSelected ? 'is-selected' : '',
      disabled ? 'is-disabled' : '',
    ].filter(Boolean).join(' ');
    html += `<button type="button" class="${cls}" data-vxdate-iso="${iso}" ${disabled?'disabled':''} aria-label="${_vxAriaLabel(d)}" tabindex="-1">${d.getDate()}</button>`;
  }
  grid.innerHTML = html;

  // Wire up event delegation
  pop.querySelectorAll('[data-vxdate-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const act = btn.dataset.vxdateAction;
      if(act === 'prev'){
        if(_vxDateView.month === 0){ _vxDateView.month = 11; _vxDateView.year--; }
        else _vxDateView.month--;
        _vxDateRenderPop(inp, pop);
      } else if(act === 'next'){
        if(_vxDateView.month === 11){ _vxDateView.month = 0; _vxDateView.year++; }
        else _vxDateView.month++;
        _vxDateRenderPop(inp, pop);
      } else if(act === 'today'){
        _vxDatePick(inp, new Date());
      } else if(act === 'clear'){
        inp.value = '';
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        _vxDateClose();
      }
    });
  });
  grid.querySelectorAll('.vxdate-day').forEach(cell => {
    cell.addEventListener('mousedown', e => {
      e.preventDefault();
      if(cell.classList.contains('is-disabled')) return;
      _vxDatePick(inp, _vxParseISO(cell.dataset.vxdateIso));
    });
  });
}

function _vxDatePick(inp, d){
  inp.value = _vxToISO(d);
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  inp.dispatchEvent(new Event('input',  { bubbles: true }));
  _vxDateClose();
}

function _vxDateHandleKey(e){
  if(!_vxDateOpenInp) return;
  const inp = _vxDateOpenInp;
  if(e.key === 'Escape'){
    e.preventDefault();
    _vxDateClose();
    const t = inp.parentNode && inp.parentNode.querySelector('.vxdate-trigger');
    if(t) t.focus();
    return;
  }
  // Keyboard cursor — work off current value, today, or first of view month.
  let cur = inp.value ? _vxParseISO(inp.value) : new Date(_vxDateView.year, _vxDateView.month, 1);
  const shift = (days) => { const d = new Date(cur); d.setDate(d.getDate() + days); _vxDatePick(inp, d); };
  if(e.key === 'ArrowLeft')  { e.preventDefault(); shift(-1); }
  else if(e.key === 'ArrowRight'){ e.preventDefault(); shift(1); }
  else if(e.key === 'ArrowUp')   { e.preventDefault(); shift(-7); }
  else if(e.key === 'ArrowDown') { e.preventDefault(); shift(7); }
  else if(e.key === 'PageUp')    { e.preventDefault(); const d = new Date(cur); d.setMonth(d.getMonth() - 1); _vxDatePick(inp, d); }
  else if(e.key === 'PageDown')  { e.preventDefault(); const d = new Date(cur); d.setMonth(d.getMonth() + 1); _vxDatePick(inp, d); }
  else if(e.key === 'Home')      { e.preventDefault(); _vxDatePick(inp, new Date()); }
}

function _vxDateOutsideClick(e){
  if(!_vxDateOpenInp) return;
  const wrap = _vxDateOpenInp.parentNode;
  if(wrap && !wrap.contains(e.target)) _vxDateClose();
}

function _vxDateClose(){
  if(!_vxDateOpenInp) return;
  const wrap = _vxDateOpenInp.parentNode;
  if(wrap){
    const t = wrap.querySelector('.vxdate-trigger');
    if(t){ t.classList.remove('is-open'); t.setAttribute('aria-expanded', 'false'); }
    const p = wrap.querySelector('.vxdate-pop');
    if(p) p.remove();
  }
  _vxDateOpenInp = null;
  document.removeEventListener('mousedown', _vxDateOutsideClick, true);
}

// ── Helpers ──────────────────────────────────────────────────────────
function _vxParseISO(s){
  // yyyy-mm-dd → local midnight Date. Avoids the UTC interpretation
  // that `new Date('2026-03-15')` triggers (which would shift dates
  // across timezone boundaries).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s||''));
  if(!m) return new Date();
  return _vxStartOfDay(new Date(+m[1], +m[2]-1, +m[3]));
}
function _vxToISO(d){
  const pad = n => String(n).padStart(2,'0');
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
}
function _vxStartOfDay(d){
  const x = new Date(d); x.setHours(0,0,0,0); return x;
}
function _vxAriaLabel(d){
  return d.getDate() + ' ' + _VX_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

function _vxDateStartObserver(){
  if(_vxDateObs) return;
  _vxDateObs = new MutationObserver(muts => {
    if(_vxDateRaf) return;
    _vxDateRaf = requestAnimationFrame(() => {
      _vxDateRaf = 0;
      muts.forEach(m => m.addedNodes.forEach(node => {
        if(node.nodeType === 1) vxDateEnhance(node);
      }));
    });
  });
  _vxDateObs.observe(document.body, { childList: true, subtree: true });
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', () => {
    vxDateEnhance(document.body);
    _vxDateStartObserver();
  });
} else {
  vxDateEnhance(document.body);
  _vxDateStartObserver();
}
