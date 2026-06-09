// ══════════════════════════════════════════════════════════════════════════
// VERITIX FLANGE — Joints register (bolted-joint integrity, ASME PCC-1 style).
// CRUD over KEYS.joints; the add/edit form is rendered into #jnt-form-wrap.
// ══════════════════════════════════════════════════════════════════════════

var JNT_STATUSES = ['Registered','Fitted','Tightened','Inspected','Leak-tested','Complete','On-hold'];
var JNT_RATINGS  = ['150','300','600','900','1500','2500'];
var JNT_FACES    = ['RF','RTJ','FF'];
var JNT_TYPES    = ['Weld neck','Slip-on','Blind','Threaded','Socket weld','Lap joint'];
var JNT_GASKETS  = ['Spiral wound','Ring joint (RTJ)','Kammprofile','CAF sheet','PTFE'];
var JNT_GRADES   = ['B7','L7','B7M','B16','A193 B8'];
var JNT_METHODS  = ['Torque','Tension'];
var JNT_MEDIA    = ['Hydrostatic','Pneumatic','Service','N/A'];
var JNT_RESULTS  = ['Pass','Fail','N/A'];

function jntStatusColor(s){
  return s === 'Complete' ? 'green'
    : (s === 'Tightened' || s === 'Inspected' || s === 'Leak-tested') ? 'blue'
    : (s === 'On-hold') ? 'red'
    : 'amber';
}

function jointGetAll(){ return ls(KEYS.joints, []) || []; }
function jointSaveAll(l){ lss(KEYS.joints, l); }

var _jntEditId = null;

function jointInit(){
  var sel = el('jnt-f-status');
  if(sel && sel.options.length <= 1){
    sel.innerHTML = '<option value="">All statuses</option>' + JNT_STATUSES.map(function(s){ return '<option>' + s + '</option>'; }).join('');
  }
  jointHideForm();
  jointRender();
}

function jointRender(){
  var list = jointGetAll();
  var q = (el('jnt-search') && el('jnt-search').value || '').toLowerCase().trim();
  var fs = (el('jnt-f-status') && el('jnt-f-status').value) || '';
  var shown = list.filter(function(j){
    if(fs && j.status !== fs) return false;
    if(q){
      var hay = [j.jointNo, j.line, j.pid, j.area, j.size, j.rating, j.gasketType, j.technician, j.status].map(function(v){ return (v||'').toString().toLowerCase(); }).join(' ');
      if(hay.indexOf(q) < 0) return false;
    }
    return true;
  });

  // Metrics
  var done = list.filter(function(j){ return j.status === 'Complete'; }).length;
  var pct = list.length ? Math.round(done / list.length * 100) : 0;
  var open = list.length - done;
  var leakFail = list.filter(function(j){ return j.leakTest && j.leakTest.result === 'Fail'; }).length;
  var m = el('jnt-metrics');
  if(m) m.innerHTML =
    tile('cyan','Total joints', list.length, shown.length + ' shown') +
    tile('green','Complete', done, pct + '% of register') +
    tile('amber','Outstanding', open, 'not yet complete') +
    tile('red','Leak failures', leakFail, 'need attention');

  set('jnt-sub', shown.length === 1 ? '1 joint' : shown.length + ' joints');

  var wrap = el('jnt-table-wrap'); if(!wrap) return;
  if(!shown.length){
    wrap.innerHTML = '<div class="sc"><div class="sc-body"><div style="text-align:center;color:var(--t3);padding:34px;font-size:13px">No joints yet. Click <strong>+ New joint</strong> to register one.</div></div></div>';
    return;
  }
  var rows = shown.slice().reverse().map(function(j){
    var c = jntStatusColor(j.status);
    var leak = j.leakTest && j.leakTest.result ? j.leakTest.result : '—';
    var leakBadge = leak === 'Pass' ? '<span class="badge badge-green">Pass</span>' : leak === 'Fail' ? '<span class="badge badge-red">Fail</span>' : '<span style="color:var(--t3)">—</span>';
    return '<tr>' +
      '<td style="font-family:var(--mono);font-size:12px;color:var(--cyan);font-weight:600">' + escapeHtml(j.jointNo||'—') + '</td>' +
      '<td>' + escapeHtml(j.line||'—') + '</td>' +
      '<td style="font-family:var(--mono);font-size:12px">' + escapeHtml(j.size||'—') + '" / Cl ' + escapeHtml(j.rating||'—') + '</td>' +
      '<td>' + escapeHtml(j.gasketType||'—') + '</td>' +
      '<td style="font-family:var(--mono);font-size:12px">' + (j.target ? escapeHtml(j.target) + (j.method==='Tension'?' kN':' Nm') : '—') + '</td>' +
      '<td>' + escapeHtml(j.technician||'—') + '</td>' +
      '<td>' + leakBadge + '</td>' +
      '<td><span class="badge badge-' + c + '">' + escapeHtml(j.status||'—') + '</span></td>' +
      '<td style="white-space:nowrap"><button class="btn btn-sm" data-action="jointEdit" data-args="\'' + j.id + '\'">Open</button> <button class="btn btn-sm btn-danger" data-action="jointDelete" data-args="\'' + j.id + '\'">Del</button></td>' +
    '</tr>';
  }).join('');
  wrap.innerHTML = '<div class="sc"><div class="sc-body" style="padding:0;overflow-x:auto"><table class="tbl" style="width:100%">' +
    '<thead><tr><th>Joint</th><th>Line</th><th>Size / Class</th><th>Gasket</th><th>Target</th><th>Technician</th><th>Leak</th><th>Status</th><th></th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div></div>';
}

