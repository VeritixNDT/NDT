# Cross-file globals safety net — design

**Date:** 2026-07-28
**Status:** Component 1 built (`tools/symbols.mjs`, 11 tests). Components 2–3 pending.
**Scope:** Static analysis + lint configuration. No runtime behaviour changes.

---

## Problem

`js/*.js` are 33 plain `<script defer>` files sharing one global namespace. They
declare **2,042 distinct top-level names** (1,653 of them functions, the rest
`var`/`let`/`const`), plus 18 `window.X =` assignments, and reference each other
freely — 950 cross-file name references in total.

ESLint cannot resolve names across script files, so `eslint.config.js` disables
`no-undef` for `js/`, with the comment that it "would be pure noise." That is
accurate as configured, and it is also the problem: a typo'd or renamed global
is invisible to lint, invisible at load, and fails only when a user clicks the
control that calls it.

Lint is currently at **48 errors / 801 warnings**. Almost all the warnings are
`no-unused-vars` firing on cross-file globals — a function declared in one file
and used in another looks unused. The tool already emits more noise than anyone
can act on, so a new `no-undef` error would simply join the pile unread.

This matters beyond day-to-day breakage. Converting the app to ES modules (the
real fix for the ambient namespace, tracked separately) requires knowing whether
the codebase contains implicit globals — assignments to undeclared names, which
become hard throws under module strict mode. With `no-undef` off, those are
invisible by construction. **The safety net is a prerequisite for the module
conversion, not an alternative to it.**

## Decision

Build a whole-program symbol analyser, feed its output to ESLint, and turn
`no-undef` back on. Two deliverables that share one parse:

- **A** — a generated globals manifest so ESLint's `no-undef` works, giving
  editor squiggles and a CI gate.
- **B** — a whole-program checker reporting what ESLint's per-file model
  structurally cannot see: undefined globals, orphaned globals, and implicit
  globals.

They are the same analysis with two outputs, so they ship together.

### Rejected alternatives

**ES-module conversion now.** The destination, and cheaper than first assumed:
zero duplicate names across all 2,042 globals, zero inline handlers in the HTML
shell (only 10 in generated markup), no `with` statements, and unresolved
imports fail loudly at load. Deferred for three reasons: it is atomic (the
moment one file becomes a module its globals leave `window` and every
script-mode consumer breaks — there is no file-at-a-time path); 96 top-level
executable statements across 12 files become evaluation-order sensitive, with
`ui.js` ↔ `dashboard.js` near-certainly cyclic; and the only regression net is
`tools/verify.mjs`, a smoke test that proves the app loads but says nothing
about sealing, report numbering, invoicing, portal or PDF. Landing a 33-file
atomic refactor on a live pilot behind that is the objection — not the
difficulty. Specced separately once this analyser reports.

**Per-file ESLint config blocks.** Generating one config object per file, with
`globals` set to the union minus that file's own declarations, avoids the
`no-redeclare` collision structurally. Rejected: 33 generated config objects to
buy what one rule option already handles.

## Non-goals

- No module reorganisation, no file splitting, no ES-module conversion.
- No runtime changes except the bug fixes surfaced in rollout steps 2 and 3.
- Does not address load-order coupling or the ambient namespace itself. Those
  need the module conversion.

---

## Component 1 — `tools/symbols.mjs`

Parses every `js/*.js` except the minified `qrcode.min.js` using **espree**,
then runs **eslint-scope** over each AST. Both resolve today via ESLint's own
dependency tree, as does `globals` — no new packages.

The core move is reading `globalScope.through`: the references that escape a
file without resolving locally. That is exactly what `no-undef` checks per
file; this script does it once against the union of all files' declarations,
which is the whole-program view ESLint cannot take. Real scope analysis, not
regex — locals, shadowing and nested functions are handled correctly.

Two tables are built:

- **declared** — every top-level `function` / `var` / `let` / `const` / `class`,
  plus `window.X =` assignments, each with file and line.
- **escaping references** — every unresolved name, with file and line.

Each escaping reference is then classified:

| Resolves to | Verdict |
|---|---|
| A browser global (`globals.browser`) | ok |
| A name declared in another app file | ok — the cross-file case |
| External allowlist: `L`, `supabase`, `pdfjsLib`, `QRCode`, `_leafletReady` | ok |
| Nothing | **error — undefined global** |

The allowlist covers the CDN libraries loaded by the inline script in
`veritix-ndt-inspect-v3_44.html` (Leaflet, pdf.js), the Supabase UMD bundle, the
locally bundled `js/qrcode.min.js`, and `window._leafletReady` set by the
Leaflet loader. It is deliberately short and explicit; additions get a comment
saying what provides the name.

### Outputs

1. **Undefined globals** — real bugs. Each is a code path that fails at click
   time today.
2. **Orphans** — declared, referenced nowhere in any file. Dead code. This is
   the whole-program replacement for the 801 bogus `no-unused-vars` warnings.
3. **Implicit globals** — assignments to undeclared names, surfaced as escaping
   references carrying a `writeExpr`. Invisible today; each is a hard throw
   under ES-module strict mode. This report is the go/no-go signal for the
   module conversion.

### Invocation

- `node tools/symbols.mjs` — report only. Exit 1 if any undefined globals.
- `node tools/symbols.mjs --write` — also writes the manifest for ESLint.

## Component 2 — ESLint wiring

`--write` emits `tools/globals.generated.json` as `{name: "writable"}`, sorted
for a stable diff. `writable` rather than `readonly` because globals are
reassigned in places — `readonly` would trigger `no-global-assign` across the
codebase.

