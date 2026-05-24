// ══════════════════════════════════════════════
// OVERVIEW PAGE
// ══════════════════════════════════════════════
var _ovMethod = null;
// Working copy of the inspected-items table while the new-report form is
// open. Held outside the DOM so + Add row / − Remove row can re-render the
// section without losing typed-but-unsaved values from sibling rows.
var _ovItems = [{}];
// Photo-page working copy — null when the inspector hasn't added a
// photo page to this report; otherwise an array of (currently) 6 slots
// holding base64 image data or null for an empty slot. Length 0 = page
// not added; length > 0 = page added, slots possibly empty.
var _ovPhotos = [];
// Optional per-photo caption typed by the inspector under each slot —
// parallel to _ovPhotos (same index = same slot). Empty string when no
// caption was typed; persisted to report.photoCaptions on save (only
// when the slot also carries a photo, so captions don't outlive their
// images).
var _ovPhotoCaptions = [];
// Per-report images for any single-photo blocks present in the active
// method's template. Map of block.id → dataURL; missing key = empty slot.
// Each single-photo block in the template surfaces one upload tile in the
// new-report Photos section and stores its image under its own block.id
// so multiple single-photo blocks can coexist without aliasing.
var _ovSinglePhotos = {};
// Per-report typed text for any photo-details block in the active
// template. Map of photo-details block.id → string. The new-report form
// surfaces each photo-details block as a textarea below its linked
// single-photo upload tile (or as a standalone tile when no link is
// set); persisted to report.photoDetails on save.
var _ovPhotoDetails = {};
// Snapshot of the revision number when the new-report form opened. Used
// to detect whether the user has bumped the revision so the save handler
// can demand a reason (required) and append a row to report.revisions.
var _ovRevisionOriginal = '';
// Set when an existing saved report has been opened for revision (via
// ovOpenReport). Holds the original report record. ovSaveReport uses it
// to keep the same report number, write a NEW record at the next
// revision, carry the revision history forward, and skip the numbering
// counter. Null for a fresh new report.
var _ovReviseSource = null;
// Next-revision string from a numeric revision ("00" → "01", "01" → "02").
function _ovBumpRevision(rev){
  return String((parseInt(rev, 10) || 0) + 1).padStart(2, '0');
}
// Overall report verdict rolled up from the inspected-items results —
// worst case wins. '' when no row carries a result yet.
function _ovOverallVerdict(items){
  const vs = (items || []).map(it => ((it && it.verdict) || '').trim()).filter(Boolean);
  if(!vs.length) return '';
  // A mix of accepted and rejected items isn't a single pass/fail
  // outcome — report it as "Various" (shown amber in the lists).
  if(vs.includes('Acceptable') && vs.includes('Not acceptable')) return 'Various';
  if(vs.includes('Not acceptable'))  return 'Not acceptable';
  if(vs.includes('Inconclusive'))    return 'Inconclusive';
  if(vs.includes('For information')) return 'For information';
  if(vs.every(v => v === 'Acceptable')) return 'Acceptable';
  return vs[0];
}
// True when the form-built report differs in any editable content from
// its revision source. Metadata (revision, dates, audit, history,
// derived equipment-snapshot ids) is ignored, so reopening and re-saving
// with no edits creates no revision.
function _ovReportChanged(next, src){
  if(!src) return true;
  const skip = new Set(['revision','revisions','revisedFrom','createdAt','createdBy',
    'updatedAt','auditLog','stage','id','eq_id','eq_svid','eq_caldate','frozenHtml',
    'witness','procRev']);
  const norm = v => JSON.stringify(v == null ? '' : v);
  const keys = new Set([...Object.keys(next || {}), ...Object.keys(src || {})]);
  for(const k of keys){
    if(skip.has(k)) continue;
    if(norm(next[k]) !== norm(src[k])) return true;
  }
  return false;
}
// Set when a non-admin opens a new report for a method their
// certification doesn't cover (missing / expired). Holds the reason
// string; ovSaveReport refuses to save while it's set.
var _ovSignBlockReason = null;

// Resolve the logged-in user to their inspector-directory record, by
// email first (reliable) then name. Returns null when there's no
// match — used to check the signer's per-method certification.
function _ovCurrentUserInspector() {
  if(typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return null;
  const list = (typeof INSPECTORS !== 'undefined' && Array.isArray(INSPECTORS) && INSPECTORS.length)
    ? INSPECTORS
    : ((typeof ls === 'function') ? ls('vx-inspectors-v1', []) : []);
  const email = (CURRENT_USER.email || '').toLowerCase().trim();
  const name  = (CURRENT_USER.name  || '').toLowerCase().trim();
  return list.find(i => email && (i.email || '').toLowerCase().trim() === email)
      || list.find(i => name  && (i.name  || '').toLowerCase().trim() === name)
      || null;
}

function ovInit() {
  // Build new report method buttons
  const wrap = el('ov-new-report-btns'); if(!wrap) return;
  const methods = getActiveMethods();
  wrap.innerHTML = methods.map(m => `
    <button class="snav-item" data-action="ovNewReport" data-pass-el="1" data-args="'${m.id}'" style="gap:9px">
      <span style="width:8px;height:8px;border-radius:50%;background:${m.color};flex-shrink:0"></span>
      New ${m.id} report
    </button>
  `).join('');
  ovRefreshDashboard();
}

function ovShowSection(id, btn) {
  document.querySelectorAll('#page-overview .ss').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('#ov-snav .snav-item').forEach(b => b.classList.remove('active'));
  const sec = el('ov-' + id); if(sec) sec.classList.add('active');
  if(btn) btn.classList.add('active');
  if(id === 'dashboard') ovRefreshDashboard();
  if(id === 'recent') ovRenderRecentList();
  if(id === 'procedures') procInitView();
}

// V8: Date range state for dashboard
var _ovDateRange = 30; // days, or 'all'
function ovSetDateRange(range){
  _ovDateRange = range;
  document.querySelectorAll('#ov-dr-selector .dr-opt').forEach(b => {
    b.classList.toggle('active', String(b.dataset.range) === String(range));
  });
  ovRefreshDashboard();
}
function ovFilterByRange(reports){
  if(_ovDateRange === 'all') return reports;
  const days = parseInt(_ovDateRange);
  if(!days) return reports;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return reports.filter(r => {
    if(!r.createdAt) return false;
    const t = new Date(r.createdAt).getTime();
    return t >= cutoff;
  });
}

function ovRefreshDashboard() {
  const allReports = ls(KEYS.reports, []);
  const reports = ovFilterByRange(allReports);
  const methods = getActiveMethods();
  const total = reports.length;
  const passed = reports.filter(r => r.verdict === 'Acceptable').length;
  const passRate = total ? Math.round(passed / total * 100) : 0;
  const defects = reports.filter(r => r.verdict === 'Not acceptable').length;
  const activeMethodCount = methods.filter(m => reports.some(r => r.method === m.id)).length;
  const mC = m => reports.filter(r => r.method === m).length;
  const mP = m => { const rs = reports.filter(r => r.method === m); return rs.length ? Math.round(rs.filter(r => r.verdict === 'Acceptable').length / rs.length * 100) : 0; };

  // Subtitle — use the user's locale for date formatting and a translated
  // "X methods" label so the dashboard speaks the user's language.
  const methodsLabel = methods.length === 1
    ? t('lbl.method', '1 method')
    : tf('lbl.x_methods', '{n} methods', { n: methods.length });
  const loc = (typeof vxLocale === 'function' ? vxLocale() : 'en-GB');
  const dateLabel = new Date().toLocaleDateString(loc, {month:'long', year:'numeric'});
  set('ov-dash-sub', `${methodsLabel} · ${dateLabel}`);

  // Sparkline data — last 7 days
  const totalSpark = generate7DaySparkline(reports, 'createdAt');
  const failSpark = generate7DaySparkline(reports.filter(r => r.verdict === 'Not acceptable'), 'createdAt');
  const passSpark = generate7DaySparkline(reports.filter(r => r.verdict === 'Acceptable'), 'createdAt');
  const methodSpark = methods.map((_, i) => activeMethodCount > i ? Math.max(1, Math.round(activeMethodCount * (0.5 + i * 0.08))) : 0);

  // Trend (last 3 days vs previous 3)
  const trendOf = arr => {
    const recent = arr.slice(-3).reduce((a,b) => a+b, 0);
    const prior  = arr.slice(0, 3).reduce((a,b) => a+b, 0);
    if(prior === 0 && recent === 0) return { label: '0%', cls: 'flat' };
    if(prior === 0) return { label: '+new', cls: 'up' };
    const pct = Math.round(((recent - prior) / Math.max(1, prior)) * 100);
    if(pct > 0)  return { label: '+' + pct + '%', cls: 'up' };
    if(pct < 0)  return { label: pct + '%', cls: 'down' };
    return { label: '0%', cls: 'flat' };
  };
  const tTotal  = trendOf(totalSpark);
  const tFail   = trendOf(failSpark);
  const tPass   = trendOf(passSpark);

  // Trend arrows
  const arrowFor = cls => cls === 'up'   ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 14 12 8 18 14"/></svg>'
                       : cls === 'down' ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 10 12 16 18 10"/></svg>'
                       :                  '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';

  // Metric tiles — refined with sparklines and trend pills
  const metricsEl = el('ov-metrics');
  if(metricsEl) metricsEl.innerHTML = `
    <div class="dash-met" data-action="ovDrillMetric" data-args="'total'" style="cursor:pointer" title="${t('dash.tip_all','Click to see all reports in this period')}">
      <div class="dash-met-glow" style="background:var(--cyan)"></div>
      <div class="dash-met-head">
        <div class="dash-met-label" data-i18n="dash.total_reports">Total reports</div>
        <div class="dash-met-icon" style="background:rgba(0,212,255,.10);color:var(--cyan)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
      </div>
      <div class="dash-met-val">${total}<span class="dash-met-trend ${tTotal.cls}">${arrowFor(tTotal.cls)} ${tTotal.label}</span></div>
      <div class="dash-met-sub">vs previous 3-day window</div>
      ${sparklineSVG(totalSpark, '#00d4ff')}
    </div>
    <div class="dash-met" data-action="ovDrillMetric" data-args="'fail'" style="cursor:pointer" title="${t('dash.tip_fail','Click to see failed reports')}">
      <div class="dash-met-glow" style="background:var(--red)"></div>
      <div class="dash-met-head">
        <div class="dash-met-label" data-i18n="dash.not_acceptable">Not acceptable</div>
        <div class="dash-met-icon" style="background:rgba(242,92,92,.10);color:var(--red)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
      </div>
      <div class="dash-met-val" style="color:var(--red)">${defects}<span class="dash-met-trend ${tFail.cls === 'up' ? 'down' : tFail.cls === 'down' ? 'up' : 'flat'}">${arrowFor(tFail.cls)} ${tFail.label}</span></div>
      <div class="dash-met-sub">of ${total} reports flagged</div>
      ${sparklineSVG(failSpark, '#f25c5c')}
    </div>
    <div class="dash-met" data-action="ovDrillMetric" data-args="'pass'" style="cursor:pointer" title="${t('dash.tip_pass','Click to see passing reports')}">
      <div class="dash-met-glow" style="background:var(--green)"></div>
      <div class="dash-met-head">
        <div class="dash-met-label" data-i18n="dash.pass_rate">Pass rate</div>
        <div class="dash-met-icon" style="background:rgba(62,207,142,.10);color:var(--green)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
      </div>
      <div class="dash-met-val" style="color:var(--green)">${passRate}%<span class="dash-met-trend ${tPass.cls}">${arrowFor(tPass.cls)} ${tPass.label}</span></div>
      <div class="dash-met-sub">${passed} of ${total} acceptable</div>
      ${sparklineSVG(passSpark, '#3ecf8e')}
    </div>
    <div class="dash-met" data-action="ovDrillMetric" data-args="'drafts'" style="cursor:pointer" title="Click to see drafts in progress">
      <div class="dash-met-glow" style="background:var(--cyan)"></div>
      <div class="dash-met-head">
        <div class="dash-met-label">Methods active</div>
        <div class="dash-met-icon" style="background:rgba(0,153,204,.10);color:var(--cyan2)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v6.5a2 2 0 0 0 .35 1.13l5.3 7.66a2 2 0 0 1-1.65 3.13H6a2 2 0 0 1-1.65-3.13l5.3-7.66A2 2 0 0 0 10 8.5V2"/><path d="M9 2h6"/></svg>
        </div>
      </div>
      <div class="dash-met-val">${activeMethodCount}<span style="font-size:14px;color:var(--t3);font-weight:500"> / ${methods.length}</span></div>
      <div class="dash-met-sub">${methods.length - activeMethodCount} methods unused</div>
      <div class="dash-met-bar"><div class="dash-met-bar-fill" style="width:${methods.length?activeMethodCount*100/methods.length:0}%;background:var(--cyan2)"></div></div>
    </div>`;

  // Method cards
  const mcardsEl = el('ov-mcards');
  if(mcardsEl) mcardsEl.innerHTML = methods.map(m => {
    const failed = reports.filter(r => r.method === m.id && r.verdict === 'Not acceptable').length;
    return `
    <div class="dash-mc" data-action="ovNewReport" data-args="'${m.id}'" style="border-color:${m.color}33">
      <style>#dmc-${m.id}::before{background:${m.color}!important}</style>
      <div id="dmc-${m.id}" style="position:absolute;left:0;top:0;bottom:0;width:3px;background:${m.color};opacity:.85"></div>
      <div class="dash-mc-code" style="color:${m.color}">${m.id}</div>
      <div class="dash-mc-name">${escapeHtml(m.name)}</div>
      <div class="dash-mc-stats">
        <div><div class="dash-mc-sl">Reports</div><div class="dash-mc-sv">${mC(m.id)}</div></div>
        <div><div class="dash-mc-sl">Pass rate</div><div class="dash-mc-sv" style="color:${mP(m.id)>=90?'var(--green)':mP(m.id)>=70?'var(--amber)':'var(--red)'}">${mP(m.id)}%</div></div>
        <div><div class="dash-mc-sl">Failed</div><div class="dash-mc-sv" style="color:${failed>0?'var(--red)':'var(--t1)'}">${failed}</div></div>
      </div>
    </div>`;
  }).join('');

  // Recent reports table
  const recentEl = el('ov-dash-recent');
  if(recentEl) {
    const recent = reports.slice(-5).reverse();
    recentEl.innerHTML = recent.length ? recent.map(r => {
      const md = NDT_METHODS.find(x => x.id === r.method);
      // Status timeline based on verdict
      const ok = r.verdict === 'Acceptable';
      const fail = r.verdict === 'Not acceptable';
      const stepsHtml = `<div class="status-timeline" title="Draft → Submitted → Reviewed → Result">
        <div class="status-step done"></div>
        <div class="status-step done"></div>
        <div class="status-step done"></div>
        <div class="status-step ${fail ? 'failed' : ok ? 'done' : 'active'}"></div>
      </div>`;
      const verdictBadge = `<span class="badge badge-${ok?'green':fail?'red':'blue'}">${r.verdict||'Draft'}</span>`;
      return `<tr>
        <td style="font-family:var(--mono);font-size:12px;color:var(--cyan)">${r.reportNo||'—'}</td>
        <td><span class="badge mono" style="background:${(md?.color||'#5a6880')+'1a'};color:${md?.color||'#5a6880'};box-shadow:inset 0 0 0 1px ${(md?.color||'#5a6880')+'33'}">${r.method}</span></td>
        <td>${escapeHtml(r.subject||r.client||'—')}</td>
        <td>${escapeHtml(r.inspector||'—')}</td>
        <td style="font-family:var(--mono);font-size:11px;color:var(--t3)">${fmtDate(r.createdAt)}</td>
        <td style="white-space:nowrap">${verdictBadge}</td>
        <td>${stepsHtml}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="7" style="padding:0">
      <div class="empty-state" style="padding:40px 20px">
        <div class="empty-state-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
        </div>
        <div class="empty-state-title">${escapeHtml(t('ov.empty.recent_title', 'No reports yet'))}</div>
        <div class="empty-state-desc">${escapeHtml(t('ov.empty.recent_body', 'Create your first inspection report to start tracking results, defects, and method coverage.'))}</div>
        <div class="empty-state-actions"><button class="btn btn-primary btn-sm" data-action="_wOvNewReportFromActiveMethod">${escapeHtml(t('ov.empty.recent_cta', '+ New report'))}</button></div>
      </div>
    </td></tr>`;
  }

  // Add the status column header if missing
  const recentTable = recentEl ? recentEl.closest('table') : null;
  if(recentTable) {
    const ths = recentTable.querySelectorAll('thead th');
    if(ths.length === 6) {
      const th = document.createElement('th');
      th.textContent = t('col.status', 'Status');
      recentTable.querySelector('thead tr').appendChild(th);
    }
  }

  // Severity bars
  const sevEl = el('ov-dash-sevbars');
  if(sevEl) {
    const sevs = ['Critical','High','Medium','Low'];
    const sevColors = {Critical:'var(--sev-critical)',High:'var(--sev-high)',Medium:'var(--sev-medium)',Low:'var(--sev-low)'};
    const sevCounts = {};
    sevs.forEach(s => sevCounts[s] = 0);
    const maxSev = Math.max(1, ...Object.values(sevCounts));
    sevEl.innerHTML = sevs.map(s => `
      <div class="sev-row">
        <div class="sev-label">${s}</div>
        <div class="sev-track"><div class="sev-fill" style="width:${Math.round(sevCounts[s]/maxSev*100)}%;background:${sevColors[s]}"></div></div>
        <div class="sev-count">${sevCounts[s]}</div>
      </div>
    `).join('');
  }

  // Activity feed with proper SVG icons
  const actEl = el('ov-dash-activity');
  if(actEl) {
    const recent5 = reports.slice(-6).reverse();
    if(recent5.length) {
      actEl.innerHTML = recent5.map(r => {
        const md = NDT_METHODS.find(x => x.id === r.method);
        const isOk = r.verdict === 'Acceptable';
        const isFail = r.verdict === 'Not acceptable';
        const iconBg = isOk ? 'rgba(62,207,142,.10)' : isFail ? 'rgba(242,92,92,.10)' : (md?.color || '#5a6880') + '20';
        const iconColor = isOk ? 'var(--green)' : isFail ? 'var(--red)' : md?.color || 'var(--t2)';
        const iconSvg = isOk
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
          : isFail
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
        const verb = isFail ? 'flagged' : isOk ? 'passed' : 'created';
        return `<div class="act-item">
          <div class="act-icon" style="background:${iconBg};color:${iconColor}">${iconSvg}</div>
          <div style="flex:1;min-width:0">
            <div class="act-text">${r.method} report <strong>${r.reportNo||''}</strong> ${verb}${r.client?' for '+escapeHtml(r.client):''}</div>
            <div class="act-time">${fmtDate(r.createdAt)}</div>
          </div>
        </div>`;
      }).join('');
    } else {
      actEl.innerHTML = `<div class="empty-state" style="padding:24px 12px">
        <div class="empty-state-icon" style="width:44px;height:44px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
        <div style="font-size:13px;color:var(--t3)">No activity yet.</div>
      </div>`;
    }
  }

  // Refresh notification badge
  if(typeof refreshNotifBadge === 'function') refreshNotifBadge();

  // V8: Render heatmap, top defect types, leaderboard, expiry timeline
  try { ovRenderHeatmap(allReports); } catch(e){ console.warn('heatmap', e); }
  try { ovRenderDefectTypes(); } catch(e){ console.warn('defect types', e); }
  try { ovRenderLeaderboard(reports); } catch(e){ console.warn('leaderboard', e); }
  try { ovRenderExpiryTimeline(); } catch(e){ console.warn('expiry timeline', e); }
  try { ovRenderGeoMap(); } catch(e){ console.warn('geo map', e); }
}

// ══════════════════════════════════════════════════════════════════════════
// V8 ANALYTICS — heatmap, leaderboard, defect types, expiry timeline, drill-down
// ══════════════════════════════════════════════════════════════════════════

// Calendar heatmap of inspection activity (past 12 months)
function ovRenderHeatmap(allReports){
  const wrap = el('ov-heatmap-grid');
  const wrapper = el('ov-heatmap-wrap');
  if(!wrap || !wrapper) return;
  if(!allReports.length){ wrapper.style.display = 'none'; return; }
  wrapper.style.display = 'block';

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const counts = {};
  allReports.forEach(r => {
    if(!r.createdAt) return;
    const d = new Date(r.createdAt);
    if(isNaN(d)) return;
    const key = d.toISOString().split('T')[0];
    counts[key] = (counts[key] || 0) + 1;
  });
  const max = Math.max(1, ...Object.values(counts));
  // V30: use the user's locale for month abbreviations so the heatmap reads
  // naturally in any language (Jan/Feb in English, Janv/Févr in French, etc.).
  const loc = (typeof vxLocale === 'function' ? vxLocale() : 'en-GB');
  const monthFmt = new Intl.DateTimeFormat(loc, { month: 'short' });
  const dateFmt  = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', year: 'numeric' });

  let html = '';
  for(let m = 0; m < 12; m++){
    const mo = new Date(start.getFullYear(), start.getMonth() + m, 1);
    const monthName = monthFmt.format(mo);
    const daysIn = new Date(mo.getFullYear(), mo.getMonth() + 1, 0).getDate();
    let cells = '';
    for(let d = 1; d <= daysIn; d++){
      const dateObj = new Date(mo.getFullYear(), mo.getMonth(), d);
      const key = dateObj.toISOString().split('T')[0];
      const c = counts[key] || 0;
      let lvl = '';
      if(c > 0){
        const ratio = c / max;
        if(ratio > 0.75) lvl = 'l4';
        else if(ratio > 0.5) lvl = 'l3';
        else if(ratio > 0.25) lvl = 'l2';
        else lvl = 'l1';
      }
      // V30: tooltip uses the same locale-aware date format.
      const tip = tf('ov.heat.tooltip', '{n} report(s) on {date}', { n: c, date: dateFmt.format(dateObj) });
      cells += `<div class="heatmap-cell ${lvl}" title="${escapeHtml(tip)}" data-action="ovDrillDate" data-args="'${key}'"></div>`;
    }
    html += `<div class="heatmap-month-col"><div class="heatmap-month-lbl">${escapeHtml(monthName)}</div>${cells}</div>`;
  }
  wrap.innerHTML = html;
}

function ovDrillDate(yyyyMMdd){
  const all = ls(KEYS.reports, []);
  const matches = all.filter(r => r.createdAt && r.createdAt.startsWith(yyyyMMdd));
  ovOpenDrilldown(`Reports on ${yyyyMMdd}`, matches);
}

// Top defect types as horizontal bar chart
function ovRenderDefectTypes(){
  const wrap = el('ov-defect-types'); if(!wrap) return;
  const all = ls(KEYS.defects, []);
  const filtered = (_ovDateRange === 'all') ? all : all.filter(d => {
    if(!d.createdAt) return false;
    const t = new Date(d.createdAt).getTime();
    return t >= Date.now() - parseInt(_ovDateRange) * 24 * 60 * 60 * 1000;
  });
  if(!filtered.length){
    wrap.innerHTML = `<div style="font-size:12px;color:var(--t3);text-align:center;padding:20px">${escapeHtml(t('ov.no_data','No data in this period'))}</div>`;
    return;
  }
  const counts = {};
  filtered.forEach(d => { const t = d.type || 'Unknown'; counts[t] = (counts[t]||0) + 1; });
  const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 8);
  const max = sorted[0][1];
  wrap.innerHTML = `<div class="barchart">${sorted.map(([type, c]) => `
    <div class="barchart-row" data-action="ovDrillDefectType" data-args="${JSON.stringify(type).replace(/"/g,'&quot;')}" style="cursor:pointer">
      <div class="barchart-label" title="${escapeHtml(type)}">${escapeHtml(type)}</div>
      <div class="barchart-track"><div class="barchart-fill" style="width:${(c/max*100).toFixed(1)}%"></div></div>
      <div class="barchart-count">${c}</div>
    </div>`).join('')}</div>`;
}

