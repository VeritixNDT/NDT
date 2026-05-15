// ══════════════════════════════════════════════════════════════════════════
// V12 ACCESSIBILITY HELPERS — focus trap, ARIA, screen-reader live region
// ══════════════════════════════════════════════════════════════════════════
// Selectors for what counts as "focusable" inside a modal
var A11Y_FOCUSABLE = 'a[href]:not([disabled]), button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Stack of {element, opener, keyHandler} so nested modals unwind correctly
var _a11yModalStack = [];

/**
 * Make a modal element accessible: applies role/aria, traps focus, focuses
 * the first focusable child, and returns focus to the opener on dismiss.
 * Call this immediately after appending the modal to the DOM.
 *
 *   const dispose = openA11yModal(modal, { label: 'Sync activity' });
 *   // ... later, on close:
 *   dispose();   // releases focus trap, returns focus to opener
 *   modal.remove();
 *
 * If you don't call dispose() before removing the modal, this helper
 * cleans up automatically via MutationObserver — but explicit is better.
 */
function openA11yModal(modal, opts = {}) {
  if(!modal) return () => {};
  // Mark as a dialog
  modal.setAttribute('role', opts.role || 'dialog');
  modal.setAttribute('aria-modal', 'true');
  if(opts.label)       modal.setAttribute('aria-label', opts.label);
  if(opts.labelledBy)  modal.setAttribute('aria-labelledby', opts.labelledBy);

  // Remember who opened it so we can return focus on close
  const opener = document.activeElement;

  // Focus trap — Tab and Shift+Tab cycle within the modal
  const keyHandler = (e) => {
    if(e.key === 'Tab') {
      const focusables = Array.from(modal.querySelectorAll(A11Y_FOCUSABLE)).filter(n => n.offsetParent !== null);
      if(!focusables.length) { e.preventDefault(); return; }
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      if(e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    // Escape closes the topmost modal — call .remove() if no explicit handler
    if(e.key === 'Escape' && _a11yModalStack[_a11yModalStack.length - 1]?.element === modal) {
      if(typeof opts.onEscape === 'function') opts.onEscape();
      else { dispose(); modal.remove(); }
    }
  };
  document.addEventListener('keydown', keyHandler, true);

  // Push to stack
  const entry = { element: modal, opener, keyHandler };
  _a11yModalStack.push(entry);

  // Focus the first focusable child after the next paint
  requestAnimationFrame(() => {
    const focusables = modal.querySelectorAll(A11Y_FOCUSABLE);
    if(focusables.length) (opts.initialFocus || focusables[0]).focus();
    else modal.focus();
  });

  // Auto-cleanup if the modal is removed without explicit dispose
  const observer = new MutationObserver(() => {
    if(!document.body.contains(modal)) { dispose(); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function dispose() {
    document.removeEventListener('keydown', keyHandler, true);
    const idx = _a11yModalStack.indexOf(entry);
    if(idx >= 0) _a11yModalStack.splice(idx, 1);
    if(opener && document.contains(opener)) {
      try { opener.focus(); } catch(e){}
    }
  }
  return dispose;
}

// Screen-reader announcement helper — pushes text into a polite live region.
// Used by toasts, sync-status changes, etc.
function a11yAnnounce(message, priority = 'polite') {
  let liveRegion = document.getElementById('a11y-live-region');
  if(!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.id = 'a11y-live-region';
    liveRegion.setAttribute('aria-live', priority);
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';
    document.body.appendChild(liveRegion);
  }
  liveRegion.setAttribute('aria-live', priority);
  // Clearing then setting forces re-announcement when the same text repeats
  liveRegion.textContent = '';
  setTimeout(() => { liveRegion.textContent = message; }, 50);
}

// Walks the DOM and associates standalone <label> elements with the next
// <input>/<select>/<textarea> sibling by inserting matching for/id attributes.
// The original markup uses .fld blocks like:
//   <div class="fld"><label>X</label><input/></div>
// — visually a label, but no for= linkage, so clicking the label doesn't
// focus the input and screen readers don't announce the relationship.
var _a11yLabelCounter = 0;
function a11yWireLabels(root = document) {
  root.querySelectorAll('label:not([for])').forEach(label => {
    // Only wire labels that have a sensible following control
    let target = label.nextElementSibling;
    // Skip any wrapping markup that might sit between label and the actual input
    while(target && !/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) {
      target = target.querySelector ? target.querySelector('input,select,textarea') : null;
      break;
    }
    if(!target) {
      // Try children of the label's parent — handles `<div><label/><span/><input/></div>`
      target = label.parentElement?.querySelector('input,select,textarea');
    }
    if(!target) return;
    if(!target.id) target.id = 'a11y-fld-' + (++_a11yLabelCounter);
    label.setAttribute('for', target.id);
  });
}
