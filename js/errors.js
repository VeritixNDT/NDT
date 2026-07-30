// ══════════════════════════════════════════════════════════════════════════
// Errors — the global safety net, and telemetry for what it catches.
// ══════════════════════════════════════════════════════════════════════════
// Split out of js/platform.js (twelfth slice). Uncaught exceptions, unhandled
// promise rejections and failed resource loads all land here, get a rate-limited
// toast, and are POSTed to /telemetry/error.
//
// This net has already earned its keep on this very refactor. When js/supabase.js
// was split out in the tenth slice, the verification harness aborted the request
// for it (its CDN blocklist matched the path, not the host). Nothing threw — the
// app has eighteen `typeof _vxSupabase === 'function'` guards that would all have
// taken the null branch — and all 30 pages still rendered. What surfaced it was
// the `error` listener below firing on the failed SCRIPT tag, which checkRendered
// then reported. A silent whole-subsystem loss became a one-line message.
//
// Its two top-level statements are addEventListener calls: they attach and
// nothing more, so they carry no evaluation-order dependency and every function
// they name is declared in this file.
//
// LOAD POSITION, and a deliberate non-change. This file is placed immediately
// after platform.js because that is exactly where the block used to execute, so
// the split cannot alter when the listeners attach. But note what that costs:
// seven files load before it (qrcode, constants, acceptance, utils, a11y, i18n,
// storage), and a throw or failed load in any of them is caught by nothing. The
// supabase.js failure was only visible BECAUSE supabase.js loads later. Moving
// this file to the front of the order would widen the net to cover the whole
// boot, and the guards make that safe: vxReportError's toast path is behind
// `typeof toast === 'function'` (and toast lives in ui.js, which loads after
// i18n.js, so tf() is available whenever toast is), and its telemetry path
// short-circuits on `typeof vxApi !== 'undefined'` before it evaluates any
// other global.
//
// That is a behaviour change, though — a beneficial one, but not something to
// smuggle into a refactor whose whole claim is that nothing moved but text. It
// is recorded here as its own decision to make.

// Catches uncaught exceptions and unhandled promise rejections. Surfaces a
// non-blocking toast to the user and POSTs to /telemetry/error so the team
// can diagnose production issues. Rate-limited to avoid toast spam if
// something throws in a tight loop.
var _vxErrorCount = 0;
var _vxLastErrorAt = 0;
var _vxErrorWindow = 60 * 1000;    // 1 minute
var _vxErrorMaxPerWindow = 3;

function vxReportError(err, context) {
  const now = Date.now();
  if(now - _vxLastErrorAt > _vxErrorWindow) _vxErrorCount = 0;
  _vxLastErrorAt = now;
  _vxErrorCount++;

  // Always log to console so devs see it
  console.error('[vx]', context || 'error', err);

  // Toast at most N times per minute — don't bury the user
  if(_vxErrorCount <= _vxErrorMaxPerWindow) {
    const msg = (err && (err.message || err.toString())) || 'Unknown error';
    // Use the existing toast infra if available; fall back to console
    if(typeof toast === 'function') {
      toast(tf('toast.something_wrong','Something went wrong: {msg}', {msg: msg.slice(0, 90)}), 'error');
    }
  }

  // Fire-and-forget telemetry to the backend (no await — must not throw)
  if(typeof vxApi !== 'undefined' && vxApi.request && vxIsAuthenticated && vxIsAuthenticated()) {
    try {
      vxApi.request('/telemetry/error', {
        method: 'POST',
        body: {
          message:   String(err?.message || err || 'unknown').slice(0, 500),
          stack:     String(err?.stack || '').slice(0, 2000),
          context:   String(context || '').slice(0, 200),
          url:       location.href,
          userAgent: navigator.userAgent.slice(0, 200),
          at:        new Date().toISOString(),
        },
      }).catch(() => {});   // Never re-throw from the error handler
    } catch(e){}
  }
}

// Capture sync errors (script errors, resource errors)
window.addEventListener('error', (e) => {
  // Resource load failures (e.g. cdnjs offline) come through here without
  // an Error object — handle separately
  if(e.error) vxReportError(e.error, 'window.error');
  else if(e.target && e.target.tagName) vxReportError(new Error('Resource load failed: ' + e.target.tagName + ' ' + (e.target.src || e.target.href || '')), 'resource');
}, true);

// Capture promise rejections that nothing else handled
window.addEventListener('unhandledrejection', (e) => {
  vxReportError(e.reason instanceof Error ? e.reason : new Error(String(e.reason)), 'unhandledrejection');
});