function ovDrillDefectType(type){
  const all = ls(KEYS.defects, []);
  const matches = all.filter(d => (d.type||'Unknown') === type);
  ovOpenDefectDrilldown(`${type} defects (${matches.length})`, matches);
}

// Inspector leaderboard
function ovRenderLeaderboard(reports){
  const wrap = el('ov-leaderboard'); if(!wrap) return;
  const stats = {};
  reports.forEach(r => {
    const name = r.inspector || 'Unknown';
    if(!stats[name]) stats[name] = { name, total: 0, passed: 0, failed: 0, drafts: 0 };
    stats[name].total++;
    if(r.verdict === 'Acceptable') stats[name].passed++;
    else if(r.verdict === 'Not acceptable') stats[name].failed++;
    if(getReportStage(r) === 'Draft') stats[name].drafts++;
  });
  const sorted = Object.values(stats).sort((a,b) => b.total - a.total).slice(0, 8);
  if(!sorted.length){
    wrap.innerHTML = `<div style="font-size:12px;color:var(--t3);text-align:center;padding:20px">${escapeHtml(t('ov.no_data','No data in this period'))}</div>`;
    return;
  }
  // V30: translated column headers
  const lbCols = {
    rank:      t('lb.col.rank',      '#'),
    inspector: t('lb.col.inspector', 'Inspector'),
    reports:   t('lb.col.reports',   'Reports'),
    pass_pct:  t('lb.col.pass_pct',  'Pass %'),
    drafts:    t('lb.col.drafts',    'Drafts'),
  };
  let html = `<div class="lb-row" style="border-bottom:1px solid var(--border);background:var(--panel2);font-size:9px;font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--t3);padding-top:8px;padding-bottom:8px">
    <div style="text-align:center">${escapeHtml(lbCols.rank)}</div><div>${escapeHtml(lbCols.inspector)}</div><div style="text-align:right">${escapeHtml(lbCols.reports)}</div><div style="text-align:right">${escapeHtml(lbCols.pass_pct)}</div><div style="text-align:right">${escapeHtml(lbCols.drafts)}</div>
  </div>`;
  sorted.forEach((s, i) => {
    const passPct = s.total ? Math.round(s.passed / s.total * 100) : 0;
    const passColor = passPct >= 90 ? 'var(--green)' : passPct >= 70 ? 'var(--amber)' : 'var(--red)';
    const ini = initials(s.name);
    html += `<div class="lb-row">
      <div class="lb-rank ${i<3?'top':''}">${i+1}</div>
      <div class="lb-name"><div class="lb-avatar" style="background:${uaGrad(s.name)}">${ini}</div>${escapeHtml(s.name)}</div>
      <div class="lb-num">${s.total}</div>
      <div class="lb-num" style="color:${passColor}">${s.total ? passPct+'%' : '—'}</div>
      <div class="lb-num ${s.drafts?'':'dim'}">${s.drafts}</div>
    </div>`;
  });
  wrap.innerHTML = html;
}

// Cert / calibration expiry timeline (Gantt-style, 6-month horizon)
function ovRenderExpiryTimeline(){
  const wrap = el('ov-expiry-timeline'); if(!wrap) return;
  const inspectors = ls(KEYS.inspectors, []);
  const now = Date.now();
  const horizonMs = 180 * 24 * 60 * 60 * 1000;
  const horizon = now + horizonMs;
  const items = [];
  inspectors.forEach(ins => {
    // One alert per method certificate — per-method certs mean an
    // inspector can have several expiry dates, each tracked separately.
    _inspCertList(ins).forEach(c => {
      if(!c.expiry) return;
      const expMs = new Date(c.expiry).getTime();
      if(isNaN(expMs)) return;
      if(expMs < now - 30*24*60*60*1000) return;
      if(expMs > horizon) return;
      items.push({ kind: 'cert', name: ins.name, label: 'Cert · ' + c.method, expMs });
    });
  });
  if(!items.length){
    wrap.innerHTML = '<div style="font-size:12px;color:var(--t3);text-align:center;padding:24px">No certifications expiring in the next 6 months — all clear.</div>';
    return;
  }
  items.sort((a,b) => a.expMs - b.expMs);
  const startMs = now - 7 * 24 * 60 * 60 * 1000;
  const rangeMs = horizonMs + 7 * 24 * 60 * 60 * 1000;
  const todayPct = ((now - startMs) / rangeMs) * 100;
  let html = '';
  items.forEach(it => {
    const days = Math.round((it.expMs - now) / (1000*60*60*24));
    const expired = days < 0;
    const urgent = !expired && days < 30;
    const color = expired ? 'var(--red)' : urgent ? 'var(--amber)' : 'var(--green)';
    const startPct = Math.max(0, ((now - startMs) / rangeMs) * 100);
    const endPct = Math.max(startPct + 1, ((it.expMs - startMs) / rangeMs) * 100);
    const widthPct = endPct - startPct;
    html += `<div class="timeline-row">
      <div style="font-size:12px;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}<div style="font-size:10px;color:var(--t3);margin-top:2px">${escapeHtml(it.label)}</div></div>
      <div class="timeline-track">
        <div class="timeline-today" style="left:${todayPct.toFixed(2)}%"></div>
        <div class="timeline-bar" style="left:${startPct.toFixed(2)}%;width:${widthPct.toFixed(2)}%;background:${color}">${expired ? `EXPIRED ${Math.abs(days)}d ago` : `${days}d → ${fmtDate(new Date(it.expMs).toISOString())}`}</div>
      </div>
      <div style="font-family:var(--mono);font-size:11px;color:${color};text-align:right">${expired ? '⚠ Expired' : days+' days'}</div>
    </div>`;
  });
  wrap.innerHTML = html;
}

// V9: Geographic distribution of inspections via Leaflet
// Strategy: maintain a small inline geocode cache for common refinery / port / industrial-hub cities.
// If a report's "location" field matches one of those, we plot a marker. Unmatched locations are
// listed underneath the map with a hint to add lat/lng manually. Locations with explicit numeric
// coordinates (locationLat / locationLng on the report) are always plotted regardless of name.
var GEO_CACHE = {
  // Major industrial / refinery hubs — focused on Europe + N. America since user is in NL
  'rotterdam':       [51.9244, 4.4777],
  'amsterdam':       [52.3676, 4.9041],
  'utrecht':         [52.0907, 5.1214],
  'eindhoven':       [51.4416, 5.4697],
  'antwerp':         [51.2194, 4.4025],
  'antwerpen':       [51.2194, 4.4025],
  'brussels':        [50.8503, 4.3517],
  'london':          [51.5074, -0.1278],
  'felixstowe':      [51.9622, 1.3517],
  'manchester':      [53.4808, -2.2426],
  'aberdeen':        [57.1497, -2.0943],
  'newcastle':       [54.9783, -1.6178],
  'glasgow':         [55.8642, -4.2518],
  'edinburgh':       [55.9533, -3.1883],
  'le havre':        [49.4944, 0.1079],
  'paris':           [48.8566, 2.3522],
  'marseille':       [43.2965, 5.3698],
  'hamburg':         [53.5511, 9.9937],
  'bremen':          [53.0793, 8.8017],
  'duisburg':        [51.4344, 6.7623],
  'frankfurt':       [50.1109, 8.6821],
  'munich':          [48.1351, 11.5820],
  'berlin':          [52.5200, 13.4050],
  'milan':           [45.4642, 9.1900],
  'genoa':           [44.4056, 8.9463],
  'naples':          [40.8518, 14.2681],
  'barcelona':       [41.3851, 2.1734],
  'madrid':          [40.4168, -3.7038],
  'valencia':        [39.4699, -0.3763],
  'bilbao':          [43.2630, -2.9350],
  'lisbon':          [38.7223, -9.1393],
  'porto':           [41.1579, -8.6291],
  'dublin':          [53.3498, -6.2603],
  'copenhagen':      [55.6761, 12.5683],
  'oslo':            [59.9139, 10.7522],
  'stavanger':       [58.9700, 5.7331],
  'bergen':          [60.3913, 5.3221],
  'stockholm':       [59.3293, 18.0686],
  'gothenburg':      [57.7089, 11.9746],
  'helsinki':        [60.1699, 24.9384],
  'gdansk':          [54.3520, 18.6466],
  'warsaw':          [52.2297, 21.0122],
  'prague':          [50.0755, 14.4378],
  'vienna':          [48.2082, 16.3738],
  'zurich':          [47.3769, 8.5417],
  'geneva':          [46.2044, 6.1432],
  'houston':         [29.7604, -95.3698],
  'galveston':       [29.3013, -94.7977],
  'corpus christi':  [27.8006, -97.3964],
  'baton rouge':     [30.4515, -91.1871],
  'new orleans':     [29.9511, -90.0715],
  'philadelphia':    [39.9526, -75.1652],
  'newark':          [40.7357, -74.1724],
  'long beach':      [33.7701, -118.1937],
  'los angeles':     [34.0522, -118.2437],
  'oakland':         [37.8044, -122.2712],
  'seattle':         [47.6062, -122.3321],
  'vancouver':       [49.2827, -123.1207],
  'calgary':         [51.0447, -114.0719],
  'edmonton':        [53.5461, -113.4938],
  'fort mcmurray':   [56.7264, -111.3803],
  'singapore':       [1.3521, 103.8198],
  'jurong':          [1.3329, 103.7436],
  'shanghai':        [31.2304, 121.4737],
  'busan':           [35.1796, 129.0756],
  'ulsan':           [35.5384, 129.3114],
  'mumbai':          [19.0760, 72.8777],
  'dubai':           [25.2048, 55.2708],
  'abu dhabi':       [24.4539, 54.3773],
  'doha':            [25.2854, 51.5310],
  'jeddah':          [21.4858, 39.1925],
  'sydney':          [-33.8688, 151.2093],
  'perth':           [-31.9523, 115.8613],
  'melbourne':       [-37.8136, 144.9631],
  'rio de janeiro':  [-22.9068, -43.1729],
  'sao paulo':       [-23.5505, -46.6333],
};

