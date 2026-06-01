// ════════════════════════════════════════════════════════════════════════
// CUSTOM SELECT COMPONENT (vxSel)
// ════════════════════════════════════════════════════════════════════════
// Replaces every native <select> with a styled popover-driven dropdown,
// while keeping the native element in the DOM (display:none) so form
// submission and 'change' event listeners keep working unchanged.
// Auto-enhances on DOMContentLoaded and via a MutationObserver, so
// dynamically rendered forms (new-report, settings, editor) all get
// the same treatment without explicit callsite wiring.
//
// Skipped: multi-selects, size>1 visible lists, anything tagged with
// data-vxsel-skip="1", and selects inside the PDF-editor canvas
// (cv-canvas) where complex drag-resize-edit behaviour would clash.

var _vxSelOpenSel    = null;
var _vxSelOpenPop    = null;
var _vxSelActiveIdx  = -1;
var _vxSelObserver   = null;
var _vxSelRaf        = 0;

function vxSelEnhance(root){
  root = root || document.body;
  if(!root || !root.querySelectorAll) return;
  // Self may be a select; querySelectorAll wouldn't include it.
  if(root.tagName === 'SELECT') { _vxSelTryWrap(root); return; }
  root.querySelectorAll('select').forEach(_vxSelTryWrap);
}

function _vxSelTryWrap(sel){
  if(!sel || sel.dataset.vxsel === '1') return;
  if(sel.multiple || sel.size > 1) return;
  if(sel.dataset.vxselSkip === '1') return;
  // PDF-editor canvas owns its own select interactions inside block
  // editors and popovers — leave those alone to avoid a fight over
  // pointer events.
  if(sel.closest('#cv-canvas, .cv-block, .cv-popover, .vxsel-popover')) return;
  _vxSelEnhanceOne(sel);
}

function _vxSelEnhanceOne(sel){
  sel.dataset.vxsel = '1';

  const wrap = document.createElement('div');
  wrap.className = 'vxsel-wrap';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'vxsel-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  // Inherit ARIA labelling from the native select where possible.
  const inheritAttrs = ['aria-label','title'];
  inheritAttrs.forEach(a => { if(sel.hasAttribute(a)) trigger.setAttribute(a, sel.getAttribute(a)); });

  const labelEl = document.createElement('span');
  labelEl.className = 'vxsel-label';
  trigger.appendChild(labelEl);

  const arrow = document.createElement('span');
  arrow.className = 'vxsel-arrow';
  arrow.textContent = '▾';
  arrow.setAttribute('aria-hidden', 'true');
  trigger.appendChild(arrow);

  // Splice the wrapper into the DOM in place of the native select.
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  wrap.appendChild(trigger);
  sel.style.display = 'none';

  _vxSelUpdateLabel(sel, labelEl);
  if(sel.disabled) trigger.setAttribute('disabled', 'disabled');

  trigger.addEventListener('click', e => {
    e.preventDefault();
    if(trigger.hasAttribute('disabled')) return;
    if(trigger.classList.contains('is-open')) _vxSelClose();
    else _vxSelOpen(sel);
  });

  trigger.addEventListener('keydown', e => {
    if(trigger.hasAttribute('disabled')) return;
    if(e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      _vxSelOpen(sel);
    }
  });

  // Mirror native 'change' (whether dispatched by us or external code).
  sel.addEventListener('change', () => _vxSelUpdateLabel(sel, labelEl));

  // Surface disabled-state changes by reflecting onto the trigger.
  // MutationObserver is overkill for one attribute; the rare callsites
  // that toggle .disabled programmatically can dispatch 'vxsel:refresh'.
  sel.addEventListener('vxsel:refresh', () => {
    _vxSelUpdateLabel(sel, labelEl);
    if(sel.disabled) trigger.setAttribute('disabled', 'disabled');
    else trigger.removeAttribute('disabled');
  });
}

