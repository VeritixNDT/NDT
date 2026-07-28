// Sweep every page and settings subsection, asserting each one renders.
//
// This is the app-level regression net: `npm run lint` proves the code
// resolves, this proves it actually draws. Runs in ONE browser against ONE
// server, switching targets in place — launching a browser per target took
// ~90s for 30 targets.
//
// CLI:  node tools/verify-all.mjs [--shots <dir>]
// Exit: 0 if every target rendered, 1 otherwise (with the failures listed).
import fs from 'node:fs';
import path from 'node:path';
import { openApp, gotoTarget, checkRendered, realErrors, PAGES, SETTINGS_SECTIONS } from './verify.mjs';

const args = process.argv.slice(2);
const shotsIdx = args.indexOf('--shots');
const shotsDir = shotsIdx >= 0 ? args[shotsIdx + 1] : null;

// `settings:` prefix so `billing`, which exists in both namespaces, is
// unambiguous — the bare name is swept as the top-level page.
const TARGETS = [...PAGES, ...SETTINGS_SECTIONS.map((s) => `settings:${s}`)];

const app = await openApp();
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const results = [];
for (const target of TARGETS) {
  const before = app.errors.length;
  try {
    await gotoTarget(app.page, target);
    const check = await checkRendered(app.page, app.errors.slice(before));
    results.push({ target, ...check });
    if (shotsDir) {
      await app.page.screenshot({ path: path.join(shotsDir, target.replace(':', '-') + '.png') });
    }
  } catch (e) {
    results.push({ target, ok: false, failures: [String(e.message || e)], details: {} });
  }
}
await app.close();

const pad = Math.max(...TARGETS.map((t) => t.length));
for (const r of results) {
  const els = r.details?.activeElements ?? '?';
  console.log(
    `${r.ok ? 'ok  ' : 'FAIL'}  ${r.target.padEnd(pad)}  ${String(els).padStart(5)} elements` +
    (r.ok ? '' : `\n        ${r.failures.join('\n        ')}`),
  );
}

const failed = results.filter((r) => !r.ok);
const leftover = realErrors(app.errors);
console.log(`\n${results.length - failed.length}/${results.length} targets rendered`);
if (leftover.length) console.log(`page errors seen: ${leftover.length}\n  ${leftover.slice(0, 5).join('\n  ')}`);

if (failed.length || leftover.length) {
  console.error(`\nVERIFY-ALL FAILED — ${failed.length} target(s) did not render` +
    (leftover.length ? `, ${leftover.length} page error(s)` : ''));
  process.exit(1);
}
