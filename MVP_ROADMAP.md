# Veritix → Full NDT Management Platform · MVP Roadmap

**Target:** 14–16 weeks to a feature-complete MVP that wins against Drive NDT / SkySoft on the "around-the-inspection" layer, while keeping Veritix's inspection-engine depth as the differentiator.

---

## North-star user journey (what the MVP delivers)

```
1. Inspector signs up → adds first customer + contact
2. Creates a Job for that customer ("ACME Pipeline Phase 2, March 2026")
3. Quotes the work → customer accepts (email link)
4. Runs inspections under the job → reports nest under it
5. Submits reports → senior approves → sealed PDF generated
6. Sends invoice → customer pays (bank transfer for MVP)
7. Customer logs in via magic link → sees all their reports + invoices
```

When that journey works end-to-end with real email, the product is shippable.

---

## Where we start from

The hardest 60% is already built (Phase 1 shipped 2026-05-17):

| Already in place | Covers |
|---|---|
| 8 methods (VT/MT/UT/PT/RT/ET/PMI/HT) with full report forms | NDT inspection layer — competitors' deepest moat |
| Inspector register with per-method certs + eye-test certs | Compliance traceability |
| Equipment register with calibration + method-tagging + smart-card resolution | Asset traceability |
| NDT procedure register with revision / review-date tracking | Document control |
| PDF template editor + smart cards + Annex page for certs | Audit-grade report output |
| Defects log cross-referenced to reports | Issue traceability |
| Photo / drawing capture per report | Evidence capture |
| Revisions + supersession workflow | Change control |
| Multi-tenant SaaS (Supabase, RLS, multi-org) | Tenancy layer |
| 5-language i18n (EN / NL / DE / FR / ES) | Multi-market ready |
| Dashboard with KPIs, leaderboard, expiry timeline | Reporting layer |
| Custom UI components (vxSel / vxDate / vxCheck / vxTt) + 6 polish layers | Premium feel |

---

## Phase plan

### Phase 0 — Foundations (Week 1–2)
- ✅ **Real email backend** — `send-email` Edge Function + Resend, JWT-gated with a server-side template whitelist (invite shipped; quote / invoice / portal-link slot in later). Client `vxApi.sendEmail()` + invite emails wired. Deploy steps in `SUPABASE_SETUP.md` §7.
- **DKIM / SPF** set up properly on the sending domain — don't roll your own SMTP. _(documented in `SUPABASE_SETUP.md` §7.1; needs DNS records added at deploy time.)_
- Audit & remove test scaffolding (`ovClearAllReports`, the bulk-delete button per memory).
- **Staging deploy** to Cloudflare Pages / Netlify so every change goes live continuously from this point.

### Phase 1 — Customers + Jobs (Week 3–6) — ✅ built (not yet browser-tested)
- ✅ New entity types stored in the existing `entities` jsonb store (KEYS + VX_ENTITY_KEYS, no schema migration):
  - ✅ `customers` — name, VAT/reg no., billing addr, contacts[] (array), sites[] (array), notes
  - ✅ `jobs` — `customerId`, title, status (Pending / Active / Closed), scope, start/end dates, lead inspector, notes
- **UI:**
  - ✅ Settings → Customers (CRUD, repeatable contacts/sites)
  - ✅ New top-level page "Jobs" between Inbox and Reports
  - ✅ Job detail page: client info, scope, child reports, inline status switch
- ✅ **Reports get a `jobId` field** — new-report form gains a Job picker (after Client info); the Reports page filters by job.
- ✅ Migration: legacy reports stay job-less and surface under the "Unassigned" filter bucket; deleting a job detaches its reports rather than losing them.

_Remaining polish (deferred): job/customer i18n (English-only for now, matching the equipment register), a Job column on the reports table, and a customer/job picker that auto-narrows jobs to the chosen client._

### Phase 2 — Quotes + Invoicing (Week 7–10) — ✅ built (browser-verified; email needs backend deploy)
- ✅ `quotes` and `invoices` entity types — line items, derived totals, status, sent/paid dates
- ✅ **UI:** Quote / Invoice builder (line items, VAT rate + currency from Company → Billing defaults, live auto-calc totals); per-job sections on the Job detail **and** a top-level Billing page with Outstanding/Paid totals + filters
- ✅ **PDF output:** print-ready quote/invoice document (company header+logo, customer address, line-items, totals, terms) via the shared `_vxPrintHtml` pipeline
- ✅ **Send via the email backend** — `send-email` gained quote/invoice templates; client `billEmailDoc` sends the document inline and marks it Sent. _Soft-fails until the backend is deployed (Resend); PDF-as-attachment deferred (no client PDF-bytes path yet — sends a rendered HTML email instead)._
- ✅ **Payment status:** manual "Mark as paid" / sent / accepted / declined; Overdue derived from due date. Stripe deferred to v2.
- ✅ **Quote → Invoice convert** (copies line items, links `sourceQuoteId`).
- ⏳ Optional Xero / QuickBooks CSV export — not done (deferred).