function _geoLookup(loc){
  if(!loc) return null;
  const key = String(loc).toLowerCase().trim();
  if(GEO_CACHE[key]) return GEO_CACHE[key];
  // Try suffix-strip ("Rotterdam, NL" → "rotterdam")
  const before = key.split(',')[0].trim();
  if(GEO_CACHE[before]) return GEO_CACHE[before];
  // Try first word
  const first = key.split(/[\s,;\/]+/)[0];
  if(GEO_CACHE[first]) return GEO_CACHE[first];
  return null;
}

var _geoMap = null;        // The Leaflet map instance
var _geoMarkers = [];      // For cleanup on re-render

function ovRenderGeoMap(){
  const wrap = el('ov-geomap');
  const wrapper = el('ov-geomap-wrap');
  if(!wrap || !wrapper) return;

  // Wait for Leaflet
  if(!window._leafletReady || typeof L === 'undefined'){
    wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--t3);font-size:12px;font-family:var(--mono)">Loading map…</div>';
    return;
  }

  const reports = ls(KEYS.reports, []);
  if(!reports.length){
    wrapper.style.display = 'none';
    return;
  }
  wrapper.style.display = 'block';

  // Group reports by lat/lng (or city)
  const buckets = new Map();
  const orphans = []; // locations we can't geocode
  reports.forEach(r => {
    if(typeof r.locationLat === 'number' && typeof r.locationLng === 'number'){
      const k = r.locationLat.toFixed(3)+','+r.locationLng.toFixed(3);
      const e = buckets.get(k) || { lat: r.locationLat, lng: r.locationLng, label: r.location || (r.locationLat+', '+r.locationLng), reports: [] };
      e.reports.push(r);
      buckets.set(k, e);
      return;
    }
    const coord = _geoLookup(r.location);
    if(coord){
      const k = coord.join(',');
      const e = buckets.get(k) || { lat: coord[0], lng: coord[1], label: r.location, reports: [] };
      e.reports.push(r);
      buckets.set(k, e);
    } else if(r.location){
      orphans.push(r);
    }
  });

  // Build / reset map
  if(_geoMap){
    _geoMarkers.forEach(m => _geoMap.removeLayer(m));
    _geoMarkers = [];
  } else {
    wrap.innerHTML = '';
    _geoMap = L.map(wrap, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 18,
    }).addTo(_geoMap);
  }

  // Plot markers
  const bounds = [];
  buckets.forEach(b => {
    const reports = b.reports || [];
    const failCount = reports.filter(r => r.verdict === 'Not acceptable').length;
    const color = failCount > 0 ? '#f25c5c' : '#3ecf8e';
    const radius = Math.min(28, 8 + Math.sqrt(reports.length) * 4);
    const marker = L.circleMarker([b.lat, b.lng], {
      radius, color, weight: 2, fillColor: color, fillOpacity: .35,
    }).addTo(_geoMap);
    const list = b.reports.slice(0, 8).map(r => `
      <li style="margin:4px 0">
        <strong style="color:#0a4">${escapeHtml(r.reportNo||'—')}</strong>
        ${r.method?` · ${r.method}`:''}
        <span style="color:#666">${escapeHtml(r.subject||r.client||'')}</span>
      </li>`).join('');
    marker.bindPopup(`<div style="font-family:system-ui;min-width:200px">
      <div style="font-weight:600;font-size:13px;margin-bottom:4px">${escapeHtml(b.label||'Location')}</div>
      <div style="font-size:11px;color:#666;margin-bottom:6px">${b.reports.length} report${b.reports.length!==1?'s':''}${failCount?' · '+failCount+' failed':''}</div>
      <ul style="padding:0;list-style:none;font-size:12px;margin:0">${list}</ul>
      ${b.reports.length>8?`<div style="font-size:11px;color:#666;margin-top:6px">+ ${b.reports.length-8} more</div>`:''}
    </div>`);
    _geoMarkers.push(marker);
    bounds.push([b.lat, b.lng]);
  });

  // Fit bounds (or default to a sensible Europe view)
  if(bounds.length){
    if(bounds.length === 1) _geoMap.setView(bounds[0], 8);
    else _geoMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 9 });
  } else {
    _geoMap.setView([52, 5], 4);
  }

  // Update meta caption
  const meta = el('ov-geomap-meta');
  if(meta){
    const placed = Array.from(buckets.values()).reduce((s,b) => s + b.reports.length, 0);
    meta.textContent = `${buckets.size} location${buckets.size!==1?'s':''} · ${placed} report${placed!==1?'s':''} mapped${orphans.length?' · '+orphans.length+' unmapped':''}`;
  }

  // Force a tile repaint after layout (Leaflet needs this when its container was hidden)
  setTimeout(() => { try { _geoMap.invalidateSize(); } catch(e){} }, 100);
}

// Drill-down modal for reports
function ovOpenDrilldown(title, list){
  let modal = document.getElementById('drilldown-modal');
  if(modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'drilldown-modal';
  modal.className = 'drilldown-modal open';
  modal.onclick = e => { if(e.target === modal) modal.remove(); };
  let body = '';
  if(!list.length){
    body = '<div style="padding:30px;text-align:center;color:var(--t3);font-size:13px">No results.</div>';
  } else {
    body = `<table class="tbl" style="width:100%"><thead><tr><th scope="col">Report</th><th scope="col">Method</th><th scope="col">Subject</th><th scope="col">Inspector</th><th scope="col">Date</th><th scope="col">Result</th></tr></thead><tbody>` +
      list.map(r => {
        const md = NDT_METHODS.find(x => x.id === r.method);
        const verdict = r.verdict && r.verdict !== '— Select —' ? r.verdict : 'Draft';
        const vClass = verdict==='Acceptable'?'green':verdict==='Not acceptable'?'red':verdict==='Various'?'amber':'blue';
        return `<tr>
          <td style="font-family:var(--mono);font-size:12px;color:var(--cyan)">${escapeHtml(r.reportNo||'—')}</td>
          <td><span style="font-family:var(--mono);font-weight:600;color:${md?.color||'var(--t2)'}">${r.method||'—'}</span></td>
          <td>${escapeHtml(r.subject||r.client||'—')}</td>
          <td>${escapeHtml(r.inspector||'—')}</td>
          <td style="font-family:var(--mono);font-size:11px">${fmtDate(r.createdAt)}</td>
          <td><span class="badge badge-${vClass}" style="font-size:10px">${verdict}</span></td>
        </tr>`;
      }).join('') + '</tbody></table>';
  }
  modal.innerHTML = `<div class="drilldown-card">
    <div class="drilldown-head">
      <div>
        <div style="font-size:14px;font-weight:600;color:var(--t1)">${escapeHtml(title)}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:2px">${list.length} item${list.length!==1?'s':''}</div>
      </div>
      <button class="btn btn-sm" data-action="_wRemoveById" data-args="\'drilldown-modal\'">Close</button>
    </div>
    <div class="drilldown-list">${body}</div>
  </div>`;
  document.body.appendChild(modal);
  openA11yModal(modal);
}

// Drill-down modal for defects
function ovOpenDefectDrilldown(title, list){
  let modal = document.getElementById('drilldown-modal');
  if(modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'drilldown-modal';
  modal.className = 'drilldown-modal open';
  modal.onclick = e => { if(e.target === modal) modal.remove(); };
  let body = '';
  if(!list.length){ body = '<div style="padding:30px;text-align:center;color:var(--t3);font-size:13px">No results.</div>'; }
  else {
    body = `<table class="tbl" style="width:100%"><thead><tr><th scope="col">ID</th><th scope="col">Type</th><th scope="col">Severity</th><th scope="col">Location</th><th scope="col">Method</th><th scope="col">Date</th></tr></thead><tbody>` +
      list.map(d => `<tr>
        <td style="font-family:var(--mono);font-size:11px">${escapeHtml(d.defectId||'—')}</td>
        <td>${escapeHtml(d.type||'—')}</td>
        <td><span class="badge badge-${d.severity==='Critical'?'red':d.severity==='High'?'amber':'blue'}" style="font-size:10px">${d.severity ? escapeHtml(tSeverity(d.severity)) : '—'}</span></td>
        <td>${escapeHtml(d.location||'—')}</td>
        <td>${escapeHtml(d.method||'—')}</td>
        <td style="font-family:var(--mono);font-size:11px">${fmtDate(d.createdAt)}</td>
      </tr>`).join('') + '</tbody></table>';
  }
  modal.innerHTML = `<div class="drilldown-card">
    <div class="drilldown-head">
      <div><div style="font-size:14px;font-weight:600;color:var(--t1)">${escapeHtml(title)}</div></div>
      <button class="btn btn-sm" data-action="_wRemoveById" data-args="\'drilldown-modal\'">Close</button>
    </div>
    <div class="drilldown-list">${body}</div>
  </div>`;
  document.body.appendChild(modal);
  openA11yModal(modal);
}

// Drill-down from clicking a metric tile
function ovDrillMetric(kind){
  const all = ls(KEYS.reports, []);
  const reports = ovFilterByRange(all);
  let title, list;
  if(kind === 'total'){ title = `All reports in selected period`; list = reports; }
  else if(kind === 'fail'){ title = `Reports flagged "Not acceptable"`; list = reports.filter(r => r.verdict === 'Not acceptable'); }
  else if(kind === 'pass'){ title = `Reports marked "Acceptable"`; list = reports.filter(r => r.verdict === 'Acceptable'); }
  else if(kind === 'drafts'){ title = `Drafts in progress`; list = reports.filter(r => getReportStage(r) === 'Draft'); }
  else return;
  ovOpenDrilldown(title, list);
}

// ══════════════════════════════════════════════════════════════════════════
// V9 — auto-fill from history, ICS export, webhook outbox
// ══════════════════════════════════════════════════════════════════════════

var AUTOFILL_FIELDS = ['client','project','drawing','location','contractor','fabricator','poNumber'];
var _autofillTimer = null;

function autofillBindClientField(methodId){
  const fid = `rf-${methodId}-client`;
  const inp = el(fid); if(!inp) return;
  if(inp.dataset.autofillBound === '1') return;
  inp.dataset.autofillBound = '1';
  inp.addEventListener('input', () => {
    clearTimeout(_autofillTimer);
    _autofillTimer = setTimeout(() => autofillCheckClient(methodId, inp.value.trim()), 250);
  });
}

function autofillCheckClient(methodId, clientName){
  const hintId = `rf-${methodId}-autofill-hint`;
  let hint = el(hintId);
  if(!clientName || clientName.length < 3){
    if(hint) hint.remove();
    return;
  }
  const all = ls(KEYS.reports, []);
  const cn = clientName.toLowerCase();
  const matches = all.slice().reverse().filter(r => r.client && r.client.toLowerCase().includes(cn));
  if(!matches.length){ if(hint) hint.remove(); return; }
  const ref = matches[0];
  const copyable = AUTOFILL_FIELDS.filter(f => f !== 'client' && ref[f] && !el(`rf-${methodId}-${f}`)?.value);
  if(!copyable.length){ if(hint) hint.remove(); return; }

  if(!hint){
    const fld = el(`rf-${methodId}-client`)?.closest('.fld');
    if(!fld) return;
    hint = document.createElement('div');
    hint.id = hintId;
    hint.className = 'autofill-hint';
    fld.appendChild(hint);
  }
  hint.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
    <span>Found previous report for <strong>${escapeHtml(ref.client)}</strong> (${escapeHtml(ref.reportNo||'—')}). Copy ${copyable.length} field${copyable.length!==1?'s':''}?</span>
    <button data-action="autofillApply" data-args="'${methodId}','${(ref.reportNo||'').replace(/'/g, "\\'")}'" data-pass-event="1">Yes, copy</button>
    <span class="autofill-dismiss" data-action="_wDismissParent" data-pass-el="1" title="Dismiss">×</span>`;
}

function autofillApply(methodId, refReportNo, evt){
  if(evt) evt.preventDefault();
  const all = ls(KEYS.reports, []);
  const ref = all.slice().reverse().find(r => r.reportNo === refReportNo);
  if(!ref) return;
  let copied = 0;
  AUTOFILL_FIELDS.forEach(f => {
    const inp = el(`rf-${methodId}-${f}`);
    if(inp && !inp.value && ref[f]){ inp.value = ref[f]; copied++; }
  });
  toast(`Copied ${copied} field${copied!==1?'s':''} from ${refReportNo}`, 'success');
  const hint = el(`rf-${methodId}-autofill-hint`); if(hint) hint.remove();
}

// ── ICS calendar export ───────────────────────────────────────────────
function generateIcsForCerts(){
  const inspectors = ls(KEYS.inspectors, []);
  const events = [];
  inspectors.forEach(ins => {
    _inspCertList(ins).forEach(c => {
      if(!c.expiry) return;
      const d = new Date(c.expiry);
      if(isNaN(d)) return;
      events.push({
        uid: 'cert-' + (ins.id || ins.name) + '-' + c.method + '@veritix-ndt',
        title: `${c.method} cert expires — ${escapeHtml(ins.name)}`,
        desc: `${c.method} certification expires for ${escapeHtml(ins.name)}.${c.certNo?' Cert no. '+escapeHtml(c.certNo)+'.':''}`,
        date: d
      });
      const reminder = new Date(d.getTime() - 30 * 24 * 60 * 60 * 1000);
      events.push({
        uid: 'cert-warn-' + (ins.id || ins.name) + '-' + c.method + '@veritix-ndt',
        title: `30-day ${c.method} cert renewal reminder — ${escapeHtml(ins.name)}`,
        desc: `${c.method} certification renewal due in 30 days for ${escapeHtml(ins.name)}.`,
        date: reminder
      });
    });
  });
  if(!events.length){ toast(t('toast.no_cert_dates','No certification dates to export.'), 'warn'); return; }

  const fmt = d => {
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth()+1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${mo}${da}`;
  };
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:.]/g, '').split('T')[0] + 'T' + now.toISOString().split('T')[1].replace(/[-:.]/g, '').slice(0, 6) + 'Z';
  const escIcs = s => String(s||'').replace(/\\/g,'\\\\').replace(/[\r\n]+/g,' ').replace(/,/g,'\\,').replace(/;/g,'\\;');

  let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Veritix NDT Inspect//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n';
  events.forEach(ev => {
    const end = new Date(ev.date.getTime() + 24*60*60*1000);
    ics += 'BEGIN:VEVENT\r\n';
    ics += `UID:${ev.uid}\r\n`;
    ics += `DTSTAMP:${stamp}\r\n`;
    ics += `DTSTART;VALUE=DATE:${fmt(ev.date)}\r\n`;
    ics += `DTEND;VALUE=DATE:${fmt(end)}\r\n`;
    ics += `SUMMARY:${escIcs(ev.title)}\r\n`;
    ics += `DESCRIPTION:${escIcs(ev.desc)}\r\n`;
    ics += 'BEGIN:VALARM\r\nTRIGGER:-P7D\r\nACTION:DISPLAY\r\n';
    ics += `DESCRIPTION:Reminder: ${escIcs(ev.title)}\r\n`;
    ics += 'END:VALARM\r\nEND:VEVENT\r\n';
  });
  ics += 'END:VCALENDAR\r\n';

  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'veritix-cert-expiry-' + new Date().toISOString().split('T')[0] + '.ics';
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${events.length} calendar event${events.length!==1?'s':''}`, 'success');
}

// ── Webhook outbox ────────────────────────────────────────────────────
var WEBHOOK_KEY = 'vx-webhooks-v1';

function webhookLoadConfig(){
  const s = ls(KEYS.settings, {});
  return {
    url: s.webhookUrl || '',
    headers: s.webhookHeaders || '',
    enabled: !!s.webhookEnabled,
    triggers: s.webhookTriggers || ['stage:Approved'],
  };
}
function webhookSaveConfig(cfg){
  const s = ls(KEYS.settings, {});
  s.webhookUrl = cfg.url;
  s.webhookHeaders = cfg.headers;
  s.webhookEnabled = !!cfg.enabled;
  s.webhookTriggers = cfg.triggers;
  lss(KEYS.settings, s);
}
function webhookGetLog(){ return ls(WEBHOOK_KEY, []); }
function webhookAppendLog(entry){
  const log = webhookGetLog();
  log.unshift(entry);
  while(log.length > 50) log.pop();
  lss(WEBHOOK_KEY, log);
  webhookRenderLog();
}
function webhookSaveFromUi(){
  const cfg = {
    url: el('wh-url')?.value.trim() || '',
    headers: el('wh-headers')?.value.trim() || '',
    enabled: el('wh-enabled')?.checked || false,
    triggers: Array.from(document.querySelectorAll('.wh-trigger:checked')).map(c => c.value),
  };
  webhookSaveConfig(cfg);
  toast(t('toast.webhook_saved', 'Webhook settings saved'), 'success');
}
function webhookFireTest(){
  const cfg = webhookLoadConfig();
  if(!cfg.url){ toast(t('toast.set_webhook_url', 'Set a webhook URL first.'), 'error'); return; }
  if(!cfg.enabled){ toast(t('toast.webhook_enable_first','Enable webhooks first to send a test.'), 'warn'); return; }
  webhookFire('test', { hello: 'from veritix-ndt-inspect', at: new Date().toISOString() });
  toast(t('toast.test_fired', 'Test fired — check delivery log below.'), 'info');
}
async function webhookFire(action, payload){
  const cfg = webhookLoadConfig();
  if(!cfg.enabled || !cfg.url) return;
  let headers = { 'Content-Type': 'application/json' };
  if(cfg.headers){
    cfg.headers.split('\n').forEach(line => {
      const m = line.match(/^([^:]+):\s*(.+)$/);
      if(m) headers[m[1].trim()] = m[2].trim();
    });
  }
  const body = JSON.stringify({ action, at: new Date().toISOString(), source: 'veritix-ndt', payload });
  const entry = { at: new Date().toISOString(), action, url: cfg.url, status: 'pending' };
  try {
    const resp = await fetch(cfg.url, { method: 'POST', headers, body, mode: 'cors' });
    entry.status = resp.ok ? 'ok' : 'http_' + resp.status;
    entry.code = resp.status;
  } catch(e){
    entry.status = 'failed';
    entry.error = String(e.message || e);
  }
  webhookAppendLog(entry);
}
function webhookRenderLog(){
  const wrap = el('wh-log'); if(!wrap) return;
  const log = webhookGetLog();
  if(!log.length){
    wrap.innerHTML = '<div style="font-size:12px;color:var(--t3);padding:14px;text-align:center;font-style:italic">No deliveries yet. Save settings and trigger a stage change, or click "Send test" above.</div>';
    return;
  }
  wrap.innerHTML = log.map(e => {
    const ok = e.status === 'ok';
    const color = ok ? 'var(--green)' : 'var(--red)';
    const lbl = ok ? '✓ ' + (e.code || 'ok') : '✕ ' + (e.status || 'failed');
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px">
      <span style="font-family:var(--mono);color:${color};font-size:11px;min-width:60px">${lbl}</span>
      <span style="color:var(--t1);font-weight:500">${escapeHtml(e.action)}</span>
      <span style="flex:1;color:var(--t3);font-size:11px;font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.url||'')}</span>
      <span style="color:var(--t3);font-family:var(--mono);font-size:10px">${fmtDate(e.at)} ${new Date(e.at).toLocaleTimeString()}</span>
    </div>`;
  }).join('');
}
function webhookLoadIntoUi(){
  const cfg = webhookLoadConfig();
  if(el('wh-url')) el('wh-url').value = cfg.url;
  if(el('wh-headers')) el('wh-headers').value = cfg.headers;
  if(el('wh-enabled')) el('wh-enabled').checked = cfg.enabled;
  document.querySelectorAll('.wh-trigger').forEach(c => {
    c.checked = cfg.triggers.includes(c.value);
  });
  webhookRenderLog();
}

