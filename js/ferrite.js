// ══════════════════════════════════════════════════════════════════════════
// FERRITE SURVEY (FN) — shared data model, visual renderer and report-form
// data-entry grid. ONE renderer (fnRenderSurvey) feeds both the on-screen form
// preview AND the sealed PDF (via the editor's 'fn-survey' block). Print/light
// palette: the PDF is a white page, so the chart is dark-ink-on-white.
//
// Ferrite Number (FN) measurement of weld metal (Feritscope / magnetic, per
// ASTM A800 / AWS A4.2 / ISO 8249). Each weld carries several measurement
// LOCATIONS (e.g. Cap / Mid-wall / Root); each location holds up to 3 readings
// whose AVERAGE is the reported & plotted value. Acceptance is a BAND — a
// minimum AND a maximum FN — unlike hardness's single max, because too little
// ferrite risks hot-cracking and too much risks embrittlement.
// One weld == one Examination-details item line (mirrors the HT site mode).
// ══════════════════════════════════════════════════════════════════════════

function fnAvg(r){
  var v = (r || []).map(function(x){ return parseFloat(x); }).filter(function(x){ return !isNaN(x); });
  if(!v.length) return null;
  return Math.round(v.reduce(function(s,x){ return s + x; }, 0) / v.length * 10) / 10;
}

// A survey holds MANY welds (one per examination item). A "weld view" exposes a
// single weld's points with the shared scale/limits so per-weld renderers work.
function _fnWeldView(base, weld){
  weld = weld || {};
  return { scale:base.scale, limitMin:base.limitMin, limitMax:base.limitMax, componentType:weld.componentType, bore:weld.bore, points:weld.points };
}
// Normalise to { scale, limitMin, limitMax, welds:[{points:[…]}] }. A legacy
// single-weld shape (top-level points) wraps into welds[0]. Idempotent.
function fnNormalize(survey){
  if(!survey || Array.isArray(survey.welds)) return survey;
  var base = { scale: survey.scale || '% ferrite',
               material: survey.material || '',
               limitMin: (survey.limitMin != null ? survey.limitMin : 35),
               limitMax: (survey.limitMax != null ? survey.limitMax : 65) };
  base.welds = [ { points: survey.points || [] } ];
  return base;
}
function fnWeldCount(survey){ survey = fnNormalize(survey); return (survey && survey.welds) ? survey.welds.length : 0; }

function _fnAll(survey){
  if(!survey) return [];
  survey = fnNormalize(survey);
  var out = [];
  (survey.welds || []).forEach(function(w){ (w.points || []).forEach(function(p){ out.push({ label:p.label, avg:fnAvg(p.r) }); }); });
  return out;
}
function fnRange(survey){
  var vals = _fnAll(survey).map(function(a){ return a.avg; }).filter(function(x){ return x != null; });
  if(!vals.length) return { lo:null, hi:null };
  return { lo: Math.min.apply(null, vals), hi: Math.max.apply(null, vals) };
}
// out-of-band = below the min OR above the max (either bound optional).
function _fnOut(avg, lo, hi){ if(avg == null) return false; if(lo && avg < lo) return true; if(hi && avg > hi) return true; return false; }
function fnVerdict(survey){
  survey = fnNormalize(survey);
  var lo = parseFloat(survey && survey.limitMin) || 0, hi = parseFloat(survey && survey.limitMax) || 0;
  var all = _fnAll(survey).filter(function(a){ return a.avg != null; });
  var over = all.filter(function(a){ return _fnOut(a.avg, lo, hi); }).length;
  return { over:over, passed:over === 0, total:all.length };
}
function fnIsEmpty(survey){ return fnVerdict(survey).total === 0; }

