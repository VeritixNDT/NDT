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
      ? `${j.startDate ? fmtDate(j.startDate) + (j.startTime ? ' ' + escapeHtml(j.startTime) : '') : '—'} → ${j.endDate ? fmtDate(j.endDate) : '—'}`
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
    const isDate = r.kind === 'date-change';
    const urg = (!isDate && r.urgency && r.urgency !== 'Normal')
      ? `<span style="font-size:10px;font-weight:700;color:${r.urgency==='Urgent'?'#dc2626':'#d97706'};border:1px solid currentColor;border-radius:10px;padding:1px 7px;margin-left:6px">${escapeHtml(r.urgency)}</span>` : '';
    const fdate = (d) => (typeof fmtDate === 'function') ? fmtDate(d) : d;
    const title = isDate
      ? ('Date change · ' + escapeHtml(r.jobTitle || 'job') + (r.requestedDate ? ' → ' + escapeHtml(fdate(r.requestedDate)) + (r.requestedTime ? ' ' + escapeHtml(r.requestedTime) : '') : ''))
      : escapeHtml(r.title || '(untitled request)');
    const meta = isDate ? [cust].filter(Boolean).map(escapeHtml).join(' · ') : [r.method, r.site, cust].filter(Boolean).map(escapeHtml).join(' · ');
    const detail = isDate ? (r.reason || '') : (r.scope || '');
    const actions = isDate
      ? `<button class="btn btn-sm btn-primary" data-action="jobApplyDateChange" data-args="'${escapeHtml(r.id)}'" style="font-size:11px">Apply date</button>`
      : `<button class="btn btn-sm btn-primary" data-action="jobFromRequest" data-args="'${escapeHtml(r.id)}'" style="font-size:11px">Create job</button>`;
    return `<div style="display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-top:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px">${title}${urg}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:2px">${meta}${r.by?' · '+escapeHtml(r.by):''}${r.at?' · '+escapeHtml(fdate(r.at)):''}</div>
        ${detail?`<div style="font-size:12px;color:var(--t2);margin-top:4px;white-space:pre-line">${escapeHtml(detail)}</div>`:''}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        ${actions}
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
// Apply a customer's requested date to the job (sets its start date), then mark
// the request handled.
function jobApplyDateChange(reqId){
  const req = (typeof vxPortalRequests === 'function') ? vxPortalRequests().find(r => r.id === reqId) : null;
  if(!req || !req.jobId){ toast('Request not found.', 'error'); return; }
  const jobs = jobLoad();
  const j = jobs.find(x => x.id === req.jobId);
  if(!j){ toast('That job no longer exists.', 'error'); if(typeof vxPortalRequestMarkHandled==='function') vxPortalRequestMarkHandled(reqId, 'dismissed'); jobsRender(); return; }
  if(req.requestedDate) j.startDate = req.requestedDate;
  if(req.requestedTime) j.startTime = req.requestedTime;
  j.updatedAt = new Date().toISOString();
  jobSaveAll(jobs);
  if(typeof vxPortalRequestMarkHandled === 'function') vxPortalRequestMarkHandled(reqId, 'applied');
  toast('Job date updated to ' + ((typeof fmtDate==='function')?fmtDate(req.requestedDate):req.requestedDate) + '.', 'success');
  jobsRender();
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
  if(el('jobf-time')) el('jobf-time').value = rec ? (rec.startTime || '') : '';
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
    startTime:     (el('jobf-time') ? el('jobf-time').value : '').trim() || null,
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
  let custCard;
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
            <div><span style="color:var(--t3);display:inline-block;min-width:90px">Start date</span> ${job.startDate ? fmtDate(job.startDate) + (job.startTime ? ' at ' + escapeHtml(job.startTime) : '') : '—'}</div>
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

    ${typeof _jobTechniqueSheetsHtml === 'function' ? _jobTechniqueSheetsHtml(job) : ''}

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

// ═══════════════════════════════════════════════════════════════════════════
// TECHNIQUE SHEETS (formal NDT technique-sheet artifact, per job/inspection)
// ═══════════════════════════════════════════════════════════════════════════
// A structured, numbered, printable technique sheet: method + procedure ref +
// the execution detail (equipment, technique/parameters, coverage, acceptance,
// personnel). Stored in KEYS.techniques; created/edited from a job's detail page
// and exported via the shared PDF pipeline. Complements the procedures register
// (controlled documents) with the application-level "how this inspection is done".
var TS_STATUSES = ['Draft', 'Approved', 'Superseded'];
function tsLoad(){ return ls(KEYS.techniques, []) || []; }
function tsSaveAll(list){ lss(KEYS.techniques, list); }
function tsForJob(jobId){ return tsLoad().filter(t => t && t.jobId === jobId); }
function _tsNextNumber(){
  const s = ls(KEYS.settings, {}) || {};
  const n = parseInt(s.techniqueNext || '1', 10) || 1;
  return 'TS-' + new Date().getFullYear() + '-' + String(n).padStart(3, '0');
}
function _tsBumpNumber(){
  const s = ls(KEYS.settings, {}) || {};
  s.techniqueNext = (parseInt(s.techniqueNext || '1', 10) || 1) + 1;
  lss(KEYS.settings, s);
}

function _jobTechniqueSheetsHtml(job){
  if(!job) return '';
  const esc = s => escapeHtml(String(s == null ? '' : s));
  const list = tsForJob(job.id).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const statusBadge = s => {
    const cls = s === 'Approved' ? 'green' : s === 'Superseded' ? 'amber' : 'blue';
    return `<span class="badge badge-${cls}" style="font-size:10px">${esc(s || 'Draft')}</span>`;
  };
  const rows = list.map(ts => `<tr>
      <td style="font-family:var(--mono);font-size:12px;font-weight:600">${esc(ts.number || '—')}</td>
      <td>${esc(ts.title || '—')}</td>
      <td><span style="font-family:var(--mono)">${esc(ts.method || '—')}</span></td>
      <td style="font-family:var(--mono);font-size:12px;text-align:center">${esc(ts.revision || '—')}</td>
      <td>${statusBadge(ts.status)}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm" data-action="tsPrint" data-args="'${esc(ts.id)}'" style="font-size:11px;margin-right:4px">PDF</button>
        <button class="btn btn-sm" data-action="tsOpenForm" data-args="'${esc(job.id)}','${esc(ts.id)}'" style="font-size:11px;margin-right:4px">Edit</button>
        <button class="btn btn-sm btn-danger" data-action="tsDelete" data-args="'${esc(ts.id)}'" style="font-size:11px">✕</button>
      </td>
    </tr>`).join('');
  const body = list.length
    ? `<div class="sc-body" style="padding:0"><table class="tbl" style="width:100%">
         <thead><tr><th scope="col" style="width:120px">No.</th><th scope="col">Title</th><th scope="col" style="width:70px">Method</th><th scope="col" style="width:50px">Rev</th><th scope="col" style="width:100px">Status</th><th scope="col" style="width:170px"></th></tr></thead>
         <tbody>${rows}</tbody></table></div>`
    : `<div class="sc-body" style="color:var(--t3);font-size:13px;padding:18px;text-align:center">No technique sheets yet — create one to define how this job's inspection is performed.</div>`;
  return `<div class="sc" style="margin-bottom:14px"><div class="sc-head" style="display:flex;align-items:center;gap:8px">
      <span class="sc-title">Technique sheets</span>
      <span style="font-size:11px;color:var(--t3);font-family:var(--mono)">(${list.length})</span>
      <button class="btn btn-sm btn-primary" data-action="tsOpenForm" data-args="'${esc(job.id)}',null" style="margin-left:auto;font-size:11px">+ New technique sheet</button>
    </div>${body}</div>`;
}

