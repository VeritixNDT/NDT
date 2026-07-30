# ES-module conversion — design

**Date:** 2026-07-29
**Re-measured:** 2026-07-30, after `js/platform.js` was split into six files
(commits `13e1d9f`…`b4e1fab`). Every count below was retaken; see
"Re-measurement" for what changed and what the old numbers were worth.
**Status:** Phase 1 **done** and on master. Phases 2–3 **attempted and parked**
on branch `refactor/es-modules` — see "What attempting Phase 2 found" below.
The cost is materially higher than this document originally estimated.
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
| No regression net beyond a smoke test that passed on a blank page | 53 tests (22 when written), a 30-page render sweep asserting the DOM, and a dispatch-registry assertion, all gated in CI |

Two further preconditions were measured and hold:

- **No duplicate top-level names** across 2,042 globals in 46 files (2,039 in 33
  when first written; the split added files, not names). The
  `vx`/`ov`/`ht`/`fn` prefix discipline held, so there are no collisions to
  resolve — normally the expensive part.
- **No inline event handlers** in the HTML shell. Nothing depends on functions
  being reachable from markup as globals.

## What is actually left

Measured with scope-resolved references, not word matching — an earlier
word-based estimate overcounted bindings by ~15% and cycles by ~20%.

Figures as of 2026-07-30, with the pre-split tree measured by the same script so
the cost of the split is separable from the cost of the conversion:

| | pre-split `bea926f` | now `4994d3d` | Δ |
|---|---|---|---|
| Files (excl. vendored qrcode) | 42 | **46** | +4 |
| Declared globals | 2,042 | **2,042** | 0 |
| Import bindings to write | 977 | **994** | **+17** |
| File-to-file edges | 313 | **370** | **+57** |
| Mutual import pairs (cycles) | 59 | **58** | −1 |
| Top-level executable statements | 104 | **104** | 0 |
| …`addEventListener` — order-safe | 34 | 34 | 0 |
| …registration calls (`vxActions`, `vxOn`) — order-safe | 48 | 48 | 0 |
| …`window.X =` exposures — order-safe | 3 | 3 | 0 |
| …everything else | 19 | **19** | 0 |
| Cross-module assigned variables | 30, at 60 sites | **30, at 60 sites** | 0 |

Heaviest importers now: `ui.js` (116 names from 22 files), `dashboard.js` (92
from 23), `boot.js` (62 from 19), `reports.js` (57 from 16), `export.js` (55 from
13), `settings.js` (51 from 15).

**What the split cost the conversion: 17 more import bindings and 57 more graph
edges. Nothing else moved.** Cycles went down by one, top-level statements are
unchanged, and the read-only-binding blocker — the thing that actually parked
Phase 2 — is the same 30 variables at the same 60 sites. The split neither
created nor removed a single one. That is the expected shape: extracting code
into new files converts intra-file references into cross-file ones, which costs
edges and bindings, not semantics.

### Re-measurement

The numbers this table replaced were 830 bindings, 230 edges and 46 cycles. The
script written to retake them reports **977 / 313 / 59 for the same pre-split
tree**, so those original figures came from a method this one does not reproduce
— roughly 15–25% lower across the board, in the same direction the doc itself
warns about for word-based counting. The absolute values above should therefore
be read as "measured this way", not as a correction of someone's arithmetic.

The Δ column is the trustworthy part: both sides come from one script run over
two commits, so whatever the method's bias is, it cancels.

One figure does nearly reproduce, and it is the one that matters most. The static
count of cross-module assignments — 30 variables at 60 sites — sits one apart
from the **59 `no-import-assign` errors ESLint actually reported** on
`refactor/es-modules` when the conversion was really run. A static approximation
landing within one of an observed compiler-level count is decent corroboration
that the write-detection is sound, which is what licenses the "0 change" claim on
the row that decides whether Phase 2 is affordable.

Method, for whoever retakes these: parse each `js/*.js` with espree and
eslint-scope exactly as `tools/symbols.mjs` does (same `ecmaVersion`, same
`typeof`-guard filter), resolve each escaping reference against the union of all
files' declarations, and count a binding as a distinct (importing file, name)
pair. Cross-module assignments are escaping references where `isWrite()` holds
and the declaration lives in another file.

### The sharp edges, honestly

Most top-level statements are `addEventListener` calls, which attach a listener
and care nothing for ordering, or registry calls into `vxActions` / `vxOn`, which
`constants.js` makes position-independent by design. After those, 19 statements
remain, and most of those are `if(document.readyState === 'loading')` guards and
IIFEs that are order-safe in practice.

Rechecked 2026-07-30. **Three of the four sharp edges this section named are
gone**, and none of them were removed by the platform split — they went earlier,
in the work that made Phase 1 possible:

