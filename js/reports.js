// ══════════════════════════════════════════════
// REPORT TEMPLATES
// ══════════════════════════════════════════════
var TPL_KEY = 'vx-templates-v1';
var RPT_KEY = 'vx-rptforms-v1';
// Per-field option overrides — populated when the user uses the + / −
// buttons on a dropdown in Settings → Report templates. Shape:
//   { "common.spec": ["EN-ISO …", "Custom A"], "UT.coup": [...] }
// "common" covers TPL_FIELDS._common entries (shared across methods); the
// methodId prefix scopes overrides to that method's tab. tplEffectiveOptions
// merges this on top of TPL_FIELDS defaults so the rendered dropdown
// reflects whatever the admin has curated.
var TPL_OPTS_KEY = 'vx-tpl-field-options-v1';
var _tplData = {};
var _rptForms = {};
var _tplFieldOpts = {};
var _tplActiveMethod = null;
var _tplView = 'defaults'; // 'defaults' | 'form'

function loadTemplates() {
  _tplData = ls(TPL_KEY, {});
  _rptForms = ls(RPT_KEY, {});
  _tplFieldOpts = ls(TPL_OPTS_KEY, {});
}
function saveTemplates() { lss(TPL_KEY, _tplData); }
function saveRptForms()  { lss(RPT_KEY, _rptForms); }
function saveTplFieldOpts() { lss(TPL_OPTS_KEY, _tplFieldOpts); }

// Resolve which scope a TPL_FIELDS entry belongs to: 'common' for
// _common shared fields, the methodId for method-specific fields, or
// null if not found (in which case overrides don't apply). The
// new-report form renames equipment fields to "eq_${id}" when rendering
// the Equipment & parameters section, so strip that prefix before
// matching against TPL_FIELDS so a single override list serves both
// the templates editor and the live report form.
function _tplFieldScope(methodId, fieldId) {
  const id = (typeof fieldId === 'string' && fieldId.startsWith('eq_')) ? fieldId.slice(3) : fieldId;
  if((TPL_FIELDS._common || []).some(f => f.id === id)) return { scope:'common', id };
  if((TPL_FIELDS[methodId] || []).some(f => f.id === id)) return { scope:methodId, id };
  return null;
}

// Effective option list for a (methodId, field) pair. Returns the stored
// override list when one exists; otherwise the field's hard-coded
// defaults. Always returns a fresh array — callers may mutate.
function tplEffectiveOptions(methodId, field) {
  if(!field) return [];
  const m = _tplFieldScope(methodId, field.id);
  if(m) {
    const store = (typeof _tplFieldOpts === 'object' && _tplFieldOpts) ? _tplFieldOpts : ls(TPL_OPTS_KEY, {});
    const custom = store[m.scope + '.' + m.id];
    if(Array.isArray(custom)) return custom.slice();
  }
  return Array.isArray(field.options) ? field.options.slice() : [];
}

// Snapshot a <select>'s current option list and persist it as the
// override for that field. Called after selAddOption / selDelOption
// updates the DOM so the change survives a re-render. selId is the
// rendered field id (`tpl-${methodId}-${fieldId}` for the templates
// editor); we no-op for selects in other parts of the UI.
function tplPersistFieldOpts(selId) {
  if(typeof selId !== 'string' || !selId.startsWith('tpl-')) return;
  const rest = selId.slice(4);
  const dash = rest.indexOf('-');
  if(dash < 0) return;
  const methodId = rest.slice(0, dash);
  const fieldId  = rest.slice(dash + 1);
  const m = _tplFieldScope(methodId, fieldId);
  if(!m) return;
  const sel = (typeof el === 'function' ? el(selId) : document.getElementById(selId));
  if(!sel) return;
  // The "— Select —" placeholder has value="" and is not part of the
  // editable option list — drop it before snapshotting.
  const opts = Array.from(sel.options)
    .filter(o => o.value !== '')
    .map(o => o.text);
  if(!_tplFieldOpts || typeof _tplFieldOpts !== 'object') _tplFieldOpts = ls(TPL_OPTS_KEY, {});
  _tplFieldOpts[m.scope + '.' + m.id] = opts;
  saveTplFieldOpts();
}

var TPL_FIELDS = {
  // _common is intentionally empty: specification and acceptance criteria
  // are now defined per NDT method (each method has its own dropdown
  // list) so the standards listed match the technique. Procedure no.
  // and NDT equipment moved to the smart place cards (procedure-link /
  // equipment / calib-status) — see Settings → NDT procedures and
  // Settings → Equipment.
  _common: [],
  UT: [
    { id:'spec',  label:'Default specification',      placeholder:'e.g. EN-ISO 17640:2018', options:['EN-ISO 17640:2018','EN-ISO 22825:2017','EN-ISO 16809:2019','ASME BPVC Sec. V, Art. 4 — 2025 Edition','ASME BPVC Sec. V, Art. 5 — 2025 Edition','AWS D1.1/D1.1M:2025, Clause 8 (Part E)','ISO 17640:2018 via NORSOK M-101 (Ed. 6, 2022)'] },
    { id:'acc',   label:'Default acceptance criteria', placeholder:'e.g. EN-ISO 11666:2018 Level 2', options:['EN-ISO 11666:2018 Level 1','EN-ISO 11666:2018 Level 2','EN-ISO 11666:2018 Level 3','EXC 1','EXC 2','EXC 3','EXC 4','ASME B31.3-2024, para. 344.6 / 341.3.2','ASME VIII Div. 1, Mandatory App. 12 — 2025','AWS D1.1/D1.1M:2025 Table 8.2','AWS D1.1/D1.1M:2025 Table 8.3','No cracks'] },
    { id:'coup',  label:'Default couplant',     placeholder:'e.g. Ultragel II', options:['Waterbased','Oil','Ultragel II','Sono 600','Sonagel W','Glycerin'] },
    { id:'freq',  label:'Frequency (MHz)',       placeholder:'e.g. 5', options:['1','1.5','2','2.25','3.5','4','5','7.5','10','15'] },
    { id:'range', label:'Calibration range',     placeholder:'e.g. 0-100mm', options:['0-50mm','0-100mm','0-200mm','0-300mm','0-500mm','25-100mm','50-250mm','100-400mm'] },
    { id:'probe', label:'Default probe',         placeholder:'e.g. MWB 60-4', options:['0°','45°','60°','70°','80°'] },
    { id:'sens',  label:'Sensitivity',           placeholder:'e.g. DAC + 6dB', options:['DAC + 6dB','DAC + Transfer + 6dB','DAC - 6dB','TCG','6 dB drop','20 dB drop'] },
    { id:'refblk',label:'Reference block',       placeholder:'e.g. K1 IIW 1', options:['K1 IIW 1','K2 IIW 2','A2 block','A7 block','Custom SDH block'] },
    { id:'calblk',label:'Calibration block',     placeholder:'e.g. Step wedge', options:['EN-ISO 17640 19mm','EN-ISO 17640 12mm','ASME V SDH block','Step wedge 5-45mm'] },
  ],
  MT: [
    { id:'spec',  label:'Default specification',      placeholder:'e.g. EN-ISO 17638:2016', options:['EN-ISO 17638:2016','EN 1090-2:2018+A1:2024','ASME BPVC Sec. V, Art. 7 — 2025 Edition','AWS D1.1/D1.1M:2025, Clause 8 (Part F)','ISO 17638:2016 via NORSOK M-101 (Ed. 6, 2022)'] },
    { id:'acc',   label:'Default acceptance criteria', placeholder:'e.g. ISO 23278:2015 Level 2', options:['ISO 23278:2015 Level 1','ISO 23278:2015 Level 2','ISO 23278:2015 Level 2X','ISO 23278:2015 Level 3','ISO 23278:2015 Level 3X','EXC 1','EXC 2','EXC 3','EXC 4','ASME B31.3-2024, para. 344.3 / 341.3.2','ASME B31.1-2024, para. 136.4.3','ASME VIII Div. 1, Mandatory App. 6 — 2025','ASME VIII Div. 2, Part 7 (Table 7.16) — 2025','No cracks'] },
    { id:'tech',       label:'Technique',          placeholder:'e.g. Yoke (AC)',        options:['Yoke (AC)','Yoke (DC)','Permanent magnet','Prods','Coil','Central conductor','Bench head shot','Flexible cable wrap'] },
    { id:'mtmethod',   label:'Method',             placeholder:'e.g. Wet fluorescent',  options:['Wet fluorescent','Wet visible (colour contrast)','Dry visible','Dry fluorescent'] },
    { id:'syscontrol', label:'System control',     placeholder:'e.g. > 4,5 kg + ASTM Pie', options:['> 4,5 kg + Dr. Berthold','> 4,5 kg + ASTM Pie','> 4,5 kg + Castrol strip','> 18 kg + Dr. Berthold','> 18 kg + ASTM Pie','> 18 kg + Castrol strip'] },
    { id:'demag',      label:'Demagnetised',       placeholder:'e.g. Yes',              options:['Yes','No','Not required'] },
    { id:'curint',     label:'Current intensity',  placeholder:'e.g. 2-3 Ampere',       options:['2-3 Ampere','15 Ampere'] },
    { id:'cur',        label:'Current',            placeholder:'e.g. AC',               options:['AC','HWDC','FWDC','DC','Permanent magnet'] },
    { id:'susp',       label:'Test suspension',    placeholder:'e.g. Magnaflux 7HF',    options:['Magnaflux 7HF','Magnaflux 14HF','MR Chemie MR 76 S','MR Chemie MR 230','Tiede fluorescent','Ardrox 800/3'] },
    { id:'suspBatch',  label:'Test suspension batch no.', placeholder:'e.g. 24A-0815' },
    { id:'susptype',   label:'Suspension type',    placeholder:'e.g. Fluorescent water-based', options:['Fluorescent water-based','Fluorescent oil-based','Visible black water-based','Visible black oil-based','Visible red water-based','Visible red oil-based','Dry powder black','Dry powder red'] },
    { id:'contrast',   label:'Contrast paint',     placeholder:'e.g. WCP-2',            options:['Magnaflux WCP-2','MR Chemie MR 72','Tiede contrast paint','Ardrox 8901W'] },
    { id:'contrastBatch',label:'Contrast paint batch no.', placeholder:'e.g. 24C-1102' },
    { id:'lightsource',label:'Light source',       placeholder:'e.g. Daylight, Torch',  options:['Daylight','Torch','Workshop lighting','Halogen lamp','LED lamp','UV-A lamp','White-light lamp'] },
    // Light / UV examination conditions. The white-light lux reading is
    // entered first and gates the meter pickers and the UV-A reading at
    // a single 20-lux threshold: 20 lux or below is a fluorescent
    // inspection (UV-A meter / reading apply); above 20 lux is a visible
    // white-light inspection (white-light meter applies). The other is
    // greyed out.
    { id:'whitelight', label:'White light (lux)',         placeholder:'e.g. 500',  options:['5','10','15','20','50','350','500','1000','1500','2000'], editable:true, numeric:true, gates:'uvirr' },
    { id:'uvmeter',    label:'UV-A light meter',   useEquipmentRegister:true, eqType:'uv-light',    gatedBy:'whitelight', gateMax:20 },
    { id:'lightmeter', label:'White light meter',  useEquipmentRegister:true, eqType:'white-light', gatedBy:'whitelight', gateMin:20 },
    { id:'uvirr',      label:'UV-A irradiance (µW/cm²)',  placeholder:'e.g. 1000', options:['500','800','1000','1200','1500','2000','3000'], editable:true, numeric:true, minWarn:1000, minWarnMsg:'Below the 1000 µW/cm² minimum', gatedBy:'whitelight', gateMax:20 },
  ],
  VT: [
    { id:'spec',  label:'Default specification',      placeholder:'e.g. EN-ISO 17637:2016', options:['EN-ISO 17637:2016','ASME BPVC Sec. V, Art. 9 — 2025 Edition','AWS D1.1/D1.1M:2025, Clause 8 (Part C)','EN 1090-2:2018+A1:2024','ISO 17637:2016 via NORSOK M-101 (Ed. 6, 2022)'] },
    { id:'acc',   label:'Default acceptance criteria', placeholder:'e.g. EN-ISO 5817:2014 Level B', options:['EN-ISO 5817:2014 Level B','EN-ISO 5817:2014 Level C','EN-ISO 5817:2014 Level D','EN-ISO 10042:2018 Level B','EN-ISO 10042:2018 Level C','EXC 1','EXC 2','EXC 3','EXC 4','ASME B31.3-2024, para. 341.3.2','ASME VIII Div. 1, UW-51 / UW-52 — 2025','AWS D1.1/D1.1M:2025 Table 8.1','No cracks'] },
    { id:'lux',  label:'Min. illumination (lux)', placeholder:'e.g. 350', options:['350','500','1000'] },
    { id:'lightsource',label:'Light source',       placeholder:'e.g. Daylight, Torch', options:['Daylight','Torch','Workshop lighting','Halogen lamp','LED lamp','UV-A lamp','White-light lamp'] },
    { id:'magn', label:'Magnification',            placeholder:'e.g. ×2', options:['×1','×2','×3','×5','×10'] },
    { id:'dist', label:'Viewing distance',         placeholder:'e.g. 600 mm max', options:['300 mm max','600 mm max','Direct visual'] },
    { id:'vtequip',label:'Equipment',              placeholder:'e.g. Welding gauge set', options:['Inspection kit','Universal cam gauge','Borescope','Welding gauge set','AWS bridge cam gauge'] },
  ],
  PT: [
    { id:'spec',  label:'Default specification',      placeholder:'e.g. EN-ISO 3452-1:2021', options:['EN-ISO 3452-1:2021','ASME BPVC Sec. V, Art. 6 — 2025 Edition','AWS D1.1/D1.1M:2025, Clause 8 (Part D)','EN 1090-2:2018+A1:2024','ISO 3452-1:2021 via NORSOK M-101 (Ed. 6, 2022)'] },
    { id:'acc',   label:'Default acceptance criteria', placeholder:'e.g. EN-ISO 23277:2015 Level 2', options:['EN-ISO 23277:2015 Level 1','EN-ISO 23277:2015 Level 2','EN-ISO 23277:2015 Level 2X','EN-ISO 23277:2015 Level 3','EN-ISO 23277:2015 Level 3X','EXC 1','EXC 2','EXC 3','EXC 4','ASME B31.3-2024, para. 344.4','ASME VIII Div. 1, Mandatory App. 8 — 2025','No cracks'] },
    // PT type (penetrant type) and PT method (excess penetrant removal)
    // per EN-ISO 3452-1:2021 §4.3 / ASME V Art. 6 T-621. Specs cite the
    // two together — "Type I Method A" — so render them side-by-side at
    // the top of the parameter list.
    { id:'pttype',   label:'PT type',   placeholder:'e.g. Type I — Fluorescent',  options:['Type I — Fluorescent','Type II — Visible (colour contrast)','Type III — Dual sensitivity'] },
    { id:'ptmethod', label:'PT method', placeholder:'e.g. Method A — Water washable', options:['Method A — Water washable','Method B — Post-emulsifiable, lipophilic','Method C — Solvent removable','Method D — Post-emulsifiable, hydrophilic'] },
    // Penetrant sensitivity level per EN-ISO 3452-2:2021 — material is
    // classified against a controlled reference panel. Levels ½ - 4
    // (with ½ the lowest, 4 the highest). Manufacturer publishes the
    // level on the product data sheet.
    { id:'ptsens',   label:'PT sensitivity level', placeholder:'e.g. Level 2 — Medium',  options:['Level ½ — Ultra-low','Level 1 — Low','Level 2 — Medium','Level 3 — High','Level 4 — Ultra-high'] },
    // Pre-cleaner — the procedural step before penetrant application
    // (ISO 3452-1 §6.1 / ASME V Art. 6 T-642). Often the same product
    // line as the post-dwell remover but logged separately so the
    // record reflects the procedure followed.
    { id:'precleaner', label:'Pre-cleaner', placeholder:'e.g. Magnaflux SKC-S', options:['Magnaflux SKC-S','MR Chemie MR 79','Ardrox 9PR5','Solvent wipe','Vapour degrease','Alkaline cleaner','Mechanical clean'] },
    { id:'pen',    label:'Default penetrant',    placeholder:'e.g. Magnaflux ZL4C', options:['Magnaflux ZL4C','Magnaflux ZL-60D','MR Chemie MR 68','Ardrox 970-P22'] },
    { id:'pdwell', label:'Penetrant dwell time', placeholder:'check spec for material — e.g. 10-20 mins', options:['5 mins','5-10 mins','10 mins','10-20 mins','15 mins','20 mins','20-30 mins','30 mins','30-60 mins','45 mins','60 mins'] },
    // Emulsifier dwell time — only applies to Method B (lipophilic) and
    // Method D (hydrophilic). ISO 3452-1 §6.3 / ASME V Art. 6 T-674
    // call for the manufacturer-recommended time, validated by a
    // sensitivity trial. Typical band 30 secs - 3 mins.
    { id:'emulTime', label:'Emulsifier dwell time', placeholder:'Method B / D — e.g. 1-2 mins', options:['15 secs','30 secs','45 secs','1 min','1-2 mins','2 mins','3 mins','5 mins'] },
    // Drying time between excess removal and developer application
    // (ISO 3452-1 §6.5 / ASME V Art. 6 T-676.4). Oven temperature
    // capped at 50°C (ISO) / 71°C (ASME). "Until dry" is a valid
    // record value when no oven is used.
    { id:'dryTime',  label:'Drying time',           placeholder:'e.g. 5-10 mins', options:['Until dry','5 mins','5-10 mins','10 mins','10-15 mins','15 mins','20 mins','30 mins'] },
    { id:'ddwell', label:'Developer dwell time', placeholder:'e.g. 10 mins', options:['7 mins','10 mins','10-20 mins','15 mins','20 mins','30 mins'] },
    { id:'clean',  label:'Cleaner/remover',      placeholder:'e.g. Magnaflux SKC-S', options:['Magnaflux SKC-S','MR Chemie MR 79','Ardrox 9PR5'] },
    { id:'dev',    label:'Developer',            placeholder:'e.g. Magnaflux SKD-S2', options:['Magnaflux SKD-S2','MR Chemie MR 70','Ardrox 9D1B'] },
    { id:'lightsource',label:'Light source',     placeholder:'e.g. Daylight, Torch',  options:['Daylight','Torch','Workshop lighting','Halogen lamp','LED lamp','UV-A lamp','White-light lamp'] },
    // Light / UV examination conditions. The white-light lux reading is
    // entered first and gates the meter pickers and the UV-A reading at
    // a single 20-lux threshold: 20 lux or below is a fluorescent
    // inspection (UV-A meter / reading apply); above 20 lux is a visible
    // white-light inspection (white-light meter applies). The other is
    // greyed out.
    { id:'whitelight', label:'White light (lux)',         placeholder:'e.g. 500',  options:['5','10','15','20','50','350','500','1000','1500','2000'], editable:true, numeric:true, gates:'uvirr' },
    { id:'uvmeter',    label:'UV-A light meter',   useEquipmentRegister:true, eqType:'uv-light',    gatedBy:'whitelight', gateMax:20 },
    { id:'lightmeter', label:'White light meter',  useEquipmentRegister:true, eqType:'white-light', gatedBy:'whitelight', gateMin:20 },
    { id:'uvirr',      label:'UV-A irradiance (µW/cm²)',  placeholder:'e.g. 1000', options:['500','800','1000','1200','1500','2000','3000'], editable:true, numeric:true, minWarn:1000, minWarnMsg:'Below the 1000 µW/cm² minimum', gatedBy:'whitelight', gateMax:20 },
  ],
  PMI:[
    { id:'spec',  label:'Default specification',      placeholder:'e.g. ASTM E1476-20', options:['ASTM E1476-20','ASTM E322-20','API RP 578 (3rd Ed., 2018)','EN 10204:2004','ASME BPVC Sec. II Part A — 2025','ISO 9712:2021 (qualification)'] },
    { id:'acc',   label:'Default acceptance criteria', placeholder:'e.g. Material grade match', options:['Material grade match','Client specification','Project material list','API RP 578 PMI requirements','ASME Sec. II / project ITP','No deviation from WPS material'] },
    { id:'ctrl',label:'System control',placeholder:'e.g. 316L Reference block',options:['316L Reference block','304 Reference block','Duplex reference block','Carbon steel reference block']},
    { id:'mode',label:'Analysis mode',placeholder:'e.g. Alloy ID',options:['Alloy ID','Grade ID','Residuals','Full quantitative']},
    { id:'pmiequip',label:'Equipment',placeholder:'e.g. X-MET 8000',options:['X-MET 8000','Olympus Vanta','Bruker S1 TITAN','Niton XL3t']},
  ],
  HT: [
    { id:'spec',  label:'Default specification',      placeholder:'e.g. EN-ISO 6507-1:2018', options:['EN-ISO 6507-1:2018 (Vickers)','EN-ISO 6506-1:2014 (Brinell)','EN-ISO 6508-1:2016 (Rockwell)','EN-ISO 16859-1:2015 (Leeb)','ASTM E384-22','ASTM E92-23','ASTM E110-22'] },
    { id:'acc',   label:'Default acceptance criteria', placeholder:'e.g. NACE MR0175 / ISO 15156-2', options:['NACE MR0175 / ISO 15156-2','ASME B31.3-2024, para. 331','ASME VIII Div. 1, UW-39 — 2025','AWS D1.1/D1.1M:2025 Clause 6.10','Client specification','Project ITP / WPS'] },
    { id:'scale',label:'Hardness scale',placeholder:'e.g. HV10, HRC',options:['HV10','HV5','HRC','HB','HRB','HL (Leeb)']},
    { id:'method',label:'Test method',placeholder:'e.g. UCI, Rebound',options:['UCI','Rebound (Leeb)','Vickers','Rockwell','Brinell']},
    { id:'htequip',label:'Equipment',placeholder:'e.g. Mic 10',options:['Mic 10','Sonodur 3','Dynamic','Proceq Equotip 550','TH170']},
  ],
  RT: [
    { id:'spec',  label:'Default specification',      placeholder:'e.g. EN-ISO 17636-1:2022', options:['EN-ISO 17636-1:2022','EN-ISO 17636-2:2022','ASME BPVC Sec. V, Art. 2 — 2025 Edition','AWS D1.1/D1.1M:2025, Clause 8 (Part B)','EN 1090-2:2018+A1:2024'] },
    { id:'acc',   label:'Default acceptance criteria', placeholder:'e.g. EN-ISO 10675-1:2016', options:['EN-ISO 10675-1:2016','EN-ISO 10675-2:2017','EXC 1','EXC 2','EXC 3','EXC 4','ASME B31.3-2024, para. 344.5','ASME VIII Div. 1, UW-51 — 2025','ASME VIII Div. 1, UW-52 — 2025','AWS D1.1/D1.1M:2025 Table 8.2','AWS D1.1/D1.1M:2025 Table 8.3','No cracks'] },
    { id:'source',label:'Radiation source',placeholder:'e.g. Ir-192',options:['Ir-192','Se-75','Co-60','X-ray 160kV','X-ray 200kV','X-ray 300kV']},
    { id:'film',label:'Film/detector',placeholder:'e.g. D7',options:['D4 / Kodak MX','D5 / Kodak T200','D7 / Kodak AA400','DR panel','CR plate']},
    { id:'iqitype',label:'IQI type',placeholder:'e.g. Wire EN 462-1',options:['Wire type EN 462-1','Step-hole EN 462-2','ASTM wire penetrameter','ASTM hole penetrameter']},
    { id:'sfd',label:'Source-film distance',placeholder:'e.g. 700 mm',options:['350 mm','500 mm','700 mm','1000 mm']},
  ],
  ET: [
    { id:'spec',  label:'Default specification',      placeholder:'e.g. EN-ISO 17643:2015', options:['EN-ISO 17643:2015','EN-ISO 15549:2019','ASME BPVC Sec. V, Art. 8 — 2025 Edition','ASTM E309-22','ASTM E215-22'] },
    { id:'acc',   label:'Default acceptance criteria', placeholder:'e.g. EN-ISO 17643:2015 (acceptance)', options:['EN-ISO 17643:2015 (acceptance)','ASME B31.3-2024, para. 344.7','ASME VIII Div. 1 — 2025','EXC 1','EXC 2','EXC 3','EXC 4','Client specification','No cracks'] },
    { id:'freq',label:'Test frequency (kHz)',placeholder:'e.g. 100',options:['10','50','100','200','500','1000']},
    { id:'coil',label:'Coil/probe type',placeholder:'e.g. Absolute pencil',options:['Absolute pencil probe','Differential probe','Encircling coil','Sector probe']},
    { id:'ref',label:'Reference standard',placeholder:'e.g. 1.0mm EDM notch',options:['0.5mm EDM notch','1.0mm EDM notch','1.5mm EDM notch','Through-hole 1.0mm']},
  ],
};

