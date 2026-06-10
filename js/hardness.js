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
function _htAll(survey){
  if(!survey) return [];
  if(survey.mode === 'site-piping') return (survey.zones || []).map(function(z){ return { label:z.label, kind:z.kind, avg:htAvg(z.r) }; });
  var out = [];
  (survey.rows || []).forEach(function(row){ (row.points || []).forEach(function(p){ out.push({ label:row.label, kind:p.zone, avg:htAvg(p.r) }); }); });
  return out;
}
function htPeak(survey){ var m=0, w=''; _htAll(survey).forEach(function(a){ if(a.avg!=null && a.avg>m){ m=a.avg; w=a.kind+' · '+a.label; } }); return { value:m, where:w }; }
function htVerdict(survey){ var lim=(survey&&survey.limitMax)||0; var over=_htAll(survey).filter(function(a){ return a.avg!=null && lim && a.avg>lim; }).length; return { over:over, passed:over===0, total:_htAll(survey).filter(function(a){return a.avg!=null;}).length }; }

// ── sample surveys (editor preview / starter) ────────────────────────────────
function _pt(zone,pos,a,b,c){ return { zone:zone, pos:pos, r:[a,b,c] }; }
var HT_SAMPLE_WELD = { mode:'weld-traverse', scale:'HV10', limitMax:248, rows:[
  { label:'Cap',  points:[_pt('PM',-15,182,179,184),_pt('PM',-12,185,188,183),_pt('HAZ',-9,228,231,226),_pt('HAZ',-7,252,258,255),_pt('Weld',-4,221,224,219),_pt('Weld',0,215,218,213),_pt('Weld',4,223,220,226),_pt('HAZ',7,246,243,249),_pt('HAZ',9,229,232,227),_pt('PM',12,186,189,184),_pt('PM',15,180,183,178)] },
  { label:'Mid',  points:[_pt('PM',-15,178,181,176),_pt('HAZ',-8,221,224,219),_pt('HAZ',-7,238,241,236),_pt('Weld',0,210,213,208),_pt('HAZ',7,236,233,239),_pt('HAZ',8,223,226,221),_pt('PM',15,177,180,175)] },
  { label:'Root', points:[_pt('PM',-15,180,177,183),_pt('HAZ',-8,225,228,223),_pt('HAZ',-7,243,246,241),_pt('Weld',0,214,217,212),_pt('HAZ',7,240,237,243),_pt('HAZ',8,226,229,224),_pt('PM',15,181,184,179)] },
]};
function _z(label,kind,a,b,c){ return { label:label, kind:kind, r:[a,b,c] }; }
var HT_SAMPLE_SITE = { mode:'site-piping', scale:'HV10', limitMax:248, zones:[
  _z('Material','PM',185,182,188), _z('HAZ','HAZ',242,247,245), _z('Weld','Weld',221,224,219), _z('HAZ','HAZ',250,254,252), _z('Material','PM',187,184,190),
]};

// ── default (empty) survey for a new report ──────────────────────────────────
function htDefault(mode){
  if(mode === 'site-piping') return { mode:'site-piping', scale:'HV10', limitMax:248, zones:[
    _z('Material','PM','','',''), _z('HAZ','HAZ','','',''), _z('Weld','Weld','','',''), _z('HAZ','HAZ','','',''), _z('Material','PM','','','') ] };
  var tmpl = [['PM',-15],['PM',-12],['HAZ',-9],['HAZ',-7],['Weld',-4],['Weld',0],['Weld',4],['HAZ',7],['HAZ',9],['PM',12],['PM',15]];
  function row(label){ return { label:label, points: tmpl.map(function(t){ return { zone:t[0], pos:t[1], r:['','',''] }; }) }; }
  return { mode:'weld-traverse', scale:'HV10', limitMax:248, rows:[ row('Cap'), row('Mid'), row('Root') ] };
}

// ══════════════════════════════════════════════════════════════════════════
// RENDERER — returns an HTML string (SVG + readings table). Print/light palette.
// ══════════════════════════════════════════════════════════════════════════
var HT_P = { ink:'#222a36', mut:'#6b7686', grid:'#dde3ec', line:'#c3ccd8',
  cyan:'#0e7fa6', amber:'#b8841c', green:'#2f9e63', red:'#cf3b3b',
  pmFill:'rgba(0,0,0,.022)', hazFill:'rgba(184,132,28,.10)', weldFill:'rgba(14,127,166,.08)' };
