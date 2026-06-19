# Veritix NDT Inspect - Competitive Audit

_June 2026 - benchmark vs. leading NDT inspection/reporting software - status refreshed 2026-06-19_

## 1. The landscape - who we actually compete with

Two distinct categories:

- **A. NDT management / reporting platforms (our real competitors):** Drive NDT,
  AgileNDT, Floodlight, NDT Suite, beXel, Zertify, SPA InnoVision / InspectO,
  NDTspec (TWI), Welders Log.
- **B. Instrument data-analysis software (adjacent, NOT competitors):** OmniScan,
  CIVA, BeamTool, WeldSight, Mentor UT. These acquire/analyse raw scan data;
  Veritix is a management/reporting layer and should not try to compete here.

Recurring competitor pitch: **field -> report -> invoice with no re-entry**
(Floodlight's wedge), configurable approval workflows, white-label customer
portals, personnel/equipment/calibration, and increasingly **AI** + **integrations**.

## 2. Where Veritix wins (strengths)

| Differentiator | vs competitors |
|---|---|
| Inspection-engine depth - 9 methods (UT/MT/VT/PT/RT/ET/PMI/HT/FN) with live survey grids, acceptance criteria, sampling tables, grade libraries | Most management-first rivals treat the report as a flat form |
| Canvas PDF editor (smart cards, conditional blocks, Annex) | More flexible than the fixed templates most rivals offer (AgileNDT excepted) |
| Eye-test cert + Annex A, sealed/frozen PDFs, QR verify | Audit-grade evidence few rivals match |
| Offline-first (localStorage / IndexedDB) | Strong for field; many rivals are cloud-only |
| Full around-the-inspection layer: Customers -> Jobs -> Quotes/Invoices -> Portal -> Planner -> Management reports -> Job report pack | Unusual breadth for our size |
| 5-language i18n (app + customer portal) | Most rivals are English-only |

## 3. Where competitors were ahead - the gaps (status 2026-06-19)

Reconciled against the actual codebase (the doc had drifted - see the note at the
foot of this section). Legend: [LIVE] shipped & live - [BUILT] built/verified, needs
go-live - [PARTIAL] partly done - [OPEN] not started.

| Gap | Who has it | Veritix status (2026-06-19) |
|---|---|---|
| Online payments (pay invoice in-portal) | AgileNDT, SPA | [BUILT] Stripe Checkout built + test-verified (portal Pay online + webhook -> invoice Paid). Needs **go-live** (live keys + business/bank verification + live webhook). |
| Public API | AgileNDT, SkySoft | [LIVE] key-authed read+write (reports/jobs/customers/invoices/quotes), OpenAPI + Swagger docs, signed webhooks. Verified end-to-end. |
| SSO / MFA | AgileNDT, SkySoft | [LIVE] Google + Microsoft OAuth + TOTP MFA via Supabase Auth. |
| Accounting / ERP export | AgileNDT, SkySoft | [LIVE] invoice/quote CSV export to **Xero, QuickBooks, Sage, e-Boekhouden.nl, and a generic CSV** (Billing -> Export: all / current filter / date range). [OPEN] deeper *live API* push to QBO/Xero/e-Boekhouden (vs CSV import). |
| Customer-initiated work requests via portal | AgileNDT, Floodlight | [LIVE] (Portal v2) request + date-change forms -> inspector "Customer requests" band -> pre-filled job. |
| AI layer | AgileNDT | [LIVE] AI report-review (do-not-issue gate, structured findings). [OPEN] trend digests / NL asset query. |
| Scheduling / dispatch depth | Zertify, Floodlight | [PARTIAL] Planner + portal inspection schedule + customer date-change. [OPEN] no dispatch queue. |
| Portal depth - notifications, payment, role tiers | AgileNDT | [LIVE] **Portal v2 complete** - two-way channel, ack/e-sign, proactive notifications, asset cockpit, work requests, self-serve depth, section toggles, white-label, **multi-contact roles (Viewer/Approver/Billing)**, and **per-customer language + EN/NL/DE/FR/ES portal i18n**. |
| Technique sheets as a formal artifact | AgileNDT, NDTspec | [OPEN] still implicit via method forms + procedure register. |

**Doc-drift note:** this table is reconciled against code. The prior versions
wrongly listed Portal v2 as "partial" and accounting export as "not started" when
both had shipped. Grep the code before trusting any "[OPEN]" here.

## 4. Internal audit flags (build/state) - 2026-06-19

1. [DONE] Backend live since 2026-06-12 (email/portal/verify); portal notifications confirmed live 2026-06-16. [OPEN] a full real-world cross-device portal/verify pass is still worth doing.
2. [DONE] jsonb sync scaling - per-report rows shipped; only embedded photo dataURLs -> Supabase Storage remains, deferred to pilot volume.
3. [DONE] Public API + SSO/MFA shipped - enterprise/no-re-entry gate closed.
4. [OPEN] Test scaffolding still shipping (VX_SHOW_TEST_TOOLS=true -> dashboard "Delete all reports" bar) - flip off before customer launch.
5. [DONE] Service-worker cache fragility - fixed (per-build SW cache + footer build stamp + no-cache headers).
6. [OPEN] Print fidelity of new PDFs verified structurally, not on a real printer. Server-side vector PDF (pdf-render) is deployed but inert until a Gotenberg container + GOTENBERG_URL are provided (falls back to raster/print).

## 5. Prioritised recommendations - updated 2026-06-19

Done since the June-12 draft: Stripe payments (built), Public API, SSO/MFA, AI
report-review, full Portal v2 (incl. roles + i18n), accounting CSV export (5
formats), sync-scaling hardening. Remaining:

1. **Launch-readiness** (gating, mostly external): Stripe go-live; flip VX_SHOW_TEST_TOOLS off / remove the "Delete all reports" tool; stand up a Gotenberg container for vector PDFs; real-printer PDF check; cross-device portal/verify pass; photo dataURLs -> Storage before pilot volume.
2. **Post-launch product depth:** dispatch queue (scheduling), formal technique-sheet artifact, AI expansion (trend digests / NL asset query), live ERP API sync (deeper than CSV).

**Bottom line:** As of 2026-06-19 the integration/enterprise gate is closed -
public API, SSO/MFA, AI review, online payments (built), a full Portal v2, and
multi-tool accounting export are all shipped. What remains is **launch-readiness
chores** (mostly your external steps - Stripe go-live, vector-PDF infra, real-world
tests) plus **post-launch depth** (dispatch, technique sheets, AI expansion, live
ERP API). No gaps are architectural.

### Sources
- DRIVE NDT - https://www.drive-ndt.com/en/
- AgileNDT - https://agilendt.com/
- Floodlight - https://floodlightsoft.com/ndt-inspection-software/
- SkySoft - https://www.skysoftconnections.com/skysoft-ndt-inspection-software/
- SPA InnoVision / InspectO - https://spainnovision.com/inspecto/
- NDTspec (TWI) - https://www.twisoftware.com/software/welding-software/ndtspec/

_Created 2026-06-12 - Reconciled against code 2026-06-19 - Owner: Carl Cope (Smart Veritas BV)_