// Report form field definitions (common to all methods)
var RPT_FORM = {
  client: [
    { id:'reportNo',  label:'Report no.',       placeholder:'Auto-generated', readonly:true },
    { id:'revision',   label:'Report revision',   placeholder:'00' },
    { id:'client',     label:'Client',             placeholder:'Client name' },
    { id:'project',    label:'Project',            placeholder:'Project name or number' },
    { id:'projectNo',  label:'Project no.',        placeholder:'PRJ-2026-014' },
    { id:'location',   label:'Test location',      placeholder:'Site or facility' },
    { id:'svOrder',    label:'SV Order no.',        placeholder:'SV-XXXX' },
    { id:'orderNo',    label:'Order no.',           placeholder:'Order number' },
    { id:'requestNo',  label:'Request no.',         placeholder:'Request number' },
    { id:'clientRef',  label:'Client reference',    placeholder:'Client reference' },
    { id:'examDate',   label:'Examination date',    placeholder:'dd/mm/yyyy', type:'date' },
  ],
  subject: [
    { id:'subject',    label:'Weld / object',       placeholder:'Pipe, vessel, structure…' },
    { id:'material',   label:'Material',             placeholder:'e.g. Carbon steel, SS316', options:['Carbon steel','Stainless steel 304','Stainless steel 316','Duplex 2205','Super duplex 2507','Inconel 625','CuNi 90/10','Chrome-moly','Aluminium'] },
    { id:'dimensions', label:'Dimensions / thickness',placeholder:'e.g. Ø219.1 × 8.2mm' },
    { id:'weldType',   label:'Weld type / prep',     placeholder:'e.g. Butt weld, Fillet', options:['V-prep','K-prep','½V-prep','Single bevel','Double V','J-prep','Fillet','Square butt','No prep'] },
    { id:'weldProcess',label:'Welding process',      placeholder:'e.g. SMAW, GTAW', options:['SMAW','GTAW','GMAW','FCAW','SAW','SMAW/GTAW','PAW','ESW','OFW'] },
  ],
  // Examination criteria. surfCond / heatTreat were moved here from the
  // Subject section. stage and weldPos carry methodsOnly:['VT'] — they
  // render only on VT reports (and VT method templates).
  exam: [
    { id:'examType',   label:'Examination type',    placeholder:'e.g. Initial', options:['Weld surface examination','Surface examination','Crack examination','Forging examination','Casting examination','Positive Material Identification','Hardness test','Wall thickness measurements','Lamination examination','Ultrasonic examination'] },
    { id:'surfCond',   label:'Surface condition',    placeholder:'e.g. Ground, As-welded', options:['As welded','Machined','Blasted','Painted','Ground','As cast','As forged','Electropolished'] },
    { id:'surfTemp',   label:'Surface temperature',  placeholder:'e.g. 22°C' },
    { id:'heatTreat',  label:'Heat treatment',       placeholder:'e.g. PWHT, As-welded', options:['PWHT','APWHT','n.a.','Before','After'] },
    { id:'stage',      label:'Stage of examination', placeholder:'e.g. Final', methodsOnly:['VT'], options:['Final','In-process','Pre-weld','Post-PWHT','Re-examination'] },
    { id:'weldPos',    label:'Welding position',     placeholder:'e.g. PA (1G)', methodsOnly:['VT'], options:['PA (1G)','PB (2F)','PC (2G)','PD (4F)','PE (4G)','PF (3G up)','PG (3G down)','PH (5G up)','PJ (5G down)','H-V','Overhead'] },
    { id:'procRev',    label:'Procedure revision',   placeholder:'e.g. 01', options:['00','01','02','03','04','05'] },
  ],
  result: [
    { id:'verdict',    label:'Overall verdict',     placeholder:'', type:'select', options:['— Select —','Acceptable','Not acceptable','For information','Inconclusive'] },
    { id:'remarks',    label:'Remarks / observations',placeholder:'Closing remarks…', type:'textarea' },
    { id:'inspector',  label:'Inspector name',      placeholder:'Name of inspector', useInspectorRegister:true },
    { id:'witness',    label:'Witness / 3rd party',  placeholder:'Witness name' },
    { id:'signDate',   label:'Date signed',          placeholder:'dd/mm/yyyy', type:'date' },
  ],
  // Per-item columns for the inspected-items table. Each row is one weld /
  // object inspected under the same report cover. Row 0 mirrors to the
  // top-level report fields (subject, drawing, …) on save so legacy place
  // cards, filters, and CSV exports keep working unchanged.
  items: [
    { id:'subject',     label:'Weld / object',          placeholder:'Pipe, vessel, structure…', width:200 },
    { id:'drawing',     label:'Drawing no.',             placeholder:'OSB-DWG-4420-B',           width:130 },
    { id:'dimensions',  label:'Dimensions / thickness', placeholder:'Ø219.1 × 8.2mm',           width:130 },
    { id:'material',    label:'Material',                placeholder:'e.g. Carbon steel', width:130, options:['Carbon steel','Stainless steel 304','Stainless steel 316','Duplex 2205','Super duplex 2507','Inconel 625','CuNi 90/10','Chrome-moly','Aluminium'] },
    { id:'weldType',    label:'Weld type / prep',        placeholder:'e.g. V-prep',        width:110, options:['V-prep','K-prep','½V-prep','Single bevel','Double V','J-prep','Fillet','Square butt','No prep'] },
    { id:'weldProcess', label:'Welding process',         placeholder:'e.g. SMAW',          width:110, options:['SMAW','GTAW','GMAW','FCAW','SAW','SMAW/GTAW','PAW','ESW','OFW'] },
    { id:'welders',     label:'Welder(s)',               placeholder:'J. Bakker, M. de Vries',  width:150 },
    { id:'examDate',    label:'Examination date',        placeholder:'dd/mm/yyyy', type:'date',  width:120 },
    { id:'extent',      label:'Extent',                  placeholder:'e.g. 100%', width:150, options:['100% Weld and HAZ','100% of the given weld','100% Surface examination','100% of the given surface','As requested by the client'] },
    { id:'verdict',     label:'Result',                  type:'select', width:140, options:['','Acceptable','Not acceptable','For information','Inconclusive'] },
  ],
};
// Field ids that the items table owns. The new-report form filters these
// out of the standalone subject / client sections so the user types each
// value in exactly one place.
var RPT_ITEM_FIELD_IDS = (RPT_FORM.items || []).map(f => f.id);

function tplBuildTabs() {
  const tabs = el('tpl-method-tabs'); if(!tabs) return;
  loadTemplates();
  const methods = getActiveMethods();
  tabs.innerHTML = methods.map((m,i) => `
    <button class="btn btn-sm ${i===0?'btn-primary':''}" id="tpl-tab-${m.id}"
      data-action="tplSelectMethod" data-args="'${m.id}'"
      style="${i===0?'':`border-color:${m.color};color:${m.color}`}">${m.id}</button>
  `).join('');
  if(methods.length) tplSelectMethod(methods[0].id);
}

function tplSelectMethod(methodId) {
  _tplActiveMethod = methodId;
  const m = NDT_METHODS.find(x => x.id === methodId); if(!m) return;
  document.querySelectorAll('[id^="tpl-tab-"]').forEach(b => {
    const mid = b.id.replace('tpl-tab-','');
    const md = NDT_METHODS.find(x => x.id === mid);
    if(mid === methodId) { b.className='btn btn-sm btn-primary'; b.style.cssText=''; }
    else { b.className='btn btn-sm'; b.style.cssText=md?`border-color:${md.color};color:${md.color}`:''; }
  });
  _tplView = 'defaults';
  tplRenderBody(methodId);
}

function tplSwitchView(view) {
  _tplView = view;
  tplRenderBody(_tplActiveMethod);
}

function tplRenderBody(methodId) {
  const body = el('tpl-method-body'); if(!body) return;
  const m = NDT_METHODS.find(x => x.id === methodId); if(!m) return;

  // Sub-tabs
  let html = `<div style="display:flex;border-bottom:2px solid var(--border);margin-bottom:16px">
    <button data-action="tplSwitchView" data-args="'defaults'" style="padding:8px 18px;font-size:12px;font-family:var(--mono);border:none;background:none;cursor:pointer;letter-spacing:.04em;transition:all .15s;margin-bottom:-2px;
      color:${_tplView==='defaults'?'var(--cyan)':'var(--t3)'};border-bottom:2px solid ${_tplView==='defaults'?'var(--cyan)':'transparent'}">⚙ Method defaults</button>
    <button data-action="tplSwitchView" data-args="'form'" style="padding:8px 18px;font-size:12px;font-family:var(--mono);border:none;background:none;cursor:pointer;letter-spacing:.04em;transition:all .15s;margin-bottom:-2px;
      color:${_tplView==='form'?'var(--cyan)':'var(--t3)'};border-bottom:2px solid ${_tplView==='form'?'var(--cyan)':'transparent'}">📋 Blank report form</button>
  </div>`;

  if(_tplView === 'defaults') {
    html += tplRenderDefaults(methodId, m);
  } else {
    html += tplRenderForm(methodId, m);
  }
  body.innerHTML = html;
}

function tplRenderDefaults(methodId, m) {
  const tpl = _tplData[methodId] || {};
  const common = TPL_FIELDS._common;
  const specific = TPL_FIELDS[methodId] || [];
  const allFields = [...common, ...specific];
  const isAdmin = (typeof vxIsAdmin === 'function') ? vxIsAdmin() : true;
  let html = `<div style="border-left:3px solid ${m.color};padding-left:14px;margin-bottom:16px">
    <div style="font-size:15px;font-weight:600;color:${m.color};margin-bottom:2px">${m.id} — ${escapeHtml(m.name)}</div>
    <div style="font-size:12px;color:var(--t3)">Configure default values for ${escapeHtml(m.name)} reports</div>
  </div>`;
  // Admin-only template number. Unique per method; surfaces in the PDF
  // header via the `tpl-number` smart field and is appended to the
  // exported file name. Free-form text — admins type whatever numbering
  // scheme their organisation uses (no prescribed format / tokens).
  html += `<div class="fg form-row" style="margin-bottom:10px">
    <div class="fld">
      <label>Template number <span style="font-size:10px;color:var(--t3);font-weight:400">· admin-only · used in header + filename</span></label>
      <input id="tpl-${methodId}-templateNo" type="text" maxlength="60" placeholder="Type your template / procedure number" value="${escapeHtml(tpl.templateNo||'')}"${isAdmin?'':' disabled title="Admin only" style="opacity:.55;cursor:not-allowed"'}/>
    </div>
    <div></div>
  </div>`;
  for(let i=0;i<allFields.length;i+=2){
    const f1=allFields[i], f2=allFields[i+1];
    html+=`<div class="fg form-row" style="margin-bottom:10px">${tplFieldHtml(methodId,f1,tpl)}${f2?tplFieldHtml(methodId,f2,tpl):''}</div>`;
  }
  html+=`<div class="fld form-row" style="margin-bottom:10px"><label>Standard remarks / closing text</label><textarea id="tpl-${methodId}-remarks" rows="3" placeholder="Default closing text for ${m.id} reports…">${escapeHtml(tpl.remarks||'')}</textarea></div>`;
  html+=`<div style="display:flex;justify-content:flex-end;gap:8px;padding-top:8px;border-top:1px solid var(--border)">
    <button class="btn btn-sm" data-action="tplClear" data-args="'${methodId}'">Reset defaults</button>
    <button class="btn btn-primary btn-sm" data-action="tplSave" data-args="'${methodId}'">Save ${m.id} defaults</button></div>`;
  return html;
}