function _htRowColors(){ return ['#0e7fa6','#3a6db5','#2f9e63']; }   // Cap / Mid / Root

// Flatten the survey into table rows (one per point/zone) so the readings
// table can be sliced for auto-pagination across printed sheets.
function htFlatRows(survey){
  if(!survey) return [];
  if(survey.mode === 'site-piping') return (survey.zones || []).map(function(z){ return { line:'', zone:z.label, pos:null, r:z.r }; });
  var out = [];
  (survey.rows || []).forEach(function(row){ (row.points || []).forEach(function(p){ out.push({ line:row.label, zone:p.zone, pos:p.pos, r:p.r }); }); });
  return out;
}
function htRowsOf(survey){ return htFlatRows(survey).length; }

// opts: { print, sample, slice:{start,count} }. When slice.start>0 this is a
// continuation sheet — render only the (sliced) readings table, no chart.
function htRenderSurvey(survey, opts){
  opts = opts || {};
  if((!survey || (!survey.rows && !survey.zones)) && opts.sample) survey = HT_SAMPLE_WELD;
  if(!survey || (!survey.rows && !survey.zones)) return '<div style="padding:18px;color:#9aa6b5;font-size:11px;text-align:center">No hardness survey recorded.</div>';
  var P = HT_P, scale = survey.scale || 'HV10', limit = parseFloat(survey.limitMax) || 0;
  var slice = opts.slice || null;
  var continued = !!(slice && slice.start > 0);
  var head;
  if(continued){
    head = '<div style="font-family:\'Geist Mono\',monospace;font-size:10px;color:'+P.mut+';margin-bottom:6px">Hardness survey · '+escapeHtml(scale)+' — readings (continued)</div>';
  } else {
    var peak = htPeak(survey), v = htVerdict(survey);
    head = '<div style="display:flex;justify-content:space-between;align-items:baseline;font-family:\'Geist Mono\',monospace;font-size:10px;color:'+P.mut+';margin-bottom:6px">'
      + '<span>Hardness survey · '+escapeHtml(scale)+' · '+(survey.mode==='site-piping'?'site (surface, 5 zones)':'weld traverse')+' · avg of 3 per point</span>'
      + '<span>Peak '+(peak.value||'—')+' '+escapeHtml(scale)+(limit?(' · '+(v.passed?'<b style="color:'+P.green+'">PASS</b>':'<b style="color:'+P.red+'">FAIL</b>')+' (max '+limit+')'):'')+'</span></div>';
  }
  var visual = continued ? '' : (survey.mode === 'site-piping' ? _htSiteSvgs(survey, P, limit, scale) : _htWeldSvgs(survey, P, limit, scale));
  var rows = htFlatRows(survey);
  var start = slice ? slice.start : 0;
  var count = slice ? slice.count : rows.length;
  var table = _htTable(survey, P, limit, rows.slice(start, start + count));
  return '<div style="font-family:\'Geist\',system-ui,sans-serif">' + head + visual + table + '</div>';
}

// dynamic Y domain from data + limit
function _htYDomain(survey, limit){
  var vals = _htAll(survey).map(function(a){ return a.avg; }).filter(function(x){ return x!=null; });
  if(limit) vals.push(limit);
  if(!vals.length) return [150, 280];
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  return [ Math.floor((lo-15)/25)*25, Math.ceil((hi+15)/25)*25 ];
}

function _htWeldSvgs(survey, P, limit, scale){
  var XMIN=-18, XMAX=18, PL=46, PR=748, dom=_htYDomain(survey, limit), YMIN=dom[0], YMAX=dom[1];
  function xs(p){ return PL + (p-XMIN)/(XMAX-XMIN)*(PR-PL); }
  // ── cross-section ──
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
  var sec='<svg viewBox="0 0 794 128" style="width:100%;height:auto;display:block">'+s1+'</svg>';
  // ── profile ──
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
  var prof='<svg viewBox="0 0 794 204" style="width:100%;height:auto;display:block">'+s2+'</svg><div style="font-family:\'Geist\',sans-serif;font-size:10px;color:'+P.mut+';margin-top:2px">'+leg+'</div>';
  return sec + '<div style="height:8px"></div>' + prof;
}