### Phase 3 — Approval workflow (Week 11–12) — ✅ built
**✅ Built & browser-verified.** (Most scaffolding pre-existed — stages, Inbox, audit log — so this phase completed & hardened it.)
- ✅ Stage state machine `Draft → Submitted → Approved → Sent` (+ legacy Reviewed/Archived retained); `verdict` kept as the technical result, stage is the workflow state.
- ✅ "Submit for review" on report rows (Draft → Submitted); a plain "Save" now Submits unless the saver may approve.
- ✅ "Approve" / "Request changes" on report rows **and** the Inbox (Senior/Admin, or self-approve inspector on own report).
- ✅ **Sealed PDF on approval** — immutable `sealedHtml` snapshot stamped "APPROVED" (approver + date); approved reports are hard-locked, changes go through a new revision that re-enters review.
- ✅ Audit trail extended (`auditLog`: created / submitted / approved & sealed / stage changes / sent).
- ✅ **Extra (Carl):** per-inspector `canSelfApprove` checkbox (admin-set) lets chosen inspectors approve & seal their own reports without separate review.

### Phase 4 — Customer portal (Week 13–14) — ✅ built (portal-data/-token need backend deploy)
- ✅ Magic-link auth for customers (no customer accounts): HMAC-signed token `{orgId, customerId, exp}` (24h), minted by the `portal-token` Edge Function, validated by the public `portal-data` function. `_shared/portal.ts` signs/verifies.
  - ✅ Customer record carries `portalEmails`.
  - ✅ "Portal link" action mints a signed link (or a local preview link in trial); `send-email` `portal-link` template ready to email it.
  - ✅ Token unlocks a read-only view of that customer's jobs / approved-sealed reports / quotes / invoices (drafts never exposed — filtered server-side).
- ✅ Route `#/portal/<token>` (single white-labelled page with Jobs+reports, Invoices, Quotes sections; sealed-report + invoice/quote PDF downloads). _(The roadmap's separate /portal/jobs/:id, /portal/invoices/:id routes collapsed into one portal page for MVP.)_
- ✅ White-label: company logo + colour drive the portal header/accent.
- ⏳ Deploy needed: `PORTAL_SECRET` secret + `supabase functions deploy portal-token portal-data` (and the email backend) for real cross-device access; works via local preview link until then.

### Phase 5 — Ship (Week 15–16)
- End-to-end test the full journey on staging with a real customer dataset
- Production deploy
- Onboarding flow polish (signup → first customer → first job in < 5 min)
- Marketing site + pricing page (skip if it already exists)
- First three pilot customers

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Email deliverability** | High | Use Resend or SendGrid from day 1; set DKIM / SPF properly during Phase 0. Don't roll your own SMTP. |
| **Quote / invoice scope creep** | High | MVP = line items + single VAT rate per org + bank-transfer pay. Defer multi-currency, recurring invoices, partial payments, credit notes. |
| **Customer portal auth complexity** | Medium | Magic-link only (no passwords). 24h token expiry. Re-issue on demand. |
| **Tax / VAT handling per region** | Medium | Single org-level VAT rate for MVP. Country-specific tax logic = v2. |
| **PDF rendering of long line-item invoices** | Low | Already have items-table overflow handling in the canvas — reuse pattern. |
| **jsonb scaling at customer volume** | Low | The Phase 2 normalisation plan is the long-term fix. MVP is fine on jsonb. |

---

## Explicitly out of MVP

- Scheduling / dispatch calendar (huge undertaking — earns its own quarter)
- Stripe live-payment flow (adds 2 weeks of compliance work)
- Multi-currency invoicing
- Stock management / consumables tracking
- ERP integrations (Xero, QuickBooks, SAP)
- Mobile app (the web app is responsive enough)
- Asset / weld register beyond what the items table already gives

These all live in v2 / v3.

---

## The big picture

| Month | Milestone |
|---|---|
| 1 | Foundations + Customers / Jobs → data model is in |
| 2 | Quotes + Invoicing → revenue flow works |
| 3 | Approval + Customer portal → enterprise-credible |
| 4 | Polish + first paying customers |

---

## Differentiators against Drive NDT / SkySoft once shipped

1. **Inspection-engine depth** — 8 methods with ISO / ASME / AWS specs and live smart-card resolution is already best-in-class
2. **PDF editor** — the canvas template editor is more flexible than competitors' fixed layouts
3. **Eye-test cert + Annex A** — audit-grade evidence handling competitors don't have

Hold the slogan as "NDT management" and lean into those three when positioning.

---

_Created 2026-06-02 · Owner: Carl Cope (Smart Veritas BV)_
