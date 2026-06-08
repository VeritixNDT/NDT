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
// V46: scheduling is admin-only. Inspectors (non-admins) reach the planner via
// the home side menu and get a READ-ONLY view — no create, drag, edit or delete.
function _plCanEdit() { return (typeof vxIsAdmin === 'function') ? vxIsAdmin() : true; }

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

// Embed support — the inspector workspace renders the planner inside its own
// page, scoped to the current inspector's own events. _plRootId is the
// container plRender writes into (the prev/next/today/view buttons re-call
// plRender() with no args, so the target must live on a module var, not a
// param); _plScopeInspector filters plCollect to CURRENT_USER. plInit (the
// top-nav path) resets both to the full-planner defaults.
var _plRootId = 'planner-root';
var _plScopeInspector = false;

// ── Aggregation ─────────────────────────────────────────────────────────────
// Returns normalized items whose date falls in [startYmd, endYmd] (inclusive).
//   { ymd, endYmd, time, title, sub, type, refId, editable, overdue }
function plCollect(startYmd, endYmd, opts) {
  const out = [];
  const en = (opts && opts.all) ? (() => true) : _plEnabled;  // dashboard ignores legend filters
  const inRange = ymd => ymd && ymd >= startYmd && ymd <= endYmd;
  const push = o => { if (inRange(o.ymd) && en(o.type)) out.push(o); };
  // Inspector-scoped view (the Inspector workspace) — restrict the
  // person-linked sources (events, jobs, report exams, cert expiries) to the
  // logged-in inspector, matched by display name exactly as the inbox does.
  // Equipment-calibration / billing deadlines aren't person-linked, so they
  // stay visible (and are toggleable via the legend either way).
  const _me = (_plScopeInspector && typeof CURRENT_USER !== 'undefined' && CURRENT_USER) ? CURRENT_USER.name : '';
  const _mineOnly = !!_me;

  // Custom events
  if (en('event')) plLoadEvents().forEach(e => {
    if (_mineOnly && (e.inspector || '') !== _me) return;
    push({
      ymd: String(e.date || '').slice(0, 10), endYmd: e.endDate ? String(e.endDate).slice(0, 10) : '',
      time: e.time || '', endTime: e.endTime || '', title: e.title || '(untitled)', sub: e.inspector || '',
      type: 'event', refId: e.id, editable: true,
    });
  });

  // Jobs (placed on their start date; range shown in the label)
  if (en('job')) jobLoad().forEach(j => {
    if (!j.startDate) return;
    if (_mineOnly && (j.leadInspector || '') !== _me) return;
    const cust = (typeof jobCustomerName === 'function') ? jobCustomerName(j.customerId) : '';
    push({ ymd: String(j.startDate).slice(0, 10), endYmd: j.endDate ? String(j.endDate).slice(0, 10) : '',
      time: '', title: j.title || 'Job', sub: [cust, j.leadInspector].filter(Boolean).join(' · '),
      type: 'job', refId: j.id, editable: false });
  });

  // Report exam dates
  if (en('report')) (ls(KEYS.reports, []) || []).forEach(r => {
    if (!r.examDate) return;
    if (_mineOnly && (r.inspector || '') !== _me) return;
    push({ ymd: String(r.examDate).slice(0, 10), endYmd: '', time: '',
      title: (r.method || '') + ' ' + (r.reportNo || ''), sub: r.client || r.project || '',
      type: 'report', refId: r.reportNo || r.id || '', editable: false });
  });

  // Inspector cert expiries (per-method + legacy + eye test)
  if (en('cert')) (ls(KEYS.inspectors, []) || []).forEach(ins => {
    if (_mineOnly && (ins.name || '') !== _me) return;
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
function plInit() { _plRootId = 'planner-root'; _plScopeInspector = false; _plInjectStyles(); _plInstallDrag(); plRender(); }

// ── Drag-to-reschedule ───────────────────────────────────────────────────────
// Pointer-drag for the schedulable items (custom events + jobs). Moving a
// timed block onto the time grid changes its day + time (15-min snap); moving
// a chip/bar onto a month cell or the all-day strip changes its day. Jobs keep
// their duration (start+end shift together). Aggregated deadlines (cert/calib/
// billing/reports) are not draggable — a normal click opens them.
var _plDragOn = false;
function _plInstallDrag() {
  if (_plDragOn) return; _plDragOn = true;
  let st = null;
  const onPlanner = () => { const p = document.getElementById('page-planner'); return p && p.classList.contains('active'); };

  document.addEventListener('mousedown', e => {
    if (e.button !== 0 || !onPlanner()) return;
    if (!_plCanEdit()) return;   // read-only: no drag-to-reschedule for non-admins
    const seg = e.target.closest('.pl-drag');
    if (!seg) return;
    const m = (seg.getAttribute('data-args') || '').match(/'([^']*)'\s*,\s*'([^']*)'/);
    if (!m || (m[1] !== 'event' && m[1] !== 'job')) return;
    st = { type: m[1], refId: m[2], seg, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, lastTgt: null, tgt: null };
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!st) return;
    if (!st.moved) {
      if (Math.abs(e.clientX - st.x0) + Math.abs(e.clientY - st.y0) < 4) return;
      st.moved = true;
      document.body.classList.add('pl-dragging');
      const g = document.createElement('div'); g.className = 'pl-ghost';
      g.textContent = (st.seg.textContent || '').replace(/[‹›]/g, '').trim() || 'event';
      document.body.appendChild(g); st.ghost = g;
      st.seg.style.opacity = '.35';
    }
    st.ghost.style.left = (e.clientX + 12) + 'px';
    st.ghost.style.top = (e.clientY + 14) + 'px';
    if (st.lastTgt) { st.lastTgt.classList.remove('pl-drop'); st.lastTgt = null; }
    st.tgt = _plDropTarget(e.clientX, e.clientY);
    if (st.tgt) { st.tgt.el.classList.add('pl-drop'); st.lastTgt = st.tgt.el; }
  });

  document.addEventListener('mouseup', () => {
    if (!st) return;
    const s = st; st = null;
    if (s.ghost) s.ghost.remove();
    if (s.seg) s.seg.style.opacity = '';
    document.body.classList.remove('pl-dragging');
    if (s.lastTgt) s.lastTgt.classList.remove('pl-drop');
    if (!s.moved) return;
    // Swallow the click that fires after a real drag so it doesn't open the item.
    const supp = ev => { ev.stopPropagation(); ev.preventDefault(); document.removeEventListener('click', supp, true); };
    document.addEventListener('click', supp, true);
    setTimeout(() => document.removeEventListener('click', supp, true), 60);
    if (s.tgt) _plApplyDrag(s.type, s.refId, s.tgt);
  });
}

// Resolve the drop target under (x,y) → { el, ymd, time|null }.
function _plDropTarget(x, y) {
  const el = document.elementFromPoint(x, y);  // ghost is pointer-events:none
  if (!el) return null;
  const col = el.closest('.pl-tg-col');
  if (col && col.dataset.ymd) {
    const grid = col.closest('.pl-tg-cols');
    const wins = +grid.dataset.wins, hpx = +grid.dataset.hpx;
    const r = col.getBoundingClientRect();
    let min = wins + (y - r.top) / hpx * 60;
    min = Math.max(wins, Math.min(min, wins + r.height / hpx * 60));
    return { el: col, ymd: col.dataset.ymd, time: _plHmm(Math.round(min / 15) * 15) };
  }
  const ac = el.closest('.pl-tg-allcell');
  if (ac && ac.dataset.ymd) return { el: ac, ymd: ac.dataset.ymd, time: null };
  const rc = el.closest('.pl-res-cell');
  if (rc && rc.dataset.ymd) return { el: rc, ymd: rc.dataset.ymd, time: null, inspector: rc.dataset.insp || '' };
  const cell = el.closest('.pl-cell');
  if (cell && cell.dataset.ymd) return { el: cell, ymd: cell.dataset.ymd, time: null };
  return null;
}

function _plApplyDrag(type, refId, tgt) {
  const reassign = (tgt.inspector !== undefined);  // dropped on a resource lane
  if (type === 'event') {
    const list = plLoadEvents(); const ev = list.find(e => e.id === refId); if (!ev) return;
    const oldYmd = String(ev.date || '').slice(0, 10);
    const noMove = oldYmd === tgt.ymd && (tgt.time === null || tgt.time === ev.time);
    if (noMove && (!reassign || ev.inspector === tgt.inspector)) return;
    if (ev.endDate) ev.endDate = _plShiftYmd(String(ev.endDate).slice(0, 10), _plDayDelta(oldYmd, tgt.ymd));
    ev.date = tgt.ymd;
    if (tgt.time !== null) {
      if (ev.time && ev.endTime) ev.endTime = _plHmm(Math.max(0, _plMin(ev.endTime) + (_plMin(tgt.time) - _plMin(ev.time))));
      ev.time = tgt.time;
    }
    if (reassign) ev.inspector = tgt.inspector;
    ev.updatedAt = new Date().toISOString();
    plSaveEvents(list);
    if (typeof toast === 'function') toast((reassign && tgt.inspector ? tgt.inspector + ' · ' : '') + 'moved to ' + _plFmt(tgt.ymd) + (tgt.time ? ' ' + tgt.time : '') + '.', 'success');
  } else if (type === 'job') {
    if (typeof jobLoad !== 'function' || typeof jobSaveAll !== 'function') return;
    const jobs = jobLoad(); const j = jobs.find(x => x.id === refId); if (!j || !j.startDate) return;
    const oldYmd = String(j.startDate).slice(0, 10);
    const delta = _plDayDelta(oldYmd, tgt.ymd);
    if (delta === 0 && !(reassign && j.leadInspector !== tgt.inspector)) return;
    if (delta !== 0) { j.startDate = _plShiftYmd(oldYmd, delta); if (j.endDate) j.endDate = _plShiftYmd(String(j.endDate).slice(0, 10), delta); }
    if (reassign) j.leadInspector = tgt.inspector;
    j.updatedAt = new Date().toISOString();
    jobSaveAll(jobs);
    if (typeof toast === 'function') toast('Job ' + (reassign && tgt.inspector ? '→ ' + tgt.inspector + ' · ' : '') + 'moved to ' + _plFmt(tgt.ymd) + '.', 'success');
  }
  plRender(); plRenderUpcoming();
}

function plRender() {
  const root = document.getElementById(_plRootId);
  if (!root) return;
  const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
  let periodLbl;
  if (_plView === 'week' || _plView === 'resource') {
    const ws = _plWeekStart(_plCursor), we = _plAddDays(ws, 6);
    periodLbl = ws.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' – ' +
                we.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } else if (_plView === 'day') {
    periodLbl = _plCursor.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
        <button class="${_plView === 'day' ? 'on' : ''}" data-action="plSetView" data-args="'day'">Day</button>
        <button class="${_plView === 'resource' ? 'on' : ''}" data-action="plSetView" data-args="'resource'">Team</button>
        <button class="${_plView === 'agenda' ? 'on' : ''}" data-action="plSetView" data-args="'agenda'">Agenda</button>
      </div>
      <div class="pl-legend">${legend}</div>
      <div style="flex:1"></div>
      ${_plCanEdit() ? `<button class="btn btn-primary btn-sm" data-action="plNewEvent" style="white-space:nowrap">+ New event</button>` : ''}
    </div>
    <div class="pl-body">${_plView === 'week' ? _plWeekHtml() : _plView === 'day' ? _plDayHtml() : _plView === 'resource' ? _plResourceHtml() : _plView === 'agenda' ? _plAgendaHtml() : _plMonthHtml()}</div>`;

  if (typeof a11yWireLabels === 'function') a11yWireLabels(root);
}

// Lay out one row of days (a calendar week, or the all-day strip) into lanes,
// rendering multi-day items as spanning bars and single-day items as chips.
// Returns grid HTML (grid-column = day span, grid-row = lane+1) + lane count.
function _plRowLanes(days, items, maxLanes) {
  const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
  const rowStart = _plYmd(days[0]), rowEnd = _plYmd(days[days.length - 1]);
  const segs = [];
  for (const it of items) {
    const sY = it.ymd, eY = (it.endYmd && it.endYmd > it.ymd) ? it.endYmd : it.ymd;
    if (!sY || eY < rowStart || sY > rowEnd) continue;
    const ss = sY < rowStart ? rowStart : sY, ee = eY > rowEnd ? rowEnd : eY;
    segs.push({ it, startCol: days.findIndex(d => _plYmd(d) === ss), endCol: days.findIndex(d => _plYmd(d) === ee),
      contL: sY < rowStart, contR: eY > rowEnd, multi: eY > sY });
  }
  // Longer (multi-day) items first → they take stable top lanes; then by column.
  segs.sort((a, b) => (b.endCol - b.startCol) - (a.endCol - a.startCol) || a.startCol - b.startCol);
  const lanes = [];
  for (const s of segs) {
    let L = 0;
    for (; L < lanes.length; L++) if (lanes[L].every(r => s.endCol < r.startCol || s.startCol > r.endCol)) break;
    if (L === lanes.length) lanes.push([]);
    lanes[L].push(s); s.lane = L;
  }
  const hidden = {};
  let html = '';
  for (const s of segs) {
    if (s.lane >= maxLanes) { for (let c = s.startCol; c <= s.endCol; c++) hidden[c] = (hidden[c] || 0) + 1; continue; }
    const it = s.it, c = it.overdue ? '#e5484d' : _plColor(it.type);
    const lbl = (it.time ? it.time + ' ' : '') + it.title;
    const rl = s.contL ? '0' : '4px', rr = s.contR ? '0' : '4px';
    const drag = (it.type === 'event' || it.type === 'job') ? ' pl-drag' : '';
    html += `<div class="pl-mseg${s.multi ? ' pl-mbar' : ''}${drag}" style="grid-column:${s.startCol + 1}/${s.endCol + 2};grid-row:${s.lane + 1};background:${s.multi ? c + 'cc' : c + '1f'};border-left:3px solid ${c};border-radius:${rl} ${rr} ${rr} ${rl};color:${s.multi ? '#fff' : 'var(--t1)'}" data-action="plItemClick" data-args="'${it.type}','${esc(it.refId)}'" title="${esc(lbl)}${it.sub ? ' · ' + esc(it.sub) : ''}">${s.contL ? '‹ ' : ''}${esc(lbl)}${s.contR ? ' ›' : ''}</div>`;
  }
  for (const c in hidden) html += `<div class="pl-mmore" style="grid-column:${(+c) + 1};grid-row:${maxLanes + 1}" data-action="plDayPopover" data-args="'${_plYmd(days[+c])}'">+${hidden[c]} more</div>`;
  return { html, laneCount: lanes.length };
}

function _plMonthHtml() {
  const gridStart = _plGridStart(_plCursor);
  const items = plCollect(_plYmd(gridStart), _plYmd(_plAddDays(gridStart, 41)));
  const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const today = _plTodayYmd();
  const curMonth = _plCursor.getMonth();
  const VIS = 3;

  let rows = '';
  for (let w = 0; w < 6; w++) {
    const weekDays = []; for (let i = 0; i < 7; i++) weekDays.push(_plAddDays(gridStart, w * 7 + i));
    const lay = _plRowLanes(weekDays, items, VIS);
    const bg = weekDays.map(d => { const ymd = _plYmd(d);
      return `<div class="pl-cell ${d.getMonth() === curMonth ? '' : 'other'} ${ymd === today ? 'today' : ''}" data-ymd="${ymd}" data-action="plDayNew" data-args="'${ymd}'"></div>`; }).join('');
    const nums = weekDays.map(d => { const ymd = _plYmd(d);
      return `<div class="pl-daynum ${d.getMonth() === curMonth ? '' : 'other'} ${ymd === today ? 'today' : ''}" data-action="plOpenDay" data-args="'${ymd}'" title="Open this day">${d.getDate()}</div>`; }).join('');
    rows += `<div class="pl-mrow">
      <div class="pl-mbg">${bg}</div>
      <div class="pl-mfg">
        <div class="pl-mnums">${nums}</div>
        <div class="pl-mlanes" style="grid-template-rows:repeat(${VIS + 1},18px)">${lay.html}</div>
      </div>
    </div>`;
  }
  return `<div class="pl-mhead">${dows.map(d => `<div class="pl-dow">${d}</div>`).join('')}</div>
    <div class="pl-mwrap">${rows}</div>
    <div style="margin-top:10px;font-size:11px;color:var(--t3)">Multi-day items span as bars · click a date to open the day · click empty space to add · click an item to open it.</div>`;
}

function _plAgendaHtml() {
  const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
  const ms = _plMonthStart(_plCursor);
  const startYmd = _plYmd(ms);
  const endYmd = _plYmd(new Date(ms.getFullYear(), ms.getMonth() + 1, 0));
  const items = plCollect(startYmd, endYmd);
  if (!items.length) return `<div style="color:var(--t3);font-size:13px;padding:24px 4px">Nothing scheduled this month.${_plCanEdit() ? ` <a href="#" data-action="plNewEvent" data-prevent-default="1" style="color:var(--cyan)">Add an event</a>.` : ''}</div>`;

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

// ── Time-grid helpers ────────────────────────────────────────────────────────
function _plMin(t)  { const p = String(t || '').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }
function _plHm(m)   { return String(Math.floor(m / 60)).padStart(2, '0') + ':00'; }
function _plHmm(m)  { const z = n => String(n).padStart(2, '0'); return z(Math.floor(m / 60)) + ':' + z(m % 60); }
function _plDayDelta(a, b) { return Math.round((_plParse(b) - _plParse(a)) / 86400000); }
function _plShiftYmd(ymd, days) { return _plYmd(_plAddDays(_plParse(ymd), days)); }
function _plEvEnd(it) { const s = _plMin(it.time); return it.endTime ? Math.max(_plMin(it.endTime), s + 30) : s + 45; }

// Lane-pack overlapping timed items (Google-calendar style) so they sit
// side-by-side. Returns the same items annotated with { lane, lanes }.
function _plLayoutDay(items) {
  const evs = items.map(it => ({ item: it, start: _plMin(it.time), end: _plEvEnd(it), lane: 0, lanes: 1 }));
  evs.sort((a, b) => a.start - b.start || a.end - b.end);
  let cols = [], lastEnd = null;
  const pack = () => cols.forEach((col, i) => col.forEach(ev => { ev.lane = i; ev.lanes = cols.length; }));
  for (const ev of evs) {
    if (lastEnd !== null && ev.start >= lastEnd) { pack(); cols = []; lastEnd = null; }
    let placed = false;
    for (const col of cols) { if (col[col.length - 1].end <= ev.start) { col.push(ev); placed = true; break; } }
    if (!placed) cols.push([ev]);
    if (lastEnd === null || ev.end > lastEnd) lastEnd = ev.end;
  }
  pack();
  return evs;
}

// Shared time-grid renderer for Week (7 days) and Day (1 day): hour rail,
// all-day strip, time-positioned event blocks, live "now" line, and
// click-a-slot-to-create-at-that-hour.
function _plTimeGridHtml(days) {
  const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
  const items = plCollect(_plYmd(days[0]), _plYmd(days[days.length - 1]));
  const byDay = {};
  items.forEach(it => { (byDay[it.ymd] = byDay[it.ymd] || []).push(it); });
  const today = _plTodayYmd();
  const HPX = 44;
  const n = days.length;

  // Visible hour window — default 07:00–19:00, expanded to fit timed events.
  let winS = 7 * 60, winE = 19 * 60;
  items.forEach(it => { if (it.time) { winS = Math.min(winS, _plMin(it.time)); winE = Math.max(winE, _plEvEnd(it)); } });
  winS = Math.max(0, Math.floor(winS / 60) * 60);
  winE = Math.min(24 * 60, Math.ceil(winE / 60) * 60);
  const hours = []; for (let m = winS; m < winE; m += 60) hours.push(m);
  const bodyH = (winE - winS) / 60 * HPX;

  const heads = days.map(d => { const ymd = _plYmd(d);
    return `<div class="pl-tg-dayh ${ymd === today ? 'today' : ''}" data-action="plOpenDay" data-args="'${ymd}'" title="Open this day"><span class="pl-wdow">${esc(d.toLocaleDateString(undefined, { weekday: 'short' }))}</span> ${d.getDate()}</div>`; }).join('');

  // All-day strip: multi-day items span across day columns (lane-packed).
  const allLay = _plRowLanes(days, items.filter(it => !it.time), 3);
  const allBg = days.map(d => `<div class="pl-tg-allcell" data-ymd="${_plYmd(d)}" data-action="plDayNew" data-args="'${_plYmd(d)}'"></div>`).join('');

  const gutter = hours.map(m => `<div class="pl-tg-hr" style="height:${HPX}px"><span>${_plHm(m)}</span></div>`).join('');

  const cols = days.map(d => { const ymd = _plYmd(d); const timed = (byDay[ymd] || []).filter(it => it.time);
    const cells = hours.map(m => `<div class="pl-tg-cell" style="height:${HPX}px" data-action="plDayNewAt" data-args="'${ymd}','${_plHm(m)}'"></div>`).join('');
    const blocks = _plLayoutDay(timed).map(b => { const it = b.item;
      const top = (b.start - winS) / 60 * HPX, h = Math.max((b.end - b.start) / 60 * HPX, 22);
      const c = it.overdue ? '#e5484d' : _plColor(it.type);
      const w = 100 / b.lanes, left = b.lane * w;
      return `<div class="pl-tg-ev pl-drag" style="top:${top}px;height:${h}px;left:calc(${left}% + 1px);width:calc(${w}% - 3px);background:${c}2b;border-left:3px solid ${c};color:var(--t1)" data-action="plItemClick" data-args="'${it.type}','${esc(it.refId)}'" title="${esc(it.time + ' ' + it.title)}"><b>${esc(it.time)}</b> ${esc(it.title)}${it.sub ? `<span class="pl-ev-sub">${esc(it.sub)}</span>` : ''}</div>`; }).join('');
    let now = '';
    if (ymd === today) { const nm = new Date().getHours() * 60 + new Date().getMinutes(); if (nm >= winS && nm <= winE) now = `<div class="pl-tg-now" style="top:${(nm - winS) / 60 * HPX}px"></div>`; }
    return `<div class="pl-tg-col" data-ymd="${ymd}">${cells}${blocks}${now}</div>`; }).join('');

  const gcols = `grid-template-columns:repeat(${n},1fr)`;
  return `<div class="pl-tg ${n === 1 ? 'pl-tg-day' : ''}">
    <div class="pl-tg-head"><div class="pl-tg-gx"></div><div class="pl-tg-heads" style="${gcols}">${heads}</div></div>
    <div class="pl-tg-allday"><div class="pl-tg-gx pl-tg-allbl">all-day</div><div class="pl-tg-allwrap">
      <div class="pl-tg-allbg" style="${gcols}">${allBg}</div>
      <div class="pl-tg-alllanes" style="${gcols};grid-auto-rows:17px">${allLay.html}</div>
    </div></div>
    <div class="pl-tg-body"><div class="pl-tg-gutter">${gutter}</div><div class="pl-tg-cols" data-wins="${winS}" data-hpx="${HPX}" style="${gcols};height:${bodyH}px">${cols}</div></div>
  </div>
  <div style="margin-top:10px;font-size:11px;color:var(--t3)">Click a time slot to add an event · click a date to open the day · click an item to open it.</div>`;
}

function _plWeekHtml() { const ws = _plWeekStart(_plCursor); const days = []; for (let i = 0; i < 7; i++) days.push(_plAddDays(ws, i)); return _plTimeGridHtml(days); }
function _plDayHtml()  { return _plTimeGridHtml([new Date(_plCursor)]); }

// ── Resource lanes ("Team") — inspectors × week. Each row reuses _plRowLanes
// so multi-day jobs span; drag an item to another row reassigns the inspector.
function _plResourceHtml() {
  const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
  const ws = _plWeekStart(_plCursor);
  const weekDays = []; for (let i = 0; i < 7; i++) weekDays.push(_plAddDays(ws, i));
  const today = _plTodayYmd();
  const norm = v => String(v || '').trim();

  // Scheduled work that carries an inspector: events, jobs, report exams.
  const items = [];
  if (_plEnabled('event')) plLoadEvents().forEach(e => { const y = String(e.date || '').slice(0, 10); if (!y) return;
    items.push({ insp: norm(e.inspector), ymd: y, endYmd: e.endDate ? String(e.endDate).slice(0, 10) : '', time: e.time || '', endTime: e.endTime || '', title: e.title || '(untitled)', type: 'event', refId: e.id }); });
  if (_plEnabled('job') && typeof jobLoad === 'function') jobLoad().forEach(j => { if (!j.startDate) return;
    items.push({ insp: norm(j.leadInspector), ymd: String(j.startDate).slice(0, 10), endYmd: j.endDate ? String(j.endDate).slice(0, 10) : '', time: '', title: j.title || 'Job', type: 'job', refId: j.id }); });
  if (_plEnabled('report')) (ls(KEYS.reports, []) || []).forEach(r => { if (!r.examDate) return;
    items.push({ insp: norm(r.inspector), ymd: String(r.examDate).slice(0, 10), endYmd: '', time: '', title: (r.method || '') + ' ' + (r.reportNo || ''), type: 'report', refId: r.reportNo || r.id || '' }); });

  const roster = (ls(KEYS.inspectors, []) || []).map(i => norm(i.name)).filter(Boolean);
  const names = [...new Set([...roster, ...items.map(it => it.insp).filter(Boolean)])].sort((a, b) => a.localeCompare(b));

  const heads = weekDays.map(d => { const ymd = _plYmd(d);
    return `<div class="pl-res-dayh ${ymd === today ? 'today' : ''}" data-action="plOpenDay" data-args="'${ymd}'" title="Open this day"><span class="pl-wdow">${esc(d.toLocaleDateString(undefined, { weekday: 'short' }))}</span> ${d.getDate()}</div>`; }).join('');

  const row = name => {
    const mine = items.filter(it => name ? it.insp === name : !it.insp);
    const lay = _plRowLanes(weekDays, mine, 6);
    const bg = weekDays.map(d => `<div class="pl-res-cell" data-ymd="${_plYmd(d)}" data-insp="${esc(name)}" data-action="plResNew" data-args="'${_plYmd(d)}'" data-pass-el="1"></div>`).join('');
    const label = name || 'Unassigned';
    return `<div class="pl-res-row${name ? '' : ' pl-res-unassigned'}">
      <div class="pl-res-name" title="${esc(label)}"><span class="pl-res-nm">${esc(label)}</span>${mine.length ? `<span class="pl-res-cnt">${mine.length}</span>` : '<span class="pl-res-free">free</span>'}</div>
      <div class="pl-res-lanewrap">
        <div class="pl-res-bg" style="grid-template-columns:repeat(7,1fr)">${bg}</div>
        <div class="pl-res-lanes" style="grid-template-columns:repeat(7,1fr);grid-auto-rows:18px">${lay.html}</div>
      </div></div>`;
  };

  return `<div class="pl-res">
    <div class="pl-res-head"><div class="pl-res-gx">Inspector</div><div class="pl-res-days" style="grid-template-columns:repeat(7,1fr)">${heads}</div></div>
    ${[...names, ''].map(row).join('')}
  </div>
  <div style="margin-top:10px;font-size:11px;color:var(--t3)">Drag an item to a different inspector or day to reassign · click a cell to schedule · click an item to open it.</div>`;
}
function plResNew(ymd, el) { plOpenEventForm(null, ymd, '', (el && el.dataset && el.dataset.insp) || ''); }

// ── Dashboard widget: List (next 14 days) ⇄ Week (this week). Ignores the
// planner's legend filters — always shows every source. ──────────────────────
var _plUpView = 'list';   // 'list' | 'week'

function plRenderUpcoming() {
  const host = document.getElementById('ov-upcoming');
  if (!host) return;
  _plInjectStyles();
  const cap = _plUpView === 'week' ? 'This week' : '';
  host.innerHTML = `
    <div class="pl-up-bar">
      <span class="pl-up-cap">${cap}</span><span style="flex:1"></span>
      <div class="pl-seg pl-seg-sm" role="tablist">
        <button class="${_plUpView === 'list' ? 'on' : ''}" data-action="plUpView" data-args="'list'">List</button>
        <button class="${_plUpView === 'week' ? 'on' : ''}" data-action="plUpView" data-args="'week'">Week</button>
      </div>
    </div>
    ${_plUpView === 'week' ? _plUpWeekHtml() : _plUpListHtml()}`;
  if (typeof a11yWireLabels === 'function') a11yWireLabels(host);
}
function plUpView(v) { _plUpView = (v === 'week') ? 'week' : 'list'; plRenderUpcoming(); }

function _plUpListHtml() {
  const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
  const items = plCollect(_plTodayYmd(), _plYmd(_plAddDays(new Date(), 14)), { all: true }).slice(0, 8);
  if (!items.length) return `<div style="padding:10px 16px 14px;color:var(--t3);font-size:12px">Nothing scheduled in the next 14 days. <a href="#" data-action="plNewEvent" data-prevent-default="1" style="color:var(--cyan)">Add an event</a>.</div>`;
  const today = _plTodayYmd();
  return items.map(it => {
    const c = it.overdue ? '#e5484d' : _plColor(it.type);
    const when = it.ymd === today ? 'Today' : _plFmt(it.ymd);
    return `<div class="pl-arow" data-action="plItemClick" data-args="'${it.type}','${esc(it.refId)}'">
      <span class="pl-dot" style="background:${c}"></span>
      <span class="pl-atime">${esc(when)}${it.time ? ' ' + esc(it.time) : ''}</span>
      <span class="pl-atitle">${esc(it.title)}${it.sub ? ` <span style="color:var(--t3)">· ${esc(it.sub)}</span>` : ''}${it.overdue ? ' <span style="color:#e5484d;font-weight:600">overdue</span>' : ''}</span>
    </div>`;
  }).join('');
}

// Compact 7-day grid of the current week for the dashboard card.
function _plUpWeekHtml() {
  const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
  const ws = _plWeekStart(new Date());
  const items = plCollect(_plYmd(ws), _plYmd(_plAddDays(ws, 6)), { all: true });
  const byDay = {};
  items.forEach(it => { (byDay[it.ymd] = byDay[it.ymd] || []).push(it); });
  const today = _plTodayYmd();
  let cols = '';
  for (let i = 0; i < 7; i++) {
    const d = _plAddDays(ws, i);
    const ymd = _plYmd(d);
    const list = byDay[ymd] || [];
    const max = 3;
    const chips = list.slice(0, max).map(it => {
      const c = it.overdue ? '#e5484d' : _plColor(it.type);
      const lbl = (it.time ? it.time + ' ' : '') + it.title;
      return `<div class="pl-up-ev" style="background:${c}1f;border-left-color:${c}" data-action="plItemClick" data-args="'${it.type}','${esc(it.refId)}'" title="${esc(lbl)}">${esc(lbl)}</div>`;
    }).join('');
    const more = list.length > max ? `<div class="pl-up-more" data-action="plDayPopover" data-args="'${ymd}'">+${list.length - max}</div>` : '';
    const wd = d.toLocaleDateString(undefined, { weekday: 'short' });
    cols += `<div class="pl-up-col ${ymd === today ? 'today' : ''}" data-action="plDayNew" data-args="'${ymd}'">
      <div class="pl-up-head"><span>${esc(wd)}</span><b>${d.getDate()}</b></div>
      <div class="pl-up-body">${chips}${more}</div></div>`;
  }
  return `<div class="pl-up-week">${cols}</div>`;
}

// ── Navigation / view ────────────────────────────────────────────────────────
function _plStep(dir) { return (_plView === 'day') ? _plAddDays(_plCursor, dir) : (_plView === 'week' || _plView === 'resource') ? _plAddDays(_plCursor, dir * 7) : new Date(_plCursor.getFullYear(), _plCursor.getMonth() + dir, 1); }
function plPrev()  { _plCursor = _plStep(-1); plRender(); }
function plNext()  { _plCursor = _plStep(1);  plRender(); }
function plToday() { _plCursor = new Date(); plRender(); }
function plSetView(v) { _plView = (v === 'agenda' || v === 'week' || v === 'day' || v === 'resource') ? v : 'month'; plRender(); }
// Drill into a single day (from a month cell / week column date).
function plOpenDay(ymd) { _plCursor = _plParse(ymd); _plView = 'day'; plRender(); }
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
    ${_plCanEdit() ? `<button class="btn btn-primary btn-sm" data-action="plDayNew" data-args="'${ymd}'" style="margin-left:6px">+ Event</button>` : ''}</div>`);
}

// ── Event editor ─────────────────────────────────────────────────────────────
function plNewEvent()        { plOpenEventForm(null, _plView === 'day' ? _plYmd(_plCursor) : _plTodayYmd()); }
function plDayNew(ymd)       { plOpenEventForm(null, ymd); }
function plDayNewAt(ymd, tm) { plOpenEventForm(null, ymd, tm); }

function plOpenEventForm(id, prefillYmd, prefillTime, prefillInsp) {
  const canEdit = _plCanEdit();
  if (!id && !canEdit) { if (typeof toast === 'function') toast(t('pl.readonly','Read-only — scheduling is admin-only.'), 'info'); return; }
  const dis = canEdit ? '' : ' disabled';
  _plEditId = id || null;
  const ev = id ? (plGetEvent(id) || {}) : {};
  const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
  const inspectors = (typeof ls === 'function') ? (ls(KEYS.inspectors, []) || []) : [];
  const jobs = (typeof jobLoad === 'function') ? jobLoad() : [];
  const date = (ev.date ? String(ev.date).slice(0, 10) : (prefillYmd || _plTodayYmd()));
  const time = ev.time || prefillTime || '';
  const insp = ev.inspector || prefillInsp || '';

  const inspOpts = ['<option value="">— Unassigned —</option>']
    .concat(inspectors.map(i => `<option value="${esc(i.name)}" ${insp === i.name ? 'selected' : ''}>${esc(i.name)}</option>`)).join('');
  const jobOpts = ['<option value="">— None —</option>']
    .concat(jobs.map(j => `<option value="${esc(j.id)}" ${ev.jobId === j.id ? 'selected' : ''}>${esc(j.title || j.id)}</option>`)).join('');

  _plModal(`
    <div style="font-size:15px;font-weight:700;color:var(--t1);margin-bottom:12px">${id ? (canEdit ? 'Edit event' : 'View event') : 'New event'}</div>
    <div class="fld form-row"><label>Title</label><input id="pl-f-title" value="${esc(ev.title || '')}" placeholder="Site visit, inspection booking…"${dis}/></div>
    <div class="fg form-row">
      <div class="fld"><label>Date</label><input type="date" id="pl-f-date" value="${esc(date)}"${dis}/></div>
      <div class="fld"><label>Start time <span style="color:var(--t3);font-weight:400">(optional)</span></label><input type="time" id="pl-f-time" value="${esc(time)}"${dis}/></div>
      <div class="fld"><label>End time <span style="color:var(--t3);font-weight:400">(optional)</span></label><input type="time" id="pl-f-endtime" value="${esc(ev.endTime || '')}"${dis}/></div>
    </div>
    <div class="fld form-row"><label>End date <span style="color:var(--t3);font-weight:400">(optional — for multi-day)</span></label><input type="date" id="pl-f-end" value="${esc(ev.endDate ? String(ev.endDate).slice(0, 10) : '')}"${dis}/></div>
    <div class="fg form-row">
      <div class="fld"><label>Inspector</label><select id="pl-f-insp"${dis}>${inspOpts}</select></div>
      <div class="fld"><label>Linked job</label><select id="pl-f-job"${dis}>${jobOpts}</select></div>
    </div>
    <div class="fld form-row"><label>Notes</label><textarea id="pl-f-notes" rows="3" placeholder="Address, contact, scope…"${dis}>${esc(ev.notes || '')}</textarea></div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:14px">
      ${(id && canEdit) ? `<button class="btn btn-sm btn-danger" data-action="plDeleteEvent" data-args="'${esc(id)}'">Delete</button>` : ''}
      <span style="flex:1"></span>
      <button class="btn btn-sm" data-action="plCloseModal">${canEdit ? 'Cancel' : 'Close'}</button>
      ${canEdit ? `<button class="btn btn-primary btn-sm" data-action="plSaveEvent">${id ? 'Save' : 'Add event'}</button>` : ''}
    </div>`);
  setTimeout(() => { const t = document.getElementById('pl-f-title'); if (t) t.focus(); }, 30);
}

function plSaveEvent() {
  if (!_plCanEdit()) return;   // read-only guard
  const val = id => (document.getElementById(id) || {}).value || '';
  const title = val('pl-f-title').trim();
  if (!title) { if (typeof toast === 'function') toast('Give the event a title.', 'warn'); document.getElementById('pl-f-title')?.focus(); return; }
  const date = val('pl-f-date');
  if (!date) { if (typeof toast === 'function') toast('Pick a date.', 'warn'); return; }
  const now = new Date().toISOString();
  const list = plLoadEvents();
  const rec = {
    id: _plEditId || ('evt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)),
    title, date, time: val('pl-f-time'), endTime: val('pl-f-endtime'), endDate: val('pl-f-end'),
    inspector: val('pl-f-insp'), jobId: val('pl-f-job'), notes: val('pl-f-notes').trim(),
    updatedAt: now,
  };
  const i = list.findIndex(e => e.id === rec.id);
  if (i >= 0) list[i] = { ...list[i], ...rec };
  else { rec.createdAt = now; list.push(rec); }
  plSaveEvents(list);
  if (typeof toast === 'function') toast(_plEditId ? 'Event updated.' : 'Event added.', 'success');
  plCloseModal(); plRender(); plRenderUpcoming();
}

async function plDeleteEvent(id) {
  if (!_plCanEdit()) return;   // read-only guard
  if (typeof vxConfirm === 'function') { if (!await vxConfirm({ message: 'Delete this event?', okLabel: 'Delete', danger: true })) return; }
  plSaveEvents(plLoadEvents().filter(e => e.id !== id));
  if (typeof toast === 'function') toast('Event deleted.');
  plCloseModal(); plRender(); plRenderUpcoming();
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
    .pl-dow{background:var(--panel);padding:7px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--t3);text-align:center;font-weight:600}
    .pl-mhead{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-bottom:0;border-radius:8px 8px 0 0;overflow:hidden}
    .pl-mwrap{border:1px solid var(--border);border-radius:0 0 8px 8px;overflow:hidden}
    .pl-mrow{position:relative;border-top:1px solid var(--border)}
    .pl-mrow:first-child{border-top:0}
    .pl-mbg{display:grid;grid-template-columns:repeat(7,1fr);position:absolute;inset:0}
    .pl-cell{background:var(--bg);border-left:1px solid var(--border);cursor:pointer}
    .pl-cell:first-child{border-left:0}
    .pl-cell:hover{background:var(--bg2)}
    .pl-cell.other{background:var(--bg2)}
    .pl-cell.today{background:rgba(34,184,206,.06)}
    .pl-mfg{position:relative;pointer-events:none;min-height:110px;padding-bottom:3px}
    .pl-mnums{display:grid;grid-template-columns:repeat(7,1fr)}
    .pl-daynum{justify-self:start;display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;margin:3px 0 2px 4px;font-size:11px;font-weight:600;color:var(--t2);border-radius:50%;pointer-events:auto;cursor:pointer}
    .pl-daynum:hover{background:var(--bg2)}
    .pl-daynum.other{color:var(--t3);opacity:.55}
    .pl-daynum.today,.pl-daynum.today:hover{background:var(--cyan);color:#012}
    .pl-mlanes{display:grid;grid-template-columns:repeat(7,1fr);column-gap:2px;row-gap:2px;padding:0 2px}
    .pl-mseg{pointer-events:auto;height:17px;line-height:17px;font-size:10.5px;padding:0 5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer}
    .pl-mseg:hover{filter:brightness(1.2)}
    .pl-mbar{font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.25)}
    .pl-mmore{pointer-events:auto;align-self:center;font-size:10px;color:var(--t3);cursor:pointer;padding-left:4px}
    .pl-mmore:hover{color:var(--cyan)}
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
    .pl-up-bar{display:flex;align-items:center;gap:8px;padding:8px 12px 4px}
    .pl-up-cap{font-size:11px;color:var(--t3);font-weight:600}
    .pl-seg-sm button{padding:3px 10px;font-size:11px}
    .pl-up-week{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border);border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
    .pl-up-col{background:var(--bg);min-height:88px;display:flex;flex-direction:column;cursor:pointer}
    .pl-up-col:hover{background:var(--bg2)}
    .pl-up-head{display:flex;flex-direction:column;align-items:center;line-height:1.15;font-size:9.5px;color:var(--t3);padding:4px 2px;border-bottom:1px solid var(--border)}
    .pl-up-head b{color:var(--t2);font-size:12px;font-weight:700}
    .pl-up-col.today .pl-up-head{background:var(--cyan)}
    .pl-up-col.today .pl-up-head,.pl-up-col.today .pl-up-head b{color:#012}
    .pl-up-body{padding:3px;display:flex;flex-direction:column;gap:2px}
    .pl-up-ev{font-size:9.5px;line-height:1.25;padding:1px 4px;border-radius:3px;border-left:2px solid;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
    .pl-up-ev:hover{filter:brightness(1.25)}
    .pl-up-more{font-size:9px;color:var(--t3);padding-left:3px;cursor:pointer}
    .pl-up-more:hover{color:var(--cyan)}
    .pl-aday{border:1px solid var(--border);border-radius:8px;margin-bottom:10px;overflow:hidden}
    .pl-aday.today{border-color:var(--cyan)}
    .pl-adate{background:var(--panel);padding:8px 12px;font-size:12px;font-weight:600;color:var(--t1);border-bottom:1px solid var(--border)}
    .pl-adow{color:var(--t3);font-weight:600;margin-right:4px}
    .pl-arows{display:flex;flex-direction:column}
    .pl-arow{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;font-size:12.5px;color:var(--t1)}
    .pl-arow:hover{background:var(--bg2)}
    .pl-atime{font-family:var(--mono);font-size:11px;color:var(--t3);min-width:64px}
    .pl-atitle{flex:1;min-width:0}
    .pl-daynum[data-action],.pl-whead[data-action]{cursor:pointer}
    .pl-daynum[data-action]:hover{background:var(--bg2);border-radius:4px}
    .pl-day{max-width:680px}
    .pl-day-sec{border:1px solid var(--border);border-radius:8px;margin-bottom:12px;overflow:hidden}
    .pl-day-h{background:var(--panel);padding:9px 14px;font-size:12px;font-weight:600;color:var(--t1);border-bottom:1px solid var(--border)}
    .pl-day-n{display:inline-block;margin-left:4px;background:var(--bg2);color:var(--t2);border-radius:9px;padding:0 7px;font-size:11px;font-family:var(--mono)}
    .pl-day-empty{padding:12px 14px;color:var(--t3);font-size:12px}
    .pl-day .pl-arow{padding:10px 14px;font-size:13px}
    .pl-tg{border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--bg)}
    .pl-tg-day{max-width:920px}
    .pl-tg-head,.pl-tg-allday,.pl-tg-body{display:flex}
    .pl-tg-gx{width:54px;flex-shrink:0;border-right:1px solid var(--border)}
    .pl-tg-heads,.pl-tg-cols{display:grid;flex:1}
    .pl-tg-head{border-bottom:1px solid var(--border)}
    .pl-tg-dayh{padding:8px 6px;text-align:center;font-size:11px;font-weight:600;color:var(--t2);border-left:1px solid var(--border);cursor:pointer}
    .pl-tg-dayh:first-child{border-left:0}
    .pl-tg-dayh.today{background:var(--cyan);color:#012}
    .pl-tg-dayh.today .pl-wdow{color:#012}
    .pl-tg-allday{border-bottom:1px solid var(--border);min-height:28px;max-height:76px;overflow-y:auto}
    .pl-tg-allbl{display:flex;align-items:center;justify-content:flex-end;padding-right:6px;font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.04em}
    .pl-tg-allwrap{flex:1;position:relative;min-height:24px}
    .pl-tg-allbg{display:grid;position:absolute;inset:0}
    .pl-tg-allcell{border-left:1px solid var(--border);cursor:pointer}
    .pl-tg-allcell:first-child{border-left:0}
    .pl-tg-allcell:hover{background:var(--bg2)}
    .pl-tg-alllanes{display:grid;position:relative;pointer-events:none;padding:3px 2px;column-gap:2px;row-gap:2px}
    .pl-tg-alllanes>*{pointer-events:auto}
    .pl-tg-body{position:relative}
    .pl-tg-gutter{width:54px;flex-shrink:0;border-right:1px solid var(--border)}
    .pl-tg-hr{position:relative}
    .pl-tg-hr span{position:absolute;top:-7px;right:6px;font-size:10px;color:var(--t3);font-family:var(--mono);line-height:1}
    .pl-tg-col{position:relative;border-left:1px solid var(--border)}
    .pl-tg-col:first-child{border-left:0}
    .pl-tg-cell{border-top:1px solid var(--border);cursor:pointer}
    .pl-tg-cell:first-child{border-top:0}
    .pl-tg-cell:hover{background:var(--bg2)}
    .pl-tg-ev{position:absolute;border-radius:4px;padding:2px 5px;font-size:10.5px;line-height:1.2;overflow:hidden;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.35)}
    .pl-tg-ev:hover{filter:brightness(1.2);z-index:5}
    .pl-tg-ev b{font-weight:700;font-family:var(--mono);font-size:9.5px;margin-right:2px}
    .pl-tg-now{position:absolute;left:0;right:0;height:0;border-top:2px solid #e5484d;z-index:6;pointer-events:none}
    .pl-tg-now::before{content:'';position:absolute;left:-4px;top:-4px;width:7px;height:7px;border-radius:50%;background:#e5484d}
    .pl-drag{cursor:grab}
    .pl-drag:active{cursor:grabbing}
    body.pl-dragging{cursor:grabbing !important;user-select:none}
    body.pl-dragging .pl-mseg,body.pl-dragging .pl-tg-ev{cursor:grabbing}
    .pl-ghost{position:fixed;z-index:10000;pointer-events:none;background:var(--cyan);color:#012;font-size:11px;font-weight:600;padding:3px 9px;border-radius:5px;box-shadow:0 6px 18px rgba(0,0,0,.5);max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pl-cell.pl-drop,.pl-tg-col.pl-drop,.pl-tg-allcell.pl-drop,.pl-res-cell.pl-drop{background:rgba(34,184,206,.14);box-shadow:inset 0 0 0 2px var(--cyan)}
    .pl-res{border:1px solid var(--border);border-radius:8px;overflow:hidden}
    .pl-res-head{display:flex;border-bottom:1px solid var(--border);background:var(--panel)}
    .pl-res-gx{width:150px;flex-shrink:0;border-right:1px solid var(--border);padding:8px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--t3);font-weight:600;display:flex;align-items:center}
    .pl-res-days{display:grid;flex:1}
    .pl-res-dayh{padding:8px 6px;text-align:center;font-size:11px;font-weight:600;color:var(--t2);border-left:1px solid var(--border);cursor:pointer}
    .pl-res-dayh:first-child{border-left:0}
    .pl-res-dayh.today{background:var(--cyan);color:#012}
    .pl-res-dayh.today .pl-wdow{color:#012}
    .pl-res-row{display:flex;border-top:1px solid var(--border);min-height:44px}
    .pl-res-row:first-of-type{border-top:0}
    .pl-res-unassigned{background:rgba(255,255,255,.015)}
    .pl-res-name{width:150px;flex-shrink:0;border-right:1px solid var(--border);padding:8px 12px;display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--t1)}
    .pl-res-unassigned .pl-res-name{color:var(--t3);font-weight:500}
    .pl-res-nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pl-res-cnt{background:var(--bg2);color:var(--t2);border-radius:9px;padding:0 7px;font-size:10px;font-family:var(--mono)}
    .pl-res-free{color:#2fb380;font-size:10px;font-weight:500}
    .pl-res-lanewrap{flex:1;position:relative;min-height:44px}
    .pl-res-bg{display:grid;position:absolute;inset:0}
    .pl-res-cell{border-left:1px solid var(--border);cursor:pointer}
    .pl-res-cell:first-child{border-left:0}
    .pl-res-cell:hover{background:var(--bg2)}
    .pl-res-lanes{display:grid;position:relative;pointer-events:none;padding:4px 2px;column-gap:2px;row-gap:2px}
    .pl-res-lanes>*{pointer-events:auto}`;
  document.head.appendChild(s);
}
