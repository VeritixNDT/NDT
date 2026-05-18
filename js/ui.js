// ── Native confirm() rebrand ────────────────────────────────────────
// The opts-aware vxConfirm() lives further down the file; an older IIFE
// that used to live here exported a single-string `show(msg)` to
// `window.vxConfirm`, which shadowed the real one. Every callsite that
// passed an opts bag (`vxConfirm({message, okLabel, danger})`) ended up
// in the native confirm fallback with `msg` = the opts object, which
// renders as "[object Object]". The shadow is gone now; vxConfirm({...})
// flows to the proper modal. We still keep the small native-confirm
// rebrand below so any stray `confirm()` call shows "Veritix" instead of
// the browser's "[site] says" header.
(function(){
  const _native = window.confirm.bind(window);
  window.confirm = function(msg){ return _native('Veritix\n\n' + msg); };
})();

// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
// V16 EVENT DELEGATION — replaces inline onclick="…" with data-action
// ══════════════════════════════════════════════════════════════════════════
// Why: inline event handlers (onclick, onchange, etc.) require
// `'unsafe-inline'` in the Content-Security-Policy script-src directive.
// That's the single biggest blocker to a strict CSP. Eliminating them lets us
// ship `script-src 'self'` and dramatically reduce XSS blast radius.
//
// Convention:
//   <button data-action="rptDelete" data-args="42">Delete</button>
//   <button data-action="togglePwdVis" data-pass-el="1">Show</button>
//   <input data-on-change="rptSearchChanged" data-pass-el="1">
//   <input data-on-input="defSearchDebounced" data-pass-el="1">
//
// data-args is comma-separated literals; numbers, booleans, null, and string
// literals are coerced automatically. JSON array syntax is also accepted for
// complex shapes: data-args='[1, "two", {"three": 4}]'.
//
// Flags:
//   data-pass-el="1"        → pushes the element as last arg
//   data-pass-event="1"     → pushes the event as last arg (after el if both)
//   data-prevent-default="1" → calls e.preventDefault() before dispatch
//   data-stop-prop="1"       → calls e.stopPropagation() before dispatch

function _vxParseArgs(argStr) {
  if(!argStr) return [];
  // JSON array form
  if(argStr.trim().startsWith('[')) {
    try { return JSON.parse(argStr); } catch(e){}
  }
  // Comma-separated literals form
  // We can't just split(',') because string args may contain commas.
  // Parse char-by-char, tracking quote state.
  const args = [];
  let cur = '';
  let inSingle = false, inDouble = false, depth = 0;
  for(let i = 0; i < argStr.length; i++) {
    const c = argStr[i];
    if(c === "'" && !inDouble) { inSingle = !inSingle; cur += c; continue; }
    if(c === '"' && !inSingle) { inDouble = !inDouble; cur += c; continue; }
    if(!inSingle && !inDouble) {
      if(c === '(' || c === '[' || c === '{') depth++;
      else if(c === ')' || c === ']' || c === '}') depth--;
      else if(c === ',' && depth === 0) { args.push(cur); cur = ''; continue; }
    }
    cur += c;
  }
  if(cur.length) args.push(cur);

  return args.map(s => {
    const t = s.trim();
    if(t === '')         return '';
    if(t === 'true')     return true;
    if(t === 'false')    return false;
    if(t === 'null')     return null;
    if(t === 'undefined') return undefined;
    if(/^-?\d+$/.test(t))         return parseInt(t, 10);
    if(/^-?\d*\.\d+$/.test(t))    return parseFloat(t);
    // String literal — strip surrounding quotes
    if((t.startsWith("'") && t.endsWith("'")) ||
       (t.startsWith('"') && t.endsWith('"'))) {
      return t.slice(1, -1);
    }
    // Unquoted token — pass as string
    return t;
  });
}

function _vxDispatch(eventName) {
  const attrMap = {
    click:      'action',
    change:     'onChange',
    input:      'onInput',
    submit:     'onSubmit',
    keydown:    'onKeydown',
    dblclick:   'onDblclick',
    blur:       'onBlur',
    focus:      'onFocus',
    mousedown:  'onMousedown',
    mouseup:    'onMouseup',
    dragstart:  'onDragstart',
    dragend:    'onDragend',
    dragover:   'onDragover',
    dragleave:  'onDragleave',
    drop:       'onDrop',
  };
  const attr = attrMap[eventName] || eventName;
  // Convert camelCase to kebab-case data attribute lookup
  const datasetKey = attr.replace(/([A-Z])/g, m => m.toLowerCase());
  const selector   = '[data-' + (attr === 'action' ? 'action' : 'on-' + datasetKey.replace(/^on/, '')) + ']';

  return function(e) {
    const target = e.target.closest(selector);
    if(!target) return;
    // BUG FIX: previously this read `target.dataset['on' + Capital(datasetKey) + rest]`
    // where datasetKey already started with 'on' (e.g. 'onchange'), producing
    // `target.dataset.onOnchange` — undefined. The element's actual dataset key
    // for `data-on-change="..."` is `target.dataset.onChange`. Since `attr` is
    // already in the correct camelCase form ('onChange', 'onInput', 'onMousedown',
    // etc.) we just use it directly. This was the root cause of every "property
    // toggle doesn't work" complaint this week — checkboxes, inputs, selects,
    // drag handlers, mousedown handlers all rely on this lookup. Only `data-action`
    // (click) was unaffected because click has its own special-case path.
    const action = attr === 'action'
      ? target.dataset.action
      : target.dataset[attr];
    if(!action) return;

    // V16: keydown filter — fires only when the named key is pressed
    if(eventName === 'keydown' && target.dataset.key) {
      const wanted = target.dataset.key;
      if(e.key !== wanted) return;
    }

    const fn = window[action];
    if(typeof fn !== 'function') {
      console.warn('vx: no handler for action', action);
      return;
    }
    let args = [];
    try { args = _vxParseArgs(target.dataset.args || ''); }
    catch(err) { console.warn('vx: arg parse failed for', action, target.dataset.args); }
    if(target.dataset.passEl    === '1') args.push(target);
    // data-pass-value="1" — pushes the element's current value (or .checked
    // for checkboxes, +value for numbers). Replaces the broken-by-design
    // `data-args=".value"` pattern that some legacy callsites used: the
    // args parser doesn't evaluate JS expressions, so `.value` was passed
    // as a literal string instead of reading from the element. With this
    // helper, handlers like cvSetLogoSize(size) get the actual value with
    // zero per-handler boilerplate.
    if(target.dataset.passValue === '1') {
      const t = target.type;
      if(t === 'checkbox' || t === 'radio') args.push(target.checked);
      else if(t === 'number')               args.push(Number(target.value));
      else                                   args.push(target.value);
    }
    if(target.dataset.passEvent === '1') args.push(e);
    if(target.dataset.preventDefault === '1') e.preventDefault();
    if(target.dataset.stopProp       === '1') e.stopPropagation();
    try { fn.apply(target, args); }
    catch(err) {
      if(typeof vxReportError === 'function') vxReportError(err, 'action:' + action);
      else console.error('action threw:', action, err);
    }
  };
}

// Wire up routers as soon as the body exists
function _vxWireRouters() {
  document.addEventListener('click',     _vxDispatch('click'));
  document.addEventListener('change',    _vxDispatch('change'));
  document.addEventListener('input',     _vxDispatch('input'));
  document.addEventListener('submit',    _vxDispatch('submit'));
  document.addEventListener('keydown',   _vxDispatch('keydown'));
  document.addEventListener('dblclick',  _vxDispatch('dblclick'));
  document.addEventListener('mousedown', _vxDispatch('mousedown'));
  document.addEventListener('mouseup',   _vxDispatch('mouseup'));
  // Focus/blur don't bubble — capture phase
  document.addEventListener('focus',     _vxDispatch('focus'), true);
  document.addEventListener('blur',      _vxDispatch('blur'),  true);
  // Drag events use capture too for consistency
  document.addEventListener('dragstart', _vxDispatch('dragstart'), true);
  document.addEventListener('dragend',   _vxDispatch('dragend'),   true);
  document.addEventListener('dragover',  _vxDispatch('dragover'),  true);
  document.addEventListener('dragleave', _vxDispatch('dragleave'), true);
  document.addEventListener('drop',      _vxDispatch('drop'),      true);
}
if(document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _vxWireRouters);
} else {
  _vxWireRouters();
}

// ── V16 wrappers ──────────────────────────────────────────────────────────
// Small named functions replacing the few remaining multi-statement onclick
// patterns. Each function is named for what it does, not how it does it, so
// the markup stays readable.

