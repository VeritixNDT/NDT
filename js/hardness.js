// ══════════════════════════════════════════════════════════════════════════
// HARDNESS SURVEY (HT) — shared data model, visual renderer and report-form
// data-entry grid. ONE renderer (htRenderSurvey) feeds both the on-screen form
// preview AND the sealed PDF (via the editor's 'ht-survey' block). Print/light
// palette: the PDF is a white page, so the chart is dark-ink-on-white.
//
// Two modes:
//   weld-traverse  rows (Cap/Mid/Root) of positional points (mm from CL) across
//                  PM / HAZ / Weld / HAZ / PM  (lab macro, ISO 9015-1)
//   site-piping    5 surface zones Material·HAZ·Weld·HAZ·Material, from the top
//                  of the weld
// Every point/zone holds 3 readings; the AVERAGE is the reported & plotted value.
// ══════════════════════════════════════════════════════════════════════════

function htAvg(r){
  var v = (r || []).map(function(x){ return parseFloat(x); }).filter(function(x){ return !isNaN(x); });
  if(!v.length) return null;
  return Math.round(v.reduce(function(s,x){ return s+x; }, 0) / v.length * 10) / 10;
}
// Site clock positions by pipe diameter (the survey is repeated at each clock
// position around the bore; the reported value per point is their average):
//   ≤ 6"   → 12 o'clock only
//   6–12"  → 4 and 8 o'clock
//   > 12"  → 12, 4 and 8 o'clock
function htSiteClocks(survey){
  var b = survey && survey.bore;
  if(b === 'small') return ['12H'];
  if(b === 'medium') return ['04H','08H'];
  return ['12H','04H','08H'];   // large (> 12")
}
// Human labels for the active clock set — reused by caption + drawing.
function htBoreClocksText(survey){
  var b = survey && survey.bore;
  if(b === 'small') return '12 o’clock';
  if(b === 'medium') return '4 / 8 o’clock';
  return '12 / 4 / 8 o’clock';
}
function htBoreSizeText(survey){
  var b = survey && survey.bore;
  if(b === 'small') return 'Ø ≤ 6″';
  if(b === 'medium') return 'Ø 6–12″';
  return 'Ø > 12″';
}
function htSiteAvg(pt, clocks){
  var c = clocks || ['12H','04H','08H'];
  var v = c.map(function(k){ return pt.clock ? pt.clock[k] : null; }).map(function(x){ return parseFloat(x); }).filter(function(x){ return !isNaN(x); });
  if(!v.length) return null;
  return Math.round(v.reduce(function(s,x){ return s+x; }, 0) / v.length * 10) / 10;
}
// A survey now holds MANY welds (one per examination-table item). A "weld view"
// re-exposes a single weld as the old flat shape so the per-weld renderers work
// unchanged. Top-level mode/scale/limitMax/bore are shared across welds.
function _htWeldView(base, weld){
  weld = weld || {};
  return { mode:base.mode, scale:base.scale, limitMax:base.limitMax, bore:base.bore, points:weld.points, rows:weld.rows };
}
// Normalise any survey to { mode, scale, limitMax, bore, welds:[…] }. Legacy
// single-weld shapes (top-level points / zones / rows) wrap into welds[0].
// Idempotent — a survey that already has `welds` is returned untouched.
function htNormalize(survey){
  if(!survey || Array.isArray(survey.welds)) return survey;
  var base = { mode: survey.mode || (survey.rows ? 'weld-traverse' : 'site-piping'),
               scale: survey.scale || 'HV10',
               limitMax: (survey.limitMax != null ? survey.limitMax : 248),
               bore: survey.bore || 'large' };
  var weld;
  if(base.mode === 'site-piping'){
    weld = { points: survey.points || (survey.zones || []).map(function(z,i){ return { n:i+1, label:z.label, kind:z.kind, clock:{ '12H':(z.r&&z.r[0]), '04H':(z.r&&z.r[1]), '08H':(z.r&&z.r[2]) } }; }) };
  } else {
    weld = { rows: survey.rows || [] };
  }
  base.welds = [weld];
  return base;
}
function htWeldCount(survey){ survey = htNormalize(survey); return (survey && survey.welds) ? survey.welds.length : 0; }

function _htAll(survey){
  if(!survey) return [];
  if(Array.isArray(survey.welds)){
    var agg = []; survey.welds.forEach(function(w){ agg = agg.concat(_htAll(_htWeldView(survey, w))); }); return agg;
  }
  if(survey.mode === 'site-piping'){
    if(survey.points){ var ck = htSiteClocks(survey); return survey.points.map(function(p){ return { label:p.label, kind:p.kind, avg:htSiteAvg(p, ck) }; }); }
    return (survey.zones || []).map(function(z){ return { label:z.label, kind:z.kind, avg:htAvg(z.r) }; });  // legacy shape
  }
  var out = [];
  (survey.rows || []).forEach(function(row){ (row.points || []).forEach(function(p){ out.push({ label:row.label, kind:p.zone, avg:htAvg(p.r) }); }); });
  return out;
}
function htPeak(survey){ var m=0, w=''; _htAll(survey).forEach(function(a){ if(a.avg!=null && a.avg>m){ m=a.avg; w=a.kind+' · '+a.label; } }); return { value:m, where:w }; }
function htVerdict(survey){ var lim=(survey&&survey.limitMax)||0; var over=_htAll(survey).filter(function(a){ return a.avg!=null && lim && a.avg>lim; }).length; return { over:over, passed:over===0, total:_htAll(survey).filter(function(a){return a.avg!=null;}).length }; }

// ── sample surveys (editor preview / starter) ────────────────────────────────
function _pt(zone,pos,a,b,c){ return { zone:zone, pos:pos, r:[a,b,c] }; }
var HT_SITE_ZONES = [['Base material','PM'],['HAZ','HAZ'],['Weld','Weld'],['HAZ','HAZ'],['Base material','PM']];
function _sp(n,a,b,c){ var z = HT_SITE_ZONES[n-1]; return { n:n, label:z[0], kind:z[1], clock:{ '12H':a, '04H':b, '08H':c } }; }
function _siteWeld(a){ return { points:[ _sp(1,a[0],a[1],a[2]), _sp(2,a[3],a[4],a[5]), _sp(3,a[6],a[7],a[8]), _sp(4,a[9],a[10],a[11]), _sp(5,a[12],a[13],a[14]) ] }; }
var HT_SAMPLE_SITE = { mode:'site-piping', scale:'HV10', limitMax:248, bore:'large', welds:[
  _siteWeld([160,170,147, 165,170,170, 185,187,180, 147,143,148, 149,146,152]),
  _siteWeld([158,162,160, 171,168,170, 188,192,190, 150,148,152, 151,149,150]),
  _siteWeld([162,159,161, 169,172,170, 196,201,199, 153,150,151, 150,152,148]),
]};
// Sample items (the editor preview has no real report.items) — the details
// table sources from these, mirroring the report's Examination-details table.
var HT_SAMPLE_ITEMS = [
  { subject:'Pipe butt weld P1', drawing:'ISO-P1-014', material:'P235GH', weldProcess:'GTAW + SMAW', dimensions:'Ø168.3 × 14.2', verdict:'Acceptable' },
  { subject:'Pipe butt weld P2', drawing:'ISO-P1-015', material:'P235GH', weldProcess:'GTAW + SMAW', dimensions:'Ø168.3 × 14.2', verdict:'Acceptable' },
  { subject:'Pipe butt weld P3', drawing:'ISO-P1-016', material:'P235GH', weldProcess:'SMAW',        dimensions:'Ø219.1 × 18.0', verdict:'Acceptable' },
];
var HT_SAMPLE_WELD = { mode:'weld-traverse', scale:'HV10', limitMax:248, welds:[ { rows:[
  { label:'Cap',  points:[_pt('PM',-15,182,179,184),_pt('PM',-12,185,188,183),_pt('HAZ',-9,228,231,226),_pt('HAZ',-7,252,258,255),_pt('Weld',-4,221,224,219),_pt('Weld',0,215,218,213),_pt('Weld',4,223,220,226),_pt('HAZ',7,246,243,249),_pt('HAZ',9,229,232,227),_pt('PM',12,186,189,184),_pt('PM',15,180,183,178)] },
  { label:'Mid',  points:[_pt('PM',-15,178,181,176),_pt('HAZ',-8,221,224,219),_pt('HAZ',-7,238,241,236),_pt('Weld',0,210,213,208),_pt('HAZ',7,236,233,239),_pt('HAZ',8,223,226,221),_pt('PM',15,177,180,175)] },
  { label:'Root', points:[_pt('PM',-15,180,177,183),_pt('HAZ',-8,225,228,223),_pt('HAZ',-7,243,246,241),_pt('Weld',0,214,217,212),_pt('HAZ',7,240,237,243),_pt('HAZ',8,226,229,224),_pt('PM',15,181,184,179)] },
] } ] };

