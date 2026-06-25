// ═══════════════════════════════════════════════════════════════════════════
// ACCEPTANCE CRITERIA — surface (MT/PT/VT) + volumetric (UT) threshold lookup
// ═══════════════════════════════════════════════════════════════════════════
// Phase-1 AI-assisted reporting, Part 2. Pure logic — NO DOM. The editor wires
// this into the finding-entry form (resolve a threshold, classify the measured
// dimension PASS / BORDERLINE / REJECT) and renders it inline. Kept DOM-free so
// it can be unit-tested and reused by the PDF / AI-review paths later.
//
// ─────────────────────────────────────────────────────────────────────────
// ⚠ COMPLIANCE NOTE — READ BEFORE RELYING ON A DISPOSITION
// The seed thresholds below are the canonical published values for each clause,
// transcribed here with the clause cited on every rule (rule.source). They are
// a decision AID, not the controlled standard. Acceptance values, SI rounding,
// and the applicable EN ISO acceptance LEVEL (set by the application standard,
// e.g. EN ISO 5817 quality level → 23278/23277 acceptance level) must be
// verified against your controlled copy of the standard before an inspector
// relies on the verdict. Every rule carries `verified` — rules I could not
// transcribe with high confidence are flagged verified:false so the UI can warn.
// The inspector remains the authority; this never seals or auto-dispositions.
// ─────────────────────────────────────────────────────────────────────────

var VX_ACCEPTANCE_DISCLAIMER =
  'Decision aid only. Thresholds are transcribed from the cited clause and must ' +
  'be verified against the controlled standard. The inspector is the authority.';

// BORDERLINE band: a measured dimension within this fraction below the limit.
// "Within 10% of the rejection limit" → dim ∈ [0.9·limit, limit].
var VX_ACCEPTANCE_BORDERLINE_FRAC = 0.10;

// Indication types that are categorically not permitted by surface/volumetric
// acceptance standards regardless of size — planar/crack-like flaws. These map
// to REJECT with no threshold comparison.
var VX_ACCEPTANCE_ALWAYS_REJECT = new Set([
  'crack', 'lack-of-fusion', 'lack-of-penetration', 'lamination', 'lap',
]);