// NOTE: setReportStage is wrapped for webhook delivery further down this file
// (see "Hook setReportStage so webhooks fire automatically on stage changes"
// near the audit/export region). The original wrapper that lived here fired
// the same webhook a second time with a different payload shape, so every
// stage change delivered two webhooks per subscriber. Removed — single wrap
// is the source of truth.

function ovNewReport(methodId, btn, sourceReport) {
  _ovMethod = methodId;
  const m = NDT_METHODS.find(x => x.id === methodId); if(!m) return;

  // Switch to new report section
  document.querySelectorAll('#page-overview .ss').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('#ov-snav .snav-item').forEach(b => b.classList.remove('active'));
  el('ov-newreport').classList.add('active');
  if(btn) btn.classList.add('active');

  if(sourceReport){
    const _nextRev = _ovBumpRevision((sourceReport.revision || '00').trim());
    el('ov-nr-title').textContent = `Revise ${m.id} report — ${escapeHtml(sourceReport.reportNo || '')} Rev ${_nextRev}`;
    el('ov-nr-desc').textContent  = `Saving creates revision ${_nextRev} of this report. The report number stays the same; a reason for the change is required.`;
  } else {
    el('ov-nr-title').textContent = `New ${m.id} report — ${escapeHtml(m.name)}`;
    el('ov-nr-desc').textContent = `Fill in the ${escapeHtml(m.name)} report details below. Fields are pre-filled from your saved templates.`;
  }

  // Load template data
  loadTemplates();
  const tpl = _tplData[methodId] || {};
  const rptForm = _rptForms[methodId] || {};

  // Merge: rptForm values override tpl values. A revision opens against
  // the saved report's own values rather than the method-template form.
  const merged = sourceReport ? { ...sourceReport } : { ...rptForm };
  _ovReviseSource = sourceReport || null;

  if(sourceReport){
    // Revision of an existing report — keep the report number, advance
    // the revision number. The reason guardrail in ovSaveReport keys off
    // _ovRevisionOriginal (set below to the source's own revision).
    merged.reportNo = sourceReport.reportNo || merged.reportNo || '';
    merged.revision = _ovBumpRevision((sourceReport.revision || '00').trim());
  } else {
    // Generate report number — pulls the per-report method code into the
    // configured numMethodPos slot so each method (UT, MT, VT, …) shows up
    // automatically in the report's identifier.
    const s = ls(KEYS.settings, {});
    const prefix = s.numPrefix || 'INS';
    const sep = s.numSep !== undefined ? s.numSep : '-';
    const yrDigits = parseInt(s.numYear || '4');
    const digits = parseInt(s.numDigits || '3');
    const next = parseInt(s.numNext || '1');
    const methodPos = s.numMethodPos || 'none';
    const yr = yrDigits === 4 ? new Date().getFullYear() : yrDigits === 2 ? String(new Date().getFullYear()).slice(-2) : '';
    const seq = String(next).padStart(digits, '0');
    const mCode = (methodId || merged.method || '').toUpperCase();
    const parts = [prefix];
    if(methodPos === 'after-prefix' && mCode) parts.push(mCode);
    if(yr) parts.push(yr);
    if(methodPos === 'after-year' && mCode) parts.push(mCode);
    parts.push(seq);
    merged.reportNo = parts.filter(Boolean).join(sep);
    if(!merged.revision) merged.revision = '00';
  }

  // Items table — seed row 0 from any top-level values the template /
  // saved-form may have pre-filled, so the user doesn't lose data when the
  // items table takes over those fields from the single-instance sections.
  _ovItems = (Array.isArray(merged.items) && merged.items.length) ? merged.items.slice() : [{}];
  // Photo page — preserve any photos already on the (sourceReport when
  // revising) report. Empty array = no photo page added yet.
  _ovPhotos = (sourceReport && Array.isArray(sourceReport.photos)) ? sourceReport.photos.slice() : [];
  _ovPhotoCaptions = (sourceReport && Array.isArray(sourceReport.photoCaptions)) ? sourceReport.photoCaptions.slice() : [];
  _ovSinglePhotos = (sourceReport && sourceReport.singlePhotos && typeof sourceReport.singlePhotos === 'object')
    ? Object.assign({}, sourceReport.singlePhotos)
    : {};
  _ovPhotoDetails = (sourceReport && sourceReport.photoDetails && typeof sourceReport.photoDetails === 'object')
    ? Object.assign({}, sourceReport.photoDetails)
    : {};
  RPT_ITEM_FIELD_IDS.forEach(fid => {
    if(_ovItems[0][fid] === undefined && merged[fid]) _ovItems[0][fid] = merged[fid];
  });

  // Build form
  const body = el('ov-nr-body'); if(!body) return;
  let html = '';

  // Fields kept off the new-report form: item-table columns (entered in
  // the items table) plus four that are now system-derived rather than
  // typed — report revision (assigned by the revision workflow), overall
  // verdict (rolled up from the item results on save), procedure revision
  // (read from the linked procedure), and witness / 3rd party.
  const omit = new Set([...RPT_ITEM_FIELD_IDS, 'revision','verdict','procRev','witness']);
  const clientShared  = RPT_FORM.client.filter(f => !omit.has(f.id));
  const examShared    = RPT_FORM.exam.filter(f => !omit.has(f.id));

  // Revision mode opens with a mandatory reason box at the top — the
  // revision number itself is system-assigned, so there is no field for
  // it; this textarea feeds ovSaveReport's revision guardrail.
  if(sourceReport){
    html += `<div style="margin:0 14px 14px;padding:11px 13px;background:rgba(245,166,35,.08);border:1px solid rgba(245,166,35,.32);border-radius:6px">
      <label style="display:block;font-size:11px;font-weight:600;color:var(--amber);margin-bottom:5px">Reason for revision <span style="color:var(--red)">*</span></label>
      <textarea id="ov-revision-reason" rows="2" placeholder="What changed in this revision?" style="width:100%;font-family:var(--font);font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);color:var(--t1);box-sizing:border-box"></textarea>
    </div>`;
  }
  // Client & report identity
  html += ovFormSection('Report revision & client information', clientShared, methodId, merged, m);
  // Examination details (expandable table + remarks)
  html += ovRenderItemsTable(methodId, _ovItems, merged.examRemarks || '');
  // Examination criteria
  html += ovFormSection('Examination criteria', examShared, methodId, merged, m);
  // Section 5: Equipment & parameters. Includes TPL_FIELDS._common
  // (specification, acceptance criteria, procedure, equipment) AND the
  // per-method fields. _common was previously template-editor-only, so
  // the equipment dropdown never rendered on the new-report form.
  const specific = [...(TPL_FIELDS._common || []), ...(TPL_FIELDS[methodId] || [])].map(f => {
    const field = {...f, id:'eq_'+f.id, label:f.label.replace('Default ','')};
    // Pre-fill from template defaults
    if(!merged['eq_'+f.id] && tpl[f.id]) merged['eq_'+f.id] = tpl[f.id];
    return field;
  });
  if(specific.length) html += ovFormSection(`${m.id} — Equipment & parameters`, specific, methodId, merged, m);
  // Section 6: Result
  html += ovFormSection('Result & sign-off', RPT_FORM.result.filter(f => !omit.has(f.id)), methodId, merged, m);

  // Defects — auto-built from inspected items the inspector marked as
  // 'Not acceptable'. Renders one Type + Size row per rejected item.
  // Lives between Result and Photos because defects logically belong to
  // the inspection result, while photos are supporting evidence.
  html += _ovDefectsSectionHtml();

  // Photos — optional photo-page section. Renders an "+ Add photo page"
  // button when none has been added, or 6 photo slots + a "Remove photo
  // page" Cancel when the inspector has opted in.
  html += _ovPhotosSectionHtml();

  // Save bar — at the foot of the form. Cancel closes the form without
  // saving; "Save" issues the report (Approved); "For review" sends it
  // to the Submitted stage / reviewers' Inbox.
  html += `<div style="display:flex;align-items:center;gap:10px;margin:20px 14px 12px;padding-top:16px;border-top:1px solid var(--border)">
    <button class="btn" data-action="ovCancelReport">Cancel</button>
    <span style="flex:1"></span>
    <button class="btn" data-action="ovSaveReport" data-args="'review'">For review</button>
    <button class="btn btn-primary" data-action="ovSaveReport">Save</button>
  </div>`;

  body.innerHTML = html;
  // V9: bind auto-fill suggestion to client field
  if(typeof autofillBindClientField === 'function'){
    setTimeout(() => autofillBindClientField(methodId), 30);
  }
  // Auto-pick the procedure when the specification / acceptance criteria
  // are chosen — matched against Settings → NDT procedures by method.
  setTimeout(() => {
    const specEl = el(`rf-${methodId}-eq_spec`);
    const accEl  = el(`rf-${methodId}-eq_acc`);
    if(specEl) specEl.addEventListener('change', () => ovAutoPickProcedure(methodId));
    if(accEl)  accEl.addEventListener('change', () => ovAutoPickProcedure(methodId));
    // Fill from any spec already pre-filled on a fresh report — but never
    // overwrite a procedure carried in on a revision.
    ovAutoPickProcedure(methodId, true);
  }, 40);
  // Non-admin inspectors sign their own reports. Verify the logged-in
  // user holds a valid certification for this report's method — if not,
  // pop up a notice and block the save (admins are exempt; they pick a
  // cert-validated inspector from the dropdown instead).
  _ovSignBlockReason = null;
  if(typeof vxIsAdmin === 'function' && !vxIsAdmin()){
    const meRec = _ovCurrentUserInspector();
    const certs = (meRec && typeof _inspMethodCerts === 'function') ? _inspMethodCerts(meRec) : {};
    const cert  = certs[methodId];
    const expFmt = c => (typeof fmtDate === 'function' && c && c.expiry) ? fmtDate(c.expiry) : (c && c.expiry) || '';
    if(!meRec){
      _ovSignBlockReason = 'Your account is not linked to an inspector record, so you cannot sign this report. Please contact an administrator.';
    } else if(!cert){
      _ovSignBlockReason = `You hold no ${methodId} certification, so you are unable to sign this ${methodId} report.`;
    } else if(typeof daysUntil === 'function' && cert.expiry && daysUntil(cert.expiry) < 0){
      _ovSignBlockReason = `Your ${methodId} certification expired on ${expFmt(cert)} — you are unable to sign this report. Please contact an administrator to renew it.`;
    }
    if(_ovSignBlockReason && typeof vxConfirm === 'function'){
      vxConfirm({ title: 'Certification check', message: _ovSignBlockReason, okLabel: 'OK', cancelLabel: 'OK' });
    }
  }
  // Baseline revision for ovSaveReport's reason guardrail. The revision
  // number is no longer a form field — it is system-assigned on save
  // (00 for a new report, the next number for a revision) — and in
  // revision mode the reason box is rendered into the form above.
  _ovRevisionOriginal = (sourceReport ? (sourceReport.revision || '00') : '00').trim();
}

// Auto-pick the Procedure field from Settings → NDT procedures, matching
// the chosen specification (and acceptance criteria when both line up)
// against registered procedures for this method. Spec / acceptance are
// compared on the year/prefix-agnostic key (_cvSpecKey, from editor.js);
// an Active revision wins. `onlyIfEmpty` skips the change when the
// Procedure field already carries a value (used on form open so a
// revision's saved procedure is never clobbered).
function ovAutoPickProcedure(methodId, onlyIfEmpty){
  const procEl = el(`rf-${methodId}-eq_proc`);
  if(!procEl) return;
  if(onlyIfEmpty && String(procEl.value || '').trim()) return;
  const specEl = el(`rf-${methodId}-eq_spec`);
  const accEl  = el(`rf-${methodId}-eq_acc`);
  const spec = specEl ? String(specEl.value || '').trim() : '';
  const acc  = accEl  ? String(accEl.value  || '').trim() : '';
  if(!spec) return;
  const key  = s => (typeof _cvSpecKey === 'function') ? _cvSpecKey(s) : String(s || '').trim().toLowerCase();
  const procs = (typeof ls === 'function') ? (ls(KEYS.procedures, []) || []) : [];
  const cands = procs.filter(p => p.method === methodId && p.standard && key(p.standard) === key(spec));
  if(!cands.length) return;
  const isActive = p => /^active$/i.test(String(p.status || '').trim());
  const accMatch = acc ? cands.filter(p => p.acceptance && key(p.acceptance) === key(acc)) : [];
  const pool = accMatch.length ? accMatch : cands;
  const pick = pool.find(isActive) || pool[0];
  const procNo = pick.procNo || pick.procedureNo || pick.no || '';
  if(!procNo) return;
  // The Procedure field is a fixed-option <select>; add the matched
  // number as an option if it isn't listed, then select it.
  if(procEl.tagName === 'SELECT' && !Array.from(procEl.options).some(o => o.value === procNo)){
    const opt = document.createElement('option');
    opt.value = procNo; opt.textContent = procNo;
    procEl.appendChild(opt);
  }
  procEl.value = procNo;
}

