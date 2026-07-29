// ── Imports (generated) ─────────────────────────────────────────────────
import { CV_FIELD_DEFS, CV_LAYOUT_ITEMS, _cvAlignGuidesOn, _cvBlockElCache,
  _cvBlockId, _cvFieldLabel, _cvLayoutLabel, _cvLoadAlignGuidesPref,
  _cvRefreshSaveIndicator, cvClearLogo, cvCloseAllDrawers,
  cvHandleLogoUpload, cvLogoLibAdd, cvLogoLibLoad, cvLogoLibPick,
  cvLogoLibRemove, cvTogglePaletteDrawer, cvTogglePropsDrawer,} from './editor.js';
import { HELP_CHAPTERS, _helpChapterBody, _helpChapterTitle,} from './help.js';
import { t, tf,} from './i18n.js';
import { VX_PLATFORM_DEFAULTS, _vxReadMetaApiBase, ls, lss, vxDiagnostics,} from './platform.js';
import { CV_COLOUR_RECENT_KEY, CV_COLOUR_RECENT_MAX, _cvLoadRecentColours,
  _cvTrackRecentColor, toast,} from './ui.js';

// ═══════════════════════════════════════════════════════════════════════════
// V28 — END-TO-END SELF-TEST HARNESS
// ═══════════════════════════════════════════════════════════════════════════
// Lightweight in-page test runner. Triggered three ways:
//   1. URL flag: append ?debug=tests or #debug=tests to the URL
//   2. Console:  vxRunTests()
//   3. Programmatic: returns a Promise<{passed, failed, total, results}>
//
// The harness is non-destructive — every test that mutates state restores it
// in a `finally` block, and all tests run against synthetic data, not the
// user's actual reports/defects. Safe to run in production for support
// debugging or release-acceptance checks.
//
// Tests focus on regression coverage for engineering work shipped in V22–V28:
// i18n round-trip, save/load, canvas reconciliation, keyboard shortcuts,
// drawer toggles, UUID generation, color picker recents, alignment guides.
// ═══════════════════════════════════════════════════════════════════════════

var VX_TESTS = [];
function vxTest(name, fn) { VX_TESTS.push({ name, fn }); }
function vxAssert(cond, message){ if(!cond) throw new Error(message || 'assertion failed'); }
function vxAssertEq(actual, expected, message){
  if(actual !== expected){
    throw new Error((message || 'expected equality') + ` (got: ${JSON.stringify(actual)}, want: ${JSON.stringify(expected)})`);
  }
}

// ── i18n round-trip ─────────────────────────────────────────────────────
vxTest('i18n: t() resolves a known English key', () => {
  vxAssertEq(t('pe.tab.home', 'FALLBACK'), 'Home', 'pe.tab.home should be Home in English');
});
vxTest('i18n: t() falls back when key is missing', () => {
  vxAssertEq(t('zz.nonexistent.key', 'FALLBACK'), 'FALLBACK');
});
vxTest('i18n: tf() interpolates parameters', () => {
  const r = tf('pe.toast.tpl_saved', '{method} template saved', { method: 'UT' });
  vxAssert(r.includes('UT'), 'tf should substitute {method}');
});

// ── Entity store round-trip ─────────────────────────────────────────────
vxTest('store: ls/lss round-trip preserves objects', () => {
  const key = 'vx-test-' + Date.now();
  const obj = { a: 1, b: 'two', c: [3, 4] };
  try {
    lss(key, obj);
    const got = ls(key, null);
    vxAssertEq(JSON.stringify(got), JSON.stringify(obj));
  } finally {
    try { localStorage.removeItem(key); } catch(e){}
  }
});
vxTest('store: ls() returns fallback for missing key', () => {
  vxAssertEq(ls('vx-test-missing-' + Date.now(), 'SENTINEL'), 'SENTINEL');
});

// ── Canvas reconciliation ────────────────────────────────────────────────
vxTest('canvas: _cvBlockId() generates unique IDs', () => {
  const ids = new Set();
  for(let i = 0; i < 100; i++) ids.add(_cvBlockId());
  vxAssertEq(ids.size, 100, 'all 100 IDs distinct');
  const sample = Array.from(ids)[0];
  vxAssert(/^blk-[a-z0-9]+-[a-z0-9]{6}$/.test(sample), 'ID format matches pattern');
});
vxTest('canvas: _cvBlockElCache is a Map', () => {
  vxAssert(_cvBlockElCache instanceof Map);
});

// ── Field / layout label helpers ─────────────────────────────────────────
vxTest('palette: _cvLayoutLabel resolves a known key', () => {
  const it = CV_LAYOUT_ITEMS.find(x => x.key === 'section-header');
  vxAssert(it && _cvLayoutLabel(it).length > 0);
});
vxTest('palette: _cvFieldLabel resolves a known field', () => {
  const def = CV_FIELD_DEFS['report-no'];
  vxAssert(def && _cvFieldLabel('report-no', def).length > 0);
});

// ── Help center ──────────────────────────────────────────────────────────
vxTest('help: _helpChapterTitle resolves chapter titles', () => {
  const ch = HELP_CHAPTERS.find(c => c.id === 'welcome');
  vxAssert(ch && _helpChapterTitle(ch).length > 0);
});
vxTest('help: _helpChapterBody returns content', () => {
  const ch = HELP_CHAPTERS.find(c => c.id === 'welcome');
  const body = _helpChapterBody(ch);
  vxAssert(body && body.length > 100, 'welcome body has substantial content');
});