function tplRenderForm(methodId, m) {
  const f = _rptForms[methodId] || {};
  const tpl = _tplData[methodId] || {};
  // Auto-increment revision if form was previously saved
  if(f._saved && f.revision) {
    const curRev = parseInt(f.revision, 10);
    if(!isNaN(curRev)) {
      f.revision = String(curRev + 1).padStart(2, '0');
      f._saved = false; // Only bump once per load
    }
  }
  let html = `<div style="background:rgba(79,142,247,.08);border:1px solid rgba(79,142,247,.2);border-radius:var(--r);padding:10px 14px;font-size:12px;color:var(--cyan);margin-bottom:16px;display:flex;align-items:flex-start;gap:10px">
    <span style="font-size:16px;flex-shrink:0">📋</span>
    <div>Fill in this form as you would a live <strong>${m.id}</strong> report. Click <strong>Save as template</strong> to pre-fill future reports. The revision number auto-increments when you re-open a saved report.</div>
  </div>`;

  // Section 1: Report revision & Client info
  html += tplFormSection('Report revision & client information', RPT_FORM.client, methodId, f);
  // Examination criteria (common + method-specific from defaults). The
  // standalone Subject section was dropped to match the new-report form —
  // its fields are item-table columns / live in Examination criteria.
  const examFields = [...RPT_FORM.exam];
  // Add method defaults as pre-filled context
  html += tplFormSection('Examination criteria', examFields, methodId, f);

  // Section 4: Method-specific equipment
  const specific = TPL_FIELDS[methodId] || [];
  if(specific.length) {
    const equipFields = specific.map(s => ({...s, id:'eq_'+s.id, label:s.label.replace('Default ','')}));
    html += tplFormSection(`${m.id} — Equipment & parameters`, equipFields, methodId, f);
  }

  // Section 5: Result
  html += tplFormSection('Result & sign-off', RPT_FORM.result, methodId, f);

  html += `<div style="display:flex;justify-content:flex-end;gap:8px;padding-top:12px;border-top:1px solid var(--border)">
    <button class="btn btn-sm" data-action="rptFormClear" data-args="'${methodId}'">Clear form</button>
    <button class="btn btn-primary btn-sm" data-action="rptFormSave" data-args="'${methodId}'">Save as ${m.id} template</button></div>`;
  return html;
}

function tplFormSection(title, fields, methodId, data) {
  // Method-gated fields (def.methodsOnly) render only for their methods.
  fields = fields.filter(f => !f.methodsOnly || f.methodsOnly.includes(methodId));
  let html = `<div class="sc" style="margin-bottom:14px"><div class="sc-head"><span class="sc-title">${title}</span></div><div class="sc-body" style="padding:14px 16px">`;
  for(let i=0;i<fields.length;i+=2){
    const f1=fields[i], f2=fields[i+1];
    html+=`<div class="fg form-row" style="margin-bottom:8px">`;
    html+=rptFieldHtml(methodId,f1,data);
    if(f2) html+=rptFieldHtml(methodId,f2,data);
    html+=`</div>`;
  }
  html+=`</div></div>`;
  return html;
}

function rptFieldHtml(methodId, f, data) {
  const val = data[f.id] || '';
  const fid = `rf-${methodId}-${f.id}`;
  // Equipment-register-backed fields render a method-filtered dropdown
  // sourced live from Settings → Equipment. Out-of-cal items appear in
  // the list but are disabled so the inspector can't pick gear that's
  // out of calibration. Falls back to free text when the register is
  // empty (so the form still works before any equipment is added).
  if(f.useEquipmentRegister) return equipmentSelectHtml(methodId, f, val, fid, data);
  // Inspector-register-backed fields render a dropdown from Settings →
  // Inspectors. An inspector with no certification for the report's
  // method, or an expired one, appears disabled — they can't be
  // selected to sign the report.
  if(f.useInspectorRegister) return inspectorSelectHtml(methodId, f, val, fid);
  if(f.type==='textarea') return `<div class="fld"><label>${f.label}</label><textarea id="${fid}" rows="2" placeholder="${f.placeholder}">${val}</textarea></div>`;
  // Effective option list — when the admin has curated the dropdown via
  // the + / − buttons in Settings → Report templates, those overrides
  // win here too. For RPT_FORM fields (client / exam / result) the
  // lookup falls through to the field's hard-coded defaults.
  const fieldOpts = tplEffectiveOptions(methodId, f);
  // Editable combo — free-typed value with the presets offered as datalist
  // suggestions, so an inspector can enter an exact reading (e.g. 1187)
  // and still pick a common value in one click.
  if(f.editable && fieldOpts.length) {
    const dl = fid + '-dl';
    const opts = fieldOpts.map(o => `<option value="${escapeHtml(o)}"></option>`).join('');
    // Numeric fields (UV-A, white-light) restrict input to numbers and
    // raise a decimal keypad on tablets; non-numeric fields stay free text.
    const numAttrs = f.numeric ? ' type="number" min="0" step="any" inputmode="decimal"' : ' type="text"';
    // Gate target — a field that reads "Not applicable" until its gating
    // field qualifies it (UV-A applies only when white light ≤ gateMax).
    const gateMax = f.gateMax != null ? f.gateMax : 20;
    let gateApplies = true;
    if(f.gatedBy) {
      const gv = parseFloat((data['eq_'+f.gatedBy] != null ? data['eq_'+f.gatedBy] : data[f.gatedBy]) || '');
      gateApplies = !isNaN(gv) && gv <= gateMax;
    }
    // Gate source — drives a target field's applicability (white light
    // gates UV-A). _rptLightGate keeps the target live as the user types.
    const gateAttrs = f.gates ? ' data-on-input="_rptLightGate" data-on-change="_rptLightGate" data-pass-el="1"' : '';
    const gateData  = f.gatedBy ? ` data-gatemax="${gateMax}"` : '';
    // Range flag — fields with a minWarn threshold show an amber warning
    // when the entered reading falls below it (e.g. UV-A < 1000 µW/cm²).
    const numVal = parseFloat(val);
    const low = f.minWarn != null && val !== '' && !isNaN(numVal) && numVal < f.minWarn;
    const warnAttrs = f.minWarn != null
      ? ` data-on-input="_rptRangeCheck" data-on-change="_rptRangeCheck" data-pass-el="1" data-minwarn="${f.minWarn}"`
      : '';
    const warnHtml = f.minWarn != null
      ? `<div class="rpt-range-warn" style="display:${low&&gateApplies?'':'none'};font-size:11px;color:var(--amber);margin-top:3px">⚠ ${escapeHtml(f.minWarnMsg || ('Below the recommended minimum of ' + f.minWarn))}</div>`
      : '';
    const naHtml = f.gatedBy
      ? `<div class="rpt-na" style="display:${gateApplies?'none':'block'};font-size:13px;color:var(--t3);font-style:italic;padding:7px 2px">Not applicable — fluorescent inspection only (≤${gateMax} lux)</div>`
      : '';
    const inpStyle = (low?'border-color:var(--amber);':'') + (f.gatedBy && !gateApplies ? 'display:none' : '');
    return `<div class="fld"><label>${f.label}</label>
      <input id="${fid}" list="${dl}"${numAttrs}${warnAttrs}${gateAttrs}${gateData} value="${escapeHtml(val)}" placeholder="${escapeHtml(f.placeholder||'')}" autocomplete="off"${inpStyle?` style="${inpStyle}"`:''}/>
      <datalist id="${dl}">${opts}</datalist>${warnHtml}${naHtml}</div>`;
  }
  // Dropdown fields on the new-report form are read-only with respect to
  // their option list — inspectors pick from the values defined under
  // Settings → Report templates, and cannot add or remove options here.
  if(f.type==='select') {
    return `<div class="fld"><label>${f.label}</label>
      <select id="${fid}">${fieldOpts.map(o=>`<option${o===val?' selected':''}>${o}</option>`).join('')}</select>
    </div>`;
  }
  if(fieldOpts.length) {
    const opts = fieldOpts.map(o => `<option${o===val?' selected':''}>${o}</option>`).join('');
    return `<div class="fld"><label>${f.label}</label>
      <select id="${fid}"><option value="">— Select —</option>${opts}</select>
    </div>`;
  }
  return `<div class="fld"><label>${f.label}</label><input id="${fid}" type="${f.type||'text'}" value="${val}" placeholder="${f.placeholder||''}" ${f.readonly?'readonly style="color:var(--t3);font-style:italic"':''}/></div>`;
}

// Range flag for editable reading fields. Toggles the amber warning shown
// under a field (and its border colour) when the entered value drops
// below the field's data-minwarn threshold. Wired via data-on-input /
// data-on-change on the input by rptFieldHtml.
function _rptRangeCheck(inp){
  if(!inp) return;
  const min = parseFloat(inp.dataset.minwarn);
  if(isNaN(min)) return;
  const warn = inp.parentElement ? inp.parentElement.querySelector('.rpt-range-warn') : null;
  const v = parseFloat(inp.value);
  const low = inp.value.trim() !== '' && !isNaN(v) && v < min;
  if(warn) warn.style.display = low ? '' : 'none';
  inp.style.borderColor = low ? 'var(--amber)' : '';
}

// Light-mode gate. White light above the threshold (20 lux) means a
// visible white-light inspection, so the UV-A field doesn't apply; at or
// below it the exam is fluorescent and UV-A is captured. Shows the UV-A
// input or its "Not applicable" readout live as the white-light field is
// edited, and clears the UV-A value while N/A so a visible inspection
// never carries a stray UV reading. Wired via data-on-input on the
// white-light field by rptFieldHtml.
function _rptLightGate(wlInput){
  if(!wlInput) return;
  const wlRaw = (wlInput.value || '').trim();
  const wl    = parseFloat(wlRaw);
  const wlNum = (wlRaw !== '' && !isNaN(wl)) ? wl : null;
  // UV-A irradiance reading — shown only for a fluorescent inspection.
  const uvInput = document.getElementById(wlInput.id.replace('whitelight','uvirr'));
  if(uvInput){
    const fld  = uvInput.closest('.fld');
    const na   = fld && fld.querySelector('.rpt-na');
    const warn = fld && fld.querySelector('.rpt-range-warn');
    const max  = parseFloat(uvInput.dataset.gatemax);
    const lim  = isNaN(max) ? 20 : max;
    const applies = wlNum != null && wlNum <= lim;
    uvInput.style.display = applies ? '' : 'none';
    if(na) na.style.display = applies ? 'none' : 'block';
    if(applies){
      if(typeof _rptRangeCheck === 'function') _rptRangeCheck(uvInput);
    } else {
      uvInput.value = '';
      if(warn) warn.style.display = 'none';
    }
  }
  // Light-meter pickers — enable only the meter whose regime the lux
  // value selects (≤ gatemax → UV-A meter, ≥ gatemin → white-light
  // meter); the other is greyed out.
  ['uvmeter','lightmeter'].forEach(key => {
    const sel = document.getElementById(wlInput.id.replace('whitelight', key));
    if(!sel) return;
    const min = parseFloat(sel.dataset.gatemin);
    const max = parseFloat(sel.dataset.gatemax);
    const applies = wlNum != null
      && (isNaN(min) || wlNum > min)
      && (isNaN(max) || wlNum <= max);
    _rptSetGateState(sel, applies);
  });
}
// Toggle a gated equipment <select> between active and greyed-out.
function _rptSetGateState(sel, applies){
  sel.disabled = !applies;
  sel.style.opacity = applies ? '' : '.45';
  if(!applies && sel.value) sel.value = '';
  const fld  = sel.closest('.fld');
  const hint = fld && fld.querySelector('.rpt-gate-hint');
  if(hint) hint.style.display = applies ? 'none' : 'block';
}

// Equipment-register dropdown — used by any RPT_FORM / TPL_FIELDS field
// that sets useEquipmentRegister:true. Filters to equipment authorised
// for `methodId` (empty methods on a record = approved for any method),
// shows "OUT OF CAL" + disabled for past-due items, and falls back to
// a free-text input when the register is empty so the form still works
// on day one.
function equipmentSelectHtml(methodId, f, val, fid, data) {
  const list = (typeof eqLoad === 'function') ? eqLoad() : [];
  // A typed field (f.eqType — the UV-A / white-light meter pickers)
  // lists only that register Type. The main NDT-equipment field lists
  // everything EXCEPT the light / UV gear (which belongs to the light
  // meter pickers and their smart cards).
  const pool = f.eqType
    ? list.filter(r => r.type === f.eqType)
    : list.filter(r => r.type !== 'white-light' && r.type !== 'uv-light');
  let filtered = pool.filter(r => !Array.isArray(r.methods) || !r.methods.length || r.methods.includes(methodId));
  // Nothing is tagged for this method but the pool has equipment — show
  // the whole pool rather than dropping to a free-text box, so the
  // inspector can still pick their gear. (Method tags are a filter
  // convenience, not a hard gate; tag the item with this method in
  // Settings → Equipment to have it shown method-filtered.)
  if(!filtered.length && pool.length) filtered = pool.slice();
  if(!filtered.length) {
    return `<div class="fld"><label>${escapeHtml(f.label)}</label>
      <input id="${fid}" type="text" value="${escapeHtml(val||'')}" placeholder="No equipment in register — add via Settings → Equipment"/>
    </div>`;
  }
  // Resolve which option to mark selected. `val` may be the equipment id
  // (after a previous save through this dropdown) or the equipment name
  // (legacy free-text reports / template defaults written before the
  // register existed). Try id first, then name.
  let selectedId = '';
  const byId   = filtered.find(r => r.id === val);
  if(byId) selectedId = byId.id;
  else {
    const byName = filtered.find(r => r.name === val);
    if(byName) selectedId = byName.id;
  }
  const opts = filtered.map(r => {
    const expired = (typeof eqIsExpired === 'function') && eqIsExpired(r);
    const bits = [r.name];
    if(r.svId) bits.push(`(${r.svId})`);
    if(expired) bits.push('— OUT OF CAL');
    return `<option value="${escapeHtml(r.id)}"${selectedId===r.id?' selected':''}${expired?' disabled':''}>${escapeHtml(bits.join(' '))}</option>`;
  }).join('');
  // Gating — a light-meter picker (f.gatedBy the white-light lux field)
  // renders disabled / greyed until the lux value puts the exam in its
  // regime. gateMax is inclusive (≤, fluorescent → UV-A meter); gateMin
  // is exclusive (>, visible → white-light meter) so the two pickers
  // partition the lux range at one threshold with no gap or overlap.
  let gateAttrs = '', gateHint = '', disAttr = '', selStyle = '';
  if(f.gatedBy){
    const raw = data && (data['eq_'+f.gatedBy] != null ? data['eq_'+f.gatedBy] : data[f.gatedBy]);
    const gv  = parseFloat(raw == null ? '' : raw);
    const applies = !isNaN(gv)
      && (f.gateMin == null || gv > f.gateMin)
      && (f.gateMax == null || gv <= f.gateMax);
    gateAttrs = ` data-gatedby="${escapeHtml(f.gatedBy)}"`
      + (f.gateMin != null ? ` data-gatemin="${f.gateMin}"` : '')
      + (f.gateMax != null ? ` data-gatemax="${f.gateMax}"` : '');
    const cond = f.gateMin != null ? `the white-light reading is above ${f.gateMin} lux`
               : f.gateMax != null ? `the white-light reading is ${f.gateMax} lux or below`
               : '';
    gateHint = `<div class="rpt-gate-hint" style="display:${applies?'none':'block'};font-size:11px;color:var(--t3);font-style:italic;margin-top:3px">Applies when ${cond}.</div>`;
    if(!applies){ disAttr = ' disabled'; selStyle = ' style="opacity:.45"'; }
  }
  return `<div class="fld"><label>${escapeHtml(f.label)} <span style="font-size:10px;color:var(--t3);font-weight:400">· from Settings → Equipment</span></label>
    <select id="${fid}" class="rf-equipment" data-method="${escapeHtml(methodId)}"${gateAttrs}${disAttr}${selStyle}><option value="">— Select —</option>${opts}</select>${gateHint}
  </div>`;
}