// ── Rule table ─────────────────────────────────────────────────────────────
// One row per (standard family, method, indication geometry, EN ISO level).
//   code            'ASME' | 'EN-ISO'
//   method          'MT' | 'PT' | 'VT' | 'UT'
//   materialGroup   '*' (any) or a specific group key; specific wins on match
//   indicationType  'linear' | 'rounded' (governing geometry after normalise)
//   level           EN ISO acceptance level (1|2|3); omit/null for ASME
//   maxAcceptableMm number  — largest acceptable governing dimension (mm), OR
//                   function(thicknessMm) → number for thickness-dependent limits
//   tMinMm / tMaxMm optional thickness band the rule applies to (inclusive min,
//                   exclusive max); omitted = all thicknesses
//   source          human-readable clause citation, shown in the UI
//   note            short plain-language reason
//   verified        true only where transcribed with high confidence
var VX_ACCEPTANCE_RULES = [
  // ── ASME — surface methods (Section VIII Div.1 mandatory appendices) ──────
  // MT: Appendix 6; PT: Appendix 8. Same acceptance wording: surfaces shall be
  // free of relevant LINEAR indications (relevant = >1/16 in ≈ 1.5 mm), and
  // ROUNDED indications > 3/16 in (5 mm). Linear = length ≥ 3 × width.
  { code:'ASME', method:'MT', materialGroup:'*', indicationType:'linear',  maxAcceptableMm:1.5,
    source:'ASME VIII Div.1, Mand. App. 6-4', note:'relevant linear indication (>1/16 in) not permitted', verified:true },
  { code:'ASME', method:'MT', materialGroup:'*', indicationType:'rounded', maxAcceptableMm:5.0,
    source:'ASME VIII Div.1, Mand. App. 6-4', note:'rounded indication > 3/16 in (5 mm) not permitted', verified:true },
  { code:'ASME', method:'PT', materialGroup:'*', indicationType:'linear',  maxAcceptableMm:1.5,
    source:'ASME VIII Div.1, Mand. App. 8-4', note:'relevant linear indication (>1/16 in) not permitted', verified:true },
  { code:'ASME', method:'PT', materialGroup:'*', indicationType:'rounded', maxAcceptableMm:5.0,
    source:'ASME VIII Div.1, Mand. App. 8-4', note:'rounded indication > 3/16 in (5 mm) not permitted', verified:true },
  // VT: ASME has no single dimensional surface-VT standard independent of the
  // construction code; weld VT typically references ASME VIII UW-35/Table or
  // the referencing code. Left to EN ISO 17637 (below) which IS dimensional.

  // ── EN ISO — surface methods, acceptance LEVELS (default level 2) ─────────
  // MT — EN ISO 23278:2015, Table 1. l = indication length (linear), d =
  // diameter (non-linear/rounded). Levels 1/2/3 selected by application std.
  { code:'EN-ISO', method:'MT', materialGroup:'*', indicationType:'linear',  level:1, maxAcceptableMm:1.5,
    source:'EN ISO 23278:2015, Table 1 (level 1)', note:'linear l ≤ 1.5 mm', verified:true },
  { code:'EN-ISO', method:'MT', materialGroup:'*', indicationType:'linear',  level:2, maxAcceptableMm:3.0,
    source:'EN ISO 23278:2015, Table 1 (level 2)', note:'linear l ≤ 3 mm', verified:true },
  { code:'EN-ISO', method:'MT', materialGroup:'*', indicationType:'linear',  level:3, maxAcceptableMm:6.0,
    source:'EN ISO 23278:2015, Table 1 (level 3)', note:'linear l ≤ 6 mm', verified:true },
  { code:'EN-ISO', method:'MT', materialGroup:'*', indicationType:'rounded', level:1, maxAcceptableMm:2.0,
    source:'EN ISO 23278:2015, Table 1 (level 1)', note:'non-linear d ≤ 2 mm', verified:true },
  { code:'EN-ISO', method:'MT', materialGroup:'*', indicationType:'rounded', level:2, maxAcceptableMm:3.0,
    source:'EN ISO 23278:2015, Table 1 (level 2)', note:'non-linear d ≤ 3 mm', verified:true },
  { code:'EN-ISO', method:'MT', materialGroup:'*', indicationType:'rounded', level:3, maxAcceptableMm:4.0,
    source:'EN ISO 23278:2015, Table 1 (level 3)', note:'non-linear d ≤ 4 mm', verified:true },
  // PT — EN ISO 23277:2015, Table 1. Transcribed but flagged for verification
  // (SI values and non-linear "X" handling vary by edition).
  { code:'EN-ISO', method:'PT', materialGroup:'*', indicationType:'linear',  level:1, maxAcceptableMm:2.0,
    source:'EN ISO 23277:2015, Table 1 (level 1)', note:'linear l ≤ 2 mm', verified:false },
  { code:'EN-ISO', method:'PT', materialGroup:'*', indicationType:'linear',  level:2, maxAcceptableMm:4.0,
    source:'EN ISO 23277:2015, Table 1 (level 2)', note:'linear l ≤ 4 mm', verified:false },
  { code:'EN-ISO', method:'PT', materialGroup:'*', indicationType:'linear',  level:3, maxAcceptableMm:8.0,
    source:'EN ISO 23277:2015, Table 1 (level 3)', note:'linear l ≤ 8 mm', verified:false },
  { code:'EN-ISO', method:'PT', materialGroup:'*', indicationType:'rounded', level:1, maxAcceptableMm:4.0,
    source:'EN ISO 23277:2015, Table 1 (level 1)', note:'non-linear d ≤ 4 mm', verified:false },
  { code:'EN-ISO', method:'PT', materialGroup:'*', indicationType:'rounded', level:2, maxAcceptableMm:6.0,
    source:'EN ISO 23277:2015, Table 1 (level 2)', note:'non-linear d ≤ 6 mm', verified:false },
  { code:'EN-ISO', method:'PT', materialGroup:'*', indicationType:'rounded', level:3, maxAcceptableMm:8.0,
    source:'EN ISO 23277:2015, Table 1 (level 3)', note:'non-linear d ≤ 8 mm', verified:false },
  // VT — EN ISO 17637 references the weld imperfection limits of EN ISO 5817.
  // Common acceptance: imperfection sizing per 5817 quality level B/C/D ≈ ISO
  // level 1/2/3. Seeded as indicative linear/rounded caps; verify per 5817.
  { code:'EN-ISO', method:'VT', materialGroup:'*', indicationType:'linear',  level:2, maxAcceptableMm:3.0,
    source:'EN ISO 17637 / EN ISO 5817 (quality C)', note:'indicative — verify per EN ISO 5817 imperfection limits', verified:false },
  { code:'EN-ISO', method:'VT', materialGroup:'*', indicationType:'rounded', level:2, maxAcceptableMm:3.0,
    source:'EN ISO 17637 / EN ISO 5817 (quality C)', note:'indicative — verify per EN ISO 5817 imperfection limits', verified:false },

  // ── UT — volumetric, thickness-dependent length limits ────────────────────
  // ASME amplitude-based UT (Section V Art.4 detection; Section VIII Div.1
  // acceptance, App. 12 / UW-53): an indication exceeding the DAC reference is
  // unacceptable if its length exceeds:  6 mm (1/4 in) for t ≤ 19 mm;  t/3 for
  // 19 < t ≤ 57 mm;  19 mm (3/4 in) for t > 57 mm. The measured "dimension"
  // here is the indication LENGTH (amplitude over reference assumed by entry).
  { code:'ASME', method:'UT', materialGroup:'*', indicationType:'linear',
    maxAcceptableMm: function(t){ var th = (t > 0) ? t : 0;
      if(th <= 19) return 6.0; if(th <= 57) return th/3; return 19.0; },
    source:'ASME VIII Div.1, App. 12 / UW-53 (amplitude > DAC)', note:'length limit varies with wall thickness', verified:true },
  // EN ISO 11666 (UT acceptance levels 2/3) — length limits relative to the
  // reference level, thickness-banded. Transcribed simplified; verify per the
  // controlled standard and the evaluation level in use.
  { code:'EN-ISO', method:'UT', materialGroup:'*', indicationType:'linear', level:2,
    maxAcceptableMm: function(t){ var th = (t > 0) ? t : 0; return th < 15 ? 10.0 : (th <= 100 ? th * 0.5 : 50.0); },
    source:'EN ISO 11666 (acceptance level 2)', note:'length limit relative to wall thickness — verify', verified:false },
  { code:'EN-ISO', method:'UT', materialGroup:'*', indicationType:'linear', level:3,
    maxAcceptableMm: function(t){ var th = (t > 0) ? t : 0; return th < 15 ? 15.0 : (th <= 100 ? th * 0.75 : 75.0); },
    source:'EN ISO 11666 (acceptance level 3)', note:'length limit relative to wall thickness — verify', verified:false },
];

