// ── Imports (generated) ─────────────────────────────────────────────────
import { KEYS,} from './constants.js';
import { _vxSupabase, fmtDate, ls,} from './platform.js';
import { getReportStage,} from './reports.js';
import { escapeHtml,} from './ui.js';

// ═════════════════════════════════════════════════════════════════════════
// Report verification view (V47) — public #/verify/<token>
// ═════════════════════════════════════════════════════════════════════════
// A printed report's QR opens this. The signed token (minted by portal-token
// kind:'verify') is the credential — there is NO app session. report-verify
// returns the report's sealed PDF (frozen HTML) + verification metadata.
// Mirrors the customer portal, but for a single report, read-only.
// ═════════════════════════════════════════════════════════════════════════

function vxVerifyActive(){
  const h = (location.hash || '').replace(/^#\/?/, '');
  return h.indexOf('verify/') === 0;
}
function _vxVerifyToken(){
  const h = (location.hash || '').replace(/^#\/?/, '');
  const m = h.match(/^verify\/(.+)$/);
  return m ? decodeURIComponent(m[1].split('?')[0]) : '';
}

async function vxVerifyFetch(token){
  if(!token) return { error: 'Missing verification token.' };
  if(token.indexOf('local-') === 0){
    return _vxVerifyLocalData(token.slice('local-'.length));
  }
  const sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
  if(sb && sb.functions){
    try {
      const r = await sb.functions.invoke('report-verify', { body: { token } });
      if(r.error){
        let msg = r.error.message || 'Could not verify this report.';
        try { if(r.error.context && typeof r.error.context.json === 'function'){ const j = await r.error.context.json(); if(j && j.error) msg = j.error; } } catch(_){}
        return { error: msg };
      }
      return r.data;
    } catch(e){ return { error: String(e.message || e) }; }
  }
  return { error: 'Verification backend not configured.' };
}

// Local/preview — resolve a report by its key (id || reportNo::revision) from
// localStorage. Only works on the device that created it.
function _vxVerifyLocalData(reportKey){
  const company = (typeof ls === 'function') ? (ls(KEYS.company, {}) || {}) : {};
  const key = (r) => r.id || ((r.reportNo != null) ? (String(r.reportNo) + '::' + String(r.revision || '')) : '');
  const r = (ls(KEYS.reports, []) || []).find(x => key(x) === reportKey);
  if(!r) return { error: 'Report not found in local data (preview link only works on the device that created it).' };
  const stage = (typeof getReportStage === 'function') ? getReportStage(r) : (r.stage || 'Draft');
  if(stage !== 'Approved' && stage !== 'Sent') return { error: 'This report is not an approved version.' };
  return {
    reportNo: r.reportNo, method: r.method, revision: r.revision, verdict: r.verdict, stage: stage,
    createdAt: r.createdAt, approvedBy: r.approvedBy || '', sealedAt: r.sealedAt || '',
    sealedHtml: r.sealedHtml || r.frozenHtml || '',
    company: { name: company.name || '', logo: company.logo || '', color: company.color || '#185FA5' },
  };
}

async function vxVerifyBoot(){
  window._vxPortalMode = true;                 // reuse the portal's app-shell suppression
  try { localStorage.setItem('vx-welcome-seen-v2', '1'); } catch(e){}
  try { const ls0 = document.getElementById('login-screen'); if(ls0) ls0.classList.add('hidden'); } catch(e){}
  try { document.querySelectorAll('.app, #app, .topbar, .topnav').forEach(e => { e.style.display = 'none'; }); } catch(e){}
  const _kill = () => { ['vx-welcome-modal','vx-trial-banner'].forEach(id => { const m = document.getElementById(id); if(m) m.remove(); }); };
  _kill(); setTimeout(_kill, 80); setTimeout(_kill, 350);
  let root = document.getElementById('vx-verify-root');
  if(!root){ root = document.createElement('div'); root.id = 'vx-verify-root'; document.body.appendChild(root); }
  root.style.cssText = "position:fixed;inset:0;z-index:5000;overflow-y:auto;background:#eef0f4;color:#1c2333;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  root.innerHTML = '<div style="max-width:760px;margin:80px auto;text-align:center;color:#6b7589">Verifying report…</div>';
  const data = await vxVerifyFetch(_vxVerifyToken());
  if(!data || data.error){ root.innerHTML = _vxVerifyNotice(data && data.error ? data.error : 'This verification link is invalid.'); return; }
  vxVerifyRender(root, data);
}

function _vxVEsc(s){ return (typeof escapeHtml === 'function') ? escapeHtml(s == null ? '' : String(s)) : String(s == null ? '' : s); }
function _vxVDate(d){ return (d && typeof fmtDate === 'function') ? fmtDate(d) : (d || '—'); }

function _vxVerifyNotice(msg){
  return `<div style="max-width:560px;margin:80px auto;background:#fff;border-radius:14px;padding:40px;text-align:center;box-shadow:0 1px 3px rgba(20,30,60,.08)">
    <div style="font-size:34px;margin-bottom:8px">⚠️</div>
    <div style="font-size:16px;font-weight:700;margin-bottom:6px">Cannot verify this report</div>
    <div style="font-size:13px;color:#6b7589">${_vxVEsc(msg)}</div></div>`;
}

function vxVerifyRender(root, data){
  const accent = (data.company && /^#[0-9A-Fa-f]{6}$/.test(data.company.color || '')) ? data.company.color : '#185FA5';
  const co = data.company || {};
  const verdictColor = data.verdict === 'Acceptable' ? '#16a34a' : (data.verdict === 'Not acceptable' ? '#dc2626' : '#6b7589');
  const logo = co.logo ? `<img src="${_vxVEsc(co.logo)}" alt="" style="height:32px;max-width:150px;object-fit:contain"/>` : '';
  const header = `<div style="background:${accent};color:#fff;padding:18px 22px;display:flex;align-items:center;gap:14px">
    ${logo}<div style="font-weight:700;font-size:16px">${_vxVEsc(co.name || 'Report verification')}</div></div>`;
  const meta = `<div style="background:#fff;padding:20px 22px;border-bottom:1px solid #e6e9ef">
    <div style="display:inline-flex;align-items:center;gap:8px;background:#dcfce7;color:#15803d;border-radius:8px;padding:8px 14px;font-weight:700;font-size:14px;margin-bottom:14px">
      <span style="font-size:17px">✓</span> Verified report</div>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:13px;max-width:460px">
      <div style="color:#6b7589">Report no.</div><div style="font-weight:600">${_vxVEsc(data.reportNo || '—')}${data.revision ? ' · rev ' + _vxVEsc(data.revision) : ''}</div>
      <div style="color:#6b7589">Method</div><div>${_vxVEsc(data.method || '—')}</div>
      <div style="color:#6b7589">Result</div><div><span style="color:${verdictColor};font-weight:600">${_vxVEsc(data.verdict || '—')}</span></div>
      <div style="color:#6b7589">Approved by</div><div>${_vxVEsc(data.approvedBy || '—')}</div>
      <div style="color:#6b7589">Approved on</div><div>${_vxVEsc(_vxVDate(data.sealedAt))}</div>
    </div></div>`;
  const doc = data.sealedHtml
    ? `<iframe srcdoc="${_vxVEsc(data.sealedHtml)}" title="Report document" onload="try{this.style.height=(this.contentDocument.documentElement.scrollHeight+24)+'px'}catch(e){}" style="width:100%;min-height:600px;border:none;background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(20,30,60,.1);margin:18px 0"></iframe>`
    : `<div style="background:#fff;margin:18px 0;padding:24px;border-radius:10px;text-align:center;color:#6b7589;font-size:13px">The full report document isn't attached to this verification.</div>`;
  root.innerHTML = `<div style="max-width:900px;margin:0 auto;padding:0 14px 48px">
    <div style="border-radius:0 0 14px 14px;overflow:hidden;box-shadow:0 1px 3px rgba(20,30,60,.08)">${header}${meta}</div>
    ${doc}
    <div style="text-align:center;color:#9aa3b2;font-size:11px;margin-top:8px">Verified via Veritix</div>
  </div>`;
}

// ── Exports (generated) — only names other modules reference ────────────
export {
  vxVerifyActive, vxVerifyBoot,
};