// ── Acceptance presets + testing-parameter (sampling) tables ─────────────────
// Material acceptance bands (% ferrite). Picking a material sets min/max + unit.
var FN_MATERIAL_PRESETS = {
  duplex:     { label:'Duplex stainless steel',     min:35, max:65, unit:'% ferrite' },
  austenitic: { label:'Austenitic stainless steel', min:3,  max:8,  unit:'% ferrite' },
  custom:     { label:'Custom / other',             min:null, max:null, unit:'% ferrite' },
};
function fnMaterialLabel(m){ var p = FN_MATERIAL_PRESETS[m]; return p ? p.label : ''; }
// Nominal-bore / OD band sets, by table. Each entry: [key, label].
var FN_BANDS = {
  pipe:  [['s', 'D ≤ 6″'], ['m', '6″ < D ≤ 12″'], ['l', 'D > 12″']],
  valve: [['a', 'D ≤ 2″'], ['b', '2″ < D ≤ 4″'], ['c', '4″ < D ≤ 12″'], ['d', 'D > 12″']],
  weld:  [['ws', 'OD < 3″'], ['wl', 'OD ≥ 3″']],
};
// Required number of measurement points by component + bore (Tables 3 & 4). Each
// point is the average of 3 readings. "Weld + base material" uses the OD pattern.
var FN_SAMPLING = {
  'Pipe':                 { bands:'pipe',  counts:{ s:3, m:3, l:3 } },
  'Tee':                  { bands:'pipe',  counts:{ s:1, m:4, l:5 } },
  'Flange & fitting':     { bands:'pipe',  counts:{ s:1, m:3, l:3 } },
  "O'let":                { bands:'pipe',  counts:{ s:1, m:2, l:6 } },
  'Forging':              { bands:'pipe',  counts:{ s:2, m:4, l:4 } },
  'Bar / shape':          { bands:'pipe',  counts:{ s:1, m:2, l:4 } },
  'Valve body':           { bands:'valve', counts:{ a:2, b:6, c:12, d:12 } },
  'Bonnet':               { bands:'valve', counts:{ a:1, b:1, c:3,  d:3 } },
  'Stem':                 { bands:'valve', counts:{ a:1, b:1, c:3,  d:3 } },
  'Ball / wedge / plug':  { bands:'valve', counts:{ a:1, b:2, c:6,  d:6 } },
  'Weld + base material': { bands:'weld' },
};
function fnBandsFor(componentType){ var c = FN_SAMPLING[componentType]; return c ? (FN_BANDS[c.bands] || []) : []; }
function fnSampleCount(componentType, boreKey){
  var c = FN_SAMPLING[componentType]; if(!c) return 0;
  if(c.bands === 'weld') return boreKey === 'wl' ? 6 : 3;   // BM1 + Weld(1|4) + BM2
  return (c.counts && c.counts[boreKey]) || 0;
}
// Build the measurement-point list a component + bore requires, per the tables.
function fnSamplePoints(componentType, boreKey){
  var c = FN_SAMPLING[componentType]; if(!c) return null;
  var labels = [];
  if(c.bands === 'weld'){
    labels.push('Base material 1');
    if(boreKey === 'wl'){ ['0°', '90°', '180°', '270°'].forEach(function(a){ labels.push('Weld ' + a); }); }
    else labels.push('Weld');
    labels.push('Base material 2');
  } else {
    var n = fnSampleCount(componentType, boreKey);
    for(var i = 0; i < n; i++) labels.push('Point ' + (i + 1));
  }
  return labels.map(function(l, i){ return { n:i + 1, label:l, r:['', '', ''] }; });
}

// ── default + sample ─────────────────────────────────────────────────────────
var FN_LOCATIONS = ['Cap', 'Mid-wall', 'Root'];
function _fnBlankWeld(){ return { points: FN_LOCATIONS.map(function(l, i){ return { n:i + 1, label:l, r:['', '', ''] }; }) }; }
function fnDefault(){ return { scale:'% ferrite', material:'duplex', limitMin:35, limitMax:65, welds:[ _fnBlankWeld() ] }; }

function _fnSampleWeld(comp, bore, a){ var pts = fnSamplePoints(comp, bore) || []; pts.forEach(function(p, i){ p.r = a[i] || ['', '', '']; }); return { componentType:comp, bore:bore, points:pts }; }
var FN_SAMPLE = { scale:'% ferrite', material:'duplex', limitMin:35, limitMax:65, welds:[
  _fnSampleWeld('Weld + base material', 'wl', [[52,55,53],[48,50,49],[58,56,57],[60,62,61],[55,54,56],[50,51,49]]),
  _fnSampleWeld('Pipe', 'm', [[61,63,62],[58,57,59],[54,55,53]]),
]};
var FN_SAMPLE_ITEMS = [
  { subject:'Duplex butt weld D1', drawing:'ISO-D1-001', material:'1.4462 (S32205)', weldProcess:'GTAW', dimensions:'Ø168.3 × 11.0', verdict:'Acceptable' },
  { subject:'Duplex butt weld D2', drawing:'ISO-D1-002', material:'1.4462 (S32205)', weldProcess:'GTAW + SMAW', dimensions:'Ø219.1 × 14.2', verdict:'Acceptable' },
];

// ══════════════════════════════════════════════════════════════════════════
// RENDERER — returns an HTML string (FN chart + readings table). Light palette.
// ══════════════════════════════════════════════════════════════════════════
var FN_P = { ink:'#111', mut:'#6b7280', grid:'#ddd', line:'#cbcbcb',
  blue:'#1e40af', green:'#065f46', greenFill:'rgba(6,95,70,.10)', red:'#991b1b' };

var FN_DETAIL_COLS = [
  { id:'weldNo',      label:'Weld / Item No.', w:150 },
  { id:'drawing',     label:'Drawing / ISO',   w:95  },
  { id:'material',    label:'Material',         w:100 },
  { id:'weldProcess', label:'Welding process',  w:95  },
  { id:'welders',     label:'Welder(s)',        w:85  },
  { id:'examDate',    label:'Exam date',        w:80  },
  { id:'dimensions',  label:'Thickness',        w:80  },
  { id:'verdict',     label:'Result',           w:95  },
];