function _wHelpFromProfile() { try { closeProfilePanel(); } catch(e){} helpOpen(); }
function _wCloseWelcomeOpenHelp() {
  const m = document.getElementById('vx-welcome-modal'); if(m) m.remove();
  helpOpen('subscription');
}
function _wCloseWelcomePullData() {
  const m = document.getElementById('vx-welcome-modal'); if(m) m.remove();
  vxStore.pullAll().then(r => {
    toast(tf('toast.pulled_count','Pulled {n} entities from server.', {n: r?.count || 0}), 'success');
    vxRenderSubscription();
    ovRefreshDashboard();
  });
}
function _wPullAll() {
  vxStore.pullAll().then(() => {
    toast(t('toast.server_pulled','Server data pulled.'), 'success');
    vxRenderSubscription();
  });
}
function _wSaveLayoutWithToast()    { cvSaveLayout(); toast(t('pe.toast.layout_saved','Layout saved.')); }
function _wResetProcFileQueue()     { _procFileQueue = []; procRenderQueue(); }
function _wRemoveCertPill(i)        { _certPills.splice(i, 1); renderCertPills(); }
function _wApLockResume() {
  const m = document.getElementById('ap-lock-overlay'); if(m) m.remove();
  _apIdleLast = Date.now();
}
function _wToggleUfPasswordVis() {
  const i = document.getElementById('uf-password'); if(!i) return;
  i.type = i.type === 'password' ? 'text' : 'password';
}
function _wHelpToDefects() {
  helpClose();
  const t = document.querySelectorAll('.tn')[3];
  if(t) showPage('defects', t);
}
function _wCvLoadSnapshotAndClose(ts) {
  cvLoadSnapshot(ts);
  const m = document.getElementById('cv-hist-modal'); if(m) m.remove();
}
async function _wCvSaveSnapshotPrompt() {
  const raw = await vxPrompt({ message: t('pe.snap.label_prompt','Snapshot label:'), defaultValue: 'Manual snapshot' });
  if(raw === null) return;          // cancelled
  const label = raw.trim() || 'Manual snapshot';
  cvSaveSnapshot(label);
  const m = document.getElementById('cv-hist-modal'); if(m) m.remove();
  cvOpenHistory();
}
function _wCvResolveCommentAndReopen(blockId, idx) {
  cvResolveComment(blockId, idx);
  const m = document.getElementById('cv-com-modal'); if(m) m.remove();
  cvOpenComments();
}
function _wCvJumpToComment(pageIdx, blockId) {
  cvSwitchPage(pageIdx);
  cvSelectBlock(blockId);
  const m = document.getElementById('cv-com-modal'); if(m) m.remove();
}
function _wCvLoadMethodAndSwitchTab(m) {
  cvLoadMethodTpl(m);
  const tab = document.querySelector('#tpl-toolbar .ribbon-tab');
  if(tab) switchRibbonTab('home', tab);
}
function _wCvSaveAsMethodWithSelect(m) {
  cvPpvMethod = m;
  const sel = document.getElementById('cv-method-select');
  if(sel) sel.value = m;
  cvSaveAsMethodTpl();
}
function _wCvTogglePaletteGroup(id) {
  cvPaletteCollapsed[id] = !cvPaletteCollapsed[id];
  const s = document.getElementById('cv-palette-search');
  cvFilterPalette(s?.value || '');
}
function _wCvTogglePpvDefects() { cvPpvShowDefects = !cvPpvShowDefects; cvRenderCanvas(); }
function _wApResetShortcutAndCancel(id) { apResetShortcut(id); apCancelRebind(); }
function _wMethodToggle(mId, el) { _methodActive[mId] = el.checked; markMethodDirty(); }
function _wCvSetPpvMethod(el) { cvPpvMethod = el.value; cvRenderCanvas(); }
function _wCvSetTplBaseSize(el) { cvTplCfg.baseSize = el.value; }
function _wCvSetTplMargin(el) { cvTplCfg.margin = el.value; }
function _wCvSetTplFooter(el) { cvTplCfg.showFooter = el.checked; cvRenderCanvas(); }
function _wCvSetTplLogo(el)   { cvTplCfg.showLogo   = el.checked; cvRenderCanvas(); }

// V29 — Header/footer toggle + height setters
function _wCvToggleHeader(el){
  if(!cvTplCfg.header) cvTplCfg.header = { enabled:false, heightPx:100, bgColor:'transparent' };
  cvTplCfg.header.enabled = !!el.checked;
  _cvBlockElCache.clear();   // band visibility affects block layout context
  cvRenderCanvas();
  cvSaveLayout();
  toast(t(el.checked ? 'pe.toast.header_enabled' : 'pe.toast.header_disabled',
          el.checked ? 'Header enabled' : 'Header disabled'));
}
function _wCvToggleFooter(el){
  if(!cvTplCfg.footer) cvTplCfg.footer = { enabled:false, heightPx:60, bgColor:'transparent' };
  cvTplCfg.footer.enabled = !!el.checked;
  _cvBlockElCache.clear();
  cvRenderCanvas();
  cvSaveLayout();
  toast(t(el.checked ? 'pe.toast.footer_enabled' : 'pe.toast.footer_disabled',
          el.checked ? 'Footer enabled' : 'Footer disabled'));
}
function _wCvSetHeaderHeight(el){
  if(!cvTplCfg.header) return;
  const v = Math.max(40, Math.min(240, parseInt(el.value, 10) || 100));
  cvTplCfg.header.heightPx = v;
  // Re-scan all block zones in case the new boundary shifts which blocks are
  // inside the header band.
  cvBlocks.forEach(b => { b.zone = _cvDetectZone(b.y, b.h); });
  cvRenderCanvas();
  cvSaveLayout();
}
function _wCvSetFooterHeight(el){
  if(!cvTplCfg.footer) return;
  const v = Math.max(30, Math.min(180, parseInt(el.value, 10) || 60));
  cvTplCfg.footer.heightPx = v;
  cvBlocks.forEach(b => { b.zone = _cvDetectZone(b.y, b.h); });
  cvRenderCanvas();
  cvSaveLayout();
}