// ── Normalisation helpers ────────────────────────────────────────────────

// Map the free-text "code" / acceptance-criteria string to a family key.
// Anything mentioning ASME/ASTM → 'ASME'; EN/ISO/DIN/NEN → 'EN-ISO'.
function vxAcceptanceNormalizeCode(s){
  var v = String(s || '').toUpperCase();
  if(/ASME|ASTM|\bAPI\b/.test(v)) return 'ASME';
  if(/EN[\s-]?ISO|\bISO\b|\bEN\b|\bDIN\b|\bNEN\b|\bBS\b/.test(v)) return 'EN-ISO';
  return null; // unknown family → cannot resolve, surfaces as UNKNOWN
}

// Map a free-text defect type to its governing geometry / disposition class.
// Returns 'crack' | 'lack-of-fusion' | … (always-reject) | 'linear' | 'rounded'
// | 'unknown'. Order matters: planar/crack-like checks first.
function vxAcceptanceNormalizeType(s){
  var v = String(s || '').toLowerCase().trim();
  if(!v) return 'unknown';
  if(/\bcrack|crazing|hot tear|cold crack|stress\b/.test(v)) return 'crack';
  if(/lack of fusion|\blof\b|incomplete fusion/.test(v)) return 'lack-of-fusion';
  if(/lack of penetration|incomplete penetration|\blop\b|lack of root/.test(v)) return 'lack-of-penetration';
  if(/lamination|laminar/.test(v)) return 'lamination';
  if(/\blap\b/.test(v)) return 'lap';
  // Rounded / volumetric-pore geometry.
  if(/round|porosit|gas pore|blow ?hole|globular|spherical|isolated pore|\bpore\b/.test(v)) return 'rounded';
  // Linear / elongated geometry (slag, undercut, elongated inclusion…).
  if(/linear|elongat|slag|undercut|inclusion|groove|scratch|seam|streak|indication/.test(v)) return 'linear';
  return 'unknown';
}

// Pull the governing numeric dimension (mm) from a free-text size string.
// "L=15, W=2" / "15 x 2 mm" / "Ø4" / "12mm" → the largest number present,
// which is the length for linear and the diameter for rounded. Returns null if
// no number is found. (Inch values are not auto-converted — entry is mm.)
function vxAcceptanceParseDimension(s){
  var nums = String(s == null ? '' : s).match(/\d+(?:[.,]\d+)?/g);
  if(!nums || !nums.length) return null;
  var vals = nums.map(function(n){ return parseFloat(n.replace(',', '.')); })
                 .filter(function(n){ return isFinite(n); });
  if(!vals.length) return null;
  return Math.max.apply(null, vals);
}