function _fnItemResultChip(weldView){
  var v = fnVerdict(weldView);
  if(!v.total) return '<span style="color:#6b7280">—</span>';
  var verdict = v.passed ? 'Acceptable' : 'Not acceptable';
  var c = (typeof OV_VERDICT_COLORS !== 'undefined' && OV_VERDICT_COLORS[verdict]) ? OV_VERDICT_COLORS[verdict] : null;
  if(!c) return escapeHtml(verdict);
  return '<span style="display:inline-block;padding:1px 7px;border-radius:3px;background:' + c.bg + ';color:' + c.fg + ';font-weight:700">' + escapeHtml(verdict) + '</span>';
}
function _fnItemDetails(item, idx, P, bar, weldView, colWidths){
  item = item || {};
  function val(x){ return (x === '' || x == null) ? '<span style="color:#9aa6b5">—</span>' : escapeHtml(x); }
  var no = ('00' + (idx + 1)).slice(-3);
  var weldNo = no + (item.subject ? (' · ' + escapeHtml(item.subject)) : '');
  var examDate = (item.examDate && typeof fmtDate === 'function') ? escapeHtml(fmtDate(item.examDate)) : val(item.examDate);
  var heads = FN_DETAIL_COLS.map(function(c){ return c.label; });
  var cells = [
    { v:weldNo, extra:'font-weight:600' },
    { v:val(item.drawing) },
    { v:val(item.material) },
    { v:val(item.weldProcess) },
    { v:val(item.welders) },
    { v:examDate, extra:'font-family:\'Geist Mono\',monospace' },
    { v:val(item.dimensions), extra:'font-family:\'Geist Mono\',monospace' },
    { v:_fnItemResultChip(weldView) }
  ];
  return vxSurveyTableEl(heads, [{ cells:cells }], bar, P, colWidths);
}

// Compact FN bar chart for one weld: a value bar per location, a shaded green
// acceptance band between min and max, out-of-band bars in red.
function _fnChart(weldView, P){
  var pts = (weldView.points || []).filter(function(p){ return fnAvg(p.r) != null; });
  var lo = parseFloat(weldView.limitMin) || 0, hi = parseFloat(weldView.limitMax) || 0;
  var avgs = pts.map(function(p){ return fnAvg(p.r); });
  var dmax = avgs.length ? Math.max.apply(null, avgs) : 0;
  var YMAX = Math.max(20, Math.ceil((Math.max(dmax, hi) + 5) / 10) * 10);
  var PL = 40, PR = 754, CT = 14, CB = 150, n = pts.length || 1;
  function ys(v){ return CT + (1 - v / YMAX) * (CB - CT); }
  function bx(i){ return PL + (i + 0.5) / n * (PR - PL); }
  var bw = Math.min(46, (PR - PL) / n * 0.5);
  var s = '';
  // acceptance band
  if(hi){ var by = ys(hi), bh = (lo ? ys(lo) : CB) - by; s += '<rect x="' + PL + '" y="' + by + '" width="' + (PR - PL) + '" height="' + bh + '" fill="' + P.greenFill + '"/>'; }
  if(lo){ s += '<line x1="' + PL + '" y1="' + ys(lo) + '" x2="' + PR + '" y2="' + ys(lo) + '" stroke="' + P.green + '" stroke-width="1" stroke-dasharray="5 3"/><text x="' + (PR - 3) + '" y="' + (ys(lo) - 4) + '" text-anchor="end" font-family="\'Geist Mono\',monospace" font-size="9" fill="' + P.green + '">min ' + lo + '</text>'; }
  if(hi){ s += '<line x1="' + PL + '" y1="' + ys(hi) + '" x2="' + PR + '" y2="' + ys(hi) + '" stroke="' + P.green + '" stroke-width="1" stroke-dasharray="5 3"/><text x="' + (PR - 3) + '" y="' + (ys(hi) - 4) + '" text-anchor="end" font-family="\'Geist Mono\',monospace" font-size="9" fill="' + P.green + '">max ' + hi + '</text>'; }
  // y grid
  for(var g = 0; g <= YMAX; g += (YMAX > 100 ? 20 : 10)){ s += '<line x1="' + PL + '" y1="' + ys(g) + '" x2="' + PR + '" y2="' + ys(g) + '" stroke="' + P.grid + '"/><text x="' + (PL - 6) + '" y="' + (ys(g) + 3) + '" text-anchor="end" font-family="\'Geist Mono\',monospace" font-size="8.5" fill="' + P.mut + '">' + g + '</text>'; }
  // baseline
  s += '<line x1="' + PL + '" y1="' + CB + '" x2="' + PR + '" y2="' + CB + '" stroke="#333" stroke-width="1"/>';
  // bars
  pts.forEach(function(p, i){
    var a = fnAvg(p.r), out = _fnOut(a, lo, hi), x = bx(i), c = out ? P.red : P.blue;
    s += '<rect x="' + (x - bw / 2) + '" y="' + ys(a) + '" width="' + bw + '" height="' + (CB - ys(a)) + '" fill="' + c + '" fill-opacity="' + (out ? '.85' : '.7') + '"/>';
    s += '<text x="' + x + '" y="' + (ys(a) - 5) + '" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="9" fill="' + (out ? P.red : '#222') + '">' + a + '</text>';
    s += '<text x="' + x + '" y="' + (CB + 14) + '" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="9" fill="' + P.mut + '">' + escapeHtml(p.label) + '</text>';
  });
  s += '<text x="18" y="' + ((CT + CB) / 2) + '" transform="rotate(-90 18 ' + ((CT + CB) / 2) + ')" text-anchor="middle" font-family="\'Geist\',sans-serif" font-size="10" fill="#555">Ferrite Number</text>';
  return '<svg viewBox="0 0 794 ' + (CB + 22) + '" style="width:100%;height:auto;display:block">' + s + '</svg>';
}