function ovFormSection(title, fields, methodId, data, m) {
  // Method-gated fields (def.methodsOnly) render only for their methods.
  fields = fields.filter(f => !f.methodsOnly || f.methodsOnly.includes(methodId));
  let html = `<div class="sc" style="margin:0 14px 14px"><div class="sc-head"><span class="sc-title">${title}</span></div><div class="sc-body" style="padding:14px 16px">`;
  for(let i = 0; i < fields.length; i += 2) {
    const f1 = fields[i], f2 = fields[i+1];
    html += `<div class="fg form-row" style="margin-bottom:8px">`;
    html += rptFieldHtml(methodId, f1, data);
    if(f2) html += rptFieldHtml(methodId, f2, data);
    html += `</div>`;
  }
  html += `</div></div>`;
  return html;
}

// Inspected-items table. One row per weld/object inspected under the same
// report cover. Each <input>/<select> id is `it-<row>-<fieldId>` so
// ovItemsCollect can read them back without touching the DOM render order.
function ovRenderItemsTable(methodId, items, remarks) {
  const cols = RPT_FORM.items;
  // Percentage colgroup — derived from each column's relative width so
  // the table scales down to whatever width the surrounding card has,
  // instead of forcing a 1250+px min-width that pushes the rightmost
  // (verdict) cell past the card edge. The trailing remove-button
  // column is a small fixed slice; the data columns share what's left.
  const dataTotal = cols.reduce((s, c) => s + (c.width || 130), 0);
  const rmShare = 4;
  const dataShare = 100 - rmShare;
  const dataPcts = cols.map(c => +(((c.width || 130) / dataTotal) * dataShare).toFixed(4));
  const sumExceptLast = dataPcts.slice(0, -1).reduce((s, p) => s + p, 0);
  dataPcts[dataPcts.length - 1] = +(dataShare - sumExceptLast).toFixed(4);
  const colgroup = `<colgroup>${dataPcts.map(p => `<col style="width:${p}%"/>`).join('')}<col style="width:${rmShare}%"/></colgroup>`;
  // Column headers match the .fld label style used by the surrounding
  // section's field labels — same font, same size (--fs-xs), same colour
  // (--t2), no uppercase / mono so the table reads as part of the form
  // rather than a tagged data grid.
  const head = cols.map(c => `<th style="padding:6px 8px;font-family:var(--font);font-size:var(--fs-xs);color:var(--t2);text-align:left;font-weight:500;letter-spacing:0;text-transform:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.label)}</th>`).join('');
  const rows = items.map((row, ri) => {
    const cells = cols.map(c => `<td style="padding:4px 6px;vertical-align:top">${ovItemFieldHtml(ri, c, row)}</td>`).join('');
    const rm = `<td style="padding:4px 4px;vertical-align:middle;text-align:center">${items.length > 1 ? `<button class="btn btn-sm btn-danger" data-action="ovItemsRemoveRow" data-args="${ri}" title="Remove row" style="padding:4px 8px;font-size:11px">−</button>` : ''}</td>`;
    return `<tr>${cells}${rm}</tr>`;
  }).join('');
  return `<div class="sc" style="margin:0 14px 14px"><div class="sc-head" style="display:flex;align-items:center;justify-content:space-between">
      <span class="sc-title">Examination details</span>
      <button class="btn btn-sm" data-action="ovItemsAddRow" style="font-size:11px;padding:4px 10px">+ Add row</button>
    </div>
    <div class="sc-body" style="padding:8px 10px 12px">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed">
        ${colgroup}
        <thead><tr style="border-bottom:1px solid var(--border)">${head}<th></th></tr></thead>
        <tbody id="ov-items-tbody">${rows}</tbody>
      </table>
      <div class="fld" style="margin-top:12px">
        <label style="font-size:11px;color:var(--t2);font-weight:500">Remarks / comments
          <span style="font-weight:400;color:var(--t3);margin-left:6px">printed in the empty space below the table on the report</span>
        </label>
        <textarea id="ov-exam-remarks" rows="3" placeholder="Any extra notes about these examinations…" style="width:100%;font-family:var(--font);font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);color:var(--t1);box-sizing:border-box;resize:vertical">${escapeHtml(remarks || '')}</textarea>
      </div>
    </div></div>`;
}

// Build a single <tr> for the items table. Used both by the initial render
// (via the inline map in ovRenderItemsTable) and by ovItemsAppendBlankRow
// when auto-growing the table so the per-cell HTML is identical.
function ovItemsRowHtml(rowIdx, row, totalRowCount) {
  const cols = RPT_FORM.items;
  const cells = cols.map(c => `<td style="padding:4px 6px;vertical-align:top">${ovItemFieldHtml(rowIdx, c, row)}</td>`).join('');
  const rm = `<td style="padding:4px 4px;vertical-align:middle">${totalRowCount > 1 ? `<button class="btn btn-sm btn-danger" data-action="ovItemsRemoveRow" data-args="${rowIdx}" title="Remove row" style="padding:4px 8px;font-size:11px">−</button>` : ''}</td>`;
  return `<tr>${cells}${rm}</tr>`;
}

// Verdict palette — same swatches as the items-table place card so the form
// reads the same as the printed page. Kept in one place so a future tweak
// (e.g. another verdict value, a new colour) updates both views together.
var OV_VERDICT_COLORS = {
  'Acceptable':     {fg:'#065f46', bg:'#d1fae5'},
  'Pass':           {fg:'#065f46', bg:'#d1fae5'},
  'Not acceptable': {fg:'#991b1b', bg:'#fee2e2'},
  'Fail':           {fg:'#991b1b', bg:'#fee2e2'},
  'Monitor':        {fg:'#92400e', bg:'#fef3c7'},
  'Inconclusive':   {fg:'#92400e', bg:'#fef3c7'},
  'For information':{fg:'#1e40af', bg:'#dbeafe'},
};
function ovVerdictStyle(val) {
  const c = OV_VERDICT_COLORS[val];
  return c ? `background:${c.bg};color:${c.fg};font-weight:600;` : '';
}

function ovItemFieldHtml(rowIdx, col, row) {
  const fid = `it-${rowIdx}-${col.id}`;
  const val = row[col.id] || '';
  const onInput = ` data-on-input="ovItemsCapture" data-args="${rowIdx},'${col.id}'" data-pass-el="1"`;
  const onChange = ` data-on-change="ovItemsCapture" data-args="${rowIdx},'${col.id}'" data-pass-el="1"`;
  // Auto-formatter on blur. Dimensions / thickness → Ø…mm so users can
  // type the bare "219.1 × 8.2" and it normalises on tab-out. Shares the
  // existing data-args so the handler receives (rowIdx, fieldId, target).
  const onBlur  = (col.id === 'dimensions') ? ` data-on-blur="ovItemsFormatDimensions"` : '';
  // Shared cell-control style — explicit height + border so <input> and
  // <select> render at the same dimensions (without this, appearance:none
  // selects compute a shorter intrinsic height than text inputs and the
  // dropdown cells look smaller than their neighbours).
  const ctrlStyle = 'width:100%;height:32px;box-sizing:border-box;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);color:var(--t1);font-family:var(--font)';
  // Any column that carries an `options` array — material, weldType,
  // weldProcess, verdict — renders as a strict <select> so the user can
  // only pick a defined value (no free-text input). A legacy value not
  // in the current option list is preserved as a one-off selected
  // entry so historical reports still display correctly; switching off
  // it drops the value permanently.
  if(col.type === 'select' || (col.options && col.options.length)) {
    const opts = col.options || [];
    const hasBlank = opts.includes('');
    const valInOptions = opts.includes(val);
    let html = '';
    if(!hasBlank) html += `<option value=""${val===''?' selected':''}></option>`;
    if(val && !valInOptions) html += `<option value="${escapeHtml(val)}" selected>${escapeHtml(val)}</option>`;
    html += opts.map(o => `<option${o===val?' selected':''}>${escapeHtml(o)}</option>`).join('');
    // Verdict gets a colour-coded background that tracks the selected
    // value. ovItemsCapture restyles the element on change.
    const extra = (col.id === 'verdict') ? ovVerdictStyle(val) : '';
    return `<select id="${fid}" style="${ctrlStyle};${extra}"${onChange}>${html}</select>`;
  }
  const type = col.type || 'text';
  return `<input id="${fid}" type="${type}" value="${escapeHtml(val)}" placeholder="${escapeHtml(col.placeholder||'')}" style="${ctrlStyle}"${onInput}${onBlur}/>`;
}

// Normalise a dimensions / thickness value to the canonical Ø…mm form.
// Idempotent — re-formatting a value that already carries the prefix /
// suffix leaves it untouched, so the save-side pass and the blur handler
// don't compound the markers if both run.
function ovFormatDimensions(raw) {
  let v = (raw || '').toString().trim();
  if(!v) return '';
  if(!v.startsWith('Ø')) v = 'Ø' + v;
  if(!/mm$/i.test(v))    v = v + 'mm';
  return v;
}

// Blur handler — runs when the user tabs / clicks out of the dimensions
// cell. Mirrors the formatted value back into _ovItems so the working
// copy stays in sync with the displayed input.
function ovItemsFormatDimensions(rowIdx, fieldId, target) {
  if(fieldId !== 'dimensions') return;
  const formatted = ovFormatDimensions(target.value);
  if(formatted !== target.value) target.value = formatted;
  if(!_ovItems[rowIdx]) _ovItems[rowIdx] = {};
  _ovItems[rowIdx].dimensions = formatted;
}

// Capture a single cell into _ovItems on every keystroke / change so the
// state survives + Add row / − Remove row re-renders without round-tripping
// through the DOM.
function ovItemsCapture(rowIdx, fieldId, target) {
  if(!_ovItems[rowIdx]) _ovItems[rowIdx] = {};
  _ovItems[rowIdx][fieldId] = target.value;
  // Verdict swatch follows the selected value live — without this the
  // background freezes at whatever colour the cell rendered with. Uses
  // the same base ctrlStyle as the initial render so the cell keeps its
  // explicit height / border / radius after the swatch is reapplied.
  if(fieldId === 'verdict') {
    const ctrlStyle = 'width:100%;height:32px;box-sizing:border-box;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);color:var(--t1);font-family:var(--font)';
    target.style.cssText = `${ctrlStyle};${ovVerdictStyle(target.value)}`;
    // Defects section is driven by which items are 'Not acceptable' —
    // a verdict change adds or removes a defect row, so refresh the
    // section in place. The Type / Size inputs inside it own their DOM
    // value so any partial typing in the OTHER rows survives the redraw.
    if(typeof ovRenderDefectsSection === 'function') ovRenderDefectsSection();
  }
  // Auto-grow — as soon as the user puts a value into the last row, add
  // a fresh empty row underneath so they can keep filling out items
  // without clicking + Add row. Caps at 50 rows as a sanity stop.
  const isLastRow = rowIdx === _ovItems.length - 1;
  const hasValue  = target.value && String(target.value).trim();
  if(isLastRow && hasValue && _ovItems.length < 50) {
    ovItemsAppendBlankRow();
  }
}

// Append one empty row to the items table in-place (no full re-render, so
// the user's caret stays where it is). Also reveals the "−" button on the
// previously-only row, which is hidden when the table has just one row.
function ovItemsAppendBlankRow() {
  _ovItems.push({});
  const tbody = document.getElementById('ov-items-tbody');
  if(!tbody) { ovItemsRerender(); return; }
  const newIdx = _ovItems.length - 1;
  const tmp = document.createElement('tbody');
  tmp.innerHTML = ovItemsRowHtml(newIdx, {}, _ovItems.length);
  const newTr = tmp.firstElementChild;
  if(newTr) tbody.appendChild(newTr);
  // First row's remove cell was rendered empty (only one row existed at
  // the time) — inject the "−" button now that there are two rows.
  if(_ovItems.length === 2) {
    const firstRow = tbody.firstElementChild;
    const lastCell = firstRow && firstRow.lastElementChild;
    if(lastCell && !lastCell.querySelector('button')) {
      lastCell.innerHTML = `<button class="btn btn-sm btn-danger" data-action="ovItemsRemoveRow" data-args="0" title="Remove row" style="padding:4px 8px;font-size:11px">−</button>`;
    }
  }
}

// Read the current DOM values back into _ovItems. Used before re-rendering
// the items section so untyped-since-last-capture chars aren't lost (e.g.
// if Add row is clicked while a field still has focus and no input event
// has fired for the most recent char).
function ovItemsSync() {
  _ovItems.forEach((row, ri) => {
    RPT_ITEM_FIELD_IDS.forEach(fid => {
      const inp = el(`it-${ri}-${fid}`);
      if(inp) row[fid] = inp.value;
    });
  });
}

function ovItemsAddRow() {
  ovItemsSync();
  _ovItems.push({});
  ovItemsRerender();
}

function ovItemsRemoveRow(idx) {
  ovItemsSync();
  if(_ovItems.length <= 1) return;
  _ovItems.splice(idx, 1);
  ovItemsRerender();
}

// ── Defects (auto-built from rejected items) ───────────────────────────
// Lists every _ovItems entry with verdict==='Not acceptable' and gives
// the inspector two inputs per row: Defect type + Size. Weld/object +
// drawing are echoed read-only so the row reads like a mini-row of the
// defect-table that will print on the report. Values land on the item
// itself (item.defectType / item.defectSize) so save persistence and
// the defect-table render share one source of truth.
function _ovDefectsSectionHtml(){
  const rejected = [];
  if(Array.isArray(_ovItems)){
    _ovItems.forEach((it, ri) => {
      if(it && it.verdict === 'Not acceptable'){
        rejected.push({ idx: ri, item: it });
      }
    });
  }
  let body = '';
  if(!rejected.length){
    body = `<div style="padding:10px 14px;background:rgba(62,207,142,.06);border:1px dashed rgba(62,207,142,.25);border-radius:4px;font-size:11.5px;color:var(--t2);line-height:1.45">
      Mark an item as <strong>Not acceptable</strong> in the examination details table above and it will appear here for defect details.
    </div>`;
  } else {
    body = rejected.map(({ idx, item }) => {
      const subj = (item.subject || '').toString().trim() || `Item ${idx + 1}`;
      const dwg  = (item.drawing || '').toString().trim() || '—';
      const type = item.defectType  || '';
      const size = item.defectSize  || '';
      const ph   = item.defectPhoto || '';
      const ctrlStyle = 'width:100%;height:32px;box-sizing:border-box;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);color:var(--t1);font-family:var(--font)';
      // Photo tile — same upload+rotate+remove controls as the
      // single-photo tiles in the Photos section, but compact (76 px
      // wide, 4:3 aspect) so it sits next to the four input cells
      // without forcing a separate row. When filled the photo prints
      // into the new defect-table photo column on the report.
      const photoTile = ph
        ? `<div style="position:relative;width:76px;aspect-ratio:4/3;border:1px solid var(--border);border-radius:4px;overflow:hidden;background:var(--bg2)">
            <img src="${ph}" alt="Defect ${idx+1}" style="width:100%;height:100%;object-fit:contain;display:block"/>
            <button type="button" data-action="ovDefectsRotatePhotoCCW" data-args="${idx}" title="Rotate 90° counter-clockwise" style="position:absolute;top:2px;right:42px;width:18px;height:18px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;font-size:10px;line-height:1;padding:0">↺</button>
            <button type="button" data-action="ovDefectsRotatePhoto"    data-args="${idx}" title="Rotate 90° clockwise"         style="position:absolute;top:2px;right:22px;width:18px;height:18px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;font-size:10px;line-height:1;padding:0">↻</button>
            <button type="button" data-action="ovDefectsClearPhoto"     data-args="${idx}" title="Remove photo"                  style="position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;font-size:10px;line-height:1;padding:0">✕</button>
          </div>`
        : `<label style="width:76px;aspect-ratio:4/3;border:1px dashed var(--border);border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;background:var(--bg2);color:var(--t3);gap:2px">
            <span style="font-size:18px;line-height:1">📷</span>
            <span style="font-size:9.5px">Photo</span>
            <input type="file" accept="image/*" style="display:none" data-on-change="ovDefectsSetPhoto" data-pass-el="1" data-args="${idx}"/>
          </label>`;
      return `<div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,0.9fr) minmax(0,1.3fr) minmax(0,0.9fr) auto;gap:8px;align-items:end;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="min-width:0">
          <div style="font-size:10.5px;color:var(--t3);margin-bottom:3px">Weld / object</div>
          <div style="font-size:12.5px;color:var(--t1);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(subj)}">${escapeHtml(subj)}</div>
        </div>
        <div style="min-width:0">
          <div style="font-size:10.5px;color:var(--t3);margin-bottom:3px">Drawing</div>
          <div style="font-size:12.5px;color:var(--t1);font-family:var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(dwg)}">${escapeHtml(dwg)}</div>
        </div>
        <div style="min-width:0">
          <div style="font-size:10.5px;color:var(--t3);margin-bottom:3px">Defect type</div>
          <input type="text" value="${escapeHtml(type)}" placeholder="Crack, porosity, slag, lack of fusion…"
            data-on-input="ovDefectsCapture" data-args="${idx},'defectType'" data-pass-el="1"
            style="${ctrlStyle}"/>
        </div>
        <div style="min-width:0">
          <div style="font-size:10.5px;color:var(--t3);margin-bottom:3px">Size</div>
          <input type="text" value="${escapeHtml(size)}" placeholder="e.g. 12 mm × 0.5 mm"
            data-on-input="ovDefectsCapture" data-args="${idx},'defectSize'" data-pass-el="1"
            style="${ctrlStyle}"/>
        </div>
        <div style="min-width:0">
          <div style="font-size:10.5px;color:var(--t3);margin-bottom:3px">Photo</div>
          ${photoTile}
        </div>
      </div>`;
    }).join('');
  }
  return `<div class="sc" id="ov-nr-defects-section" style="margin:0 14px 14px">
    <div class="sc-head" style="display:flex;align-items:center">
      <span class="sc-title">Defects / indications</span>
      <span style="flex:1"></span>
      ${rejected.length ? `<span style="font-size:11px;color:var(--t3)">${rejected.length} item${rejected.length===1?'':'s'} flagged</span>` : ''}
    </div>
    <div class="sc-body" style="padding:6px 16px 14px">${body}</div>
  </div>`;
}

