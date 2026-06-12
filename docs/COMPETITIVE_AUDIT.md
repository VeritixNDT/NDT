# Veritix NDT Inspect — Competitive Audit

_June 2026 · benchmark vs. leading NDT inspection/reporting software_

## 1. The landscape — who we actually compete with

Two distinct categories:

- **A. NDT management / reporting platforms (our real competitors):** Drive NDT,
  AgileNDT, Floodlight, NDT Suite, beXel, Zertify, SPA InnoVision / InspectO,
  NDTspec (TWI), Welders Log.
- **B. Instrument data-analysis software (adjacent, NOT competitors):** OmniScan,
  CIVA, BeamTool, WeldSight, Mentor UT. These acquire/analyse raw scan data;
  Veritix is a management/reporting layer and should not try to compete here.

Recurring competitor pitch: **field → report → invoice with no re-entry**
(Floodlight's wedge), configurable approval workflows, white-label customer
portals, personnel/equipment/calibration, and increasingly **AI** + **integrations**.

## 2. Where Veritix wins 🟢

| Differentiator | vs competitors |
|---|---|
| Inspection-engine depth — 9 methods (UT/MT/VT/PT/RT/ET/PMI/HT/FN) with live survey grids, acceptance criteria, sampling tables, grade libraries | Most management-first rivals treat the report as a flat form |
| Canvas PDF editor (smart cards, conditional blocks, Annex) | More flexible than the fixed templates most rivals offer (AgileNDT excepted) |
| Eye-test cert + Annex A, sealed/frozen PDFs, QR verify | Audit-grade evidence few rivals match |
| Offline-first (localStorage / IndexedDB) | Strong for field; many rivals are cloud-only |
| Full around-the-inspection layer: Customers → Jobs → Quotes/Invoices → Portal → Planner → Management reports → Job report pack | Unusual breadth for our size |
| 5-language i18n | Most rivals are English-only |

## 3. Where competitors are ahead — the gaps 🔴

| Gap | Who has it | Veritix today |
|---|---|---|
| Online payments (pay invoice in-portal) | AgileNDT, SPA | Stripe Checkout now BUILT (portal Pay online + webhook), pending Stripe keys + deploy |
| Integrations: public API, SSO/MFA, ERP/accounting | AgileNDT, SkySoft | None — enterprise procurement gate |
| Customer-initiated work requests via portal | AgileNDT, Floodlight | Portal is read-only |
| AI layer — report review, trend digests, NL asset query | AgileNDT | None — but our structured survey data is ideal for it |
| Scheduling / dispatch depth | Zertify, Floodlight | Planner exists; no dispatch queue |
| Portal depth — notifications, payment, role tiers | AgileNDT | Magic-link read-only (+ Stripe pay now) |
| Technique sheets as a formal artifact | AgileNDT, NDTspec | Implicit via method forms + procedure register |

## 4. Internal audit flags (build/state)

1. Backend went live 2026-06-12 (email/portal/verify); cross-device portal/verify still needs a real-world test.
2. jsonb sync scaling risk (~650 KB/report blobs) — harden before pilot volume.
3. No public API / SSO — blocks enterprise + the "no re-entry" story.
4. Test scaffolding still shipping ("Delete all reports" bulk tool) — remove before launch.
5. Service-worker cache fragility (documented stale-JS issues).
6. Print fidelity of new PDFs verified structurally, not on a real printer.

## 5. Prioritised recommendations

1. **Stripe online payments** — highest leverage; closes quote → invoice → paid. **(Built 2026-06-12 — needs Stripe keys + deploy.)**
2. Accounting export first (QuickBooks/Xero CSV), public API second.
3. SSO/MFA (Azure AD/Okta/Google) — enterprise gate.
4. Portal v2 — customer work-request submission + "report ready" notifications.
5. AI report-review — pre-delivery validation. Our structured data makes this easier for us than for form-based rivals.
6. Harden sync scaling before pilot customers.

**Bottom line:** Veritix is ahead on inspection-engine depth, evidence handling,
offline, and breadth; behind on integrations/SSO and AI. None of the gaps are
architectural. Online payments (the #1 gap) is now built.

### Sources
- DRIVE NDT — https://www.drive-ndt.com/en/
- AgileNDT — https://agilendt.com/
- Floodlight — https://floodlightsoft.com/ndt-inspection-software/
- SkySoft — https://www.skysoftconnections.com/skysoft-ndt-inspection-software/
- SPA InnoVision / InspectO — https://spainnovision.com/inspecto/
- NDTspec (TWI) — https://www.twisoftware.com/software/welding-software/ndtspec/

_Created 2026-06-12 · Owner: Carl Cope (Smart Veritas BV)_
