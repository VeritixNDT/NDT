# Veritix NDT Inspect - Competitive Audit

_June 2026 - benchmark vs. leading NDT inspection/reporting software - status refreshed 2026-06-18_

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
| 5-language i18n | Most rivals are English-only |

## 3. Where competitors were ahead - the gaps (mostly closed)

Status as of 2026-06-18. The original June-12 gap list is now largely shipped.
Legend: [LIVE] shipped & live - [BUILT] built/verified - [PARTIAL] partly done - [OPEN] not started.

| Gap | Who has it | Veritix status (2026-06-18) |
|---|---|---|
| Online payments (pay invoice in-portal) | AgileNDT, SPA | [BUILT] Stripe Checkout built + test-verified (portal Pay online + webhook -> invoice Paid). Needs **go-live** (live keys + business/bank verification + live webhook). |
| Public API | AgileNDT, SkySoft | [LIVE] key-authed read+write (reports/jobs/customers/invoices/quotes), OpenAPI spec + Swagger docs, signed webhooks. Verified end-to-end. |
| SSO / MFA | AgileNDT, SkySoft | [LIVE] Google + Microsoft OAuth + TOTP MFA via Supabase Auth. |
| ERP / accounting integration | AgileNDT, SkySoft | [OPEN] QuickBooks/Xero CSV export is the next integration. |
| Customer-initiated work requests via portal | AgileNDT, Floodlight | [LIVE] (Portal v2 B) request form -> inspector "Customer requests" band -> pre-filled job; + date-change requests. |
| AI layer | AgileNDT | [LIVE] AI report-review (do-not-issue gate, structured findings). [OPEN] trend digests / NL asset query. |
| Scheduling / dispatch depth | Zertify, Floodlight | [PARTIAL] Planner + portal inspection schedule + customer date-change. [OPEN] no dispatch queue. |
| Portal depth - notifications, payment, role tiers | AgileNDT | [LIVE] Portal v2 (A+B+C+D+E+F): two-way channel, ack/e-sign, proactive notifications, asset cockpit, work requests, self-serve depth, section toggles, white-label. [OPEN] multi-contact role tiers. |
| Technique sheets as a formal artifact | AgileNDT, NDTspec | [OPEN] still implicit via method forms + procedure register. |

## 4. Internal audit flags (build/state) - 2026-06-18

1. [DONE] Backend live since 2026-06-12 (email/portal/verify); portal notifications confirmed live 2026-06-16. [OPEN] a full real-world cross-device portal/verify pass is still worth doing.
2. [DONE] jsonb sync scaling - per-report rows shipped; only embedded photo dataURLs -> Supabase Storage remains, deferred to pilot volume.
3. [DONE] Public API + SSO/MFA shipped - enterprise/no-re-entry gate closed.
4. [OPEN] Test scaffolding still shipping ("Delete all reports" tool / VX_SHOW_TEST_TOOLS) - flip off before customer launch.
5. [DONE] Service-worker cache fragility - fixed (per-build SW cache + footer build stamp + no-cache headers).
6. [OPEN] Print fidelity of new PDFs verified structurally, not on a real printer. Server-side vector PDF (pdf-render) is deployed but inert until a Gotenberg container + GOTENBERG_URL are provided (falls back to raster/print).

## 5. Prioritised recommendations - updated 2026-06-18

Done since June 12: Stripe payments (built), Public API, SSO/MFA, AI report-review,
Portal v2, sync-scaling hardening. Remaining:

1. **Launch-readiness** (gating, not features): Stripe go-live; remove the "Delete all reports" test tool; real-printer PDF check; deploy a Gotenberg container for vector PDFs; cross-device portal/verify pass; photo dataURLs -> Storage before pilot volume.
2. **Accounting/ERP export** (QuickBooks/Xero CSV) - the one untouched integration; pairs with the now-live public API.
3. **Post-launch product depth:** dispatch queue (scheduling), formal technique-sheet artifact, AI expansion (trend digests / NL asset query), portal multi-contact role tiers + i18n.

**Bottom line:** As of 2026-06-18 the integration/enterprise gate is essentially
closed - public API, SSO/MFA, AI review, online payments, and a full Portal v2 are
all built. What remains is **launch-readiness chores** (Stripe go-live, remove test
tooling, vector-PDF infra, real-world tests) plus one net-new integration
(accounting export); the rest is post-launch depth. No gaps are architectural.

### Sources
- DRIVE NDT - https://www.drive-ndt.com/en/
- AgileNDT - https://agilendt.com/
- Floodlight - https://floodlightsoft.com/ndt-inspection-software/
- SkySoft - https://www.skysoftconnections.com/skysoft-ndt-inspection-software/
- SPA InnoVision / InspectO - https://spainnovision.com/inspecto/
- NDTspec (TWI) - https://www.twisoftware.com/software/welding-software/ndtspec/

_Created 2026-06-12 - Status refreshed 2026-06-18 - Owner: Carl Cope (Smart Veritas BV)_