// ── default (empty) survey for a new report ──────────────────────────────────
function _htBlankSiteWeld(){ return { points: HT_SITE_ZONES.map(function(z,i){ return { n:i+1, label:z[0], kind:z[1], clock:{ '12H':'', '04H':'', '08H':'' } }; }) }; }
function _htBlankWeldRows(){
  var tmpl = [['PM',-15],['PM',-12],['HAZ',-9],['HAZ',-7],['Weld',-4],['Weld',0],['Weld',4],['HAZ',7],['HAZ',9],['PM',12],['PM',15]];
  function row(label){ return { label:label, points: tmpl.map(function(t){ return { zone:t[0], pos:t[1], r:['','',''] }; }) }; }
  return [ row('Cap'), row('Mid'), row('Root') ];
}
function htDefault(mode){
  if(mode === 'site-piping') return { mode:'site-piping', scale:'HV10', limitMax:248, bore:'large', welds:[ _htBlankSiteWeld() ] };
  return { mode:'weld-traverse', scale:'HV10', limitMax:248, welds:[ { rows: _htBlankWeldRows() } ] };
}

// ══════════════════════════════════════════════════════════════════════════
// RENDERER — returns an HTML string (SVG + readings table). Print/light palette.
// ══════════════════════════════════════════════════════════════════════════
// Palette aligned to the report/PDF tables: black ink, #ddd hairlines, the
// report's verdict-chip tones for accents (blue = weld, amber = HAZ, red = over).
var HT_P = { ink:'#111', mut:'#6b7280', grid:'#ddd', line:'#cbcbcb',
  cyan:'#1e40af', amber:'#92400e', green:'#065f46', red:'#991b1b',
  pmFill:'rgba(0,0,0,.03)', hazFill:'rgba(146,64,14,.09)', weldFill:'rgba(30,64,175,.06)' };
function _htRowColors(){ return ['#0e7fa6','#3a6db5','#2f9e63']; }   // Cap / Mid / Root

// Flatten the survey into table rows (one per point/zone) so the readings
// table can be sliced for auto-pagination across printed sheets.
function htFlatRows(survey){
  if(!survey) return [];
  survey = htNormalize(survey);
  if(survey.mode === 'site-piping') return [];   // site paginates by weld, not rows
  var w0 = (survey.welds && survey.welds[0]) || {};
  var out = [];
  (w0.rows || []).forEach(function(row){ (row.points || []).forEach(function(p){ out.push({ line:row.label, zone:p.zone, pos:p.pos, r:p.r }); }); });
  return out;
}
function htRowsOf(survey){ return htFlatRows(survey).length; }

// opts: { print, sample, slice:{start,count}, part }. part selects which place
// card this is: 'method' = the methodology drawing only; 'results' = caption +
// details + profile + readings table; 'all' (default) = everything stacked (used
// by the form preview). When slice.start>0 this is a continuation sheet — render
// only the (sliced) readings table.
function htRenderSurvey(survey, opts){
  opts = opts || {};
  var part = opts.part || 'all';
  var hasData = function(s){ return s && (s.welds || s.rows || s.zones || s.points); };
  // Editor/preview fallback (no real survey): show the SITE example so the
  // designer sees the layout. opts.sampleMode:'weld' falls back to the traverse.
  if(!hasData(survey) && opts.sample) survey = (opts.sampleMode === 'weld') ? HT_SAMPLE_WELD : HT_SAMPLE_SITE;
  if(!hasData(survey)) return '<div style="padding:18px;color:#9aa6b5;font-size:11px;text-align:center">No hardness survey recorded.</div>';
  survey = htNormalize(survey);
  var items = opts.items || (opts.sample ? HT_SAMPLE_ITEMS : []);
  var P = HT_P, scale = survey.scale || 'HV10', limit = parseFloat(survey.limitMax) || 0;
  // Heading bar colour is editable on the block (opts.barColor); falls back to
  // the template section colour. Per-weld details column widths likewise.
  var bar = opts.barColor || ((typeof cvTplCfg !== 'undefined' && cvTplCfg.sectionColor) ? cvTplCfg.sectionColor : '#404040');
  var detailWidths = (Array.isArray(opts.detailWidths) && opts.detailWidths.length === HT_DETAIL_COLS.length) ? opts.detailWidths : null;
  var site = survey.mode === 'site-piping';
  var welds = survey.welds || [];
  var slice = opts.slice || null;
  // site: slice is over WELDS; traverse: slice is over readings ROWS. start>0 ⇒
  // a continuation sheet (MAIN CONT) — no method card / caption / profile.
  var continued = !!(slice && slice.start > 0) && part !== 'method';
  if(continued) part = 'results';
  var wantMethod = (part === 'all' || part === 'method');
  var wantResults = (part === 'all' || part === 'results');

  var title = continued ? 'MAIN CONT' : (part === 'method' ? 'HARDNESS SURVEY — MEASUREMENT METHOD' : 'HARDNESS SURVEY');
  var titleBar = '<div style="background:'+bar+';color:#fff;font:700 11px \'Geist\',system-ui,sans-serif;letter-spacing:.06em;text-align:center;padding:4px 8px">'+title+'</div>';
  var html = titleBar;

  if(wantResults && !continued){
    var peak = htPeak(survey), v = htVerdict(survey);
    var wc = welds.length;
    var sub = site ? (wc+' weld'+(wc===1?'':'s')+' · 5 points across the weld · '+htBoreClocksText(survey)+' · avg per point') : 'Weld traverse · avg of 3 per point';
    var verdict = limit ? ((v.passed?'<b style="color:'+P.green+'">PASS</b>':'<b style="color:'+P.red+'">FAIL</b>')+' (max '+limit+')') : '';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 8px;font:400 8px \'Geist Mono\',monospace;color:'+P.mut+';border-bottom:0.5px solid '+P.grid+'"><span>'+escapeHtml(scale)+' · '+sub+'</span><span>Peak '+(peak.value||'—')+' '+escapeHtml(scale)+(verdict?(' · '+verdict):'')+'</span></div>';
  }
  // method card = the schematic drawing (first weld's view drives mode/bore).
  if(wantMethod && !continued){
    var mview = _htWeldView(survey, welds[0] || {});
    html += '<div style="padding:6px 8px 2px">' + (site ? _htSiteMethod(mview, P) : _htWeldDiagram(mview, P, limit, scale)) + '</div>';
  }
  if(wantResults){
    if(site){
      // one self-contained block per weld; sliced over the welds array
      var start = slice ? slice.start : 0, count = slice ? slice.count : welds.length;
      welds.slice(start, start + count).forEach(function(w, k){
        var idx = start + k;
        html += _htWeldUnit(_htWeldView(survey, w), items[idx] || {}, idx, P, limit, bar, scale, detailWidths);
      });
    } else {
      // traverse: single weld — details + profile (first sheet) then row-sliced table
      var w0 = _htWeldView(survey, welds[0] || {});
      if(!continued){
        html += _htItemDetails(items[0] || {}, 0, P, limit, bar, w0, detailWidths);
        html += '<div style="padding:6px 8px 0">' + _htWeldProfile(w0, P, limit, scale) + '</div>';
      }
      var rows = htFlatRows(survey);
      var rstart = slice ? slice.start : 0, rcount = slice ? slice.count : rows.length;
      html += _htTable(w0, P, limit, rows.slice(rstart, rstart + rcount), bar);
    }
  }
  // No own outline — the editor block's border (when shown) is the frame.
  return '<div style="overflow:hidden;font-family:\'Geist\',system-ui,sans-serif">' + html + '</div>';
}

