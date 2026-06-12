// ══════════════════════════════════════════════════════════════════════════
// MANAGEMENT REPORTS — exportable business analytics (Thread 1 of the Reports
// feature). The dashboard SHOWS analytics live; this turns the same numbers
// into a shareable, date-ranged deliverable: a branded PDF (KPIs + by-method +
// inspector productivity + defect breakdown) and a per-report CSV.
//
// Reuses the dashboard's own computations — ovFilterByRange (the active date
// range), rptLatestRevisions (count welds once, not every revision) and
// _defCombined (report-embedded + manually-logged defects) — so the report and
// the on-screen dashboard always agree.
// ══════════════════════════════════════════════════════════════════════════

function _mgmtPeriodLabel(){
  var r = (typeof _ovDateRange !== 'undefined') ? _ovDateRange : 30;
  if(r === 'all') return 'All time';
  if(String(r) === '365') return 'Last 12 months';
  return 'Last ' + r + ' days';
}

// Gather the management-report dataset for the dashboard's active date range.
function _mgmtData(){
  var all = (typeof ls === 'function') ? (ls(KEYS.reports, []) || []) : [];
  var ranged = (typeof ovFilterByRange === 'function') ? ovFilterByRange(all) : all;
  var latest = (typeof rptLatestRevisions === 'function') ? rptLatestRevisions(ranged) : ranged;

  var total = latest.length;
  var passed = latest.filter(function(r){ return r.verdict === 'Acceptable'; }).length;
  var failed = latest.filter(function(r){ return r.verdict === 'Not acceptable'; }).length;
  var passRate = total ? Math.round(passed / total * 100) : 0;

  function tally(keyFn){
    var m = {};
    latest.forEach(function(r){ var k = keyFn(r) || '—'; if(!m[k]) m[k] = { n:0, pass:0, fail:0 }; m[k].n++; if(r.verdict === 'Acceptable') m[k].pass++; else if(r.verdict === 'Not acceptable') m[k].fail++; });
    return Object.keys(m).sort(function(a, b){ return m[b].n - m[a].n; }).map(function(k){ return { key:k, n:m[k].n, pass:m[k].pass, fail:m[k].fail, rate: m[k].n ? Math.round(m[k].pass / m[k].n * 100) : 0 }; });
  }
  var byMethod = tally(function(r){ return r.method; });
  var byInspector = tally(function(r){ return r.inspector; });

  var defsAll = (typeof _defCombined === 'function') ? _defCombined() : [];
  var defs = (typeof ovFilterByRange === 'function') ? ovFilterByRange(defsAll) : defsAll;
  var openDef = defs.filter(function(d){ return (d.status || 'Open') === 'Open'; }).length;
  var dt = {};
  defs.forEach(function(d){ var k = d.type || '—'; dt[k] = (dt[k] || 0) + 1; });
  var byType = Object.keys(dt).sort(function(a, b){ return dt[b] - dt[a]; }).map(function(k){ return { key:k, n:dt[k] }; });

  return { latest:latest, total:total, passed:passed, failed:failed, passRate:passRate,
           byMethod:byMethod, byInspector:byInspector, defs:defs, openDef:openDef, byType:byType };
}