// Readings table for one weld: location rows × 3 readings + Avg.
function _fnTable(weldView, P, bar){
  var lo = parseFloat(weldView.limitMin) || 0, hi = parseFloat(weldView.limitMax) || 0;
  var heads = ['Location', 'FN #1', 'FN #2', 'FN #3', 'Average'];
  var rows = (weldView.points || []).map(function(p){
    var a = fnAvg(p.r), out = _fnOut(a, lo, hi);
    var avgCell = (a == null) ? '—' : (out ? '<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:#fee2e2;color:#991b1b;font-weight:600">' + a + '</span>' : String(a));
    return { cells: [
      { v:escapeHtml(p.label || ''), extra:'font-weight:600' }
    ].concat(p.r.map(function(x){ return { v:(x === '' || x == null ? '—' : escapeHtml(x)), extra:'font-family:\'Geist Mono\',monospace' }; }))
      .concat([{ v:avgCell, extra:'font-weight:700;font-family:\'Geist Mono\',monospace' }]) };
  });
  return vxSurveyTableEl(heads, rows, bar, P);
}

function _fnComponentLine(weldView, P){
  if(!weldView.componentType) return '';
  var bands = fnBandsFor(weldView.componentType);
  var bb = bands.filter(function(b){ return b[0] === weldView.bore; })[0];
  var boreLbl = bb ? bb[1] : '';
  var npts = (weldView.points || []).length;
  return '<div style="padding:3px 8px 0;font:400 8px \'Geist Mono\',monospace;color:' + P.mut + '">Sampling: ' + escapeHtml(weldView.componentType) + (boreLbl ? (' · ' + escapeHtml(boreLbl)) : '') + ' · ' + npts + ' point' + (npts === 1 ? '' : 's') + ' (avg of 3 readings each)</div>';
}
function _fnWeldUnit(weldView, item, idx, P, bar, detailWidths){
  var sep = idx > 0 ? 'border-top:2px solid ' + P.grid + ';margin-top:8px;padding-top:2px;' : '';
  return '<div style="' + sep + '">'
    + _fnItemDetails(item, idx, P, bar, weldView, detailWidths)
    + _fnComponentLine(weldView, P)
    + '<div style="padding:6px 8px 0">' + _fnChart(weldView, P) + '</div>'
    + _fnTable(weldView, P, bar)
    + '</div>';
}

// opts: { print, sample, items, barColor, detailWidths }
function fnRenderSurvey(survey, opts){
  opts = opts || {};
  var hasData = function(s){ return s && (s.welds || s.points); };
  if(!hasData(survey) && opts.sample) survey = FN_SAMPLE;
  if(!hasData(survey)) return '<div style="padding:18px;color:#9aa6b5;font-size:11px;text-align:center">No ferrite survey recorded.</div>';
  survey = fnNormalize(survey);
  var items = opts.items || (opts.sample ? FN_SAMPLE_ITEMS : []);
  var P = FN_P, scale = survey.scale || 'FN';
  var lo = parseFloat(survey.limitMin) || 0, hi = parseFloat(survey.limitMax) || 0;
  var bar = opts.barColor || ((typeof cvTplCfg !== 'undefined' && cvTplCfg.sectionColor) ? cvTplCfg.sectionColor : '#404040');
  var detailWidths = (Array.isArray(opts.detailWidths) && opts.detailWidths.length === FN_DETAIL_COLS.length) ? opts.detailWidths : null;
  var welds = survey.welds || [];

  var titleBar = '<div style="background:' + bar + ';color:#fff;font:700 11px \'Geist\',system-ui,sans-serif;letter-spacing:.06em;text-align:center;padding:4px 8px">FERRITE SURVEY</div>';
  var v = fnVerdict(survey), rng = fnRange(survey);
  var band = (lo || hi) ? ((lo || '0') + '–' + (hi || '∞') + ' ' + escapeHtml(scale)) : 'no band set';
  var verdict = (lo || hi) ? ((v.passed ? '<b style="color:' + P.green + '">PASS</b>' : '<b style="color:' + P.red + '">FAIL</b>')) : '';
  var rangeTxt = (rng.lo != null) ? (rng.lo + '–' + rng.hi + ' ' + escapeHtml(scale)) : '—';
  var wc = welds.length;
  var matTxt = fnMaterialLabel(survey.material);
  var caption = '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 8px;font:400 8px \'Geist Mono\',monospace;color:' + P.mut + ';border-bottom:0.5px solid ' + P.grid + '">'
    + '<span>' + (matTxt ? (escapeHtml(matTxt) + ' · ') : '') + wc + ' weld' + (wc === 1 ? '' : 's') + ' · acceptance ' + band + '</span>'
    + '<span>Range ' + rangeTxt + (verdict ? (' · ' + verdict) : '') + '</span></div>';

  var html = titleBar + caption;
  welds.forEach(function(w, idx){ html += _fnWeldUnit(_fnWeldView(survey, w), items[idx] || {}, idx, P, bar, detailWidths); });
  return '<div style="overflow:hidden;font-family:\'Geist\',system-ui,sans-serif">' + html + '</div>';
}

