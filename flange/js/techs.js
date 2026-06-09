// ══════════════════════════════════════════════════════════════════════════
// VERITIX FLANGE — Technicians register (joint-integrity competencies).
// ══════════════════════════════════════════════════════════════════════════
var TECH_COMPS  = ['ECITB MJI10','ECITB MJI18','ASME PCC-1','Hydraulic tensioning','Flange mgmt awareness'];
var TECH_STATUS = ['Active','Inactive'];

function techGetAll(){ return ls(KEYS.techs, []) || []; }
function techSaveAll(l){ lss(KEYS.techs, l); }
var _techEditId = null;

function techCertBadge(t){
  var d = daysUntil(t.certExpiry);
  if(!t.certExpiry) return '<span style="color:var(--t3)">—</span>';
  if(d < 0)  return '<span class="badge badge-red">Expired</span>';
  if(d <= 60) return '<span class="badge badge-amber">' + d + 'd left</span>';
  return '<span class="badge badge-green">Valid</span>';
}

function techInit(){ techHideForm(); techRender(); }

function techRender(){
  var list = techGetAll();
  var q = (el('tech-search') && el('tech-search').value || '').toLowerCase().trim();
  var shown = list.filter(function(t){ return !q || [t.name,t.company,t.competency,t.certNo,t.status].join(' ').toLowerCase().indexOf(q) >= 0; });
  var expired = list.filter(function(t){ return t.certExpiry && daysUntil(t.certExpiry) < 0; }).length;
  var m = el('tech-metrics');
  if(m) m.innerHTML = tile('cyan','Technicians', list.length, shown.length + ' shown') + tile('green','Active', list.filter(function(t){return t.status==='Active';}).length, '') + tile('red','Expired certs', expired, 'renew required');
  var wrap = el('tech-table-wrap'); if(!wrap) return;
  if(!shown.length){ wrap.innerHTML = '<div class="sc"><div class="sc-body"><div style="text-align:center;color:var(--t3);padding:34px;font-size:13px">No technicians yet. Click <strong>+ New technician</strong>.</div></div></div>'; return; }
  var rows = shown.slice().reverse().map(function(t){
    return '<tr>' +
      '<td style="font-weight:600;color:var(--t1)">' + escapeHtml(t.name||'—') + '</td>' +
      '<td>' + escapeHtml(t.company||'—') + '</td>' +
      '<td>' + escapeHtml(t.competency||'—') + '</td>' +
      '<td style="font-family:var(--mono);font-size:12px">' + escapeHtml(t.certNo||'—') + '</td>' +
      '<td style="font-family:var(--mono);font-size:12px">' + fmtDate(t.certExpiry) + '</td>' +
      '<td>' + techCertBadge(t) + '</td>' +
      '<td><span class="badge badge-' + (t.status==='Active'?'green':'muted') + '">' + escapeHtml(t.status||'—') + '</span></td>' +
      '<td style="white-space:nowrap"><button class="btn btn-sm" data-action="techEdit" data-args="\'' + t.id + '\'">Open</button> <button class="btn btn-sm btn-danger" data-action="techDelete" data-args="\'' + t.id + '\'">Del</button></td>' +
    '</tr>';
  }).join('');
  wrap.innerHTML = '<div class="sc"><div class="sc-body" style="padding:0;overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr><th>Name</th><th>Company</th><th>Competency</th><th>Cert no.</th><th>Expiry</th><th>Cert</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

function techShowForm(id){
  _techEditId = id || null;
  var t = id ? techGetAll().find(function(x){ return x.id === id; }) : { status:'Active' };
  t = t || { status:'Active' };
  var html = '<div class="sc"><div class="sc-head"><span class="sc-title">' + (id ? escapeHtml(t.name||'Technician') : 'New technician') + '</span></div><div class="sc-body"><div class="fm-grid">' +
    _fld('Full name', 'cf-name', t.name, 'e.g. Jan de Vries') +
    _fld('Company', 'cf-company', t.company, 'e.g. Acme Mechanical') +
    _sel('Competency', 'cf-comp', t.competency, TECH_COMPS, '— select —') +
    _fld('Certificate no.', 'cf-certno', t.certNo, 'e.g. MJI-44821') +
    _fld('Cert expiry', 'cf-certexp', (t.certExpiry||'').slice(0,10), '', 'date') +
    _sel('Status', 'cf-status', t.status, TECH_STATUS) +
    _txt('Notes', 'cf-notes', t.notes) +
    '</div><div class="fm-form-actions"><button class="btn btn-primary" data-action="techSave">' + (id?'Update technician':'Save technician') + '</button><button class="btn" data-action="techHideForm">Cancel</button></div></div></div>';
  var fw = el('tech-form-wrap'); fw.innerHTML = html; fw.style.display = 'block';
  el('tech-table-wrap').style.display = 'none'; el('tech-list-tools').style.display = 'none';
  fw.scrollIntoView({ behavior:'smooth', block:'start' });
}

function techSave(){
  var name = (el('cf-name').value||'').trim();
  if(!name){ toast('Name is required.', 'error'); return; }
  var data = { name:name, company:(el('cf-company').value||'').trim(), competency:el('cf-comp').value, certNo:(el('cf-certno').value||'').trim(), certExpiry:el('cf-certexp').value, status:el('cf-status').value, notes:(el('cf-notes').value||'').trim(), updatedAt:new Date().toISOString() };
  var all = techGetAll();
  if(_techEditId){ var t = all.find(function(x){ return x.id === _techEditId; }); if(t) Object.assign(t, data); techSaveAll(all); toast('Technician updated.', 'success'); }
  else { data.id = vxNewId(); data.createdAt = new Date().toISOString(); all.push(data); techSaveAll(all); toast('Technician added.', 'success'); }
  techHideForm(); techRender();
}
function techEdit(id){ techShowForm(id); }
async function techDelete(id){ var t = techGetAll().find(function(x){return x.id===id;}); if(!t) return; if(!await fmConfirm({title:'Delete technician',message:'Delete ' + (t.name||'this technician') + '?',okLabel:'Delete',danger:true})) return; techSaveAll(techGetAll().filter(function(x){return x.id!==id;})); techRender(); toast('Technician deleted.'); }
function techHideForm(){ var fw = el('tech-form-wrap'); if(fw){ fw.style.display='none'; fw.innerHTML=''; } if(el('tech-table-wrap')) el('tech-table-wrap').style.display=''; if(el('tech-list-tools')) el('tech-list-tools').style.display=''; _techEditId = null; }
function techNew(){ techShowForm(null); }