- ~~`js/dashboard.js:3632, 3803, 3828` — three top-level monkey-patches~~
  **Resolved.** `setReportStage = function(…)`, `if(_origDefSave){…}` and
  `if(_origDbRefreshCard){…}` no longer exist. They were replaced by the `vxOn`
  event-hook registry in `constants.js` — `dashboard.js` now has three `vxOn(…)`
  registrations in their place. This was the single biggest blocker in the
  section, since reassigning another module's binding is illegal under modules,
  not merely order-sensitive.
- ~~`js/export.js:1092` — `cvLoadTplConfig()`~~ **Resolved.** No longer a
  top-level statement.
- **`js/editor.js:246, 2389`** — `Object.assign(CV_FIELD_DEFS, {…})` and
  `_cvLoadAlignGuidesPref()`, which mutate/read state another module owns. Still
  present, still the real thing to deal with.
- **`js/boot.js:101`** — `(async function init(){…})()`, the app entry point,
  which must remain last. Still present, and correctly so.

So the ordering constraint is now roughly **three statements**, not six and
certainly not the 95 an earlier line-based count suggested. Worth being clear
about the direction of travel: this section has only ever shrunk. The remaining
cost of Phases 2–3 is concentrated almost entirely in the read-only-binding
problem below, not in load order.

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

- Replace the 46 `<script defer src>` tags (32 when this was written) with one
  `<script type="module" src="js/boot.js">`.
- **`js/errors.js` must be the first thing the entry module imports.** This is
  new since `4994d3d` and easy to lose in the cutover. The global error handler
  covers every script BELOW it in the tag list and none above, so it was moved to
  position one — deferred scripts execute in document order, and a script whose
  fetch failed fires its error event at its turn in that same order. Collapsing
  46 tags into one destroys the tag order that guarantees this. Under modules the
  equivalent is that `boot.js`'s first import must be `./errors.js`, so its two
  `addEventListener` calls run before any other module body. The
  `errors.js loads first` test in `tools/verify.test.mjs` asserts the tag
  position and will need rewriting against the import graph, not deleting.
- `js/qrcode.min.js` is a vendored UMD bundle: keep it as a classic script tag
  before the module, or wrap it. It is excluded from the analyser already. Note
  it currently sits second, immediately after `errors.js`, and the coverage test
  blocks it specifically — moving it out of the deferred list means that test
  needs a different victim.
- ~~`sw.js` caches `js/*.js` by name — unchanged, modules fetch the same URLs.~~
  **Moot: there is no service worker, and now no code pretending there is.**
  The aside added here on 2026-07-30 — two registrations, one 404ing — was
  investigated the same day and was worse than it looked. Neither registration
  could succeed anywhere: `sw.js` has never existed in the repo and is not in
  the Netlify publish dir (in production the SPA fallback serves `index.html` as
  `text/html`, so it fails on MIME type rather than 404), and the other
  registered a `blob:` URL, which Chromium rejects as a script protocol
  outright. Zero registrations after a full boot, measured. Both paths were
  deleted; `js/platform-boot.js`'s header carries the evidence. So this bullet
  imposes no constraint on the cutover — there is nothing to keep working.
- `netlify.toml` already serves `js/*` with `no-cache`, so no deploy-cache
  concern.

Single commit, reverted with `git revert` if the sweep fails.

---

## Verification

Each phase gates on what already exists, with nothing new to build:

| Check | Catches |
|---|---|
| `npm run lint` (`no-undef`, ~994 bindings) | a missed or misspelt import |
| `npm test` — 53 tests | analyser and harness regressions |
| `npm run verify:all` — 30 pages asserted rendered | a module that fails to load or throws at import |
| dispatch-registry assertion | a handler lost in the conversion |
| per-block survival tests (15) | a block that moved but arrived incomplete |
| CI on every push | all of the above, per commit |

The survival tests are new since this was written: 15 in `tools/verify.test.mjs`,
one per block moved out of `platform.js` (the sync queue is the exception — it
got 13 behavioural tests in `tools/sync-queue.test.mjs` instead, before it was
allowed to move). Each asserts that a moved block's functions exist AND that
calling them does the right thing — the registry entry resolves, the constant
beside them travelled, the listener actually fires.

They were written for the split, but they are the right shape for the conversion
too, because the failure mode is identical: a name that quietly resolves to
nothing. Several were shown to fail against a deliberate mutation before being
trusted, which is the property that makes them worth relying on here.

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

## What attempting Phase 2 found

Phase 2 was run on `refactor/es-modules` and parked. The mechanical part worked
exactly as specced — 830 imports and 409 exports generated by codemod, every
file parsing as a module, a `js/main.js` entry, the shell down to one module tag
— and then linting as modules produced **59 `no-import-assign` errors**.