// V29 — Auto-setup header + footer from the company profile.
// Reads vx-company-v1, and if the user has filled in anything, builds a
// sensible default header (logo left, name center, address right) plus a
// minimal footer (page number + company name). Replaces any existing
// header/footer blocks after confirming with the user.
async function cvAutoSetupFromCompany(){
  const co = _cvCompany();
  if(!_cvHasCompanyData()){
    toast(t('pe.auto.no_company', 'Fill in your company profile first (Settings → Company), then come back to use auto-setup.'), 'info');
    return;
  }
  // ════════════════════════════════════════════════════════════════════════
  // AUDIT-FIX #12: Layout intent.
  // ════════════════════════════════════════════════════════════════════════
  // The values below describe one specific opinionated layout — a "modern
  // header" with logo-left / name-center / address-right plus a 4px section-
  // colour accent bar, and a "minimal footer" with company-name-left /
  // page-num-center / report-id-right above a thin 2px accent.
  //
  // The handful of values that are intent-bearing (i.e. would naturally vary
  // between presets) are named here so a future preset library can override
  // just these. Per-block coordinates (x:197 for the center title, etc.)
  // remain inline because they're tied to this specific layout's geometry
  // and don't generalise.
  //
  //   X_MARGIN          left/right page padding shared by header and footer
  //   HEADER_PAD_Y      top padding inside the header band
  //   FOOTER_LIFT_PX    how far above the page bottom the footer text sits
  //   ACCENT_HEADER_H   accent bar thickness at header bottom (chunky)
  //   ACCENT_FOOTER_H   accent bar thickness at footer top (thinner)
  //   Z_HEADER_BASE     z-index range for header blocks (100…103)
  //   Z_FOOTER_BASE     z-index range for footer blocks (200…203)
  const X_MARGIN        = 20;
  const HEADER_PAD_Y    = 10;
  const FOOTER_LIFT_PX  = 50;
  const ACCENT_HEADER_H = 4;
  const ACCENT_FOOTER_H = 2;
  const Z_HEADER_BASE   = 100;
  const Z_FOOTER_BASE   = 200;

  // Check if existing header/footer blocks would be replaced
  const existing = cvPages.reduce((acc, p) => {
    (p.blocks || []).forEach(b => {
      if(b.zone === 'header') acc.header++;
      else if(b.zone === 'footer') acc.footer++;
    });
    return acc;
  }, { header: 0, footer: 0 });
  if(existing.header || existing.footer){
    if(!await vxConfirm({ message: t('pe.auto.confirm_replace', 'Are you sure you want to continue? This will replace any existing header and footer blocks on the page.'), okLabel: t('vxc.replace','Replace'), danger: true })) return;
  }

  cvPushUndo();

  // Strip existing zone blocks across every page
  cvPages.forEach(p => {
    p.blocks = (p.blocks || []).filter(b => b.zone !== 'header' && b.zone !== 'footer');
  });

  // Enable header + footer zones if they aren't already
  if(!cvTplCfg.header) cvTplCfg.header = { enabled:false, heightPx:100, bgColor:'transparent' };
  if(!cvTplCfg.footer) cvTplCfg.footer = { enabled:false, heightPx:60, bgColor:'transparent' };
  cvTplCfg.header.enabled = true;
  cvTplCfg.footer.enabled = true;

  // Make sure target page exists — header/footer blocks live on page 0 by
  // convention; the print pipeline replicates them across every page anyway.
  if(!cvPages.length) cvPages = [{ label: 'Page 1', blocks: [] }];
  const targetPage = cvPages[0];

  // ── Build the default HEADER ───────────────────────────────────────────
  // Layout: logo top-left (140×60), company name top-center, address top-right.
  // Coordinates are inside the header band (top 100px of A4).
  const headerY = HEADER_PAD_Y;
  const newBlocks = [];

  // Logo (left) — uses the live company.logo via co-logo-smart smart field
  if(co.logo){
    newBlocks.push({
      id: _cvBlockId(), key: 'co-logo-smart', isLayout: false, zone: 'header',
      x: X_MARGIN, y: headerY, w: 140, h: 56,
      text: 'Company logo', fontSize: '8.5px', bold: false, italic: false,
      color: '#000', bgColor: 'transparent', borderColor: '#cccccc', showBorder: false,
      align: 'left', zIndex: Z_HEADER_BASE, locked: false,
    });
  }

  // Center column intentionally empty — the user asked for a logo-left /
  // details-right header without a centred company-name block. The
  // template number (added further down) still drops into the centre
  // when configured.

  // Address block (right) — uses co-block (multi-line composite)
  if(co.addr1 || co.phone || co.email){
    newBlocks.push({
      id: _cvBlockId(), key: 'co-block', isLayout: false, zone: 'header',
      x: 607, y: headerY, w: 167, h: 82,
      text: 'Company details', fontSize: '8px', bold: false, italic: false,
      color: '#444', bgColor: 'transparent', borderColor: '#cccccc', showBorder: false,
      align: 'right', zIndex: Z_HEADER_BASE + 2, locked: false,
    });
  }

  // Template number — sits as a small mono identifier under the company
  // name. Only added when the active method has a templateNo configured at
  // Settings → Report templates; otherwise the field is meaningless and
  // would render as "—".
  try {
    const _td = (typeof ls === 'function' && typeof TPL_KEY === 'string') ? ls(TPL_KEY, {}) : {};
    const _activeMethod = (typeof cvPpvMethod !== 'undefined' && cvPpvMethod) ? cvPpvMethod : 'UT';
    if(_td && _td[_activeMethod] && _td[_activeMethod].templateNo){
      newBlocks.push({
        id: _cvBlockId(), key: 'tpl-number', isLayout: false, zone: 'header',
        x: 297, y: headerY + 40, w: 200, h: 22,
        text: 'Template no.', fontSize: '8px', bold: false, italic: false,
        color: '#555', bgColor: 'transparent', borderColor: '#cccccc', showBorder: false,
        align: 'center', zIndex: Z_HEADER_BASE + 4, locked: false,
      });
    }
  } catch(e){ /* silent — template number is a nice-to-have */ }

  // Thin accent bar at the bottom of the header to visually divide it from
  // the page body — uses the layout accent-bar block with the section colour.
  newBlocks.push({
    id: _cvBlockId(), key: 'accent-bar', isLayout: true, zone: 'header',
    x: 0, y: 90, w: CV_PAGE_WIDTH_PX, h: ACCENT_HEADER_H,
    text: '', fontSize: '8.5px', bold: false, italic: false,
    color: '#000', bgColor: cvTplCfg.sectionColor || '#404040',
    borderColor: '#cccccc', showBorder: false,
    align: 'left', zIndex: Z_HEADER_BASE + 3, locked: false,
  });

  // ── Build the default FOOTER ───────────────────────────────────────────
  // Layout: company name + VAT bottom-left, page number bottom-center,
  // report ID bottom-right. Footer height defaults to 60px.
  // footerY puts the top of the footer text block FOOTER_LIFT_PX above the
  // page bottom; combined with a 24px tall block this leaves ~26px of
  // bottom margin.
  const footerY = CV_PAGE_HEIGHT_PX - FOOTER_LIFT_PX;

  // Thin accent bar at the top of the footer
  newBlocks.push({
    id: _cvBlockId(), key: 'accent-bar', isLayout: true, zone: 'footer',
    x: 0, y: footerY - 8, w: CV_PAGE_WIDTH_PX, h: ACCENT_FOOTER_H,
    text: '', fontSize: '8.5px', bold: false, italic: false,
    color: '#000', bgColor: cvTplCfg.sectionColor || '#404040',
    borderColor: '#cccccc', showBorder: false,
    align: 'left', zIndex: Z_FOOTER_BASE, locked: false,
  });

  // Footer text (left) — prefers the "Standard footer text" from Settings →
  // Company so accreditation / contact lines surface automatically. Falls back
  // to the live company-name smart-field when no footer text is set, matching
  // the legacy behaviour. Width bumps up to 340px when a footer line is used
  // because accreditation strings tend to be long.
  const hasFooterText = !!(co.footer && String(co.footer).trim());
  const hasConfid     = !!(co.confidstmt && String(co.confidstmt).trim());
  if(hasFooterText){
    newBlocks.push({
      id: _cvBlockId(), key: 'text-block', isLayout: true, zone: 'footer',
      x: X_MARGIN, y: footerY, w: 340, h: 24,
      text: String(co.footer).trim(),
      fontSize: '8px', bold: false, italic: false,
      color: '#666', bgColor: 'transparent', borderColor: '#cccccc', showBorder: false,
      align: 'left', zIndex: Z_FOOTER_BASE + 1, locked: false,
    });
  } else if(co.name){
    newBlocks.push({
      id: _cvBlockId(), key: 'co-name-smart', isLayout: false, zone: 'footer',
      x: X_MARGIN, y: footerY, w: 260, h: 24,
      text: 'Company name', fontSize: '8px', bold: false, italic: false,
      color: '#666', bgColor: 'transparent', borderColor: '#cccccc', showBorder: false,
      align: 'left', zIndex: Z_FOOTER_BASE + 1, locked: false,
    });
  }

  // Page number (right) — was previously the centre column with a
  // separate Report No. block on the right. The auto Report No. block
  // is dropped; the report number already lives in the body of the
  // template via the user-placed report-no field, so duplicating it
  // in the footer was noise. Page number takes over the right slot.
  newBlocks.push({
    id: _cvBlockId(), key: 'page-num', isLayout: false, zone: 'footer',
    x: 514, y: footerY, w: 260, h: 24,
    text: 'Page', fontSize: '8px', bold: false, italic: false,
    color: '#666', bgColor: 'transparent', borderColor: '#cccccc', showBorder: false,
    align: 'right', zIndex: Z_FOOTER_BASE + 2, locked: false,
  });

  // QR code — auto-placed verification mark on the cover page (page 0).
  // Sits inside the page body at the bottom-right corner so it doesn't
  // overlap the footer band; the footer height stays as configured. Uses
  // the qr-code field's native 90×90 size so other blocks aren't shifted.
  // No `zone` tag: QR lives on the cover, not the repeating footer chrome
  // (a verification mark only needs to appear once per document).
  {
    const QR_SIZE = 90;
    const QR_MARGIN = 18;
    const footerH = (cvTplCfg.footer && cvTplCfg.footer.heightPx) || 60;
    newBlocks.push({
      id: _cvBlockId(), key: 'qr-code', isLayout: false,
      x: CV_PAGE_WIDTH_PX - QR_SIZE - QR_MARGIN,
      y: CV_PAGE_HEIGHT_PX - footerH - QR_SIZE - 6,
      w: QR_SIZE, h: QR_SIZE,
      text: 'Verify QR', fontSize: '8px', bold: false, italic: false,
      color: '#000', bgColor: 'transparent', borderColor: '#cccccc', showBorder: false,
      align: 'center', zIndex: Z_FOOTER_BASE + 5, locked: false,
    });
  }

  // Confidentiality statement (full-width, below the name/page/report row).
  // Only added when the user has filled it in at Settings → Company. Renders
  // in smaller italic text — legally important but visually subordinate.
  // When present, bump the footer band height so the new line clears the
  // page margin instead of crashing into the page edge.
  if(hasConfid){
    newBlocks.push({
      id: _cvBlockId(), key: 'text-block', isLayout: true, zone: 'footer',
      x: X_MARGIN, y: footerY + 18, w: CV_PAGE_WIDTH_PX - (X_MARGIN * 2), h: 24,
      text: String(co.confidstmt).trim(),
      fontSize: '7px', bold: false, italic: true,
      color: '#888', bgColor: 'transparent', borderColor: '#cccccc', showBorder: false,
      align: 'center', zIndex: Z_FOOTER_BASE + 4, locked: false,
    });
    // Bigger footer band so both lines fit comfortably above the page edge.
    cvTplCfg.footer.heightPx = Math.max(cvTplCfg.footer.heightPx || 60, 88);
  }

  // Add all new blocks to the target page
  targetPage.blocks = (targetPage.blocks || []).concat(newBlocks);

  // Invalidate the entire cache — band visibility + many new blocks
  _cvBlockElCache.clear();

  // Re-render and persist
  cvSync();
  cvRenderCanvas();
  cvSaveLayout();
  // Sync the toggle checkboxes so the UI reflects the new state
  _cvSyncHeaderFooterUI();

  // Pick the right success message — full setup vs partial (no logo)
  const msg = co.logo
    ? t('pe.auto.success', 'Default header and footer added from your company profile.')
    : t('pe.auto.partial', 'Default layout added. Tip: add a logo in Settings → Company for a complete header.');
  toast(msg, 'success');
}

/** V29 — Sync the Design ribbon's header/footer checkboxes and height
 *  inputs to current cvTplCfg state. Called on editor init and after any
 *  programmatic header/footer change (like the auto-setup wizard). */
function _cvSyncHeaderFooterUI(){
  const hOn = document.getElementById('cv-header-on');
  const fOn = document.getElementById('cv-footer-on');
  const hH  = document.getElementById('cv-header-h');
  const fH  = document.getElementById('cv-footer-h');
  if(hOn && cvTplCfg.header) hOn.checked = !!cvTplCfg.header.enabled;
  if(fOn && cvTplCfg.footer) fOn.checked = !!cvTplCfg.footer.enabled;
  if(hH  && cvTplCfg.header) hH.value    = cvTplCfg.header.heightPx || 100;
  if(fH  && cvTplCfg.footer) fH.value    = cvTplCfg.footer.heightPx || 60;
}
function _wCvUpdateBlockFormat(id, el) {
  cvUpdateBlock(id, 'format', el.value);
  const custom = document.getElementById('cv-fmt-custom-' + id);
  if(custom) custom.value = el.value;
}
function _wApFontFamilyPreview(elNode) { const p = document.getElementById('ap-font-preview'); if(p) p.style.fontFamily = elNode.value; }
function _wApFontSizePreview(elNode)   { const p = document.getElementById('ap-font-preview'); if(p) p.style.fontSize   = elNode.value + 'px'; }
function _wLogoLoadFromInput(el) { logoLoadFile(el.files[0]); el.value = ''; }
function _wPmPhotoLoadFromInput(el) { pmPhotoLoad(el.files[0]); el.value = ''; }
function _wPmSigLoadFromInput(el)   { pmSigLoad(el.files[0]);   el.value = ''; }
function _wSigLoadFromInput(el)     { sigLoadUpload(el.files[0]); el.value = ''; }

