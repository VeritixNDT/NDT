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
// LOAD POSITION — THIS FILE MUST LOAD FIRST. It is the first script tag in the
// shell, ahead of even the vendored qrcode bundle.
//
// The twelfth slice left it eighth, immediately after platform.js, so that the
// split could not change when the listeners attach. Right for a refactor, wrong
// as a resting place: seven files executed before the handler existed (qrcode,
// constants, acceptance, utils, a11y, i18n, storage) and a throw or failed load
// in any of them was caught by nothing. The supabase.js failure in the tenth
// slice was only visible BECAUSE supabase.js happens to load later.
//
// What moving it buys, precisely. Deferred scripts execute in document order
// once parsing completes, and a script whose FETCH failed fires its error event
// at its turn in that same ordered sequence rather than whenever the network
// gave up. So position in the tag list — not fetch timing — decides coverage,
// and being first means every other app script is covered for both a throw
// during execution and a failed load. Asserted rather than assumed:
// tools/verify.test.mjs blocks js/qrcode.min.js, the very next tag, and requires
// the handler to have reported it.
//
// Running before everything is safe because every global vxReportError touches
// is either guarded or short-circuits:
//   - the toast path is behind `typeof toast === 'function'`, and toast lives in
//     ui.js which loads after i18n.js, so tf() exists whenever toast does;
//   - the telemetry path stops at `typeof vxApi !== 'undefined'` before it
//     evaluates vxIsAuthenticated, and api.js loads after platform.js, so vxApi
//     existing implies vxIsAuthenticated does too.
// An error raised before either exists still reaches console.error, which is the
// floor this is meant to guarantee.

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
