# ES-module conversion — design

**Date:** 2026-07-29
**Status:** Specced, not started. Phase 1 is independently valuable and can
begin without committing to the rest.
**Supersedes:** the "rejected alternatives" note in
`2026-07-28-globals-safety-net-design.md`, which deferred this work.

---

## Why this was deferred, and what changed

The conversion was rejected in July on three grounds. Two are now gone, and
they were removed incrementally with verification rather than inside the
conversion itself.

| Blocker then | Now |
|---|---|
| Implicit globals would throw under strict mode — unmeasurable with `no-undef` off | **0**, measured by `tools/symbols.mjs` |
| 518 handlers resolved via `window[action]`; modules put nothing on `window`, so all would break | **0** — every handler is registered, the fallback is deleted, and CI asserts it stays that way |
| No regression net beyond a smoke test that passed on a blank page | 22 tests, a 30-page render sweep asserting the DOM, and a dispatch-registry assertion, all gated in CI |

Two further preconditions were measured and hold:

- **No duplicate top-level names** across 2,039 globals in 33 files. The
  `vx`/`ov`/`ht`/`fn` prefix discipline held, so there are no collisions to
  resolve — normally the expensive part.
- **No inline event handlers** in the HTML shell. Nothing depends on functions
  being reachable from markup as globals.

## What is actually left

Measured with scope-resolved references, not word matching — an earlier
word-based estimate overcounted bindings by ~15% and cycles by ~20%.

| | |
|---|---|
| Import bindings to write | **830** |
| File-to-file edges | **230** |
| Mutual import pairs (cycles) | **46** |
| Top-level executable statements | **102** |
| …registration calls (`vxActions`, `vxTest`) — order-safe | 42 |
| …`window.X = fn` exposures — order-safe | 3 |
| …**genuinely order-sensitive initialisers** | **57** |

Heaviest importers: `ui.js` (116 names from 16 files), `dashboard.js` (95 from
19), `boot.js` (61 from 10), `export.js` (56 from 11), `reports.js` (56 from 10).

### The 57, honestly

Most are `addEventListener` calls, which attach a listener and care nothing for
ordering. The sharp edges are few and specific:

- **`js/dashboard.js:3632, 3803, 3828`** — three top-level monkey-patches
  (`setReportStage = function(…)`, `if(_origDefSave){…}`,
  `if(_origDbRefreshCard){…}`) that wrap functions defined in *other* files.
  These are the real order dependency: they must run after their targets exist.
  Same shape as the `applyAccent` patch removed in `ecf1c7b`.
- **`js/editor.js:246, 2389`** — `Object.assign(CV_FIELD_DEFS, {…})` and
  `_cvLoadAlignGuidesPref()`, which mutate/read state another module owns.
- **`js/export.js:1092`** — `cvLoadTplConfig()`.
- **`js/boot.js:101`** — `(async function init(){…})()`, the app entry point,
  which must remain last.

That is roughly six statements that genuinely constrain ordering, not 57 and
certainly not the 95 an earlier line-based count suggested.

---

## Approach

Three phases. **Phase 1 is incremental and independently useful**; only Phase 3
is a cutover.

### Phase 1 — neutralise order sensitivity (no modules yet)

Under `<script defer>`, evaluation order is the tag order in the shell: a total
order you can read off one file. Under modules it is derived depth-first from
the import graph, and with 46 mutual pairs that order is not obvious by
inspection.

Rather than reason about what the new order would be, remove the dependence on
it:

1. Move each genuinely order-sensitive initialiser into a named function
   (`vxInitEditor()`, `vxInitReports()`, …) that does nothing at load.
2. Have `boot.js` call them explicitly, in the current script-tag order.
3. Resolve the three `dashboard.js` monkey-patches properly — fold the wrapper
   into the target function where the body has no early return (as with
   `applyAccent`), or make the wrapping an explicit call from `boot.js`.

Done file by file. Each step is verifiable with the existing 30-page sweep, and
each is independently revertible. After this, module evaluation order stops
mattering, which is what makes Phase 3 safe.

**This phase is worth doing whether or not the conversion proceeds.** It turns
implicit boot order into an explicit, readable sequence.

### Phase 2 — generate imports and exports

A codemod using `tools/symbols.mjs`'s tables, which already know every
declaration and every cross-file reference:

- For each file, `export` the names other files reference (not everything —
  exporting only what is used keeps the orphan report meaningful).
- For each file, emit `import { … } from './other.js';` for the names it uses,
  grouped by source file and sorted.
- Leave function bodies untouched.

830 bindings generated, not typed. The codemod's output is checked by the
existing `no-undef` gate: an import that fails to resolve is a hard load error,
and a missing one is a lint error.

Cycles need no special handling for function declarations — those hoist and
resolve normally. After Phase 1 there is no top-level code in a cycle that
reads another module's state at load, which is the only case that breaks.

### Phase 3 — cutover

- Replace the 32 `<script defer src>` tags with one
  `<script type="module" src="js/boot.js">`.
- `js/qrcode.min.js` is a vendored UMD bundle: keep it as a classic script tag
  before the module, or wrap it. It is excluded from the analyser already.
- `sw.js` caches `js/*.js` by name — unchanged, modules fetch the same URLs.
- `netlify.toml` already serves `js/*` with `no-cache`, so no deploy-cache
  concern.

Single commit, reverted with `git revert` if the sweep fails.

---

## Verification

Each phase gates on what already exists, with nothing new to build:

| Check | Catches |
|---|---|
| `npm run lint` (`no-undef`, 830 bindings) | a missed or misspelt import |
| `npm test` — 22 tests | analyser and harness regressions |
| `npm run verify:all` — 30 pages asserted rendered | a module that fails to load or throws at import |
| dispatch-registry assertion | a handler lost in the conversion |
| CI on every push | all of the above, per commit |

The dispatch assertion matters most here: it walks eight pages and asserts every
rendered `data-action` resolves through the registry. If the conversion drops a
registration, that fails loudly rather than becoming a dead button.

## Risks

**A module that throws at import takes the whole app down**, where a classic
script failure was localised. Mitigated by the sweep — a page that does not
render fails CI — but the blast radius is genuinely larger than today.

**The codemod could export too much.** Exporting every declaration would make
every global reachable and quietly destroy the orphan report's meaning. Export
only what is referenced; assert the orphan count does not drop on conversion.

**Cycles plus Phase 1 shortcuts.** If Phase 1 leaves even one top-level read of
another module's state inside a cycle, it will produce a `undefined` at load
rather than an error. The classification above is the checklist; it should be
re-run after Phase 1 and show zero remaining in the `real` bucket beyond
`boot.js`'s entry call.

**No behavioural test coverage.** The sweep proves pages render, not that
features work. A conversion that renders but subtly misorders initialisation
would pass. This is the residual risk and it does not go away.

## Should this happen at all?

Worth stating plainly: **the practical pain is already fixed.** The safety net
made invisible breakage visible, and the registry made dispatch explicit. What
the conversion adds is explicit dependencies, a non-ambient namespace, readable
load order, and better editor tooling — real, but marginal against what has
already been recovered.

Phase 1 captures a good share of that benefit (explicit boot order) at a
fraction of the risk. A reasonable outcome is to do Phase 1, then decide whether
Phases 2–3 still earn their cost.

## Non-goals

- No file splitting. `platform.js` (~12 responsibilities in 4.6k lines) and
  `editor.js` (7k) are worth breaking up, but not in the same change.
- No bundler or build step. The app stays no-build; native modules only.
- No TypeScript.
- The `hardness`/`ferrite`/`pmi` triplication is untouched.
