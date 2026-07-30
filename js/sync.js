// ══════════════════════════════════════════════════════════════════════════
// Sync — getting local changes to the server, and surviving a bad network.
// ══════════════════════════════════════════════════════════════════════════
// Split out of js/platform.js (ninth and last of the series). The most
// intricate code in the app: a mutation queue with per-key dedup, a 5000-op
// cap, a per-op retry budget, heavy-field offload, server-side report
// numbering, and a circuit breaker that resets the Supabase SDK after
// repeated trips.
//
// Moved only after tools/sync-queue.test.mjs existed to cover it — 13
// behavioural tests, each shown to fail against a deliberate mutation of the
// logic it guards. Nothing else in the suite exercises this code, so without
// them a subtle break here would have passed every gate and surfaced as a
// customer's work silently never reaching the server.
//
// No top-level executable statements, so the move carries no
// evaluation-order risk. Report numbering travels with it rather than being
// split off: vxAllocReportNo runs during flush, and separating it would mean
// moving untested code on its own.
// ── Sync queue ────────────────────────────────────────────────────────────
// Each entry records a single mutation that should be replayed against the
// server. We replay in insertion order and on success mark the entry delivered.
// Failed entries stay in the queue for the periodic retry sweep.
// V14: sync queue robustness — per-key dedup, size cap, circuit breaker.
//
// Dedup: if a 'put' for the same key is already pending, replace its value
// rather than adding another op. Most user activity is rapid edits to the
// same record; without this, a 30-second editing session can leave 50
// pending ops for one report. Last write wins, which matches the server's
// semantics anyway.
//
// Size cap: queue is bounded to 5000 ops. If we exceed, oldest delivered/
// failed ops get evicted. Failed ops past N retries are dropped with a
// telemetry event (the user is in a bad state and we want to surface it).
//
// Circuit breaker: if the last 5 sync attempts all failed, stop trying for
// 60 seconds. Prevents hammering an unhealthy server. The next manual sync
// or successful request resets the breaker.

var VX_SYNC_QUEUE_MAX     = 5000;
var VX_SYNC_OP_MAX_RETRIES = 8;
var VX_BREAKER_FAIL_THRESHOLD = 5;
var VX_BREAKER_COOLDOWN_MS    = 60 * 1000;
var _vxBreakerRecentFails = 0;
var _vxBreakerOpenUntil = 0;
// Count of consecutive breaker trips (resets on the first successful
// op). When the SDK client wedges into a bad state, every request fails
// with TypeError: Failed to fetch — the breaker opens, cools down, then
// trips again the moment retries resume. After two such trips we null
// out the cached _vxSupabaseClient so the next call rebuilds it from
// scratch with a fresh fetch wrapper, websocket, and auth listener.
var _vxBreakerTripCount = 0;
var VX_BREAKER_TRIPS_BEFORE_SDK_RESET = 2;

function vxBreakerIsOpen() { return Date.now() < _vxBreakerOpenUntil; }
function _vxBreakerRecordResult(ok) {
  if(ok) {
    _vxBreakerRecentFails = 0;
    _vxBreakerOpenUntil = 0;
    _vxBreakerTripCount = 0;
  } else {
    _vxBreakerRecentFails++;
    if(_vxBreakerRecentFails >= VX_BREAKER_FAIL_THRESHOLD) {
      _vxBreakerOpenUntil = Date.now() + VX_BREAKER_COOLDOWN_MS;
      _vxBreakerRecentFails = 0;   // reset so the *next* burst counts cleanly toward another trip
      _vxBreakerTripCount++;
      console.warn('vx: sync circuit breaker open for ' + (VX_BREAKER_COOLDOWN_MS/1000) + 's (trip ' + _vxBreakerTripCount + ')');
      if(_vxBreakerTripCount >= VX_BREAKER_TRIPS_BEFORE_SDK_RESET) {
        console.warn('vx: resetting Supabase SDK singleton after ' + _vxBreakerTripCount + ' consecutive breaker trips');
        _vxDisposeSupabaseClient(_vxSupabaseClient);
        _vxSupabaseClient = null;
        _vxBreakerTripCount = 0;
      }
    }
  }
}