// ── Resolution ─────────────────────────────────────────────────────────────
// input: { code, method, materialGroup, thicknessMm, indicationType, level }
//   code/method/indicationType may be raw free text — normalised here.
//   level defaults to 2 (the common EN ISO acceptance level) when applicable.
// Returns the best-matching rule with its limit resolved to a number, or null.
function vxAcceptanceResolve(input){
  input = input || {};
  var code   = vxAcceptanceNormalizeCode(input.code);
  var method = String(input.method || '').toUpperCase().trim();
  var type   = vxAcceptanceNormalizeType(input.indicationType);
  var matGrp = input.materialGroup || '*';
  var tMm    = (input.thicknessMm != null && isFinite(input.thicknessMm)) ? Number(input.thicknessMm) : null;
  var level  = (input.level != null) ? Number(input.level) : 2;

  if(!code || !method) return null;
  // Always-reject types resolve without a dimensional rule.
  if(VX_ACCEPTANCE_ALWAYS_REJECT.has(type)){
    return { alwaysReject:true, indicationType:type, code:code, method:method,
             source:(code === 'ASME' ? 'ASME — planar/crack-like flaw not permitted'
                                     : 'EN ISO — planar/crack-like flaw not permitted'),
             note:'planar / crack-like indications are not permitted regardless of size' };
  }
  if(type !== 'linear' && type !== 'rounded') return null; // unknown geometry

  var candidates = VX_ACCEPTANCE_RULES.filter(function(r){
    if(r.code !== code || r.method !== method || r.indicationType !== type) return false;
    if(r.level != null && r.level !== level) return false;
    // Material group: a group-specific rule only applies to its group; '*' is
    // the catch-all that always applies.
    if(r.materialGroup && r.materialGroup !== '*' && r.materialGroup !== matGrp) return false;
    // Thickness band (if the rule declares one).
    if(r.tMinMm != null && (tMm == null || tMm < r.tMinMm)) return false;
    if(r.tMaxMm != null && (tMm == null || tMm >= r.tMaxMm)) return false;
    return true;
  });
  if(!candidates.length) return null;
  // Prefer a material-group-specific rule over the '*' fallback.
  candidates.sort(function(a, b){
    var as = (a.materialGroup && a.materialGroup !== '*') ? 0 : 1;
    var bs = (b.materialGroup && b.materialGroup !== '*') ? 0 : 1;
    return as - bs;
  });
  var rule = candidates[0];

  var limit = (typeof rule.maxAcceptableMm === 'function')
    ? rule.maxAcceptableMm(tMm) : rule.maxAcceptableMm;
  if(!isFinite(limit)) return null;

  return {
    rule: rule,
    code: code,
    method: method,
    indicationType: type,
    level: (rule.level != null) ? rule.level : null,
    maxAcceptableMm: limit,
    thicknessDependent: (typeof rule.maxAcceptableMm === 'function'),
    source: rule.source,
    note: rule.note,
    verified: rule.verified !== false,
  };
}

// ── Classification ───────────────────────────────────────────────────────
// Classify a measured dimension against the resolved criteria.
// dimensionMm: number (mm) OR a free-text size string (parsed).
// input: same shape as vxAcceptanceResolve.
// Returns { verdict, threshold, source, note, reason, level, verified,
//           dimensionMm, alwaysReject }.
//   verdict ∈ 'PASS' | 'BORDERLINE' | 'REJECT' | 'UNKNOWN'
//   UNKNOWN = no rule resolved or no measurable dimension; never fabricated.
function vxAcceptanceClassify(dimensionMm, input){
  var resolved = vxAcceptanceResolve(input);

  // Planar / crack-like — rejected regardless of dimension.
  if(resolved && resolved.alwaysReject){
    return { verdict:'REJECT', threshold:null, source:resolved.source, note:resolved.note,
             reason:resolved.note, level:null, verified:true, dimensionMm:null, alwaysReject:true };
  }
  if(!resolved){
    return { verdict:'UNKNOWN', threshold:null, source:null,
             reason:'No acceptance rule for this code / method / indication type.',
             level:null, verified:false, dimensionMm:null };
  }

  var dim = (typeof dimensionMm === 'number') ? dimensionMm : vxAcceptanceParseDimension(dimensionMm);
  if(dim == null || !isFinite(dim)){
    return { verdict:'UNKNOWN', threshold:resolved.maxAcceptableMm, source:resolved.source,
             note:resolved.note, reason:'No measurable dimension entered.',
             level:resolved.level, verified:resolved.verified, dimensionMm:null };
  }

  var limit = resolved.maxAcceptableMm;
  var verdict;
  if(dim > limit)                                           verdict = 'REJECT';
  else if(dim >= limit * (1 - VX_ACCEPTANCE_BORDERLINE_FRAC)) verdict = 'BORDERLINE';
  else                                                       verdict = 'PASS';

  var reason;
  if(verdict === 'REJECT')      reason = dim.toFixed(2) + ' mm exceeds the ' + limit.toFixed(2) + ' mm limit.';
  else if(verdict === 'BORDERLINE') reason = dim.toFixed(2) + ' mm is within 10% of the ' + limit.toFixed(2) + ' mm limit.';
  else                          reason = dim.toFixed(2) + ' mm is within the ' + limit.toFixed(2) + ' mm limit.';

  return {
    verdict: verdict,
    threshold: limit,
    source: resolved.source,
    note: resolved.note,
    reason: reason,
    level: resolved.level,
    verified: resolved.verified,
    thicknessDependent: resolved.thicknessDependent,
    dimensionMm: dim,
    alwaysReject: false,
  };
}

