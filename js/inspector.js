// ══════════════════════════════════════════════════════════════════════════
// INSPECTOR WORKSPACE — a role-focused home that gathers the things an
// inspector does behind one persistent left side menu: make a new report,
// view their own planner, their own reports, the defect register, the NDT
// procedures, and their inbox. It does NOT re-implement those views — each
// section reuses the existing renderer pointed at an `insp-` prefixed host
// (see the hostId/scope params added to inboxRender, procInitView, plRender,
// and ovNewReport). Page markup lives in page-inspector; showPage('inspector')
// calls inspInit().
//
// Per-inspector scope: Reports and Planner are filtered to the logged-in
// inspector, matched by display name exactly as the inbox does
// (r.inspector === me.name || r.createdBy === me.id). Defects and procedures
// show the full register; the inbox is already personal.
// ══════════════════════════════════════════════════════════════════════════

// Default landing = Inbox ("what needs your attention"). Note we deliberately
// do NOT land on New report: building that form runs the non-admin
// certification check, which would pop a modal on every workspace open. New
// report stays the first side-menu item and builds on click instead.
var _inspCurrentSection = 'inbox';

// Entry point (showPage('inspector')). Re-renders whichever section was last
// open so returning to the workspace lands where the inspector left off.
function inspInit(){
  const sec = _inspCurrentSection || 'inbox';
  inspShowSection(sec, el('inspi-' + sec));
}

// Side-menu switcher — mirrors ovShowSection but scoped to #page-inspector so
// it never touches the Overview/Settings sidebars. Toggles the .ss panel and
// the active snav-item, then renders the section's content.
function inspShowSection(id, btn){
  document.querySelectorAll('#page-inspector .ss').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('#insp-snav .snav-item').forEach(b => b.classList.remove('active'));
  const sec = el('insp-' + id); if(sec) sec.classList.add('active');
  if(btn) btn.classList.add('active');
  else { const b = el('inspi-' + id); if(b) b.classList.add('active'); }
  _inspCurrentSection = id;
  if(id === 'newreport')  inspRenderNewReport();
  if(id === 'planner')    inspRenderPlanner();
  if(id === 'reports')    inspRenderReports();
  if(id === 'defects')    inspRenderDefects();
  if(id === 'procedures') inspRenderProcedures();
  if(id === 'inbox')      inspRenderInbox();
  if(typeof a11yWireLabels === 'function') a11yWireLabels(sec || document);
}

// Helper — the current inspector (or null in preview/no-session).
function _inspMe(){ return (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) ? CURRENT_USER : null; }
// A report belongs to me if I authored it (createdBy) or my name is on it.
function _inspOwnsReport(r, me){
  if(!me) return false;
  return (r.createdBy && r.createdBy === me.id) || (r.inspector && r.inspector === me.name);
}

// ── New report ───────────────────────────────────────────────────────────
// Reuse the Overview new-report flow, hosted in the inspector page (pfx 'insp').
// Skip re-popping the method picker if a form is already built in this host.
function inspRenderNewReport(){
  const body = el('insp-nr-body');
  if(body && body.childElementCount > 0) return;   // keep the in-progress form
  if(typeof ovNewReportPicker === 'function') ovNewReportPicker('insp');
}

// ── Planner (the inspector's own events) ───────────────────────────────────
function inspRenderPlanner(){
  if(typeof _plInjectStyles === 'function') _plInjectStyles();   // safe to call repeatedly; ensures planner CSS even if the top-nav planner was never opened
  // Scope plCollect to me and point plRender (+ its nav/view buttons) at the
  // inspector host. plInit resets both when the top-nav planner is opened.
  if(typeof _plScopeInspector !== 'undefined') _plScopeInspector = true;
  if(typeof _plRootId !== 'undefined') _plRootId = 'insp-planner-root';
  if(typeof _plInstallDrag === 'function') _plInstallDrag();   // no-op if already installed; drag stays read-only off #page-planner
  if(typeof plRender === 'function') plRender();
}

