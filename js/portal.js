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
    .map(r => ({ reportNo:r.reportNo, method:r.method, revision:r.revision, createdAt:r.createdAt, verdict:r.verdict, jobId:r.jobId, stage:getReportStage(r), sealedHtml:r.sealedHtml || r.frozenHtml || '' }));
  const quotes = (ls(KEYS.quotes, []) || []).filter(q => q.customerId === customerId && (q.status === 'Sent' || q.status === 'Accepted'));
  const invoices = (ls(KEYS.invoices, []) || []).filter(i => i.customerId === customerId);
  return {
    company: { name:company.name||'', logo:company.logo||'', color:company.color||'#185FA5', footer:company.footer||'' },
    customer: { name:cust.name||'', id:cust.id },
    jobs, reports, quotes, invoices,
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

function vxPortalRender(root, data){
  const accent = (data.company && /^#[0-9A-Fa-f]{6}$/.test(data.company.color || '')) ? data.company.color : '#185FA5';
  const co = data.company || {};
  const reportsByJob = {};
  (data.reports || []).forEach(r => { (reportsByJob[r.jobId] = reportsByJob[r.jobId] || []).push(r); });

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
      const reps = reportsByJob[j.id] || [];
      const repRows = reps.length ? reps.map(r => `<tr>
          <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-family:monospace;font-size:12px;color:${accent}">${_portalEsc(r.reportNo||'—')}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-size:12px">${_portalEsc(r.method||'')} · Rev ${_portalEsc(r.revision||'00')}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-size:11px;color:#6b7589">${_portalDate(r.createdAt)}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;text-align:right">${r.sealedHtml ? `<button data-action="vxPortalOpenReport" data-args="'${_portalEsc(r.reportNo)}'" style="cursor:pointer;border:1px solid ${accent};color:${accent};background:transparent;border-radius:6px;font-size:11px;padding:4px 10px">View / PDF</button>` : '<span style="font-size:11px;color:#9aa5bd">—</span>'}</td>
        </tr>`).join('') : `<tr><td colspan="4" style="padding:10px 8px;color:#9aa5bd;font-size:12px">No issued reports for this job yet.</td></tr>`;
      return `<div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,60,.06);margin-bottom:12px;overflow:hidden">
        <div style="padding:12px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #eef0f4">
          <span style="font-weight:700;font-size:14px">${_portalEsc(j.title||'—')}</span>
          ${_portalBadge(j.status||'Pending', _portalJobStatusColor(j.status))}
          <span style="flex:1"></span>
          <span style="font-size:11px;color:#9aa5bd">${reps.length} report${reps.length===1?'':'s'}</span>
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
      return `<tr>
        <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-family:monospace;font-size:12px;font-weight:600">${_portalEsc(d.number||'—')}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-size:11px;color:#6b7589">${_portalDate(d.issueDate)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #eef0f4">${_portalBadge(status, _portalDocStatusColor(status))}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;text-align:right;font-family:monospace;font-size:12px">${_portalMoney(total, d.currency)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;text-align:right"><button data-action="vxPortalOpenDoc" data-args="'${type}','${_portalEsc(d.id)}'" style="cursor:pointer;border:1px solid ${accent};color:${accent};background:transparent;border-radius:6px;font-size:11px;padding:4px 10px">PDF</button></td>
      </tr>`;
    }).join('');
    return `<h2 style="font-size:15px;margin:24px 0 10px;color:#0b1220">${_portalEsc(title)}</h2>
      <div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,60,.06);overflow:hidden"><table style="width:100%;border-collapse:collapse">${rows}</table></div>`;
  };
  const invoicesHtml = docBlock('Invoices', data.invoices, 'invoice');
  const quotesHtml   = docBlock('Quotes', data.quotes, 'quote');

  const payNote = (data.invoices && data.invoices.some(i => i.status !== 'Paid'))
    ? `<div style="font-size:11px;color:#6b7589;margin-top:8px">To pay an invoice, please use the bank details on the invoice PDF and quote the invoice number.</div>` : '';

  const footer = `<div style="text-align:center;color:#9aa5bd;font-size:11px;margin-top:30px">${_portalEsc(co.footer || co.name || '')}</div>`;

  root.innerHTML = header + _portalShell(accent, jobsHtml + invoicesHtml + payNote + quotesHtml + footer);
}

// ── Downloads ────────────────────────────────────────────────────────────────
function _vxPortalOpenHtml(html){
  if(!html){ if(typeof toast === 'function') toast('Nothing to open.', 'error'); return; }
  const w = window.open('', '_blank');
  if(!w){ if(typeof toast === 'function') toast('Pop-up blocked — allow pop-ups to open the document.', 'error'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
function vxPortalOpenReport(reportNo){
  const r = (_vxPortalData && _vxPortalData.reports || []).find(x => x.reportNo === reportNo);
  _vxPortalOpenHtml(r && r.sealedHtml);
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
  _vxPortalOpenHtml(html);
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
