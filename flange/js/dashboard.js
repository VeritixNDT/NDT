// ══════════════════════════════════════════════════════════════════════════
// VERITIX FLANGE — Dashboard: register health at a glance.
// ══════════════════════════════════════════════════════════════════════════
function dashInit(){
  var joints = jointGetAll();
  var tools  = toolGetAll();
  var techs  = techGetAll();
  var punch  = punchGetAll();

  var done = joints.filter(function(j){ return j.status === 'Complete'; }).length;
  var pct = joints.length ? Math.round(done / joints.length * 100) : 0;
  var outstanding = joints.length - done;
  var leakFail = joints.filter(function(j){ return j.leakTest && j.leakTest.result === 'Fail'; }).length;
  var outCal = tools.filter(function(t){ return t.calDueAt && daysUntil(t.calDueAt) < 0; }).length;
  var openPunch = punch.filter(function(p){ return p.status !== 'Cleared'; }).length;

  set('dash-sub', (CURRENT_USER ? 'Welcome, ' + (CURRENT_USER.name.split(' ')[0]) + ' — ' : '') + fmCompany().name || 'Joint integrity overview');

  var m = el('dash-metrics');
  if(m) m.innerHTML =
    tile('cyan','Joints registered', joints.length, pct + '% complete') +
    tile('green','Complete', done, 'signed off') +
    tile('amber','Outstanding', outstanding, 'in progress') +
    tile('red','Leak failures', leakFail, 'need rework') +
    tile('violet','Open punch items', openPunch, punch.length + ' total') +
    tile('red','Tools out of cal', outCal, tools.length + ' tools');

  // Progress bar
  var pb = el('dash-progress');
  if(pb) pb.innerHTML =
    '<div class="sc"><div class="sc-head"><span class="sc-title">Completion</span><span style="font-family:var(--mono);font-size:12px;color:var(--cyan)">' + pct + '%</span></div>' +
    '<div class="sc-body"><div style="height:10px;background:var(--bg2);border-radius:6px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,var(--cyan),var(--green));border-radius:6px;transition:width .6s"></div></div></div></div>';

  // Status breakdown
  var byStatus = {};
  JNT_STATUSES.forEach(function(s){ byStatus[s] = 0; });
  joints.forEach(function(j){ byStatus[j.status] = (byStatus[j.status]||0) + 1; });
  var maxN = Math.max(1, Math.max.apply(null, JNT_STATUSES.map(function(s){ return byStatus[s]; })));
  var bars = JNT_STATUSES.map(function(s){
    var n = byStatus[s] || 0;
    var c = jntStatusColor(s);
    var w = Math.round(n / maxN * 100);
    return '<div style="display:flex;align-items:center;gap:12px;margin-bottom:9px">' +
      '<div style="width:96px;font-size:12px;color:var(--t2)">' + escapeHtml(s) + '</div>' +
      '<div style="flex:1;height:18px;background:var(--bg2);border-radius:4px;overflow:hidden"><div style="height:100%;width:' + w + '%;background:var(--' + (c==='green'?'green':c==='red'?'red':c==='blue'?'blue':'amber') + ');opacity:.8"></div></div>' +
      '<div style="width:34px;text-align:right;font-family:var(--mono);font-size:12px;color:var(--t1)">' + n + '</div>' +
    '</div>';
  }).join('');
  var sb = el('dash-status');
  if(sb) sb.innerHTML = '<div class="sc"><div class="sc-head"><span class="sc-title">Joints by status</span></div><div class="sc-body">' + (joints.length ? bars : '<div style="color:var(--t3);font-size:13px;padding:8px 0">No joints registered yet.</div>') + '</div></div>';

  // Recent joints
  var recent = joints.slice().reverse().slice(0, 8);
  var rb = el('dash-recent');
  if(rb){
    var rows = recent.map(function(j){
      return '<tr><td style="font-family:var(--mono);color:var(--cyan);font-size:12px">' + escapeHtml(j.jointNo||'—') + '</td><td>' + escapeHtml(j.line||'—') + '</td><td>' + escapeHtml(j.technician||'—') + '</td><td><span class="badge badge-' + jntStatusColor(j.status) + '">' + escapeHtml(j.status||'—') + '</span></td></tr>';
    }).join('');
    rb.innerHTML = '<div class="sc"><div class="sc-head"><span class="sc-title">Recent joints</span><button class="btn btn-sm" data-action="showPage" data-args="\'joints\'" data-pass-el="1">View all</button></div><div class="sc-body" style="padding:0;overflow-x:auto">' +
      (recent.length ? '<table class="tbl" style="width:100%"><thead><tr><th>Joint</th><th>Line</th><th>Technician</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<div style="color:var(--t3);font-size:13px;padding:18px">Nothing yet — register your first joint.</div>') +
      '</div></div>';
  }
}
