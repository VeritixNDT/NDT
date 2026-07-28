# Orphan triage — findings

**Date:** 2026-07-28
**Input:** the 485 orphans reported by `tools/symbols.mjs` after the globals
safety net landed (`17241a6`).

---

## Headline

**485 raw orphans → 75 real ones. 410 (85%) were false positives**, and the
analyser has been taught to exclude them so the number stays meaningful.

`js/ui.js` dispatches UI handlers by name — `const fn = window[action]`
(`ui.js:131`, `:749`) — so anything wired as `data-action="foo"`,
`data-on-change`, or `data-on-input` is reachable at runtime with no direct
reference anywhere in the source. That was a deliberate architectural choice:
eliminating inline `onclick` handlers is what allows a strict
`script-src 'self'` CSP. It also makes those handlers invisible to scope
analysis.

`analyse()` now collects dispatch targets from every `js/*.js` **and** from the
HTML shell, which wires handlers the same way (`adminNewReport` at
`veritix-ndt-inspect-v3_44.html:778` was one). Verified by sampling eight
dispatch-classified names and confirming each has a real wiring site.

| Bucket | Count | Verdict |
|---|---|---|
| `data-action` / `on-change` / `on-input` dispatch | 410 | **Live** — deleting would break the UI |
| Name appears in the HTML shell | 16 | **Live** |
| Name appears in some other string or comment | 23 | Suspect — needs eyes |
| Appears nowhere but its own declaration | 36 | **Dead** |

---

## Finding 1 — the Kanban board is unreachable

**`rptRenderKanban` (`js/reports.js:2005`) is never called.**

`rptRender` ends unconditionally:

```js
rptRenderTiles(allReports);
return rptRenderTable(list, allReports);
```

There is no branch on `_rptView`. Its only read is
`_rptView === 'kanban'` at `reports.js:1134` and `:1190`, which toggles the
`active` CSS class on the toggle button. So clicking **Kanban** highlights the
button, persists the preference to storage — and renders the table.

Everything around the feature exists:

- the toggle buttons `rpt-vtog-table` / `rpt-vtog-kanban`
- `_rptView` state, persisted and restored (`reports.js:1131`)
- `rptRenderKanban` (~88 lines) and `rptRenderKanbanCard`
- the five drag handlers `rptKbDragStart/End/Over/Leave/Drop`
- **user documentation** in `help.js:290`: *"Kanban drag & drop. Open Reports,
  click the Kanban toggle, grab any card and drop it on…"*, plus `help.js:474`
  *"Table vs kanban view"*
- **translated strings in all five locales** (`rpt.view.kanban`,
  `rpt.view.kanban_tip`)

This is the same shape as the `billRender` bug: a feature that looks wired,
never runs, and fails silently. Unlike that one it is user-visible — the manual
documents a feature that cannot work.

**Not fixed here.** Wiring it up versus removing it is a product call, and the
renderer has never executed against real data, so switching it on during a live
pilot needs a deliberate decision rather than a drive-by patch.

## Finding 2 — the duplicated survey modules have drifted

The audit flagged `hardness.js` / `ferrite.js` / `pmi.js` as prefix-renamed
copies of one module shape. The orphan data confirms they have diverged:

| Name | References |
|---|---|
| `htWeldCount` | 3 — live |
| `fnWeldCount` | 1 — its own declaration, **dead** |
| `pmiWeldCount` | 0 — never written |
| `fnIsEmpty` | 1 — its own declaration, **dead** |
| `htIsEmpty` | 0 — never written |

Three copies of the same concept, each evolving separately, with nothing
enforcing parity. Extracting one weld-survey core is the fix; this is evidence
for it, not a bug on its own.

## Finding 3 — 36 genuinely dead globals

Safe to delete after a spot-check. Notable clusters:

- **Profile shims** (`ui.js:1588-1592`) — `openProfilePanel`,
  `startProfileEdit`, `cancelProfileEdit` are one-line aliases for
  `openProfileModal`/`closeProfileModal`; `closeProfileSubForms` is an empty
  function. Nothing references any of them. (`closeProfilePanel`, on the same
  lines, IS referenced — so don't delete the block wholesale.)
- **Accounting wrappers** (`billing.js:632-633`) — `billExportXeroCsv` /
  `billExportQuickBooksCsv` are unused convenience wrappers around
  `billExportRun`. The CSV export itself is live via the `data-fmt` buttons, so
  the feature works; only these two entry points are dead.
- **Unused constants** — `BILL_STATUSES`, `DEF_SEVERITIES`, `DEF_STATUSES`,
  `AP_KEYBOARD_SHORTCUTS`, each with one reference (its own declaration).
- **Kanban renderer** — see Finding 1. Do not delete before deciding.

The remaining 23 "suspect" entries reference their name in some string or
comment and need a human glance; most look like module-scope flags
(`_vxResizeGatingWired`, `_apIdleHooked`, `_methodDirty`) whose write is the
only use.

---

## Change to the analyser

`analyse({ dir, shell })` gained an optional `shell` argument and now excludes
string-dispatch targets from the orphan report. Covered by a test
(`does not report a string-dispatch target as an orphan`) with a fixture, so the
exclusion cannot silently regress into reporting live handlers as dead.

The orphan report also prints its entries now rather than just a count — at 75
it is reviewable, which it was not at 485.