// Inspector-register dropdown — used by any field with
// useInspectorRegister:true. Lists inspectors from Settings →
// Inspectors; each option is disabled unless the inspector holds a
// non-expired certification for the report's method, so an inspector
// who isn't validly certified can't be selected to sign. Falls back to
// free text when the directory is empty.
function inspectorSelectHtml(methodId, f, val, fid) {
  // The full inspector dropdown is admin-only — an admin records who
  // performed/signed the inspection. A non-admin signs as themselves:
  // their own name is shown locked, and ovNewReport / ovSaveReport
  // enforce that their certification for this method is valid.
  const isAdmin = (typeof vxIsAdmin === 'function') ? vxIsAdmin() : true;
  if(!isAdmin) {
    let myName = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER)
      ? (CURRENT_USER.name || CURRENT_USER.email || '') : '';
    if(typeof _ovCurrentUserInspector === 'function') {
      const rec = _ovCurrentUserInspector();
      if(rec && rec.name) myName = rec.name;
    }
    return `<div class="fld"><label>${escapeHtml(f.label)}</label>
      <input id="${fid}" type="text" value="${escapeHtml(myName || val || '')}" readonly style="color:var(--t3);font-style:italic" title="You sign reports as yourself"/>
    </div>`;
  }
  const list = (typeof INSPECTORS !== 'undefined' && Array.isArray(INSPECTORS) && INSPECTORS.length)
    ? INSPECTORS
    : ((typeof ls === 'function') ? ls('vx-inspectors-v1', []) : []);
  if(!list.length) {
    return `<div class="fld"><label>${escapeHtml(f.label)}</label>
      <input id="${fid}" type="text" value="${escapeHtml(val||'')}" placeholder="No inspectors in directory — add via Settings → Inspectors"/>
    </div>`;
  }
  const opts = list.map(ins => {
    const certs = (typeof _inspMethodCerts === 'function') ? _inspMethodCerts(ins) : (ins.methodCerts || {});
    const cert = methodId ? certs[methodId] : null;
    let disabled = false, suffix = '';
    if(methodId && !cert) {
      disabled = true; suffix = ' — not certified for ' + methodId;
    } else if(cert) {
      const d = (typeof daysUntil === 'function') ? daysUntil(cert.expiry) : null;
      if(d !== null && d < 0) { disabled = true; suffix = ' — ' + methodId + ' cert EXPIRED'; }
    }
    // A previously-saved value that's now disabled is still shown
    // selected so the form doesn't silently lose it.
    return `<option value="${escapeHtml(ins.name)}"${ins.name===val?' selected':''}${disabled && ins.name!==val?' disabled':''}>${escapeHtml((ins.name||'—') + suffix)}</option>`;
  }).join('');
  return `<div class="fld"><label>${escapeHtml(f.label)} <span style="font-size:10px;color:var(--t3);font-weight:400">· must hold a valid ${escapeHtml(methodId||'')} certification</span></label>
    <select id="${fid}" class="rf-inspector" data-method="${escapeHtml(methodId)}"><option value="">— Select —</option>${opts}</select>
  </div>`;
}

function rptFormSave(methodId) {
  const m = NDT_METHODS.find(x=>x.id===methodId); if(!m) return;
  const allFields = [...RPT_FORM.client,...RPT_FORM.subject,...RPT_FORM.exam,...RPT_FORM.result];
  const specific = (TPL_FIELDS[methodId]||[]).map(s=>({...s,id:'eq_'+s.id}));
  const all = [...allFields,...specific];
  const data = {};
  all.forEach(f => {
    const inp = el(`rf-${methodId}-${f.id}`);
    if(inp) data[f.id] = f.type==='select' ? inp.value : inp.value.trim();
  });
  _rptForms[methodId] = data;
  _rptForms[methodId]._saved = true;
  saveRptForms();
  toast(`${m.id} report template saved.`);
}

async function rptFormClear(methodId) {
  if(!await vxConfirm({ message: `Are you sure you want to clear the ${methodId} report form? Any unsaved changes will be lost.`, okLabel: t('vxc.clear','Clear'), danger: true })) return;
  delete _rptForms[methodId];
  saveRptForms();
  tplRenderBody(methodId);
  toast(`${methodId} report form cleared.`);
}

function tplFieldHtml(methodId, f, tpl) {
  const val = tpl[f.id]||'';
  const fid = `tpl-${methodId}-${f.id}`;
  // Effective option list = TPL_FIELDS defaults merged with any add/delete
  // edits the admin has saved on this field. Falls back to the static
  // defaults when no overrides exist.
  const fieldOpts = tplEffectiveOptions(methodId, f);
  // Editable combo — same as the new-report form: free text with the
  // presets as datalist suggestions (see rptFieldHtml).
  if(f.editable && fieldOpts.length) {
    const dl = fid + '-dl';
    const opts = fieldOpts.map(o => `<option value="${escapeHtml(o)}"></option>`).join('');
    // Numeric fields (UV-A, white-light) restrict input to numbers and
    // raise a decimal keypad on tablets; non-numeric fields stay free text.
    const numAttrs = f.numeric ? ' type="number" min="0" step="any" inputmode="decimal"' : ' type="text"';
    return `<div class="fld"><label>${f.label}</label>
      <input id="${fid}" list="${dl}"${numAttrs} value="${escapeHtml(val)}" placeholder="${escapeHtml(f.placeholder||'')}" autocomplete="off"/>
      <datalist id="${dl}">${opts}</datalist></div>`;
  }
  if(fieldOpts.length) {
    const opts = fieldOpts.map(o => `<option${o===val?' selected':''}>${o}</option>`).join('');
    return `<div class="fld"><label>${f.label}</label><div style="display:flex;gap:6px;align-items:stretch">
      <select id="${fid}" style="flex:1"><option value="">— Select —</option>${opts}</select>
      <button type="button" class="sel-add-btn" data-action="selAddOption" data-args="'${fid}'" title="Add option">+</button>
      <button type="button" class="sel-del-btn" data-action="selDelOption" data-args="'${fid}'" title="Remove selected">−</button>
    </div></div>`;
  }
  return `<div class="fld"><label>${f.label}</label><input id="${fid}" type="${f.type||'text'}" value="${val}" placeholder="${f.placeholder}"/></div>`;
}

function tplSave(methodId) {
  const m = NDT_METHODS.find(x=>x.id===methodId); if(!m) return;
  const common = TPL_FIELDS._common;
  const specific = TPL_FIELDS[methodId]||[];
  const tpl = {};
  [...common,...specific].forEach(f => { const inp=el(`tpl-${methodId}-${f.id}`); if(inp) tpl[f.id]=inp.value.trim(); });
  const rem=el(`tpl-${methodId}-remarks`); if(rem) tpl.remarks=rem.value.trim();
  // Template number — admin-only. Non-admins see a disabled input so they
  // can't change it in the UI; the action-level guard here is the
  // belt-and-braces check (server-side RLS will be the eventual final
  // enforcer when the field moves to Supabase).
  const tno = el(`tpl-${methodId}-templateNo`);
  if(tno){
    const newVal = tno.value.trim();
    const prevVal = (_tplData[methodId] && _tplData[methodId].templateNo) || '';
    if(newVal !== prevVal){
      const isAdmin = (typeof vxIsAdmin === 'function') ? vxIsAdmin() : true;
      if(!isAdmin){
        toast(t('rbac.admin_only_tpl_number', 'Only admins can change the template number.'), 'error');
        return;
      }
    }
    tpl.templateNo = newVal;
  }
  _tplData[methodId]=tpl;
  saveTemplates();
  // Re-render the editor body from the just-saved state. Without this the
  // form keeps showing the DOM values the user typed; on a tab-switch /
  // page revisit the body re-renders from _tplData, which is jarring if
  // anything was inadvertently dropped on save. Re-rendering immediately
  // makes the persisted state visible.
  tplRenderBody(methodId);
  toast(`${m.id} template saved.`);
}

async function tplClear(methodId) {
  if(!await vxConfirm({ message: `Are you sure you want to reset all ${methodId} defaults? This action cannot be undone.`, okLabel: t('vxc.reset','Reset'), danger: true })) return;
  delete _tplData[methodId];
  saveTemplates();
  tplSelectMethod(methodId);
  toast(`${methodId} defaults cleared.`);
}

// ══════════════════════════════════════════════
// REPORTS PAGE
// ══════════════════════════════════════════════
function rptInit() {
  // Populate method filter
  const fm = el('rpt-fm'); if(!fm) return;
  const cur = fm.value;
  fm.innerHTML = '<option value="">All methods</option>' +
    getActiveMethods().map(m => `<option value="${m.id}">${m.id}</option>`).join('');
  fm.value = cur;
  // V6: restore saved view preference
  try {
    const saved = localStorage.getItem(RPT_VIEW_PREF_KEY);
    if(saved === 'table' || saved === 'kanban') _rptView = saved;
  } catch(e){}
  document.getElementById('rpt-vtog-table')?.classList.toggle('active', _rptView === 'table');
  document.getElementById('rpt-vtog-kanban')?.classList.toggle('active', _rptView === 'kanban');
  rptRender();
  rptUpdateBulkBar();
}

// V6: View state + selection + saved filters
var _rptView = 'table';            // 'table' | 'kanban'
var _rptStatusFilter = '';         // '' | 'review' | 'approved' — status-tile filter
// reportNo -> highest revision number seen. A report below its reportNo's
// max is superseded (locked). Recomputed at the start of each table render.
var _rptMaxRev = {};
var _rptSelectedIdx = new Set();   // indices into the full reports array
var _rptActiveSavedView = null;    // id of currently active saved view (or null)

var RPT_SAVED_VIEWS_KEY = 'vx-rpt-saved-views-v1';
var RPT_VIEW_PREF_KEY   = 'vx-rpt-view-pref-v1';

function rptListSavedViews(){ return ls(RPT_SAVED_VIEWS_KEY, []); }
function rptSaveViewsList(list){ lss(RPT_SAVED_VIEWS_KEY, list); }

function rptSetView(view){
  _rptView = view;
  try { localStorage.setItem(RPT_VIEW_PREF_KEY, view); } catch(e){}
  document.getElementById('rpt-vtog-table')?.classList.toggle('active', view === 'table');
  document.getElementById('rpt-vtog-kanban')?.classList.toggle('active', view === 'kanban');
  rptRender();
}

function rptCollectFilters(){
  return {
    search:   el('rpt-search')?.value || '',
    method:   el('rpt-fm')?.value || '',
    status:   _rptStatusFilter || '',
    dateFrom: el('rpt-f-datefrom')?.value || '',
    dateTo:   el('rpt-f-dateto')?.value || '',
  };
}

function rptApplyFilters(filters){
  if(el('rpt-search'))     el('rpt-search').value     = filters.search    || '';
  if(el('rpt-fm'))         el('rpt-fm').value         = filters.method    || '';
  _rptStatusFilter = filters.status || '';
  if(el('rpt-f-datefrom')) el('rpt-f-datefrom').value = filters.dateFrom  || '';
  if(el('rpt-f-dateto'))   el('rpt-f-dateto').value   = filters.dateTo    || '';
}

async function rptSaveCurrentView(){
  const filters = rptCollectFilters();
  const activeCount = Object.values(filters).filter(Boolean).length;
  if(activeCount === 0){ toast(t('toast.set_filter_first','Set at least one filter before saving a view.'), 'warn'); return; }
  const name = await vxPrompt({ message: t('rpt.view.name_prompt','Name this view:'), defaultValue: 'My filter ' + (rptListSavedViews().length + 1) });
  if(!name || !name.trim()) return;
  const list = rptListSavedViews();
  const item = { id: 'view-' + Date.now(), name: name.trim(), filters, view: _rptView };
  list.push(item);
  rptSaveViewsList(list);
  _rptActiveSavedView = item.id;
  toast('View "' + name.trim() + '" saved');
  rptRenderSavedViews();
}

function rptApplySavedView(id){
  const v = rptListSavedViews().find(x => x.id === id);
  if(!v) return;
  _rptActiveSavedView = id;
  rptApplyFilters(v.filters);
  if(v.view) rptSetView(v.view);
  else rptRender();
  rptRenderSavedViews();
}

async function rptDeleteSavedView(id, evt){
  if(evt) evt.stopPropagation();
  if(!await vxConfirm({ message: 'Are you sure you want to delete this saved view?', okLabel: t('vxc.delete','Delete'), danger: true })) return;
  rptSaveViewsList(rptListSavedViews().filter(v => v.id !== id));
  if(_rptActiveSavedView === id) _rptActiveSavedView = null;
  rptRenderSavedViews();
}

function rptRenderSavedViews(){
  const wrap = el('rpt-saved-views'); if(!wrap) return;
  const list = rptListSavedViews();
  if(!list.length){
    wrap.innerHTML = '<span style="font-size:11px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em">Tip:</span> <span style="font-size:11px;color:var(--t3)">set filters and click "+ Save view" to pin them here.</span>';
    return;
  }
  wrap.innerHTML = '<span class="rpt-view-chip-label">Saved views:</span>' +
    list.map(v => `
      <span class="rpt-view-chip ${v.id === _rptActiveSavedView ? 'active' : ''}" data-action="rptApplySavedView" data-args="'${v.id}'">
        ${escapeHtml(v.name)}
        <span class="rpt-view-chip-x" data-action="rptDeleteSavedView" data-pass-event="1" data-args="'${v.id}'" title="Delete view">×</span>
      </span>
    `).join('') +
    (_rptActiveSavedView ? `<button class="btn btn-xs" data-action="rptClearActiveView" style="font-size:10px;padding:3px 8px">Clear</button>` : '');
}

function rptClearActiveView(){
  _rptActiveSavedView = null;
  rptClearFilters();
  rptRenderSavedViews();
}

// Bulk selection helpers
function rptToggleSelect(idx, evt){
  if(evt) evt.stopPropagation();
  if(_rptSelectedIdx.has(idx)) _rptSelectedIdx.delete(idx);
  else _rptSelectedIdx.add(idx);
  rptUpdateBulkBar();
  rptRender();
}
function rptToggleAll(visibleIdxList){
  const allSelected = visibleIdxList.every(i => _rptSelectedIdx.has(i));
  if(allSelected) visibleIdxList.forEach(i => _rptSelectedIdx.delete(i));
  else visibleIdxList.forEach(i => _rptSelectedIdx.add(i));
  rptUpdateBulkBar();
  rptRender();
}
function rptBulkClearSelection(){ _rptSelectedIdx.clear(); rptUpdateBulkBar(); rptRender(); }
function rptUpdateBulkBar(){
  const bar = el('rpt-bulk-bar'); if(!bar) return;
  const n = _rptSelectedIdx.size;
  if(n === 0){ bar.classList.remove('show'); bar.style.display = 'none'; return; }
  bar.classList.add('show');
  bar.style.display = 'flex';
  set('rpt-bulk-count', tf('rpt.bulk.selected', '{n} selected', { n }));
}
// Bulk PDF — browser printing is one report at a time, so each selected
// report opens its own print/PDF view in turn.
function rptBulkPdf(){
  const idxs = Array.from(_rptSelectedIdx);
  if(!idxs.length){ toast(t('toast.select_reports','Select one or more reports first.'), 'warn'); return; }
  idxs.forEach(i => { if(typeof ovPrintReport === 'function') ovPrintReport(i); });
}

// Bulk Open — opening loads a report into the form, so exactly one must
// be selected. ovOpenReport itself blocks superseded revisions.
function rptBulkOpen(){
  const idxs = Array.from(_rptSelectedIdx);
  if(idxs.length !== 1){ toast(t('toast.open_one','Select a single report to revise.'), 'warn'); return; }
  if(typeof ovOpenReport === 'function') ovOpenReport(idxs[0]);
}

// Bulk View — opens the rendered report in a new tab as a read-only
// PDF-like viewer. Single-select for now to stay friendly with browser
// popup blockers (most browsers cap simultaneous window.open calls
// from one user action at one).
function rptBulkView(){
  const idxs = Array.from(_rptSelectedIdx);
  if(idxs.length !== 1){ toast(t('toast.open_one_view','Select a single report to open.'), 'warn'); return; }
  if(typeof ovViewReport === 'function') ovViewReport(idxs[0]);
}

