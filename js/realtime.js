// ══════════════════════════════════════════════════════════════════════════
// Realtime — WebSocket transport for live cross-device updates.
// ══════════════════════════════════════════════════════════════════════════
// Split out of js/platform.js (seventh slice). It sat under a "Photo upload
// pipeline" header that covered only the 23-line wrapper above it — the
// fourth time in this series a section header has not bounded its content.
//
// Its three top-level statements are window listeners that connect or
// disconnect on platform/online/offline changes; every function they name is
// declared here, so no evaluation-order dependency travels with them.
// ══════════════════════════════════════════════════════════════════════════
// V14 REALTIME — WebSocket transport for live cross-device updates
// ══════════════════════════════════════════════════════════════════════════
// Server contract: a WebSocket endpoint at /ws (auth via Sec-WebSocket-Protocol
// header containing the JWT, since browsers don't allow custom headers on WS
// upgrades). Server pushes JSON frames of shape:
//   { type: 'entity.changed', key: 'vx-reports-v1', actor: 'u_abc', ts: '...' }
//   { type: 'presence',       userId: '...', orgId: '...', status: 'online' }
//   { type: 'pong' }
//
// On entity.changed, the client either re-pulls (if the change isn't ours) or
// ignores (if actor === own userId). The reactive renderers pick up the new
// data on next render naturally.

// V44: realtime uses Supabase channels (postgres_changes). The previous
// hand-rolled WebSocket + ping loop is gone, but we keep the same module-
// level variables (_vxWs, _vxWsReconnectAttempt, etc.) so anything that
// peeked at them (e.g. vxDiagnostics) keeps working. _vxWs now holds a
// RealtimeChannel reference rather than a WebSocket — its .state property
// is used for diagnostic readState mapping.
var _vxWs = null;                       // RealtimeChannel | null
var _vxWsReconnectTimer = null;         // unused under Supabase (SDK handles reconnect) — kept for back-compat
var _vxWsReconnectAttempt = 0;
              // unused under Supabase — SDK has its own heartbeat
var VX_WS_PING_INTERVAL_MS = 30 * 1000;

// Re-dispatch helper: fired on every remote entity-changed event so the
// rest of the app can listen for 'vx:entity-change' without knowing or
// caring whether the transport is raw WebSocket or Supabase channels.
function _vxDispatchEntityChange(key, actor){
  try { window.dispatchEvent(new CustomEvent('vx:entity-change', { detail: { key: key, actor: actor } })); } catch(e){}
  // Back-compat: previous code listened to 'vx:remote-change' too.
  try { window.dispatchEvent(new CustomEvent('vx:remote-change',  { detail: { key: key, actor: actor } })); } catch(e){}
}

