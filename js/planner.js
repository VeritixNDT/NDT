// ══════════════════════════════════════════════════════════════════════════
// PLANNER + CALENDAR (js/planner.js)
// ══════════════════════════════════════════════════════════════════════════
// A month / agenda calendar that (a) aggregates existing dated entities —
// jobs, report exam dates, inspector cert expiries, equipment calibration due,
// invoice/quote due dates — and (b) lets the user schedule their own events
// (site visits, bookings) in a new store (KEYS.events), optionally linked to a
// job + inspector. Read-only aggregated items click through to their source;
// custom events open an editor. Mirrors the app's load/save + render idiom.

// ── Custom-event store ──────────────────────────────────────────────────────
function plLoadEvents()     { return (typeof ls === 'function') ? (ls(KEYS.events, []) || []) : []; }
function plSaveEvents(list) { if (typeof lss === 'function') lss(KEYS.events, list); }
function plGetEvent(id)     { return plLoadEvents().find(e => e.id === id) || null; }

// ── State ───────────────────────────────────────────────────────────────────
var _plCursor  = new Date();    // any day within the displayed month
var _plView    = 'month';       // 'month' | 'agenda'
var _plFilters = null;          // Set of enabled source keys; null ⇒ all on
var _plEditId  = null;          // event id being edited (null = new)

var PL_SOURCES = [
  { key: 'event',   label: 'Events',          color: '#22b8cf' },
  { key: 'job',     label: 'Jobs',            color: '#5b8def' },
  { key: 'report',  label: 'Report exams',    color: '#9b87f5' },
  { key: 'cert',    label: 'Cert expiry',     color: '#f5a623' },
  { key: 'calib',   label: 'Calibration due', color: '#ff8c42' },
  { key: 'billing', label: 'Invoices/quotes', color: '#2fb380' },
];
function _plColor(key) { const s = PL_SOURCES.find(x => x.key === key); return s ? s.color : '#888'; }
function _plEnabled(key) { return !_plFilters || _plFilters.has(key); }