function rptBulkSetStage(stage){
  const idxs = Array.from(_rptSelectedIdx);
  const count = setReportStageBulk(idxs, stage);
  // V31: translated stage name for the toast
  const stageKey = 'rpt.stage.' + stage.toLowerCase();
  const stageLbl = t(stageKey, stage);
  toast(tf('rpt.bulk.stage_done', '{n} report(s) moved to {stage}', { n: count, stage: stageLbl }), 'success');
  _rptSelectedIdx.clear();
  rptUpdateBulkBar();
  rptRender();
}
async function rptBulkDelete(){
  const n = _rptSelectedIdx.size;
  if(!n) return;
  if(!await vxConfirm({ message: tf('rpt.bulk.confirm_delete', 'Are you sure you want to delete {n} report(s)? This action cannot be undone.', { n }), okLabel: t('vxc.delete','Delete'), danger: true })) return;
  const all = ls(KEYS.reports, []);
  const toRemove = new Set(_rptSelectedIdx);
  const remaining = all.filter((_, i) => !toRemove.has(i));
  lss(KEYS.reports, remaining);
  _rptSelectedIdx.clear();
  rptUpdateBulkBar();
  if(typeof updateReportCount === 'function') updateReportCount();
  rptRender();
  toast(n + ' report' + (n !== 1 ? 's' : '') + ' deleted');
}
function rptBulkExportCsv(){
  const all = ls(KEYS.reports, []);
  const idxs = Array.from(_rptSelectedIdx).sort((a,b) => a - b);
  if(!idxs.length) return;
  const headers = ['Report no.','Method','Stage','Verdict','Client','Subject','Drawing','Weld no.','Inspector','Date'];
  const rows = idxs.map(i => {
    const r = all[i];
    return [r.reportNo||'', r.method||'', getReportStage(r), r.verdict||'Draft', r.client||'', r.subject||'', r.drawing||'', r.weldNo||'', r.inspector||'', r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ''].map(v=>'"'+String(v).replace(/"/g,'""')+'"');
  });
  const csv = [headers.join(','), ...rows.map(r=>r.join(','))].join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'reports-export-'+new Date().toISOString().split('T')[0]+'.csv';
  a.click(); URL.revokeObjectURL(url);
  toast(tf('toast.exported_n','Exported {n} report(s).', {n: idxs.length}));
}

function rptRender() {
  let list = ls(KEYS.reports, []);
  const allReports = list.slice(); // keep original index reference for selection
  const search = (el('rpt-search')?.value || '').toLowerCase().trim();
  const fm = el('rpt-fm')?.value || '';
  const fDateFrom = el('rpt-f-datefrom')?.value || '';
  const fDateTo = el('rpt-f-dateto')?.value || '';

  // Build filtered list while preserving the original index in `_origIdx`
  list = list.map((r, i) => ({ r, _origIdx: i })).filter(({r}) => {
    if(fm && r.method !== fm) return false;
    // Status tiles — 'review' = Submitted stage, 'approved' = Approved.
    if(_rptStatusFilter === 'review'   && getReportStage(r) !== 'Submitted') return false;
    if(_rptStatusFilter === 'approved' && getReportStage(r) !== 'Approved')  return false;
    if(search) {
      // "Weld / object" — hits the top-level subject (mirrored from
      // items[0]) AND every items-table row's subject, so a weld id is
      // found regardless of which row it lives in. Legacy weldNo kept.
      const _itemSubjects = Array.isArray(r.items) ? r.items.map(it => (it && it.subject) || '').join(' ') : '';
      const hay = [r.reportNo, r.client, r.project, r.drawing, r.weldNo, r.subject, _itemSubjects, r.inspector].map(v => (v||'').toLowerCase()).join(' ');
      if(!hay.includes(search)) return false;
    }
    if(fDateFrom){ const d = (r.createdAt||'').split('T')[0]; if(d < fDateFrom) return false; }
    if(fDateTo)  { const d = (r.createdAt||'').split('T')[0]; if(d > fDateTo)   return false; }
    return true;
  });

  const activeFilters = [fm, search, _rptStatusFilter, fDateFrom, fDateTo].filter(Boolean).length;
  // V31: translated subtitle. Plural-aware report count + "N filter(s) active"
  // when filters are in play. The {n} interpolation handles localization of
  // grammatical number for English / Dutch / German / French / Spanish.
  const reportLbl = list.length === 1
    ? t('rpt.sub.1_report', '1 report')
    : tf('rpt.sub.n_reports', '{n} reports', { n: list.length });
  const filterLbl = activeFilters
    ? ' · ' + tf('rpt.sub.filters_active', '{n} filter(s) active', { n: activeFilters })
    : '';
  set('rpt-sub', reportLbl + filterLbl);

  rptRenderSavedViews();
  rptRenderTiles(allReports);
  return rptRenderTable(list, allReports);
}

// Status tiles — counts of every report by workflow status, doubling as
// click-to-filter controls. '' = All, 'review' = Submitted, 'approved'.
function rptRenderTiles(allReports){
  const wrap = el('rpt-tiles'); if(!wrap) return;
  const total    = allReports.length;
  const forRev   = allReports.filter(r => getReportStage(r) === 'Submitted').length;
  const approved = allReports.filter(r => getReportStage(r) === 'Approved').length;
  const tile = (key, label, n, accent) => {
    const on = _rptStatusFilter === key;
    return `<button data-action="rptSetStatusFilter" data-args="'${key}'" style="flex:0 0 auto;min-width:132px;text-align:left;padding:9px 15px;border-radius:8px;cursor:pointer;font-family:var(--font);border:1px solid ${on?accent:'var(--border)'};background:${on?accent+'22':'var(--bg2)'}">
      <div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.05em">${label}</div>
      <div style="font-size:21px;font-weight:700;color:${accent}">${n}</div>
    </button>`;
  };
  wrap.innerHTML =
      tile('',         'All reports', total,    '#7f8caa')
    + tile('review',   'For review',  forRev,   '#00d4ff')
    + tile('approved', 'Approved',    approved, '#3ecf8e');
}

function rptSetStatusFilter(key){
  key = key || '';
  _rptStatusFilter = (_rptStatusFilter === key) ? '' : key;
  rptRender();
}

function rptRenderTable(list, allReports){
  const wrap = el('rpt-table-wrap'); if(!wrap) return;
  // Highest revision per report number — drives the superseded/locked flag.
  _rptMaxRev = {};
  allReports.forEach(o => {
    const rn = o.reportNo; if(!rn) return;
    const rv = parseInt(o.revision, 10) || 0;
    if(_rptMaxRev[rn] == null || rv > _rptMaxRev[rn]) _rptMaxRev[rn] = rv;
  });
  // V12: if previous render was kanban, the board needs to go before we
  // can build the table shell. The shell-creation branch handles this when
  // table.tbl is missing — but if both exist (theoretically possible after
  // hot reload), prefer the table.
  const staleBoard = wrap.querySelector('.kb-board');
  if(staleBoard) staleBoard.remove();
  const visibleIdxList = list.map(x => x._origIdx);
  const allChecked = visibleIdxList.length > 0 && visibleIdxList.every(i => _rptSelectedIdx.has(i));

  // V12 perf: keyed reconciliation. Build the static shell once (header,
  // wrapper card, table chrome) and on subsequent renders only update the
  // tbody — and within tbody, only the rows whose data actually changed.
  // Empirical: ~30× faster on 1000-row filter operations than innerHTML rebuild.

  // Build/recover the shell
  let table = wrap.querySelector('table.tbl');
  let tbody = table?.querySelector('tbody');
  let allCb = table?.querySelector('thead input[type=checkbox]');
  if(!table || !tbody) {
    // First render — assemble the full shell
    wrap.innerHTML = `<div class="sc" style="margin-top:14px"><div class="sc-body np" style="overflow-x:auto">
      <table class="tbl" style="width:100%"><thead><tr>
        <th scope="col" style="width:34px;padding:8px 10px"><input type="checkbox" class="rpt-cb" aria-label="Select all visible reports" title="Select all visible"></th>
        <th scope="col" data-i18n="col.report_id">Report ID</th><th scope="col" data-i18n="col.method">Method</th><th scope="col" data-i18n="col.stage">Stage</th><th scope="col" data-i18n="col.client">Client</th><th scope="col">Weld / object</th><th scope="col" data-i18n="col.drawing">Drawing</th><th scope="col" data-i18n="col.inspector">Inspector</th><th scope="col" data-i18n="col.date">Date</th><th scope="col" data-i18n="col.result">Result</th>
      </tr></thead><tbody></tbody></table></div></div>`;
    table = wrap.querySelector('table.tbl');
    tbody = table.querySelector('tbody');
    allCb = table.querySelector('thead input[type=checkbox]');
    // Wire the header checkbox via JS rather than inline onclick (so we can
    // pass the live visible-idx array without JSON-stringifying on every render)
    allCb.addEventListener('click', () => rptToggleAll(visibleIdxListLatest));
  }
  // Update header checkbox state
  allCb.checked  = allChecked;
  allCb.disabled = !list.length;

  // Empty state
  if(!list.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:28px;color:var(--t3)">No reports match these filters.</td></tr>';
    visibleIdxListLatest = [];
    return;
  }
  visibleIdxListLatest = visibleIdxList;

  // Compute desired rows in display order (reversed = newest first)
  const desired = list.slice().reverse();

  // Index existing rows by key so we can reuse their DOM nodes
  const existing = new Map();
  Array.from(tbody.children).forEach(tr => {
    if(tr.dataset.key) existing.set(tr.dataset.key, tr);
  });

  // Walk desired list and reuse / update / insert as needed. We track the
  // previous node so each row can be `.after()`-positioned correctly without
  // disturbing the DOM more than necessary.
  let prevNode = null;
  desired.forEach(({r, _origIdx}) => {
    const key = 'rpt-' + _origIdx;
    const sig = _rptRowSig(r, _origIdx);
    let tr = existing.get(key);
    if(tr && tr.dataset.sig === sig) {
      // No data change — just reposition if needed
    } else if(tr) {
      // Same row, data changed — update inner HTML
      tr.innerHTML = _rptRowInner(r, _origIdx);
      tr.className = _rptSelectedIdx.has(_origIdx) ? 'selected' : '';
      tr.dataset.sig = sig;
    } else {
      // New row
      tr = document.createElement('tr');
      tr.dataset.key = key;
      tr.dataset.sig = sig;
      tr.className = _rptSelectedIdx.has(_origIdx) ? 'selected' : '';
      tr.innerHTML = _rptRowInner(r, _origIdx);
    }
    // Position: if not already in correct spot, move
    const expectedSibling = prevNode ? prevNode.nextSibling : tbody.firstChild;
    if(tr !== expectedSibling) {
      if(prevNode) prevNode.after(tr);
      else tbody.prepend(tr);
    }
    existing.delete(key);
    prevNode = tr;
  });

  // Remove rows that are no longer in the visible list
  existing.forEach(tr => tr.remove());
}

// Latest visible-idx list — captured by the header checkbox closure
var visibleIdxListLatest = [];

// Hash-like signature of a report's rendered fields. If this changes, the
// row gets re-rendered. Cheap concat; no actual hashing needed.
// A report is superseded (locked) once a higher revision of the same
// report number exists. Superseded reports are read-only — PDF / email
// only, no Open. Reads _rptMaxRev, filled by rptRenderTable.
function _rptIsSuperseded(r){
  if(!r || !r.reportNo) return false;
  return (parseInt(r.revision, 10) || 0) < (_rptMaxRev[r.reportNo] || 0);
}

function _rptRowSig(r, idx) {
  return [
    r.reportNo, r.method, getReportStage(r), r.verdict, r.client, r.subject,
    r.drawing, r.inspector, r.createdAt, r.stageUpdatedAt,
    _rptIsSuperseded(r) ? 'S' : '',
    _rptSelectedIdx.has(idx) ? '1' : '0',
  ].join('|');
}

// Build the inner HTML of one row. Stable enough to compare via the signature.
function _rptRowInner(r, _origIdx) {
  const md = NDT_METHODS.find(x => x.id === r.method);
  const sup = _rptIsSuperseded(r);
  const verdict = r.verdict && r.verdict !== '— Select —' ? r.verdict : 'Draft';
  const vClass = verdict==='Acceptable'?'green':verdict==='Not acceptable'?'red':verdict==='Various'?'amber':'blue';
  const stage = getReportStage(r);
  const sc = RPT_STAGE_COLORS[stage] || RPT_STAGE_COLORS.Draft;
  const isSelected = _rptSelectedIdx.has(_origIdx);
  const health = stageHealthy(r);
  return `<td style="padding:8px 10px"><input type="checkbox" class="rpt-cb" aria-label="Select report ${escapeHtml(r.reportNo||'')}" ${isSelected?'checked':''} data-action="rptToggleSelect" data-pass-event="1" data-args="${_origIdx}"></td>
    <td style="font-family:var(--mono);font-size:12px">${escapeHtml(r.reportNo||'—')} <span style="color:var(--t3);font-weight:400">Rev ${escapeHtml(r.revision||'00')}</span>${sup?' <span title="Superseded by a later revision — locked" style="color:var(--t3)">🔒</span>':''}</td>
    <td><span style="font-family:var(--mono);font-weight:600;color:${md?.color||'var(--t2)'}">${escapeHtml(r.method||'—')}</span></td>
    <td><span class="badge" data-no-glyph style="background:${sc.bg};color:${sc.fg};box-shadow:inset 0 0 0 1px ${sc.accent}33;font-size:10px">${tStage(stage)}</span>${health!=='fresh'?` <span title="${fmtDuration(timeOnStage(r))} on this stage" style="font-size:10px;color:${health==='critical'?'var(--red)':'var(--amber)'};font-family:var(--mono)">·${fmtDuration(timeOnStage(r))}</span>`:''}</td>
    <td>${escapeHtml(r.client||'—')}</td>
    <td>${escapeHtml(r.subject||'—')}</td>
    <td style="font-size:12px;color:var(--t2)">${escapeHtml(r.drawing||'—')}</td>
    <td>${escapeHtml(r.inspector||'—')}</td>
    <td style="font-family:var(--mono);font-size:11px;white-space:nowrap">${fmtDate(r.createdAt)}</td>
    <td><span class="badge badge-${vClass}" data-no-glyph style="font-size:10px">${escapeHtml(verdict)}</span></td>`;
}

function rptRenderKanban(list, allReports){
  const wrap = el('rpt-table-wrap'); if(!wrap) return;
  // V12: drop stale table DOM from previous view
  const staleTable = wrap.querySelector('table.tbl')?.closest('.sc');
  if(staleTable) staleTable.remove();
  // Group filtered list by stage
  const groups = {}; RPT_STAGES.forEach(s => groups[s] = []);
  list.forEach(({r, _origIdx}) => {
    const s = getReportStage(r);
    if(groups[s]) groups[s].push({ r, _origIdx });
  });

  // V12 perf: keyed reconciliation. Build the board shell once, then on
  // re-renders only update the cards inside each column. Avoids drag-drop
  // disruption mid-interaction and saves layout cost on filter typing.
  let board = wrap.querySelector('.kb-board');
  if(!board) {
    // First render — assemble the columns
    let html = '<div class="kb-board" role="list" aria-label="Report stages">';
    RPT_STAGES.forEach(stage => {
      const sc = RPT_STAGE_COLORS[stage];
      html += `<div class="kb-col" role="listitem" data-stage="${stage}" data-on-dragover="rptKbDragOver" data-pass-event="1" data-on-dragleave="rptKbDragLeave" data-pass-event="1" data-on-drop="rptKbDrop" data-pass-event="1" data-args="'${stage}'" aria-label="${stage} column">
        <div class="kb-col-head">
          <span class="kb-col-head-title"><span class="kb-col-head-dot" style="background:${sc.accent}" aria-hidden="true"></span>${tStage(stage)}</span>
          <span class="kb-col-head-count" aria-label="card count">0</span>
        </div>
        <div class="kb-col-body" data-stage-body="${stage}"></div>
      </div>`;
    });
    html += '</div>';
    wrap.innerHTML = html;
    board = wrap.querySelector('.kb-board');
  }

  // Update each column independently with keyed reconciliation
  RPT_STAGES.forEach(stage => {
    const body = board.querySelector(`[data-stage-body="${stage}"]`);
    const head = board.querySelector(`[data-stage="${stage}"] .kb-col-head-count`);
    if(!body) return;
    const cards = groups[stage].slice().reverse();   // newest first
    if(head) head.textContent = String(cards.length);

    if(!cards.length) {
      body.innerHTML = '<div class="kb-empty">No reports here.<br>Drag a card to move it.</div>';
      return;
    }
    // Drop empty placeholder if it exists
    const empty = body.querySelector('.kb-empty');
    if(empty) empty.remove();

    // Build map of existing cards by key
    const existing = new Map();
    Array.from(body.children).forEach(card => {
      if(card.dataset.key) existing.set(card.dataset.key, card);
    });

    // Walk desired cards
    let prevNode = null;
    cards.forEach(({r, _origIdx}) => {
      const key = 'kb-' + _origIdx;
      const sig = _rptRowSig(r, _origIdx);
      let card = existing.get(key);
      if(card && card.dataset.sig === sig) {
        // unchanged
      } else if(card) {
        // update content in place
        card.outerHTML = rptRenderKanbanCard(r, _origIdx);
        // outerHTML replaces the node — refetch
        card = body.querySelector(`[data-key="${key}"]`);
      } else {
        // new card
        const tmp = document.createElement('div');
        tmp.innerHTML = rptRenderKanbanCard(r, _origIdx);
        card = tmp.firstElementChild;
      }
      // Position
      const expectedSibling = prevNode ? prevNode.nextSibling : body.firstChild;
      if(card !== expectedSibling) {
        if(prevNode) prevNode.after(card);
        else body.prepend(card);
      }
      existing.delete(key);
      prevNode = card;
    });
    // Remove cards no longer in this column
    existing.forEach(card => card.remove());
  });
}
function rptRenderKanbanCard(r, idx){
  const md = NDT_METHODS.find(x => x.id === r.method);
  const verdict = r.verdict && r.verdict !== '— Select —' ? r.verdict : '—';
  const vClass = verdict==='Acceptable'?'green':verdict==='Not acceptable'?'red':verdict==='Various'?'amber':null;
  const isSelected = _rptSelectedIdx.has(idx);
  const health = stageHealthy(r);
  const healthClass = health === 'fresh' ? '' : 'health-' + health;
  // V12: data-key + data-sig for keyed reconciliation
  return `<div class="kb-card ${isSelected?'selected':''} ${healthClass}" draggable="true" data-idx="${idx}" data-key="kb-${idx}" data-sig="${_rptRowSig(r, idx)}" data-on-dragstart="rptKbDragStart" data-pass-event="1" data-args="${idx}" data-on-dragend="rptKbDragEnd" data-pass-event="1" data-action="rptToggleSelect" data-args="${idx}" tabindex="0" role="article" aria-label="Report ${escapeHtml(r.reportNo||'')} on ${getReportStage(r)} stage">
    <div class="kb-card-row1">
      <span class="kb-card-id">${escapeHtml(r.reportNo||'—')}</span>
      <span class="kb-card-method" style="background:${(md?.color||'#5a6880')}1a;color:${md?.color||'#5a6880'}">${escapeHtml(r.method||'?')}</span>
    </div>
    <div class="kb-card-subject">${escapeHtml(r.subject || r.client || 'No subject')}</div>
    <div class="kb-card-meta">
      <span title="${escapeHtml(r.inspector||'')}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px">${escapeHtml(r.inspector||'—')}</span>
      <span class="kb-card-meta-time" style="${health==='critical'?'color:var(--red)':health==='stale'?'color:var(--amber)':''}" title="On stage for ${fmtDuration(timeOnStage(r))}">${fmtDuration(timeOnStage(r))}${vClass==='green'?' · ✓':vClass==='red'?' · ✕':''}</span>
    </div>
  </div>`;
}

// Drag and drop
var _rptDragIdx = null;
function rptKbDragStart(e, idx){
  _rptDragIdx = idx;
  e.target.classList.add('dragging');
  try { e.dataTransfer.setData('text/plain', String(idx)); e.dataTransfer.effectAllowed = 'move'; } catch(err){}
}
function rptKbDragEnd(e){
  e.target.classList.remove('dragging');
  document.querySelectorAll('.kb-col.drag-over').forEach(c => c.classList.remove('drag-over'));
  _rptDragIdx = null;
}
function rptKbDragOver(e){
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}
function rptKbDragLeave(e){
  if(!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drag-over');
}
function rptKbDrop(e, stage){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const idx = _rptDragIdx != null ? _rptDragIdx : parseInt(e.dataTransfer.getData('text/plain'));
  if(isNaN(idx)) return;
  if(setReportStage(idx, stage)) toast(tf('toast.moved_to','Moved to {stage}', {stage: tStage(stage)}));
  _rptDragIdx = null;
}

function rptDelete(idx) {
  const reports = ls(KEYS.reports, []);
  const original = reports[idx];
  if(!original) return;
  // V14: optimistic delete with undo. The report is removed immediately and
  // the user gets a 6-second window to undo. No confirm() dialog — the undo
  // toast is the safety net, and it preserves momentum.
  vxUndoable({
    message:        'Report ' + (original.reportNo || '(no number)') + ' deleted',
    undoneMessage:  'Report restored',
    duration:       6000,
    apply: () => {
      const list = ls(KEYS.reports, []);
      list.splice(idx, 1);
      lss(KEYS.reports, list);
      updateReportCount();
      rptRender();
    },
    undo: () => {
      const list = ls(KEYS.reports, []);
      list.splice(idx, 0, original);
      lss(KEYS.reports, list);
      updateReportCount();
      rptRender();
    },
    commit: () => {
      // No server-side action needed — the lss() already queued a sync op.
      // For audit, we could log the commit here.
    },
  });
}

function rptClearFilters() {
  ['rpt-search','rpt-f-datefrom','rpt-f-dateto'].forEach(id => { const e=el(id); if(e) e.value=''; });
  const fm = el('rpt-fm'); if(fm) fm.value = '';
  _rptStatusFilter = '';
  rptRender();
}

// ══════════════════════════════════════════════════════════════════════════
// V6 WORKFLOW — Report stages, audit log, approval routing
// ══════════════════════════════════════════════════════════════════════════
var RPT_STAGES = ['Draft', 'Submitted', 'Reviewed', 'Approved', 'Archived'];
var RPT_STAGE_COLORS = {
  'Draft':     { bg:'rgba(127,140,170,.10)', fg:'var(--t2)',     accent:'#7f8caa' },
  'Submitted': { bg:'rgba(0,212,255,.10)',   fg:'var(--cyan)',   accent:'#00d4ff' },
  'Reviewed':  { bg:'rgba(167,139,250,.10)', fg:'var(--violet)', accent:'#a78bfa' },
  // Approved is the terminal "signed off / officially issued" state.
  // Green — matching the (green) checkmark in the Veritix shield — so the
  // stage badge reads as an official, passed stamp.
  'Approved':  { bg:'rgba(62,207,142,.10)',  fg:'var(--green)',  accent:'#3ecf8e' },
  'Archived':  { bg:'rgba(255,255,255,.04)', fg:'var(--t3)',     accent:'#5a6880' },
};
function getReportStage(r){ return r.stage || 'Draft'; }

// Migration: ensure every report has stage + auditLog. Infers stage from verdict if missing.
function migrateReportsWorkflow(){
  const all = ls(KEYS.reports, []);
  let changed = false;
  all.forEach(r => {
    if(!r.stage){
      // Infer: Acceptable verdict + signed → Approved; verdict set but no sign → Reviewed; else Draft
      if(r.verdict && r.verdict !== '— Select —' && r.signedAt) r.stage = 'Approved';
      else if(r.verdict && r.verdict !== '— Select —') r.stage = 'Reviewed';
      else r.stage = 'Draft';
      changed = true;
    }
    if(!Array.isArray(r.auditLog)) { r.auditLog = []; changed = true; }
  });
  if(changed) lss(KEYS.reports, all);
}

function addReportAudit(report, action, details){
  if(!Array.isArray(report.auditLog)) report.auditLog = [];
  report.auditLog.push({
    at: new Date().toISOString(),
    by: CURRENT_USER ? CURRENT_USER.name : 'System',
    byId: CURRENT_USER ? CURRENT_USER.id : null,
    action: action,
    details: details || ''
  });
}

// Move a report by index to a new stage. Records audit. Persists. Refreshes.
function setReportStage(idx, newStage, comment){
  const all = ls(KEYS.reports, []);
  const r = all[idx]; if(!r) return false;
  if(!RPT_STAGES.includes(newStage)) return false;
  const prev = getReportStage(r);
  if(prev === newStage) return false;
  r.stage = newStage;
  r.stageUpdatedAt = new Date().toISOString();
  addReportAudit(r, 'stage:'+newStage, comment ? `${prev} → ${newStage}: ${comment}` : `${prev} → ${newStage}`);
  lss(KEYS.reports, all);
  // Refresh whichever views are visible
  if(typeof rptRender === 'function') rptRender();
  if(typeof inboxRender === 'function') inboxRender();
  if(typeof updateReportCount === 'function') updateReportCount();
  return true;
}

// Bulk stage change
function setReportStageBulk(idxList, newStage){
  const all = ls(KEYS.reports, []);
  let count = 0;
  idxList.forEach(idx => {
    const r = all[idx]; if(!r) return;
    const prev = getReportStage(r);
    if(prev === newStage) return;
    r.stage = newStage;
    r.stageUpdatedAt = new Date().toISOString();
    addReportAudit(r, 'stage:'+newStage, `${prev} → ${newStage} (bulk)`);
    count++;
  });
  if(count) lss(KEYS.reports, all);
  return count;
}

// Time on current stage (ms since stageUpdatedAt; fall back to createdAt)
function timeOnStage(r){
  const t = r.stageUpdatedAt || r.createdAt;
  if(!t) return 0;
  return Date.now() - new Date(t).getTime();
}
function fmtDuration(ms){
  if(!ms || ms < 0) return '—';
  const days = Math.floor(ms / (1000*60*60*24));
  const hours = Math.floor(ms / (1000*60*60));
  if(days >= 1) return days + 'd';
  if(hours >= 1) return hours + 'h';
  const mins = Math.floor(ms / (1000*60));
  return mins + 'm';
}
// Returns 'fresh' / 'stale' / 'critical' based on time on stage relative to expected pace
function stageHealthy(r){
  const dys = timeOnStage(r) / (1000*60*60*24);
  // Drafts can sit forever; submitted/reviewed should move within a week
  if(getReportStage(r) === 'Draft' || getReportStage(r) === 'Approved' || getReportStage(r) === 'Archived') return 'fresh';
  if(dys < 3) return 'fresh';
  if(dys < 7) return 'stale';
  return 'critical';
}

// ══════════════════════════════════════════════════════════════════════════
// V6 INBOX — what needs my attention right now
// ══════════════════════════════════════════════════════════════════════════
function inboxBuild(){
  const me = CURRENT_USER;
  const reports = ls(KEYS.reports, []);
  const inspectors = ls(KEYS.inspectors, []);

  // 1. Reports awaiting my approval (I'm the named approver, OR I'm Admin/Senior and stage is Submitted/Reviewed and there is no specific approver)
  const awaitingApproval = reports.filter((r, idx) => {
    r._idx = idx;
    const stage = getReportStage(r);
    if(stage !== 'Submitted' && stage !== 'Reviewed') return false;
    if(!me) return false;
    // Explicit approver assignment
    if(r.approver && r.approver === me.name) return true;
    // Otherwise, only show to senior/admin roles
    if((me.role === 'Admin' || me.role === 'Senior') && (!r.approver || r.approver === me.name)) return true;
    return false;
  });

  // 2. My drafts (reports I created that haven't been submitted)
  const myDrafts = reports.filter((r, idx) => {
    r._idx = idx;
    if(!me) return false;
    if(getReportStage(r) !== 'Draft') return false;
    return r.inspector === me.name || r.createdBy === me.id;
  });

  // 3. Stale reports (any stage > 7 days, regardless of who owns)
  const stale = reports.filter((r, idx) => {
    r._idx = idx;
    return stageHealthy(r) === 'critical';
  });

  // 4. Cert expiry within 60 days — one entry per expiring method cert
  // (per-method certs mean an inspector can surface several rows).
  const now = Date.now();
  const sixtyDays = 60 * 24 * 60 * 60 * 1000;
  const certsExpiring = [];
  inspectors.forEach((ins, idx) => {
    (typeof _inspCertList === 'function' ? _inspCertList(ins) : []).forEach(c => {
      if(!c.expiry) return;
      const ms = new Date(c.expiry).getTime();
      if(isNaN(ms)) return;
      if((ms - now) < sixtyDays) certsExpiring.push({ ins, idx, cert: c });
    });
  });

  // 5. Calibration due — currently no equipment store; placeholder for future
  const calDue = []; // future hook

  return { awaitingApproval, myDrafts, stale, certsExpiring, calDue };
}

function inboxBadgeCount(){
  const me = CURRENT_USER;
  if(!me) return 0;
  const data = inboxBuild();
  // What deserves a badge: things needing the user's action today
  return data.awaitingApproval.length + data.certsExpiring.length;
}

function updateInboxBadge(){
  const pill = el('inbox-count-pill'); if(!pill) return;
  const n = inboxBadgeCount();
  if(n > 0){ pill.textContent = n; pill.style.display = 'inline-flex'; }
  else { pill.style.display = 'none'; }
}

function inboxRender(){
  const me = CURRENT_USER;
  const subEl = el('inbox-sub');
  if(subEl) subEl.textContent = me
    ? tf('inb.sub.hello', 'Hello {name} — what needs your attention right now', { name: me.name.split(' ')[0] })
    : t('inb.sub', 'What needs your attention right now');

  const data = inboxBuild();
  const summaryEl = el('inbox-summary');
  if(summaryEl){
    const tile = (count, label, urgent, iconSvg, iconBg, iconColor, sectionId, navTo) => `
      <div class="inbox-tile ${urgent==='attention'?'attention':urgent==='urgent'?'urgent':''}" data-action="_wInboxJumpToSection" data-args="'${sectionId}',${navTo?1:0}">
        <div class="inbox-tile-icon" style="background:${iconBg};color:${iconColor}">${iconSvg}</div>
        <div class="inbox-tile-body">
          <div class="inbox-tile-count">${count}</div>
          <div class="inbox-tile-label">${label}</div>
        </div>
      </div>`;
    summaryEl.innerHTML = [
      tile(data.awaitingApproval.length, t('inb.tile.approval','Awaiting your approval'), data.awaitingApproval.length>0?'attention':null,
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
        'rgba(0,212,255,.10)','var(--cyan)',
        'inbox-sec-approval', true),
      tile(data.myDrafts.length, t('inb.tile.drafts','Your drafts in progress'), null,
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        'rgba(127,140,170,.10)','var(--t2)',
        'inbox-sec-drafts', false),
      tile(data.stale.length, t('inb.tile.stale','Stale reports (7d+)'), data.stale.length>0?'urgent':null,
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        'rgba(242,92,92,.10)','var(--red)',
        'inbox-sec-stale', false),
      tile(data.certsExpiring.length, t('inb.tile.certs','Certs expiring (60d)'), data.certsExpiring.length>0?'attention':null,
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="9" cy="12" r="2.5"/><path d="M14 10h4"/><path d="M14 14h2.5"/></svg>',
        'rgba(245,166,35,.10)','var(--amber)',
        'inbox-sec-certs', false),
    ].join('');
  }

  const contentEl = el('inbox-content');
  if(!contentEl) return;
  let html = '';

  // ── Awaiting approval ──
  html += `<div class="inbox-section" id="inbox-sec-approval">
    <div class="inbox-section-head">
      <span class="inbox-section-title"><svg class="inbox-section-title-icon" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>${escapeHtml(t('inb.sec.approval','Awaiting your approval'))}</span>
      <span class="inbox-section-count">${data.awaitingApproval.length}</span>
    </div>`;
  if(data.awaitingApproval.length === 0){
    html += `<div class="inbox-empty"><div class="inbox-empty-icon">${vxShield({ size: 'lg' })}</div>${escapeHtml(t('inb.empty.approval','All clear — nothing waiting on you.'))}</div>`;
  } else {
    data.awaitingApproval.slice().sort((a,b) => timeOnStage(b) - timeOnStage(a)).forEach(r => {
      const md = NDT_METHODS.find(x => x.id === r.method);
      const stage = getReportStage(r);
      const sc = RPT_STAGE_COLORS[stage];
      const tt = timeOnStage(r);
      const tStr = fmtDuration(tt);
      const ageColor = stageHealthy(r) === 'critical' ? 'color:var(--red)' : stageHealthy(r) === 'stale' ? 'color:var(--amber)' : 'color:var(--t3)';
      html += `<div class="inbox-row">
        <div class="inbox-row-meta">
          <div class="inbox-row-primary">
            <span style="font-family:var(--mono);font-size:11px;color:var(--cyan);font-weight:600">${escapeHtml(r.reportNo||'—')}</span>
            <span style="font-family:var(--mono);font-size:10px;font-weight:700;background:${(md?.color||'#5a6880')+'1a'};color:${md?.color||'#5a6880'};padding:1px 6px;border-radius:3px">${r.method||'?'}</span>
            <span style="background:${sc.bg};color:${sc.fg};box-shadow:inset 0 0 0 1px ${sc.accent}33;font-size:10px;padding:2px 7px;border-radius:5px">${escapeHtml(tStage(stage))}</span>
            <span style="${ageColor};font-family:var(--mono);font-size:10px">${escapeHtml(tf('inb.row.on_stage','{t} on this stage',{t:tStr}))}</span>
          </div>
          <div class="inbox-row-secondary">${escapeHtml(r.subject || r.client || t('inb.row.no_subject','No subject'))} · ${escapeHtml(t('inb.row.inspector','Inspector'))}: ${escapeHtml(r.inspector||'—')}</div>
        </div>
        <div class="inbox-row-actions">
          <button class="btn btn-sm btn-primary" data-action="inboxApprove" data-args="${r._idx}">${escapeHtml(t('inb.btn.approve','Approve'))}</button>
          <button class="btn btn-sm btn-danger" data-action="inboxReject" data-args="${r._idx}">${escapeHtml(t('inb.btn.reject','Reject'))}</button>
          <button class="btn btn-sm" data-action="inboxOpenAudit" data-args="${r._idx}" title="${escapeHtml(t('inb.btn.view_history','View history'))}">⌕</button>
        </div>
      </div>`;
    });
  }
  html += `</div>`;

  // ── My drafts ──
  html += `<div class="inbox-section" id="inbox-sec-drafts">
    <div class="inbox-section-head">
      <span class="inbox-section-title"><svg class="inbox-section-title-icon" viewBox="0 0 24 24" fill="none" stroke="var(--t2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${escapeHtml(t('inb.sec.drafts','Your drafts'))}</span>
      <span class="inbox-section-count">${data.myDrafts.length}</span>
    </div>`;
  if(data.myDrafts.length === 0){
    html += `<div class="inbox-empty">${escapeHtml(t('inb.empty.drafts','No drafts in progress.'))}</div>`;
  } else {
    data.myDrafts.slice(-10).reverse().forEach(r => {
      const md = NDT_METHODS.find(x => x.id === r.method);
      html += `<div class="inbox-row">
        <div class="inbox-row-meta">
          <div class="inbox-row-primary">
            <span style="font-family:var(--mono);font-size:11px;color:var(--cyan);font-weight:600">${escapeHtml(r.reportNo||'—')}</span>
            <span style="font-family:var(--mono);font-size:10px;font-weight:700;background:${(md?.color||'#5a6880')+'1a'};color:${md?.color||'#5a6880'};padding:1px 6px;border-radius:3px">${r.method||'?'}</span>
          </div>
          <div class="inbox-row-secondary">${escapeHtml(r.subject || r.client || t('inb.row.no_subject','No subject'))} · ${fmtDate(r.createdAt)}</div>
        </div>
        <div class="inbox-row-actions">
          <button class="btn btn-sm btn-primary" data-action="inboxSubmit" data-args="${r._idx}">${escapeHtml(t('inb.btn.submit_review','Submit for review'))}</button>
          <button class="btn btn-sm" data-action="inboxOpenAudit" data-args="${r._idx}" title="${escapeHtml(t('inb.btn.view_history','View history'))}">⌕</button>
        </div>
      </div>`;
    });
  }
  html += `</div>`;

  // ── Stale reports ──
  html += `<div class="inbox-section" id="inbox-sec-stale">
    <div class="inbox-section-head">
      <span class="inbox-section-title"><svg class="inbox-section-title-icon" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${escapeHtml(t('inb.sec.stale','Stale (7+ days on stage)'))}</span>
      <span class="inbox-section-count">${data.stale.length}</span>
    </div>`;
  if(data.stale.length === 0){
    html += `<div class="inbox-empty"><div class="inbox-empty-icon">${vxShield({ size: 'lg' })}</div>${escapeHtml(t('inb.empty.stale','No stale reports.'))}</div>`;
  } else {
    data.stale.slice().sort((a,b) => timeOnStage(b) - timeOnStage(a)).slice(0, 12).forEach(r => {
      const md = NDT_METHODS.find(x => x.id === r.method);
      const stage = getReportStage(r);
      const sc = RPT_STAGE_COLORS[stage];
      html += `<div class="inbox-row">
        <div class="inbox-row-meta">
          <div class="inbox-row-primary">
            <span style="font-family:var(--mono);font-size:11px;color:var(--cyan);font-weight:600">${escapeHtml(r.reportNo||'—')}</span>
            <span style="font-family:var(--mono);font-size:10px;font-weight:700;background:${(md?.color||'#5a6880')+'1a'};color:${md?.color||'#5a6880'};padding:1px 6px;border-radius:3px">${r.method||'?'}</span>
            <span style="background:${sc.bg};color:${sc.fg};box-shadow:inset 0 0 0 1px ${sc.accent}33;font-size:10px;padding:2px 7px;border-radius:5px">${escapeHtml(tStage(stage))}</span>
            <span style="color:var(--red);font-family:var(--mono);font-size:10px">${escapeHtml(tf('inb.row.on_stage_short','{t} on stage',{t:fmtDuration(timeOnStage(r))}))}</span>
          </div>
          <div class="inbox-row-secondary">${escapeHtml(r.subject || r.client || t('inb.row.no_subject','No subject'))} · ${escapeHtml(r.inspector||'—')}</div>
        </div>
        <div class="inbox-row-actions">
          <button class="btn btn-sm" data-action="inboxOpenAudit" data-args="${r._idx}" title="${escapeHtml(t('inb.btn.view_history','View history'))}">${escapeHtml(t('inb.btn.view_history','View history'))}</button>
        </div>
      </div>`;
    });
  }
  html += `</div>`;

  // ── Cert expiry ──
  html += `<div class="inbox-section" id="inbox-sec-certs">
    <div class="inbox-section-head">
      <span class="inbox-section-title"><svg class="inbox-section-title-icon" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="9" cy="12" r="2.5"/></svg>${escapeHtml(t('inb.sec.certs','Certifications expiring within 60 days'))}</span>
      <div style="display:flex;align-items:center;gap:8px">
        ${data.certsExpiring.length ? `<button class="btn btn-sm" data-action="generateIcsForCerts" title="${escapeHtml(t('inb.btn.export_ics_tip','Download an .ics file with cert expiry events for Outlook/Google/Apple Calendar'))}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:4px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${escapeHtml(t('inb.btn.export_ics','Export .ics'))}</button>` : ''}
        <span class="inbox-section-count">${data.certsExpiring.length}</span>
      </div>
    </div>`;
  if(data.certsExpiring.length === 0){
    html += `<div class="inbox-empty">${escapeHtml(t('inb.empty.certs','No certifications expiring soon.'))}</div>`;
  } else {
    data.certsExpiring.forEach(({ins, cert}) => {
      const days = Math.round((new Date(cert.expiry).getTime() - Date.now()) / (1000*60*60*24));
      const expired = days < 0;
      html += `<div class="inbox-row">
        <div class="inbox-row-meta">
          <div class="inbox-row-primary">
            <span style="color:var(--t1);font-weight:500">${escapeHtml(ins.name||'—')}</span>
            <span style="font-family:var(--mono);font-size:10px;color:var(--t3)">${escapeHtml(cert.method)}${cert.certNo?' · '+escapeHtml(cert.certNo):''}</span>
          </div>
          <div class="inbox-row-secondary">
            ${expired
              ? `<span style="color:var(--red);font-weight:500">${escapeHtml(tf('inb.row.expired_ago','EXPIRED {n} day(s) ago',{n:Math.abs(days)}))}</span>`
              : `${escapeHtml(tf('inb.row.expires','Expires {date}',{date:fmtDate(cert.expiry)}))} · <span style="color:${days<14?'var(--red)':'var(--amber)'};font-family:var(--mono);font-size:10px">${escapeHtml(tf('inb.row.days_left','{n} day(s)',{n:days}))}</span>`
            }
          </div>
        </div>
        <div class="inbox-row-actions">
          <button class="btn btn-sm" data-action="_wOpenInspectorsSettings">${escapeHtml(t('inb.btn.open_inspectors','Open inspectors'))}</button>
        </div>
      </div>`;
    });
  }
  html += `</div>`;

  contentEl.innerHTML = html;
  updateInboxBadge();
}

// Approval actions
async function inboxApprove(idx){
  // Approval is gated to Admin or Senior. The UI only shows the Approve
  // button to those roles, but the action-level guard protects against
  // direct calls (e.g. from console or stale UI). Backend will enforce
  // this independently when it lands.
  if(!vxIsSeniorOrAdmin()){
    toast(t('toast.approver_required', 'Senior Inspector or Admin role required to approve.'), 'error');
    return;
  }
  if(!await vxConfirm({ message: t('inb.confirm.approve','Are you sure you want to approve this report?'), okLabel: t('vxc.approve','Approve') })) return;
  if(setReportStage(idx, 'Approved', '')){
    toast(t('toast.report_approved','Report approved.'), 'success');
    inboxRender();
  }
}
async function inboxReject(idx){
  if(!vxIsSeniorOrAdmin()){
    toast(t('toast.approver_required', 'Senior Inspector or Admin role required to approve.'), 'error');
    return;
  }
  const reason = await vxPrompt({
    title: t('inb.reject.title','Reject report'),
    message: t('inb.prompt.reject','Reason for rejection (will be added to the audit log):'),
    inputType: 'textarea',
    okLabel: t('inb.reject.ok','Send back to Draft'),
  });
  if(reason === null) return;
  // Move back to Draft, attach reason
  if(setReportStage(idx, 'Draft', reason || '')){
    toast(t('toast.report_back_to_draft','Report sent back to Draft with comment.'), 'success');
    inboxRender();
  }
}
function inboxSubmit(idx){
  if(setReportStage(idx, 'Submitted', '')){
    toast(t('toast.submitted_review','Submitted for review.'), 'success');
    inboxRender();
  }
}

// Audit log modal
function inboxOpenAudit(idx){
  const r = ls(KEYS.reports, [])[idx];
  if(!r) return;
  const log = (r.auditLog||[]).slice().reverse();
  let modal = document.getElementById('inbox-audit-modal');
  if(modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'inbox-audit-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)';
  modal.onclick = e => { if(e.target === modal) modal.remove(); };
  let logHtml = '';
  if(!log.length) logHtml = '<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">No audit history yet.</div>';
  else logHtml = log.map(entry => `
    <div style="padding:11px 16px;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:flex-start">
      <div style="width:8px;height:8px;border-radius:50%;background:${entry.action.startsWith('stage:Approved')?'var(--red)':entry.action.startsWith('stage:Draft')?'var(--t3)':'var(--cyan)'};margin-top:6px;flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:var(--t1)"><strong>${escapeHtml(entry.by||'—')}</strong> · ${escapeHtml(entry.action||'')}</div>
        ${entry.details?`<div style="font-size:12px;color:var(--t2);margin-top:3px;font-style:italic">"${escapeHtml(entry.details)}"</div>`:''}
        <div style="font-size:10px;color:var(--t3);font-family:var(--mono);margin-top:4px">${fmtDate(entry.at)} · ${new Date(entry.at).toLocaleTimeString()}</div>
      </div>
    </div>`).join('');
  modal.innerHTML = `<div style="background:var(--panel);border:1px solid var(--border2);border-radius:14px;width:560px;max-width:96vw;max-height:75vh;display:flex;flex-direction:column;box-shadow:var(--sh-xl);overflow:hidden">
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:14px;font-weight:600;color:var(--t1)">Audit history</div>
        <div style="font-size:11px;color:var(--t3);font-family:var(--mono);margin-top:2px">${escapeHtml(r.reportNo||'')} — ${log.length} event${log.length!==1?'s':''}</div>
      </div>
      <button class="btn btn-sm" data-action="_wRemoveById" data-args="\'inbox-audit-modal\'">Close</button>
    </div>
    <div style="overflow-y:auto;flex:1">${logHtml}</div>
  </div>`;
  document.body.appendChild(modal);
  openA11yModal(modal);
}

// ══════════════════════════════════════════════════════════════════════════
// V7 FIELD-FIRST — photo capture, voice notes, sidebar collapse,
//                  offline indicator, capture wizard, barcode scanning
// ══════════════════════════════════════════════════════════════════════════

// ── Photo capture with EXIF preservation ─────────────────────
// Stored as data URLs in the defect record under `photos` array.
// Browser preserves EXIF when reading via FileReader on mobile camera input.
var _defPhotos = [];   // working list for the open form

// V14: photos route through IndexedDB (or remote upload if authenticated).
// The defect record stores { photoId, remoteUrl, name, ... } — NOT base64
// data — so a single record stays small enough for localStorage / sync.
// Rendering paths (defRenderPhotos, defOpenPhotoView, PDF embed) resolve
// the photoId/remoteUrl to an object URL on demand.
async function defAttachPhotos(input){
  if(!input.files || !input.files.length) return;
  const files = Array.from(input.files);
  input.value = '';

  for(const file of files) {
    if(!file.type.startsWith('image/')) continue;
    if(file.size > 25 * 1024 * 1024) {
      toast(tf('photos.too_large','Photo "{name}" is over 25 MB — skipped.',{name:file.name}), 'warn');
      continue;
    }
    try {
      // Read as data URL for EXIF + base64-or-blob storage
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = e => res(e.target.result);
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file);
      });
      const photo = {
        // Legacy field — kept temporarily for back-compat with code paths that
        // still expect `.data`. Will become null once those paths are migrated.
        data: dataUrl,
        name: file.name,
        size: file.size,
        type: file.type,
        capturedAt: new Date(file.lastModified || Date.now()).toISOString(),
      };
      // EXIF best-effort (orientation, GPS, datetime)
      await new Promise(resolve => tryExtractExif(file, exif => {
        if(exif) Object.assign(photo, exif);
        resolve();
      }));
      // V14: upload to cloud if authenticated, otherwise store in IDB.
      // Either way, the record stores { photoId, remoteUrl } and drops the
      // huge base64 blob.
      try {
        const result = await vxUploadPhoto(file, { name: file.name, exifDateTime: photo.exifDateTime });
        photo.photoId  = result.photoId;
        photo.remoteUrl = result.remoteUrl;
        // Once we have a remoteUrl OR a photoId pointing to IDB, drop .data
        // from the persisted record to save space. We keep it on the in-memory
        // _defPhotos[] entry so the form preview can show the thumbnail
        // immediately without an extra IDB read.
        if(result.photoId || result.remoteUrl) {
          // Mark .data as "transient" — sync-time serializer will strip it
          photo._transient = true;
        }
      } catch(e) {
        console.warn('Photo storage failed, keeping inline:', e);
      }
      _defPhotos.push(photo);
      defRenderPhotos();
    } catch(e) {
      vxReportError(e, 'defAttachPhotos');
    }
  }
}

function tryExtractExif(file, cb){
  // Lightweight EXIF extraction — reads only the first 64KB looking for GPS + DateTime tags.
  // Robust enough for "did the phone tag this photo?" but not a full library.
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const view = new DataView(e.target.result);
      if(view.getUint16(0, false) !== 0xFFD8){ cb(null); return; } // not JPEG
      let offset = 2;
      const length = view.byteLength;
      let exif = {};
      while(offset < length){
        if(view.getUint16(offset, false) === 0xFFE1){
          // APP1 (EXIF) marker
          const exifLen = view.getUint16(offset+2, false);
          const exifStart = offset + 4;
          // Look for ASCII "Exif\0\0"
          if(view.getUint32(exifStart, false) === 0x45786966){
            const tiffStart = exifStart + 6;
            const little = view.getUint16(tiffStart, false) === 0x4949;
            const ifd0Offset = view.getUint32(tiffStart + 4, little);
            const ifd0Start = tiffStart + ifd0Offset;
            const ifd0Entries = view.getUint16(ifd0Start, little);
            for(let i = 0; i < ifd0Entries; i++){
              const entryStart = ifd0Start + 2 + i * 12;
              const tag = view.getUint16(entryStart, little);
              if(tag === 0x9003 || tag === 0x9004){ // DateTimeOriginal / DateTimeDigitized
                const valOffset = view.getUint32(entryStart + 8, little);
                const dStart = tiffStart + valOffset;
                let str = '';
                for(let j = 0; j < 19; j++) str += String.fromCharCode(view.getUint8(dStart + j));
                exif.exifDateTime = str.trim();
              }
              if(tag === 0x8825){ // GPS IFD pointer — defer (would need more parsing)
                exif.hasGps = true;
              }
            }
          }
          break;
        }
        const sectLen = view.getUint16(offset+2, false);
        offset += 2 + sectLen;
        if(offset > 65000) break; // safety
      }
      cb(Object.keys(exif).length ? exif : null);
    } catch(err) {
      cb(null);
    }
  };
  reader.readAsArrayBuffer(file.slice(0, 64 * 1024));
}

function defRenderPhotos(){
  const wrap = el('def-photos'); if(!wrap) return;
  // Keep the add button as the last child
  const addBtn = wrap.querySelector('.photo-attach-add');
  wrap.innerHTML = '';
  _defPhotos.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'photo-attach-thumb';
    div.style.backgroundImage = `url("${p.data}")`;
    div.title = (p.name || 'Photo') + (p.exifDateTime ? ' · ' + p.exifDateTime : '') + (p.hasGps ? ' · GPS' : '');
    div.onclick = () => defOpenPhotoView(p);
    const meta = document.createElement('span');
    meta.className = 'photo-attach-thumb-meta';
    meta.textContent = (p.hasGps ? '📍 ' : '') + (p.size ? Math.round(p.size/1024) + 'k' : '');
    div.appendChild(meta);
    const x = document.createElement('button');
    x.className = 'photo-attach-thumb-remove';
    x.textContent = '×';
    x.onclick = e => { e.stopPropagation(); _defPhotos.splice(idx, 1); defRenderPhotos(); };
    div.appendChild(x);
    wrap.appendChild(div);
  });
  if(addBtn) wrap.appendChild(addBtn);
  else {
    const lbl = document.createElement('label');
    lbl.className = 'photo-attach-add';
    lbl.htmlFor = 'def-photo-input';
    lbl.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><span>Add photo</span>';
    wrap.appendChild(lbl);
  }
}

function defOpenPhotoView(photo){
  let modal = document.getElementById('def-photo-modal');
  if(modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'def-photo-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px';
  // Click-outside-to-close (but not on the inner card)
  modal.onclick = e => { if(e.target === modal) modal.remove(); };
  // Save/cancel buttons need access to canvas state; store on the modal element.
  modal._photo = photo;
  modal._annotations = Array.isArray(photo.annotations) ? photo.annotations.slice() : [];
  modal._mode = 'view';   // 'view' | 'arrow' | 'circle' | 'text'
  modal.innerHTML = `<div style="position:relative;display:flex;flex-direction:column;max-width:96vw;max-height:96vh;gap:10px">
    <!-- Toolbar -->
    <div style="display:flex;gap:8px;align-items:center;background:var(--panel);border:1px solid var(--border2);border-radius:var(--r2);padding:8px 12px;box-shadow:var(--sh-md)">
      <span style="font-size:11px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em;margin-right:4px">Annotate:</span>
      <button class="btn btn-sm" data-mode="arrow"  data-action="defAnnotMode" data-args="'arrow'"  style="font-size:12px">↗ Arrow</button>
      <button class="btn btn-sm" data-mode="circle" data-action="defAnnotMode" data-args="'circle'" style="font-size:12px">⊙ Circle</button>
      <button class="btn btn-sm" data-mode="text"   data-action="defAnnotMode" data-args="'text'"   style="font-size:12px">T Label</button>
      <span style="width:1px;height:18px;background:var(--border2);margin:0 4px"></span>
      <button class="btn btn-sm" data-action="defAnnotUndo" title="Remove last annotation" style="font-size:12px">↶ Undo</button>
      <button class="btn btn-sm btn-danger" data-action="defAnnotClear" style="font-size:12px">Clear all</button>
      <span style="flex:1"></span>
      <button class="btn btn-sm btn-primary" data-action="defAnnotSave" style="font-size:12px">Save annotations</button>
      <button class="btn btn-sm" data-action="_wRemoveById" data-args="\'def-photo-modal\'" style="font-size:12px">Close</button>
    </div>
    <!-- Stage -->
    <div id="def-photo-stage" style="position:relative;display:inline-block;align-self:center">
      <img id="def-photo-img" src="${photo.data}" alt="Defect photo${photo.name?': '+escapeHtml(photo.name):''}" loading="lazy" style="max-width:90vw;max-height:78vh;border-radius:8px;display:block"/>
      <canvas id="def-photo-canvas" style="position:absolute;inset:0;width:100%;height:100%;cursor:crosshair"></canvas>
    </div>
    <!-- Footer -->
    <div style="display:flex;align-items:center;background:rgba(0,0,0,.6);color:#fff;font-family:var(--mono);font-size:11px;padding:6px 12px;border-radius:6px;align-self:center;max-width:90vw;flex-wrap:wrap;gap:10px">
      <span>${escapeHtml(photo.name||'photo')}</span>
      ${photo.exifDateTime?`<span style="opacity:.7">·</span><span>${escapeHtml(photo.exifDateTime)}</span>`:''}
      ${photo.hasGps?'<span style="opacity:.7">·</span><span>📍 GPS embedded</span>':''}
      <span style="opacity:.7">·</span>
      <span id="def-annot-count">${modal._annotations.length} annotation${modal._annotations.length!==1?'s':''}</span>
    </div>
  </div>`;
  document.body.appendChild(modal);
  openA11yModal(modal);
  // Wait for image to load to size the canvas
  const img = modal.querySelector('#def-photo-img');
  const canvas = modal.querySelector('#def-photo-canvas');
  const sync = () => {
    canvas.width = img.naturalWidth || img.clientWidth;
    canvas.height = img.naturalHeight || img.clientHeight;
    defAnnotRedraw();
  };
  if(img.complete) sync();
  else img.addEventListener('load', sync);
  // Drawing handlers — coordinates are normalized 0–1 so they survive resize.
  let drawing = null;
  canvas.addEventListener('mousedown', async e => {
    if(modal._mode === 'view') return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if(modal._mode === 'arrow' || modal._mode === 'circle'){
      drawing = { mode: modal._mode, x1:x, y1:y, x2:x, y2:y };
    } else if(modal._mode === 'text'){
      const label = await vxPrompt({ message: t('def.annot.label_prompt','Label text:'), defaultValue: 'D'+(modal._annotations.length+1) });
      if(label !== null) {
        modal._annotations.push({ mode:'text', x, y, text: label });
        defAnnotRedraw();
      }
    }
  });
  canvas.addEventListener('mousemove', e => {
    if(!drawing) return;
    const rect = canvas.getBoundingClientRect();
    drawing.x2 = (e.clientX - rect.left) / rect.width;
    drawing.y2 = (e.clientY - rect.top) / rect.height;
    defAnnotRedraw(drawing);
  });
  canvas.addEventListener('mouseup', () => {
    if(!drawing) return;
    modal._annotations.push(drawing);
    drawing = null;
    defAnnotRedraw();
  });
  // Initial render
  defAnnotMode('view');
}
function defAnnotMode(mode){
  const modal = document.getElementById('def-photo-modal'); if(!modal) return;
  modal._mode = mode;
  modal.querySelectorAll('button[data-mode]').forEach(b => {
    b.classList.toggle('btn-primary', b.dataset.mode === mode);
  });
  const canvas = document.getElementById('def-photo-canvas');
  if(canvas) canvas.style.cursor = (mode === 'view') ? 'default' : 'crosshair';
}
function defAnnotRedraw(preview){
  const modal = document.getElementById('def-photo-modal'); if(!modal) return;
  const canvas = document.getElementById('def-photo-canvas'); if(!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const all = modal._annotations.concat(preview ? [preview] : []);
  all.forEach((a, i) => {
    ctx.save();
    ctx.lineWidth = Math.max(2, canvas.width / 300);
    ctx.font = `${Math.max(14, canvas.width/40)}px sans-serif`;
    ctx.strokeStyle = '#f25c5c';
    ctx.fillStyle = '#f25c5c';
    if(a.mode === 'arrow'){
      const x1 = a.x1*canvas.width, y1 = a.y1*canvas.height;
      const x2 = a.x2*canvas.width, y2 = a.y2*canvas.height;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      // Arrowhead
      const ang = Math.atan2(y2-y1, x2-x1);
      const head = Math.max(10, canvas.width/60);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head*Math.cos(ang - Math.PI/6), y2 - head*Math.sin(ang - Math.PI/6));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head*Math.cos(ang + Math.PI/6), y2 - head*Math.sin(ang + Math.PI/6));
      ctx.stroke();
    } else if(a.mode === 'circle'){
      const x1 = a.x1*canvas.width, y1 = a.y1*canvas.height;
      const x2 = a.x2*canvas.width, y2 = a.y2*canvas.height;
      const cx = (x1+x2)/2, cy = (y1+y2)/2;
      const rx = Math.abs(x2-x1)/2, ry = Math.abs(y2-y1)/2;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 2*Math.PI); ctx.stroke();
    } else if(a.mode === 'text'){
      const x = a.x*canvas.width, y = a.y*canvas.height;
      const padding = 6;
      const txt = a.text||'';
      const m = ctx.measureText(txt);
      const w = m.width + padding*2;
      const h = parseInt(ctx.font) + padding;
      ctx.fillStyle = '#f25c5c';
      ctx.fillRect(x - w/2, y - h/2, w, h);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, x, y);
    }
    ctx.restore();
  });
  // Update annotation count label
  const lbl = document.getElementById('def-annot-count');
  if(lbl) lbl.textContent = modal._annotations.length + ' annotation' + (modal._annotations.length !== 1 ? 's' : '');
}
function defAnnotUndo(){
  const modal = document.getElementById('def-photo-modal'); if(!modal) return;
  modal._annotations.pop();
  defAnnotRedraw();
}
async function defAnnotClear(){
  const modal = document.getElementById('def-photo-modal'); if(!modal) return;
  if(modal._annotations.length && !(await vxConfirm({ message: 'Are you sure you want to remove all annotations from this defect?', okLabel: t('vxc.remove','Remove'), danger: true }))) return;
  modal._annotations = [];
  defAnnotRedraw();
}
function defAnnotSave(){
  const modal = document.getElementById('def-photo-modal'); if(!modal) return;
  const photo = modal._photo;
  // Find the photo in _defPhotos and update annotations
  const i = _defPhotos.indexOf(photo);
  if(i >= 0){
    _defPhotos[i] = Object.assign({}, photo, { annotations: modal._annotations.slice() });
  }
  modal.remove();
  if(typeof defRenderPhotos === 'function') defRenderPhotos();
  toast(t('toast.annotations_saved','Annotations saved.'), 'success');
}

// ── Voice notes via Web Speech API ────────────────────────────
var _voiceRecognition = null;
var _voiceTargetField = null;
var _voiceBtn = null;

function voiceToggle(fieldId, btn){
  if(_voiceRecognition){
    // Stop active recording
    try { _voiceRecognition.stop(); } catch(e){}
    return;
  }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!Recognition){
    toast(t('toast.voice_unsupported', 'Voice recognition not supported in this browser.'), 'error');
    return;
  }
  const target = document.getElementById(fieldId);
  if(!target) return;
  _voiceTargetField = target;
  _voiceBtn = btn;
  const r = new Recognition();
  r.lang = 'en';
  r.continuous = true;
  r.interimResults = true;
  let baseline = target.value;
  if(baseline && !baseline.endsWith(' ') && !baseline.endsWith('\n')) baseline += ' ';
  r.onstart = () => {
    btn.classList.add('recording');
    toast(t('toast.mic_listening','Listening — speak naturally. Tap mic again to stop.'), 'info');
  };
  r.onresult = ev => {
    let final = '', interim = '';
    for(let i = ev.resultIndex; i < ev.results.length; i++){
      const txt = ev.results[i][0].transcript;
      if(ev.results[i].isFinal) final += txt + ' ';
      else interim += txt;
    }
    target.value = baseline + final + interim;
    if(final){ baseline += final; target.dispatchEvent(new Event('input')); }
  };
  r.onerror = ev => {
    if(ev.error === 'no-speech') return;
    if(ev.error === 'not-allowed'){ toast(t('toast.mic_denied','Microphone permission denied.'), 'error'); }
    else toast(tf('toast.voice_error','Voice error: {msg}', {msg: ev.error}), 'error');
  };
  r.onend = () => {
    if(_voiceBtn) _voiceBtn.classList.remove('recording');
    _voiceRecognition = null;
    _voiceTargetField = null;
    _voiceBtn = null;
  };
  r.start();
  _voiceRecognition = r;
}

// ── Sidebar collapse toggle ────────────────────────────────────
function toggleSidebar(){
  const html = document.documentElement;
  const collapsed = html.getAttribute('data-sidebar-collapsed') === 'true';
  if(collapsed) html.removeAttribute('data-sidebar-collapsed');
  else html.setAttribute('data-sidebar-collapsed', 'true');
  try { localStorage.setItem('vx-sidebar-collapsed-v1', collapsed ? '0' : '1'); } catch(e){}
}
function loadSidebarState(){
  try {
    const v = localStorage.getItem('vx-sidebar-collapsed-v1');
    if(v === '1') document.documentElement.setAttribute('data-sidebar-collapsed', 'true');
  } catch(e){}
}

// ── Online/offline indicator ──────────────────────────────────
function updateOnlineStatus(){
  const sig = document.querySelector('.signal');
  if(!sig) return;
  if(navigator.onLine){
    sig.classList.remove('offline');
    const lbl = el('report-count-label');
    if(lbl && lbl.textContent.includes('offline')) updateReportCount();
  } else {
    sig.classList.add('offline');
    const lbl = el('report-count-label');
    if(lbl) lbl.textContent = 'offline — changes will sync';
  }
}
window.addEventListener('online', () => { updateOnlineStatus(); toast(t('toast.back_online','Back online — changes will sync.'), 'success'); });
window.addEventListener('offline', () => { updateOnlineStatus(); toast(t('toast.offline_mode','You are offline — work continues and will sync when reconnected.'), 'warn'); });

// V9: Ctrl+B / Cmd+B to toggle sidebar collapse
document.addEventListener('keydown', e => {
  if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b'){
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    toggleSidebar();
  }
});

// ── Capture mode wizard ────────────────────────────────────────
// Wraps the new-report form in a step-by-step layout for tablet inspectors.
var _wizardStep = 0;
var _wizardSteps = [];   // Each step: { fields: [...], title, help }
var _wizardMethod = null;

function captureWizardStart(){
  if(!_ovMethod) { toast(t('toast.pick_method', 'Pick a method first.'), 'error'); return; }
  _wizardMethod = _ovMethod;
  // Group fields into wizard steps
  const m = NDT_METHODS.find(x => x.id === _ovMethod); if(!m) return;
  const specific = (TPL_FIELDS[_ovMethod] || []).map(f => ({...f, id:'eq_'+f.id}));
  _wizardSteps = [
    { title: t('wiz.client_title','Client & project'),  help: t('wiz.client_help','Who is this inspection for?'), fields: RPT_FORM.client },
    { title: t('wiz.subject_title','Subject of inspection'), help: t('wiz.subject_help','What is being inspected?'), fields: RPT_FORM.subject },
    { title: t('wiz.exam_title','Examination details'),  help: t('wiz.exam_help','When, where, with what.'), fields: RPT_FORM.exam },
    { title: t('wiz.method_title','Method-specific data'),  help: tf('wiz.method_help','{method} — equipment, technique, parameters.', {method: m.id}), fields: specific.length ? specific : [] },
    { title: t('wiz.result_title','Result & verdict'),  help: t('wiz.result_help','Findings, acceptance, sign-off.'), fields: RPT_FORM.result },
  ].filter(s => s.fields && s.fields.length);
  _wizardStep = 0;
  let overlay = document.getElementById('capture-wizard');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'capture-wizard';
    overlay.className = 'capture-wizard-overlay';
    overlay.innerHTML = `
      <div class="capture-wizard-head">
        <button class="btn btn-sm" data-action="captureWizardClose">Exit</button>
        <span class="capture-wizard-step-counter" id="cw-step-counter">Step 1 of 5</span>
        <div class="capture-wizard-progress"><div class="capture-wizard-progress-fill" id="cw-progress" style="width:0%"></div></div>
      </div>
      <div class="capture-wizard-body" id="cw-body"></div>
      <div class="capture-wizard-foot">
        <button class="btn" id="cw-back" data-action="captureWizardBack">← Back</button>
        <button class="btn btn-primary" id="cw-next" data-action="captureWizardNext">Next →</button>
      </div>`;
    document.body.appendChild(overlay);
  }
  overlay.classList.add('open');
  captureWizardRenderStep();
}

function captureWizardRenderStep(){
  const step = _wizardSteps[_wizardStep]; if(!step) return;
  const body = el('cw-body'); if(!body) return;
  const counter = el('cw-step-counter');
  const progress = el('cw-progress');
  const back = el('cw-back');
  const next = el('cw-next');
  if(counter) counter.textContent = `Step ${_wizardStep+1} of ${_wizardSteps.length}`;
  if(progress) progress.style.width = (((_wizardStep+1) / _wizardSteps.length) * 100) + '%';
  if(back) back.disabled = (_wizardStep === 0);
  if(next) next.textContent = (_wizardStep === _wizardSteps.length - 1) ? 'Save report' : 'Next →';

  const m = _wizardMethod;
  let fldHtml = '';
  (step.fields || []).forEach(f => {
    const id = `rf-${m}-${f.id}`;
    // Try to read the existing value from the underlying form (so multi-step preserves state)
    const existing = el(id) ? el(id).value : '';
    const hasMic = f.type !== 'select' && (f.id.includes('remarks') || f.id.includes('notes') || f.id.includes('description'));
    if(f.type === 'select'){
      fldHtml += `<div class="fld capture-wizard-fld" style="margin-bottom:14px"><label>${escapeHtml(f.label)}</label><select data-on-change="_wCaptureWizardSetValue" data-pass-el="1" data-args="'${id}'">`;
      (f.options || []).forEach(o => { fldHtml += `<option ${o===existing?'selected':''}>${escapeHtml(o)}</option>`; });
      fldHtml += '</select></div>';
    } else if(f.type === 'date'){
      fldHtml += `<div class="fld capture-wizard-fld" style="margin-bottom:14px"><label>${escapeHtml(f.label)}</label><input type="date" value="${escapeHtml(existing)}" data-on-change="_wCaptureWizardSetValue" data-pass-el="1" data-args="'${id}'"/></div>`;
    } else if(hasMic){
      fldHtml += `<div class="fld capture-wizard-fld voice-wrap-textarea" style="margin-bottom:14px"><label>${escapeHtml(f.label)}</label><textarea rows="3" id="cwfld-${f.id}" data-on-input="_wCaptureWizardSetValue" data-pass-el="1" data-args="'${id}'" placeholder="${escapeHtml(f.placeholder||'')}" style="padding-right:46px">${escapeHtml(existing)}</textarea><button type="button" class="voice-mic-btn" data-action="voiceToggle" data-pass-el="1" data-args="'cwfld-${f.id}'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></button></div>`;
    } else {
      fldHtml += `<div class="fld capture-wizard-fld" style="margin-bottom:14px"><label>${escapeHtml(f.label)}</label><input value="${escapeHtml(existing)}" data-on-input="_wCaptureWizardSetValue" data-pass-el="1" data-args="'${id}'" placeholder="${escapeHtml(f.placeholder||'')}"/></div>`;
    }
  });
  body.innerHTML = `<div class="capture-wizard-card">
    <div class="capture-wizard-step-title">${escapeHtml(step.title)}</div>
    <div class="capture-wizard-step-help">${escapeHtml(step.help)}</div>
    ${fldHtml}
  </div>`;
}
function captureWizardSetVal(targetId, val){
  const t = el(targetId);
  if(t) t.value = val;
}
function captureWizardNext(){
  if(_wizardStep < _wizardSteps.length - 1){
    _wizardStep++;
    captureWizardRenderStep();
    el('cw-body').scrollTop = 0;
  } else {
    // Save the report through the existing path
    captureWizardClose();
    if(typeof ovSaveReport === 'function') ovSaveReport();
  }
}
function captureWizardBack(){
  if(_wizardStep > 0){
    _wizardStep--;
    captureWizardRenderStep();
  }
}
function captureWizardClose(){
  const overlay = document.getElementById('capture-wizard');
  if(overlay) overlay.classList.remove('open');
}

