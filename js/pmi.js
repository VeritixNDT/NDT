// ══════════════════════════════════════════════════════════════════════════
// POSITIVE MATERIAL IDENTIFICATION (PMI) — shared data model, visual renderer
// and report-form data-entry grid. Mirrors js/hardness.js: ONE renderer
// (pmiRenderSurvey) feeds both the on-screen form preview AND the sealed PDF
// (via the editor's 'pmi-survey'/'pmi-method' blocks). Print/light palette.
//
// Domain: verify a component's measured CHEMICAL COMPOSITION against the
// element bands of a specified alloy grade (API 578 material verification).
// Auto-acceptance = every controlled element of the grade falls inside its
// min/max band ⇒ grade MATCH (Acceptable); any element out of band ⇒ No-match.
//
// Two technique modes (the analog of HT's site-piping / weld-traverse):
//   xrf   X-ray fluorescence — portable alloy ID. Cannot measure carbon, so C
//         is locked + excluded from the verdict (316 vs 316L not separable).
//   oes   Optical emission (arc-spark) — measures C too, so verifies L-grades.
// Per component the grid/chart show only the elements the specified grade
// defines a band for. Acceptance limits follow the ASTM/ASME material specs.
// ══════════════════════════════════════════════════════════════════════════

// ── element model ────────────────────────────────────────────────────────────
var PMI_ELEMENT_ORDER = ['C','Si','Mn','P','S','Cr','Ni','Mo','Cu','Ti','Nb','V','W','Co','N','Fe'];
var PMI_ELEMENT_NAMES = { C:'Carbon', Si:'Silicon', Mn:'Manganese', P:'Phosphorus', S:'Sulphur', Cr:'Chromium', Ni:'Nickel', Mo:'Molybdenum', Cu:'Copper', Ti:'Titanium', Nb:'Niobium', V:'Vanadium', W:'Tungsten', Co:'Cobalt', N:'Nitrogen', Fe:'Iron' };

// Alloy grade library — element acceptance bands [min, max] in wt%. null = open
// (e.g. Ni:[58,null] = ≥ 58 %; Fe:[0,5] = ≤ 5 %). Bands per ASTM/ASME material
// specs; the listed elements are the composition-controlled ones used for the
// grade-match decision (balance elements are not band-checked). Editable later.
var PMI_GRADES = {
  // ── Carbon & low-alloy steel — ASTM A106 / A333 / A516 / A335 P-grades ──
  'CS A106-B':  { name:'Carbon steel — A106 Gr B', uns:'K03006', family:'Carbon / low-alloy', el:{ C:[0,0.30], Mn:[0.29,1.06], Si:[0.10,null], Cr:[0,0.40], Mo:[0,0.15], Ni:[0,0.40], Cu:[0,0.40] } },
  'A333-6':     { name:'Low-temp CS — A333 Gr 6',  uns:'K03006', family:'Carbon / low-alloy', el:{ C:[0,0.30], Mn:[0.29,1.06], Si:[0.10,null], Cr:[0,0.40], Mo:[0,0.12], Ni:[0,0.40] } },
  'A516-70':    { name:'PV plate — A516 Gr 70',    uns:'K02700', family:'Carbon / low-alloy', el:{ C:[0,0.28], Mn:[0.85,1.20], Si:[0.15,0.40] } },
  'P1':         { name:'C-½Mo — A335 P1',          uns:'K11522', family:'Carbon / low-alloy', el:{ C:[0,0.28], Mn:[0.30,0.90], Si:[0.10,0.50], Mo:[0.44,0.65] } },
  'P11':        { name:'1¼Cr-½Mo — A335 P11',      uns:'K11597', family:'Carbon / low-alloy', el:{ C:[0.05,0.15], Si:[0.50,1.00], Mn:[0.30,0.60], Cr:[1.00,1.50], Mo:[0.44,0.65] } },
  'P12':        { name:'1Cr-½Mo — A335 P12',       uns:'K11562', family:'Carbon / low-alloy', el:{ C:[0.05,0.15], Mn:[0.30,0.61], Si:[0,0.50], Cr:[0.80,1.25], Mo:[0.44,0.65] } },
  'P22':        { name:'2¼Cr-1Mo — A335 P22',      uns:'K21590', family:'Carbon / low-alloy', el:{ C:[0.05,0.15], Mn:[0.30,0.60], Si:[0,0.50], Cr:[1.90,2.60], Mo:[0.87,1.13] } },
  'P23':        { name:'2¼Cr-W-V — A335 P23',      uns:'K40712', family:'Carbon / low-alloy', el:{ C:[0.04,0.10], Mn:[0.10,0.60], Cr:[1.90,2.60], Mo:[0.05,0.30], W:[1.45,1.75], V:[0.20,0.30], Nb:[0.02,0.08] } },
  'P5':         { name:'5Cr-½Mo — A335 P5',        uns:'K41545', family:'Carbon / low-alloy', el:{ C:[0,0.15], Mn:[0.30,0.60], Si:[0,0.50], Cr:[4.00,6.00], Mo:[0.45,0.65] } },
  'P9':         { name:'9Cr-1Mo — A335 P9',        uns:'K90941', family:'Carbon / low-alloy', el:{ C:[0,0.15], Mn:[0.30,0.60], Si:[0.25,1.00], Cr:[8.00,10.00], Mo:[0.90,1.10] } },
  'P91':        { name:'9Cr-1Mo-V — A335 P91',     uns:'K90901', family:'Carbon / low-alloy', el:{ C:[0.08,0.12], Mn:[0.30,0.60], Cr:[8.00,9.50], Mo:[0.85,1.05], V:[0.18,0.25], Nb:[0.06,0.10], Ni:[0,0.40] } },
  // ── Austenitic stainless — ASTM A312 / A240 ──
  '304':        { name:'304 stainless',            uns:'S30400', family:'Austenitic stainless', el:{ C:[0,0.08],  Cr:[18.0,20.0], Ni:[8.0,10.5], Mn:[0,2.00] } },
  '304L':       { name:'304L stainless',           uns:'S30403', family:'Austenitic stainless', el:{ C:[0,0.030], Cr:[18.0,20.0], Ni:[8.0,12.0], Mn:[0,2.00] } },
  '309S':       { name:'309S stainless',           uns:'S30908', family:'Austenitic stainless', el:{ C:[0,0.08],  Cr:[22.0,24.0], Ni:[12.0,15.0], Mn:[0,2.00] } },
  '310S':       { name:'310S stainless',           uns:'S31008', family:'Austenitic stainless', el:{ C:[0,0.08],  Cr:[24.0,26.0], Ni:[19.0,22.0], Mn:[0,2.00] } },
  '316':        { name:'316 stainless',            uns:'S31600', family:'Austenitic stainless', el:{ C:[0,0.08],  Cr:[16.0,18.0], Ni:[10.0,14.0], Mo:[2.00,3.00] } },
  '316L':       { name:'316L stainless',           uns:'S31603', family:'Austenitic stainless', el:{ C:[0,0.030], Cr:[16.0,18.0], Ni:[10.0,14.0], Mo:[2.00,3.00] } },
  '316Ti':      { name:'316Ti stainless',          uns:'S31635', family:'Austenitic stainless', el:{ C:[0,0.08],  Cr:[16.0,18.0], Ni:[10.0,14.0], Mo:[2.00,3.00], Ti:[0.30,0.70] } },
  '317L':       { name:'317L stainless',           uns:'S31703', family:'Austenitic stainless', el:{ C:[0,0.035], Cr:[18.0,20.0], Ni:[11.0,15.0], Mo:[3.00,4.00] } },
  '321':        { name:'321 stainless',            uns:'S32100', family:'Austenitic stainless', el:{ C:[0,0.08],  Cr:[17.0,19.0], Ni:[9.0,12.0], Ti:[0.20,0.70] } },
  '347':        { name:'347 stainless',            uns:'S34700', family:'Austenitic stainless', el:{ C:[0,0.08],  Cr:[17.0,19.0], Ni:[9.0,13.0], Nb:[0.40,1.00] } },
  // ── Super-austenitic (high-alloy) — ASTM A312 / B625 ──
  '904L':       { name:'904L (N08904)',            uns:'N08904', family:'Super-austenitic', el:{ C:[0,0.020], Cr:[19.0,23.0], Ni:[23.0,28.0], Mo:[4.00,5.00], Cu:[1.00,2.00] } },
  '254 SMO':    { name:'254 SMO / 6Mo (S31254)',   uns:'S31254', family:'Super-austenitic', el:{ C:[0,0.020], Cr:[19.5,20.5], Ni:[17.5,18.5], Mo:[6.00,6.50], Cu:[0.50,1.00], N:[0.18,0.22] } },
  'Alloy 020':  { name:'Alloy 20 / 20Cb-3',        uns:'N08020', family:'Super-austenitic', el:{ C:[0,0.07],  Cr:[19.0,21.0], Ni:[32.0,38.0], Mo:[2.00,3.00], Cu:[3.00,4.00], Nb:[0,1.00] } },
  // ── Duplex / super-duplex stainless — ASTM A790 / A240 ──
  '2304':       { name:'Lean duplex 2304',         uns:'S32304', family:'Duplex stainless', el:{ C:[0,0.030], Cr:[21.5,24.5], Ni:[3.00,5.50], Mo:[0.05,0.60], N:[0.05,0.20] } },
  '2205':       { name:'Duplex 2205',              uns:'S32205', family:'Duplex stainless', el:{ C:[0,0.030], Cr:[22.0,23.0], Ni:[4.50,6.50], Mo:[3.00,3.50], N:[0.14,0.20] } },
  '2507':       { name:'Super duplex 2507',        uns:'S32750', family:'Duplex stainless', el:{ C:[0,0.030], Cr:[24.0,26.0], Ni:[6.0,8.0], Mo:[3.00,5.00], N:[0.24,0.32] } },
  'Zeron 100':  { name:'Super duplex Zeron 100',   uns:'S32760', family:'Duplex stainless', el:{ C:[0,0.030], Cr:[24.0,26.0], Ni:[6.00,8.00], Mo:[3.00,4.00], Cu:[0.50,1.00], W:[0.50,1.00], N:[0.20,0.30] } },
  // ── Nickel & nickel-iron alloys — ASTM B sheet (UNS) ──
  'Alloy 600':  { name:'Alloy 600 (Inconel 600)',  uns:'N06600', family:'Nickel alloy', el:{ Ni:[72.0,null], Cr:[14.0,17.0], Fe:[6.00,10.00] } },
  'Alloy 625':  { name:'Alloy 625 (Inconel 625)',  uns:'N06625', family:'Nickel alloy', el:{ Ni:[58.0,null], Cr:[20.0,23.0], Mo:[8.0,10.0], Nb:[3.15,4.15], Fe:[0,5.0] } },
  'Alloy 718':  { name:'Alloy 718 (Inconel 718)',  uns:'N07718', family:'Nickel alloy', el:{ Ni:[50.0,55.0], Cr:[17.0,21.0], Mo:[2.80,3.30], Nb:[4.75,5.50], Ti:[0.65,1.15], Co:[0,1.00] } },
  'Alloy 800H': { name:'Alloy 800H (Incoloy 800H)',uns:'N08810', family:'Nickel alloy', el:{ Ni:[30.0,35.0], Cr:[19.0,23.0], Fe:[39.5,null], C:[0.05,0.10], Ti:[0.15,0.60] } },
  'Alloy 825':  { name:'Alloy 825 (Incoloy 825)',  uns:'N08825', family:'Nickel alloy', el:{ Ni:[38.0,46.0], Cr:[19.5,23.5], Mo:[2.50,3.50], Cu:[1.50,3.00], Ti:[0.60,1.20], Fe:[22.0,null] } },
  'Alloy 400':  { name:'Alloy 400 (Monel 400)',    uns:'N04400', family:'Nickel alloy', el:{ Ni:[63.0,null], Cu:[28.0,34.0], Fe:[0,2.50], Mn:[0,2.00] } },
  'Alloy C276': { name:'Alloy C276 (Hastelloy)',   uns:'N10276', family:'Nickel alloy', el:{ Ni:[50.0,null], Cr:[14.5,16.5], Mo:[15.0,17.0], W:[3.00,4.50], Fe:[4.00,7.00], Co:[0,2.50] } },
};
// Dropdown order (preserves the family grouping above).
var PMI_GRADE_ORDER = ['CS A106-B','A333-6','A516-70','P1','P11','P12','P22','P23','P5','P9','P91','304','304L','309S','310S','316','316L','316Ti','317L','321','347','904L','254 SMO','Alloy 020','2304','2205','2507','Zeron 100','Alloy 600','Alloy 625','Alloy 718','Alloy 800H','Alloy 825','Alloy 400','Alloy C276'];