function ovRenderDefectsSection(){
  const cur = document.getElementById('ov-nr-defects-section');
  if(!cur) return;
  cur.outerHTML = _ovDefectsSectionHtml();
}

// Capture handler for the Defects inputs. Stores onto the same item the
// Examination details row already owns, so save / round-trip / defect-
// table render all read from one place (item.defectType / defectSize).
function ovDefectsCapture(rowIdx, fieldId, target){
  if(!Array.isArray(_ovItems) || !_ovItems[rowIdx]) return;
  _ovItems[rowIdx][fieldId] = target.value;
}

// Defect-row photo handlers. Lives on item.defectPhoto so storage stays
// on the item itself (one source of truth — save, frozen snapshot,
// defect-table render all read from items). 2 MB cap, canvas-rotate-
// and-bake so the chosen orientation is permanent and prints correctly.
function ovDefectsSetPhoto(rowIdx, elInput){
  if(!Array.isArray(_ovItems) || !_ovItems[rowIdx]) return;
  const file = elInput && elInput.files && elInput.files[0];
  if(!file) return;
  if(file.size > 2 * 1024 * 1024){
    toast(t('toast.photo_too_large','Photo must be under 2 MB.'), 'error');
    elInput.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    _ovItems[rowIdx].defectPhoto = e.target.result;
    ovRenderDefectsSection();
  };
  reader.readAsDataURL(file);
}

function ovDefectsClearPhoto(rowIdx){
  if(!Array.isArray(_ovItems) || !_ovItems[rowIdx]) return;
  _ovItems[rowIdx].defectPhoto = '';
  ovRenderDefectsSection();
}

function _ovDefectsRotatePhotoBy(rowIdx, dir){
  if(!Array.isArray(_ovItems) || !_ovItems[rowIdx] || !_ovItems[rowIdx].defectPhoto) return;
  const src = _ovItems[rowIdx].defectPhoto;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width  = img.naturalHeight;
    c.height = img.naturalWidth;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(dir * Math.PI / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    const isPng = /^data:image\/png/i.test(src);
    _ovItems[rowIdx].defectPhoto = isPng ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
    ovRenderDefectsSection();
  };
  img.onerror = () => { if(typeof toast === 'function') toast('Could not rotate photo.', 'error'); };
  img.src = src;
}
function ovDefectsRotatePhoto(rowIdx)    { _ovDefectsRotatePhotoBy(rowIdx, +1); }
function ovDefectsRotatePhotoCCW(rowIdx) { _ovDefectsRotatePhotoBy(rowIdx, -1); }

// ── Photo page (optional, per-report) ──────────────────────────────────
// Builds the "Photos" section that sits between Result and the save bar.
// Six slots fixed for now (matches the photo-page block's default 2 × 3
// grid); base64 image data is stored on _ovPhotos and saved onto the
// report so the photo-page block can render them.
// Find every single-photo / single-drawing block in the active method's
// saved template. Returns [{id, label, kind, detailsBlockId?}, …] in
// document order across all pages. Used by the Photos section to surface
// one upload tile per block — each tile stores its image under the
// block's id, so multiple blocks of either kind can coexist without
// aliasing. kind drives the placeholder icon shown when the slot is
// empty; detailsBlockId, when set, surfaces a textarea below the tile
// for typed information that will print under the photo on the report.
function _ovSinglePhotoBlocks(){
  if(!_ovMethod || typeof CV_METHOD_TPL_PREFIX === 'undefined' || typeof ls !== 'function') return [];
  try {
    const tpl = ls(CV_METHOD_TPL_PREFIX + _ovMethod, null);
    if(!tpl || !Array.isArray(tpl.pages)) return [];
    // First pass — gather all single-photo / single-drawing entries.
    const out = [];
    const byId = {};
    tpl.pages.forEach(pg => {
      if(!pg || !Array.isArray(pg.blocks)) return;
      pg.blocks.forEach(b => {
        if(!b || !b.id) return;
        if(b.key === 'single-photo'){
          const e = { id: b.id, kind: 'photo',   label: (b.text || 'Single image').toString() };
          out.push(e); byId[b.id] = e;
        } else if(b.key === 'single-drawing'){
          const e = { id: b.id, kind: 'drawing', label: (b.text || 'Single drawing').toString() };
          out.push(e); byId[b.id] = e;
        }
      });
    });
    // Second pass — for each photo-details block, attach its block id to
    // the linked photo entry so the tile can render the textarea inline.
    // Last-write-wins on multiple details blocks pointing at the same
    // photo (the inspector can always reassign in the Properties panel).
    tpl.pages.forEach(pg => {
      if(!pg || !Array.isArray(pg.blocks)) return;
      pg.blocks.forEach(b => {
        if(b && b.key === 'photo-details' && b.linkedPhotoId && byId[b.linkedPhotoId]){
          byId[b.linkedPhotoId].detailsBlockId = b.id;
          byId[b.linkedPhotoId].detailsLabel   = (b.text || 'Details / information').toString();
        }
      });
    });
    return out;
  } catch(e){ return []; }
}

