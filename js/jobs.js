// ══════════════════════════════════════════════════════════════════════════
// JOBS — the work-management layer (Phase 1)
// ══════════════════════════════════════════════════════════════════════════
// A job is a unit of work for a customer ("ACME Pipeline Phase 2"). Reports
// nest under a job via report.jobId, so the journey is:
//   Customer → Job → Reports run under it.
//
// Storage: KEYS.jobs (vx-jobs-v1), the same IDB-backed entity store the
// other registers use — always via ls()/lss(), never raw localStorage.
//
// The Jobs page has two views inside #page-jobs, toggled by show/hide:
//   • #jobs-main-view   — filter bar + create/edit form + list table
//   • #jobs-detail-view — one job: client info, scope, status, child reports
// ══════════════════════════════════════════════════════════════════════════

var _jobEditId = null;          // null when adding, else the job id being edited

function jobLoad()        { return ls(KEYS.jobs, []) || []; }
function jobSaveAll(list) { lss(KEYS.jobs, list); }

var JOB_STATUSES = ['Pending', 'Active', 'Closed'];

// Status → badge colours. Pending = waiting to start, Active = in progress,
// Closed = done.
function _jobStatusMeta(status) {
  switch(status) {
    case 'Active': return { bg:'rgba(62,207,142,.18)',  fg:'var(--green)' };
    case 'Closed': return { bg:'rgba(154,170,191,.18)', fg:'var(--t3)' };
    case 'Pending':
    default:       return { bg:'rgba(245,166,35,.18)',  fg:'var(--amber)' };
  }
}
function _jobStatusBadge(status) {
  const m = _jobStatusMeta(status);
  return `<span style="display:inline-block;font-size:10px;font-weight:600;background:${m.bg};color:${m.fg};padding:2px 9px;border-radius:3px">${escapeHtml(status || 'Pending')}</span>`;
}

// Resolve a customer id to its display name (or a friendly fallback).
function jobCustomerName(customerId) {
  if(!customerId) return '—';
  const list = (typeof custLoad === 'function') ? custLoad() : [];
  const c = list.find(r => r.id === customerId);
  return c ? (c.name || '—') : '(deleted customer)';
}

// Count reports filed against a job.
function _jobReportCount(jobId) {
  if(!jobId) return 0;
  return (ls(KEYS.reports, []) || []).filter(r => r.jobId === jobId).length;
}

// ── Page entry ────────────────────────────────────────────────────────────
function jobsInit() {
  jobBackToList();   // always land on the list, never a stale detail view
}