// Ordered list of band-controlled element symbols for a grade (drive the
// grade-match verdict + the composition band chart).
function pmiElementsOf(grade){ var g = PMI_GRADES[grade]; if(!g) return []; return PMI_ELEMENT_ORDER.filter(function(e){ return g.el[e]; }); }
// Elements always recorded on the report even when the specified grade doesn't
// spec-control them — a PMI scan reports the full measured spectrum. Where a
// grade has no band for one of these it is informational only (no in/out, no
// effect on the verdict).
var PMI_REPORT_EXTRA = ['Mn','Cu','Fe'];
// Ordered union of the grade's banded elements + the always-reported extras.
function pmiReportElements(grade){
  var set = {}; pmiElementsOf(grade).forEach(function(e){ set[e] = 1; });
  PMI_REPORT_EXTRA.forEach(function(e){ set[e] = 1; });
  return PMI_ELEMENT_ORDER.filter(function(e){ return set[e]; });
}
// A user-entered custom limit [lo, hi] (strings) → a usable band, or null when
// both bounds are blank. Either bound may be left open.
function _pmiLimitBand(lim){
  if(!lim) return null;
  var lo = (lim[0] === '' || lim[0] == null || isNaN(parseFloat(lim[0]))) ? null : parseFloat(lim[0]);
  var hi = (lim[1] === '' || lim[1] == null || isNaN(parseFloat(lim[1]))) ? null : parseFloat(lim[1]);
  return (lo == null && hi == null) ? null : [lo, hi];
}
// Resolve the acceptance band for one element on a point: the grade's spec band
// if it controls that element, else a user-entered custom limit (for the
// otherwise report-only extras), else none. { band, spec, custom }.
function pmiBandFor(point, el){
  var g = point && point.grade, gb = (PMI_GRADES[g] && PMI_GRADES[g].el[el]) || null;
  if(gb) return { band:gb, spec:true, custom:false };
  var cb = _pmiLimitBand((point && point.limits || {})[el]);
  if(cb) return { band:cb, spec:false, custom:true };
  return { band:null, spec:false, custom:false };
}
// Elements that gate the verdict: grade-banded + any with a custom limit set.
function pmiCheckElements(point){
  var set = {}; pmiElementsOf(point && point.grade).forEach(function(e){ set[e] = 1; });
  var lims = (point && point.limits) || {};
  Object.keys(lims).forEach(function(e){ if(_pmiLimitBand(lims[e])) set[e] = 1; });
  return PMI_ELEMENT_ORDER.filter(function(e){ return set[e]; });
}
// Full readings rows for the report (banded + informational extras). An element
// with a grade band OR a user custom limit carries that band + in/near/out
// state; the rest are informational ('info'/'blank'/'na').
function pmiReportRows(point, mode){
  point = point || {}; mode = mode || 'oes';
  var readings = point.readings || {};
  return pmiReportElements(point.grade).map(function(e){
    var bf = pmiBandFor(point, e), band = bf.band;
    if(band) return { el:e, val:readings[e], min:band[0], max:band[1], band:band, state:pmiElState(readings[e], band, e, mode), spec:bf.spec, custom:bf.custom };
    var v = readings[e];
    var st = (e === 'C' && mode === 'xrf') ? 'na' : ((v === '' || v == null || isNaN(parseFloat(v))) ? 'blank' : 'info');
    return { el:e, val:v, min:null, max:null, band:null, state:st, spec:false, custom:false };
  });
}
function pmiRangeText(band){ if(!band) return '—'; var lo = band[0], hi = band[1];
  if(lo != null && hi != null) return (lo===0 ? '≤ '+hi : lo+'–'+hi);
  if(hi != null) return '≤ '+hi; if(lo != null) return '≥ '+lo; return '—'; }

// Caution margin: a reading inside the band but within this fraction of a spec
// limit is flagged amber ("near limit") — still acceptable, but close enough to
// the edge to warrant a second look (instrument tolerance near the boundary).
var PMI_EDGE_FRAC = 0.10;
// Zones for one band: the amber edge strips (ylo near min, yhi near max) and the
// green core between them, all in value space. Two-sided bands use 10% of the
// band span at each end; one-sided limits use 10% of the limit value.
function pmiBandZones(band){
  if(!band) return null;
  var lo = band[0], hi = band[1], F = PMI_EDGE_FRAC;
  // A min of 0 means "no minimum" (a ≤ max limit), not a real lower bound — so
  // it gets no lower caution strip. Only genuine spec limits are flagged.
  var hasLo = (lo != null && lo > 0), hasHi = (hi != null);
  if(hasLo && hasHi && hi > lo){ var e = (hi - lo) * F; return { lo:lo, hi:hi, ylo:[lo, lo+e], yhi:[hi-e, hi], core:[lo+e, hi-e] }; }
  if(hasHi){ var eh = hi * F; return { lo:null, hi:hi, ylo:null, yhi:[hi-eh, hi], core:[null, hi-eh] }; }   // ≤ max
  if(hasLo){ var el2 = lo * F; return { lo:lo, hi:null, ylo:[lo, lo+el2], yhi:null, core:[lo+el2, null] }; }  // ≥ min
  return null;
}
// 'core' (comfortably in band) | 'near' (within a 10% edge strip) | null.
function pmiEdgeState(val, band){
  var z = pmiBandZones(band);
  if(!z || val === '' || val == null || isNaN(parseFloat(val))) return null;
  var v = parseFloat(val);
  if((z.ylo && v >= z.ylo[0] && v <= z.ylo[1]) || (z.yhi && v >= z.yhi[0] && v <= z.yhi[1])) return 'near';
  return 'core';
}

