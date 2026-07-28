// ESLint flat config — static analysis for the Veritix app + dev tooling.
//
// The app is intentionally NOT a module bundle: js/*.js are plain <script>
// files that share a large set of cross-file globals (showSS, ls, KEYS,
// vxEmailCompose, …). ESLint can't resolve those across files, so `no-undef`
// would be pure noise and is disabled for js/. The remaining recommended
// rules still catch the bugs that actually bite: duplicate object keys,
// unreachable code, redeclarations, bad comparisons, etc.
import js from '@eslint/js';
import globals from 'globals';

export default [
  // The shipped app (browser scripts, shared globals).
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
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
  // Not linted here: deps, Deno edge functions (different runtime/globals),
  // verify output, and vendored minified libraries — qrcode.min.js is
  // third-party build output, so its lint findings are unactionable noise.
  // tools/symbols.mjs skips it for the same reason.
  { ignores: ['node_modules/', 'supabase/', '.verify-out/', 'tools/lib/', 'js/qrcode.min.js'] },
];