function _vxSelUpdateLabel(sel, labelEl){
  const opt = sel.selectedOptions && sel.selectedOptions[0];
  if(!opt){
    labelEl.textContent = '— Select —';
    labelEl.classList.add('vxsel-placeholder');
    return;
  }
  const txt = opt.text || '';
  const isPlaceholder = opt.value === '' || /^[—\-]\s*select/i.test(txt);
  labelEl.textContent = txt || '— Select —';
  labelEl.classList.toggle('vxsel-placeholder', isPlaceholder);
}

function _vxSelOpen(sel){
  if(_vxSelOpenSel) _vxSelClose();
  _vxSelOpenSel = sel;
  const wrap = sel.parentNode;
  const trigger = wrap.querySelector('.vxsel-trigger');
  trigger.classList.add('is-open');
  trigger.setAttribute('aria-expanded', 'true');

  const pop = document.createElement('div');
  pop.className = 'vxsel-popover';
  pop.setAttribute('role', 'dialog');

  const options = Array.from(sel.options);
  const needsSearch = options.length > 10;
  let searchInput = null;
  if(needsSearch){
    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'vxsel-search';
    searchInput.placeholder = 'Type to filter…';
    searchInput.setAttribute('aria-label', 'Filter options');
    pop.appendChild(searchInput);
  }

  const optsEl = document.createElement('div');
  optsEl.className = 'vxsel-options';
  optsEl.setAttribute('role', 'listbox');
  optsEl.tabIndex = -1;
  pop.appendChild(optsEl);

  _vxSelRenderOptions(sel, optsEl, options, '');

  wrap.appendChild(pop);
  _vxSelOpenPop = pop;
  _vxSelActiveIdx = sel.selectedIndex >= 0 ? sel.selectedIndex : -1;
  _vxSelMarkActive(optsEl);

  // Flip the popover above the trigger if it overflows the viewport.
  const rect = pop.getBoundingClientRect();
  if(rect.bottom > window.innerHeight - 16) pop.classList.add('is-up');

  if(searchInput){
    searchInput.focus();
    searchInput.addEventListener('input', () => {
      _vxSelRenderOptions(sel, optsEl, options, searchInput.value.toLowerCase());
      _vxSelActiveIdx = -1;
      _vxSelMarkActive(optsEl);
    });
    searchInput.addEventListener('keydown', _vxSelHandleKey);
  } else {
    optsEl.focus();
    optsEl.addEventListener('keydown', _vxSelHandleKey);
  }

  // Defer outside-click binding so the click that opened us doesn't
  // immediately close us.
  setTimeout(() => document.addEventListener('mousedown', _vxSelOutsideClick, true), 0);
}

function _vxSelRenderOptions(sel, optsEl, options, filter){
  optsEl.innerHTML = '';
  let visibleCount = 0;
  options.forEach((opt, idx) => {
    const text = opt.text || '';
    if(filter && !text.toLowerCase().includes(filter)) return;
    visibleCount++;
    const o = document.createElement('div');
    o.className = 'vxsel-option';
    o.dataset.optIdx = idx;
    o.setAttribute('role', 'option');
    o.textContent = text;
    if(opt.disabled) o.classList.add('is-disabled');
    if(idx === sel.selectedIndex) o.setAttribute('aria-selected', 'true');
    o.addEventListener('mousedown', e => {
      // mousedown so the option click beats the outside-click handler.
      e.preventDefault();
      if(opt.disabled) return;
      sel.selectedIndex = idx;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sel.dispatchEvent(new Event('input',  { bubbles: true }));
      _vxSelClose();
    });
    o.addEventListener('mouseenter', () => {
      const all = Array.from(optsEl.querySelectorAll('.vxsel-option'));
      _vxSelActiveIdx = all.indexOf(o);
      _vxSelMarkActive(optsEl);
    });
    optsEl.appendChild(o);
  });
  if(!visibleCount){
    const empty = document.createElement('div');
    empty.className = 'vxsel-empty';
    empty.textContent = 'No matches';
    optsEl.appendChild(empty);
  }
}

