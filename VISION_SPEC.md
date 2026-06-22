# Vision Photo-Analysis — Feature Spec

Status: **HELD — future update** (product decision 2026-06-22). The product
stops at "attach photo to report"; the AI-vision UI is backed out of `master`.
All built work (Phases 1–3: indication-triage, equipment-label OCR, photo-vs-
verdict consistency) is preserved on the **`feat/ai-vision`** branch and ready
to revive — re-add the `js/ai-vision.js` script include + the row/save-bar
buttons, then deploy the `ai-vision` Edge Function. `js/ai-vision.js` and
`supabase/functions/ai-vision/` remain in `master` as dormant (unreferenced)
scaffolding. Author: Veritix. Created 2026-06-21.

## 1. Goal & scope
Let Claude's vision model look at inspection photos already attached to a report
and return **structured, advisory findings** an inspector/approver can act on —
same security model and "advisory, never auto-edits" posture as the existing
`ai-review` gate (`supabase/functions/ai-review/index.ts`). Closes the biggest AI
gap for an NDT app: today photos are stored but never seen by the model.

**In scope (v1):** analyze photos attached to a report/defect, return findings.
**Out of scope (v1):** auto-filling fields without confirmation, video, live
camera, authoritative measurement/quantification.

## 2. Use cases (ranked)
1. **Indication triage** — visible crack/porosity/undercut/corrosion + rough
   location. *(Phase 1.)*
2. **Equipment-label / cert OCR** — serials, calibration stickers, gauge
   readings, material stamps → structured fields (ties into compliance flow).
3. **Photo-vs-verdict consistency** — do the photos contradict the verdict?
4. **Caption / quality assist** — suggest captions, flag unusable photos.

## 3. UX / entry points
Mirror the `✦ AI` affordance (`js/dashboard.js`, `js/reports.js`).
- **Report-level** `✦ Photos` button on each Reports-table row (Phase 1).
- Per-photo `✦ Analyze` on photo slots (Phase 2).
- Results render in the existing overlay (`_aiReviewShowOverlay`) — native look.
- OCR findings carry **"Apply to field"** (inspector confirms; never auto-applied).

## 4. Architecture & data flow
```
Browser                              Edge (ai-vision)            Anthropic
resolve photo -> blob/dataURL
  (vxPhotos.get / remoteUrl / .data)
downscale <=1568px, re-encode JPEG
  -> base64 (strip header)
POST {mode,reportCtx,images[]} ----> verify JWT (as ai-review)
                                     size/count guard
                                     image blocks BEFORE text
                                     model claude-opus-4-8 ----> vision + structured out
                                     output_config.format json_schema
findings overlay <------------------ {ok, vision}
```
Photos are **not** base64 at rest (V14 — `{photoId, remoteUrl}`, `.data` dropped
after upload). The client resolves then re-encodes before sending.

## 5. Edge Function `supabase/functions/ai-vision/index.ts`
Clones `ai-review`; changes message construction.
- **Model:** `claude-opus-4-8` (vision; coords map 1:1 to pixels).
- **Image block:** `{type:"image",source:{type:"base64",media_type:"image/jpeg",data:<b64 no newlines>}}`, placed **before** the text block.
- **Source:** base64 (Storage objects aren't reliably public; avoids signed-URL plumbing).
- **Formats:** JPEG/PNG/GIF/WebP — client normalizes to JPEG.
- **Structured output:** `output_config.format` json_schema; `thinking:{type:"adaptive"}`; `effort:"medium"`.
- **Guards:** JWT-gated; <=6 images/request; total base64 <= ~7M chars (~5MB) -> 413.
- **Secret:** reuse `ANTHROPIC_API_KEY`.

**Response (VISION_SCHEMA):**
```json
{ "summary":"...", "overallRisk":"pass|warnings|fail",
  "findings":[ { "imageId":"p1", "type":"indication|quality|mismatch|ocr",
    "severity":"high|medium|low", "description":"...",
    "location":"e.g. upper-left weld toe", "confidence":"low|medium|high" } ] }
```

## 6. Client module `js/ai-vision.js`
Mirrors `js/ai-review.js`; reuses `_aiReviewSanitize`, `_aiReviewShowOverlay`,
`AI_REVIEW_RISK`, `AI_REVIEW_SEV`, `_AI_DISCLAIMER_HTML`.
- `aiVisionReport(idx)` — saved report entry point.
- `_aiVisionCollectPhotos(report)` — recursive walk for photo-like nodes (cap 6).
- `_aiVisionResolveToJpegB64(photo)` — resolve bytes -> canvas downscale -> JPEG b64.

## 7. Image prep (load-bearing)
- Downscale to **<=1568px** long edge before encoding (cost: full-res ~3x tokens).
  Optional **high-detail** mode -> 2576px when fine indication detail is needed.
- Re-encode JPEG q~0.85 (originals can be 25MB).

## 8. Security & cost
- JWT-gated, per-org; key only in Edge. Hard caps; log dropped images (no silent
  truncation). Advisory only — findings never mutate the report.
- Future: prompt caching on the system prompt; vision feed into do-not-issue gate.

## 9. Phasing
- **Phase 1 — DONE** (d07dd11). Edge fn + `js/ai-vision.js` + report-row
  `✦ Photos`, indication-triage mode.
- **Phase 2 — DONE**. Edge fn `mode:"ocr"` (OCR_SCHEMA + `fieldOptions` mapping)
  + editor save-bar `📷 Scan label`: photographs a label/sticker, reads values,
  per-field **Apply** writes into the live `rf-<method>-<key>` input
  (inspector-confirmed, never auto). Logic-verified headless; needs Edge
  redeploy + real-photo eyeball.
- **Phase 3** — photo-vs-verdict consistency, optional approval-gate wiring.

## 10. Open decisions
1. First use case after triage — OCR vs consistency.
2. Liability framing strength in the UI.
3. Cost ceiling — default 1568px + opt-in high-detail, or full-res always.