// Custom keydown handlers (replace `onkeydown="if(key==='Enter')…"`)
function _wKbInspAddCustomMethod(el, e) {
  // Element has data-pass-el (for the input handler) so dispatcher pushes
  // (target, event). Accept both but only use the event.
  if(e.key === 'Enter') { e.preventDefault(); inspAddCustomMethod(); }
}
function _wKbCertPillAdd(e) {
  if(e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const v = e.target.value.trim();
    if(v) { _certPills.push(v); e.target.value = ''; renderCertPills(); }
  }
}

// Drag/drop helpers (replace inline drag handlers in render templates).
// IMPORTANT: parameter order is (el, e) because the dispatcher pushes
// passEl first then passEvent — the wrappers were originally written as
// (e, el) which silently swapped the args and made every drag/drop handler
// throw. Drag-and-drop file uploads (logo, signature, procedures, photo)
// were broken across the entire app until this fix.
function _wDragoverHighlight(el, e)   { e.preventDefault(); el.classList.add('drag-over'); }
function _wDragleaveUnhighlight(el)   { el.classList.remove('drag-over'); }
function _wDragoverFileZone(el, e) {
  e.preventDefault();
  el.style.borderColor = 'var(--blue)';
  el.style.background  = 'rgba(79,142,247,.08)';
}
function _wDragleaveFileZone(el) {
  el.style.borderColor = 'var(--border2)';
  el.style.background  = 'rgba(79,142,247,.03)';
}

// Form-submit prevention wrappers (replace `onsubmit="event.preventDefault();X()"`)
function _wFormSubmitSignin(e) { e.preventDefault(); vxDoSignin(); }
function _wFormSubmitSignup(e) { e.preventDefault(); vxDoSignup(); }

// Final-pass wrappers — replace template-literal-generated and complex handlers
function _wInboxJumpToSection(sectionId, navTo) {
  if(navTo) {
    const tab = document.querySelectorAll('.tn')[1];
    if(tab) showPage('inbox', tab);
  }
  document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
}
function _wHelpToInbox()    { helpClose(); const t=document.querySelectorAll('.tn')[1]; if(t) showPage('inbox',  t); }
function _wHelpToReports()  { helpClose(); const t=document.querySelectorAll('.tn')[2]; if(t) showPage('reports',t); }
function _wHelpToSubscription() {
  helpClose();
  const t = el('tn-settings'); if(t) showPage('settings', t);
  setTimeout(() => { const s = el('sni-subscription'); if(s) showSS('subscription', s); }, 100);
}
function _wOpenInspectorsSettings() {
  const t = el('tn-settings'); if(t) showPage('settings', t);
  setTimeout(() => { const s = el('sni-inspectors'); if(s) showSS('inspectors', s); }, 100);
}
function _wOpenCmdKFromFocus(el) { el.blur(); openCmdK(); }
function _wUppercaseInput(el)    { el.value = el.value.toUpperCase(); }
function _wDismissParent(el)     { el.parentElement?.remove(); }

// Two-way sync between the native colour picker (#co-color) and the hex
// text input (#co-color-hex). Either input drives the other so they always
// match. Only accept well-formed #RRGGBB from the hex side; ignore partial
// typing so the picker doesn't flicker mid-type.
function _wSyncColorHex(el) {
  // Called from #co-color-hex input — push valid hex back to the picker
  const v = (el.value || '').trim().toUpperCase();
  if(/^#[0-9A-F]{6}$/.test(v)) {
    el.value = v;  // normalise case
    const picker = document.getElementById('co-color');
    if(picker) picker.value = v;
  }
}
function _wSyncColorPicker(el) {
  // Called from #co-color change — push the picker's value to the hex input
  const hexInp = document.getElementById('co-color-hex');
  if(hexInp) hexInp.value = (el.value || '').toUpperCase();
}

// Modal-backdrop click handlers — only close when click hits the overlay itself
function _wCmdKBackdropClose(el, e)        { if(e.target === el) closeCmdK(); }
function _wProfileModalBackdropClose(el,e) { if(e.target === el) closeProfileModal(); }
function _wPwdModalBackdropClose(el,e)     { if(e.target === el) closePwdModal(); }

// Focus delegators — replaces `onclick="document.getElementById('x').focus()"`
function _wFocusInput(id) { const t = document.getElementById(id); if(t) t.focus(); }
function _wClickInput(id) { const t = document.getElementById(id); if(t) t.click(); }

// vxShield — returns an HTML string for the Veritix brand mark. Use anywhere
// the shield should appear: empty states, success moments, watermarks. Pair
// with .vx-shield--sm/md/lg/xl/watermark/ghost/draw modifiers from styles.css.
//   vxShield()                            → default md size
//   vxShield({ size: 'lg' })              → 64×74
//   vxShield({ size: 'watermark' })       → 480×555 @ 5% opacity
//   vxShield({ size: 'lg', draw: true })  → stroke-draws the checkmark on
//                                            insert (success / saved moment)
//   vxShield({ extra: 'my-class' })       → append a project-specific class
function vxShield(opts) {
  const o = opts || {};
  const size  = o.size  ? ' vx-shield--' + o.size : ' vx-shield--md';
  const ghost = o.ghost ? ' vx-shield--ghost' : '';
  const draw  = o.draw  ? ' vx-shield--draw'  : '';
  const extra = o.extra ? ' ' + o.extra : '';
  return '<span class="vx-shield' + size + ghost + draw + extra + '" aria-hidden="true">'
    + '<svg viewBox="0 0 52 60">'
    + '<path class="vx-shield-body" d="M26 2 L50 14 L50 36 Q50 52 26 58 Q2 52 2 36 L2 14 Z"/>'
    + '<path class="vx-shield-check" d="M17 30 L24 38 L36 22"/>'
    + '</svg></span>';
}

// vxPlan method delegators (router uses window[action], can't traverse dots)
function _wOpenBilling() { vxPlan.openBilling(); }

// Generic element-by-id manipulation wrappers
function _wRemoveById(id) { const t = document.getElementById(id); if(t) t.remove(); }

// More modal-backdrop close handlers
function _wEmailModalBackdropClose(el, e) { if(e.target === el) closeEmailModal(); }
function _wHelpBackdropClose(el, e)       { if(e.target === el) helpClose(); }
function _wCvFgColorChange(el) {
  cvExecCmd('foreColor', el.value);
  const p = document.getElementById('cv-fg-preview'); if(p) p.style.borderBottomColor = el.value;
  _cvTrackRecentColor(el.value);
}
function _wCvBgColorChange(el) {
  cvExecCmd('hiliteColor', el.value);
  const p = document.getElementById('cv-bg-preview'); if(p) p.style.background = el.value;
  _cvTrackRecentColor(el.value);
}

// V25 — themed colour picker with recents.
// Opens a small floating panel below the toolbar button showing:
//   • Theme colours (12 well-chosen swatches matching common doc/print colours)
//   • Recently used (last 8, persisted in localStorage)
//   • Custom… (triggers native input as fallback for any RGB)
//
// `slot` = 'fg' (foreground / text) or 'bg' (background / highlight).
var CV_THEME_COLOURS = [
  '#000000','#404040','#737373','#a3a3a3','#d4d4d4','#ffffff',
  '#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e',
  '#14b8a6','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#ec4899',
];
var CV_COLOUR_RECENT_KEY = 'vx-cv-recent-colours';
var CV_COLOUR_RECENT_MAX = 8;