// ── Heavy-field offload helpers (V45) ────────────────────────────────────
// Per-report HTML rows are immutable once sealed, so we sync each one exactly
// once. A persistent signature map (reportId -> sig, sig = sealedAt) records
// which have already reached the cloud, so a metadata-only change never
// re-uploads the megabytes of HTML.
function _vxHtmlSigMap(){ try { return JSON.parse(localStorage.getItem(VX_HTML_SIG_KEY) || '{}'); } catch { return {}; } }
function _vxHtmlSigSave(m){ try { localStorage.setItem(VX_HTML_SIG_KEY, JSON.stringify(m)); } catch(e){} }
function _vxHtmlSigSet(id, sig){ const m = _vxHtmlSigMap(); if(m[id] !== sig){ m[id] = sig; _vxHtmlSigSave(m); } }
function _vxHtmlSigClear(id){ const m = _vxHtmlSigMap(); if(id in m){ delete m[id]; _vxHtmlSigSave(m); } }
// V48: parallel signature map for per-report METADATA rows, so a report whose
// light metadata hasn't changed is not re-uploaded on every save of any report.
function _vxReportMetaSigMap(){ try { return JSON.parse(localStorage.getItem(VX_REPORT_META_SIG_KEY) || '{}'); } catch { return {}; } }
function _vxReportMetaSigSave(m){ try { localStorage.setItem(VX_REPORT_META_SIG_KEY, JSON.stringify(m)); } catch(e){} }
function _vxReportMetaSigSet(id, sig){ const m = _vxReportMetaSigMap(); if(m[id] !== sig){ m[id] = sig; _vxReportMetaSigSave(m); } }
function _vxReportMetaSigClear(id){ const m = _vxReportMetaSigMap(); if(id in m){ delete m[id]; _vxReportMetaSigSave(m); } }
// Signature of a light (HTML-stripped) report — any field change flips it.
function _vxReportMetaSig(lightReport){ try { return JSON.stringify(lightReport); } catch { return String(Date.now()); } }
// Stable per-seal signature: sealedAt is set once at approval and never
// changes for a given sealed report/revision. Falls back to a length tag.
function _vxReportHtmlSig(r){
  const fields = VX_HEAVY_FIELDS['vx-reports-v1'];
  const has = fields.some(f => r && r[f]);
  if(!has) return null;
  return String(r.sealedAt || (r.revision || '') + ':' + ((r.sealedHtml || r.frozenHtml || '').length));
}
// Stable per-report key for addressing its html row. Reports created before
// an `id` field existed are keyed by reportNo::revision (unique per revision).
// Returns null if neither is available — caller then must NOT strip its HTML.
function _vxReportKey(r){
  if(!r) return null;
  if(r.id) return String(r.id);
  if(r.reportNo) return String(r.reportNo) + '::' + String(r.revision || '');
  return null;
}