// ── Optional self-test (called from tests.js / console) ──────────────────
// Returns { pass, results[] }. Keeps the seed table honest after edits.
function vxAcceptanceSelfTest(){
  var cases = [
    // ASME MT linear: limit 1.5 mm.
    { args:[3.0, {code:'ASME', method:'MT', indicationType:'linear'}],            want:'REJECT' },
    { args:[1.45, {code:'ASME', method:'MT', indicationType:'linear'}],           want:'BORDERLINE' }, // ≥1.35
    { args:[1.0, {code:'ASME', method:'MT', indicationType:'linear'}],            want:'PASS' },
    // EN ISO MT rounded level 2: limit 3 mm.
    { args:[2.0, {code:'EN ISO 23278', method:'MT', indicationType:'rounded'}],   want:'PASS' },
    { args:[3.5, {code:'EN ISO 23278', method:'MT', indicationType:'rounded'}],   want:'REJECT' },
    // Crack: always reject.
    { args:[0.1, {code:'ASME', method:'MT', indicationType:'crack'}],             want:'REJECT' },
    // UT thickness-dependent (ASME): t=10 → 6 mm limit; t=30 → 10 mm limit.
    { args:[5.0,  {code:'ASME', method:'UT', indicationType:'linear', thicknessMm:10}], want:'PASS' },
    { args:[8.0,  {code:'ASME', method:'UT', indicationType:'linear', thicknessMm:10}], want:'REJECT' },
    { args:[8.0,  {code:'ASME', method:'UT', indicationType:'linear', thicknessMm:30}], want:'PASS' },       // limit 10, < 9
    { args:[9.0,  {code:'ASME', method:'UT', indicationType:'linear', thicknessMm:30}], want:'BORDERLINE' }, // limit 10, = 0.9·limit
    // Unknown family / geometry → UNKNOWN.
    { args:[2.0, {code:'', method:'MT', indicationType:'linear'}],                want:'UNKNOWN' },
    { args:[2.0, {code:'ASME', method:'MT', indicationType:'mystery'}],           want:'UNKNOWN' },
    // Parse from free-text size string.
    { args:['L=15, W=2 mm', {code:'ASME', method:'MT', indicationType:'linear'}], want:'REJECT' },
  ];
  var results = cases.map(function(c){
    var got = vxAcceptanceClassify(c.args[0], c.args[1]).verdict;
    return { input:c.args, want:c.want, got:got, ok:(got === c.want) };
  });
  var pass = results.every(function(r){ return r.ok; });
  if(!pass && typeof console !== 'undefined'){
    console.warn('[acceptance] self-test FAILED', results.filter(function(r){ return !r.ok; }));
  }
  return { pass:pass, results:results };
}

// Expose on window for the editor / tests (app convention: globals, no modules).
if(typeof window !== 'undefined'){
  window.vxAcceptanceResolve        = vxAcceptanceResolve;
  window.vxAcceptanceClassify       = vxAcceptanceClassify;
  window.vxAcceptanceNormalizeType  = vxAcceptanceNormalizeType;
  window.vxAcceptanceNormalizeCode  = vxAcceptanceNormalizeCode;
  window.vxAcceptanceParseDimension = vxAcceptanceParseDimension;
  window.vxAcceptanceSelfTest       = vxAcceptanceSelfTest;
  window.VX_ACCEPTANCE_RULES        = VX_ACCEPTANCE_RULES;
  window.VX_ACCEPTANCE_DISCLAIMER   = VX_ACCEPTANCE_DISCLAIMER;
}