// ── Barcode scanner ────────────────────────────────────────────
var _barcodeStream = null;
var _barcodeInterval = null;
var _barcodeTargetInput = null;

async function barcodeOpen(targetFieldId){
  _barcodeTargetInput = targetFieldId;
  let overlay = document.getElementById('barcode-overlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'barcode-overlay';
    overlay.className = 'barcode-scan-overlay';
    overlay.innerHTML = `<div class="barcode-scan-frame">
      <div class="barcode-scan-overlay-frame">
        <video id="barcode-video" class="barcode-scan-video" autoplay muted playsinline></video>
        <div class="barcode-scan-target"></div>
      </div>
      <div class="barcode-scan-foot">
        <span style="font-size:12px;color:var(--t3)">Align the code in the cyan frame.</span>
        <button class="btn btn-sm" data-action="barcodeClose">Cancel</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
  }
  overlay.classList.add('open');
  if(!('BarcodeDetector' in window)){
    overlay.querySelector('.barcode-scan-foot span').innerHTML = '<span style="color:var(--amber)">⚠ Barcode detection not supported in this browser. Use a recent Chrome/Edge.</span>';
    return;
  }
  try {
    _barcodeStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    el('barcode-video').srcObject = _barcodeStream;
    const detector = new window.BarcodeDetector({ formats: ['code_128','code_39','ean_13','ean_8','qr_code','data_matrix','upc_a','upc_e'] });
    _barcodeInterval = setInterval(async () => {
      try {
        const codes = await detector.detect(el('barcode-video'));
        if(codes && codes.length){
          const value = codes[0].rawValue;
          barcodeClose();
          if(_barcodeTargetInput){
            const t = document.getElementById(_barcodeTargetInput);
            if(t){ t.value = value; t.dispatchEvent(new Event('input')); }
          }
          toast(tf('toast.scanned','Scanned: {value}', {value}), 'success');
        }
      } catch(e){}
    }, 400);
  } catch(e){
    toast(t('toast.camera_denied','Camera access denied or unavailable.'), 'error');
    barcodeClose();
  }
}
function barcodeClose(){
  const overlay = document.getElementById('barcode-overlay');
  if(overlay) overlay.classList.remove('open');
  if(_barcodeInterval){ clearInterval(_barcodeInterval); _barcodeInterval = null; }
  if(_barcodeStream){ _barcodeStream.getTracks().forEach(t => t.stop()); _barcodeStream = null; }
  _barcodeTargetInput = null;
}

