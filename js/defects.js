// ═══════════════════════════════════════════════════════════════════════════
// DEFECTS PAGE — Full defect logging, tracking, and management
// ═══════════════════════════════════════════════════════════════════════════

var DEF_SEVERITIES = ['Critical','High','Medium','Low'];
var DEF_STATUSES = ['Open','In Progress','Repaired','Verified','Closed'];
var _defEditIdx = -1;  // -1 = adding new, >=0 = editing index

function defInit(){
  // Populate method filters
  const selFilter = el('def-f-method');
  const selForm = el('def-method');
  if(selFilter){
    const current = selFilter.value;
    selFilter.innerHTML = '<option value="">All methods</option>' + getActiveMethods().map(m=>`<option>${m.id}</option>`).join('');
    selFilter.value = current;
  }
  if(selForm){
    selForm.innerHTML = getActiveMethods().map(m=>`<option>${m.id}</option>`).join('');
  }
  defRender();
}

function defGetAll(){ return ls(KEYS.defects, []); }
function defSaveAll(list){ lss(KEYS.defects, list); }

// Surface defects that live ON saved reports as well — every items-table
// row marked verdict='Not acceptable' on the new-report form can carry
// defectType / defectLocation / defectSize / defectPhoto. The Defects
// log used to only show manually-added entries from KEYS.defects, so a
// report could record a critical defect and the dashboard wouldn't know.
// Now each rejected item with any defect detail surfaces here too, with
// _source='report' so it reads as read-only — the inspector edits these
// by opening the linked report (the form is the source of truth).
//
// Revisions are collapsed: a report with several revisions (Rev 00 ->
// Rev 01 -> Rev 02) only contributes defects from its highest revision,
// so the log doesn't duplicate the same defect across every revision.
// "Open report" lands on that latest-revision record so the inspector
// edits the current state of the report. Repair history is still
// visible by browsing the prior revisions in the Reports list.
function _defFromReports(){
  const reports = (typeof ls === 'function') ? (ls(KEYS.reports, []) || []) : [];
  // Pick the highest-revision report for each reportNo. Reports with
  // no reportNo (rare — usually unsaved scaffolding) fall through with
  // a synthetic key so they aren't bucketed together.
  const latestByReportNo = new Map();
  reports.forEach((r, ri) => {
    if(!r) return;
    const rn = r.reportNo || ('__no_rn__' + ri);
    const rv = parseInt(r.revision, 10) || 0;
    const cur = latestByReportNo.get(rn);
    if(!cur || (parseInt(cur.r.revision, 10) || 0) < rv){
      latestByReportNo.set(rn, { r, ri });
    }
  });
  const out = [];
  latestByReportNo.forEach(({ r, ri }) => {
    if(!Array.isArray(r.items)) return;
    r.items.forEach((it, ii) => {
      if(!it || it.verdict !== 'Not acceptable') return;
      // An item flagged Not acceptable but with no defect detail typed
      // yet isn't useful to surface — the report form is the place to
      // capture it. Wait until at least one of type / location / size /
      // depth / length / dB drop (UT) / severity / disposition is
      // filled before publishing to the log.
      if(!it.defectType && !it.defectLocation && !it.defectSize
         && !it.defectDepth && !it.defectLength && !it.defectDbDrop
         && !it.defectSeverity && !it.defectDisposition) return;
      const subject = (it.subject || r.subject || '').toString();
      out.push({
        _source:     'report',
        _reportIdx:  ri,
        _itemIdx:    ii,
        defectId:    (r.reportNo || '—') + ' #' + (ii + 1),
        type:        it.defectType     || '',
        // Severity / disposition now ride on the item itself —
        // captured via the new dropdowns in the report's Defects
        // section so both views (log + defect-table place card)
        // stay aligned. Depth / length / width still live on the
        // standalone log only (split numeric fields); the item
        // defectSize text is folded into notes.
        severity:    it.defectSeverity    || '',
        status:      'Open',
        method:      r.method          || '',
        location:    it.defectLocation || '',
        // Depth / length now ride on the item itself (the report's
        // Defects section gained split inputs to mirror the log's
        // depth + length fields). Width still log-only.
        depth:       it.defectDepth      || '',
        length:      it.defectLength     || '',
        width:       '',
        component:   subject || '',
        drawing:     it.drawing  || r.drawing || '',
        inspector:   r.inspector || '',
        report:      (r.reportNo || '') + (r.revision ? ' Rev ' + r.revision : ''),
        disposition: it.defectDisposition || '',
        notes:       it.defectSize ? ('Size: ' + it.defectSize) : '',
        photos:      it.defectPhoto ? [it.defectPhoto] : [],
        createdAt:   r.createdAt || '',
      });
    });
  });
  return out;
}

// Combined log = report-derived first (newest report ID at top after
// the .reverse() in the render), then manually-entered standalone
// defects from KEYS.defects. Both flows render through the same table.
function _defCombined(){
  return _defFromReports().concat(defGetAll());
}

// "Open report" action wired to report-derived rows in the table —
// reuses ovViewReport so the inspector lands in the same PDF preview
// the Reports list opens. _reportIdx points at the report's position
// in KEYS.reports captured at _defFromReports time.
function _defOpenReport(reportIdx){
  if(typeof ovViewReport === 'function') ovViewReport(reportIdx);
  else toast('Report viewer not available in this build.', 'error');
}