function tile(color, label, val, sub){
  return '<div class="stat-tile ' + color + '"><div class="stat-label">' + escapeHtml(label) + '</div><div class="stat-val">' + escapeHtml(val) + '</div><div class="stat-sub">' + escapeHtml(sub||'') + '</div></div>';
}

// ── form builders ─────────────────────────────────────────────────────────────
function _opt(v, sel){ return '<option' + (v === sel ? ' selected' : '') + '>' + escapeHtml(v) + '</option>'; }
function _fld(label, id, val, ph, type){ return '<div class="fld"><label>' + escapeHtml(label) + '</label><input id="' + id + '" type="' + (type||'text') + '" value="' + escapeHtml(val==null?'':val) + '" placeholder="' + escapeHtml(ph||'') + '"/></div>'; }
function _sel(label, id, val, options, blank){ var o = (blank ? '<option value="">' + escapeHtml(blank) + '</option>' : '') + options.map(function(v){ return _opt(v, val); }).join(''); return '<div class="fld"><label>' + escapeHtml(label) + '</label><select id="' + id + '" data-on-change="jointFormSync">' + o + '</select></div>'; }
function _txt(label, id, val){ return '<div class="fld full"><label>' + escapeHtml(label) + '</label><textarea id="' + id + '" rows="2">' + escapeHtml(val||'') + '</textarea></div>'; }
function _card(title, inner){ return '<div class="sc" style="margin-bottom:14px"><div class="sc-head"><span class="sc-title">' + escapeHtml(title) + '</span></div><div class="sc-body"><div class="fm-grid">' + inner + '</div></div></div>'; }