function _ovPhotosSectionHtml(){
  const enabled = Array.isArray(_ovPhotos) && _ovPhotos.length > 0;
  const slots = enabled ? _ovPhotos.map((p, i) => {
    const tile = p
      ? `<div style="position:relative;aspect-ratio:4/3;border:1px solid var(--border);border-radius:4px;overflow:hidden;background:var(--bg2)">
          <img src="${p}" alt="Photo ${i+1}" style="width:100%;height:100%;object-fit:contain;display:block"/>
          <button type="button" data-action="ovRotatePhotoCCW" data-args="${i}" title="Rotate 90° counter-clockwise" style="position:absolute;top:4px;right:56px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;font-size:13px;line-height:1;padding:0">↺</button>
          <button type="button" data-action="ovRotatePhoto" data-args="${i}" title="Rotate 90° clockwise" style="position:absolute;top:4px;right:30px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;font-size:13px;line-height:1;padding:0">↻</button>
          <button type="button" data-action="ovClearPhoto" data-args="${i}" title="Remove photo" style="position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;font-size:13px;line-height:1;padding:0">✕</button>
        </div>`
      : `<label style="aspect-ratio:4/3;border:1px dashed var(--border);border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;background:var(--bg2);color:var(--t3);gap:4px">
          <span style="font-size:24px">📷</span>
          <span style="font-size:11px">Choose photo ${i+1}</span>
          <input type="file" accept="image/*" style="display:none" data-on-change="ovSetPhotoFromFile" data-pass-el="1" data-args="${i}"/>
        </label>`;
    // Caption input below every slot — typed text appears under the photo
    // on the printed page; empty captions are dropped on save so unused
    // slots stay clean. Wrapping tile + input in a <div> makes the grid
    // cells uniform height regardless of caption-strip state.
    const cap = (Array.isArray(_ovPhotoCaptions) && _ovPhotoCaptions[i]) || '';
    return `<div>
      ${tile}
      <input type="text" placeholder="Caption (optional)" value="${escapeHtml(cap)}"
        data-on-input="ovSetPhotoCaption" data-pass-el="1" data-args="${i}"
        style="width:100%;margin-top:5px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:5px 8px;box-sizing:border-box"/>
    </div>`;
  }).join('') : '';

  // Single-photo blocks present in the active method's template — one
  // upload tile each, labelled with the block's text so the inspector
  // knows which slot they're filling (e.g. "Site overview", "Defect 1").
  const singleBlocks = _ovSinglePhotoBlocks();
  const singleSlots = singleBlocks.map(b => {
    const p = _ovSinglePhotos && _ovSinglePhotos[b.id];
    const idArg = `'${b.id}'`;
    const placeIco   = b.kind === 'drawing' ? '📐' : '🖼';
    const placeLabel = b.kind === 'drawing' ? 'Choose drawing' : 'Choose image';
    // Details textarea — present only when the template has a
    // photo-details block linked to this photo. Stored under the
    // details-block id so multiple photo-details blocks (each linked to
    // a different photo) stay independent.
    let detailsBox = '';
    if(b.detailsBlockId){
      const dArg = `'${b.detailsBlockId}'`;
      const txt = (_ovPhotoDetails && _ovPhotoDetails[b.detailsBlockId]) || '';
      detailsBox = `<textarea data-on-input="ovSetPhotoDetails" data-pass-el="1" data-args="${dArg}"
        placeholder="${escapeHtml(b.detailsLabel || 'Details / information')}"
        rows="3"
        style="width:100%;margin-top:6px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--t1);font-size:11px;padding:6px 8px;box-sizing:border-box;font-family:inherit;resize:vertical;min-height:54px">${escapeHtml(txt)}</textarea>`;
    }
    return `<div>
      <div style="font-size:10.5px;color:var(--t2);margin-bottom:4px">${escapeHtml(b.label)}</div>
      ${p
        ? `<div style="position:relative;aspect-ratio:4/3;border:1px solid var(--border);border-radius:4px;overflow:hidden;background:var(--bg2)">
            <img src="${p}" alt="${escapeHtml(b.label)}" style="width:100%;height:100%;object-fit:contain;display:block"/>
            <button type="button" data-action="ovRotateSinglePhotoCCW" data-args="${idArg}" title="Rotate 90° counter-clockwise" style="position:absolute;top:4px;right:56px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;font-size:13px;line-height:1;padding:0">↺</button>
            <button type="button" data-action="ovRotateSinglePhoto"    data-args="${idArg}" title="Rotate 90° clockwise"         style="position:absolute;top:4px;right:30px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;font-size:13px;line-height:1;padding:0">↻</button>
            <button type="button" data-action="ovClearSinglePhoto"     data-args="${idArg}" title="Remove ${b.kind==='drawing'?'drawing':'image'}" style="position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;font-size:13px;line-height:1;padding:0">✕</button>
          </div>`
        : `<label style="aspect-ratio:4/3;border:1px dashed var(--border);border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;background:var(--bg2);color:var(--t3);gap:4px">
            <span style="font-size:24px">${placeIco}</span>
            <span style="font-size:11px">${placeLabel}</span>
            <input type="file" accept="image/*" style="display:none" data-on-change="ovSetSinglePhotoFromFile" data-pass-el="1" data-args="${idArg}"/>
          </label>`}
      ${detailsBox}
    </div>`;
  }).join('');

  // Section is shown whenever there's anything to offer: either the photo
  // page can be added/edited, or the template has at least one single-photo
  // block. If neither applies the section is still rendered with just the
  // "+ Add photo page" button — same as before.
  return `<div class="sc" id="ov-nr-photos-section" style="margin:0 14px 14px">
    <div class="sc-head" style="display:flex;align-items:center">
      <span class="sc-title">Photos</span>
      <span style="flex:1"></span>
      ${enabled ? `<button class="btn btn-sm" data-action="ovRemovePhotoPage" title="Cancel — remove the photo page from this report">Remove photo page</button>` : ''}
    </div>
    <div class="sc-body" style="padding:14px 16px;display:flex;flex-direction:column;gap:14px">
      ${enabled
        ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${slots}</div>`
        : `<div><button class="btn btn-sm" data-action="ovAddPhotoPage" style="padding:8px 14px;font-size:12px">+ Add photo page</button></div>`}
      ${singleBlocks.length > 0
        ? `<div>
            <div style="font-size:11px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">${
              singleBlocks.every(b => b.kind === 'drawing') ? 'Drawings from this template'
              : singleBlocks.every(b => b.kind === 'photo') ? 'Single images from this template'
              : 'Images & drawings from this template'
            }</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${singleSlots}</div>
          </div>`
        : ''}
    </div>
  </div>`;
}

function ovRenderPhotosSection(){
  const cur = document.getElementById('ov-nr-photos-section');
  if(!cur) return;
  cur.outerHTML = _ovPhotosSectionHtml();
}

function ovAddPhotoPage(){
  _ovPhotos = new Array(6).fill(null);
  _ovPhotoCaptions = new Array(6).fill('');
  ovRenderPhotosSection();
}

async function ovRemovePhotoPage(){
  if(Array.isArray(_ovPhotos) && _ovPhotos.some(p => !!p) && typeof vxConfirm === 'function'){
    const ok = await vxConfirm({ message: 'Remove the photo page from this report? Any photos you added will be cleared.', okLabel: 'Remove', cancelLabel: 'Keep', danger: true });
    if(!ok) return;
  }
  _ovPhotos = [];
  _ovPhotoCaptions = [];
  ovRenderPhotosSection();
}

function ovSetPhotoFromFile(i, el){
  const file = el && el.files && el.files[0];
  if(!file) return;
  if(file.size > 2 * 1024 * 1024){
    toast(t('toast.photo_too_large','Photo must be under 2 MB.'), 'error');
    el.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    if(!Array.isArray(_ovPhotos) || _ovPhotos.length === 0) _ovPhotos = new Array(6).fill(null);
    if(!Array.isArray(_ovPhotoCaptions) || _ovPhotoCaptions.length === 0) _ovPhotoCaptions = new Array(6).fill('');
    _ovPhotos[i] = e.target.result;
    ovRenderPhotosSection();
  };
  reader.readAsDataURL(file);
}

function ovClearPhoto(i){
  if(Array.isArray(_ovPhotos)) _ovPhotos[i] = null;
  // Clear the caption too — a caption that outlives its photo would
  // attach to whatever the inspector uploads next, which isn't what
  // anyone would expect.
  if(Array.isArray(_ovPhotoCaptions)) _ovPhotoCaptions[i] = '';
  ovRenderPhotosSection();
}

// Caption typed below a photo slot in the new-report form. Stored in
// _ovPhotoCaptions[i] mirroring _ovPhotos[i]. Updated on every keystroke
// so partial typing survives ovRenderPhotosSection redraws (rotate /
// remove / re-upload). No re-render here — the input owns its DOM value.
function ovSetPhotoCaption(i, el){
  if(!Array.isArray(_ovPhotoCaptions)) _ovPhotoCaptions = new Array(6).fill('');
  _ovPhotoCaptions[i] = (el && typeof el.value === 'string') ? el.value : '';
}

// Rotate a slot's photo by ±90°. The rotation is baked into the stored
// dataURL via a canvas so the orientation is permanent — the saved report,
// the photo-page block and the printed PDF all show the same rotated image.
// Each press rotates a further 90°; four presses return to the original.
// PNG sources keep their format (transparency preserved); everything else
// re-encodes as JPEG at 0.9 quality, which keeps file size close to the
// original after a couple of rotations.
//
// dir = +1 → clockwise; dir = -1 → counter-clockwise.
function _ovRotatePhotoBy(i, dir){
  if(!Array.isArray(_ovPhotos) || !_ovPhotos[i]) return;
  const src = _ovPhotos[i];
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width  = img.naturalHeight;
    c.height = img.naturalWidth;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(dir * Math.PI / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    const isPng = /^data:image\/png/i.test(src);
    _ovPhotos[i] = isPng ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
    ovRenderPhotosSection();
  };
  img.onerror = () => { if(typeof toast === 'function') toast('Could not rotate photo.', 'error'); };
  img.src = src;
}
function ovRotatePhoto(i)    { _ovRotatePhotoBy(i, +1); }
function ovRotatePhotoCCW(i) { _ovRotatePhotoBy(i, -1); }

// ── Single-photo block uploads ─────────────────────────────────────────
// Each single-photo block in the active template surfaces one upload tile
// in the Photos section. The image is stored on _ovSinglePhotos under the
// block's id (stable across template re-orderings) and serialised to
// report.singlePhotos on save so the single-photo render branch picks it
// up directly. Same 2 MB cap, same canvas-rotate-and-bake mechanism as
// the photo-page slots.
function ovSetSinglePhotoFromFile(blockId, elInput){
  const file = elInput && elInput.files && elInput.files[0];
  if(!file) return;
  if(file.size > 2 * 1024 * 1024){
    toast(t('toast.photo_too_large','Photo must be under 2 MB.'), 'error');
    elInput.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    if(!_ovSinglePhotos || typeof _ovSinglePhotos !== 'object') _ovSinglePhotos = {};
    _ovSinglePhotos[blockId] = e.target.result;
    ovRenderPhotosSection();
  };
  reader.readAsDataURL(file);
}

function ovClearSinglePhoto(blockId){
  if(_ovSinglePhotos && typeof _ovSinglePhotos === 'object') delete _ovSinglePhotos[blockId];
  ovRenderPhotosSection();
}

function _ovRotateSinglePhotoBy(blockId, dir){
  if(!_ovSinglePhotos || !_ovSinglePhotos[blockId]) return;
  const src = _ovSinglePhotos[blockId];
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width  = img.naturalHeight;
    c.height = img.naturalWidth;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(dir * Math.PI / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    const isPng = /^data:image\/png/i.test(src);
    _ovSinglePhotos[blockId] = isPng ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
    ovRenderPhotosSection();
  };
  img.onerror = () => { if(typeof toast === 'function') toast('Could not rotate photo.', 'error'); };
  img.src = src;
}
function ovRotateSinglePhoto(blockId)    { _ovRotateSinglePhotoBy(blockId, +1); }
function ovRotateSinglePhotoCCW(blockId) { _ovRotateSinglePhotoBy(blockId, -1); }

// Per-photo details textarea handler. Stored on _ovPhotoDetails under
// the photo-details block's id (not the photo's) so each details card
// keeps its own text independently. Updated on every keystroke so partial
// typing survives any redraw of the Photos section (rotate, re-upload).
// No re-render here — the textarea owns its DOM value.
function ovSetPhotoDetails(blockId, elInput){
  if(!_ovPhotoDetails || typeof _ovPhotoDetails !== 'object') _ovPhotoDetails = {};
  _ovPhotoDetails[blockId] = (elInput && typeof elInput.value === 'string') ? elInput.value : '';
}

function ovItemsRerender() {
  // Replace just the items-table section in place. The section is the only
  // .sc whose header contains the title "Examination details". Preserves
  // the remarks textarea content across re-renders by snapshotting it
  // before replacement — without this, +Add row / −Remove row would wipe
  // any remarks the user had already typed.
  const sections = document.querySelectorAll('#ov-nr-body .sc');
  for(const sec of sections) {
    const title = sec.querySelector('.sc-title');
    if(title && title.textContent.trim() === 'Examination details') {
      const remarksEl = document.getElementById('ov-exam-remarks');
      const remarks = remarksEl ? remarksEl.value : '';
      const tmp = document.createElement('div');
      tmp.innerHTML = ovRenderItemsTable(_ovMethod, _ovItems, remarks);
      const fresh = tmp.firstElementChild;
      if(fresh) sec.replaceWith(fresh);
      return;
    }
  }
}

function ovSaveReport(mode) {
  if(!_ovMethod) { toast(t('toast.no_method', 'No method selected.'), 'error'); return; }
  const m = NDT_METHODS.find(x => x.id === _ovMethod); if(!m) return;
  // A non-admin without a valid certification for this method can't
  // sign the report — refuse the save (the reason was already shown in
  // a popup when the form opened).
  if(_ovSignBlockReason){
    if(typeof vxConfirm === 'function'){
      vxConfirm({ title: 'Cannot sign report', message: _ovSignBlockReason, okLabel: 'OK', cancelLabel: 'OK' });
    } else {
      toast(_ovSignBlockReason, 'error');
    }
    return;
  }
  const allFields = [...RPT_FORM.client, ...RPT_FORM.subject, ...RPT_FORM.exam, ...RPT_FORM.result];
  const specific = [...(TPL_FIELDS._common || []), ...(TPL_FIELDS[_ovMethod] || [])].map(f => ({...f, id:'eq_'+f.id}));
  const all = [...allFields, ...specific];
  const report = { method: _ovMethod, createdAt: new Date().toISOString() };
  all.forEach(f => {
    const inp = el(`rf-${_ovMethod}-${f.id}`);
    if(inp) report[f.id] = (f.type === 'select') ? inp.value : inp.value.trim();
  });
  // Report revision is system-assigned, not a typed field: 00 for a new
  // report, the next number when revising an existing one.
  report.revision = _ovReviseSource
    ? _ovBumpRevision((_ovReviseSource.revision || '00').trim())
    : '00';
  // Equipment-register snapshot — if any field was rendered via the
  // equipment dropdown (useEquipmentRegister:true on the TPL_FIELDS
  // entry), the stored value is an equipment id. Resolve it against
  // the live register and freeze the equipment's name / svId / last
  // cal date onto the report so the historical record is stable even
  // if the equipment record is later edited or deleted. Also keeps
  // r.eq_id around for traceability / live-lookup place cards.
  try {
    const eqList = (typeof eqLoad === 'function') ? eqLoad() : [];
    all.forEach(f => {
      if(!f.useEquipmentRegister) return;
      const pickedId = report[f.id];
      if(!pickedId) return;
      const rec = eqList.find(r => r.id === pickedId);
      if(f.eqType) {
        // Light meter picker (UV-A / white-light) — keep the register id
        // on the field so the light/UV smart card resolves it; never
        // claim the primary eq_id / eq_svid / eq_caldate snapshot, which
        // belongs to the main NDT equipment.
        if(!rec) report[f.id] = '';
      } else if(rec) {
        report.eq_id = rec.id;
        report[f.id] = rec.name || '';
        if(rec.svId)      report.eq_svid    = rec.svId;
        if(rec.calLastAt) report.eq_caldate = rec.calLastAt;
      } else {
        // Picked id no longer exists (equipment was deleted between
        // render and save). Don't carry a dead reference forward.
        report[f.id] = '';
      }
    });
  } catch(e) { console.warn('equipment snapshot failed', e); }
  // Inspected-items table — capture every row, then mirror row 0 to the
  // top-level report fields so existing PDF place cards, list filters, and
  // CSV exports keep reading r.subject / r.drawing / r.welders / … as
  // before. Trailing empty rows are dropped so a single-item report still
  // saves with items: [{…}] only.
  ovItemsSync();
  const items = _ovItems
    .map(row => {
      const clean = {};
      RPT_ITEM_FIELD_IDS.forEach(fid => {
        let v = (row[fid] || '').toString().trim();
        // Normalise dimensions on save in case the blur handler didn't
        // run (e.g. user clicked Save while the dimensions cell still
        // had focus). ovFormatDimensions is idempotent — safe to call
        // on values that already carry the prefix / suffix.
        if(fid === 'dimensions' && v) v = ovFormatDimensions(v);
        if(v) clean[fid] = v;
      });
      // Defect detail fields — typed in the Defects section of the form
      // and persisted on the item itself. Carried only when verdict is
      // 'Not acceptable' so an inspector who toggles a verdict back to
      // 'Acceptable' doesn't leave stale defect text against an accepted
      // item (and so the defect-table render branch's filter pulls in
      // exactly the rows the inspector intended).
      if(clean.verdict === 'Not acceptable'){
        ['defectType','defectSize'].forEach(fid => {
          const v = (row[fid] || '').toString().trim();
          if(v) clean[fid] = v;
        });
      }
      return clean;
    })
    .filter(row => Object.keys(row).length > 0);
  if(items.length) {
    report.items = items;
    // Mirror row 0's values to the top-level report fields (legacy place
    // cards / filters / CSV). `verdict` is excluded — the overall verdict
    // is rolled up from every row's result below, not taken from row 0.
    RPT_ITEM_FIELD_IDS.forEach(fid => {
      if(fid === 'verdict') return;
      if(items[0][fid] !== undefined) report[fid] = items[0][fid];
    });
  }
  // Overall verdict is derived from the inspected-items results — worst
  // case wins — rather than entered as a separate sign-off field.
  report.verdict = _ovOverallVerdict(items);
  // Photo page — when the inspector has added one, store the slot array
  // (nulls preserved so the photo-page block renders slot-by-slot).
  if(Array.isArray(_ovPhotos) && _ovPhotos.length && _ovPhotos.some(p => !!p)){
    report.photos = _ovPhotos.map(p => p || null);
    // Captions are stored only for slots that actually carry a photo —
    // a caption typed into an empty slot is dropped on save so it can't
    // resurface against whatever fills that slot on a later revision.
    if(Array.isArray(_ovPhotoCaptions) && _ovPhotoCaptions.some((c, i) => !!_ovPhotos[i] && (c || '').trim())){
      report.photoCaptions = _ovPhotos.map((p, i) => (p && _ovPhotoCaptions[i]) ? String(_ovPhotoCaptions[i]) : '');
    }
  }
  // Single-photo blocks — copy any filled slots over (keyed by block.id so
  // each single-photo block in the template lands on its own render branch).
  if(_ovSinglePhotos && typeof _ovSinglePhotos === 'object'){
    const _kept = {};
    Object.keys(_ovSinglePhotos).forEach(k => { if(_ovSinglePhotos[k]) _kept[k] = _ovSinglePhotos[k]; });
    if(Object.keys(_kept).length) report.singlePhotos = _kept;
  }
  // Photo-details cards — copy typed text (trimmed of trailing whitespace)
  // for any details block that actually has content. Empty entries are
  // dropped so saved reports stay compact and so an empty card with no
  // text can't print a stray heading bar when its linked photo is empty.
  if(_ovPhotoDetails && typeof _ovPhotoDetails === 'object'){
    const _kept = {};
    Object.keys(_ovPhotoDetails).forEach(k => {
      const v = (_ovPhotoDetails[k] || '').replace(/\s+$/, '');
      if(v) _kept[k] = v;
    });
    if(Object.keys(_kept).length) report.photoDetails = _kept;
  }
  // Required-field guard — a saved report must carry the essentials.
  // Without this a report could be saved with no client, inspector or
  // examined items at all.
  const _missing = [];
  if(!String(report.client || '').trim())    _missing.push('Client');
  if(!String(report.inspector || '').trim()) _missing.push('Inspector');
  if(!items.length)                          _missing.push('at least one examination item');
  if(_missing.length){
    toast(t('toast.report_missing','Cannot save — please complete') + ': ' + _missing.join(', ') + '.', 'error');
    return;
  }
  // Examination remarks — free-text notes printed in the empty space
  // below the items table on the place card. Saved alongside the items
  // so the PDF render can pull them on the next preview.
  const remarksEl = document.getElementById('ov-exam-remarks');
  const examRemarks = remarksEl ? remarksEl.value.trim() : '';
  if(examRemarks) report.examRemarks = examRemarks;
  // Revising an existing report: do nothing if no editable content
  // changed (a no-op open/save creates no revision), keep the original
  // report number, and seed report.revisions with the source's history
  // so the guardrail below appends to it.
  if(_ovReviseSource){
    if(!_ovReportChanged(report, _ovReviseSource)){
      toast(t('toast.revision_no_change','No changes were made — no revision created.'), 'info');
      return;
    }
    report.reportNo    = _ovReviseSource.reportNo || report.reportNo;
    report.revisedFrom = _ovReviseSource.reportNo || '';
    report.revisions   = Array.isArray(_ovReviseSource.revisions) ? _ovReviseSource.revisions.slice() : [];
  }
  // Revision-change guardrail — if the user bumped the revision number,
  // require a non-empty reason and log it. Without a reason the save is
  // blocked and the textarea is focused so the inspector can supply one.
  const newRev = (report.revision || '').trim();
  if(newRev !== _ovRevisionOriginal) {
    const reasonEl = document.getElementById('ov-revision-reason');
    const reason = reasonEl ? reasonEl.value.trim() : '';
    if(!reason) {
      toast(t('toast.revision_reason_required', 'A reason is required when the revision number changes.'), 'error');
      if(reasonEl) reasonEl.focus();
      return;
    }
    if(!Array.isArray(report.revisions)) report.revisions = [];
    report.revisions.push({
      rev: newRev,
      fromRev: _ovRevisionOriginal,
      date: new Date().toISOString(),
      reason,
      author: CURRENT_USER ? (CURRENT_USER.name || CURRENT_USER.email || '') : '',
    });
  }
  // V6: ensure new report has stage + audit log. "Save" issues the report
  // straight to the Approved stage; "For review" puts it at the Submitted
  // stage so it appears in the reviewers' Inbox instead.
  const forReview = (mode === 'review');
  report.stage = forReview ? 'Submitted' : 'Approved';
  report.auditLog = [];
  if(CURRENT_USER) report.createdBy = CURRENT_USER.id;
  addReportAudit(report, 'created', _ovReviseSource ? ('Revision ' + (report.revision||'') + ' created') : 'Report created');
  addReportAudit(report, forReview ? 'submitted' : 'approved', forReview ? 'Submitted for review' : 'Approved on save');
  // Stage 2 — freeze the fully rendered report so reprints are identical
  // regardless of any later template / register change. Stored as a
  // self-contained HTML document on the record.
  try {
    if(typeof ovBuildReportSnapshot === 'function') report.frozenHtml = ovBuildReportSnapshot(report);
  } catch(e){ console.warn('report snapshot failed', e); }
  // Save
  const reports = ls(KEYS.reports, []);
  reports.push(report);
  lss(KEYS.reports, reports);
  // Increment numbering — a revision keeps the original report number,
  // so the counter only advances for a genuinely new report.
  if(!_ovReviseSource){
    const s = ls(KEYS.settings, {});
    s.numNext = (parseInt(s.numNext || '1')) + 1;
    lss(KEYS.settings, s);
  }
  updateReportCount();
  if(typeof updateInboxBadge === 'function') updateInboxBadge();
  toast(forReview ? `${m.id} report submitted for review.` : `${m.id} report saved.`);
  ovShowSection('dashboard', el('ovi-dashboard'));
}

// Close the report form without saving — e.g. a report opened by
// mistake. Returns to the Reports page when this was an opened report,
// else back to the dashboard. Nothing is written, so the original
// report and any revisions are untouched.
async function ovCancelReport(){
  if(typeof vxConfirm === 'function'){
    const ok = await vxConfirm({ message: 'Close this report without saving? Any changes you have made will be lost.', okLabel: 'Close', cancelLabel: 'Keep editing' });
    if(!ok) return;
  }
  if(_ovReviseSource && typeof showPage === 'function'){
    showPage('reports', document.querySelectorAll('.tn')[2]);
  } else {
    ovShowSection('dashboard', el('ovi-dashboard'));
  }
}

async function ovResetReport() {
  if(!_ovMethod) return;
  if(!await vxConfirm({ message: 'Are you sure you want to clear the report form? Any unsaved changes will be lost.', okLabel: t('vxc.clear','Clear'), danger: true })) return;
  ovNewReport(_ovMethod, document.querySelector('#ov-snav .snav-item.active'));
}

function ovRenderRecentList() {
  const reports = ls(KEYS.reports, []);
  const wrap = el('ov-reports-table'); if(!wrap) return;
  // TEST TOOL — bulk-clear button for wiping test data during local
  // testing. Built first so it shows in BOTH the empty and populated
  // states. Remove this bar and ovClearAllReports() before release.
  const _testBar = `<div style="margin-bottom:10px;padding:6px 10px;border:1px dashed var(--amber);border-radius:6px;display:flex;align-items:center;gap:10px;background:rgba(245,166,35,.06);flex-wrap:wrap">
    <span style="font-size:10px;font-family:var(--mono);color:var(--amber);text-transform:uppercase;letter-spacing:.05em">⚠ Test tool</span>
    <button class="btn btn-sm btn-danger" data-action="ovClearAllReports" style="font-size:11px">Delete all reports</button>
    <span style="font-size:10px;color:var(--t3)">Temporary — clears test data; remove before the cloud release.</span>
  </div>`;
  if(!reports.length) {
    wrap.innerHTML = _testBar + '<div style="text-align:center;color:var(--t3);font-size:13px;padding:20px">No reports saved yet.</div>';
    return;
  }
  let html = _testBar;
  html += `<table class="tbl" style="width:100%"><thead><tr>
    <th scope="col" style="width:40px">Method</th><th scope="col">Report no.</th><th scope="col">Rev</th><th scope="col">Client</th><th scope="col">Date</th><th scope="col">Verdict</th><th scope="col" style="width:168px"></th>
  </tr></thead><tbody>`;
  reports.slice().reverse().forEach((r, i) => {
    const md = NDT_METHODS.find(x => x.id === r.method);
    const idx = reports.length - 1 - i;
    html += `<tr>
      <td><span style="font-family:var(--mono);font-weight:600;color:${md?.color||'var(--t2)'}">${r.method||'—'}</span></td>
      <td style="font-family:var(--mono);font-size:12px">${r.reportNo||'—'}</td>
      <td style="font-family:var(--mono);font-size:12px">${r.revision||'00'}</td>
      <td>${escapeHtml(r.client||'—')}</td>
      <td style="font-family:var(--mono);font-size:11px">${fmtDate(r.createdAt)}</td>
      <td><span class="badge badge-${r.verdict==='Acceptable'?'green':r.verdict==='Not acceptable'?'red':r.verdict==='Various'?'amber':'blue'}" style="font-size:10px">${r.verdict||'Draft'}</span></td>
      <td style="white-space:nowrap"><button class="btn btn-sm" data-action="ovPrintReport" data-args="${idx}" style="margin-right:4px">PDF</button><button class="btn btn-sm" data-action="ovViewReport" data-args="${idx}" style="margin-right:4px">Open</button><button class="btn btn-sm" data-action="ovOpenReport" data-args="${idx}" style="margin-right:4px">Revise</button><button class="btn btn-sm btn-danger" data-action="ovDeleteReport" data-args="${idx}">Del</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// Open a saved report for revision. Loads it back into the report form