function defRender(){
  // Pull from both sources: standalone defects (KEYS.defects) and
  // report-derived defects (rejected items on saved reports). See
  // _defCombined / _defFromReports above.
  let list = _defCombined();
  const search = (el('def-search')?.value||'').toLowerCase().trim();
  const fSev = el('def-f-sev')?.value||'';
  const fStatus = el('def-f-status')?.value||'';
  const fMethod = el('def-f-method')?.value||'';
  const fFrom = el('def-f-from')?.value||'';
  const fTo = el('def-f-to')?.value||'';

  if(fSev) list = list.filter(d=>d.severity===fSev);
  if(fStatus) list = list.filter(d=>d.status===fStatus);
  if(fMethod) list = list.filter(d=>d.method===fMethod);
  if(search) list = list.filter(d=>{
    const hay = [d.type,d.location,d.report,d.component,d.drawing,d.inspector,d.disposition,d.notes,d.severity,d.status,d.method].map(v=>(v||'').toLowerCase()).join(' ');
    return hay.includes(search);
  });
  if(fFrom) list = list.filter(d=>{ const dt=(d.createdAt||'').split('T')[0]; return dt>=fFrom; });
  if(fTo)   list = list.filter(d=>{ const dt=(d.createdAt||'').split('T')[0]; return dt<=fTo; });

  const activeFilters = [search,fSev,fStatus,fMethod,fFrom,fTo].filter(Boolean).length;
  // V32: plural-aware translated subtitle for the Defects page
  const defLbl = list.length === 1
    ? t('def.sub.1_defect', '1 defect')
    : tf('def.sub.n_defects', '{n} defects', { n: list.length });
  const flLbl = activeFilters
    ? ' · ' + tf('rpt.sub.filters_active', '{n} filter(s) active', { n: activeFilters })
    : '';
  set('def-sub', defLbl + flLbl);

  // Metrics
  defRenderMetrics(list);

  // Table
  const wrap = el('def-table-wrap'); if(!wrap) return;
  const allDefs = defGetAll();

  if(list.length){
    const rows = list.slice().reverse().map(d=>{
      const fromReport = d._source === 'report';
      // Standalone defects index by their position in the manual store;
      // report-derived entries have no position there and can't be
      // edited / deleted from the log (the report form is the source
      // of truth). defEdit / defDelete are wired to the standalone idx.
      const idx = fromReport ? -1 : allDefs.indexOf(d);
      const sevColor = {Critical:'red',High:'amber',Medium:'blue',Low:'green'}[d.severity]||'muted';
      const statusColor = {Open:'red','In Progress':'amber',Repaired:'blue',Verified:'green',Closed:'muted'}[d.status]||'muted';
      const md = NDT_METHODS.find(m=>m.id===d.method);
      const srcBadge = fromReport
        ? ` <span title="Pulled from a saved report — edit by opening the linked report" style="background:rgba(0,212,255,.12);color:var(--cyan);font-family:var(--mono);font-size:9px;padding:1px 5px;border-radius:3px;letter-spacing:.04em;margin-left:6px">REPORT</span>`
        : '';
      const actions = fromReport
        ? `<button class="btn btn-sm" data-action="_defOpenReport" data-args="${d._reportIdx}" title="Open the linked report" style="font-size:10px;padding:3px 8px">Open report</button>`
        : `<button class="btn btn-sm" data-action="defEdit" data-args="${idx}" style="font-size:10px;padding:3px 8px">Edit</button>
           <button class="btn btn-sm btn-danger" data-action="defDelete" data-args="${idx}" style="font-size:10px;padding:3px 8px">Del</button>`;
      return `<tr>
        <td style="font-family:var(--mono);font-size:11px;color:var(--t2)">${d.defectId||'—'}${srcBadge}</td>
        <td>${d.type||'—'}</td>
        <td><span class="badge badge-${sevColor}" style="font-size:10px">${d.severity ? tSeverity(d.severity) : '—'}</span></td>
        <td><span class="badge badge-${statusColor}" style="font-size:10px">${d.status ? tStatus(d.status) : '—'}</span></td>
        <td><span style="font-family:var(--mono);font-weight:600;color:${md?.color||'var(--t2)'}">${d.method||'—'}</span></td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(d.location||'').replace(/"/g,'&quot;')}">${escapeHtml(d.location||'—')}</td>
        <td style="font-family:var(--mono);font-size:11px">${d.depth ? formatLength(d.depth, 2) : '—'}</td>
        <td style="font-family:var(--mono);font-size:11px">${d.length ? formatLength(d.length, 2) : '—'}</td>
        <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.component||'—'}</td>
        <td style="font-family:var(--mono);font-size:11px;color:var(--t2)">${d.report||'—'}</td>
        <td>${d.disposition||'—'}</td>
        <td style="font-family:var(--mono);font-size:11px;white-space:nowrap">${fmtDate(d.createdAt)}</td>
        <td>
          <div style="display:flex;gap:4px">${actions}</div>
        </td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `<div class="sc"><div class="sc-body np" style="overflow-x:auto">
      <table class="tbl" style="width:100%;font-size:12px"><thead><tr>
        <th scope="col" data-i18n="col.id">ID</th><th scope="col" data-i18n="col.type">Type</th><th scope="col" data-i18n="col.severity">Severity</th><th scope="col" data-i18n="col.status">Status</th><th scope="col" data-i18n="col.method">Method</th><th scope="col" data-i18n="col.location">Location</th><th scope="col" data-i18n="col.depth">Depth</th><th scope="col" data-i18n="col.length">Length</th><th scope="col" data-i18n="col.component">Component</th><th scope="col">Report</th><th scope="col" data-i18n="col.disposition">Disposition</th><th scope="col" data-i18n="col.date">Date</th><th scope="col" style="width:90px" data-i18n="col.actions">Actions</th>
      </tr></thead><tbody>${rows}</tbody></table></div></div>`;
  } else {
    wrap.innerHTML = `<div class="sc"><div class="sc-body np">
      <table class="tbl" style="width:100%"><thead><tr>
        <th scope="col">ID</th><th scope="col">Type</th><th scope="col">Severity</th><th scope="col">Status</th><th scope="col">Method</th><th scope="col">Location</th><th scope="col">Depth</th><th scope="col">Length</th><th scope="col">Component</th><th scope="col">Report</th><th scope="col">Disposition</th><th scope="col">Date</th><th scope="col">Actions</th>
      </tr></thead><tbody>
        <tr><td colspan="13" style="text-align:center;padding:36px;color:var(--t3)">No defects recorded yet. Click <strong>+ Add defect</strong> to create one.</td></tr>
      </tbody></table></div></div>`;
  }
}

function defRenderMetrics(filtered){
  // Use the combined log (standalone + report-derived) so the tile
  // counts reflect every defect on file, not just the manually-added
  // entries.
  const all = _defCombined();
  const metricsEl = el('def-metrics'); if(!metricsEl) return;

  const total = all.length;
  const open = all.filter(d=>d.status==='Open').length;
  const inProg = all.filter(d=>d.status==='In Progress').length;
  const repaired = all.filter(d=>d.status==='Repaired'||d.status==='Verified'||d.status==='Closed').length;
  const critical = all.filter(d=>d.severity==='Critical'&&d.status!=='Closed'&&d.status!=='Verified').length;
  const high = all.filter(d=>d.severity==='High'&&d.status!=='Closed'&&d.status!=='Verified').length;

  metricsEl.innerHTML = `
    <div class="stat-tile cyan">
      <div class="stat-label">Total defects</div>
      <div class="stat-val">${total}</div>
      <div class="stat-sub">${filtered.length} shown</div>
    </div>
    <div class="stat-tile red">
      <div class="stat-label">Open</div>
      <div class="stat-val">${open}</div>
      <div class="stat-sub">Awaiting action</div>
    </div>
    <div class="stat-tile amber">
      <div class="stat-label">In progress</div>
      <div class="stat-val">${inProg}</div>
      <div class="stat-sub">Being resolved</div>
    </div>
    <div class="stat-tile green">
      <div class="stat-label">Resolved</div>
      <div class="stat-val">${repaired}</div>
      <div class="stat-sub">Repaired / verified / closed</div>
    </div>
    <div class="stat-tile red">
      <div class="stat-label">Critical open</div>
      <div class="stat-val">${critical}</div>
      <div class="stat-sub">${high} high severity</div>
    </div>`;
}

function defShowForm(editIdx){
  _defEditIdx = typeof editIdx === 'number' ? editIdx : -1;
  const formWrap = el('def-form-wrap'); if(!formWrap) return;
  const titleEl = el('def-form-title');
  const saveBtn = el('def-save-btn');

  // V5: ensure unit-aware labels reflect the current setting before populating values
  refreshUnitLabels(formWrap);

  if(_defEditIdx >= 0){
    // Load existing defect into form
    const all = defGetAll();
    const d = all[_defEditIdx];
    if(!d) return;
    if(titleEl) titleEl.textContent = t('def.edit_title', 'Edit defect') + ' — ' + (d.defectId||'');
    if(saveBtn) saveBtn.textContent = t('def.btn.update', 'Update defect');
    el('def-type').value = d.type||'';
    el('def-sev').value = d.severity||'High';
    el('def-status').value = d.status||'Open';
    el('def-method').value = d.method||'UT';
    el('def-loc').value = d.location||'';
    // V5: stored in mm, displayed in user's unit
    el('def-depth').value = mmToDisplayValue(d.depth, 3);
    el('def-len').value   = mmToDisplayValue(d.length, 3);
    el('def-width').value = mmToDisplayValue(d.width, 3);
    el('def-report').value = d.report||'';
    el('def-component').value = d.component||'';
    el('def-drawing').value = d.drawing||'';
    el('def-inspector').value = d.inspector||'';
    el('def-disp').value = d.disposition||'';
    el('def-notes').value = d.notes||'';
    // V7: load photos
    _defPhotos = (d.photos || []).slice();
    defRenderPhotos();
  } else {
    if(titleEl) titleEl.textContent = t('def.add_title', 'Add defect');
    if(saveBtn) saveBtn.textContent = t('def.btn.add', '+ Add defect');
    // Clear form
    ['def-loc','def-depth','def-len','def-width','def-report','def-component','def-drawing','def-inspector','def-notes'].forEach(id=>{ const e=el(id); if(e)e.value=''; });
    el('def-sev').value = 'High';
    el('def-status').value = 'Open';
    el('def-type').selectedIndex = 0;
    el('def-disp').selectedIndex = 0;
    // Auto-fill inspector from current user
    if(CURRENT_USER && el('def-inspector')) el('def-inspector').value = CURRENT_USER.name||'';
    // V7: clear photos
    _defPhotos = [];
    defRenderPhotos();
  }

  formWrap.style.display = 'block';
  formWrap.scrollIntoView({behavior:'smooth', block:'nearest'});
}

function defHideForm(){
  const formWrap = el('def-form-wrap'); if(formWrap) formWrap.style.display = 'none';
  _defEditIdx = -1;
}

function defGenerateId(){
  const all = defGetAll();
  const num = all.length + 1;
  return 'DEF-' + String(num).padStart(4,'0');
}

// 'defect.saved' fires only when a defect was actually written — js/dashboard.js
// listens for it to append the audit entry, which it used to do by reassigning
// this function from another file (illegal under ES modules).
//
// Firing from inside the save paths also fixes a bug in the old wrapper: it
// appended an audit entry unconditionally, so a save rejected by the `!type`
// validation below still recorded a "created" entry against whatever defect
// happened to be last in the list. Hooks run just BEFORE the write, so their
// changes land in the same save rather than a second one.
function defSave(){
  const type = el('def-type')?.value||'';
  const severity = el('def-sev')?.value||'High';
  const status = el('def-status')?.value||'Open';
  const method = el('def-method')?.value||'UT';
  const location = el('def-loc')?.value?.trim()||'';
  // V5: input value in user's unit → convert to mm for storage
  const depth = inputValueToMm(el('def-depth')?.value?.trim()||'');
  const length = inputValueToMm(el('def-len')?.value?.trim()||'');
  const width = inputValueToMm(el('def-width')?.value?.trim()||'');
  const report = el('def-report')?.value?.trim()||'';
  const component = el('def-component')?.value?.trim()||'';
  const drawing = el('def-drawing')?.value?.trim()||'';
  const inspector = el('def-inspector')?.value?.trim()||'';
  const disposition = el('def-disp')?.value||'';
  const notes = el('def-notes')?.value?.trim()||'';

  if(!type){ toast(t('toast.choose_defect_type', 'Please select a defect type'),'error'); return; }

  const all = defGetAll();

  if(_defEditIdx >= 0 && _defEditIdx < all.length){
    // Update existing
    const d = all[_defEditIdx];
    Object.assign(d, {type,severity,status,method,location,depth,length,width,report,component,drawing,inspector,disposition,notes,photos:_defPhotos.slice(),updatedAt:new Date().toISOString()});
    vxFire('defect.saved', d, true);
    defSaveAll(all);
    toast(t('toast.defect_updated','Defect updated.'));
  } else {
    // Add new
    const defect = {
      defectId: defGenerateId(),
      type,severity,status,method,location,depth,length,width,
      report,component,drawing,inspector,disposition,notes,
      photos: _defPhotos.slice(),
      createdAt: new Date().toISOString(),
      createdBy: CURRENT_USER?.name||'Unknown',
    };
    all.push(defect);
    vxFire('defect.saved', defect, false);
    defSaveAll(all);
    toast(t('toast.defect_added','Defect added.'));
  }

  defHideForm();
  defRender();
}

function defEdit(idx){
  defShowForm(idx);
}

function defDelete(idx){
  const all = defGetAll();
  const original = all[idx];
  if(!original) return;
  // V14: optimistic delete with undo
  vxUndoable({
    message:       'Defect ' + (original.defectId || '(no id)') + ' deleted',
    undoneMessage: 'Defect restored',
    duration:      6000,
    apply: () => {
      const list = defGetAll();
      list.splice(idx, 1);
      defSaveAll(list);
      defRender();
    },
    undo: () => {
      const list = defGetAll();
      list.splice(idx, 0, original);
      defSaveAll(list);
      defRender();
    },
  });
}

function defClearFilters(){
  ['def-search','def-f-from','def-f-to'].forEach(id=>{ const e=el(id); if(e)e.value=''; });
  ['def-f-sev','def-f-status','def-f-method'].forEach(id=>{ const e=el(id); if(e)e.value=''; });
  defRender();
}

function defExportCsv(){
  // Export the combined log so the CSV covers every defect — manually-
  // added and report-derived alike. The Source column flags which
  // entries came from a report so an analyst can filter / pivot.
  const all = _defCombined();
  if(!all.length){ toast(t('toast.no_defects', 'No defects to export'),'error'); return; }
  const u = unitLabel();
  const headers = ['ID','Type','Severity','Status','Method','Location',`Depth (${u})`,`Length (${u})`,`Width (${u})`,'Report','Component','Drawing','Inspector','Disposition','Notes','Date','Created By','Source'];
  const rows = all.map(d=>[
    d.defectId, d.type, d.severity, d.status, d.method, d.location,
    mmToDisplayValue(d.depth, 3), mmToDisplayValue(d.length, 3), mmToDisplayValue(d.width, 3),
    d.report, d.component, d.drawing, d.inspector, d.disposition, d.notes,
    d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '', d.createdBy||'',
    d._source === 'report' ? 'report' : 'manual',
  ].map(v=>'"'+(v||'').replace(/"/g,'""')+'"'));
  const csv = [headers.join(','), ...rows.map(r=>r.join(','))].join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'defects-export-'+new Date().toISOString().split('T')[0]+'.csv';
  a.click(); URL.revokeObjectURL(url);
  toast(t('toast.csv_exported', 'CSV exported'));
}


// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// NDT PROCEDURES — Document management, upload, key info extraction
// ═══════════════════════════════════════════════════════════════════════════

var _procEditIdx = -1;
var _procFileQueue = [];
var _procViewingIdx = -1;

function procGetAll(){ return ls(KEYS.procedures, []); }
function procSaveAll(list){ lss(KEYS.procedures, list); }
function procSaveFile(procNo, dataUrl){
  try{
    localStorage.setItem('vx-proc-file-'+procNo, dataUrl);
    // Verify it was stored
    const check = localStorage.getItem('vx-proc-file-'+procNo);
    if(!check || check.length < 100){ return false; }
    return true;
  }catch(e){ console.warn('File storage failed',e); return false; }
}
function procLoadFile(procNo){
  try{ return localStorage.getItem('vx-proc-file-'+procNo)||null; }catch(e){ return null; }
}
function procDeleteFile(procNo){
  try{ localStorage.removeItem('vx-proc-file-'+procNo); }catch(e){}
}

function procInit(){
  const sel = el('proc-f-method');
  const selForm = el('proc-method');
  if(sel){
    const v = sel.value;
    sel.innerHTML = '<option value="">All methods</option>' + getActiveMethods().map(m=>`<option>${m.id}</option>`).join('');
    sel.value = v;
  }
  if(selForm) selForm.innerHTML = getActiveMethods().map(m=>`<option>${m.id}</option>`).join('');
  procRender();
}

// ── Home page: View-only procedures ──────────────────────────────────
// The read-only procedures view is embedded in two places (the Overview
// "NDT procedures" section and the Inspector workspace). Both reuse these
// functions; _procViewPfx names the active host's id prefix so the filter
// inputs, metrics, table and viewer all resolve to the right copy. The
// data-on-input handlers re-call procRenderView() with no args, so the
// prefix lives on a module var (set by procInitView), not a parameter.
var _procViewPfx = 'proc-view';
function procInitView(hostId){
  _procViewPfx = hostId || 'proc-view';
  const sel = el(_procViewPfx + '-f-method');
  if(sel){
    const v = sel.value;
    sel.innerHTML = '<option value="">All methods</option>' + getActiveMethods().map(m=>`<option>${m.id}</option>`).join('');
    sel.value = v;
  }
  procRenderView();
}

function procRenderView(){
  // See procRender — procGetAll() returns a fresh parse each call, so each
  // procedure's stored-array index must be captured while `list` still
  // holds these object instances (indexOf against a second call fails).
  const P = _procViewPfx || 'proc-view';
  const stored = procGetAll();
  const idxOf  = new Map(stored.map((p, i) => [p, i]));
  let list = stored.slice();
  const search = (el(P+'-search')?.value||'').toLowerCase().trim();
  const fMethod = el(P+'-f-method')?.value||'';
  const fStatus = el(P+'-f-status')?.value||'';

  if(fMethod) list = list.filter(p=>p.method===fMethod);
  if(fStatus) list = list.filter(p=>p.status===fStatus);
  if(search) list = list.filter(p=>{
    return [p.procNo,p.title,p.method,p.standard,p.acceptance,p.status,p.fileName]
      .map(v=>(v||'').toLowerCase()).join(' ').includes(search);
  });
  list.sort((a,b)=>(a.procNo||'').localeCompare(b.procNo||''));

  // Metrics
  const all = stored;
  const metricsEl = el(P+'-metrics');
  if(metricsEl){
    const active = all.filter(p=>p.status==='Active').length;
    const draft = all.filter(p=>p.status==='Draft').length;
    const withFile = all.filter(p=>p.hasFile||p.fileName).length;
    const methods = new Set(all.map(p=>p.method)).size;
    metricsEl.innerHTML = `
      <div class="stat-tile cyan"><div class="stat-label">Total procedures</div><div class="stat-val">${all.length}</div><div class="stat-sub">${list.length} shown</div></div>
      <div class="stat-tile green"><div class="stat-label">Active</div><div class="stat-val">${active}</div><div class="stat-sub">Current revision</div></div>
      <div class="stat-tile blue"><div class="stat-label">Draft</div><div class="stat-val">${draft}</div><div class="stat-sub">In preparation</div></div>
      <div class="stat-tile amber"><div class="stat-label">With document</div><div class="stat-val">${withFile}</div><div class="stat-sub">File attached</div></div>
      <div class="stat-tile violet"><div class="stat-label">Methods covered</div><div class="stat-val">${methods}</div><div class="stat-sub">of ${NDT_METHODS.length} configured</div></div>`;
  }

  // Table (view-only — no edit/delete buttons)
  const wrap = el(P+'-table-wrap'); if(!wrap) return;

  if(list.length){
    const rows = list.map(p=>{
      const idx = idxOf.get(p);
      const md = NDT_METHODS.find(m=>m.id===p.method);
      const stColor = {Active:'green',Draft:'blue',Superseded:'amber',Withdrawn:'red'}[p.status]||'muted';
      const hasFile = !!(p.hasFile || p.fileName);
      const fSize = p.fileSize ? (p.fileSize<1048576?(p.fileSize/1024).toFixed(0)+'KB':(p.fileSize/1048576).toFixed(1)+'MB') : '';
      const fIcon = p.fileType ? (p.fileType.includes('pdf')?'📕':p.fileType.includes('image')?'🖼':'📘') : '📄';
      return `<tr>
        <td style="font-family:var(--mono);font-size:12px;font-weight:600;white-space:nowrap">${p.procNo||'—'}</td>
        <td style="min-width:160px;font-weight:500">${p.title||'Untitled'}</td>
        <td style="font-family:var(--mono);font-size:12px;text-align:center">${p.revision||'—'}</td>
        <td><span style="font-family:var(--mono);font-weight:600;color:${md?.color||'var(--t2)'}">${p.method||'—'}</span></td>
        <td style="font-size:11px">${p.standard||'—'}</td>
        <td style="font-size:11px">${p.acceptance||'—'}</td>
        <td><span class="badge badge-${stColor}" style="font-size:10px">${p.status||'—'}</span></td>
        <td style="font-size:11px;white-space:nowrap">${p.reviewDate ? new Date(p.reviewDate).toLocaleDateString('en-GB') : '—'}</td>
        <td>
          ${hasFile
            ?`<div style="display:flex;align-items:center;gap:6px;cursor:pointer" data-action="procViewFileView" data-args="${idx}" title="Click to view">
                <span style="font-size:14px">${fIcon}</span>
                <div style="min-width:0"><div style="font-size:11px;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">${escapeHtml(p.fileName||'Document')}</div>
                ${fSize?'<div style="font-size:9px;color:var(--t3)">'+fSize+'</div>':''}
                </div>
              </div>`
            :'<span style="color:var(--t3);font-size:11px">—</span>'}
        </td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `<div class="sc"><div class="sc-body np" style="overflow-x:auto">
      <table class="tbl" style="width:100%;font-size:12px"><thead><tr>
        <th scope="col">Procedure No.</th><th scope="col">Title</th><th scope="col">Rev</th><th scope="col">Method</th><th scope="col">Specification</th><th scope="col">Acceptance</th><th scope="col">Status</th><th scope="col">Review</th><th scope="col">Document</th>
      </tr></thead><tbody>${rows}</tbody></table></div></div>`;
  } else {
    wrap.innerHTML = `<div class="sc"><div class="sc-body np">
      <table class="tbl" style="width:100%"><thead><tr>
        <th scope="col">Procedure No.</th><th scope="col">Title</th><th scope="col">Rev</th><th scope="col">Method</th><th scope="col">Specification</th><th scope="col">Acceptance</th><th scope="col">Status</th><th scope="col">Review</th><th scope="col">Document</th>
      </tr></thead><tbody>
        <tr><td colspan="9" style="text-align:center;padding:36px;color:var(--t3)">No procedures found. Add procedures via <strong>Settings → NDT procedures</strong>.</td></tr>
      </tbody></table></div></div>`;
  }
}

function procClearViewFilters(){
  const P = _procViewPfx || 'proc-view';
  const s = el(P+'-search'); if(s) s.value = '';
  const m = el(P+'-f-method'); if(m) m.value = '';
  const st = el(P+'-f-status'); if(st) st.value = '';
  procRenderView();
}

function procViewFileView(idx){
  const all = procGetAll();
  const p = all[idx]; if(!p){ toast(t('toast.procedure_not_found', 'Procedure not found'),'error'); return; }
  const fileData = procLoadFile(p.procNo);
  if(!fileData){ toast(t('toast.no_file_storage_settings', 'No file in storage — re-upload via Settings'),'error'); return; }

  _procViewingIdx = idx;
  let blobUrl;
  try {
    const parts = fileData.split(',');
    const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/pdf';
    const raw = atob(parts[1]);
    const arr = new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) arr[i]=raw.charCodeAt(i);
    blobUrl = URL.createObjectURL(new Blob([arr], {type: mime}));
  } catch(e) { blobUrl = fileData; }

  const P = _procViewPfx || 'proc-view';
  const viewerWrap = el(P+'-viewer-wrap');
  const viewerTitle = el(P+'-viewer-title');
  const viewerFrame = el(P+'-viewer-frame');
  if(!viewerWrap || !viewerFrame){ window.open(blobUrl); return; }

  if(viewerTitle) viewerTitle.textContent = (p.procNo||'') + ' — ' + (p.fileName||'Document');
  viewerFrame.src = blobUrl;
  viewerWrap.style.display = 'block';
  viewerWrap.scrollIntoView({behavior:'smooth', block:'start'});
}

function procCloseViewViewer(){
  const P = _procViewPfx || 'proc-view';
  const wrap = el(P+'-viewer-wrap');
  const frame = el(P+'-viewer-frame');
  if(frame && frame.src && frame.src.startsWith('blob:')) URL.revokeObjectURL(frame.src);
  if(wrap) wrap.style.display = 'none';
  if(frame) frame.src = 'about:blank';
}

function procRender(){
  // procGetAll() parses fresh JSON on every call, so objects from one call
  // are never reference-equal to another's. Capture each procedure's
  // stored-array index up front, while `list` still holds these exact
  // instances. The old allProcs.indexOf(p) compared against a SECOND
  // procGetAll() and always returned -1 — every row's Edit/Del button
  // carried data-args="-1", so Edit opened a blank upload form, Delete
  // removed the last procedure, and View reported "not found".
  const stored = procGetAll();
  const idxOf  = new Map(stored.map((p, i) => [p, i]));
  let list = stored.slice();
  const search = (el('proc-search')?.value||'').toLowerCase().trim();
  const fMethod = el('proc-f-method')?.value||'';
  const fStatus = el('proc-f-status')?.value||'';

  if(fMethod) list = list.filter(p=>p.method===fMethod);
  if(fStatus) list = list.filter(p=>p.status===fStatus);
  if(search) list = list.filter(p=>{
    return [p.procNo,p.title,p.method,p.standard,p.acceptance,p.status,p.fileName]
      .map(v=>(v||'').toLowerCase()).join(' ').includes(search);
  });

  list.sort((a,b)=>(a.procNo||'').localeCompare(b.procNo||''));
  procRenderMetrics(list);

  const wrap = el('proc-table-wrap'); if(!wrap) return;

  if(list.length){
    const rows = list.map(p=>{
      const idx = idxOf.get(p);
      const md = NDT_METHODS.find(m=>m.id===p.method);
      const stColor = {Active:'green',Draft:'blue',Superseded:'amber',Withdrawn:'red'}[p.status]||'muted';
      const hasFile = !!(p.hasFile || p.fileName);
      const fSize = p.fileSize ? (p.fileSize<1048576?(p.fileSize/1024).toFixed(0)+'KB':(p.fileSize/1048576).toFixed(1)+'MB') : '';
      const fIcon = p.fileType ? (p.fileType.includes('pdf')?'📕':p.fileType.includes('image')?'🖼':'📘') : '📄';
      return `<tr>
        <td style="font-family:var(--mono);font-size:12px;font-weight:600;white-space:nowrap">${p.procNo||'—'}</td>
        <td style="min-width:160px;font-weight:500">${p.title||'Untitled'}</td>
        <td style="font-family:var(--mono);font-size:12px;text-align:center">${p.revision||'—'}</td>
        <td><span style="font-family:var(--mono);font-weight:600;color:${md?.color||'var(--t2)'}">${p.method||'—'}</span></td>
        <td style="font-size:11px">${p.standard||'—'}</td>
        <td style="font-size:11px">${p.acceptance||'—'}</td>
        <td><span class="badge badge-${stColor}" style="font-size:10px">${p.status||'—'}</span></td>
        <td style="font-size:11px;white-space:nowrap">${p.reviewDate ? new Date(p.reviewDate).toLocaleDateString('en-GB') : '—'}</td>
        <td>
          ${hasFile
            ?`<div style="display:flex;align-items:center;gap:6px;cursor:pointer" data-action="procViewFile" data-args="${idx}" title="Click to view">
                <span style="font-size:14px">${fIcon}</span>
                <div style="min-width:0"><div style="font-size:11px;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">${escapeHtml(p.fileName||'Document')}</div>
                ${fSize?'<div style="font-size:9px;color:var(--t3)">'+fSize+'</div>':''}
                </div>
              </div>`
            :'<span style="color:var(--t3);font-size:11px">—</span>'}
        </td>
        <td>
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm" data-action="procEdit" data-args="${idx}" style="font-size:10px;padding:3px 7px">Edit</button>
            <button class="btn btn-sm btn-danger" data-action="procDelete" data-args="${idx}" style="font-size:10px;padding:3px 7px">Del</button>
          </div>
        </td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `<div class="sc"><div class="sc-body np" style="overflow-x:auto">
      <table class="tbl" style="width:100%;font-size:12px"><thead><tr>
        <th scope="col">Procedure No.</th><th scope="col">Title</th><th scope="col">Rev</th><th scope="col">Method</th><th scope="col">Specification</th><th scope="col">Acceptance</th><th scope="col">Status</th><th scope="col">Review</th><th scope="col">Document</th><th scope="col" style="width:90px">Actions</th>
      </tr></thead><tbody>${rows}</tbody></table></div></div>`;
  } else {
    wrap.innerHTML = `<div class="sc"><div class="sc-body np">
      <table class="tbl" style="width:100%"><thead><tr>
        <th scope="col">Procedure No.</th><th scope="col">Title</th><th scope="col">Rev</th><th scope="col">Method</th><th scope="col">Specification</th><th scope="col">Acceptance</th><th scope="col">Status</th><th scope="col">Review</th><th scope="col">Document</th><th scope="col">Actions</th>
      </tr></thead><tbody>
        <tr><td colspan="10" style="text-align:center;padding:36px;color:var(--t3)">No procedures found. Click <strong>+ Upload procedure</strong> to add one.</td></tr>
      </tbody></table></div></div>`;
  }
}

function procRenderMetrics(filtered){
  const all = procGetAll();
  const metricsEl = el('proc-metrics'); if(!metricsEl) return;
  const active = all.filter(p=>p.status==='Active').length;
  const draft = all.filter(p=>p.status==='Draft').length;
  const withFile = all.filter(p=>p.hasFile||p.fileName).length;
  const methods = new Set(all.map(p=>p.method)).size;

  metricsEl.innerHTML = `
    <div class="stat-tile cyan"><div class="stat-label">Total procedures</div><div class="stat-val">${all.length}</div><div class="stat-sub">${filtered.length} shown</div></div>
    <div class="stat-tile green"><div class="stat-label">Active</div><div class="stat-val">${active}</div><div class="stat-sub">Current revision</div></div>
    <div class="stat-tile blue"><div class="stat-label">Draft</div><div class="stat-val">${draft}</div><div class="stat-sub">In preparation</div></div>
    <div class="stat-tile amber"><div class="stat-label">With document</div><div class="stat-val">${withFile}</div><div class="stat-sub">File attached</div></div>
    <div class="stat-tile violet"><div class="stat-label">Methods covered</div><div class="stat-val">${methods}</div><div class="stat-sub">of ${NDT_METHODS.length} configured</div></div>`;
}

// Fill a procedure-form <select> with the canonical options, keeping a
// non-canonical saved value selectable so editing a legacy procedure
// never silently loses its specification / acceptance.
function _procFillSelect(id, options, value){
  const sel = el(id);
  if(!sel) return;
  const v = String(value || '');
  const opts = (options || []).slice();
  if(v && opts.indexOf(v) === -1) opts.unshift(v);
  sel.innerHTML = '<option value=""></option>'
    + opts.map(o => `<option${o === v ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('');
  sel.value = v;
}

// ── Upload form ──────────────────────────────────────────────────────
function procShowUpload(editIdx){
  _procEditIdx = typeof editIdx === 'number' ? editIdx : -1;
  _procFileQueue = [];
  const wrap = el('proc-upload-wrap'); if(!wrap) return;
  const titleEl = el('proc-form-title');
  const saveBtn = el('proc-save-btn');
  const queueEl = el('proc-file-queue');
  const extractBanner = el('proc-extract-info');

  const mSel = el('proc-method');
  if(mSel) mSel.innerHTML = getActiveMethods().map(m=>`<option>${m.id}</option>`).join('');
  if(extractBanner) extractBanner.style.display = 'none';

  // Specification / Acceptance are free-text inputs (not dropdowns) on
  // the upload form so the inspector can type or paste whatever the
  // procedure document actually cites — including standards not in any
  // preset list. The procedure register still matches by NDT method +
  // Active status (see cvResolveSmartLink in editor.js); the spec /
  // acceptance text is kept on the record for the list / export
  // columns and for legacy data continuity.
  if(_procEditIdx >= 0){
    const all = procGetAll();
    const p = all[_procEditIdx]; if(!p) return;
    if(titleEl) titleEl.textContent = 'Edit procedure — ' + (p.procNo||'');
    if(saveBtn) saveBtn.textContent = 'Save changes';
    el('proc-no').value = p.procNo||'';
    el('proc-title').value = p.title||'';
    el('proc-rev').value = p.revision||'';
    el('proc-review').value = p.reviewDate||'';
    el('proc-status').value = p.status||'Active';
    if(mSel) mSel.value = p.method||'UT';
    if(el('proc-standard'))   el('proc-standard').value   = p.standard   || '';
    if(el('proc-acceptance')) el('proc-acceptance').value = p.acceptance || '';
    if(p.fileName && queueEl){
      const fIcon = p.fileType?(p.fileType.includes('pdf')?'📕':p.fileType.includes('image')?'🖼':'📘'):'📄';
      queueEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--panel2);border-radius:6px;font-size:12px;color:var(--t2)">${fIcon} ${escapeHtml(p.fileName)} <span style="color:var(--t3);font-size:10px">(current file — upload new to replace)</span></div>`;
    }
  } else {
    if(titleEl) titleEl.textContent = 'Upload procedure';
    if(saveBtn) saveBtn.textContent = 'Save procedure';
    ['proc-no','proc-title','proc-rev','proc-review','proc-standard','proc-acceptance'].forEach(id=>{ const e=el(id); if(e) e.value=''; });
    el('proc-status').value = 'Active';
    if(mSel) mSel.selectedIndex = 0;
    if(queueEl) queueEl.innerHTML = '';
  }
  wrap.style.display = 'block';
  wrap.scrollIntoView({behavior:'smooth', block:'nearest'});
}

function procHideUpload(){
  const wrap = el('proc-upload-wrap'); if(wrap) wrap.style.display = 'none';
  _procEditIdx = -1;
  _procFileQueue = [];
}

function procHandleFiles(files){
  if(!files || !files.length) return;
  _procFileQueue = [];

  const file = files[0];
  if(file.size > 5 * 1024 * 1024){ toast(tf('toast.file_too_large_n','File too large: {name} (max {max})', {name: file.name, max: '5MB'}), 'error'); return; }

  // Read as dataURL for storage
  const reader = new FileReader();
  reader.onload = e => {
    _procFileQueue = [{name:file.name, size:file.size, type:file.type, dataUrl:e.target.result}];
    procRenderQueue();

    // Extract info from filename first (fallback)
    procExtractInfo(file.name);

    // If PDF, extract text content using pdf.js for better field population
    if(file.type === 'application/pdf' && typeof pdfjsLib !== 'undefined'){
      const reader2 = new FileReader();
      reader2.onload = e2 => {
        procExtractPdfText(new Uint8Array(e2.target.result)).then(text => {
          if(text && text.length > 10) procExtractFromContent(text);
        }).catch(err => console.warn('PDF text extraction failed:', err));
      };
      reader2.readAsArrayBuffer(file);
    }

    const banner = el('proc-extract-info');
    if(banner) banner.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

// ── PDF text extraction using pdf.js ────────────────────────────────
async function procExtractPdfText(uint8Array){
  if(typeof pdfjsLib === 'undefined') return '';
  try {
    const pdf = await pdfjsLib.getDocument({data: uint8Array}).promise;
    const maxPages = Math.min(pdf.numPages, 3); // first 3 pages is enough
    let fullText = '';
    for(let i = 1; i <= maxPages; i++){
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map(item => item.str);
      fullText += strings.join(' ') + '\n';
    }
    return fullText;
  } catch(e){
    console.warn('pdf.js extraction error:', e);
    return '';
  }
}

// ── Extract fields from PDF text content ────────────────────────────
function procExtractFromContent(text){
  // Normalise whitespace
  const t = text.replace(/\s+/g,' ');

  // 1. Revision — look for "Revision: 03", "Rev. 02", "Issue 4", "Rev No: 01"
  if(el('proc-rev')){
    const revPatterns = [
      /(?:revision|rev\.?|issue)[\s:.-]*(?:no\.?\s*[:.]?\s*)?(\d{1,3})/i,
      /\brev\s+(\d{1,3})\b/i,
      /\brevision\s*[:]\s*(\d{1,3})/i,
      /\bissue\s*[:]\s*(\d{1,3})/i,
    ];
    for(const re of revPatterns){
      const m = t.match(re);
      if(m){
        el('proc-rev').value = m[1].padStart(2,'0');
        break;
      }
    }
  }

  // 2. Specification / Standard — look for standard references in content
  if(el('proc-standard') && !el('proc-standard').value){
    const specPatterns = [
      /(?:specification|standard|code|reference|applicable standard|examination to|tested to|inspected to|in accordance with|acc\.?\s*to)[\s:.-]+([A-Z]{2,5}[-\s]?(?:ISO[-\s]?)?\d{4,6}(?:[-:]\d+)?(?:[-:]\d{4})?)/i,
      /(EN[-\s]?ISO[-\s]?\d{4,6}(?:[-:]\d+)?(?:[-:]\d{4})?)/,
      /(ISO[-\s]?\d{4,6}(?:[-:]\d+)?(?:[-:]\d{4})?)/,
      /(ASME\s+\w+(?:\s+\w+)?)/,
      /(AWS\s+D[\d.]+(?:[-:/]\d{4})?)/,
      /(ASTM\s+\w+[-\s]?\d+)/,
      /(BS[-\s]?EN[-\s]?\d{4,}(?:[-:]\d+)?)/,
      /(BS\s+\d{4,}(?:[-:]\d+)?)/,
      /(API\s+\d+(?:\s+\w+)?)/,
      /(DNV[-\s]\w+[-\s]\w+)/,
      /(NORSOK\s+\w+[-\s]?\w+)/,
    ];
    for(const re of specPatterns){
      const m = t.match(re);
      if(m){
        let val = (m[1]||m[0]).replace(/\s+/g,' ').trim();
        val = val.split(/\s+(?:Prepared|Author|Approved|Reviewed|Checked|Issued|Written|Signed|Date|Page|Name|Mr\.|Mrs\.|Ms\.|Dr\.)/i)[0].trim();
        val = val.replace(/[.\s:,;]+$/,'');
        el('proc-standard').value = val;
        break;
      }
    }
  }

  // 3. Acceptance criteria — look for acceptance/evaluation references
  if(el('proc-acceptance') && !el('proc-acceptance').value){
    const accPatterns = [
      /(?:acceptance\s*(?:criteria|level|standard|code)|accept(?:ance)?\s*(?:to|per|acc\.?\s*to)|evaluation\s*(?:to|per|level)|assessed\s*(?:to|per|in accordance))[\s:.-]+([A-Z][\w\s.:-]{5,80})/i,
      /(?:acceptance\s*(?:criteria|level))[\s:.-]+(.{5,60}?)(?:\.|$|\n)/i,
      /((?:EN[-\s]?)?ISO[-\s]?\d{4,6}(?:[-:\s]\d+)?(?:[-:\s]\d{4})?(?:\s*[-–]\s*\d+)?(?:\s*(?:level|class|grade)\s*\w+)?)/i,
      /(?:level|class|grade)\s+(\w+)\s+(?:of|per|to)\s+([A-Z][\w\s.:-]{5,40})/i,
    ];
    for(const re of accPatterns){
      const m = t.match(re);
      if(m){
        let val = (m[1]||m[0]).replace(/\s+/g,' ').trim();
        // Truncate at boundary words (names, roles, document sections)
        val = val.split(/\s+(?:Prepared|Author|Approved|Reviewed|Checked|Issued|Written|Signed|Date|Page|Revision|Rev\b|Name|Document|Signature|Mr\.|Mrs\.|Ms\.|Dr\.)/i)[0].trim();
        val = val.replace(/[.\s:,;]+$/,'').substring(0,80);
        if(val.length > 3) el('proc-acceptance').value = val;
        break;
      }
    }
  }

  // 4. Procedure number — if not already set, look for it in content
  if(el('proc-no') && !el('proc-no').value){
    const procPatterns = [
      /(?:procedure\s*(?:no\.?|number|ref\.?|reference))[\s:.-]+([A-Z0-9][\w-]{3,30})/i,
      /(?:document\s*(?:no\.?|number|ref\.?))[\s:.-]+([A-Z0-9][\w-]{3,30})/i,
    ];
    for(const re of procPatterns){
      const m = t.match(re);
      if(m){
        el('proc-no').value = m[1].trim();
        break;
      }
    }
  }

  // 5. Title — if not already set
  if(el('proc-title') && !el('proc-title').value){
    const titlePatterns = [
      /(?:title|procedure\s*title|document\s*title)[\s:.-]+(.{5,80}?)(?:\n|revision|rev|issue|date|page)/i,
    ];
    for(const re of titlePatterns){
      const m = t.match(re);
      if(m){
        el('proc-title').value = m[1].replace(/\s+/g,' ').trim();
        break;
      }
    }
  }

  // 6. NDT Method — detect from content
  const methodDetect = [
    ['UT', /\b(?:ultrasonic\s*(?:testing|inspection|examination)|TOFD|phased\s*array)\b/i],
    ['MT', /\b(?:magnetic\s*(?:particle|testing)|MPI)\b/i],
    ['VT', /\b(?:visual\s*(?:testing|inspection|examination))\b/i],
    ['PT', /\b(?:(?:liquid|dye)\s*penetrant|penetrant\s*(?:testing|inspection))\b/i],
    ['RT', /\b(?:radiographic\s*(?:testing|inspection|examination)|radiography)\b/i],
    ['ET', /\b(?:eddy\s*current\s*(?:testing|inspection))\b/i],
    ['PMI', /\b(?:positive\s*material\s*identification|PMI\s*testing)\b/i],
    ['HT', /\b(?:hardness\s*(?:testing|measurement))\b/i],
  ];
  for(const [method, regex] of methodDetect){
    if(regex.test(t)){
      const mSel = el('proc-method'); if(mSel) mSel.value = method;
      break;
    }
  }
}

function procRenderQueue(){
  const queueEl = el('proc-file-queue'); if(!queueEl) return;
  if(!_procFileQueue.length){ queueEl.innerHTML = ''; return; }
  const f = _procFileQueue[0];
  const sizeStr = f.size < 1024 ? f.size+'B' : f.size < 1048576 ? (f.size/1024).toFixed(1)+'KB' : (f.size/1048576).toFixed(1)+'MB';
  const ftype = f.type || '';
  const icon = ftype.includes('pdf') ? '📕' : ftype.includes('word') || ftype.includes('doc') ? '📘' : ftype.includes('image') ? '🖼' : '📄';
  queueEl.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--panel2);border-radius:6px">
    <span style="font-size:18px">${icon}</span>
    <div style="flex:1;min-width:0"><div style="font-size:12px;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.name)}</div><div style="font-size:10px;color:var(--t3)">${sizeStr} · ${f.type||'unknown'}</div></div>
    <button class="btn btn-sm" data-action="_wResetProcFileQueue" style="font-size:10px;padding:2px 6px;color:var(--red)">✕</button>
  </div>`;
}

// ── Filename extraction ──────────────────────────────────────────────
function procExtractInfo(fileName){
  const name = fileName.replace(/\.[^.]+$/, ''); // strip extension
  const parts = name.replace(/[-_]+/g, ' ').trim();

  // 1. Procedure number — extract just the procedure ID, not the full filename
  if(el('proc-no') && !el('proc-no').value){
    const procPatterns = [
      // Match structured IDs: SV2023-004-NDTD-PRO-0003, NDTD-PRO-0003, PRO-0003
      /((?:\w{2,6}[-_]\d{2,4}[-_])?(?:\w{2,6}[-_])?(?:PRO|PROC|WPS|WI|QP|NDE|NDT)[-_]?\d{3,})/i,
      // Match doc number patterns: XX-XXXX-XXX
      /^([A-Z]{2,4}[-_]\d{3,}(?:[-_]\d{3,})?(?:[-_][A-Z]{2,4}[-_]\d{3,})?)/i,
    ];
    for(const re of procPatterns){
      const m = name.match(re);
      if(m){
        el('proc-no').value = m[1].replace(/\s+/g,'-').toUpperCase();
        break;
      }
    }
  }

  // 2. Revision — look for Rev/R/V, or the number right after the procedure ID
  const revPatterns = [
    /(?:rev(?:ision)?|issue)[-_.\s]?(\d{1,3})/i,
    /[-_\s]r(\d{1,3})(?:[-_.\s]|$)/i,
    /[-_\s]v(\d{1,3})(?:[-_.\s]|$)/i,
  ];
  // Also try: number immediately after the procedure number portion (e.g. PRO-0003-01)
  const procNo = el('proc-no')?.value || '';
  if(procNo){
    const escaped = procNo.replace(/[-_]/g,'[-_]');
    revPatterns.push(new RegExp(escaped + '[-_](\\d{1,2})(?:[-_]|$)', 'i'));
  }
  revPatterns.push(/[-_](\d{1,2})$/); // trailing number fallback

  for(const re of revPatterns){
    const m = name.match(re);
    if(m){
      if(el('proc-rev') && !el('proc-rev').value) el('proc-rev').value = m[1].padStart(2,'0');
      break;
    }
  }

  // 3. NDT method
  const methodPatterns = [
    ['UT', /\b(ultrasonic|ultra.?sonic|TOFD|phased.?array)\b|(?:^|[-_\s])UT(?:[-_\s]|$)/i],
    ['MT', /\b(magnetic|mag.?particle|MPI)\b|(?:^|[-_\s])MT(?:[-_\s]|$)/i],
    ['VT', /\b(visual)\b|(?:^|[-_\s])VT(?:[-_\s]|$)/i],
    ['PT', /\b(penetrant|dye.?pen|liquid.?pen|FPI|DPI)\b|(?:^|[-_\s])PT(?:[-_\s]|$)/i],
    ['PMI', /\b(positive.?material|PMI|XRF)\b/i],
    ['HT', /\b(hardness)\b|(?:^|[-_\s])HT(?:[-_\s]|$)/i],
    ['RT', /\b(radiograph|x.?ray|gamma.?ray)\b|(?:^|[-_\s])RT(?:[-_\s]|$)/i],
    ['ET', /\b(eddy.?current|ECT)\b|(?:^|[-_\s])ET(?:[-_\s]|$)/i],
  ];
  for(const [method, regex] of methodPatterns){
    if(regex.test(name)){
      const mSel = el('proc-method'); if(mSel) mSel.value = method;
      break;
    }
  }

  // 4. Specification — look for standard references in filename
  const specPatterns = [
    /(EN[-\s]?(?:ISO)?[-\s]?\d{4,6}(?:[-:]\d+)?(?:[-:]\d{4})?)/i,
    /(ISO[-\s]?\d{4,6}(?:[-:]\d+)?)/i,
    /(ASME[-\s]?\w+(?:[-\s]?\w+)?)/i,
    /(AWS[-\s]?D[\d.]+)/i,
    /(ASTM[-\s]?\w+[-\s]?\d+)/i,
    /(BS[-\s]?EN[-\s]?\d+)/i,
    /(BS[-\s]?\d{4,})/i,
    /(API[-\s]?\d+(?:[-\s]\w+)?)/i,
    /(DNV[-\s]?\w+[-\s]?\w+)/i,
    /(NORSOK[-\s]?\w+[-\s]?\w+)/i,
  ];
  for(const re of specPatterns){
    const m = name.match(re);
    if(m && el('proc-standard') && !el('proc-standard').value){
      el('proc-standard').value = m[1].replace(/\s+/g,' ').trim();
      break;
    }
  }

  // 5. Title — try to build a readable title from the filename
  if(el('proc-title') && !el('proc-title').value){
    let title = parts;
    // Remove common prefixes/suffixes
    title = title.replace(/\b(?:proc|procedure|wps|ndt|nde|ndtd|rev\s*\d+|r\d+|v\d+)\b/gi, '');
    title = title.replace(/\b\d{4,}\b/g,''); // remove long number sequences
    title = title.replace(/\s+/g,' ').trim();
    if(title.length > 2){
      el('proc-title').value = title.split(' ').filter(w=>w.length>0).map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(' ');
    }
  }
}

// ── Save ─────────────────────────────────────────────────────────────
async function procSave(){
  const procNo = el('proc-no')?.value?.trim()||'';
  const title = el('proc-title')?.value?.trim()||'';
  const revision = el('proc-rev')?.value?.trim()||'';
  const status = el('proc-status')?.value||'Active';
  const method = el('proc-method')?.value||'UT';
  // Specification / Acceptance are free-text inputs on the upload form
  // (no preset dropdown): the inspector types or edits the standard
  // exactly as the procedure document spells it out.
  const standard = el('proc-standard')?.value?.trim()||'';
  const acceptance = el('proc-acceptance')?.value?.trim()||'';
  const reviewDate = el('proc-review')?.value||'';

  if(!procNo){ toast(t('toast.procedure_no_required', 'Procedure number is required'),'error'); return; }

  const all = procGetAll();
  const hasNewFile = _procFileQueue.length > 0;
  const fileName = hasNewFile ? _procFileQueue[0].name : null;
  const fileType = hasNewFile ? _procFileQueue[0].type : null;
  const fileSize = hasNewFile ? _procFileQueue[0].size : null;

  if(_procEditIdx >= 0 && _procEditIdx < all.length){
    const p = all[_procEditIdx];
    if(hasNewFile && p.procNo && p.procNo !== procNo) procDeleteFile(p.procNo);
    Object.assign(p, {procNo, title, revision, status, method, standard, acceptance, reviewDate, updatedAt:new Date().toISOString()});
    if(hasNewFile){
      p.fileName = fileName; p.fileType = fileType; p.fileSize = fileSize; p.hasFile = true;
      if(!procSaveFile(procNo, _procFileQueue[0].dataUrl)){
        toast(t('toast.file_too_large_storage', 'File too large for browser storage — metadata saved without file'),'error');
      }
    }
    procSaveAll(all);
    toast(t('toast.procedure_updated', 'Procedure updated'));
  } else {
    if(all.some(p=>p.procNo===procNo)){
      if(!await vxConfirm({ message: `A procedure named "${procNo}" already exists. Are you sure you want to add it anyway?`, okLabel: t('vxc.add','Add') })) return;
    }
    const proc = {
      procNo, title, revision, status, method, standard, acceptance, reviewDate,
      fileName: fileName||null, fileType: fileType||null, fileSize: fileSize||null,
      hasFile: hasNewFile,
      createdAt: new Date().toISOString(),
      createdBy: CURRENT_USER?.name||'Unknown',
    };
    all.push(proc);
    procSaveAll(all);
    if(hasNewFile){
      if(!procSaveFile(procNo, _procFileQueue[0].dataUrl)){
        toast(t('toast.file_too_large_storage', 'File too large for browser storage — metadata saved without file'),'error');
      }
    }
    toast(t('toast.procedure_saved', 'Procedure saved'));
  }

  procHideUpload();
  procRender();
}

function procEdit(idx){ procShowUpload(idx); }

async function procDelete(idx){
  if(!await vxConfirm({ message: 'Are you sure you want to delete this procedure? This action cannot be undone.', okLabel: t('vxc.delete','Delete'), danger: true })) return;
  const all = procGetAll();
  const p = all[idx];
  if(p && p.procNo) procDeleteFile(p.procNo);
  all.splice(idx, 1);
  procSaveAll(all);
  procRender();
  toast(t('toast.procedure_deleted','Procedure deleted.'));
}

// ── PDF / file viewing ───────────────────────────────────────────────
function procViewFile(idx){
  const all = procGetAll();
  const p = all[idx]; if(!p){ toast(t('toast.procedure_not_found', 'Procedure not found'),'error'); return; }
  const fileData = procLoadFile(p.procNo);
  if(!fileData){ toast(t('toast.no_file_storage_reupload', 'No file in storage — re-upload the procedure document'),'error'); return; }

  _procViewingIdx = idx;

  // Convert data URL → Blob URL (far more reliable in iframes than raw data URLs)
  let blobUrl;
  try {
    const parts = fileData.split(',');
    const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/pdf';
    const raw = atob(parts[1]);
    const arr = new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) arr[i]=raw.charCodeAt(i);
    const blob = new Blob([arr], {type: mime});
    blobUrl = URL.createObjectURL(blob);
  } catch(e) {
    console.warn('Blob conversion failed, using data URL', e);
    blobUrl = fileData;
  }

  // Show inline viewer
  const viewerWrap = el('proc-viewer-wrap');
  const viewerTitle = el('proc-viewer-title');
  const viewerFrame = el('proc-viewer-frame');
  if(!viewerWrap || !viewerFrame) {
    window.open(blobUrl);
    return;
  }

  if(viewerTitle) viewerTitle.textContent = (p.procNo||'') + ' — ' + (p.fileName||'Document');
  viewerFrame.src = blobUrl;
  viewerWrap.style.display = 'block';
  viewerWrap.scrollIntoView({behavior:'smooth', block:'start'});
}

function procCloseViewer(){
  const wrap = el('proc-viewer-wrap');
  const frame = el('proc-viewer-frame');
  // Revoke blob URL to free memory
  if(frame && frame.src && frame.src.startsWith('blob:')) URL.revokeObjectURL(frame.src);
  if(wrap) wrap.style.display = 'none';
  if(frame) frame.src = 'about:blank';
  _procViewingIdx = -1;
}

function procOpenInTab(){
  if(_procViewingIdx < 0) return;
  const all = procGetAll();
  const p = all[_procViewingIdx]; if(!p) return;
  const fileData = procLoadFile(p.procNo);
  if(!fileData){ toast(t('toast.file_unavailable', 'File not available'),'error'); return; }
  try {
    const parts = fileData.split(',');
    const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/pdf';
    const raw = atob(parts[1]);
    const arr = new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) arr[i]=raw.charCodeAt(i);
    const blob = new Blob([arr], {type: mime});
    window.open(URL.createObjectURL(blob));
  } catch(e) {
    window.open(fileData);
  }
}

function procClearFilters(){
  const s = el('proc-search'); if(s) s.value = '';
  const m = el('proc-f-method'); if(m) m.value = '';
  const st = el('proc-f-status'); if(st) st.value = '';
  procRender();
}

function procExportList(){
  const all = procGetAll();
  if(!all.length){ toast(t('toast.no_procedures', 'No procedures to export'),'error'); return; }
  const headers = ['Procedure No.','Title','Revision','Method','Specification','Acceptance Criteria','Status','File'];
  const rows = all.sort((a,b)=>(a.procNo||'').localeCompare(b.procNo||'')).map(p=>[
    p.procNo, p.title, p.revision, p.method, p.standard, p.acceptance, p.status, p.fileName||''
  ].map(v=>'"'+(v||'').replace(/"/g,'""')+'"'));
  const csv = [headers.join(','), ...rows.map(r=>r.join(','))].join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'procedures-'+new Date().toISOString().split('T')[0]+'.csv';
  a.click(); URL.revokeObjectURL(url);
  toast(t('toast.procedures_exported', 'Procedures list exported'));
}

// ── Dispatch registration — see vxActions in js/constants.js.
// Object shorthand keeps each data-action name tied to its function, so a
// rename that misses one is a no-undef error rather than a dead control.
vxActions({
  _defOpenReport, defClearFilters, defDelete, defEdit, defExportCsv,
  defHideForm, defRender, defSave, defShowForm, procClearFilters,
  procClearViewFilters, procCloseViewViewer, procCloseViewer, procDelete,
  procEdit, procExportList, procHideUpload, procOpenInTab, procRender,
  procRenderView, procSave, procShowUpload, procViewFile, procViewFileView,
});