function _cvLoadRecentColours(){
  try {
    const raw = localStorage.getItem(CV_COLOUR_RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(c => typeof c === 'string') : [];
  } catch(e){ return []; }
}
function _cvTrackRecentColor(hex){
  if(!hex || typeof hex !== 'string') return;
  try {
    let list = _cvLoadRecentColours();
    list = [hex.toLowerCase(), ...list.filter(c => c.toLowerCase() !== hex.toLowerCase())];
    if(list.length > CV_COLOUR_RECENT_MAX) list = list.slice(0, CV_COLOUR_RECENT_MAX);
    try {
    localStorage.setItem(CV_COLOUR_RECENT_KEY, JSON.stringify(list));
    } catch(e){ console.warn("ls setItem failed", e); }
  } catch(e){}
}

function _wCvOpenColourPicker(slot, _el, e){
  if(e && e.preventDefault) e.preventDefault();
  if(e && e.stopPropagation) e.stopPropagation();
  // Close any existing popover
  const existing = document.getElementById('cv-colour-popover');
  if(existing){ existing.remove(); if(existing.dataset.slot === slot) return; }

  const anchorBtn = document.getElementById(slot === 'fg' ? 'cv-fg-preview' : 'cv-bg-preview');
  const anchorRect = anchorBtn ? anchorBtn.getBoundingClientRect() : { left: 100, bottom: 100 };

  const recents = _cvLoadRecentColours();
  const themeLbl  = t('pe.colour.theme',  'Theme colours');
  const recentLbl = t('pe.colour.recent', 'Recent');
  const customLbl = t('pe.colour.custom', 'Custom…');
  const titleLbl  = slot === 'fg' ? t('pe.colour.text','Text colour') : t('pe.colour.bg','Background colour');

  const swatch = (hex) => `<button data-action="_wCvPickColour" data-args="'${slot}','${hex}'" title="${hex}" style="width:20px;height:20px;border-radius:3px;border:1px solid var(--border2);background:${hex};cursor:pointer;padding:0"></button>`;

  const pop = document.createElement('div');
  pop.id = 'cv-colour-popover';
  pop.dataset.slot = slot;
  pop.style.cssText = `position:fixed;left:${anchorRect.left}px;top:${anchorRect.bottom + 4}px;background:var(--panel);border:1px solid var(--border2);border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,.4);padding:10px;z-index:99999;min-width:180px;animation:helpScaleIn .12s ease`;
  pop.innerHTML = `
    <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">${escapeHtml(titleLbl)}</div>
    <div style="font-size:9px;color:var(--t3);margin:6px 0 4px">${escapeHtml(themeLbl)}</div>
    <div style="display:grid;grid-template-columns:repeat(6,20px);gap:3px">${CV_THEME_COLOURS.map(swatch).join('')}</div>
    ${recents.length ? `
      <div style="font-size:9px;color:var(--t3);margin:8px 0 4px">${escapeHtml(recentLbl)}</div>
      <div style="display:grid;grid-template-columns:repeat(6,20px);gap:3px">${recents.map(swatch).join('')}</div>
    ` : ''}
    <button data-action="_wCvPickCustomColour" data-args="'${slot}'" style="margin-top:8px;width:100%;padding:5px 8px;font-size:11px;background:var(--bg2);color:var(--t1);border:1px solid var(--border2);border-radius:3px;cursor:pointer">${escapeHtml(customLbl)}</button>
  `;
  document.body.appendChild(pop);

  // Click-outside to close
  setTimeout(() => {
    const closeFn = (evt) => {
      if(!pop.contains(evt.target)){
        pop.remove();
        document.removeEventListener('mousedown', closeFn);
      }
    };
    document.addEventListener('mousedown', closeFn);
  }, 10);
}

function _wCvPickColour(slot, hex){
  if(slot === 'fg'){
    cvExecCmd('foreColor', hex);
    const p = document.getElementById('cv-fg-preview'); if(p) p.style.borderBottomColor = hex;
    const i = document.getElementById('cv-tb-fg'); if(i) i.value = hex;
  } else {
    cvExecCmd('hiliteColor', hex);
    const p = document.getElementById('cv-bg-preview'); if(p) p.style.background = hex;
    const i = document.getElementById('cv-tb-bg'); if(i) i.value = hex;
  }
  _cvTrackRecentColor(hex);
  const pop = document.getElementById('cv-colour-popover');
  if(pop) pop.remove();
}

function _wCvPickCustomColour(slot){
  // Trigger the hidden native input as fallback for "anything else"
  const input = document.getElementById(slot === 'fg' ? 'cv-tb-fg' : 'cv-tb-bg');
  if(input) input.click();
  const pop = document.getElementById('cv-colour-popover');
  if(pop) pop.remove();
}
function _wCvRenamePageStopProp(e, i) { e.stopPropagation(); cvRenamePage(i); }
function _wDropLogo(el, e) {
  e.preventDefault(); el.classList.remove('drag-over');
  logoLoadFile(e.dataTransfer.files[0]);
}
function _wDropPmSig(el, e) {
  e.preventDefault(); el.classList.remove('drag-over');
  pmSigLoad(e.dataTransfer.files[0]);
}
function _wDropSigUpload(el, e) {
  e.preventDefault(); el.classList.remove('drag-over');
  sigLoadUpload(e.dataTransfer.files[0]);
}
function _wDropProcFiles(el, e) {
  e.preventDefault();
  el.style.borderColor = 'var(--border2)';
  el.style.background  = 'rgba(79,142,247,.03)';
  procHandleFiles(e.dataTransfer.files);
}

// V15 ENTITY STORE — IndexedDB-backed canonical storage with localStorage cache
// ══════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════
function toast(msg, type='success') {
  const c = el('toast-container');
  const settings = ls(KEYS.settings, {});
  // V4: respect Do-Not-Disturb hours — silence non-error toasts
  if(settings.dndStart && settings.dndEnd && type !== 'error'){
    const now = new Date();
    const cur = now.getHours()*60 + now.getMinutes();
    const [sh,sm] = settings.dndStart.split(':').map(n=>parseInt(n)||0);
    const [eh,em] = settings.dndEnd.split(':').map(n=>parseInt(n)||0);
    const start = sh*60+sm, end = eh*60+em;
    const inDnd = (start <= end) ? (cur >= start && cur < end) : (cur >= start || cur < end);
    if(inDnd) return; // suppress
  }
  // Apply position from settings
  if(settings.toastPos && c) c.dataset.pos = settings.toastPos;
  const dur = parseInt(settings.toastDuration || '4000');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  // V12: build via DOM, escape user-controlled message — was an XSS surface
  const icon = document.createElement('span'); icon.className = 'toast-icon';
  const text = document.createElement('span'); text.textContent = msg;
  t.appendChild(icon); t.appendChild(text);
  // V12: announce to assistive tech via the live region
  a11yAnnounce(msg, type === 'error' ? 'assertive' : 'polite');
  c.appendChild(t);
  // Optional sound
  if(settings.toastSound === 'on'){
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      const freq = type==='error'?280:type==='warn'?420:type==='info'?660:520;
      o.frequency.value = freq;
      g.gain.value = 0.05;
      o.start(); o.stop(ctx.currentTime + 0.08);
    } catch(e){}
  }
  if(dur > 0) setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(),220); }, dur);
  else {
    // Persistent — add a manual dismiss
    t.style.cursor = 'pointer';
    t.title = 'Click to dismiss';
    t.addEventListener('click', () => { t.classList.add('out'); setTimeout(()=>t.remove(),220); });
  }
}

// ══════════════════════════════════════════════
// CUSTOM CONFIRM DIALOG — replaces native confirm()
// ══════════════════════════════════════════════
// Native confirm() prefixes the title with "[hostname] says" which looks
// unprofessional. This modal shows "Veritix" in a branded header and returns
// a Promise that resolves to true (Confirm) or false (Cancel / Escape / backdrop).
//
// Usage:
//   if (await vxConfirm({ message: 'Remove this report?', danger: true })) { ... }
//   vxConfirm({ message: '...', danger: true }).then(ok => { if(ok) ... });
//
// Options:
//   message  — body text (required)
//   title    — header text (default: "Veritix")
//   okLabel  — confirm button text (default: "Confirm")
//   cancelLabel — cancel button text (default: "Cancel")
//   danger   — if true, the confirm button is styled red and the header
//              accent is red (use for destructive actions like Remove/Delete)
var _vxConfirmWired = false;
var _vxConfirmResolver = null;
function vxConfirm(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    const modal   = document.getElementById('vx-confirm');
    const titleEl = document.getElementById('vx-confirm-title');
    const msgEl   = document.getElementById('vx-confirm-message');
    const okBtn   = document.getElementById('vx-confirm-ok');
    const cancelBtn = document.getElementById('vx-confirm-cancel');
    if(!modal || !titleEl || !msgEl || !okBtn || !cancelBtn) {
      // Fallback to native confirm if the modal is missing for any reason —
      // worst case the user still gets a working dialog, even if uglier.
      console.warn('[vxConfirm] modal elements missing; falling back to native confirm');
      resolve(window.confirm(o.message || 'Are you sure?'));
      return;
    }

    // Populate. Custom titles go through textContent (safe). The default
    // "Veritix" uses innerHTML so the wordmark's red V (.vr) renders.
    if(o.title) titleEl.textContent = o.title;
    else        titleEl.innerHTML   = '<span class="vr">V</span>eritix';
    msgEl.textContent    = o.message  || t('vxc.are_you_sure', 'Are you sure?');
    okBtn.textContent    = o.okLabel  || t('vxc.confirm', 'Confirm');
    cancelBtn.textContent = o.cancelLabel || t('vxc.cancel', 'Cancel');

    // Styling: danger variant for destructive actions
    modal.classList.toggle('danger', !!o.danger);
    okBtn.classList.toggle('btn-danger', !!o.danger);
    okBtn.classList.toggle('btn-primary', !o.danger);

    // Wire buttons once, then reuse forever — _vxConfirmResolver is replaced
    // every call so the closure picks up the latest resolve fn.
    _vxConfirmResolver = resolve;
    if(!_vxConfirmWired) {
      const close = (result) => {
        modal.classList.remove('open');
        const r = _vxConfirmResolver;
        _vxConfirmResolver = null;
        if(r) r(result);
      };
      okBtn.addEventListener('click',     () => close(true));
      cancelBtn.addEventListener('click', () => close(false));
      // Click on backdrop (outside the inner panel) = cancel
      modal.addEventListener('click', (e) => { if(e.target === modal) close(false); });
      // Escape key = cancel; Enter = confirm (only when modal is open)
      document.addEventListener('keydown', (e) => {
        if(!modal.classList.contains('open')) return;
        if(e.key === 'Escape') { e.preventDefault(); close(false); }
        else if(e.key === 'Enter') { e.preventDefault(); close(true); }
      });
      _vxConfirmWired = true;
    }

    // Show + focus the cancel button (safer default than confirm)
    modal.classList.add('open');
    setTimeout(() => cancelBtn.focus(), 30);
  });
}

