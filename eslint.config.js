// ESLint flat config — static analysis for the Veritix app + dev tooling.
//
// The app is intentionally NOT a module bundle: js/*.js are plain <script>
// files sharing a large set of cross-file globals (showSS, ls, KEYS,
// vxEmailCompose, …). ESLint resolves names per file, so it cannot see those
// on its own — which is why `no-undef` was off, and why a typo'd global used
// to fail only when a user clicked the control that called it.
//
// tools/symbols.mjs now parses every js/*.js and writes the real declared
// surface to globals.generated.json, which is fed in below so `no-undef` works
// again. `npm run lint` regenerates it first, so it cannot go stale, and lints
// js/ and tools/ alike.
// See docs/superpowers/specs/2026-07-28-globals-safety-net-design.md
import fs from 'node:fs';
import js from '@eslint/js';
import globals from 'globals';

let appGlobals;
try {
  appGlobals = JSON.parse(fs.readFileSync(new URL('./tools/globals.generated.json', import.meta.url), 'utf8'));
} catch {
  throw new Error(
    'tools/globals.generated.json is missing or unreadable.\n' +
    'Regenerate it with:  node tools/symbols.mjs --write   (or just `npm run lint`)',
  );
}

export default [
  // The shipped app (browser scripts, shared globals).
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, ...appGlobals },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Works now that appGlobals describes the real cross-file surface.
      'no-undef': 'error',
      // REQUIRED alongside the above. no-redeclare defaults to
      // builtinGlobals: true, which counts config-supplied globals — with ~2k
      // names fed in, every file would error on its own declarations.
      'no-redeclare': ['error', { builtinGlobals: false }],
      // `vars: 'local'` scopes the unused check to locals. Without it, every
      // function declared in one file and used in another looks dead (that was
      // 801 false warnings). The whole-program case is covered properly by
      // tools/symbols.mjs's orphan report.
      // caughtErrors: 'none' — ESLint 9 flipped this default to 'all', which
      // flagged 290 `catch(e){}` bindings. The defensive empty catch is already
      // an accepted idiom here (see no-empty's allowEmptyCatch below); this
      // keeps the two rules consistent instead of half-warning about it.
      'no-unused-vars': ['warn', { args: 'none', vars: 'local', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['warn', { checkLoops: false }],
    },
  },
  // Dev tooling (Node ES modules).
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { ...js.configs.recommended.rules },
  },
  // The Playwright harnesses are Node modules that CONTAIN browser code: the
  // callbacks passed to page.evaluate() are serialised and executed in the
  // page, against the running app. So they legitimately reference browser
  // globals (window, document) and app globals (vxApi, ls, CURRENT_USER, …) —
  // 65 no-undef errors that were never surfaced because lint only covered js/.
  //
  // Scoped to these files, not all of tools/: serve.mjs and symbols.mjs are
  // pure Node and stay strict, so a stray `document` in them is still an error.
  // The cost here is that a genuine misuse of a browser global in these files'
  // Node halves won't be caught — ESLint can't tell a page.evaluate callback
  // from its surrounding module, and having the app's real surface checked
  // inside those callbacks is worth more than that.
  {
    files: ['tools/verify.mjs', 'tools/verify-numbering.mjs', 'tools/verify.test.mjs'],
    languageOptions: {
      globals: { ...globals.browser, ...appGlobals },
    },
    rules: {
      // Same defensive-catch idiom as the app; these callbacks are app code.
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  // Not linted here: deps, Deno edge functions (different runtime/globals),
  // verify output, and vendored minified libraries — qrcode.min.js is
  // third-party build output, so its lint findings are unactionable noise.
  // tools/symbols.mjs skips it for the same reason.
  { ignores: ['node_modules/', 'supabase/', '.verify-out/', 'tools/lib/', 'js/qrcode.min.js'] },
];