// ── Date helpers (work in local time; compare as yyyy-mm-dd strings) ─────────
function _plYmd(d)        { const z = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
function _plParse(ymd)    { const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function _plTodayYmd()    { return _plYmd(new Date()); }
function _plAddDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function _plMonthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
// Monday-based grid start: the Monday on/before the 1st of the cursor month.
function _plGridStart(d)  { const f = _plMonthStart(d); const dow = (f.getDay() + 6) % 7; return _plAddDays(f, -dow); }
function _plFmt(ymd)      { return (typeof fmtDate === 'function') ? fmtDate(ymd) : ymd; }

// ── Aggregation ─────────────────────────────────────────────────────────────
// Returns normalized items whose date falls in [startYmd, endYmd] (inclusive).
//   { ymd, endYmd, time, title, sub, type, refId, editable, overdue }
function plCollect(startYmd, endYmd, opts) {
  const out = [];
  const en = (opts && opts.all) ? (() => true) : _plEnabled;  // dashboard ignores legend filters
  const inRange = ymd => ymd && ymd >= startYmd && ymd <= endYmd;
  const push = o => { if (inRange(o.ymd) && en(o.type)) out.push(o); };

  // Custom events
  if (en('event')) plLoadEvents().forEach(e => push({
    ymd: String(e.date || '').slice(0, 10), endYmd: e.endDate ? String(e.endDate).slice(0, 10) : '',
    time: e.time || '', title: e.title || '(untitled)', sub: e.inspector || '',
    type: 'event', refId: e.id, editable: true,
  }));

  // Jobs (placed on their start date; range shown in the label)
  if (en('job')) jobLoad().forEach(j => {
    if (!j.startDate) return;
    const cust = (typeof jobCustomerName === 'function') ? jobCustomerName(j.customerId) : '';
    push({ ymd: String(j.startDate).slice(0, 10), endYmd: j.endDate ? String(j.endDate).slice(0, 10) : '',
      time: '', title: j.title || 'Job', sub: [cust, j.leadInspector].filter(Boolean).join(' · '),
      type: 'job', refId: j.id, editable: false });
  });

  // Report exam dates
  if (en('report')) (ls(KEYS.reports, []) || []).forEach(r => {
    if (!r.examDate) return;
    push({ ymd: String(r.examDate).slice(0, 10), endYmd: '', time: '',
      title: (r.method || '') + ' ' + (r.reportNo || ''), sub: r.client || r.project || '',
      type: 'report', refId: r.reportNo || r.id || '', editable: false });
  });

  // Inspector cert expiries (per-method + legacy + eye test)
  if (en('cert')) (ls(KEYS.inspectors, []) || []).forEach(ins => {
    const seen = [];
    const mc = ins.methodCerts || {};
    Object.keys(mc).forEach(m => { if (mc[m] && mc[m].expiry) seen.push([mc[m].expiry, m + ' cert']); });
    if (!seen.length && ins.certExpiry) seen.push([ins.certExpiry, 'cert']);
    if (ins.eyeTest && ins.eyeTest.expiry) seen.push([ins.eyeTest.expiry, 'eye test']);
    seen.forEach(([exp, what]) => push({ ymd: String(exp).slice(0, 10), endYmd: '', time: '',
      title: (ins.name || 'Inspector') + ' — ' + what + ' expires', sub: 'Certification',
      type: 'cert', refId: ins.id || '', editable: false }));
  });

  // Equipment calibration due
  if (en('calib')) eqLoad().forEach(eq => {
    if (!eq.calDueAt) return;
    push({ ymd: String(eq.calDueAt).slice(0, 10), endYmd: '', time: '',
      title: (eq.name || 'Equipment') + ' calibration due', sub: eq.svId || '',
      type: 'calib', refId: eq.id || '', editable: false });
  });

  // Invoices + quotes due
  if (en('billing')) {
    const today = _plTodayYmd();
    (billLoad('invoice') || []).forEach(d => { if (!d.dueDate) return;
      const ymd = String(d.dueDate).slice(0, 10);
      push({ ymd, endYmd: '', time: '', title: 'Invoice ' + (d.number || '') + ' due', sub: '',
        type: 'billing', refId: 'invoice:' + d.id, editable: false, overdue: ymd < today && d.status !== 'Paid' });
    });
    (billLoad('quote') || []).forEach(d => { if (!d.dueDate) return;
      push({ ymd: String(d.dueDate).slice(0, 10), endYmd: '', time: '', title: 'Quote ' + (d.number || '') + ' valid until',
        sub: '', type: 'billing', refId: 'quote:' + d.id, editable: false });
    });
  }

  out.sort((a, b) => (a.ymd === b.ymd) ? (a.time || '').localeCompare(b.time || '') : a.ymd.localeCompare(b.ymd));
  return out;
}

// ── Entry / render ───────────────────────────────────────────────────────────
function plInit() { _plInjectStyles(); plRender(); }

function plRender() {
  const root = document.getElementById('planner-root');
  if (!root) return;
  const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
  let periodLbl;
  if (_plView === 'week') {
    const ws = _plWeekStart(_plCursor), we = _plAddDays(ws, 6);
    periodLbl = ws.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' – ' +
                we.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } else {
    periodLbl = _plCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  const legend = PL_SOURCES.map(s =>
    `<span class="pl-chip ${_plEnabled(s.key) ? '' : 'off'}" data-action="plToggleFilter" data-args="'${s.key}'" title="Show/hide ${esc(s.label)}">
       <span class="pl-dot" style="background:${s.color}"></span>${esc(s.label)}</span>`).join('');

  root.innerHTML = `
    <div class="pl-head">
      <div class="pl-nav">
        <button class="pl-iconbtn" data-action="plPrev" title="Previous" aria-label="Previous">‹</button>
        <button class="btn btn-sm" data-action="plToday" style="font-size:12px">Today</button>
        <button class="pl-iconbtn" data-action="plNext" title="Next" aria-label="Next">›</button>
      </div>
      <div class="pl-title">${esc(periodLbl)}</div>
      <div class="pl-seg" role="tablist">
        <button class="${_plView === 'month' ? 'on' : ''}" data-action="plSetView" data-args="'month'">Month</button>
        <button class="${_plView === 'week' ? 'on' : ''}" data-action="plSetView" data-args="'week'">Week</button>
        <button class="${_plView === 'agenda' ? 'on' : ''}" data-action="plSetView" data-args="'agenda'">Agenda</button>
      </div>
      <div class="pl-legend">${legend}</div>
      <div style="flex:1"></div>
      <button class="btn btn-primary btn-sm" data-action="plNewEvent" style="white-space:nowrap">+ New event</button>
    </div>
    <div class="pl-body">${_plView === 'week' ? _plWeekHtml() : _plView === 'agenda' ? _plAgendaHtml() : _plMonthHtml()}</div>`;

  if (typeof a11yWireLabels === 'function') a11yWireLabels(root);
}

function _plMonthHtml() {
  const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
  const gridStart = _plGridStart(_plCursor);
  const startYmd = _plYmd(gridStart);
  const endYmd = _plYmd(_plAddDays(gridStart, 41));
  const items = plCollect(startYmd, endYmd);
  const byDay = {};
  items.forEach(it => { (byDay[it.ymd] = byDay[it.ymd] || []).push(it); });

  const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const today = _plTodayYmd();
  const curMonth = _plCursor.getMonth();

  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = _plAddDays(gridStart, i);
    const ymd = _plYmd(d);
    const dayItems = byDay[ymd] || [];
    const max = 4;
    const chips = dayItems.slice(0, max).map(it => {
      const c = it.overdue ? '#e5484d' : _plColor(it.type);
      const lbl = (it.time ? it.time + ' ' : '') + it.title;
      return `<div class="pl-ev" style="background:${c}1f;border-left-color:${c};color:var(--t1)"
        data-action="plItemClick" data-args="'${it.type}','${esc(it.refId)}'" title="${esc(lbl)}${it.sub ? ' · ' + esc(it.sub) : ''}">${esc(lbl)}</div>`;
    }).join('');
    const more = dayItems.length > max
      ? `<div class="pl-more" data-action="plDayPopover" data-args="'${ymd}'">+${dayItems.length - max} more</div>` : '';
    cells += `<div class="pl-cell ${d.getMonth() === curMonth ? '' : 'other'} ${ymd === today ? 'today' : ''}"
      data-action="plDayNew" data-args="'${ymd}'">
      <div class="pl-daynum">${d.getDate()}</div>${chips}${more}</div>`;
  }
  return `<div class="pl-grid">${dows.map(d => `<div class="pl-dow">${d}</div>`).join('')}${cells}</div>
    <div style="margin-top:10px;font-size:11px;color:var(--t3)">Click a day to add an event · click an item to open it.</div>`;
}

function _plAgendaHtml() {
  const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
  const ms = _plMonthStart(_plCursor);
  const startYmd = _plYmd(ms);
  const endYmd = _plYmd(new Date(ms.getFullYear(), ms.getMonth() + 1, 0));
  const items = plCollect(startYmd, endYmd);
  if (!items.length) return `<div style="color:var(--t3);font-size:13px;padding:24px 4px">Nothing scheduled this month. <a href="#" data-action="plNewEvent" style="color:var(--cyan)">Add an event</a>.</div>`;

  const byDay = {};
  items.forEach(it => { (byDay[it.ymd] = byDay[it.ymd] || []).push(it); });
  const today = _plTodayYmd();
  return Object.keys(byDay).sort().map(ymd => {
    const rows = byDay[ymd].map(it => {
      const c = it.overdue ? '#e5484d' : _plColor(it.type);
      return `<div class="pl-arow" data-action="plItemClick" data-args="'${it.type}','${esc(it.refId)}'">
        <span class="pl-dot" style="background:${c}"></span>
        <span class="pl-atime">${esc(it.time || (it.endYmd && it.endYmd !== ymd ? '→ ' + _plFmt(it.endYmd) : 'all day'))}</span>
        <span class="pl-atitle">${esc(it.title)}${it.sub ? ` <span style="color:var(--t3)">· ${esc(it.sub)}</span>` : ''}${it.overdue ? ' <span style="color:#e5484d;font-weight:600">overdue</span>' : ''}</span>
      </div>`;
    }).join('');
    const dd = _plParse(ymd);
    const wd = dd.toLocaleDateString(undefined, { weekday: 'short' });
    return `<div class="pl-aday ${ymd === today ? 'today' : ''}">
      <div class="pl-adate"><span class="pl-adow">${esc(wd)}</span> ${esc(_plFmt(ymd))}${ymd === today ? ' <span style="color:var(--cyan)">· today</span>' : ''}</div>
      <div class="pl-arows">${rows}</div></div>`;
  }).join('');
}

// Monday on/before the given date.
function _plWeekStart(d) { const x = new Date(d); const dow = (x.getDay() + 6) % 7; return _plAddDays(x, -dow); }

function _plWeekHtml() {
  const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
  const ws = _plWeekStart(_plCursor);
  const items = plCollect(_plYmd(ws), _plYmd(_plAddDays(ws, 6)));
  const byDay = {};
  items.forEach(it => { (byDay[it.ymd] = byDay[it.ymd] || []).push(it); });
  const today = _plTodayYmd();

  let cols = '';
  for (let i = 0; i < 7; i++) {
    const d = _plAddDays(ws, i);
    const ymd = _plYmd(d);
    const list = byDay[ymd] || [];
    const chips = list.map(it => {
      const c = it.overdue ? '#e5484d' : _plColor(it.type);
      const lbl = (it.time ? it.time + ' ' : '') + it.title;
      return `<div class="pl-ev pl-ev-wk" style="background:${c}1f;border-left-color:${c};color:var(--t1)"
        data-action="plItemClick" data-args="'${it.type}','${esc(it.refId)}'" title="${esc(lbl)}">${esc(lbl)}${it.sub ? `<span class="pl-ev-sub">${esc(it.sub)}</span>` : ''}</div>`;
    }).join('') || '<div class="pl-wk-empty">—</div>';
    const wd = d.toLocaleDateString(undefined, { weekday: 'short' });
    cols += `<div class="pl-wcol" data-action="plDayNew" data-args="'${ymd}'">
      <div class="pl-whead ${ymd === today ? 'today' : ''}"><span class="pl-wdow">${esc(wd)}</span> ${d.getDate()}</div>
      <div class="pl-wbody">${chips}</div></div>`;
  }
  return `<div class="pl-week">${cols}</div>
    <div style="margin-top:10px;font-size:11px;color:var(--t3)">Click a day to add an event · click an item to open it.</div>`;
}

// ── Dashboard widget: next 14 days (ignores legend filters) ──────────────────
function plRenderUpcoming() {
  const host = document.getElementById('ov-upcoming');
  if (!host) return;
  _plInjectStyles();
  const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
  const items = plCollect(_plTodayYmd(), _plYmd(_plAddDays(new Date(), 14)), { all: true }).slice(0, 8);
  if (!items.length) {
    host.innerHTML = `<div style="padding:14px 16px;color:var(--t3);font-size:12px">Nothing scheduled in the next 14 days. <a href="#" data-action="plNewEvent" style="color:var(--cyan)">Add an event</a>.</div>`;
    if (typeof a11yWireLabels === 'function') a11yWireLabels(host);
    return;
  }
  const today = _plTodayYmd();
  host.innerHTML = items.map(it => {
    const c = it.overdue ? '#e5484d' : _plColor(it.type);
    const when = it.ymd === today ? 'Today' : _plFmt(it.ymd);
    return `<div class="pl-arow" data-action="plItemClick" data-args="'${it.type}','${esc(it.refId)}'">
      <span class="pl-dot" style="background:${c}"></span>
      <span class="pl-atime">${esc(when)}${it.time ? ' ' + esc(it.time) : ''}</span>
      <span class="pl-atitle">${esc(it.title)}${it.sub ? ` <span style="color:var(--t3)">· ${esc(it.sub)}</span>` : ''}${it.overdue ? ' <span style="color:#e5484d;font-weight:600">overdue</span>' : ''}</span>
    </div>`;
  }).join('');
  if (typeof a11yWireLabels === 'function') a11yWireLabels(host);
}

// ── Navigation / view ────────────────────────────────────────────────────────
function plPrev()  { _plCursor = (_plView === 'week') ? _plAddDays(_plCursor, -7) : new Date(_plCursor.getFullYear(), _plCursor.getMonth() - 1, 1); plRender(); }
function plNext()  { _plCursor = (_plView === 'week') ? _plAddDays(_plCursor,  7) : new Date(_plCursor.getFullYear(), _plCursor.getMonth() + 1, 1); plRender(); }
function plToday() { _plCursor = new Date(); plRender(); }
function plSetView(v) { _plView = (v === 'agenda' || v === 'week') ? v : 'month'; plRender(); }
function plToggleFilter(key) {
  if (!_plFilters) _plFilters = new Set(PL_SOURCES.map(s => s.key));
  if (_plFilters.has(key)) _plFilters.delete(key); else _plFilters.add(key);
  plRender();
}

// ── Item click → open the source (or edit a custom event) ────────────────────
function plItemClick(type, refId) {
  if (type === 'event') { plOpenEventForm(refId); return; }
  if (type === 'job')    { if (typeof showPage === 'function') showPage('jobs', document.querySelector(".tn[data-args=\"'jobs'\"]")); return; }
  if (type === 'report') { if (typeof showPage === 'function') showPage('reports', document.querySelector(".tn[data-args=\"'reports'\"]")); return; }
  if (type === 'billing'){ if (typeof showPage === 'function') showPage('billing', document.querySelector(".tn[data-args=\"'billing'\"]")); return; }
  if (type === 'cert' || type === 'calib') {
    if (typeof vxIsAdmin === 'function' && !vxIsAdmin()) { if (typeof toast === 'function') toast('Open Settings to manage certifications and calibration.', 'info'); return; }
    if (typeof showPage === 'function') showPage('settings', document.getElementById('tn-settings'));
    if (typeof showSS === 'function') showSS(type === 'cert' ? 'inspectors' : 'equipment', document.getElementById('sni-' + (type === 'cert' ? 'inspectors' : 'equipment')));
  }
}

// Small popover listing every item on one day (overflow from a month cell).
function plDayPopover(ymd) {
  const items = plCollect(ymd, ymd);
  const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
  const rows = items.map(it => {
    const c = it.overdue ? '#e5484d' : _plColor(it.type);
    return `<div class="pl-arow" data-action="plItemClick" data-args="'${it.type}','${esc(it.refId)}'">
      <span class="pl-dot" style="background:${c}"></span>
      <span class="pl-atime">${esc(it.time || 'all day')}</span>
      <span class="pl-atitle">${esc(it.title)}</span></div>`;
  }).join('');
  _plModal(`<div style="font-weight:700;color:var(--t1);margin-bottom:8px">${esc(_plFmt(ymd))}</div>
    <div class="pl-arows">${rows}</div>
    <div style="margin-top:12px;text-align:right"><button class="btn btn-sm" data-action="plCloseModal">Close</button>
    <button class="btn btn-primary btn-sm" data-action="plDayNew" data-args="'${ymd}'" style="margin-left:6px">+ Event</button></div>`);
}

// ── Event editor ─────────────────────────────────────────────────────────────
function plNewEvent()      { plOpenEventForm(null, _plTodayYmd()); }
function plDayNew(ymd)     { plOpenEventForm(null, ymd); }

function plOpenEventForm(id, prefillYmd) {
  _plEditId = id || null;
  const ev = id ? (plGetEvent(id) || {}) : {};
  const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
  const inspectors = (typeof ls === 'function') ? (ls(KEYS.inspectors, []) || []) : [];
  const jobs = (typeof jobLoad === 'function') ? jobLoad() : [];
  const date = (ev.date ? String(ev.date).slice(0, 10) : (prefillYmd || _plTodayYmd()));

  const inspOpts = ['<option value="">— Unassigned —</option>']
    .concat(inspectors.map(i => `<option value="${esc(i.name)}" ${ev.inspector === i.name ? 'selected' : ''}>${esc(i.name)}</option>`)).join('');
  const jobOpts = ['<option value="">— None —</option>']
    .concat(jobs.map(j => `<option value="${esc(j.id)}" ${ev.jobId === j.id ? 'selected' : ''}>${esc(j.title || j.id)}</option>`)).join('');

  _plModal(`
    <div style="font-size:15px;font-weight:700;color:var(--t1);margin-bottom:12px">${id ? 'Edit event' : 'New event'}</div>
    <div class="fld form-row"><label>Title</label><input id="pl-f-title" value="${esc(ev.title || '')}" placeholder="Site visit, inspection booking…"/></div>
    <div class="fg form-row">
      <div class="fld"><label>Date</label><input type="date" id="pl-f-date" value="${esc(date)}"/></div>
      <div class="fld"><label>Time <span style="color:var(--t3);font-weight:400">(optional)</span></label><input type="time" id="pl-f-time" value="${esc(ev.time || '')}"/></div>
      <div class="fld"><label>End date <span style="color:var(--t3);font-weight:400">(optional)</span></label><input type="date" id="pl-f-end" value="${esc(ev.endDate ? String(ev.endDate).slice(0, 10) : '')}"/></div>
    </div>
    <div class="fg form-row">
      <div class="fld"><label>Inspector</label><select id="pl-f-insp">${inspOpts}</select></div>
      <div class="fld"><label>Linked job</label><select id="pl-f-job">${jobOpts}</select></div>
    </div>
    <div class="fld form-row"><label>Notes</label><textarea id="pl-f-notes" rows="3" placeholder="Address, contact, scope…">${esc(ev.notes || '')}</textarea></div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:14px">
      ${id ? `<button class="btn btn-sm btn-danger" data-action="plDeleteEvent" data-args="'${esc(id)}'">Delete</button>` : ''}
      <span style="flex:1"></span>
      <button class="btn btn-sm" data-action="plCloseModal">Cancel</button>
      <button class="btn btn-primary btn-sm" data-action="plSaveEvent">${id ? 'Save' : 'Add event'}</button>
    </div>`);
  setTimeout(() => { const t = document.getElementById('pl-f-title'); if (t) t.focus(); }, 30);
}

function plSaveEvent() {
  const val = id => (document.getElementById(id) || {}).value || '';
  const title = val('pl-f-title').trim();
  if (!title) { if (typeof toast === 'function') toast('Give the event a title.', 'warn'); document.getElementById('pl-f-title')?.focus(); return; }
  const date = val('pl-f-date');
  if (!date) { if (typeof toast === 'function') toast('Pick a date.', 'warn'); return; }
  const now = new Date().toISOString();
  const list = plLoadEvents();
  const rec = {
    id: _plEditId || ('evt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)),
    title, date, time: val('pl-f-time'), endDate: val('pl-f-end'),
    inspector: val('pl-f-insp'), jobId: val('pl-f-job'), notes: val('pl-f-notes').trim(),
    updatedAt: now,
  };
  const i = list.findIndex(e => e.id === rec.id);
  if (i >= 0) list[i] = { ...list[i], ...rec };
  else { rec.createdAt = now; list.push(rec); }
  plSaveEvents(list);
  if (typeof toast === 'function') toast(_plEditId ? 'Event updated.' : 'Event added.', 'success');
  plCloseModal(); plRender();
}

async function plDeleteEvent(id) {
  if (typeof vxConfirm === 'function') { if (!await vxConfirm({ message: 'Delete this event?', okLabel: 'Delete', danger: true })) return; }
  plSaveEvents(plLoadEvents().filter(e => e.id !== id));
  if (typeof toast === 'function') toast('Event deleted.');
  plCloseModal(); plRender();
}

// ── Modal + styles ───────────────────────────────────────────────────────────
function _plModal(innerHtml) {
  let host = document.getElementById('pl-modal');
  if (host) host.remove();
  host = document.createElement('div');
  host.id = 'pl-modal';
  host.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(6,10,20,.6);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:48px 16px';
  host.innerHTML = `<div style="width:100%;max-width:560px;background:var(--panel);border:1px solid var(--border);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.45);padding:20px 22px">${innerHtml}</div>`;
  host.addEventListener('mousedown', e => { if (e.target === host) plCloseModal(); });
  document.body.appendChild(host);
}
function plCloseModal() { const m = document.getElementById('pl-modal'); if (m) m.remove(); }

function _plInjectStyles() {
  if (document.getElementById('pl-styles')) return;
  const s = document.createElement('style');
  s.id = 'pl-styles';
  s.textContent = `
    #page-planner{flex-direction:column;overflow:hidden}
    .pl-head{padding:12px 24px;border-bottom:1px solid var(--border);background:var(--panel);display:flex;align-items:center;gap:14px;flex-wrap:wrap;flex-shrink:0}
    .pl-nav{display:flex;align-items:center;gap:6px}
    .pl-iconbtn{width:30px;height:30px;border:1px solid var(--border);background:var(--bg2);color:var(--t1);border-radius:6px;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center}
    .pl-iconbtn:hover{background:var(--border)}
    .pl-title{font-size:18px;font-weight:700;color:var(--t1);min-width:150px}
    .pl-seg{display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden}
    .pl-seg button{background:var(--bg2);color:var(--t2);border:0;padding:6px 12px;font-size:12px;cursor:pointer}
    .pl-seg button.on{background:var(--cyan);color:#012;font-weight:600}
    .pl-legend{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
    .pl-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--t2);cursor:pointer;user-select:none;padding:3px 7px;border-radius:5px;border:1px solid transparent}
    .pl-chip:hover{border-color:var(--border)}
    .pl-chip.off{opacity:.38}
    .pl-dot{width:9px;height:9px;border-radius:2px;flex-shrink:0;display:inline-block}
    .pl-body{flex:1;overflow-y:auto;padding:16px 24px 28px}
    .pl-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:8px;overflow:hidden}
    .pl-dow{background:var(--panel);padding:7px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--t3);text-align:center;font-weight:600}
    .pl-cell{background:var(--bg);min-height:108px;padding:5px 6px;display:flex;flex-direction:column;gap:3px;cursor:pointer}
    .pl-cell:hover{background:var(--bg2)}
    .pl-cell.other{background:var(--bg2);opacity:.5}
    .pl-daynum{font-size:11px;color:var(--t2);font-weight:600;align-self:flex-start;min-width:20px;height:20px;display:flex;align-items:center;justify-content:center}
    .pl-cell.today .pl-daynum{background:var(--cyan);color:#012;border-radius:50%}
    .pl-ev{font-size:10.5px;line-height:1.3;padding:2px 5px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;border-left:3px solid}
    .pl-ev:hover{filter:brightness(1.25)}
    .pl-more{font-size:10px;color:var(--t3);cursor:pointer;padding-left:3px}
    .pl-more:hover{color:var(--cyan)}
    .pl-week{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:8px;overflow:hidden;min-height:440px}
    .pl-wcol{background:var(--bg);display:flex;flex-direction:column;cursor:pointer}
    .pl-wcol:hover{background:var(--bg2)}
    .pl-whead{padding:8px;font-size:11px;font-weight:600;color:var(--t2);border-bottom:1px solid var(--border);text-align:center}
    .pl-whead.today{background:var(--cyan);color:#012}
    .pl-wdow{color:var(--t3);font-weight:600;margin-right:3px}
    .pl-whead.today .pl-wdow{color:#012}
    .pl-wbody{padding:6px;display:flex;flex-direction:column;gap:5px;flex:1}
    .pl-ev-wk{white-space:normal;line-height:1.3}
    .pl-ev-sub{display:block;color:var(--t3);font-size:9.5px;margin-top:1px}
    .pl-wk-empty{color:var(--t3);opacity:.35;text-align:center;font-size:11px;padding:6px 0}
    .pl-aday{border:1px solid var(--border);border-radius:8px;margin-bottom:10px;overflow:hidden}
    .pl-aday.today{border-color:var(--cyan)}
    .pl-adate{background:var(--panel);padding:8px 12px;font-size:12px;font-weight:600;color:var(--t1);border-bottom:1px solid var(--border)}
    .pl-adow{color:var(--t3);font-weight:600;margin-right:4px}
    .pl-arows{display:flex;flex-direction:column}
    .pl-arow{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;font-size:12.5px;color:var(--t1)}
    .pl-arow:hover{background:var(--bg2)}
    .pl-atime{font-family:var(--mono);font-size:11px;color:var(--t3);min-width:64px}
    .pl-atitle{flex:1;min-width:0}`;
  document.head.appendChild(s);
}