// ══════════════════════════════════════════════
// CUSTOM PROMPT DIALOG — replaces native prompt()
// ══════════════════════════════════════════════
// Same motivation as vxConfirm above — the browser's "[site] says" header
// looks unprofessional. Returns a Promise that resolves to the entered
// string, or null if the user cancelled (Escape, Cancel button, backdrop).
//
// Usage:
//   const name = await vxPrompt({ message: 'Name this view:', defaultValue: 'My filter' });
//   if(name == null) return;            // cancelled
//   if(!name.trim()) return;            // empty
//
// Options:
//   message      — label shown above the input (required)
//   title        — header text (default: "Veritix")
//   defaultValue — initial input value
//   placeholder  — input placeholder
//   okLabel      — confirm button text (default: "OK")
//   cancelLabel  — cancel button text (default: "Cancel")
//   inputType    — 'text' (default), 'email', or 'textarea' for multi-line
var _vxPromptWired = false;
var _vxPromptResolver = null;
var _vxPromptIsTextarea = false;
function vxPrompt(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    const modal     = document.getElementById('vx-prompt');
    const titleEl   = document.getElementById('vx-prompt-title');
    const msgEl     = document.getElementById('vx-prompt-message');
    const inp       = document.getElementById('vx-prompt-input');
    const ta        = document.getElementById('vx-prompt-textarea');
    const okBtn     = document.getElementById('vx-prompt-ok');
    const cancelBtn = document.getElementById('vx-prompt-cancel');
    if(!modal || !titleEl || !msgEl || !inp || !ta || !okBtn || !cancelBtn) {
      console.warn('[vxPrompt] modal elements missing; falling back to native prompt');
      resolve(window.prompt(o.message || '', o.defaultValue != null ? o.defaultValue : ''));
      return;
    }

    if(o.title) titleEl.textContent = o.title;
    else        titleEl.innerHTML   = '<span class="vr">V</span>eritix';
    msgEl.textContent     = o.message     || '';
    okBtn.textContent     = o.okLabel     || t('vxc.ok',     'OK');
    cancelBtn.textContent = o.cancelLabel || t('vxc.cancel', 'Cancel');

    const isTextarea = o.inputType === 'textarea';
    _vxPromptIsTextarea = isTextarea;
    inp.style.display = isTextarea ? 'none' : '';
    ta.style.display  = isTextarea ? ''     : 'none';
    const field = isTextarea ? ta : inp;
    if(!isTextarea) inp.type = (o.inputType === 'email') ? 'email' : 'text';
    field.value       = o.defaultValue != null ? o.defaultValue : '';
    field.placeholder = o.placeholder || '';

    _vxPromptResolver = resolve;
    if(!_vxPromptWired) {
      const close = (result) => {
        modal.classList.remove('open');
        const r = _vxPromptResolver;
        _vxPromptResolver = null;
        if(r) r(result);
      };
      const submit = () => {
        const f = _vxPromptIsTextarea ? ta : inp;
        close(f.value);
      };
      okBtn.addEventListener('click',     submit);
      cancelBtn.addEventListener('click', () => close(null));
      modal.addEventListener('click', (e) => { if(e.target === modal) close(null); });
      // Enter submits in single-line mode. In textarea mode, Enter inserts
      // a newline normally; Ctrl/Cmd+Enter submits.
      document.addEventListener('keydown', (e) => {
        if(!modal.classList.contains('open')) return;
        if(e.key === 'Escape') { e.preventDefault(); close(null); return; }
        if(e.key === 'Enter') {
          if(_vxPromptIsTextarea && !(e.ctrlKey || e.metaKey)) return;
          e.preventDefault();
          submit();
        }
      });
      _vxPromptWired = true;
    }

    modal.classList.add('open');
    setTimeout(() => {
      field.focus();
      if(!isTextarea && typeof field.select === 'function') field.select();
    }, 30);
  });
}

// V4: Number formatter respecting decimal/thousands separator settings
function fmtNumber(n, decimals){
  if(n == null || isNaN(n)) return '—';
  const settings = ls(KEYS.settings, {});
  const decSep = settings.decimal || '.';
  const thouSep = settings.thousands != null ? settings.thousands : ',';
  decimals = decimals != null ? decimals : (Number.isInteger(+n) ? 0 : 2);
  const fixed = Number(n).toFixed(decimals);
  const [intPart, fracPart] = fixed.split('.');
  const intWithSep = thouSep ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thouSep) : intPart;
  return fracPart ? intWithSep + decSep + fracPart : intWithSep;
}

// V4: Convert mm to user's chosen unit system
function formatLength(mm, decimals){
  if(mm == null || isNaN(mm)) return '—';
  const settings = ls(KEYS.settings, {});
  if(settings.units === 'imperial'){
    const inches = mm / 25.4;
    return fmtNumber(inches, decimals != null ? decimals : 3) + ' in';
  }
  return fmtNumber(mm, decimals != null ? decimals : 1) + ' mm';
}

// V5: Unit-system helpers — measurements always stored in mm; display in user's unit.
function unitLabel(){
  const s = ls(KEYS.settings, {});
  return s.units === 'imperial' ? 'in' : 'mm';
}
function unitName(){
  const s = ls(KEYS.settings, {});
  return s.units === 'imperial' ? 'inches' : 'millimetres';
}
// Convert raw mm value (storage) → display string in user's preferred unit (no unit suffix).
function mmToDisplayValue(mm, decimals){
  if(mm == null || mm === '') return '';
  const n = parseFloat(mm);
  if(isNaN(n)) return '';
  const s = ls(KEYS.settings, {});
  if(s.units === 'imperial') return (n / 25.4).toFixed(decimals != null ? decimals : 3);
  return decimals != null ? n.toFixed(decimals) : String(n);
}
// Convert user-entered display value (in their unit) → mm (storage).
function inputValueToMm(v){
  if(v == null || v === '') return '';
  const n = parseFloat(v);
  if(isNaN(n)) return v;
  const s = ls(KEYS.settings, {});
  if(s.units === 'imperial') return String(+(n * 25.4).toFixed(3));
  return String(n);
}
// Refresh any element with [data-unit-label="...{unit}..."] to reflect current unit setting.
function refreshUnitLabels(root){
  const u = unitLabel();
  const scope = root || document;
  scope.querySelectorAll('[data-unit-label]').forEach(lbl => {
    lbl.textContent = lbl.dataset.unitLabel.replace(/\{unit\}/g, u);
  });
  scope.querySelectorAll('[data-unit-placeholder]').forEach(inp => {
    const raw = inp.dataset.unitPlaceholder;
    // Support either "{unit}" pattern or a JSON map { "mm": "...", "in": "..." }
    if(raw && raw.trim().startsWith('{') && raw.includes('"')) {
      try { const map = JSON.parse(raw); if(map[u]) inp.placeholder = map[u]; }
      catch(e) { inp.placeholder = raw.replace(/\{unit\}/g, u); }
    } else if(raw) {
      inp.placeholder = raw.replace(/\{unit\}/g, u);
    }
  });
}

// ══════════════════════════════════════════════
// COMMAND PALETTE (⌘K)
// ══════════════════════════════════════════════
var _cmdkSelected = 0;
var _cmdkItems = [];

