// V48 verification: per-report sync rows + atomic numbering.
// Boots the real app (offline, via verify.mjs) and exercises the actual loaded
// functions — no logic is re-implemented here. Run: node tools/verify-numbering.mjs
import { withApp } from './verify.mjs';

let failures = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + JSON.stringify(detail)}`);
}

await withApp(async (page, app) => {
  // ── 0. App booted with all V48 changes and no page errors ────────────────
  // The harness deliberately blocks the Supabase/jsDelivr CDN to boot offline,
  // which logs a benign "Failed to load resource" — ignore those; only real JS
  // exceptions / console errors matter.
  const realErrors = app.errors.filter((e) => !/Failed to load resource|ERR_FAILED|net::|bad HTTP response code|fetching the script/.test(e));
  check('app boots without JS errors', realErrors.length === 0, realErrors.slice(0, 5));

  // ── 1. Pure helpers ──────────────────────────────────────────────────────
  const h = await page.evaluate(() => {
    const yr = new Date().getFullYear();
    return {
      fmt: vxFormatReportNo(7, 'MT', { numPrefix: 'SV', numSep: '-', numYear: '4', numDigits: '5', numMethodPos: 'after-prefix' }),
      expect: 'SV-MT-' + yr + '-00007',
      id1: vxNewId(), id2: vxNewId(),
      keyId: _vxReportKey({ id: 'abc' }),
      keyNo: _vxReportKey({ reportNo: 'SV-1', revision: '00' }),
    };
  });
  check('vxFormatReportNo formats with method + padding', h.fmt === h.expect, h);
  check('vxNewId returns distinct ids', h.id1 !== h.id2 && /[0-9a-f-]{8,}/.test(h.id1), h);
  check('_vxReportKey prefers id', h.keyId === 'abc', h);
  check('_vxReportKey falls back to reportNo::revision', h.keyNo === 'SV-1::00', h);

  // ── 2. Trial-mode (unauthenticated) local numbering still works ──────────
  const local = await page.evaluate(() => {
    const s = ls('vx-settings-v1', {}); s.numNext = 5; s.numPrefix = 'SV'; s.numSep = '-'; s.numYear = '4'; s.numDigits = '3'; s.numMethodPos = 'none';
    lss('vx-settings-v1', s);
    const no1 = _ovAllocLocalReportNo({ method: 'MT' });
    const after1 = ls('vx-settings-v1', {}).numNext;
    const no2 = _ovAllocLocalReportNo({ method: 'MT' });
    const after2 = ls('vx-settings-v1', {}).numNext;
    return { no1, after1, no2, after2 };
  });
  check('trial local numbering uses + bumps the counter', local.after1 === 6 && local.after2 === 7, local);
  check('trial local numbers are sequential', /-005$/.test(local.no1) && /-006$/.test(local.no2), local);

  // ── 3. vxAllocReportNo returns null offline (→ caller keeps it a Draft) ──
  const offlineAlloc = await page.evaluate(async () => {
    const _auth = window.vxIsAuthenticated; const _sb = window._vxSupabase;
    vxIsAuthenticated = () => true; _vxSupabase = () => null;   // authed but no cloud reachable
    const r = { id: 'rep-x', method: 'MT' };
    const res = await vxAllocReportNo(r);
    vxIsAuthenticated = _auth; _vxSupabase = _sb;
    return { res, reportNo: r.reportNo };
  });
  check('vxAllocReportNo returns null when cloud unreachable', offlineAlloc.res === null && !offlineAlloc.reportNo, offlineAlloc);

  // ── 4. THE FIX: two devices saving DIFFERENT reports — neither clobbers ──
  const merge = await page.evaluate(async () => {
    // Fake server-side entities store + vxApi, mark authenticated.
    window.__store = {};
    const _auth = window.vxIsAuthenticated, _cfg = window.vxPlatformConfig;
    window.vxIsAuthenticated = () => true;
    window.vxPlatformConfig = () => ({ orgId: 'org-test', userId: 'me' });
    vxApi.upsertEntity = async (key, val) => { window.__store[key] = JSON.parse(JSON.stringify(val)); return { ok: true }; };
    vxApi.deleteEntity = async (key) => { delete window.__store[key]; return { ok: true }; };
    vxApi.hydrateReports = async () => { const m = {}; Object.keys(window.__store).forEach(k => { if (k.indexOf('vx-report::') === 0) m[k.slice('vx-report::'.length)] = window.__store[k]; }); return m; };
    vxApi.hydrateReportHtml = async () => { const m = {}; Object.keys(window.__store).forEach(k => { if (k.indexOf('vx-report-html::') === 0) m[k.slice('vx-report-html::'.length)] = window.__store[k]; }); return m; };
    // Clean slate
    ['vx-dirty-flags-v1', 'vx-sync-queue-v1', 'vx-rpt-meta-sig-v1', 'vx-rpt-html-sig-v1'].forEach(k => localStorage.removeItem(k));
    _vxRawLss('vx-reports-v1', []);

    // Device 1 saves report A, flushes to the (fake) server.
    const A = { id: 'rep-A', method: 'MT', reportNo: 'SV-A', revision: '00', stage: 'Submitted', client: 'X' };
    lss('vx-reports-v1', [A]);
    await vxSyncFlush();
    const wroteA = Object.keys(window.__store).slice();
    const blobOnServer = !!window.__store['vx-reports-v1'];

    // Another device already wrote report B straight to the server.
    window.__store['vx-report::rep-B'] = { id: 'rep-B', method: 'UT', reportNo: 'SV-B', revision: '00', stage: 'Submitted', client: 'Y' };

    // Device 1 pulls — MUST merge (keep A, gain B), never blob-replace.
    await vxPullReports();
    const after = ls('vx-reports-v1', []).map(r => r.id).sort();

    window.vxIsAuthenticated = _auth; window.vxPlatformConfig = _cfg;
    return { wroteA, blobOnServer, after };
  });
  check('report A synced as its own per-report row', merge.wroteA.includes('vx-report::rep-A'), merge);
  check('reports no longer sync as one blob', merge.blobOnServer === false, merge);
  check('PULL MERGES — both A and B survive (no clobber)', merge.after.length === 2 && merge.after[0] === 'rep-A' && merge.after[1] === 'rep-B', merge);

  // ── 5. Dirty (unpushed) local edit wins over server on pull ─────────────
  const dirty = await page.evaluate(async () => {
    window.__store = {};
    const _auth = window.vxIsAuthenticated, _cfg = window.vxPlatformConfig;
    window.vxIsAuthenticated = () => true;
    window.vxPlatformConfig = () => ({ orgId: 'org-test', userId: 'me' });
    vxApi.hydrateReports = async () => ({ 'rep-A': { id: 'rep-A', reportNo: 'SV-A', revision: '00', client: 'SERVER' } });
    vxApi.hydrateReportHtml = async () => ({});
    ['vx-dirty-flags-v1', 'vx-rpt-meta-sig-v1', 'vx-rpt-html-sig-v1'].forEach(k => localStorage.removeItem(k));
    _vxRawLss('vx-reports-v1', [{ id: 'rep-A', reportNo: 'SV-A', revision: '00', client: 'LOCAL-EDIT' }]);
    _vxMarkDirty('vx-report::rep-A');   // unpushed local edit
    await vxPullReports();
    const client = (ls('vx-reports-v1', [])[0] || {}).client;
    window.vxIsAuthenticated = _auth; window.vxPlatformConfig = _cfg;
    return { client };
  });
  check('dirty local edit is NOT overwritten by server on pull', dirty.client === 'LOCAL-EDIT', dirty);
}, {});

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
