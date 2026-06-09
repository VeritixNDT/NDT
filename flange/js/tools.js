// ══════════════════════════════════════════════════════════════════════════
// VERITIX FLANGE — Tools & calibration register (torque wrenches / tensioners).
// ══════════════════════════════════════════════════════════════════════════
var TOOL_TYPES  = ['Torque wrench','Hydraulic tensioner','Torque multiplier','Pneumatic wrench'];
var TOOL_STATUS = ['In service','Out of service','Lost'];

function toolGetAll(){ return ls(KEYS.tools, []) || []; }
function toolSaveAll(l){ lss(KEYS.tools, l); }
var _toolEditId = null;

function toolCalBadge(t){
  var d = daysUntil(t.calDueAt);
  if(t.calDueAt == null || t.calDueAt === '') return '<span style="color:var(--t3)">—</span>';
  if(d < 0)  return '<span class="badge badge-red">OUT OF CAL</span>';
  if(d <= 30) return '<span class="badge badge-amber">Due ' + d + 'd</span>';
  return '<span class="badge badge-green">In cal</span>';
}

function toolInit(){ toolHideForm(); toolRender(); }

function toolRender(){
  var list = toolGetAll();
  var q = (el('tool-search') && el('tool-search').value || '').toLowerCase().trim();
  var shown = list.filter(function(t){ return !q || [t.toolNo,t.type,t.make,t.serial,t.rangeText,t.status].join(' ').toLowerCase().indexOf(q) >= 0; });
  var outCal = list.filter(function(t){ return t.calDueAt && daysUntil(t.calDueAt) < 0; }).length;
  var m = el('tool-metrics');
  if(m) m.innerHTML = tile('cyan','Tools', list.length, shown.length + ' shown') + tile('red','Out of calibration', outCal, 'do not use') + tile('green','In service', list.filter(function(t){return t.status==='In service';}).length, '');
  var wrap = el('tool-table-wrap'); if(!wrap) return;
  if(!shown.length){ wrap.innerHTML = '<div class="sc"><div class="sc-body"><div style="text-align:center;color:var(--t3);padding:34px;font-size:13px">No tools yet. Click <strong>+ New tool</strong>.</div></div></div>'; return; }
  var rows = shown.slice().reverse().map(function(t){
    return '<tr>' +
      '<td style="font-family:var(--mono);color:var(--cyan);font-weight:600">' + escapeHtml(t.toolNo||'—') + '</td>' +
      '<td>' + escapeHtml(t.type||'—') + '</td>' +
      '<td>' + escapeHtml(t.make||'—') + '</td>' +
      '<td style="font-family:var(--mono);font-size:12px">' + escapeHtml(t.serial||'—') + '</td>' +
      '<td>' + escapeHtml(t.rangeText||'—') + '</td>' +
      '<td style="font-family:var(--mono);font-size:12px">' + fmtDate(t.calDueAt) + '</td>' +
      '<td>' + toolCalBadge(t) + '</td>' +
      '<td style="white-space:nowrap"><button class="btn btn-sm" data-action="toolEdit" data-args="\'' + t.id + '\'">Open</button> <button class="btn btn-sm btn-danger" data-action="toolDelete" data-args="\'' + t.id + '\'">Del</button></td>' +
    '</tr>';
  }).join('');
  wrap.innerHTML = '<div class="sc"><div class="sc-body" style="padding:0;overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr><th>Tool</th><th>Type</th><th>Make</th><th>Serial</th><th>Range</th><th>Cal due</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

function toolShowForm(id){
  _toolEditId = id || null;
  var t = id ? toolGetAll().find(function(x){ return x.id === id; }) : { status:'In service' };
  t = t || { status:'In service' };
  var html = '<div class="sc"><div class="sc-head"><span class="sc-title">' + (id ? 'Tool ' + escapeHtml(t.toolNo||'') : 'New tool') + '</span></div><div class="sc-body"><div class="fm-grid">' +
    _sel('Type', 'tf-type', t.type, TOOL_TYPES, '— select —') +
    _fld('Make / model', 'tf-make', t.make, 'e.g. Norbar HT5') +
    _fld('Serial number', 'tf-serial', t.serial, 'e.g. SN-44821') +
    _fld('Range', 'tf-range', t.rangeText, 'e.g. 50–750 Nm') +
    _fld('Calibration due', 'tf-cal', (t.calDueAt||'').slice(0,10), '', 'date') +
    _sel('Status', 'tf-status', t.status, TOOL_STATUS) +
    _txt('Notes', 'tf-notes', t.notes) +
    '</div><div class="fm-form-actions"><button class="btn btn-primary" data-action="toolSave">' + (id?'Update tool':'Save tool') + '</button><button class="btn" data-action="toolHideForm">Cancel</button></div></div></div>';
  var fw = el('tool-form-wrap'); fw.innerHTML = html; fw.style.display = 'block';
  el('tool-table-wrap').style.display = 'none'; el('tool-list-tools').style.display = 'none';
  fw.scrollIntoView({ behavior:'smooth', block:'start' });
}

function toolSave(){
  var type = el('tf-type').value;
  if(!type){ toast('Select a tool type.', 'error'); return; }
  var data = { type:type, make:(el('tf-make').value||'').trim(), serial:(el('tf-serial').value||'').trim(), rangeText:(el('tf-range').value||'').trim(), calDueAt:el('tf-cal').value, status:el('tf-status').value, notes:(el('tf-notes').value||'').trim(), updatedAt:new Date().toISOString() };
  var all = toolGetAll();
  if(_toolEditId){ var t = all.find(function(x){ return x.id === _toolEditId; }); if(t) Object.assign(t, data); toolSaveAll(all); toast('Tool updated.', 'success'); }
  else { data.id = vxNewId(); data.toolNo = nextNo('tool', 'TL-', 3); data.createdAt = new Date().toISOString(); all.push(data); toolSaveAll(all); toast('Tool ' + data.toolNo + ' added.', 'success'); }
  toolHideForm(); toolRender();
}
function toolEdit(id){ toolShowForm(id); }
async function toolDelete(id){ var t = toolGetAll().find(function(x){return x.id===id;}); if(!t) return; if(!await fmConfirm({title:'Delete tool',message:'Delete ' + (t.toolNo||'this tool') + '?',okLabel:'Delete',danger:true})) return; toolSaveAll(toolGetAll().filter(function(x){return x.id!==id;})); toolRender(); toast('Tool deleted.'); }
function toolHideForm(){ var fw = el('tool-form-wrap'); if(fw){ fw.style.display='none'; fw.innerHTML=''; } if(el('tool-table-wrap')) el('tool-table-wrap').style.display=''; if(el('tool-list-tools')) el('tool-list-tools').style.display=''; _toolEditId = null; }
function toolNew(){ toolShowForm(null); }