// ══════════════════════════════════════════════════════════════════════════
// DATA ENTRY (report form). _fnSurvey is the source of truth; the grid edits it.
// ══════════════════════════════════════════════════════════════════════════
var _fnSurvey = null;

function _fnItems(){ return (typeof _ovItems !== 'undefined' && Array.isArray(_ovItems)) ? _ovItems : []; }
function _fnItemCount(){ var n = _fnItems().length; return n > 0 ? n : 1; }
function _fnWeldLabel(wi){ var it = _fnItems()[wi]; return (it && it.subject) ? it.subject : ''; }

function fnSyncWelds(){
  if(!_fnSurvey) return;
  if(!Array.isArray(_fnSurvey.welds)) _fnSurvey = fnNormalize(_fnSurvey);
  var n = _fnItemCount();
  while(_fnSurvey.welds.length < n) _fnSurvey.welds.push(_fnBlankWeld());
  if(_fnSurvey.welds.length > n) _fnSurvey.welds = _fnSurvey.welds.slice(0, n);
}
function fnSyncToItems(){ if(!_fnSurvey) return; fnReadGrid(); fnSyncWelds(); fnRebuildGrid(); }

function fnRenderEntrySection(existing){
  _fnSurvey = (existing && (existing.welds || existing.points)) ? fnNormalize(JSON.parse(JSON.stringify(existing))) : fnDefault();
  fnSyncWelds();
  return '<div class="sc" style="margin:0 14px 14px"><div class="sc-head"><span class="sc-title">Ferrite survey</span></div><div class="sc-body" style="padding:14px 16px">'
    + '<div class="fg form-row" style="margin-bottom:4px;display:flex;gap:12px;flex-wrap:wrap">'
      + '<div class="fld" style="width:210px"><label>Material / acceptance</label><select id="fn-material" data-on-change="fnSetMaterial">' + fnMaterialOptions(_fnSurvey.material) + '</select></div>'
      + '<div class="fld" style="width:110px"><label>Unit</label><input id="fn-scale" value="' + escapeHtml(_fnSurvey.scale || '% ferrite') + '" data-on-input="fnEntryChanged"/></div>'
      + '<div class="fld" style="width:130px"><label>Acceptance min</label><input id="fn-min" type="number" step="any" value="' + escapeHtml(_fnSurvey.limitMin != null ? _fnSurvey.limitMin : '') + '" data-on-input="fnEntryChanged"/></div>'
      + '<div class="fld" style="width:130px"><label>Acceptance max</label><input id="fn-max" type="number" step="any" value="' + escapeHtml(_fnSurvey.limitMax != null ? _fnSurvey.limitMax : '') + '" data-on-input="fnEntryChanged"/></div>'
    + '</div>'
    + '<div style="font-size:11px;color:var(--t3);margin:2px 0 12px">Pick a <b>material</b> to set the acceptance band (austenitic 3–8%, duplex 35–65%), and a <b>component type + bore</b> per weld to auto-set the required number of measurement points. Weld identification comes from the <b>Examination details</b> table above — one line per weld.</div>'
    + '<div id="fn-grid">' + fnGridHtml() + '</div>'
    + '<div style="font-size:11px;color:var(--t3);margin:10px 0 6px;text-transform:uppercase;letter-spacing:.05em">Live preview</div>'
    + '<div id="fn-preview" style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:14px 16px">' + fnRenderSurvey(_fnSurvey, { print:true, items:_fnItems() }) + '</div>'
    + '</div></div>';
}