// Per-element pass/fail vs the grade's band. 'na' = not measurable (carbon on
// XRF); 'blank' = not yet entered; 'in'/'out' = inside / outside the band.
function pmiElState(val, band, elSym, mode){
  if(elSym === 'C' && mode === 'xrf') return 'na';
  if(val === '' || val == null || isNaN(parseFloat(val))) return 'blank';
  var v = parseFloat(val), lo = band[0], hi = band[1];
  if(lo != null && v < lo - 1e-9) return 'out';
  if(hi != null && v > hi + 1e-9) return 'out';
  return 'in';
}
// Grade-match verdict for ONE measurement point { grade, readings } (the analog
// of htVerdict). Returns the per-element evaluation plus the Result string.
function pmiPointMatch(point, mode){
  point = point || {}; mode = mode || 'oes';
  var grade = point.grade, readings = point.readings || {};
  var els = pmiCheckElements(point);   // grade-banded + custom-limited
  var rows = els.map(function(e){
    var band = pmiBandFor(point, e).band;
    return { el:e, val:readings[e], min:band[0], max:band[1], band:band, state:pmiElState(readings[e], band, e, mode) };
  });
  var checkable = rows.filter(function(r){ return r.state !== 'na'; });
  var anyOut = checkable.some(function(r){ return r.state === 'out'; });
  var anyBlank = checkable.some(function(r){ return r.state === 'blank'; });
  var complete = checkable.length > 0 && !anyBlank;
  var hasCriteria = !!grade || els.length > 0;   // a grade, or at least one custom limit
  var result = !hasCriteria ? '' : (anyOut ? 'Not acceptable' : (complete ? 'Acceptable' : ''));
  return { result:result, complete:complete, anyOut:anyOut, rows:rows, grade:grade };
}
// Component verdict — rolls up its measurement points (single → 1, 3-point → 3).
// Not acceptable if any graded point fails; Acceptable only when every graded
// point is complete & in spec; else '' (incomplete / no grade yet).
function pmiComponentVerdict(comp, mode){
  var graded = (comp && comp.points || []).filter(function(p){ return p && p.grade; });
  if(!graded.length) return '';
  var results = graded.map(function(p){ return pmiPointMatch(p, mode).result; });
  if(results.indexOf('Not acceptable') >= 0) return 'Not acceptable';
  return results.every(function(r){ return r === 'Acceptable'; }) ? 'Acceptable' : '';
}
// Whole-survey roll-up for the caption (matched / total components, overall pass).
function pmiSurveyVerdict(survey){
  survey = pmiNormalize(survey); if(!survey) return { total:0, matched:0, anyFail:false };
  var total = 0, matched = 0, anyFail = false;
  (survey.components || []).forEach(function(c){ var r = pmiComponentVerdict(c, survey.mode);
    if(r === 'Acceptable'){ total++; matched++; }
    else if(r === 'Not acceptable'){ total++; anyFail = true; } });
  return { total:total, matched:matched, anyFail:anyFail };
}

// ── model: defaults, normalise, sample ───────────────────────────────────────
// A component holds a measurement mode + its points. 'single' = one reading set
// (a plain component); '3point' = parent · weld · parent (a welded joint), each
// point with its own specified grade.
var PMI_3PT_LABELS = ['Parent material','Weld','Parent material'];
function _pmiBlankPoint(label){ return { label: label || '', grade:'', readings:{}, limits:{} }; }
function _pmiBlankComponent(){ return { measMode:'single', points:[ _pmiBlankPoint('Test point') ] }; }
// Build a component's points for a mode, preserving overlapping data. 3pt→single
// keeps the weld point's readings; single→3pt seeds the weld point from the
// existing single reading (parents start blank).
function _pmiClone(o){ return Object.assign({}, o || {}); }   // shallow copy — never share readings between points
function _pmiCloneLimits(l){ var o = {}; Object.keys(l || {}).forEach(function(k){ o[k] = (l[k] || []).slice(); }); return o; }
function _pmiPoint(label, src){ src = src || {}; return { label:label, grade:src.grade || '', readings:_pmiClone(src.readings), limits:_pmiCloneLimits(src.limits) }; }
function _pmiPointsForMode(measMode, existing){
  existing = existing || [];
  if(measMode === '3point'){
    var weldSrc = existing.length > 1 ? existing[1] : existing[0];
    return PMI_3PT_LABELS.map(function(lbl, i){ return _pmiPoint(lbl, (i === 1 ? weldSrc : existing[i])); });
  }
  return [ _pmiPoint('Test point', existing[1] || existing[0]) ];   // collapse → keep the weld point
}
function pmiDefault(mode){ return { mode: mode || 'xrf', components:[ _pmiBlankComponent() ] }; }
// Normalise to { mode, components:[{measMode, points:[{label,grade,readings}]}] }.
// Migrates legacy shapes (a top-level {grade,readings} survey, or per-component
// {grade,readings}) into a single-point component. Idempotent.
function pmiNormalize(survey){
  if(!survey) return null;
  if(!Array.isArray(survey.components)){
    survey = { mode: survey.mode || 'xrf', components:[ { grade: survey.grade || '', readings: survey.readings || {} } ] };
  }
  if(survey.mode !== 'xrf' && survey.mode !== 'oes') survey.mode = 'xrf';
  survey.components = (survey.components || []).map(function(c){
    c = c || {};
    if(Array.isArray(c.points) && c.points.length){
      var mm = c.measMode === '3point' ? '3point' : 'single';
      return { measMode:mm, points:c.points.map(function(p){ p = p || {}; return { label:p.label || '', grade:p.grade || '', readings:p.readings || {}, limits:p.limits || {} }; }) };
    }
    return { measMode:'single', points:[ { label:'Test point', grade:c.grade || '', readings:c.readings || {}, limits:{} } ] };
  });
  if(!survey.components.length) survey.components = [ _pmiBlankComponent() ];
  return survey;
}
function pmiComponentCount(survey){ survey = pmiNormalize(survey); return (survey && survey.components) ? survey.components.length : 0; }
// Empty = no point in any component has a specified grade (so an opted-in but
// unfilled PMI survey page is skipped on print, mirroring cadIsEmpty / HT).
function pmiIsEmpty(survey){ survey = pmiNormalize(survey); if(!survey) return true; return !(survey.components || []).some(function(c){ return (c.points || []).some(function(p){ return p && p.grade; }); }); }
function pmiIsXrf(){ return !!(_pmiSurvey && _pmiSurvey.mode === 'xrf'); }

// Sample survey / items for the editor preview (no real report attached). One
// single-point component, then a 3-point welded joint (parent 316L · weld 316L ·
// parent 316L), then a dissimilar example (parent P22 · weld 625 · parent P22).
// Custom limits on the otherwise report-only extras so the editor example also
// demonstrates the green/amber bar on added elements (Fe/Mn green, Cu near-limit
// amber). Spec-controlled elements (e.g. Mn on P22, Fe on 625) keep their grade
// band and need no limit.
var PMI_SAMPLE = { mode:'oes', components:[
  { measMode:'single', points:[ { label:'Test point', grade:'316L', readings:{ C:'0.022', Cr:'16.8', Ni:'10.4', Mo:'2.32', Mn:'1.52', Cu:'0.34', Fe:'68.1' }, limits:{ Mn:['1.0','2.0'], Cu:['','0.35'], Fe:['64','70'] } } ] },
  { measMode:'3point', points:[
    { label:'Parent material', grade:'316L', readings:{ C:'0.024', Cr:'16.9', Ni:'10.2', Mo:'2.28', Mn:'1.48', Fe:'68.3' }, limits:{ Mn:['1.0','2.0'], Fe:['60','70'] } },
    { label:'Weld',            grade:'316L', readings:{ C:'0.021', Cr:'17.1', Ni:'11.6', Mo:'2.41', Mn:'1.62', Fe:'67.0' }, limits:{ Mn:['1.0','2.0'], Fe:['60','70'] } },
    { label:'Parent material', grade:'316L', readings:{ C:'0.023', Cr:'16.8', Ni:'10.3', Mo:'2.30', Mn:'1.50', Fe:'68.2' }, limits:{ Mn:['1.0','2.0'], Fe:['60','70'] } },
  ] },
  { measMode:'3point', points:[
    { label:'Parent material', grade:'P22',       readings:{ C:'0.11', Mn:'0.46', Si:'0.24', Cr:'2.21', Mo:'0.98', Fe:'95.8' }, limits:{ Fe:['92','100'] } },
    { label:'Weld',            grade:'Alloy 625', readings:{ Ni:'61.2', Cr:'21.7', Mo:'8.9', Nb:'3.62', Fe:'3.1', Mn:'0.18' }, limits:{ Mn:['','0.50'] } },
    { label:'Parent material', grade:'P22',       readings:{ C:'0.12', Mn:'0.48', Si:'0.26', Cr:'2.24', Mo:'1.01', Fe:'95.6' }, limits:{ Fe:['92','100'] } },
  ] },
]};
var PMI_SAMPLE_ITEMS = [
  { subject:'6"-P-1201 elbow',     drawing:'ISO-P-1201', examDate:'', extent:'100%' },
  { subject:'4"-P-2204 tee',       drawing:'ISO-P-2204', examDate:'', extent:'100%' },
  { subject:'3"-A-3307 valve body',drawing:'ISO-A-3307', examDate:'', extent:'Risk-based' },
];