// ── Branded PDF (flowing pages, paginates naturally like the billing docs) ───
function vxBuildMgmtReportHtml(data){
  var esc = function(s){ return escapeHtml(String(s == null ? '' : s)); };
  var c = (typeof ls === 'function') ? (ls(KEYS.company, {}) || {}) : {};
  var accent = (c.color && /^#[0-9A-Fa-f]{6}$/.test(c.color)) ? c.color : '#185FA5';
  var period = _mgmtPeriodLabel();
  var fdate = function(d){ return (typeof fmtDate === 'function') ? fmtDate(d) : String(d || ''); };

  function table(heads, rows, empty){
    if(!rows.length) return '<div class="mr-empty">' + esc(empty) + '</div>';
    var h = heads.map(function(x){ return '<th>' + esc(x) + '</th>'; }).join('');
    var b = rows.map(function(cells){ return '<tr>' + cells.map(function(cell){ return '<td' + (cell.s ? ' style="' + cell.s + '"' : '') + '>' + cell.v + '</td>'; }).join('') + '</tr>'; }).join('');
    return '<table class="mr-tbl"><thead><tr>' + h + '</tr></thead><tbody>' + b + '</tbody></table>';
  }
  var rateColor = function(r){ return r >= 90 ? '#1a8d4e' : r >= 70 ? '#92400e' : '#c0392b'; };

  var kpis = [
    { label:'Reports', value:data.total },
    { label:'Pass rate', value:data.passRate + '%', color:rateColor(data.passRate) },
    { label:'Failed', value:data.failed, color: data.failed ? '#c0392b' : '#1c2333' },
    { label:'Open defects', value:data.openDef, color: data.openDef ? '#c0392b' : '#1c2333' },
  ].map(function(k){ return '<div class="mr-kpi"><div class="mr-kpi-v" style="color:' + (k.color || accent) + '">' + esc(k.value) + '</div><div class="mr-kpi-l">' + esc(k.label) + '</div></div>'; }).join('');

  var methodRows = data.byMethod.map(function(m){ return [
    { v:esc(m.key), s:'font-weight:600' }, { v:String(m.n) }, { v:String(m.pass) }, { v:String(m.fail) },
    { v:m.rate + '%', s:'font-weight:700;color:' + rateColor(m.rate) },
  ]; });
  var inspectorRows = data.byInspector.map(function(m){ return [
    { v:esc(m.key), s:'font-weight:600' }, { v:String(m.n) }, { v:String(m.pass) }, { v:String(m.fail) },
    { v:m.rate + '%', s:'font-weight:700;color:' + rateColor(m.rate) },
  ]; });
  var defectRows = data.byType.map(function(d){ return [ { v:esc(d.key), s:'font-weight:600' }, { v:String(d.n) } ]; });

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Management report</title><style>'
    + '@page { size:A4; margin:16mm; }'
    + '* { box-sizing:border-box; }'
    + 'body { font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:#1c2333; font-size:12px; margin:0; }'
    + '.mr-head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid ' + accent + '; padding-bottom:14px; margin-bottom:18px; }'
    + '.mr-title { font-size:26px; font-weight:800; color:' + accent + '; text-transform:uppercase; letter-spacing:-.01em; }'
    + '.mr-sub { font-size:13px; color:#3a4660; margin-top:4px; }'
    + '.mr-logo { max-height:60px; max-width:200px; }'
    + '.mr-kpis { display:flex; gap:12px; margin-bottom:22px; }'
    + '.mr-kpi { flex:1; border:1px solid #e6e9f0; border-radius:8px; padding:12px 14px; }'
    + '.mr-kpi-v { font-size:26px; font-weight:800; }'
    + '.mr-kpi-l { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:#9aa5bd; margin-top:2px; }'
    + '.mr-h { font-size:13px; font-weight:700; color:#1c2333; margin:22px 0 8px; }'
    + '.mr-tbl { width:100%; border-collapse:collapse; font-size:11.5px; }'
    + '.mr-tbl th { background:' + accent + '; color:#fff; font-size:10px; text-transform:uppercase; letter-spacing:.04em; padding:6px 9px; text-align:left; }'
    + '.mr-tbl th:nth-child(n+2), .mr-tbl td:nth-child(n+2) { text-align:right; }'
    + '.mr-tbl td { padding:5px 9px; border-bottom:1px solid #e6e9f0; }'
    + '.mr-empty { color:#9aa5bd; font-size:11.5px; padding:8px 0; }'
    + '.mr-foot { margin-top:28px; font-size:10px; color:#9aa5bd; text-align:center; }'
    + '</style></head><body>'
    + '<div class="mr-head"><div>' + (c.logo ? '<img class="mr-logo" src="' + esc(c.logo) + '" alt=""/>' : '<div style="font-size:20px;font-weight:800;color:' + accent + '">' + esc(c.name || 'Your Company') + '</div>') + '</div>'
    + '<div style="text-align:right"><div class="mr-title">Management Report</div><div class="mr-sub">' + esc(period) + ' · prepared ' + esc(fdate(new Date().toISOString())) + '</div></div></div>'
    + '<div class="mr-kpis">' + kpis + '</div>'
    + '<div class="mr-h">By method</div>' + table(['Method', 'Reports', 'Pass', 'Fail', 'Pass rate'], methodRows, 'No reports in this period.')
    + '<div class="mr-h">Inspector productivity</div>' + table(['Inspector', 'Reports', 'Pass', 'Fail', 'Pass rate'], inspectorRows, 'No reports in this period.')
    + '<div class="mr-h">Defects by type</div>' + table(['Defect type', 'Count'], defectRows, 'No defects logged in this period.')
    + '<div class="mr-foot">Generated by Veritix NDT Inspect · ' + esc(period) + '</div>'
    + '</body></html>';
}

// ── UI actions (wired to the dashboard toolbar) ──────────────────────────────
function vxOpenMgmtReport(){
  if(typeof _vxPrintHtml !== 'function'){ if(typeof toast === 'function') toast('PDF export unavailable.', 'error'); return; }
  var data = _mgmtData();
  if(!data.total){ if(typeof toast === 'function') toast(t('toast.mgmt_empty', 'No reports in the selected period.'), 'warn'); return; }
  _vxPrintHtml(vxBuildMgmtReportHtml(data));
}

function vxMgmtReportExportCsv(){
  var data = _mgmtData();
  if(!data.latest.length){ if(typeof toast === 'function') toast(t('toast.mgmt_empty', 'No reports in the selected period.'), 'warn'); return; }
  var jobs = (typeof jobLoad === 'function') ? jobLoad() : [];
  var jobTitle = function(id){ var j = jobs.find(function(x){ return x.id === id; }); return j ? (j.title || '') : ''; };
  var q = function(v){ return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
  var heads = ['Report no', 'Revision', 'Method', 'Stage', 'Verdict', 'Inspector', 'Client', 'Job', 'Date'];
  var lines = [heads.map(q).join(',')];
  data.latest.forEach(function(r){
    var stage = (typeof getReportStage === 'function') ? getReportStage(r) : (r.stage || '');
    lines.push([r.reportNo || '', r.revision || '', r.method || '', stage, r.verdict || '', r.inspector || '', r.client || '', r.jobTitle || jobTitle(r.jobId), r.createdAt ? (typeof fmtDate === 'function' ? fmtDate(r.createdAt) : r.createdAt) : ''].map(q).join(','));
  });
  var csv = lines.join('\r\n');
  var blob = new Blob([csv], { type:'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'veritix-management-report-' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  if(typeof toast === 'function') toast(t('toast.mgmt_csv', 'Management report exported (CSV).'), 'success');
}