function _vxSelMarkActive(optsEl){
  const all = optsEl.querySelectorAll('.vxsel-option');
  all.forEach((o, i) => o.classList.toggle('is-active', i === _vxSelActiveIdx));
  if(_vxSelActiveIdx >= 0 && all[_vxSelActiveIdx]){
    all[_vxSelActiveIdx].scrollIntoView({ block: 'nearest' });
  }
}

function _vxSelHandleKey(e){
  if(!_vxSelOpenSel) return;
  const pop = _vxSelOpenPop;
  if(!pop) return;
  const optsEl = pop.querySelector('.vxsel-options');
  const opts = Array.from(optsEl.querySelectorAll('.vxsel-option:not(.is-disabled)'));
  if(e.key === 'Escape'){
    e.preventDefault();
    _vxSelClose();
    const trigger = _vxSelOpenSel && _vxSelOpenSel.parentNode && _vxSelOpenSel.parentNode.querySelector('.vxsel-trigger');
    if(trigger) trigger.focus();
    return;
  }
  if(e.key === 'ArrowDown'){
    e.preventDefault();
    _vxSelActiveIdx = Math.min(opts.length - 1, _vxSelActiveIdx + 1);
    _vxSelMarkActive(optsEl);
  } else if(e.key === 'ArrowUp'){
    e.preventDefault();
    _vxSelActiveIdx = Math.max(0, _vxSelActiveIdx - 1);
    _vxSelMarkActive(optsEl);
  } else if(e.key === 'Enter'){
    e.preventDefault();
    if(_vxSelActiveIdx >= 0 && opts[_vxSelActiveIdx]){
      opts[_vxSelActiveIdx].dispatchEvent(new Event('mousedown', { bubbles: true }));
    }
  } else if(e.key === 'Home'){
    e.preventDefault();
    _vxSelActiveIdx = 0;
    _vxSelMarkActive(optsEl);
  } else if(e.key === 'End'){
    e.preventDefault();
    _vxSelActiveIdx = opts.length - 1;
    _vxSelMarkActive(optsEl);
  }
}

function _vxSelOutsideClick(e){
  if(!_vxSelOpenSel) return;
  const wrap = _vxSelOpenSel.parentNode;
  if(wrap && !wrap.contains(e.target)) _vxSelClose();
}

function _vxSelClose(){
  if(!_vxSelOpenSel) return;
  const wrap = _vxSelOpenSel.parentNode;
  if(wrap){
    const trigger = wrap.querySelector('.vxsel-trigger');
    if(trigger){
      trigger.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
    }
    const pop = wrap.querySelector('.vxsel-popover');
    if(pop) pop.remove();
  }
  _vxSelOpenSel   = null;
  _vxSelOpenPop   = null;
  _vxSelActiveIdx = -1;
  document.removeEventListener('mousedown', _vxSelOutsideClick, true);
}

// Public refresh hook for callers that change select.value programmatically
// without dispatching 'change' (rare but possible during form rehydration).
function vxSelRefresh(sel){
  if(!sel) return;
  sel.dispatchEvent(new Event('vxsel:refresh'));
}

// MutationObserver — picks up dynamically rendered selects so the
// new-report form, settings panels and editor ribbons get enhanced
// automatically after any innerHTML swap. Debounced via rAF so a
// big render pass doesn't enhance the same nodes twice.
function _vxSelStartObserver(){
  if(_vxSelObserver) return;
  _vxSelObserver = new MutationObserver(muts => {
    if(_vxSelRaf) return;
    _vxSelRaf = requestAnimationFrame(() => {
      _vxSelRaf = 0;
      muts.forEach(m => {
        m.addedNodes.forEach(node => {
          if(node.nodeType === 1) vxSelEnhance(node);
        });
      });
    });
  });
  _vxSelObserver.observe(document.body, { childList: true, subtree: true });
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', () => {
    vxSelEnhance(document.body);
    _vxSelStartObserver();
  });
} else {
  vxSelEnhance(document.body);
  _vxSelStartObserver();
}