// ══════════════════════════════════════════════════════════════════════════
// RENDERER — returns an HTML string (SVG + tables). Print/light palette,
// aligned to the report tables (black ink, #ddd hairlines, verdict-chip tones).
// ══════════════════════════════════════════════════════════════════════════
var PMI_P = { ink:'#111', mut:'#6b7280', grid:'#ddd', line:'#cbcbcb',
  blue:'#1e40af', amber:'#b45309', green:'#065f46', red:'#991b1b',
  bandFill:'#d1fae5', bandStroke:'rgba(6,95,70,.55)',
  edgeFill:'rgba(217,119,6,.20)', edgeStroke:'rgba(180,83,9,.45)',
  steel:'rgba(20,30,55,.05)' };

// Per-component details header columns (editable widths on the block). The
// specified / identified grade lives in the per-point sub-headers (each point
// has its own grade), so the component header carries the measurement mode and
// the rolled-up Result instead.
var PMI_DETAIL_COLS = [
  { id:'compNo',    label:'Component / Item No.', w:175 },
  { id:'drawing',   label:'Line / ISO',           w:110 },
  { id:'meas',      label:'Measurement',          w:135 },
  { id:'examDate',  label:'Exam date',            w:85  },
  { id:'extent',    label:'Extent',               w:90  },
  { id:'technique', label:'Technique',            w:75  },
  { id:'verdict',   label:'Result',               w:100 },
];

// opts mirror htRenderSurvey: { print, sample, slice:{start,count}, part:
// 'method'|'results'|'all', items, barColor, detailWidths }.
function pmiRenderSurvey(survey, opts){
  opts = opts || {};
  var part = opts.part || 'all';
  var hasData = function(s){ return s && (Array.isArray(s.components) || s.readings || s.grade); };
  if(!hasData(survey) && opts.sample) survey = PMI_SAMPLE;
  if(!hasData(survey)) return '<div style="padding:18px;color:#9aa6b5;font-size:11px;text-align:center">No material-verification survey recorded.</div>';
  survey = pmiNormalize(survey);
  var items = opts.items || (opts.sample ? PMI_SAMPLE_ITEMS : []);
  var P = PMI_P, mode = survey.mode || 'xrf';
  var bar = opts.barColor || ((typeof cvTplCfg !== 'undefined' && cvTplCfg.sectionColor) ? cvTplCfg.sectionColor : '#404040');
  var detailWidths = (Array.isArray(opts.detailWidths) && opts.detailWidths.length === PMI_DETAIL_COLS.length) ? opts.detailWidths : null;
  var comps = survey.components || [];
  var slice = opts.slice || null;
  var continued = !!(slice && slice.start > 0) && part !== 'method';
  if(continued) part = 'results';
  var wantMethod = (part === 'all' || part === 'method');
  var wantResults = (part === 'all' || part === 'results');

  var title = continued ? 'MATERIAL VERIFICATION CONT' : (part === 'method' ? 'MATERIAL VERIFICATION — METHOD' : 'MATERIAL VERIFICATION (PMI)');
  var html = '<div style="background:'+bar+';color:#fff;font:700 11px \'Geist\',system-ui,sans-serif;letter-spacing:.06em;text-align:center;padding:4px 8px">'+title+'</div>';

  if(wantResults && !continued){
    var sv = pmiSurveyVerdict(survey), nc = comps.length;
    var tech = mode === 'xrf' ? 'XRF (X-ray fluorescence)' : 'OES (optical emission)';
    var sub = nc + ' component' + (nc===1?'':'s') + ' · API 578 grade match to MTR';
    var verdict = sv.total ? ((sv.anyFail ? '<b style="color:'+P.red+'">FAIL</b>' : '<b style="color:'+P.green+'">PASS</b>') + ' · ' + sv.matched + '/' + sv.total + ' match') : '';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 8px;font:400 8px \'Geist Mono\',monospace;color:'+P.mut+';border-bottom:0.5px solid '+P.grid+'"><span>'+escapeHtml(tech)+' · '+sub+'</span><span>'+verdict+'</span></div>';
  }
  if(wantMethod && !continued){
    html += '<div style="padding:6px 8px 2px">' + _pmiMethodCard(mode, P) + '</div>';
  }
  if(wantResults){
    var start = slice ? slice.start : 0, count = slice ? slice.count : comps.length;
    comps.slice(start, start + count).forEach(function(c, k){
      var idx = start + k;
      html += _pmiCompUnit(c, items[idx] || {}, idx, mode, P, bar, detailWidths);
    });
  }
  return '<div style="overflow:hidden;font-family:\'Geist\',system-ui,sans-serif">' + html + '</div>';
}

// One component block: details header + one point block per measurement point
// (single → 1; 3-point → parent · weld · parent).
function _pmiCompUnit(comp, item, idx, mode, P, bar, detailWidths){
  comp = comp || {};
  var sep = idx > 0 ? 'border-top:2px solid '+P.grid+';margin-top:8px;padding-top:2px;' : '';
  var pts = comp.points || [];
  var multi = pts.length > 1;
  var blocks = pts.map(function(pt, pi){ return _pmiPointBlock(pt, pi, mode, P, bar, multi); }).join('');
  return '<div style="'+sep+'">'
    + _pmiItemDetails(comp, item, idx, mode, P, bar, detailWidths)
    + blocks
    + '</div>';
}

// Result chip for a result string (report verdict tones).
function _pmiVerdictChip(result, P){
  if(!result) return '<span style="color:#6b7280">—</span>';
  var c = (typeof OV_VERDICT_COLORS !== 'undefined' && OV_VERDICT_COLORS[result]) ? OV_VERDICT_COLORS[result] : null;
  if(!c) return escapeHtml(result);
  return '<span style="display:inline-block;padding:1px 7px;border-radius:3px;background:'+c.bg+';color:'+c.fg+';font-weight:700">'+escapeHtml(result)+'</span>';
}
// Human label for a component's measurement mode.
function _pmiMeasLabel(comp){ return (comp && comp.measMode === '3point') ? '3-point (parent · weld · parent)' : 'Single point'; }

// One measurement point: a sub-header (label · specified grade · identified ·
// result) then its composition chart + readings table. `multi` adds the header
// (omitted for a single-point component, which reads as one block).
function _pmiPointBlock(point, pi, mode, P, bar, multi){
  point = point || {};
  var m = pmiPointMatch(point, mode);
  var head = '';
  if(multi){
    var nominal = point.grade && PMI_GRADES[point.grade] ? (point.grade + ' — ' + PMI_GRADES[point.grade].name) : '— no grade —';
    var ident = !point.grade ? '' : (m.result === 'Acceptable' ? (' · found <b>'+escapeHtml(point.grade)+'</b>') : (m.result === 'Not acceptable' ? ' · <span style="color:'+P.red+'">Unidentified</span>' : ''));
    head = '<div style="display:flex;align-items:center;gap:8px;padding:4px 8px 2px;font-family:\'Geist\',sans-serif;font-size:9.5px;color:'+P.ink+'">'
      + '<span style="font-weight:700">'+escapeHtml(point.label || ('Point '+(pi+1)))+'</span>'
      + '<span style="color:'+P.mut+'">spec: '+escapeHtml(nominal)+ident+'</span>'
      + '<span style="margin-left:auto">'+_pmiVerdictChip(m.result, P)+'</span></div>';
  }
  return '<div style="'+(pi>0?'border-top:0.5px dashed '+P.grid+';margin-top:6px;':'')+'">'
    + head
    + '<div style="padding:4px 8px 0">' + _pmiCompChart(point, mode, P) + '</div>'
    + _pmiCompTable(point, mode, P, bar)
    + '</div>';
}

function _pmiItemDetails(comp, item, idx, mode, P, bar, colWidths){
  item = item || {}; comp = comp || {};
  function val(x){ return (x === '' || x == null) ? '<span style="color:#9aa6b5">—</span>' : escapeHtml(x); }
  var no = ('00' + (idx + 1)).slice(-3);
  var compNo = no + (item.subject ? (' · ' + escapeHtml(item.subject)) : '');
  var examDate = (item.examDate && typeof fmtDate === 'function') ? escapeHtml(fmtDate(item.examDate)) : val(item.examDate);
  var heads = PMI_DETAIL_COLS.map(function(c){ return c.label; });
  var cells = [
    { v:compNo, extra:'font-weight:600' },
    { v:val(item.drawing) },
    { v:_pmiMeasLabel(comp) },
    { v:examDate, extra:'font-family:\'Geist Mono\',monospace' },
    { v:val(item.extent) },
    { v:(mode === 'xrf' ? 'XRF' : 'OES'), extra:'font-family:\'Geist Mono\',monospace' },
    { v:_pmiVerdictChip(pmiComponentVerdict(comp, mode), P) },
  ];
  return _pmiTableEl(heads, [{ cells:cells }], bar, P, colWidths);
}