function _htSiteSvgs(survey, P, limit, scale){
  var zones=survey.zones||[], n=zones.length||5, PL=46, PR=748, dom=_htYDomain(survey,limit), YMIN=dom[0], YMAX=dom[1];
  function kf(k){ return k==='HAZ'?P.hazFill:k==='Weld'?P.weldFill:P.pmFill; }
  function kc(k){ return k==='HAZ'?P.amber:k==='Weld'?P.cyan:P.mut; }
  function zx(i){ return PL + (i+0.5)/n*(PR-PL); }
  // strip
  var top=22, h=54, segW=(PR-PL)/n, s1='';
  zones.forEach(function(z,i){ var x=PL+i*segW, a=htAvg(z.r), over=limit&&a!=null&&a>limit;
    s1+='<rect x="'+(x+3)+'" y="'+top+'" width="'+(segW-6)+'" height="'+h+'" rx="5" fill="'+kf(z.kind)+'" stroke="'+(over?P.red:P.line)+'" stroke-width="'+(over?'1.6':'1')+'"/>';
    s1+='<text x="'+(x+segW/2)+'" y="'+(top-6)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="9" fill="'+kc(z.kind)+'">'+escapeHtml(z.label.toUpperCase())+'</text>';
    s1+='<text x="'+(x+segW/2)+'" y="'+(top+h/2+2)+'" text-anchor="middle" font-family="\'Funnel Display\',sans-serif" font-weight="700" font-size="19" fill="'+(over?P.red:P.ink)+'">'+(a!=null?a:'—')+'</text>';
    s1+='<text x="'+(x+segW/2)+'" y="'+(top+h/2+15)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="8.5" fill="'+P.mut+'">HV avg</text>'; });
  s1+='<text x="'+PL+'" y="'+(top+h+18)+'" font-family="\'Geist Mono\',monospace" font-size="8.5" fill="'+P.mut+'">▲ measured on the outer surface, across the weld cap</text>';
  var strip='<svg viewBox="0 0 794 104" style="width:100%;height:auto;display:block">'+s1+'</svg>';
  // profile
  var CT=14, CB=168; function ys(v){ return CT+(1-(v-YMIN)/(YMAX-YMIN))*(CB-CT); }
  var s2='';
  zones.forEach(function(z,i){ var bw=(PR-PL)/n; s2+='<rect x="'+(zx(i)-bw/2)+'" y="'+CT+'" width="'+bw+'" height="'+(CB-CT)+'" fill="'+kf(z.kind)+'" opacity=".55"/>'; s2+='<text x="'+zx(i)+'" y="'+(CB+13)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="9" fill="'+kc(z.kind)+'">'+escapeHtml(z.label)+'</text>'; });
  for(var hh=YMIN; hh<=YMAX; hh+=25){ s2+='<line x1="'+PL+'" y1="'+ys(hh)+'" x2="'+PR+'" y2="'+ys(hh)+'" stroke="'+P.grid+'"/><text x="'+(PL-6)+'" y="'+(ys(hh)+3)+'" text-anchor="end" font-family="\'Geist Mono\',monospace" font-size="8.5" fill="'+P.mut+'">'+hh+'</text>'; }
  if(limit>=YMIN&&limit<=YMAX){ s2+='<line x1="'+PL+'" y1="'+ys(limit)+'" x2="'+PR+'" y2="'+ys(limit)+'" stroke="'+P.red+'" stroke-width="1.3" stroke-dasharray="6 4"/><text x="'+(PR-3)+'" y="'+(ys(limit)-4)+'" text-anchor="end" font-family="\'Geist Mono\',monospace" font-size="9" fill="'+P.red+'">max '+limit+'</text>'; }
  var line=zones.map(function(z,i){ var a=htAvg(z.r); return a!=null?(zx(i)+','+ys(a)):null; }).filter(Boolean).join(' ');
  if(line) s2+='<polyline points="'+line+'" fill="none" stroke="'+P.cyan+'" stroke-width="1.8" stroke-opacity=".85"/>';
  zones.forEach(function(z,i){ var a=htAvg(z.r); if(a==null) return; var over=limit&&a>limit; s2+='<circle cx="'+zx(i)+'" cy="'+ys(a)+'" r="'+(over?4:3.2)+'" fill="'+(over?P.red:P.cyan)+'" stroke="#fff" stroke-width="1"/><text x="'+zx(i)+'" y="'+(ys(a)-9)+'" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="9" fill="'+(over?P.red:P.ink)+'">'+a+'</text>'; });
  var prof='<svg viewBox="0 0 794 196" style="width:100%;height:auto;display:block">'+s2+'</svg>';
  return strip + '<div style="height:8px"></div>' + prof;
}

// Render the readings table for a (possibly sliced) flat row list. Flat Line
// column (no rowspan) so a slice can start/stop on any row across page breaks.
function _htTable(survey, P, limit, flat){
  var site = survey.mode === 'site-piping';
  var th = 'style="text-align:left;padding:5px 8px;border-bottom:1px solid '+P.line+';font:600 9px \'Geist Mono\',monospace;color:'+P.mut+';text-transform:uppercase;letter-spacing:.04em"';
  function td(extra){ return 'style="padding:5px 8px;border-bottom:1px solid '+P.grid+';font-family:\'Geist Mono\',monospace;font-size:11px;color:'+P.ink+';'+(extra||'')+'"'; }
  var head = (site ? '' : '<th '+th+'>Line</th>') + '<th '+th+'>Zone</th>' + (site ? '' : '<th '+th+'>Pos</th>') + '<th '+th+'>HV #1</th><th '+th+'>HV #2</th><th '+th+'>HV #3</th><th '+th+'>Average</th>';
  var rows = (flat || []).map(function(p){
    var a = htAvg(p.r), over = limit && a != null && a > limit;
    var c = site ? '' : '<td '+td('font-weight:600')+'>'+escapeHtml(p.line||'')+'</td>';
    c += '<td '+td()+'>'+escapeHtml(p.zone||'')+'</td>';
    if(!site) c += '<td '+td()+'>'+(p.pos==null||p.pos===''?'—':((p.pos>0?'+':'')+escapeHtml(p.pos)))+'</td>';
    c += p.r.map(function(x){ return '<td '+td()+'>'+(x===''||x==null?'—':escapeHtml(x))+'</td>'; }).join('');
    c += '<td '+td('font-weight:700;'+(over?'color:'+P.red:''))+'>'+(a!=null?a:'—')+'</td>';
    return '<tr>'+c+'</tr>';
  }).join('');
  return '<table style="width:100%;border-collapse:collapse;margin-top:10px"><thead><tr>'+head+'</tr></thead><tbody>'+rows+'</tbody></table>';
}

// ══════════════════════════════════════════════════════════════════════════
// DATA ENTRY (report form). _htSurvey is the source of truth; the grid edits it.
// ══════════════════════════════════════════════════════════════════════════
var _htSurvey = null;

function htRenderEntrySection(existing){
  _htSurvey = (existing && (existing.rows || existing.zones)) ? JSON.parse(JSON.stringify(existing)) : htDefault('weld-traverse');
  var ZONES = ['PM','HAZ','Weld'];
  void ZONES;
  return '<div class="sc" style="margin:0 14px 14px"><div class="sc-head"><span class="sc-title">Hardness survey</span></div><div class="sc-body" style="padding:14px 16px">'
    + '<div class="fg form-row" style="margin-bottom:10px;display:flex;gap:12px;flex-wrap:wrap">'
      + '<div class="fld" style="width:200px"><label>Survey type</label><select id="ht-mode" data-on-change="htSetMode">'
        + '<option value="weld-traverse"'+(_htSurvey.mode==='weld-traverse'?' selected':'')+'>Weld traverse (lab macro)</option>'
        + '<option value="site-piping"'+(_htSurvey.mode==='site-piping'?' selected':'')+'>Site piping (5-zone surface)</option></select></div>'
      + '<div class="fld" style="width:120px"><label>Scale</label><input id="ht-scale" value="'+escapeHtml(_htSurvey.scale||'HV10')+'" data-on-input="htEntryChanged"/></div>'
      + '<div class="fld" style="width:150px"><label>Acceptance max (HV)</label><input id="ht-limit" type="number" value="'+escapeHtml(_htSurvey.limitMax||248)+'" data-on-input="htEntryChanged"/></div>'
    + '</div>'
    + '<div id="ht-grid">'+htGridHtml()+'</div>'
    + '<div style="font-size:11px;color:var(--t3);margin:10px 0 6px;text-transform:uppercase;letter-spacing:.05em">Live preview</div>'
    + '<div id="ht-preview" style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:14px 16px">'+htRenderSurvey(_htSurvey,{print:true})+'</div>'
    + '</div></div>';
}

function _htZoneSel(val, row, pt){
  return '<select data-ht-row="'+row+'" data-ht-pt="'+pt+'" data-ht-field="zone" data-on-change="htEntryChanged" style="width:84px">'
    + ['PM','HAZ','Weld'].map(function(z){ return '<option'+(z===val?' selected':'')+'>'+z+'</option>'; }).join('') + '</select>';
}
function _htNum(val, row, pt, field, ph, w){
  return '<input type="number" step="any" data-ht-row="'+row+'" data-ht-pt="'+pt+'" data-ht-field="'+field+'" data-on-input="htEntryChanged" value="'+(val===''||val==null?'':escapeHtml(val))+'" placeholder="'+(ph||'')+'" style="width:'+(w||60)+'px"/>';
}

function htGridHtml(){
  var s = _htSurvey;
  if(s.mode === 'site-piping'){
    var rows = (s.zones||[]).map(function(z,i){
      var a = htAvg(z.r);
      return '<tr><td style="padding:5px 8px;font-weight:600;color:var(--t1)">'+escapeHtml(z.label)+'</td>'
        + '<td style="padding:4px 6px">'+_htNum(z.r[0],i,0,'r0','#1')+'</td><td style="padding:4px 6px">'+_htNum(z.r[1],i,1,'r1','#2')+'</td><td style="padding:4px 6px">'+_htNum(z.r[2],i,2,'r2','#3')+'</td>'
        + '<td style="padding:5px 8px;font-family:var(--mono);color:var(--cyan)">'+(a!=null?a:'—')+'</td></tr>';
    }).join('');
    return '<table class="tbl" style="width:auto"><thead><tr><th>Zone</th><th>HV #1</th><th>HV #2</th><th>HV #3</th><th>Avg</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }
  // weld traverse — one sub-table per row
  return (s.rows||[]).map(function(row, ri){
    var pr = (row.points||[]).map(function(p, pi){
      var a = htAvg(p.r);
      return '<tr><td style="padding:4px 6px">'+_htZoneSel(p.zone, ri, pi)+'</td>'
        + '<td style="padding:4px 6px">'+_htNum(p.pos, ri, pi, 'pos', 'mm', 64)+'</td>'
        + '<td style="padding:4px 6px">'+_htNum(p.r[0], ri, pi, 'r0', '#1')+'</td><td style="padding:4px 6px">'+_htNum(p.r[1], ri, pi, 'r1', '#2')+'</td><td style="padding:4px 6px">'+_htNum(p.r[2], ri, pi, 'r2', '#3')+'</td>'
        + '<td style="padding:5px 8px;font-family:var(--mono);color:var(--cyan)">'+(a!=null?a:'—')+'</td>'
        + '<td style="padding:4px 6px"><button class="btn btn-sm btn-danger" data-action="htRemovePoint" data-args="'+ri+','+pi+'" title="Remove point" style="padding:2px 7px">×</button></td></tr>';
    }).join('');
    return '<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:5px">'+escapeHtml(row.label)+' row</div>'
      + '<table class="tbl" style="width:auto"><thead><tr><th>Zone</th><th>Pos (mm)</th><th>HV #1</th><th>HV #2</th><th>HV #3</th><th>Avg</th><th></th></tr></thead><tbody>'+pr+'</tbody></table>'
      + '<button class="btn btn-sm" data-action="htAddPoint" data-args="'+ri+'" style="margin-top:6px">+ point</button></div>';
  }).join('');
}

// read DOM grid → _htSurvey (without rebuilding the grid)
function htReadGrid(){
  if(!_htSurvey) return;
  var sc = el('ht-scale'); if(sc) _htSurvey.scale = sc.value || 'HV10';
  var lm = el('ht-limit'); if(lm) _htSurvey.limitMax = parseFloat(lm.value) || 0;
  var grid = el('ht-grid'); if(!grid) return;
  if(_htSurvey.mode === 'site-piping'){
    (_htSurvey.zones||[]).forEach(function(z, i){
      ['r0','r1','r2'].forEach(function(f, k){ var inp = grid.querySelector('[data-ht-row="'+i+'"][data-ht-pt="'+k+'"][data-ht-field="'+f+'"]'); if(inp) z.r[k] = inp.value; });
    });
  } else {
    (_htSurvey.rows||[]).forEach(function(row, ri){
      (row.points||[]).forEach(function(p, pi){
        var zs = grid.querySelector('[data-ht-row="'+ri+'"][data-ht-pt="'+pi+'"][data-ht-field="zone"]'); if(zs) p.zone = zs.value;
        var ps = grid.querySelector('[data-ht-row="'+ri+'"][data-ht-pt="'+pi+'"][data-ht-field="pos"]'); if(ps) p.pos = ps.value === '' ? '' : parseFloat(ps.value);
        ['r0','r1','r2'].forEach(function(f, k){ var inp = grid.querySelector('[data-ht-row="'+ri+'"][data-ht-pt="'+pi+'"][data-ht-field="'+f+'"]'); if(inp) p.r[k] = inp.value; });
      });
    });
  }
}
function htRenderPreview(){ var pv = el('ht-preview'); if(pv) pv.innerHTML = htRenderSurvey(_htSurvey, { print:true }); }
function htRebuildGrid(){ var g = el('ht-grid'); if(g) g.innerHTML = htGridHtml(); htRenderPreview(); }

function htEntryChanged(){ htReadGrid(); htRenderPreview(); }
function htSetMode(sel){ htReadGrid(); var m = sel.value; if(m !== _htSurvey.mode) _htSurvey = Object.assign(htDefault(m), { scale:_htSurvey.scale, limitMax:_htSurvey.limitMax }); htRebuildGrid(); }
function htAddPoint(ri){ htReadGrid(); var row = _htSurvey.rows[ri]; if(row){ row.points.push({ zone:'HAZ', pos:'', r:['','',''] }); htRebuildGrid(); } }
function htRemovePoint(ri, pi){ htReadGrid(); var row = _htSurvey.rows[ri]; if(row){ row.points.splice(pi,1); htRebuildGrid(); } }

// called by ovSaveReport for HT reports
function htCollect(){ htReadGrid(); return _htSurvey ? JSON.parse(JSON.stringify(_htSurvey)) : null; }

// ── default template seeding ─────────────────────────────────────────────────
// Ensure the HT report template carries a hardness-survey block out of the box,
// so HT reports get the visual in their PDF with zero manual layout work. Adds
// the block on its OWN page (never overlaps an existing layout) and only if the
// template doesn't already have one. A one-time flag means a deliberate later
// removal isn't undone on the next load. Idempotent.
function htSeedTemplateBlock(){
  try {
    var PFX = (typeof CV_METHOD_TPL_PREFIX !== 'undefined') ? CV_METHOD_TPL_PREFIX : 'vx-method-tpl-';
    var KEY = PFX + 'HT';
    var FLAG = 'vx-ht-tpl-seeded-v1';
    if(localStorage.getItem(FLAG)) return;
    var tpl = ls(KEY, null);
    var has = tpl && Array.isArray(tpl.pages) && tpl.pages.some(function(p){ return (p.blocks||[]).some(function(b){ return b && b.key === 'ht-survey'; }); });
    if(!has){
      var nid = (tpl && tpl.nextId) || 1;
      var page = { label:'Hardness survey', blocks:[ { id: nid, key:'ht-survey', isLayout:true, x:20, y:20, w:754, h:1040 } ] };
      if(tpl && Array.isArray(tpl.pages)){ tpl.pages.push(page); tpl.nextId = nid + 1; }
      else { tpl = { pages:[ page ], nextId: nid + 1, savedAt: new Date().toISOString() }; }
      lss(KEY, tpl);
    }
    localStorage.setItem(FLAG, '1');
  } catch(e){ console.warn('htSeedTemplateBlock failed', e); }
}
window.addEventListener('DOMContentLoaded', function(){ try { htSeedTemplateBlock(); } catch(e){} });