`eslint.config.js` imports that JSON into `languageOptions.globals` for `js/**`
and changes three rules:

```js
'no-undef':       'error',                              // the point of the exercise
'no-redeclare':   ['error', { builtinGlobals: false }], // required — see below
'no-unused-vars': ['warn', { args: 'none', vars: 'local' }],
```

All three were verified against a real ESLint run before this spec was written.

**`no-redeclare` is the landmine.** It defaults to `builtinGlobals: true`, which
counts config-supplied globals. Feeding it 2,042 names makes every file error on
its own declarations — reproduced as `'myGlobalFn' is already defined as a
built-in global variable`. Without `builtinGlobals: false` this design produces
~2,042 spurious errors and fails immediately.

**`vars: 'local'` clears the 801 false warnings.** It scopes the unused check to
local variables, so a function declared in one file and used in another is no
longer reported, while a genuinely dead local still is. Verified on a fixture:
the cross-file global went quiet, the dead local stayed flagged, the undefined
name errored.

### Staleness

Handled by regenerating on every run rather than a CI diff check:

```json
"lint":          "node tools/symbols.mjs --write && eslint js",
"check:globals": "node tools/symbols.mjs"
```

`tools/globals.generated.json` is committed so editors get squiggles without
anyone having run the script first.

## Component 3 — Rollout

Lint is at 48 errors today, so the CI gate cannot go on in one move. Five steps,
each independently valuable and revertible:

1. **Land the analyser and run it by hand.** No config change and nothing gated,
   so its non-zero exit affects nobody yet. Read the three reports.
2. **Fix report 1.** Every undefined global is a live broken path. The payoff
   lands before any config change.
3. **Clear the 48 existing errors.** 26 `no-useless-escape` and 21
   `no-useless-assignment` are mechanical. The `no-func-assign` at
   `js/settings.js:697` (`applyAccent`, a function declaration that gets
   reassigned) is not — a reassigned function declaration is usually a real bug
   and gets read properly, not silenced.
4. **Flip the config** to the three rules above, with the generated manifest
   wired in. Lint should now be green.
5. **Gate CI** — a workflow running `npm run lint` on push and PR, alongside the
   existing `.github/workflows/keep-alive.yml`.

Only step 4 touches configuration, and by then the noise is gone so a new error
is actually visible.

## Testing

A checker that silently reports nothing is worse than no checker, and the
analyser is the only new logic here.

`tools/__fixtures__/` gets four small files: a declared global, a legitimate
cross-file reference to it, a reference to a typo'd name, and an assignment to
an undeclared name. The test asserts the run reports exactly one undefined
global and one implicit global, and raises nothing about the legitimate pair.

Run with `node --test`, built into Node — no new dependency. Wired as
`"test": "node --test \"tools/*.test.mjs\""`. The bare directory form
(`node --test tools/`) fails on Node 24 with `Cannot find module` — it treats
the path as an entry point rather than a directory to scan.

## Risks

**False positives in report 1 make step 2 noisy.** Mitigated by using
eslint-scope's real scope analysis rather than regex, and by an explicit,
deliberately short external allowlist. If a false-positive class appears it goes
in the allowlist with a comment naming its provider.

**The manifest drifts from reality.** Mitigated by regenerating inside `npm run
lint` rather than checking a committed artifact for freshness — it cannot be
stale at the moment it is used.

**Step 3 hides a real bug by "cleaning" it.** `applyAccent` is called out
explicitly above so it gets diagnosed rather than pattern-matched away with the
other 47.

## Implementation notes

Three things the design did not anticipate, all found by running the analyser
against real code rather than fixtures:

- **espree must be given `range: true`, not just `loc`.** eslint-scope reads
  `node.range` while resolving references inside arrow functions and throws
  without it. Fixtures never hit this; `js/*.js` crashed on the first run.
- **`globals.browser` is DOM/window APIs only.** It contains no `Math`,
  `Object`, `Promise` or `Array`, so resolving against it alone reported 1,896
  undefined globals, almost all of them language built-ins. The ambient set must
  be `globals.es2023` ∪ `globals.browser`.
- **`typeof X` on an undeclared name is excluded**, matching ESLint's `no-undef`
  default. It is legitimate feature detection, and the app leans on the
  `typeof fn === 'function' && fn()` idiom throughout — the call is the real
  signal, and counting the guard too reported every finding twice.

## First run

Against 33 files and 2,052 declared globals:

| Report | Count |
|---|---|
| Undefined globals | **1** |
| Implicit globals | **0** |
| Orphans | 485 |

The single undefined global is real: `js/platform.js:3577` calls `billRender`,
which is declared in no file. The function is `billingRender`
(`js/billing.js:635`). It sits behind `typeof billRender === 'function'`, so it
never throws — it silently does nothing, and the billing page has never
re-rendered on incoming portal events. Its neighbour `rptRender` resolves
correctly, so reports do. Exactly the failure mode the tool exists to catch:
invisible to lint, invisible at load, and only observable as a feature quietly
not happening.

**Implicit globals: 0.** This is the go/no-go signal for the ES-module
conversion, and it is clean — no assignment to an undeclared name anywhere in
`js/*.js`, so module strict mode has nothing to throw on. That removes the
unknown that made the conversion unspeccable.

Orphans are recorded but not actioned here; 485 unreferenced globals is a
dead-code finding for separate triage, not a blocker.

## How this feeds the module conversion

The declared/reference tables are most of the input needed to generate the 950
import statements mechanically rather than by hand, and report 3 is the only way
to learn whether implicit globals will throw under strict mode. The conversion
gets its own spec once this analyser has run and its reports are known.