function _fnNum(val, wi, pt, field, ph, w){
  return '<input type="number" step="any" data-fn-weld="' + wi + '" data-fn-pt="' + pt + '" data-fn-field="' + field + '" data-on-input="fnEntryChanged" value="' + (val === '' || val == null ? '' : escapeHtml(val)) + '" placeholder="' + (ph || '') + '" style="width:' + (w || 62) + 'px"/>';
}
function _fnTxt(val, wi, pt){
  return '<input type="text" data-fn-weld="' + wi + '" data-fn-pt="' + pt + '" data-fn-field="label" data-on-input="fnEntryChanged" value="' + escapeHtml(val == null ? '' : val) + '" placeholder="Location" style="width:120px"/>';
}
function fnMaterialOptions(sel){
  return '<option value="">— Select material —</option>' + Object.keys(FN_MATERIAL_PRESETS).map(function(k){
    var p = FN_MATERIAL_PRESETS[k];
    var lab = p.label + (p.min != null ? ' (' + p.min + '–' + p.max + '%)' : '');
    return '<option value="' + k + '"' + (sel === k ? ' selected' : '') + '>' + escapeHtml(lab) + '</option>';
  }).join('');
}
// Per-weld component-type + nominal-bore selectors that drive the required
// number of measurement points (Tables 3 & 4 + the weld OD pattern).
function fnComponentBoreRow(weld, wi){
  var ctype = weld.componentType || '';
  var compOpts = '<option value="">— Component (optional) —</option>' + Object.keys(FN_SAMPLING).map(function(k){
    return '<option value="' + escapeHtml(k) + '"' + (ctype === k ? ' selected' : '') + '>' + escapeHtml(k) + '</option>';
  }).join('');
  var bands = fnBandsFor(ctype);
  var boreOpts = bands.length ? bands.map(function(b){ return '<option value="' + b[0] + '"' + (weld.bore === b[0] ? ' selected' : '') + '>' + escapeHtml(b[1]) + '</option>'; }).join('') : '<option value="">—</option>';
  var n = fnSampleCount(ctype, weld.bore);
  var hint = !ctype ? 'optional — sets the required number of points' : (n ? n + ' point' + (n === 1 ? '' : 's') + ' · avg of 3 readings each' : 'select a size');
  var dis = bands.length ? '' : ' disabled';
  return '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:7px">'
    + '<div class="fld" style="width:190px"><label style="font-size:11px">Component type</label><select data-fn-weld="' + wi + '" data-fn-field="componentType" data-on-change="fnSetSampling" data-pass-el="1">' + compOpts + '</select></div>'
    + '<div class="fld" style="width:160px"><label style="font-size:11px">Nominal bore / OD</label><select data-fn-weld="' + wi + '" data-fn-field="bore" data-on-change="fnSetSampling" data-pass-el="1"' + dis + '>' + boreOpts + '</select></div>'
    + '<div style="font-size:11px;color:var(--t3);padding-bottom:7px">' + escapeHtml(hint) + '</div>'
    + '</div>';
}
function fnGridHtml(){
  var s = _fnSurvey;
  var multi = (s.welds || []).length > 1;
  var grids = (s.welds || []).map(function(weld, wi){
    var lbl = _fnWeldLabel(wi);
    var del = multi ? '<button class="btn btn-sm btn-danger" data-action="fnRemoveWeld" data-args="' + wi + '" title="Remove this weld" style="padding:2px 9px;font-size:11px;margin-left:10px">− Remove weld</button>' : '';
    var rows = (weld.points || []).map(function(p, pi){
      var a = fnAvg(p.r);
      return '<tr><td style="padding:4px 6px">' + _fnTxt(p.label, wi, pi) + '</td>'
        + '<td style="padding:4px 6px">' + _fnNum(p.r[0], wi, pi, 'r0', '#1') + '</td>'
        + '<td style="padding:4px 6px">' + _fnNum(p.r[1], wi, pi, 'r1', '#2') + '</td>'
        + '<td style="padding:4px 6px">' + _fnNum(p.r[2], wi, pi, 'r2', '#3') + '</td>'
        + '<td style="padding:5px 8px;font-family:var(--mono);color:var(--cyan)">' + (a != null ? a : '—') + '</td>'
        + '<td style="padding:4px 6px"><button class="btn btn-sm btn-danger" data-action="fnRemovePoint" data-args="' + wi + ',' + pi + '" title="Remove location" style="padding:2px 7px">×</button></td></tr>';
    }).join('');
    return '<div style="margin-bottom:16px;border-left:2px solid var(--border);padding-left:10px"><div style="display:flex;align-items:center;font-size:12px;font-weight:600;color:var(--t1);margin-bottom:6px">Weld ' + (wi + 1) + (lbl ? ' — ' + escapeHtml(lbl) : '') + del + '</div>'
      + fnComponentBoreRow(weld, wi)
      + '<table class="tbl" style="width:auto"><thead><tr><th>Location</th><th>#1</th><th>#2</th><th>#3</th><th>Avg</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '<button class="btn btn-sm" data-action="fnAddPoint" data-args="' + wi + '" style="margin-top:6px">+ location</button></div>';
  }).join('');
  return grids
    + '<button class="btn btn-sm" data-action="fnAddWeld" style="margin-top:2px">+ Add weld</button>'
    + '<div style="font-size:11px;color:var(--t3);margin-top:6px">Each weld is one line in the Examination details table above — adding/removing here keeps them in sync.</div>';
}

