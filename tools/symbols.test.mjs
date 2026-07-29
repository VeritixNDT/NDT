// Tests for the cross-file globals analyser.
//
// A checker that silently reports nothing is worse than no checker, so these
// guard against symbols.mjs degrading into a no-op. Fixtures live in
// __fixtures__/ and deliberately contain the bugs the tool must catch.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse, manifest } from './symbols.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const names = (rows) => rows.map((r) => r.name).sort();

test('reports a reference to a name declared in no file as an undefined global', async () => {
  const r = await analyse({ dir: FIXTURES });
  assert.deepEqual(names(r.undefinedGlobals), ['fixtureHelpr']);
});

test('reports an assignment to an undeclared name as an implicit global', async () => {
  const r = await analyse({ dir: FIXTURES });
  assert.deepEqual(names(r.implicitGlobals), ['fixtureImplicitTarget']);
});

test('treats a global published via window.X as declared', async () => {
  const r = await analyse({ dir: FIXTURES });
  assert.equal(names(r.undefinedGlobals).includes('fixtureWindowGlobal'), false);
});

test('reports a global that no file references as an orphan', async () => {
  const r = await analyse({ dir: FIXTURES });
  assert.ok(names(r.orphans).includes('fixtureConsume'), 'unreferenced global was not reported');
});

test('does not report a global referenced from another file as an orphan', async () => {
  const r = await analyse({ dir: FIXTURES });
  assert.equal(names(r.orphans).includes('fixtureHelper'), false);
});

test('does not report a cross-file reference or a browser global', async () => {
  const r = await analyse({ dir: FIXTURES });
  const flagged = [...names(r.undefinedGlobals), ...names(r.implicitGlobals)];
  assert.equal(flagged.includes('fixtureHelper'), false, 'cross-file reference was flagged');
  assert.equal(flagged.includes('document'), false, 'browser global was flagged');
});

test('emits every declared global into the manifest as writable', async () => {
  const r = await analyse({ dir: FIXTURES });
  const m = manifest(r.declared);
  assert.equal(m.fixtureHelper, 'writable');
  assert.equal(m.fixtureWindowGlobal, 'writable', 'window.X globals missing from manifest');
});

test('emits manifest keys sorted, for a stable diff', async () => {
  const r = await analyse({ dir: FIXTURES });
  const keys = Object.keys(manifest(r.declared));
  assert.deepEqual(keys, [...keys].sort());
});

test('analyses a file containing an arrow function passed to a call', async () => {
  const r = await analyse({ dir: FIXTURES });
  assert.ok(r.files.includes('arrow.js'));
});

test('does not report ECMAScript built-ins as undefined globals', async () => {
  const r = await analyse({ dir: FIXTURES });
  const flagged = names(r.undefinedGlobals);
  for (const builtin of ['Math', 'Number', 'JSON', 'Object']) {
    assert.equal(flagged.includes(builtin), false, `built-in ${builtin} was flagged`);
  }
});

test('does not report a name used only in a typeof feature-detection guard', async () => {
  const r = await analyse({ dir: FIXTURES });
  assert.equal(names(r.undefinedGlobals).includes('fixtureOptionalThing'), false);
});

test('includes externally-provided globals in the manifest', async () => {
  const r = await analyse({ dir: FIXTURES });
  const m = manifest(r.declared);
  // CDN/vendored libs are real globals at runtime but declared in no js/ file.
  // ESLint needs them or no-undef flags every use; keeping the list in one
  // place stops the analyser and eslint.config.js drifting apart.
  for (const name of ['L', 'pdfjsLib', 'QRCode']) {
    assert.equal(m[name], 'writable', `external ${name} missing from manifest`);
  }
});

test('a registered dispatch handler is not an orphan', async () => {
  const r = await analyse({ dir: FIXTURES });
  // Its vxActions({ … }) registration is a real reference, so this needs no
  // special-casing of data-action markup — scope analysis simply sees it.
  assert.equal(names(r.orphans).includes('fixtureDispatchTarget'), false,
    'a registered handler was reported dead — deleting it would break the UI');
});