// ── List ────────────────────────────────────────────────────────────────
function jobsRender() {
  const wrap = el('jobs-list-wrap'); if(!wrap) return;
  const requestsBand = (typeof _jobsRequestsBand === 'function') ? _jobsRequestsBand() : '';
  const all = jobLoad();
  const search = (el('jobs-search')?.value || '').toLowerCase().trim();
  const fStatus = el('jobs-filter-status')?.value || '';

  let list = all.slice();
  if(fStatus) list = list.filter(j => (j.status || 'Pending') === fStatus);
  if(search) {
    list = list.filter(j => {
      const hay = [j.title, jobCustomerName(j.customerId), j.scope, j.leadInspector, j.notes]
        .map(x => (x || '').toString().toLowerCase()).join(' ');
      return hay.includes(search);
    });
  }
  // Active first, then Pending, then Closed; newest within each.
  const order = { Active:0, Pending:1, Closed:2 };
  list.sort((a,b) => {
    const oa = order[a.status] ?? 1, ob = order[b.status] ?? 1;
    if(oa !== ob) return oa - ob;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  const sub = el('jobs-sub');
  if(sub) {
    const n = all.length;
    const shown = list.length;
    sub.textContent = (shown === n)
      ? `${n} job${n === 1 ? '' : 's'}`
      : `${shown} of ${n} job${n === 1 ? '' : 's'}`;
  }

  if(!all.length) {
    // Chain the empty state to the prerequisite: a job needs a customer, so
    // with none yet, point straight at adding one (top-nav Customers) rather
    // than at "+ New job" (which would dead-end on an empty customer picker).
    const noCust = (typeof custLoad === 'function' && !custLoad().length);
    const body = noCust
      ? `<div style="color:var(--t3);font-size:13px;margin-bottom:14px">${escapeHtml(t('jobs.empty.needcust','A job belongs to a customer. Add your first customer to get started.'))}</div><button class="btn btn-primary btn-sm" data-action="ovOpenCustomers">+ ${escapeHtml(t('gs.cta1','Add customer'))}</button>`
      : `<div style="color:var(--t3);font-size:13px;margin-bottom:14px">${escapeHtml(t('jobs.empty.nojobs','No jobs yet — create your first one.'))}</div><button class="btn btn-primary btn-sm" data-action="jobOpenForm" data-args="null">+ ${escapeHtml(t('gs.cta2','New job'))}</button>`;
    wrap.innerHTML = requestsBand + `<div class="sc"><div class="sc-body" style="text-align:center;padding:34px 20px">${body}</div></div>`;
    return;
  }
  if(!list.length) {
    wrap.innerHTML = requestsBand + `<div class="sc"><div class="sc-body" style="text-align:center;color:var(--t3);font-size:13px;padding:30px">No jobs match your filters.</div></div>`;
    return;
  }

  const row = (j) => {
    const reports = _jobReportCount(j.id);
    // Sealed (Approved/Sent) report count — gates the inline pack shortcut so it
    // only appears when there is something to deliver. Same source of truth as
    // the detail-view button and the builder, so the number never overstates.
    const sealed = (typeof jobSealedReports === 'function') ? jobSealedReports(j.id).length : 0;
    const dates = (j.startDate || j.endDate)
      ? `${j.startDate ? fmtDate(j.startDate) : '—'} → ${j.endDate ? fmtDate(j.endDate) : '—'}`
      : '—';
    return `<tr style="cursor:pointer" data-action="jobOpenDetail" data-args="'${escapeHtml(j.id)}'">
      <td style="font-weight:600">${escapeHtml(j.title || '—')}</td>
      <td>${escapeHtml(jobCustomerName(j.customerId))}</td>
      <td>${_jobStatusBadge(j.status)}</td>
      <td style="font-family:var(--mono);font-size:11px">${dates}</td>
      <td style="font-family:var(--mono);font-size:12px;text-align:center">${reports || '—'}</td>
      <td style="text-align:right">
        ${sealed ? `<button class="btn btn-sm" data-action="jobDownloadReportPack" data-args="'${escapeHtml(j.id)}'" style="font-size:11px" title="Download the consolidated report pack">⬇ Pack (${sealed})</button>` : ''}
        <button class="btn btn-sm" data-action="jobOpenForm" data-args="'${escapeHtml(j.id)}'" style="font-size:11px">Edit</button>
        <button class="btn btn-sm btn-danger" data-action="jobDelete" data-args="'${escapeHtml(j.id)}'" style="font-size:11px">Del</button>
      </td>
    </tr>`;
  };
  wrap.innerHTML = requestsBand + `<div class="sc"><div class="sc-body" style="padding:0"><table class="tbl" style="width:100%">
    <thead><tr>
      <th scope="col">Job</th><th scope="col">Customer</th><th scope="col" style="width:90px">Status</th>
      <th scope="col" style="width:180px">Dates</th><th scope="col" style="width:80px">Reports</th>
      <th scope="col" style="width:210px"></th>
    </tr></thead><tbody>${list.map(row).join('')}</tbody>
  </table></div></div>`;
}

// ── Customer work requests (Portal v2, Pillar B) ──────────────────────────────
// Pending portal requests (filed by the ingest / preview applier) shown atop the
// Jobs page, each turnable into a job or dismissed.
function _jobsRequestsBand(){
  const reqs = (typeof vxPortalPendingRequests === 'function') ? vxPortalPendingRequests() : [];
  if(!reqs.length) return '';
  const rows = reqs.map(r => {
    const cust = (typeof jobCustomerName === 'function') ? jobCustomerName(r.customerId) : '';
    const urg = (r.urgency && r.urgency !== 'Normal')
      ? `<span style="font-size:10px;font-weight:700;color:${r.urgency==='Urgent'?'#dc2626':'#d97706'};border:1px solid currentColor;border-radius:10px;padding:1px 7px;margin-left:6px">${escapeHtml(r.urgency)}</span>` : '';
    const meta = [r.method, r.site, cust].filter(Boolean).map(escapeHtml).join(' · ');
    return `<div style="display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-top:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px">${escapeHtml(r.title||'(untitled request)')}${urg}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:2px">${meta}${r.by?' · '+escapeHtml(r.by):''}${r.at?' · '+((typeof fmtDate==='function')?fmtDate(r.at):escapeHtml(r.at)):''}</div>
        ${r.scope?`<div style="font-size:12px;color:var(--t2);margin-top:4px;white-space:pre-line">${escapeHtml(r.scope)}</div>`:''}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn btn-sm btn-primary" data-action="jobFromRequest" data-args="'${escapeHtml(r.id)}'" style="font-size:11px">Create job</button>
        <button class="btn btn-sm" data-action="jobDismissRequest" data-args="'${escapeHtml(r.id)}'" style="font-size:11px">Dismiss</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="sc" style="margin-bottom:14px">
    <div class="sc-head" style="display:flex;align-items:center;gap:8px"><span class="sc-title">📥 Customer requests</span><span style="font-size:11px;color:var(--t3);font-family:var(--mono)">(${reqs.length})</span></div>
    <div class="sc-body" style="padding:2px 16px 12px">${rows}</div>
  </div>`;
}

// Pre-fill the New-job form from a customer request, then mark it handled.
function jobFromRequest(reqId){
  const req = (typeof vxPortalRequests === 'function') ? vxPortalRequests().find(r => r.id === reqId) : null;
  if(!req){ toast('Request not found.', 'error'); return; }
  jobOpenForm(null);
  if(el('jobf-title'))    el('jobf-title').value = req.title || '';
  if(el('jobf-customer')) el('jobf-customer').value = req.customerId || '';
  if(el('jobf-scope'))    el('jobf-scope').value = [req.scope, req.method ? 'Requested method: ' + req.method : '', req.site ? 'Site: ' + req.site : '', (req.urgency && req.urgency !== 'Normal') ? 'Urgency: ' + req.urgency : '', req.by ? 'Requested by: ' + req.by : ''].filter(Boolean).join('\n');
  if(typeof vxPortalRequestMarkHandled === 'function') vxPortalRequestMarkHandled(reqId, 'job');
  toast('Job pre-filled from the request — review and save.', 'info');
}
async function jobDismissRequest(reqId){
  if(typeof vxConfirm === 'function'){ if(!await vxConfirm({ message: 'Dismiss this customer request?', okLabel: 'Dismiss' })) return; }
  if(typeof vxPortalRequestMarkHandled === 'function') vxPortalRequestMarkHandled(reqId, 'dismissed');
  jobsRender();
}

// ── Create / edit form ────────────────────────────────────────────────────
function jobOpenForm(id) {
  _jobEditId = id || null;
  // Editing from the detail view? Return to the list so the form is visible.
  jobBackToList();
  const wrap = el('jobs-form-wrap'); if(!wrap) return;
  const title = el('job-form-title'); if(title) title.textContent = id ? 'Edit job' : 'New job';
  const rec = id ? jobLoad().find(j => j.id === id) : null;

  // Populate the customer picker fresh each open.
  const sel = el('jobf-customer');
  if(sel) {
    const customers = (typeof custLoad === 'function' ? custLoad() : [])
      .slice().sort((a,b) => (a.name||'').localeCompare(b.name||''));
    let opts = '<option value="">'+(customers.length ? '— Select customer —' : t('jobs.form.nocust','— No customers yet — add one first —'))+'</option>'
      + customers.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name||'(unnamed)')}</option>`).join('');
    // Preserve a since-deleted customer reference so editing doesn't silently
    // drop it.
    if(rec && rec.customerId && !customers.some(c => c.id === rec.customerId)) {
      opts += `<option value="${escapeHtml(rec.customerId)}">(deleted customer)</option>`;
    }
    sel.innerHTML = opts;
    sel.value = rec ? (rec.customerId || '') : '';
  }

  el('jobf-title').value  = rec ? (rec.title || '')         : '';
  el('jobf-status').value = rec ? (rec.status || 'Pending') : 'Pending';
  el('jobf-lead').value   = rec ? (rec.leadInspector || '') : '';
  el('jobf-start').value  = rec ? (rec.startDate || '')     : '';
  el('jobf-end').value    = rec ? (rec.endDate || '')       : '';
  el('jobf-scope').value  = rec ? (rec.scope || '')         : '';
  el('jobf-notes').value  = rec ? (rec.notes || '')         : '';

  wrap.style.display = '';
  el('jobf-title').focus();
}

function jobCloseForm() {
  _jobEditId = null;
  const wrap = el('jobs-form-wrap'); if(wrap) wrap.style.display = 'none';
}

function jobSave() {
  const title = (el('jobf-title').value || '').trim();
  if(!title) { toast('Job needs a title.', 'error'); el('jobf-title').focus(); return; }
  const customerId = el('jobf-customer') ? el('jobf-customer').value : '';
  if(!customerId) { toast('Pick a customer for this job.', 'error'); if(el('jobf-customer')) el('jobf-customer').focus(); return; }
  const status = el('jobf-status') ? el('jobf-status').value : 'Pending';
  const now = new Date().toISOString();
  const rec = {
    id: _jobEditId || ('job-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7)),
    customerId,
    title,
    status: JOB_STATUSES.includes(status) ? status : 'Pending',
    leadInspector: (el('jobf-lead').value  || '').trim(),
    startDate:     (el('jobf-start').value || '').trim() || null,
    endDate:       (el('jobf-end').value   || '').trim() || null,
    scope:         (el('jobf-scope').value || '').trim(),
    notes:         (el('jobf-notes').value || '').trim(),
    updatedAt:     now,
  };
  const list = jobLoad();
  const i = list.findIndex(j => j.id === rec.id);
  if(i >= 0) list[i] = { ...list[i], ...rec };
  else       { rec.createdAt = now; list.push(rec); }
  jobSaveAll(list);
  toast(_jobEditId ? 'Job updated.' : 'Job created.');
  jobCloseForm();
  jobsRender();
}

async function jobDelete(id) {
  const rec = jobLoad().find(j => j.id === id);
  const reports = _jobReportCount(id);
  const label = rec && rec.title ? '"' + escapeHtml(rec.title) + '"' : 'this job';
  const warn = reports
    ? ` ${reports} report${reports === 1 ? '' : 's'} filed against it will become unassigned (the reports are kept).`
    : '';
  if(!await vxConfirm({ message: 'Delete ' + label + '?' + warn, okLabel: 'Delete', danger: true })) return;
  // Detach child reports so they don't carry a dead jobId.
  if(reports) {
    const all = ls(KEYS.reports, []);
    let changed = false;
    all.forEach(r => { if(r.jobId === id) { delete r.jobId; delete r.jobTitle; changed = true; } });
    if(changed) lss(KEYS.reports, all);
  }
  jobSaveAll(jobLoad().filter(j => j.id !== id));
  toast('Job deleted.');
  jobBackToList();
  jobsRender();
}

// ── Detail view ────────────────────────────────────────────────────────────
function jobOpenDetail(id) {
  const job = jobLoad().find(j => j.id === id);
  const view = el('jobs-detail-view');
  const main = el('jobs-main-view');
  if(!job || !view || !main) return;

  const cust = (typeof custLoad === 'function' ? custLoad() : []).find(c => c.id === job.customerId);

  // Child reports — preserve each report's index for the open/PDF actions.
  const allReports = ls(KEYS.reports, []) || [];
  const children = [];
  allReports.forEach((r, idx) => { if(r.jobId === id) children.push({ r, idx }); });

  // Count exactly what the report pack would include (sealed, latest revision,
  // non-internal) so the button's number never overstates the pack.
  const sealedCount = (typeof jobSealedReports === 'function') ? jobSealedReports(id).length : 0;

  // Customer card
  let custCard = '';
  if(cust) {
    const primary = (cust.contacts || [])[0];
    const contactLine = primary
      ? `${escapeHtml(primary.name || '')}${primary.role ? ' · ' + escapeHtml(primary.role) : ''}${primary.email ? ' · ' + escapeHtml(primary.email) : ''}${primary.phone ? ' · ' + escapeHtml(primary.phone) : ''}`
      : '<span style="color:var(--t3)">No contact on file</span>';
    custCard = `<div class="sc" style="margin-bottom:14px"><div class="sc-head"><span class="sc-title">Customer</span></div>
      <div class="sc-body">
        <div style="font-weight:600;font-size:14px;margin-bottom:4px">${escapeHtml(cust.name || '—')}</div>
        ${cust.vatNo ? `<div style="font-size:12px;color:var(--t3);font-family:var(--mono);margin-bottom:6px">${escapeHtml(cust.vatNo)}</div>` : ''}
        ${cust.billingAddress ? `<div style="font-size:12px;color:var(--t2);white-space:pre-line;margin-bottom:6px">${escapeHtml(cust.billingAddress)}</div>` : ''}
        <div style="font-size:12px;color:var(--t2)">${contactLine}</div>
      </div></div>`;
  } else {
    custCard = `<div class="sc" style="margin-bottom:14px"><div class="sc-body" style="color:var(--t3);font-size:13px">Customer not found (it may have been deleted).</div></div>`;
  }

  // Status quick-switch
  const statusOpts = JOB_STATUSES.map(s => `<option value="${s}"${(job.status||'Pending')===s?' selected':''}>${s}</option>`).join('');

  // Child reports table
  let reportsBlock;
  if(children.length) {
    const verdictBadge = (v) => {
      const cls = v === 'Acceptable' ? 'green' : v === 'Not acceptable' ? 'red' : v === 'Various' ? 'amber' : 'blue';
      return `<span class="badge badge-${cls}" style="font-size:10px">${escapeHtml(v || 'Draft')}</span>`;
    };
    const rows = children.map(({ r, idx }) => {
      const md = NDT_METHODS.find(x => x.id === r.method);
      return `<tr>
        <td><span style="font-family:var(--mono);font-weight:600;color:${md?md.color:'var(--t2)'}">${escapeHtml(r.method||'—')}</span></td>
        <td style="font-family:var(--mono);font-size:12px">${escapeHtml(r.reportNo||'—')}</td>
        <td style="font-family:var(--mono);font-size:12px">${escapeHtml(r.revision||'00')}</td>
        <td style="font-family:var(--mono);font-size:11px">${r.createdAt ? fmtDate(r.createdAt) : '—'}</td>
        <td>${verdictBadge(r.verdict)}</td>
        <td style="text-align:right">
          <button class="btn btn-sm" data-action="ovPrintReport" data-args="${idx}" style="font-size:11px;margin-right:4px">PDF</button>
          <button class="btn btn-sm" data-action="ovViewReport" data-args="${idx}" style="font-size:11px">Open</button>
        </td>
      </tr>`;
    }).join('');
    reportsBlock = `<div class="sc-body" style="padding:0"><table class="tbl" style="width:100%">
      <thead><tr><th scope="col" style="width:60px">Method</th><th scope="col">Report no.</th><th scope="col" style="width:50px">Rev</th><th scope="col" style="width:110px">Date</th><th scope="col" style="width:120px">Verdict</th><th scope="col" style="width:140px"></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  } else {
    reportsBlock = `<div class="sc-body" style="color:var(--t3);font-size:13px;padding:20px;text-align:center">No reports filed under this job yet. New reports can be filed against it from the report form's Job picker.</div>`;
  }

  view.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:16px">
      <button class="btn btn-sm" data-action="jobBackToList" style="flex:0 0 auto">← Back</button>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span class="sh-title" style="font-size:20px">${escapeHtml(job.title || '—')}</span>
          ${_jobStatusBadge(job.status)}
        </div>
        <div class="sh-desc" style="margin-top:2px">${escapeHtml(jobCustomerName(job.customerId))}</div>
      </div>
      <div style="display:flex;gap:6px;flex:0 0 auto">
        <button class="btn btn-sm" data-action="jobOpenForm" data-args="'${escapeHtml(job.id)}'">Edit</button>
        <button class="btn btn-sm btn-danger" data-action="jobDelete" data-args="'${escapeHtml(job.id)}'">Delete</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start">
      <div>
        ${custCard}
      </div>
      <div>
        <div class="sc" style="margin-bottom:14px"><div class="sc-head"><span class="sc-title">Job details</span></div>
          <div class="sc-body" style="font-size:13px;line-height:1.7">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <span style="color:var(--t3);min-width:90px">Status</span>
              <select data-on-change="jobSetStatusFromDetail" data-pass-value="1" data-args="'${escapeHtml(job.id)}'" style="font-size:12px;padding:3px 6px">${statusOpts}</select>
            </div>
            <div><span style="color:var(--t3);display:inline-block;min-width:90px">Lead inspector</span> ${escapeHtml(job.leadInspector || '—')}</div>
            <div><span style="color:var(--t3);display:inline-block;min-width:90px">Start date</span> ${job.startDate ? fmtDate(job.startDate) : '—'}</div>
            <div><span style="color:var(--t3);display:inline-block;min-width:90px">End date</span> ${job.endDate ? fmtDate(job.endDate) : '—'}</div>
          </div>
        </div>
      </div>
    </div>

    ${job.scope ? `<div class="sc" style="margin-bottom:14px"><div class="sc-head"><span class="sc-title">Scope of work</span></div><div class="sc-body" style="font-size:13px;color:var(--t2);white-space:pre-line">${escapeHtml(job.scope)}</div></div>` : ''}
    ${job.notes ? `<div class="sc" style="margin-bottom:14px"><div class="sc-head"><span class="sc-title">Notes</span></div><div class="sc-body" style="font-size:13px;color:var(--t2);white-space:pre-line">${escapeHtml(job.notes)}</div></div>` : ''}

    <div class="sc" style="margin-bottom:14px"><div class="sc-head" style="display:flex;align-items:center;gap:8px">
      <span class="sc-title">Reports</span>
      <span style="font-size:11px;color:var(--t3);font-family:var(--mono)">(${children.length})</span>
      <button class="btn btn-sm" data-action="jobDownloadReportPack" data-args="'${escapeHtml(job.id)}'" style="margin-left:auto;font-size:11px"${sealedCount ? '' : ' disabled title="No approved reports to include yet"'}>⬇ Report pack${sealedCount ? ` (${sealedCount})` : ''}</button>
    </div>${reportsBlock}</div>

    ${typeof billJobSectionsHtml === 'function' ? billJobSectionsHtml(job) : ''}
  `;

  main.style.display = 'none';
  view.style.display = '';
  view.scrollTop = 0;
}

// The sealed (Approved/Sent, latest-revision, non-internal) reports under a
// job — the exact set the consolidated report pack includes. Shared by the
// detail view's button count and the pack builder so they never diverge.
function jobSealedReports(jobId) {
  let list = (ls(KEYS.reports, []) || []).filter(r => r.jobId === jobId && !r.internalNoCustomer);
  if(typeof rptLatestRevisions === 'function') list = rptLatestRevisions(list);
  return list.filter(r => {
    const st = (typeof getReportStage === 'function') ? getReportStage(r) : r.stage;
    return (st === 'Approved' || st === 'Sent') && (r.sealedHtml || r.frozenHtml);
  });
}

// Build + print a consolidated client report pack for one job: a branded
// cover page (job + customer + pass/fail tally + summary table) followed by
// every sealed report under the job. Prints via the shared PDF pipeline.
function jobDownloadReportPack(jobId) {
  const job = jobLoad().find(j => j.id === jobId);
  if(!job){ toast(t('toast.job_not_found','Job not found.'), 'error'); return; }
  const cust = (typeof custLoad === 'function' ? custLoad() : []).find(c => c.id === job.customerId) || null;
  const sealed = jobSealedReports(jobId);
  if(!sealed.length){ toast(t('toast.no_sealed_reports','No approved reports to include in the pack yet.'), 'warn'); return; }
  // Stable order: group by method, then report number.
  sealed.sort((a, b) => (a.method || '').localeCompare(b.method || '') || (a.reportNo || '').localeCompare(b.reportNo || ''));
  if(typeof vxBuildReportPackHtml !== 'function' || typeof _vxPrintHtml !== 'function'){
    toast(t('toast.pack_unavailable','Report pack export is unavailable.'), 'error'); return;
  }
  _vxPrintHtml(vxBuildReportPackHtml(job, cust, sealed));
}

// Inline status change from the detail view's dropdown. The dispatcher
// passes data-args first then the element's value (data-pass-value), so the
// arg order is (id, value).
function jobSetStatusFromDetail(id, value) {
  const list = jobLoad();
  const i = list.findIndex(j => j.id === id);
  if(i < 0) return;
  list[i].status = JOB_STATUSES.includes(value) ? value : list[i].status;
  list[i].updatedAt = new Date().toISOString();
  jobSaveAll(list);
  toast('Status updated.');
  jobOpenDetail(id);   // re-render so the header badge updates too
}

function jobBackToList() {
  const view = el('jobs-detail-view');
  const main = el('jobs-main-view');
  if(view) view.style.display = 'none';
  if(main) main.style.display = 'flex';
  jobsRender();
}
