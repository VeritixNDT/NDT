// ═══════════════════════════════════════════════════════════════════════════
// PDF TEMPLATE EDITOR v2 — Professional Canvas Layout Builder
// ═══════════════════════════════════════════════════════════════════════════

// Equipment-register fallback lookup. Used by the equipment / sv-id /
// cal-date field getters as a last resort — the normal path is the
// snapshot fields written onto the report by ovSaveReport
// (eq_equip / eq_svid / eq_caldate). This lookup catches reports where
// the snapshot didn't fire but eq_id is set, so the cards don't go
// dark unnecessarily. Returns null when there's no register or no
// matching record.
function _cvEqRecord(r) {
  if(!r || !r.eq_id) return null;
  if(typeof eqLoad !== 'function') return null;
  try { return eqLoad().find(e => e.id === r.eq_id) || null; }
  catch(e) { return null; }
}
function _cvEqLookup(r, field) {
  const rec = _cvEqRecord(r);
  return rec ? (rec[field] || null) : null;
}

// ── Field definitions — maps to report data ────────────────────────────
var CV_FIELD_DEFS = {
  'report-no':    {label:'Report No.',                    ph:'SV-2023-004-NDTD-REP-023-001', get:r=>r.reportNo||r.id||'—',        w:260,h:38, mapTo:'reportNo'},
  // Template number — per-method, admin-set at Settings → Report templates.
  // The smart getter prefers a value baked into the report (set when the
  // report was created from the method template) but falls back to the live
  // per-method template number so legacy reports still surface the field.
  'tpl-number':   {label:'📋 Report template no.',         ph:'TPL-UT-007',                    get:r=>{
    if(r && r.templateNo) return r.templateNo;
    try {
      const td = (typeof ls === 'function' && typeof TPL_KEY === 'string') ? ls(TPL_KEY, {}) : {};
      const m  = (r && r.method) || (typeof cvPpvMethod !== 'undefined' ? cvPpvMethod : '');
      return (td && td[m] && td[m].templateNo) || '—';
    } catch(e){ return '—'; }
  }, w:150, h:38, mapTo:'templateNo', noLabel:true},
  'revision':     {label:'Revision',                      ph:'00',                            get:r=>r.revision||'00',             w:90, h:38, mapTo:'revision'},
  'exam-date':    {label:'Examination date',              ph:'15 Mar 2025',                   get:r=>fmtDate(r.examDate),          w:130,h:38, mapTo:'examDate'},
  // Method — renders the full method name (e.g.
  // "MAGNETIC PARTICLE EXAMINATION REPORT") from NDT_METHODS rather than
  // just the code "MT". Uppercased on render so the card reads as a
  // document title. Value-only (noLabel) so the card on the canvas is the
  // readable method line itself.
  'method':       {label:'NDT Method',                    ph:'ULTRASONIC EXAMINATION REPORT', get:r=>{
    const code = r && r.method;
    if(!code) return '—';
    const m = (typeof NDT_METHODS !== 'undefined') ? NDT_METHODS.find(x => x.id === code) : null;
    return ((m && m.name) || code).toUpperCase();
  }, w:260,h:38, mapTo:'method', noLabel:true},
  'client':       {label:'Client',                        ph:'Offshore Structures BV',        get:r=>r.client||'—',                w:200,h:38, mapTo:'client'},
  'project':      {label:'Project',                       ph:'Platform Alpha — Leg Inspection',get:r=>r.project||'—',              w:240,h:38, mapTo:'project'},
  'project-no':   {label:'Project no.',                    ph:'PRJ-2026-014',                  get:r=>r.projectNo||'—',             w:160,h:38, mapTo:'projectNo'},
  'location':     {label:'Test location',                 ph:'Fabrication yard, Rotterdam',   get:r=>r.location||'—',              w:200,h:38, mapTo:'location'},
  'sv-order':     {label:'SV Order no.',                  ph:'SV-2023-004',                   get:r=>r.svOrder||'—',               w:120,h:38, mapTo:'svOrder'},
  'order-no':     {label:'Order no.',                     ph:'PO-98271',                      get:r=>r.orderNo||'—',               w:120,h:38, mapTo:'orderNo'},
  'req-no':       {label:'Request no.',                   ph:'REQ-2023-045',                  get:r=>r.requestNo||'—',             w:150,h:38, mapTo:'requestNo'},
  'ref-client':   {label:'Client reference',              ph:'OSB-2023-PR-012',               get:r=>r.clientRef||'—',             w:150,h:38, mapTo:'clientRef'},
  'subject':      {label:'Weld / object',                 ph:'Main leg splice weld — Node L4',get:r=>r.subject||'—',               w:260,h:38, mapTo:'subject'},
  'drawing-no':   {label:'Drawing no.',                   ph:'OSB-DWG-4420-B',                get:r=>r.drawing||'—',               w:150,h:38, mapTo:'drawing'},
  'subject-no':   {label:'Subject no.',                   ph:'L4-SP-007',                     get:r=>r.subjectNo||'—',             w:130,h:38, mapTo:'subjectNo'},
  'welders':      {label:'Welder(s)',                     ph:'J. Bakker, M. de Vries',        get:r=>r.welders||'—',               w:175,h:38, mapTo:'welders'},
  'weld-process': {label:'Welding process',               ph:'FCAW / SAW',                    get:r=>r.weldProcess||'—',           w:130,h:38, mapTo:'weldProcess'},
  'material':     {label:'Material',                      ph:'S355J2G3',                      get:r=>r.material||'—',              w:130,h:38, mapTo:'material'},
  'weld-prep':    {label:'Weld type / prep',              ph:'V-groove',                      get:r=>r.weldType||'—',              w:130,h:38, mapTo:'weldType'},
  'heat-treat':   {label:'Heat treatment',                ph:'PWHT',                          get:r=>r.heatTreat||'—',             w:120,h:38, mapTo:'heatTreat'},
  'thickness':    {label:'Dimensions / thickness',        ph:'Ø323.9 × 32mm',                get:r=>r.dimensions||'—',            w:110,h:38, mapTo:'dimensions'},
  'surf-cond':    {label:'Surface condition',             ph:'As welded',                     get:r=>r.surfCond||'—',              w:150,h:38, mapTo:'surfCond'},
  'temperature':  {label:'Surface temperature',           ph:'18°C',                          get:r=>r.surfTemp||'—',              w:110,h:38, mapTo:'surfTemp'},
  'weld-pos':     {label:'Welding position',              ph:'PA',                            get:r=>r.eq_weldPos||r.weldPos||'—', w:100,h:38, mapTo:'eq_weldPos / weldPos'},
  'part-exam':    {label:'Part examined',                  ph:'100% of weld seam incl. HAZ',   get:r=>r.partExam||'—',              w:380,h:44, mapTo:'partExam'},
  'exam-type':    {label:'Examination type',              ph:'Weld surface examination',      get:r=>r.examType||'—',              w:200,h:38, mapTo:'examType'},
  'extent':       {label:'Extent',                        ph:'100% Weld and HAZ',             get:r=>r.extent||'—',                w:160,h:38, mapTo:'extent'},
  'spec':         {label:'Specification',                 ph:'EN-ISO 17640:2018',             get:r=>r.eq_spec||r.spec||'—',       w:185,h:38, mapTo:'eq_spec / spec'},
  'acc-crit':     {label:'Acceptance criteria',           ph:'EN-ISO 11666:2018 level 2',     get:r=>r.eq_acc||r.accCrit||'—',     w:200,h:38, mapTo:'eq_acc / accCrit'},
  'procedure':    {label:'Procedure no.',                 ph:'SV2023-004-NDTD-PRO-0009',      get:r=>r.eq_proc||r.proc||'—',       w:210,h:38, mapTo:'eq_proc / proc'},
  'proc-rev':     {label:'Procedure revision',            ph:'01',                            get:r=>r.procRev||'—',               w:90, h:38, mapTo:'procRev'},
  // PT classification + procedural fields (Type / Method / Sensitivity /
  // pre-cleaner / test panel / emulsifier dwell / drying time) are
  // dropped on the page via the Method-specific field card below —
  // each one is just another TPL_FIELDS.PT entry the configurable cell
  // can bind to. Avoids a card-per-field explosion in the palette.
  'equipment':    {label:'Equipment',                     ph:'SIUI Smartor 16',               get:r=>r.eq_equip||r.equip||_cvEqLookup(r,'name')||'—',     w:185,h:38, mapTo:'eq_equip / equip'},
  'sv-id':        {label:'SV-ID No.',                     ph:'SV-UT-004',                     get:r=>r.eq_svid||r.eqSvId||_cvEqLookup(r,'svId')||'—',     w:110,h:38, mapTo:'eq_svid'},
  'cal-date':     {label:'Calibration date',              ph:'2025-01-10',                    get:r=>r.eq_caldate||r.eqCalDate||_cvEqLookup(r,'calLastAt')||'—',w:130,h:38, mapTo:'eq_caldate'},
  'light-source': {label:'Light source',                  ph:'Daylight',                      get:r=>r.eq_lightsource||r.lightsource||'—',                w:150,h:38, mapTo:'eq_lightsource'},
  // Method-specific field — one configurable place card that can bind
  // to any per-method TPL_FIELDS entry (block.methodField). Free-drag;
  // parents to a method-block container when dropped inside one. Custom
  // render (def.methodCell). The legacy 'method-cell' key is kept so
  // canvases saved before the rename keep resolving.
  'method-cell':  {label:'Method-specific field',          ph:'',                              get:r=>'',                           w:150,h:40, methodCell:true},
  'stage':        {label:'Stage of examination',          ph:'Final',                         get:r=>r.eq_stage||r.stage||'—',     w:140,h:38, mapTo:'eq_stage / stage'},
  'result':       {label:'Result / Verdict',              ph:'ACCEPTABLE',                    get:r=>{const v=r.verdict||r.result||'—'; return v==='Acceptable'||v==='Pass'?'ACCEPTABLE':v==='Not acceptable'||v==='Fail'?'NOT ACCEPTABLE':v==='Monitor'?'MONITOR':v;}, w:240,h:48,result:true, mapTo:'verdict'},
  'indications':  {label:'Reportable indications',        ph:'No / Nee',                      get:r=>r.indications||((r.verdict==='Not acceptable'||r.result==='Fail')?'Yes':'No'), w:155,h:38, mapTo:'indications'},
  'remarks':      {label:'Remarks / observations',        ph:'No recordable indications detected.',get:r=>r.remarks||'—',          w:400,h:60,multi:true, mapTo:'remarks'},
  'inspector':    {label:'Inspector name',                ph:'Carl Cope',                     get:r=>r.inspector||'—',             w:160,h:38, mapTo:'inspector'},
  'insp-level':   {label:'Level',                         ph:'UT Level II',                   get:r=>r.level||(r.method?r.method+' Level II':'—'), w:110,h:38, mapTo:'level'},
  'cert-auth':    {label:'Cert. Authority',               ph:'PCN:319222',                    get:r=>r.certAuth||'—',              w:160,h:38, mapTo:'certAuth'},
  'insp-sig':     {label:'Inspector signature',           ph:'',                              get:r=>'',                           w:185,h:60,sig:true},
  'client-sig':   {label:'Client signature',              ph:'',                              get:r=>'',                           w:185,h:60,sig:true},
  // QC and Certifying Authority / Notified Body sign-off slots — same
  // shape as the existing signature fields so they slot into the
  // sig-block pattern transparently. Distinct keys so each can carry
  // its own signature image / dated countersign on the report data.
  'qc-sig':       {label:'QC signature',                  ph:'',                              get:r=>'',                           w:185,h:60,sig:true},
  'cert-auth-sig':{label:'Cert. Authority / NoBo signature', ph:'',                           get:r=>'',                           w:200,h:60,sig:true},
  'insp-date':    {label:'Inspector date',                ph:'____/____/________',            get:r=>'',                           w:145,h:38},
  // Plain unbound "Date" card — label only, never carries report data.
  // For PDFs where a date is written in by hand on the printed sheet.
  'date-blank':   {label:'Date',                          ph:'____/____/________',            get:r=>'',                           w:145,h:38},

  // ── COMPUTED / SMART FIELDS ─────────────────────────────────────
  'defect-count':    {label:'Defect count',          ph:'3',         get:r=>(r.defects||[]).length, w:100,h:38, computed:true, mapTo:'computed'},
  'pass-rate':       {label:'Pass rate %',           ph:'92%',       get:r=>{const rs=ls(KEYS.reports,[]);if(!rs.length)return'—';return Math.round(rs.filter(x=>x.verdict==='Acceptable').length/rs.length*100)+'%';}, w:120,h:38, computed:true},
  'rejected-count':  {label:'Rejected indications', ph:'1',         get:r=>(r.defects||[]).filter(d=>d.severity==='Critical'||d.severity==='High'||d.acceptance==='Reject').length, w:140,h:38, computed:true},
  // Report / sign date (auto) — formerly "Today (auto)". Renders today's
  // date as the live report / sign date. Keys / palette group unchanged
  // so existing canvases with a today-date block keep working.
  'today-date':      {label:'Report / sign (auto)',  ph:'15 Mar 2025', get:r=>fmtDate(new Date()), w:140,h:38, computed:true},
  'page-num':        {label:'Page X of Y',           ph:'Page 1 of 3', get:r=>'Page '+((typeof _cvPrintPageNum!=='undefined'&&_cvPrintPageNum)||(typeof cvCurrentPage!=='undefined'?cvCurrentPage+1:1))+' of '+((typeof _cvPrintPageNum!=='undefined'&&_cvPrintPageNum&&typeof _cvPrintTotal!=='undefined'&&_cvPrintTotal)?_cvPrintTotal:(typeof cvPages!=='undefined'?cvPages.length:1)), w:130,h:32, computed:true},

  // ── PROCEDURE / CERT / CALIBRATION STATUS ───────────────────────
  'procedure-link':  {label:'Procedure (linked)',    ph:'SV-PRO-009 Rev 02',  get:r=>'',w:280,h:46, smartLink:'procedure'},
  'cert-status':     {label:'Inspector cert status', ph:'Level II UT · valid', get:r=>'',w:240,h:46, smartLink:'cert'},
  // Eye-sight test cert (EN-ISO 17637:2016 §6) — resolves the signoff
  // inspector's annual near-vision certificate, in the same shape as
  // cert-status. On VT reports the smart card surfaces Valid / Expiring
  // / Expired; on the printed PDF the card hyperlinks to the cert in
  // Annex A when an uploaded file is on file.
  'eye-cert-status': {label:'Eye-sight test cert',    ph:'Eye-sight · valid',   get:r=>'',w:240,h:46, smartLink:'eyecert'},
  'calib-status':    {label:'Equipment calibration', ph:'Cal valid until Q3 2025', get:r=>'',w:240,h:46, smartLink:'calib'},
  // Secondary equipment card — for inspections that combine two
  // pieces of gear on one report (VT's cam gauge + borescope, etc.).
  // Resolves from report.eq_id_secondary (set by ovSaveReport when a
  // useEquipmentRegister field is flagged secondary:true). Same card
  // shape as calib-status; the resolver branches on smartLink:'calib2'.
  'calib-status-2':  {label:'Equipment calibration (2nd)', ph:'Additional gear · in cal', get:r=>'',w:240,h:46, smartLink:'calib2'},
  // Light-equipment calibration cards — same shape and status logic as
  // calib-status. They resolve a register record (Settings → Equipment)
  // by its Type field — White-light meter for the light card, UV-A lamp
  // for the UV card — falling back to a name keyword for untyped records.
  'light-status':    {label:'White-light equipment', ph:'White light · in cal', get:r=>'',w:240,h:46, smartLink:'light'},
  'uv-light-status': {label:'UV-A light equipment',  ph:'UV-A 365 nm · in cal', get:r=>'',w:240,h:46, smartLink:'uvlight'},
  // Combined examination light & UV conditions — renders the white-light
  // and UV-A readings captured on a VT / MT / PT report. White light gates
  // UV-A: ≤20 lux is fluorescent (UV-A shown), above 20 lux is a visible
  // inspection (UV-A "Not applicable"). All three methods now record the
  // reading as eq_whitelight; the legacy eq_lux fallback in the resolver
  // keeps pre-unification VT reports rendering correctly.
  'light-conditions':{label:'Light & UV conditions', ph:'White light · UV-A', get:r=>'',w:240,h:46, smartLink:'lightcond'},
  'accept-eval':     {label:'Acceptance evaluation', ph:'7 mm vs ≤ 8 mm (ISO 11666 L2) — ACCEPTABLE', get:r=>'',w:380,h:46, smartLink:'accept'},

  // ── ADVANCED OUTPUT ─────────────────────────────────────────────
  'qr-code':         {label:'QR — verify report',    ph:'',           get:r=>'',                          w:90, h:90,  qr:true},
  'weld-map':        {label:'Weld / defect map',     ph:'',           get:r=>'',                          w:380,h:220, weldMap:true},
  'scan-image':      {label:'A/B/C-scan image',      ph:'',           get:r=>'',                          w:280,h:200, scanImg:true},
  'cross-ref':       {label:'Cross-reference',       ph:'See defect 3 on page 4', get:r=>'',              w:200,h:32, xref:true},

  // ── REPEATING SECTIONS ──────────────────────────────────────────
  'defect-row-loop': {label:'Defect row (auto-repeat)', ph:'Loops once per defect', get:r=>'',           w:754,h:34, repeat:'defects'},

  // ── COMPANY (LIVE) ─────────────────────────────────────────────
  // V29: smart-link fields that read live from the company profile
  // (Settings → Company). The get() functions invoke _cvCompany() which
  // reads vx-company-v1 fresh each render — so changes to the profile
  // appear in the next preview without any explicit refresh.
  'co-name-smart':    {label:'Company name (live)',    ph:'Acme Inspection Ltd.',     get:r=>_cvCompany().name||'—',         w:260,h:36, smartLink:'company', companyField:'name'},
  'co-address-smart': {label:'Company address (live)', ph:'1 NDT Street, Antwerp',    get:r=>_cvFormatCompanyAddress(),       w:280,h:56, smartLink:'company', companyField:'address'},
  'co-phone-smart':   {label:'Company phone (live)',   ph:'+32 3 123 45 67',          get:r=>_cvCompany().phone||'—',        w:160,h:32, smartLink:'company', companyField:'phone'},
  'co-email-smart':   {label:'Company email (live)',   ph:'info@company.com',         get:r=>_cvCompany().email||'—',        w:200,h:32, smartLink:'company', companyField:'email'},
  'co-website-smart': {label:'Company website (live)', ph:'https://company.com',      get:r=>_cvCompany().web||'—',          w:200,h:32, smartLink:'company', companyField:'web'},
  'co-vat-smart':     {label:'Company VAT/reg (live)', ph:'BE 0123.456.789',          get:r=>_cvCompany().reg||'—',          w:160,h:32, smartLink:'company', companyField:'reg'},
  'co-logo-smart':    {label:'Company logo (live)',    ph:'',                          get:r=>'',                             w:140,h:56, smartLink:'company', companyField:'logo', isLogo:true},
  'co-block':         {label:'Company info block',     ph:'Acme Inspection Ltd.\n1 NDT Street\n+32 3 123 45 67', get:r=>'',  w:280,h:90, smartLink:'company', companyField:'block', isCompanyBlock:true},
  // Live company-text smart fields. Render the corresponding Settings →
  // Company field at every read — so changing the standard footer text or
  // confidentiality statement updates the printed output on the next
  // render, without re-running auto-setup. noLabel so the card carries
  // just the value (these are full lines of copy, not labelled fields).
  'co-footer-smart':   {label:'Standard footer text',   ph:'Acme Inspection Ltd. — Accredited inspection body', get:r=>'', w:340,h:24, smartLink:'company', companyField:'footer',     isCompanyFooter:true,     noLabel:true},
  'co-confidstmt-smart':{label:'Confidentiality statement', ph:'This report is confidential and intended solely for the named client.', get:r=>'', w:520,h:30, smartLink:'company', companyField:'confidstmt', isCompanyConfidStmt:true, noLabel:true},
};

// V29 — Company profile live-read helpers.
// _cvCompany()                — read the company profile fresh each call
// _cvFormatCompanyAddress()   — compose a multi-line postal address
// _cvHasCompanyData()         — quick "has the user filled anything in" check
function _cvCompany(){
  try { return ls(KEYS.company, {}) || {}; }
  catch(e){ return {}; }
}
function _cvFormatCompanyAddress(){
  const c = _cvCompany();
  const parts = [
    c.addr1,
    c.addr2,
    [c.post, c.city].filter(Boolean).join(' '),
    c.country,
  ].filter(s => s && s.trim());
  return parts.length ? parts.join('\n') : '—';
}
function _cvHasCompanyData(){
  const c = _cvCompany();
  return !!(c.name || c.addr1 || c.email || c.phone || c.logo);
}

// V29 — Zone detection. A block placed within the header band (top
// cvTplCfg.header.heightPx pixels) gets zone='header'; within the footer band
// (bottom cvTplCfg.footer.heightPx pixels of the A4 page) gets zone='footer';
// otherwise no zone (page body). A block straddling a band boundary is
// assigned to the zone where its midpoint lies — biases toward the band the
// user most likely intended.
var CV_PAGE_HEIGHT_PX = 1123;
// AUDIT-FIX #9: A4 page width in CSS pixels (210mm @ 96dpi). Was a bare
// literal at four sites (cvFitToView, cvApplyZoom width + zoom, print CSS);
// now named alongside the existing height constant so the page-size pair
// has a single source of truth. Changing page size (Letter, Legal, etc.)
// in the future only requires updating these two constants.
var CV_PAGE_WIDTH_PX  = 794;
function _cvDetectZone(y, h){
  const midY = y + (h || 0) / 2;
  const hdr  = cvTplCfg.header;
  const ftr  = cvTplCfg.footer;
  if(hdr && hdr.enabled && midY < (hdr.heightPx || 100)) return 'header';
  if(ftr && ftr.enabled && midY > (CV_PAGE_HEIGHT_PX - (ftr.heightPx || 60))) return 'footer';
  return null;   // null = page body (default)
}

// AUDIT-FIX #1: Cross-reference page-number resolution.
// Both cvRenderCanvas and cvBuildPrintHTML need to populate cvCrossRefMap
// with { 'defect-N': 'page X' } so that cross-reference fields can show
// "See defect-3 on page 4". Earlier versions of this code had two divergent
// implementations: the preview hardcoded every entry to 'page 1', and the
// print pipeline mapped defect-N to page-N — both wrong, because defects
// don't get their own pages by default. They render inline within whichever
// editor page contains a defect-table or defect-row-loop block. This helper
// scans cvPages, finds the first page hosting a defect-rendering block, and
// maps every defect index to that page. Falls back to page 1 if no defect
// block is found (the cross-reference still resolves to something readable
// rather than 'pending').
function _cvBuildCrossRefMap(report){
  const map = {};
  if(!report || !report.defects || !report.defects.length) return map;
  // Find the editor page that hosts the first defect-rendering block.
  // Recognised renderers: any block whose field def carries repeat:'defects'
  // (e.g. 'defect-row-loop') AND the 'defect-table' layout block.
  let defectPageIdx = -1;
  for(let p = 0; p < cvPages.length; p++){
    const blocks = cvPages[p].blocks || [];
    const hasDefectBlock = blocks.some(b => {
      if(b.key === 'defect-table') return true;
      const def = CV_FIELD_DEFS[b.key];
      return !!(def && def.repeat === 'defects');
    });
    if(hasDefectBlock){ defectPageIdx = p; break; }
  }
  // If no defect block is anywhere on the template, fall back to page 1 so
  // the cross-ref still renders readable text instead of leaving "pending"
  // visible in the printed PDF.
  const pageLabel = 'page ' + (defectPageIdx >= 0 ? defectPageIdx + 1 : 1);
  (report.defects || []).forEach((d, i) => { map['defect-' + (i + 1)] = pageLabel; });
  return map;
}

// Column definition for the defect-table block. Each defect now renders
// as a two-row card: three data columns (each with a top + bottom field)
// plus a photo column that spans both rows. The render branch + the
// Properties-panel column-width editor share this so they stay in sync;
// per-block block.colWidths overrides drive the visible widths once the
// inspector has dragged any column.
//
//   ┌──────────┬──────────┬──────────┬───────┐
//   │ Subject  │ Drawing  │ Material │ Photo │
//   ├──────────┼──────────┼──────────┤ (2×)  │
//   │ Location │ Type     │ Size     │       │
//   └──────────┴──────────┴──────────┴───────┘
//
// Column 1's data cells: subject (top) + defectLocation (bottom)
// Column 2's data cells: drawing (top) + defectType     (bottom)
// Column 3's data cells: material (top) + defectSize    (bottom)
// Column 4:              defectPhoto rowspan 2
var CV_DEFECT_COLS = [
  { label:'Col 1 (Weld / Location)', width:140, topId:'subject',  topLabel:'Weld / object', botId:'defectLocation',    botLabel:'Location' },
  { label:'Col 2 (Drawing / Type)',  width:120, topId:'drawing',  topLabel:'Drawing no.',   botId:'defectType',        botLabel:'Defect type' },
  { label:'Col 3 (Material / Size)', width:110, topId:'material', topLabel:'Material',      botId:'defectSize',        botLabel:'Size' },
  // Col 4 mirrors the standalone Defects log's Severity / Disposition
  // pair so the same information that's captured on the log surfaces
  // on the printed defect table. The new-report Defects section
  // captures these per rejected item — see _ovDefectsSectionHtml in
  // dashboard.js — and the cross-reference path in the defect-table
  // renderer (case 'defect-table') maps log entries' severity /
  // disposition into the same slots.
  { label:'Col 4 (Severity / Action)', width:110, topId:'defectSeverity', topLabel:'Severity', botId:'defectDisposition', botLabel:'Action' },
  { label:'Photo (full height)',     width:60,  photoId:'defectPhoto' },
];

// Method-cell field pairs — when the "Method-specific field" place card
// is bound to one of these fields, the paired field's value is appended
// after the separator so two related procedural pieces print on a
// single line (e.g. "Magnaflux ZL4C · Batch 24P-0815").
//   MT  susp + suspBatch, contrast + contrastBatch,
//       susptype + bathConc (suspension classification joined with
//       the centrifuge-settling concentration reading),
//       tech + magDir (magnetising technique joined with field
//       direction — Yoke (AC) · Longitudinal etc.),
//       cur + curint (current type joined with the intensity in A),
//       liftingPower + refIndicator (system-performance check —
//       lift-test result joined with the reference indicator used),
//       demag + demagMethod (was demagnetisation achieved, and how).
//   PT  pen + penBatch, dev + devBatch, precleaner + dryTime.
// CV_METHOD_FIELD_HIDDEN is derived from this — the paired secondary
// fields are hidden from the Properties panel's Method field picker,
// because they're already rendered alongside their primary partner
// (a standalone Penetrant batch / Developer batch / Drying time /
// Reference indicator / Demagnetisation method / Current intensity
// cell would just repeat what's already on the primary card).
var CV_METHOD_FIELD_PAIRS = {
  susp:         { with:'suspBatch',     prefix:' · Batch ' },
  contrast:     { with:'contrastBatch', prefix:' · Batch ' },
  pen:          { with:'penBatch',      prefix:' · Batch ' },
  dev:          { with:'devBatch',      prefix:' · Batch ' },
  precleaner:   { with:'dryTime',       prefix:' · Dry ' },
  susptype:     { with:'bathConc',      prefix:' · ' },
  tech:         { with:'magDir',        prefix:' · ' },
  cur:          { with:'curint',        prefix:' · ' },
  liftingPower: { with:'refIndicator',  prefix:' · ' },
  demag:        { with:'demagMethod',   prefix:' · ' },
};
var CV_METHOD_FIELD_HIDDEN = new Set(
  Object.values(CV_METHOD_FIELD_PAIRS).map(p => p.with)
);

var CV_LAYOUT_ITEMS = [
  {key:'section-header', label:'Section header bar',         w:754,h:24},
  {key:'text-block',     label:'Free text / note',           w:360,h:48},
  {key:'h-line',         label:'Horizontal divider',         w:754,h:10},
  {key:'logo-co',        label:'Company logo',               w:140,h:56},
  {key:'photo-box',      label:'Photo placeholder',          w:220,h:150},
  {key:'photo-page',     label:'Photo page (6 slots)',       w:754,h:980},
  {key:'drawing-page',   label:'Drawing page',                w:754,h:980},
  {key:'single-photo',   label:'Single image (photo / screenshot)', w:360,h:280},
  {key:'single-drawing', label:'Single drawing',             w:360,h:280},
  {key:'photo-details',  label:'Photo details / information', w:360,h:80},
  {key:'additional-page',label:'Additional page',            w:754,h:980},
  {key:'defect-table',   label:'Defect / indication table',  w:754,h:90},
  {key:'items-table',    label:'Examination details',        w:754,h:90},
  {key:'revision-history',label:'Revision history',           w:260,h:64},
  {key:'method-block',   label:'Method-specific data block', w:754,h:90},
  {key:'accent-bar',     label:'Colour accent bar',          w:754,h:5},
];

var CV_PALETTE_GROUPS = [
  {id:'company',   label:'🏢 Company (live)', fields:['co-name-smart','co-address-smart','co-phone-smart','co-email-smart','co-website-smart','co-vat-smart','co-logo-smart','co-block','co-footer-smart','co-confidstmt-smart']},
  {id:'template',  label:'📋 Report template', fields:['tpl-number']},
  {id:'identity',  label:'Identity',      fields:['report-no','revision','method','exam-date']},
  {id:'client',    label:'Client info',   fields:['client','project','project-no','location','sv-order','order-no','req-no','ref-client']},
  {id:'subject',   label:'Subject',       fields:['subject','drawing-no','subject-no','material','thickness','weld-prep','weld-process','welders']},
  // Stale picks dropped from the palette (definitions kept in
  // CV_FIELD_DEFS so legacy templates referencing them still render):
  //   • procedure          — replaced by procedure-link smart card
  //   • equipment / sv-id / cal-date — replaced by calib-status smart card
  //   • insp-level / cert-auth       — replaced by cert-status smart card
  // The Smart / linked group is the place to grab their working equivalents.
  {id:'criteria',  label:'Criteria',      fields:['exam-type','surf-cond','temperature','heat-treat','extent','spec','acc-crit','proc-rev','stage','weld-pos']},
  {id:'equipment', label:'Equipment',     fields:['light-source','method-cell']},
  {id:'result',    label:'Result',        fields:['result','indications','remarks']},
  {id:'signoff',   label:'Sign-off',      fields:['inspector','insp-sig','client-sig','qc-sig','cert-auth-sig','insp-date','date-blank']},
  {id:'smart',     label:'⚡ Smart / linked',fields:['procedure-link','cert-status','eye-cert-status','calib-status','calib-status-2','light-status','uv-light-status','light-conditions','accept-eval']},
  {id:'computed',  label:'∑ Computed',    fields:['defect-count','rejected-count','pass-rate','today-date','page-num','cross-ref']},
  {id:'advanced',  label:'★ Advanced output', fields:['qr-code','weld-map','scan-image','defect-row-loop']},
  {id:'components',label:'⬢ My components', isComponents:true},
  {id:'layout',    label:'Layout elements',isLayout:true},
];

// ── Canvas state ──────────────────────────────────────────────────────
var CV_KEY = 'vx-canvas-layout-v1';

// V24: stable, collision-resistant block ID generator. Combines an
// epoch-seconds base-36 timestamp with 6 chars of cryptographic randomness.
// Format: 'blk-{ts36}-{rand6}' — e.g. 'blk-l8x2k4-h7q9z2'. About 60 bits of
// entropy per block; collisions effectively impossible in single-user use,
// safe for cross-device merge later. Uses crypto.getRandomValues where
// available, falling back to Math.random for older browsers.
function _cvBlockId(){
  const ts36 = Date.now().toString(36);
  let rand;
  if(typeof crypto !== 'undefined' && crypto.getRandomValues){
    const buf = new Uint8Array(4);
    crypto.getRandomValues(buf);
    rand = Array.from(buf).map(b => b.toString(36).padStart(2,'0')).join('').slice(0,6);
  } else {
    rand = Math.random().toString(36).slice(2,8);
  }
  return 'blk-' + ts36 + '-' + rand;
}

// AUDIT-FIX #3: Block-clone helper. Three places used to inline the same
// five-line pattern: JSON.parse(JSON.stringify(b)) for a deep copy, fresh
// _cvBlockId(), x/y offset by 16px (= 2 grid cells, visible but adjacent),
// and a zIndex that lifts the clone above existing blocks. The callers
// (cvDuplicateBlock, cvPasteClipboard, the Ctrl+D multi-duplicate handler)
// all push the result to cvBlocks themselves, so this helper just produces
// the prepared clone — it doesn't mutate cvBlocks. That keeps batch loops
// correct: each iteration sees a fresh cvBlocks.length when computing the
// next zIndex, so duplicates of 5 blocks all stack predictably above the
// originals. The +16 offset is also reused so multi-iteration callers
// produce a slight cascade rather than overlapping the originals at the
// exact same coordinates.
function _cvCloneBlock(b){
  const nb = JSON.parse(JSON.stringify(b));
  nb.id = _cvBlockId();
  nb.x = cvSnap(b.x + 16);
  nb.y = cvSnap(b.y + 16);
  nb.zIndex = cvBlocks.length + 1;
  return nb;
}
var CV_TPL_KEY = 'vx-tpl-config-v1';
var CV_METHOD_TPL_PREFIX = 'vx-method-tpl-';

// PDF editor font catalogue. block.fontFamily stores a KEY from this map;
// the rendered CSS value is the full fallback stack. Both the ribbon and
// the Properties-panel dropdowns list these keys. A block with no
// fontFamily (or an unknown one) inherits the canvas font, so existing
// templates are unaffected.
var CV_FONTS = {
  'Arial':           "Arial, Helvetica, sans-serif",
  'Helvetica':       "Helvetica, Arial, sans-serif",
  'Segoe UI':        "'Segoe UI', Tahoma, Geneva, sans-serif",
  'Times New Roman': "'Times New Roman', Times, serif",
  'Georgia':         "Georgia, 'Times New Roman', serif",
  'Courier New':     "'Courier New', Courier, monospace",
  'Verdana':         "Verdana, Geneva, sans-serif",
  'Calibri':         "Calibri, 'Segoe UI', sans-serif"
};
var CV_FONT_LIST = Object.keys(CV_FONTS);

var cvPages = [{label:'Page 1', blocks:[]}];
var cvCurrentPage = 0;
var cvBlocks = cvPages[0].blocks;
var cvSelectedId = null;
var cvSelectedIds = [];  // multi-select

// AUDIT-FIX #2: Named helpers for the two "sync cvSelectedId from cvSelectedIds"
// patterns used across the editor. Earlier code inlined the choice at five
// different callsites, which made the underlying convention invisible. The
// convention is:
//
//   _cvPrimaryToLast()  — for shift-toggle operations (shift-click on canvas
//                         or in the layers panel). The block the user most
//                         recently interacted with becomes the primary
//                         selection. Matches mainstream editors (Figma,
//                         Sketch, Illustrator).
//
//   _cvPrimaryToFirst() — for batch operations that replace the selection
//                         wholesale (Ctrl+A select-all, Ctrl+D duplicate-all).
//                         The first block in document order becomes primary,
//                         giving a stable, predictable result regardless of
//                         which order the user clicked things previously.
//
// Both helpers gracefully handle the empty-selection case by clearing
// cvSelectedId to null. Callers don't need to write the `|| null` fallback.
function _cvPrimaryToLast(){
  cvSelectedId = cvSelectedIds[cvSelectedIds.length - 1] || null;
}
function _cvPrimaryToFirst(){
  cvSelectedId = cvSelectedIds[0] || null;
}

// AUDIT-FIX #7 (scoped): the paired-write pattern for selecting exactly one
// block (or none). Original audit framed this as "cvSelectedId is fully
// derivable from cvSelectedIds", but after fix #2 made the two-pattern
// convention explicit (toggle uses last, batch uses first), cvSelectedId
// genuinely preserves which convention applied at the last selection event.
// What IS still redundant is the paired-write pattern for the "select
// exactly one block" case — five sites used to write both fields in two
// lines. This helper centralizes that.
//
// Passing a falsy id (null/undefined) clears the selection — same semantics
// as cvSelectBlock(null) but without the UI side effects (re-render etc.),
// so it can be used inside larger operations that batch their re-render.
function _cvSelectSingle(id){
  cvSelectedId = id || null;
  cvSelectedIds = id ? [id] : [];
}
var cvDragging = null;
var cvResizing = null;
var cvZoom = 1.0;
var cvPreview = false;
var cvNextId = 1;
var cvPaletteDrag = null;
var cvPaletteCollapsed = {};
var cvPpvMethod = 'MT';
var cvPpvResult = 'Pass';
// 1-based page number during a print build (set by cvBuildPrintHTML for
// each sheet); 0 at all other times. Lets the page-num field resolve to
// the real page on every printed sheet instead of a static "Page 1".
var _cvPrintPageNum = 0;
// Total printed sheets after table pagination (the "of N" page-num shows),
// and the row slice the items-table renders on the current sheet
// (null = every row).
var _cvPrintTotal = 0;
var _cvItemsSlice = null;
var cvPpvShowDefects = false;
var cvUndoStack = [];
var cvRedoStack = [];
var cvClipboard = null;  // copy/paste
var cvDragUndoPushed = false;  // prevent undo spam during drag
// Base positioning grid. 4px (finer than the previous 8px) so block
// widths / x-positions divide cleanly with the per-column sizes used
// across CV_FIELD_DEFS and RPT_FORM.items (most are multiples of 4).
// Combined with the snap-to-edge below, this gives an Excel-feel:
// blocks always land on a predictable cadence in empty space, but the
// edge snap overrides for pixel-perfect adjacency next to neighbours.
var CV_GRID = 4;
// Pixels for snap-to-edge. 12px is wide enough to feel responsive when
// dragging a card into a neighbouring column without making it sticky
// in empty space.
var CV_SNAP_THRESHOLD = 12;
// Snap-to-grid toggle — persisted across sessions. Default on so the
// editor's existing behaviour is unchanged; flipping off lets the user
// position pixel-perfectly without the grid rounding their drags.
var _cvSnapOn = (function(){
  try { return localStorage.getItem('vx-cv-snap') !== '0'; }
  catch(e){ return true; }
})();
function _cvPersistSnap(){
  try { localStorage.setItem('vx-cv-snap', _cvSnapOn ? '1' : '0'); }
  catch(e){}
}
function cvSnap(v){ return _cvSnapOn ? Math.round(v/CV_GRID)*CV_GRID : Math.round(v); }
function cvToggleSnap(){
  _cvSnapOn = !_cvSnapOn;
  _cvPersistSnap();
  _cvSyncSnapButton();
  _cvSyncGridOverlay();
  if(typeof toast === 'function')
    toast(t(_cvSnapOn ? 'pe.toast.snap_on' : 'pe.toast.snap_off',
      _cvSnapOn ? 'Snap to grid: on' : 'Snap to grid: off'));
}
function _cvSyncSnapButton(){
  const btn = document.getElementById('cv-snap-toggle');
  if(!btn) return;
  btn.classList.toggle('active', _cvSnapOn);
  btn.style.background = _cvSnapOn ? 'rgba(79,142,247,.15)' : '';
  btn.style.color      = _cvSnapOn ? 'var(--blue)' : '';
  btn.title = _cvSnapOn
    ? 'Snap to grid is ON — drags and resizes round to 8px. Click to disable.'
    : 'Snap to grid is OFF — pixel-perfect positioning. Click to enable.';
}
// Show/hide the 8px grid overlay so the visual matches the snap state.
function _cvSyncGridOverlay(){
  const g = document.getElementById('cv-grid-overlay');
  if(g) g.style.display = _cvSnapOn ? '' : 'none';
}
function cvSync(){ cvBlocks = cvPages[cvCurrentPage].blocks; }

function cvGetCompanyColor(){
  try { const c = ls(KEYS.company, {}); return c.color || '#185FA5'; } catch(e){ return '#185FA5'; }
}

var cvTplCfg = {
  sectionColor:'#404040', margin:'8px', baseSize:'8.5px',
  showLogo:true, showFooter:true,
  tplLogo:null, logoPos:'left', logoSize:'md',
  content:{},
  // Header / footer zones repeat on every page in print/export.
  //
  //   enabled            — toggles the zone on/off (no-cost when off).
  //   heightPx           — band height in design pixels.
  //   bgColor            — chrome fill. 'transparent' = no fill.
  //   accentColor        — accent strip colour. '' falls back to sectionColor.
  //   accentThicknessPx  — accent strip thickness (0 = no strip).
  //   accentPos          — 'top' | 'bottom' | 'none'.
  //   borderStyle        — 'none' | 'thin' (1px) | 'heavy' (2px).
  //   borderColor        — '' falls back to a tinted sectionColor.
  //   paddingPx          — inner padding for blocks placed in the zone.
  //
  // Blocks placed inside the band are tagged with zone='header'|'footer' in
  // the block JSON; at print time the pipeline injects them at the band
  // position on every page. The chrome (bg, accent, border) renders behind
  // those blocks both in design mode and in print, giving the zone a
  // designed look without users having to wire it up block-by-block.
  header:{
    enabled:false, heightPx:100, bgColor:'transparent',
    accentColor:'', accentThicknessPx:4, accentPos:'bottom',
    borderStyle:'none', borderColor:'', paddingPx:8,
  },
  footer:{
    enabled:false, heightPx:60, bgColor:'transparent',
    accentColor:'', accentThicknessPx:2, accentPos:'top',
    borderStyle:'none', borderColor:'', paddingPx:8,
  },
  // Single template-wide flag — when on, every block tagged with zone
  // 'header' or 'footer' is treated as locked regardless of its own
  // .locked property. Lets users freeze the chrome with one click while
  // still editing body blocks freely.
  lockZones:false,
};

// Returns true if a block should be treated as locked right now.
// Inputs collapse to one effective state:
//   1. Per-block .locked flag — user explicitly locked this block.
//   2. cvTplCfg.lockZones + b.zone tag — set by auto-setup / dropped
//      into the header/footer zone with an explicit tag.
//   3. cvTplCfg.lockZones + position — anything whose midpoint sits
//      inside the configured header/footer band height counts, even
//      if the zone .enabled flag isn't on (so users who place a page
//      number / footer line by hand without ever ticking the Footer
//      checkbox still get them locked when Lock header & footer is on).
// All drag / resize / keyboard-move gates and the on-canvas lock icon
// read through this so the locking mechanisms can't drift.
function _cvIsBlockLocked(b){
  if(!b) return false;
  if(b.locked) return true;
  if(cvTplCfg && cvTplCfg.lockZones){
    if(b.zone === 'header' || b.zone === 'footer') return true;
    // Position fallback — uses the configured band heights regardless
    // of header/footer.enabled. Default 100px header / 60px footer if
    // not configured. Blocks straddling are assigned by midpoint.
    const midY = (+b.y || 0) + (+b.h || 0) / 2;
    const hH = (cvTplCfg.header && +cvTplCfg.header.heightPx) || 100;
    const fH = (cvTplCfg.footer && +cvTplCfg.footer.heightPx) || 60;
    if(midY < hH) return true;
    if(midY > CV_PAGE_HEIGHT_PX - fH) return true;
  }
  return false;
}

// ── Sample data ──────────────────────────────────────────────────────
var CV_SAMPLE = {
  base: {
    reportNo:'SV-2023-004-NDTD-REP-023-001', revision:'00',
    client:'Offshore Structures BV', project:'Platform Alpha — Leg Inspection',
    location:'Fabrication yard — Rotterdam', svOrder:'SV-2023-004',
    orderNo:'PO-98271', requestNo:'REQ-2023-045', clientRef:'OSB-2023-PR-012',
    examDate:'2025-03-15',
    subject:'Main leg splice weld — Node L4', drawing:'OSB-DWG-4420-B',
    subjectNo:'L4-SP-007', weldProcess:'FCAW / SAW',
    welders:'J. Bakker, M. de Vries', material:'S355J2G3',
    weldType:'V-groove', heatTreat:'PWHT',
    dimensions:'Ø323.9 × 32mm', surfCond:'Blasted',
    surfTemp:'18°C', weldPos:'PA',
    partExam:'100% of weld seam incl. HAZ — 1200mm total length',
    examType:'Weld surface examination', extent:'100% Weld and HAZ',
    spec:'EN-ISO 17638:2016', accCrit:'EN-ISO 23278:2016 Level 2',
    proc:'SV2023-004-NDTD-PRO-0009', procRev:'01', stage:'Final',
    equip:'Magnaflux Y-7 AC Yoke', eqSvId:'SV-MT-002', eqCalDate:'2025-01-10',
    whitelight:'15', uvirr:'1200',
    inspector:'Carl Cope', level:'MT Level II',
    certAuth:'PCN:319222', indications:'No / Nee', witness:'Client representative',
    repDate:'2025-03-15', signDate:'2025-03-15',
    remarks:'Examination performed in accordance with the approved procedure. No recordable indications were detected. The weld is accepted.',
  },
  methodData: {
    UT:  {coup:'Waterbased', freq:'5 MHz', range:'0-100mm', probe:'Single crystal angle beam 70°', sens:'DAC + Transfer + 6dB', refblk:'K1 IIW 1', calblk:'EN-ISO 17640 32mm'},
    MT:  {tech:'Yoke (AC)', mtmethod:'Wet fluorescent', syscontrol:'> 4,5 kg + ASTM Pie', demag:'Yes', curint:'2-3 Ampere', cur:'AC', susp:'Magnaflux 7HF', suspBatch:'24A-0815', susptype:'Fluorescent water-based', contrast:'Not used', whitelight:'15', uvirr:'1200'},
    VT:  {lux:'500', magn:'×2', dist:'600 mm max', vtequip:'Welding gauge set'},
    PT:  {pen:'Magnaflux ZL4C', pdwell:'15 mins', ddwell:'10-20 mins', clean:'Magnaflux SKC-S', dev:'Magnaflux SKD-S2', whitelight:'15', uvirr:'1200'},
    PMI: {ctrl:'316L Reference block', mode:'Alloy ID', pmiequip:'X-MET 8000 Expert'},
    HT:  {scale:'HV10', method:'UCI', htequip:'Mic 10'},
    RT:  {source:'Ir-192', film:'D7 / Kodak AA400', iqitype:'Wire type EN 462-1', sfd:'700 mm'},
    ET:  {freq:'100 kHz', coil:'Absolute pencil probe', ref:'1.0mm EDM notch'},
  },
  defects: [
    { type:'Linear indication', sev:'High', loc:'250mm from datum', depth:'3.2', len:'12', disp:'Repair required' },
    { type:'Surface porosity', sev:'Low',  loc:'680mm from datum', depth:'—', len:'4', disp:'Accept as-is' },
  ],
  // Sample examination-details rows — shown in the items-table block when
  // the editor is in Preview mode and no real report / form data is on
  // hand, so the layout designer can judge column spacing against
  // realistic content instead of an empty row.
  items: [
    { subject:'Main leg splice weld — Node L4', drawing:'OSB-DWG-4420-B', dimensions:'Ø323.9 × 32mm', material:'S355J2G3', weldType:'V-prep',  weldProcess:'FCAW', welders:'J. Bakker',   examDate:'2025-03-15', extent:'100% Weld and HAZ',        verdict:'Acceptable' },
    { subject:'Brace-to-chord weld — Node K2', drawing:'OSB-DWG-4418-A', dimensions:'Ø219.1 × 20mm', material:'S355J2G3', weldType:'½V-prep', weldProcess:'SMAW', welders:'M. de Vries', examDate:'2025-03-15', extent:'100% of the given weld',   verdict:'Not acceptable' },
    { subject:'Stiffener fillet weld — Bay 3', drawing:'OSB-DWG-4421-C', dimensions:'12mm fillet',    material:'S355J2G3', weldType:'Fillet',  weldProcess:'SAW',  welders:'J. Bakker',   examDate:'2025-03-16', extent:'100% Surface examination', verdict:'Acceptable' },
  ]
};

function cvBuildReport(method, result, showDefects){
  // V3: If a real report ID is selected, use that report's actual data
  if(cvPpvReportId){
    const reports = ls(KEYS.reports, []);
    const real = reports.find(r => (r.reportNo === cvPpvReportId || r.id === cvPpvReportId));
    if(real){
      const b = Object.assign({}, CV_SAMPLE.base, real);
      // Ensure verdict mirrors result + flags
      b.method = real.method || method;
      b.result = real.verdict === 'Acceptable' ? 'Pass' : real.verdict === 'Not acceptable' ? 'Fail' : (real.verdict || result);
      b.verdict = real.verdict || (result==='Pass'?'Acceptable':result==='Fail'?'Not acceptable':result);
      b.id = b.reportNo || real.reportNo;
      // Defects from store, filtered to this report
      const allDef = ls(KEYS.defects, []);
      b.defects = allDef.filter(d => d.reportNo === b.reportNo || d.reportId === real.id);
      if(!b.defects.length && showDefects) b.defects = CV_SAMPLE.defects.slice(0, 1); // give designer at least one row
      // Method-specific
      b.methodData = CV_SAMPLE.methodData[b.method] || {};
      // Maintain alias compatibility
      b.eq_spec = b.eq_spec||b.spec; b.eq_acc = b.eq_acc||b.accCrit; b.eq_proc = b.eq_proc||b.proc;
      b.eq_equip = b.eq_equip||b.equip; b.eq_svid = b.eq_svid||b.eqSvId; b.eq_caldate = b.eq_caldate||b.eqCalDate;
      b.signDate = b.signDate||b.repDate||b.examDate;
      b.level = b.level || (b.method+' Level II');
      return b;
    }
  }
  // Fallback: synthetic sample data
  const b = Object.assign({}, CV_SAMPLE.base);
  // Overlay the live "next report number" from Settings → Numbering so the
  // report-no place card in design / preview mode shows what the next saved
  // report will actually be labelled, instead of the static "SV-2023-004-…"
  // sample. Only applied when the user has configured numbering (else keeps
  // the existing sample). Same algorithm as dashboard.js ovBuildReport.
  try {
    const s = (typeof ls === 'function' && typeof KEYS !== 'undefined') ? ls(KEYS.settings, {}) : {};
    if(s && (s.numPrefix || s.numSep != null || s.numYear || s.numDigits || s.numNext || s.numMethodPos)){
      const prefix    = (s.numPrefix || 'INS');
      const sep       = (s.numSep != null) ? s.numSep : '-';
      const yrDigits  = parseInt(s.numYear || '4', 10);
      const digits    = parseInt(s.numDigits || '3', 10);
      const next      = parseInt(s.numNext || '1', 10);
      const methodPos = s.numMethodPos || 'none';
      const yr  = yrDigits === 4 ? new Date().getFullYear() : yrDigits === 2 ? String(new Date().getFullYear()).slice(-2) : '';
      const seq = String(next).padStart(digits, '0');
      const m   = (method || cvPpvMethod || '').toUpperCase();
      const parts = [prefix];
      if(methodPos === 'after-prefix' && m) parts.push(m);
      if(yr) parts.push(yr);
      if(methodPos === 'after-year' && m) parts.push(m);
      parts.push(seq);
      b.reportNo = parts.filter(Boolean).join(sep);
    }
  } catch(e){ /* keep sample reportNo */ }
  b.method = method; b.result = result;
  b.id = b.reportNo;
  b.verdict = result==='Pass'?'Acceptable':result==='Fail'?'Not acceptable':result;
  b.defects = showDefects ? CV_SAMPLE.defects : [];
  b.level = method + ' Level II';
  b.signDate = b.repDate || b.examDate;
  if(result !== 'Pass') b.indications = 'Yes / Ja';
  b.eq_spec = b.spec; b.eq_acc = b.accCrit; b.eq_proc = b.proc;
  b.eq_equip = b.equip; b.eq_svid = b.eqSvId; b.eq_caldate = b.eqCalDate;
  b.methodData = CV_SAMPLE.methodData[method] || {};
  return b;
}

// ════════════════════════════════════════════════════════════════════
// V3 ENGINE: Conditional visibility, format, computed, components, i18n
// ════════════════════════════════════════════════════════════════════

var cvPpvReportId = null;       // null = sample data, else report.reportNo
var cvPpvLanguage = 'en';        // en, nl, de, fr
var cvComponents = [];           // user-saved components: [{id, name, blocks:[...]}]
var cvCrossRefMap = {};          // populated during render: { 'defect-3': 'page 4' }

var CV_LANG_LABELS = {
  en: { method:'NDT Method', client:'Client', project:'Project', subject:'Subject', inspector:'Inspector', report_no:'Report No.', revision:'Revision', exam_date:'Examination date', sign_date:'Date signed', spec:'Specification', acc_crit:'Acceptance criteria', procedure:'Procedure no.', equipment:'Equipment', material:'Material', remarks:'Remarks', result:'Result', acceptable:'ACCEPTABLE', not_acceptable:'NOT ACCEPTABLE', monitor:'MONITOR', defects:'Defects', page:'Page', of:'of' },
  nl: { method:'NDO-methode', client:'Opdrachtgever', project:'Project', subject:'Onderwerp', inspector:'Inspecteur', report_no:'Rapportnr.', revision:'Revisie', exam_date:'Onderzoeksdatum', sign_date:'Datum ondertekend', spec:'Specificatie', acc_crit:'Acceptatiecriterium', procedure:'Procedurenr.', equipment:'Apparatuur', material:'Materiaal', remarks:'Opmerkingen', result:'Resultaat', acceptable:'AANVAARDBAAR', not_acceptable:'NIET AANVAARDBAAR', monitor:'BEWAKEN', defects:'Indicaties', page:'Pagina', of:'van' },
  de: { method:'ZfP-Verfahren', client:'Auftraggeber', project:'Projekt', subject:'Gegenstand', inspector:'Prüfer', report_no:'Berichtsnr.', revision:'Revision', exam_date:'Prüfdatum', sign_date:'Unterschriftsdatum', spec:'Spezifikation', acc_crit:'Abnahmekriterium', procedure:'Verfahrensnr.', equipment:'Prüfgerät', material:'Werkstoff', remarks:'Bemerkungen', result:'Ergebnis', acceptable:'ANNEHMBAR', not_acceptable:'NICHT ANNEHMBAR', monitor:'ÜBERWACHEN', defects:'Anzeigen', page:'Seite', of:'von' },
  fr: { method:'Méthode CND', client:'Client', project:'Projet', subject:'Objet', inspector:'Inspecteur', report_no:'N° de rapport', revision:'Révision', exam_date:'Date d\'examen', sign_date:'Date de signature', spec:'Spécification', acc_crit:'Critère d\'acceptation', procedure:'N° de procédure', equipment:'Équipement', material:'Matériau', remarks:'Remarques', result:'Résultat', acceptable:'ACCEPTABLE', not_acceptable:'NON ACCEPTABLE', monitor:'À SURVEILLER', defects:'Indications', page:'Page', of:'sur' },
};

// Format a value with a format string; { date | DD-MMM-YYYY }, { num | 0.00 }, { upper }
function cvFormatValue(value, format){
  if(value == null || value === '') return '';
  if(!format) return value;
  // Date formats
  const dateMatch = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(dateMatch && /[YMD]/.test(format)){
    const d = new Date(value);
    if(isNaN(d)) return value;
    const pad=n=>String(n).padStart(2,'0');
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthsFull=['January','February','March','April','May','June','July','August','September','October','November','December'];
    return format
      .replace(/YYYY/g, d.getFullYear())
      .replace(/YY/g, String(d.getFullYear()).slice(-2))
      .replace(/MMMM/g, monthsFull[d.getMonth()])
      .replace(/MMM/g, months[d.getMonth()])
      .replace(/MM/g, pad(d.getMonth()+1))
      .replace(/DD/g, pad(d.getDate()));
  }
  // Number formats
  if(!isNaN(parseFloat(value)) && /[#0]/.test(format)){
    const n = parseFloat(value);
    const decimals = (format.split('.')[1] || '').length;
    return n.toFixed(decimals);
  }
  // Case formats
  if(format === 'upper') return String(value).toUpperCase();
  if(format === 'lower') return String(value).toLowerCase();
  if(format === 'title') return String(value).replace(/\w\S*/g, w => w.charAt(0).toUpperCase()+w.substr(1).toLowerCase());
  return value;
}

// Evaluate conditional show-when rule against report data
function cvEvalShowWhen(block, report){
  if(!block.showWhen || !block.showWhen.field) return true;  // no rule = always show
  if(!report) return true;
  const { field, op, value } = block.showWhen;
  let actual;
  if(field === 'defectCount') actual = (report.defects||[]).length;
  else if(field === 'verdict') actual = report.verdict;
  else if(field === 'method') actual = report.method;
  else actual = report[field];
  const a = String(actual ?? '').toLowerCase();
  const v = String(value ?? '').toLowerCase();
  switch(op){
    case '=':       return a === v;
    case '!=':      return a !== v;
    case 'contains':return a.includes(v);
    case '>':       return parseFloat(actual) > parseFloat(value);
    case '<':       return parseFloat(actual) < parseFloat(value);
    case '>=':      return parseFloat(actual) >= parseFloat(value);
    case '<=':      return parseFloat(actual) <= parseFloat(value);
    case 'empty':   return !actual || actual === '' || actual === '—';
    case 'notEmpty':return !!actual && actual !== '' && actual !== '—';
    default:        return true;
  }
}

// Resolve smart-link content for procedure/cert/calib/accept-eval
// The Veritix shield, drawn inline. Inline fill/stroke (no dependency on
// the .vx-shield stylesheet) so it renders identically in the editor and
// in printed / exported PDFs. `mark` picks the interior glyph: a tick for
// a valid state, a cross for an invalid one, a dash for neutral.
function _cvShieldSvg(lineColor, bodyFill, mark){
  const inner = mark === 'cross'
    ? `<path d="M19 25 L33 39 M33 25 L19 39" fill="none" stroke="${lineColor}" stroke-width="5" stroke-linecap="round"/>`
    : mark === 'dash'
    ? `<path d="M18 31 L34 31" fill="none" stroke="${lineColor}" stroke-width="5" stroke-linecap="round"/>`
    : `<path d="M17 30 L24 38 L36 22" fill="none" stroke="${lineColor}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg width="21" height="24" viewBox="0 0 52 60" style="display:block">`
    + `<path d="M26 2 L50 14 L50 36 Q50 52 26 58 Q2 52 2 36 L2 14 Z" fill="${bodyFill}" stroke="${lineColor}" stroke-width="2.5"/>`
    + inner + `</svg>`;
}
// Smart-card body — a Veritix-shield status indicator plus one or more
// text lines. The status is read from the lbl's leading glyph: ✓ → valid
// (green shield + tick, "valid" caption), ⚠ / ✕ → not valid (red shield +
// cross, "not valid" caption), anything else → neutral (grey shield). The
// descriptive reason for a failure lives in the detail lines. The first
// line is the name (bold); the rest are detail. Each line's pieces sit
// inline when the card is wide and wrap when it is narrow (flex-wrap).
function _cvSmartCardHtml(lbl, ...lines){
  const row = (pieces, style) => {
    const spans = (pieces || [])
      .filter(p => p != null && String(p).trim() !== '')
      .map(p => `<span>${escapeHtml(String(p))}</span>`).join('');
    return spans ? `<div style="display:flex;flex-wrap:wrap;column-gap:5px;word-break:break-word;${style}">${spans}</div>` : '';
  };
  const body = lines.map((ln, i) =>
    row(ln, i === 0 ? 'font-weight:600;font-size:9px' : 'font-size:8px;color:#666')
  ).join('');
  let lc, fill, mark, caption;
  if(/^✓/.test(lbl)){
    lc = '#16a34a'; fill = 'rgba(62,207,142,.18)'; mark = 'check'; caption = 'valid';
  } else if(/^[⚠✕✗]/.test(lbl)){
    lc = '#b91c1c'; fill = 'rgba(242,92,92,.16)'; mark = 'cross'; caption = 'not valid';
  } else {
    lc = '#8a8f98'; fill = 'rgba(160,160,160,.16)'; mark = 'dash';
    caption = String(lbl || '').replace(/^\W+/u, '').toLowerCase() || '—';
  }
  return `<div style="display:flex;align-items:center;gap:8px;height:100%">
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0;width:48px">
      ${_cvShieldSvg(lc, fill, mark)}
      <span style="font-size:7px;font-weight:700;letter-spacing:.2px;color:${lc};text-align:center;line-height:1.1">${escapeHtml(caption)}</span>
    </div>
    <div style="flex:1;min-width:0;line-height:1.3">${body}</div>
  </div>`;
}

// ── Light / UV-light equipment smart cards ─────────────────────────────
// White-light meters and UV-A lamps are calibrated gear like any other,
// so these cards reuse the calib-status status logic. Resolution is by
// the equipment record's Type field, with a name/notes keyword fallback
// for records saved before the Type field existed.
var _CV_UV_RE    = /\buv\b|uv-?a|black\s*-?light|wood'?s\s*lamp|365\s*nm/i;
var _CV_LIGHT_RE = /lux|light\s*meter|white\s*-?light|illuminat|photometer|lumen/i;

// Pick a register record passing matchFn, preferring one approved for the
// report's method — mirrors the calib-status fallback resolution.
function _cvResolveEqByKind(matchFn, reportMethod){
  if(typeof eqLoad !== 'function') return null;
  let all;
  try { all = eqLoad() || []; } catch(e){ return null; }
  const pool = all.filter(matchFn);
  if(!pool.length) return null;
  return (reportMethod && pool.find(e => Array.isArray(e.methods) && e.methods.includes(reportMethod)))
    || pool[0];
}

// Build a calibration status card from a register record. Identical
// checks and styling to the calib-status branch of cvResolveSmartLink:
//   1. Calibration — calDueAt vs today (eqIsExpired)
//   2. Method approval — report's method in the record's `methods` list
function _cvEqKindStatusCard(rec, reportMethod, emptyLbl){
  if(!rec){
    return _cvSmartCardHtml(emptyLbl,
      ['No matching equipment'], ['Add it to Settings → Equipment']);
  }
  const calDue = rec.calDueAt ? new Date(rec.calDueAt) : null;
  const expired = (typeof eqIsExpired === 'function')
    ? eqIsExpired(rec)
    : (calDue && !isNaN(calDue) && new Date() > calDue);
  const approvedForMethod = !reportMethod
    || !Array.isArray(rec.methods) || !rec.methods.length
    || rec.methods.includes(reportMethod);
  let lbl, detail;
  if(expired){
    lbl = '⚠ OUT OF CAL';
    detail = ['Calibration expired ' + fmtDate(calDue)];
  } else if(!approvedForMethod){
    lbl = '⚠ NOT APPROVED';
    detail = ['Not approved for ' + reportMethod, 'approved: ' + ((rec.methods||[]).join(', ') || 'none')];
  } else {
    lbl = '✓ VALID';
    detail = [
      (calDue && !isNaN(calDue)) ? 'In cal to ' + fmtDate(calDue) : 'No calibration-due date set',
      reportMethod ? 'approved for ' + reportMethod : '',
    ];
  }
  return _cvSmartCardHtml(lbl, [rec.name || '—', rec.svId || ''], detail);
}
// Normalise a specification / standard string to a comparison key, so the
// procedure smart card links a report's specification to a registered
// procedure even when the two were typed in different forms. By agreed
// rule the key ignores letter case, all whitespace and punctuation, the
// edition year (":2016", "Ed.2023", a trailing year) and a leading "EN"
// adoption prefix — so "ISO 17638: 2016", "EN-ISO 17638:2018" and
// "EN ISO 17638" all collapse to the same key, "iso17638".
function _cvSpecKey(s){
  let x = String(s || '').toLowerCase().trim();
  if(!x) return '';
  // Drop the edition year where it is anchored to a separator or "Ed.".
  x = x.replace(/[:\-]\s*(?:ed(?:ition)?\.?\s*)?(?:19|20)\d{2}/g, ' ');
  x = x.replace(/\bed(?:ition)?\.?\s*(?:19|20)\d{2}/g, ' ');
  x = x.replace(/\s+(?:19|20)\d{2}\s*$/g, ' ');
  // Reduce to bare alphanumerics, then drop a leading "en" adoption
  // marker so "eniso17638" matches a plain "iso17638".
  x = x.replace(/[^a-z0-9]+/g, '').replace(/^en(?=iso)/, '');
  return x;
}
function cvResolveSmartLink(block, report){
  if(!block || !block.key) return '';
  const k = block.key;
  if(k === 'procedure-link'){
    const procs = (typeof ls === 'function') ? ls(KEYS.procedures, []) : [];
    const reportMeth = report?.method || '';
    const reportRev  = report?.procRev || '';
    // Match against Settings → NDT procedures by NDT method + status —
    // the upload form no longer carries spec / acceptance dropdowns
    // (the uploaded PDF is the source of truth) so the smart card
    // picks the Active procedure registered for this report's method,
    // falling back to the most recent registered procedure for the
    // method when none is currently flagged Active.
    const isActive = p => /^active$/i.test(String(p.status || '').trim());
    const byMethod = procs.filter(p => p.method === reportMeth);
    let match = byMethod.find(isActive) || byMethod[0] || null;
    if(match){
      // Revision is pulled from the linked procedure record on file (its
      // authoritative current revision), falling back to the revision
      // recorded on the report if the record carries none.
      const rev = match.revision || match.rev || reportRev;
      const shownNo = match.procNo || match.procedureNo || match.no || '—';
      // Review date carried on the linked procedure record (Settings →
      // NDT procedures). A procedure past its review date flags the card
      // into the not-valid (red) state — the same treatment the cert /
      // calib cards give an expired certificate.
      const reviewDate = match.reviewDate ? new Date(match.reviewDate) : null;
      const reviewOk   = reviewDate && !isNaN(reviewDate);
      const overdue    = reviewOk && reviewDate < new Date(new Date().toDateString());
      const reviewLine = reviewOk
        ? [(overdue ? 'Review overdue — ' : 'Review: ') + fmtDate(reviewDate)]
        : [];
      return _cvSmartCardHtml(overdue ? '⚠ REVIEW DUE' : '✓ LINKED',
        [shownNo + (rev ? ' Rev ' + rev : '')],
        [match.title || match.standard || match.specification || 'Procedure on file'],
        reviewLine);
    }
    return _cvSmartCardHtml('⚠ MISSING',
      [reportMeth ? (reportMeth + ' procedure') : '—'],
      [reportMeth
        ? ('No ' + reportMeth + ' procedure on file — upload one in Settings → NDT procedures')
        : 'No procedure on file']);
  }
  if(k === 'cert-status'){
    const insp = report?.inspector || '—';
    const list = (typeof INSPECTORS !== 'undefined') ? INSPECTORS : (typeof ls==='function' ? ls('vx-inspectors-v1',[]) : []);
    const match = list.find(i => i.name === insp);
    const reportMethod = report?.method || '';
    if(match){
      // Resolve the inspector's certification FOR THIS REPORT'S METHOD.
      // methodCerts is keyed by method code; legacy records (single
      // inspector-wide cert) are migrated by _inspMethodCerts so old
      // data still resolves. Falls back to the first cert on file if
      // the report has no method set.
      const certs = (typeof _inspMethodCerts === 'function')
        ? _inspMethodCerts(match)
        : (match.methodCerts || {});
      let cert = reportMethod ? certs[reportMethod] : null;
      let methodLabel = reportMethod;
      if(!cert){
        const firstKey = Object.keys(certs)[0];
        if(firstKey){ cert = certs[firstKey]; methodLabel = firstKey; }
      }
      if(cert){
        const expiry = cert.expiry ? new Date(cert.expiry) : null;
        // Expiry is judged against TODAY — the same rule Settings →
        // Inspectors uses (certStatus) — so an expired cert always reads
        // as expired here, regardless of the report's examination date.
        const expired = !!cert.expiry && (typeof certStatus === 'function'
          ? certStatus(cert.expiry) === 'expired'
          : (!!expiry && new Date() > expiry));
        const lvl = cert.level || (methodLabel + ' Level II');
        const certNo = cert.certNo || cert.authority || '—';
        const lbl = expired ? '⚠ EXPIRED' : '✓ VALID';
        // Inspector name on its own line, the cert method/level under
        // it, then the cert no. + expiry (which wrap apart when narrow).
        return _cvSmartCardHtml(lbl,
          [insp],
          [(methodLabel + ' ' + lvl).trim()],
          ['Cert no. ' + certNo, expiry ? 'expires ' + fmtDate(expiry) : '']);
      }
      // Inspector exists but holds no cert for this method.
      return _cvSmartCardHtml('⚠ NOT CERTIFIED',
        [insp], ['No ' + (reportMethod || 'method') + ' certification on file']);
    }
    return _cvSmartCardHtml('— UNKNOWN',
      [insp], ['Inspector not found in directory']);
  }
  if(k === 'eye-cert-status'){
    // Eye-sight test cert smart card (EN-ISO 17637:2016 §6). Resolves
    // in two steps so historical reports stay stable:
    //   1. Prefer the snapshot frozen onto the report at save time
    //      (report.inspectorEyeTest) — captures the cert as it stood
    //      when the report was signed.
    //   2. Fall back to the live inspector record if the report
    //      pre-dates the snapshot field (legacy data) or is being
    //      previewed in the editor without a saved report.
    const insp = report?.inspector || '—';
    let et = report && report.inspectorEyeTest;
    if(!et){
      const list = (typeof INSPECTORS !== 'undefined') ? INSPECTORS : (typeof ls==='function' ? ls('vx-inspectors-v1',[]) : []);
      const match = list.find(i => i.name === insp);
      et = match && match.eyeTest;
    }
    if(et && (et.expiry || et.certNo || et.authority)){
      const expired = !!et.expiry && (typeof certStatus === 'function'
        ? certStatus(et.expiry) === 'expired'
        : (!!new Date(et.expiry) && new Date() > new Date(et.expiry)));
      const lbl = expired ? '⚠ EXPIRED' : '✓ VALID';
      const certNo = et.certNo || et.authority || '—';
      return _cvSmartCardHtml(lbl,
        [insp],
        ['Eye-sight test' + (et.authority ? ' · ' + et.authority : '')],
        ['Cert no. ' + certNo, et.expiry ? 'expires ' + fmtDate(et.expiry) : '']);
    }
    // Inspector found but no eye-test cert recorded.
    if(insp && insp !== '—') return _cvSmartCardHtml('⚠ NO EYE-CERT',
      [insp], ['No eye-sight certificate on file — upload via Settings → Inspectors']);
    return _cvSmartCardHtml('— UNKNOWN',
      ['—'], ['Inspector not set']);
  }
  if(k === 'calib-status'){
    // Calibration validity is judged against today, matching Settings →
    // Equipment (eqIsExpired) — not the report's examination date.
    const now = new Date();
    const reportMethod = report?.method || '';
    // Resolve the equipment: the report's picked item (eq_id) first; if
    // the report carries none, fall back to a representative item from
    // Settings → Equipment approved for this method — so the card pulls
    // real register data in design mode, the way the cert card resolves
    // a sample inspector.
    let rec = _cvEqRecord(report);
    if(!rec && typeof eqLoad === 'function'){
      try {
        // Light meters (white-light / UV-A) have their own dedicated
        // smart cards (light-status / uv-light-status). Exclude them
        // from this card's fallback so a VT report whose register only
        // contains a white-light meter doesn't render it here as the
        // primary NDT equipment.
        const isLightMeter = e => e && (e.type === 'white-light' || e.type === 'uv-light');
        const eqAll = (eqLoad() || []).filter(e => !isLightMeter(e));
        rec = (reportMethod && eqAll.find(e => Array.isArray(e.methods) && e.methods.includes(reportMethod)))
          || eqAll.find(e => !Array.isArray(e.methods) || !e.methods.length)
          || null;
      } catch(e){ rec = null; }
    }
    if(rec){
      // Live equipment record from Settings → Equipment. Two checks,
      // mirroring the inspector cert-status card:
      //   1. Calibration — calDueAt vs the report's exam date
      //   2. Method approval — is the report's method in the
      //      equipment's approved `methods` list?
      const calDue = rec.calDueAt ? new Date(rec.calDueAt) : null;
      const expired = (typeof eqIsExpired === 'function')
        ? eqIsExpired(rec)
        : (calDue && !isNaN(calDue) && now > calDue);
      const approvedForMethod = !reportMethod
        || !Array.isArray(rec.methods) || !rec.methods.length
        || rec.methods.includes(reportMethod);
      let lbl, detail;
      if(expired){
        lbl = '⚠ OUT OF CAL';
        detail = ['Calibration expired ' + fmtDate(calDue)];
      } else if(!approvedForMethod){
        lbl = '⚠ NOT APPROVED';
        detail = ['Not approved for ' + reportMethod, 'approved: ' + ((rec.methods||[]).join(', ') || 'none')];
      } else {
        lbl = '✓ VALID';
        detail = [
          (calDue && !isNaN(calDue)) ? 'In cal to ' + fmtDate(calDue) : 'No calibration-due date set',
          reportMethod ? 'approved for ' + reportMethod : '',
        ];
      }
      // Equipment name and SV-ID as separate pieces so the SV-ID drops
      // onto its own line, and the "approved" piece below the "in cal"
      // piece, when the card is narrow.
      return _cvSmartCardHtml(lbl, [rec.name || '—', rec.svId || ''], detail);
    }
    // Fallback — no register record (legacy report, or equipment that
    // predates the register). Use the snapshot fields; without a record
    // there's no methods list, so the method check is skipped and
    // calibration validity falls back to the "assume 1 year" heuristic.
    const equip = report?.eq_equip || report?.equip || '—';
    const calDate = report?.eq_caldate || report?.eqCalDate;
    let lbl='— NO DATE';
    let detail = ['Calibration record on file'];
    if(calDate){
      const cd = new Date(calDate);
      if(!isNaN(cd)){
        const expiry = new Date(cd); expiry.setFullYear(expiry.getFullYear()+1);
        lbl = now > expiry ? '⚠ EXPIRED' : '✓ VALID';
        detail = ['cal ' + fmtDate(cd), 'expires ' + fmtDate(expiry)];
      }
    }
    return _cvSmartCardHtml(lbl, [equip], detail);
  }
  if(k === 'calib-status-2'){
    // Secondary equipment card — resolves from report.eq_id_secondary
    // (set by ovSaveReport for any useEquipmentRegister field flagged
    // secondary:true). Mirrors calib-status structure so designers
    // can mix and match the two cards on the PDF.
    const now = new Date();
    const reportMethod = report?.method || '';
    let rec = null;
    if(report && report.eq_id_secondary && typeof eqLoad === 'function'){
      try { rec = (eqLoad() || []).find(e => e.id === report.eq_id_secondary) || null; } catch(e){}
    }
    if(!rec && typeof eqLoad === 'function'){
      // Design-mode fallback — pick a representative secondary item so
      // the card renders meaningfully in the editor before a real
      // report is selected. Excludes light meters (they have their
      // own cards) AND the primary eq_id record so the two cards
      // don't resolve to the same gear in preview.
      try {
        const isLightMeter = e => e && (e.type === 'white-light' || e.type === 'uv-light');
        const primaryId = report && report.eq_id;
        const eqAll = (eqLoad() || []).filter(e => !isLightMeter(e) && (!primaryId || e.id !== primaryId));
        rec = (reportMethod && eqAll.find(e => Array.isArray(e.methods) && e.methods.includes(reportMethod)))
          || eqAll.find(e => !Array.isArray(e.methods) || !e.methods.length)
          || null;
      } catch(e){ rec = null; }
    }
    if(rec){
      const calDue = rec.calDueAt ? new Date(rec.calDueAt) : null;
      const expired = (typeof eqIsExpired === 'function')
        ? eqIsExpired(rec)
        : (calDue && !isNaN(calDue) && now > calDue);
      const approvedForMethod = !reportMethod
        || !Array.isArray(rec.methods) || !rec.methods.length
        || rec.methods.includes(reportMethod);
      let lbl, detail;
      if(expired){
        lbl = '⚠ OUT OF CAL';
        detail = ['Calibration expired ' + fmtDate(calDue)];
      } else if(!approvedForMethod){
        lbl = '⚠ NOT APPROVED';
        detail = ['Not approved for ' + reportMethod, 'approved: ' + ((rec.methods||[]).join(', ') || 'none')];
      } else {
        lbl = '✓ VALID';
        detail = [
          (calDue && !isNaN(calDue)) ? 'In cal to ' + fmtDate(calDue) : 'No calibration-due date set',
          reportMethod ? 'approved for ' + reportMethod : '',
        ];
      }
      return _cvSmartCardHtml(lbl, [rec.name || '—', rec.svId || ''], detail);
    }
    return _cvSmartCardHtml('— NONE',
      ['No 2nd equipment'], ['Pick an Additional equipment in the report form']);
  }
  if(k === 'light-status' || k === 'uv-light-status'){
    // White-light / UV-A light equipment calibration card. Resolves a
    // register record (Settings → Equipment) by its Type field. Records
    // with no Type set (saved before the field existed) fall back to a
    // name/notes keyword match; UV matches are kept out of the
    // white-light pool so a "UV light" record can't resolve as both.
    const reportMethod = report?.method || '';
    const isUv = k === 'uv-light-status';
    // Prefer the light meter the inspector explicitly picked on the
    // report (eq_uvmeter / eq_lightmeter hold the register id); fall back
    // to resolving one by register Type when nothing was picked.
    let rec = null;
    const pickedId = report && (isUv ? report.eq_uvmeter : report.eq_lightmeter);
    if(pickedId && typeof eqLoad === 'function'){
      try { rec = (eqLoad() || []).find(e => e.id === pickedId) || null; } catch(e){}
    }
    if(!rec) rec = _cvResolveEqByKind(e => {
      if(e.type === 'uv-light')    return isUv;
      if(e.type === 'white-light') return !isUv;
      if(e.type === 'general')     return false;
      // Untyped legacy record — fall back to the name/notes keyword.
      const s = (e.name || '') + ' ' + (e.notes || '');
      return isUv ? _CV_UV_RE.test(s) : (_CV_LIGHT_RE.test(s) && !_CV_UV_RE.test(s));
    }, reportMethod);
    return _cvEqKindStatusCard(rec, reportMethod, isUv ? '— NO UV METER' : '— NO LIGHT METER');
  }
  if(k === 'light-conditions'){
    // Combined examination light & UV conditions — the white-light, UV-A
    // and background-light readings captured on a VT / MT / PT report.
    // VT / MT / PT all record white light as eq_whitelight now; the
    // legacy eq_lux fallback keeps older VT reports rendering.
    const wl = report?.eq_whitelight || report?.whitelight || report?.eq_lux || report?.lux || '';
    const uv = report?.eq_uvirr || report?.uvirr || '';
    // White light gates UV-A: at or below 20 lux the exam is fluorescent
    // (UV-A applies); above 20 lux it is a visible white-light inspection,
    // so UV-A reads "Not applicable".
    const wlNum = parseFloat(wl);
    const fluorescent = wl !== '' && !isNaN(wlNum) && wlNum <= 20;
    // Flag an applicable UV-A reading below the 1000 µW/cm² minimum — the
    // badge turns red and the line notes the shortfall.
    const uvNum = parseFloat(uv);
    const uvLow = fluorescent && uv !== '' && !isNaN(uvNum) && uvNum < 1000;
    const lines = [];
    if(wl) lines.push(['White light', wl + ' lux']);
    if(fluorescent){
      lines.push(['UV-A', uv !== '' ? (uv + ' µW/cm²' + (uvLow ? ' — below 1000 min' : '')) : 'not recorded']);
    } else if(wl){
      lines.push(['UV-A', 'Not applicable']);
    }
    if(!lines.length){
      return _cvSmartCardHtml('💡 LIGHT / UV',
        ['No light/UV readings'], ['Recorded on VT / MT / PT reports']);
    }
    return _cvSmartCardHtml(uvLow ? '⚠ UV-A LOW' : '💡 LIGHT / UV', ...lines);
  }
  if(k === 'accept-eval'){
    // If block has measurement+criterion props, evaluate
    const meas = parseFloat(block.measurement);
    const crit = parseFloat(block.criterion);
    const unit = block.unit || 'mm';
    const std  = block.standard || (report?.eq_acc || report?.accCrit || 'acceptance criterion');
    if(!isNaN(meas) && !isNaN(crit)){
      const op = block.evalOp || '<=';
      let pass;
      if(op === '<=') pass = meas <= crit;
      else if(op === '<') pass = meas < crit;
      else if(op === '>=') pass = meas >= crit;
      else if(op === '>') pass = meas > crit;
      else pass = meas <= crit;
      const lbl = pass ? '✓ ACCEPTABLE' : '✕ EXCEEDS LIMIT';
      return _cvSmartCardHtml(lbl,
        [meas + ' ' + unit + ' ' + op + ' ' + crit + ' ' + unit],
        [std]);
    }
    return `<div style="display:flex;align-items:center;gap:6px;height:100%;color:#999;font-size:9px;font-style:italic">Set measurement & criterion in block properties</div>`;
  }
  return '';
}

// Real QR via qrcode-generator library (cdnjs); falls back to deterministic pattern
function cvRenderQR(payload, size){
  size = size || 90;
  payload = String(payload || 'verify');

  // Use real QR library if loaded
  if(typeof window.qrcode === 'function'){
    try {
      // Pick smallest type that fits the payload, error correction M
      const qr = window.qrcode(0, 'M');
      qr.addData(payload);
      qr.make();
      const moduleCount = qr.getModuleCount();
      const margin = 4;
      const cellSize = (size - margin*2) / moduleCount;
      let cells = '';
      for(let r=0; r<moduleCount; r++){
        for(let c=0; c<moduleCount; c++){
          if(qr.isDark(r, c)){
            const x = (margin + c*cellSize).toFixed(2);
            const y = (margin + r*cellSize).toFixed(2);
            cells += `<rect x="${x}" y="${y}" width="${cellSize.toFixed(2)}" height="${cellSize.toFixed(2)}" fill="#000"/>`;
          }
        }
      }
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="display:block;background:#fff" data-qr-payload="${escapeHtml(payload).slice(0,80)}">
        <rect width="${size}" height="${size}" fill="#fff"/>
        ${cells}
      </svg>`;
    } catch(e) {
      console.warn('QR encoding failed, using fallback', e);
    }
  }

  // Fallback: deterministic pattern (visually QR-like, not scannable)
  const hash = (str) => { let h=0; for(let i=0;i<str.length;i++) h = ((h<<5)-h+str.charCodeAt(i))|0; return Math.abs(h); };
  const seed = hash(payload);
  const grid = 21;
  const cellSize = (size - 8) / grid;
  let cells = '';
  const drawMarker = (cx, cy) => {
    cells += `<rect x="${4 + cx*cellSize}" y="${4 + cy*cellSize}" width="${7*cellSize}" height="${7*cellSize}" fill="#000"/>`;
    cells += `<rect x="${4 + (cx+1)*cellSize}" y="${4 + (cy+1)*cellSize}" width="${5*cellSize}" height="${5*cellSize}" fill="#fff"/>`;
    cells += `<rect x="${4 + (cx+2)*cellSize}" y="${4 + (cy+2)*cellSize}" width="${3*cellSize}" height="${3*cellSize}" fill="#000"/>`;
  };
  drawMarker(0,0); drawMarker(grid-7,0); drawMarker(0,grid-7);
  for(let y=0; y<grid; y++){
    for(let x=0; x<grid; x++){
      if((x<8&&y<8)||(x>grid-9&&y<8)||(x<8&&y>grid-9)) continue;
      const v = ((seed>>((x*y)%30))^(x*7+y*13)) & 0x3;
      if(v === 1 || v === 2) cells += `<rect x="${4+x*cellSize}" y="${4+y*cellSize}" width="${cellSize}" height="${cellSize}" fill="#000"/>`;
    }
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="display:block;background:#fff">
    <rect width="${size}" height="${size}" fill="#fff"/>
    ${cells}
    <text x="${size/2}" y="${size-2}" text-anchor="middle" fill="#999" font-size="6" font-family="Arial">preview</text>
  </svg>`;
}

// Build small static weld-map SVG with editable markers in edit mode
function cvRenderWeldMap(block, report){
  const w = block.w, h = block.h;
  const defects = (report?.defects)||[];
  // Use stored markers if present, else infer from defects
  const markers = block.weldMarkers && block.weldMarkers.length
    ? block.weldMarkers
    : defects.map((d,i) => ({x: 0.15+i*0.18, y:0.5, label:'D'+(i+1), defectIdx:i})).slice(0, 6);
  const editMode = !cvPreview;
  let markerHtml = '';
  markers.forEach((m, i) => {
    const px = (m.x||0.5) * w;
    const py = (m.y||0.5) * h;
    const cls = editMode ? 'cv-weldmark' : '';
    const cursor = editMode ? 'cursor:move;' : '';
    markerHtml += `<g class="${cls}" data-marker-idx="${i}" style="${cursor}">
      <circle cx="${px}" cy="${py}" r="9" fill="#f25c5c" stroke="#fff" stroke-width="2"/>
      <text x="${px}" y="${py+3}" text-anchor="middle" fill="#fff" font-size="9" font-weight="bold" font-family="Arial" style="user-select:none;pointer-events:none">${escapeHtml(m.label||'D'+(i+1))}</text>
    </g>`;
  });
  const editHint = editMode
    ? `<text x="${w/2}" y="${h-4}" text-anchor="middle" fill="#888" font-size="7" font-family="Arial">Click to add · Drag to move · Right-click to remove</text>`
    : `<text x="${w-4}" y="${h-6}" text-anchor="end" fill="#aaa" font-size="7" font-family="Arial">${markers.length} indication${markers.length!==1?'s':''}</text>`;
  return `<svg class="cv-weldmap-svg" data-block-id="${block.id}" width="100%" height="100%" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="background:#f8f8f8;display:block">
    <rect x="2" y="2" width="${w-4}" height="${h-4}" fill="#fff" stroke="#ccc" stroke-width="1" stroke-dasharray="4,2"/>
    <text x="${w/2}" y="14" text-anchor="middle" fill="#888" font-size="8" font-family="Arial">WELD / DEFECT MAP</text>
    <line x1="20" y1="${h/2}" x2="${w-20}" y2="${h/2}" stroke="#888" stroke-width="2" stroke-dasharray="3,2"/>
    <line x1="20" y1="${h/2-15}" x2="${w-20}" y2="${h/2-15}" stroke="#aaa" stroke-width="0.5"/>
    <line x1="20" y1="${h/2+15}" x2="${w-20}" y2="${h/2+15}" stroke="#aaa" stroke-width="0.5"/>
    ${markerHtml}
    ${editHint}
  </svg>`;
}

// Weld map marker editing: handle click on map (place new marker)
async function cvWeldMapClick(blockId, evt){
  const block = cvBlocks.find(b => b.id === blockId);
  if(!block || cvPreview) return;
  // Resolve click coords to relative 0–1
  const svg = evt.target.closest('svg.cv-weldmap-svg');
  if(!svg) return;
  const rect = svg.getBoundingClientRect();
  const relX = Math.max(0, Math.min(1, (evt.clientX - rect.left) / rect.width));
  const relY = Math.max(0, Math.min(1, (evt.clientY - rect.top)  / rect.height));
  // Don't add when clicking an existing marker (handled separately)
  if(evt.target.closest('.cv-weldmark')) return;
  if(!block.weldMarkers) block.weldMarkers = [];
  const label = await vxPrompt({ message: t('pe.weld.marker_label','Marker label:'), defaultValue: 'D'+(block.weldMarkers.length+1) });
  if(label === null) return;
  cvPushUndo();
  block.weldMarkers.push({ x: relX, y: relY, label: label.trim() || 'D'+(block.weldMarkers.length+1) });
  cvSaveLayout();
  cvRenderCanvas();
  cvRenderProps(blockId);
}

// Right-click to remove a marker
function cvWeldMapMarkerRemove(blockId, idx){
  const block = cvBlocks.find(b => b.id === blockId);
  if(!block || !block.weldMarkers) return;
  cvPushUndo();
  block.weldMarkers.splice(idx, 1);
  cvSaveLayout();
  cvRenderCanvas();
  cvRenderProps(blockId);
}

// Drag a marker to a new position
var _cvWeldDrag = null;
function cvWeldMapMarkerDragStart(blockId, idx, evt){
  if(cvPreview) return;
  evt.stopPropagation();
  evt.preventDefault();
  const svg = evt.target.closest('svg.cv-weldmap-svg');
  _cvWeldDrag = { blockId, idx, svg };
  document.addEventListener('mousemove', _cvWeldDragMove);
  document.addEventListener('mouseup', _cvWeldDragEnd, { once: true });
}
function _cvWeldDragMove(evt){
  if(!_cvWeldDrag) return;
  const { blockId, idx, svg } = _cvWeldDrag;
  const block = cvBlocks.find(b => b.id === blockId);
  if(!block || !block.weldMarkers || !block.weldMarkers[idx]) return;
  const rect = svg.getBoundingClientRect();
  block.weldMarkers[idx].x = Math.max(0.02, Math.min(0.98, (evt.clientX - rect.left) / rect.width));
  block.weldMarkers[idx].y = Math.max(0.05, Math.min(0.95, (evt.clientY - rect.top)  / rect.height));
  cvRenderCanvas();
}
function _cvWeldDragEnd(){
  document.removeEventListener('mousemove', _cvWeldDragMove);
  if(_cvWeldDrag){
    cvSaveLayout();
    cvRenderProps(_cvWeldDrag.blockId);
  }
  _cvWeldDrag = null;
}

// Render the repeating defect rows
function cvRenderDefectLoop(block, report){
  const defs = (report?.defects) || [];
  if(!defs.length){
    return `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:9px;color:#999;font-style:italic;border:1px dashed #ddd">↻ No defects to repeat (template row preview)</div>`;
  }
  const rowHeight = 28;
  let html = `<div style="height:100%;overflow:visible">
    <div style="display:grid;grid-template-columns:30px 1fr 80px 60px 90px 90px;gap:0;background:#374151;color:#fff;font-size:8.5px;font-weight:600;padding:5px 6px">
      <div>#</div><div>Description</div><div>Type</div><div>Sev.</div><div>Location</div><div>Acceptance</div>
    </div>`;
  defs.forEach((d,i)=>{
    const accCls = d.acceptance==='Accept'?'#16a34a':d.acceptance==='Reject'?'#991b1b':'#666';
    html += `<div style="display:grid;grid-template-columns:30px 1fr 80px 60px 90px 90px;gap:0;border-bottom:1px solid #eee;padding:3px 6px;font-size:8.5px;background:${i%2?'#f9fafb':'#fff'};min-height:${rowHeight}px;align-items:center">
      <div style="font-family:monospace;font-weight:600">D${i+1}</div>
      <div>${escapeHtml(d.description||d.desc||'—')}</div>
      <div>${escapeHtml(d.type||'—')}</div>
      <div style="color:${d.severity==='Critical'?'#991b1b':d.severity==='High'?'#c2410c':d.severity==='Medium'?'#92400e':'#16a34a'}">${escapeHtml(d.severity||'—')}</div>
      <div style="font-family:monospace;font-size:8px">${escapeHtml(d.location||'—')}</div>
      <div style="color:${accCls};font-weight:600">${escapeHtml(d.acceptance||'—')}</div>
    </div>`;
  });
  html += `</div>`;
  return html;
}

// ── COMPONENTS LIBRARY ────────────────────────────────────────────
var CV_COMP_KEY = 'vx-canvas-components-v1';
function cvLoadComponents(){ cvComponents = ls(CV_COMP_KEY, []); }
function cvSaveComponents(){ lss(CV_COMP_KEY, cvComponents); }
async function cvSaveAsComponent(){
  if(!cvSelectedIds.length){ toast(t('toast.select_blocks_first','Select one or more blocks first.'), 'warn'); return; }
  const name = await vxPrompt({ message: t('pe.comp.name_prompt','Component name:'), defaultValue: 'My component '+(cvComponents.length+1) });
  if(!name || !name.trim()) return;
  // Find bounding origin
  const blocks = cvSelectedIds.map(id => cvBlocks.find(b=>b.id===id)).filter(Boolean);
  if(!blocks.length) return;
  const minX = Math.min(...blocks.map(b=>b.x));
  const minY = Math.min(...blocks.map(b=>b.y));
  const comp = {
    id: 'comp-' + Date.now(),
    name: name.trim(),
    blocks: blocks.map(b => {
      const c = JSON.parse(JSON.stringify(b));
      c.x -= minX; c.y -= minY;  // normalize to origin
      delete c.id;  // will be regenerated on insert
      return c;
    })
  };
  cvComponents.push(comp);
  cvSaveComponents();
  cvRenderPalette('');
  toast(`Component "${name}" saved`, 'success');
}
function cvInsertComponent(compId, x, y){
  const comp = cvComponents.find(c => c.id === compId);
  if(!comp) return;
  cvPushUndo();
  x = x ?? 20;
  y = y ?? cvBlocks.reduce((m,b)=>Math.max(m,b.y+b.h+4), 20);
  const newIds = [];
  (comp.blocks || []).forEach(srcBlock => {
    const nb = JSON.parse(JSON.stringify(srcBlock));
    nb.id = _cvBlockId();
    nb.x += x; nb.y += y;
    nb.zIndex = cvBlocks.length+1;
    cvBlocks.push(nb);
    newIds.push(nb.id);
  });
  cvSelectedIds = newIds;
  cvSelectedId = newIds[0] || null;
  cvRenderCanvas(); cvRenderProps(cvSelectedId); cvSaveLayout();
  toast(`"${escapeHtml(comp.name)}" inserted`, 'success');
}
async function cvDeleteComponent(compId){
  if(!await vxConfirm({ message: 'Are you sure you want to delete this component? Existing instances on the canvas will not be affected.', okLabel: t('vxc.delete','Delete'), danger: true })) return;
  cvComponents = cvComponents.filter(c => c.id !== compId);
  cvSaveComponents();
  cvRenderPalette('');
}

// ── COMMENTS ──────────────────────────────────────────────────────
async function cvAddCommentToBlock(blockId){
  const block = cvBlocks.find(b => b.id === blockId);
  if(!block) return;
  const text = await vxPrompt({ message: t('pe.comment.prompt','Comment:'), inputType: 'textarea', placeholder: t('pe.comment.placeholder','Write your comment…') });
  if(!text || !text.trim()) return;
  if(!block.comments) block.comments = [];
  const author = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) ? CURRENT_USER.name : 'Anonymous';
  block.comments.push({ author, text: text.trim(), timestamp: Date.now(), resolved: false });
  cvSaveLayout();
  cvRenderCanvas();
  cvRenderProps(blockId);
  toast(t('toast.comment_added', 'Comment added'), 'success');
}
function cvResolveComment(blockId, idx){
  const block = cvBlocks.find(b => b.id === blockId);
  if(!block || !block.comments) return;
  block.comments[idx].resolved = !block.comments[idx].resolved;
  cvSaveLayout();
  cvRenderCanvas();
  cvRenderProps(blockId);
}
function cvDeleteComment(blockId, idx){
  const block = cvBlocks.find(b => b.id === blockId);
  if(!block || !block.comments) return;
  block.comments.splice(idx, 1);
  cvSaveLayout();
  cvRenderCanvas();
  cvRenderProps(blockId);
}
function cvAllComments(){
  const out = [];
  cvPages.forEach((page, pidx) => {
    (page.blocks || []).forEach(b => {
      (b.comments||[]).forEach((c, ci) => {
        out.push({ ...c, blockId: b.id, blockText: b.text || b.key, pageIdx: pidx, commentIdx: ci });
      });
    });
  });
  return out;
}

// ── FIND & REPLACE ────────────────────────────────────────────────
function cvFindReplace(findStr, replaceStr, replaceAll){
  if(!findStr) return 0;
  let count = 0;
  const fields = ['text'];
  cvPages.forEach(page => {
    page.blocks.forEach(b => {
      fields.forEach(f => {
        if(b[f] && typeof b[f] === 'string' && b[f].includes(findStr)){
          const newVal = replaceAll
            ? b[f].split(findStr).join(replaceStr)
            : b[f].replace(findStr, replaceStr);
          if(newVal !== b[f]){ b[f] = newVal; count++; }
        }
      });
    });
  });
  if(count){ cvSaveLayout(); cvRenderCanvas(); }
  return count;
}

// ── VERSION HISTORY ───────────────────────────────────────────────
var CV_HISTORY_KEY = 'vx-canvas-history-v1';
var CV_HISTORY_MAX = 20;
function cvSaveSnapshot(label){
  const list = ls(CV_HISTORY_KEY, []);
  list.push({
    timestamp: Date.now(),
    label: label || ('Snapshot ' + new Date().toLocaleString()),
    pages: JSON.parse(JSON.stringify(cvPages)),
    user: (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) ? CURRENT_USER.name : 'Anonymous',
  });
  while(list.length > CV_HISTORY_MAX) list.shift();
  lss(CV_HISTORY_KEY, list);
}
async function cvLoadSnapshot(timestamp){
  const list = ls(CV_HISTORY_KEY, []);
  const snap = list.find(s => s.timestamp === timestamp);
  if(!snap) return;
  if(!await vxConfirm({ message: 'Are you sure you want to revert to this version? Any unsaved changes you have made will be lost.', okLabel: t('vxc.revert','Revert'), danger: true })) return;
  cvPushUndo();
  cvPages = JSON.parse(JSON.stringify(snap.pages));
  cvCurrentPage = 0; cvSync();
  cvSelectedId=null; cvSelectedIds=[];
  cvRenderPageTabs(); cvRenderCanvas(); cvRenderProps(null); cvSaveLayout();
  toast(tf('toast.reverted_to','Reverted to {label}', {label: snap.label}), 'success');
}

// Auto-snapshot — throttled so we don't spam history
var _cvLastAutoSnap = 0;
var CV_AUTOSNAP_MIN_INTERVAL = 5 * 60 * 1000;  // 5 minutes
function cvAutoSnapshot(label){
  const now = Date.now();
  if(now - _cvLastAutoSnap < CV_AUTOSNAP_MIN_INTERVAL && !label) return;
  _cvLastAutoSnap = now;
  cvSaveSnapshot(label || 'Auto-snapshot');
}

// ── Page management ──────────────────────────────────────────────────
function cvAddPage(){
  const label = 'Page '+(cvPages.length+1);
  cvPages.push({label, blocks:[]});
  cvCurrentPage = cvPages.length-1;
  cvSync(); cvSelectedId=null; cvSelectedIds=[];
  cvRenderPageTabs(); cvRenderCanvas(); cvRenderProps(null); cvSaveLayout();
  toast(tf('toast.added_label','Added {label}', {label}));
}
// Duplicate the current page — an easy way to base an extra page (e.g. a
// table-continuation page) on page 1. Blocks are deep-copied with fresh
// ids so the copy and the original never share a block id.
function cvDuplicatePage(){
  const src = cvPages[cvCurrentPage];
  if(!src) return;
  cvPushUndo();
  const blocks = (src.blocks || []).map(b => {
    const c = JSON.parse(JSON.stringify(b));
    c.id = _cvBlockId();
    return c;
  });
  const label = 'Page ' + (cvPages.length + 1);
  cvPages.splice(cvCurrentPage + 1, 0, { label: label, blocks: blocks });
  cvCurrentPage = cvCurrentPage + 1;
  cvSync(); cvSelectedId = null; cvSelectedIds = [];
  cvRenderPageTabs(); cvRenderCanvas(); cvRenderProps(null); cvSaveLayout();
  toast('Page duplicated as ' + label + ' — use ✎ on the tab to rename it.');
}
function cvSwitchPage(idx){
  if(idx<0||idx>=cvPages.length) return;
  cvCurrentPage=idx; cvSync(); cvSelectedId=null; cvSelectedIds=[];
  // Reset the click-to-add anchor — the last-placed id is page-scoped,
  // so a click on the new page should start a fresh column.
  _cvLastPlacedId = null;
  cvRenderPageTabs(); cvRenderCanvas(); cvRenderProps(null);
}
async function cvDeletePage(idx){
  if(cvPages.length<=1){ toast(t('toast.cant_delete_only_page', 'Cannot delete the only page')); return; }
  if(!await vxConfirm({ message: `Are you sure you want to delete "${cvPages[idx].label}"?`, okLabel: t('vxc.delete','Delete'), danger: true })) return;
  cvPushUndo();
  cvPages.splice(idx,1);
  if(cvCurrentPage>=cvPages.length) cvCurrentPage=cvPages.length-1;
  cvSync(); cvSelectedId=null; cvSelectedIds=[];
  cvRenderPageTabs(); cvRenderCanvas(); cvRenderProps(null); cvSaveLayout();
}
async function cvRenamePage(idx){
  const name = await vxPrompt({ message: t('pe.page.rename_prompt','Page name:'), defaultValue: cvPages[idx].label });
  if(name&&name.trim()){ cvPages[idx].label=name.trim(); cvRenderPageTabs(); cvSaveLayout(); }
}
function cvRenderPageTabs(){
  const bar=document.getElementById('cv-page-tabs');
  if(!bar) return;
  bar.innerHTML = cvPages.map((p,i)=>{
    const active=i===cvCurrentPage?'active':'';
    const rename=`<span class="pg-close" data-action="cvRenamePage" data-args="${i}" data-stop-prop="1" title="Rename page">✎</span>`;
    const close=cvPages.length>1?`<span class="pg-close" data-action="cvDeletePage" data-args="${i}" data-stop-prop="1" title="Delete page">✕</span>`:'';
    return `<button class="canvas-page-tab ${active}" data-action="cvSwitchPage" data-args="${i}" title="${escapeHtml(p.label||'')}">${escapeHtml(p.label||'')}${rename}${close}</button>`;
  }).join('')
    + `<button class="canvas-page-add" data-action="cvDuplicatePage" title="Duplicate current page">⧉</button>`
    + `<button class="canvas-page-add" data-action="cvAddPage" title="Add blank page">+</button>`;
}

// ── Init ──────────────────────────────────────────────────────────────
function cvInitCanvas(){
  cvLoadTplConfig();    // pull persisted tplLogo/logoPos/etc before rendering
  cvLoadLayout();
  cvLoadComponents();   // V3: load saved components
  cvSync();
  cvRenderPageTabs();
  cvRenderPalette('');
  cvRenderCanvas();
  cvFitToView();
  cvRenderMethodBtns();
  cvUpdateStatusBar();
  cvUpdateLogoThumb();  // reflect persisted tplLogo in the ribbon thumb
  cvRenderLogoLib();    // populate the saved-logo library
  _cvRefreshUndoRedoUI();  // page-tabs-bar arrows start disabled at boot
  _cvSyncSnapButton();     // reflect persisted snap-to-grid state
  _cvSyncGridOverlay();    // hide the grid overlay when snap is off
  setTimeout(() => cvRefreshPreviewSource(), 50);   // V3: populate report dropdown
  // Auto-adopt the most recent saved report for the active method as
  // the preview source so the canvas opens with real values, not
  // synthetic sample data. Honours an existing pick (e.g. one the user
  // had set in a prior session and that gets restored) — only kicks in
  // when no source is currently set.
  setTimeout(() => { if(!cvPpvReportId) _cvAutoPickPreviewSource(cvPpvMethod); cvRenderCanvas(); }, 80);
  // V25: reflect saved alignment-guides toggle state on the button
  const alignBtn = document.getElementById('cv-align-toggle');
  if(alignBtn){
    alignBtn.classList.toggle('active', _cvAlignGuidesOn);
    if(_cvAlignGuidesOn){
      alignBtn.style.background = 'rgba(79,142,247,.15)';
      alignBtn.style.color      = 'var(--blue)';
    }
  }
  // V25: prime autosave indicator
  if(_cvLastSaveTime === 0) _cvLastSaveTime = Date.now();  // treat load as initial save baseline
  _cvRefreshSaveIndicator();
  // V29: sync the header/footer Design ribbon checkboxes + height inputs
  // to persisted cvTplCfg state. Without this, a user who enabled the
  // header in a previous session would see un-checked checkboxes on next
  // open even though the header is actually enabled.
  _cvSyncHeaderFooterUI();
}

// ── Palette ──────────────────────────────────────────────────────────
function cvGetLayoutIcon(k){
  if(k && k.startsWith('logo-lib:')) return '🖼';
  return {'section-header':'▬','text-block':'T','h-line':'—','logo-co':'🖼',
    'photo-box':'📷','photo-page':'📸','single-photo':'🖼','single-drawing':'📐','drawing-page':'📐','photo-details':'📝','additional-page':'📄','defect-table':'⊟','items-table':'☷','revision-history':'↻','method-block':'⚙',
    'accent-bar':'█'}[k]||'□';
}

// V24: helper resolves a translated label for palette items.
// Convention: layout item with key 'section-header' → t('pe.lay.section-header', it.label)
//             field def with key 'report-no'         → t('cv.fld.report-no', def.label)
//             palette group id 'identity'            → t('pe.group.identity', grp.label)
//             group 'advanced' maps to 'advanced_out' key (name collision with ribbon group)
var _CV_GROUP_KEY_MAP = { 'advanced': 'pe.group.advanced_out' };
function _cvLayoutLabel(it){
  // Library-derived items already carry the user-supplied name in `label`
  // and have no fixed i18n key, so skip the lookup for them.
  if(it.key && it.key.startsWith('logo-lib:')) return it.label;
  return t('pe.lay.' + it.key, it.label);
}

// Returns the static layout items plus a virtual item per saved-logo
// library entry. Each library entry becomes its own draggable palette card
// keyed `logo-lib:<id>` so the canvas block remembers which logo it holds.
function _cvAllLayoutItems(){
  const lib = (typeof cvLogoLibLoad === 'function') ? cvLogoLibLoad() : [];
  const libItems = lib.map(e => ({
    key:   'logo-lib:' + e.id,
    label: (e.name || 'Logo'),
    w: 140, h: 56,
    isLogoLibCard: true,
  }));
  return CV_LAYOUT_ITEMS.concat(libItems);
}
function _cvFieldLabel(fk, def){ return t('cv.fld.' + fk, def.label); }
function _cvGroupLabel(grp){ return t(_CV_GROUP_KEY_MAP[grp.id] || ('pe.group.' + grp.id), grp.label); }

// AUDIT-FIX #4: Map a field definition to its palette badge + colour. The
// classification rule used to be inlined identically at two callsites in
// cvRenderPalette (the search-results renderer and the grouped-palette
// renderer). Categories are mutually exclusive and checked in priority
// order — a field that is both `smartLink` and `computed` (which shouldn't
// happen but the data is user-extensible) shows as smart-link. Returns an
// object so callers can spread it into a template literal cleanly.
//
//   ⚡ smart link  — purple, live-bound to a settings value
//   ∑ computed    — teal,   derived/calculated at render time
//   ★ advanced    — amber,  QR, weld map, scan image, defect-repeat, xref
//   f field       — blue,   default — pulls from the report record
function _cvFieldBadge(def){
  if(def.smartLink)  return { badge:'⚡', badgeStyle:'background:rgba(167,139,250,.15);color:#a78bfa' };
  if(def.computed)   return { badge:'∑', badgeStyle:'background:rgba(20,184,166,.15);color:#14b8a6' };
  if(def.qr || def.weldMap || def.scanImg || def.repeat || def.xref)
                     return { badge:'★', badgeStyle:'background:rgba(245,166,35,.15);color:var(--amber)' };
  return                    { badge:'f', badgeStyle:'background:rgba(79,142,247,.15);color:var(--blue)' };
}

function cvRenderPalette(filter){
  const body = document.getElementById('cv-palette-body');
  if(!body) return;
  const q = filter.toLowerCase().trim();
  let html = '';

  // V23: Recently-used group at top (only when not filtering, and only if
  // there are entries). Single row per entry, same UX as other fields.
  if(!q){
    const recents = _cvLoadRecent();
    if(recents.length){
      const collapsed = cvPaletteCollapsed['recent'];
      const recentLabel = t('pe.palette.recently_used', '⏱ Recently used');
      html += `<div>
        <div data-action="_wCvTogglePaletteGroup" data-args="'recent'" class="cv-pal-group-hdr">
          <span style="font-size:9px;font-family:var(--mono);color:var(--cyan);text-transform:uppercase;letter-spacing:.08em">${escapeHtml(recentLabel)} (${recents.length})</span>
          <svg style="width:9px;height:9px;opacity:.5;transition:transform .15s;${collapsed?'transform:rotate(-90deg)':''}" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div style="${collapsed?'display:none':''}">`;
      const allLayout = _cvAllLayoutItems();
      recents.forEach(r => {
        if(r.isLayout){
          const it = allLayout.find(x => x.key === r.key);
          if(!it) return;
          const lbl = _cvLayoutLabel(it);
          html += `<div class="palette-item" draggable="true" data-on-dragstart="cvPaletteDragStart" data-pass-event="1" data-args="'${it.key}',true" data-action="cvAddBlockDefault" data-args="'${it.key}',true" title="${escapeHtml(lbl)}\nClick = stack below previous\nShift+Click = chain to the right">
            <span style="font-size:13px;width:16px;text-align:center;flex-shrink:0;opacity:.65">${cvGetLayoutIcon(it.key)}</span><span>${escapeHtml(lbl)}</span>
          </div>`;
        } else {
          const def = CV_FIELD_DEFS[r.key]; if(!def) return;
          const lbl = _cvFieldLabel(r.key, def);
          const short = lbl.split(' / ')[0].split(' ').slice(0,4).join(' ');
          const { badge, badgeStyle } = _cvFieldBadge(def);
          html += `<div class="palette-item" draggable="true" data-on-dragstart="cvPaletteDragStart" data-pass-event="1" data-args="'${r.key}',false" data-action="cvAddBlockDefault" data-args="'${r.key}',false" title="${escapeHtml(lbl)}${def.mapTo?'\nField: '+def.mapTo:''}\nClick = stack below previous\nShift+Click = chain to the right">
            <span style="font-size:8.5px;font-family:var(--mono);${badgeStyle};padding:1px 4px;border-radius:3px;flex-shrink:0">${badge}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(short)}</span>
          </div>`;
        }
      });
      html += `</div></div>`;
    }
  }

  CV_PALETTE_GROUPS.forEach(grp => {
    let items;
    if(grp.isLayout){
      items = _cvAllLayoutItems().filter(it => !q || _cvLayoutLabel(it).toLowerCase().includes(q) || it.key.includes(q));
    } else if(grp.isComponents){
      items = (cvComponents || []).filter(c => !q || c.name.toLowerCase().includes(q));
    } else {
      items = (grp.fields || []).filter(fk => {
        const d = CV_FIELD_DEFS[fk];
        return !q || fk.includes(q) || (d && _cvFieldLabel(fk, d).toLowerCase().includes(q));
      });
    }
    if(!items.length && !grp.isComponents) return;
    const collapsed = cvPaletteCollapsed[grp.id];
    const grpLabel = _cvGroupLabel(grp);
    html += `<div>
      <div data-action="_wCvTogglePaletteGroup" data-args="'${grp.id}'" class="cv-pal-group-hdr">
        <span style="font-size:9px;font-family:var(--mono);color:var(--t3);text-transform:uppercase;letter-spacing:.08em">${escapeHtml(grpLabel)}${grp.isComponents?' ('+items.length+')':''}</span>
        <svg style="width:9px;height:9px;opacity:.5;transition:transform .15s;${collapsed?'transform:rotate(-90deg)':''}" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div style="${collapsed?'display:none':''}">`;
    if(grp.isComponents){
      // Add "Save selection as component" CTA
      html += `<div data-action="cvSaveAsComponent" style="padding:6px 10px;font-size:10px;color:var(--cyan);cursor:pointer;border-bottom:1px solid var(--border);background:rgba(0,212,255,.04);display:flex;align-items:center;gap:6px">
        <span style="background:rgba(0,212,255,.18);color:var(--cyan);width:16px;height:16px;border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold">+</span>
        <span>${escapeHtml(t('pe.palette.save_as_comp','Save selection as component'))}</span>
      </div>`;
      if(!items.length){
        html += `<div style="padding:14px 10px;font-size:10px;color:var(--t3);text-align:center;font-style:italic;line-height:1.5">${escapeHtml(t('pe.palette.no_components','No components yet.\nSelect 1+ blocks and click\n"Save as component"')).replace(/\n/g,'<br>')}</div>`;
      } else {
        items.forEach(comp => {
          html += `<div class="palette-item" draggable="true" data-on-dragstart="cvPaletteDragStart" data-pass-event="1" data-args="'comp:${comp.id}',false" data-action="cvInsertComponent" data-args="'${comp.id}'" title="Drag or click to insert: ${escapeHtml(comp.name)} (${comp.blocks.length} blocks)">
            <span style="font-size:8.5px;font-family:var(--mono);background:rgba(0,212,255,.15);color:var(--cyan);padding:1px 4px;border-radius:3px;flex-shrink:0">⬢</span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(comp.name)}</span>
            <span style="color:var(--t3);font-size:9px">${comp.blocks.length}</span>
            <button data-action="cvDeleteComponent" data-args="'${comp.id}'" data-stop-prop="1" title="Delete component" style="background:none;border:none;color:var(--red);font-size:10px;cursor:pointer;padding:1px 4px;opacity:.7">✕</button>
          </div>`;
        });
      }
    } else if(grp.isLayout){
      items.forEach(it => {
        const lbl = _cvLayoutLabel(it);
        // Library-derived cards get a × delete button that removes the
        // underlying library entry (and so the card itself). data-stop-prop
        // keeps the click from also firing the row's add-block action.
        const isLibCard = it.key && it.key.startsWith('logo-lib:');
        const libId = isLibCard ? it.key.slice('logo-lib:'.length) : '';
        const removeBtn = isLibCard
          ? `<button data-action="_wCvDeleteLogoLibCard" data-args="'${escapeHtml(libId)}'" data-stop-prop="1" title="${escapeHtml(t('pe.logo_lib.remove','Remove from library'))}" style="background:none;border:none;color:var(--red);font-size:11px;cursor:pointer;padding:1px 4px;opacity:.7;margin-left:auto">✕</button>`
          : '';
        html += `<div class="palette-item" draggable="true" data-on-dragstart="cvPaletteDragStart" data-pass-event="1" data-args="'${it.key}',true" data-action="cvAddBlockDefault" data-args="'${it.key}',true" title="${escapeHtml(lbl)}">
          <span style="font-size:13px;width:16px;text-align:center;flex-shrink:0;opacity:.65">${cvGetLayoutIcon(it.key)}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(lbl)}</span>${removeBtn}
        </div>`;
      });
    } else {
      items.forEach(fk => {
        const def = CV_FIELD_DEFS[fk]; if(!def) return;
        const lbl = _cvFieldLabel(fk, def);
        const short = lbl.split(' / ')[0].split(' ').slice(0,4).join(' ');
        const { badge, badgeStyle } = _cvFieldBadge(def);
        html += `<div class="palette-item" draggable="true" data-on-dragstart="cvPaletteDragStart" data-pass-event="1" data-args="'${fk}',false" data-action="cvAddBlockDefault" data-args="'${fk}',false" title="${escapeHtml(lbl)}${def.mapTo?'\nField: '+def.mapTo:''}">
          <span style="font-size:8.5px;font-family:var(--mono);${badgeStyle};padding:1px 4px;border-radius:3px;flex-shrink:0">${badge}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(short)}</span>
        </div>`;
      });
    }
    html += `</div></div>`;
  });
  body.innerHTML = html || `<div style="padding:16px;font-size:12px;color:var(--t3);text-align:center">${escapeHtml(t('pe.palette.no_match','No fields match'))}</div>`;
}

function cvFilterPalette(q){ cvRenderPalette(q); }

// ── Drag from palette ────────────────────────────────────────────────
// Argument order matches the dispatcher convention: data-args first, then
// the event (because the markup uses `data-pass-event="1"` and the
// dispatcher appends event LAST). Earlier code expected (e, key, isLayout)
// which silently failed — `e.dataTransfer` was `'fld:reportNo'.dataTransfer`,
// a TypeError that the dispatcher catches and logs without recovering, so
// dragging from the palette did nothing.
function cvPaletteDragStart(key, isLayout, e){
  cvPaletteDrag = {key, isLayout};
  if(e && e.dataTransfer){
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', key);
  }
}
function cvDragOver(e){ e.preventDefault(); e.dataTransfer.dropEffect='copy'; }
function cvDrop(e){
  e.preventDefault();
  if(!cvPaletteDrag) return;
  const canvas = document.getElementById('cv-canvas');
  if(!canvas) return;
  const rect = canvas.getBoundingClientRect();
  // FIX: account for zoom correctly using getBoundingClientRect (already scaled)
  let x = cvSnap(Math.max(0,(e.clientX - rect.left) / cvZoom));
  let y = cvSnap(Math.max(0,(e.clientY - rect.top)  / cvZoom));
  // Edge-snap the drop position to neighbouring blocks' edges. Without
  // this, palette drops only honour the grid — they land 1-3px off the
  // neighbour's edge and the borders don't actually touch. Same snap
  // mechanism the drag-move path uses, including the closest-target
  // tie-break and Alt-bypass.
  if(!e.altKey){
    const def = cvPaletteDrag.isLayout
      ? _cvAllLayoutItems().find(it => it.key === cvPaletteDrag.key)
      : CV_FIELD_DEFS[cvPaletteDrag.key];
    const probeW = cvSnap((def && def.w) || 200);
    const probeH = cvSnap((def && def.h) || 38);
    const snaps = cvCalcSnapLines(null, x, y, probeW, probeH);
    const byDelta = (a,b) => Math.abs(a.delta) - Math.abs(b.delta);
    const vSnap = snaps.filter(s => s.axis === 'v').sort(byDelta)[0];
    const hSnap = snaps.filter(s => s.axis === 'h').sort(byDelta)[0];
    if(vSnap){
      if(vSnap.edge === 'l')       x = vSnap.pos;
      else if(vSnap.edge === 'r')  x = vSnap.pos - probeW;
      else if(vSnap.edge === 'cx') x = vSnap.pos - probeW / 2;
    }
    if(hSnap){
      if(hSnap.edge === 't')       y = hSnap.pos;
      else if(hSnap.edge === 'b')  y = hSnap.pos - probeH;
      else if(hSnap.edge === 'cy') y = hSnap.pos - probeH / 2;
    }
    x = Math.max(0, x);
    y = Math.max(0, y);
  }
  // V3: handle component drops
  if(cvPaletteDrag.key && cvPaletteDrag.key.startsWith('comp:')){
    cvInsertComponent(cvPaletteDrag.key.slice(5), x, y);
  } else {
    cvAddBlock(cvPaletteDrag.key, cvPaletteDrag.isLayout, x, y);
  }
  cvPaletteDrag = null;
}
// Tracks the most recent click-to-add block id so successive clicks
// chain into a clean column — each new card sits directly under the
// previous click, inheriting its x / width. Cleared when the block
// is deleted (cvDeleteBlock / cvDeleteSelected) so the chain doesn't
// dangle on a ghost id.
var _cvLastPlacedId = null;

function cvAddBlockDefault(key, isLayout, event){
  // Resolve the block's default width. Layout items go through
  // _cvAllLayoutItems so dynamic items (saved-logo cards) are considered
  // too; field items use CV_FIELD_DEFS. Falls back to 200px when neither
  // lookup hits.
  const def = isLayout ? _cvAllLayoutItems().find(it=>it.key===key) : CV_FIELD_DEFS[key];
  const defaultW = (def && def.w) || 200;
  const defaultH = (def && def.h) || 38;

  // Body-zone bounds — header / footer get filtered out so a populated
  // footer can't push new cards into the footer band, and the header
  // height defines where the body actually starts.
  const bodyTop    = (cvTplCfg.header && cvTplCfg.header.enabled) ? (+cvTplCfg.header.heightPx || 100) : 20;
  const bodyBottom = (cvTplCfg.footer && cvTplCfg.footer.heightPx) ? (CV_PAGE_HEIGHT_PX - (+cvTplCfg.footer.heightPx || 60) - 40) : 1060;

  // Anchor selection — prefer the LAST click-to-added block on this page
  // so successive clicks chain into a column. Falls back to the visually
  // bottom-most body field when there's no recent placement (e.g. first
  // click, deleted anchor, switched pages).
  let anchor = null;
  if(_cvLastPlacedId){
    anchor = cvBlocks.find(b =>
      b.id === _cvLastPlacedId &&
      !b.isLayout &&
      b.zone !== 'header' && b.zone !== 'footer'
    ) || null;
  }
  if(!anchor && !isLayout) anchor = _cvFindStackAnchor();

  // Shift-click chains the new card to the RIGHT of the anchor (Excel-
  // style row build-out) instead of below it. Keeps the same width,
  // touches the previous card's right edge exactly. Without Shift the
  // default vertical-stack behaviour is unchanged.
  const chainRight = !!(event && event.shiftKey && anchor);

  let x, w, y;
  if(anchor){
    // Snap inherited values so a legacy block with non-grid w doesn't
    // pass its misalignment forward.
    if(chainRight){
      x = cvSnap(anchor.x + anchor.w);
      w = cvSnap(anchor.w);
      y = cvSnap(anchor.y);
    } else {
      x = cvSnap(anchor.x);
      w = cvSnap(anchor.w);
      y = cvSnap(anchor.y + anchor.h + 4);
    }
  } else {
    w = cvSnap(defaultW);
    x = cvSnap(Math.max(0, (CV_PAGE_WIDTH_PX - w) / 2));
    y = bodyTop;
  }
  // Keep the new card inside the body band — never let the chain march
  // into the footer.
  if(y > bodyBottom) y = bodyBottom;

  cvAddBlock(key, isLayout, x, y);
  // cvAddBlock seeds w from def — override on the just-pushed block so
  // the new card lines up with the column. cvAddBlock pushes to the end
  // of cvBlocks.
  const newBlock = cvBlocks.length ? cvBlocks[cvBlocks.length - 1] : null;
  if(newBlock && newBlock.key === key){
    if(anchor && w && w !== newBlock.w){
      newBlock.w = w;
      cvRenderCanvas();
      cvSaveLayout();
    }
    // Remember this placement as the next click's anchor. Layout blocks
    // (section headers, accent bars, h-lines) aren't useful anchors
    // because they're full-width — chain only through real field cards.
    if(!isLayout) _cvLastPlacedId = newBlock.id;
  }
}

// The block to align a new click-to-add field below: the visually
// bottommost DATA-FIELD on the page in the body zone. Excluded:
//   • Layout blocks (section-header, accent-bar, h-line, …) — full-
//     width chrome shouldn't force a narrow field to span the page.
//   • zone='header' / 'footer' blocks — different page region.
//   • Non-field decorations (QR codes, weld maps, scan images, photo
//     boxes, signature blocks, the company logo / info block) —
//     these often sit in corners or span wide; anchoring under a
//     bottom-right QR would land the next field crammed against the
//     footer. Identifier: field defs without a `mapTo` are not
//     data-bearing rows and shouldn't anchor the column.
// Returns null when the body has no suitable anchor.
function _cvFindStackAnchor(){
  if(!cvBlocks.length) return null;
  let bottom = null;
  cvBlocks.forEach(b => {
    if(b.isLayout) return;
    if(b.zone === 'header' || b.zone === 'footer') return;
    const def = CV_FIELD_DEFS[b.key];
    // Only anchor on data fields — defs without mapTo are decorations
    // / composites (qr-code, weld-map, photo-box, co-block, co-logo-smart,
    // sig-block, method-block, etc.).
    if(!def || !def.mapTo) return;
    if(!bottom || (b.y + b.h) > (bottom.y + bottom.h)) bottom = b;
  });
  return bottom;
}

// ── Block creation ───────────────────────────────────────────────────
function cvAddBlock(key, isLayout, x, y){
  cvPushUndo();
  const def = isLayout ? _cvAllLayoutItems().find(it=>it.key===key) : CV_FIELD_DEFS[key];
  const id  = _cvBlockId();
  let bgColor='transparent', color='#000', bold=false, showBorder=true, fontSize='8.5px';
  if(isLayout){
    if(key==='section-header'){ bgColor=cvTplCfg.sectionColor||'#404040'; color='#ffffff'; bold=true; showBorder=false; }
    else if(key==='accent-bar'){ bgColor=cvGetCompanyColor(); showBorder=false; }
    else if(key==='h-line'){ showBorder=false; }
    else { showBorder=false; }
  }
  // Snap default width/height to the grid at creation time. Several
  // field defs carry non-grid sizes (part-exam at 380×44, subject at
  // 260×38, …) which left newly placed blocks misaligned with the
  // surrounding column. Layout blocks that span the full page width
  // (754) keep their natural sizing — 754 isn't grid-aligned but the
  // full-width usage is intentional.
  const isFullWidth = def && def.w === 754;
  const defW = def?.w || 160;
  const defH = def?.h || 38;
  const block = {
    id, key, isLayout,
    x: Math.max(0,x), y: Math.max(0,y),
    w: isFullWidth ? defW : cvSnap(defW),
    h: cvSnap(defH),
    // noLabel fields (e.g. method, tpl-number) skip the label row when text
    // is blank — seeding the label as block.text would defeat that and force
    // every drop to render with a "NDT Method:" / "Template no.:" prefix.
    text: (!isLayout && def?.noLabel) ? '' : (isLayout ? (def?.label||key) : (def?.label||key)),
    fontSize, bold, italic:false,
    color, bgColor, borderColor:'#cccccc', showBorder,
    align:'left', zIndex: cvBlocks.length+1,
    locked: false,
  };
  // V29 — assign zone based on drop position. Blocks within the header band
  // get zone='header' and repeat on every page at print. Footer same. Blocks
  // outside both bands get no zone (default = page body, single-page only).
  block.zone = _cvDetectZone(block.y, block.h);
  cvBlocks.push(block);
  // A method-equipment cell dropped inside a container parents to it.
  if(key === 'method-cell') _cvReparentCell(block);
  _cvSelectSingle(id);
  cvRenderCanvas();
  cvRenderProps(id);
  cvSaveLayout();
  cvUpdateStatusBar();
  // V23: track this field in the recently-used palette group
  _cvTrackRecent(key, isLayout);
  // V26: on narrow screens, auto-close the palette drawer once a field has
  // been placed. The drawer's job is done; staying open would obscure the
  // canvas where the user wants to position the new block.
  const palette = document.getElementById('cv-field-palette');
  if(palette && palette.classList.contains('cv-drawer-open')){
    palette.classList.remove('cv-drawer-open');
    _cvUpdateBackdrop();
  }
}

// V23: Recently-used field tracking. Persisted in localStorage so the
// list survives reloads. Bounded at CV_RECENT_MAX entries. When the user
// adds the same field again, it bumps to the top.
var CV_RECENT_KEY = 'vx-canvas-recent-v1';
var CV_RECENT_MAX = 8;

/** Append (key, isLayout) to recents, dedup, persist. Skips component inserts. */
function _cvTrackRecent(key, isLayout){
  if(!key || key.startsWith('comp:')) return;  // components have their own group
  try {
    const raw = localStorage.getItem(CV_RECENT_KEY);
    let list = raw ? JSON.parse(raw) : [];
    if(!Array.isArray(list)) list = [];
    // Remove existing entry (we'll re-add at top)
    list = list.filter(r => !(r.key === key && !!r.isLayout === !!isLayout));
    list.unshift({ key, isLayout: !!isLayout, ts: Date.now() });
    if(list.length > CV_RECENT_MAX) list = list.slice(0, CV_RECENT_MAX);
    try {
    localStorage.setItem(CV_RECENT_KEY, JSON.stringify(list));
    } catch(e){ console.warn("ls setItem failed", e); }
    // Re-render palette so the Recently-used group reflects the change.
    // Use existing search filter if any.
    const searchEl = document.getElementById('cv-palette-search');
    if(searchEl) cvRenderPalette(searchEl.value || '');
  } catch(e){ console.warn('_cvTrackRecent failed', e); }
}

/** Returns the recents list (most-recent-first). */
function _cvLoadRecent(){
  try {
    const raw = localStorage.getItem(CV_RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch(e){ return []; }
}

// ── Smart snap alignment ─────────────────────────────────────────────
function cvCalcSnapLines(dragId, newX, newY, newW, newH){
  const lines = [];
  const edges = { l:newX, r:newX+newW, cx:newX+newW/2, t:newY, b:newY+newH, cy:newY+newH/2 };
  cvBlocks.forEach(b => {
    if(b.id === dragId) return;
    const be = { l:b.x, r:b.x+b.w, cx:b.x+b.w/2, t:b.y, b:b.y+b.h, cy:b.y+b.h/2 };
    // Vertical snap lines (x-axis alignment)
    [['l','l'],['r','r'],['l','r'],['r','l'],['cx','cx']].forEach(([a,c])=>{
      if(Math.abs(edges[a]-be[c]) < CV_SNAP_THRESHOLD) lines.push({axis:'v', pos:be[c], from:Math.min(edges.t,be.t), to:Math.max(edges.b,be.b), delta:be[c]-edges[a], edge:a});
    });
    // Horizontal snap lines (y-axis alignment)
    [['t','t'],['b','b'],['t','b'],['b','t'],['cy','cy']].forEach(([a,c])=>{
      if(Math.abs(edges[a]-be[c]) < CV_SNAP_THRESHOLD) lines.push({axis:'h', pos:be[c], from:Math.min(edges.l,be.l), to:Math.max(edges.r,be.r), delta:be[c]-edges[a], edge:a});
    });
  });
  return lines;
}

function cvDrawSnapLines(lines){
  // Remove old
  document.querySelectorAll('.cv-snap-line').forEach(e=>e.remove());
  const canvas = document.getElementById('cv-canvas');
  if(!canvas) return;
  lines.forEach(ln => {
    const el = document.createElement('div');
    el.className = 'cv-snap-line';
    // Crisp 1px solid guide — a fully-opaque brand-blue line reads as a
    // precise alignment guide; the old translucent line looked smudgy
    // against the faint grid.
    if(ln.axis==='v'){
      el.style.cssText = `position:absolute;left:${ln.pos}px;top:${ln.from}px;width:1px;height:${ln.to-ln.from}px;background:#3b82f6;z-index:9999;pointer-events:none`;
    } else {
      el.style.cssText = `position:absolute;left:${ln.from}px;top:${ln.pos}px;width:${ln.to-ln.from}px;height:1px;background:#3b82f6;z-index:9999;pointer-events:none`;
    }
    canvas.appendChild(el);
  });
}

// V25: persistent alignment guides — shows light dashed lines extending from
// the selected block's edges to any other block whose edge aligns within the
// snap threshold. Unlike cvDrawSnapLines (drag-only, blue solid), these are
// drawn whenever a single block is selected AND the toggle is on. Subtle
// styling (dashed, low opacity) so they don't compete visually with the
// solid snap lines that appear during drag.
var _cvAlignGuidesOn = false;  // persisted in localStorage on toggle

function _cvLoadAlignGuidesPref(){
  try { _cvAlignGuidesOn = localStorage.getItem('vx-cv-align-guides') === '1'; }
  catch(e){}
}
function _cvSaveAlignGuidesPref(){
  try { localStorage.setItem('vx-cv-align-guides', _cvAlignGuidesOn ? '1' : '0'); }
  catch(e){}
}

/** Toggle the persistent alignment guide feature. */
function cvToggleAlignGuides(){
  _cvAlignGuidesOn = !_cvAlignGuidesOn;
  _cvSaveAlignGuidesPref();
  // Update the toolbar button visual
  const btn = document.getElementById('cv-align-toggle');
  if(btn){
    btn.classList.toggle('active', _cvAlignGuidesOn);
    btn.style.background = _cvAlignGuidesOn ? 'rgba(79,142,247,.15)' : '';
    btn.style.color      = _cvAlignGuidesOn ? 'var(--blue)' : '';
  }
  _cvRefreshAlignGuides();
}

/** Compute and draw the persistent guides for the currently-selected single block. */
function _cvRefreshAlignGuides(){
  document.querySelectorAll('.cv-align-guide').forEach(e => e.remove());
  if(!_cvAlignGuidesOn) return;
  if(cvPreview) return;
  if(!cvSelectedId || cvSelectedIds.length !== 1) return;
  const b = cvBlocks.find(bb => bb.id === cvSelectedId);
  if(!b) return;
  const canvas = document.getElementById('cv-canvas');
  if(!canvas) return;

  // Re-use the same edge-comparison logic but accept perfect alignments only
  // (delta === 0, not the snap-threshold tolerance — we're showing what IS
  // aligned, not what's close).
  const edges = { l:b.x, r:b.x+b.w, cx:b.x+b.w/2, t:b.y, b:b.y+b.h, cy:b.y+b.h/2 };
  const guides = [];
  cvBlocks.forEach(other => {
    if(other.id === b.id) return;
    const oe = { l:other.x, r:other.x+other.w, cx:other.x+other.w/2, t:other.y, b:other.y+other.h, cy:other.y+other.h/2 };
    [['l','l'],['r','r'],['l','r'],['r','l'],['cx','cx']].forEach(([a,c])=>{
      if(edges[a] === oe[c]){
        guides.push({ axis:'v', pos: oe[c],
          from: Math.min(edges.t, oe.t),
          to:   Math.max(edges.b, oe.b) });
      }
    });
    [['t','t'],['b','b'],['t','b'],['b','t'],['cy','cy']].forEach(([a,c])=>{
      if(edges[a] === oe[c]){
        guides.push({ axis:'h', pos: oe[c],
          from: Math.min(edges.l, oe.l),
          to:   Math.max(edges.r, oe.r) });
      }
    });
  });

  // Also show alignment to page edges + page centre (very useful for centring)
  const pageW = CV_PAGE_WIDTH_PX, pageH = CV_PAGE_HEIGHT_PX;
  [edges.l, edges.r, edges.cx].forEach(x => {
    if(x === 0 || x === pageW || x === pageW/2){
      guides.push({ axis:'v', pos:x, from:0, to:pageH });
    }
  });
  [edges.t, edges.b, edges.cy].forEach(y => {
    if(y === 0 || y === pageH || y === pageH/2){
      guides.push({ axis:'h', pos:y, from:0, to:pageW });
    }
  });

  guides.forEach(g => {
    const el = document.createElement('div');
    el.className = 'cv-align-guide';
    if(g.axis === 'v'){
      el.style.cssText = `position:absolute;left:${g.pos}px;top:${g.from}px;width:0;height:${g.to-g.from}px;border-left:1px dashed rgba(20,184,166,.5);z-index:9998;pointer-events:none`;
    } else {
      el.style.cssText = `position:absolute;left:${g.from}px;top:${g.pos}px;width:${g.to-g.from}px;height:0;border-top:1px dashed rgba(20,184,166,.5);z-index:9998;pointer-events:none`;
    }
    canvas.appendChild(el);
  });
}

// Load preference at startup
_cvLoadAlignGuidesPref();

// ── Render canvas ────────────────────────────────────────────────────
// V25 — Per-block element cache for keyed reconciliation.
// Each entry: { el: HTMLElement, sig: string }. Signature captures every
// property that affects the rendered output so we can skip rebuilds when
// nothing has changed. Trades a small JSON.stringify cost per block for
// avoiding 130+ lines of DOM construction work per block per render.
//
// Hit rate on a typical session: when the user edits one block's property,
// 49 of 50 blocks short-circuit on signature match, only the edited one
// rebuilds. Equivalent perf to selecting (V23's cvUpdateSelectionUI) but
// extended to the property-edit path.
var _cvBlockElCache = new Map();

// AUDIT-FIX #5: Upsert (create-or-update) the header or footer visualization
// band inside the canvas in design mode. Was two near-identical 12-line
// branches in cvRenderCanvas that differed only by ID, anchor edge, colour,
// translation key, and default height. Consolidating them removes risk that
// a future visual tweak only gets applied to one band.
//
//   zone   — 'header' | 'footer'
//   canvas — the cv-canvas element (passed in to avoid a re-lookup)
//
// When the zone is enabled in cvTplCfg, the band is created if missing and
// its height refreshed from config. When the zone is disabled, the band is
// removed if present. In preview mode the band is always removed because
// printed pages render the header/footer blocks themselves, not the visual
// boundary indicator.
// Pulls chrome styling out of a zone config so design-mode and print-time
// renderers can build the same CSS string. Returns:
//   {
//     bg:           background colour or 'transparent',
//     accentColor:  resolved accent strip colour (falls back to sectionColor),
//     accentThickness, accentPos,
//     borderWidthPx, borderColor, borderEdge ('top'|'bottom')
//   }
function _cvResolveZoneChrome(zone){
  const cfg = cvTplCfg[zone] || {};
  const section = cvTplCfg.sectionColor || '#404040';
  const accentColor = (cfg.accentColor || '').trim() || section;
  const accentThickness = Math.max(0, Math.min(12, +cfg.accentThicknessPx || 0));
  const accentPos = (cfg.accentPos === 'top' || cfg.accentPos === 'bottom') ? cfg.accentPos : 'none';
  const borderColor = (cfg.borderColor || '').trim() || 'rgba(0,0,0,.18)';
  const borderWidthPx = cfg.borderStyle === 'heavy' ? 2 : (cfg.borderStyle === 'thin' ? 1 : 0);
  // Header divides at its bottom; footer divides at its top. The single-edge
  // border keeps prints clean — no full rectangle border, which would clash
  // visually with the page edge on most paper sizes.
  const borderEdge = zone === 'header' ? 'bottom' : 'top';
  return {
    bg: cfg.bgColor || 'transparent',
    accentColor, accentThickness, accentPos,
    borderColor, borderWidthPx, borderEdge,
  };
}

// Build the inline CSS for a chrome layer (background, accent strip, single-
// edge divider border). Used in design-mode band visualisation AND in the
// print pipeline so design and print stay in sync.
function _cvZoneChromeStyle(chrome, zone){
  let css = '';
  if(chrome.bg && chrome.bg !== 'transparent') css += 'background:' + chrome.bg + ';';
  if(chrome.borderWidthPx) css += 'border-' + chrome.borderEdge + ':' + chrome.borderWidthPx + 'px solid ' + chrome.borderColor + ';';
  return css;
}

function _cvUpsertZoneBand(zone, canvas){
  const cfg = cvTplCfg[zone];
  const id = 'cv-' + zone + '-band';
  // Per-zone visual config bundled into one object so the branches don't
  // have to fight over which colour goes where.
  const opts = zone === 'header'
    ? { side:'top:0',    rgb:'79,142,247',  labelAlpha:.8,  bgAlpha:.12, i18nKey:'pe.header.label', fallback:'HEADER — repeats on every page', defaultHeight:100 }
    : { side:'bottom:0', rgb:'245,166,35',  labelAlpha:.95, bgAlpha:.15, i18nKey:'pe.footer.label', fallback:'FOOTER — repeats on every page', defaultHeight:60  };
  let band = document.getElementById(id);
  if(!cvPreview && cfg && cfg.enabled){
    const chrome = _cvResolveZoneChrome(zone);
    if(!band){
      band = document.createElement('div');
      band.id = id;
      band.style.cssText = `position:absolute;left:0;right:0;${opts.side};pointer-events:none;z-index:1;display:flex;align-items:flex-start;justify-content:flex-end;padding:3px 6px;overflow:hidden`;
      const lbl = document.createElement('div');
      lbl.className = 'cv-zone-band-label';
      lbl.style.cssText = `font-size:8px;font-family:var(--mono);color:rgba(${opts.rgb},${opts.labelAlpha});background:rgba(${opts.rgb},${opts.bgAlpha});padding:1px 5px;border-radius:2px;letter-spacing:.05em;position:relative;z-index:2`;
      lbl.textContent = t(opts.i18nKey, opts.fallback);
      band.appendChild(lbl);
      canvas.insertBefore(band, canvas.firstChild?.nextSibling || null);
    }
    // Always restyle — designer changes need to flow live to the band.
    // When the user hasn't set any chrome, fall back to the tinted preview
    // band (semi-transparent fill + dashed edge) so they can still see the
    // boundary.
    const hasChrome = chrome.bg !== 'transparent' || chrome.borderWidthPx > 0 || chrome.accentPos !== 'none';
    if(hasChrome){
      band.style.background = chrome.bg !== 'transparent' ? chrome.bg : 'transparent';
      band.style.borderTop    = '';
      band.style.borderBottom = '';
      if(chrome.borderWidthPx){
        band.style['border' + chrome.borderEdge.charAt(0).toUpperCase() + chrome.borderEdge.slice(1)]
          = chrome.borderWidthPx + 'px solid ' + chrome.borderColor;
      }
    } else {
      // Preview-only band — tinted fill + dashed edge so the user can see
      // where their header/footer lives even without chrome configured.
      band.style.background = `rgba(${opts.rgb},.05)`;
      band.style.borderTop    = '';
      band.style.borderBottom = '';
      band.style['border' + (zone === 'header' ? 'Bottom' : 'Top')] = `1px dashed rgba(${opts.rgb},.4)`;
    }
    // Accent strip — rendered as an absolutely-positioned child so it
    // overlays the band without affecting block-positioning math.
    let strip = band.querySelector('.cv-zone-accent');
    if(chrome.accentPos !== 'none' && chrome.accentThickness > 0){
      if(!strip){
        strip = document.createElement('div');
        strip.className = 'cv-zone-accent';
        strip.style.cssText = 'position:absolute;left:0;right:0;pointer-events:none;z-index:1';
        band.appendChild(strip);
      }
      strip.style.height = chrome.accentThickness + 'px';
      strip.style.background = chrome.accentColor;
      strip.style.top    = chrome.accentPos === 'top'    ? '0' : '';
      strip.style.bottom = chrome.accentPos === 'bottom' ? '0' : '';
    } else if(strip){
      strip.remove();
    }
    band.style.height = (cfg.heightPx || opts.defaultHeight) + 'px';
  } else if(band){
    band.remove();
  }
}

function cvRenderCanvas(){
  const canvas = document.getElementById('cv-canvas');
  if(!canvas) return;
  // Marker class so the CSS card-hover affordance applies only in edit
  // mode — in preview the canvas should read like the printed page.
  canvas.classList.toggle('cv-preview', !!cvPreview);

  // ── Grid overlay management (preserve across renders) ──
  let grid = document.getElementById('cv-grid-overlay');
  if(!cvPreview){
    if(!grid){
      grid = document.createElement('div');
      grid.id = 'cv-grid-overlay';
      // Two-tier graph paper: a faint fine grid at the actual snap
      // resolution (CV_GRID) so it's truthful, plus a slightly stronger
      // line every 8 cells for orientation without visual noise.
      const fine = CV_GRID, major = CV_GRID * 8;
      grid.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:0;background-image:' +
        'linear-gradient(rgba(99,102,241,.045) 1px,transparent 1px),' +
        'linear-gradient(90deg,rgba(99,102,241,.045) 1px,transparent 1px),' +
        'linear-gradient(rgba(99,102,241,.085) 1px,transparent 1px),' +
        'linear-gradient(90deg,rgba(99,102,241,.085) 1px,transparent 1px);' +
        `background-size:${fine}px ${fine}px,${fine}px ${fine}px,${major}px ${major}px,${major}px ${major}px`;
      canvas.insertBefore(grid, canvas.firstChild);
    }
  } else if(grid){
    grid.remove();
  }

  // V29 — Header/footer band visualization in design mode.
  // Two semi-transparent bands above the grid: top = header, bottom = footer.
  // Each band shows a small "HEADER / FOOTER" label so the user knows the
  // boundary. In preview/print they disappear (the blocks inside render
  // normally per-page in the print pipeline).
  // AUDIT-FIX #5: previously two near-identical 12-line branches inlined
  // here; now delegated to _cvUpsertZoneBand so the two zones can't drift.
  _cvUpsertZoneBand('header', canvas);
  _cvUpsertZoneBand('footer', canvas);

  // ── Build report data once for this render pass ──
  // Build whenever a preview source is set OR preview mode is on, so a
  // template designer working in edit mode (and so still able to drag /
  // resize blocks) sees the actual values that will land on their VT /
  // UT / MT report — not synthetic sample placeholders. The smart-card
  // path already had this behaviour; this lifts it to regular fields.
  const report = (cvPreview || cvPpvReportId)
    ? cvBuildReport(cvPpvMethod, cvPpvResult, cvPpvShowDefects)
    : null;
  // AUDIT-FIX #1: use shared helper so editor preview shows the same page
  // labels the printed PDF will show. The old code hardcoded 'page 1' for
  // every defect, which lied to the user.
  cvCrossRefMap = _cvBuildCrossRefMap(report);

  // ── Orphan removal: any cblk-* in DOM not in current cvBlocks ──
  // Handles three cases: blocks deleted, page switched, layout loaded mid-session.
  // Also acts as duplicate cleanup — if a previous render left a stale element
  // with the same id (see cvMouseUp drag handling), the second occurrence is
  // removed here on the next render pass.
  const currentIds = new Set(cvBlocks.map(b => b.id));
  const seenIds = new Set();
  canvas.querySelectorAll('[id^="cblk-"]').forEach(el => {
    const bid = el.id.slice(5);
    if(!currentIds.has(bid)){
      el.remove();
      _cvBlockElCache.delete(bid);
    } else if(seenIds.has(bid)){
      // Duplicate of an element we've already seen. Removing the element is
      // necessary but NOT sufficient — the cache may point to either copy.
      // If it points to the one we just removed, the block render loop below
      // will call `cached.el.replaceWith(newEl)` on a detached element, which
      // silently does nothing. The block then keeps its stale visual state
      // (e.g. unchecking "Show border" appears not to work). Invalidate the
      // cache so the render loop falls through to the stale-querySelector
      // path and replaces the remaining (kept) element correctly.
      el.remove();
      _cvBlockElCache.delete(bid);
    } else {
      seenIds.add(bid);
    }
  });

  // ── Render each block, skipping unchanged ones ──
  const sortedBlocks = [...cvBlocks].sort((a,b)=>(a.zIndex||0)-(b.zIndex||0));
  // Suffix encodes external dependencies of cvRenderBlockContent — in preview
  // mode the rendered content depends on which report we're showing.
  const previewSuffix = cvPreview ? `|p:${cvPpvMethod}|r:${cvPpvResult}|d:${cvPpvShowDefects}` : '|design';

  sortedBlocks.forEach(block => {
    const passesShowWhen = cvEvalShowWhen(block, report);
    if(cvPreview && !passesShowWhen){
      const cached = _cvBlockElCache.get(block.id);
      if(cached){ cached.el.remove(); _cvBlockElCache.delete(block.id); }
      return;
    }
    const isSel = !cvPreview && (cvSelectedId === block.id || cvSelectedIds.includes(block.id));
    // Signature: anything that changes what _cvBuildBlockElement produces.
    // Border-collapse depends on neighbour positions, so fold it in —
    // otherwise a card's collapsed border wouldn't refresh when a
    // *neighbour* moved (the card's own JSON is unchanged).
    const _col = block.showBorder ? _cvBorderCollapse(block) : null;
    // A method-block container's empty-hint depends on how many cells are
    // parented to it — its own JSON doesn't change when a child is added,
    // so fold the child count into the signature (same idea as the
    // border-collapse term above).
    const _kids = block.key === 'method-block'
      ? '|kids:' + cvBlocks.filter(b => b.parentId === block.id).length
      : '';
    const sig = JSON.stringify(block) + '|s:' + isSel + '|h:' + (!passesShowWhen)
      + (_col ? '|bc' + (_col.top?1:0) + (_col.left?1:0) : '') + _kids + previewSuffix;

    const cached = _cvBlockElCache.get(block.id);
    if(cached && cached.sig === sig){
      return;   // unchanged
    }

    const newEl = _cvBuildBlockElement(block, report, isSel, passesShowWhen);
    if(cached && cached.el.isConnected){
      // Cached element is still in the DOM — safe to replace in place.
      cached.el.replaceWith(newEl);
    } else {
      // Cache miss OR cached element was detached (e.g. by the duplicate
      // cleanup above, or by external code). Either way, look for a stale
      // element in the DOM with this block's id and replace it; otherwise
      // it's a genuinely new block and we append. Without the isConnected
      // check, a stale-detached cached.el would silently fail replaceWith
      // (no-op on detached node) and the block would never render — so
      // e.g. unchecking "Show border" would appear not to work.
      const stale = canvas.querySelector('#cblk-' + block.id);
      if(stale) stale.replaceWith(newEl);
      else      canvas.appendChild(newEl);
    }
    _cvBlockElCache.set(block.id, { el: newEl, sig });
  });

  // ── Empty state hint (idempotent) ──
  let emptyHint = canvas.querySelector('#cv-empty-hint');
  if(!cvBlocks.length && !cvPreview){
    if(!emptyHint){
      emptyHint = document.createElement('div');
      emptyHint.id = 'cv-empty-hint';
      emptyHint.style.cssText='position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;pointer-events:none;font-family:Arial,Helvetica,sans-serif;text-align:center;padding:0 32px';
      emptyHint.innerHTML=`<svg width="44" height="44" viewBox="0 0 48 48" fill="none"><rect x="4" y="4" width="40" height="40" rx="5" stroke="#d2d6dd" stroke-width="2" stroke-dasharray="6 4"/><path d="M24 16v16M16 24h16" stroke="#c2c7cf" stroke-width="2.5" stroke-linecap="round"/></svg>
        <div style="font-size:14px;font-weight:600;color:#9aa0aa">This page is empty</div>
        <div style="font-size:12px;color:#b4b9c2;line-height:1.5;max-width:300px">Drag fields from the palette on the left to build the report, or duplicate an existing page with the ⧉ button.</div>`;
      canvas.appendChild(emptyHint);
    }
  } else if(emptyHint){
    emptyHint.remove();
  }

  cvApplyZoom();
  const defLbl = document.getElementById('cv-ppv-defect-label');
  if(defLbl) defLbl.textContent = cvPpvShowDefects ? '− Defects' : '+ Defects';
  cvUpdateStatusBar();

  // Weld-map wiring: only attach to SVGs without listeners (data-wm-attached
  // flag prevents double-binding when reconciliation skips existing blocks).
  if(!cvPreview){
    canvas.querySelectorAll('svg.cv-weldmap-svg:not([data-wm-attached])').forEach(svg => {
      svg.setAttribute('data-wm-attached', '1');
      const blockId = svg.dataset.blockId;
      svg.addEventListener('click', evt => {
        evt.stopPropagation();
        cvWeldMapClick(blockId, evt);
      });
      svg.querySelectorAll('.cv-weldmark').forEach(g => {
        const idx = parseInt(g.dataset.markerIdx);
        g.addEventListener('mousedown', evt => cvWeldMapMarkerDragStart(blockId, idx, evt));
        g.addEventListener('contextmenu', async evt => {
          evt.preventDefault();
          if(await vxConfirm({ message: 'Are you sure you want to remove this marker?', okLabel: t('vxc.remove','Remove'), danger: true })) cvWeldMapMarkerRemove(blockId, idx);
        });
      });
    });
  }
}

// Border-collapse detection. Returns { top, left } — true means that
// side's border should be SUPPRESSED because a bordered block sits
// flush against it. The rule (always draw right/bottom, drop top/left
// when a neighbour is flush) means exactly one of any two touching
// blocks draws the shared edge — a single hairline, not a doubled one.
// O(n) per block; n is small (a page's blocks).
function _cvBorderCollapse(block){
  const TOL = 1.5;                       // px slack for "flush"
  const bx = +block.x||0, by = +block.y||0, bw = +block.w||0, bh = +block.h||0;
  let supTop = false, supLeft = false;
  for(let i = 0; i < cvBlocks.length; i++){
    const o = cvBlocks[i];
    if(!o || o.id === block.id || o.showBorder === false) continue;
    const ox = +o.x||0, oy = +o.y||0, ow = +o.w||0, oh = +o.h||0;
    // Need a real overlap along the *other* axis to count as flush.
    const vOv = Math.min(by+bh, oy+oh) - Math.max(by, oy);
    const hOv = Math.min(bx+bw, ox+ow) - Math.max(bx, ox);
    if(!supLeft && vOv > 2 && Math.abs((ox+ow) - bx) <= TOL) supLeft = true;
    if(!supTop  && hOv > 2 && Math.abs((oy+oh) - by) <= TOL) supTop  = true;
    if(supTop && supLeft) break;
  }
  return { top: supTop, left: supLeft };
}

// V25 — Build a single block's DOM element. Extracted from cvRenderCanvas so
// reconciliation can call it on demand. All side effects (event listener
// attachments, badge/FAB appends) are scoped to the returned element.
function _cvBuildBlockElement(block, report, isSel, passesShowWhen){
  const elDiv = document.createElement('div');
  elDiv.id = 'cblk-'+block.id;
  elDiv.className = 'cv-block';
  elDiv.dataset.blockId = block.id;
  const isLocked = _cvIsBlockLocked(block);
  const isHidden = !cvPreview && !passesShowWhen;
  const hasComments = block.comments && block.comments.some(c => !c.resolved);

  // V24 accessibility
  if(!cvPreview){
    const fieldDef = block.isLayout
      ? _cvAllLayoutItems().find(x => x.key === block.key)
      : CV_FIELD_DEFS[block.key];
    const baseLbl = fieldDef
      ? (block.isLayout ? _cvLayoutLabel(fieldDef) : _cvFieldLabel(block.key, fieldDef))
      : (block.text || block.key || 'Block');
    const lockedSuffix = isLocked ? ', ' + t('pe.prop.locked', 'Locked').toLowerCase() : '';
    elDiv.setAttribute('role', 'button');
    elDiv.setAttribute('tabindex', '0');
    elDiv.setAttribute('aria-label', baseLbl + lockedSuffix +
      ' (' + Math.round(block.x) + ', ' + Math.round(block.y) + ')');
    if(isSel) elDiv.setAttribute('aria-selected', 'true');
  }

  // SECURITY: block.bgColor/borderColor/fontSize/color/align are user-editable
  // (properties panel + imported template JSON). They're being assigned to
  // style.cssText which the browser CSS-parses, so the worst case is CSS
  // injection rather than JS XSS — but a value like `transparent; position:
  // fixed; top:0; left:0; width:100vw; height:100vh; z-index:99999` could
  // still overlay the whole editor. Whitelist each value to its valid shape.
  const _safeCssColor = (v, fb) => (typeof v === 'string' && /^(?:#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\)|transparent)$/.test(v.trim())) ? v.trim() : fb;
  const _safeCssFs = (v, fb) => (typeof v === 'string' && /^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/.test(v.trim())) ? v.trim() : fb;
  const _safeCssAlign = (v) => (v === 'center' || v === 'right' || v === 'left' || v === 'justify') ? v : 'left';
  const _bg = _safeCssColor(block.bgColor, 'transparent');
  const _bc = _safeCssColor(block.borderColor, '#ccc');
  const _fc = _safeCssColor(block.color, '#000');
  const _fs = _safeCssFs(block.fontSize, '8.5px');
  const _ff = (block.fontFamily && CV_FONTS[block.fontFamily]) ? CV_FONTS[block.fontFamily] : '';
  const _td = [block.underline?'underline':'', block.strike?'line-through':''].filter(Boolean).join(' ');
  const _ta = _safeCssAlign(block.align);
  const _zi = Number.isFinite(+block.zIndex) ? +block.zIndex : 1;

  // Border uses the real `border` property (visible at 100% zoom,
  // survives print). Collapsed seams: a bordered card flush against a
  // neighbour drops its TOP/LEFT border so only the neighbour's
  // BOTTOM/RIGHT border draws the shared edge — a single 0.5px line
  // instead of two stacked into 1px. Free edges keep the full border.
  let _borderCss = 'border:none';
  if(block.showBorder){
    const w = `0.5px solid ${_bc}`;
    const col = (typeof _cvBorderCollapse === 'function') ? _cvBorderCollapse(block) : { top:false, left:false };
    _borderCss = `border-top:${col.top?'none':w};border-right:${w};border-bottom:${w};border-left:${col.left?'none':w}`;
  }

  // Selection / hidden-state rings — box-shadow so they never collide
  // with the cell border. The selection ring shows for ANY selected
  // block, border or not: it's editor chrome (a 2px blue/amber glow),
  // visually distinct from a 0.5px hairline print border, so it can't
  // be mistaken for "the border is still on". Composed into one
  // declaration since a repeated box-shadow property overrides.
  const shadows = [];
  if(isSel) {
    shadows.push(`0 0 0 2px ${isLocked?'#f5a623':'#4f8ef7'}`);
    shadows.push(`0 0 12px 2px ${isLocked?'rgba(245,166,35,.35)':'rgba(79,142,247,.35)'}`);
  }
  if(isHidden) {
    shadows.push(`0 0 0 1.5px #a78bfa`);
  }
  const shadowDecl = shadows.length ? `box-shadow:${shadows.join(',')}` : '';

  elDiv.style.cssText = [
    `position:absolute`,
    `left:${+block.x||0}px`, `top:${+block.y||0}px`,
    `width:${+block.w||0}px`, `height:${+block.h||0}px`,
    `background:${_bg}`,
    _borderCss,
    `font-size:${_fs}`,
    _ff ? `font-family:${_ff}` : '',
    `font-weight:${block.bold?'bold':'normal'}`,
    `font-style:${block.italic?'italic':'normal'}`,
    _td ? `text-decoration:${_td}` : '',
    `color:${_fc}`,
    `text-align:${_ta}`,
    `box-sizing:border-box`, `overflow:hidden`,
    `cursor:${cvPreview?'default':isLocked?'not-allowed':'move'}`,
    `z-index:${_zi}`,
    `user-select:none`,
    shadowDecl,
    isLocked && !cvPreview ? 'opacity:0.85' : '',
    isHidden ? 'opacity:0.4' : '',
  ].filter(Boolean).join(';');

  // AUDIT-FIX #11: tolerate per-block render errors. Previously a single
  // throwing block would crash the whole cvRenderCanvas pass, leaving the
  // editor blank with the error only visible in the dev console. Now the
  // failed block shows a small inline warning in its slot — the rest of
  // the canvas renders normally and the user can click into the bad block
  // to diagnose and fix the source data.
  try {
    elDiv.innerHTML = cvRenderBlockContent(block, report, cvPreview);
  } catch(e) {
    console.warn('Render error for block', block.id, e);
    elDiv.innerHTML = `<div style="height:100%;background:rgba(220,38,38,.08);border:1px dashed rgba(220,38,38,.4);color:#991b1b;font-size:10px;display:flex;align-items:center;justify-content:center;text-align:center;padding:4px;box-sizing:border-box">⚠ Render error<br><span style="font-size:8px;font-family:monospace;opacity:.7">${escapeHtml(block.id || '?')}</span></div>`;
  }

  // V24 a11y: Enter / Space select the focused block
  if(!cvPreview){
    elDiv.addEventListener('keydown', kE => {
      if(kE.key === 'Enter' || kE.key === ' '){
        kE.preventDefault();
        cvSelectBlock(block.id);
      }
    });
  }

  // Visibility-rule badge
  if(!cvPreview && block.showWhen && block.showWhen.field){
    const badge = document.createElement('div');
    badge.style.cssText = 'position:absolute;top:-1px;left:-1px;background:rgba(167,139,250,.9);color:#fff;font-size:8px;font-weight:600;padding:1px 4px;border-radius:0 0 4px 0;z-index:401;pointer-events:none;font-family:monospace';
    badge.textContent = '⚡ '+(block.showWhen.field)+' '+(block.showWhen.op||'=')+' '+(block.showWhen.value||'');
    elDiv.appendChild(badge);
  }

  // V29: zone badge for blocks in header/footer bands
  if(!cvPreview && (block.zone === 'header' || block.zone === 'footer')){
    const zb = document.createElement('div');
    const isHdr = block.zone === 'header';
    zb.style.cssText = `position:absolute;${isHdr?'top':'bottom'}:-1px;left:-1px;background:${isHdr?'rgba(79,142,247,.9)':'rgba(245,166,35,.95)'};color:#fff;font-size:7.5px;font-weight:700;padding:1px 5px;border-radius:0 0 4px 0;z-index:401;pointer-events:none;font-family:monospace;letter-spacing:.04em`;
    zb.textContent = isHdr ? 'HDR ↻' : 'FTR ↻';
    zb.title = isHdr
      ? t('pe.header.label','HEADER — repeats on every page')
      : t('pe.footer.label','FOOTER — repeats on every page');
    elDiv.appendChild(zb);
  }

  // Comment indicator
  if(!cvPreview && hasComments){
    const commentDot = document.createElement('div');
    commentDot.style.cssText = 'position:absolute;top:-7px;right:14px;background:#f5a623;color:#000;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid #fff;z-index:401;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.4)';
    commentDot.textContent = block.comments.filter(c=>!c.resolved).length;
    commentDot.title = 'Unresolved comments';
    commentDot.onclick = (ev) => { ev.stopPropagation(); cvSelectBlock(block.id); };
    elDiv.appendChild(commentDot);
  }

  // Locked-block indicator — a small amber corner badge so a locked
  // card is unmistakable. The 0.85 opacity alone (set in the cssText
  // above) is too subtle to read as a deliberate state.
  if(!cvPreview && isLocked){
    const lb = document.createElement('div');
    lb.style.cssText = 'position:absolute;bottom:-1px;right:-1px;background:rgba(245,166,35,.95);color:#fff;font-size:8px;line-height:1;padding:2px 4px;border-radius:4px 0 0 0;z-index:401;pointer-events:none';
    lb.textContent = '🔒';
    lb.title = t('pe.lock.label', 'Locked — position fixed');
    elDiv.appendChild(lb);
  }

  if(!cvPreview){
    elDiv.addEventListener('mousedown', e=>{
      if(e.target.classList.contains('cblk-rh') || e.target.closest('.cblk-fab-btn') || e.target.closest('.cblk-del-btn')) return;
      e.stopPropagation();
      if(e.shiftKey){
        if(cvSelectedIds.includes(block.id)){
          cvSelectedIds = cvSelectedIds.filter(x=>x!==block.id);
          _cvPrimaryToLast();   // most-recently-remaining becomes primary
        } else {
          cvSelectedIds.push(block.id);
          _cvPrimaryToLast();   // just-added becomes primary
        }
        cvUpdateSelectionUI();
        cvRenderProps(cvSelectedId);
        return;
      }
      if(!cvSelectedIds.includes(block.id)){
        _cvSelectSingle(block.id);
        cvUpdateSelectionUI();
        cvRenderProps(block.id);
      }
      // Re-evaluate the locked state at mousedown time rather than reusing
      // the closure-captured `isLocked` — when cvTplCfg.lockZones toggles
      // while the block element is cached, the old isLocked value is stale.
      if(_cvIsBlockLocked(block)) return;
      const canvas = document.getElementById('cv-canvas');
      const canvasRect = canvas.getBoundingClientRect();
      cvDragging = {
        ids: [...cvSelectedIds],
        startPositions: cvSelectedIds.map(sid => { const sb=cvBlocks.find(bb=>bb.id===sid); return sb?{id:sid,x:sb.x,y:sb.y}:null; }).filter(Boolean),
        anchorX: (e.clientX - canvasRect.left) / cvZoom,
        anchorY: (e.clientY - canvasRect.top)  / cvZoom,
      };
      // Parented cells ride along when their container is dragged — append
      // each container's children to startPositions so cvMouseMove offsets
      // them by the same delta. ids stays unchanged so single-block snap
      // still applies to the container itself.
      cvDragging.ids.forEach(did => {
        const c = cvBlocks.find(b => b.id === did);
        if(!c || c.key !== 'method-block') return;
        _cvContainerChildren(did).forEach(ch => {
          if(!cvDragging.startPositions.some(sp => sp.id === ch.id))
            cvDragging.startPositions.push({ id: ch.id, x: ch.x, y: ch.y });
        });
      });
      cvDragUndoPushed = false;
      document.body.style.cursor='move'; document.body.style.userSelect='none';
      cvAttachDragListeners();
    });

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'cblk-del-btn';
    delBtn.textContent = '✕';
    delBtn.style.cssText='position:absolute;top:-1px;right:-1px;width:18px;height:18px;background:rgba(242,92,92,.85);color:#fff;border:none;border-radius:0 0 0 4px;font-size:10px;line-height:1;cursor:pointer;z-index:400;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .12s;pointer-events:auto';
    delBtn.addEventListener('click', e=>{
      e.stopPropagation();
      // Respect the live lock state — zone-locked blocks shouldn't vanish
      // via the corner ✕ either.
      if(_cvIsBlockLocked(block)){
        toast(t('pe.toast.zone_locked_block', 'Unlock header & footer first.'), 'warn');
        return;
      }
      cvDeleteBlock(block.id);
    });
    elDiv.addEventListener('mouseenter', ()=>{ if(!cvPreview) delBtn.style.opacity='1'; });
    elDiv.addEventListener('mouseleave', ()=>{ delBtn.style.opacity='0'; });
    elDiv.appendChild(delBtn);

    // Resize handle
    if(!isLocked){
      const rh = document.createElement('div');
      rh.className = 'cblk-rh';
      rh.style.cssText='position:absolute;right:0;bottom:0;width:12px;height:12px;cursor:se-resize;background:linear-gradient(135deg,transparent 40%,rgba(79,142,247,.7) 40%);z-index:200';
      rh.addEventListener('mousedown', e=>{
        // Same stale-closure guard as the move-drag handler — check live
        // lock state so zone-lock blocks can't be resized after toggling.
        if(_cvIsBlockLocked(block)){ e.stopPropagation(); return; }
        e.stopPropagation();
        cvSelectBlock(block.id);
        cvResizing = {id:block.id, startX:e.clientX, startY:e.clientY, startW:block.w, startH:block.h};
        cvDragUndoPushed = false;
        document.body.style.cursor='se-resize'; document.body.style.userSelect='none';
        cvAttachDragListeners();
      });
      elDiv.appendChild(rh);
    }

    // FAB buttons on single-selected
    if(isSel && cvSelectedIds.length <= 1){
      const fab = document.createElement('div');
      fab.className = 'cblk-fab-btn';
      fab.style.cssText='position:absolute;top:-24px;right:0;display:flex;gap:2px;z-index:300';
      fab.innerHTML=`
        <button class="cblk-fab-btn" data-action="cvDuplicateBlock" data-args="'${block.id}'" title="${escapeHtml(t('pe.fab.duplicate','Duplicate (Ctrl+D)'))}" style="background:var(--panel);border:1px solid var(--border2);color:var(--t2);font-size:10px;padding:2px 6px;border-radius:3px;cursor:pointer;line-height:1">⧉</button>
        <button class="cblk-fab-btn" data-action="cvToggleLock" data-args="'${block.id}'" title="${escapeHtml(t(isLocked?'pe.fab.unlock':'pe.fab.lock', (isLocked?'Unlock':'Lock')+' position'))}" style="background:var(--panel);border:1px solid var(--border2);color:${isLocked?'var(--amber)':'var(--t2)'};font-size:10px;padding:2px 5px;border-radius:3px;cursor:pointer;line-height:1">${isLocked?'🔒':'🔓'}</button>
        <button class="cblk-fab-btn" data-action="cvMoveZ" data-args="'${block.id}',1" title="${escapeHtml(t('pe.fab.forward','Forward'))}" style="background:var(--panel);border:1px solid var(--border2);color:var(--t2);font-size:10px;padding:2px 5px;border-radius:3px;cursor:pointer;line-height:1">↑z</button>
        <button class="cblk-fab-btn" data-action="cvMoveZ" data-args="'${block.id}',-1" title="${escapeHtml(t('pe.fab.back','Back'))}" style="background:var(--panel);border:1px solid var(--border2);color:var(--t2);font-size:10px;padding:2px 5px;border-radius:3px;cursor:pointer;line-height:1">↓z</button>
        <button class="cblk-fab-btn" data-action="cvDeleteBlock" data-args="'${block.id}'" title="Delete" style="background:rgba(242,92,92,.15);border:1px solid rgba(242,92,92,.3);color:#f87171;font-size:10px;padding:2px 6px;border-radius:3px;cursor:pointer;line-height:1">✕</button>`;
      elDiv.appendChild(fab);
    }
  }

  return elDiv;
}

// ── Block content renderer ───────────────────────────────────────────
function cvRenderBlockContent(block, report, preview){
  const key = block.key;
  const co = ls(KEYS.company, {});
  // SECURITY: block.text, block.bgColor/
  // color/borderColor/fontSize and the company name all originate from
  // free-form user input (properties panel + imported/shared template JSON +
  // company settings) and are injected via innerHTML below. Without these
  // sanitisers a crafted value like `"><img src=x onerror=alert(1)>` in any
  // colour/text field would execute. Whitelist colours and font sizes to
  // their valid CSS shapes; escape every text interpolation.
  const _h = (v) => escapeHtml(v == null ? '' : String(v));
  const _safeColor = (v, fb) => (typeof v === 'string' && /^(?:#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\)|transparent)$/.test(v.trim())) ? v.trim() : fb;
  const _safeFs    = (v, fb) => (typeof v === 'string' && /^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/.test(v.trim())) ? v.trim() : fb;
  const _safeAlign = (v) => (v === 'center' || v === 'right' || v === 'left' || v === 'justify') ? v : 'left';
  const _safeUrl   = (v) => {
    if(typeof v !== 'string') return '';
    const s = v.trim();
    if(/^(?:https?:|data:image\/(?:png|jpeg|jpg|gif|svg\+xml|webp);)/i.test(s)) return s.replace(/"/g, '%22');
    return '';
  };
  const coName = _h(co.name || 'NDT Inspect');

  // ── Helpers for consistent property propagation ──
  const al = _safeAlign(block.align);
  const jc = al==='center'?'center':al==='right'?'flex-end':'flex-start';  // justify-content
  const fs = _safeFs(block.fontSize, '8.5px');
  // Page number and the auto report/sign date render in the brand green
  // (the valid-shield colour) as a deliberate accent — applied in both
  // the editor preview and the printed PDF (this render path feeds both).
  const fc = (block.key === 'page-num' || block.key === 'today-date')
    ? '#16a34a'
    : _safeColor(block.color, '#000');
  const bg = _safeColor(block.bgColor, 'transparent');
  const bc = _safeColor(block.borderColor, '#ccc');
  const fw = block.bold ? 'bold' : 'normal';
  const fi = block.italic ? 'italic' : 'normal';

  if(block.isLayout){
    // Saved-logo library cards: key is `logo-lib:<id>`, render the bound
    // library entry's image. If the entry is gone (user deleted it from
    // the library) we show a placeholder so the block stays selectable
    // instead of vanishing silently.
    if(key.startsWith('logo-lib:')){
      const id = key.slice('logo-lib:'.length);
      const entry = (typeof cvLogoLibLoad === 'function') ? cvLogoLibLoad().find(e => e && e.id === id) : null;
      if(entry && entry.dataUrl){
        return `<div style="height:100%;display:flex;align-items:center;justify-content:${jc};padding:4px"><img src="${entry.dataUrl}" alt="${_h(entry.name||'Logo')}" style="max-height:100%;max-width:100%;object-fit:contain"/></div>`;
      }
      return `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;${block.showBorder?'border:1px dashed #ddd;':''}color:#bbb;font-size:9px;gap:2px"><span style="font-size:20px">🖼</span>${_h(block.text||'Saved logo (removed)')}</div>`;
    }
    switch(key){
      case 'accent-bar':
        return `<div style="height:100%;background:${_safeColor(block.bgColor, cvGetCompanyColor())}"></div>`;
      case 'h-line':
        return `<div style="height:100%;display:flex;align-items:center"><div style="width:100%;border-top:0.5px solid ${bc}"></div></div>`;
      case 'section-header':
        return `<div style="height:100%;display:flex;align-items:center;justify-content:${jc};padding:0 8px;background:${_safeColor(block.bgColor,'#404040')};color:${_safeColor(block.color,'#fff')};font-weight:${fw};font-style:${fi};font-size:${fs};text-align:${al}">${_h(block.text||'Section header')}</div>`;
      case 'logo-co':{
        // V29: per-template tplLogo wins; otherwise fall back to the live
        // company profile logo so users who've uploaded a logo in Settings →
        // Company don't have to re-upload it inside the editor.
        const src = _safeUrl(cvTplCfg.tplLogo || co.logo);
        return src
          ? `<div style="height:100%;display:flex;align-items:center;justify-content:center;padding:4px"><img src="${src}" style="max-height:100%;max-width:100%;object-fit:contain"/></div>`
          : `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;${block.showBorder?'border:1px dashed #ddd;':''}color:#bbb;font-size:9px;gap:2px"><span style="font-size:20px">🖼</span>Company logo<span style="font-size:7.5px;color:#999">Upload in Settings → Company</span></div>`;
      }
      case 'photo-box':
        return `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;${block.showBorder?'border:1px dashed #ccc;':''}color:#bbb;gap:4px"><span style="font-size:24px">📷</span><span style="font-size:8.5px">${_h(block.text||'Photo placeholder')}</span></div>`;
      case 'drawing-page':
      case 'photo-page':{
        // Both blocks share the same grid + slot render. Drawing-page is
        // semantically a 'photo-page for drawings' — pulls from
        // report.drawings / _ovDrawings instead of report.photos /
        // _ovPhotos, defaults to a 1×1 grid (drawings are usually
        // singular and large), uses the 📐 placeholder.
        const _isDrawing = block.key === 'drawing-page';
        // Heading bar matches the rest of the report's section headers:
        // a filled bar in the template section colour (or a per-block
        // barColor override from the Properties picker), with white,
        // uppercase, bold, letter-spaced text on top.
        const _tplSectionColor = (typeof cvTplCfg !== 'undefined' && cvTplCfg.sectionColor) ? cvTplCfg.sectionColor : '#404040';
        const _headColor = _safeColor(block.barColor, _tplSectionColor);
        // Grid: rows × items-per-row, configurable per block via the
        // Properties panel. Photo-page defaults to 2 × 3 (six slots);
        // drawing-page defaults to 1 × 1 (one large slot — drawings are
        // usually singular). Clamped to a sensible range so a typo can't
        // blow the layout out.
        const _rows = Math.max(1, Math.min(10, parseInt(block.photoRows, 10) || (_isDrawing ? 1 : 2)));
        const _cols = Math.max(1, Math.min(6,  parseInt(block.photoCols, 10) || (_isDrawing ? 1 : 3)));
        const _slots = _rows * _cols;
        // Fill slots from the appropriate per-report source — photos for
        // photo-page, drawings for drawing-page. Captions only apply to
        // photo-page (drawing-page renders a single image grid; details
        // for drawings live in dedicated photo-details / single-drawing
        // blocks if needed).
        const _photos   = _isDrawing
          ? ((report && Array.isArray(report.drawings)) ? report.drawings : [])
          : ((report && Array.isArray(report.photos))   ? report.photos   : []);
        const _captions = _isDrawing
          ? []
          : ((report && Array.isArray(report.photoCaptions)) ? report.photoCaptions : []);
        // Caption styling is configurable per block via the Properties
        // panel. Defaults match the original drop (7.5 px italic centred
        // mid-grey) so existing reports look identical until the inspector
        // touches the controls. showCaptions=false hides the strip
        // entirely, returning the full cell height to the photo.
        const _showCap  = block.showCaptions !== false;
        const _capSize  = block.captionSize  || '7.5px';
        const _capAlign = block.captionAlign || 'center';
        const _capItalic= block.captionItalic !== false;
        const _capBold  = block.captionBold  === true;
        const _capColor = _safeColor(block.captionColor, '#555555');
        // Card mode + hide-empty — set on the photo-page block via the
        // 'Per-photo details' Properties card. showCard upgrades each
        // caption strip to a heading-bar + body card; hideEmpty drops
        // cells without a photo on print (and in preview).
        const _showCard  = !!block.showDetailsCard;
        const _cardH     = Math.max(30, Math.min(240, parseInt(block.detailsCardHeight, 10) || 70));
        const _hideEmpty = !!block.hideEmptySlots;
        const boxes = Array.from({length:_slots},(_,i)=>{
          const _p   = _photos[i];
          const _cap = (_captions[i] || '').toString();
          // Hide-empty: in preview / print we drop the cell entirely
          // (blank space, no dashed frame). In the design canvas we
          // keep the dashed placeholder so the inspector can still see
          // the slot layout while editing — otherwise the photo-page
          // looks emptier than it actually is.
          if(!_p && _hideEmpty && preview){
            return `<div></div>`;
          }
          let inner;
          if(_p){
            // object-fit:contain so the whole photo is visible (no crop) regardless
            // of source aspect — phones (3:4 portrait) and cameras (3:2 landscape)
            // both display in full. The slot stays a uniform grid cell so the page
            // keeps its geometric rhythm; any unused space inside the slot reads as
            // a thin matted frame (4 px white pad inside the grey border).
            inner = `<div style="flex:1;border:1px solid #ddd;border-radius:3px;overflow:hidden;background:#fff;padding:4px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;min-height:0"><img src="${_p}" alt="${_isDrawing?'Drawing':'Photo'} ${i+1}" style="width:100%;height:100%;object-fit:contain;display:block"/></div>`;
          } else {
            const _placeIco = _isDrawing ? '📐' : '📷';
            const _placeLbl = _isDrawing ? 'Drawing' : 'Photo';
            inner = `<div style="flex:1;border:1px dashed #bbb;border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#bbb;font-size:7px;gap:4px;background:#fafafa;min-height:0"><span style="font-size:18px">${_placeIco}</span>${_placeLbl} ${i+1}</div>`;
          }
          // Caption strip vs styled card. In card mode the cell gets a
          // section-header bar + body sized to detailsCardHeight; the
          // caption styling (font / italic / bold / colour / align)
          // applies to the body so one set of controls covers both
          // looks. In strip mode (legacy default) the inline caption
          // text sits directly below the photo.
          let capContent;
          if(_cap){
            capContent = _h(_cap);
          } else if(!preview){
            capContent = `<span style="color:#aaa">${_showCard ? 'Details / information typed in the new-report form will appear here' : 'Caption'}</span>`;
          } else {
            capContent = '';
          }
          let capArea = '';
          if(_showCap){
            if(_showCard){
              const _bodyStyle = `flex:1;padding:5px 8px;font-size:${_capSize};line-height:1.3;${_capItalic?'font-style:italic;':''}${_capBold?'font-weight:600;':''}color:${_capColor};text-align:${_capAlign};overflow:hidden;white-space:pre-wrap`;
              capArea = `<div style="margin-top:5px;height:${_cardH}px;display:flex;flex-direction:column;border:1px solid #ddd;border-radius:3px;overflow:hidden;background:#fff">
                <div style="padding:3px 8px;background:${_headColor};text-align:center">
                  <span style="font-size:9.5px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.06em">${_h(block.detailsTitle || 'Details / information')}</span>
                </div>
                <div style="${_bodyStyle}">${capContent}</div>
              </div>`;
            } else {
              capArea = `<div style="margin-top:3px;font-size:${_capSize};line-height:1.25;${_capItalic?'font-style:italic;':''}${_capBold?'font-weight:600;':''}color:${_capColor};text-align:${_capAlign};min-height:10px;padding:0 2px;overflow:hidden">${capContent}</div>`;
            }
          }
          return `<div style="display:flex;flex-direction:column;height:100%;min-height:0">${inner}${capArea}</div>`;
        }).join('');
        return `<div style="height:100%;display:flex;flex-direction:column;box-sizing:border-box">
          <div style="padding:4px 8px;background:${_headColor};text-align:center">
            <span style="font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.06em">${_h(block.text || (_isDrawing ? 'Drawings' : 'Photo attachments'))}</span>
          </div>
          <div style="flex:1;padding:8px;display:grid;grid-template-columns:repeat(${_cols},1fr);grid-template-rows:repeat(${_rows},1fr);gap:8px">${boxes}</div>
        </div>`;
      }
      case 'single-photo':
      case 'single-drawing':{
        // One-image variant of photo-page: same heading-bar styling, single
        // slot that fills the block, intended for a sketch / defect close-up /
        // PDF screenshot (single-photo) or a drawing / diagram (single-drawing).
        // Per-report image lives on report.singlePhotos keyed by block.id —
        // both keys share the same storage (block.id is unique) and the same
        // upload tile mechanism, only the placeholder icon and default label
        // differ so the palette reads as two distinct picks.
        const _isDrawing = block.key === 'single-drawing';
        const _defLabel  = _isDrawing ? 'Drawing' : 'Image';
        const _placeIco  = _isDrawing ? '📐' : '🖼';
        const _tplSectionColor = (typeof cvTplCfg !== 'undefined' && cvTplCfg.sectionColor) ? cvTplCfg.sectionColor : '#404040';
        const _headColor = _safeColor(block.barColor, _tplSectionColor);
        const _img = (report && report.singlePhotos && typeof report.singlePhotos === 'object') ? report.singlePhotos[block.id] : null;
        // Same contain + thin matted-frame treatment as photo-page slots so
        // phones (portrait) and cameras (landscape) both display in full
        // without crop; surrounding white pad inside the grey border reads
        // as a deliberate mat.
        const slot = _img
          ? `<div style="flex:1;margin:6px;border:1px solid #ddd;border-radius:3px;padding:4px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;background:#fff"><img src="${_img}" alt="${_h(block.text||_defLabel)}" style="width:100%;height:100%;object-fit:contain;display:block"/></div>`
          : `<div style="flex:1;margin:6px;border:1px dashed #bbb;border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#bbb;font-size:8px;gap:4px;background:#fafafa"><span style="font-size:24px">${_placeIco}</span><span>${_h(block.text||('Single '+_defLabel.toLowerCase()))}</span></div>`;
        return `<div style="height:100%;display:flex;flex-direction:column;box-sizing:border-box">
          <div style="padding:4px 8px;background:${_headColor};text-align:center">
            <span style="font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.06em">${_h(block.text||_defLabel)}</span>
          </div>
          ${slot}
        </div>`;
      }
      case 'photo-details':{
        // Companion to single-photo: a section-header-styled card whose
        // body holds per-report typed text about the linked photo.
        // Linked via block.linkedPhotoId; the photo and the details card
        // hide together on print when the linked photo is unfilled, so
        // each visible details card always belongs to a real photo above
        // it (handled in export.js, not here).
        //
        // Body text comes from report.photoDetails[block.id]. In the
        // design canvas (!preview) the body shows a soft placeholder
        // hint so the inspector can see where the typed information will
        // land; the hint is dropped in preview / print.
        const _tplSectionColor = (typeof cvTplCfg !== 'undefined' && cvTplCfg.sectionColor) ? cvTplCfg.sectionColor : '#404040';
        const _headColor = _safeColor(block.barColor, _tplSectionColor);
        const _txt = (report && report.photoDetails && typeof report.photoDetails === 'object')
          ? (report.photoDetails[block.id] || '')
          : '';
        const _bodySize = block.fontSize || '9px';
        const _bodyColor = _safeColor(block.color, '#222');
        let _bodyContent;
        if(_txt){
          _bodyContent = _h(_txt).replace(/\n/g, '<br>');
        } else if(!preview){
          _bodyContent = `<span style="color:#aaa;font-style:italic">Details / information typed in the new-report form will appear here</span>`;
        } else {
          _bodyContent = '';
        }
        return `<div style="height:100%;display:flex;flex-direction:column;box-sizing:border-box">
          <div style="padding:4px 8px;background:${_headColor};text-align:center">
            <span style="font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.06em">${_h(block.text||'Details / information')}</span>
          </div>
          <div style="flex:1;padding:6px 8px;font-size:${_bodySize};line-height:1.35;color:${_bodyColor};overflow:hidden;white-space:pre-wrap">${_bodyContent}</div>
        </div>`;
      }
      case 'additional-page':
        // outline (not border) so the wrapper doesn't inset its content by
        // the border width — header / footer strips line up flush with
        // child blocks placed at the same x. See method-block for the
        // full rationale.
        return `<div style="height:100%;display:flex;flex-direction:column;outline:1px solid #ddd"><div style="padding:6px 8px;border-bottom:1px solid #ccc;background:#f5f5f5;font-size:9px;font-weight:600;color:#333;text-align:${al}">${_h(block.text||'Additional information')}</div><div style="flex:1;padding:12px 8px;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:9px;border:1px dashed #ddd;margin:8px;border-radius:3px">Place blocks inside for custom content</div><div style="padding:3px 8px;background:#f5f5f5;border-top:1px solid #ddd;font-size:6.5px;color:#888">${coName}</div></div>`;
      case 'items-table':{
        // Examination-details table — mirrors RPT_FORM.items columns onto a
        // table that fills the block. table-layout:fixed + percentage col
        // widths (derived from each column's RPT_FORM.items.width) means
        // the table scales horizontally to whatever width the user has
        // dragged the block to; height is filled by row content, with
        // overflow clipped if the block isn't tall enough.
        const cols = (typeof RPT_FORM !== 'undefined' && RPT_FORM.items) ? RPT_FORM.items : [];
        if(!cols.length){
          return `<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:9px">No item columns defined</div>`;
        }
        // Per-block column widths win over the RPT_FORM.items defaults so
        // users can drag columns to whatever proportions suit their layout
        // (edited from the Properties panel). The array length must match
        // cols — if it doesn't (e.g. RPT_FORM.items grew after the block
        // was saved), fall back to defaults rather than render incorrectly.
        const widthsArr = (Array.isArray(block.colWidths) && block.colWidths.length === cols.length)
          ? block.colWidths.map(w => (typeof w === 'number' && w > 0) ? w : 130)
          : cols.map(c => c.width || 130);
        const totalW = widthsArr.reduce((s, w) => s + w, 0);
        // Compute column percentages so they sum to *exactly* 100. Naive
        // toFixed(2) on each column rounds independently and can leave a
        // 0.05–0.5px gap on one side that reads as a misalignment against
        // cards stacked above the table. Assigning the remainder to the
        // last column closes that gap to zero.
        const pcts = widthsArr.map(w => +((w / totalW) * 100).toFixed(4));
        const sumExceptLast = pcts.slice(0, -1).reduce((s, p) => s + p, 0);
        pcts[pcts.length - 1] = +(100 - sumExceptLast).toFixed(4);
        const colgroup = `<colgroup>${pcts.map(p => `<col style="width:${p}%"/>`).join('')}</colgroup>`;
        // Three independent font sizes:
        //   titleFs  — the EXAMINATION DETAILS heading (block.titleFontSize
        //              override → fixed 11px default)
        //   colFs    — the column-name row (fixed 7.5px small-caps)
        //   cellFs   — the row cells (block.fontSize from the Properties
        //              panel, default 8.5px) so users can tune the table
        //              text independently from the heading
        const titleFs = _safeFs(block.titleFontSize, '11px');
        const colFs   = '7.5px';
        const cellFs  = fs; // already _safeFs(block.fontSize, '8.5px') above
        const headCells = cols.map(c => `<th scope="col" style="padding:3px 5px;text-align:left;font-size:${colFs};font-weight:600;color:#fff;letter-spacing:.02em">${_h(c.label)}</th>`).join('');
        // Source the items array in order of preference:
        //   1. the active `report` (preview mode + a selected report)
        //   2. live `_ovItems` — the user typing into the new-report form
        //      right now, even before they've clicked Save (this fed
        //      directly from dashboard.js's working copy)
        //   3. the most recent saved report carrying items[] (design mode
        //      or sample-data preview)
        //   4. an empty placeholder row
        // Items source — when a real `report` is being rendered, use its
        // own items list and stop there. The form-state / latest-saved
        // fallbacks are design-mode only so a report with an empty
        // items list never silently borrows from another report.
        let liveItems = null;
        if(report && Array.isArray(report.items) && report.items.length){
          liveItems = report.items;
        }
        if(!liveItems && !report){
          if(typeof _ovItems !== 'undefined' && Array.isArray(_ovItems)){
            const live = _ovItems
              .map(r => {
                const o = {}; if(!r) return o;
                Object.keys(r).forEach(k => { if(r[k] && String(r[k]).trim()) o[k] = String(r[k]).trim(); });
                return o;
              })
              .filter(r => Object.keys(r).length);
            if(live.length) liveItems = live;
          }
          if(!liveItems){
            try {
              if(typeof ls === 'function' && typeof KEYS !== 'undefined'){
                const reports = ls(KEYS.reports, []) || [];
                for(let i = reports.length - 1; i >= 0; i--){
                  if(reports[i] && Array.isArray(reports[i].items) && reports[i].items.length){
                    liveItems = reports[i].items;
                    break;
                  }
                }
              }
            } catch(e){}
          }
        }
        let items = liveItems
          ? liveItems
          : (preview
              ? ((typeof CV_SAMPLE !== 'undefined' && Array.isArray(CV_SAMPLE.items) && CV_SAMPLE.items.length) ? CV_SAMPLE.items : [{}])
              : [{ subject:'[Weld / object]', drawing:'[Drawing]', dimensions:'[Dimensions]', material:'[Material]', weldType:'[Prep]', weldProcess:'[Process]', welders:'[Welder]', examDate:'—', extent:'[Extent]', verdict:'—' }]);
        // Pagination — during a print build the engine sets _cvItemsSlice
        // so page 1 shows the rows that fit and each continuation page
        // shows its overflow batch.
        if(_cvItemsSlice && Array.isArray(items)){
          items = items.slice(_cvItemsSlice.start, _cvItemsSlice.start + _cvItemsSlice.count);
        }
        // Verdict cell colour swatches — same palette as the result place
        // card (rcolor / rbg above) plus a blue variant for "For
        // information" so all four states the form offers are covered.
        const vColors = {
          'Acceptable':     {fg:'#065f46', bg:'#d1fae5'},
          'Pass':           {fg:'#065f46', bg:'#d1fae5'},
          'Not acceptable': {fg:'#991b1b', bg:'#fee2e2'},
          'Fail':           {fg:'#991b1b', bg:'#fee2e2'},
          'Monitor':        {fg:'#92400e', bg:'#fef3c7'},
          'Inconclusive':   {fg:'#92400e', bg:'#fef3c7'},
          'For information':{fg:'#1e40af', bg:'#dbeafe'},
        };
        const lastCol = cols.length - 1;
        const rows = items.map((it, ri) => {
          const isLastRow = ri === items.length - 1;
          const cells = cols.map((c, ci) => {
            let v = (it && it[c.id] != null && it[c.id] !== '') ? String(it[c.id]) : '—';
            // Date columns render through the shared formatter so the table
            // matches the rest of the report's date style.
            if(c.type === 'date' && v !== '—') v = fmtDate(v);
            // Verdict gets a chip — colour-coded swatch contained inside the
            // cell. Inline-block + padding bounds the colour to the chip,
            // so neighbouring cell borders can't bleed colour into it.
            const inner = (c.id === 'verdict' && vColors[v])
              ? `<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:${vColors[v].bg};color:${vColors[v].fg};font-weight:600">${_h(v)}</span>`
              : _h(v);
            // Internal grid lines — last column drops its right border so
            // it can't extend past the wrapper, but every row keeps its
            // bottom border (including the final row) so each data row
            // has a visible line underneath even when the block is taller
            // than the content.
            const borderRight  = (ci === lastCol) ? '' : 'border-right:0.5px solid #ddd;';
            const borderBottom = 'border-bottom:0.5px solid #ddd;';
            // Each data row renders 36px deep so the table's row rhythm
            // matches the standard place-card height used everywhere else
            // on the report. height on a <td> acts as a minimum, so a cell
            // with unusually long content can still grow past it.
            return `<td style="height:36px;padding:2px 5px;${borderRight}${borderBottom}font-size:${cellFs};line-height:1.3;vertical-align:middle;word-break:break-word;overflow:hidden">${inner}</td>`;
          }).join('');
          return `<tr>${cells}</tr>`;
        }).join('');
        // Title strip — now lives inside the table as a colspan row so the
        // bar's left/right edges line up exactly with the table's column
        // edges instead of drifting by a few pixels (which is what happens
        // when a separate <div> sits above the table). Bar colour is
        // independent of block.bgColor so the card body's fill can change
        // without making the bar disappear.
        const tplSectionColor = (typeof cvTplCfg !== 'undefined' && cvTplCfg.sectionColor) ? cvTplCfg.sectionColor : '#404040';
        const barColor = _safeColor(block.barColor, tplSectionColor);
        const title = _h((block.text || 'Examination details')).toUpperCase();
        // Examination remarks. When a real `report` is being rendered
        // (preview / PDF / print) use its own remarks and nothing else —
        // a blank field means the inspector chose to leave it blank,
        // not "borrow another report's remarks". The cross-report
        // fallback was leaking the latest saved report's remarks
        // (e.g. an MT report's remarks showing on a PT report that
        // had the field left empty). The form / saved-report fallback
        // chain is kept for design mode only, so the editor canvas
        // still previews with realistic copy.
        let liveRemarks = (report && report.examRemarks) ? String(report.examRemarks) : '';
        if(!liveRemarks && !report){
          try {
            const liveTa = document.getElementById('ov-exam-remarks');
            if(liveTa && liveTa.value && liveTa.value.trim()) liveRemarks = liveTa.value.trim();
          } catch(e){}
          if(!liveRemarks){
            try {
              if(typeof ls === 'function' && typeof KEYS !== 'undefined'){
                const reports = ls(KEYS.reports, []) || [];
                for(let i = reports.length - 1; i >= 0; i--){
                  if(reports[i] && reports[i].examRemarks){ liveRemarks = String(reports[i].examRemarks); break; }
                }
              }
            } catch(e){}
          }
        }
        const remarksFs = _safeFs(block.fontSize, '8.5px');
        const remarksHtml = liveRemarks
          ? `<div style="flex:1;padding:6px 8px;font-size:${remarksFs};line-height:1.4;color:#000;white-space:pre-wrap;word-break:break-word;overflow:hidden;border-top:0.5px solid #ddd">${_h(liveRemarks)}</div>`
          : `<div style="flex:1;padding:6px 8px;font-size:${remarksFs};line-height:1.4;color:#bbb;font-style:italic;overflow:hidden;border-top:0.5px solid #ddd">${preview?'':'Inspector remarks / comments…'}</div>`;
        // Wrapper outline (not border) so the table inside fills the
        // block's full width and lines up flush with any card stacked
        // above or below at the same x — border + box-sizing was
        // insetting the table by 0.5px on each side.
        // The heading colour is set on <thead> — one fill behind BOTH
        // header rows — so the title bar and the column-header row share a
        // single rectangle and align exactly. Backgrounding the title
        // colspan cell and the column-header row separately let the two
        // drift by a sub-pixel at some zooms / column widths (the colspan
        // cell rounds once, the N column cells round independently).
        return `<div style="width:100%;height:100%;outline:1px solid #ddd;overflow:hidden;display:flex;flex-direction:column">
          <table style="width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;flex-shrink:0">
            ${colgroup}
            <thead style="background:${barColor}">
              <tr><th colspan="${cols.length}" style="padding:4px 8px;color:#fff;font-size:${titleFs};font-weight:700;font-style:${fi};text-align:center;letter-spacing:.06em;border-bottom:0.5px solid rgba(255,255,255,.18)">${title}</th></tr>
              <tr>${headCells}</tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          ${remarksHtml}
        </div>`;
      }
      case 'revision-history':{
        // Standard place-card style — small label at the top, stacked
        // value lines below (matching how per-item fields render when a
        // report has multiple inspected items). No coloured bar, no
        // table chrome — just the data, formatted to read at a glance.
        const lblTxt = _h(block.text || 'Revision history');
        // Prefer the active report's revisions. When a real `report` is
        // being rendered (preview / PDF / print), don't fall through to
        // any other report's history — a brand-new report at rev 00
        // genuinely has no revisions, and borrowing another report's
        // list leaks history across methods (e.g. PT rev 0 was showing
        // rv 3 / rv 4 entries from the latest MT report). Latest-saved
        // fallback only fires in design mode for editor-canvas previews.
        let revs = (report && Array.isArray(report.revisions)) ? report.revisions : null;
        if((!revs || !revs.length) && !report){
          try {
            if(typeof ls === 'function' && typeof KEYS !== 'undefined'){
              const reports = ls(KEYS.reports, []) || [];
              for(let i = reports.length - 1; i >= 0; i--){
                if(reports[i] && Array.isArray(reports[i].revisions) && reports[i].revisions.length){
                  revs = reports[i].revisions;
                  break;
                }
              }
            }
          } catch(e){}
        }
        revs = revs || [];
        // Show only the current revision and the one immediately before
        // it — the full audit trail lives in the report's audit log; the
        // card is for at-a-glance context, not history scrolling.
        const body = revs.length
          ? revs.slice(-2).map((rv, i) => `<div style="${i ? 'border-top:0.5px solid #e5e7eb;padding-top:2px;margin-top:2px;' : ''}font-size:${fs};line-height:1.35;color:${preview?'#000':'#bbb'};white-space:normal;word-break:break-word">
              <span style="font-family:var(--mono);font-weight:600;margin-right:6px">${_h(rv.rev||'—')}</span>${_h(rv.reason||'—')}
            </div>`).join('')
          : `<div style="font-size:${fs};color:${preview?'#999':'#bbb'};font-style:italic">No revisions logged</div>`;
        return `<div style="height:100%;padding:3px 7px;display:flex;flex-direction:column;justify-content:${revs.length>1?'flex-start':'center'};box-sizing:border-box;text-align:${al}">
          <div style="font-size:7px;color:#777;line-height:1.3;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${lblTxt}</div>
          ${body}
        </div>`;
      }
      case 'defect-table':{
        // Defect / indication table — mirrors the items-table layout but
        // filters to inspected items the inspector marked as 'Not
        // acceptable'. Each rejected item becomes one row:
        //   • Weld / object   pulled from item.subject
        //   • Drawing         pulled from item.drawing
        //   • Defect type     typed per item in the Defects form section
        //   • Size            typed per item in the Defects form section
        //
        // Source items — when a real `report` is being rendered, use only
        // its items list. The form-state / latest-saved fallbacks are
        // design-mode only so a saved report's defects are never
        // borrowed from another (cross-method) report.
        let liveItems = null;
        if(report && Array.isArray(report.items) && report.items.length){
          liveItems = report.items;
        }
        if(!liveItems && !report){
          if(typeof _ovItems !== 'undefined' && Array.isArray(_ovItems)){
            const live = _ovItems
              .map(r => {
                const o = {}; if(!r) return o;
                Object.keys(r).forEach(k => { if(r[k] && String(r[k]).trim()) o[k] = String(r[k]).trim(); });
                return o;
              })
              .filter(r => Object.keys(r).length);
            if(live.length) liveItems = live;
          }
          if(!liveItems){
            try {
              if(typeof ls === 'function' && typeof KEYS !== 'undefined'){
                const reports = ls(KEYS.reports, []) || [];
                for(let i = reports.length - 1; i >= 0; i--){
                  if(reports[i] && Array.isArray(reports[i].items) && reports[i].items.length){
                    liveItems = reports[i].items;
                    break;
                  }
                }
              }
            } catch(e){}
          }
        }
        // Filter to rejected items. In design mode (no real / live items)
        // synthesise two placeholder rows so the inspector can see the
        // table shape while editing the template.
        const rejected = (liveItems || []).filter(it => it && it.verdict === 'Not acceptable');
        // Cross-reference manually-added defects from the standalone
        // Defects log that point at this report (by report number) —
        // they print alongside the rejected items so both views stay
        // aligned: anything added in the log surfaces on the report's
        // defect table, and anything captured on the report surfaces
        // in the log. Standalone entries are mapped into the same item
        // shape the table renderer expects.
        let linkedFromLog = [];
        if(report && report.reportNo){
          try {
            const _logAll = (typeof ls === 'function' && typeof KEYS !== 'undefined') ? (ls(KEYS.defects, []) || []) : [];
            const _match  = String(report.reportNo).trim().toLowerCase();
            linkedFromLog = _logAll.filter(d => {
              if(!d || !d.report) return false;
              // d.report may include " Rev XX" — strip for comparison.
              const dr = String(d.report).replace(/\s+Rev\s+.*$/i, '').trim().toLowerCase();
              return dr === _match;
            }).map(d => {
              // Concatenate dimensions for the defect-table size cell —
              // standalone defects split depth / length / width, the
              // report's items table carries a single defectSize string.
              const dims = [d.length, d.width, d.depth]
                .filter(v => v != null && String(v).trim() !== '')
                .join(' × ');
              const photo = (Array.isArray(d.photos) && d.photos.length)
                ? d.photos[0] : '';
              return {
                subject:           d.component   || '',
                drawing:           d.drawing     || '',
                material:          '',
                defectLocation:    d.location    || '',
                defectType:        d.type        || '',
                defectSize:        dims || (d.depth || ''),
                defectSeverity:    d.severity    || '',
                defectDisposition: d.disposition || '',
                defectPhoto:       photo,
                verdict:           'Not acceptable',
              };
            });
          } catch(e){}
        }
        let drawItems = rejected.concat(linkedFromLog);
        if(!drawItems.length){
          if(preview){
            drawItems = []; // real report with no rejections — print empty body
          } else {
            drawItems = [
              { subject:'[Weld / object]', drawing:'[Drawing]', material:'[Material]', defectLocation:'[Location]', defectType:'[Defect type]', defectSize:'[Size]' },
              { subject:'[Weld / object]', drawing:'[Drawing]', material:'[Material]', defectLocation:'[Location]', defectType:'[Defect type]', defectSize:'[Size]' },
            ];
          }
        }
        // Columns defined module-scope on CV_DEFECT_COLS so the Properties
        // panel column-width editor shares the same definition; per-block
        // colWidths overrides the defaults when the inspector has dragged
        // any column (same mechanism as items-table).
        const defectCols = CV_DEFECT_COLS;
        // Photo-column width is now driven entirely from CV_DEFECT_COLS
        // (60 px); the saved per-block override is ignored for the
        // photo cell so the smaller photo applies to every existing
        // template without the inspector having to reset the column.
        // Data-column overrides on the three text columns are still
        // honoured — only the photo cell is clamped.
        const widthsArr = (Array.isArray(block.colWidths) && block.colWidths.length === defectCols.length)
          ? block.colWidths.map((w, i) => {
              const newDefault = defectCols[i].width || 130;
              if(defectCols[i].photoId) return newDefault;
              return (typeof w === 'number' && w > 0) ? w : newDefault;
            })
          : defectCols.map(c => c.width || 130);
        const totalW = widthsArr.reduce((s, w) => s + w, 0);
        const pcts = widthsArr.map(w => +((w / totalW) * 100).toFixed(4));
        const sumExceptLast = pcts.slice(0, -1).reduce((s, p) => s + p, 0);
        pcts[pcts.length - 1] = +(100 - sumExceptLast).toFixed(4);
        const colgroup = `<colgroup>${pcts.map(p => `<col style="width:${p}%"/>`).join('')}</colgroup>`;
        const titleFs = _safeFs(block.titleFontSize, '11px');
        const colFs   = '7.5px';
        const cellFs  = fs; // _safeFs(block.fontSize, '8.5px') from above
        // Column header row labels each data column by its top field
        // (e.g. 'Weld / object'); the bottom field's label is shown
        // inline above the value in the body cell so the inspector
        // doesn't need two stacked header rows to know what each value
        // is. Photo column gets a plain 'Photo'.
        const headCells = defectCols.map(c => {
          const label = c.photoId ? 'Photo' : (c.topLabel || c.label);
          return `<th scope="col" style="padding:3px 5px;text-align:left;font-size:${colFs};font-weight:600;color:#fff;letter-spacing:.02em">${_h(label)}</th>`;
        }).join('');
        const lastCol = defectCols.length - 1;
        // Row height is configurable per block via the Properties panel
        // (block.rowHeight). Default 60 px gives the photo thumbnail enough
        // room to read — at 36 the photo cell crushes to ~32 px tall, which
        // looks more like a marker than a photo. Inspectors with longer
        // defect descriptions can raise it; tighter layouts can lower it.
        // Bounded 32–120 so a typo can't blow the layout out.
        // Each defect now spans TWO table rows (a card with 3 data
        // columns + photo column rowspanning both). rowHeight is the
        // height of each half-row, so the full card is 2 × halfRowH —
        // the photo cell fills that doubled height (2 × halfRowH).
        const halfRowH = Math.max(32, Math.min(120, parseInt(block.rowHeight, 10) || 60));
        const _val = (it, fid) => (it && it[fid] != null && it[fid] !== '') ? String(it[fid]) : '—';
        // Small grey field label above each value — mirrors the place-
        // card 7 px label used elsewhere in the report so the defect
        // card visually belongs with the rest of the report typography.
        const _lblStyle = 'font-size:6.5px;color:#888;line-height:1.2;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:1px;font-weight:600';
        const rows = drawItems.map((it, ri) => {
          // Top row of this defect card — each data column's topId
          // value (subject / drawing / material) plus the photo cell
          // rowspanning both rows on the right.
          const topCells = defectCols.map((c, ci) => {
            const borderRight = (ci === lastCol) ? '' : 'border-right:0.5px solid #ddd;';
            if(c.photoId){
              const dURL = (it && it.defectPhoto) ? String(it.defectPhoto) : '';
              const inner = dURL
                ? `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:3px;box-sizing:border-box"><img src="${dURL}" alt="Defect ${ri+1}" style="max-width:100%;max-height:100%;object-fit:contain;display:block"/></div>`
                : (preview
                    ? `<div style="width:100%;height:100%"></div>`
                    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:14px">📷</div>`);
              return `<td rowspan="2" style="height:${halfRowH*2}px;padding:0;${borderRight}border-bottom:0.5px solid #ddd;vertical-align:middle">${inner}</td>`;
            }
            const v = _val(it, c.topId);
            return `<td style="height:${halfRowH}px;padding:3px 5px;${borderRight}font-size:${cellFs};line-height:1.25;vertical-align:top;word-break:break-word;overflow:hidden">
              <span style="${_lblStyle}">${_h(c.topLabel || '')}</span>${_h(v)}
            </td>`;
          }).join('');
          // Bottom row — each data column's botId value (location /
          // defectType / defectSize). Photo cell is already emitted with
          // rowspan from the top row, so it's skipped here.
          const botCells = defectCols.map((c, ci) => {
            if(c.photoId) return '';
            const borderRight  = (ci === lastCol) ? '' : 'border-right:0.5px solid #ddd;';
            const borderBottom = 'border-bottom:0.5px solid #ddd;';
            const v = _val(it, c.botId);
            return `<td style="height:${halfRowH}px;padding:3px 5px;${borderRight}${borderBottom}font-size:${cellFs};line-height:1.25;vertical-align:top;word-break:break-word;overflow:hidden">
              <span style="${_lblStyle}">${_h(c.botLabel || '')}</span>${_h(v)}
            </td>`;
          }).join('');
          return `<tr>${topCells}</tr><tr>${botCells}</tr>`;
        }).join('');
        const tplSectionColor = (typeof cvTplCfg !== 'undefined' && cvTplCfg.sectionColor) ? cvTplCfg.sectionColor : '#404040';
        const barColor = _safeColor(block.barColor, tplSectionColor);
        const title = _h((block.text || 'Defect / indication table')).toUpperCase();
        // Empty-body placeholder — preview path renders a soft 'No defects
        // recorded' message into the rows area so a clean report doesn't
        // print a stray heading bar with nothing underneath.
        const emptyMsg = (preview && !drawItems.length)
          ? `<tr><td colspan="${defectCols.length}" style="padding:14px 8px;text-align:center;font-size:${cellFs};color:#999;font-style:italic">No defects recorded on this report.</td></tr>`
          : '';
        // Wrapper outline (not border) — same rationale as items-table:
        // border + box-sizing was insetting the table by 0.5px so its
        // edges didn't line up with neighbouring cards.
        return `<div style="width:100%;height:100%;outline:1px solid #ddd;overflow:hidden;display:flex;flex-direction:column">
          <table style="width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;flex-shrink:0">
            ${colgroup}
            <thead style="background:${barColor}">
              <tr><th colspan="${defectCols.length}" style="padding:4px 8px;color:#fff;font-size:${titleFs};font-weight:700;font-style:${fi};text-align:center;letter-spacing:.06em;border-bottom:0.5px solid rgba(255,255,255,.18)">${title}</th></tr>
              <tr>${headCells}</tr>
            </thead>
            <tbody>${rows}${emptyMsg}</tbody>
          </table>
        </div>`;
      }
      case 'method-block':{
        // Titled container. The user drops "Method equipment cell" place
        // cards inside it; those cells are separate blocks (parentId points
        // here) and render on top. The container itself is just the section-
        // coloured title strip + a bordered area.
        const tplSectionColor = (typeof cvTplCfg !== 'undefined' && cvTplCfg.sectionColor) ? cvTplCfg.sectionColor : '#404040';
        const barColor = _safeColor(block.barColor, tplSectionColor);
        const titleFs  = _safeFs(block.titleFontSize, '11px');
        // Title defaults to "<METHOD> Equipment". block.text is only a
        // custom title when the user has changed it from the palette
        // label ("Method-specific data block") — a fresh drop carries
        // that label and should still show the method name.
        const _mbDefLbl = (CV_LAYOUT_ITEMS.find(it => it.key === 'method-block') || {}).label || '';
        const _mbCustom = (block.text && block.text.trim() && block.text.trim() !== _mbDefLbl) ? block.text.trim() : '';
        const title    = _h(_mbCustom || (cvPpvMethod + ' Equipment')).toUpperCase();
        const barH     = _cvMethodBarHeight(block);
        const childCount = !preview ? cvBlocks.filter(b => b.parentId === block.id).length : 0;
        const body = (!preview && !childCount)
          ? `<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:8.5px;font-style:italic;text-align:center;padding:6px;gap:3px"><span style="font-size:16px">⚙</span> Drop method-equipment cells inside</div>`
          : `<div style="flex:1"></div>`;
        // outline (not border) on the container: border + box-sizing:
        // border-box was insetting the header by the border width, so
        // the coloured strip sat 0.5–1px inside the block bounds while
        // child cells (positioned at the block's true x/y) ran flush
        // to the edge — making the header read as narrower than the
        // cells / items table sitting inside it. `outline` doesn't take
        // layout space, so the header now spans the full block width
        // and lines up with the cells beneath it. The header keeps a
        // 1px border-bottom so the divider line between title strip
        // and body stays visible.
        return `<div style="width:100%;height:100%;outline:1px solid #ddd;overflow:hidden;display:flex;flex-direction:column">
          <div style="height:${barH}px;box-sizing:border-box;border-bottom:1px solid #ddd;padding:0 8px;background:${barColor};color:#fff;font-size:${titleFs};font-weight:700;font-style:${fi};letter-spacing:.06em;flex-shrink:0;display:flex;align-items:center;justify-content:center">${title}</div>
          ${body}
        </div>`;
      }
      case 'text-block':
        return `<div style="height:100%;padding:4px 7px;font-size:${fs};color:${_safeColor(block.color,'#333')};font-weight:${fw};font-style:${fi};text-align:${al};white-space:pre-wrap;word-break:break-word;line-height:1.5">${_h(block.text||'Free text — edit in Properties')}</div>`;
      default:
        return `<div style="height:100%;display:flex;align-items:center;justify-content:${jc};padding:4px 7px;color:#aaa;font-size:8.5px;text-align:${al}">${_h(block.text||key)}</div>`;
    }
  }

  // ── Data field blocks ──────────────────────────────────────────────
  const def = CV_FIELD_DEFS[key];
  if(!def) return '';

  // Method-equipment cell — place-card render of one method-data field
  // (block.methodField). The small grey label sits above the value
  // resolved from report.methodData; word-break lets the value wrap.
  if(def.methodCell){
    const mf = block.methodField;
    const mFields = (typeof TPL_FIELDS !== 'undefined' && TPL_FIELDS[cvPpvMethod]) ? TPL_FIELDS[cvPpvMethod] : [];
    const fdef = mFields.find(f => f.id === mf);
    const label = fdef ? fdef.label : (mf || 'Method field');
    // Resolve the value from the real report's eq_<field> first (what a
    // saved report actually carries), then methodData (sample / preview
    // data). Without the eq_ lookup a real report's method cells would
    // only ever show the sample equipment values.
    let val = '';
    if(report && mf){
      const eqv = report['eq_' + mf];
      val = (eqv != null && eqv !== '') ? String(eqv)
          : (report.methodData ? (report.methodData[mf] || '') : '');
    }
    let shown = val || (preview ? '—' : (mf ? (fdef && fdef.placeholder || '') : 'Pick a field in Properties'));
    // Field-pair table (CV_METHOD_FIELD_PAIRS) lives at module level so
    // both this renderer and the Properties-panel field picker share
    // the same definition — see the comment by CV_METHOD_FIELD_PAIRS
    // for the meaning of each pairing. The paired value lives on
    // report.eq_<paired-field> when the inspector typed it on the form
    // (or methodData[<paired-field>] for sample / preview data).
    const _pair = (typeof CV_METHOD_FIELD_PAIRS !== 'undefined') ? CV_METHOD_FIELD_PAIRS[mf] : null;
    if(val && _pair && report){
      const paired = report['eq_' + _pair.with]
        || (report.methodData && report.methodData[_pair.with]) || '';
      if(paired) shown = val + _pair.prefix + paired;
    }
    const valColor = val ? '#000' : (preview ? '#999' : '#bbb');
    return `<div style="height:100%;padding:3px 7px;display:flex;flex-direction:column;justify-content:center;box-sizing:border-box;text-align:${al}">
      <div style="font-size:7px;color:#777;line-height:1.3;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_h(label)}</div>
      <div style="font-size:${fs};color:${valColor};line-height:1.3;word-break:break-word">${_h(shown)}</div>
    </div>`;
  }

  // V3: Smart-link blocks (procedure/cert/calib/accept-eval)
  if(def.smartLink){
    // V29: Company-scoped smart-link fields render the live company profile
    // value at preview AND in design mode (their value is always available).
    if(def.smartLink === 'company'){
      const co2 = _cvCompany();
      // Company logo: live image render. The 'Use on reports' checkbox
      // in Settings → Company → Logo area picks the slot (primary vs
      // dark); falls back to the other slot when the chosen one is
      // empty so the report always prints whatever's available.
      if(def.isLogo){
        const _useReports = (co2 && co2.logoUseOnReports === 'dark') ? 'dark' : 'primary';
        const _pri = co2.logo || '';
        const _drk = co2.logoDark || '';
        const _chosen = (_useReports === 'dark') ? (_drk || _pri) : (_pri || _drk);
        const src = _safeUrl(_chosen);
        if(src){
          return `<div style="height:100%;display:flex;align-items:center;justify-content:${jc};padding:4px"><img src="${src}" style="max-height:100%;max-width:100%;object-fit:contain"/></div>`;
        }
        return `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;${block.showBorder?'border:1px dashed #ddd;':''}color:#bbb;font-size:9px;gap:2px"><span style="font-size:20px">🏢</span>Company logo<span style="font-size:7.5px;color:#999">Upload in Settings → Company</span></div>`;
      }
      // Standard footer text — wraps to fit the block's width / height so
      // accreditation lines that don't fit on one line break onto the next
      // instead of ellipsing. pre-wrap preserves any newlines in the
      // source text; word-break:break-word handles long unbroken tokens
      // (URLs, hyphenated reg numbers).
      if(def.isCompanyFooter){
        const txt = (co2.footer && String(co2.footer).trim()) || '';
        if(txt) return `<div style="height:100%;display:flex;align-items:center;justify-content:${jc};padding:3px 7px;font-size:${fs};font-weight:${fw};font-style:${fi};color:${fc};text-align:${al};line-height:1.35;white-space:pre-wrap;word-break:break-word;overflow:hidden">${escapeHtml(txt)}</div>`;
        return `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:9px;color:#bbb;font-style:italic;text-align:center;padding:0 8px">Standard footer text — fill in Settings → Company</div>`;
      }
      // Confidentiality statement — multi-line render of co.confidstmt.
      // Uses pre-wrap so paragraph breaks in the source text survive.
      if(def.isCompanyConfidStmt){
        const txt = (co2.confidstmt && String(co2.confidstmt).trim()) || '';
        if(txt) return `<div style="height:100%;display:flex;align-items:center;justify-content:${jc};padding:3px 7px;font-size:${fs};font-weight:${fw};font-style:${fi};color:${fc};text-align:${al};line-height:1.4;white-space:pre-wrap;overflow:hidden">${escapeHtml(txt)}</div>`;
        return `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:9px;color:#bbb;font-style:italic;text-align:center;padding:0 8px">Confidentiality statement — fill in Settings → Company</div>`;
      }
      // Composite "info block": multi-line company identity.
      // Phone and email get their own lines so contact info reads as a
      // proper two-line block (matches how an inspector glances at a
      // header — phone in one row, email below).
      if(def.isCompanyBlock){
        const lines = [
          co2.name,
          co2.addr1, co2.addr2,
          [co2.post, co2.city].filter(Boolean).join(' '),
          co2.country,
          co2.phone,
          co2.email,
          co2.web,
        ].filter(s => s && s.trim());
        const content = lines.length
          ? lines.map(l => `<div>${escapeHtml(l)}</div>`).join('')
          : `<div style="color:#999;font-style:italic">Fill in Settings → Company to populate</div>`;
        return `<div style="height:100%;padding:4px 7px;box-sizing:border-box;line-height:1.4;font-size:${fs};font-weight:${fw};font-style:${fi};color:${fc};text-align:${al}">${content}</div>`;
      }
      // Single-value field (name, phone, email, etc.): use the def.get() result directly
      const value = def.get(report) || '—';
      return `<div style="height:100%;padding:4px 7px;box-sizing:border-box;display:flex;align-items:center;justify-content:${jc};white-space:pre-wrap;line-height:1.35;font-size:${fs};font-weight:${fw};font-style:${fi};color:${fc};text-align:${al}">${escapeHtml(value)}</div>`;
    }
    // Non-company smart-link fields. accept-eval still needs report-
    // specific defect measurements, so it keeps the "resolves at preview/
    // export" placeholder until a real report is in preview. The rest —
    // cert / calib / light status and procedure-link — resolve live in
    // design mode too: they read from Settings (Inspectors / Equipment /
    // NDT procedures) against the sample or preview-selected report, the
    // way the company smart fields do.
    const liveSmart = def.smartLink === 'cert' || def.smartLink === 'calib'
      || def.smartLink === 'calib2'
      || def.smartLink === 'light' || def.smartLink === 'uvlight'
      || def.smartLink === 'lightcond' || def.smartLink === 'procedure'
      || def.smartLink === 'eyecert';
    const smartReport = report || (liveSmart ? cvBuildReport(cvPpvMethod, cvPpvResult, cvPpvShowDefects) : null);
    const inner = smartReport
      ? cvResolveSmartLink(block, smartReport)
      : `<div style="display:flex;align-items:center;gap:6px;height:100%">
          <span style="background:rgba(167,139,250,.15);color:#6d28d9;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:600">⚡ SMART</span>
          <div style="flex:1;min-width:0;line-height:1.25"><div style="font-weight:600;font-size:9px">${escapeHtml(def.label)}</div><div style="font-size:8px;color:#666">Resolves at preview/export</div></div>
        </div>`;
    return `<div style="height:100%;padding:4px 7px;box-sizing:border-box">${inner}</div>`;
  }

  // V3: QR code
  if(def.qr){
    const payload = block.qrPayload || (report ? `${location.origin || 'https://verify.veritix'}/r/${report.reportNo||report.id||'sample'}` : 'sample-qr');
    const size = Math.min(block.w, block.h) - 6;
    return `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3px;box-sizing:border-box">
      ${cvRenderQR(payload, size)}
    </div>`;
  }

  // V3: Weld / defect map
  if(def.weldMap){
    return cvRenderWeldMap(block, report);
  }

  // V3: Scan image (A/B/C-scan)
  if(def.scanImg){
    const src = _safeUrl(block.scanSrc);
    if(src){
      return `<div style="height:100%;position:relative;background:#000;display:flex;align-items:center;justify-content:center"><img src="${src}" style="max-width:100%;max-height:100%;object-fit:contain"/>
        ${(block.scanAnnotations||[]).map((a,i)=>`<div style="position:absolute;left:${(Number(a.x)||0.5)*100}%;top:${(Number(a.y)||0.5)*100}%;background:rgba(255,80,80,.85);color:#fff;font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;transform:translate(-50%,-50%);border:2px solid #fff;pointer-events:none">${escapeHtml(a.label||'I'+(i+1))}</div>`).join('')}
      </div>`;
    }
    return `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px dashed #ccc;color:#999;font-size:8px;background:#fafafa;gap:6px">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      <div>Scan image (A/B/C-scan)</div>
      <div style="font-size:7px;color:#bbb">Add image URL in properties</div>
    </div>`;
  }

  // V3: Defect-row repeating loop
  if(def.repeat === 'defects'){
    return cvRenderDefectLoop(block, report);
  }

  // V3: Cross-reference
  if(def.xref){
    const ref = block.xrefTarget || 'defect-1';
    const resolved = cvCrossRefMap[ref] || 'pending';
    return `<div style="height:100%;display:flex;align-items:center;padding:3px 7px;text-align:${al};font-size:${fs};color:${_safeColor(block.color,'#0066cc')};text-decoration:underline;font-style:italic">
      ${_h(block.text || 'See ')}${_h(ref.replace('-',' '))}${preview ? ' on '+_h(resolved) : ''}
    </div>`;
  }

  let value = report ? (() => { try{ return def.get(report); }catch(e){ return def.ph||'—'; } })() : def.ph||'';

  // Items-table support — if this card maps to a per-item column (subject,
  // drawing, welders, …) and the report carries more than one inspected
  // item, expand the value column into a stack of N values, one per item.
  // Each value is resolved by calling def.get against a shallow merge of
  // the report with the item row, so card-specific formatters keep
  // working. Single-item reports fall through to the existing single-value
  // path and render exactly as before.
  let itemValues = null;
  if(report && Array.isArray(report.items) && report.items.length > 1
     && def.mapTo && typeof RPT_ITEM_FIELD_IDS !== 'undefined'
     && RPT_ITEM_FIELD_IDS.indexOf(def.mapTo) >= 0
     && !def.sig && !def.multi){
    itemValues = report.items.map(it => {
      try { return def.get(Object.assign({}, report, it)) || '—'; }
      catch(e) { return '—'; }
    });
  }

  // V3: Apply format string if set
  if(block.format && value !== '' && value !== '—'){
    value = cvFormatValue(value, block.format);
  }

  // V3: Apply language label override
  if(block.langLabel && cvPpvLanguage !== 'en'){
    const labelKey = block.langLabel;
    const langLabels = CV_LANG_LABELS[cvPpvLanguage] || CV_LANG_LABELS.en;
    if(langLabels[labelKey]) block.text = langLabels[labelKey];
  }
  // SECURITY: value comes from report data (free-form user input), so escape
  // it before injecting into the field renderers below. The block label
  // (block.text||def.label) is also escaped — def.label is from constants
  // today, but the same render path would propagate any future user-editable
  // override unsafely.
  const vEsc = _h(value);
  const lblEsc = _h(block.text||def.label);
  if(def.computed){
    // Render computed/calculated field with a subtle distinguishing accent.
    // The "computed" marker lives on the palette badge (∑ chip) — printing
    // it again in front of every placed card was visual noise, especially
    // in tight footer rows where "∑ Page" stacked above "Page 1 of 3".
    return `<div style="height:100%;padding:3px 7px;display:flex;flex-direction:column;justify-content:center;text-align:${al};box-sizing:border-box">
      <div style="font-size:7px;color:#777;line-height:1.3;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${lblEsc}</div>
      <div style="font-size:${fs};font-weight:${fw||'600'};font-style:${fi};border-bottom:0.5px dashed ${preview?'transparent':'#a78bfa'};min-height:11px;color:${preview?'#0d9488':'#a78bfa'};padding-bottom:1px">${vEsc}</div>
    </div>`;
  }

  if(def.result){
    const rcolor = {Pass:'#065f46',Fail:'#991b1b',Monitor:'#92400e',Acceptable:'#065f46','Not acceptable':'#991b1b',Inconclusive:'#92400e'};
    const rbg    = {Pass:'#d1fae5',Fail:'#fee2e2',Monitor:'#fef3c7',Acceptable:'#d1fae5','Not acceptable':'#fee2e2',Inconclusive:'#fef3c7'};
    // Pill renders one row. `rawKey` is the unmodified verdict string (used
    // for the colour swatch lookup); `displayText` is what the user reads
    // (matches the all-caps transform def.get applies to single-row).
    const pill = (rawKey, displayText) => {
      const rc = rcolor[rawKey]||'#555'; const rb = rbg[rawKey]||'#f9f9f9';
      return `<div style="padding:3px 10px;border:1.5px solid ${rc};color:${rc};background:${rb};font-weight:bold;font-style:${fi};font-size:${fs};display:inline-block">${_h(displayText||rawKey||'—')}</div>`;
    };
    let body;
    if(itemValues){
      body = `<div style="display:flex;flex-direction:column;gap:3px">${
        report.items.map((it, i) => pill(it.verdict || '', itemValues[i])).join('')
      }</div>`;
    } else {
      const rk = preview ? (report.result||report.verdict||'') : '';
      // `value` (pre-escape) is what def.get returned — typically the
      // uppercased display text. Falls back to the raw key if def.get
      // produced nothing useful.
      body = pill(rk, value || rk);
    }
    return `<div style="height:100%;padding:3px 7px;display:flex;flex-direction:column;justify-content:center;text-align:${al}">
      <div style="font-size:7px;color:#777;line-height:1.3;margin-bottom:2px">${lblEsc}</div>
      ${body}
    </div>`;
  }
  if(def.sig){
    const sh = Math.max(0, block.h-26);
    // The inspector-signature card auto-fills from the selected
    // inspector's registered signature image (Settings → Inspectors).
    let sigImg = '';
    if(key === 'insp-sig' && report && report.inspector){
      try {
        const _ins = (typeof INSPECTORS !== 'undefined' && Array.isArray(INSPECTORS) && INSPECTORS.length)
          ? INSPECTORS
          : (typeof ls === 'function' ? ls('vx-inspectors-v1', []) : []);
        const _m = (_ins || []).find(p => p && (p.name === report.inspector || p.id === report.inspector));
        if(_m && _m.signature) sigImg = _m.signature;
      } catch(e){}
    }
    const sigInner = sigImg
      ? `<img src="${sigImg}" alt="signature" style="height:${Math.max(10, sh-3)}px;max-width:100%;object-fit:contain;object-position:${al==='right'?'right':al==='center'?'center':'left'} bottom"/>`
      : '';
    return `<div style="height:100%;padding:3px 7px;text-align:${al}">
      <div style="font-size:7px;color:#777;line-height:1.3;margin-bottom:2px">${lblEsc}</div>
      <div style="height:${sh}px;${block.showBorder?'border-bottom:0.5px solid #000;':''}">${sigInner}</div>
    </div>`;
  }
  if(def.multi){
    return `<div style="height:100%;padding:3px 7px;text-align:${al}">
      <div style="font-size:7px;color:#777;line-height:1.3;margin-bottom:2px">${lblEsc}</div>
      <div style="font-size:${fs};font-weight:${fw};font-style:${fi};color:${preview?'#000':'#bbb'};${block.showBorder?`border-bottom:0.5px solid ${preview?'transparent':'#ddd'};`:''};padding-bottom:2px;line-height:1.5;word-break:break-word">${vEsc}</div>
    </div>`;
  }

  // Standard labeled field. Fields tagged with def.noLabel render only the
  // value (used by method, tpl-number — the default label would just
  // duplicate what the value already conveys).
  // A user override survives only if it differs from def.label — older
  // blocks placed before noLabel was added carry block.text === def.label
  // and we want those to honour the new no-label rendering too.
  const blockTextRaw = block.text && String(block.text).trim();
  const isDefaultLabel = blockTextRaw && blockTextRaw === String(def.label || '').trim();
  const skipLabel = def.noLabel && (!blockTextRaw || isDefaultLabel);
  // Multi-row items rendering — stack one value per inspected item. Each
  // row is a div so the editor's existing word-break / wrap rules apply
  // per cell; a 0.5px divider between rows hints at the table structure
  // without needing extra borders on every place card.
  const valueRows = itemValues
    ? itemValues.map((v, i) => `<div style="${i ? 'border-top:0.5px solid #e5e7eb;padding-top:2px;margin-top:2px;' : ''}font-size:${fs};font-weight:${fw};font-style:${fi};color:${preview?'#000':'#bbb'};line-height:1.35;white-space:normal;word-break:break-word">${_h(v)}</div>`).join('')
    : null;
  if(skipLabel){
    const inner = valueRows
      ? `<div style="display:flex;flex-direction:column;width:100%">${valueRows}</div>`
      : `<div style="font-size:${fs};font-weight:${fw};font-style:${fi};${block.showBorder?`border-bottom:0.5px solid ${preview?'transparent':'#ddd'};`:''};color:${preview?'#000':'#bbb'};padding-bottom:1px;line-height:1.35;white-space:normal;word-break:break-word;overflow:hidden;width:100%">${vEsc}</div>`;
    return `<div style="height:100%;padding:3px 7px;display:flex;align-items:${valueRows?'flex-start':'center'};justify-content:${jc};text-align:${al}">${inner}</div>`;
  }
  const valueBlock = valueRows
    ? `<div style="display:flex;flex-direction:column">${valueRows}</div>`
    : `<div style="font-size:${fs};font-weight:${fw};font-style:${fi};${block.showBorder?`border-bottom:0.5px solid ${preview?'transparent':'#ddd'};`:''};min-height:11px;color:${preview?'#000':'#bbb'};padding-bottom:1px;line-height:1.35;white-space:normal;word-break:break-word;overflow:hidden">${vEsc}</div>`;
  return `<div style="height:100%;padding:3px 7px;display:flex;flex-direction:column;justify-content:${valueRows?'flex-start':'center'};text-align:${al}">
    <div style="font-size:7px;color:#777;line-height:1.3;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${lblEsc}</div>
    ${valueBlock}
  </div>`;
}


// ── Selection & properties ───────────────────────────────────────────
function cvSelectBlock(id){
  _cvSelectSingle(id);
  // V23: lightweight selection update — no full canvas re-render. The block
  // contents don't change; only outline state and FAB visibility do.
  cvUpdateSelectionUI();
  cvRenderProps(id);
}

// V23: incrementally update outline + FAB visibility on already-rendered
// blocks without a full canvas re-render. Used by selection clicks and
// keyboard nudges. Falls back to a full render if any block element is
// missing (e.g. blocks were added since the last render).
function cvUpdateSelectionUI(){
  const canvas = document.getElementById('cv-canvas');
  if(!canvas){ return; }

  // Remove any existing FAB containers — only the currently-selected block
  // (if single-select) should have them.
  canvas.querySelectorAll('.cblk-fab-btn').forEach(node => {
    // Only remove the wrapper FAB containers, not individual buttons inside
    if(node.querySelector('.cblk-fab-btn')) node.remove();
  });

  // Iterate every block and update its outline state.
  cvBlocks.forEach(block => {
    const elB = document.getElementById('cblk-' + block.id);
    if(!elB){
      // Element missing — block must have been added after last render.
      // Bail out and trigger a full re-render to stay correct.
      cvRenderCanvas();
      return;
    }
    const isSel = (cvSelectedId === block.id) || cvSelectedIds.includes(block.id);
    const isLocked = _cvIsBlockLocked(block);
    if(isSel){
      // Selection visual — always shown for a selected block (matches
      // _cvBuildBlockElement). Editor chrome, independent of showBorder.
      elB.style.boxShadow = `0 0 0 2px ${isLocked?'#f5a623':'#4f8ef7'},0 0 12px 2px ${isLocked?'rgba(245,166,35,.35)':'rgba(79,142,247,.35)'}`;
    } else {
      elB.style.boxShadow = '';
    }
    elB.style.outline = '';
    elB.style.outlineOffset = '';
  });

  // Add FAB buttons to the single-selected block (if exactly one selected).
  if(!cvPreview && cvSelectedIds.length === 1){
    const sid = cvSelectedIds[0];
    const block = cvBlocks.find(b => b.id === sid);
    const elB = document.getElementById('cblk-' + sid);
    if(block && elB){
      const isLocked = _cvIsBlockLocked(block);
      const fab = document.createElement('div');
      fab.className = 'cblk-fab-btn';
      // FABs normally sit just above the block. For a block near the
      // page top the row would render off-canvas / clipped — flip it to
      // just below the block in that case.
      const fabAbove = (+block.y || 0) >= 26;
      fab.style.cssText = `position:absolute;${fabAbove ? 'top:-24px' : 'top:'+((+block.h||0)+2)+'px'};right:0;display:flex;gap:2px;z-index:300`;
      fab.innerHTML = `
        <button class="cblk-fab-btn" data-action="cvDuplicateBlock" data-args="'${block.id}'" title="${escapeHtml(t('pe.fab.duplicate','Duplicate (Ctrl+D)'))}" style="background:var(--panel);border:1px solid var(--border2);color:var(--t2);font-size:10px;padding:2px 6px;border-radius:3px;cursor:pointer;line-height:1">⧉</button>
        <button class="cblk-fab-btn" data-action="cvToggleLock" data-args="'${block.id}'" title="${escapeHtml(t(isLocked?'pe.fab.unlock':'pe.fab.lock', (isLocked?'Unlock':'Lock')+' position'))}" style="background:var(--panel);border:1px solid var(--border2);color:${isLocked?'var(--amber)':'var(--t2)'};font-size:10px;padding:2px 5px;border-radius:3px;cursor:pointer;line-height:1">${isLocked?'🔒':'🔓'}</button>
        <button class="cblk-fab-btn" data-action="cvMoveZ" data-args="'${block.id}',1" title="${escapeHtml(t('pe.fab.forward','Forward'))}" style="background:var(--panel);border:1px solid var(--border2);color:var(--t2);font-size:10px;padding:2px 5px;border-radius:3px;cursor:pointer;line-height:1">↑z</button>
        <button class="cblk-fab-btn" data-action="cvMoveZ" data-args="'${block.id}',-1" title="${escapeHtml(t('pe.fab.back','Back'))}" style="background:var(--panel);border:1px solid var(--border2);color:var(--t2);font-size:10px;padding:2px 5px;border-radius:3px;cursor:pointer;line-height:1">↓z</button>
        <button class="cblk-fab-btn" data-action="cvDeleteBlock" data-args="'${block.id}'" title="Delete" style="background:rgba(242,92,92,.15);border:1px solid rgba(242,92,92,.3);color:#f87171;font-size:10px;padding:2px 6px;border-radius:3px;cursor:pointer;line-height:1">✕</button>`;
      elB.appendChild(fab);
    }
  }
  // V25: refresh persistent alignment guides whenever selection changes
  _cvRefreshAlignGuides();
}

function cvRenderProps(id){
  const panel = document.getElementById('cv-props-body');
  if(!panel) return;
  if(!id){
    panel.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:9px;padding:44px 22px 0;text-align:center">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#c2c7cf" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/></svg>
      <div style="font-size:12px;font-weight:600;color:#9aa0aa">No block selected</div>
      <div style="font-size:11px;color:var(--t3);line-height:1.5;max-width:190px">Click a card on the canvas to edit its properties, or drag a field in from the palette.</div>
    </div>`;
    return;
  }

  // Multi-select info
  if(cvSelectedIds.length > 1){
    panel.innerHTML = `
      <div style="font-size:11px;font-weight:600;color:var(--t1);margin-bottom:11px;padding-bottom:8px;border-bottom:1px solid var(--border)">${cvSelectedIds.length} blocks selected</div>
      <div style="font-size:10px;color:var(--t3);margin-bottom:12px">Shift+click to add/remove from selection</div>
      <div style="display:flex;flex-direction:column;gap:5px">
        <div style="font-size:9px;font-family:var(--mono);color:var(--t3);text-transform:uppercase;margin-bottom:3px">Align selected</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
          <button data-action="cvAlignSelected" data-args="'left'" class="btn btn-sm" style="font-size:10px">⬅ Left</button>
          <button data-action="cvAlignSelected" data-args="'right'" class="btn btn-sm" style="font-size:10px">➡ Right</button>
          <button data-action="cvAlignSelected" data-args="'top'" class="btn btn-sm" style="font-size:10px">⬆ Top</button>
          <button data-action="cvAlignSelected" data-args="'bottom'" class="btn btn-sm" style="font-size:10px">⬇ Bottom</button>
          <button data-action="cvDistributeSelected" data-args="'h'" class="btn btn-sm" style="font-size:10px;grid-column:span 2">↔ Distribute horiz.</button>
          <button data-action="cvDistributeSelected" data-args="'v'" class="btn btn-sm" style="font-size:10px;grid-column:span 2">↕ Distribute vert.</button>
        </div>
        <button data-action="cvDeleteSelected" class="btn btn-sm" style="font-size:11px;width:100%;background:rgba(242,92,92,.12);color:var(--red);border-color:rgba(242,92,92,.25);margin-top:8px">✕ Delete all selected</button>
      </div>`;
    return;
  }

  const block = cvBlocks.find(b=>b.id===id);
  if(!block){ panel.innerHTML=''; return; }
  _cvSyncRibbon(block);
  const def = !block.isLayout ? CV_FIELD_DEFS[block.key] : null;
  const title = def ? def.label.split('/')[0].trim() : block.key.replace(/-/g,' ');

  const row = (lbl, content) => `<div style="margin-bottom:9px"><div style="font-size:8.5px;font-family:var(--mono);color:var(--t3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">${lbl}</div>${content}</div>`;
  // FIX: this helper was generating
  //   data-args="'${id}','${prop}'.value"
  // which the dispatcher's args parser does NOT evaluate — `.value` was
  // passed as a literal string suffix, so cvUpdateBlock received garbage
  // and every text field in the properties panel did nothing. Route
  // through the existing typed wrappers (_wCvUpdateBlockValue / Number)
  // which read el.value themselves — same pattern the checkbox / colour /
  // numRow helpers below already use.
  const input = (prop, val, type='text') => {
    const handler = type === 'number' ? '_wCvUpdateBlockNumber' : '_wCvUpdateBlockValue';
    return `<input type="${type}" value="${String(val||'').replace(/"/g,'&quot;')}" data-prop="${prop}"
      style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:4px 6px;font-family:var(--font);box-sizing:border-box"
      data-on-change="${handler}" data-pass-el="1" data-args="'${id}','${prop}'"
      data-on-input="${handler}"  data-pass-el="1" data-args="'${id}','${prop}'"/>`;
  };
  const check = (prop, val, lbl) =>
    `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t2);cursor:pointer;margin-bottom:5px">
      <input type="checkbox" ${val?'checked':''} data-on-change="_wCvUpdateBlockChecked" data-pass-el="1" data-args="'${id}','${prop}'"/> ${lbl}
    </label>`;
  // <input type="color"> only accepts a full #rrggbb value. A 3-digit hex
  // (#000 — what the default layout stores), "transparent" (an unset
  // background), an rgb()/rgba() string or a named colour makes the
  // browser log a format warning and silently fall back. Normalise to
  // #rrggbb for the swatch; the span still shows the block's real value.
  const _toHex6 = (v) => {
    const s = (typeof v === 'string' ? v : '').trim().toLowerCase();
    let m = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
    if(m) return '#' + m[1]+m[1] + m[2]+m[2] + m[3]+m[3];
    m = s.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/);
    if(m) return '#' + m[1];
    m = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
    if(m){ const h = n => Math.max(0,Math.min(255,+n)).toString(16).padStart(2,'0'); return '#' + h(m[1]) + h(m[2]) + h(m[3]); }
    return '#000000';
  };
  const colorPick = (prop, val) =>
    `<div style="display:flex;gap:6px;align-items:center"><input type="color" value="${_toHex6(val)}" style="width:30px;height:24px;border-radius:3px;border:1px solid var(--border);padding:1px;cursor:pointer" data-on-change="_wCvUpdateBlockValue" data-pass-el="1" data-args="'${id}','${prop}'"/><span style="font-size:9px;font-family:var(--mono);color:var(--t3)">${val||'#000'}</span></div>`;
  const numRow = (prop, val) => {
    // X/Y/W/H are disabled while the block is locked — a locked block's
    // geometry is frozen, so the panel must not offer a way to change it.
    const lk  = _cvIsBlockLocked(block);
    const off = lk ? ';opacity:.5;cursor:not-allowed' : '';
    return `<div style="display:flex;align-items:stretch">
      <input type="number" step="1" value="${val||0}" data-prop="${prop}" class="cv-num"${lk?' disabled':''}
        style="flex:1;min-width:0;background:var(--bg2);border:1px solid var(--border);border-right:none;border-radius:4px 0 0 4px;color:var(--t1);font-size:11px;padding:4px 6px;box-sizing:border-box${off}"
        data-on-change="_wCvUpdateBlockNumber" data-on-input="_wCvUpdateBlockNumber" data-pass-el="1" data-args="'${id}','${prop}'"/>
      <div style="display:flex;flex-direction:column;width:22px;flex-shrink:0">
        <button type="button" class="cv-step"${lk?' disabled':''} title="Increase" data-action="cvStepBlockNum" data-args="'${id}','${prop}',1"  style="border-radius:0 4px 0 0;border-bottom:none${off}">▲</button>
        <button type="button" class="cv-step"${lk?' disabled':''} title="Decrease" data-action="cvStepBlockNum" data-args="'${id}','${prop}',-1" style="border-radius:0 0 4px 0${off}">▼</button>
      </div>
    </div>`;
  };

  // Field mapping info
  const mapInfo = def && def.mapTo ? `<div style="margin-bottom:9px;padding:5px 7px;background:rgba(79,142,247,.08);border:1px solid rgba(79,142,247,.2);border-radius:4px;font-size:10px;color:var(--blue)">📎 Maps to: <span style="font-family:var(--mono)">${def.mapTo}</span></div>` : '';

  // V3 — Smart-link configuration UI (for accept-eval block, the user can enter measurement/criterion)
  let smartLinkUI = '';
  if(def && def.smartLink === 'accept'){
    smartLinkUI = `
      <div style="background:rgba(167,139,250,.06);border:1px solid rgba(167,139,250,.2);border-radius:4px;padding:7px 8px;margin-bottom:9px">
        <div style="font-size:9px;font-family:var(--mono);color:#a78bfa;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">⚡ Acceptance check</div>
        <div style="display:grid;grid-template-columns:1fr auto 1fr 1fr;gap:4px;align-items:center;margin-bottom:5px">
          ${input('measurement', block.measurement||'', 'number')}
          <select data-on-change="_wCvUpdateBlockValue" data-pass-el="1" data-args="'${id}','evalOp'" style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:3px 4px">
            ${['<=','<','>=','>','='].map(o=>`<option ${block.evalOp===o?'selected':''}>${o}</option>`).join('')}
          </select>
          ${input('criterion', block.criterion||'', 'number')}
          ${input('unit', block.unit||'mm')}
        </div>
        ${row('Standard / source', input('standard', block.standard||''))}
      </div>`;
  }
  if(def && (def.smartLink === 'procedure' || def.smartLink === 'cert' || def.smartLink === 'calib' || def.smartLink === 'calib2' || def.smartLink === 'eyecert')){
    const _slSrc = def.smartLink === 'procedure' ? 'procedures store'
      : def.smartLink === 'cert'   ? 'inspector directory'
      : def.smartLink === 'eyecert' ? 'inspector eye-sight certificate'
      : def.smartLink === 'calib2' ? 'secondary equipment register pick'
      : 'equipment calibration data';
    smartLinkUI = `<div style="background:rgba(167,139,250,.06);border:1px solid rgba(167,139,250,.2);border-radius:4px;padding:7px 8px;margin-bottom:9px;font-size:10px;color:#a78bfa">
      ⚡ <strong>Smart link</strong> — auto-resolves from ${_slSrc} at preview/export
    </div>`;
  }

  // QR payload field
  let qrUI = '';
  if(def && def.qr){
    qrUI = row('QR payload (URL or text)', input('qrPayload', block.qrPayload||''));
  }
  // Cross-ref target
  let xrefUI = '';
  if(def && def.xref){
    xrefUI = row('Reference target', `<select data-on-change="_wCvUpdateBlockValue" data-pass-el="1" data-args="'${id}','xrefTarget'" style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:4px 6px">
      ${['defect-1','defect-2','defect-3','defect-4','defect-5'].map(t=>`<option value="${t}" ${block.xrefTarget===t?'selected':''}>${t}</option>`).join('')}
    </select>`);
  }
  // Scan image source
  let scanUI = '';
  if(def && def.scanImg){
    scanUI = row('Scan image URL', input('scanSrc', block.scanSrc||''));
  }

  // V3 — Format string for data fields
  let formatUI = '';
  if(def && !def.smartLink && !def.qr && !def.weldMap && !def.scanImg && !def.repeat && !def.xref){
    const presets = ['', 'DD-MMM-YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MMM YYYY', 'upper', 'lower', '0.00', '0'];
    formatUI = `
      <div style="background:rgba(20,184,166,.05);border:1px solid rgba(20,184,166,.18);border-radius:4px;padding:7px 8px;margin-bottom:9px">
        <div style="font-size:9px;font-family:var(--mono);color:#14b8a6;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">⚙ Format</div>
        <select data-on-change="_wCvUpdateBlockFormat" data-args="'${id}'" data-pass-el="1" style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:4px 6px;margin-bottom:4px">
          ${presets.map(p=>`<option value="${p}" ${block.format===p?'selected':''}>${p||'(none)'}</option>`).join('')}
        </select>
        <input id="cv-fmt-custom-${id}" type="text" placeholder="Custom format…" value="${block.format||''}" data-on-input="_wCvUpdateBlockValue" data-pass-el="1" data-args="'${id}','format'" style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:4px 6px;font-family:var(--mono);box-sizing:border-box"/>
      </div>`;
  }

  // V3 — Conditional visibility (show-when rule)
  const swRule = block.showWhen || {};
  const fieldOptions = ['','method','verdict','result','client','indications','defectCount','heatTreat','material'];
  const showWhenUI = `
    <div style="background:rgba(79,142,247,.05);border:1px solid rgba(79,142,247,.18);border-radius:4px;padding:7px 8px;margin-bottom:9px">
      <div style="font-size:9px;font-family:var(--mono);color:var(--blue);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;display:flex;align-items:center;justify-content:space-between">
        <span>⚡ Show only when…</span>
        ${swRule.field ? `<button data-action="cvUpdateBlock" data-args="'${id}','showWhen',null" style="background:none;border:none;color:var(--red);font-size:10px;cursor:pointer;padding:0">clear</button>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:1.1fr 0.8fr 1.1fr;gap:3px;margin-bottom:4px">
        <select data-on-change="_wCvSetShowWhenValue" data-pass-el="1" data-args="'${id}','field'" style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:3px 4px">
          ${fieldOptions.map(f=>`<option value="${f}" ${swRule.field===f?'selected':''}>${f||'(off)'}</option>`).join('')}
        </select>
        <select data-on-change="_wCvSetShowWhenValue" data-pass-el="1" data-args="'${id}','op'" style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:3px 4px">
          ${['=','!=','contains','>','<','>=','<=','empty','notEmpty'].map(o=>`<option ${swRule.op===o?'selected':''}>${o}</option>`).join('')}
        </select>
        <input type="text" value="${(swRule.value||'').replace(/"/g,'&quot;')}" placeholder="value" data-on-input="_wCvSetShowWhenValue" data-pass-el="1" data-args="'${id}','value'" style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:3px 4px;font-family:var(--mono)"/>
      </div>
      <div style="font-size:9px;color:var(--t3);line-height:1.3">e.g. <code>method = RT</code>, <code>defectCount &gt; 0</code>, <code>verdict = Not acceptable</code></div>
    </div>`;

  // V3 — Comments
  const comments = block.comments || [];
  const commentsUI = `
    <div style="background:rgba(245,166,35,.05);border:1px solid rgba(245,166,35,.18);border-radius:4px;padding:7px 8px;margin-bottom:9px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:9px;font-family:var(--mono);color:var(--amber);text-transform:uppercase;letter-spacing:.06em">💬 Comments (${comments.length})</span>
        <button data-action="cvAddCommentToBlock" data-args="'${id}'" style="background:rgba(245,166,35,.15);border:1px solid rgba(245,166,35,.3);color:var(--amber);font-size:10px;padding:2px 7px;border-radius:3px;cursor:pointer">+ Add</button>
      </div>
      ${comments.map((c,ci)=>`
        <div style="background:var(--bg2);border-radius:4px;padding:5px 7px;margin-bottom:3px;${c.resolved?'opacity:0.55':''}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
            <span style="font-size:9px;font-weight:600;color:var(--t2)">${escapeHtml(c.author)}</span>
            <div style="display:flex;gap:3px">
              <button data-action="cvResolveComment" data-args="'${id}',${ci}" title="${c.resolved?'Reopen':'Resolve'}" style="background:none;border:none;color:${c.resolved?'var(--green)':'var(--t3)'};font-size:11px;cursor:pointer;padding:0">${c.resolved?'✓':'○'}</button>
              <button data-action="cvDeleteComment" data-args="'${id}',${ci}" title="Delete" style="background:none;border:none;color:var(--red);font-size:11px;cursor:pointer;padding:0">✕</button>
            </div>
          </div>
          <div style="font-size:10px;color:var(--t1);line-height:1.4;${c.resolved?'text-decoration:line-through':''}">${escapeHtml(c.text)}</div>
          <div style="font-size:8.5px;color:var(--t3);margin-top:2px;font-family:var(--mono)">${new Date(c.timestamp).toLocaleString()}</div>
        </div>`).join('')}
    </div>`;

  // Padlock at top-right of the panel header — animated, click to toggle
  // the per-block lock. .cv-padlock-anim flags the element so cvToggleLock
  // can pulse it after each toggle.
  const padlock = `<button data-action="cvToggleLock" data-args="'${id}'" class="cv-padlock-anim ${block.locked?'is-locked':''}" title="${escapeHtml(block.locked?t('pe.fab.unlock','Unlock position'):t('pe.fab.lock','Lock position'))}" style="background:none;border:none;cursor:pointer;font-size:14px;padding:0 2px;line-height:1;color:${block.locked?'var(--amber)':'var(--t3)'};margin-left:auto">${block.locked?'🔒':'🔓'}</button>`;
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid var(--border);line-height:1.4">
      <span style="font-size:11px;font-weight:600;color:var(--t1);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${title}</span>
      ${padlock}
    </div>
    ${mapInfo}
    ${smartLinkUI}
    ${qrUI}
    ${xrefUI}
    ${scanUI}
    ${row('Label / text', input('text', block.text))}
    ${block.key === 'method-cell' ? row('Method field', (() => {
      // The paired "secondary" fields (batch numbers, drying time)
      // are rendered alongside their primary partner via
      // CV_METHOD_FIELD_PAIRS, so they're hidden here to avoid the
      // user dropping a duplicate cell that just repeats what's
      // already on the consumable's place card. The previously-saved
      // selection is still honoured if it points at a hidden field.
      const mf = (typeof TPL_FIELDS !== 'undefined' && TPL_FIELDS[cvPpvMethod]) ? TPL_FIELDS[cvPpvMethod] : [];
      const hidden = (typeof CV_METHOD_FIELD_HIDDEN !== 'undefined') ? CV_METHOD_FIELD_HIDDEN : new Set();
      const visible = mf.filter(f => !hidden.has(f.id) || f.id === block.methodField);
      return `<select style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:4px 6px" data-on-change="_wCvUpdateBlockValue" data-pass-el="1" data-args="'${id}','methodField'">
        <option value="" ${!block.methodField?'selected':''}>— select —</option>
        ${visible.map(f=>`<option value="${escapeHtml(f.id)}" ${block.methodField===f.id?'selected':''}>${escapeHtml(f.label)}</option>`).join('')}
      </select>`;
    })()) : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:9px">
      ${['x','y','w','h'].map(p=>`<div style="min-width:0"><div style="font-size:8.5px;font-family:var(--mono);color:var(--t3);margin-bottom:2px;text-transform:uppercase">${p.toUpperCase()}</div>${numRow(p,block[p])}</div>`).join('')}
    </div>
    ${row('Font',`<select style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:4px 6px" data-on-change="_wCvUpdateBlockValue" data-pass-el="1" data-args="'${id}','fontFamily'">
      <option value="" ${!block.fontFamily?'selected':''}>Default (Arial)</option>
      ${CV_FONT_LIST.map(f=>`<option value="${f}" ${block.fontFamily===f?'selected':''}>${f}</option>`).join('')}
    </select>`)}
    ${row((block.key === 'items-table' || block.key === 'defect-table') ? 'Table font size' : 'Font size',`<select style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:4px 6px" data-on-change="_wCvUpdateBlockValue" data-pass-el="1" data-args="'${id}','fontSize'">
      ${['6px','7px','7.5px','8px','8.5px','9px','10px','11px','12px','14px','16px','20px'].map(s=>`<option value="${s}" ${block.fontSize===s?'selected':''}>${s}</option>`).join('')}
    </select>`)}
    ${(block.key === 'items-table' || block.key === 'method-block' || block.key === 'defect-table') ? row('Heading font size',`<select style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:4px 6px" data-on-change="_wCvUpdateBlockValue" data-pass-el="1" data-args="'${id}','titleFontSize'">
      ${['8px','9px','10px','11px','12px','13px','14px','16px','18px','20px'].map(s=>`<option value="${s}" ${(block.titleFontSize||'11px')===s?'selected':''}>${s}</option>`).join('')}
    </select>`) : ''}
    ${(block.key === 'items-table' || block.key === 'method-block' || block.key === 'photo-page' || block.key === 'drawing-page' || block.key === 'single-photo' || block.key === 'single-drawing' || block.key === 'photo-details' || block.key === 'defect-table')
      ? row('Heading colour', colorPick('barColor', block.barColor || ((typeof cvTplCfg !== 'undefined' && cvTplCfg.sectionColor) ? cvTplCfg.sectionColor : '#404040')))
      : ''}
    ${block.key === 'items-table' && typeof RPT_FORM !== 'undefined' && Array.isArray(RPT_FORM.items) ? (() => {
      const itemCols = RPT_FORM.items;
      const widths = (Array.isArray(block.colWidths) && block.colWidths.length === itemCols.length)
        ? block.colWidths
        : itemCols.map(c => c.width || 130);
      return row('Column widths (relative)', `<div style="display:flex;flex-direction:column;gap:3px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:6px 8px">
        ${itemCols.map((c, i) => `<div style="display:flex;align-items:center;gap:6px">
          <span style="flex:1;font-size:10px;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.label)}</span>
          <div style="display:flex;align-items:stretch;width:80px;flex-shrink:0">
            <input type="number" min="20" max="500" step="5" value="${widths[i]}" data-colw="${i}" class="cv-num"
              data-on-change="_wCvSetItemsColWidth" data-on-input="_wCvSetItemsColWidth" data-pass-el="1" data-args="'${id}',${i}"
              style="flex:1;min-width:0;background:var(--panel);border:1px solid var(--border);border-right:none;border-radius:4px 0 0 4px;color:var(--t1);font-size:11px;padding:3px 5px;box-sizing:border-box;font-family:var(--mono)"/>
            <div style="display:flex;flex-direction:column;width:22px;flex-shrink:0">
              <button type="button" class="cv-step" data-action="cvStepColWidth" data-args="'${id}',${i},1"  style="border-radius:0 4px 0 0;border-bottom:none">▲</button>
              <button type="button" class="cv-step" data-action="cvStepColWidth" data-args="'${id}',${i},-1" style="border-radius:0 0 4px 0">▼</button>
            </div>
          </div>
        </div>`).join('')}
        <button data-action="_wCvResetItemsColWidths" data-args="'${id}'" style="margin-top:4px;background:none;border:1px dashed var(--border);color:var(--t3);font-size:10px;padding:4px 6px;border-radius:3px;cursor:pointer">Reset to defaults</button>
      </div>`);
    })() : ''}
    ${block.key === 'defect-table' && typeof CV_DEFECT_COLS !== 'undefined' && Array.isArray(CV_DEFECT_COLS) ? (() => {
      // Defect-table column-widths editor — mirrors the items-table
      // version above, driven by CV_DEFECT_COLS so the column list stays
      // in sync with the render branch.
      const defCols = CV_DEFECT_COLS;
      const widths = (Array.isArray(block.colWidths) && block.colWidths.length === defCols.length)
        ? block.colWidths
        : defCols.map(c => c.width || 130);
      return row('Column widths (relative)', `<div style="display:flex;flex-direction:column;gap:3px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:6px 8px">
        ${defCols.map((c, i) => `<div style="display:flex;align-items:center;gap:6px">
          <span style="flex:1;font-size:10px;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.label)}</span>
          <div style="display:flex;align-items:stretch;width:80px;flex-shrink:0">
            <input type="number" min="20" max="500" step="5" value="${widths[i]}" data-colw="${i}" class="cv-num"
              data-on-change="_wCvSetDefectColWidth" data-on-input="_wCvSetDefectColWidth" data-pass-el="1" data-args="'${id}',${i}"
              style="flex:1;min-width:0;background:var(--panel);border:1px solid var(--border);border-right:none;border-radius:4px 0 0 4px;color:var(--t1);font-size:11px;padding:3px 5px;box-sizing:border-box;font-family:var(--mono)"/>
            <div style="display:flex;flex-direction:column;width:22px;flex-shrink:0">
              <button type="button" class="cv-step" data-action="cvStepDefectColWidth" data-args="'${id}',${i},1"  style="border-radius:0 4px 0 0;border-bottom:none">▲</button>
              <button type="button" class="cv-step" data-action="cvStepDefectColWidth" data-args="'${id}',${i},-1" style="border-radius:0 0 4px 0">▼</button>
            </div>
          </div>
        </div>`).join('')}
        <button data-action="_wCvResetDefectColWidths" data-args="'${id}'" style="margin-top:4px;background:none;border:1px dashed var(--border);color:var(--t3);font-size:10px;padding:4px 6px;border-radius:3px;cursor:pointer">Reset to defaults</button>
      </div>`);
    })() : ''}
    ${block.key === 'defect-table' ? row('Row height', `<div style="display:flex;gap:6px;align-items:center;background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:6px 8px">
      <input type="number" min="32" max="120" step="2" value="${parseInt(block.rowHeight,10)||60}" data-on-change="_wCvUpdateBlockNumber" data-on-input="_wCvUpdateBlockNumber" data-pass-el="1" data-args="'${id}','rowHeight'" class="cv-num" style="flex:1;min-width:0;background:var(--panel);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:3px 5px;box-sizing:border-box;font-family:var(--mono);text-align:center" title="Row height in px"/>
      <span style="font-size:11px;color:var(--t3)">px</span>
    </div>`) : ''}
    ${(block.key === 'photo-page' || block.key === 'drawing-page') ? row((block.key === 'drawing-page' ? 'Drawing grid' : 'Photo grid') + ' (rows × cols)', `<div style="display:flex;gap:6px;align-items:center;background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:6px 8px">
      <input type="number" min="1" max="10" value="${parseInt(block.photoRows,10) || (block.key === 'drawing-page' ? 1 : 2)}" data-on-change="_wCvUpdateBlockValue" data-on-input="_wCvUpdateBlockValue" data-pass-el="1" data-args="'${id}','photoRows'" class="cv-num" style="flex:1;min-width:0;background:var(--panel);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:3px 5px;box-sizing:border-box;font-family:var(--mono);text-align:center" title="Rows"/>
      <span style="font-size:11px;color:var(--t3)">×</span>
      <input type="number" min="1" max="6"  value="${parseInt(block.photoCols,10) || (block.key === 'drawing-page' ? 1 : 3)}" data-on-change="_wCvUpdateBlockValue" data-on-input="_wCvUpdateBlockValue" data-pass-el="1" data-args="'${id}','photoCols'" class="cv-num" style="flex:1;min-width:0;background:var(--panel);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:3px 5px;box-sizing:border-box;font-family:var(--mono);text-align:center" title="Items per row"/>
    </div>`) : ''}
    ${block.key === 'photo-details' ? (() => {
      // Link to a single-photo block on the canvas. The print pipeline
      // hides both the linked photo and this details card when the
      // photo carries no uploaded image, so each visible pair always
      // shows a real photo + its typed information.
      const allPhotos = [];
      try {
        if(Array.isArray(cvPages)){
          cvPages.forEach((pg, pi) => {
            if(!pg || !Array.isArray(pg.blocks)) return;
            pg.blocks.forEach(b => {
              if(b && b.key === 'single-photo' && b.id){
                allPhotos.push({ id: b.id, label: (b.text || 'Single image').toString(), page: pi + 1 });
              }
            });
          });
        }
      } catch(e){}
      const opts = `<option value="">— not linked —</option>` + allPhotos.map(p =>
        `<option value="${escapeHtml(p.id)}" ${block.linkedPhotoId === p.id ? 'selected' : ''}>${escapeHtml(p.label)} (page ${p.page})</option>`
      ).join('');
      const hint = allPhotos.length
        ? `Pairs this card with a photo above it. When the photo is left empty in a report, the pair hides together on print.`
        : `Drop a 'Single image' block on the canvas first, then come back here to link the two together.`;
      return row('Link to photo', `<select style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:4px 6px" data-on-change="_wCvUpdateBlockValue" data-pass-el="1" data-args="'${id}','linkedPhotoId'">${opts}</select>
        <div style="font-size:9.5px;color:var(--t3);margin-top:4px;line-height:1.35">${hint}</div>`);
    })() : ''}
    ${block.key === 'photo-page' ? (() => {
      // Per-photo details / hide-empty controls. When 'Show details card'
      // is on, each filled cell renders photo on top + a styled card
      // (heading bar in section colour + body) beneath — same look as a
      // standalone photo-details card, but managed centrally from the
      // photo-page block. Hide-empty drops unfilled cells on print so a
      // report with 1 photo shows 1 visible pair, not 1 + 5 placeholders.
      const showCard   = !!block.showDetailsCard;
      const cardH      = parseInt(block.detailsCardHeight, 10) || 70;
      const hideEmpty  = !!block.hideEmptySlots;
      return row('Per-photo details', `<div style="display:flex;flex-direction:column;gap:6px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:8px">
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t2);cursor:pointer">
          <input type="checkbox" ${showCard?'checked':''} data-on-change="_wCvUpdateBlockChecked" data-pass-el="1" data-args="'${id}','showDetailsCard'"/> Show details card under each photo
        </label>
        <div style="display:flex;gap:6px;align-items:center;${showCard?'':'opacity:0.45;pointer-events:none'}">
          <span style="font-size:10.5px;color:var(--t3);min-width:88px">Card height</span>
          <input type="number" min="30" max="240" value="${cardH}" data-on-change="_wCvUpdateBlockNumber" data-on-input="_wCvUpdateBlockNumber" data-pass-el="1" data-args="'${id}','detailsCardHeight'" class="cv-num" style="flex:1;min-width:0;background:var(--panel);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:3px 5px;box-sizing:border-box;font-family:var(--mono);text-align:center" title="Card height in px"/>
          <span style="font-size:10.5px;color:var(--t3)">px</span>
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t2);cursor:pointer;border-top:1px solid var(--border);padding-top:6px;margin-top:2px">
          <input type="checkbox" ${hideEmpty?'checked':''} data-on-change="_wCvUpdateBlockChecked" data-pass-el="1" data-args="'${id}','hideEmptySlots'"/> Hide empty slots on print
        </label>
        <div style="font-size:9.5px;color:var(--t3);line-height:1.35">${showCard?'Card body shares the caption font / colour controls below — same styling whether the cell renders as a plain caption strip or a styled card.':'Off: each photo gets a plain italic caption beneath it (legacy look).'}</div>
      </div>`);
    })() : ''}
    ${block.key === 'photo-page' ? (() => {
      // Caption styling — every control below is read by the photo-page
      // render branch via block.caption*. Show-captions off hides the
      // strip entirely (photo gets full cell height); the other controls
      // dim out while it's off but stay editable so the inspector can
      // pre-tune the styling before flipping captions back on.
      const capSize    = block.captionSize  || '7.5px';
      const capAlign   = block.captionAlign || 'center';
      const capItalic  = block.captionItalic !== false;
      const capBold    = block.captionBold  === true;
      const capColor   = block.captionColor || '#555555';
      const showCap    = block.showCaptions !== false;
      const _dim       = showCap ? '' : 'opacity:0.45;pointer-events:none';
      const sizeOpts   = ['6px','7px','7.5px','8px','8.5px','9px','10px','11px','12px']
        .map(s => `<option value="${s}" ${capSize===s?'selected':''}>${s}</option>`).join('');
      const alignBtns  = ['left','center','right'].map(a =>
        `<button data-action="cvUpdateBlock" data-args="'${id}','captionAlign','${a}'" style="padding:4px 8px;font-size:11px;border-radius:3px;border:1px solid var(--border);cursor:pointer;background:${capAlign===a?'var(--blue)':'var(--panel)'};color:${capAlign===a?'#fff':'var(--t2)'}" title="${a}">${a==='left'?'⬅':a==='center'?'↔':'➡'}</button>`).join('');
      return row('Photo captions', `<div style="display:flex;flex-direction:column;gap:6px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:8px">
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t2);cursor:pointer">
          <input type="checkbox" ${showCap?'checked':''} data-on-change="_wCvUpdateBlockChecked" data-pass-el="1" data-args="'${id}','showCaptions'"/> Show caption under each photo
        </label>
        <div style="display:flex;gap:6px;align-items:center;${_dim}">
          <select style="flex:1;min-width:0;background:var(--panel);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:3px 5px;box-sizing:border-box" data-on-change="_wCvUpdateBlockValue" data-pass-el="1" data-args="'${id}','captionSize'" title="Caption font size">${sizeOpts}</select>
          <div style="display:flex;gap:2px">${alignBtns}</div>
        </div>
        <div style="display:flex;gap:12px;${_dim}">
          <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--t2);cursor:pointer">
            <input type="checkbox" ${capItalic?'checked':''} data-on-change="_wCvUpdateBlockChecked" data-pass-el="1" data-args="'${id}','captionItalic'"/> Italic
          </label>
          <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--t2);cursor:pointer">
            <input type="checkbox" ${capBold?'checked':''}   data-on-change="_wCvUpdateBlockChecked" data-pass-el="1" data-args="'${id}','captionBold'"/> Bold
          </label>
        </div>
        <div style="${_dim}">
          <div style="font-size:9.5px;color:var(--t3);margin-bottom:3px">Caption colour</div>
          ${colorPick('captionColor', capColor)}
        </div>
      </div>`);
    })() : ''}
    ${check('bold',block.bold,'Bold')}
    ${check('italic',block.italic,'Italic')}
    ${check('underline',block.underline,'Underline')}
    ${check('strike',block.strike,'Strikethrough')}
    ${check('showBorder',block.showBorder,'Show border')}
    ${check('locked',block.locked,'Lock position 🔒')}
    ${row('Alignment',`<div style="display:flex;gap:3px">
      ${['left','center','right','justify'].map(a=>`<button data-action="cvUpdateBlock" data-args="'${id}','align','${a}'" style="flex:1;padding:4px 2px;font-size:11px;border-radius:3px;border:1px solid var(--border);cursor:pointer;background:${block.align===a?'var(--blue)':'var(--bg2)'};color:${block.align===a?'#fff':'var(--t2)'}">${a==='left'?'⬅':a==='center'?'↔':a==='right'?'➡':'☰'}</button>`).join('')}
    </div>`)}
    ${row('Text colour', colorPick('color', block.color||'#000000'))}
    ${row('Background',  colorPick('bgColor', block.bgColor||'transparent'))}
    <div style="margin-bottom:9px;${block.showBorder?'':'opacity:0.45;pointer-events:none'}"><div style="font-size:8.5px;font-family:var(--mono);color:var(--t3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Border colour</div>${colorPick('borderColor', block.borderColor||'#cccccc')}</div>
    ${formatUI}
    ${showWhenUI}
    ${commentsUI}
    <div style="display:flex;flex-direction:column;gap:5px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
      <button data-action="cvDuplicateBlock" data-args="'${id}'" class="btn btn-sm" style="font-size:11px;width:100%">⧉ Duplicate (Ctrl+D)</button>
      <div style="display:flex;gap:5px">
        <button data-action="cvMoveZ" data-args="'${id}',1" class="btn btn-sm" style="font-size:11px;flex:1">↑ Front</button>
        <button data-action="cvMoveZ" data-args="'${id}',-1" class="btn btn-sm" style="font-size:11px;flex:1">↓ Back</button>
      </div>
      <button data-action="cvDeleteBlock" data-args="'${id}'" class="btn btn-sm" style="font-size:11px;width:100%;background:rgba(242,92,92,.12);color:var(--red);border-color:rgba(242,92,92,.25)">✕ Delete block (Del)</button>
    </div>`;
}

// V3: helper to set a key on the showWhen rule object
function cvSetShowWhen(id, key, value){
  const block = cvBlocks.find(b=>b.id===id);
  if(!block) return;
  if(!block.showWhen) block.showWhen = { field:'', op:'=', value:'' };
  block.showWhen[key] = value;
  // If field is cleared, drop the rule
  if(key === 'field' && !value) block.showWhen = null;
  cvSaveLayout();
  cvRenderCanvas();
  cvRenderProps(id);
}

// ════════════════════════════════════════════════════════════════════
// V3 LAYERS PANEL — tab switcher and z-order list
// ════════════════════════════════════════════════════════════════════
function cvSwitchRsbTab(which){
  const tabs = ['props', 'layers'];
  tabs.forEach(t => {
    const btn = document.getElementById('cv-rsb-tab-'+t);
    const body = document.getElementById('cv-'+t+'-body');
    if(t === which){
      if(btn){ btn.classList.add('active'); btn.style.color='var(--t1)'; btn.style.borderBottomColor='var(--cyan)'; }
      if(body) body.style.display = 'block';
    } else {
      if(btn){ btn.classList.remove('active'); btn.style.color='var(--t3)'; btn.style.borderBottomColor='transparent'; }
      if(body) body.style.display = 'none';
    }
  });
  if(which === 'layers') cvRenderLayers();
}

function cvBlockDisplayName(b){
  if(b.isLayout){
    const item = _cvAllLayoutItems().find(i => i.key === b.key);
    return item ? item.label : b.key.replace(/-/g,' ');
  }
  const def = CV_FIELD_DEFS[b.key];
  if(def) return def.label.split(' / ')[0].split(' ').slice(0,4).join(' ');
  return b.key.replace(/-/g,' ');
}

function cvBlockTypeIcon(b){
  if(b.isLayout) return '▢';
  const def = CV_FIELD_DEFS[b.key];
  if(!def) return '·';
  if(def.smartLink) return '⚡';
  if(def.computed)  return '∑';
  if(def.qr)        return '▦';
  if(def.weldMap)   return '⊕';
  if(def.scanImg)   return '▤';
  if(def.repeat)    return '↻';
  if(def.xref)      return '↗';
  if(def.sig)       return '✍';
  if(def.result)    return '★';
  if(def.multi)     return '¶';
  return 'f';
}

function cvRenderLayers(){
  const body = document.getElementById('cv-layers-body');
  const countEl = document.getElementById('cv-layers-count');
  if(!body) return;
  if(countEl) countEl.textContent = '('+cvBlocks.length+')';
  if(!cvBlocks.length){
    body.innerHTML = '<div style="padding:30px 16px;font-size:12px;color:var(--t3);text-align:center;line-height:1.7">No blocks on this page.<br>Drag from the palette →</div>';
    return;
  }
  // Sort by zIndex desc (front-most first)
  const sorted = [...cvBlocks].sort((a,b) => (b.zIndex||0) - (a.zIndex||0));
  let html = `<div style="padding:6px 8px;border-bottom:1px solid var(--border);background:var(--bg2);font-size:9px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em;display:flex;align-items:center;justify-content:space-between">
    <span>${cvBlocks.length} blocks · top → bottom</span>
    <button data-action="cvSelectAllBlocks" style="background:none;border:none;color:var(--cyan);font-size:9px;cursor:pointer;padding:0;text-transform:uppercase">Select all</button>
  </div>`;
  sorted.forEach(b => {
    const sel = b.id === cvSelectedId || cvSelectedIds.includes(b.id);
    const icon = cvBlockTypeIcon(b);
    const name = cvBlockDisplayName(b);
    const hasComment = b.comments && b.comments.some(c => !c.resolved);
    const hasShowWhen = b.showWhen && b.showWhen.field;
    html += `<div class="cv-layer-row" data-action="cvLayerSelect" data-pass-event="1" data-args="'${b.id}'" ${sel?'data-sel="1"':''}>
      <span style="width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:11px;background:rgba(255,255,255,.04);color:var(--t2);border-radius:3px;flex-shrink:0">${icon}</span>
      <span style="flex:1;min-width:0;font-size:11px;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${b.locked?'opacity:.6':''}">${escapeHtml(name)}</span>
      ${hasComment ? '<span title="Has unresolved comment" style="color:var(--amber);font-size:10px">●</span>' : ''}
      ${hasShowWhen ? '<span title="Conditional visibility" style="color:var(--blue);font-size:10px">⚡</span>' : ''}
      <button data-action="cvToggleLock" data-args="'${b.id}'" data-stop-prop="1" class="cv-padlock-anim" title="${b.locked?'Unlock':'Lock'}" style="background:none;border:none;color:${b.locked?'var(--amber)':'var(--t3)'};font-size:11px;cursor:pointer;padding:1px 3px;line-height:1;opacity:${b.locked?'1':'.55'}">${b.locked?'🔒':'🔓'}</button>
      <div style="display:flex;flex-direction:column;gap:1px">
        <button data-action="cvMoveZ" data-args="'${b.id}',1" data-stop-prop="1" title="Bring forward" style="background:none;border:none;color:var(--t3);font-size:8px;cursor:pointer;padding:0 2px;line-height:1;opacity:.7">▲</button>
        <button data-action="cvMoveZ" data-args="'${b.id}',-1" data-stop-prop="1" title="Send backward" style="background:none;border:none;color:var(--t3);font-size:8px;cursor:pointer;padding:0 2px;line-height:1;opacity:.7">▼</button>
      </div>
    </div>`;
  });
  body.innerHTML = html;
}

function cvLayerSelect(id, evt){
  if(evt && evt.shiftKey){
    // Multi-select toggle
    const i = cvSelectedIds.indexOf(id);
    if(i >= 0) cvSelectedIds.splice(i, 1);
    else cvSelectedIds.push(id);
    _cvPrimaryToLast();   // toggle convention: last-touched becomes primary
  } else {
    _cvSelectSingle(id);
    cvSwitchRsbTab('props');
  }
  cvRenderCanvas();
  cvRenderProps(cvSelectedId);
  cvRenderLayers();
}

function cvSelectAllBlocks(){
  cvSelectedIds = cvBlocks.map(b => b.id);
  _cvPrimaryToFirst();    // batch convention: first-in-document becomes primary
  cvRenderCanvas();
  cvRenderProps(cvSelectedId);
}

// ════════════════════════════════════════════════════════════════════
// V3 RIBBON HELPERS — preview source, language, find/replace, history
// ════════════════════════════════════════════════════════════════════

function cvSetPreviewSource(reportNo){
  cvPpvReportId = reportNo || null;
  // If a report is selected, infer method/result from it for the preview
  if(cvPpvReportId){
    const reports = ls(KEYS.reports, []);
    const r = reports.find(x => x.reportNo === cvPpvReportId || x.id === cvPpvReportId);
    if(r){
      if(r.method) cvPpvMethod = r.method;
      cvPpvResult = r.verdict === 'Acceptable' ? 'Pass' : r.verdict === 'Not acceptable' ? 'Fail' : 'Monitor';
      const sel = document.getElementById('cv-method-select'); if(sel) sel.value = r.method || cvPpvMethod;
      cvRenderMethodBtns();
    }
  }
  // Always end up in preview mode so the user can see the result
  if(!cvPreview && cvPpvReportId){
    cvPreview = true;
    const btn=document.getElementById('cv-mode-btn');
    if(btn){ btn.classList.add('on'); btn.textContent='✏️ Edit'; }
  }
  // Update the preview badge
  const badge = document.getElementById('cv-preview-badge');
  if(badge){
    if(cvPpvReportId){
      badge.style.display = 'inline-block';
      badge.textContent = '⚡ Live: ' + cvPpvReportId;
    } else {
      badge.style.display = 'none';
    }
  }
  cvRenderCanvas();
}

function cvRefreshPreviewSource(){
  const sel = document.getElementById('cv-ppv-source');
  if(!sel) return;
  const reports = (typeof ls === 'function') ? ls(KEYS.reports, []) : [];
  const recent = reports.slice(-30).reverse();
  const cur = cvPpvReportId || '';
  sel.innerHTML = '<option value="">Sample data</option>' + recent.map(r => {
    const id = r.reportNo || r.id || '';
    const v = r.verdict === 'Acceptable' ? '✓' : r.verdict === 'Not acceptable' ? '✕' : '·';
    const subj = (r.subject || r.client || '—').slice(0, 24);
    return `<option value="${escapeHtml(id)}" ${id===cur?'selected':''}>${v} ${escapeHtml(id)} — ${escapeHtml(subj)}</option>`;
  }).join('');
}

function cvOpenSelectedReport(){
  if(!cvPpvReportId){ toast(t('toast.no_report','No report selected.'), 'warn'); return; }
  toast(t('toast.switch_to_reports','Switch to Reports page to view this report.'), 'info');
}

function cvSetLanguage(lang){
  cvPpvLanguage = lang;
  if(cvPreview) cvRenderCanvas();
  toast(tf('toast.preview_language','Preview language: {lang}', {lang: lang.toUpperCase()}), 'info');
}

// ── FIND & REPLACE MODAL ──────────────────────────────────────────
function cvOpenFindReplace(){
  let modal = document.getElementById('cv-fr-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'cv-fr-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    modal.innerHTML = `<div style="background:var(--panel);border:1px solid var(--border2);border-radius:14px;width:440px;max-width:96vw;box-shadow:var(--sh-xl);overflow:hidden">
      <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:14px;font-weight:600;color:var(--t1)">Find &amp; replace in template</div>
        <button data-action="_wRemoveById" data-args="\'cv-fr-modal\'" style="background:none;border:none;color:var(--t2);font-size:16px;cursor:pointer">✕</button>
      </div>
      <div style="padding:18px">
        <div style="font-size:11px;font-weight:500;color:var(--t2);margin-bottom:5px">Find</div>
        <input id="cv-fr-find" type="text" placeholder="Text to find…" style="width:100%;background:var(--bg2);border:1px solid var(--border2);border-radius:6px;color:var(--t1);font-size:13px;padding:9px 11px;margin-bottom:12px;font-family:var(--font);box-sizing:border-box"/>
        <div style="font-size:11px;font-weight:500;color:var(--t2);margin-bottom:5px">Replace with</div>
        <input id="cv-fr-rep" type="text" placeholder="Replacement text…" style="width:100%;background:var(--bg2);border:1px solid var(--border2);border-radius:6px;color:var(--t1);font-size:13px;padding:9px 11px;margin-bottom:14px;font-family:var(--font);box-sizing:border-box"/>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-sm" data-action="_wRemoveById" data-args="\'cv-fr-modal\'">Cancel</button>
          <button class="btn btn-sm" data-action="cvDoFindReplace" data-args="false">Replace once</button>
          <button class="btn btn-sm btn-primary" data-action="cvDoFindReplace" data-args="true">Replace all</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(modal);
    openA11yModal(modal);
    requestAnimationFrame(() => document.getElementById('cv-fr-find')?.focus());
  }
}
function cvDoFindReplace(all){
  const find = document.getElementById('cv-fr-find').value;
  const rep  = document.getElementById('cv-fr-rep').value;
  if(!find){ toast(t('toast.find_text_required','Enter find text.'), 'warn'); return; }
  cvPushUndo();
  const n = cvFindReplace(find, rep, all);
  toast(n ? `${n} replacement${n!==1?'s':''} made` : 'No matches', n ? 'success' : 'info');
  document.getElementById('cv-fr-modal').remove();
}

// ── VERSION HISTORY MODAL ─────────────────────────────────────────
function cvOpenHistory(){
  // Save current as snapshot first if changed
  cvSaveSnapshot('Before opening history');
  const list = ls(CV_HISTORY_KEY, []).slice().reverse();
  let modal = document.getElementById('cv-hist-modal');
  if(modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'cv-hist-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
  const items = list.length ? list.map(s => {
    const blocks = (s.pages||[]).reduce((a,p)=>a+(p.blocks?.length||0),0);
    return `<div style="padding:11px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:10px;transition:background var(--motion-fast)" onmouseenter="this.style.background='var(--panel2)'" onmouseleave="this.style.background=''">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:var(--t1);font-weight:500">${escapeHtml(s.label||'Snapshot')}</div>
        <div style="font-size:11px;color:var(--t3);font-family:var(--mono);margin-top:2px">${new Date(s.timestamp).toLocaleString()} · ${s.user||'Anonymous'} · ${blocks} blocks · ${s.pages?.length||1} page(s)</div>
      </div>
      <button class="btn btn-sm" data-action="_wCvLoadSnapshotAndClose" data-args="${s.timestamp}">Restore</button>
    </div>`;
  }).join('') : '<div style="padding:40px;text-align:center;color:var(--t3);font-size:13px">No saved versions yet.<br><span style="font-size:11px">Snapshots save automatically.</span></div>';
  modal.innerHTML = `<div style="background:var(--panel);border:1px solid var(--border2);border-radius:14px;width:540px;max-width:96vw;max-height:80vh;display:flex;flex-direction:column;box-shadow:var(--sh-xl);overflow:hidden">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:14px;font-weight:600;color:var(--t1)">Version history (${list.length})</div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-sm btn-primary" data-action="_wCvSaveSnapshotPrompt">+ Save snapshot now</button>
        <button data-action="_wRemoveById" data-args="\'cv-hist-modal\'" style="background:none;border:none;color:var(--t2);font-size:16px;cursor:pointer">✕</button>
      </div>
    </div>
    <div style="overflow-y:auto;flex:1">${items}</div>
  </div>`;
  document.body.appendChild(modal);
  openA11yModal(modal);
}

// ── COMMENTS MODAL (all-comments view) ────────────────────────────
function cvOpenComments(){
  const all = cvAllComments();
  let modal = document.getElementById('cv-com-modal');
  if(modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'cv-com-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
  const items = all.length ? all.map(c => `
    <div style="padding:11px 14px;border-bottom:1px solid var(--border);${c.resolved?'opacity:.55':''}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:11px;font-weight:600;color:var(--t1)">${escapeHtml(c.author)} <span style="color:var(--t3);font-weight:normal">on</span> <code style="font-size:10px;color:var(--cyan)">${escapeHtml(c.blockText||c.blockId).slice(0,40)}</code></span>
        <span style="font-size:10px;color:var(--t3);font-family:var(--mono)">${new Date(c.timestamp).toLocaleString()}</span>
      </div>
      <div style="font-size:13px;color:var(--t1);line-height:1.5;${c.resolved?'text-decoration:line-through':''}">${escapeHtml(c.text)}</div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn btn-xs" data-action="_wCvJumpToComment" data-args="${c.pageIdx},'${c.blockId}'">Go to block</button>
        <button class="btn btn-xs" data-action="_wCvResolveCommentAndReopen" data-args="'${c.blockId}',${c.commentIdx}">${c.resolved?'Reopen':'Resolve'}</button>
      </div>
    </div>`).join('') : '<div style="padding:40px;text-align:center;color:var(--t3);font-size:13px">No comments yet.<br><span style="font-size:11px">Click any block then add a comment from its properties panel.</span></div>';
  modal.innerHTML = `<div style="background:var(--panel);border:1px solid var(--border2);border-radius:14px;width:560px;max-width:96vw;max-height:80vh;display:flex;flex-direction:column;box-shadow:var(--sh-xl);overflow:hidden">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:14px;font-weight:600;color:var(--t1)">Comments (${all.length} total · ${all.filter(c=>!c.resolved).length} unresolved)</div>
      <button data-action="_wRemoveById" data-args="\'cv-com-modal\'" style="background:none;border:none;color:var(--t2);font-size:16px;cursor:pointer">✕</button>
    </div>
    <div style="overflow-y:auto;flex:1">${items}</div>
  </div>`;
  document.body.appendChild(modal);
  openA11yModal(modal);
}

// ── Block operations ─────────────────────────────────────────────────
//
// Typed wrappers for the property-panel inputs. The dispatcher's args
// parser treats `'foo'.checked` and `'bar'.value` as opaque strings — it
// does NOT evaluate `el.checked` or `el.value` for you. So every checkbox
// / select / colour-picker / number input in the properties panel needs a
// wrapper that reads the value from the element and forwards it correctly
// to cvUpdateBlock or cvSetShowWhen. Previously this was attempted inline
// via `data-args="'showBorder'.checked"` which silently set the block
// property to the literal string `"'showBorder'.checked"` instead of the
// boolean — making the "Show border" toggle and every other property
// control effectively non-functional.
function _wCvUpdateBlockChecked(id, prop, el) { cvUpdateBlock(id, prop, el.checked); }
function _wCvUpdateBlockValue  (id, prop, el) { cvUpdateBlock(id, prop, el.value);   }
function _wCvUpdateBlockNumber (id, prop, el) { cvUpdateBlock(id, prop, +el.value);  }
function _wCvSetShowWhenValue  (id, key,  el) { cvSetShowWhen(id, key, el.value);    }

// Update a single column width on an items-table block. Lazily creates
// block.colWidths from the RPT_FORM.items defaults so the first edit
// only mutates the column the user touched, leaving the others intact.
function _wCvSetItemsColWidth(id, colIdx, el) {
  const block = cvBlocks.find(b => b.id === id);
  if(!block || typeof RPT_FORM === 'undefined' || !Array.isArray(RPT_FORM.items)) return;
  const cols = RPT_FORM.items;
  const widths = (Array.isArray(block.colWidths) && block.colWidths.length === cols.length)
    ? block.colWidths.slice()
    : cols.map(c => c.width || 130);
  const v = +el.value;
  widths[colIdx] = (Number.isFinite(v) && v >= 20) ? v : (cols[colIdx]?.width || 130);
  cvUpdateBlock(id, 'colWidths', widths);
}
// Step a single items-table column width by ±5 — the ▲/▼ buttons beside
// each width field, styled identically (.cv-num + .cv-step) to the
// X/Y/W/H geometry steppers.
function cvStepColWidth(id, colIdx, delta){
  const block = cvBlocks.find(b => b.id === id);
  if(!block || typeof RPT_FORM === 'undefined' || !Array.isArray(RPT_FORM.items)) return;
  const cols = RPT_FORM.items;
  const widths = (Array.isArray(block.colWidths) && block.colWidths.length === cols.length)
    ? block.colWidths.slice()
    : cols.map(c => c.width || 130);
  const cur = (+widths[colIdx]) || (cols[colIdx]?.width || 130);
  widths[colIdx] = Math.min(500, Math.max(20, cur + (+delta || 0) * 5));
  cvUpdateBlock(id, 'colWidths', widths);
  // cvUpdateBlock skips the props re-render for 'c…' props, so push the
  // new value straight into the width field.
  const inp = document.querySelector('#cv-props-body [data-colw="' + colIdx + '"]');
  if(inp) inp.value = widths[colIdx];
}
// Reset back to RPT_FORM.items defaults. Forces a props-panel re-render
// because cvUpdateBlock skips that for props starting with 'c' (intended
// for active text-typing — colWidths inherits the skip incorrectly).
function _wCvResetItemsColWidths(id) {
  cvUpdateBlock(id, 'colWidths', null);
  cvRenderProps(id);
}

// Defect-table column-width handlers — mirror the items-table trio
// (above) but reference CV_DEFECT_COLS so the column list stays
// authoritative across both tables.
function _wCvSetDefectColWidth(id, colIdx, el) {
  const block = cvBlocks.find(b => b.id === id);
  if(!block || typeof CV_DEFECT_COLS === 'undefined' || !Array.isArray(CV_DEFECT_COLS)) return;
  const cols = CV_DEFECT_COLS;
  const widths = (Array.isArray(block.colWidths) && block.colWidths.length === cols.length)
    ? block.colWidths.slice()
    : cols.map(c => c.width || 130);
  const v = +el.value;
  widths[colIdx] = (Number.isFinite(v) && v >= 20) ? v : (cols[colIdx]?.width || 130);
  cvUpdateBlock(id, 'colWidths', widths);
}
function cvStepDefectColWidth(id, colIdx, delta){
  const block = cvBlocks.find(b => b.id === id);
  if(!block || typeof CV_DEFECT_COLS === 'undefined' || !Array.isArray(CV_DEFECT_COLS)) return;
  const cols = CV_DEFECT_COLS;
  const widths = (Array.isArray(block.colWidths) && block.colWidths.length === cols.length)
    ? block.colWidths.slice()
    : cols.map(c => c.width || 130);
  const cur = (+widths[colIdx]) || (cols[colIdx]?.width || 130);
  widths[colIdx] = Math.min(500, Math.max(20, cur + (+delta || 0) * 5));
  cvUpdateBlock(id, 'colWidths', widths);
  const inp = document.querySelector('#cv-props-body [data-colw="' + colIdx + '"]');
  if(inp) inp.value = widths[colIdx];
}
function _wCvResetDefectColWidths(id) {
  cvUpdateBlock(id, 'colWidths', null);
  cvRenderProps(id);
}

// Same dispatcher-args-parser issue applied to two other handlers.
// apSetSeverity is wired to the four severity colour pickers in Appearance
// settings. captureWizardSetVal is wired to every field in the capture
// wizard modal. Without these wrappers each handler was receiving the DOM
// element where a string was expected, causing silent failure of the
// severity colours and capture-wizard input persistence.
function _wApSetSeverityValue   (level,  el) { apSetSeverity(level, el.value);       }
function _wCaptureWizardSetValue(target, el) { captureWizardSetVal(target, el.value);}

// Reads the method select's current value and loads the matching template.
// Replaces the broken `data-args="document.getElementById(...).value"`
// markup pattern (the args parser doesn't evaluate JS expressions).
function _wCvLoadMethodTplFromSelect(){
  const sel = document.getElementById('cv-method-select');
  if(sel) cvLoadMethodTpl(sel.value);
}

// File-input wrappers — reads element.files instead of relying on a broken
// `data-args=".files"` / `data-args=".files[0]"` expression that the args
// parser cannot evaluate. The wrappers handle the empty-selection case
// (user opened the picker then cancelled).
function _wProcHandleFiles(el){
  if(el && el.files && el.files.length) procHandleFiles(el.files);
}
function _wApImportThemeFile(el){
  const f = el && el.files && el.files[0];
  if(f) apImportTheme(f);
}

// "New report" from the empty-overview state. Picks the first active
// method (configured under Settings → Methods) or falls back to UT.
// Replaces a `data-args="(getActiveMethods()[0]||{}).id||'UT'"` callsite
// that tried to evaluate JS in the markup — the args parser cannot.
function _wOvNewReportFromActiveMethod(){
  let methodId = 'UT';
  try {
    const active = (typeof getActiveMethods === 'function') ? getActiveMethods() : [];
    if(active && active[0] && active[0].id) methodId = active[0].id;
  } catch(e){}
  ovNewReport(methodId);
}

// Custom X/Y/W/H stepper — the Properties panel's ▲/▼ buttons. Steps the
// block property by delta, then writes the new value back into the number
// input (cvUpdateBlock skips the panel re-render for geometry props, so
// the field has to be refreshed here).
function cvStepBlockNum(id, prop, delta){
  const b = cvBlocks.find(x => x.id === id);
  if(!b) return;
  cvUpdateBlock(id, prop, (+b[prop] || 0) + (+delta || 0));
  const inp = document.querySelector('#cv-props-body [data-prop="' + prop + '"]');
  if(inp) inp.value = b[prop];
}
function cvUpdateBlock(id, prop, value){
  const block = cvBlocks.find(b=>b.id===id);
  if(!block) return;
  const _geom = ['x','y','w','h'].indexOf(prop) >= 0;
  // A locked block's position and size are frozen. Reject X/Y/W/H edits
  // from the Properties panel — typed values and steppers alike — so the
  // lock can't be bypassed there. (The inputs also render disabled while
  // locked; this is the defence-in-depth guard.)
  if(_geom && _cvIsBlockLocked(block)){
    toast(t('pe.toast.locked_geom','Block is locked — unlock it to move or resize.'), 'warn');
    cvRenderProps(id);
    return;
  }
  // FIX: push undo for property edits (debounced — only on first change per interaction)
  if(!cvDragUndoPushed){ cvPushUndo(); cvDragUndoPushed = true; setTimeout(()=>{ cvDragUndoPushed=false; }, 800); }
  // X/Y/W/H typed in the Properties panel are honoured exactly (only
  // floored to a sane minimum) — NOT grid-snapped. Snapping a precisely
  // typed value back to the grid is what made the number fields feel
  // broken, and it cancelled out the spinner's ±1 steps. Drag-move still
  // grid-snaps via cvMouseMove.
  if(_geom) value = Math.max(prop==='x'||prop==='y'?0:16, +value || 0);
  block[prop] = value;
  cvRenderCanvas();
  // Properties panel needs to reflect the new value so e.g. alignment
  // buttons highlight the active option, lock checkbox flips, etc. Skip
  // text inputs while typing, props starting with 'c' (color picker,
  // colWidths), and the X/Y/W/H fields — re-rendering the panel would
  // replace the <input> under the user's caret and break the spinner.
  if(prop !== 'text' && !prop.startsWith('c') && !_geom) {
    cvRenderProps(id);
  }
  cvSaveLayout();
}
// ── Ribbon Font / Paragraph commands ────────────────────────────────────
// The whole ribbon used to route through document.execCommand, which only
// affects a contenteditable selection. The place cards aren't edited
// inline, so every one of these controls silently did nothing. They now
// mutate real block properties on the current selection instead.

// Apply `mutate` to every selected, unlocked block (one undo step, one
// re-render). Toasts and returns 0 when there's nothing to act on.
function _cvApplyToSelection(mutate){
  if(!cvSelectedIds.length){
    toast(t('toast.select_blocks_first','Select one or more blocks first.'), 'warn');
    return 0;
  }
  cvPushUndo();
  let n = 0;
  cvSelectedIds.forEach(id => {
    const b = cvBlocks.find(bb => bb.id === id);
    if(!b || _cvIsBlockLocked(b)) return;
    mutate(b); n++;
  });
  if(n){ cvRenderCanvas(); cvRenderProps(cvSelectedId); cvSaveLayout(); }
  else toast(t('pe.toast.block_locked','That block is locked.'), 'warn');
  return n;
}

// Font family — empty value clears the override (falls back to canvas font).
function cvSetBlockFont(font){
  if(font && !CV_FONTS[font]) return;
  _cvApplyToSelection(b => { if(font) b.fontFamily = font; else delete b.fontFamily; });
}

// Font size — value is a CSS px string e.g. '8.5px'.
function cvSetBlockFontSize(size){
  if(!/^\d+(?:\.\d+)?px$/.test(String(size||''))) return;
  _cvApplyToSelection(b => { b.fontSize = size; });
}

// Bold / italic / underline / strike — decide the new state from the first
// selected block, then apply it uniformly so a mixed selection converges.
function cvToggleBlockFmt(prop){
  if(['bold','italic','underline','strike'].indexOf(prop) < 0) return;
  if(!cvSelectedIds.length){
    toast(t('toast.select_blocks_first','Select one or more blocks first.'), 'warn');
    return;
  }
  const first = cvBlocks.find(b => b.id === cvSelectedIds[0]);
  const next = !(first && first[prop]);
  _cvApplyToSelection(b => { b[prop] = next; });
}

// Text alignment.
function cvSetBlockAlign(align){
  if(['left','center','right','justify'].indexOf(align) < 0) return;
  _cvApplyToSelection(b => { b.align = align; });
}

// Text / background colour — called by the ribbon colour picker (ui.js).
function cvSetBlockColor(hex){
  if(!/^#[0-9a-fA-F]{3,8}$/.test(String(hex||''))) return;
  _cvApplyToSelection(b => { b.color = hex; });
}
function cvSetBlockBg(hex){
  if(!/^(?:#[0-9a-fA-F]{3,8}|transparent)$/.test(String(hex||''))) return;
  _cvApplyToSelection(b => { b.bgColor = hex; });
}

// Clear character formatting — mirrors execCommand('removeFormat'): resets
// weight/style/decoration/font/colour but leaves geometry, border and
// background alone.
function cvClearBlockFmt(){
  _cvApplyToSelection(b => {
    b.bold = false; b.italic = false; b.underline = false; b.strike = false;
    delete b.fontFamily;
    b.color = '#000000';
  });
}

// Sync the ribbon Font/Paragraph controls to the selected block's state so
// the dropdowns show the right value and the toggle buttons highlight.
function _cvSyncRibbon(block){
  if(!block) return;
  const set = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };
  const act = (id, on)  => { const el = document.getElementById(id); if(el) el.classList.toggle('active', !!on); };
  set('cv-tb-font', (block.fontFamily && CV_FONTS[block.fontFamily]) ? block.fontFamily : 'Arial');
  set('cv-tb-size', /^\d+(?:\.\d+)?px$/.test(block.fontSize||'') ? block.fontSize : '8.5px');
  act('cv-tb-bold',      block.bold);
  act('cv-tb-italic',    block.italic);
  act('cv-tb-underline', block.underline);
  act('cv-tb-strike',    block.strike);
  ['left','center','right','justify'].forEach(a => act('cv-tb-align-'+a, (block.align||'left') === a));
  const fgP = document.getElementById('cv-fg-preview');
  if(fgP && /^#[0-9a-fA-F]{3,8}$/.test(block.color||'')) fgP.style.borderBottomColor = block.color;
  const bgP = document.getElementById('cv-bg-preview');
  if(bgP && /^#[0-9a-fA-F]{3,8}$/.test(block.bgColor||'')) bgP.style.background = block.bgColor;
}
// ── Method-block container parenting ────────────────────────────────────
// 'method-cell' blocks carry a parentId pointing at a 'method-block'
// container. Children ride along when the container is dragged, are
// deleted with it, and are clamped inside its rectangle.
function _cvContainerChildren(containerId){
  return cvBlocks.filter(b => b.parentId === containerId);
}
// Height of a method-block container's title strip — a fixed 24px,
// growing only if the Heading font size needs more room. Shared by the
// render and the clamp so cells land exactly below the bar.
function _cvMethodBarHeight(block){
  const m = /^(\d+(?:\.\d+)?)px$/.exec((block && block.titleFontSize) || '');
  const fs = m ? parseFloat(m[1]) : 11;
  return Math.max(24, Math.round(fs * 1.2) + 5);
}
// Keep a cell inside its container's INNER area — below the title bar and
// within the borders. A cell that lands near the bar snaps flush against
// it, so place cards sit tight under the header instead of floating.
function _cvClampToParent(cell, parent, doSnap){
  if(!cell || !parent) return;
  const barH   = _cvMethodBarHeight(parent);
  const innerX = parent.x;
  const innerY = parent.y + barH;
  const innerW = parent.w;
  const innerH = Math.max(0, parent.h - barH);
  cell.w = Math.min(cell.w, innerW);
  cell.h = Math.min(cell.h, innerH);
  cell.x = Math.min(Math.max(cell.x, innerX), innerX + innerW - cell.w);
  cell.y = Math.min(Math.max(cell.y, innerY), innerY + innerH - cell.h);
  // Snap flush to the header bar when the cell lands near the top — but
  // ONLY on an explicit drag / drop / resize. On layout load this snap
  // would silently pull validly-placed cells up to the bar on every
  // return to the editor, so the load path passes doSnap === false.
  const snapT = (typeof CV_SNAP_THRESHOLD === 'number') ? CV_SNAP_THRESHOLD : 12;
  if(doSnap !== false && cell.y - innerY <= snapT) cell.y = innerY;
}
// Resize variant — caps a cell's size so it stays inside its container
// WITHOUT moving its x/y. Used after a cell is resized: dragging the
// right / bottom edge must never shift the opposite (x/y) edge.
function _cvClampSizeToParent(cell, parent){
  if(!cell || !parent) return;
  cell.w = Math.min(cell.w, Math.max(16, parent.x + parent.w - cell.x));
  cell.h = Math.min(cell.h, Math.max(16, parent.y + parent.h - cell.y));
}
// Hit-test a cell's centre against every container and (re)assign its
// parentId: inside a container → parent to it, lift above it, clamp
// inside; inside none → un-parent. Lets the user drag a cell out of a
// container to detach it, or into one to attach it.
function _cvReparentCell(cell){
  if(!cell || cell.key !== 'method-cell') return;
  const cx = cell.x + cell.w / 2, cy = cell.y + cell.h / 2;
  let parent = null;
  cvBlocks.forEach(b => {
    if(b.key !== 'method-block') return;
    if(cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h){
      if(!parent || (b.zIndex || 0) >= (parent.zIndex || 0)) parent = b;
    }
  });
  cell.parentId = parent ? parent.id : null;
  if(parent){
    if((cell.zIndex || 0) <= (parent.zIndex || 0)) cell.zIndex = (parent.zIndex || 0) + 1;
    _cvClampToParent(cell, parent);
  }
}
function cvDeleteBlock(id){
  cvPushUndo();
  const target = cvBlocks.find(b => b.id === id);
  const kill = new Set([id]);
  if(target && target.key === 'method-block')
    _cvContainerChildren(id).forEach(c => kill.add(c.id));
  cvPages[cvCurrentPage].blocks = cvPages[cvCurrentPage].blocks.filter(b => !kill.has(b.id));
  cvSync();
  if(kill.has(cvSelectedId)) cvSelectedId = null;
  cvSelectedIds = cvSelectedIds.filter(x => !kill.has(x));
  if(kill.has(_cvLastPlacedId)) _cvLastPlacedId = null;
  cvRenderCanvas(); cvRenderProps(cvSelectedId); cvSaveLayout();
}
function cvDeleteSelected(){
  if(!cvSelectedIds.length) return;
  cvPushUndo();
  const kill = new Set(cvSelectedIds);
  cvSelectedIds.forEach(sid => {
    const b = cvBlocks.find(bb => bb.id === sid);
    if(b && b.key === 'method-block') _cvContainerChildren(sid).forEach(c => kill.add(c.id));
  });
  cvPages[cvCurrentPage].blocks = cvPages[cvCurrentPage].blocks.filter(b => !kill.has(b.id));
  if(kill.has(_cvLastPlacedId)) _cvLastPlacedId = null;
  cvSync(); cvSelectedId=null; cvSelectedIds=[];
  cvRenderCanvas(); cvRenderProps(null); cvSaveLayout();
}
function cvDuplicateBlock(id){ cvPushUndo(); const b=cvBlocks.find(b=>b.id===id); if(!b) return; const nb=_cvCloneBlock(b); cvBlocks.push(nb); _cvSelectSingle(nb.id); cvRenderCanvas(); cvRenderProps(nb.id); cvSaveLayout(); }
function cvMoveZ(id,dir){ const b=cvBlocks.find(b=>b.id===id); if(!b) return; b.zIndex=(b.zIndex||1)+dir; cvRenderCanvas(); cvSaveLayout(); }
function cvToggleLock(id){
  const b = cvBlocks.find(b => b.id === id); if(!b) return;
  // If the block is currently locked solely because of the template-wide
  // "Lock header & footer" toggle (zone lock), clicking the FAB padlock
  // here would set b.locked = true — and the block would stay locked
  // forever after the user later unticks the zone toggle. Bail with a
  // hint so the user knows where to actually unlock it.
  if(!b.locked && cvTplCfg && cvTplCfg.lockZones && _cvIsBlockLocked(b)){
    toast(t('pe.toast.zone_locked_block_hint',
      'This block is locked by "Lock header & footer". Untick that in Design to unlock.'),
      'info');
    return;
  }
  b.locked = !b.locked;
  cvRenderCanvas(); cvRenderProps(id); cvRenderLayers(); cvSaveLayout();
  // Pulse every visible padlock — properties header + layers row — so the
  // user gets visual confirmation that the toggle landed. The class is
  // applied after the re-render so the just-rendered element animates.
  requestAnimationFrame(() => {
    document.querySelectorAll('.cv-padlock-anim').forEach(el => {
      el.classList.remove('cv-padlock-anim--pulse');
      void el.offsetWidth;  // reflow so the animation restarts on re-add
      el.classList.add('cv-padlock-anim--pulse');
    });
  });
  toast(b.locked ? t('pe.toast.block_locked','Block locked') : t('pe.toast.block_unlocked','Block unlocked'));
}

// ── Multi-select alignment ───────────────────────────────────────────
function cvAlignSelected(edge){
  if(cvSelectedIds.length < 2) return;
  cvPushUndo();
  const blocks = cvSelectedIds.map(sid=>cvBlocks.find(b=>b.id===sid)).filter(Boolean);
  if(edge==='left')   { const minX=Math.min(...blocks.map(b=>b.x)); blocks.forEach(b=>b.x=minX); }
  if(edge==='right')  { const maxR=Math.max(...blocks.map(b=>b.x+b.w)); blocks.forEach(b=>b.x=maxR-b.w); }
  if(edge==='top')    { const minY=Math.min(...blocks.map(b=>b.y)); blocks.forEach(b=>b.y=minY); }
  if(edge==='bottom') { const maxB=Math.max(...blocks.map(b=>b.y+b.h)); blocks.forEach(b=>b.y=maxB-b.h); }
  cvRenderCanvas(); cvSaveLayout();
}
function cvDistributeSelected(axis){
  if(cvSelectedIds.length < 3) return;
  cvPushUndo();
  const blocks = cvSelectedIds.map(sid=>cvBlocks.find(b=>b.id===sid)).filter(Boolean);
  if(axis==='h'){
    blocks.sort((a,b)=>a.x-b.x);
    const minX=blocks[0].x, maxR=blocks[blocks.length-1].x+blocks[blocks.length-1].w;
    const totalW=blocks.reduce((s,b)=>s+b.w,0);
    const gap=(maxR-minX-totalW)/(blocks.length-1);
    let cx=minX;
    blocks.forEach(b=>{ b.x=Math.round(cx); cx+=b.w+gap; });
  } else {
    blocks.sort((a,b)=>a.y-b.y);
    const minY=blocks[0].y, maxB=blocks[blocks.length-1].y+blocks[blocks.length-1].h;
    const totalH=blocks.reduce((s,b)=>s+b.h,0);
    const gap=(maxB-minY-totalH)/(blocks.length-1);
    let cy=minY;
    blocks.forEach(b=>{ b.y=Math.round(cy); cy+=b.h+gap; });
  }
  cvRenderCanvas(); cvSaveLayout();
}

// ── Copy / Paste ─────────────────────────────────────────────────────
function cvCopySelected(){
  const ids = cvSelectedIds.length ? cvSelectedIds : (cvSelectedId ? [cvSelectedId] : []);
  if(!ids.length) return;
  cvClipboard = ids.map(sid=>{ const b=cvBlocks.find(bb=>bb.id===sid); return b?JSON.parse(JSON.stringify(b)):null; }).filter(Boolean);
  toast(tf('toast.copied_n','Copied {n} block(s)', {n: cvClipboard.length}));
}
function cvPasteClipboard(){
  if(!cvClipboard || !cvClipboard.length) return;
  cvPushUndo();
  const newIds = [];
  cvClipboard.forEach(b => {
    const nb = _cvCloneBlock(b);
    cvBlocks.push(nb);
    newIds.push(nb.id);
  });
  cvSelectedIds = newIds;
  _cvPrimaryToFirst();    // batch convention: first pasted block becomes primary
  cvRenderCanvas(); cvRenderProps(cvSelectedId); cvSaveLayout();
  toast(tf('toast.pasted_n','Pasted {n} block(s)', {n: newIds.length}));
}

// ── Mouse interaction ────────────────────────────────────────────────
function cvBgMouseDown(e){
  if(e.target.id==='cv-canvas'||e.target.id==='cv-grid-overlay'){
    cvSelectedId=null; cvSelectedIds=[];
    cvUpdateSelectionUI();   // V23: no full re-render on background click
    cvRenderProps(null);
  }
}
function cvMouseMove(e){
  if(cvDragging){
    const canvas = document.getElementById('cv-canvas');
    if(!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const mx = (e.clientX - canvasRect.left) / cvZoom;
    const my = (e.clientY - canvasRect.top)  / cvZoom;
    const dx = mx - cvDragging.anchorX;
    const dy = my - cvDragging.anchorY;
    // Drag threshold — sub-3px pointer jitter counts as a click, not a
    // drag, so simply clicking a block never nudges or grid-snaps it.
    // (A non-grid block would otherwise jump to the nearest grid line on
    // the first stray mousemove between mousedown and mouseup.)
    if(!cvDragging.engaged){
      if(Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      cvDragging.engaged = true;
    }
    if(!cvDragUndoPushed){ cvPushUndo(); cvDragUndoPushed = true; }
    // When a container is dragged, its parented children are appended to
    // startPositions so they ride along. In that case the move must stay
    // rigid (grid snap only) — alignment-line snap would pull the
    // container and each child independently and desync the group.
    const _rigidGroup = cvDragging.startPositions.length > cvDragging.ids.length;

    // Move all dragged blocks
    cvDragging.startPositions.forEach(sp => {
      const b = cvBlocks.find(bb=>bb.id===sp.id);
      if(!b || _cvIsBlockLocked(b)) return;
      let newX = cvSnap(Math.max(0, sp.x + dx));
      let newY = cvSnap(Math.max(0, sp.y + dy));

      // Smart snap alignment (only when dragging a single block on its
      // own). Hold Alt while dragging to bypass the alignment-line snap —
      // useful when you want to drop a block fractionally off the column
      // or to overlap edges intentionally. Grid snap still applies above.
      if(cvDragging.ids.length === 1 && b.id === cvDragging.ids[0] && !_rigidGroup && !e.altKey){
        const snaps = cvCalcSnapLines(b.id, newX, newY, b.w, b.h);
        // Pick the snap with the SMALLEST delta on each axis so the
        // closest target wins (previously: first in iteration order,
        // which sometimes pulled the drag toward a more distant block
        // when a closer one was also within threshold — felt random).
        const byDelta = (a,b) => Math.abs(a.delta) - Math.abs(b.delta);
        const vSnap = snaps.filter(s=>s.axis==='v').sort(byDelta)[0];
        const hSnap = snaps.filter(s=>s.axis==='h').sort(byDelta)[0];
        if(vSnap){
          if(vSnap.edge==='l') newX = vSnap.pos;
          else if(vSnap.edge==='r') newX = vSnap.pos - b.w;
          else if(vSnap.edge==='cx') newX = vSnap.pos - b.w/2;
        }
        if(hSnap){
          if(hSnap.edge==='t') newY = hSnap.pos;
          else if(hSnap.edge==='b') newY = hSnap.pos - b.h;
          else if(hSnap.edge==='cy') newY = hSnap.pos - b.h/2;
        }
        cvDrawSnapLines(snaps.filter(s=>(s===vSnap||s===hSnap)));
      } else {
        // Smart snap didn't run (Alt bypass, rigid group move, or multi-
        // select) — clear any guide lines still drawn from a previous
        // move so the canvas reflects the freeform state.
        cvDrawSnapLines([]);
      }

      // A method-cell that belongs to a method block is confined to that
      // container's inner area — it cannot be dragged out of it. When the
      // method block itself is dragged its children ride along via their
      // own startPositions entry, so this clamp is a no-op there and only
      // bites when a cell is dragged on its own.
      if(b.key === 'method-cell' && b.parentId){
        const parent = cvBlocks.find(p => p.id === b.parentId);
        if(parent){
          const barH = _cvMethodBarHeight(parent);
          const minX = parent.x, maxX = parent.x + parent.w - b.w;
          const minY = parent.y + barH, maxY = parent.y + parent.h - b.h;
          newX = Math.min(Math.max(newX, minX), Math.max(minX, maxX));
          newY = Math.min(Math.max(newY, minY), Math.max(minY, maxY));
        }
      }

      b.x = newX; b.y = newY;
      const elB = document.getElementById('cblk-'+b.id);
      if(elB){ elB.style.left=b.x+'px'; elB.style.top=b.y+'px'; }
    });

    // FIX: Update properties panel live during drag
    cvUpdatePropsPositionLive();
  }
  if(cvResizing){
    if(!cvDragUndoPushed){ cvPushUndo(); cvDragUndoPushed = true; }
    const b=cvBlocks.find(b=>b.id===cvResizing.id); if(!b) return;
    let newW = cvSnap(Math.max(32, cvResizing.startW+(e.clientX-cvResizing.startX)/cvZoom));
    let newH = cvSnap(Math.max(16, cvResizing.startH+(e.clientY-cvResizing.startY)/cvZoom));
    // Edge-snap during resize so the right / bottom edge actually
    // touches neighbouring blocks. Without this, only the drag-move
    // path snapped to edges — resizing always landed on the grid
    // (multiples of CV_GRID) which left tiny gaps next to non-grid-
    // aligned neighbours. Alt bypasses the snap, same convention as
    // drag-move.
    if(!e.altKey){
      const snaps = cvCalcSnapLines(b.id, b.x, b.y, newW, newH);
      const byDelta = (a,b) => Math.abs(a.delta) - Math.abs(b.delta);
      const vSnap = snaps.filter(s => s.axis === 'v' && (s.edge === 'r' || s.edge === 'cx')).sort(byDelta)[0];
      const hSnap = snaps.filter(s => s.axis === 'h' && (s.edge === 'b' || s.edge === 'cy')).sort(byDelta)[0];
      if(vSnap){
        if(vSnap.edge === 'r')      newW = Math.max(32, vSnap.pos - b.x);
        else if(vSnap.edge === 'cx') newW = Math.max(32, (vSnap.pos - b.x) * 2);
      }
      if(hSnap){
        if(hSnap.edge === 'b')      newH = Math.max(16, hSnap.pos - b.y);
        else if(hSnap.edge === 'cy') newH = Math.max(16, (hSnap.pos - b.y) * 2);
      }
      cvDrawSnapLines(snaps.filter(s => s === vSnap || s === hSnap));
    } else {
      cvDrawSnapLines([]);
    }
    b.w = newW; b.h = newH;
    const elB=document.getElementById('cblk-'+b.id); if(elB){elB.style.width=b.w+'px';elB.style.height=b.h+'px';}
    cvUpdatePropsPositionLive();
  }
}
function cvMouseUp(){
  // V25: blocks whose x/y/w/h were mutated during drag have stale cached
  // signatures. Invalidate them so the next cvRenderCanvas pass rebuilds
  // their elements to match the current state.
  if(cvDragging){
    // V29: re-detect zone for every dragged block based on its final position.
    // A block dragged from the body into the header band becomes a header block;
    // dragged out of the band, it returns to the body.
    cvDragging.ids.forEach(id => {
      _cvBlockElCache.delete(id);
      const b = cvBlocks.find(bb => bb.id === id);
      if(b){
        const newZone = _cvDetectZone(b.y, b.h);
        if(b.zone !== newZone){
          b.zone = newZone;
        }
        // A cell dragged into a container attaches to it; dragged out of
        // every container, it detaches. Gate on a REAL position change —
        // a plain click (even with the 1px jitter the grid-snap absorbs)
        // leaves x/y untouched and must not snap the cell anywhere.
        if(b.key === 'method-cell'){
          const sp = cvDragging.startPositions.find(s => s.id === id);
          if(sp && (sp.x !== b.x || sp.y !== b.y)){
            // A cell already inside a method block stays inside it: clamp
            // it back into its container rather than hit-testing for
            // detachment. Only an unparented free cell runs the hit-test
            // that can attach it to a container it was dropped into.
            const parent = b.parentId ? cvBlocks.find(p => p.id === b.parentId) : null;
            if(parent) _cvClampToParent(b, parent);
            else _cvReparentCell(b);
          }
        }
      }
    });
  }
  if(cvResizing){
    _cvBlockElCache.delete(cvResizing.id);
    const b = cvBlocks.find(bb => bb.id === cvResizing.id);
    if(b){
      const newZone = _cvDetectZone(b.y, b.h);
      if(b.zone !== newZone) b.zone = newZone;
      // Keep parented cells inside their container after a real resize —
      // skip when the size is unchanged (a click on the resize handle).
      const _resized = (b.w !== cvResizing.startW || b.h !== cvResizing.startH);
      if(_resized && b.key === 'method-block'){
        _cvContainerChildren(b.id).forEach(ch => { _cvClampToParent(ch, b); _cvBlockElCache.delete(ch.id); });
      } else if(_resized && b.key === 'method-cell' && b.parentId){
        const p = cvBlocks.find(x => x.id === b.parentId);
        if(p) _cvClampSizeToParent(b, p);
      }
    }
  }
  const _moved = !!(cvDragging || cvResizing);
  if(_moved) cvSaveLayout();
  cvDragging=null; cvResizing=null; cvDragUndoPushed=false;
  document.body.style.cursor=''; document.body.style.userSelect='';
  // Clear snap lines
  document.querySelectorAll('.cv-snap-line').forEach(e=>e.remove());
  // A moved/resized block can change which edges its neighbours share,
  // so re-render: the border-collapse signature picks up neighbours
  // whose collapsed borders flipped.
  if(_moved) cvRenderCanvas();
  // FIX V22: detach document-level listeners
  cvDetachDragListeners();
  // V25: persistent alignment guides may need updating — positions changed
  _cvRefreshAlignGuides();
}

// V22: document-level drag listeners. Without these, dragging a block past
// the canvas edge freezes — mousemove only fires while over the canvas.
// We bind on drag/resize start and unbind on mouseup so we don't pay event-
// handler cost when nothing is being dragged.
function cvAttachDragListeners(){
  if(cvAttachDragListeners._on) return;  // idempotent
  cvAttachDragListeners._on = true;
  document.addEventListener('mousemove', cvMouseMove);
  document.addEventListener('mouseup',   cvMouseUp);
}
function cvDetachDragListeners(){
  if(!cvAttachDragListeners._on) return;
  cvAttachDragListeners._on = false;
  document.removeEventListener('mousemove', cvMouseMove);
  document.removeEventListener('mouseup',   cvMouseUp);
}

// FIX: Live-update position inputs in properties panel during drag
function cvUpdatePropsPositionLive(){
  if(!cvSelectedId) return;
  const b = cvBlocks.find(bb=>bb.id===cvSelectedId);
  if(!b) return;
  const panel = document.getElementById('cv-props-body');
  if(!panel) return;
  ['x','y','w','h'].forEach(p=>{
    const inp = panel.querySelector(`input[data-prop="${p}"]`);
    if(inp && document.activeElement !== inp) inp.value = b[p];
  });
}

document.addEventListener('mouseup', ()=>{ if(cvDragging||cvResizing){cvMouseUp();} });

// ── Keyboard shortcuts ───────────────────────────────────────────────
document.addEventListener('keydown', e=>{
  const pdfSec = document.getElementById('ss-pdfeditor');
  if(!pdfSec || !pdfSec.classList.contains('active')) return;
  if(cvPreview) return;
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return;

  // Respect global shortcuts toggle
  const settings = ls(KEYS.settings, {});
  if(settings.shortcutsEnabled === false) return;

  // V5: registry-driven (each may be rebound or disabled by the user)
  // Delete
  if(matchShortcut(e, getShortcutKey('delete-block')) && (cvSelectedId || cvSelectedIds.length)){
    e.preventDefault();
    if(cvSelectedIds.length > 1) cvDeleteSelected();
    else if(cvSelectedId) cvDeleteBlock(cvSelectedId);
  }
  // Undo/Redo
  if(matchShortcut(e, getShortcutKey('undo'))){ e.preventDefault(); cvUndo(); }
  if(matchShortcut(e, getShortcutKey('redo'))){ e.preventDefault(); cvRedo(); }
  // Copy/Paste/Duplicate
  if(matchShortcut(e, getShortcutKey('copy'))){ e.preventDefault(); cvCopySelected(); }
  if(matchShortcut(e, getShortcutKey('paste'))){ e.preventDefault(); cvPasteClipboard(); }
  if(matchShortcut(e, getShortcutKey('duplicate'))){ e.preventDefault(); if(cvSelectedId) cvDuplicateBlock(cvSelectedId); }
  // Find & replace
  if(matchShortcut(e, getShortcutKey('find-replace'))){ e.preventDefault(); cvOpenFindReplace(); }
  // Save snapshot
  if(matchShortcut(e, getShortcutKey('snapshot'))){ e.preventDefault(); cvSaveSnapshot('Manual snapshot ('+new Date().toLocaleTimeString()+')'); toast(t('toast.snapshot_saved','Snapshot saved.'), 'success'); }
  // Select all
  if(matchShortcut(e, getShortcutKey('select-all'))){ e.preventDefault(); cvSelectedIds=cvBlocks.map(b=>b.id); _cvPrimaryToFirst(); cvRenderCanvas(); cvRenderProps(cvSelectedId); }
  // Arrow key nudge — not user-rebindable, hard-coded
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key) && cvSelectedId){
    e.preventDefault();
    const step = e.shiftKey ? CV_GRID * 4 : CV_GRID;
    const ids = cvSelectedIds.length ? cvSelectedIds : [cvSelectedId];
    ids.forEach(sid=>{
      const b = cvBlocks.find(bb=>bb.id===sid);
      if(!b || _cvIsBlockLocked(b)) return;
      if(e.key==='ArrowLeft')  b.x = Math.max(0, b.x - step);
      if(e.key==='ArrowRight') b.x = b.x + step;
      if(e.key==='ArrowUp')    b.y = Math.max(0, b.y - step);
      if(e.key==='ArrowDown')  b.y = b.y + step;
    });
    cvRenderCanvas(); cvSaveLayout();
  }
});

// ── Zoom ─────────────────────────────────────────────────────────────
function cvApplyZoom(){
  const wrap=document.getElementById('cv-scale-wrap');
  const canvas=document.getElementById('cv-canvas');
  const label=document.getElementById('cv-zoom-label');
  const label2=document.getElementById('cv-zoom-label-rib');
  if(label) label.textContent=Math.round(cvZoom*100)+'%';
  if(label2) label2.textContent=Math.round(cvZoom*100)+'%';
  if(canvas) canvas.style.transform=`scale(${cvZoom})`;
  if(canvas&&wrap){
    wrap.style.width =Math.ceil(CV_PAGE_WIDTH_PX*cvZoom)+'px';
    wrap.style.height=Math.ceil((canvas.scrollHeight||CV_PAGE_HEIGHT_PX)*cvZoom)+'px';
  }
}
function cvZoomStep(delta){
  const area = document.getElementById('cv-scroll-area');
  const oldZoom = cvZoom;
  cvZoom = Math.max(0.25, Math.min(2.0, cvZoom + delta));
  if(!area){ cvApplyZoom(); return; }
  // Viewport center in scroll coordinates before zoom
  const cx = area.scrollLeft + area.clientWidth / 2;
  const cy = area.scrollTop + area.clientHeight / 2;
  const ratio = cvZoom / oldZoom;
  cvApplyZoom();
  // Scroll so the same canvas point stays at viewport center
  area.scrollLeft = cx * ratio - area.clientWidth / 2;
  area.scrollTop  = cy * ratio - area.clientHeight / 2;
}
function cvFitToView(){
  const area = document.getElementById('cv-scroll-area') || document.getElementById('cv-canvas-outer');
  if(!area) return;
  const margin = 32;
  // Fit the page to the full width of the canvas area; it scrolls
  // vertically when the sheet is taller than the viewport.
  const avail = area.clientWidth - margin * 2;
  cvZoom = Math.max(0.3, Math.min(2.0, avail / CV_PAGE_WIDTH_PX));
  cvApplyZoom();
  area.scrollLeft = 0;
  area.scrollTop  = 0;
}

// Ctrl+Wheel zoom toward cursor position
document.addEventListener('wheel', function(e){
  const area = document.getElementById('cv-scroll-area');
  if(!area || !area.contains(e.target)) return;
  if(!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const oldZoom = cvZoom;
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  cvZoom = Math.max(0.25, Math.min(2.0, cvZoom + delta));
  // Cursor position relative to scroll area viewport
  const rect = area.getBoundingClientRect();
  const mx = e.clientX - rect.left + area.scrollLeft;
  const my = e.clientY - rect.top  + area.scrollTop;
  const ratio = cvZoom / oldZoom;
  cvApplyZoom();
  // Keep cursor point stationary
  area.scrollLeft = mx * ratio - (e.clientX - rect.left);
  area.scrollTop  = my * ratio - (e.clientY - rect.top);
}, {passive:false});

// ── Preview mode ─────────────────────────────────────────────────────
function cvToggleMode(){
  cvPreview=!cvPreview;
  const btn=document.getElementById('cv-mode-btn');
  if(btn){ btn.classList.toggle('on',cvPreview); btn.textContent=cvPreview?'✏️ Edit':'👁 Preview'; }
  cvRenderCanvas();
}

// ══════════════════════════════════════════════════════════════════════════
// V26 — Responsive drawer toggles for narrow viewports
// ══════════════════════════════════════════════════════════════════════════
// At desktop widths (>1100px) both side panels are always visible. Below
// 1100px the palette becomes a slide-in drawer; below 900px the properties
// panel also becomes a drawer. The toggles below are no-ops on desktop
// (panels never have transform:translateX set without the media query) but
// behave as expected on tablet/phone.

function cvTogglePaletteDrawer(){
  const palette = document.getElementById('cv-field-palette');
  if(!palette) return;
  const open = !palette.classList.contains('cv-drawer-open');
  // Close the other drawer first — only one open at a time
  document.getElementById('cv-props-panel')?.classList.remove('cv-drawer-open');
  palette.classList.toggle('cv-drawer-open', open);
  _cvUpdateBackdrop();
}

function cvTogglePropsDrawer(){
  const props = document.getElementById('cv-props-panel');
  if(!props) return;
  const open = !props.classList.contains('cv-drawer-open');
  document.getElementById('cv-field-palette')?.classList.remove('cv-drawer-open');
  props.classList.toggle('cv-drawer-open', open);
  _cvUpdateBackdrop();
}

function cvCloseAllDrawers(){
  document.getElementById('cv-field-palette')?.classList.remove('cv-drawer-open');
  document.getElementById('cv-props-panel')?.classList.remove('cv-drawer-open');
  _cvUpdateBackdrop();
}

/** Show backdrop iff at least one drawer is open. */
function _cvUpdateBackdrop(){
  const backdrop = document.getElementById('cv-drawer-backdrop');
  if(!backdrop) return;
  const anyOpen = document.querySelector('#cv-field-palette.cv-drawer-open, #cv-props-panel.cv-drawer-open');
  backdrop.classList.toggle('cv-active', !!anyOpen);
}

// Auto-close drawers when viewport widens past breakpoints — prevents the
// awkward state where a tablet rotates to landscape with the drawer still
// "open" (now visible inline as it used to be, but with the .cv-drawer-open
// class lingering).
var _cvLastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  // Crossed up past 1100 → palette becomes inline again, clear drawer state
  if(w > 1100 && _cvLastWidth <= 1100){
    document.getElementById('cv-field-palette')?.classList.remove('cv-drawer-open');
  }
  if(w > 900 && _cvLastWidth <= 900){
    document.getElementById('cv-props-panel')?.classList.remove('cv-drawer-open');
  }
  _cvUpdateBackdrop();
  _cvLastWidth = w;
});

// Escape key closes any open drawer (a11y + power-user convenience)
document.addEventListener('keydown', e => {
  if(e.key === 'Escape'){
    const palette = document.getElementById('cv-field-palette');
    const props   = document.getElementById('cv-props-panel');
    if(palette?.classList.contains('cv-drawer-open') || props?.classList.contains('cv-drawer-open')){
      e.preventDefault();
      cvCloseAllDrawers();
    }
  }
});

// ── Status bar ───────────────────────────────────────────────────────
function cvUpdateStatusBar(){
  // Inject status bar into canvas toolbar area if not present
  let bar = document.getElementById('cv-status-bar');
  const outer = document.getElementById('cv-canvas-outer');
  if(!outer) return;
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'cv-status-bar';
    bar.style.cssText='padding:3px 10px;background:var(--panel);border-top:1px solid var(--border);font-size:10px;font-family:var(--mono);color:var(--t3);display:flex;gap:16px;flex-shrink:0';
    outer.appendChild(bar);
  }
  const total = cvBlocks.length;
  const fields = cvBlocks.filter(b=>!b.isLayout).length;
  const layouts = cvBlocks.filter(b=>b.isLayout).length;
  const sel = cvSelectedIds.length;
  bar.innerHTML = `<span>Page ${cvCurrentPage+1}/${cvPages.length}</span><span>${total} blocks (${fields} fields, ${layouts} layout)</span>${sel>1?`<span style="color:var(--blue)">${sel} selected</span>`:''}`;
}

// ── Persist ──────────────────────────────────────────────────────────
// V22: route canvas storage through ls/lss helpers. These hand off to the
// vxEntityStore for keys in VX_ENTITY_KEYS — meaning canvas-layout-v1
// and per-method templates now live in IndexedDB (canonical) with a
// localStorage hot cache. Layouts with inline base64 images no longer hit
// the ~5 MB localStorage quota; IDB practical limit is hundreds of MB.
// V25: autosave timestamp tracking. cvSaveLayout records when it last wrote,
// the indicator in the canvas top bar reads this and updates its label every
// few seconds. _cvSavePendingFlash gives a brief "Saving…" visual on every save.
var _cvLastSaveTime = 0;
var _cvSavePendingFlash = 0;

function cvSaveLayout(){
  try {
    _cvSavePendingFlash = Date.now();
    _cvRefreshSaveIndicator();   // immediate "Saving…" feedback
    lss(CV_KEY, { pages: cvPages, currentPage: cvCurrentPage, nextId: cvNextId });
    _cvLastSaveTime = Date.now();
    setTimeout(_cvRefreshSaveIndicator, 350);   // settle to "Saved · just now"
  } catch(e) { console.warn('cvSaveLayout failed', e); }
}

/** Update the autosave indicator's label based on time since last save. */
function _cvRefreshSaveIndicator(){
  const el = document.getElementById('cv-autosave-text');
  if(!el) return;
  const dot = document.getElementById('cv-autosave-dot');
  if(!_cvLastSaveTime){ el.textContent = ''; if(dot) dot.style.background='var(--t3)'; return; }
  const now = Date.now();
  const dt  = now - _cvLastSaveTime;
  // Still mid-save (within 350ms of cvSaveLayout call)
  if(_cvSavePendingFlash && (now - _cvSavePendingFlash) < 300){
    el.textContent = t('pe.autosave.saving','Saving…');
    if(dot){ dot.style.background = 'var(--amber)'; dot.style.animation = 'cv-pulse 0.8s ease-in-out infinite'; }
    return;
  }
  // Just saved (within 4s) → "just now"
  if(dt < 4000){
    el.textContent = t('pe.autosave.saved_just','Saved · just now');
  } else if(dt < 60000){
    el.textContent = tf('pe.autosave.saved_ago','Saved · {n}s ago', { n: Math.floor(dt/1000) });
  } else {
    el.textContent = tf('pe.autosave.saved_min','Saved · {n} min ago', { n: Math.floor(dt/60000) });
  }
  if(dot){ dot.style.background = 'var(--green)'; dot.style.animation = ''; }
}

// Refresh every 5s so the "X seconds ago" label stays current.
setInterval(_cvRefreshSaveIndicator, 5000);
function cvLoadLayout(){
  try {
    const d = ls(CV_KEY, null);
    if(d){
      if(Array.isArray(d.pages) && d.pages.length){
        cvPages = d.pages;
        // Clamp the saved page index into range. A stale or corrupt
        // layout whose currentPage points past the last page would crash
        // cvSync() — it does an unguarded cvPages[cvCurrentPage].blocks.
        cvCurrentPage = Math.min(Math.max(0, d.currentPage || 0), cvPages.length - 1);
      }
      else if(d.blocks){ cvPages = [{ label: 'Page 1', blocks: d.blocks }]; cvCurrentPage = 0; }
      cvNextId = d.nextId || (cvPages.reduce((s,p)=>s+p.blocks.length, 0) + 1);
    }
  } catch(e) { console.warn('cvLoadLayout failed', e); }
  // Re-clamp parented cells into their container's inner area — fixes any
  // cell saved before the title-bar inset existed (it would otherwise
  // keep overlapping the header until next dragged).
  try {
    cvPages.forEach(pg => {
      (pg.blocks || []).forEach(b => {
        // Skip locked cells — a locked cell's position is frozen, so the
        // re-clamp must never move it. Unlocked cells are clamped back
        // into bounds but NOT snapped (snap is drag-only — see
        // _cvClampToParent), so a return to the editor leaves a validly
        // placed cell exactly where the inspector left it.
        if(b && b.key === 'method-cell' && b.parentId && !_cvIsBlockLocked(b)){
          const parent = (pg.blocks || []).find(x => x.id === b.parentId);
          if(parent) _cvClampToParent(b, parent, false);
        }
      });
    });
  } catch(e) { console.warn('cvLoadLayout parenting normalise failed', e); }
}
async function cvClearCanvas(){ if(cvPages[cvCurrentPage].blocks.length && !(await vxConfirm({ message: 'Are you sure you want to clear all blocks from this page?', okLabel: t('vxc.clear','Clear'), danger: true }))) return; cvAutoSnapshot('Before clear'); cvPushUndo(); cvPages[cvCurrentPage].blocks=[];cvSync();cvSelectedId=null;cvSelectedIds=[];cvNextId=1;cvSaveLayout();cvRenderCanvas();cvRenderProps(null);toast(t('toast.page_cleared','Page cleared.')); }

// ── Undo / Redo ──────────────────────────────────────────────────────
function cvPushUndo(){
  cvUndoStack.push(JSON.stringify(cvPages));
  if(cvUndoStack.length>50) cvUndoStack.shift();
  cvRedoStack = [];
  _cvRefreshUndoRedoUI();
}
function cvUndo(){
  if(!cvUndoStack.length){ toast(t('toast.nothing_to_undo', 'Nothing to undo')); return; }
  cvRedoStack.push(JSON.stringify(cvPages));
  cvPages = JSON.parse(cvUndoStack.pop());
  cvSync(); cvSelectedId=null; cvSelectedIds=[];
  cvRenderPageTabs(); cvRenderCanvas(); cvRenderProps(null); cvSaveLayout();
  _cvRefreshUndoRedoUI();
}
function cvRedo(){
  if(!cvRedoStack.length){ toast(t('toast.nothing_to_redo', 'Nothing to redo')); return; }
  cvUndoStack.push(JSON.stringify(cvPages));
  cvPages = JSON.parse(cvRedoStack.pop());
  cvSync(); cvSelectedId=null; cvSelectedIds=[];
  cvRenderPageTabs(); cvRenderCanvas(); cvRenderProps(null); cvSaveLayout();
  _cvRefreshUndoRedoUI();
}

// Sync the page-tabs-bar undo/redo arrow buttons to current stack state.
// Disables the arrow when its stack is empty so the affordance is honest.
function _cvRefreshUndoRedoUI(){
  const u = document.getElementById('cv-undo-btn');
  const r = document.getElementById('cv-redo-btn');
  if(u) u.disabled = !cvUndoStack.length;
  if(r) r.disabled = !cvRedoStack.length;
}

// ── Method template storage ──────────────────────────────────────────
// V22: now uses ls/lss → IndexedDB. Per-method templates can be heavy
// (a single template can include dozens of blocks with inline signatures
// and logos) so localStorage quota was a real risk.
function cvSaveMethodTpl(method){
  if(!method){ toast(t('toast.no_method', 'No method selected')); return; }
  const data = { pages: cvPages, nextId: cvNextId, savedAt: new Date().toISOString() };
  try { lss(CV_METHOD_TPL_PREFIX + method, data); toast(tf('pe.toast.tpl_saved','{method} template saved',{method})); cvRenderTplCards(); }
  catch(e){ toast(t('toast.template_save_failed','Could not save template.')); }
}
function cvLoadMethodTpl(method){
  if(!method){ toast(t('toast.no_method', 'No method selected')); return; }
  try {
    const d = ls(CV_METHOD_TPL_PREFIX + method, null);
    if(!d){ toast(t('toast.no_saved_template','No saved template for this method.')); return; }
    if(d.pages){
      cvPushUndo();
      cvPages = d.pages; cvCurrentPage = 0;
      cvNextId = d.nextId || (cvPages.reduce((s,p)=>s+p.blocks.length,0)+1);
      cvSync(); cvSelectedId = null; cvSelectedIds = [];
      // Sync the ribbon's method dropdown + the preview method so smart
      // fields (template number, method name, method-specific equipment
      // block) resolve against the template the user just loaded rather
      // than whatever was previously selected.
      const sel = document.getElementById('cv-method-select');
      if(sel) sel.value = method;
      cvPpvMethod = method;
      cvRenderPageTabs(); cvRenderCanvas(); cvRenderProps(null); cvSaveLayout();
      // Method tabs (Preview source) reflect cvPpvMethod's active state too —
      // refresh them so the loaded method gets the active visual.
      if(typeof cvRenderMethodBtns === 'function') cvRenderMethodBtns();
      toast(tf('pe.toast.tpl_loaded','{method} template loaded',{method}));
    }
  } catch(e){ toast(t('toast.template_load_failed','Could not load template.')); }
}
async function cvDeleteMethodTpl(method){
  if(!await vxConfirm({ message: `Are you sure you want to delete the saved ${method} template?`, okLabel: t('vxc.delete','Delete'), danger: true })) return;
  // V22: lss with null clears the value through both IDB and localStorage paths
  try { lss(CV_METHOD_TPL_PREFIX + method, null); } catch(e){}
  try { localStorage.removeItem(CV_METHOD_TPL_PREFIX + method); } catch(e){}
  toast(tf('pe.toast.tpl_deleted','{method} template deleted',{method})); cvRenderTplCards();
}
function cvGetMethodTplInfo(method){
  try {
    const d = ls(CV_METHOD_TPL_PREFIX + method, null);
    if(!d) return null;
    return { pages: d.pages?.length||0, blocks: d.pages?.reduce((s,p)=>s+p.blocks.length,0)||0, date: d.savedAt ? new Date(d.savedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—' };
  } catch(e){ return null; }
}
async function cvSaveAsMethodTpl(){
  const allBlocks = cvPages.reduce((a,p)=>a.concat(p.blocks),[]);
  if(!allBlocks.length){ toast(t('toast.design_template_first','Design a template first.')); return; }
  const sel = document.getElementById('cv-method-select');
  const method = sel ? sel.value : 'UT';
  if(await vxConfirm({ message: `Save the current layout as the ${method} template?`, okLabel: t('vxc.save','Save') })) cvSaveMethodTpl(method);
}

// The ribbon's 💾 Save (and Ctrl+S) commit the canvas straight to the
// current method's template — the vx-method-tpl-<method> slot that
// reports read from — with no confirm dialog. cvSaveAsMethodTpl stays as
// the explicit, confirmed variant. The working draft (vx-canvas-layout-v1)
// autosaves on every edit, so it is already current; this is what makes
// the 💾 Save button actually persist a method template.
function cvSaveLayoutToMethod(){
  const allBlocks = cvPages.reduce((a,p)=>a.concat(p.blocks),[]);
  if(!allBlocks.length){ toast(t('toast.design_template_first','Design a template first.')); return; }
  const sel = document.getElementById('cv-method-select');
  const method = (sel && sel.value) || cvPpvMethod || 'UT';
  cvSaveMethodTpl(method);
}

// V25: copy current layout to another method's template slot. Opens a small
// modal with a method picker so the user can target a specific destination
// (vs the "Save for method" button which always uses the visible dropdown).
var CV_KNOWN_METHODS = ['UT','MT','VT','PT','RT','ET','PMI','HT','RFT'];

function cvOpenCopyToMethod(){
  const allBlocks = cvPages.reduce((a,p)=>a.concat(p.blocks),[]);
  if(!allBlocks.length){
    toast(t('toast.design_template_first','Design a template first.'));
    return;
  }
  // Build the dropdown options. Highlight which methods already have a saved
  // template so the user knows when they'd be replacing something.
  const optsHtml = CV_KNOWN_METHODS.map(m => {
    const info = (typeof cvGetMethodTplInfo === 'function') ? cvGetMethodTplInfo(m) : null;
    const has  = !!info;
    const suffix = has ? ` — ${info.pages}p · ${info.blocks}b` : '';
    return `<option value="${m}"${has?' data-has="1"':''}>${m}${suffix}</option>`;
  }).join('');

  const title    = t('pe.copy.title',       'Copy current layout to another method');
  const subtitle = t('pe.copy.subtitle',    "Saves this layout as the selected method's template. The destination's existing template (if any) will be replaced.");
  const lbl      = t('pe.copy.method_label','Destination method');
  const okLbl    = t('pe.copy.confirm',     'Copy');
  const cancelLbl= t('pe.copy.cancel',      'Cancel');

  const html = `
    <div style="padding:18px 20px 16px;max-width:440px">
      <div style="font-size:14px;font-weight:600;color:var(--t1);margin-bottom:6px">${escapeHtml(title)}</div>
      <div style="font-size:11px;color:var(--t3);line-height:1.5;margin-bottom:14px">${escapeHtml(subtitle)}</div>
      <label style="display:block;font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">${escapeHtml(lbl)}</label>
      <select id="cv-copy-method-sel" style="width:100%;padding:7px 9px;font-size:13px;background:var(--bg2);color:var(--t1);border:1px solid var(--border2);border-radius:4px">${optsHtml}</select>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        <button data-action="_wCloseModal" data-args="'cv-copy-modal'" style="padding:7px 14px;font-size:12px;background:transparent;color:var(--t2);border:1px solid var(--border2);border-radius:4px;cursor:pointer">${escapeHtml(cancelLbl)}</button>
        <button data-action="_wCvCopyToMethodConfirm" style="padding:7px 16px;font-size:12px;background:var(--blue);color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600">${escapeHtml(okLbl)}</button>
      </div>
    </div>`;

  _cvShowSimpleModal('cv-copy-modal', html);
}

async function _wCvCopyToMethodConfirm(){
  const sel = document.getElementById('cv-copy-method-sel');
  if(!sel) return;
  const method = sel.value;
  const opt = sel.options[sel.selectedIndex];
  const hasExisting = opt && opt.dataset.has === '1';
  // If destination already has a template, warn before replacing
  if(hasExisting){
    const warn = tf('pe.copy.replace_warn','{method} already has a template. Replace it?', { method });
    if(!await vxConfirm({ message: warn, okLabel: t('vxc.replace','Replace'), danger: true })) return;
  }
  // Re-use existing save logic — same code path as Save for method, but
  // explicit destination chosen via the modal.
  try {
    cvSaveMethodTpl(method);   // this also fires its own toast
    // Override the generic toast with a more specific one for this flow:
    toast(tf('pe.copy.success','Layout copied to {method}', { method }), 'success');
  } catch(e){
    console.error('cvOpenCopyToMethod confirm failed', e);
  }
  _wCloseModal('cv-copy-modal');
}

/** Lightweight modal helper used by cvOpenCopyToMethod (and reusable). */
function _cvShowSimpleModal(id, innerHtml){
  // Clean up any prior instance
  const prior = document.getElementById(id);
  if(prior) prior.remove();
  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;animation:helpFadeIn .15s ease';
  overlay.innerHTML = `<div style="background:var(--panel);border:1px solid var(--border2);border-radius:8px;box-shadow:0 16px 64px rgba(0,0,0,.5);animation:helpScaleIn .18s ease">${innerHtml}</div>`;
  // Close on backdrop click
  overlay.addEventListener('click', e => { if(e.target === overlay) overlay.remove(); });
  // Close on Escape
  overlay.addEventListener('keydown', e => { if(e.key === 'Escape') overlay.remove(); });
  document.body.appendChild(overlay);
  // Focus the first interactive element for keyboard users
  setTimeout(() => {
    const first = overlay.querySelector('select, input, button');
    if(first) first.focus();
  }, 50);
}
function _wCloseModal(id){ const m = document.getElementById(id); if(m) m.remove(); }


// ── Ribbon ───────────────────────────────────────────────────────────
function switchRibbonTab(id, el){
  document.querySelectorAll('#tpl-toolbar .ribbon-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('#tpl-toolbar .ribbon-panel').forEach(p=>p.classList.remove('active'));
  if(el) el.classList.add('active');
  const panel = document.getElementById('ribbon-'+id);
  if(panel) panel.classList.add('active');
  if(id==='tpl-saved') cvRenderTplCards();
}

function cvRenderTplCards(){
  const container = document.getElementById('cv-ribbon-tpl-cards');
  if(!container) return;
  const orderedMethods = (typeof getActiveMethods === 'function') ? getActiveMethods() : NDT_METHODS;
  const methods = orderedMethods.map(m=>m.id);
  container.innerHTML = methods.map(m=>{
    const info = cvGetMethodTplInfo(m);
    const c = (NDT_METHODS.find(x=>x.id===m)||{}).color||'#4f8ef7';
    if(info){
      return `<div style="min-width:130px;background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:4px;position:relative;overflow:hidden;flex-shrink:0"><div style="position:absolute;top:0;left:0;right:0;height:2px;background:${c}"></div><div style="display:flex;align-items:center;justify-content:space-between"><span style="font-family:var(--mono);font-size:12px;font-weight:600;color:${c}">${m}</span><span style="font-size:9px;font-family:var(--mono);color:var(--green)">● saved</span></div><div style="font-size:10px;color:var(--t3)">${info.pages} pg · ${info.blocks} blocks</div><div style="font-size:9px;color:var(--t3);font-family:var(--mono)">${info.date}</div><div style="display:flex;gap:3px;margin-top:2px"><button class="btn btn-sm" style="flex:1;font-size:10px;padding:3px 0" data-action="_wCvLoadMethodAndSwitchTab" data-args="'${m}'">Load</button><button class="btn btn-sm" style="font-size:10px;padding:3px 6px;background:rgba(242,92,92,.12);color:var(--red);border-color:rgba(242,92,92,.25)" data-action="cvDeleteMethodTpl" data-args="'${m}'">✕</button></div></div>`;
    } else {
      return `<div style="min-width:130px;background:var(--panel);border:1px dashed var(--border);border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:4px;position:relative;overflow:hidden;flex-shrink:0;opacity:0.6"><div style="position:absolute;top:0;left:0;right:0;height:2px;background:${c};opacity:0.3"></div><div style="font-family:var(--mono);font-size:12px;font-weight:600;color:${c}">${m}</div><div style="font-size:10px;color:var(--t3)">No template</div><div style="margin-top:auto"><button class="btn btn-sm" style="width:100%;font-size:10px;padding:3px 0" data-action="_wCvSaveAsMethodWithSelect" data-args="'${m}'">Save current</button></div></div>`;
    }
  }).join('');
}

function cvRenderMethodBtns(){
  const container = document.getElementById('cv-ppv-method-btns');
  if(!container) return;
  const ppvMethods = (typeof getActiveMethods === 'function') ? getActiveMethods() : NDT_METHODS;
  container.innerHTML = ppvMethods.map(m=>`<button class="tbe" data-action="cvSetPpvMethod" data-args="'${m.id}'" style="font-size:11px;color:${m.color}">${m.id}</button>`).join('');
}
function cvSetPpvMethod(m){
  // Method switch — re-pick a real saved report for the new method so
  // the canvas keeps showing live data, not a stale pick from the old
  // method. Sample data is left alone: a user who explicitly chose
  // "Sample data" keeps it across method switches.
  const hadRealSource = !!cvPpvReportId;
  cvPpvMethod = m;
  if(hadRealSource) _cvAutoPickPreviewSource(m);
  cvRenderCanvas();
}

// Find the most recent saved report for `method` and adopt it as the
// preview source, *without* flipping the editor into preview mode —
// edit-mode rendering will pick it up too via the report-build path in
// cvRenderCanvas. Quiet no-op when no matching report exists (clears
// the source so the canvas falls back to synthetic sample data).
function _cvAutoPickPreviewSource(method){
  if(!method) return;
  try {
    const reports = (typeof ls === 'function' && typeof KEYS !== 'undefined')
      ? (ls(KEYS.reports, []) || []) : [];
    // Reports are stored append-only, so the last entry for a method
    // is the most recent. Walking from the end is cheaper than sorting.
    let recent = null;
    for(let i = reports.length - 1; i >= 0; i--){
      const r = reports[i];
      if(r && r.method === method && (r.reportNo || r.id)){ recent = r; break; }
    }
    const sel   = document.getElementById('cv-ppv-source');
    const badge = document.getElementById('cv-preview-badge');
    if(recent){
      cvPpvReportId = recent.reportNo || recent.id;
      cvPpvResult = recent.verdict === 'Acceptable' ? 'Pass'
                  : recent.verdict === 'Not acceptable' ? 'Fail' : 'Monitor';
      if(sel)   sel.value = cvPpvReportId;
      if(badge){ badge.style.display = 'inline-block'; badge.textContent = '⚡ Live: ' + cvPpvReportId; }
    } else {
      cvPpvReportId = null;
      if(sel)   sel.value = '';
      if(badge) badge.style.display = 'none';
    }
  } catch(e){ /* sample-data fallback is fine */ }
}
function cvSetPpvResult(r){ cvPpvResult=r; cvRenderCanvas(); }

// ── Template config ──────────────────────────────────────────────────
function _cvPersistTplCfg(){
  try{ localStorage.setItem(CV_TPL_KEY, JSON.stringify(cvTplCfg)); }catch(e){}
}
function cvSaveTplConfig(){
  _cvPersistTplCfg();
  cvSaveLayout();
  toast(t('toast.template_saved','Template saved.'));
}
async function cvResetTplConfig(){
  if(!await vxConfirm({ message: 'Are you sure you want to reset the template configuration?', okLabel: t('vxc.reset','Reset'), danger: true })) return;
  cvTplCfg = {
    sectionColor:'#404040', margin:'8px', baseSize:'8.5px',
    showLogo:true, showFooter:true,
    tplLogo:null, logoPos:'left', logoSize:'md',
    content:{},
    header:{ enabled:false, heightPx:100, bgColor:'transparent', accentColor:'', accentThicknessPx:4, accentPos:'bottom', borderStyle:'none', borderColor:'', paddingPx:8 },
    footer:{ enabled:false, heightPx:60,  bgColor:'transparent', accentColor:'', accentThicknessPx:2, accentPos:'top',    borderStyle:'none', borderColor:'', paddingPx:8 },
    lockZones:false,
  };
  localStorage.removeItem(CV_TPL_KEY);
  cvRenderCanvas();
  toast(t('toast.template_reset', 'Template config reset'));
}
function cvLoadTplConfig(){
  try{ const raw=localStorage.getItem(CV_TPL_KEY); if(raw) cvTplCfg = Object.assign({}, cvTplCfg, JSON.parse(raw)); }catch(e){}
}

// ══════════════════════════════════════════════════════════════════
// HEADER / FOOTER DESIGNER
// Free-form per-zone style editor — opens a modal with two parallel
// columns of controls (header + footer) covering height, background,
// accent strip, border and padding. Live-applies to cvTplCfg as the
// user edits; Apply persists template config; Cancel reverts to the
// snapshot taken at open time.
// ══════════════════════════════════════════════════════════════════
var _cvHFDesignerSnapshot = null;   // JSON-clone of cvTplCfg.header + .footer at open time

function _cvHFD_fieldIds(zone){
  const p = zone === 'header' ? 'h' : 'f';
  return {
    enabled:      'hfd-' + p + '-enabled',
    height:       'hfd-' + p + '-height',
    bgColor:      'hfd-' + p + '-bg',
    bgHex:        'hfd-' + p + '-bg-hex',
    accentPos:    'hfd-' + p + '-accent-pos',
    accentThick:  'hfd-' + p + '-accent-thick',
    accentColor:  'hfd-' + p + '-accent-color',
    accentHex:    'hfd-' + p + '-accent-hex',
    borderStyle:  'hfd-' + p + '-border-style',
    borderColor:  'hfd-' + p + '-border-color',
    borderHex:    'hfd-' + p + '-border-hex',
    padding:      'hfd-' + p + '-padding',
  };
}
function _cvHFD_val(id){ const e = document.getElementById(id); return e ? e.value : ''; }
function _cvHFD_setVal(id, v){ const e = document.getElementById(id); if(e) e.value = v == null ? '' : String(v); }
function _cvHFD_setChecked(id, v){ const e = document.getElementById(id); if(e) e.checked = !!v; }
function _cvHFD_getChecked(id){ const e = document.getElementById(id); return e ? !!e.checked : false; }

// Load values from cvTplCfg into the form.
function _cvHFD_loadZone(zone){
  const cfg = cvTplCfg[zone] || {};
  const ids = _cvHFD_fieldIds(zone);
  _cvHFD_setChecked(ids.enabled, cfg.enabled);
  _cvHFD_setVal(ids.height, cfg.heightPx || (zone === 'header' ? 100 : 60));
  const bg = (cfg.bgColor && cfg.bgColor !== 'transparent') ? cfg.bgColor : '';
  _cvHFD_setVal(ids.bgHex, bg || 'transparent');
  if(bg && /^#[0-9a-fA-F]{6}$/.test(bg)) _cvHFD_setVal(ids.bgColor, bg);
  _cvHFD_setVal(ids.accentPos,   cfg.accentPos   || 'none');
  _cvHFD_setVal(ids.accentThick, cfg.accentThicknessPx != null ? cfg.accentThicknessPx : (zone === 'header' ? 4 : 2));
  if(cfg.accentColor && /^#[0-9a-fA-F]{6}$/.test(cfg.accentColor)){
    _cvHFD_setVal(ids.accentColor, cfg.accentColor);
    _cvHFD_setVal(ids.accentHex,   cfg.accentColor);
  } else {
    _cvHFD_setVal(ids.accentColor, cvTplCfg.sectionColor || '#404040');
    _cvHFD_setVal(ids.accentHex,   '');
  }
  _cvHFD_setVal(ids.borderStyle, cfg.borderStyle || 'none');
  if(cfg.borderColor && /^#[0-9a-fA-F]{6}$/.test(cfg.borderColor)){
    _cvHFD_setVal(ids.borderColor, cfg.borderColor);
    _cvHFD_setVal(ids.borderHex,   cfg.borderColor);
  } else {
    _cvHFD_setVal(ids.borderColor, '#cccccc');
    _cvHFD_setVal(ids.borderHex,   '');
  }
  _cvHFD_setVal(ids.padding, cfg.paddingPx != null ? cfg.paddingPx : 8);
}

// Read form values back into cvTplCfg (live-apply pattern). Returns the
// resolved config so callers can decide whether to persist.
function _cvHFD_readZone(zone){
  const ids = _cvHFD_fieldIds(zone);
  if(!cvTplCfg[zone]) cvTplCfg[zone] = {};
  const cfg = cvTplCfg[zone];
  cfg.enabled  = _cvHFD_getChecked(ids.enabled);
  cfg.heightPx = Math.max(10, +_cvHFD_val(ids.height) || (zone === 'header' ? 100 : 60));
  // Background: hex input wins when it parses; 'transparent' / empty resets.
  const bgHex = (_cvHFD_val(ids.bgHex) || '').trim();
  if(/^transparent$/i.test(bgHex) || bgHex === '') cfg.bgColor = 'transparent';
  else if(/^#[0-9a-fA-F]{6}$/.test(bgHex)) cfg.bgColor = bgHex;
  else cfg.bgColor = _cvHFD_val(ids.bgColor) || 'transparent';
  cfg.accentPos         = _cvHFD_val(ids.accentPos)   || 'none';
  cfg.accentThicknessPx = Math.max(0, Math.min(12, +_cvHFD_val(ids.accentThick) || 0));
  const accHex = (_cvHFD_val(ids.accentHex) || '').trim();
  cfg.accentColor = /^#[0-9a-fA-F]{6}$/.test(accHex) ? accHex : '';   // '' = inherit sectionColor
  cfg.borderStyle = _cvHFD_val(ids.borderStyle) || 'none';
  const brdHex = (_cvHFD_val(ids.borderHex) || '').trim();
  cfg.borderColor = /^#[0-9a-fA-F]{6}$/.test(brdHex) ? brdHex : '';
  cfg.paddingPx   = Math.max(0, Math.min(40, +_cvHFD_val(ids.padding) || 0));
  return cfg;
}

// Wire change/input listeners so every edit live-applies to cvTplCfg and
// re-renders the canvas bands. Wired once; subsequent opens just reload
// values into the existing inputs.
var _cvHFD_wired = false;
function _cvHFD_wire(){
  if(_cvHFD_wired) return;
  ['header','footer'].forEach(zone => {
    const ids = _cvHFD_fieldIds(zone);
    Object.keys(ids).forEach(k => {
      const el = document.getElementById(ids[k]);
      if(!el) return;
      const evt = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
      el.addEventListener(evt, () => {
        // Mirror color/hex pairs: editing the picker fills the hex input,
        // editing the hex (when valid) updates the picker. Same idea used in
        // the Settings → Company colour picker.
        if(k === 'bgColor')     _cvHFD_setVal(ids.bgHex, el.value);
        else if(k === 'bgHex' && /^#[0-9a-fA-F]{6}$/.test((el.value||'').trim())) _cvHFD_setVal(ids.bgColor, el.value.trim());
        if(k === 'accentColor') _cvHFD_setVal(ids.accentHex, el.value);
        else if(k === 'accentHex' && /^#[0-9a-fA-F]{6}$/.test((el.value||'').trim())) _cvHFD_setVal(ids.accentColor, el.value.trim());
        if(k === 'borderColor') _cvHFD_setVal(ids.borderHex, el.value);
        else if(k === 'borderHex' && /^#[0-9a-fA-F]{6}$/.test((el.value||'').trim())) _cvHFD_setVal(ids.borderColor, el.value.trim());
        _cvHFD_readZone(zone);
        cvRenderCanvas();
        // Keep the ribbon's quick-toggles in sync too.
        _cvSyncHeaderFooterUI();
      });
    });
  });
  _cvHFD_wired = true;
}

function cvOpenHFDesigner(){
  const modal = document.getElementById('cv-hf-designer');
  if(!modal) return;
  // Snapshot current state so Cancel can revert.
  _cvHFDesignerSnapshot = JSON.parse(JSON.stringify({
    header: cvTplCfg.header || {},
    footer: cvTplCfg.footer || {},
  }));
  _cvHFD_loadZone('header');
  _cvHFD_loadZone('footer');
  _cvHFD_wire();
  modal.classList.add('open');
}

function cvCloseHFDesigner(){
  const modal = document.getElementById('cv-hf-designer');
  if(!modal) return;
  // Revert to snapshot — every live edit since open is rolled back.
  if(_cvHFDesignerSnapshot){
    cvTplCfg.header = _cvHFDesignerSnapshot.header;
    cvTplCfg.footer = _cvHFDesignerSnapshot.footer;
    _cvHFDesignerSnapshot = null;
    cvRenderCanvas();
    _cvSyncHeaderFooterUI();
  }
  modal.classList.remove('open');
}

function cvSaveHFDesigner(){
  const modal = document.getElementById('cv-hf-designer');
  if(!modal) return;
  // Edits are already live in cvTplCfg via the wired listeners. Just persist
  // and drop the snapshot so close-via-X stops trying to revert.
  _cvHFD_readZone('header');
  _cvHFD_readZone('footer');
  _cvPersistTplCfg();
  _cvHFDesignerSnapshot = null;
  modal.classList.remove('open');
  toast(t('pe.hfd.saved', 'Header & footer style saved.'), 'success');
}

function cvHFDesignerMirror(){
  // Copy every relevant header field onto the footer form, then sync.
  const src = _cvHFD_fieldIds('header');
  const dst = _cvHFD_fieldIds('footer');
  ['bgColor','bgHex','accentColor','accentHex','accentThick','borderStyle','borderColor','borderHex','padding'].forEach(k => {
    _cvHFD_setVal(dst[k], _cvHFD_val(src[k]));
  });
  // Accent position mirrors with a sensible default: if header has accent at
  // the bottom (most common — divider between header and body), footer takes
  // accent at the top (divider between body and footer).
  const hAccPos = _cvHFD_val(src.accentPos);
  _cvHFD_setVal(dst.accentPos, hAccPos === 'bottom' ? 'top' : hAccPos);
  _cvHFD_readZone('footer');
  cvRenderCanvas();
}

async function cvHFDesignerReset(){
  if(!await vxConfirm({ message: t('pe.hfd.confirm_reset','Reset header and footer style to defaults?'), okLabel: t('vxc.reset','Reset'), danger: true })) return;
  cvTplCfg.header = { enabled:false, heightPx:100, bgColor:'transparent', accentColor:'', accentThicknessPx:4, accentPos:'bottom', borderStyle:'none', borderColor:'', paddingPx:8 };
  cvTplCfg.footer = { enabled:false, heightPx:60,  bgColor:'transparent', accentColor:'', accentThicknessPx:2, accentPos:'top',    borderStyle:'none', borderColor:'', paddingPx:8 };
  _cvHFD_loadZone('header');
  _cvHFD_loadZone('footer');
  cvRenderCanvas();
  _cvSyncHeaderFooterUI();
}

function _wHFDClearColor(slot){
  // Bg-only clear button — wipes the hex field to 'transparent' and triggers
  // the live-apply pipeline. Accent / border don't have a clear button (they
  // have a select that already includes a "None / no accent" option).
  const [p, kind] = slot.split('-');
  const ids = _cvHFD_fieldIds(p === 'h' ? 'header' : 'footer');
  if(kind === 'bg'){
    _cvHFD_setVal(ids.bgHex, 'transparent');
    document.getElementById(ids.bgHex).dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// ── Logo handlers + saved-logo library ───────────────────────────────
// Single active logo per template (cvTplCfg.tplLogo). Uploads are also
// auto-added to a small cross-template library so the user can swap
// between previously-used logos without re-uploading.
var CV_LOGO_LIB_KEY = 'vx-logo-library-v1';
var CV_LOGO_LIB_MAX = 12;

function cvHandleLogoUpload(file){
  if(!file) return;
  const fallbackName = (file.name || 'Logo').replace(/\.[^.]+$/, '').trim().slice(0, 40) || 'Logo';
  const reader = new FileReader();
  reader.onload = e => {
    const rawDataUrl = e.target.result;
    // Route through the existing crop modal. If it's not available (e.g.
    // page partially loaded), fall back to saving the raw image so the
    // upload still works end-to-end.
    if(typeof openCropModal !== 'function'){
      _cvFinishLogoUpload(rawDataUrl, fallbackName);
      return;
    }
    openCropModal({
      src: rawDataUrl,
      onApply: croppedDataUrl => _cvFinishLogoUpload(croppedDataUrl, fallbackName),
      // Cancel → discard upload silently. The user explicitly bailed out.
      onCancel: () => {},
    });
  };
  reader.readAsDataURL(file);
}

async function _cvFinishLogoUpload(dataUrl, fallbackName){
  const raw = await vxPrompt({ message: t('pe.logo_lib.name_prompt','Name this logo:'), defaultValue: fallbackName });
  if(raw === null) return;          // user cancelled → discard
  const name = raw.trim();
  if(name === '') return;           // empty → discard
  cvTplCfg.tplLogo = dataUrl;
  _cvPersistTplCfg();
  cvLogoLibAdd(dataUrl, name);
  cvUpdateLogoThumb();
  cvRenderLogoLib();
  cvRenderPalette('');   // refresh palette so the new logo's place card appears
  cvRenderCanvas();
  toast(t('toast.logo_uploaded', 'Logo uploaded.'));
}

// The bare `cvHandleLogoUpload` callsite in the markup uses data-pass-el="1",
// which hands the dispatcher the input element. This wrapper pulls the
// file off it before calling the real handler.
function _wCvHandleLogoUpload(el){
  const f = el && el.files && el.files[0];
  if(f) cvHandleLogoUpload(f);
  if(el) el.value = '';  // allow re-uploading the same filename
}

function cvClearLogo(){
  cvTplCfg.tplLogo = null;
  _cvPersistTplCfg();
  cvUpdateLogoThumb();
  cvRenderLogoLib();   // re-render to drop the active-ring
  cvRenderCanvas();
  toast(t('toast.logo_removed', 'Logo removed.'));
}

function cvSetLogoPos(pos){
  cvTplCfg.logoPos = pos;
  ['left','center','right'].forEach(p=>{ const b=document.getElementById('cv-logo-pos-'+p); if(b) b.classList.toggle('active',p===pos); });
  cvRenderCanvas();
}
function cvSetLogoSize(sz){ cvTplCfg.logoSize = sz; cvRenderCanvas(); }
function cvUpdateLogoThumb(){
  const img = document.getElementById('cv-logo-thumb');
  const ph  = document.getElementById('cv-logo-thumb-ph');
  if(!img) return;
  if(cvTplCfg.tplLogo){
    img.src = cvTplCfg.tplLogo;
    img.style.display = '';
    if(ph) ph.style.display = 'none';
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
    if(ph) ph.style.display = '';
  }
}

// ── Logo library ─────────────────────────────────────────────────────
function cvLogoLibLoad(){
  try { return JSON.parse(localStorage.getItem(CV_LOGO_LIB_KEY) || '[]'); }
  catch(e){ return []; }
}
function cvLogoLibSave(lib){
  try { localStorage.setItem(CV_LOGO_LIB_KEY, JSON.stringify(lib)); }
  catch(e){ console.warn('logo library save failed (quota?)', e); }
}
function cvLogoLibAdd(dataUrl, name){
  if(!dataUrl) return;
  const safeName = (name && String(name).trim()) || 'Logo';
  let lib = cvLogoLibLoad().filter(e => e && e.dataUrl !== dataUrl);
  lib.unshift({ id: 'l_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6), dataUrl, name: safeName, addedAt: Date.now() });
  if(lib.length > CV_LOGO_LIB_MAX) lib = lib.slice(0, CV_LOGO_LIB_MAX);
  cvLogoLibSave(lib);
}
function cvLogoLibPick(id){
  const entry = cvLogoLibLoad().find(e => e && e.id === id);
  if(!entry) return;
  cvTplCfg.tplLogo = entry.dataUrl;
  _cvPersistTplCfg();
  cvUpdateLogoThumb();
  cvRenderLogoLib();
  cvRenderCanvas();
}
function cvLogoLibRemove(id){
  const lib = cvLogoLibLoad().filter(e => e && e.id !== id);
  cvLogoLibSave(lib);
  cvRenderLogoLib();
  cvRenderPalette('');     // the place card for this logo disappears too
  cvRenderCanvas();        // any logo-lib:<id> blocks now render as missing
}

// Palette card delete handler — same destination as the ribbon × button
// but goes through vxConfirm so a stray click doesn't nuke a saved logo.
async function _wCvDeleteLogoLibCard(id){
  const entry = cvLogoLibLoad().find(e => e && e.id === id);
  const name = (entry && entry.name) || 'this logo';
  const ok = await vxConfirm({
    message: t('pe.logo_lib.confirm_remove', 'Remove "' + name + '" from your logo library? Blocks already placed on the canvas will show a placeholder.'),
    okLabel: t('vxc.remove', 'Remove'),
    danger: true,
  });
  if(!ok) return;
  cvLogoLibRemove(id);
}
function cvRenderLogoLib(){
  const host = document.getElementById('cv-logo-lib');
  if(!host) return;
  const lib = cvLogoLibLoad();
  if(!lib.length){
    host.innerHTML = `<div style="font-size:9px;color:var(--t3);padding:4px 2px;line-height:1.3">${escapeHtml(t('pe.logo_lib.empty','Uploaded logos appear here for reuse.'))}</div>`;
    return;
  }
  const active = cvTplCfg.tplLogo;
  const pickTitle   = t('pe.logo_lib.pick',   'Click to use');
  const removeTitle = escapeHtml(t('pe.logo_lib.remove', 'Remove from library'));
  host.innerHTML = lib.map(e => {
    const isActive = e.dataUrl === active;
    const ring = isActive ? 'border:1.5px solid var(--blue);box-shadow:0 0 0 1px var(--blue) inset' : 'border:1px solid var(--border2)';
    const name = e.name || 'Logo';
    const title = escapeHtml(name + ' — ' + pickTitle);
    return `<div class="cv-logo-lib-item" style="position:relative;width:36px;height:28px;border-radius:3px;${ring};overflow:hidden;flex-shrink:0;background:#fff" title="${title}">
      <img src="${e.dataUrl}" data-action="cvLogoLibPick" data-args="'${escapeHtml(e.id)}'" style="width:100%;height:100%;object-fit:contain;display:block;cursor:pointer"/>
      <button class="tbe" data-action="cvLogoLibRemove" data-args="'${escapeHtml(e.id)}'" style="position:absolute;top:-1px;right:-1px;padding:0;width:14px;height:14px;border-radius:0 3px 0 3px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;line-height:14px;border:none;cursor:pointer" title="${removeTitle}">×</button>
    </div>`;
  }).join('');
}

// ── Design helpers ───────────────────────────────────────────────────
function cvSetSectionColor(c){
  cvTplCfg.sectionColor = c;
  const el = document.getElementById('cv-sec-custom'); if(el) el.value = c;
  cvBlocks.forEach(b=>{ if(b.isLayout && b.key==='section-header') b.bgColor=c; });
  cvRenderCanvas(); cvSaveLayout();
}

function cvInsertTable(){ cvAddBlockDefault('text-block',true); toast(t('toast.table_edit_hint', 'Table: edit the text block content in Properties')); }
function cvInsertHRule(){ cvAddBlockDefault('h-line',true); }
function cvInsertPageBreak(){ cvAddPage(); }

// ── Full-page overlay mode ───────────────────────────────────────────
function cvOpenFullPage(){
  const pdfSec = document.getElementById('ss-pdfeditor');
  if(!pdfSec || pdfSec._fsActive) return;
  pdfSec._fsActive = true;

  // Store originals
  const toolbar = document.getElementById('tpl-toolbar');
  const frame   = document.getElementById('cv-editor-frame');
  pdfSec._orig  = pdfSec.getAttribute('style')||'';
  if(toolbar) toolbar._orig = toolbar.getAttribute('style')||'';
  if(frame)   frame._orig   = frame.getAttribute('style')||'';

  // Hide section header
  const sh = pdfSec.querySelector('.sh');
  if(sh) sh.style.display = 'none';

  // Section → fixed full viewport
  pdfSec.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;background:var(--bg);overflow:hidden;padding:0;margin:0';

  // Toolbar → remove rounded corners and margin for edge-to-edge
  if(toolbar) toolbar.style.cssText = (toolbar._orig||'').replace(/border-radius[^;]*/g,'border-radius:0').replace(/margin[^;]*/g,'margin:0') + ';flex-shrink:0';

  // 3-panel frame → fill remaining height
  if(frame) frame.style.cssText = 'display:flex;flex:1;overflow:hidden;background:var(--bg);border:none;border-radius:0;margin:0;height:auto;min-height:0';

  // Close button
  if(!document.getElementById('cv-fs-close')){
    const cb = document.createElement('button');
    cb.id = 'cv-fs-close';
    cb.style.cssText = 'position:fixed;top:8px;right:12px;z-index:10001;padding:5px 14px;border-radius:6px;border:1px solid rgba(242,92,92,.35);background:rgba(13,18,25,.95);color:#f87171;font-size:12px;font-family:var(--mono);cursor:pointer;display:flex;align-items:center;gap:6px;backdrop-filter:blur(8px);transition:all .15s';
    cb.innerHTML = '<span style="font-size:14px">\u2715</span> Close editor';
    cb.onmouseenter = function(){ this.style.background='rgba(242,92,92,.2)'; };
    cb.onmouseleave = function(){ this.style.background='rgba(13,18,25,.95)'; };
    cb.onclick = cvCloseFullPage;
    document.body.appendChild(cb);
  }

  // Fit canvas after layout settles
  setTimeout(()=>{ cvFitToView(); }, 150);
  setTimeout(()=>{ cvFitToView(); }, 400);
}

function cvCloseFullPage(){
  const pdfSec = document.getElementById('ss-pdfeditor');
  if(!pdfSec) return;
  pdfSec._fsActive = false;

  // Restore header
  const sh = pdfSec.querySelector('.sh');
  if(sh) sh.style.display = '';

  // Restore styles
  pdfSec.setAttribute('style', pdfSec._orig||'');
  const toolbar = document.getElementById('tpl-toolbar');
  if(toolbar && toolbar._orig !== undefined) toolbar.setAttribute('style', toolbar._orig);
  const frame = document.getElementById('cv-editor-frame');
  if(frame && frame._orig !== undefined) frame.setAttribute('style', frame._orig);

  // Remove close button
  const cb = document.getElementById('cv-fs-close');
  if(cb) cb.remove();

  setTimeout(()=>{ cvFitToView(); }, 100);
}

document.addEventListener('fullscreenchange', ()=>{ if(!document.fullscreenElement) cvCloseFullPage(); });

// Escape key closes the full-page editor
document.addEventListener('keydown', e=>{
  if(e.key === 'Escape'){
    const pdfSec = document.getElementById('ss-pdfeditor');
    if(pdfSec && pdfSec._fsActive){ e.preventDefault(); cvCloseFullPage(); }
  }
});

// ══════════════════════════════════════════════════════════════════════════
// V23 PDF EDITOR KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════════════════
// All shortcuts gate on: (1) PDF editor is the visible page, (2) focus is
// not inside an input/textarea/contenteditable. The second guard means a
// user typing in the palette search box, the find-replace dialog, a property
// input, or directly inside a text-block (contenteditable) gets the native
// keyboard behaviour. Outside those, the canvas owns the shortcut.
//
// Implemented:
//   Delete / Backspace  → delete selected blocks
//   Ctrl/Cmd + D        → duplicate selected
//   Ctrl/Cmd + A        → select all blocks on current page
//   Ctrl/Cmd + C / X    → copy / cut selected
//   Ctrl/Cmd + V        → paste clipboard
//   Ctrl/Cmd + Z        → undo
//   Ctrl/Cmd + Shift + Z   or   Ctrl/Cmd + Y  → redo
//   Ctrl/Cmd + S        → save layout (with toast)
//   Ctrl/Cmd + P        → print / export PDF
//   Arrow keys          → nudge selected by 1 px
//   Shift + Arrow keys  → nudge by 10 px
//   Escape              → deselect all (or close full-page if active)

/** Is the PDF editor the visible context? */
function _cvIsActive(){
  const ed = document.getElementById('ss-pdfeditor');
  return !!ed && (ed.classList.contains('active') || ed._fsActive);
}

/** Is the user typing in a text input we shouldn't override? */
function _cvFocusIsTyping(){
  const el = document.activeElement;
  if(!el) return false;
  const tag = el.tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if(el.isContentEditable) return true;
  return false;
}

/** Nudge selected blocks by (dx, dy) pixels. */
function _cvNudge(dx, dy){
  const ids = cvSelectedIds.length ? cvSelectedIds : (cvSelectedId ? [cvSelectedId] : []);
  if(!ids.length) return false;
  cvPushUndo();
  ids.forEach(id => {
    const b = cvBlocks.find(bb => bb.id === id);
    if(!b || _cvIsBlockLocked(b)) return;
    b.x = Math.max(0, b.x + dx);
    b.y = Math.max(0, b.y + dy);
  });
  // Update positions in-place without full re-render
  ids.forEach(id => {
    const b = cvBlocks.find(bb => bb.id === id);
    const el = document.getElementById('cblk-' + id);
    if(b && el){ el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; }
    // V25: invalidate cache — block JSON changed, sig is now stale
    _cvBlockElCache.delete(id);
  });
  cvUpdatePropsPositionLive();
  cvSaveLayout();
  // V25: refresh persistent alignment guides — positions changed
  _cvRefreshAlignGuides();
  return true;
}

/** Cut = copy then delete. */
function cvCutSelected(){
  cvCopySelected();
  cvDeleteSelected();
}

document.addEventListener('keydown', e => {
  if(!_cvIsActive()) return;
  if(_cvFocusIsTyping()){
    // Inside a text input — only special-case Escape and Ctrl+P which we
    // intercept regardless because they're unambiguous user intents.
    if(e.key === 'Escape'){
      // Let Escape blur the input naturally; don't return — fall through
      // so the full-page exit check below still applies.
    } else if((e.ctrlKey || e.metaKey) && e.key === 'p' && !e.shiftKey && !e.altKey){
      // Still intercept Ctrl+P — print intent is unambiguous
    } else {
      return;
    }
  }

  const mod = e.ctrlKey || e.metaKey;

  // ── Save: Ctrl/Cmd + S — commit to the current method's template ──
  if(mod && e.key === 's' && !e.shiftKey && !e.altKey){
    e.preventDefault();
    try { cvSaveLayoutToMethod(); } catch(err){ console.error(err); }
    return;
  }

  // ── Print: Ctrl/Cmd + P ──
  if(mod && e.key === 'p' && !e.shiftKey && !e.altKey){
    e.preventDefault();
    cvPrintOrExport();
    return;
  }

  // ── Undo / Redo ──
  if(mod && e.key === 'z' && !e.shiftKey && !e.altKey){
    e.preventDefault();
    cvUndo();
    return;
  }
  if(mod && ((e.key === 'z' && e.shiftKey) || (e.key === 'y' && !e.shiftKey))){
    e.preventDefault();
    cvRedo();
    return;
  }

  // ── Select all ──
  if(mod && e.key === 'a' && !e.shiftKey && !e.altKey){
    e.preventDefault();
    cvSelectAllBlocks();
    return;
  }

  // ── Copy / Cut / Paste ──
  if(mod && e.key === 'c' && !e.shiftKey && !e.altKey){
    e.preventDefault();
    cvCopySelected();
    return;
  }
  if(mod && e.key === 'x' && !e.shiftKey && !e.altKey){
    e.preventDefault();
    cvCutSelected();
    return;
  }
  if(mod && e.key === 'v' && !e.shiftKey && !e.altKey){
    e.preventDefault();
    cvPasteClipboard();
    return;
  }

  // ── Duplicate: Ctrl/Cmd + D ──
  if(mod && e.key === 'd' && !e.shiftKey && !e.altKey){
    e.preventDefault();
    const ids = cvSelectedIds.length ? cvSelectedIds : (cvSelectedId ? [cvSelectedId] : []);
    if(ids.length){
      // Duplicate each — cvDuplicateBlock pushes its own undo per call;
      // wrap in a batch undo for "duplicate 5 at once" → single undo step.
      cvPushUndo();
      const before = cvBlocks.length;
      ids.forEach(id => {
        const b = cvBlocks.find(bb => bb.id === id);
        if(!b) return;
        cvBlocks.push(_cvCloneBlock(b));
      });
      const newBlocks = cvBlocks.slice(before);
      cvSelectedIds = newBlocks.map(b => b.id);
      _cvPrimaryToFirst();    // batch convention: first new copy becomes primary
      cvRenderCanvas();
      cvRenderProps(cvSelectedId);
      cvSaveLayout();
    }
    return;
  }

  // ── Delete ──
  if(e.key === 'Delete' || e.key === 'Backspace'){
    const hasSelection = cvSelectedIds.length || cvSelectedId;
    if(hasSelection){
      e.preventDefault();
      cvDeleteSelected();
    }
    return;
  }

  // ── Escape ──
  if(e.key === 'Escape'){
    // First priority: close full-page editor (handled by earlier listener)
    const pdfSec = document.getElementById('ss-pdfeditor');
    if(pdfSec && pdfSec._fsActive){
      // Earlier handler covers this; don't double-handle
      return;
    }
    // Otherwise: deselect
    if(cvSelectedIds.length || cvSelectedId){
      e.preventDefault();
      cvSelectedId = null;
      cvSelectedIds = [];
      cvUpdateSelectionUI();   // V23: lightweight update; no full re-render
      cvRenderProps(null);
    }
    return;
  }

  // ── Arrow keys: nudge ──
  if(e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight'){
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0;
    if(_cvNudge(dx, dy)) e.preventDefault();
    return;
  }
});