// V48: a stable client-side UUID for a new report, so its sync-row key is
// independent of its (later-allocated) report number.
function vxNewId(){
  try { if(typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch(e){}
  try {
    if(typeof crypto !== 'undefined' && crypto.getRandomValues){
      const b = new Uint8Array(16); crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b).map(x => x.toString(16).padStart(2, '0'));
      return h.slice(0,4).join('') + '-' + h.slice(4,6).join('') + '-' + h.slice(6,8).join('') + '-' + h.slice(8,10).join('') + '-' + h.slice(10).join('');
    }
  } catch(e){}
  return 'r-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

// V48: format a human report number from an integer sequence + the org's local
// numbering config (prefix / separator / year digits / seq digits / method
// position). Single source of truth — the new-report, editor preview and
// settings preview all call this. Mirrors the original inline algorithm.
function vxFormatReportNo(seq, method, settings){
  const s = settings || (typeof ls === 'function' ? ls('vx-settings-v1', {}) : {});
  const prefix    = s.numPrefix || 'INS';
  const sep       = s.numSep !== undefined ? s.numSep : '-';
  const yrDigits  = parseInt(s.numYear || '4', 10);
  const digits    = parseInt(s.numDigits || '3', 10);
  const methodPos = s.numMethodPos || 'none';
  const yr = yrDigits === 4 ? new Date().getFullYear() : yrDigits === 2 ? String(new Date().getFullYear()).slice(-2) : '';
  const sq = String(seq).padStart(digits, '0');
  const mCode = (method || '').toUpperCase();
  const parts = [prefix];
  if(methodPos === 'after-prefix' && mCode) parts.push(mCode);
  if(yr) parts.push(yr);
  if(methodPos === 'after-year' && mCode) parts.push(mCode);
  parts.push(sq);
  return parts.filter(Boolean).join(sep);
}

// V48: seed the server counter ONCE from the org's configured "next number",
// the first time this org allocates — so an org that set a starting number in
// Settings keeps it. No-op if the counter has already advanced (peek != 1) or
// the local start is the default 1. Best-effort; guarded server-side so it can
// never lower a counter below an already-issued number.
var _vxReportCounterSeeded = false;
async function _vxSeedReportCounterOnce(sb, orgId){
  if(_vxReportCounterSeeded) return;
  _vxReportCounterSeeded = true;
  try {
    const s = (typeof ls === 'function') ? ls('vx-settings-v1', {}) : {};
    const localNext = parseInt(s.numNext || '1', 10);
    if(!(localNext > 1)) return;
    const peek = await sb.rpc('vx_peek_report_no', { p_org: orgId });
    if(peek.error || peek.data == null) return;
    if(Number(peek.data) === 1){
      await sb.rpc('vx_set_report_no', { p_org: orgId, p_next: localNext });
    }
  } catch(e){ /* best-effort seed */ }
}

// V48: allocate a report's final number from the server — atomic, gap-free, and
// exactly-once per report id (a retry returns the same number, never skips).
// Online + authenticated only. On success sets report.reportNo + reportSeq and
// clears isDraft; on offline/error leaves it a Draft (no number) and returns
// null, so the caller can save it as a Draft to be numbered when back online.
// V48: number any Drafts that were saved offline (have a stable id but no
// reportNo yet). Runs after a sync/flush and after signin, when online. The
// allocation RPC is idempotent on report id, so this is safe to re-run. Returns
// how many it numbered.
async function vxNumberPendingDrafts(){
  try {
    if(!vxIsAuthenticated()) return 0;
    if(typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    const reports = ls('vx-reports-v1', []);
    if(!Array.isArray(reports) || !reports.length) return 0;
    let numbered = 0;
    for(const r of reports){
      if(r && r.id && !r.reportNo){
        const no = await vxAllocReportNo(r);
        if(no){ r.updatedAt = new Date().toISOString(); numbered++; }
      }
    }
    if(numbered){ lss('vx-reports-v1', reports); if(typeof rptRender === 'function') try { rptRender(); } catch(e){} }
    return numbered;
  } catch(e){ console.warn('vx: vxNumberPendingDrafts failed', e); return 0; }
}

async function vxAllocReportNo(report){
  try {
    if(!report || !report.id) return null;
    if(report.reportNo) return report.reportNo;          // already numbered (idempotent caller-side)
    if(!vxIsAuthenticated() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
    const sb  = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
    const cfg = (typeof vxPlatformConfig === 'function') ? vxPlatformConfig() : {};
    if(!sb || !sb.rpc || !cfg.orgId) return null;
    await _vxSeedReportCounterOnce(sb, cfg.orgId);
    const res = await sb.rpc('vx_alloc_report_no', { p_org: cfg.orgId, p_report_uuid: report.id });
    if(res.error || res.data == null){ console.warn('vx: alloc_report_no', res.error && res.error.message); return null; }
    const seq = res.data;
    const s = (typeof ls === 'function') ? ls('vx-settings-v1', {}) : {};
    report.reportNo  = vxFormatReportNo(seq, report.method, s);
    report.reportSeq = Number(seq);
    report.isDraft   = false;
    return report.reportNo;
  } catch(e){ console.warn('vx: vxAllocReportNo failed', e); return null; }
}

// V47: mint the report-verify URL that the report's QR code encodes. The
// signed token is minted server-side (portal-token kind:'verify') and is
// long-lived. The caller stores the URL on the report BEFORE sealing, so the
// frozen PDF's QR opens a working #/verify/<token> link. Returns the URL, or
// null when offline / not cloud-configured (the report still seals, just
// without a verify QR until re-approved online).
async function vxEnsureReportVerifyUrl(r){
  try {
    if(r && r.verifyUrl) return r.verifyUrl;
    const sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
    const cfg = (typeof vxPlatformConfig === 'function') ? vxPlatformConfig() : {};
    if(!sb || !sb.functions || !cfg.orgId) return null;
    const reportId = _vxReportKey(r);
    if(!reportId) return null;
    const res = await sb.functions.invoke('portal-token', { body: { kind: 'verify', orgId: cfg.orgId, reportId: reportId } });
    if(res.error || !res.data || !res.data.url) return null;
    return res.data.url;
  } catch(e){ console.warn('vx: verify-url mint failed', e); return null; }
}
// Return a shallow clone of the array with the heavy fields removed from each
// item (never mutates the caller's objects), plus the html put/delete ops.
// SAFETY: an item's HTML is only stripped when we have a stable key to re-home
// it in a per-report row — never strip HTML we can't address, or it'd be lost.
function _vxSplitHeavy(collectionKey, value){
  const fields = VX_HEAVY_FIELDS[collectionKey];
  if(!fields || !Array.isArray(value)) return { stripped: value, puts: [], deletes: [] };
  const sigMap = _vxHtmlSigMap();
  const liveIds = {};
  const stripped = [];
  const puts = [];
  for(const item of value){
    if(!item || typeof item !== 'object'){ stripped.push(item); continue; }
    let heavy = null;
    for(const f of fields){ if(item[f] != null){ (heavy = heavy || {})[f] = item[f]; } }
    const key = heavy ? _vxReportKey(item) : null;
    if(heavy && key){
      const clone = Object.assign({}, item);
      for(const f of fields) delete clone[f];
      stripped.push(clone);
      liveIds[key] = true;
      const sig = _vxReportHtmlSig(item);
      if(sig && sigMap[key] !== sig){ puts.push({ id: key, sig: sig, value: heavy }); }
    } else {
      // No heavy fields, or no stable key to address an html row → leave the
      // item exactly as-is (do not strip HTML we couldn't re-home).
      stripped.push(item);
    }
  }
  // Reports we've synced HTML for that are no longer present → delete their rows.
  const deletes = [];
  for(const id of Object.keys(sigMap)){ if(!liveIds[id]) deletes.push(id); }
  return { stripped, puts, deletes };
}

function vxSyncEnqueue(op) {
  if(!vxIsAuthenticated()) return;
  // V48: the reports collection ('vx-reports-v1') no longer syncs as a blob —
  // it is split into per-report rows by vxSyncEnqueueReports, which is called
  // directly from lss(). Any stray blob-level enqueue for it is ignored here.
  if(op.key === 'vx-reports-v1'){ try { vxSyncEnqueueReports(op.value); } catch(e){} return; }
  // only sync generic entity keys, per-report metadata rows, or html rows
  if(!VX_ENTITY_KEYS.has(op.key)
     && op.key.indexOf(VX_HTML_PREFIX) !== 0
     && op.key.indexOf(VX_REPORT_PREFIX) !== 0) return;
  try {
    let queue = JSON.parse(localStorage.getItem(VX_SYNC_QUEUE_KEY) || '[]');

    // Dedup: if there's already a pending op for this key with the same kind,
    // replace its value (and bump the timestamp) rather than appending.
    const existingIdx = queue.findIndex(o =>
      o.key === op.key && o.op === op.kind && o.status === 'pending'
    );
    if(existingIdx >= 0 && op.kind !== 'delete') {
      queue[existingIdx].value = op.value;
      queue[existingIdx].at = new Date().toISOString();
      if(op.htmlId){ queue[existingIdx].htmlId = op.htmlId; queue[existingIdx].htmlSig = op.htmlSig; }
      if(op.metaId){ queue[existingIdx].metaId = op.metaId; queue[existingIdx].metaSig = op.metaSig; }
    } else {
      queue.push({
        id: 'op-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        at: new Date().toISOString(),
        op: op.kind,                            // 'put' | 'delete' | 'patch'
        key: op.key,
        value: op.value,
        htmlId: op.htmlId,                      // V45: set for vx-report-html:: ops
        htmlSig: op.htmlSig,
        metaId: op.metaId,                      // V48: set for vx-report:: ops
        metaSig: op.metaSig,
        tries: 0,
        status: 'pending',
      });
    }

    // Size cap: drop oldest delivered/failed ops if over the limit.
    if(queue.length > VX_SYNC_QUEUE_MAX) {
      queue.sort((a, b) => {
        // Pending > failed > delivered, then by timestamp (newest first)
        const order = { pending: 0, failed: 1, delivered: 2 };
        if(order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return new Date(b.at) - new Date(a.at);
      });
      queue = queue.slice(0, VX_SYNC_QUEUE_MAX);
    }

    try {
    localStorage.setItem(VX_SYNC_QUEUE_KEY, JSON.stringify(queue));
    } catch(e){ console.warn("ls setItem failed", e); }
    vxSyncPokeBadge();
  } catch(e) { console.warn('vxSyncEnqueue', e); }
}

// V48: enqueue the reports array as per-report rows instead of one blob.
// Reuses _vxSplitHeavy to peel each report's heavy HTML into its write-once
// 'vx-report-html::<key>' row (unchanged), then enqueues each CHANGED light
// report as its own 'vx-report::<key>' row (skipping reports whose metadata
// signature is unchanged, so saving one report doesn't re-upload the rest).
// Marks each changed report's per-report dirty flag so a concurrent pull keeps
// the local copy until the queue drains. There are no per-report deletes — the
// product never deletes a report (a wrong report is revised), which removes the
// whole "did a teammate's report get resurrected on pull" class of bug.
function vxSyncEnqueueReports(arr){
  if(!vxIsAuthenticated()) return;
  if(!Array.isArray(arr)) return;
  const split = _vxSplitHeavy('vx-reports-v1', arr);   // { stripped, puts, deletes } for HTML
  for(const p of split.puts){
    vxSyncEnqueue({ kind: 'put', key: VX_HTML_PREFIX + p.id, value: p.value, htmlId: p.id, htmlSig: p.sig });
  }
  for(const id of split.deletes){
    vxSyncEnqueue({ kind: 'delete', key: VX_HTML_PREFIX + id, htmlId: id });
  }
  const sigMap = _vxReportMetaSigMap();
  for(const light of split.stripped){
    const key = _vxReportKey(light);
    if(!key) continue;                                  // unkeyable draft — stays local until it has an id
    const sig = _vxReportMetaSig(light);
    if(sigMap[key] === sig) continue;                   // metadata unchanged — skip
    _vxMarkDirty(VX_REPORT_PREFIX + key);
    vxSyncEnqueue({ kind: 'put', key: VX_REPORT_PREFIX + key, value: light, metaId: key, metaSig: sig });
  }
}
function vxSyncList()   { try { return JSON.parse(localStorage.getItem(VX_SYNC_QUEUE_KEY) || '[]'); } catch { return []; } }
function vxSyncStats()  {
  const q = vxSyncList();
  return {
    total: q.length,
    pending: q.filter(o => o.status === 'pending').length,
    failed:  q.filter(o => o.status === 'failed').length,
    delivered: q.filter(o => o.status === 'delivered').length,
    droppedPermanently: vxSyncDroppedList().length,
    breakerOpen: vxBreakerIsOpen(),
  };
}
function vxSyncPokeBadge() {
  try { window.dispatchEvent(new CustomEvent('vx:sync-change', { detail: vxSyncStats() })); } catch(e){}
}
async function vxSyncFlush() {
  if(!vxIsAuthenticated()) return { skipped: true };
  if(!navigator.onLine)    return { offline: true };
  if(vxBreakerIsOpen())    return { breakerOpen: true, openUntil: _vxBreakerOpenUntil };

  const queue = vxSyncList();
  const pending = queue.filter(o => o.status === 'pending' || o.status === 'failed');
  if(!pending.length) return { empty: true };

  let delivered = 0, failed = 0, dropped = 0;
  const droppedThisRun = [];
  for(const op of pending) {
    if(vxBreakerIsOpen()) break;   // stop mid-flush if breaker trips
    op.tries = (op.tries || 0) + 1;

    // Drop ops that have exceeded the retry budget — mark them so the
    // compaction step at the end of this function evicts them from the
    // queue (instead of leaving them in 'failed' state to be re-tried
    // forever on every subsequent flush). A copy is stashed in the
    // dropped log for UI surfacing and post-mortem.
    if(op.tries > VX_SYNC_OP_MAX_RETRIES) {
      op.status = 'dropped';
      op.lastError = (op.lastError || '') + ' [exceeded retry budget]';
      op.droppedAt = new Date().toISOString();
      droppedThisRun.push({
        id: op.id, key: op.key, op: op.op, tries: op.tries,
        lastError: op.lastError, droppedAt: op.droppedAt,
      });
      dropped++;
      vxReportError(new Error('Sync op dropped after ' + op.tries + ' attempts: ' + op.key), 'sync-drop');
      continue;
    }

    try {
      // V44: route through the Supabase-backed entity helpers. The op.value
      // we stored at enqueue time is the parsed JS object (since lss()
      // hands us the JS object before JSON.stringify) — pass it through to
      // upsertEntity which writes it as jsonb.
      var r;
      if(op.op === 'delete'){
        r = await vxApi.deleteEntity(op.key);
      } else {
        r = await vxApi.upsertEntity(op.key, op.value);
      }
      if(r.ok) {
        op.status = 'delivered'; op.deliveredAt = new Date().toISOString();
        delivered++;
        _vxBreakerRecordResult(true);
        // V45: a per-report HTML row reached the cloud — record (or clear, on
        // delete) its signature so we never re-upload that immutable snapshot.
        if(op.htmlId){ if(op.op === 'delete') _vxHtmlSigClear(op.htmlId); else _vxHtmlSigSet(op.htmlId, op.htmlSig); }
        // V48: a per-report metadata row reached the cloud — record its sig so an
        // unchanged report isn't re-uploaded on the next save of another report.
        if(op.metaId){ if(op.op === 'delete') _vxReportMetaSigClear(op.metaId); else _vxReportMetaSigSet(op.metaId, op.metaSig); }
      } else {
        op.status = 'failed'; op.lastError = r.error || 'sync error';
        failed++;
        _vxBreakerRecordResult(false);
      }
    } catch(e) {
      op.status = 'failed'; op.lastError = String(e.message || e);
      failed++;
      _vxBreakerRecordResult(false);
    }
  }
  // Compact:
  //   - 'dropped' ops are removed from the queue entirely (their record
  //     lives in the dropped log persisted below — without this they were
  //     left in 'failed' state and re-tried every cycle, which is how the
  //     vx-settings-v1 op reached 134 attempts before).
  //   - 'delivered' ops older than 24h are pruned to keep storage tidy.
  // A key whose queued writes have ALL been delivered this run is no longer
  // ahead of the server — clear its dirty flag so a later pullAll may
  // refresh it again. Keys with ops still pending/failed stay dirty so
  // pullAll keeps skipping them until the queue fully drains — that is what
  // protects an in-flight save from being clobbered by a concurrent pull.
  const _stillQueued = new Set(
    queue.filter(o => o.status === 'pending' || o.status === 'failed').map(o => o.key)
  );
  pending.forEach(o => {
    if(o.status === 'delivered' && o.key && !_stillQueued.has(o.key)) _vxClearDirty(o.key);
  });
  const cutoff = Date.now() - 24*60*60*1000;
  const next = queue.filter(o => {
    if(o.status === 'dropped') return false;
    if(o.status === 'delivered') return o.deliveredAt && new Date(o.deliveredAt).getTime() > cutoff;
    return true;
  });
  try { localStorage.setItem(VX_SYNC_QUEUE_KEY, JSON.stringify(next)); } catch(e){}
  // Persist this run's dropped ops, capped to the most recent 200 so the
  // log can't itself become a storage hog. UI consumers read this via
  // vxSyncDroppedList() to surface a "N ops dropped permanently" badge.
  if(droppedThisRun.length){
    try {
      const existing = JSON.parse(localStorage.getItem(VX_SYNC_DROPPED_KEY) || '[]');
      const combined = existing.concat(droppedThisRun).slice(-200);
      localStorage.setItem(VX_SYNC_DROPPED_KEY, JSON.stringify(combined));
    } catch(e){}
  }
  vxPlatformSet({ lastSyncAt: new Date().toISOString(), syncErrorCount: failed });
  vxSyncPokeBadge();
  return { delivered, failed, dropped, remaining: next.filter(o => o.status !== 'delivered').length };
}

// Read the persisted dropped-op log. UI / diagnostics use this to show
// "N ops dropped permanently" without scanning the live queue.
function vxSyncDroppedList() {
  try { return JSON.parse(localStorage.getItem(VX_SYNC_DROPPED_KEY) || '[]'); }
  catch { return []; }
}
// Clear the dropped log — useful for "I've seen the failures, hide the
// badge" actions or for tests.
function vxSyncDroppedClear() {
  try { localStorage.removeItem(VX_SYNC_DROPPED_KEY); }
  catch(e){}
  vxSyncPokeBadge();
}

// Periodic retry sweep — every 30s when authenticated AND online AND breaker closed
var _vxSyncTimer = null;
function vxSyncStart() {
  if(_vxSyncTimer) clearInterval(_vxSyncTimer);
  _vxSyncTimer = setInterval(() => {
    if(vxIsCloud() && navigator.onLine){
      vxSyncFlush().then(() => vxNumberPendingDrafts()).catch(() => {});
    }
  }, 30 * 1000);
}

// Don't wait up to 30s for the sweep after connectivity returns — flush on the
// `online` event too. This listener sat inside platform.js's global error-handler
// block until the twelfth slice; it has nothing to do with error handling and
// belongs beside the flush it triggers. The 800ms delay lets the connection
// settle before the first request goes out.
//
// It is now this file's only top-level statement. The ninth slice moved the queue
// on the strength of having none; attaching a listener is order-safe, so that
// property is preserved in substance — nothing here reads another module's state
// at load.
window.addEventListener('online', () => { if(vxIsCloud()) setTimeout(() => vxSyncFlush().catch(()=>{}), 800); });