function _cmdkBuildItems() {
  const reports = ls(KEYS.reports, []);
  const items = [];

  // Pages
  items.push({
    section: 'Navigation',
    title: 'Home / Overview',
    sub: 'Dashboard with metrics and recent activity',
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z"/></svg>',
    action: () => showPage('overview', document.querySelector('.tn'))
  });
  items.push({
    section: 'Navigation',
    title: 'All Reports',
    sub: 'Browse and filter inspection reports',
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    action: () => showPage('reports', document.querySelectorAll('.tn')[2])
  });
  items.push({
    section: 'Navigation',
    title: 'Defects',
    sub: 'Track and review defects across reports',
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>',
    action: () => showPage('defects', document.querySelectorAll('.tn')[3])
  });
  items.push({
    section: 'Navigation',
    title: 'Settings',
    sub: 'Configure methods, templates, and access',
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    action: () => showPage('settings', el('tn-settings'))
  });
  items.push({
    section: 'Navigation',
    title: 'User manual',
    sub: 'Open the in-app help center (?)',
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    action: () => helpOpen()
  });

  // Quick actions
  const newReportSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>';
  const methods = (typeof getActiveMethods === 'function') ? getActiveMethods() : [];
  methods.slice(0, 6).forEach(m => {
    items.push({
      section: 'Quick actions',
      title: `New ${m.id} report`,
      sub: m.name,
      iconSvg: newReportSvg,
      action: () => { showPage('overview', document.querySelector('.tn')); setTimeout(() => ovNewReport(m.id), 50); }
    });
  });

  // Recent reports (last 8)
  const recent = reports.slice(-8).reverse();
  recent.forEach(r => {
    items.push({
      section: 'Recent reports',
      title: r.reportNo || `${r.method} report`,
      sub: `${r.method} · ${escapeHtml(r.subject || r.client || 'No subject')} · ${(r.verdict || 'Draft')}`,
      iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      action: () => { showPage('reports', document.querySelectorAll('.tn')[2]); }
    });
  });

  // V9: Deep content search across ALL reports — searches remarks, findings,
  // equipment serials, inspector notes, etc. Surfaces under "All reports"
  // with the matched snippet shown in the sub-line.
  const olderReports = reports.slice(0, -8); // skip the recent-8 already added
  olderReports.forEach(r => {
    // Build a concatenated searchable string from every value
    const fields = Object.entries(r).filter(([k, v]) => typeof v === 'string' && v.length > 0 && k !== 'method' && k !== 'verdict');
    const haystack = fields.map(([k, v]) => `${k}: ${v}`).join(' · ').toLowerCase();
    items.push({
      section: 'All reports (search content)',
      title: r.reportNo || `${r.method} report`,
      sub: `${r.method} · ${escapeHtml(r.subject || r.client || '—')} · ${fmtDate(r.createdAt)}`,
      _haystack: haystack,
      iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
      action: () => { showPage('reports', document.querySelectorAll('.tn')[2]); }
    });
  });

  // V9: Defects search hits
  const defects = ls(KEYS.defects, []);
  defects.slice(0, 200).forEach(d => {
    const fields = Object.entries(d).filter(([k, v]) => typeof v === 'string' && v.length > 0);
    const haystack = fields.map(([k, v]) => `${k}: ${v}`).join(' · ').toLowerCase();
    items.push({
      section: 'Defects (search content)',
      title: d.defectId || 'Defect',
      sub: `${d.type || '—'} · ${d.severity || '—'} · ${d.location || ''}`,
      _haystack: haystack,
      iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>',
      action: () => { showPage('defects', document.querySelectorAll('.tn')[3]); }
    });
  });

  // Settings shortcuts
  const settingsItems = [
    ['Company profile', 'company', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/></svg>'],
    ['Inspectors', 'inspectors', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="9" cy="12" r="2.5"/></svg>'],
    ['NDT methods', 'methods', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v6.5a2 2 0 0 0 .35 1.13l5.3 7.66a2 2 0 0 1-1.65 3.13H6a2 2 0 0 1-1.65-3.13l5.3-7.66A2 2 0 0 0 10 8.5V2"/><path d="M9 2h6"/></svg>'],
    ['Report templates', 'templates', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>'],
    ['PDF layout editor', 'pdfeditor', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'],
    ['Theme & display', 'appearance', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="11.5" r="2.5"/><circle cx="6.5" cy="13.5" r="2.5"/></svg>'],
  ];
  settingsItems.forEach(([title, key, svg]) => {
    items.push({
      section: 'Settings',
      title: title,
      sub: 'Open settings page',
      iconSvg: svg,
      action: () => {
        showPage('settings', el('tn-settings'));
        setTimeout(() => {
          const btn = el('sni-' + key);
          if(btn && typeof showSS === 'function') showSS(key, btn);
        }, 60);
      }
    });
  });

  return items;
}

function openCmdK() {
  el('cmdk-overlay').classList.add('open');
  const inp = el('cmdk-input');
  inp.value = '';
  _cmdkSelected = 0;
  cmdkRender();
  requestAnimationFrame(() => inp.focus());
}
function closeCmdK() {
  el('cmdk-overlay').classList.remove('open');
}
function cmdkRender() {
  const all = _cmdkBuildItems();
  const q = (el('cmdk-input').value || '').toLowerCase().trim();
  // V9: search includes deep _haystack for report/defect content matches
  const filtered = q
    ? all.filter(it => (it.title + ' ' + (it.sub || '') + ' ' + it.section + ' ' + (it._haystack || '')).toLowerCase().includes(q))
    : all.filter(it => !it._haystack || it.section === 'Recent reports'); // hide deep-search items until query typed
  _cmdkItems = filtered;
  if(_cmdkSelected >= filtered.length) _cmdkSelected = 0;

  const list = el('cmdk-list');
  if(!filtered.length) {
    list.innerHTML = '<div class="cmdk-empty">No matches found.</div>';
    return;
  }
  // Group by section, preserving order
  const sections = [];
  const seen = {};
  filtered.forEach((it, i) => {
    if(!seen[it.section]) { seen[it.section] = []; sections.push(it.section); }
    seen[it.section].push({ it, idx: i });
  });
  let html = '';
  sections.forEach(sec => {
    html += `<div class="cmdk-section-label">${sec}</div>`;
    seen[sec].forEach(({ it, idx }) => {
      const sel = idx === _cmdkSelected ? ' selected' : '';
      html += `<div class="cmdk-item${sel}" data-action="cmdkExec" data-args="${idx}" onmouseenter="_cmdkSelected=${idx};cmdkUpdateSel()">
        <div class="cmdk-icon">${it.iconSvg}</div>
        <div class="cmdk-text">
          <div class="cmdk-title">${escapeHtml(it.title)}</div>
          ${it.sub ? `<div class="cmdk-sub">${escapeHtml(it.sub)}</div>` : ''}
        </div>
      </div>`;
    });
  });
  list.innerHTML = html;
}
function cmdkUpdateSel() {
  document.querySelectorAll('.cmdk-item').forEach((n, i) => {
    n.classList.toggle('selected', i === _cmdkSelected);
  });
}
function cmdkExec(idx) {
  const it = _cmdkItems[idx];
  if(!it) return;
  closeCmdK();
  setTimeout(() => { try { it.action(); } catch(e){ console.error(e); } }, 50);
}
function cmdkOnKeyDown(e) {
  if(e.key === 'Escape') { e.preventDefault(); closeCmdK(); return; }
  if(e.key === 'ArrowDown') { e.preventDefault(); _cmdkSelected = Math.min(_cmdkItems.length - 1, _cmdkSelected + 1); cmdkUpdateSel(); cmdkScrollToSel(); return; }
  if(e.key === 'ArrowUp')   { e.preventDefault(); _cmdkSelected = Math.max(0, _cmdkSelected - 1); cmdkUpdateSel(); cmdkScrollToSel(); return; }
  if(e.key === 'Enter')     { e.preventDefault(); cmdkExec(_cmdkSelected); return; }
}
function cmdkScrollToSel() {
  const sel = document.querySelector('.cmdk-item.selected');
  if(sel) sel.scrollIntoView({ block: 'nearest' });
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }

// Global keyboard shortcut
document.addEventListener('keydown', e => {
  // Respect the user's "Enable global shortcuts" preference
  const settings = ls(KEYS.settings, {});
  if(settings.shortcutsEnabled === false) return;
  // V5: registry-driven matching
  if(matchShortcut(e, getShortcutKey('cmd-palette'))) {
    e.preventDefault();
    if(el('cmdk-overlay').classList.contains('open')) closeCmdK();
    else openCmdK();
  }
});

// ══════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════
function _buildNotifs() {
  // Generate friendly notifications from recent reports
  const reports = ls(KEYS.reports, []).slice(-5).reverse();
  const out = [];
  reports.forEach((r, i) => {
    const isFail = r.verdict === 'Not acceptable';
    const isOk   = r.verdict === 'Acceptable';
    out.push({
      kind: isFail ? 'danger' : isOk ? 'success' : 'info',
      text: `${r.method} report <strong>${r.reportNo || ''}</strong> ${isFail ? 'flagged as not acceptable' : isOk ? 'marked acceptable' : 'created'}${r.client ? ' for ' + escapeHtml(r.client) : ''}.`,
      time: r.createdAt ? fmtDate(r.createdAt) : '',
      unread: i < 2
    });
  });
  return out;
}
function toggleNotifDropdown() {
  const dd = el('notif-dropdown');
  const isOpen = dd.classList.contains('open');
  if(isOpen) { dd.classList.remove('open'); return; }

  const items = _buildNotifs();
  const list = el('notif-list');
  if(!items.length) {
    list.innerHTML = '<div class="notif-empty">No notifications yet.<br>Activity will appear here.</div>';
  } else {
    list.innerHTML = items.map(n => {
      const iconMap = {
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        danger:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
        warn:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>',
        info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
      };
      return `<div class="notif-item${n.unread ? ' unread' : ''}">
        <div class="notif-icon ${n.kind}">${iconMap[n.kind] || iconMap.info}</div>
        <div class="notif-body">
          <div class="notif-text">${n.text}</div>
          <div class="notif-time">${n.time}</div>
        </div>
      </div>`;
    }).join('');
  }
  // Show notification dot if any unread
  el('notif-btn').classList.toggle('has-notif', items.some(n => n.unread));

  dd.classList.add('open');
  setTimeout(() => {
    document.addEventListener('click', _closeNotifOutside, { once: true });
  }, 0);
}
function _closeNotifOutside(e) {
  const dd = el('notif-dropdown');
  const btn = el('notif-btn');
  if(!dd.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
    dd.classList.remove('open');
  } else if(dd.classList.contains('open')) {
    document.addEventListener('click', _closeNotifOutside, { once: true });
  }
}
function closeNotifDropdown() { el('notif-dropdown').classList.remove('open'); }
function clearNotifs() {
  document.querySelectorAll('.notif-item.unread').forEach(n => n.classList.remove('unread'));
  el('notif-btn').classList.remove('has-notif');
}
function refreshNotifBadge() {
  const items = _buildNotifs();
  el('notif-btn').classList.toggle('has-notif', items.some(n => n.unread));
}

// ══════════════════════════════════════════════
// SPARKLINE GENERATOR
// ══════════════════════════════════════════════
function sparklineSVG(values, color) {
  if(!values || values.length < 2) {
    values = [0, 0, 0, 0, 0, 0, 0];
  }
  const w = 100, h = 32, pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = (max - min) || 1;
  const stepX = (w - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y];
  });
  const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const areaPath = linePath + ` L${points[points.length-1][0].toFixed(1)},${h-pad} L${points[0][0].toFixed(1)},${h-pad} Z`;
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <path class="area" d="${areaPath}" fill="${color}"/>
    <path class="line" d="${linePath}" stroke="${color}"/>
  </svg>`;
}

// Generate a 7-day distribution from a list of dated items
function generate7DaySparkline(items, dateField) {
  const now = new Date();
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  items.forEach(it => {
    const d = it[dateField] ? new Date(it[dateField]) : null;
    if(!d || isNaN(d)) return;
    const diff = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if(diff >= 0 && diff < 7) buckets[6 - diff]++;
  });
  return buckets;
}


// ══════════════════════════════════════════════
// PROFILE PANEL
// ══════════════════════════════════════════════
function toggleProfileDropdown() {
  const dd = el('profile-dropdown');
  const isOpen = dd.classList.contains('open');
  dd.classList.toggle('open');
  if(!isOpen) {
    const u = CURRENT_USER; if(!u) return;
    const ini = initials(u.name);
    el('pd-avatar').textContent = ini;
    el('pd-name').textContent   = u.name  || '—';
    el('pd-role').textContent   = u.role  || 'Inspector';
    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', _closeDropdownOutside, { once: true });
    }, 0);
  }
}
function _closeDropdownOutside(e) {
  const dd = el('profile-dropdown');
  const btn = el('avatar-btn');
  if(!dd.contains(e.target) && e.target !== btn) {
    dd.classList.remove('open');
  } else if(dd.classList.contains('open')) {
    document.addEventListener('click', _closeDropdownOutside, { once: true });
  }
}
function closeDropdown() {
  el('profile-dropdown').classList.remove('open');
}

// ── Profile Modal ──
var _pmSigData = null;
var _pmPhotoData = null;

function togglePwdVis(btn) {
  const inp = btn.parentNode.querySelector('input');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.innerHTML = show
    ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2"/><line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" stroke-width="1.2"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2"/></svg>';
}

function pmPhotoLoad(file) {
  if(!file || !file.type.startsWith('image/')) return;
  if(file.size > 2*1024*1024) { toast(t('toast.image_too_large_2', 'Image must be under 2 MB.'),'error'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    _pmPhotoData = e.target.result;
    const img = el('pm-photo-img');
    img.src = _pmPhotoData; img.style.display = '';
    el('pm-avatar').style.fontSize = '0';
  };
  reader.readAsDataURL(file);
}

function openProfilePanel() { openProfileModal(); }
function closeProfilePanel() { closeProfileModal(); }
function closeProfileSubForms() {}
function startProfileEdit() { openProfileModal(); }
function cancelProfileEdit() { closeProfileModal(); }

function openProfileModal() {
  closeDropdown();
  const u = CURRENT_USER; if(!u) return;
  const av = el('pm-avatar');
  if(av){ av.textContent = initials(u.name); av.style.background = uaGrad(u.name); av.style.fontSize = '18px'; }
  // Photo
  _pmPhotoData = u.photo || null;
  const photoImg = el('pm-photo-img');
  if(_pmPhotoData) {
    photoImg.src = _pmPhotoData; photoImg.style.display = '';
    av.style.fontSize = '0';
  } else {
    photoImg.style.display = 'none';
  }
  el('pm-name').textContent = u.name || '—';
  const rb = el('pm-role-badge');
  if(rb) rb.innerHTML = `<span class="role ${roleClass(u.role)}">${u.role||'Inspector'}</span>`;
  el('pm-meta').textContent = `Last login: ${fmtDate(u.lastLogin)||'Never'}  Since: ${fmtDate(u.createdAt)||'—'}`;
  el('pm-name-inp').value  = u.name      || '';
  el('pm-jobtitle').value  = u.jobTitle  || '';
  el('pm-email').value     = u.email     || '';
  el('pm-phone').value     = u.phone     || '';
  el('pm-dept').value      = u.dept      || '';
  el('pm-location').value  = u.location  || '';
  el('pm-empid').value     = u.empId     || '';
  el('pm-startdate').value = u.startDate || '';
  el('pm-notes').value     = u.notes     || '';
  _pmSigData = u.signature || null;
  if(_pmSigData) {
    el('pm-sig-preview').src = _pmSigData; el('pm-sig-preview').style.display = '';
    el('pm-sig-hint').style.display = 'none'; el('pm-sig-clear').style.display = '';
  } else {
    el('pm-sig-preview').style.display = 'none';
    el('pm-sig-hint').style.display = ''; el('pm-sig-clear').style.display = 'none';
  }
  el('pm-overlay').classList.add('open');
}
function closeProfileModal() { el('pm-overlay').classList.remove('open'); }

function pmSigLoad(file) {
  if(!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = e => {
    _pmSigData = e.target.result;
    el('pm-sig-preview').src = _pmSigData; el('pm-sig-preview').style.display = '';
    el('pm-sig-hint').style.display = 'none'; el('pm-sig-clear').style.display = '';
  };
  reader.readAsDataURL(file);
}
function pmSigClear() {
  _pmSigData = null;
  el('pm-sig-preview').style.display = 'none';
  el('pm-sig-hint').style.display = ''; el('pm-sig-clear').style.display = 'none';
}

function saveProfileModal() {
  const u = CURRENT_USER; if(!u) return;
  const name = el('pm-name-inp').value.trim();
  if(!name) { toast(t('toast.name_empty', 'Name cannot be empty.'), 'error'); return; }
  u.name      = name;
  u.jobTitle  = el('pm-jobtitle').value.trim();
  u.email     = el('pm-email').value.trim();
  u.phone     = el('pm-phone').value.trim();
  u.dept      = el('pm-dept').value.trim();
  u.location  = el('pm-location').value.trim();
  u.empId     = el('pm-empid').value.trim();
  u.startDate = el('pm-startdate').value || '';
  u.notes     = el('pm-notes').value.trim();
  u.signature = _pmSigData;
  u.photo     = _pmPhotoData;
  const idx = AUTH_USERS.findIndex(x => x.id === u.id);
  if(idx >= 0) AUTH_USERS[idx] = u;
  saveUsers();
  // Update all avatars
  const ini = initials(u.name);
  el('pd-avatar').textContent  = ini;
  el('pd-name').textContent    = u.name;
  const avBtn = el('avatar-btn');
  if(u.photo && isSafeImageUrl(u.photo)) {
    // Build the img element via DOM API rather than innerHTML — eliminates XSS surface
    avBtn.textContent = '';
    el('pd-avatar').textContent = '';
    [avBtn, el('pd-avatar')].forEach(host => {
      const img = document.createElement('img');
      img.alt = u.name;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      img.src = u.photo;
      img.onerror = () => { host.textContent = ini; };
      host.appendChild(img);
    });
  } else {
    avBtn.textContent = ini;
    el('pd-avatar').textContent = ini;
  }
  closeProfileModal();
  uaRender();
  toast(t('toast.profile_updated','Profile updated.'));
}

// ── Password Modal ──
function openPwdModal() {
  closeDropdown();
  el('pp-pwd-current').value = ''; el('pp-pwd-new').value = ''; el('pp-pwd-confirm').value = '';
  el('pp-pwd-err').style.display = 'none';
  el('pwd-overlay').classList.add('open');
  requestAnimationFrame(() => requestAnimationFrame(() => el('pp-pwd-current')?.focus()));
}
function closePwdModal() { el('pwd-overlay').classList.remove('open'); }
async function savePwdModal() {
  const u = CURRENT_USER; if(!u) return;
  const cur = el('pp-pwd-current').value;
  const nw  = el('pp-pwd-new').value;
  const cf  = el('pp-pwd-confirm').value;
  const err = el('pp-pwd-err');
  err.style.display = 'none';
  if(!cur) { err.textContent='Enter current password.'; err.style.display=''; return; }
  if(nw.length < 6) { err.textContent='New password must be at least 6 characters.'; err.style.display=''; return; }
  if(nw !== cf) { err.textContent='Passwords do not match.'; err.style.display=''; return; }
  const hash = await sha256(cur);
  if(hash !== u.pwd) { err.textContent='Current password is incorrect.'; err.style.display=''; return; }
  u.pwd = await sha256(nw);
  const idx = AUTH_USERS.findIndex(x => x.id === u.id);
  if(idx >= 0) AUTH_USERS[idx] = u;
  saveUsers();
  closePwdModal();
  toast(t('toast.password_changed','Password changed.'));
}

// ══════════════════════════════════════════════
// PAGE NAVIGATION
// ══════════════════════════════════════════════
function showPage(id, btn) {
  if(id === 'settings' && !(typeof vxIsAdmin === 'function' ? vxIsAdmin() : CURRENT_USER?.role === 'Admin')) {
    toast(t('toast.admin_required_settings','Admin access required for Settings.'), 'error');
    return;
  }
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tn').forEach(b=>{ b.classList.remove('active'); b.removeAttribute('aria-current'); });
  const pg = el('page-'+id); if(pg) pg.classList.add('active');
  if(btn) { btn.classList.add('active'); btn.setAttribute('aria-current', 'page'); }
  if(id === 'overview') ovInit();
  if(id === 'reports') rptInit();
  if(id === 'defects') defInit();
  if(id === 'inbox') inboxRender();
  // V12: re-wire any newly-rendered labels on this page
  if(typeof a11yWireLabels === 'function') a11yWireLabels(pg || document);
  closeProfilePanel();
}

function showSS(id, btn) {
  // Defense-in-depth: every settings sub-section is admin-only. The
  // top-nav settings button is already hidden for non-admins, but if
  // any future code path (deep link, programmatic nav, etc) routes a
  // non-admin into the settings shell, replace the section content
  // with the "admin required" panel instead of letting them interact.
  if(VX_ADMIN_ONLY_SECTIONS.has(id) && !vxIsAdmin()){
    document.querySelectorAll('.ss').forEach(s=>s.classList.remove('active'));
    document.querySelectorAll('.snav-item').forEach(b=>b.classList.remove('active'));
    const sec = el('ss-'+id); if(sec) sec.classList.add('active');
    const sni = btn || el('sni-'+id); if(sni) sni.classList.add('active');
    vxShowAdminRequired(id);
    return;
  }
  document.querySelectorAll('.ss').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.snav-item').forEach(b=>b.classList.remove('active'));
  const sec = el('ss-'+id); if(sec) sec.classList.add('active');
  const sni = btn || el('sni-'+id); if(sni) sni.classList.add('active');
  if(id==='users')       { try{uaRender();}catch(e){console.error(e);} }
  if(id==='inspectors')  { try{inspRender();}catch(e){console.error(e);} }
  if(id==='database') { try{dbRefreshCard();}catch(e){console.error(e);} }
  if(id==='subscription') { try{vxRenderSubscription();}catch(e){console.error(e);} }
  if(id==='system')   { renderSystemInfo(); }
  if(id==='methods')  { renderMethodsTable(); }
  if(id==='numbering'){ renderNumberingPreview(); }
  if(id==='templates'){ tplBuildTabs(); }
  if(id==='pdfeditor'){
    if(!vxIsDesktopClass()){
      cvShowDesktopOnly();
      return;
    }
    try{ cvInitCanvas(); setTimeout(cvOpenFullPage, 80); }catch(e){console.error('cvInit',e);}
  }
  if(id==='procedures'){ procInit(); }
  if(id==='notifications'){ try{ if(typeof webhookLoadIntoUi === 'function') webhookLoadIntoUi(); }catch(e){console.error(e);} }
  if(id==='appearance'){ try{ renderLocalePicker(); }catch(e){console.error(e);} }
}

function updateReportCount() {
  const reports = ls(KEYS.reports, []);
  set('report-count-label', reports.length + ' report' + (reports.length===1?'':'s'));
}

