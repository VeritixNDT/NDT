// Whole-program cross-file globals analyser.
// See docs/superpowers/specs/2026-07-28-globals-safety-net-design.md
//
// js/*.js are plain <script> files sharing one global namespace, so ESLint
// cannot resolve names across them and no-undef is off. This does the analysis
// ESLint structurally can't: parse every file, collect the references that
// escape each file's scope, and resolve them against the union of all files'
// declarations.
import fs from 'node:fs';
import path from 'node:path';
import * as espree from 'espree';
import { analyze as analyzeScope } from 'eslint-scope';
import globals from 'globals';

// `range` is required, not cosmetic: eslint-scope reads node.range while
// resolving references inside arrow functions and throws without it.
const PARSE = { ecmaVersion: 2023, sourceType: 'script', loc: true, range: true };

// Names provided by something other than js/*.js. Each entry names its source
// so this list can be audited rather than accumulating mystery entries.
const EXTERNAL = new Set([
  'L',              // Leaflet — CDN loader in the HTML shell
  'supabase',       // @supabase/supabase-js UMD bundle
  'pdfjsLib',       // pdf.js — CDN loader in the HTML shell
  'QRCode',         // js/qrcode.min.js (bundled locally, minified)
  '_leafletReady',  // set by the Leaflet loader in the HTML shell
]);

// globals.browser is DOM/window APIs only — it has no Math, Object or Promise.
// The language built-ins come from globals.es2023, matching PARSE.ecmaVersion.
const AMBIENT = new Set([
  ...Object.keys(globals.es2023),
  ...Object.keys(globals.browser),
]);

// js/ui.js dispatches UI handlers by NAME — `const fn = window[action]` — so a
// function wired as data-action="foo" has no direct reference anywhere and
// looks dead to scope analysis. 410 of the app's 485 raw orphans were exactly
// this; without this the orphan report is 85% false positives and unusable.
const DISPATCH_ATTR = /data-(?:action|on-change|on-input)\s*=\s*\\?["'`]?\s*([A-Za-z_$][\w$]*)/g;
function dispatchTargets(source) {
  const names = [];
  for (const m of source.matchAll(DISPATCH_ATTR)) names.push(m[1]);
  return names;
}

// Minimal ESTree walk. `loc`/`range` are skipped so the visitor only ever sees
// real nodes.
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return; }
  if (typeof node.type === 'string') visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'parent') continue;
    walk(node[key], visit);
  }
}

// `window.foo = …` publishes a global without declaring a variable, so
// eslint-scope sees only a member assignment. The app does this 18 times;
// without collecting them every consumer would be a false positive.
function windowAssignments(ast, file) {
  const found = [];
  walk(ast, (node) => {
    const left = node.type === 'AssignmentExpression' ? node.left : null;
    if (left?.type === 'MemberExpression' && !left.computed
        && left.object.type === 'Identifier' && left.object.name === 'window'
        && left.property.type === 'Identifier') {
      found.push({ name: left.property.name, file, line: left.property.loc?.start.line ?? 0 });
    }
  });
  return found;
}

// Parse one file and return its top-level declarations plus the references
// that escape it. Escaping references are what no-undef checks per file; the
// caller resolves them against every other file's declarations.
function scanFile(file, source) {
  const ast = espree.parse(source, PARSE);
  const scope = analyzeScope(ast, { ecmaVersion: PARSE.ecmaVersion, sourceType: 'script' });
  const global = scope.globalScope;

  const declared = global.variables
    .filter((v) => v.defs.length > 0)
    .map((v) => ({
      name: v.name,
      file,
      line: v.defs[0].node.loc?.start.line ?? 0,
    }))
    .concat(windowAssignments(ast, file));

  // `typeof X` on an undeclared name is legal feature detection, not a bug, and
  // ESLint's no-undef skips it by default. The app leans on the
  // `typeof fn === 'function' && fn()` idiom, where the CALL is the real signal.
  const typeofGuarded = new Set();
  walk(ast, (node) => {
    if (node.type === 'UnaryExpression' && node.operator === 'typeof'
        && node.argument.type === 'Identifier') typeofGuarded.add(node.argument);
  });

  const escaping = global.through
    .filter((ref) => !typeofGuarded.has(ref.identifier))
    .map((ref) => ({
      name: ref.identifier.name,
      file,
      line: ref.identifier.loc?.start.line ?? 0,
      write: ref.isWrite(),
    }));

  // Reads of this file's own globals resolve locally, so they never appear in
  // `through`. Orphan detection needs them or every self-contained helper would
  // look dead.
  const readLocally = global.variables
    .filter((v) => v.references.some((r) => r.isRead()))
    .map((v) => v.name);

  return { declared, escaping, readLocally };
}