function fnReadGrid(){
  if(!_fnSurvey) return;
  var sc = el('fn-scale'); if(sc) _fnSurvey.scale = sc.value || '% ferrite';
  var mt = el('fn-material'); if(mt) _fnSurvey.material = mt.value;
  var mn = el('fn-min'); if(mn) _fnSurvey.limitMin = mn.value === '' ? '' : parseFloat(mn.value);
  var mx = el('fn-max'); if(mx) _fnSurvey.limitMax = mx.value === '' ? '' : parseFloat(mx.value);
  var grid = el('fn-grid'); if(!grid) return;
  (_fnSurvey.welds || []).forEach(function(weld, wi){
    var cSel = grid.querySelector('[data-fn-weld="' + wi + '"][data-fn-field="componentType"]'); if(cSel) weld.componentType = cSel.value;
    var bSel = grid.querySelector('[data-fn-weld="' + wi + '"][data-fn-field="bore"]'); if(bSel) weld.bore = bSel.value;
    (weld.points || []).forEach(function(p, pi){
      var lb = grid.querySelector('[data-fn-weld="' + wi + '"][data-fn-pt="' + pi + '"][data-fn-field="label"]'); if(lb) p.label = lb.value;
      ['r0', 'r1', 'r2'].forEach(function(f, k){ var inp = grid.querySelector('[data-fn-weld="' + wi + '"][data-fn-pt="' + pi + '"][data-fn-field="' + f + '"]'); if(inp) p.r[k] = inp.value; });
    });
  });
}
// Material preset → acceptance band + unit.
function fnSetMaterial(){
  fnReadGrid();
  var m = el('fn-material') ? el('fn-material').value : '';
  _fnSurvey.material = m;
  var p = FN_MATERIAL_PRESETS[m];
  if(p){
    if(p.min != null) _fnSurvey.limitMin = p.min;
    if(p.max != null) _fnSurvey.limitMax = p.max;
    if(p.unit) _fnSurvey.scale = p.unit;
  }
  var sc = el('fn-scale'); if(sc) sc.value = _fnSurvey.scale || '% ferrite';
  var mn = el('fn-min'); if(mn) mn.value = _fnSurvey.limitMin != null ? _fnSurvey.limitMin : '';
  var mx = el('fn-max'); if(mx) mx.value = _fnSurvey.limitMax != null ? _fnSurvey.limitMax : '';
  fnRebuildGrid();
}
// Component type / bore changed → regenerate that weld's measurement points.
function fnSetSampling(elm){
  fnReadGrid();
  var wi = parseInt((elm && elm.getAttribute) ? elm.getAttribute('data-fn-weld') : elm, 10);
  var weld = _fnSurvey.welds && _fnSurvey.welds[wi]; if(!weld) return;
  var grid = el('fn-grid');
  var cSel = grid && grid.querySelector('[data-fn-weld="' + wi + '"][data-fn-field="componentType"]');
  var bSel = grid && grid.querySelector('[data-fn-weld="' + wi + '"][data-fn-field="bore"]');
  var ctype = cSel ? cSel.value : '';
  var bands = fnBandsFor(ctype);
  var bkey = bSel ? bSel.value : '';
  if(bands.length && !bands.some(function(b){ return b[0] === bkey; })) bkey = bands[0][0];   // first valid band for a newly-picked component
  weld.componentType = ctype;
  weld.bore = ctype ? bkey : '';
  if(ctype && bkey){ var pts = fnSamplePoints(ctype, bkey); if(pts && pts.length) weld.points = pts; }
  fnRebuildGrid();
}
function fnRenderPreview(){ var pv = el('fn-preview'); if(pv) pv.innerHTML = fnRenderSurvey(_fnSurvey, { print:true, items:_fnItems() }); }
function fnRebuildGrid(){ var g = el('fn-grid'); if(g) g.innerHTML = fnGridHtml(); fnRenderPreview(); }
function fnEntryChanged(){ fnReadGrid(); fnAutoVerdicts(); fnRenderPreview(); }

// Each weld's pass/fail (in/out of band) is written back to the matching
// Examination-details item verdict so the report Result column tracks it.
function fnAutoVerdicts(){
  if(!_fnSurvey || typeof _ovItems === 'undefined' || !Array.isArray(_ovItems)) return;
  (_fnSurvey.welds || []).forEach(function(w, i){
    var v = fnVerdict(_fnWeldView(_fnSurvey, w));
    var verdict = !v.total ? '' : (v.passed ? 'Acceptable' : 'Not acceptable');
    if(_ovItems[i]) _ovItems[i].verdict = verdict;
    var sel = el('it-' + i + '-verdict');
    if(sel && sel.value !== verdict){
      sel.value = verdict;
      if(typeof ovVerdictStyle === 'function'){ sel.style.cssText = 'width:100%;height:32px;box-sizing:border-box;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);color:var(--t1);font-family:var(--font);' + ovVerdictStyle(verdict); }
    }
  });
}
function fnAddWeld(){
  fnReadGrid();
  if(typeof ovHtAddItem === 'function') ovHtAddItem();
  else if(_fnSurvey && _fnSurvey.welds) _fnSurvey.welds.push(_fnBlankWeld());
  fnSyncWelds();
  fnRebuildGrid();
}
function fnRemoveWeld(wi){
  fnReadGrid();
  if(!_fnSurvey || !_fnSurvey.welds || _fnSurvey.welds.length <= 1) return;
  _fnSurvey.welds.splice(wi, 1);
  if(typeof ovHtRemoveItem === 'function') ovHtRemoveItem(wi);
  fnSyncWelds();
  fnRebuildGrid();
}
function fnAddPoint(wi){ fnReadGrid(); var w = _fnSurvey.welds && _fnSurvey.welds[wi]; if(w){ if(!w.points) w.points = []; w.points.push({ n:w.points.length + 1, label:'', r:['', '', ''] }); fnRebuildGrid(); } }
function fnRemovePoint(wi, pi){ fnReadGrid(); var w = _fnSurvey.welds && _fnSurvey.welds[wi]; if(w && w.points){ w.points.splice(pi, 1); fnRebuildGrid(); } }

