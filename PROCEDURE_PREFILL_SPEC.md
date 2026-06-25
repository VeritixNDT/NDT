# Procedure-driven report pre-fill — design spec

**Status:** agreed design, NOT yet built. Gated on Carl uploading the finalised
NDT procedures. This locks in the approach decided 2026-06-25 so it can be built
when the procedures land. Sibling parked spec: `VISION_SPEC.md`.

## Goal

The finalised procedures become the **source of truth** for acceptance criteria
and other report data. The app reads an uploaded procedure and pre-fills the
report from it, so inspectors don't re-key what the governing procedure already
dictates, and the PASS/BORDERLINE/REJECT engine resolves against the company's
controlled values rather than hardcoded seed numbers.

## Source-of-truth model (decided: "a mix of both")

- **Procedure tabulates explicit numeric limits** → extract the real numbers
  (per indication type / thickness / level) and drive the acceptance chip from
  them directly.
- **Procedure only cites a standard + level** (e.g. "EN ISO 23278 Level 2") →
  map the reference to the standard, and resolve numbers from the standard's
  table held in `js/acceptance.js`.
- So `acceptance.js` shifts from primary source to **fallback layer**: use the
  procedure's extracted values when present, the standard table otherwise. This
  also retires the `verified:false` hand-verification problem — the controlled
  procedure supersedes the seed values.

## Scope (decided: full report pre-fill)

Pull acceptance criteria **plus** equipment / technique parameters / surface
prep / personnel qualification / specification from the governing procedure —
populate the whole report, not just the disposition.

## Apply behaviour (decided: reviewed bulk pre-fill, not silent auto-fill)

- **One "Apply procedure" action** fills every mapped field at once, with a
  summary toast (e.g. "Filled 9 fields from MT-PROC-03 Rev 2"). No per-field
  click-through (that was the OCR friction trap); one bulk apply, then review.
- **Pre-filled cells are visibly marked** ("from procedure" tint/badge) so it's
  obvious what came from the document vs. what the inspector typed.
- **Never silently overwrite** a field the inspector already filled — flag the
  conflict and let them choose.
- **Never auto-seal.** The existing approval workflow + pre-issue AI review gate
  remain the backstop. Inspector stays author of record.
- Optional later: a per-method "trusted procedure → auto-apply" toggle if a
  customer wants zero-touch.

## Linkage

A report (or its job) points at its **governing procedure**, so the app knows
*which* procedure's criteria to apply. Pre-fill is driven off that link.

## What exists today vs. the gap

Already in the app (`js/defects.js` Procedures register):
- Procedure document upload + **pdf.js text extraction** (`procExtractPdfText`).
- Pattern-match extraction of revision, specification/standard, and the
  acceptance-criteria **reference string** (`procExtractFromContent`, ~L826).
- `js/acceptance.js` engine resolves criteria → PASS/BORDERLINE/REJECT and reads
  the report's `eq_acc` cell.
- The ai-vision OCR **Apply** path (`aiVisionApplyOcr`) already writes an
  extracted value into a live `rf-<method>-<key>` field (input or select, adds
  a missing option) — the proven write mechanism to reuse.

The gap to build:
1. **Structured extraction** — an AI pass (same JWT-gated, server-key pattern as
   `ai-review` / `ai-narrative` / `ai-vision`) that reads the procedure text and
   emits structured JSON: a criteria table (numeric limits keyed by indication
   type / thickness / level) **and** the report-field values (equipment,
   technique, spec, surface prep, personnel). Needs OCR path for scanned PDFs.
2. **Per-method field map** — procedure concept → existing report cell
   (acceptance → `eq_acc`, spec → `eq_spec`, technique → `eq_tech`, …). Differs
   per method (MT/PT/UT each have their own `eq_` fields).
3. **Reviewed bulk-apply UI** — the "Apply procedure" action + visible marking +
   non-destructive conflict handling described above.
4. **Acceptance resolver wiring** — `acceptance.js` reads the active procedure's
   extracted criteria first, seed table as fallback.

## Open question for when procedures arrive

Format: born-digital text PDF (pdf.js reads directly) vs. scanned/image PDF
(needs the ai-vision OCR path) vs. Word/Excel source. Confirm on first upload —
it decides whether plain text-extraction suffices.