// ── Reports (the inspector's own reports) ──────────────────────────────────
function inspRenderReports(){
  const wrap = el('insp-reports-table'); if(!wrap) return;
  const me = _inspMe();
  const all = ls(KEYS.reports, []) || [];
  // Keep each report's index into KEYS.reports — the row actions
  // (ovViewReport / ovPrintReport / ovOpenReport) address reports by index.
  const mine = all.map((r, idx) => ({ r, idx })).filter(({ r }) => _inspOwnsReport(r, me));
  if(!mine.length){
    wrap.innerHTML = `<div style="text-align:center;color:var(--t3);font-size:13px;padding:24px">${escapeHtml(me ? 'You have no reports yet — start one from “New report”.' : 'Sign in to see your reports.')}</div>`;
    return;
  }
  let html = `<table class="tbl" style="width:100%"><thead><tr>
    <th scope="col" style="width:40px">Method</th><th scope="col">Report no.</th><th scope="col">Rev</th><th scope="col">Client</th><th scope="col">Date</th><th scope="col">Verdict</th><th scope="col" style="width:150px"></th>
  </tr></thead><tbody>`;
  mine.slice().reverse().forEach(({ r, idx }) => {
    const md = NDT_METHODS.find(x => x.id === r.method);
    html += `<tr>
      <td><span style="font-family:var(--mono);font-weight:600;color:${md?.color||'var(--t2)'}">${r.method||'—'}</span></td>
      <td style="font-family:var(--mono);font-size:12px">${escapeHtml(r.reportNo||'—')}</td>
      <td style="font-family:var(--mono);font-size:12px">${escapeHtml(r.revision||'00')}</td>
      <td>${escapeHtml(r.client||'—')}</td>
      <td style="font-family:var(--mono);font-size:11px">${fmtDate(r.createdAt)}</td>
      <td><span class="badge badge-${r.verdict==='Acceptable'?'green':r.verdict==='Not acceptable'?'red':r.verdict==='Various'?'amber':'blue'}" style="font-size:10px">${escapeHtml(r.verdict||'Draft')}</span></td>
      <td style="white-space:nowrap"><button class="btn btn-sm" data-action="ovPrintReport" data-args="${idx}" style="margin-right:4px">PDF</button><button class="btn btn-sm" data-action="ovViewReport" data-args="${idx}" style="margin-right:4px">Open</button><button class="btn btn-sm" data-action="ovOpenReport" data-args="${idx}">Revise</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ── Defects register (read-only, all reports) ──────────────────────────────
// Renders the combined defect log (standalone + report-derived) reusing
// _defCombined()/_defOpenReport. Read-only: report-derived rows offer "Open
// report"; standalone rows are listed without edit/delete (the Defects page /
// report form remain the source of truth for editing).
function inspRenderDefects(){
  const host = el('insp-def-host'); if(!host) return;
  const list = (typeof _defCombined === 'function') ? _defCombined() : [];
  if(!list.length){
    host.innerHTML = `<div class="sc"><div class="sc-body"><div style="text-align:center;color:var(--t3);font-size:13px;padding:24px">No defects recorded yet.</div></div></div>`;
    return;
  }
  const rows = list.slice().reverse().map(d => {
    const fromReport = d._source === 'report';
    const sevColor = {Critical:'red',High:'amber',Medium:'blue',Low:'green'}[d.severity]||'muted';
    const statusColor = {Open:'red','In Progress':'amber',Repaired:'blue',Verified:'green',Closed:'muted'}[d.status]||'muted';
    const md = NDT_METHODS.find(m => m.id === d.method);
    const sevTxt = d.severity ? (typeof tSeverity === 'function' ? tSeverity(d.severity) : d.severity) : '—';
    const statusTxt = d.status ? (typeof tStatus === 'function' ? tStatus(d.status) : d.status) : '—';
    const action = fromReport
      ? `<button class="btn btn-sm" data-action="_defOpenReport" data-args="${d._reportIdx}" title="Open the linked report" style="font-size:10px;padding:3px 8px">Open report</button>`
      : '<span style="color:var(--t3);font-size:11px">—</span>';
    return `<tr>
      <td style="font-family:var(--mono);font-size:11px;color:var(--t2)">${escapeHtml(d.defectId||'—')}</td>
      <td>${escapeHtml(d.type||'—')}</td>
      <td><span class="badge badge-${sevColor}" style="font-size:10px">${escapeHtml(sevTxt)}</span></td>
      <td><span class="badge badge-${statusColor}" style="font-size:10px">${escapeHtml(statusTxt)}</span></td>
      <td><span style="font-family:var(--mono);font-weight:600;color:${md?.color||'var(--t2)'}">${escapeHtml(d.method||'—')}</span></td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(d.location||'')}">${escapeHtml(d.location||'—')}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(d.component||'—')}</td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--t2)">${escapeHtml(d.report||'—')}</td>
      <td style="font-family:var(--mono);font-size:11px;white-space:nowrap">${fmtDate(d.createdAt)}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');
  host.innerHTML = `<div class="sc"><div class="sc-body np" style="overflow-x:auto">
    <table class="tbl" style="width:100%;font-size:12px"><thead><tr>
      <th scope="col">ID</th><th scope="col">Type</th><th scope="col">Severity</th><th scope="col">Status</th><th scope="col">Method</th><th scope="col">Location</th><th scope="col">Component</th><th scope="col">Report</th><th scope="col">Date</th><th scope="col" style="width:96px">Actions</th>
    </tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// ── NDT procedures (read-only) ─────────────────────────────────────────────
// Inject the filter + metrics + viewer + table markup once (insp-proc- ids),
// then drive it with the shared procInitView/procRenderView via the host prefix.
function inspRenderProcedures(){
  const host = el('insp-proc-host'); if(!host) return;
  if(host.dataset.built !== '1'){
    host.innerHTML = `
      <div class="sh-actions" style="margin-bottom:12px"><button class="btn btn-sm" data-action="procExportList">⬇ Export list</button></div>
      <div class="stat-row" id="insp-proc-metrics" style="margin-bottom:16px"></div>
      <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:16px">
        <div class="fld" style="flex:1;gap:3px"><label>Search</label><input id="insp-proc-search" placeholder="Search procedure no., title, method…" data-on-input="procRenderView" style="font-size:13px"/></div>
        <div class="fld" style="flex:0 0 140px;gap:3px"><label>Method</label>
          <select id="insp-proc-f-method" data-on-change="procRenderView" style="font-size:13px"><option value="">All methods</option></select>
        </div>
        <div class="fld" style="flex:0 0 140px;gap:3px"><label>Status</label>
          <select id="insp-proc-f-status" data-on-change="procRenderView" style="font-size:13px">
            <option value="">All</option><option>Active</option><option>Draft</option><option>Superseded</option><option>Withdrawn</option>
          </select>
        </div>
        <button class="btn btn-sm" data-action="procClearViewFilters" style="padding:8px 12px;font-size:12px;margin-bottom:1px">Clear</button>
      </div>
      <div id="insp-proc-viewer-wrap" style="display:none;margin-bottom:18px">
        <div class="sc">
          <div class="sc-head" style="display:flex;align-items:center;justify-content:space-between">
            <span class="sc-title" id="insp-proc-viewer-title">Viewing procedure</span>
            <div style="display:flex;gap:6px">
              <button class="btn btn-sm" data-action="procOpenInTab" style="font-size:11px">⤴ Open in new tab</button>
              <button class="btn btn-sm" data-action="procCloseViewViewer" style="font-size:11px">✕ Close</button>
            </div>
          </div>
          <div class="sc-body" style="padding:0">
            <iframe id="insp-proc-viewer-frame" style="width:100%;height:75vh;border:none;background:#525659"></iframe>
          </div>
        </div>
      </div>
      <div id="insp-proc-table-wrap"></div>`;
    host.dataset.built = '1';
  }
  if(typeof procInitView === 'function') procInitView('insp-proc');
}

// ── Inbox (the current user's inbox) ───────────────────────────────────────
function inspRenderInbox(){
  if(typeof inboxRender === 'function') inboxRender('insp-inbox');
}
