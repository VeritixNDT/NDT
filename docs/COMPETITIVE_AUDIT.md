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
| Full around-the-inspection layer: Customers -> Jobs -> Quotes/Invoices -> Portal -> Planner -> Dispatch -> Management reports -> Job report pack | Unusual breadth for our size |
| 5-language i18n (app + customer portal) | Most rivals are English-only |

## 3. Where competitors were ahead - the gaps (status 2026-06-19)

Reconciled against the actual codebase. Legend: [LIVE] shipped & live - [BUILT]
built/verified, needs go-live - [PARTIAL] partly done - [OPEN] not started.

| Gap | Who has it | Veritix status (2026-06-19) |
|---|---|---|
| Online payments (pay invoice in-portal) | AgileNDT, SPA | [BUILT] Stripe Checkout built + test-verified. Needs **go-live** (live keys + business/bank verification + live webhook). |
| Public API | AgileNDT, SkySoft | [LIVE] key-authed read+write, OpenAPI + Swagger docs, signed webhooks. Verified end-to-end. |
| SSO / MFA | AgileNDT, SkySoft | [LIVE] Google + Microsoft OAuth + TOTP MFA via Supabase Auth. |
| Accounting / ERP export | AgileNDT, SkySoft | [LIVE] invoice/quote CSV export to Xero, QuickBooks, Sage, e-Boekhouden.nl, generic (all / filter / date range). [OPEN-DEFERRED] live *API* push (vs CSV) - scoped, deferred 2026-06-19. |
| Customer-initiated work requests via portal | AgileNDT, Floodlight | [LIVE] (Portal v2) request + date-change forms -> inspector band -> pre-filled job. |
| AI layer | AgileNDT | [LIVE] AI report-review (do-not-issue gate) **+ trend digests + natural-language query over reports** (ai-insights). |
| Scheduling / dispatch depth | Zertify, Floodlight | [LIVE] Planner **dispatch queue** (assign/schedule open jobs + per-inspector workload) + inspection schedule + customer date-change. |
| Portal depth - notifications, payment, role tiers | AgileNDT | [LIVE] **Portal v2 complete** - two-way channel, ack/e-sign, notifications, asset cockpit, work requests, self-serve, section toggles, white-label, multi-contact roles (Viewer/Approver/Billing), per-customer language + EN/NL/DE/FR/ES i18n. |
| Technique sheets as a formal artifact | AgileNDT, NDTspec | [LIVE] formal **technique-sheet artifact** (per job, numbered TS-YYYY-NNN, method + procedure ref + execution detail, PDF) alongside the procedures register. |

**Doc-drift note:** reconciled against code. Earlier versions wrongly listed
shipped features as open. Grep the code before trusting any "[OPEN]" here.

## 4. Internal audit flags (build/state) - 2026-06-19

1. [DONE] Backend live since 2026-06-12; portal notifications confirmed live 2026-06-16; cross-device customer-portal access verified on a real device 2026-06-19. [OPEN] cross-device QR report-verify still worth a real-world pass.
2. [DONE] jsonb sync scaling - per-report rows shipped; only embedded photo dataURLs -> Supabase Storage remains, deferred to pilot volume.
3. [DONE] Public API + SSO/MFA shipped - enterprise/no-re-entry gate closed.
4. [OPEN] Test scaffolding still shipping (VX_SHOW_TEST_TOOLS=true -> dashboard "Delete all reports" bar) - flip off before customer launch.
5. [DONE] Service-worker cache fragility - fixed (per-build SW cache + footer build stamp + no-cache headers).
6. [OPEN-DEFERRED] Real-printer PDF check - deferred with the Gotenberg vector-PDF container (GOTENBERG_URL); pdf-render falls back to raster/print until then.

## 5. Prioritised recommendations - updated 2026-06-19

Shipped since the June-12 draft: Stripe payments (built), Public API, SSO/MFA, AI
report-review **+ trend digests / NL query**, full Portal v2 (roles + i18n),
accounting CSV export (5 formats), sync-scaling hardening, **dispatch queue**,
**formal technique sheets**. Remaining:

1. **Launch-readiness** (gating, mostly external): Stripe go-live; flip VX_SHOW_TEST_TOOLS off / remove the "Delete all reports" tool; Gotenberg container for vector PDFs + real-printer check; cross-device QR-verify pass; photo dataURLs -> Storage before pilot volume.
2. **Deferred:** live ERP **API** push (vs CSV) - scoped, awaiting a provider choice + the org's API credentials.

**Bottom line:** As of 2026-06-19 the integration/enterprise gate is closed and
the post-launch depth list is nearly cleared - dispatch queue, technique sheets,
and AI trend/query all shipped today; only the live ERP API push is deferred.
What remains is **launch-readiness chores** (mostly external). No gaps are
architectural.

### Sources
- DRIVE NDT - https://www.drive-ndt.com/en/
- AgileNDT - https://agilendt.com/
- Floodlight - https://floodlightsoft.com/ndt-inspection-software/
- SkySoft - https://www.skysoftconnections.com/skysoft-ndt-inspection-software/
- SPA InnoVision / InspectO - https://spainnovision.com/inspecto/
- NDTspec (TWI) - https://www.twisoftware.com/software/welding-software/ndtspec/

_Created 2026-06-12 - Reconciled against code 2026-06-19 - Owner: Carl Cope (Smart Veritas BV)_