// called by ovSaveReport for FN reports
function fnCollect(){ fnReadGrid(); fnSyncWelds(); fnAutoVerdicts(); return _fnSurvey ? JSON.parse(JSON.stringify(_fnSurvey)) : null; }

// ── default template seeding ─────────────────────────────────────────────────
// Ensure the FN report template is a COMPLETE report — the standard header/
// fields/result layout (same as every other method) plus a dedicated ferrite-
// survey page — so FN reports aren't just a bare survey with no report chrome.
function _fnNid(){ return (typeof _cvBlockId === 'function') ? _cvBlockId() : ('fn-' + Math.random().toString(36).slice(2, 9)); }
function _fnReplaceSubjectWithItems(blocks){
  if(!Array.isArray(blocks) || !blocks.length) return blocks;
  if(blocks.some(function(b){ return b && b.key === 'items-table'; })) return blocks;
  var subj = {'subject':1,'drawing-no':1,'subject-no':1,'welders':1,'material':1,'weld-prep':1,'heat-treat':1,'thickness':1,'surf-cond':1,'temperature':1,'weld-pos':1};
  var isSubjHdr = function(b){ return b && b.key === 'section-header' && /subject/i.test(b.text || ''); };
  var rm = blocks.filter(function(b){ return b && (subj[b.key] || isSubjHdr(b)); });
  if(!rm.length) return blocks;
  var top = Math.min.apply(null, rm.map(function(b){ return b.y || 0; }));
  var bot = Math.max.apply(null, rm.map(function(b){ return (b.y || 0) + (b.h || 0); }));
  var kept = blocks.filter(function(b){ return !(b && (subj[b.key] || isSubjHdr(b))); });
  var itH = 150, delta = (top + itH) - bot;
  kept.forEach(function(b){ if((b.y || 0) >= bot - 0.5) b.y = (b.y || 0) + delta; });
  kept.push({ id:_fnNid(), key:'items-table', isLayout:true, x:20, y:top, w:754, h:itH, showBorder:false, fontSize:'8.5px' });
  kept.sort(function(a, b){ return (a.y || 0) - (b.y || 0); });
  return kept;
}
function _fnPage1Blocks(){ return _fnReplaceSubjectWithItems((typeof cvDefaultLayoutBlocks === 'function') ? cvDefaultLayoutBlocks() : []); }
function _fnSurveyPage(){
  return { label:'Ferrite survey', blocks:[
    { id:_fnNid(), key:'fn-survey', isLayout:true, x:20, y:20, w:754, h:900, showBorder:true, borderColor:'#dddddd' },
  ] };
}
function fnSeedTemplateBlock(){
  try {
    var PFX = (typeof CV_METHOD_TPL_PREFIX !== 'undefined') ? CV_METHOD_TPL_PREFIX : 'vx-method-tpl-';
    var KEY = PFX + 'FN';
    var FLAG = 'vx-fn-tpl-seeded-v1';
    if(localStorage.getItem(FLAG)) return;
    var tpl = ls(KEY, null);
    var pages = (tpl && Array.isArray(tpl.pages)) ? tpl.pages : [];
    var allBlocks = pages.reduce(function(a, p){ return a.concat(p.blocks || []); }, []);
    var hasSurvey = allBlocks.some(function(b){ return b && b.key === 'fn-survey'; });
    var nonSurvey = allBlocks.filter(function(b){ return b && b.key !== 'fn-survey'; }).length;
    if(hasSurvey){ localStorage.setItem(FLAG, '1'); return; }
    if(nonSurvey === 0){
      var page1 = _fnPage1Blocks();
      var newPages = page1.length ? [ { label:'Report', blocks:page1 }, _fnSurveyPage() ] : [ _fnSurveyPage() ];
      lss(KEY, { pages:newPages, nextId: (allBlocks.length + (page1 ? page1.length : 0) + 4), savedAt: new Date().toISOString() });
    } else {
      tpl.pages.push(_fnSurveyPage());
      tpl.nextId = (tpl.nextId || allBlocks.length) + 2;
      lss(KEY, tpl);
    }
    localStorage.setItem(FLAG, '1');
  } catch(e){ console.warn('fnSeedTemplateBlock failed', e); }
}
window.addEventListener('DOMContentLoaded', function(){ try { fnSeedTemplateBlock(); } catch(e){} });

// ── Dispatch registration — see vxActions in js/constants.js.
// Object shorthand keeps each data-action name tied to its function, so a
// rename that misses one is a no-undef error rather than a dead control.
vxActions({
  fnAddPoint, fnAddWeld, fnEntryChanged, fnRemovePoint, fnRemoveWeld,
  fnSetMaterial, fnSetSampling,
});