(Those two counts describe what the codemod produced against the tree as it stood
on 2026-07-29. Re-running it today would emit more of both, because
`platform.js`'s six new files turn intra-file references into imports and their
declarations into exports. The branch was not rebased; it is a record of where
the attempt got to, not a mergeable state.)

**29 distinct variables are assigned across module boundaries**, at 59 sites:
the canvas editor's state (`cvPages`, `cvCurrentPage`, `cvSelectedId`,
`cvNextId`, written from `billing.js`, `export.js`, `ui.js`), `CURRENT_USER`,
and a cluster in `settings.js`. Imported bindings are read-only, so each is a
hard error.

**Still true on 2026-07-30, and unchanged by the platform split.** The same
variables, in the same numbers: `CURRENT_USER` (9 sites) leads, then `cvPages`
(5), `cvCurrentPage` and `cvPpvMethod` (4 each), tailing into sixteen variables
written from exactly one other file. The split moved `_dateFmt`, `_timeFmt`,
`AUTH_USERS` and `_vxSupabaseClient` between files without changing whether
their writes cross a boundary — they crossed one before and they cross one now.
So the work this branch is parked behind has neither grown nor shrunk, and the
codemod remains reproducible against the current tree.

**This document missed it, and the reason is worth recording.** When assessing
read-only-binding risk above, only *top-level* statements were analysed — that
is what surfaced the three monkey-patches Phase 1 fixed. Assignments inside
function bodies were never in view, and there are twenty times as many.

The fix is known and does not require touching read sites: module imports are
live bindings, so roughly 29 exported setters plus 59 converted assignment
sites would do it. But that is semantic work on shared mutable state, not the
"generated, not typed" mechanical change Phase 2 was scoped as — and the app has
not yet booted in module form, so more may sit behind these.

Two phases also turn out to be **inseparable**: `import`/`export` are syntax
errors in a classic script, so the codemod's output cannot ship until the shell
switches to `type="module"`. Phases 2 and 3 are one landing, not two.

Also required by the cutover, and not anticipated here:

- `window.ovRenderGeoMap` must be published explicitly. The shell's inline
  Leaflet loader is a classic script and cannot see module scope.
- The generated globals manifest must be **removed** from `eslint.config.js`,
  not carried over. Under modules `no-undef` resolves imports natively, and
  feeding it ~2k names would mask exactly the errors it exists to catch.

## Should this happen at all?

Worth stating plainly: **the practical pain is already fixed.** The safety net
made invisible breakage visible, and the registry made dispatch explicit. What
the conversion adds is explicit dependencies, a non-ambient namespace, readable
load order, and better editor tooling — real, but marginal against what has
already been recovered.

Phase 1 captures a good share of that benefit (explicit boot order) at a
fraction of the risk. A reasonable outcome is to do Phase 1, then decide whether
Phases 2–3 still earn their cost.

**That is what happened.** Phase 1 shipped; Phases 2–3 were attempted, found to
cost more than estimated, and parked on a branch. The decision to stop was taken
on the evidence above rather than on appetite — and it can be revisited cheaply,
since the codemod is reproducible and the branch records exactly where it got
to and what remains.

## Non-goals

- No file splitting **in this change**. `platform.js` (~12 responsibilities in
  4.6k lines) and `editor.js` (7k) are worth breaking up, but not here.

  **Update 2026-07-30: `platform.js` has since been split, in its own series of
  fifteen commits — 4,658 lines to 381, one responsibility per file.** The
  non-goal held: it happened separately, not inside the conversion. Its cost to
  this work is quantified in the table above (+17 bindings, +57 edges, nothing
  else), and it is not all cost — six of the twelve responsibilities that made
  `platform.js` hard to reason about are now files with a stated purpose and a
  test pinning their surface, which is exactly the kind of boundary a codemod
  finds easier to reason about than a 4.6k-line file. `editor.js` is untouched
  and the non-goal still stands for it.
- No bundler or build step. The app stays no-build; native modules only.
- No TypeScript.
- The `hardness`/`ferrite`/`pmi` triplication is untouched.

  **Correction:** this was already inaccurate when written. `940c293`, eleven
  minutes before this document was saved, extracted `_htTableEl`/`_fnTableEl`/
  `_pmiTableEl` — the same 17-line table renderer three times over — into
  `vxSurveyTableEl` in `js/utils.js`. The rest of the triplication genuinely is
  untouched, and deliberately so: measurement in
  `2026-07-28-orphan-triage.md` found only 91 of ~2,150 lines actually
  duplicated. So the non-goal is right in substance and wrong in the word
  "untouched".
