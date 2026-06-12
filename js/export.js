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
      let inner = cvRenderBlockContent(block, report, true);
      // Smart-card hyperlink — when an annex page will be appended for
      // this card's linked cert file, wrap the inner content in an
      // anchor that targets the annex row. Print-to-PDF preserves
      // intra-document `#id` links in every major browser, so the
      // smart card becomes a clickable jump to the cert image.
      const anchorId = _cvSmartCardAnnexAnchor(block, report);
      if(anchorId){
        inner = `<a href="#${anchorId}" style="display:block;height:100%;color:inherit;text-decoration:none">${inner}</a>`;
      }
      return `<div style="${styles}">${inner}</div>`;
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
  // Photo page / drawing page / standalone defect-table pages are
  // opt-in per report — skip a page when its substantive content is
  // empty so the inspector doesn't get a stray "Photos" / "Drawings" /
  // "Defects" sheet with nothing on it. The check looks past decorative
  // companions (section headers, accent bars, page numbers, etc.) and
  // past blocks that the block-level visibility filter will drop at
  // render time (orphan single-photo / single-drawing / photo-details),
  // so e.g. a "Photos" page with a section-header strip and 3 single-
  // photo slots still skips when no images were uploaded.
  const _hasPhotos   = !!(report && Array.isArray(report.photos)   && report.photos.some(p => !!p));
  const _hasDrawings = !!(report && Array.isArray(report.drawings) && report.drawings.some(p => !!p));
  // Defects on the report come from two places now: items marked
  // verdict='Not acceptable' on the items table, AND standalone log
  // entries (KEYS.defects) cross-referenced to this report by number.
  // Either source should keep the defect-table sheet from being
  // skipped at print time.
  const _itemDefects = !!(report && Array.isArray(report.items) && report.items.some(it => it && it.verdict === 'Not acceptable'));
  let _logDefects = false;
  try {
    if(report && report.reportNo && typeof ls === 'function' && typeof KEYS !== 'undefined'){
      const _logAll = ls(KEYS.defects, []) || [];
      const _matchRep = String(report.reportNo).trim().toLowerCase();
      _logDefects = _logAll.some(d => {
        if(!d || !d.report) return false;
        const dr = String(d.report).replace(/\s+Rev\s+.*$/i, '').trim().toLowerCase();
        return dr === _matchRep;
      });
    }
  } catch(e){}
  const _hasDefects = _itemDefects || _logDefects;
  // Decorative keys — blocks that decorate / identify a page but don't
  // justify keeping the page when the actual content is empty. Includes:
  //  - section-header / h-line / accent-bar / text-block — layout chrome
  //  - today-date / page-num / date-blank — date / page-number stamps
  //  - co-* / logo-co — company-info / logo strips repeated per page
  //  - qr-code / revision / report-no / method / exam-date / tpl-number /
  //    proc-rev — page-identifier fields the inspector typically places
  //    on every page as a header strip so each printed sheet traces back
  //    to the report. They're identification, not content, so a page
  //    that carries only these + an empty primary block (photo-page /
  //    drawing-page / defect-table) is skipped.
  const _DECORATIVE_KEYS = new Set([
    'section-header','h-line','accent-bar','text-block','today-date',
    'page-num','date-blank','logo-co','co-block','co-name-smart',
    'co-address-smart','co-phone-smart','co-email-smart','co-website-smart',
    'co-vat-smart','co-logo-smart','co-footer-smart','co-confidstmt-smart',
    'qr-code','revision','report-no','method','exam-date','tpl-number','proc-rev',
  ]);
  const _hasSingle = (id) => !!(report && report.singlePhotos && id && report.singlePhotos[id]);
  const _isBlockEmpty = (b) => {
    if(b.key === 'photo-page')     return !_hasPhotos;
    if(b.key === 'drawing-page')   return !_hasDrawings;
    if(b.key === 'defect-table')   return !_hasDefects;
    if(b.key === 'single-photo')   return !_hasSingle(b.id);
    if(b.key === 'single-drawing') return !_hasSingle(b.id);
    // CAD drawing: empty when the report carries no drawing (or an element-less
    // one) for this block id — so an unfilled cad-drawing block skips its page.
    if(b.key === 'cad-drawing')    return !(report && report.cadDrawings && report.cadDrawings[b.id] && typeof cadIsEmpty === 'function' && !cadIsEmpty(report.cadDrawings[b.id]));
    if(b.key === 'photo-details' && b.linkedPhotoId) return !_hasSingle(b.linkedPhotoId);
    // items-table on a non-page-1 page is only meaningful when item
    // overflow demands a continuation page — without overflow it just
    // paints an empty header band, so treat it as empty and let the
    // page skip if that's all the page carries.
    if(b.key === 'items-table') return !_overflow;
    // Hardness-survey block: the survey page is meaningful only when the report
    // actually carries recorded readings (an HT report with the seeded survey
    // page but no readings shouldn't print an empty "No survey" sheet).
    if(b.key === 'ht-survey' || b.key === 'ht-method') return !(report && report.hardnessSurvey && typeof htVerdict === 'function' && htVerdict(report.hardnessSurvey).total > 0);
    // Material-verification (PMI) page: meaningful only when the report carries a
    // graded survey — an opted-in but unfilled PMI page shouldn't print.
    if(b.key === 'pmi-survey' || b.key === 'pmi-method') return !(report && report.pmiSurvey && typeof pmiIsEmpty === 'function' && !pmiIsEmpty(report.pmiSurvey));
    return false; // any other primary block is treated as content-bearing
  };
  // First page in the plan is always the main report — never skip it
  // even if the inspector somehow stripped it of primary blocks.
  const _planFinal = _plan.filter((entry, idx) => {
    if(idx === 0) return true;
    const _body = (entry.page.blocks || []).filter(b => b.zone !== 'header' && b.zone !== 'footer');
    const _primary = _body.filter(b => !_DECORATIVE_KEYS.has(b.key));
    if(_primary.length === 0) return false;             // only decorative — skip
    if(_primary.every(_isBlockEmpty)) return false;     // every primary block has no content — skip
    return true;
  });
  // Hardness-survey readings auto-pagination: the chart sits on the survey
  // block's first sheet; overflow readings flow onto synthesised copies of that
  // sheet (table only). Capacity estimated from the block height (chart +
  // header reserved on sheet 1; full height for the table on continuations).
  const _htSurvey = report && report.hardnessSurvey;
  const _htSite   = !!(_htSurvey && _htSurvey.mode === 'site-piping');
  const _htRows   = (typeof htRowsOf === 'function') ? htRowsOf(_htSurvey) : 0;
  const _htWelds  = (typeof htWeldCount === 'function') ? htWeldCount(_htSurvey) : 0;
  const _planHt = [];
  _planFinal.forEach(entry => {
    const _hb = (entry.page.blocks || []).find(b => b.key === 'ht-survey');
    if(!_hb || !_htSurvey){ _planHt.push(entry); return; }
    const _bh = (typeof _hb.h === 'number' && _hb.h > 0) ? _hb.h : 740;
    if(_htSite){
      // site: paginate by WELD block (each ≈ details + compact chart + clock table)
      if(_htWelds <= 1){ _planHt.push(Object.assign({}, entry, { htSlice: { start:0, count:Math.max(1,_htWelds) } })); return; }
      const _unitH = 300;
      const _cap0 = Math.max(1, Math.floor((_bh - 30) / _unitH));
      if(_htWelds <= _cap0){ _planHt.push(Object.assign({}, entry, { htSlice: { start:0, count:_htWelds } })); return; }
      _planHt.push(Object.assign({}, entry, { htSlice: { start:0, count:_cap0 } }));
      let _wp = _cap0;
      while(_wp < _htWelds && _planHt.length < 300){ const _wc = Math.min(_cap0, _htWelds - _wp); _planHt.push(Object.assign({}, entry, { htSlice: { start:_wp, count:_wc } })); _wp += _wc; }
      return;
    }
    // weld-traverse: paginate the readings table by ROWS (single weld)
    if(_htRows === 0){ _planHt.push(entry); return; }
    const _rowH = 26, _reserve = 390;
    const _cap0 = Math.max(1, Math.floor((_bh - _reserve) / _rowH));
    if(_htRows <= _cap0){ _planHt.push(Object.assign({}, entry, { htSlice: { start:0, count:_htRows } })); return; }
    const _capC = Math.max(1, Math.floor((_bh - 30) / _rowH));
    _planHt.push(Object.assign({}, entry, { htSlice: { start:0, count:_cap0 } }));
    let _hp = _cap0;
    while(_hp < _htRows && _planHt.length < 300){ const _hc = Math.min(_capC, _htRows - _hp); _planHt.push(Object.assign({}, entry, { htSlice: { start:_hp, count:_hc } })); _hp += _hc; }
  });
  // Material-verification (PMI) auto-pagination: per-component results (details
  // header + composition chart + readings table) flow onto synthesised copies of
  // the survey sheet (mirrors the HT site-piping pass). A report is one method,
  // so only one of the two passes ever expands; the other is a pass-through.
  const _pmiSrv   = report && report.pmiSurvey;
  const _pmiComps = (typeof pmiComponentCount === 'function') ? pmiComponentCount(_pmiSrv) : 0;
  // Per-component height scales with its measurement points (single ≈ 1 block,
  // 3-point ≈ 3 blocks of sub-header + chart + table) — estimate from the tallest
  // component so whole components stay together on a sheet.
  const _pmiMaxPts = (function(){ let m = 1; ((_pmiSrv && _pmiSrv.components) || []).forEach(c => { const n = (c && c.points && c.points.length) || 1; if(n > m) m = n; }); return m; })();
  const _planPmi  = [];
  _planHt.forEach(entry => {
    const _pb = (entry.page.blocks || []).find(b => b.key === 'pmi-survey');
    if(!_pb || !_pmiSrv){ _planPmi.push(entry); return; }
    const _bh = (typeof _pb.h === 'number' && _pb.h > 0) ? _pb.h : 760;
    if(_pmiComps <= 1){ _planPmi.push(Object.assign({}, entry, { pmiSlice: { start:0, count:Math.max(1,_pmiComps) } })); return; }
    const _unitH = 60 + _pmiMaxPts * 240;
    const _cap0 = Math.max(1, Math.floor((_bh - 30) / _unitH));
    if(_pmiComps <= _cap0){ _planPmi.push(Object.assign({}, entry, { pmiSlice: { start:0, count:_pmiComps } })); return; }
    _planPmi.push(Object.assign({}, entry, { pmiSlice: { start:0, count:_cap0 } }));
    let _cp = _cap0;
    while(_cp < _pmiComps && _planPmi.length < 300){ const _cc = Math.min(_cap0, _pmiComps - _cp); _planPmi.push(Object.assign({}, entry, { pmiSlice: { start:_cp, count:_cc } })); _cp += _cc; }
  });
  _cvPrintTotal = _planPmi.length;

  let pagesHtml = '';
  _planPmi.forEach((entry, sheetIdx) => {
    // 1-based sheet number for the page-num field; the items-table row
    // slice for this sheet (null when the table isn't paginated).
    _cvPrintPageNum = sheetIdx + 1;
    _cvItemsSlice   = entry.slice;
    _cvHtSlice      = entry.htSlice || null;
    _cvPmiSlice     = entry.pmiSlice || null;
    const page = entry.page;
    // Body blocks only — zone-tagged blocks are in the header/footer
    // fragments. Filter before sort so sort never mutates page.blocks.
    let bodyHtml = '';
    // Build the list of body blocks for this sheet. Two stages of
    // filtering: drop zone-tagged blocks (they're in the header/footer
    // fragments), then drop image/details blocks whose content wasn't
    // attached on this report so the printed page doesn't carry empty
    // photo frames or orphaned details cards. The check resolves the
    // image map once per sheet to keep the filter cheap; positions are
    // preserved (no reflow), so a filled pair always prints in its
    // original spot.
    const _hasSingle = (id) => !!(report && report.singlePhotos && id && report.singlePhotos[id]);
    const bodyBlocks = page.blocks
      .filter(b => b.zone !== 'header' && b.zone !== 'footer')
      .filter(b => {
        // single-photo / single-drawing: hide when no image was uploaded
        // for this slot. Without this an unfilled slot would print the
        // dashed placeholder on the report PDF, which we don't want.
        if(b.key === 'single-photo' || b.key === 'single-drawing'){
          return _hasSingle(b.id);
        }
        // photo-details: hide when linked to a single-photo that has
        // no image attached, so each visible details card always sits
        // beneath a real photo. Unlinked details cards (linkedPhotoId
        // unset) always print — they're standalone notes by intent.
        if(b.key === 'photo-details' && b.linkedPhotoId){
          return _hasSingle(b.linkedPhotoId);
        }
        return true;
      })
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
  _cvHtSlice      = null;
  _cvPmiSlice     = null;
  _cvPrintPageNum = 0;

  // Cert annex — appended after the report's last page when any linked
  // cert file has been uploaded. The smart cards on the main report
  // hyperlink to rows on this page. Build now (after pagesHtml is
  // settled) so the annex sees the same `report` and so the anchor
  // helper (used inside renderBlock above) and the annex page agree
  // on the same id namespace.
  const annexHtml = _cvBuildCertAnnexHtml(report);
  if(annexHtml) pagesHtml += annexHtml;

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

// ── Certificate annex ─────────────────────────────────────────────────
// Generic mechanism: enumerate every annex-eligible cert linked to the
// report, render an annex page at the back of the PDF, and provide
// hyperlink anchors that the matching smart cards on the main report
// can target. Designed for extension — adding inspector method-cert
// uploads or equipment cal-cert uploads in future is a one-liner in
// _cvAnnexEntries.

/** All certs that should appear on the annex page, in order. Each
 *  entry: { id, anchor, title, subtitle, certNo, expiry, fileData,
 *  fileName, fileType }. Returns [] when no annexable file is linked
 *  on the report. */
function _cvAnnexEntries(report){
  const out = [];
  // Eye-sight test cert (frozen on the report at save time by
  // ovSaveReport; falls back to the live inspector record so the
  // annex still appears in design-mode preview).
  let et = report && report.inspectorEyeTest;
  if(!et){
    try {
      const list = (typeof INSPECTORS !== 'undefined' && Array.isArray(INSPECTORS)) ? INSPECTORS : (typeof ls==='function' ? ls('vx-inspectors-v1',[]) : []);
      const match = list.find(i => i.name === (report && report.inspector));
      et = match && match.eyeTest;
    } catch(e){ et = null; }
  }
  if(et && et.fileData){
    out.push({
      id: 'eye',
      anchor: 'vx-cert-annex-eye',
      title: 'Eye-sight test certificate',
      subtitle: 'EN-ISO 17637:2016 §6 · annual near-vision + colour',
      inspector: (report && report.inspector) || '',
      authority: et.authority || '',
      certNo:    et.certNo    || '',
      testDate:  et.testDate  || '',
      expiry:    et.expiry    || '',
      fileData:  et.fileData,
      fileName:  et.fileName || '',
      fileType:  et.fileType || '',
    });
  }
  return out;
}

/** Hyperlink target id for a smart-card block whose linked cert is in
 *  the annex. Returns '' when there is no annex entry for this block
 *  (so renderBlock skips the anchor wrap). */
function _cvSmartCardAnnexAnchor(block, report){
  if(!block || !report) return '';
  const entries = _cvAnnexEntries(report);
  if(!entries.length) return '';
  if(block.key === 'eye-cert-status'){
    const e = entries.find(x => x.id === 'eye');
    return e ? e.anchor : '';
  }
  return '';
}

/** Build the annex page HTML (one <div class="vx-print-page">). Returns
 *  '' when no annexable cert exists. */
function _cvBuildCertAnnexHtml(report){
  const entries = _cvAnnexEntries(report);
  if(!entries.length) return '';
  const pageW = (typeof CV_PAGE_WIDTH_PX  !== 'undefined') ? CV_PAGE_WIDTH_PX  : 794;
  const pageH = (typeof CV_PAGE_HEIGHT_PX !== 'undefined') ? CV_PAGE_HEIGHT_PX : 1123;
  // Compose the cert cards. Image files get a true thumbnail (object-
  // contained inside a fixed frame); PDFs get a styled file-badge with
  // the filename and metadata — embedding PDF inside print HTML doesn't
  // survive Save-as-PDF reliably, so the badge is the auditable
  // surface and the original file remains on the inspector record.
  const cardsHtml = entries.map((e, idx) => {
    const isImg = e.fileType && e.fileType.startsWith('image/');
    const isPdf = e.fileType === 'application/pdf';
    const thumb = isImg
      ? `<img src="${e.fileData}" alt="Certificate ${idx+1}" style="max-width:100%;max-height:100%;object-fit:contain"/>`
      : isPdf
        ? `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#666;font-size:11px">
            <div style="font-size:48px">📕</div>
            <div style="font-family:monospace;font-size:10px;text-align:center;padding:0 8px;word-break:break-all">${escapeHtml(e.fileName||'certificate.pdf')}</div>
            <div style="font-size:9px;font-style:italic;color:#999">PDF attached — full file in Settings → Inspectors</div>
          </div>`
        : `<div style="display:flex;align-items:center;justify-content:center;color:#999;font-size:11px;font-style:italic">No preview available</div>`;
    const fmtD = v => (v && typeof fmtDate === 'function') ? fmtDate(v) : (v || '—');
    const ordinal = 'A' + (idx + 1);
    return `<div id="${escapeHtml(e.anchor)}" style="display:grid;grid-template-columns:240px 1fr;gap:18px;padding:16px;border:1px solid #d4d4d8;border-radius:6px;margin-bottom:18px;background:#fff;page-break-inside:avoid;break-inside:avoid">
      <div style="width:100%;height:300px;background:#fafafa;border:1px solid #e4e4e7;border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden">
        ${thumb}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;font-size:11px;color:#222">
        <div style="font-size:10px;font-weight:700;letter-spacing:.5px;color:#666;text-transform:uppercase">Annex ${ordinal}</div>
        <div style="font-size:14px;font-weight:700;color:#111">${escapeHtml(e.title)}</div>
        <div style="font-size:11px;color:#666">${escapeHtml(e.subtitle)}</div>
        <div style="height:1px;background:#e4e4e7;margin:4px 0"></div>
        ${e.inspector ? `<div><span style="display:inline-block;width:90px;color:#666">Inspector</span><strong>${escapeHtml(e.inspector)}</strong></div>` : ''}
        ${e.certNo    ? `<div><span style="display:inline-block;width:90px;color:#666">Cert no.</span><span style="font-family:monospace">${escapeHtml(e.certNo)}</span></div>` : ''}
        ${e.authority ? `<div><span style="display:inline-block;width:90px;color:#666">Authority</span>${escapeHtml(e.authority)}</div>` : ''}
        ${e.testDate  ? `<div><span style="display:inline-block;width:90px;color:#666">Test date</span>${escapeHtml(fmtD(e.testDate))}</div>` : ''}
        ${e.expiry    ? `<div><span style="display:inline-block;width:90px;color:#666">Expires</span><strong>${escapeHtml(fmtD(e.expiry))}</strong></div>` : ''}
        ${e.fileName  ? `<div><span style="display:inline-block;width:90px;color:#666">File</span><span style="font-family:monospace;font-size:10px">${escapeHtml(e.fileName)}</span></div>` : ''}
      </div>
    </div>`;
  }).join('');
  return `<div class="vx-print-page" data-annex="1">
    <div class="vx-print-inner" style="padding:40px 48px">
      <div style="border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:24px">
        <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:#666;text-transform:uppercase">Annex A</div>
        <div style="font-size:22px;font-weight:700;color:#111;margin-top:2px">Certificates</div>
        <div style="font-size:11px;color:#666;margin-top:4px">Linked certificates supporting this report. Each entry corresponds to a smart card on the main report; click any smart card to jump to its annex row.</div>
      </div>
      ${cardsHtml}
    </div>
  </div>`;
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

// ── Job report pack (consolidated client deliverable) ─────────────────
// Combine a job's sealed reports into ONE print/PDF: a branded cover page
// (company header, job + customer, pass/fail tally, summary table) then each
// report's sealed pages. Each report's sealedHtml is a standalone A4 document;
// we reuse the exact shared page scaffolding and concatenate the <body> of
// each (per-block styling is inline, so it travels with the body content).
function vxBuildReportPackHtml(job, cust, reports){
  const esc = (s) => escapeHtml(String(s == null ? '' : s));
  const c = (typeof ls === 'function') ? (ls(KEYS.company, {}) || {}) : {};
  const accent = (c.color && /^#[0-9A-Fa-f]{6}$/.test(c.color)) ? c.color : '#185FA5';
  const W = (typeof CV_PAGE_WIDTH_PX !== 'undefined') ? CV_PAGE_WIDTH_PX : 794;
  const H = (typeof CV_PAGE_HEIGHT_PX !== 'undefined') ? CV_PAGE_HEIGHT_PX : 1123;
  const fdate = (d) => (typeof fmtDate === 'function') ? fmtDate(d) : String(d || '');

  // Pass/fail tally.
  let nAcc = 0, nRej = 0, nOther = 0;
  reports.forEach((r) => {
    if(r.verdict === 'Acceptable') nAcc++;
    else if(r.verdict === 'Not acceptable') nRej++;
    else nOther++;
  });
  const vColor = (v) => v === 'Acceptable' ? '#1a8d4e' : v === 'Not acceptable' ? '#c0392b' : '#6b7589';

  const summaryRows = reports.map((r) => `<tr>
    <td style="font-family:monospace;font-weight:700">${esc(r.method || '—')}</td>
    <td style="font-family:monospace">${esc(r.reportNo || '—')}</td>
    <td style="font-family:monospace;text-align:center">${esc(r.revision || '00')}</td>
    <td>${esc(r.subject || '—')}</td>
    <td style="color:${vColor(r.verdict)};font-weight:600">${esc(r.verdict || '—')}</td>
    <td style="font-family:monospace;white-space:nowrap">${r.createdAt ? esc(fdate(r.createdAt)) : '—'}</td>
  </tr>`).join('');

  const custAddr = [cust && cust.name, cust && cust.billingAddress, cust && cust.vatNo && ('VAT ' + cust.vatNo)].filter(Boolean);
  const cover = `<div class="vx-print-page"><div class="vx-print-inner"><div class="vxpack-cover">
    <div class="vxpack-head">
      <div>${c.logo ? `<img class="vxpack-logo" src="${esc(c.logo)}" alt=""/>` : `<div style="font-size:22px;font-weight:800;color:${accent}">${esc(c.name || 'Your Company')}</div>`}</div>
      <div style="text-align:right">
        <div class="vxpack-title">Inspection Report Pack</div>
        <div class="vxpack-sub">${esc(job.title || '—')}</div>
      </div>
    </div>
    <div class="vxpack-blocks">
      <div class="vxpack-block"><h4>Customer</h4>${custAddr.length ? custAddr.map(esc).join('<br>') : '<span style="color:#9aa5bd">—</span>'}</div>
      <div class="vxpack-block"><h4>Job</h4>${esc(job.title || '—')}<br>${job.scope ? esc(job.scope) + '<br>' : ''}${job.startDate ? 'From ' + esc(fdate(job.startDate)) : ''}${job.endDate ? ' to ' + esc(fdate(job.endDate)) : ''}</div>
      <div class="vxpack-block" style="text-align:right"><h4>Prepared</h4>${esc(fdate(new Date().toISOString()))}<br>${reports.length} report${reports.length === 1 ? '' : 's'}</div>
    </div>
    <div class="vxpack-tally">
      <span class="vxpack-chip" style="--c:#1a8d4e">${nAcc} Acceptable</span>
      <span class="vxpack-chip" style="--c:#c0392b">${nRej} Not acceptable</span>
      ${nOther ? `<span class="vxpack-chip" style="--c:#6b7589">${nOther} Other</span>` : ''}
    </div>
    <table class="vxpack-tbl"><thead><tr><th>Method</th><th>Report no.</th><th>Rev</th><th>Subject</th><th>Verdict</th><th>Date</th></tr></thead><tbody>${summaryRows}</tbody></table>
  </div></div></div>`;

  // Concatenate each report's <body> content (the .vx-print-page set).
  const bodies = reports.map((r) => {
    let html = r.sealedHtml || r.frozenHtml;
    if(!html && typeof ovBuildReportSnapshot === 'function') html = ovBuildReportSnapshot(r);
    if(!html) return '';
    const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return m ? m[1] : '';
  }).join('\n');

  const lang = (typeof vxLocale === 'function' ? vxLocale() : 'en').split('-')[0];
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(job.title || 'Report pack')} — Report pack</title>
<style>
  @page { size: A4; margin: 0; }
  html, body { margin:0; padding:0; background:#fff; }
  body { font-family: Arial, Helvetica, sans-serif; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .vx-print-page { position: relative; width:${W}px; height:${H}px; background:#fff; overflow:hidden; page-break-after: always; break-after: page; }
  .vx-print-page:last-child { page-break-after: auto; break-after: auto; }
  .vx-print-inner { position: absolute; inset: 0; }
  @media print { .vx-print-page { width:210mm; height:297mm; } .vx-print-inner { transform: scale(0.97); transform-origin: center center; } }
  @media screen { body { background:#444; padding:20px; } .vx-print-page { box-shadow:0 4px 20px rgba(0,0,0,.5); margin:0 auto 20px; } }
  div { cursor: default !important; }
  .vxpack-cover { padding:48px 54px; color:#1c2333; font-size:12px; }
  .vxpack-head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid ${accent}; padding-bottom:16px; margin-bottom:22px; }
  .vxpack-logo { max-height:64px; max-width:220px; }
  .vxpack-title { font-size:26px; font-weight:800; color:${accent}; text-transform:uppercase; letter-spacing:-.01em; }
  .vxpack-sub { font-size:14px; color:#3a4660; margin-top:4px; }
  .vxpack-blocks { display:flex; justify-content:space-between; gap:24px; margin-bottom:18px; }
  .vxpack-block { font-size:11.5px; line-height:1.6; flex:1; }
  .vxpack-block h4 { margin:0 0 4px; font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:#9aa5bd; }
  .vxpack-tally { display:flex; gap:10px; margin-bottom:18px; }
  .vxpack-chip { font-size:12px; font-weight:700; color:var(--c); border:1.5px solid var(--c); border-radius:14px; padding:4px 12px; }
  .vxpack-tbl { width:100%; border-collapse:collapse; font-size:11.5px; }
  .vxpack-tbl th { background:${accent}; color:#fff; font-size:10px; text-transform:uppercase; letter-spacing:.04em; padding:7px 9px; text-align:left; }
  .vxpack-tbl td { padding:6px 9px; border-bottom:1px solid #e6e9f0; }
</style></head><body>
${cover}
${bodies}
</body></html>`;
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
  // An approved report prints its sealed (stamped, immutable) snapshot.
  let html = r.sealedHtml || r.frozenHtml;
  if(!html) html = ovBuildReportSnapshot(r);
  if(!html){
    toast(t('toast.report_no_snapshot','No printable layout for this report — its method has no saved template.'),'error');
    return;
  }
  _vxPrintHtml(html);
}

/** Open a saved report in a new browser tab as a viewable PDF-like page.
 *  Same render pipeline as ovPrintReport but no auto-print — the inspector
 *  can scroll, read, share, or print on demand (Ctrl+P) without the
 *  print dialog popping up uninvited. Frozen snapshot first, live rebuild
 *  as fallback for pre-snapshot reports. */
function ovViewReport(idx){
  const reports = (typeof ls === 'function') ? ls(KEYS.reports, []) : [];
  const r = reports[idx];
  if(!r){ toast(t('toast.report_not_found','Report not found.'),'error'); return; }
  let html = r.sealedHtml || r.frozenHtml;
  if(!html) html = ovBuildReportSnapshot(r);
  if(!html){
    toast(t('toast.report_no_snapshot','No printable layout for this report — its method has no saved template.'),'error');
    return;
  }
  const w = window.open('', '_blank');
  if(!w){
    toast(t('toast.popup_blocked','Pop-up blocked — allow pop-ups for this site to open the report viewer.'),'error');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/** Open the rendered template in a new tab for inspection / manual printing. */
function cvOpenInTab(){ cvPrintOrExport({ openInTab:true }); }

// ── Default layout ───────────────────────────────────────────────────
// Pure builder: returns the standard report layout as an array of block
// objects (header, client/subject/criteria/equipment fields, method block,
// result). Shared by the editor's "default layout" button AND the HT template
// seeder so an HT report gets the same report chrome as every other method.
function cvDefaultLayoutBlocks(cc){
  cc = cc || (typeof cvTplCfg!=='undefined' && cvTplCfg.sectionColor) || (typeof cvGetCompanyColor==='function' ? cvGetCompanyColor() : '#404040');
  const blocks=[];
  const add=(key,isLayout,x,y,w,h,extra={})=>{
    const def=isLayout?CV_LAYOUT_ITEMS.find(i=>i.key===key):CV_FIELD_DEFS[key];
    blocks.push({
      id:(typeof _cvBlockId==='function'?_cvBlockId():('blk-'+blocks.length)), key, isLayout,
      x,y, w:w||(def?.w)||160, h:h||(def?.h)||38,
      text:extra.text||(isLayout?(def?.label||key):(def?.label||key)),
      fontSize:extra.fontSize||'8.5px', bold:extra.bold||false, italic:false,
      color:extra.color||'#000', bgColor:extra.bgColor||'transparent',
      borderColor:'#cccccc', showBorder:extra.showBorder!==false,
      align:extra.align||'left', zIndex:blocks.length+1, locked:false,
    });
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
  // 'part-exam' row dropped — that card had no form-side data source
  // and only showed sample data; the items-table covers per-row
  // examination extent already.
  add('section-header',true,M,y,W,22,{text:'Examination criteria',bgColor:cc,color:'#fff',bold:true,showBorder:false,fontSize:'8.5px'}); y+=22;
  add('exam-type',false,M,y,col4+20,36); add('extent',false,M+col4+21,y,col4-10,36); add('spec',false,M+col4*2+12,y,col4+5,36); add('acc-crit',false,M+col4*3+18,y,col4-15,36);
  y+=36;
  // procedure-link (smart card) replaces the legacy 'procedure' field
  // card — it resolves the active procedure for the report's method
  // from Settings → NDT procedures at print time, so the printed
  // procedure number tracks the procedure register without the
  // report having to carry its own eq_proc value.
  add('procedure-link',false,M,y,col2,46); add('proc-rev',false,M+col2+1,y,90,46); add('stage',false,M+col2+95,y,col2-90,46);
  y+=46;
  add('section-header',true,M,y,W,22,{text:'Equipment',bgColor:cc,color:'#fff',bold:true,showBorder:false,fontSize:'8.5px'}); y+=22;
  // calib-status (smart card) replaces the legacy 'equipment' +
  // 'sv-id' + 'cal-date' trio — it resolves the live equipment
  // record from Settings → Equipment (by report eq_id) and prints
  // name + SV-ID + calibration date together with an in-cal /
  // out-of-cal flag.
  add('calib-status',false,M,y,W,46); y+=46;
  add('method-block',true,M,y,W,88,{showBorder:false}); y+=88;
  add('section-header',true,M,y,W,22,{text:'Result / Verdict',bgColor:cc,color:'#fff',bold:true,showBorder:false,fontSize:'8.5px'}); y+=22;
  add('remarks',false,M,y,W,56); y+=56;
  add('result',false,M,y,col2-5,46); add('indications',false,M+col2-4,y,col2+11,46);
  y+=46;
  // page-footer block removed — the Header/Footer zone designer + auto-setup
  // covers everything this block did, and dual sources of footer truth
  // confuse users. The footer for a default layout comes from the zone.
  return blocks;
}

async function cvLoadDefaultLayout(){
  if(cvBlocks.length && !(await vxConfirm({ message: 'Are you sure you want to replace the current page with the default NDT layout? Any custom blocks on this page will be removed.', okLabel: t('vxc.replace','Replace'), danger: true }))) return;
  cvAutoSnapshot('Before default layout');
  cvPushUndo();
  cvPages[cvCurrentPage].blocks=[]; cvSync(); cvNextId=1; cvSelectedId=null; cvSelectedIds=[];
  const cc=cvTplCfg.sectionColor||cvGetCompanyColor();
  cvDefaultLayoutBlocks(cc).forEach(b => cvBlocks.push(b));
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