// in revision mode (see ovNewReport's sourceReport path) — same report
// number, next revision, reason required on save.
function ovOpenReport(idx){
  const reports = ls(KEYS.reports, []);
  const r = reports[idx];
  if(!r){ toast(t('toast.report_not_found','Report not found.'),'error'); return; }
  // A superseded revision is locked — once a higher revision of the same
  // report number exists, only the current revision can be opened.
  const _rev = parseInt(r.revision, 10) || 0;
  if(reports.some(o => o.reportNo && o.reportNo === r.reportNo && (parseInt(o.revision, 10) || 0) > _rev)){
    toast(t('toast.report_superseded','This revision is superseded — open the current revision to make changes.'), 'error');
    return;
  }
  // Came from the Reports page — switch to the Overview page first, since
  // ovNewReport only activates the new-report SECTION within it. Without
  // this the form is built on a page that isn't on screen.
  if(typeof showPage === 'function') showPage('overview', document.querySelector('.tn'));
  ovNewReport(r.method, null, r);
}

// TEST TOOL — wipes every saved report in one click, for resetting test
// data during local testing. Remove this function and the button in
// ovRenderRecentList before the cloud release.
async function ovClearAllReports(){
  const reports = ls(KEYS.reports, []);
  if(!reports.length){ toast(t('toast.no_reports','No reports to delete.')); return; }
  if(!await vxConfirm({ message: 'Delete ALL ' + reports.length + ' saved report(s)? This testing tool cannot be undone.', okLabel: t('vxc.delete','Delete all'), danger: true })) return;
  lss(KEYS.reports, []);
  updateReportCount();
  ovRenderRecentList();
  toast(t('toast.all_reports_deleted','All test reports deleted.'));
}

async function ovDeleteReport(idx) {
  if(!await vxConfirm({ message: 'Are you sure you want to delete this report? This action cannot be undone.', okLabel: t('vxc.delete','Delete'), danger: true })) return;
  const reports = ls(KEYS.reports, []);
  reports.splice(idx, 1);
  lss(KEYS.reports, reports);
  updateReportCount();
  ovRenderRecentList();
  toast(t('toast.report_deleted','Report deleted.'));
}

// ══════════════════════════════════════════════════════════════════════════
// V9 INTEGRATIONS — ICS export, webhook outbox, public API, unified audit log
// ══════════════════════════════════════════════════════════════════════════

// ── ICS calendar export ──────────────────────────────────────────────
function _icsEscape(s){ return String(s||'').replace(/[\\;,]/g, m => '\\'+m).replace(/\n/g, '\\n'); }
function _icsDate(d){
  // Format: YYYYMMDD (date only, all-day event)
  const dd = (d instanceof Date) ? d : new Date(d);
  const y = dd.getFullYear();
  const m = String(dd.getMonth()+1).padStart(2,'0');
  const da = String(dd.getDate()).padStart(2,'0');
  return `${y}${m}${da}`;
}
function _icsBuild(events){
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Veritix//NDT Inspect//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  events.forEach(ev => {
    lines.push('BEGIN:VEVENT');
    lines.push('UID:'+ev.uid);
    lines.push('DTSTAMP:'+ _icsDate(new Date()) + 'T000000Z');
    lines.push('DTSTART;VALUE=DATE:'+_icsDate(ev.start));
    if(ev.end) lines.push('DTEND;VALUE=DATE:'+_icsDate(ev.end));
    lines.push('SUMMARY:'+_icsEscape(ev.title));
    if(ev.description) lines.push('DESCRIPTION:'+_icsEscape(ev.description));
    if(ev.alarm){
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:'+_icsEscape(ev.title));
      lines.push('TRIGGER:-P'+ev.alarm+'D');
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function _downloadIcs(filename, content){
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click(); URL.revokeObjectURL(url);
}
function exportCertIcs(){
  const inspectors = ls(KEYS.inspectors, []);
  const events = [];
  inspectors.forEach(ins => {
    _inspCertList(ins).forEach(c => {
      if(!c.expiry) return;
      const d = new Date(c.expiry);
      if(isNaN(d)) return;
      events.push({
        uid: 'cert-'+(ins.id||ins.name).replace(/[^a-z0-9]/gi,'')+'-'+c.method+'@veritix',
        start: d,
        end: new Date(d.getTime() + 24*60*60*1000),
        title: c.method + ' cert expiry — ' + (ins.name||'?'),
        description: 'Method: ' + c.method + '\\nCert no.: ' + (c.certNo||'—') + '\\nAuthority: ' + (c.authority||'—'),
        alarm: 30,
      });
    });
  });
  if(!events.length){ toast(t('toast.no_certs_to_export','No certifications with expiry dates to export.'), 'warn'); return; }
  _downloadIcs('veritix-cert-expiries.ics', _icsBuild(events));
  toast(t('toast.calendar_imported','Calendar file downloaded — import into Outlook, Google, or Apple Calendar.'), 'success');
}
function exportReportIcs(){
  // Report "due dates" = stale-flag thresholds for in-progress stages
  const reports = ls(KEYS.reports, []);
  const events = [];
  reports.forEach(r => {
    const stage = getReportStage(r);
    if(stage === 'Approved' || stage === 'Archived') return;
    const lastChange = new Date(r.stageUpdatedAt || r.createdAt || Date.now());
    const due = new Date(lastChange.getTime() + 7*24*60*60*1000);
    events.push({
      uid: 'rpt-'+(r.reportNo||lastChange.getTime()).toString().replace(/[^a-z0-9]/gi,'')+'@veritix',
      start: due,
      end: new Date(due.getTime() + 24*60*60*1000),
      title: `Review due — ${r.reportNo||'(report)'} (${stage})`,
      description: `Method: ${r.method||'?'}\\nClient: ${escapeHtml(r.client||'—')}\\nSubject: ${escapeHtml(r.subject||'—')}\\nInspector: ${escapeHtml(r.inspector||'—')}`,
      alarm: 0,
    });
  });
  if(!events.length){ toast(t('toast.no_in_progress','No in-progress reports with due dates.'), 'warn'); return; }
  _downloadIcs('veritix-report-due-dates.ics', _icsBuild(events));
  toast(t('toast.calendar_downloaded', 'Calendar file downloaded.'), 'success');
}

// Hook setReportStage so webhooks fire automatically on stage changes.
// Routes through the canonical webhook implementation defined above
// (webhookLoadConfig / webhookFire) which reads its config from
// KEYS.settings.webhook* — single source of truth.
var _origSetReportStage = setReportStage;
setReportStage = function(idx, newStage, comment){
  const all = ls(KEYS.reports, []);
  const r = all[idx];
  const fromStage = r ? getReportStage(r) : null;
  const result = _origSetReportStage(idx, newStage, comment);
  if(result && r){
    try {
      const cfg = webhookLoadConfig();
      const stageTrigger = 'stage:' + newStage;
      if(cfg.enabled && cfg.url && (cfg.triggers || []).includes(stageTrigger)){
        webhookFire('report.stage_changed', {
          sentAt: new Date().toISOString(),
          fromStage, toStage: newStage,
          report: {
            reportNo: r.reportNo, method: r.method, client: r.client,
            subject: r.subject, inspector: r.inspector, verdict: r.verdict,
            drawing: r.drawing, weldNo: r.weldNo,
            stage: newStage, createdAt: r.createdAt,
          },
          triggeredBy: CURRENT_USER ? { id: CURRENT_USER.id, name: CURRENT_USER.name } : null,
        });
      }
    } catch(e){ console.warn('webhook fire failed', e); }
  }
  return result;
};

// ── Public API export (snapshots) ──────────────────────────────────
function _downloadJson(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click(); URL.revokeObjectURL(url);
}
function apiExport(kind){
  const map = { reports: KEYS.reports, defects: KEYS.defects, inspectors: KEYS.inspectors };
  const k = map[kind]; if(!k){ toast(t('toast.unknown_export', 'Unknown export kind'), 'error'); return; }
  const data = ls(k, []);
  _downloadJson(`veritix-${kind}-${new Date().toISOString().split('T')[0]}.json`, {
    schema: 'veritix-v1',
    kind,
    exportedAt: new Date().toISOString(),
    count: data.length,
    items: data,
  });
  toast(`Exported ${data.length} ${kind}.`, 'success');
}
function apiOpenSchema(){
  let modal = document.getElementById('api-schema-modal');
  if(modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'api-schema-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)';
  modal.onclick = e => { if(e.target === modal) modal.remove(); };
  modal.innerHTML = `<div style="background:var(--panel);border:1px solid var(--border2);border-radius:14px;width:680px;max-width:96vw;max-height:80vh;display:flex;flex-direction:column;box-shadow:var(--sh-xl);overflow:hidden">
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:14px;font-weight:600;color:var(--t1)">Public data schema (v1)</div>
      <button class="btn btn-sm" data-action="_wRemoveById" data-args="\'api-schema-modal\'">Close</button>
    </div>
    <div style="overflow-y:auto;flex:1;padding:16px 20px;font-family:var(--mono);font-size:12px;line-height:1.6;color:var(--t1);white-space:pre-wrap">{
  "schema": "veritix-v1",
  "kind": "reports" | "defects" | "inspectors",
  "exportedAt": ISO 8601 string,
  "count": number,
  "items": [
    Report {
      reportNo: string,
      method: "UT" | "MT" | "PT" | "RT" | "VT" | "ET" | ...,
      stage: "Draft" | "Submitted" | "Reviewed" | "Approved" | "Archived",
      verdict: "Acceptable" | "Not acceptable" | "For information" | "Inconclusive",
      client: string, subject: string, drawing: string, weldNo: string,
      inspector: string, project: string, location: string,
      createdAt: ISO 8601,
      stageUpdatedAt: ISO 8601,
      auditLog: AuditEntry[],
      ...method-specific fields prefixed with "eq_"
    }

    Defect {
      defectId: string,
      type: string, severity: "Critical"|"High"|"Medium"|"Low",
      status: string, method: string, location: string,
      depth: string (mm), length: string (mm), width: string (mm),
      report: string, component: string, drawing: string,
      inspector: string, disposition: string, notes: string,
      photos: Photo[],
      createdAt: ISO 8601, updatedAt: ISO 8601
    }

    Inspector {
      id: string, name: string, email: string,
      methods: string[], certAuthority: string, certNumber: string,
      certExpiry: ISO 8601 date, level: string,
      signature: data URL (PNG)
    }

    AuditEntry {
      at: ISO 8601, by: string, byId: string|null,
      action: string, details: string
    }
  ]
}</div>
  </div>`;
  document.body.appendChild(modal);
  openA11yModal(modal);
}

// ── Unified audit log ──────────────────────────────────────────────
function auditLogGather(){
  const events = [];
  // Reports
  const reports = ls(KEYS.reports, []);
  reports.forEach(r => {
    (r.auditLog||[]).forEach(e => events.push({
      at: e.at, by: e.by, byId: e.byId, action: e.action, details: e.details,
      source: 'report', sourceId: r.reportNo || ''
    }));
  });
  // Defects (if defects.auditLog exists, otherwise infer 'created' from createdAt)
  const defects = ls(KEYS.defects, []);
  defects.forEach(d => {
    if(Array.isArray(d.auditLog)){
      d.auditLog.forEach(e => events.push({ at: e.at, by: e.by, byId: e.byId, action: e.action, details: e.details, source: 'defect', sourceId: d.defectId || '' }));
    } else if(d.createdAt){
      events.push({ at: d.createdAt, by: d.createdBy || '—', action: 'created', details: `${d.type||''} (${d.severity||''})`, source: 'defect', sourceId: d.defectId||'' });
    }
  });
  // Sort newest first
  events.sort((a, b) => (b.at||'').localeCompare(a.at||''));
  return events;
}
function auditLogRender(){
  const list = el('audit-log-list'); if(!list) return;
  const filter = (el('audit-log-filter')?.value||'').toLowerCase().trim();
  const source = el('audit-log-source')?.value || 'all';
  let events = auditLogGather();
  if(source !== 'all') events = events.filter(e => e.source === source);
  if(filter) events = events.filter(e => [e.by, e.action, e.details, e.sourceId, e.source].map(v => (v||'').toLowerCase()).join(' ').includes(filter));
  set('audit-log-count', events.length + ' event' + (events.length!==1?'s':'') + (filter || source !== 'all' ? ' (filtered)' : ''));
  if(!events.length){
    list.innerHTML = '<div style="padding:36px;text-align:center;color:var(--t3);font-size:13px">No matching events.</div>';
    return;
  }
  const sourceColor = { report:'var(--cyan)', defect:'var(--amber)', settings:'var(--violet)', user:'var(--green)' };
  list.innerHTML = events.slice(0, 200).map(e => `
    <div style="padding:9px 16px;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:flex-start">
      <span style="width:6px;height:6px;border-radius:50%;background:${sourceColor[e.source]||'var(--t3)'};margin-top:7px;flex-shrink:0"></span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;color:var(--t1)"><strong>${escapeHtml(e.by||'—')}</strong> · ${escapeHtml(e.action||'')}${e.sourceId?` · <span style="font-family:var(--mono);color:var(--cyan)">${escapeHtml(e.sourceId)}</span>`:''}</div>
        ${e.details?`<div style="font-size:11px;color:var(--t2);margin-top:2px;font-style:italic">"${escapeHtml(e.details)}"</div>`:''}
        <div style="font-size:10px;color:var(--t3);font-family:var(--mono);margin-top:3px">${e.at?new Date(e.at).toLocaleString():'—'} · ${e.source}</div>
      </div>
    </div>`).join('') + (events.length > 200 ? `<div style="padding:14px;text-align:center;color:var(--t3);font-size:11px">Showing first 200 of ${events.length} events. Use filter to narrow.</div>` : '');
}
function auditLogExportCsv(){
  const events = auditLogGather();
  if(!events.length){ toast(t('toast.no_audit_events','No audit events to export.'), 'warn'); return; }
  const headers = ['Timestamp','User','Action','Details','Source','Source ID'];
  const rows = events.map(e => [e.at||'', e.by||'', e.action||'', e.details||'', e.source||'', e.sourceId||''].map(v => '"'+String(v).replace(/"/g,'""')+'"'));
  const csv = [headers.join(','), ...rows.map(r=>r.join(','))].join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'veritix-audit-log-'+new Date().toISOString().split('T')[0]+'.csv';
  a.click(); URL.revokeObjectURL(url);
  toast(t('toast.audit_exported','Audit log exported.'), 'success');
}

// Wrap defect save to add audit entries
var _origDefSave = (typeof defSave === 'function') ? defSave : null;
if(_origDefSave){
  defSave = function(){
    const editIdx = (typeof _defEditIdx === 'number') ? _defEditIdx : -1;
    const before = editIdx >= 0 ? (ls(KEYS.defects, [])[editIdx]) : null;
    const result = _origDefSave.apply(this, arguments);
    // Find the (possibly new) record and append audit
    const all = ls(KEYS.defects, []);
    const target = editIdx >= 0 ? all[editIdx] : all[all.length-1];
    if(target){
      if(!Array.isArray(target.auditLog)) target.auditLog = [];
      target.auditLog.push({
        at: new Date().toISOString(),
        by: CURRENT_USER ? CURRENT_USER.name : 'System',
        byId: CURRENT_USER ? CURRENT_USER.id : null,
        action: before ? 'updated' : 'created',
        details: target.type ? `${target.type} (${target.severity||'?'})` : '',
      });
      lss(KEYS.defects, all);
    }
    return result;
  };
}

// Wire dbRefresh to also load webhook config + render audit on database tab open
var _origDbRefreshCard = (typeof dbRefreshCard === 'function') ? dbRefreshCard : null;
if(_origDbRefreshCard){
  dbRefreshCard = function(){
    const r = _origDbRefreshCard.apply(this, arguments);
    try { webhookLoadConfig(); auditLogRender(); } catch(e){ console.warn(e); }
    return r;
  };
}

