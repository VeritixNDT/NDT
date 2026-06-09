// ══════════════════════════════════════════════════════════════════════════
// VERITIX FLANGE — Punch list (leaks / re-torque / defects against joints).
// ══════════════════════════════════════════════════════════════════════════
var PUNCH_TYPES  = ['Leak','Re-torque','Damaged flange','Missing bolt','Wrong gasket','Misalignment'];
var PUNCH_SEV    = ['A','B','C'];
var PUNCH_STATUS = ['Open','In progress','Cleared'];

function punchGetAll(){ return ls(KEYS.punch, []) || []; }
function punchSaveAll(l){ lss(KEYS.punch, l); }
var _punchEditId = null;

function punchSevColor(s){ return s === 'A' ? 'red' : s === 'B' ? 'amber' : 'blue'; }
function punchStatusColor(s){ return s === 'Cleared' ? 'green' : s === 'In progress' ? 'amber' : 'red'; }

function punchInit(){ punchHideForm(); punchRender(); }

function punchRender(){
  var list = punchGetAll();
  var q = (el('pun-search') && el('pun-search').value || '').toLowerCase().trim();
  var shown = list.filter(function(p){ return !q || [p.punchNo,p.jointNo,p.type,p.severity,p.status,p.raisedBy].join(' ').toLowerCase().indexOf(q) >= 0; });
  var open = list.filter(function(p){ return p.status !== 'Cleared'; }).length;
  var critA = list.filter(function(p){ return p.severity === 'A' && p.status !== 'Cleared'; }).length;
  var m = el('pun-metrics');
  if(m) m.innerHTML = tile('cyan','Punch items', list.length, shown.length + ' shown') + tile('red','Open', open, 'not cleared') + tile('amber','Severity A open', critA, 'critical');
  var wrap = el('pun-table-wrap'); if(!wrap) return;
  if(!shown.length){ wrap.innerHTML = '<div class="sc"><div class="sc-body"><div style="text-align:center;color:var(--t3);padding:34px;font-size:13px">No punch items. Click <strong>+ New punch item</strong>.</div></div></div>'; return; }
  var rows = shown.slice().reverse().map(function(p){
    return '<tr>' +
      '<td style="font-family:var(--mono);color:var(--cyan);font-weight:600">' + escapeHtml(p.punchNo||'—') + '</td>' +
      '<td style="font-family:var(--mono);font-size:12px">' + escapeHtml(p.jointNo||'—') + '</td>' +
      '<td>' + escapeHtml(p.type||'—') + '</td>' +
      '<td><span class="badge badge-' + punchSevColor(p.severity) + '">' + escapeHtml(p.severity||'—') + '</span></td>' +
      '<td>' + escapeHtml(p.raisedBy||'—') + '</td>' +
      '<td style="font-family:var(--mono);font-size:12px">' + fmtDate(p.date) + '</td>' +
      '<td><span class="badge badge-' + punchStatusColor(p.status) + '">' + escapeHtml(p.status||'—') + '</span></td>' +
      '<td style="white-space:nowrap"><button class="btn btn-sm" data-action="punchEdit" data-args="\'' + p.id + '\'">Open</button> <button class="btn btn-sm btn-danger" data-action="punchDelete" data-args="\'' + p.id + '\'">Del</button></td>' +
    '</tr>';
  }).join('');
  wrap.innerHTML = '<div class="sc"><div class="sc-body" style="padding:0;overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr><th>Ref</th><th>Joint</th><th>Type</th><th>Sev</th><th>Raised by</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

function punchShowForm(id){
  _punchEditId = id || null;
  var p = id ? punchGetAll().find(function(x){ return x.id === id; }) : { severity:'B', status:'Open', date:new Date().toISOString().slice(0,10) };
  p = p || { severity:'B', status:'Open' };
  var joints = jointGetAll();
  var jointOpts = '<option value="">— link a joint —</option>' + joints.map(function(j){ return '<option' + (j.jointNo===p.jointNo?' selected':'') + '>' + escapeHtml(j.jointNo) + '</option>'; }).join('');
  var html = '<div class="sc"><div class="sc-head"><span class="sc-title">' + (id ? 'Punch ' + escapeHtml(p.punchNo||'') : 'New punch item') + '</span></div><div class="sc-body"><div class="fm-grid">' +
    '<div class="fld"><label>Joint</label><select id="pf-joint">' + jointOpts + '</select></div>' +
    _sel('Type', 'pf-type', p.type, PUNCH_TYPES, '— select —') +
    _sel('Severity', 'pf-sev', p.severity, PUNCH_SEV) +
    _sel('Status', 'pf-status', p.status, PUNCH_STATUS) +
    _fld('Raised by', 'pf-by', p.raisedBy || (CURRENT_USER && CURRENT_USER.name), '') +
    _fld('Date', 'pf-date', (p.date||'').slice(0,10), '', 'date') +
    _txt('Description', 'pf-notes', p.notes) +
    '</div><div class="fm-form-actions"><button class="btn btn-primary" data-action="punchSave">' + (id?'Update item':'Save item') + '</button><button class="btn" data-action="punchHideForm">Cancel</button></div></div></div>';
  var fw = el('pun-form-wrap'); fw.innerHTML = html; fw.style.display = 'block';
  el('pun-table-wrap').style.display = 'none'; el('pun-list-tools').style.display = 'none';
  fw.scrollIntoView({ behavior:'smooth', block:'start' });
}

function punchSave(){
  var type = el('pf-type').value;
  if(!type){ toast('Select a punch type.', 'error'); return; }
  var data = { jointNo:el('pf-joint').value, type:type, severity:el('pf-sev').value, status:el('pf-status').value, raisedBy:(el('pf-by').value||'').trim(), date:el('pf-date').value, notes:(el('pf-notes').value||'').trim(), updatedAt:new Date().toISOString() };
  var all = punchGetAll();
  if(_punchEditId){ var p = all.find(function(x){ return x.id === _punchEditId; }); if(p) Object.assign(p, data); punchSaveAll(all); toast('Punch item updated.', 'success'); }
  else { data.id = vxNewId(); data.punchNo = nextNo('punch', 'P-', 4); data.createdAt = new Date().toISOString(); all.push(data); punchSaveAll(all); toast('Punch ' + data.punchNo + ' raised.', 'success'); }
  punchHideForm(); punchRender();
}
function punchEdit(id){ punchShowForm(id); }
async function punchDelete(id){ var p = punchGetAll().find(function(x){return x.id===id;}); if(!p) return; if(!await fmConfirm({title:'Delete punch item',message:'Delete ' + (p.punchNo||'this item') + '?',okLabel:'Delete',danger:true})) return; punchSaveAll(punchGetAll().filter(function(x){return x.id!==id;})); punchRender(); toast('Punch item deleted.'); }
function punchHideForm(){ var fw = el('pun-form-wrap'); if(fw){ fw.style.display='none'; fw.innerHTML=''; } if(el('pun-table-wrap')) el('pun-table-wrap').style.display=''; if(el('pun-list-tools')) el('pun-list-tools').style.display=''; _punchEditId = null; }
function punchNew(){ punchShowForm(null); }
