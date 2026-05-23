// ══════════════════════════════════════════════════════════════════════════
// V22 PRINT / PDF EXPORT
// ══════════════════════════════════════════════════════════════════════════
// The browser's print dialog doubles as PDF export ("Save as PDF" / "Print
// to PDF" in every major browser). We render the canvas into a standalone
// HTML document inside a hidden iframe, then invoke print on that iframe.
// This is preferable to client-side PDF synthesis (jsPDF) for two reasons:
// (1) text in the PDF is selectable and searchable; (2) it works identically
// across browsers without bundling a library. The trade-off is the user
// going through a print dialog — accepted for a B2B tool where inspectors
// print certificates routinely anyway.

/**
 * Build the standalone print HTML containing all pages.
 * @param {object} report  Resolved report data (real or sample).
 * @returns {string} Full HTML document.
 */
function cvBuildPrintHTML(report){
  // AUDIT-FIX #1: shared cross-reference resolution. Defects don't get a
  // page each — they all render together inside the editor page that hosts
  // the defect-table or defect-row-loop block. The helper locates that page
  // and maps every defect index to it, so cross-references print correctly.
  cvCrossRefMap = _cvBuildCrossRefMap(report);

  // V29 — Collect header/footer blocks across ALL pages. These render on
  // every page in the printed output, regardless of which editor page they
  // were placed on. De-duplicate by id in case a header block was copied to
  // multiple pages by the user.
  const seen = new Set();
  const headerBlocks = [];
  const footerBlocks = [];
  cvPages.forEach(page => {
    (page.blocks || []).forEach(b => {
      if(seen.has(b.id)) return;
      if(b.zone === 'header'){ headerBlocks.push(b); seen.add(b.id); }
      else if(b.zone === 'footer'){ footerBlocks.push(b); seen.add(b.id); }
    });
  });

  /** Render one block as absolutely-positioned div HTML. Shared helper used
   *  for both zone blocks and body blocks so they format consistently.
   *  SECURITY: colour/font-size/align values come from user-editable block
   *  properties and imported template JSON, then get injected into a style="…"
   *  HTML attribute (not style.cssText). Without validation a value like
   *  `red" onmouseover="alert(1)` would break out of the attribute. Whitelist
   *  each to its valid CSS shape before interpolating. */
  const _pSafeColor = (v, fb) => (typeof v === 'string' && /^(?:#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\)|transparent)$/.test(v.trim())) ? v.trim() : fb;
  const _pSafeFs    = (v, fb) => (typeof v === 'string' && /^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/.test(v.trim())) ? v.trim() : fb;
  const _pSafeAlign = (v) => (v === 'center' || v === 'right' || v === 'left' || v === 'justify') ? v : 'left';
  // Border-collapse for print — mirrors editor.js _cvBorderCollapse so
  // the printed PDF matches the canvas: a bordered block flush against
  // a neighbour drops its top/left border, leaving a single shared
  // hairline instead of two stacked into 1px. `siblings` is the block
  // list it can touch (same page body, or the header/footer set).
  const _pBorderCollapse = (block, siblings) => {
    const TOL = 1.5;
    const bx = +block.x||0, by = +block.y||0, bw = +block.w||0, bh = +block.h||0;
    let supTop = false, supLeft = false;
    for(let i = 0; i < siblings.length; i++){
      const o = siblings[i];
      if(!o || o.id === block.id || o.showBorder === false) continue;
      const ox = +o.x||0, oy = +o.y||0, ow = +o.w||0, oh = +o.h||0;
      const vOv = Math.min(by+bh, oy+oh) - Math.max(by, oy);
      const hOv = Math.min(bx+bw, ox+ow) - Math.max(bx, ox);
      if(!supLeft && vOv > 2 && Math.abs((ox+ow) - bx) <= TOL) supLeft = true;
      if(!supTop  && hOv > 2 && Math.abs((oy+oh) - by) <= TOL) supTop  = true;
      if(supTop && supLeft) break;
    }
    return { top: supTop, left: supLeft };
  };
  const renderBlock = (block, siblings) => {
    if(!cvEvalShowWhen(block, report)) return '';
    let borderCss = '';
    if(block.showBorder){
      // Real CSS border (box-shadow is dropped by print engines). The
      // collapse drops top/left where a neighbour is flush, so touching
      // cards print a single hairline, matching the editor.
      const w = `0.5px solid ${_pSafeColor(block.borderColor,'#ccc')}`;
      const col = _pBorderCollapse(block, siblings || []);
      borderCss = `border-top:${col.top?'none':w};border-right:${w};border-bottom:${w};border-left:${col.left?'none':w}`;
    }
    const styles = [
      `position:absolute`,
      `left:${+block.x||0}px`, `top:${+block.y||0}px`,
      `width:${+block.w||0}px`, `height:${+block.h||0}px`,
      block.bgColor ? `background:${_pSafeColor(block.bgColor,'transparent')}` : '',
      borderCss,
      `font-size:${_pSafeFs(block.fontSize,'8.5px')}`,
      (typeof CV_FONTS !== 'undefined' && CV_FONTS[block.fontFamily]) ? `font-family:${CV_FONTS[block.fontFamily]}` : '',
      `font-weight:${block.bold?'bold':'normal'}`,
      `font-style:${block.italic?'italic':'normal'}`,
      (block.underline || block.strike) ? `text-decoration:${[block.underline?'underline':'',block.strike?'line-through':''].filter(Boolean).join(' ')}` : '',
      `color:${_pSafeColor(block.color,'#000')}`,
      `text-align:${_pSafeAlign(block.align)}`,
      `box-sizing:border-box`,
      `overflow:hidden`,
      `z-index:${Number.isFinite(+block.zIndex) ? +block.zIndex : 1}`,
    ].filter(Boolean).join(';');
    try {
      return `<div style="${styles}">${cvRenderBlockContent(block, report, true)}</div>`;
    } catch(e) {
      console.warn('Render error for block', block.id, e);
      // AUDIT-FIX #11: surface render failures visibly. Previously returned
      // an empty string, which silently dropped the failed block from the
      // printed PDF — the inspector would have no idea their template had
      // a problem. A tiny inline warning preserves the block's geometry
      // (so the rest of the layout isn't disturbed) and gives the user
      // enough information to find and fix the underlying issue.
      const errStyles = styles + ';background:rgba(220,38,38,.08);border:1px dashed rgba(220,38,38,.4);color:#991b1b;font-size:9px;display:flex;align-items:center;justify-content:center;text-align:center;padding:4px';
      return `<div style="${errStyles}">⚠ Render error<br><span style="font-size:7px;font-family:monospace;opacity:.7">${escapeHtml(block.id || '?')}</span></div>`;
    }
  };

  // Pre-render the header/footer fragments once — they're identical on every page.
  // Print rule: blocks tagged with zone='header' / 'footer' always print if
  // they exist. The cvTplCfg.{header,footer}.enabled flag still controls
  // whether the *chrome layer* (background fill, accent strip, divider)
  // renders, but content blocks render regardless. Otherwise an unticked
  // Header / Footer checkbox silently drops the address composite, the
  // standard footer text, the confidentiality statement, etc. — content
  // the user has plainly placed and expects on the printed page.
  const hdrEnabled  = cvTplCfg.header && cvTplCfg.header.enabled;
  const ftrEnabled  = cvTplCfg.footer && cvTplCfg.footer.enabled;
  const hdrHasContent = headerBlocks.length > 0;
  const ftrHasContent = footerBlocks.length > 0;
  // Header / footer blocks sorted once; the fragments are re-rendered
  // per page inside the loop below so the page-num field resolves to the
  // correct page on every sheet.
  if(hdrEnabled || hdrHasContent) headerBlocks.sort((a,b)=>(a.zIndex||0)-(b.zIndex||0));
  if(ftrEnabled || ftrHasContent) footerBlocks.sort((a,b)=>(a.zIndex||0)-(b.zIndex||0));
  const _hdrShow = hdrEnabled || hdrHasContent;
  const _ftrShow = ftrEnabled || ftrHasContent;

  // Chrome layer for each zone — background fill, accent strip, single-edge
  // divider border. Sits behind the zone blocks at z-index 0 so user content
  // overlays it. _cvResolveZoneChrome lives in editor.js and is the same
  // resolver design-mode bands use, so print matches the on-screen design.
  const renderChrome = (zone) => {
    const cfg = cvTplCfg[zone];
    if(!cfg || !cfg.enabled) return '';
    const chrome = (typeof _cvResolveZoneChrome === 'function') ? _cvResolveZoneChrome(zone) : null;
    if(!chrome) return '';
    const h = +cfg.heightPx || (zone === 'header' ? 100 : 60);
    const sidePos = zone === 'header' ? 'top:0' : 'bottom:0';
    let css = `position:absolute;left:0;right:0;${sidePos};height:${h}px;z-index:0;pointer-events:none;`;
    if(chrome.bg && chrome.bg !== 'transparent')
      css += 'background:' + _pSafeColor(chrome.bg,'transparent') + ';';
    if(chrome.borderWidthPx){
      const edge = chrome.borderEdge === 'top' ? 'border-top' : 'border-bottom';
      css += edge + ':' + chrome.borderWidthPx + 'px solid ' + _pSafeColor(chrome.borderColor,'rgba(0,0,0,.18)') + ';';
    }
    let inner = '';
    if(chrome.accentPos !== 'none' && chrome.accentThickness > 0){
      const accentSide = chrome.accentPos === 'top' ? 'top:0' : 'bottom:0';
      inner = `<div style="position:absolute;left:0;right:0;${accentSide};height:${chrome.accentThickness}px;background:${_pSafeColor(chrome.accentColor,'#404040')}"></div>`;
    }
    return `<div class="vx-print-zone-chrome" data-zone="${zone}" style="${css}">${inner}</div>`;
  };
  const hdrChromeFragment = renderChrome('header');
  const ftrChromeFragment = renderChrome('footer');

  // ── Table pagination ────────────────────────────────────────────────
  // Page 1's examination-details table fills to capacity; overflow rows
  // flow onto copies of the continuation page — a later template page
  // that also carries an items-table block. No overflow → the
  // continuation page is not printed at all. (≈40px allows for the
  // items-table's title strip + column-header row above the 36px rows.)
  const _itemsCap = b => Math.max(1, Math.floor((((typeof b.h === 'number' && b.h > 0) ? b.h : 90) - 40) / 36));
  const _mainTbl = (cvPages[0] && cvPages[0].blocks) ? cvPages[0].blocks.find(b => b.key === 'items-table') : null;
  let _contIdx = -1;
  for(let i = 1; i < cvPages.length; i++){
    if((cvPages[i].blocks || []).some(b => b.key === 'items-table')){ _contIdx = i; break; }
  }
  const _contTbl  = (_contIdx >= 0) ? cvPages[_contIdx].blocks.find(b => b.key === 'items-table') : null;
  const _nItems   = (report && Array.isArray(report.items)) ? report.items.length : 0;
  const _cap0     = _mainTbl ? _itemsCap(_mainTbl) : 0;
  const _capC     = _contTbl ? _itemsCap(_contTbl) : 0;
  const _overflow = !!(_mainTbl && _contTbl && _capC > 0 && _nItems > _cap0);

  // Sheet plan — one entry per printed sheet: { page, slice }.
  const _plan = [];
  if(_overflow){
    _plan.push({ page: cvPages[0], slice: { start: 0, count: _cap0 } });
    let _placed = _cap0;
    while(_placed < _nItems && _plan.length < 200){
      _plan.push({ page: cvPages[_contIdx], slice: { start: _placed, count: _capC } });
      _placed += _capC;
    }
    cvPages.forEach((p, i) => { if(i !== 0 && i !== _contIdx) _plan.push({ page: p, slice: null }); });
  } else {
    // No overflow — print every page once, skipping the continuation
    // page (it exists only to receive overflow rows).
    cvPages.forEach((p, i) => { if(i !== _contIdx) _plan.push({ page: p, slice: null }); });
  }
  // Photo page is opt-in per report — skip any page whose only body
  // block is a photo-page when the report has no photos attached.
  const _hasPhotos = !!(report && Array.isArray(report.photos) && report.photos.some(p => !!p));
  const _planFinal = _plan.filter(entry => {
    if(_hasPhotos) return true;
    const _body = (entry.page.blocks || []).filter(b => b.zone !== 'header' && b.zone !== 'footer');
    return !(_body.length === 1 && _body[0].key === 'photo-page');
  });
  _cvPrintTotal = _planFinal.length;

  let pagesHtml = '';
  _planFinal.forEach((entry, sheetIdx) => {
    // 1-based sheet number for the page-num field; the items-table row
    // slice for this sheet (null when the table isn't paginated).
    _cvPrintPageNum = sheetIdx + 1;
    _cvItemsSlice   = entry.slice;
    const page = entry.page;
    // Body blocks only — zone-tagged blocks are in the header/footer
    // fragments. Filter before sort so sort never mutates page.blocks.
    let bodyHtml = '';
    const bodyBlocks = page.blocks
      .filter(b => b.zone !== 'header' && b.zone !== 'footer')
      .sort((a,b) => (a.zIndex||0) - (b.zIndex||0));
    bodyBlocks.forEach(block => { bodyHtml += renderBlock(block, bodyBlocks); });
    const hdrFragment = _hdrShow ? headerBlocks.map(b => renderBlock(b, headerBlocks)).join('') : '';
    const ftrFragment = _ftrShow ? footerBlocks.map(b => renderBlock(b, footerBlocks)).join('') : '';
    pagesHtml += `<div class="vx-print-page" data-page-num="${sheetIdx + 1}">
      <div class="vx-print-inner">
        ${hdrChromeFragment}
        ${ftrChromeFragment}
        ${hdrFragment}
        ${bodyHtml}
        ${ftrFragment}
      </div>
    </div>`;
  });
  _cvItemsSlice   = null;
  _cvPrintPageNum = 0;

  // Filename surfaced to the browser's print-to-PDF dialog via <title>.
  // Format: "<ReportNo> — <TemplateNo>" so the inspector can tell at a glance
  // which method template generated the file. Template number prefers the
  // value baked into the report; falls back to the live per-method config.
  const _reportLabel = (report && (report.reportNo || report.id)) || 'NDT Report';
  let _tplNo = (report && report.templateNo) || '';
  if(!_tplNo){
    try {
      const _td = (typeof ls === 'function' && typeof TPL_KEY === 'string') ? ls(TPL_KEY, {}) : {};
      const _m  = (report && report.method) || cvPpvMethod || '';
      _tplNo = (_td && _td[_m] && _td[_m].templateNo) || '';
    } catch(e){ _tplNo = ''; }
  }
  // Sanitize template number for filesystem-friendliness — browsers also
  // strip / and other path separators from the suggested filename so this
  // is a belt-and-braces clean-up.
  _tplNo = String(_tplNo).replace(/[\\/:*?"<>|]/g, '').trim();
  const title = escapeHtml(_tplNo ? `${_reportLabel} — ${_tplNo}` : _reportLabel);
  return `<!DOCTYPE html>
<html lang="${vxLocale().split('-')[0]}">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { size: A4; margin: 0; }
  html, body { margin:0; padding:0; background:#fff; }
  body { font-family: Arial, Helvetica, sans-serif; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .vx-print-page {
    position: relative;
    width: ${CV_PAGE_WIDTH_PX}px;
    height: ${CV_PAGE_HEIGHT_PX}px;
    background: #fff;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }
  .vx-print-page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  /* Every page's content lives in this inner layer. The print-time scale
     (below) is applied HERE, never on .vx-print-page itself: transforming
     the page-break element makes Chrome emit a trailing blank page and
     shift content vertically in Save-as-PDF — which is what made the PDF
     margins differ from a physical print. The blocks inside are
     position:absolute and this layer is inset:0, so their coordinates and
     the printed result stay identical between print and PDF. */
  .vx-print-inner { position: absolute; inset: 0; }
  @media print {
    .vx-print-page { width: 210mm; height: 297mm; }
    /* The design canvas is full-bleed A4 (794px = 210mm). Physical
       printers cannot print a ~5-6mm band at each edge. A light 3% inward
       scale (centred) pulls real content — text, boxes, borders, which
       carry the design's own ~5mm margin — clear of that dead zone while
       keeping the report essentially full size. Purely decorative
       full-bleed elements may still lose a few mm at the very edge, which
       is unavoidable on a non-borderless printer. */
    .vx-print-inner {
      transform: scale(0.97);
      transform-origin: center center;
    }
  }
  @media screen {
    body { background: #444; padding: 20px; }
    .vx-print-page { box-shadow: 0 4px 20px rgba(0,0,0,.5); margin: 0 auto 20px; }
  }
  /* Disable any interactive cursors */
  div { cursor: default !important; }
</style>
</head>
<body>
${pagesHtml}
</body>
</html>`;
}

/**
 * Print the current template using the configured preview source (real
 * report) or the live sample data if no source selected.
 * @param {object} [opts]
 * @param {boolean} [opts.openInTab=false]  If true, open in a new tab
 *   instead of triggering print. Lets the user inspect, then File→Print
 *   from the tab if they prefer.
 */
function cvPrintOrExport(opts){
  opts = opts || {};
  // Pick a report: configured preview source if any, else live sample.
  let report;
  try {
    if(typeof cvBuildReport === 'function'){
      report = cvBuildReport(cvPpvMethod || 'UT', cvPpvResult || 'Pass', cvPpvShowDefects);
    }
  } catch(e){ console.error('cvBuildReport failed', e); report = null; }

  let html;
  try {
    html = cvBuildPrintHTML(report);
  } catch(e){
    console.error('cvBuildPrintHTML failed', e);
    toast(t('pe.toast.print_failed','Could not prepare the document for printing.'),'error');
    return;
  }

  if(opts.openInTab){
    // Open as a tab — user can save / inspect / re-print
    const win = window.open('', '_blank');
    if(!win){
      toast(t('toast.popup_blocked', 'Pop-up blocked — allow pop-ups to print the manual.'), 'warn');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    return;
  }

  _vxPrintHtml(html);
}

/** Print a standalone HTML document via a hidden iframe + the browser
 *  print dialog. Shared by the editor's Print / PDF (cvPrintOrExport)
 *  and saved-report reprints (ovPrintReport). */
function _vxPrintHtml(html){
  let iframe = document.getElementById('vx-print-iframe');
  if(iframe) iframe.remove();
  iframe = document.createElement('iframe');
  iframe.id = 'vx-print-iframe';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:-9999px;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);

  const idoc = iframe.contentDocument || iframe.contentWindow.document;
  idoc.open();
  idoc.write(html);
  idoc.close();

  toast(t('pe.toast.preparing_pdf','Preparing PDF — print dialog will open shortly.'),'info');

  // Defer print() until layout is settled. Images (inline base64) are
  // already encoded so no network wait; this is just a microtask hop.
  const triggerPrint = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch(e){
      console.error('print() threw', e);
      toast(t('pe.toast.print_failed','Print failed. Try the browser menu instead.'),'error');
    }
    // Give the user time to inspect/cancel/print the dialog. Browsers
    // block the parent thread while the dialog is up, so this timeout
    // only fires after dismissal.
    setTimeout(() => { try { iframe.remove(); } catch(e){} }, 1000);
  };

  // Wait one frame past document load to ensure CSS @page rules apply
  if(idoc.readyState === 'complete'){
    requestAnimationFrame(() => requestAnimationFrame(triggerPrint));
  } else {
    iframe.addEventListener('load', () => {
      requestAnimationFrame(() => requestAnimationFrame(triggerPrint));
    });
  }
}

// ── Saved-report snapshot & reprint (Stage 2) ─────────────────────────
// A report is frozen on save: cvBuildPrintHTML is rendered through the
// method's saved template and the resulting self-contained HTML document
// is stored on the record (report.frozenHtml). Reprinting replays that
// HTML, so a saved report is identical forever regardless of any later
// template / procedure / certificate / equipment change.

/** Build the frozen print HTML for a report — rendered through its
 *  method's saved template, without disturbing the editor's live canvas.
 *  Returns '' when the method has no saved template. */
function ovBuildReportSnapshot(report){
  if(typeof cvBuildPrintHTML !== 'function' || !report) return '';
  const method = report.method || '';
  let tpl = null;
  try { tpl = (typeof ls === 'function') ? ls(CV_METHOD_TPL_PREFIX + method, null) : null; } catch(e){}
  if(!tpl || !Array.isArray(tpl.pages) || !tpl.pages.length) return '';
  // Swap the method template onto the editor globals cvBuildPrintHTML
  // reads, build, then restore — so a report save never disturbs whatever
  // the user has open on the editor canvas.
  const _pages = cvPages, _page = cvCurrentPage, _ppv = cvPpvMethod;
  let html = '';
  try {
    cvPages = tpl.pages;
    cvCurrentPage = 0;
    cvPpvMethod = method;
    if(typeof cvSync === 'function') cvSync();
    html = cvBuildPrintHTML(report);
  } catch(e){
    console.warn('ovBuildReportSnapshot failed', e);
    html = '';
  } finally {
    cvPages = _pages;
    cvCurrentPage = _page;
    cvPpvMethod = _ppv;
    if(typeof cvSync === 'function') cvSync();
  }
  return html;
}

/** Reprint a saved report from its frozen snapshot. Falls back to a live
 *  rebuild for reports saved before snapshots existed. */
function ovPrintReport(idx){
  const reports = (typeof ls === 'function') ? ls(KEYS.reports, []) : [];
  const r = reports[idx];
  if(!r){ toast(t('toast.report_not_found','Report not found.'),'error'); return; }
  let html = r.frozenHtml;
  if(!html) html = ovBuildReportSnapshot(r);
  if(!html){
    toast(t('toast.report_no_snapshot','No printable layout for this report — its method has no saved template.'),'error');
    return;
  }
  _vxPrintHtml(html);
}

/** Open the rendered template in a new tab for inspection / manual printing. */
function cvOpenInTab(){ cvPrintOrExport({ openInTab:true }); }

// ── Default layout ───────────────────────────────────────────────────
async function cvLoadDefaultLayout(){
  if(cvBlocks.length && !(await vxConfirm({ message: 'Are you sure you want to replace the current page with the default NDT layout? Any custom blocks on this page will be removed.', okLabel: t('vxc.replace','Replace'), danger: true }))) return;
  cvAutoSnapshot('Before default layout');
  cvPushUndo();
  cvPages[cvCurrentPage].blocks=[]; cvSync(); cvNextId=1; cvSelectedId=null; cvSelectedIds=[];
  const cc=cvTplCfg.sectionColor||cvGetCompanyColor();
  const add=(key,isLayout,x,y,w,h,extra={})=>{
    const def=isLayout?CV_LAYOUT_ITEMS.find(i=>i.key===key):CV_FIELD_DEFS[key];
    const block={
      id:_cvBlockId(), key, isLayout,
      x,y, w:w||(def?.w)||160, h:h||(def?.h)||38,
      text:extra.text||(isLayout?(def?.label||key):(def?.label||key)),
      fontSize:extra.fontSize||'8.5px', bold:extra.bold||false, italic:false,
      color:extra.color||'#000', bgColor:extra.bgColor||'transparent',
      borderColor:'#cccccc', showBorder:extra.showBorder!==false,
      align:extra.align||'left', zIndex:cvBlocks.length+1, locked:false,
    };
    cvBlocks.push(block);
  };
  const M=20, W=754;
  const col4=Math.floor((W-3)/4), col3=Math.floor((W-2)/3), col2=Math.floor((W-1)/2);
  let y=M;

  add('accent-bar',true,M,y,W,5,{bgColor:cc,showBorder:false}); y+=5;
  add('logo-co',true,M,y,130,52,{showBorder:false});
  add('report-no',false,M+134,y,330,26); add('revision',false,M+468,y,90,26); add('method',false,M+562,y,112,26);
  y+=28;
  add('exam-date',false,M+134,y,190,24); add('today-date',false,M+328,y,190,24);
  y+=30;
  add('section-header',true,M,y,W,22,{text:'Client information',bgColor:cc,color:'#fff',bold:true,showBorder:false,fontSize:'8.5px'}); y+=22;
  add('client',false,M,y,col4,36); add('project',false,M+col4+1,y,col4,36); add('sv-order',false,M+col4*2+2,y,col4-5,36); add('order-no',false,M+col4*3-1,y,col4+8,36);
  y+=36;
  add('location',false,M,y,col4,36); add('req-no',false,M+col4+1,y,col4,36); add('ref-client',false,M+col4*2+2,y,col4-5,36);
  y+=36;
  add('section-header',true,M,y,W,22,{text:'Subject information',bgColor:cc,color:'#fff',bold:true,showBorder:false,fontSize:'8.5px'}); y+=22;
  add('subject',false,M,y,col3*2-5,36); add('drawing-no',false,M+col3*2-4,y,col3-3,36); add('subject-no',false,M+col3*3-5,y,col3+12,36);
  y+=36;
  add('welders',false,M,y,col4,36); add('material',false,M+col4+1,y,col4,36); add('weld-prep',false,M+col4*2+2,y,col4-5,36); add('heat-treat',false,M+col4*3-1,y,col4+8,36);
  y+=36;
  add('thickness',false,M,y,col4,36); add('surf-cond',false,M+col4+1,y,col4,36); add('temperature',false,M+col4*2+2,y,col4-5,36); add('weld-pos',false,M+col4*3-1,y,col4+8,36);
  y+=36;
  add('part-exam',false,M,y,W,36); y+=36;
  add('section-header',true,M,y,W,22,{text:'Examination criteria',bgColor:cc,color:'#fff',bold:true,showBorder:false,fontSize:'8.5px'}); y+=22;
  add('exam-type',false,M,y,col4+20,36); add('extent',false,M+col4+21,y,col4-10,36); add('spec',false,M+col4*2+12,y,col4+5,36); add('acc-crit',false,M+col4*3+18,y,col4-15,36);
  y+=36;
  add('procedure',false,M,y,col2,36); add('proc-rev',false,M+col2+1,y,90,36); add('stage',false,M+col2+95,y,col2-90,36);
  y+=36;
  add('section-header',true,M,y,W,22,{text:'Equipment',bgColor:cc,color:'#fff',bold:true,showBorder:false,fontSize:'8.5px'}); y+=22;
  add('equipment',false,M,y,col3*2-5,36); add('sv-id',false,M+col3*2-4,y,col3-3,36); add('cal-date',false,M+col3*3-5,y,col3+12,36);
  y+=36;
  add('method-block',true,M,y,W,88,{showBorder:false}); y+=88;
  add('section-header',true,M,y,W,22,{text:'Result / Verdict',bgColor:cc,color:'#fff',bold:true,showBorder:false,fontSize:'8.5px'}); y+=22;
  add('remarks',false,M,y,W,56); y+=56;
  add('result',false,M,y,col2-5,46); add('indications',false,M+col2-4,y,col2+11,46);
  y+=46;
  // page-footer block removed — the Header/Footer zone designer + auto-setup
  // covers everything this block did, and dual sources of footer truth
  // confuse users. The footer for a default layout comes from the zone.

  cvSaveLayout(); cvRenderPageTabs(); cvRenderCanvas(); cvFitToView();
  toast(t('toast.layout_loaded','Default NDT layout loaded — customise freely.'));
}

// Load tpl config on boot
cvLoadTplConfig();

// ── Service Worker Registration ──────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('SW registered:', reg.scope))
      .catch(() => {});
  });
}