// Self-contained builder modal (independent of the static HTML form).
function tsOpenForm(jobId, id){
  const esc = s => escapeHtml(String(s == null ? '' : s));
  const ts = id ? (tsLoad().find(x => x.id === id) || null) : null;
  const job = jobLoad().find(j => j.id === jobId) || null;
  const methods = (typeof getActiveMethods === 'function') ? getActiveMethods() : (typeof NDT_METHODS !== 'undefined' ? NDT_METHODS : []);
  const procs = (typeof procGetAll === 'function') ? procGetAll() : [];
  const methodOpts = ['<option value="">— method —</option>'].concat(methods.map(m => `<option value="${esc(m.id)}"${ts && ts.method === m.id ? ' selected' : ''}>${esc(m.id)}${m.name ? ' · ' + esc(m.name) : ''}</option>`)).join('');
  const procOpts = ['<option value="">— none —</option>'].concat(procs.map(p => `<option value="${esc(p.procNo)}"${ts && ts.procedureRef === p.procNo ? ' selected' : ''}>${esc(p.procNo)}${p.title ? ' · ' + esc(p.title) : ''}</option>`)).join('');
  const statusOpts = TS_STATUSES.map(s => `<option value="${s}"${(ts ? ts.status : 'Draft') === s ? ' selected' : ''}>${s}</option>`).join('');
  const v = k => esc(ts ? (ts[k] || '') : '');
  const inp = 'width:100%;box-sizing:border-box;margin:3px 0 10px;padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--bg2);color:var(--t1);font-family:inherit';
  const lbl = 'font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.04em';
  const fld = (label, k, ph) => `<label style="${lbl}">${esc(label)}</label><input id="tsf-${k}" value="${v(k)}" placeholder="${esc(ph || '')}" style="${inp}">`;
  const area = (label, k, ph) => `<label style="${lbl}">${esc(label)}</label><textarea id="tsf-${k}" rows="2" placeholder="${esc(ph || '')}" style="${inp};resize:vertical">${v(k)}</textarea>`;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:7000;background:rgba(12,18,32,.55);display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow-y:auto';
  ov.innerHTML = `<div style="background:var(--panel,#fff);color:var(--t1);border-radius:14px;max-width:620px;width:100%;padding:22px;box-shadow:0 12px 40px rgba(0,0,0,.4);font-family:inherit">
    <div style="font-size:16px;font-weight:700;margin-bottom:2px">${ts ? 'Edit technique sheet' : 'New technique sheet'}</div>
    <div style="font-size:12px;color:var(--t3);margin-bottom:14px">${esc(job ? (job.title || '') : '')}</div>
    ${fld('Title', 'title', 'e.g. MT of pipe-to-flange welds, Unit 4')}
    <div style="display:flex;gap:10px">
      <div style="flex:1"><label style="${lbl}">Method</label><select id="tsf-method" style="${inp}">${methodOpts}</select></div>
      <div style="flex:1"><label style="${lbl}">Procedure ref</label><select id="tsf-procedureRef" style="${inp}">${procOpts}</select></div>
      <div style="flex:0 0 90px"><label style="${lbl}">Revision</label><input id="tsf-revision" value="${v('revision') || '0'}" style="${inp}"></div>
    </div>
    <div style="display:flex;gap:10px">
      <div style="flex:1">${fld('Component / item', 'component', 'e.g. Weld W4-12')}</div>
      <div style="flex:1">${fld('Material', 'material', 'e.g. P265GH')}</div>
      <div style="flex:0 0 110px">${fld('Thickness', 'thickness', 'mm')}</div>
    </div>
    <div style="display:flex;gap:10px">
      <div style="flex:1">${fld('Surface condition / stage', 'surfaceCondition', 'e.g. As-welded, post-PWHT')}</div>
      <div style="flex:1">${fld('Personnel (cert level)', 'personnel', 'e.g. Level 2 MT (ISO 9712)')}</div>
    </div>
    ${area('Equipment', 'equipment', 'Yoke / lamp / penetrant kit, serials…')}
    ${area('Technique / parameters', 'technique', 'Magnetisation, current, viewing conditions, dwell/development times…')}
    ${area('Extent / coverage', 'coverage', 'e.g. 100% of accessible weld length + 25 mm each side')}
    <div style="display:flex;gap:10px">
      <div style="flex:1">${fld('Acceptance standard', 'acceptanceStandard', 'e.g. ISO 5817 level B')}</div>
      <div style="flex:1">${fld('Acceptance criteria', 'acceptanceCriteria', 'e.g. No relevant linear indications')}</div>
    </div>
    ${area('Notes', 'notes', '')}
    <div style="display:flex;gap:10px;align-items:center;margin-top:4px">
      <label style="${lbl}">Status</label><select id="tsf-status" style="${inp};max-width:160px;margin:0">${statusOpts}</select>
      <div style="flex:1"></div>
      <button class="btn btn-sm" id="tsf-cancel">Cancel</button>
      <button class="btn btn-sm btn-primary" id="tsf-save">${ts ? 'Save' : 'Create'}</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => { try { ov.remove(); } catch(e){} };
  ov.addEventListener('click', e => { if(e.target === ov) close(); });
  ov.querySelector('#tsf-cancel').addEventListener('click', close);
  ov.querySelector('#tsf-save').addEventListener('click', () => {
    const get = k => { const e = ov.querySelector('#tsf-' + k); return e ? (e.value || '').trim() : ''; };
    if(!get('title')){ const e = ov.querySelector('#tsf-title'); if(e){ e.style.borderColor = '#dc2626'; e.focus(); } return; }
    const now = new Date().toISOString();
    const list = tsLoad();
    if(ts){
      const i = list.findIndex(x => x.id === ts.id);
      if(i >= 0) Object.assign(list[i], _tsCollect(get), { updatedAt: now });
    } else {
      list.push(Object.assign({ id: 'ts-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), jobId: jobId, number: _tsNextNumber(), createdAt: now, updatedAt: now }, _tsCollect(get)));
      _tsBumpNumber();
    }
    tsSaveAll(list);
    if(typeof toast === 'function') toast(ts ? 'Technique sheet saved.' : 'Technique sheet created.', 'success');
    close();
    if(typeof jobOpenDetail === 'function') jobOpenDetail(jobId);
  });
}
function _tsCollect(get){
  return {
    title: get('title'), method: get('method'), procedureRef: get('procedureRef'), revision: get('revision'),
    component: get('component'), material: get('material'), thickness: get('thickness'),
    surfaceCondition: get('surfaceCondition'), personnel: get('personnel'),
    equipment: get('equipment'), technique: get('technique'), coverage: get('coverage'),
    acceptanceStandard: get('acceptanceStandard'), acceptanceCriteria: get('acceptanceCriteria'),
    notes: get('notes'), status: get('status') || 'Draft',
  };
}
function tsDelete(id){
  const ts = tsLoad().find(x => x.id === id);
  const jobId = ts ? ts.jobId : null;
  const doDelete = () => {
    tsSaveAll(tsLoad().filter(x => x.id !== id));
    if(typeof toast === 'function') toast('Technique sheet deleted.', 'success');
    if(jobId && typeof jobOpenDetail === 'function') jobOpenDetail(jobId);
  };
  if(typeof vxConfirm === 'function'){
    vxConfirm({ message: 'Delete technique sheet ' + (ts ? (ts.number || '') : '') + '?', okLabel: 'Delete', danger: true }).then(ok => { if(ok) doDelete(); });
  } else doDelete();
}
function tsPrint(id){
  const ts = tsLoad().find(x => x.id === id);
  if(!ts){ if(typeof toast === 'function') toast('Technique sheet not found.', 'error'); return; }
  const html = _tsBuildHtml(ts);
  if(typeof vxDownloadHtmlAsPdf === 'function') vxDownloadHtmlAsPdf(html, (ts.number || 'technique-sheet'), {});
  else if(typeof _vxPrintHtml === 'function') _vxPrintHtml(html);
}
function _tsBuildHtml(ts){
  const esc = s => escapeHtml(String(s == null ? '' : s));
  const co = (typeof ls === 'function') ? (ls(KEYS.company, {}) || {}) : {};
  const job = jobLoad().find(j => j.id === ts.jobId) || {};
  const cust = (typeof custLoad === 'function' ? custLoad() : []).find(c => c.id === job.customerId) || {};
  const accent = /^#[0-9A-Fa-f]{6}$/.test(co.color || '') ? co.color : '#185FA5';
  const row = (label, val) => val ? `<tr><td style="padding:6px 10px;border:1px solid #d6dbe6;background:#f5f7fb;font-weight:600;width:200px;vertical-align:top">${esc(label)}</td><td style="padding:6px 10px;border:1px solid #d6dbe6;white-space:pre-line">${esc(val)}</td></tr>` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(ts.number)}</title></head>
  <body style="font-family:Arial,Helvetica,sans-serif;color:#1c2333;max-width:800px;margin:0 auto;padding:24px;font-size:13px">
    <div style="display:flex;align-items:center;gap:14px;border-bottom:3px solid ${accent};padding-bottom:12px;margin-bottom:16px">
      ${co.logo ? `<img src="${esc(co.logo)}" style="max-height:50px;max-width:180px;object-fit:contain">` : `<div style="font-size:20px;font-weight:800;color:${accent}">${esc(co.name || '')}</div>`}
      <div style="flex:1"></div>
      <div style="text-align:right"><div style="font-size:18px;font-weight:800;color:${accent}">Technique Sheet</div><div style="font-family:monospace;font-size:13px">${esc(ts.number)}${ts.revision ? (' · Rev ' + esc(ts.revision)) : ''}</div></div>
    </div>
    <h2 style="font-size:16px;margin:0 0 4px">${esc(ts.title || '')}</h2>
    <div style="font-size:12px;color:#6b7589;margin-bottom:14px">${esc(co.name || '')} · ${esc(cust.name || '')}${job.title ? (' · ' + esc(job.title)) : ''} · ${esc(ts.status || 'Draft')}</div>
    <table style="width:100%;border-collapse:collapse;font-size:12.5px">
      ${row('Method', ts.method)}
      ${row('Procedure reference', ts.procedureRef)}
      ${row('Component / item', ts.component)}
      ${row('Material', ts.material)}
      ${row('Thickness', ts.thickness)}
      ${row('Surface condition / stage', ts.surfaceCondition)}
      ${row('Equipment', ts.equipment)}
      ${row('Technique / parameters', ts.technique)}
      ${row('Extent / coverage', ts.coverage)}
      ${row('Acceptance standard', ts.acceptanceStandard)}
      ${row('Acceptance criteria', ts.acceptanceCriteria)}
      ${row('Personnel', ts.personnel)}
      ${row('Notes', ts.notes)}
    </table>
    <div style="margin-top:30px;display:flex;gap:40px;font-size:12px;color:#6b7589">
      <div style="flex:1;border-top:1px solid #1c2333;padding-top:4px">Prepared by</div>
      <div style="flex:1;border-top:1px solid #1c2333;padding-top:4px">Approved by</div>
      <div style="flex:1;border-top:1px solid #1c2333;padding-top:4px">Date</div>
    </div>
    <div style="text-align:center;color:#9aa5bd;font-size:10px;margin-top:24px">${esc(co.footer || co.name || '')}</div>
  </body></html>`;
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
  const _packHtml = vxBuildReportPackHtml(job, cust, sealed);
  // Download as a PDF (server vector → raster → print-dialog fallback).
  if(typeof vxDownloadHtmlAsPdf === 'function') vxDownloadHtmlAsPdf(_packHtml, ((job.title || 'job') + ' report pack'));
  else _vxPrintHtml(_packHtml);
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

// ── Dispatch registration — see vxActions in js/constants.js.
// Object shorthand keeps each data-action name tied to its function, so a
// rename that misses one is a no-undef error rather than a dead control.
vxActions({
  jobApplyDateChange, jobBackToList, jobCloseForm, jobDelete,
  jobDismissRequest, jobDownloadReportPack, jobFromRequest, jobOpenDetail,
  jobOpenForm, jobSave, jobSetStatusFromDetail, jobsRender, tsDelete,
  tsOpenForm, tsPrint,
});