function jointShowForm(id){
  _jntEditId = id || null;
  var j = id ? jointGetAll().find(function(x){ return x.id === id; }) : null;
  j = j || { method:'Torque', status:'Registered', rating:'150', face:'RF', leakTest:{}, passes:[] };
  var tools = ls(KEYS.tools, []) || [];
  var techs = ls(KEYS.techs, []) || [];
  var toolOpts = '<option value="">— select tool —</option>' + tools.map(function(t){ return '<option value="' + escapeHtml(t.id) + '"' + (t.id===j.toolId?' selected':'') + '>' + escapeHtml((t.toolNo||'') + ' · ' + (t.type||'')) + '</option>'; }).join('');
  var techOpts = '<option value="">— select technician —</option>' + techs.map(function(t){ return '<option' + (t.name===j.technician?' selected':'') + '>' + escapeHtml(t.name) + '</option>'; }).join('');
  var lt = j.leakTest || {};

  var html =
    _card('Identification',
      _fld('Line number', 'jf-line', j.line, 'e.g. 6"-P-1203') +
      _fld('P&ID / drawing', 'jf-pid', j.pid, 'e.g. PID-1203-02') +
      _fld('Area / unit', 'jf-area', j.area, 'e.g. Unit 200')) +
    _card('Flange specification',
      _fld('Size (NPS)', 'jf-size', j.size, 'e.g. 6') +
      _sel('Pressure class', 'jf-rating', j.rating, JNT_RATINGS) +
      _sel('Flange face', 'jf-face', j.face, JNT_FACES) +
      _sel('Flange type', 'jf-type', j.flangeType, JNT_TYPES, '— select —')) +
    _card('Gasket & bolting',
      _sel('Gasket type', 'jf-gasket', j.gasketType, JNT_GASKETS, '— select —') +
      _fld('Gasket spec', 'jf-gspec', j.gasketSpec, 'e.g. SWG 316L/Graphite') +
      _fld('Bolt size', 'jf-bsize', j.boltSize, 'e.g. M20 / 7/8"') +
      _sel('Bolt grade', 'jf-bgrade', j.boltGrade, JNT_GRADES, '— select —') +
      _fld('Bolt qty', 'jf-bqty', j.boltQty, 'e.g. 8', 'number') +
      _fld('Bolt length (mm)', 'jf-blen', j.boltLength, 'e.g. 120', 'number')) +
    '<div class="sc" style="margin-bottom:14px"><div class="sc-head"><span class="sc-title">Controlled tightening</span></div><div class="sc-body">' +
      '<div class="fm-grid">' +
        _sel('Method', 'jf-method', j.method, JNT_METHODS) +
        '<div class="fld"><label>Target (<span id="jf-target-unit">Nm</span>)</label><input id="jf-target" type="number" value="' + escapeHtml(j.target||'') + '" placeholder="e.g. 450" data-on-input="jointFormSync"/></div>' +
        '<div class="fld full"><label>Tightening tool</label><select id="jf-tool">' + toolOpts + '</select></div>' +
      '</div>' +
      '<div id="jf-passes" style="margin-top:6px">' + jointPassesHtml(j) + '</div>' +
    '</div></div>' +
    _card('Leak test',
      _sel('Required', 'jf-lt-req', lt.required || 'No', ['No','Yes']) +
      _sel('Medium', 'jf-lt-med', lt.medium, JNT_MEDIA, '— select —') +
      _fld('Test pressure', 'jf-lt-press', lt.pressure, 'e.g. 19 barg') +
      _sel('Result', 'jf-lt-res', lt.result, JNT_RESULTS, '— select —') +
      _fld('Test date', 'jf-lt-date', (lt.date||'').slice(0,10), '', 'date')) +
    '<div class="sc" style="margin-bottom:14px"><div class="sc-head"><span class="sc-title">Sign-off</span></div><div class="sc-body"><div class="fm-grid">' +
      '<div class="fld"><label>Technician</label><select id="jf-tech">' + techOpts + '</select></div>' +
      _fld('Assembled date', 'jf-asm', (j.assembledAt||'').slice(0,10), '', 'date') +
      _sel('Status', 'jf-status', j.status, JNT_STATUSES) +
      _txt('Notes', 'jf-notes', j.notes) +
    '</div></div></div>' +
    '<div class="fm-form-actions">' +
      '<button class="btn btn-primary" data-action="jointSave">' + (id ? 'Update joint' : 'Save joint') + '</button>' +
      '<button class="btn" data-action="jointHideForm">Cancel</button>' +
    '</div>';

  var fw = el('jnt-form-wrap');
  fw.innerHTML = '<div class="sh" style="margin-bottom:6px"><div class="sh-left"><div class="sc-title" style="font-size:17px">' + (id ? 'Joint ' + escapeHtml(j.jointNo||'') : 'New joint') + '</div></div></div>' + html;
  fw.style.display = 'block';
  el('jnt-table-wrap').style.display = 'none';
  el('jnt-list-tools').style.display = 'none';
  jointFormSync();
  fw.scrollIntoView({ behavior:'smooth', block:'start' });
}