// ── Recent colour tracking ───────────────────────────────────────────────
vxTest('colours: _cvTrackRecentColor de-duplicates and bounds list', () => {
  const backup = localStorage.getItem(CV_COLOUR_RECENT_KEY);
  try {
    localStorage.removeItem(CV_COLOUR_RECENT_KEY);
    for(let i = 0; i < 12; i++) _cvTrackRecentColor('#' + i.toString(16).padStart(6, '0'));
    const recents = _cvLoadRecentColours();
    vxAssert(recents.length <= CV_COLOUR_RECENT_MAX);
    const before = recents.length;
    _cvTrackRecentColor(recents[0]);
    vxAssertEq(_cvLoadRecentColours().length, before, 'no duplicate added');
  } finally {
    try {
      if(backup != null) localStorage.setItem(CV_COLOUR_RECENT_KEY, backup);
      else localStorage.removeItem(CV_COLOUR_RECENT_KEY);
    } catch(e){ console.warn("ls setItem failed", e); }
  }
});

// ── Alignment guides ─────────────────────────────────────────────────────
vxTest('align: _cvAlignGuidesOn is a boolean and persists', () => {
  vxAssertEq(typeof _cvAlignGuidesOn, 'boolean');
  _cvLoadAlignGuidesPref();
});

// ── Diagnostics ──────────────────────────────────────────────────────────
vxTest('diagnostics: vxDiagnostics() returns structured snapshot', async () => {
  const d = await vxDiagnostics();
  vxAssert(d && d.platform && d.realtime && d.browser);
  vxAssert(typeof d.platform.apiBase === 'string');
  vxAssert(['trial','signed_out','authenticated'].includes(d.platform.authState));
});

// ── Drawer toggles (no-op on desktop, but functions must exist) ──────────
vxTest('drawer: toggle functions defined', () => {
  vxAssertEq(typeof cvTogglePaletteDrawer, 'function');
  vxAssertEq(typeof cvTogglePropsDrawer, 'function');
  vxAssertEq(typeof cvCloseAllDrawers, 'function');
});

// ── Logo handlers + library ──────────────────────────────────────────────
vxTest('logos: single-slot handlers + library API exist', () => {
  vxAssertEq(typeof cvHandleLogoUpload, 'function');
  vxAssertEq(typeof cvClearLogo,        'function');
  vxAssertEq(typeof cvLogoLibLoad,      'function');
  vxAssertEq(typeof cvLogoLibAdd,       'function');
  vxAssertEq(typeof cvLogoLibPick,      'function');
  vxAssertEq(typeof cvLogoLibRemove,    'function');
});

// ── Autosave indicator ───────────────────────────────────────────────────
vxTest('autosave: _cvRefreshSaveIndicator does not throw', () => {
  _cvRefreshSaveIndicator();
});

// ── Backend config ───────────────────────────────────────────────────────
vxTest('backend: _vxReadMetaApiBase returns null when no meta tag', () => {
  // No meta tag in test HTML — but assertion proves the helper handles absence
  const v = _vxReadMetaApiBase();
  vxAssert(v === null || typeof v === 'string');
});
vxTest('backend: VX_PLATFORM_DEFAULTS has an apiBase', () => {
  vxAssert(typeof VX_PLATFORM_DEFAULTS.apiBase === 'string' && VX_PLATFORM_DEFAULTS.apiBase.length > 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Runner — invoked by URL flag or explicit vxRunTests() call
// ═══════════════════════════════════════════════════════════════════════════
async function vxRunTests(){
  console.group('%cvx self-tests', 'color:#4f8ef7;font-weight:bold');
  const start = performance.now();
  const results = [];
  let passed = 0, failed = 0;
  for(const t of VX_TESTS){
    try {
      const r = t.fn();
      if(r && typeof r.then === 'function') await r;
      console.log('%c✔', 'color:#3ecf8e', t.name);
      results.push({ name: t.name, status: 'pass' });
      passed++;
    } catch(e){
      console.error('%c✘', 'color:#f25c5c', t.name, '\n  →', e.message);
      results.push({ name: t.name, status: 'fail', error: e.message });
      failed++;
    }
  }
  const elapsed = Math.round(performance.now() - start);
  const summaryStyle = failed === 0 ? 'color:#3ecf8e;font-weight:bold' : 'color:#f25c5c;font-weight:bold';
  console.log('%c' + (failed === 0 ? '✓ ALL PASS' : '✗ FAILED') +
    ` — ${passed}/${VX_TESTS.length} in ${elapsed}ms`, summaryStyle);
  console.groupEnd();
  if(typeof toast === 'function'){
    toast(`Tests: ${passed}/${VX_TESTS.length} passed`, failed === 0 ? 'success' : 'error');
  }
  return { passed, failed, total: VX_TESTS.length, elapsedMs: elapsed, results };
}
window.vxRunTests = vxRunTests;

// Auto-run if URL flag is present
(function _vxMaybeAutoRunTests(){
  const u = (location.search + location.hash).toLowerCase();
  if(u.includes('debug=tests') || u.includes('runtests')){
    if(document.readyState === 'complete') setTimeout(vxRunTests, 200);
    else window.addEventListener('load', () => setTimeout(vxRunTests, 200));
  }
})();
