// ══════════════════════════════════════════════════════════════════════════
// CUSTOMER PORTAL (Phase 4)
// ══════════════════════════════════════════════════════════════════════════
// A read-only, white-labelled view a customer reaches via a magic link
// (#/portal/<token>). The customer is NOT a Supabase auth user — the signed
// token IS the credential. The portal shows that customer's jobs, their
// approved/sent (sealed) reports, and their quotes/invoices, all downloadable.
//
// Data sources:
//   • Real token → portal-data Edge Function (validates the HMAC token
//     server-side and returns the customer's data from the org store).
//   • local-<customerId> token → reads localStorage directly. This is the
//     trial/preview + verification path; it only works on the device that
//     holds the data (the inspector's own browser).
//
// The portal renders into a full-screen #vx-portal-root and never shows the
// app shell or login. It's intercepted at boot before normal app init.
// ══════════════════════════════════════════════════════════════════════════

var _vxPortalData = null;   // the fetched portal payload, kept for downloads

function vxPortalActive(){
  const h = (location.hash || '').replace(/^#\/?/, '');
  return h.indexOf('portal/') === 0;
}
function _vxPortalToken(){
  const h = (location.hash || '').replace(/^#\/?/, '');
  const m = h.match(/^portal\/(.+)$/);
  return m ? decodeURIComponent(m[1].split('?')[0]) : '';
}

// ── Fetch ─────────────────────────────────────────────────────────────────
async function vxPortalFetch(token){
  if(!token) return { error: 'Missing portal token.' };
  if(token.indexOf('local-') === 0){
    return _vxPortalLocalData(token.slice('local-'.length));
  }
  const sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
  if(sb && sb.functions){
    try {
      const r = await sb.functions.invoke('portal-data', { body: { token } });
      if(r.error){
        let msg = r.error.message || 'Could not load the portal.';
        try { if(r.error.context && typeof r.error.context.json === 'function'){ const j = await r.error.context.json(); if(j && j.error) msg = j.error; } } catch(_){}
        return { error: msg };
      }
      return r.data;
    } catch(e){ return { error: String(e.message || e) }; }
  }
  return { error: 'Portal backend not configured.' };
}

// Local/preview data — filters localStorage to one customer. Mirrors what
// the portal-data Edge Function returns server-side.
function _vxPortalLocalData(customerId){
  const company = (typeof ls === 'function') ? (ls(KEYS.company, {}) || {}) : {};
  const customers = ls(KEYS.customers, []) || [];
  const cust = customers.find(c => c.id === customerId);
  if(!cust) return { error: 'Customer not found in local data (preview link only works on the device that created it).' };
  const jobs = (ls(KEYS.jobs, []) || []).filter(j => j.customerId === customerId);
  const jobIds = new Set(jobs.map(j => j.id));
  const reports = (ls(KEYS.reports, []) || [])
    .filter(r => jobIds.has(r.jobId) && (getReportStage(r) === 'Approved' || getReportStage(r) === 'Sent'))
    .map(r => ({ reportNo:r.reportNo, method:r.method, revision:r.revision, createdAt:r.createdAt, verdict:r.verdict, jobId:r.jobId, stage:getReportStage(r), sealedHtml:r.sealedHtml || r.frozenHtml || '', acknowledgedBy:r.acknowledgedBy||'', acknowledgedAt:r.acknowledgedAt||'', examDate:r.examDate||'' }));
  const quotes = (ls(KEYS.quotes, []) || []).filter(q => q.customerId === customerId && (q.status === 'Sent' || q.status === 'Accepted'));
  const invoices = (ls(KEYS.invoices, []) || []).filter(i => i.customerId === customerId);
  // The customer's own submitted requests (from the local requests store).
  let requests = [];
  try {
    const key = (typeof VX_PORTAL_REQ_KEY !== 'undefined') ? VX_PORTAL_REQ_KEY : 'vx-portal-requests-v1';
    requests = (JSON.parse(localStorage.getItem(key) || '[]') || [])
      .filter(e => e && e.customerId === customerId && (e.kind === 'work-request' || e.kind === 'date-change'))
      .map(e => ({ id:e.id, kind:e.kind, at:e.at, title:e.title||'', method:e.method||'', urgency:e.urgency||'', site:e.site||'', scope:e.scope||'', requestedDate:e.requestedDate||'', requestedTime:e.requestedTime||'', reason:e.reason||'', jobTitle:e.jobTitle||'' }))
      .sort((a,b) => String(b.at||'').localeCompare(String(a.at||'')));
  } catch(e){}
  return {
    company: { name:company.name||'', logo:((company.logoUseOnPortal==='dark' && company.logoDark) ? company.logoDark : company.logo)||'', color:company.color||'#185FA5', footer:company.footer||'', portalSections:company.portalSections||{} },
    customer: { name:cust.name||'', id:cust.id },
    jobs, reports, quotes, invoices, requests,
  };
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function vxPortalBoot(){
  // Portal mode: a customer, not an app user. Suppress the app shell, the
  // login screen, and the first-run welcome modal / trial banner.
  window._vxPortalMode = true;
  try { localStorage.setItem('vx-welcome-seen-v2', '1'); } catch(e){}
  try { const ls0 = document.getElementById('login-screen'); if(ls0) ls0.classList.add('hidden'); } catch(e){}
  try { document.querySelectorAll('.app, #app, .topbar, .topnav').forEach(e => { e.style.display = 'none'; }); } catch(e){}
  const _killChrome = () => {
    ['vx-welcome-modal','vx-trial-banner'].forEach(id => { const m = document.getElementById(id); if(m) m.remove(); });
  };
  _killChrome();
  setTimeout(_killChrome, 80); setTimeout(_killChrome, 350);
  let root = document.getElementById('vx-portal-root');
  if(!root){ root = document.createElement('div'); root.id = 'vx-portal-root'; document.body.appendChild(root); }
  root.style.cssText = 'position:fixed;inset:0;z-index:5000;overflow-y:auto;background:#eef0f4;color:#1c2333;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif';
  root.innerHTML = '<div style="max-width:760px;margin:80px auto;text-align:center;color:#6b7589">Loading your portal…</div>';
  const data = await vxPortalFetch(_vxPortalToken());
  _vxPortalData = data;
  if(!data || data.error){ root.innerHTML = _portalShell('', _portalNotice(data && data.error ? data.error : 'This link is invalid or has expired.')); return; }
  vxPortalRender(root, data);
}

// ── Render ──────────────────────────────────────────────────────────────────
function _portalEsc(s){ return (typeof escapeHtml === 'function') ? escapeHtml(s == null ? '' : String(s)) : String(s == null ? '' : s); }
function _portalMoney(n, cur){ return (typeof billFmtMoney === 'function') ? billFmtMoney(n, cur) : ((Number(n)||0).toFixed(2)); }
function _portalDate(d){ return (d && typeof fmtDate === 'function') ? fmtDate(d) : (d || '—'); }

function _portalShell(accent, inner){
  return `<div style="max-width:900px;margin:0 auto;padding:0 18px 48px">${inner}</div>`;
}
function _portalNotice(msg){
  return `<div style="background:#fff;border-radius:14px;margin-top:80px;padding:40px;text-align:center;box-shadow:0 1px 3px rgba(20,30,60,.08)">
    <div style="font-size:34px;margin-bottom:8px">🔒</div>
    <div style="font-size:16px;font-weight:700;margin-bottom:6px">Portal unavailable</div>
    <div style="font-size:13px;color:#6b7589">${_portalEsc(msg)}</div>
  </div>`;
}
function _portalBadge(label, color){
  return `<span style="display:inline-block;font-size:10px;font-weight:600;background:${color}1a;color:${color};padding:2px 9px;border-radius:4px">${_portalEsc(label)}</span>`;
}
function _portalJobStatusColor(s){ return s==='Active'?'#16a34a':s==='Closed'?'#6b7589':'#d97706'; }
function _portalDocStatusColor(s){ return (s==='Paid'||s==='Accepted')?'#16a34a':s==='Sent'?'#2563eb':(s==='Overdue'||s==='Declined')?'#dc2626':'#6b7589'; }

// ── Asset cockpit (Portal v2, Pillar E) ──────────────────────────────────────
// A per-customer inspection-health overview computed from THIS customer's
// issued reports: headline KPIs, pass-rate by method, and a short trend. Turns
// the portal from a document list into an asset-integrity view. Read-only;
// renders nothing until there are reports.
function _portalCockpit(data, accent){
  const reports = (data && data.reports) || [];
  if(!reports.length) return '';
  let acc = 0, rej = 0, oth = 0;
  const byMethod = {}, byMonth = {};
  reports.forEach(r => {
    const v = r.verdict, m = r.method || '—';
    byMethod[m] = byMethod[m] || { total:0, acc:0, rej:0 };
    byMethod[m].total++;
    if(v === 'Acceptable'){ acc++; byMethod[m].acc++; }
    else if(v === 'Not acceptable'){ rej++; byMethod[m].rej++; }
    else oth++;
    if(r.createdAt){ const d = new Date(r.createdAt); if(!isNaN(d.getTime())){ const k = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); byMonth[k] = byMonth[k] || { acc:0, rej:0 }; if(v === 'Acceptable') byMonth[k].acc++; else if(v === 'Not acceptable') byMonth[k].rej++; } }
  });
  const decided = acc + rej;
  const passRate = decided ? Math.round(acc / decided * 100) : null;
  const prColor = passRate == null ? '#6b7589' : passRate >= 90 ? '#16a34a' : passRate >= 70 ? '#d97706' : '#dc2626';
  const activeJobs = ((data.jobs) || []).filter(j => j.status === 'Active').length;
  const ackCount = reports.filter(r => r.acknowledgedBy).length;

  const kpi = (label, value, sub, color) => `<div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,60,.06);padding:13px 16px;flex:1;min-width:120px">
    <div style="font-size:10px;color:#9aa5bd;text-transform:uppercase;letter-spacing:.05em">${_portalEsc(label)}</div>
    <div style="font-size:25px;font-weight:800;color:${color || '#0b1220'};line-height:1.1;margin-top:3px">${_portalEsc(value)}</div>
    ${sub ? `<div style="font-size:11px;color:#6b7589;margin-top:2px">${_portalEsc(sub)}</div>` : ''}
  </div>`;

  const kpis = `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
    ${kpi('Reports', String(reports.length), reports.length === 1 ? 'issued' : 'issued', accent)}
    ${kpi('Acceptable rate', passRate == null ? '—' : passRate + '%', decided + ' with a verdict', prColor)}
    ${kpi('Open issues', String(rej), rej === 1 ? 'not acceptable' : 'not acceptable', rej ? '#dc2626' : '#16a34a')}
    ${kpi('Active jobs', String(activeJobs), ackCount + ' report' + (ackCount === 1 ? '' : 's') + ' acknowledged', '#0b1220')}
  </div>`;

  const methodRows = Object.keys(byMethod).sort().map(m => {
    const x = byMethod[m], dec = x.acc + x.rej, pr = dec ? Math.round(x.acc / dec * 100) : null;
    const c = pr == null ? '#9aa5bd' : pr >= 90 ? '#16a34a' : pr >= 70 ? '#d97706' : '#dc2626';
    return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0">
      <span style="font-family:monospace;font-weight:700;font-size:12px;width:40px;color:${accent}">${_portalEsc(m)}</span>
      <div style="flex:1;height:8px;background:#eef0f4;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pr == null ? 0 : pr}%;background:${c}"></div></div>
      <span style="font-size:11px;color:#6b7589;width:96px;text-align:right">${pr == null ? '—' : pr + '% pass'} · ${x.total}</span>
    </div>`;
  }).join('');

  const months = Object.keys(byMonth).sort().slice(-6);
  let trendHtml = '';
  if(months.length > 1){
    const maxM = Math.max(1, ...months.map(k => byMonth[k].acc + byMonth[k].rej));
    const bars = months.map(k => {
      const x = byMonth[k], tot = x.acc + x.rej, h = Math.round((tot / maxM) * 56), accH = tot ? Math.round((x.acc / tot) * h) : 0;
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:5px;flex:1">
        <div style="height:56px;display:flex;flex-direction:column;justify-content:flex-end;width:22px">
          <div style="height:${h - accH}px;background:#dc2626;border-radius:3px 3px 0 0"></div>
          <div style="height:${accH}px;background:#16a34a"></div>
        </div>
        <span style="font-size:9px;color:#9aa5bd;font-family:monospace">${_portalEsc(k.slice(2))}</span>
      </div>`;
    }).join('');
    trendHtml = `<div style="flex:1;min-width:200px"><div style="font-size:11px;font-weight:600;color:#6b7589;margin-bottom:8px">Results by month</div>
      <div style="display:flex;align-items:flex-end;gap:8px;height:78px">${bars}</div></div>`;
  }

  return `<h2 style="font-size:15px;margin:0 0 10px;color:#0b1220">Asset overview</h2>
    ${kpis}
    <div style="display:flex;gap:18px;flex-wrap:wrap;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,60,.06);padding:16px 18px;margin-bottom:22px">
      <div style="flex:1;min-width:240px"><div style="font-size:11px;font-weight:600;color:#6b7589;margin-bottom:6px">Pass rate by method</div>${methodRows}</div>
      ${trendHtml}
    </div>`;
}

// ── Inspection schedule (Portal v2 — calendar of job/exam dates) ──────────────
function _portalSchedule(data, accent){
  const items = [];
  (data.jobs || []).forEach(j => { if(j.startDate) items.push({ ymd:String(j.startDate).slice(0,10), endYmd:j.endDate?String(j.endDate).slice(0,10):'', time:j.startTime||'', title:j.title||'Job', sub:j.status||'', jobId:j.id, type:'job' }); });
  (data.reports || []).forEach(r => { if(r.examDate) items.push({ ymd:String(r.examDate).slice(0,10), endYmd:'', time:'', title:((r.method||'')+' '+(r.reportNo||'')).trim(), sub:'Exam', type:'exam' }); });
  if(!items.length) return '';
  items.sort((a,b) => a.ymd.localeCompare(b.ymd));

  // Days that carry an inspection (job ranges expanded) → calendar dots.
  const marked = {};
  items.forEach(it => {
    marked[it.ymd] = true;
    if(it.endYmd && it.endYmd > it.ymd){ let d = new Date(it.ymd+'T00:00:00'); const end = new Date(it.endYmd+'T00:00:00'); let g=0; while(d<=end && g++<400){ marked[d.toISOString().slice(0,10)] = true; d.setDate(d.getDate()+1); } }
  });
  const todayYmd = new Date().toISOString().slice(0,10);
  const focusItem = items.find(it => (it.endYmd||it.ymd) >= todayYmd) || items[items.length-1];
  const focus = new Date(focusItem.ymd+'T00:00:00');
  const year = focus.getFullYear(), month = focus.getMonth();
  const startDow = (new Date(year, month, 1).getDay()+6)%7;   // Monday-first
  const dim = new Date(year, month+1, 0).getDate();
  let cells = '';
  for(let i=0;i<startDow;i++) cells += '<div></div>';
  for(let d=1; d<=dim; d++){
    const k = year+'-'+String(month+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const has = marked[k], isToday = k===todayYmd;
    cells += `<div style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;position:relative;font-size:12px;border-radius:6px;${has?`background:${accent}14;color:${accent};font-weight:700`:'color:#6b7589'}${isToday?(';box-shadow:inset 0 0 0 1.5px '+accent):''}">${d}${has?`<span style="position:absolute;bottom:3px;width:4px;height:4px;border-radius:50%;background:${accent}"></span>`:''}</div>`;
  }
  const dowRow = ['Mo','Tu','We','Th','Fr','Sa','Su'].map(x=>`<div style="font-size:10px;color:#9aa5bd;text-align:center;padding-bottom:4px">${x}</div>`).join('');
  const cal = `<div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,60,.06);padding:14px 16px;flex:0 0 270px">
    <div style="font-weight:700;font-size:13px;margin-bottom:8px">${focus.toLocaleString('en',{month:'long',year:'numeric'})}</div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">${dowRow}${cells}</div></div>`;

  const upcoming = items.filter(it => (it.endYmd||it.ymd) >= todayYmd).slice(0,8);
  const agendaRows = (upcoming.length ? upcoming : items.slice(-4)).map(it => {
    const dt = new Date(it.ymd+'T00:00:00');
    const dchg = (it.type==='job' && it.jobId) ? `<button data-action="vxPortalRequestDateChange" data-args="'${_portalEsc(it.jobId)}'" title="Request a different date" style="cursor:pointer;border:1px solid ${accent};color:${accent};background:transparent;border-radius:6px;font-size:10px;padding:3px 8px;white-space:nowrap">Request change</button>` : '';
    return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-top:1px solid #eef0f4">
      <div style="text-align:center;flex:0 0 42px"><div style="font-size:18px;font-weight:800;color:${accent};line-height:1">${dt.getDate()}</div><div style="font-size:10px;color:#9aa5bd;text-transform:uppercase">${dt.toLocaleString('en',{month:'short'})}</div></div>
      <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">${_portalEsc(it.title)}${it.time?` <span style="color:${accent};font-weight:700">${_portalEsc(it.time)}</span>`:''}</div><div style="font-size:11px;color:#6b7589">${_portalEsc(it.sub)}${it.endYmd&&it.endYmd!==it.ymd?(' · until '+_portalDate(it.endYmd)):''}</div></div>
      ${dchg}
    </div>`;
  }).join('');
  const agenda = `<div style="flex:1;min-width:220px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,60,.06);padding:14px 16px"><div style="font-size:11px;font-weight:600;color:#6b7589;margin-bottom:4px">${upcoming.length?'Upcoming':'Recent'}</div>${agendaRows}</div>`;

  return `<h2 style="font-size:15px;margin:24px 0 10px;color:#0b1220">Inspection schedule</h2>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:22px">${cal}${agenda}</div>`;
}

// ── Your submitted requests (Portal v2) ───────────────────────────────────────
function _portalRequests(data){
  const reqs = (data.requests || []);
  if(!reqs.length) return '';
  const rows = reqs.map(r => {
    const isDate = r.kind === 'date-change';
    const title = isDate
      ? ('Date change' + (r.jobTitle ? ' · ' + r.jobTitle : '') + (r.requestedDate ? ' → ' + _portalDate(r.requestedDate) + (r.requestedTime ? ' ' + r.requestedTime : '') : ''))
      : (r.title || 'Inspection request');
    const meta = (isDate ? [r.reason] : [r.method, r.site]).filter(Boolean).map(_portalEsc).join(' · ');
    return `<tr>
      <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-size:13px;font-weight:600">${_portalEsc(title)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-size:11px;color:#6b7589">${meta}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-size:11px;color:#6b7589;white-space:nowrap">${_portalDate(r.at)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;text-align:right">${_portalBadge('Received', '#6b7589')}</td>
    </tr>`;
  }).join('');
  return `<h2 style="font-size:15px;margin:24px 0 10px;color:#0b1220">Your requests</h2>
    <div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,60,.06);overflow:hidden"><table style="width:100%;border-collapse:collapse">${rows}</table></div>`;
}

function vxPortalRender(root, data){
  const accent = (data.company && /^#[0-9A-Fa-f]{6}$/.test(data.company.color || '')) ? data.company.color : '#185FA5';
  const co = data.company || {};
  // Online payment is only available from a live (server-signed) portal link —
  // the local preview link has no token the payment function can verify.
  const _tok = _vxPortalToken();
  const canPay = !!_tok && _tok.indexOf('local-') !== 0;
  // Stripe redirects back with ?paid=<invoiceId> after a successful checkout.
  const paidParam = (location.hash.split('?')[1] || '').match(/(?:^|&)paid=([^&]+)/);
  const paidNotice = paidParam
    ? `<div style="background:#dcfce7;border:1px solid #86efac;color:#15803d;border-radius:12px;padding:14px 18px;margin-bottom:16px;font-size:13px;font-weight:600">✓ Payment received — thank you. The invoice will show as paid shortly.</div>`
    : '';
  const reportsByJob = {};
  (data.reports || []).forEach(r => { (reportsByJob[r.jobId] = reportsByJob[r.jobId] || []).push(r); });
  // F: free-text filter across reports / jobs / documents.
  const _q = (_vxPortalQuery || '').trim().toLowerCase();
  const _match = (s) => !_q || String(s == null ? '' : s).toLowerCase().indexOf(_q) !== -1;
  const _repMatch = (r) => _match(r.reportNo) || _match(r.method) || _match(r.subject);

  // Header (white-label)
  const header = `<div style="background:#fff;border-radius:0 0 16px 16px;box-shadow:0 1px 3px rgba(20,30,60,.08);padding:22px 26px;margin-bottom:22px;display:flex;align-items:center;gap:16px">
    ${co.logo ? `<img src="${_portalEsc(co.logo)}" alt="" style="max-height:48px;max-width:180px;object-fit:contain"/>` : `<div style="font-size:20px;font-weight:800;color:${accent}">${_portalEsc(co.name || 'Customer Portal')}</div>`}
    <div style="flex:1"></div>
    <div style="text-align:right">
      <div style="font-size:11px;color:#9aa5bd;text-transform:uppercase;letter-spacing:.06em">Customer portal</div>
      <div style="font-size:14px;font-weight:600">${_portalEsc((data.customer && data.customer.name) || '')}</div>
    </div>
  </div>`;

  // Jobs + their reports
  let jobsHtml = `<h2 style="font-size:15px;margin:0 0 10px;color:#0b1220">Jobs &amp; reports</h2>`;
  if(!(data.jobs || []).length){
    jobsHtml += `<div style="background:#fff;border-radius:12px;padding:22px;color:#9aa5bd;font-size:13px;text-align:center">No jobs to show yet.</div>`;
  } else {
    jobsHtml += (data.jobs || []).map(j => {
      const allReps = reportsByJob[j.id] || [];
      let reps = allReps;
      if(_q){ const jt = _match(j.title); reps = allReps.filter(_repMatch); if(!jt && !reps.length) return ''; }
      const repRows = reps.length ? reps.map(r => `<tr>
          <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-family:monospace;font-size:12px;color:${accent}">${_portalEsc(r.reportNo||'—')}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-size:12px">${_portalEsc(r.method||'')} · Rev ${_portalEsc(r.revision||'00')}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-size:11px;color:#6b7589">${_portalDate(r.createdAt)}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;text-align:right;white-space:nowrap">${r.acknowledgedBy ? `<span title="Acknowledged ${_portalDate(r.acknowledgedAt)} by ${_portalEsc(r.acknowledgedBy)}" style="font-size:11px;color:#16a34a;font-weight:600;margin-right:8px">✓ Acknowledged</span>` : `<button data-action="vxPortalAckReport" data-args="'${_portalEsc(r.reportNo)}','${_portalEsc(r.revision||'')}'" title="Confirm receipt of this report" style="cursor:pointer;border:1px solid #16a34a;color:#16a34a;background:transparent;border-radius:6px;font-size:11px;padding:4px 10px;margin-right:6px">Acknowledge</button>`}${r.sealedHtml ? `<button data-action="vxPortalOpenReport" data-args="'${_portalEsc(r.reportNo)}'" title="Download this report as a PDF" style="cursor:pointer;border:1px solid ${accent};color:${accent};background:transparent;border-radius:6px;font-size:11px;padding:4px 10px">⬇ PDF</button>` : '<span style="font-size:11px;color:#9aa5bd">—</span>'}</td>
        </tr>`).join('') : `<tr><td colspan="4" style="padding:10px 8px;color:#9aa5bd;font-size:12px">No issued reports for this job yet.</td></tr>`;
      return `<div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,60,.06);margin-bottom:12px;overflow:hidden">
        <div style="padding:12px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #eef0f4">
          <span style="font-weight:700;font-size:14px">${_portalEsc(j.title||'—')}</span>
          ${_portalBadge(j.status||'Pending', _portalJobStatusColor(j.status))}
          <span style="flex:1"></span>
          <span style="font-size:11px;color:#9aa5bd">${reps.length} report${reps.length===1?'':'s'}</span>
          ${allReps.some(r => r.sealedHtml) ? `<button data-action="vxPortalDownloadPack" data-args="'${_portalEsc(j.id)}'" title="Download all reports for this job as one PDF" style="cursor:pointer;border:1px solid ${accent};color:${accent};background:transparent;border-radius:6px;font-size:11px;padding:4px 10px;margin-left:8px">⬇ Pack</button>` : ''}
        </div>
        <table style="width:100%;border-collapse:collapse">${repRows}</table>
      </div>`;
    }).join('');
  }

  // Quotes + invoices
  const docBlock = (title, docs, type) => {
    if(!docs || !docs.length) return '';
    const rows = docs.map(d => {
      const total = (typeof billCalc === 'function') ? billCalc(d).total : 0;
      const overdue = (type==='invoice' && typeof billIsOverdue === 'function' && billIsOverdue(d));
      const status = overdue ? 'Overdue' : (d.status || 'Draft');
      // F: invoice aging — days until/over due, beside the status.
      let aging = '';
      if(type==='invoice' && d.status!=='Paid' && d.dueDate){
        const due = new Date(d.dueDate);
        if(!isNaN(due.getTime())){
          const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
          aging = days < 0 ? `<div style="font-size:10px;color:#dc2626;margin-top:2px">${-days} day${-days===1?'':'s'} overdue</div>`
                : days <= 7 ? `<div style="font-size:10px;color:#d97706;margin-top:2px">due in ${days} day${days===1?'':'s'}</div>` : '';
        }
      }
      return `<tr>
        <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-family:monospace;font-size:12px;font-weight:600">${_portalEsc(d.number||'—')}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-size:11px;color:#6b7589">${_portalDate(d.issueDate)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #eef0f4">${_portalBadge(status, _portalDocStatusColor(status))}${aging}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;text-align:right;font-family:monospace;font-size:12px">${_portalMoney(total, d.currency)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;text-align:right;white-space:nowrap">${(type==='quote' && d.status==='Sent') ? `<button data-action="vxPortalQuoteDecision" data-args="'${_portalEsc(d.id)}','Accepted'" style="cursor:pointer;border:none;color:#fff;background:#16a34a;border-radius:6px;font-size:11px;padding:4px 11px;margin-right:6px;font-weight:600">Accept</button><button data-action="vxPortalQuoteDecision" data-args="'${_portalEsc(d.id)}','Declined'" style="cursor:pointer;border:1px solid #dc2626;color:#dc2626;background:transparent;border-radius:6px;font-size:11px;padding:4px 10px;margin-right:6px">Decline</button>` : ''}${(type==='quote' && d.status==='Accepted') ? `<span style="font-size:11px;color:#16a34a;font-weight:600;margin-right:8px">✓ Accepted${d.decisionBy ? ' · ' + _portalEsc(d.decisionBy) : ''}</span>` : ''}${(type==='invoice' && canPay && d.status!=='Paid') ? `<button data-action="vxPortalPayInvoice" data-args="'${_portalEsc(d.id)}'" style="cursor:pointer;border:none;color:#fff;background:#16a34a;border-radius:6px;font-size:11px;padding:4px 11px;margin-right:6px;font-weight:600">Pay online</button>` : ''}<button data-action="vxPortalOpenDoc" data-args="'${type}','${_portalEsc(d.id)}'" title="Download as a PDF" style="cursor:pointer;border:1px solid ${accent};color:${accent};background:transparent;border-radius:6px;font-size:11px;padding:4px 10px">⬇ PDF</button></td>
      </tr>`;
    }).join('');
    return `<h2 style="font-size:15px;margin:24px 0 10px;color:#0b1220">${_portalEsc(title)}</h2>
      <div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,60,.06);overflow:hidden"><table style="width:100%;border-collapse:collapse">${rows}</table></div>`;
  };
  const invoicesHtml = docBlock('Invoices', (data.invoices || []).filter(d => !_q || _match(d.number)), 'invoice');
  const quotesHtml   = docBlock('Quotes', (data.quotes || []).filter(d => !_q || _match(d.number)), 'quote');

  const payNote = (data.invoices && data.invoices.some(i => i.status !== 'Paid'))
    ? `<div style="font-size:11px;color:#6b7589;margin-top:8px">${canPay ? 'Pay securely online with the button beside each unpaid invoice, or use' : 'To pay an invoice, please use'} the bank details on the invoice PDF and quote the invoice number.</div>` : '';

  const footer = `<div style="text-align:center;color:#9aa5bd;font-size:11px;margin-top:30px">${_portalEsc(co.footer || co.name || '')}</div>`;

  // Section visibility — admin-controlled (Settings → Customer portal). Default
  // on when unset, so existing portals are unchanged.
  const _sec = (data.company && data.company.portalSections) || {};
  const _secOn = (k) => _sec[k] !== false;
  const cockpitHtml = _secOn('cockpit') ? _portalCockpit(data, accent) : '';
  const scheduleHtml = _secOn('schedule') ? _portalSchedule(data, accent) : '';
  const requestsHtml = _portalRequests(data);
  const requestCta = `<div style="display:flex;justify-content:flex-end;margin:-6px 0 16px"><button data-action="vxPortalRequestWork" style="cursor:pointer;border:none;background:${accent};color:#fff;border-radius:9px;font-size:13px;font-weight:600;padding:10px 18px;box-shadow:0 1px 3px rgba(20,30,60,.12)">+ Request an inspection</button></div>`;
  const searchBar = (data.jobs || []).length
    ? `<div style="margin:0 0 16px"><input id="vxp-search" type="search" value="${_portalEsc(_vxPortalQuery)}" data-on-input="vxPortalSearch" data-pass-value="1" placeholder="Search reports, jobs, invoices…" style="width:100%;box-sizing:border-box;padding:11px 15px;border:1px solid #d6dbe6;border-radius:10px;font-size:14px;background:#fff;color:#1c2333"></div>`
    : '';
  root.innerHTML = header + _portalShell(accent, paidNotice
    + (_secOn('requestButton') ? requestCta : '')
    + cockpitHtml + scheduleHtml + searchBar
    + (_secOn('reports') ? jobsHtml : '')
    + requestsHtml
    + (_secOn('invoices') ? invoicesHtml + payNote : '')
    + (_secOn('quotes') ? quotesHtml : '')
    + footer);
}

// ── Downloads ────────────────────────────────────────────────────────────────
function _vxPortalOpenHtml(html){
  if(!html){ if(typeof toast === 'function') toast('Nothing to open.', 'error'); return; }
  const w = window.open('', '_blank');
  if(!w){ if(typeof toast === 'function') toast('Pop-up blocked — allow pop-ups to open the document.', 'error'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
// Shared download options — pass the live portal token so the customer call to
// pdf-render authenticates (empty for the on-device preview link).
function _vxPortalDlOpts(){ const tok = _vxPortalToken(); return { portalToken: (tok && tok.indexOf('local-') !== 0) ? tok : '' }; }

function vxPortalOpenReport(reportNo){
  const r = (_vxPortalData && _vxPortalData.reports || []).find(x => x.reportNo === reportNo);
  if(!r || !r.sealedHtml){ if(typeof toast === 'function') toast('Report not available.', 'error'); return; }
  if(typeof vxDownloadHtmlAsPdf === 'function') vxDownloadHtmlAsPdf(r.sealedHtml, (reportNo || 'report'), _vxPortalDlOpts());
  else _vxPortalOpenHtml(r.sealedHtml);
}
function vxPortalOpenDoc(type, id){
  const list = (_vxPortalData && (type === 'invoice' ? _vxPortalData.invoices : _vxPortalData.quotes)) || [];
  const doc = list.find(d => d.id === id);
  if(!doc){ if(typeof toast === 'function') toast('Document not found.', 'error'); return; }
  // Render via the billing doc-builder, passing the portal's company so it
  // works even though localStorage has no company on the customer's device.
  const html = (typeof billBuildDocHtml === 'function')
    ? billBuildDocHtml(type, doc, (_vxPortalData && _vxPortalData.company) || null)
    : '';
  if(!html){ if(typeof toast === 'function') toast('Document not available.', 'error'); return; }
  if(typeof vxDownloadHtmlAsPdf === 'function') vxDownloadHtmlAsPdf(html, (doc.number || type), _vxPortalDlOpts());
  else _vxPortalOpenHtml(html);
}

// ── Self-serve depth (Portal v2, Pillar F) ───────────────────────────────────
// Download a consolidated report pack for one job — reuses the inspector-side
// builder, branded from the server-supplied company (the customer device has no
// local company profile).
function vxPortalDownloadPack(jobId){
  const data = _vxPortalData; if(!data) return;
  const job = (data.jobs || []).find(j => j.id === jobId);
  if(!job){ if(typeof toast === 'function') toast('Job not found.', 'error'); return; }
  const reps = (data.reports || []).filter(r => r.jobId === jobId && r.sealedHtml);
  if(!reps.length){ if(typeof toast === 'function') toast('No issued reports to include yet.', 'warn'); return; }
  reps.sort((a, b) => (a.method || '').localeCompare(b.method || '') || String(a.reportNo || '').localeCompare(String(b.reportNo || '')));
  if(typeof vxBuildReportPackHtml !== 'function'){ if(typeof toast === 'function') toast('Pack export unavailable.', 'error'); return; }
  const cust = { name: (data.customer && data.customer.name) || '' };
  const html = vxBuildReportPackHtml(job, cust, reps, data.company || null);
  const fn = (job.title || 'job') + ' report pack';
  const tok = _vxPortalToken();
  // True no-dialog download → server-side vector PDF (passing the portal token
  // to authenticate), falling back to raster / print dialog.
  if(typeof vxDownloadHtmlAsPdf === 'function') vxDownloadHtmlAsPdf(html, fn, { portalToken: (tok && tok.indexOf('local-') !== 0) ? tok : '' });
  else if(typeof _vxPrintHtml === 'function') _vxPrintHtml(html);
  else _vxPortalOpenHtml(html);
}

// Portal search — filters jobs/reports/documents by a free-text query, then
// re-renders. Focus + caret are restored so typing isn't interrupted.
var _vxPortalQuery = '';
function vxPortalSearch(v){
  _vxPortalQuery = v || '';
  const root = document.getElementById('vx-portal-root');
  if(root && _vxPortalData && !_vxPortalData.error){
    const caret = (function(){ const e = document.getElementById('vxp-search'); return e ? e.selectionStart : null; })();
    vxPortalRender(root, _vxPortalData);
    const e = document.getElementById('vxp-search');
    if(e){ e.focus(); try { if(caret != null) e.setSelectionRange(caret, caret); } catch(_){} }
  }
}

// Pay an invoice online — asks the stripe-checkout Edge Function for a hosted
// Stripe Checkout URL (the portal token is the credential), then redirects the
// customer there. stripe-webhook flips the invoice to Paid on success.
async function vxPortalPayInvoice(id){
  const token = _vxPortalToken();
  if(!token || token.indexOf('local-') === 0){ if(typeof toast === 'function') toast('Online payment needs a live portal link.', 'warn'); return; }
  const sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
  if(!sb || !sb.functions){ if(typeof toast === 'function') toast('Payments are not available right now.', 'error'); return; }
  if(typeof toast === 'function') toast('Opening secure checkout…', 'info');
  try {
    const r = await sb.functions.invoke('stripe-checkout', { body: { token, invoiceId: id } });
    if(r.error || !r.data || !r.data.url){
      let msg = 'Could not start checkout.';
      try { if(r.error && r.error.context && typeof r.error.context.json === 'function'){ const j = await r.error.context.json(); if(j && j.error) msg = j.error; } } catch(_){}
      if(typeof toast === 'function') toast(msg, 'error');
      return;
    }
    location.href = r.data.url;   // Stripe-hosted checkout page
  } catch(e){ if(typeof toast === 'function') toast(String(e.message || e), 'error'); }
}

// ── Two-way channel (Portal v2, Pillar A) ────────────────────────────────────
// Every customer action goes through one helper. A real (server-signed) token
// posts to the portal-submit Edge Function, which records a write-once event
// the inspector's app ingests. A local-<id> preview token has no cloud, so we
// apply the event straight to localStorage on-device — the same browser holds
// the data, so the loop still demonstrates end-to-end.
async function vxPortalSubmit(kind, payload){
  const token = _vxPortalToken();
  if(token && token.indexOf('local-') === 0){
    try { _vxApplyPortalEventLocal({ kind: kind, customerId: token.slice('local-'.length), at: new Date().toISOString(), by: (payload && payload.by) || '', ...payload }); return { ok:true, local:true }; }
    catch(e){ return { error: String(e.message || e) }; }
  }
  const sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
  if(!sb || !sb.functions) return { error: 'This action needs a live portal link.' };
  try {
    const r = await sb.functions.invoke('portal-submit', { body: { token: token, kind: kind, payload: payload } });
    if(r.error){
      let msg = 'Could not submit — please try again.';
      try { if(r.error.context && typeof r.error.context.json === 'function'){ const j = await r.error.context.json(); if(j && j.error) msg = j.error; } } catch(_){}
      return { error: msg };
    }
    return r.data || { ok:true };
  } catch(e){ return { error: String(e.message || e) }; }
}

// Apply a customer event to the local store (preview path + the model the app's
// cloud-pull ingest reuses): a quote decision flips the quote; a report ack
// stamps the report. Mutations go through lss() so entity-key storage is safe.
function _vxApplyPortalEventLocal(ev){
  if(!ev || !ev.kind) return;
  if(ev.kind === 'quote-decision'){
    const quotes = ls(KEYS.quotes, []) || [];
    const q = quotes.find(x => x && x.id === ev.quoteId);
    if(q && q.status === 'Sent'){
      q.status = ev.decision;
      q[ev.decision === 'Accepted' ? 'acceptedAt' : 'declinedAt'] = ev.at;
      q.decisionBy = ev.by || '';
      lss(KEYS.quotes, quotes);
    }
  } else if(ev.kind === 'ack-report'){
    const reports = ls(KEYS.reports, []) || [];
    const r = reports.find(x => x && String(x.reportNo) === String(ev.reportNo) && (!ev.revision || String(x.revision) === String(ev.revision)));
    if(r){
      r.acknowledgedBy = ev.by || '';
      r.acknowledgedAt = ev.at;
      if(ev.note) r.acknowledgedNote = ev.note;
      if(typeof addReportAudit === 'function') try { addReportAudit(r, 'ack', 'Acknowledged by customer' + (ev.by ? ' (' + ev.by + ')' : '')); } catch(_){}
      lss(KEYS.reports, reports);
    }
  } else if(ev.kind === 'work-request' || ev.kind === 'date-change'){
    // Preview path mirrors the cloud ingest: file the request locally so the
    // inspector's Jobs page shows it on this device.
    try {
      const key = (typeof VX_PORTAL_REQ_KEY !== 'undefined') ? VX_PORTAL_REQ_KEY : 'vx-portal-requests-v1';
      const reqs = JSON.parse(localStorage.getItem(key) || '[]');
      reqs.unshift(Object.assign({ id: 'req-' + Date.now().toString(36) + Math.random().toString(36).slice(2,6) }, ev));
      localStorage.setItem(key, JSON.stringify(reqs.slice(0, 200)));
    } catch(_){}
  }
}

// ── A tiny self-contained e-sign prompt (portal has no app modal helpers) ─────
// Resolves { by, note } or null. The typed name + server timestamp + IP that
// portal-submit records together form the click-wrap signature.
function _vxPortalPrompt(opts){
  opts = opts || {};
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(12,18,32,.55);display:flex;align-items:center;justify-content:center;padding:18px';
    const accent = opts.accent || '#185FA5';
    ov.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:22px 22px 18px;box-shadow:0 12px 40px rgba(12,18,32,.3);font-family:inherit">
      <div style="font-size:16px;font-weight:700;margin-bottom:4px;color:#0b1220">${_portalEsc(opts.title || 'Confirm')}</div>
      <div style="font-size:12.5px;color:#6b7589;line-height:1.5;margin-bottom:14px">${_portalEsc(opts.body || '')}</div>
      <label style="font-size:11px;font-weight:600;color:#6b7589;text-transform:uppercase;letter-spacing:.04em">Your name (signature)</label>
      <input id="vxpp-name" type="text" placeholder="Full name" style="width:100%;box-sizing:border-box;margin:5px 0 12px;padding:9px 11px;border:1px solid #d6dbe6;border-radius:8px;font-size:14px;font-family:inherit">
      ${opts.note === false ? '' : `<label style="font-size:11px;font-weight:600;color:#6b7589;text-transform:uppercase;letter-spacing:.04em">Note (optional)</label>
      <textarea id="vxpp-note" rows="2" placeholder="${_portalEsc(opts.notePlaceholder || 'Anything to add…')}" style="width:100%;box-sizing:border-box;margin:5px 0 14px;padding:9px 11px;border:1px solid #d6dbe6;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical"></textarea>`}
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="vxpp-cancel" style="cursor:pointer;border:1px solid #d6dbe6;background:#fff;color:#6b7589;border-radius:8px;font-size:13px;padding:8px 16px">Cancel</button>
        <button id="vxpp-ok" style="cursor:pointer;border:none;background:${accent};color:#fff;border-radius:8px;font-size:13px;font-weight:600;padding:8px 18px">${_portalEsc(opts.okLabel || 'Confirm')}</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const done = (v) => { try { ov.remove(); } catch(_){} resolve(v); };
    const nameEl = ov.querySelector('#vxpp-name');
    ov.querySelector('#vxpp-cancel').addEventListener('click', () => done(null));
    ov.addEventListener('click', (e) => { if(e.target === ov) done(null); });
    ov.querySelector('#vxpp-ok').addEventListener('click', () => {
      const by = (nameEl.value || '').trim();
      if(!by){ nameEl.style.borderColor = '#dc2626'; nameEl.focus(); return; }
      const noteEl = ov.querySelector('#vxpp-note');
      done({ by: by, note: noteEl ? (noteEl.value || '').trim() : '' });
    });
    setTimeout(() => { try { nameEl.focus(); } catch(_){} }, 30);
  });
}

// Acknowledge receipt of an issued report (C — e-sign).
async function vxPortalAckReport(reportNo, revision){
  const accent = (_vxPortalData && _vxPortalData.company && _vxPortalData.company.color) || '#185FA5';
  const sig = await _vxPortalPrompt({ accent: accent, title: 'Acknowledge report ' + reportNo, body: 'Confirm you have received and reviewed this report. Your name and the time are recorded as a receipt.', okLabel: 'Acknowledge', notePlaceholder: 'Comments on the findings (optional)…' });
  if(!sig) return;
  if(typeof toast === 'function') toast('Recording acknowledgement…', 'info');
  const res = await vxPortalSubmit('ack-report', { reportNo: reportNo, revision: revision, by: sig.by, note: sig.note });
  if(res.error){ if(typeof toast === 'function') toast(res.error, 'error'); return; }
  // Optimistically reflect it so the customer sees the receipt immediately.
  const r = (_vxPortalData && _vxPortalData.reports || []).find(x => String(x.reportNo) === String(reportNo));
  if(r){ r.acknowledgedBy = sig.by; r.acknowledgedAt = (res.at || new Date().toISOString()); if(sig.note) r.acknowledgedNote = sig.note; }
  if(typeof toast === 'function') toast('Thank you — acknowledgement recorded.', 'success');
  _vxPortalReRender();
}

// Accept or decline a quote (C — e-sign).
async function vxPortalQuoteDecision(quoteId, decision){
  const accent = (_vxPortalData && _vxPortalData.company && _vxPortalData.company.color) || '#185FA5';
  const q = (_vxPortalData && _vxPortalData.quotes || []).find(x => x.id === quoteId);
  const num = q ? (q.number || '') : '';
  const sig = await _vxPortalPrompt({ accent: accent, title: decision + ' quote ' + num, body: 'Confirm you ' + (decision === 'Accepted' ? 'accept' : 'decline') + ' this quotation. Your name and the time are recorded.', okLabel: decision, notePlaceholder: decision === 'Declined' ? 'Reason (optional)…' : 'Any note (optional)…' });
  if(!sig) return;
  if(typeof toast === 'function') toast('Recording your decision…', 'info');
  const res = await vxPortalSubmit('quote-decision', { quoteId: quoteId, decision: decision, by: sig.by, note: sig.note });
  if(res.error){ if(typeof toast === 'function') toast(res.error, 'error'); return; }
  if(q){ q.status = decision; q.decisionBy = sig.by; }
  if(typeof toast === 'function') toast(decision === 'Accepted' ? 'Quote accepted — thank you.' : 'Quote declined — noted.', 'success');
  _vxPortalReRender();
}

// ── Work request (Portal v2, Pillar B) ───────────────────────────────────────
// A self-contained form letting the customer raise an inspection request, which
// the channel records as a work-request event the inspector's app files.
function _vxPortalRequestForm(accent){
  return new Promise((resolve) => {
    const methods = (typeof NDT_METHODS !== 'undefined' && Array.isArray(NDT_METHODS)) ? NDT_METHODS : [];
    const methodOpts = '<option value="">— Method (optional) —</option>'
      + methods.map(m => `<option value="${_portalEsc(m.id)}">${_portalEsc(m.id + (m.name ? ' · ' + m.name : ''))}</option>`).join('')
      + '<option value="Other">Other</option>';
    const inp = 'width:100%;box-sizing:border-box;margin:0 0 10px;padding:9px 11px;border:1px solid #d6dbe6;border-radius:8px;font-size:13.5px;font-family:inherit';
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(12,18,32,.55);display:flex;align-items:flex-start;justify-content:center;padding:24px 18px;overflow-y:auto';
    ov.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:480px;width:100%;padding:22px;box-shadow:0 12px 40px rgba(12,18,32,.3);font-family:inherit">
      <div style="font-size:16px;font-weight:700;margin-bottom:3px;color:#0b1220">Request an inspection</div>
      <div style="font-size:12.5px;color:#6b7589;margin-bottom:14px">Tell us what you need and we'll be in touch.</div>
      <input id="vxr-title" placeholder="What needs inspecting? (e.g. Unit 4 weld survey)" style="${inp}">
      <div style="display:flex;gap:10px">
        <select id="vxr-method" style="${inp};flex:1">${methodOpts}</select>
        <select id="vxr-urgency" style="${inp};flex:1"><option value="Normal">Normal</option><option value="High">High priority</option><option value="Urgent">Urgent</option></select>
      </div>
      <input id="vxr-site" placeholder="Site / location (optional)" style="${inp}">
      <textarea id="vxr-scope" rows="3" placeholder="Scope or details (optional)" style="${inp};resize:vertical"></textarea>
      <input id="vxr-by" placeholder="Your name" style="${inp}">
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
        <button id="vxr-cancel" style="cursor:pointer;border:1px solid #d6dbe6;background:#fff;color:#6b7589;border-radius:8px;font-size:13px;padding:8px 16px">Cancel</button>
        <button id="vxr-ok" style="cursor:pointer;border:none;background:${accent};color:#fff;border-radius:8px;font-size:13px;font-weight:600;padding:8px 18px">Send request</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const done = (v) => { try { ov.remove(); } catch(_){} resolve(v); };
    const titleEl = ov.querySelector('#vxr-title'), byEl = ov.querySelector('#vxr-by');
    ov.querySelector('#vxr-cancel').addEventListener('click', () => done(null));
    ov.addEventListener('click', (e) => { if(e.target === ov) done(null); });
    ov.querySelector('#vxr-ok').addEventListener('click', () => {
      const title = (titleEl.value || '').trim();
      if(!title){ titleEl.style.borderColor = '#dc2626'; titleEl.focus(); return; }
      const by = (byEl.value || '').trim();
      if(!by){ byEl.style.borderColor = '#dc2626'; byEl.focus(); return; }
      done({ title: title, method: ov.querySelector('#vxr-method').value, urgency: ov.querySelector('#vxr-urgency').value, site: (ov.querySelector('#vxr-site').value || '').trim(), scope: (ov.querySelector('#vxr-scope').value || '').trim(), by: by });
    });
    setTimeout(() => { try { titleEl.focus(); } catch(_){} }, 30);
  });
}
async function vxPortalRequestWork(){
  const accent = (_vxPortalData && _vxPortalData.company && _vxPortalData.company.color) || '#185FA5';
  const req = await _vxPortalRequestForm(accent);
  if(!req) return;
  if(typeof toast === 'function') toast('Sending your request…', 'info');
  const res = await vxPortalSubmit('work-request', req);
  if(res.error){ if(typeof toast === 'function') toast(res.error, 'error'); return; }
  if(typeof toast === 'function') toast('Request sent — thank you. We\'ll be in touch.', 'success');
}

// Request a different date for a scheduled job.
function _vxPortalDateForm(accent, job){
  return new Promise((resolve) => {
    const inp = 'width:100%;box-sizing:border-box;margin:0 0 10px;padding:9px 11px;border:1px solid #d6dbe6;border-radius:8px;font-size:13.5px;font-family:inherit';
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(12,18,32,.55);display:flex;align-items:flex-start;justify-content:center;padding:24px 18px;overflow-y:auto';
    ov.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:440px;width:100%;padding:22px;box-shadow:0 12px 40px rgba(12,18,32,.3);font-family:inherit">
      <div style="font-size:16px;font-weight:700;margin-bottom:3px;color:#0b1220">Request a date change</div>
      <div style="font-size:12.5px;color:#6b7589;margin-bottom:14px">${_portalEsc(job ? (job.title || '') : '')}${job && job.startDate ? ' · currently ' + _portalDate(job.startDate) : ''}</div>
      <label style="font-size:11px;font-weight:600;color:#6b7589;text-transform:uppercase;letter-spacing:.04em">Preferred date &amp; time</label>
      <div style="display:flex;gap:10px;margin-top:5px">
        <input id="vxd-date" type="date" style="${inp};flex:1;margin:0 0 10px">
        <input id="vxd-time" type="time" style="${inp};flex:0 0 130px;margin:0 0 10px">
      </div>
      <textarea id="vxd-reason" rows="2" placeholder="Reason (optional)" style="${inp};resize:vertical"></textarea>
      <input id="vxd-by" placeholder="Your name" style="${inp}">
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
        <button id="vxd-cancel" style="cursor:pointer;border:1px solid #d6dbe6;background:#fff;color:#6b7589;border-radius:8px;font-size:13px;padding:8px 16px">Cancel</button>
        <button id="vxd-ok" style="cursor:pointer;border:none;background:${accent};color:#fff;border-radius:8px;font-size:13px;font-weight:600;padding:8px 18px">Send request</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const done = (v) => { try { ov.remove(); } catch(_){} resolve(v); };
    const dateEl = ov.querySelector('#vxd-date'), byEl = ov.querySelector('#vxd-by');
    ov.querySelector('#vxd-cancel').addEventListener('click', () => done(null));
    ov.addEventListener('click', (e) => { if(e.target === ov) done(null); });
    ov.querySelector('#vxd-ok').addEventListener('click', () => {
      if(!dateEl.value){ dateEl.style.borderColor = '#dc2626'; dateEl.focus(); return; }
      const by = (byEl.value || '').trim();
      if(!by){ byEl.style.borderColor = '#dc2626'; byEl.focus(); return; }
      done({ requestedDate: dateEl.value, requestedTime: (ov.querySelector('#vxd-time').value || ''), reason: (ov.querySelector('#vxd-reason').value || '').trim(), by: by });
    });
    setTimeout(() => { try { dateEl.focus(); } catch(_){} }, 30);
  });
}
async function vxPortalRequestDateChange(jobId){
  const data = _vxPortalData; if(!data) return;
  const job = (data.jobs || []).find(j => j.id === jobId) || null;
  const accent = (data.company && data.company.color) || '#185FA5';
  const r = await _vxPortalDateForm(accent, job);
  if(!r) return;
  if(typeof toast === 'function') toast('Sending your request…', 'info');
  const res = await vxPortalSubmit('date-change', { jobId: jobId, jobTitle: job ? job.title : '', requestedDate: r.requestedDate, requestedTime: r.requestedTime, reason: r.reason, by: r.by });
  if(res.error){ if(typeof toast === 'function') toast(res.error, 'error'); return; }
  if(typeof toast === 'function') toast('Date-change request sent — thank you.', 'success');
  _vxPortalReRender();
}

// Re-render the portal from the (possibly optimistically updated) data.
function _vxPortalReRender(){
  const root = document.getElementById('vx-portal-root');
  if(root && _vxPortalData && !_vxPortalData.error) vxPortalRender(root, _vxPortalData);
}

// Entering a portal link after the app already loaded — render the portal.
window.addEventListener('hashchange', function(){
  try { if(vxPortalActive() && !document.getElementById('vx-portal-root')) vxPortalBoot(); } catch(e){}
});

// Build a shareable portal link for a customer (used by the "Generate portal
// link" admin action). Real signed links come from the portal-token Edge
// Function; this builds the local preview link for trial/verification.
function vxPortalLocalLink(customerId){
  const base = location.origin + location.pathname;
  return base + '#/portal/local-' + customerId;
}