// One site weld block: item-sourced details header + a compact HV chart + the
// 12H/04H/08H clock table. Stacked by htRenderSurvey, paginated by weld.
function _htWeldUnit(weldView, item, idx, P, limit, bar, scale, detailWidths){
  var sep = idx > 0 ? 'border-top:2px solid '+P.grid+';margin-top:8px;padding-top:2px;' : '';
  return '<div style="'+sep+'">'
    + _htItemDetails(item, idx, P, limit, bar, weldView, detailWidths)
    + '<div style="padding:4px 8px 0">' + _htSiteProfile(weldView, P, limit, { compact:true }) + '</div>'
    + _htSiteTable(weldView, P, limit, bar)
    + '</div>';
}

// Examination-details row — sourced from the report's items table (one item per
// weld), styled like the report items-table. Result is the item's verdict chip,
// falling back to the computed pass/fail from the weld's own readings.
// Result is computed automatically from the weld's HV readings vs the acceptance
// max (peak ≤ limit → Acceptable). Not taken from the item's verdict column.
function _htItemResultChip(item, weldView, limit){
  var v = htVerdict(weldView);
  if(!limit || !v.total) return '<span style="color:#6b7280">—</span>';
  var verdict = v.passed ? 'Acceptable' : 'Not acceptable';
  var c = (typeof OV_VERDICT_COLORS !== 'undefined' && OV_VERDICT_COLORS[verdict]) ? OV_VERDICT_COLORS[verdict] : null;
  if(!c) return escapeHtml(verdict);
  return '<span style="display:inline-block;padding:1px 7px;border-radius:3px;background:'+c.bg+';color:'+c.fg+';font-weight:700">'+escapeHtml(verdict)+'</span>';
}
// Per-weld details header — sources every Examination-details column from the
// matching item. Column widths are editable on the ht-survey block (colWidths).
var HT_DETAIL_COLS = [
  { id:'weldNo',      label:'Weld / Item No.',  w:150 },
  { id:'drawing',     label:'Drawing / ISO',    w:95  },
  { id:'material',    label:'Material',          w:90  },
  { id:'weldType',    label:'Weld type / prep',  w:80  },
  { id:'weldProcess', label:'Welding process',   w:90  },
  { id:'welders',     label:'Welder(s)',         w:90  },
  { id:'examDate',    label:'Exam date',         w:80  },
  { id:'dimensions',  label:'Thickness',         w:80  },
  { id:'extent',      label:'Extent',            w:110 },
  { id:'verdict',     label:'Result',            w:95  },
];
function _htItemDetails(item, idx, P, limit, bar, weldView, colWidths){
  item = item || {};
  function val(x){ return (x === '' || x == null) ? '<span style="color:#9aa6b5">—</span>' : escapeHtml(x); }
  var no = ('00' + (idx + 1)).slice(-3);
  var weldNo = no + (item.subject ? (' · ' + escapeHtml(item.subject)) : '');
  var examDate = (item.examDate && typeof fmtDate === 'function') ? escapeHtml(fmtDate(item.examDate)) : val(item.examDate);
  var heads = HT_DETAIL_COLS.map(function(c){ return c.label; });
  var cells = [
    { v:weldNo, extra:'font-weight:600' },
    { v:val(item.drawing) },
    { v:val(item.material) },
    { v:val(item.weldType) },
    { v:val(item.weldProcess) },
    { v:val(item.welders) },
    { v:examDate, extra:'font-family:\'Geist Mono\',monospace' },
    { v:val(item.dimensions), extra:'font-family:\'Geist Mono\',monospace' },
    { v:val(item.extent) },
    { v:_htItemResultChip(item, weldView, limit) }
  ];
  return _htTableEl(heads, [{ cells:cells }], bar, P, colWidths);
}

