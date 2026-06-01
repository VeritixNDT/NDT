// ════════════════════════════════════════════════════════════════════════
// CUSTOM TOOLTIP (vxTt)
// ════════════════════════════════════════════════════════════════════════
// Replaces native browser title="" tooltips with a themed hover bubble.
// On first hover of any element with a title attribute, the title is
// moved to data-vxtt and the native attribute is removed so the OS
// bubble can't fight ours. A single shared .vxtt element is positioned
// near the trigger and reused across the page — cheaper than one
// element per trigger.
//
// Authors can pre-seed by setting data-vxtt="…" directly, which is
// useful for cases where you want a tooltip but not the browser's
// built-in fallback (e.g. when title would conflict with form
// behaviour). Tooltips suppressed on touch-only devices so taps don't
// trigger them.

var _vxTtEl     = null;
var _vxTtTarget = null;
var _vxTtTimer  = 0;
var _vxTtDelay  = 380;
var _vxTtTouch  = (typeof matchMedia === 'function') && matchMedia('(hover: none)').matches;

function _vxTtMakeEl(){
  if(_vxTtEl) return _vxTtEl;
  _vxTtEl = document.createElement('div');
  _vxTtEl.className = 'vxtt';
  _vxTtEl.setAttribute('role', 'tooltip');
  document.body.appendChild(_vxTtEl);
  return _vxTtEl;
}

function _vxTtShow(target, text){
  const el = _vxTtMakeEl();
  el.textContent = text;
  el.classList.remove('is-visible', 'is-below');
  // Reset position so measurement is clean — then reflow read.
  el.style.left = '-9999px';
  el.style.top  = '-9999px';
  // Force a layout read so offsetWidth reflects the new text.
  const tw = el.offsetWidth;
  const th = el.offsetHeight;
  const tr = target.getBoundingClientRect();
  let left = tr.left + tr.width / 2 - tw / 2;
  let top  = tr.top - th - 9;
  let below = false;
  // Flip below if there isn't room above.
  if(top < 8){
    top = tr.bottom + 9;
    below = true;
  }
  // Clamp horizontally within the viewport with a small inset.
  left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
  el.style.left = left + 'px';
  el.style.top  = top  + 'px';
  if(below) el.classList.add('is-below');
  // Arrow offset — keep the arrow pointing at the trigger centre even
  // when the bubble is clamped against the viewport edge.
  const arrowX = tr.left + tr.width / 2 - left;
  el.style.setProperty('--vxtt-arrow-x', Math.max(10, Math.min(tw - 10, arrowX)) + 'px');
  // Animate in on next frame so the transition has a starting state.
  requestAnimationFrame(() => el.classList.add('is-visible'));
}

function _vxTtHide(){
  if(!_vxTtEl) return;
  _vxTtEl.classList.remove('is-visible');
  _vxTtTarget = null;
  if(_vxTtTimer){ clearTimeout(_vxTtTimer); _vxTtTimer = 0; }
}

function _vxTtPrep(el){
  if(!el || el.dataset.vxttDone === '1') return;
  if(el.title){
    el.dataset.vxtt = el.title;
    el.removeAttribute('title');
  }
  el.dataset.vxttDone = '1';
}

if(!_vxTtTouch){
  document.addEventListener('mouseover', e => {
    const target = e.target.closest && e.target.closest('[title], [data-vxtt]');
    if(!target) return;
    _vxTtPrep(target);
    const text = target.dataset.vxtt;
    if(!text || target === _vxTtTarget) return;
    _vxTtTarget = target;
    if(_vxTtTimer) clearTimeout(_vxTtTimer);
    _vxTtTimer = setTimeout(() => {
      if(_vxTtTarget === target && document.body.contains(target)){
        _vxTtShow(target, text);
      }
    }, _vxTtDelay);
  });

  document.addEventListener('mouseout', e => {
    const target = e.target.closest && e.target.closest('[data-vxtt]');
    if(!target) return;
    // Don't hide if the cursor moved to a child of the same target.
    if(e.relatedTarget && target.contains(e.relatedTarget)) return;
    _vxTtHide();
  });

  // Hide on interaction / context change so the bubble doesn't stick.
  document.addEventListener('mousedown', _vxTtHide, true);
  document.addEventListener('scroll',    _vxTtHide, true);
  document.addEventListener('keydown',   e => { if(e.key === 'Escape') _vxTtHide(); });
  window.addEventListener('blur',        _vxTtHide);
  window.addEventListener('resize',      _vxTtHide);
}