function vxRealtimeConnect() {
  if(!vxIsAuthenticated()) return;
  var sb = _vxSupabase();
  if(!sb) return;
  var cfg = vxPlatformConfig();
  if(!cfg.orgId) return;
  // Always tear down before reconnecting (V44.4). Reasons:
  //   1. An early boot subscribe may have joined the channel with the anon
  //      token before _vxApplySupabaseSession pushed the JWT into sb.realtime.
  //      Such channels report state='joined' but never receive any RLS-gated
  //      row events — the only fix is rebuild from scratch with the JWT in
  //      hand.
  //   2. Idempotent reconnect lets TOKEN_REFRESHED handlers re-bind cleanly
  //      without worrying about stale-channel state.
  if(_vxWs) {
    try {
      if(typeof sb.removeChannel === 'function') sb.removeChannel(_vxWs);
      else if(typeof _vxWs.unsubscribe === 'function') _vxWs.unsubscribe();
    } catch(e){}
    _vxWs = null;
  }

  // Per-session channel name suffix (V44.5). The naïve 'org:<orgId>' name
  // could be re-used across reconnects in a single tab; once it had been
  // joined with anon auth the broker silently rejected all RLS-gated row
  // events for that channel name even after setAuth pushed the real JWT.
  // Fresh names with a timestamp suffix sidestep the broker's per-name
  // auth context caching — verified empirically: identical bindings on a
  // fresh name deliver events; on the reused name they don't.
  var channelName = 'org:' + cfg.orgId + ':' + Date.now();
  try {
    _vxWs = sb.channel(channelName)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'entities', filter: 'org_id=eq.' + cfg.orgId },
        function(payload){
          // payload.new / payload.old / payload.eventType — we want the key
          // of the row that changed, plus the actor (updated_by) so we can
          // skip our own writes (which would cause a render loop).
          var row = payload.new || payload.old || {};
          var key = row.key;
          var actor = row.updated_by;
          if(!key) return;
          var cfgNow = vxPlatformConfig();
          if(actor && actor === cfgNow.userId) return;  // our own write — ignore
          // V45: a per-report HTML row changed (teammate sealed/revised a
          // report). Don't store it as a standalone local key — merge the
          // snapshot onto the matching report in vx-reports-v1.
          if(key.indexOf(VX_HTML_PREFIX) === 0){
            var rid = key.slice(VX_HTML_PREFIX.length);
            vxApi.hydrate(key).then(function(val){
              if(!val) return;
              var reps = ls('vx-reports-v1', []);
              if(!Array.isArray(reps)) return;
              var fields = VX_HEAVY_FIELDS['vx-reports-v1']; var hit = false;
              reps.forEach(function(r){
                if(r && _vxReportKey(r) === rid){ fields.forEach(function(f){ if(val[f] != null) r[f] = val[f]; }); hit = true; var s = _vxReportHtmlSig(r); if(s) _vxHtmlSigSet(rid, s); }
              });
              if(hit){
                _vxRawLss('vx-reports-v1', reps);
                _vxDispatchEntityChange('vx-reports-v1', actor);
                var active = document.querySelector('.page.active');
                if(active && active.id === 'page-reports' && typeof rptRender === 'function') rptRender();
              }
            }).catch(function(){});
            return;
          }
          // V48: a per-report METADATA row changed (teammate created/edited a
          // report). Merge that one report into the local array — keep our copy
          // if it has unpushed local edits, else take theirs. New reports from a
          // teammate appear; nothing is clobbered (each report is its own row).
          if(key.indexOf(VX_REPORT_PREFIX) === 0){
            var mkey = key.slice(VX_REPORT_PREFIX.length);
            if(vxStore.isDirty(VX_REPORT_PREFIX + mkey)) return;  // our unpushed edit wins
            vxApi.hydrate(key).then(function(val){
              if(!val) return;
              var reps = ls('vx-reports-v1', []);
              if(!Array.isArray(reps)) reps = [];
              var fields = VX_HEAVY_FIELDS['vx-reports-v1'];
              var idx = reps.findIndex(function(r){ return _vxReportKey(r) === mkey; });
              var rec = val;
              if(idx >= 0){
                var prev = reps[idx];
                if(fields.some(function(f){ return rec[f] == null && prev[f] != null; })){
                  rec = Object.assign({}, rec);
                  fields.forEach(function(f){ if(rec[f] == null && prev[f] != null) rec[f] = prev[f]; });
                }
                reps[idx] = rec;
              } else {
                reps.push(rec);
              }
              _vxReportMetaSigSet(mkey, _vxReportMetaSig(val));
              _vxClearDirty(VX_REPORT_PREFIX + mkey);
              _vxRawLss('vx-reports-v1', reps);
              _vxDispatchEntityChange('vx-reports-v1', actor);
              _vxReportTeammateToast();
              var active = document.querySelector('.page.active');
              if(active && active.id === 'page-reports' && typeof rptRender === 'function') rptRender();
              else if(active && active.id === 'page-overview' && typeof ovRefreshDashboard === 'function') ovRefreshDashboard();
            }).catch(function(){});
            return;
          }
          // Re-pull this single key so the local cache catches up
          vxStore.pull(key).then(function(){
            _vxDispatchEntityChange(key, actor);
            if(typeof toast === 'function'){
              var labels = {
                'vx-reports-v1':    'Reports updated by a teammate',
                'vx-defects-v1':    'Defects updated by a teammate',
                'vx-inspectors-v1': 'Inspectors updated',
                'vx-company-v1':    'Company profile updated',
                'vx-settings-v1':   'Settings updated',
              };
              if(labels[key]) toast(labels[key] + '.', 'info');
            }
            // Re-render the active page so the user sees the new data
            var active = document.querySelector('.page.active');
            if(active && active.id){
              var pageId = active.id.replace('page-', '');
              if(pageId === 'reports'  && typeof rptRender         === 'function') rptRender();
              else if(pageId === 'defects'  && typeof defRender         === 'function') defRender();
              else if(pageId === 'overview' && typeof ovRefreshDashboard === 'function') ovRefreshDashboard();
              else if(pageId === 'inbox'    && typeof inboxRender       === 'function') inboxRender();
            }
          }).catch(function(){});
        })
      .subscribe(function(status){
        // status: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'
        if(status === 'SUBSCRIBED'){
          _vxWsReconnectAttempt = 0;
          console.log('vx: realtime subscribed (' + channelName + ')');
          try { window.dispatchEvent(new CustomEvent('vx:realtime-status', { detail: { status: 'connected' } })); } catch(e){}
        } else if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'){
          try { window.dispatchEvent(new CustomEvent('vx:realtime-status', { detail: { status: 'disconnected' } })); } catch(e){}
          // The Supabase SDK auto-reconnects internally; no manual schedule.
        }
      });
  } catch(e){
    console.warn('vx: realtime connect failed', e);
    _vxWs = null;
  }
}

function vxRealtimeDisconnect() {
  if(_vxWs){
    try {
      var sb = _vxSupabase();
      if(sb && typeof sb.removeChannel === 'function') sb.removeChannel(_vxWs);
      else if(typeof _vxWs.unsubscribe === 'function') _vxWs.unsubscribe();
    } catch(e){}
    _vxWs = null;
  }
}

// Connect on auth, disconnect on signout
window.addEventListener('vx:platform-change', () => {
  if(vxIsAuthenticated()) vxRealtimeConnect();
  else vxRealtimeDisconnect();
});
// V28: when the browser comes back online, reset the backoff counter so we
// reconnect promptly instead of waiting through a long backoff timer that
// started before the outage was diagnosed.
window.addEventListener('online', () => {
  if(vxIsAuthenticated()){
    _vxWsReconnectAttempt = 0;
    if(_vxWsReconnectTimer){ clearTimeout(_vxWsReconnectTimer); _vxWsReconnectTimer = null; }
    vxRealtimeConnect();
  }
});
// V28: when the browser detects going offline, surgically close so we don't
// leak a half-dead socket. Reconnect logic will fire automatically on online.
// V44: under Supabase channels the SDK handles its own offline detection,
// but we still proactively tear down our channel reference so we don't
// double-subscribe on online.
window.addEventListener('offline', () => vxRealtimeDisconnect());