// `shell` is the app's HTML entry point, which wires handlers with data-action
// too — omit it and every handler declared only there looks dead.
export async function analyse({ dir, shell = null }) {
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js') && f !== 'qrcode.min.js')
    .sort();

  const declared = new Map();   // name -> {name, file, line}
  const escaping = [];
  const used = new Set();

  for (const f of files) {
    const source = fs.readFileSync(path.join(dir, f), 'utf8');
    const scan = scanFile(f, source);
    for (const d of scan.declared) if (!declared.has(d.name)) declared.set(d.name, d);
    escaping.push(...scan.escaping);
    for (const r of scan.escaping) used.add(r.name);
    for (const n of scan.readLocally) used.add(n);
    for (const n of dispatchTargets(source)) used.add(n);
  }
  if (shell && fs.existsSync(shell)) {
    for (const n of dispatchTargets(fs.readFileSync(shell, 'utf8'))) used.add(n);
  }

  const known = (name) => declared.has(name) || AMBIENT.has(name) || EXTERNAL.has(name);

  // A write to an undeclared name is an implicit global — a hard throw under
  // module strict mode. A read of one is a plain undefined global. Splitting
  // them keeps the strict-mode signal separate from the broken-call-path signal.
  const undefinedGlobals = escaping.filter((r) => !known(r.name) && !r.write);
  const implicitGlobals = escaping.filter((r) => !known(r.name) && r.write);

  // Declared but read by nobody, in any file. The whole-program replacement for
  // no-unused-vars, which per-file can only see that a shared helper looks dead.
  const orphans = [...declared.values()].filter((d) => !used.has(d.name));

  return { declared, undefinedGlobals, implicitGlobals, orphans, files };
}

// ESLint's `globals` shape. `writable` rather than `readonly` because the app
// reassigns globals in places, and `readonly` would fire no-global-assign
// across the codebase. Keys are sorted so the committed file diffs cleanly.
//
// EXTERNAL is folded in: those names exist at runtime but are declared in no
// js/ file, so ESLint would flag every use. Emitting them here keeps one
// source of truth — eslint.config.js never repeats the allowlist.
export function manifest(declared) {
  const out = {};
  for (const name of [...declared.keys(), ...EXTERNAL].sort()) out[name] = 'writable';
  return out;
}

// ── CLI ───────────────────────────────────────────────────────────────────
// node tools/symbols.mjs           report only
// node tools/symbols.mjs --write   also write the ESLint globals manifest
const MANIFEST = 'tools/globals.generated.json';

function report(title, rows, { detail = true } = {}) {
  console.log(`\n${title}: ${rows.length}`);
  if (!detail) return;
  for (const r of rows.slice(0, 40)) console.log(`  js/${r.file}:${r.line}  ${r.name}`);
  if (rows.length > 40) console.log(`  … and ${rows.length - 40} more`);
}

if (import.meta.filename === process.argv[1]) {
  const r = await analyse({ dir: 'js', shell: 'veritix-ndt-inspect-v3_44.html' });
  console.log(`Scanned ${r.files.length} files · ${r.declared.size} declared globals`);

  report('UNDEFINED GLOBALS (referenced, declared nowhere)', r.undefinedGlobals);
  report('IMPLICIT GLOBALS (assigned without declaration)', r.implicitGlobals);
  report('ORPHANS (declared, referenced by no file and not string-dispatched)', r.orphans);

  if (process.argv.includes('--write')) {
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest(r.declared), null, 2) + '\n');
    console.log(`\nWrote ${MANIFEST}`);
  }
  process.exit(r.undefinedGlobals.length ? 1 : 0);
}