// Shared table builder — mirrors the report items-table look: coloured header
// bar with white column labels, black cells on white with #ddd hairlines.
function _htAvgCell(a, over){
  if(a == null) return '—';
  return over ? '<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:#fee2e2;color:#991b1b;font-weight:600">'+a+'</span>' : String(a);
}
function _htTableEl(headLabels, rowsData, bar, P, colWidths){
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

// dynamic Y domain from data + limit
function _htYDomain(survey, limit){
  var vals = _htAll(survey).map(function(a){ return a.avg; }).filter(function(x){ return x!=null; });
  if(limit) vals.push(limit);
  if(!vals.length) return [150, 280];
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  return [ Math.floor((lo-15)/25)*25, Math.ceil((hi+15)/25)*25 ];
}

// Weld-traverse cross-section schematic (the diagram, referenced once at top).
function _htWeldDiagram(survey, P, limit, scale){
  var XMIN=-18, XMAX=18, PL=46, PR=748;
  function xs(p){ return PL + (p-XMIN)/(XMAX-XMIN)*(PR-PL); }
  var topY=22, botY=104, capH=8, rootH=1.6, hazW=2.4;
  function pl(a){ return a.map(function(q){return q[0].toFixed(1)+','+q[1].toFixed(1);}).join(' '); }
  var weld=[[xs(-capH),topY],[xs(capH),topY],[xs(rootH),botY],[xs(-rootH),botY]];
  var hazL=[[xs(-capH-hazW),topY],[xs(-capH),topY],[xs(-rootH),botY],[xs(-rootH-hazW),botY]];
  var hazR=[[xs(capH+hazW),topY],[xs(capH),topY],[xs(rootH),botY],[xs(rootH+hazW),botY]];
  var depths={Cap:topY+16,Mid:(topY+botY)/2,Root:botY-16}, cols=_htRowColors();
  var s1='';
  s1+='<rect x="'+xs(XMIN)+'" y="'+topY+'" width="'+(xs(XMAX)-xs(XMIN))+'" height="'+(botY-topY)+'" fill="'+P.pmFill+'" stroke="'+P.line+'"/>';
  s1+='<polygon points="'+pl(hazL)+'" fill="'+P.hazFill+'"/><polygon points="'+pl(hazR)+'" fill="'+P.hazFill+'"/>';
  s1+='<polygon points="'+pl(weld)+'" fill="'+P.weldFill+'" stroke="'+P.cyan+'" stroke-opacity=".5"/>';
  s1+='<path d="M'+xs(-capH)+' '+topY+' Q '+xs(0)+' '+(topY-9)+' '+xs(capH)+' '+topY+'" fill="'+P.weldFill+'" stroke="'+P.cyan+'" stroke-opacity=".5"/>';
  s1+='<line x1="'+xs(0)+'" y1="'+(topY-12)+'" x2="'+xs(0)+'" y2="'+(botY+4)+'" stroke="'+P.mut+'" stroke-dasharray="3 3" opacity=".5"/>';
  (survey.rows||[]).forEach(function(row,ri){ var dy=depths[row.label]||(topY+16+ri*14), c=cols[ri%3];
    s1+='<text x="'+(PL-8)+'" y="'+(dy+3)+'" text-anchor="end" font-family="\'Geist Mono\',monospace" font-size="9" fill="'+P.mut+'">'+escapeHtml(row.label)+'</text>';
    (row.points||[]).forEach(function(p){ var a=htAvg(p.r); if(a==null) return; var over=limit&&a>limit;
      s1+='<circle cx="'+xs(p.pos)+'" cy="'+dy+'" r="3" fill="'+(over?P.red:c)+'" stroke="#fff" stroke-width=".7"/>'; }); });
  ['PARENT,-14','HAZ,-8','WELD,0','HAZ,8','PARENT,14'].forEach(function(z){ var a=z.split(','); s1+='<text x="'+xs(+a[1])+'" y="'+(botY+15)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="8.5" fill="'+(a[0]==='HAZ'?P.amber:a[0]==='WELD'?P.cyan:P.mut)+'">'+a[0]+'</text>'; });
  return '<svg viewBox="0 0 794 128" style="width:100%;height:auto;display:block">'+s1+'</svg>';
}

// Weld-traverse hardness profile (the data chart, below the diagram).
function _htWeldProfile(survey, P, limit, scale){
  var XMIN=-18, XMAX=18, PL=46, PR=748, dom=_htYDomain(survey, limit), YMIN=dom[0], YMAX=dom[1];
  function xs(p){ return PL + (p-XMIN)/(XMAX-XMIN)*(PR-PL); }
  var CT=14, CB=176; function ys(h){ return CT+(1-(h-YMIN)/(YMAX-YMIN))*(CB-CT); }
  var bands=[[XMIN,-10,P.pmFill,'Parent'],[-10,-6,P.hazFill,'HAZ'],[-6,6,P.weldFill,'Weld'],[6,10,P.hazFill,'HAZ'],[10,XMAX,P.pmFill,'Parent']];
  var s2='';
  bands.forEach(function(b){ s2+='<rect x="'+xs(b[0])+'" y="'+CT+'" width="'+(xs(b[1])-xs(b[0]))+'" height="'+(CB-CT)+'" fill="'+b[2]+'"/>'; });
  [['Parent',-14],['HAZ',-8],['Weld',0],['HAZ',8],['Parent',14]].forEach(function(z){ s2+='<text x="'+xs(z[1])+'" y="'+(CT+11)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="9" fill="'+P.mut+'">'+z[0]+'</text>'; });
  for(var h=YMIN; h<=YMAX; h+=25){ s2+='<line x1="'+PL+'" y1="'+ys(h)+'" x2="'+PR+'" y2="'+ys(h)+'" stroke="'+P.grid+'"/><text x="'+(PL-6)+'" y="'+(ys(h)+3)+'" text-anchor="end" font-family="\'Geist Mono\',monospace" font-size="8.5" fill="'+P.mut+'">'+h+'</text>'; }
  [-15,-10,-5,0,5,10,15].forEach(function(p){ s2+='<text x="'+xs(p)+'" y="'+(CB+13)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="8.5" fill="'+P.mut+'">'+p+'</text>'; });
  s2+='<text x="'+((PL+PR)/2)+'" y="'+(CB+26)+'" text-anchor="middle" font-size="9.5" fill="'+P.mut+'">Position from weld centreline (mm)</text>';
  if(limit>=YMIN&&limit<=YMAX){ s2+='<line x1="'+PL+'" y1="'+ys(limit)+'" x2="'+PR+'" y2="'+ys(limit)+'" stroke="'+P.red+'" stroke-width="1.3" stroke-dasharray="6 4"/><text x="'+(PR-3)+'" y="'+(ys(limit)-4)+'" text-anchor="end" font-family="\'Geist Mono\',monospace" font-size="9" fill="'+P.red+'">max '+limit+'</text>'; }
  var cols2=_htRowColors();
  (survey.rows||[]).forEach(function(row,ri){ var c=cols2[ri%3];
    var pts=(row.points||[]).filter(function(p){return htAvg(p.r)!=null;}).slice().sort(function(a,b){return a.pos-b.pos;});
    if(pts.length>1){ s2+='<polyline points="'+pts.map(function(p){return xs(p.pos).toFixed(1)+','+ys(htAvg(p.r)).toFixed(1);}).join(' ')+'" fill="none" stroke="'+c+'" stroke-width="1.6" stroke-opacity=".85"/>'; }
    pts.forEach(function(p){ var a=htAvg(p.r), over=limit&&a>limit; s2+='<circle cx="'+xs(p.pos)+'" cy="'+ys(a)+'" r="'+(over?3.8:2.8)+'" fill="'+(over?P.red:c)+'" stroke="#fff" stroke-width="1"/>'; }); });
  // legend
  var leg=(survey.rows||[]).map(function(row,ri){ return '<span style="display:inline-flex;align-items:center;gap:5px;margin-right:14px"><span style="width:13px;height:3px;background:'+cols2[ri%3]+';display:inline-block;border-radius:2px"></span>'+escapeHtml(row.label)+'</span>'; }).join('');
  return '<svg viewBox="0 0 794 204" style="width:100%;height:auto;display:block">'+s2+'</svg><div style="font-family:\'Geist\',sans-serif;font-size:10px;color:'+P.mut+';margin-top:2px">'+leg+'</div>';
}

function _htKc(P,k){ return k==='HAZ'?P.amber:k==='Weld'?P.cyan:P.mut; }

// "How measurements are taken" — pipe side-view + 5 points + section A-A + clock end-view.
function _htSiteMethod(survey, P){
  var pts = survey.points || [];
  var pipeL=60, pipeR=470, top=110, bot=190, cx=(pipeL+pipeR)/2, midY=(top+bot)/2;
  var steel='rgba(20,30,55,.05)';
  var s='';
  s+='<text x="'+pipeL+'" y="13" font-family="\'Geist Mono\',monospace" font-size="9.5" font-weight="700" fill="'+P.ink+'">HOW MEASUREMENTS ARE TAKEN</text>';
  // one line per pipe-size rule; the survey's active size is highlighted
  var _sz=[['small','≤ 6″','12 o’clock'],['medium','6–12″','4 / 8 o’clock'],['large','&gt; 12″','12 / 4 / 8 o’clock']];
  var _act=survey.bore||'large';
  _sz.forEach(function(z,i){ var on=(z[0]===_act); s+='<text x="'+pipeL+'" y="'+(26+i*11)+'" font-family="\'Geist Mono\',monospace" font-size="8" fill="'+(on?P.cyan:P.mut)+'"'+(on?' font-weight="700"':'')+'>'+(on?'▸ ':'  ')+z[1]+' — '+z[2]+'</text>'; });
  // pipe + weld
  s+='<rect x="'+pipeL+'" y="'+top+'" width="'+(pipeR-pipeL)+'" height="'+(bot-top)+'" fill="'+steel+'" stroke="'+P.line+'"/>';
  s+='<rect x="'+(cx-8)+'" y="'+top+'" width="16" height="'+(bot-top)+'" fill="'+P.weldFill+'" stroke="'+P.cyan+'" stroke-opacity=".55"/>';
  s+='<path d="M'+(cx-11)+' '+top+' Q '+cx+' '+(top-7)+' '+(cx+11)+' '+top+'" fill="'+P.weldFill+'" stroke="'+P.cyan+'" stroke-opacity=".5"/>';
  // flow arrow
  s+='<line x1="'+(pipeL+24)+'" y1="'+midY+'" x2="'+(cx-34)+'" y2="'+midY+'" stroke="'+P.mut+'" stroke-width="1.3"/><path d="M'+(cx-34)+' '+(midY-4)+' L '+(cx-27)+' '+midY+' L '+(cx-34)+' '+(midY+4)+'" fill="'+P.mut+'"/>';
  s+='<text x="'+(pipeL+24)+'" y="'+(midY-7)+'" font-family="\'Geist Mono\',monospace" font-size="9" fill="'+P.mut+'">Direction of flow</text>';
  // 5 points (2,3,4 clustered at the weld)
  var px=[cx-104, cx-16, cx, cx+16, cx+104], callTop=72;
  px.forEach(function(x,i){ var c=(i===2)?P.cyan:(i===1||i===3)?P.amber:P.mut;
    s+='<line x1="'+x+'" y1="'+callTop+'" x2="'+x+'" y2="'+(top-2)+'" stroke="'+c+'" stroke-width="1" stroke-dasharray="2 2" opacity=".75"/>';
    s+='<circle cx="'+x+'" cy="'+top+'" r="3" fill="'+c+'"/>';
    s+='<circle cx="'+x+'" cy="'+callTop+'" r="9" fill="#fff" stroke="'+c+'"/><text x="'+x+'" y="'+(callTop+3.5)+'" text-anchor="middle" font-family="\'Funnel Display\',sans-serif" font-weight="700" font-size="11" fill="'+c+'">'+(i+1)+'</text>'; });
  function dim(x1,x2,y,lbl){ return '<line x1="'+x1+'" y1="'+y+'" x2="'+x2+'" y2="'+y+'" stroke="'+P.mut+'"/><path d="M'+x1+' '+(y-3)+' L '+(x1+6)+' '+y+' L '+x1+' '+(y+3)+'" fill="'+P.mut+'"/><path d="M'+x2+' '+(y-3)+' L '+(x2-6)+' '+y+' L '+x2+' '+(y+3)+'" fill="'+P.mut+'"/><text x="'+((x1+x2)/2)+'" y="'+(y-5)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="9" fill="'+P.mut+'">'+lbl+'</text>'; }
  s+=dim(px[0],px[1],bot+22,'20 mm')+dim(px[3],px[4],bot+22,'20 mm');
  // section A-A
  s+='<line x1="'+cx+'" y1="'+(top-26)+'" x2="'+cx+'" y2="'+(bot+40)+'" stroke="'+P.cyan+'" stroke-dasharray="4 3" opacity=".7"/>';
  s+='<text x="'+(cx+5)+'" y="'+(top-28)+'" font-family="\'Geist Mono\',monospace" font-size="10" fill="'+P.cyan+'">A</text><text x="'+(cx+5)+'" y="'+(bot+52)+'" font-family="\'Geist Mono\',monospace" font-size="10" fill="'+P.cyan+'">A</text>';
  // View A-A end ring + clock positions
  var ex=648, ey=150, rO=56, rI=42, clk = survey.bore==='small' ? [[12,'12H']] : survey.bore==='medium' ? [[4,'04H'],[8,'08H']] : [[12,'12H'],[4,'04H'],[8,'08H']];
  s+='<text x="'+ex+'" y="'+(ey-rO-22)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="10" fill="'+P.mut+'">VIEW A–A</text>';
  s+='<circle cx="'+ex+'" cy="'+ey+'" r="'+rO+'" fill="'+steel+'" stroke="'+P.line+'"/><circle cx="'+ex+'" cy="'+ey+'" r="'+rI+'" fill="#fff" stroke="'+P.line+'"/>';
  clk.forEach(function(c){ var ang=(c[0]/12)*2*Math.PI-Math.PI/2, rr=(rO+rI)/2, dx=ex+rr*Math.cos(ang), dy=ey+rr*Math.sin(ang), lx=ex+(rO+13)*Math.cos(ang), ly=ey+(rO+13)*Math.sin(ang);
    s+='<circle cx="'+dx+'" cy="'+dy+'" r="4.2" fill="'+P.cyan+'" stroke="#fff" stroke-width=".7"/><text x="'+lx+'" y="'+(ly+3)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="9" fill="'+P.cyan+'">'+c[1]+'</text>'; });
  // legend
  ['1 Base material','2 HAZ','3 Weld','4 HAZ','5 Base material'].forEach(function(z,i){ var k=(i===2)?'Weld':(i===1||i===3)?'HAZ':'PM'; s+='<text x="'+(pipeL+i*128)+'" y="285" font-family="\'Geist Mono\',monospace" font-size="9" fill="'+_htKc(P,k)+'">'+z+'</text>'; });
  return '<svg viewBox="0 0 794 296" style="width:100%;height:auto;display:block">'+s+'</svg>';
}

// Hardness "HV" chart styled after the reference report: Y axis from 0, a grey
// parent-plate base band with a yellow single-V butt weld rising into it, and a
// blue data line with diamond markers. The plate/weld sit in real HV units so
// the data reads against the weld cross-section beneath it.
function _htSiteProfile(survey, P, limit, opts){
  opts = opts || {};
  var pts=survey.points||[], n=pts.length||5, clocks=htSiteClocks(survey);
  var PL=64, PR=752, CT=opts.compact?34:46, CB=opts.compact?188:300;
  var avgs=pts.map(function(p){ return htSiteAvg(p,clocks); }).filter(function(x){ return x!=null; });
  var dmax=avgs.length?Math.max.apply(null,avgs):200;
  var YMAX=Math.max(200, Math.ceil((Math.max(dmax, limit||0)+1)/50)*50);
  function ys(v){ return CT+(1-v/YMAX)*(CB-CT); }
  // x-positions cluster points 2-3-4 at the weld and push 1/5 out (20 mm each
  // side), mirroring the pipe methodology drawing rather than even spacing.
  var XPOS=[-62,-26,0,26,62], xm=28;
  function zx(i){ return (n===5) ? (PL+xm+(XPOS[i]+104)/208*(PR-PL-2*xm)) : (PL+(i+0.5)/n*(PR-PL)); }
  var WELD='#a9cbee', WELDST='#2c5b96', GREY='#cacaca', BLUE='#3f6fb5';
  var s='';
  // title
  s+='<text x="'+((PL+PR)/2)+'" y="26" text-anchor="middle" font-family="\'Geist\',sans-serif" font-weight="700" font-size="15" fill="#222">HV</text>';
  // gridlines + Y labels (0 → YMAX, every 50)
  for(var hh=0; hh<=YMAX; hh+=50){ var gy=ys(hh); s+='<line x1="'+PL+'" y1="'+gy+'" x2="'+PR+'" y2="'+gy+'" stroke="'+P.grid+'"/><text x="'+(PL-8)+'" y="'+(gy+4)+'" text-anchor="end" font-family="\'Geist Mono\',monospace" font-size="10" fill="#555">'+hh+'</text>'; }
  // ── single-V groove butt weld detail (per ASME/TWI joint geometry) drawn as
  //    the chart base: two base-metal plates with bevelled edges (~60° included
  //    angle), a root face + root gap, the weld metal filling the groove and a
  //    cap reinforcement proud of the plate surface, with fusion/pass lines. ──
  var plateHV=70, plY=ys(plateHV), T=CB-plY, wcx=zx(2);
  var rootGap=4, rootFace=Math.max(7, T*0.10), capReinf=8;
  var capHW=rootGap + (T-rootFace)*0.62;                 // ≈ 63° included groove
  var capL=wcx-capHW, capR=wcx+capHW, rgL=wcx-rootGap, rgR=wcx+rootGap, rfTop=CB-rootFace;
  // base-metal plates (left + right of the groove), bevelled inner edge + root face
  s+='<path d="M'+PL+' '+plY+' L '+capL+' '+plY+' L '+rgL+' '+rfTop+' L '+rgL+' '+CB+' L '+PL+' '+CB+' Z" fill="'+GREY+'" stroke="#9a9a9a" stroke-width=".6"/>';
  s+='<path d="M'+PR+' '+plY+' L '+capR+' '+plY+' L '+rgR+' '+rfTop+' L '+rgR+' '+CB+' L '+PR+' '+CB+' Z" fill="'+GREY+'" stroke="#9a9a9a" stroke-width=".6"/>';
  // weld bead: toes spread onto the plate, a convex fusion boundary penetrating
  // into the parent metal on each sidewall, and a root penetration bead proud of
  // the underside — drawn as one bead like a real single-V weld macro.
  var toeL=capL-11, toeR=capR+11, midY=plY+(CB-plY)*0.5, rootPenet=5;
  var weldD='M'+toeL+' '+plY
    +' Q '+wcx+' '+(plY-capReinf)+' '+toeR+' '+plY
    +' Q '+(capR+8)+' '+midY+' '+rgR+' '+CB
    +' Q '+wcx+' '+(CB+rootPenet)+' '+rgL+' '+CB
    +' Q '+(capL-8)+' '+midY+' '+toeL+' '+plY+' Z';
  s+='<path d="'+weldD+'" fill="'+WELD+'" stroke="'+WELDST+'" stroke-width="1"/>';
  // original groove prep, drawn on top of the bead — bevel faces plus the
  // vertical root face (land) above the root gap; the weld fuses BEYOND it
  s+='<path d="M'+capL+' '+plY+' L '+rgL+' '+rfTop+' L '+rgL+' '+CB+' M '+capR+' '+plY+' L '+rgR+' '+rfTop+' L '+rgR+' '+CB+'" fill="none" stroke="'+WELDST+'" stroke-width=".8" stroke-dasharray="3 2" stroke-opacity=".7"/>';
  // plate top surface line (interrupted by the weld toes)
  s+='<line x1="'+PL+'" y1="'+plY+'" x2="'+toeL+'" y2="'+plY+'" stroke="#333" stroke-width="1.2"/>';
  s+='<line x1="'+toeR+'" y1="'+plY+'" x2="'+PR+'" y2="'+plY+'" stroke="#333" stroke-width="1.2"/>';
  // acceptance-max line (kept for pass/fail context)
  if(limit && limit<=YMAX){ var ly=ys(limit); s+='<line x1="'+PL+'" y1="'+ly+'" x2="'+PR+'" y2="'+ly+'" stroke="'+P.red+'" stroke-width="1.2" stroke-dasharray="6 4"/><text x="'+(PR-3)+'" y="'+(ly-4)+'" text-anchor="end" font-family="\'Geist Mono\',monospace" font-size="9" fill="'+P.red+'">max '+limit+'</text>'; }
  // data line + diamond markers + value labels
  var line=pts.map(function(p,i){ var a=htSiteAvg(p,clocks); return a!=null?(zx(i)+','+ys(a)):null; }).filter(Boolean).join(' ');
  if(line) s+='<polyline points="'+line+'" fill="none" stroke="'+BLUE+'" stroke-width="2"/>';
  pts.forEach(function(p,i){ var a=htSiteAvg(p,clocks); if(a==null) return; var over=limit&&a>limit, mx=zx(i), my=ys(a), c=over?P.red:BLUE;
    s+='<polygon points="'+mx+','+(my-5)+' '+(mx+5)+','+my+' '+mx+','+(my+5)+' '+(mx-5)+','+my+'" fill="'+c+'" stroke="#fff" stroke-width=".8"/>';
    s+='<text x="'+mx+'" y="'+(my-10)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="9" fill="'+(over?P.red:'#222')+'">'+a+'</text>'; });
  // x-axis baseline (= plate underside, interrupted by the root penetration bead)
  s+='<line x1="'+PL+'" y1="'+CB+'" x2="'+rgL+'" y2="'+CB+'" stroke="#333" stroke-width="1"/>';
  s+='<line x1="'+rgR+'" y1="'+CB+'" x2="'+PR+'" y2="'+CB+'" stroke="#333" stroke-width="1"/>';
  pts.forEach(function(p,i){ s+='<text x="'+zx(i)+'" y="'+(CB+16)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="9" fill="'+_htKc(P,p.kind)+'">'+p.n+'. '+escapeHtml(p.label)+'</text>'; });
  // Y-axis title
  s+='<text x="22" y="'+((CT+CB)/2)+'" transform="rotate(-90 22 '+((CT+CB)/2)+')" text-anchor="middle" font-family="\'Geist\',sans-serif" font-size="10" fill="#555">Hardness HV</text>';
  return '<svg viewBox="0 0 794 '+(CB+28)+'" style="width:100%;height:auto;display:block">'+s+'</svg>';
}

// Site readings: clock-position rows × point columns + AVG row (report style).
function _htSiteTable(survey, P, limit, bar){
  var pts=survey.points||[], clocks=htSiteClocks(survey);
  var heads = ['Location / point'].concat(pts.map(function(p){ return p.label+' ('+p.n+')'; }));
  var rows = clocks.map(function(c){
    return { cells: [{ v:c, extra:'font-family:\'Geist Mono\',monospace;color:#555' }].concat(pts.map(function(p){ var x=p.clock?p.clock[c]:''; return { v:(x===''||x==null?'—':escapeHtml(x)), extra:'font-family:\'Geist Mono\',monospace' }; })) };
  });
  rows.push({ rowStyle:'background:#f3f4f6', cells: [{ v:'AVG', extra:'font-weight:700' }].concat(pts.map(function(p){ var a=htSiteAvg(p,clocks), over=limit&&a!=null&&a>limit; return { v:_htAvgCell(a, over), extra:'font-weight:700;font-family:\'Geist Mono\',monospace' }; })) });
  return _htTableEl(heads, rows, bar, P);
}

// Weld readings: a (possibly sliced) flat row list. Flat Line column (no
// rowspan) so a slice can start/stop on any row across page breaks.
function _htTable(survey, P, limit, flat, bar){
  var heads = ['Line','Zone','Pos','HV #1','HV #2','HV #3','Average'];
  var rows = (flat || []).map(function(p){
    var a = htAvg(p.r), over = limit && a != null && a > limit;
    return { cells: [
      { v:escapeHtml(p.line||''), extra:'font-weight:600' },
      { v:escapeHtml(p.zone||'') },
      { v:(p.pos==null||p.pos===''?'—':((p.pos>0?'+':'')+escapeHtml(p.pos))), extra:'font-family:\'Geist Mono\',monospace' }
    ].concat(p.r.map(function(x){ return { v:(x===''||x==null?'—':escapeHtml(x)), extra:'font-family:\'Geist Mono\',monospace' }; }))
      .concat([{ v:_htAvgCell(a, over), extra:'font-weight:700;font-family:\'Geist Mono\',monospace' }]) };
  });
  return _htTableEl(heads, rows, bar, P);
}

// ══════════════════════════════════════════════════════════════════════════
// DATA ENTRY (report form). _htSurvey is the source of truth; the grid edits it.
// ══════════════════════════════════════════════════════════════════════════
var _htSurvey = null;

function htRenderEntrySection(existing){
  _htSurvey = (existing && (existing.welds || existing.rows || existing.zones || existing.points)) ? htNormalize(JSON.parse(JSON.stringify(existing))) : htDefault('site-piping');
  htSyncWelds();
  return '<div class="sc" style="margin:0 14px 14px"><div class="sc-head"><span class="sc-title">Hardness survey</span></div><div class="sc-body" style="padding:14px 16px">'
    + '<div class="fg form-row" style="margin-bottom:4px;display:flex;gap:12px;flex-wrap:wrap">'
      + '<div class="fld" style="width:220px"><label>Survey type</label><select id="ht-mode" data-on-change="htSetMode" data-pass-el="1">'
        + '<option value="site-piping"'+(_htSurvey.mode==='site-piping'?' selected':'')+'>Site piping (5-zone, multi-weld)</option>'
        + '<option value="weld-traverse"'+(_htSurvey.mode==='weld-traverse'?' selected':'')+'>Weld traverse (lab macro, 1 weld)</option></select></div>'
      + '<div class="fld" style="width:120px"><label>Scale</label><input id="ht-scale" value="'+escapeHtml(_htSurvey.scale||'HV10')+'" data-on-input="htEntryChanged"/></div>'
      + '<div class="fld" style="width:150px"><label>Acceptance max (HV)</label><input id="ht-limit" type="number" value="'+escapeHtml(_htSurvey.limitMax||248)+'" data-on-input="htEntryChanged"/></div>'
    + '</div>'
    + '<div style="font-size:11px;color:var(--t3);margin:2px 0 12px">Weld identification (no., drawing, material, result) comes from the <b>Examination details</b> table above — one line per weld.</div>'
    + '<div id="ht-grid">'+htGridHtml()+'</div>'
    + '<div style="font-size:11px;color:var(--t3);margin:10px 0 6px;text-transform:uppercase;letter-spacing:.05em">Live preview</div>'
    + '<div id="ht-preview" style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:14px 16px">'+htRenderSurvey(_htSurvey,{print:true,items:_htItems()})+'</div>'
    + '</div></div>';
}

// The examination items drive the welds (one weld per item line).
function _htItems(){ return (typeof _ovItems !== 'undefined' && Array.isArray(_ovItems)) ? _ovItems : []; }
function _htItemCount(){ var n = _htItems().length; return n > 0 ? n : 1; }
function _htWeldLabel(wi){ var it = _htItems()[wi]; return (it && it.subject) ? it.subject : ''; }
// Keep _htSurvey.welds aligned with the item count (site) / single (traverse).
function htSyncWelds(){
  if(!_htSurvey) return;
  if(!Array.isArray(_htSurvey.welds)) _htSurvey = htNormalize(_htSurvey);
  if(_htSurvey.mode === 'site-piping'){
    var n = _htItemCount();
    while(_htSurvey.welds.length < n) _htSurvey.welds.push(_htBlankSiteWeld());
    if(_htSurvey.welds.length > n) _htSurvey.welds = _htSurvey.welds.slice(0, n);
  } else {
    _htSurvey.welds = [ _htSurvey.welds[0] || { rows: _htBlankWeldRows() } ];
  }
}
// Called from the items table add/remove hooks so grids track the item rows.
function htSyncToItems(){ if(!_htSurvey) return; htReadGrid(); htSyncWelds(); htRebuildGrid(); }

function _htZoneSel(val, wi, row, pt){
  return '<select data-ht-weld="'+wi+'" data-ht-row="'+row+'" data-ht-pt="'+pt+'" data-ht-field="zone" data-on-change="htEntryChanged" style="width:84px">'
    + ['PM','HAZ','Weld'].map(function(z){ return '<option'+(z===val?' selected':'')+'>'+z+'</option>'; }).join('') + '</select>';
}
function _htNum(val, wi, row, pt, field, ph, w){
  return '<input type="number" step="any" data-ht-weld="'+wi+'" data-ht-row="'+row+'" data-ht-pt="'+pt+'" data-ht-field="'+field+'" data-on-input="htEntryChanged" value="'+(val===''||val==null?'':escapeHtml(val))+'" placeholder="'+(ph||'')+'" style="width:'+(w||60)+'px"/>';
}
function _htClk(val, wi, ptIdx, clock){
  return '<input type="number" step="any" data-ht-weld="'+wi+'" data-ht-row="'+ptIdx+'" data-ht-clock="'+clock+'" data-on-input="htEntryChanged" value="'+(val===''||val==null?'':escapeHtml(val))+'" placeholder="HV" style="width:62px"/>';
}

function htGridHtml(){
  var s = _htSurvey;
  if(s.mode === 'site-piping'){
    var clocks = htSiteClocks(s);
    var bore = '<div class="fld" style="width:260px;margin-bottom:12px"><label>Pipe size</label><select id="ht-bore" data-on-change="htBoreChange" data-pass-el="1">'
      + '<option value="small"'+(s.bore==='small'?' selected':'')+'>≤ 6″ — 12 o’clock</option>'
      + '<option value="medium"'+(s.bore==='medium'?' selected':'')+'>6–12″ — 4 / 8 o’clock</option>'
      + '<option value="large"'+(s.bore!=='small'&&s.bore!=='medium'?' selected':'')+'>&gt; 12″ — 12 / 4 / 8 o’clock</option></select></div>';
    var head = '<th>Pt</th><th>Zone</th>' + clocks.map(function(c){ return '<th>'+c+'</th>'; }).join('') + '<th>Avg</th>';
    var multi = (s.welds||[]).length > 1;
    var grids = (s.welds||[]).map(function(weld, wi){
      var lbl = _htWeldLabel(wi);
      var del = multi ? '<button class="btn btn-sm btn-danger" data-action="htRemoveWeld" data-args="'+wi+'" title="Remove this weld" style="padding:2px 9px;font-size:11px;margin-left:10px">− Remove weld</button>' : '';
      var rows = (weld.points||[]).map(function(p,i){
        var a = htSiteAvg(p, clocks);
        return '<tr><td style="padding:5px 8px;font-family:var(--mono);color:var(--t3)">'+p.n+'</td>'
          + '<td style="padding:5px 8px;font-weight:600;color:var(--t1)">'+escapeHtml(p.label)+'</td>'
          + clocks.map(function(c){ return '<td style="padding:4px 6px">'+_htClk(p.clock?p.clock[c]:'', wi, i, c)+'</td>'; }).join('')
          + '<td style="padding:5px 8px;font-family:var(--mono);color:var(--cyan)">'+(a!=null?a:'—')+'</td></tr>';
      }).join('');
      return '<div style="margin-bottom:14px"><div style="display:flex;align-items:center;font-size:12px;font-weight:600;color:var(--t1);margin-bottom:5px">Weld '+(wi+1)+(lbl?' — '+escapeHtml(lbl):'')+del+'</div>'
        + '<table class="tbl" style="width:auto"><thead><tr>'+head+'</tr></thead><tbody>'+rows+'</tbody></table></div>';
    }).join('');
    return bore + grids
      + '<button class="btn btn-sm" data-action="htAddWeld" style="margin-top:2px">+ Add weld</button>'
      + '<div style="font-size:11px;color:var(--t3);margin-top:6px">Each weld is one line in the Examination details table above — adding/removing here keeps them in sync.</div>';
  }
  // weld traverse — single weld (welds[0]), one sub-table per row
  var w0 = (s.welds && s.welds[0]) || { rows:[] };
  return (w0.rows||[]).map(function(row, ri){
    var pr = (row.points||[]).map(function(p, pi){
      var a = htAvg(p.r);
      return '<tr><td style="padding:4px 6px">'+_htZoneSel(p.zone, 0, ri, pi)+'</td>'
        + '<td style="padding:4px 6px">'+_htNum(p.pos, 0, ri, pi, 'pos', 'mm', 64)+'</td>'
        + '<td style="padding:4px 6px">'+_htNum(p.r[0], 0, ri, pi, 'r0', '#1')+'</td><td style="padding:4px 6px">'+_htNum(p.r[1], 0, ri, pi, 'r1', '#2')+'</td><td style="padding:4px 6px">'+_htNum(p.r[2], 0, ri, pi, 'r2', '#3')+'</td>'
        + '<td style="padding:5px 8px;font-family:var(--mono);color:var(--cyan)">'+(a!=null?a:'—')+'</td>'
        + '<td style="padding:4px 6px"><button class="btn btn-sm btn-danger" data-action="htRemovePoint" data-args="'+ri+','+pi+'" title="Remove point" style="padding:2px 7px">×</button></td></tr>';
    }).join('');
    return '<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:5px">'+escapeHtml(row.label)+' row</div>'
      + '<table class="tbl" style="width:auto"><thead><tr><th>Zone</th><th>Pos (mm)</th><th>HV #1</th><th>HV #2</th><th>HV #3</th><th>Avg</th><th></th></tr></thead><tbody>'+pr+'</tbody></table>'
      + '<button class="btn btn-sm" data-action="htAddPoint" data-args="'+ri+'" style="margin-top:6px">+ point</button></div>';
  }).join('');
}

// read DOM grid → _htSurvey.welds (without rebuilding the grid)
function htReadGrid(){
  if(!_htSurvey) return;
  var sc = el('ht-scale'); if(sc) _htSurvey.scale = sc.value || 'HV10';
  var lm = el('ht-limit'); if(lm) _htSurvey.limitMax = parseFloat(lm.value) || 0;
  var grid = el('ht-grid'); if(!grid) return;
  var welds = _htSurvey.welds || [];
  if(_htSurvey.mode === 'site-piping'){
    welds.forEach(function(weld, wi){
      (weld.points||[]).forEach(function(p, i){
        if(!p.clock) p.clock = {};
        ['12H','04H','08H'].forEach(function(c){ var inp = grid.querySelector('[data-ht-weld="'+wi+'"][data-ht-row="'+i+'"][data-ht-clock="'+c+'"]'); if(inp) p.clock[c] = inp.value; });
      });
    });
  } else {
    var w0 = welds[0] || { rows:[] };
    (w0.rows||[]).forEach(function(row, ri){
      (row.points||[]).forEach(function(p, pi){
        var zs = grid.querySelector('[data-ht-weld="0"][data-ht-row="'+ri+'"][data-ht-pt="'+pi+'"][data-ht-field="zone"]'); if(zs) p.zone = zs.value;
        var ps = grid.querySelector('[data-ht-weld="0"][data-ht-row="'+ri+'"][data-ht-pt="'+pi+'"][data-ht-field="pos"]'); if(ps) p.pos = ps.value === '' ? '' : parseFloat(ps.value);
        ['r0','r1','r2'].forEach(function(f, k){ var inp = grid.querySelector('[data-ht-weld="0"][data-ht-row="'+ri+'"][data-ht-pt="'+pi+'"][data-ht-field="'+f+'"]'); if(inp) p.r[k] = inp.value; });
      });
    });
  }
}
function htRenderPreview(){ var pv = el('ht-preview'); if(pv) pv.innerHTML = htRenderSurvey(_htSurvey, { print:true, items:_htItems() }); }
function htRebuildGrid(){ var g = el('ht-grid'); if(g) g.innerHTML = htGridHtml(); htRenderPreview(); }

function htEntryChanged(){ htReadGrid(); htAutoVerdicts(); htRenderPreview(); }
// Each weld's pass/fail is derived from its HV readings and written back to the
// matching Examination-details item verdict (so the report's Result column +
// overall verdict track the measurements). Updates the select in place.
function htAutoVerdicts(){
  if(!_htSurvey || typeof _ovItems === 'undefined' || !Array.isArray(_ovItems)) return;
  var limit = parseFloat(_htSurvey.limitMax) || 0;
  (_htSurvey.welds || []).forEach(function(w, i){
    var v = htVerdict(_htWeldView(_htSurvey, w));
    var verdict = (!limit || !v.total) ? '' : (v.passed ? 'Acceptable' : 'Not acceptable');
    if(_ovItems[i]) _ovItems[i].verdict = verdict;
    var sel = el('it-' + i + '-verdict');
    if(sel && sel.value !== verdict){
      sel.value = verdict;
      if(typeof ovVerdictStyle === 'function'){ sel.style.cssText = 'width:100%;height:32px;box-sizing:border-box;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);color:var(--t1);font-family:var(--font);' + ovVerdictStyle(verdict); }
    }
  });
}
// Add a weld (and a matching Examination-details line) from the survey side.
function htAddWeld(){
  htReadGrid();
  if(typeof ovHtAddItem === 'function') ovHtAddItem();
  else if(_htSurvey && _htSurvey.welds) _htSurvey.welds.push(_htBlankSiteWeld());
  htSyncWelds();
  htRebuildGrid();
}
// Remove a weld (and its Examination-details line) — for a mis-added row.
function htRemoveWeld(wi){
  htReadGrid();
  if(!_htSurvey || !_htSurvey.welds || _htSurvey.welds.length <= 1) return;
  _htSurvey.welds.splice(wi, 1);
  if(typeof ovHtRemoveItem === 'function') ovHtRemoveItem(wi);
  htSyncWelds();
  htRebuildGrid();
}
function htSetMode(sel){
  sel = sel || el('ht-mode'); if(!sel) return;
  htReadGrid();
  var m = sel.value;
  if(m !== _htSurvey.mode){ _htSurvey = Object.assign(htDefault(m), { scale:_htSurvey.scale, limitMax:_htSurvey.limitMax, bore:_htSurvey.bore }); }
  // traverse = exactly one weld; let the form trim the items table to one line.
  if(typeof ovHtModeChanged === 'function') ovHtModeChanged(m);
  htSyncWelds();
  htRebuildGrid();
}
function htBoreChange(sel){ sel = sel || el('ht-bore'); if(!sel) return; htReadGrid(); _htSurvey.bore = sel.value; htRebuildGrid(); }
function htAddPoint(ri){ htReadGrid(); var w0 = _htSurvey.welds && _htSurvey.welds[0]; var row = w0 && w0.rows && w0.rows[ri]; if(row){ row.points.push({ zone:'HAZ', pos:'', r:['','',''] }); htRebuildGrid(); } }
function htRemovePoint(ri, pi){ htReadGrid(); var w0 = _htSurvey.welds && _htSurvey.welds[0]; var row = w0 && w0.rows && w0.rows[ri]; if(row){ row.points.splice(pi,1); htRebuildGrid(); } }
function htIsTraverse(){ return !!(_htSurvey && _htSurvey.mode === 'weld-traverse'); }

// called by ovSaveReport for HT reports
function htCollect(){ htReadGrid(); htSyncWelds(); htAutoVerdicts(); return _htSurvey ? JSON.parse(JSON.stringify(_htSurvey)) : null; }

// ── default template seeding ─────────────────────────────────────────────────
// Ensure the HT report template is a COMPLETE report — the standard header/
// fields/result layout (same as every other method) plus a dedicated hardness-
// survey page — so HT reports aren't just a bare survey with no report chrome.
//
// Migration (v3): the HT survey is now TWO place cards — 'ht-method' (the
// methodology drawing) and 'ht-survey' (the results). Cases handled once:
//   • no real layout (fresh / old survey-only seed) → full report + survey page
//   • real layout but no HT cards at all            → append a survey page
//   • has ht-survey but no ht-method (the v2 seed)  → insert a method card above
//     each survey card so the drawing isn't lost when ht-survey went results-only
function _htNid(){ return (typeof _cvBlockId === 'function') ? _cvBlockId() : ('ht-' + Math.random().toString(36).slice(2,9)); }
// Swap the single-value Subject-information field cards (they only show the
// first weld) for an Examination-details items-table so a multi-weld HT report
// lists every weld. Returns a new blocks array; shifts lower blocks to fit.
function _htReplaceSubjectWithItems(blocks){
  if(!Array.isArray(blocks) || !blocks.length) return blocks;
  if(blocks.some(function(b){ return b && b.key === 'items-table'; })) return blocks;   // already has one
  var subj = {'subject':1,'drawing-no':1,'subject-no':1,'welders':1,'material':1,'weld-prep':1,'heat-treat':1,'thickness':1,'surf-cond':1,'temperature':1,'weld-pos':1};
  var isSubjHdr = function(b){ return b && b.key === 'section-header' && /subject/i.test(b.text || ''); };
  var rm = blocks.filter(function(b){ return b && (subj[b.key] || isSubjHdr(b)); });
  if(!rm.length) return blocks;
  var top = Math.min.apply(null, rm.map(function(b){ return b.y || 0; }));
  var bot = Math.max.apply(null, rm.map(function(b){ return (b.y || 0) + (b.h || 0); }));
  var kept = blocks.filter(function(b){ return !(b && (subj[b.key] || isSubjHdr(b))); });
  var itH = 150, delta = (top + itH) - bot;
  kept.forEach(function(b){ if((b.y || 0) >= bot - 0.5) b.y = (b.y || 0) + delta; });
  kept.push({ id:_htNid(), key:'items-table', isLayout:true, x:20, y:top, w:754, h:itH, showBorder:false, fontSize:'8.5px' });
  kept.sort(function(a,b){ return (a.y || 0) - (b.y || 0); });
  return kept;
}
function _htPage1Blocks(){
  return _htReplaceSubjectWithItems((typeof cvDefaultLayoutBlocks === 'function') ? cvDefaultLayoutBlocks() : []);
}
function _htSurveyPage(){
  return { label:'Hardness survey', blocks:[
    { id:_htNid(), key:'ht-method', isLayout:true, x:20, y:20,  w:754, h:330, showBorder:true, borderColor:'#dddddd' },   // methodology drawing
    { id:_htNid(), key:'ht-survey', isLayout:true, x:20, y:362, w:754, h:740, showBorder:true, borderColor:'#dddddd' },   // results — per-weld blocks (paginates → MAIN CONT)
  ] };
}
function htSeedTemplateBlock(){
  try {
    var PFX = (typeof CV_METHOD_TPL_PREFIX !== 'undefined') ? CV_METHOD_TPL_PREFIX : 'vx-method-tpl-';
    var KEY = PFX + 'HT';
    var FLAG = 'vx-ht-tpl-seeded-v5';
    if(localStorage.getItem(FLAG)) return;
    var tpl = ls(KEY, null);
    var pages = (tpl && Array.isArray(tpl.pages)) ? tpl.pages : [];
    var allBlocks = pages.reduce(function(a,p){ return a.concat(p.blocks||[]); }, []);
    var hasSurvey = allBlocks.some(function(b){ return b && b.key === 'ht-survey'; });
    var hasMethod = allBlocks.some(function(b){ return b && b.key === 'ht-method'; });
    var hasItems  = allBlocks.some(function(b){ return b && b.key === 'items-table'; });
    var nonSurvey = allBlocks.filter(function(b){ return b && b.key !== 'ht-survey' && b.key !== 'ht-method'; }).length;

    // v5: existing split templates — give the results card height for per-weld
    // blocks, and swap the single subject cards for an examination-details table.
    if(hasSurvey && hasMethod){
      var changed = false;
      allBlocks.forEach(function(b){ if(b && b.key === 'ht-survey' && (b.h || 0) < 740){ b.h = 740; changed = true; } });
      if(!hasItems){
        pages.forEach(function(p){
          if((p.blocks||[]).some(function(b){ return b && (b.key === 'subject' || b.key === 'material'); })){
            p.blocks = _htReplaceSubjectWithItems(p.blocks); changed = true;
          }
        });
      }
      if(changed) lss(KEY, tpl);
      localStorage.setItem(FLAG, '1');
      return;
    }

    if(nonSurvey === 0){
      // Fresh, or the old survey-only seed → build a full report + survey page.
      var page1 = _htPage1Blocks();
      var newPages = page1.length ? [ { label:'Report', blocks:page1 }, _htSurveyPage() ] : [ _htSurveyPage() ];
      lss(KEY, { pages:newPages, nextId: (allBlocks.length + page1.length + 6), savedAt: new Date().toISOString() });
    } else if(!hasSurvey && !hasMethod){
      // Real custom layout but no HT cards → append a survey page, leave the rest.
      tpl.pages.push(_htSurveyPage());
      tpl.nextId = (tpl.nextId || allBlocks.length) + 3;
      lss(KEY, tpl);
    } else if(hasSurvey && !hasMethod){
      // v2 single-card template → insert a method card above each survey card so
      // the methodology drawing isn't lost (ht-survey now renders results-only).
      pages.forEach(function(p){
        var blocks = p.blocks || [];
        for(var i = 0; i < blocks.length; i++){
          if(blocks[i] && blocks[i].key === 'ht-survey'){
            var sb = blocks[i];
            var method = { id:_htNid(), key:'ht-method', isLayout:true, x:(sb.x||20), y:(sb.y||20), w:(sb.w||754), h:330, showBorder:true, borderColor:'#dddddd' };
            sb.y = (sb.y || 20) + 340; sb.h = Math.max(560, (sb.h || 1040) - 340);
            blocks.splice(i, 0, method); i++;   // skip the inserted method card
          }
        }
      });
      tpl.nextId = (tpl.nextId || allBlocks.length) + 3;
      lss(KEY, tpl);
    }
    localStorage.setItem(FLAG, '1');
  } catch(e){ console.warn('htSeedTemplateBlock failed', e); }
}
window.addEventListener('DOMContentLoaded', function(){ try { htSeedTemplateBlock(); } catch(e){} });