function jointPassesHtml(j){
  var method = (el('jf-method') && el('jf-method').value) || j.method || 'Torque';
  var target = parseFloat((el('jf-target') && el('jf-target').value) || j.target || 0) || 0;
  var unit = method === 'Tension' ? 'kN' : 'Nm';
  var pcts = [30, 60, 100];
  var existing = {};
  (j.passes || []).forEach(function(p){ existing[p.pct] = p; });
  var rows = pcts.map(function(pct){
    var tgt = target ? Math.round(target * pct / 100) : '';
    var actual = existing[pct] ? (existing[pct].actual != null ? existing[pct].actual : '') : '';
    return '<tr>' +
      '<td style="font-family:var(--mono);color:var(--cyan)">Pass ' + (pct===30?'1':pct===60?'2':'3') + '</td>' +
      '<td style="font-family:var(--mono)">' + pct + '%</td>' +
      '<td style="font-family:var(--mono);color:var(--t2)">' + (tgt!==''?tgt + ' ' + unit:'—') + '</td>' +
      '<td><input class="jf-pass" data-pct="' + pct + '" type="number" value="' + escapeHtml(actual) + '" placeholder="actual ' + unit + '" style="width:120px"/></td>' +
    '</tr>';
  }).join('');
  return '<div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.05em;margin:4px 0 6px">Cross-pattern passes</div>' +
    '<table class="tbl" style="width:auto"><thead><tr><th>Pass</th><th>Target %</th><th>Target ' + unit + '</th><th>Actual</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

// Keep unit labels + suggested pass targets in sync with method/target.
function jointFormSync(){
  var method = (el('jf-method') && el('jf-method').value) || 'Torque';
  var unitEl = el('jf-target-unit'); if(unitEl) unitEl.textContent = method === 'Tension' ? 'kN' : 'Nm';
  var passes = el('jf-passes');
  if(passes){
    // preserve current actual entries before re-render
    var cur = {};
    passes.querySelectorAll('.jf-pass').forEach(function(i){ cur[i.dataset.pct] = i.value; });
    passes.innerHTML = jointPassesHtml({ method: method, target: (el('jf-target') && el('jf-target').value), passes: Object.keys(cur).map(function(p){ return { pct:+p, actual:cur[p] }; }) });
  }
}

function jointSave(){
  var line = (el('jf-line') && el('jf-line').value || '').trim();
  if(!line){ toast('Line number is required.', 'error'); return; }
  var passes = [];
  document.querySelectorAll('#jf-passes .jf-pass').forEach(function(i){
    if(i.value !== '') passes.push({ pct: +i.dataset.pct, actual: parseFloat(i.value) });
  });
  var data = {
    line: line,
    pid: (el('jf-pid').value||'').trim(),
    area: (el('jf-area').value||'').trim(),
    size: (el('jf-size').value||'').trim(),
    rating: el('jf-rating').value,
    face: el('jf-face').value,
    flangeType: el('jf-type').value,
    gasketType: el('jf-gasket').value,
    gasketSpec: (el('jf-gspec').value||'').trim(),
    boltSize: (el('jf-bsize').value||'').trim(),
    boltGrade: el('jf-bgrade').value,
    boltQty: el('jf-bqty').value,
    boltLength: el('jf-blen').value,
    method: el('jf-method').value,
    target: el('jf-target').value,
    toolId: el('jf-tool').value,
    passes: passes,
    leakTest: {
      required: el('jf-lt-req').value,
      medium: el('jf-lt-med').value,
      pressure: (el('jf-lt-press').value||'').trim(),
      result: el('jf-lt-res').value,
      date: el('jf-lt-date').value,
    },
    technician: el('jf-tech').value,
    assembledAt: el('jf-asm').value,
    status: el('jf-status').value,
    notes: (el('jf-notes').value||'').trim(),
    updatedAt: new Date().toISOString(),
  };
  var all = jointGetAll();
  if(_jntEditId){
    var j = all.find(function(x){ return x.id === _jntEditId; });
    if(j) Object.assign(j, data);
    jointSaveAll(all);
    toast('Joint ' + (j.jointNo||'') + ' updated.', 'success');
  } else {
    data.id = vxNewId();
    data.jointNo = nextNo('joint', 'JNT-', 4);
    data.createdAt = new Date().toISOString();
    data.createdBy = CURRENT_USER && CURRENT_USER.name;
    all.push(data);
    jointSaveAll(all);
    toast('Joint ' + data.jointNo + ' registered.', 'success');
  }
  jointHideForm();
  jointRender();
}

function jointEdit(id){ jointShowForm(id); }

async function jointDelete(id){
  var j = jointGetAll().find(function(x){ return x.id === id; });
  if(!j) return;
  if(!await fmConfirm({ title:'Delete joint', message:'Delete ' + (j.jointNo||'this joint') + '? This cannot be undone.', okLabel:'Delete', danger:true })) return;
  jointSaveAll(jointGetAll().filter(function(x){ return x.id !== id; }));
  jointRender();
  toast('Joint deleted.');
}

function jointHideForm(){
  var fw = el('jnt-form-wrap'); if(fw){ fw.style.display = 'none'; fw.innerHTML = ''; }
  if(el('jnt-table-wrap')) el('jnt-table-wrap').style.display = '';
  if(el('jnt-list-tools')) el('jnt-list-tools').style.display = '';
  _jntEditId = null;
}

function jointNew(){ jointShowForm(null); }