// Shared table builder (mirrors the report items-table look).
function _pmiTableEl(headLabels, rowsData, bar, P, colWidths){
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

// Per-element acceptance domain (band-centric so the band reads prominently
// rather than being a sliver on a 0→max axis).
function _pmiDomain(r){
  var lo = r.min, hi = r.max, v = parseFloat(r.val);
  var d0, d1;
  if(lo != null && hi != null && hi > lo){ var span = Math.max(hi - lo, hi * 0.05, 0.01); d0 = lo - span * 0.8; d1 = hi + span * 0.8; }
  else if(hi != null){ d0 = 0; d1 = (hi || 1) * 1.6; }                 // ≤ max
  else if(lo != null){ d0 = lo * 0.85; d1 = (lo || 1) * 1.25; }        // ≥ min
  else if(!isNaN(v)){ d0 = 0; d1 = Math.max(v * 1.4, 0.01); }          // no band (informational) — frame the reading
  else { d0 = 0; d1 = 1; }
  if(!isNaN(v)){ var pad = (d1 - d0) * 0.12; d0 = Math.min(d0, v - pad); d1 = Math.max(d1, v + pad); }
  if(d0 < 0) d0 = 0;
  if(d1 <= d0) d1 = d0 + 1;
  return [d0, d1];
}
// Composition range chart — one row per reported element. Spec-controlled
// elements show the acceptance band (green core + amber 10% caution strips) with
// the measured value as a diamond (green in / amber near limit / red out).
// Always-reported extras (Mn/Cu/Nb/Fe) have no band, so they plot a neutral
// grey marker on a plain track and are labelled "report only".
function _pmiCompChart(comp, mode, P){
  var rows = comp && comp.grade ? pmiReportRows(comp, mode) : [];
  if(!rows.length) return '<div style="padding:8px;color:#9aa6b5;font-size:10px;text-align:center">Select a specified grade to chart its composition bands.</div>';
  var W = 794, TX0 = 196, TX1 = 560, rowH = 22, top = 22, H = top + rows.length * rowH + 10;
  var s = '';
  s += '<text x="6" y="13" font-family="\'Geist Mono\',monospace" font-size="9" fill="'+P.mut+'">CHEMICAL COMPOSITION (wt%) vs '+(comp.grade?escapeHtml(comp.grade):'grade')+' ACCEPTANCE BAND</text>';
  rows.forEach(function(r, i){
    var cy = top + i * rowH + rowH / 2;
    var dom = _pmiDomain(r), d0 = dom[0], d1 = dom[1];
    function sx(v){ return TX0 + (v - d0) / (d1 - d0) * (TX1 - TX0); }
    var edge = (r.state === 'in') ? pmiEdgeState(r.val, r.band) : null;   // 'core' | 'near' | null
    // element label
    s += '<text x="8" y="'+(cy-1)+'" font-family="\'Geist\',sans-serif" font-weight="700" font-size="11" fill="'+P.ink+'">'+r.el+'</text>';
    s += '<text x="30" y="'+(cy-1)+'" font-family="\'Geist\',sans-serif" font-size="8.5" fill="'+P.mut+'">'+escapeHtml(PMI_ELEMENT_NAMES[r.el]||'')+'</text>';
    // track baseline
    s += '<line x1="'+TX0+'" y1="'+cy+'" x2="'+TX1+'" y2="'+cy+'" stroke="'+P.grid+'" stroke-width="1"/>';
    if(r.band){
      // acceptance band: amber 10% caution strips at the spec ends, green core
      // between (draw the amber band full-width, overlay the green core on top).
      var bandLo = r.min != null ? r.min : d0, bandHi = r.max != null ? r.max : d1;
      var bx0 = sx(bandLo), bx1 = sx(bandHi), z = pmiBandZones(r.band);
      s += '<rect x="'+bx0.toFixed(1)+'" y="'+(cy-6)+'" width="'+Math.max(1,(bx1-bx0)).toFixed(1)+'" height="12" fill="'+P.edgeFill+'" stroke="'+P.edgeStroke+'" stroke-width=".7"/>';
      if(z){
        var cLo = sx(z.core[0] != null ? z.core[0] : bandLo), cHi = sx(z.core[1] != null ? z.core[1] : bandHi);
        if(cHi > cLo) s += '<rect x="'+cLo.toFixed(1)+'" y="'+(cy-6)+'" width="'+(cHi-cLo).toFixed(1)+'" height="12" fill="'+P.bandFill+'" stroke="none"/>';
      }
      // band edge labels
      if(r.min != null && r.min > 0) s += '<text x="'+bx0.toFixed(1)+'" y="'+(cy+15)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="7.5" fill="'+P.mut+'">'+r.min+'</text>';
      if(r.max != null) s += '<text x="'+bx1.toFixed(1)+'" y="'+(cy+15)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="7.5" fill="'+P.mut+'">'+r.max+'</text>';
    } else {
      // informational element — no acceptance band to evaluate against
      s += '<text x="'+TX0+'" y="'+(cy+15)+'" font-family="\'Geist Mono\',monospace" font-size="7.5" fill="#9aa6b5">report only</text>';
    }
    // measured marker — red out of band, amber within the 10% edge, green core,
    // neutral grey for informational (no-band) elements. A custom user limit
    // counts as a band, so those evaluate green/amber/red like spec elements.
    var mcol = r.state === 'out' ? P.red : (!r.band ? P.mut : (edge === 'near' ? P.amber : P.green));
    if(r.state === 'na'){
      s += '<text x="'+((TX0+TX1)/2)+'" y="'+(cy+3)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="8" fill="'+P.mut+'">not measurable (XRF)</text>';
    } else if(r.state !== 'blank'){
      var mx = sx(parseFloat(r.val));
      mx = Math.max(TX0-6, Math.min(TX1+6, mx));
      s += '<polygon points="'+mx.toFixed(1)+','+(cy-6)+' '+(mx+5).toFixed(1)+','+cy+' '+mx.toFixed(1)+','+(cy+6)+' '+(mx-5).toFixed(1)+','+cy+'" fill="'+mcol+'" stroke="#fff" stroke-width=".8"/>';
    }
    // right column: measured value + spec range (or "report" for extras)
    var meas = (r.state === 'blank') ? '—' : (r.state === 'na' ? 'n/a' : r.val);
    var mc = (r.state === 'blank' || r.state === 'na') ? P.mut : mcol;
    s += '<text x="'+(TX1+12)+'" y="'+(cy+3)+'" font-family="\'Geist Mono\',monospace" font-size="9" font-weight="700" fill="'+mc+'">'+escapeHtml(String(meas))+'</text>';
    s += '<text x="'+(TX1+70)+'" y="'+(cy+3)+'" font-family="\'Geist Mono\',monospace" font-size="8" fill="'+(r.custom?P.blue:P.mut)+'">'+(r.band ? '('+escapeHtml(pmiRangeText(r.band))+(r.custom?' set':'')+')' : '(report)')+'</text>';
  });
  var legend = '<div style="font-family:\'Geist\',sans-serif;font-size:9px;color:'+P.mut+';margin-top:2px;display:flex;gap:14px;flex-wrap:wrap">'
    + '<span><span style="display:inline-block;width:18px;height:8px;vertical-align:middle;background:'+P.bandFill+';border:.5px solid '+P.bandStroke+'"></span> within spec</span>'
    + '<span><span style="display:inline-block;width:18px;height:8px;vertical-align:middle;background:'+P.edgeFill+';border:.5px solid '+P.edgeStroke+'"></span> within 10% of a limit</span>'
    + '<span><span style="display:inline-block;width:9px;height:9px;vertical-align:middle;transform:rotate(45deg);background:'+P.green+'"></span> measured · <span style="color:'+P.amber+'">amber = near limit</span> · <span style="color:'+P.red+'">red = out</span> · <span style="color:'+P.mut+'">grey = report only</span></span>'
    + '</div>';
  return '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;display:block">'+s+'</svg>'+legend;
}

// Readings table: the full measured spectrum (grade-controlled elements + the
// always-reported extras Mn/Cu/Nb/Fe). Element | Measured | Spec min | Spec max
// | Status. Informational (non-spec) elements show a neutral "reported" status.
function _pmiCompTable(comp, mode, P, bar){
  var rows = comp && comp.grade ? pmiReportRows(comp, mode) : [];
  var heads = ['Element','Measured (wt%)','Spec min','Spec max','Status'];
  var statusCell = function(st, near){
    if(st === 'in' && near) return '<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:#fef3c7;color:#b45309;font-weight:600">In band · near limit</span>';
    if(st === 'in')   return '<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:#d1fae5;color:#065f46;font-weight:600">In band</span>';
    if(st === 'out')  return '<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:#fee2e2;color:#991b1b;font-weight:600">Out of band</span>';
    if(st === 'info') return '<span style="color:#6b7280">Reported</span>';
    if(st === 'na')   return '<span style="color:#6b7280">n/a (XRF)</span>';
    return '<span style="color:#9aa6b5">—</span>';
  };
  var body = rows.map(function(r){
    var near = (r.state === 'in') && pmiEdgeState(r.val, r.band) === 'near';
    var tag = r.spec ? '' : (r.custom ? ' <span style="color:#1e40af;font-size:7.5px">(custom limit)</span>' : ' <span style="color:#9aa6b5;font-size:7.5px">(report)</span>');
    return { cells: [
      { v:'<b>'+r.el+'</b> <span style="color:#6b7280">'+escapeHtml(PMI_ELEMENT_NAMES[r.el]||'')+'</span>' + tag },
      { v:(r.state==='na'?'n/a':(r.val===''||r.val==null?'—':escapeHtml(r.val))), extra:'font-family:\'Geist Mono\',monospace;font-weight:600' },
      { v:(r.min!=null?escapeHtml(r.min):'—'), extra:'font-family:\'Geist Mono\',monospace' },
      { v:(r.max!=null?escapeHtml(r.max):'—'), extra:'font-family:\'Geist Mono\',monospace' },
      { v:statusCell(r.state, near) },
    ] };
  });
  if(!body.length) body = [{ cells:[{ v:'<span style="color:#9aa6b5">No grade selected</span>' },{v:''},{v:''},{v:''},{v:''}] }];
  return _pmiTableEl(heads, body, bar, P);
}

// "How the material is verified" — a welded-pipe side view with the 3 PMI test
// points (parent material · weld · parent material, per API 578: verify both
// parent metals AND the weld deposit), alongside the single reference-standard
// reading the instrument is standardised on. Plus the XRF carbon caveat.
function _pmiMethodCard(mode, P){
  var xrf = mode === 'xrf';
  var weldFill = 'rgba(30,64,175,.10)';
  var s = '';
  s += '<text x="6" y="13" font-family="\'Geist Mono\',monospace" font-size="9.5" font-weight="700" fill="'+P.ink+'">HOW THE MATERIAL IS VERIFIED</text>';
  // technique rules — active one highlighted
  [['xrf','XRF','X-ray fluorescence — portable alloy ID; carbon NOT measurable'],
   ['oes','OES','Optical emission (arc-spark) — measures carbon; verifies L-grades']].forEach(function(z,i){
    var on = (z[0] === mode);
    s += '<text x="6" y="'+(28+i*11)+'" font-family="\'Geist Mono\',monospace" font-size="8" fill="'+(on?P.blue:P.mut)+'"'+(on?' font-weight="700"':'')+'>'+(on?'▸ ':'  ')+z[1]+' — '+z[2]+'</text>';
  });
  // ── welded pipe side view + 3 test points ──
  var pipeL=64, pipeR=452, top=108, bot=176, cx=258, callTop=80;
  s += '<rect x="'+pipeL+'" y="'+top+'" width="'+(pipeR-pipeL)+'" height="'+(bot-top)+'" fill="'+P.steel+'" stroke="'+P.line+'"/>';
  // weld bead at the centre (body + cap reinforcement)
  s += '<rect x="'+(cx-9)+'" y="'+top+'" width="18" height="'+(bot-top)+'" fill="'+weldFill+'" stroke="'+P.blue+'" stroke-opacity=".55"/>';
  s += '<path d="M'+(cx-12)+' '+top+' Q '+cx+' '+(top-7)+' '+(cx+12)+' '+top+'" fill="'+weldFill+'" stroke="'+P.blue+'" stroke-opacity=".5"/>';
  // 3 callout points: parent (grey) · weld (blue) · parent (grey)
  var p1=pipeL+58, p3=pipeR-58;
  var pts = [[p1,P.mut,'1','Parent material'],[cx,P.blue,'2','Weld'],[p3,P.mut,'3','Parent material']];
  pts.forEach(function(pt){ var x=pt[0], c=pt[1];
    s += '<line x1="'+x+'" y1="'+(callTop+9)+'" x2="'+x+'" y2="'+(top-2)+'" stroke="'+c+'" stroke-width="1" stroke-dasharray="2 2" opacity=".75"/>';
    s += '<circle cx="'+x+'" cy="'+top+'" r="3" fill="'+c+'"/>';
    s += '<circle cx="'+x+'" cy="'+callTop+'" r="9" fill="#fff" stroke="'+c+'"/><text x="'+x+'" y="'+(callTop+3.5)+'" text-anchor="middle" font-family="\'Geist\',sans-serif" font-weight="700" font-size="11" fill="'+c+'">'+pt[2]+'</text>';
    s += '<text x="'+x+'" y="'+(bot+15)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="8.5" fill="'+c+'">'+pt[2]+' '+pt[3]+'</text>';
  });
  // faint divider, then the single reference-standard reading inset
  s += '<line x1="498" y1="70" x2="498" y2="'+(bot+22)+'" stroke="'+P.grid+'" stroke-dasharray="3 3"/>';
  var ax=520, ay=(top+bot)/2;
  s += '<rect x="'+ax+'" y="'+(ay-20)+'" width="60" height="40" rx="6" fill="#eef2f7" stroke="'+P.line+'"/>';
  s += '<rect x="'+(ax+9)+'" y="'+(ay-12)+'" width="32" height="13" rx="2" fill="#fff" stroke="'+P.line+'"/>';
  s += '<polygon points="'+(ax+60)+','+(ay-8)+' '+(ax+82)+','+ay+' '+(ax+60)+','+(ay+8)+'" fill="#dbe3ee" stroke="'+P.line+'"/>';
  s += '<text x="'+(ax+30)+'" y="'+(ay+33)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="8" fill="'+P.mut+'">Analyser</text>';
  var rx=636;
  s += '<line x1="'+(ax+82)+'" y1="'+ay+'" x2="'+(rx-2)+'" y2="'+ay+'" stroke="'+P.green+'" stroke-width="1.3" stroke-dasharray="5 3"/>';
  s += '<path d="M'+(rx-2)+' '+(ay-4)+' L '+(rx-8)+' '+ay+' L '+(rx-2)+' '+(ay+4)+'" fill="'+P.green+'"/>';
  s += '<rect x="'+rx+'" y="'+top+'" width="92" height="'+(bot-top)+'" rx="4" fill="rgba(6,95,70,.06)" stroke="'+P.bandStroke+'"/>';
  s += '<text x="'+(rx+46)+'" y="'+(ay-2)+'" text-anchor="middle" font-family="\'Geist\',sans-serif" font-weight="700" font-size="11" fill="'+P.green+'">CRM</text>';
  s += '<text x="'+(rx+46)+'" y="'+(ay+11)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="7.5" fill="'+P.mut+'">certified reference</text>';
  s += '<text x="'+((ax+rx+92)/2)+'" y="'+(bot+15)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="8.5" fill="'+P.green+'">Single reference reading</text>';
  // bottom notes
  s += '<text x="6" y="'+(bot+33)+'" font-family="\'Geist Mono\',monospace" font-size="8" fill="'+P.mut+'">Verify the parent material each side of the weld and the weld deposit; standardise on the CRM before &amp; after use — API 578.</text>';
  if(xrf) s += '<text x="6" y="'+(bot+45)+'" font-family="\'Geist Mono\',monospace" font-size="8" fill="'+P.amber+'">✱ XRF cannot read carbon — grade vs low-carbon (L) grade not distinguishable; use OES where C is critical.</text>';
  return '<svg viewBox="0 0 794 '+(xrf?228:216)+'" style="width:100%;height:auto;display:block">'+s+'</svg>';
}

// ══════════════════════════════════════════════════════════════════════════
// DATA ENTRY (report form). _pmiSurvey is the source of truth; the grid edits it.
// ══════════════════════════════════════════════════════════════════════════
var _pmiSurvey = null;

function pmiRenderEntrySection(existing){
  _pmiSurvey = (existing && (existing.components || existing.readings || existing.grade)) ? pmiNormalize(JSON.parse(JSON.stringify(existing))) : pmiDefault('xrf');
  pmiSyncComponents();
  pmiSeedGradesFromItems();
  return '<div class="sc" style="margin:0 14px 14px"><div class="sc-head"><span class="sc-title">Material verification (PMI)</span></div><div class="sc-body" style="padding:14px 16px">'
    + '<div class="fg form-row" style="margin-bottom:4px;display:flex;gap:12px;flex-wrap:wrap">'
      + '<div class="fld" style="width:280px"><label>Technique</label><select id="pmi-mode" data-on-change="pmiSetMode" data-pass-el="1">'
        + '<option value="xrf"'+(_pmiSurvey.mode==='xrf'?' selected':'')+'>XRF — X-ray fluorescence (no carbon)</option>'
        + '<option value="oes"'+(_pmiSurvey.mode==='oes'?' selected':'')+'>OES — optical emission (incl. carbon)</option></select></div>'
    + '</div>'
    + '<div style="font-size:11px;color:var(--t3);margin:2px 0 12px">Each component is one line in the <b>Examination details</b> table above. The Result is set automatically — every controlled element of the specified grade must fall inside its acceptance band (API 578 grade match).</div>'
    + '<div id="pmi-grid">'+pmiGridHtml()+'</div>'
    + '<div style="font-size:11px;color:var(--t3);margin:10px 0 6px;text-transform:uppercase;letter-spacing:.05em">Live preview</div>'
    + '<div id="pmi-preview" style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:14px 16px">'+pmiRenderSurvey(_pmiSurvey,{print:true,items:_pmiItems()})+'</div>'
    + '</div></div>';
}

// The examination items drive the components (one component per item line).
function _pmiItems(){ return (typeof _ovItems !== 'undefined' && Array.isArray(_ovItems)) ? _ovItems : []; }
function _pmiItemCount(){ var n = _pmiItems().length; return n > 0 ? n : 1; }
function _pmiComponentLabel(wi){ var it = _pmiItems()[wi]; return (it && it.subject) ? it.subject : ''; }
// Keep _pmiSurvey.components aligned with the item count.
function pmiSyncComponents(){
  if(!_pmiSurvey) return;
  if(!Array.isArray(_pmiSurvey.components)) _pmiSurvey = pmiNormalize(_pmiSurvey);
  var n = _pmiItemCount();
  while(_pmiSurvey.components.length < n) _pmiSurvey.components.push(_pmiBlankComponent());
  if(_pmiSurvey.components.length > n) _pmiSurvey.components = _pmiSurvey.components.slice(0, n);
}
// One-way convenience: prefill a component's specified grade from the matching
// item's Material column when it names a known grade and none is set yet.
function pmiSeedGradesFromItems(){
  if(!_pmiSurvey) return;
  var items = _pmiItems();
  _pmiSurvey.components.forEach(function(c, i){
    var mat = items[i] && items[i].material;
    if(!mat || !PMI_GRADES[mat]) return;
    (c.points || []).forEach(function(p){ if(!p.grade) p.grade = mat; });
  });
}
// Called from the items-table add/remove hooks so the grid tracks the rows.
function pmiSyncToItems(){ if(!_pmiSurvey) return; pmiReadGrid(); pmiSyncComponents(); pmiRebuildGrid(); }

function _pmiGradeSelect(wi, pi, grade){
  var groups = {}, order = [];
  PMI_GRADE_ORDER.forEach(function(k){ var fam = PMI_GRADES[k].family; if(!groups[fam]){ groups[fam] = []; order.push(fam); } groups[fam].push(k); });
  var opts = '<option value=""'+(!grade?' selected':'')+'>— select grade —</option>';
  order.forEach(function(fam){
    opts += '<optgroup label="'+escapeHtml(fam)+'">';
    groups[fam].forEach(function(k){ opts += '<option value="'+escapeHtml(k)+'"'+(k===grade?' selected':'')+'>'+escapeHtml(k)+' — '+escapeHtml(PMI_GRADES[k].name)+'</option>'; });
    opts += '</optgroup>';
  });
  return '<select data-pmi-comp="'+wi+'" data-pmi-pt="'+pi+'" data-on-change="pmiGradeChange" data-pass-el="1" style="width:290px">'+opts+'</select>';
}
function _pmiElInput(wi, pi, elSym, val, disabled){
  return '<input type="number" step="any" data-pmi-comp="'+wi+'" data-pmi-pt="'+pi+'" data-pmi-el="'+elSym+'" data-on-input="pmiEntryChanged" value="'+(val===''||val==null?'':escapeHtml(val))+'" placeholder="wt%" '+(disabled?'disabled title="XRF cannot measure carbon"':'')+' style="width:74px'+(disabled?';background:var(--bg3,#f1f1f1);opacity:.6;cursor:not-allowed':'')+'"/>';
}
// Optional min/max acceptance limit for a report-only element → turns it into a
// green/amber band on the chart (which='0' min, '1' max).
function _pmiLimInput(wi, pi, elSym, which, val){
  return '<input type="number" step="any" data-pmi-comp="'+wi+'" data-pmi-pt="'+pi+'" data-pmi-el="'+elSym+'" data-pmi-lim="'+which+'" data-on-input="pmiEntryChanged" value="'+(val===''||val==null?'':escapeHtml(val))+'" placeholder="'+(which==='0'?'min':'max')+'" title="'+(which==='0'?'Low':'High')+' acceptance limit (optional)" style="width:46px"/>';
}
// One measurement point's entry sub-block: label (3-point only), grade select +
// live match chip, then an input per report element.
function _pmiPointEntryHtml(wi, pi, point, mode, multi){
  point = point || {}; var grade = point.grade;
  var m = grade ? pmiPointMatch(point, mode) : null;
  var chip = '';
  if(m && m.result){ var col = m.result === 'Acceptable' ? '#065f46' : '#991b1b', bg = m.result === 'Acceptable' ? '#d1fae5' : '#fee2e2';
    chip = '<span style="display:inline-block;padding:2px 9px;border-radius:4px;background:'+bg+';color:'+col+';font-weight:700;font-size:11px;margin-left:10px">'+(m.result==='Acceptable'?'✓ Grade match':'✗ No match')+'</span>'; }
  else if(grade){ chip = '<span style="color:var(--t3);font-size:11px;margin-left:10px">enter readings…</span>'; }
  var els = grade ? pmiReportElements(grade) : [];
  var rd = point.readings || {}, lims = point.limits || {};
  var inputs = els.length
    ? '<div style="display:flex;flex-wrap:wrap;gap:10px 14px;margin-top:8px">' + els.map(function(e){
        var band = PMI_GRADES[grade].el[e];
        if(band){
          var disabled = (e === 'C' && mode === 'xrf');
          return '<div style="display:flex;flex-direction:column;gap:2px"><label style="font-size:10px;color:var(--t3)">'+e+' <span style="color:var(--t4,#9aa6b5)">'+escapeHtml(pmiRangeText(band))+'</span></label>'+_pmiElInput(wi, pi, e, rd[e], disabled)+'</div>';
        }
        // report-only element — measured value + optional low/high acceptance limit
        var lim = lims[e] || ['',''];
        return '<div style="display:flex;flex-direction:column;gap:2px"><label style="font-size:10px;color:var(--t3)">'+e+' <span style="color:var(--t4,#9aa6b5);font-style:italic">report</span></label>'
          + '<div style="display:flex;align-items:flex-end;gap:4px">'+_pmiElInput(wi, pi, e, rd[e], false)
          + '<div style="display:flex;flex-direction:column;gap:1px"><span style="font-size:8px;color:var(--t4,#9aa6b5);text-align:center">limits</span><div style="display:flex;gap:3px">'+_pmiLimInput(wi, pi, e, '0', lim[0])+_pmiLimInput(wi, pi, e, '1', lim[1])+'</div></div>'
          + '</div></div>';
      }).join('') + '</div>'
    : '<div style="font-size:11px;color:var(--t3);margin-top:6px">Select a specified grade to enter its controlled elements.</div>';
  var ptLabel = multi ? '<div style="font-size:11px;font-weight:600;color:var(--t2);margin-bottom:4px">'+escapeHtml(point.label || ('Point '+(pi+1)))+'</div>' : '';
  return '<div style="'+(pi>0?'border-top:1px dashed var(--border);margin-top:10px;padding-top:8px;':'')+'">'
    + ptLabel
    + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><label style="font-size:11px;color:var(--t3)">Specified grade</label>'+_pmiGradeSelect(wi, pi, grade)+chip+'</div>'
    + inputs
    + '</div>';
}

function _pmiMeasSelect(wi, measMode){
  return '<select data-pmi-comp="'+wi+'" data-on-change="pmiSetMeasMode" data-pass-el="1" style="width:280px">'
    + '<option value="single"'+(measMode!=='3point'?' selected':'')+'>Single point</option>'
    + '<option value="3point"'+(measMode==='3point'?' selected':'')+'>3-point (parent · weld · parent)</option></select>';
}
function pmiGridHtml(){
  var s = _pmiSurvey, mode = s.mode, multi = (s.components||[]).length > 1;
  return (s.components||[]).map(function(comp, wi){
    var lbl = _pmiComponentLabel(wi);
    var del = multi ? '<button class="btn btn-sm btn-danger" data-action="pmiRemoveComponent" data-args="'+wi+'" title="Remove this component" style="padding:2px 9px;font-size:11px;margin-left:10px">− Remove component</button>' : '';
    var pts = comp.points || [];
    var multiPt = pts.length > 1;
    var points = pts.map(function(pt, pi){ return _pmiPointEntryHtml(wi, pi, pt, mode, multiPt); }).join('');
    return '<div style="margin-bottom:14px;padding-bottom:12px'+(wi<(s.components.length-1)?';border-bottom:1px solid var(--border)':'')+'">'
      + '<div style="display:flex;align-items:center;font-size:12px;font-weight:600;color:var(--t1);margin-bottom:6px">Component '+(wi+1)+(lbl?' — '+escapeHtml(lbl):'')+del+'</div>'
      + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px"><label style="font-size:11px;color:var(--t3)">Measurement</label>'+_pmiMeasSelect(wi, comp.measMode)+'</div>'
      + points
      + '</div>';
  }).join('')
    + '<button class="btn btn-sm" data-action="pmiAddComponent" style="margin-top:2px">+ Add component</button>'
    + '<div style="font-size:11px;color:var(--t3);margin-top:6px">Each component is one line in the Examination details table above — adding/removing here keeps them in sync. A 3-point measurement verifies the parent material each side of the weld and the weld deposit (API 578).</div>';
}

// read DOM grid → _pmiSurvey (without rebuilding the grid)
function pmiReadGrid(){
  if(!_pmiSurvey) return;
  var ms = el('pmi-mode'); if(ms) _pmiSurvey.mode = ms.value || 'xrf';
  var grid = el('pmi-grid'); if(!grid) return;
  (_pmiSurvey.components || []).forEach(function(comp, wi){
    (comp.points || []).forEach(function(point, pi){
      var gs = grid.querySelector('select[data-pmi-comp="'+wi+'"][data-pmi-pt="'+pi+'"][data-on-change="pmiGradeChange"]');
      if(gs) point.grade = gs.value;
      if(!point.readings) point.readings = {};
      if(!point.limits) point.limits = {};
      // measured readings (exclude the min/max limit inputs, which share data-pmi-el)
      grid.querySelectorAll('input[data-pmi-comp="'+wi+'"][data-pmi-pt="'+pi+'"][data-pmi-el]:not([data-pmi-lim])').forEach(function(inp){
        point.readings[inp.getAttribute('data-pmi-el')] = inp.value;
      });
      // custom low/high acceptance limits for the report-only elements
      grid.querySelectorAll('input[data-pmi-comp="'+wi+'"][data-pmi-pt="'+pi+'"][data-pmi-lim]').forEach(function(inp){
        var e = inp.getAttribute('data-pmi-el'), which = parseInt(inp.getAttribute('data-pmi-lim'), 10) || 0;
        if(!point.limits[e]) point.limits[e] = ['', ''];
        point.limits[e][which] = inp.value;
      });
    });
  });
}
function pmiRenderPreview(){ var pv = el('pmi-preview'); if(pv) pv.innerHTML = pmiRenderSurvey(_pmiSurvey, { print:true, items:_pmiItems() }); }
function pmiRebuildGrid(){ var g = el('pmi-grid'); if(g) g.innerHTML = pmiGridHtml(); pmiRenderPreview(); }

function pmiEntryChanged(){ pmiReadGrid(); pmiAutoVerdicts(); pmiRenderPreview(); }
// Each component's grade-match is derived from its readings and written back to
// the matching Examination-details item verdict (locked column). Mirrors
// htAutoVerdicts — updates the select in place so the report's Result tracks it.
function pmiAutoVerdicts(){
  if(!_pmiSurvey || typeof _ovItems === 'undefined' || !Array.isArray(_ovItems)) return;
  var mode = _pmiSurvey.mode;
  (_pmiSurvey.components || []).forEach(function(c, i){
    var verdict = pmiComponentVerdict(c, mode) || '';
    if(_ovItems[i]) _ovItems[i].verdict = verdict;
    var sel = el('it-' + i + '-verdict');
    if(sel && sel.value !== verdict){
      sel.value = verdict;
      if(typeof ovVerdictStyle === 'function'){ sel.style.cssText = 'width:100%;height:32px;box-sizing:border-box;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);color:var(--t1);font-family:var(--font);' + ovVerdictStyle(verdict); }
    }
  });
}
// Add a component (and a matching Examination-details line) from the survey side.
function pmiAddComponent(){
  pmiReadGrid();
  if(typeof ovPmiAddItem === 'function') ovPmiAddItem();
  else if(_pmiSurvey && _pmiSurvey.components) _pmiSurvey.components.push(_pmiBlankComponent());
  pmiSyncComponents();
  pmiRebuildGrid();
}
// Remove a component (and its Examination-details line).
function pmiRemoveComponent(wi){
  pmiReadGrid();
  if(!_pmiSurvey || !_pmiSurvey.components || _pmiSurvey.components.length <= 1) return;
  _pmiSurvey.components.splice(wi, 1);
  if(typeof ovPmiRemoveItem === 'function') ovPmiRemoveItem(wi);
  pmiSyncComponents();
  pmiRebuildGrid();
}
// Toggle technique (XRF ↔ OES). Both modes are multi-component, so no item-table
// restructure — just re-derive carbon measurability + refresh the locked verdicts.
function pmiSetMode(sel){
  sel = sel || el('pmi-mode'); if(!sel) return;
  pmiReadGrid();
  _pmiSurvey.mode = sel.value === 'oes' ? 'oes' : 'xrf';
  pmiRebuildGrid();
  pmiAutoVerdicts();
}
// Specified-grade change for one point → re-derive its element inputs,
// preserving any readings for elements the new grade still controls.
function pmiGradeChange(sel){
  if(!sel) return;
  var wi = parseInt(sel.getAttribute('data-pmi-comp'), 10) || 0;
  var pi = parseInt(sel.getAttribute('data-pmi-pt'), 10) || 0;
  pmiReadGrid();
  var comp = _pmiSurvey && _pmiSurvey.components[wi];
  if(comp && comp.points && comp.points[pi]) comp.points[pi].grade = sel.value;
  pmiRebuildGrid();
  pmiAutoVerdicts();
}
// Measurement-mode change for one component (single ↔ 3-point) → rebuild its
// points, preserving overlapping readings (see _pmiPointsForMode).
function pmiSetMeasMode(sel){
  if(!sel) return;
  var wi = parseInt(sel.getAttribute('data-pmi-comp'), 10) || 0;
  pmiReadGrid();
  var comp = _pmiSurvey && _pmiSurvey.components[wi];
  if(comp){ var mm = sel.value === '3point' ? '3point' : 'single'; comp.measMode = mm; comp.points = _pmiPointsForMode(mm, comp.points); }
  pmiRebuildGrid();
  pmiAutoVerdicts();
}

// called by ovSaveReport for PMI reports
function pmiCollect(){ pmiReadGrid(); pmiSyncComponents(); pmiAutoVerdicts(); return _pmiSurvey ? JSON.parse(JSON.stringify(_pmiSurvey)) : null; }

// ── default template seeding ─────────────────────────────────────────────────
// Ensure the PMI report template is a COMPLETE report (standard header/fields/
// result layout, like every other method) plus a dedicated material-verification
// page (method card + results card), so PMI reports aren't a bare survey.
function _pmiNid(){ return (typeof _cvBlockId === 'function') ? _cvBlockId() : ('pmi-' + Math.random().toString(36).slice(2,9)); }
// Swap the single-value Subject-information cards for an Examination-details
// items-table so a multi-component PMI report lists every component.
function _pmiReplaceSubjectWithItems(blocks){
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
  kept.push({ id:_pmiNid(), key:'items-table', isLayout:true, x:20, y:top, w:754, h:itH, showBorder:false, fontSize:'8.5px' });
  kept.sort(function(a,b){ return (a.y || 0) - (b.y || 0); });
  return kept;
}
function _pmiPage1Blocks(){ return _pmiReplaceSubjectWithItems((typeof cvDefaultLayoutBlocks === 'function') ? cvDefaultLayoutBlocks() : []); }
function _pmiSurveyPage(){
  return { label:'Material verification', blocks:[
    { id:_pmiNid(), key:'pmi-method', isLayout:true, x:20, y:20,  w:754, h:300, showBorder:true, borderColor:'#dddddd' },
    { id:_pmiNid(), key:'pmi-survey', isLayout:true, x:20, y:332, w:754, h:760, showBorder:true, borderColor:'#dddddd' },
  ] };
}
function pmiSeedTemplateBlock(){
  try {
    var PFX = (typeof CV_METHOD_TPL_PREFIX !== 'undefined') ? CV_METHOD_TPL_PREFIX : 'vx-method-tpl-';
    var KEY = PFX + 'PMI';
    var FLAG = 'vx-pmi-tpl-seeded-v1';
    if(localStorage.getItem(FLAG)) return;
    var tpl = ls(KEY, null);
    var pages = (tpl && Array.isArray(tpl.pages)) ? tpl.pages : [];
    var allBlocks = pages.reduce(function(a,p){ return a.concat(p.blocks||[]); }, []);
    var hasSurvey = allBlocks.some(function(b){ return b && (b.key === 'pmi-survey' || b.key === 'pmi-method'); });
    var nonSurvey = allBlocks.filter(function(b){ return b && b.key !== 'pmi-survey' && b.key !== 'pmi-method'; }).length;
    if(hasSurvey){ localStorage.setItem(FLAG, '1'); return; }
    if(nonSurvey === 0){
      var page1 = _pmiPage1Blocks();
      var newPages = page1.length ? [ { label:'Report', blocks:page1 }, _pmiSurveyPage() ] : [ _pmiSurveyPage() ];
      lss(KEY, { pages:newPages, nextId:(allBlocks.length + page1.length + 6), savedAt:new Date().toISOString() });
    } else {
      // Real custom layout but no PMI cards → append a survey page, leave the rest.
      tpl.pages.push(_pmiSurveyPage());
      tpl.nextId = (tpl.nextId || allBlocks.length) + 3;
      lss(KEY, tpl);
    }
    localStorage.setItem(FLAG, '1');
  } catch(e){ console.warn('pmiSeedTemplateBlock failed', e); }
}
window.addEventListener('DOMContentLoaded', function(){ try { pmiSeedTemplateBlock(); } catch(e){} });

// ── Dispatch registration — see vxActions in js/constants.js.
// Object shorthand keeps each data-action name tied to its function, so a
// rename that misses one is a no-undef error rather than a dead control.
vxActions({
  pmiAddComponent, pmiEntryChanged, pmiGradeChange, pmiRemoveComponent,
  pmiSetMeasMode, pmiSetMode,
});
