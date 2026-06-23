# Veritix NDT Inspect — Pilot Notes

Living log for the real-world pilot (Carl running real company reporting through
the app). Append as you go; I fix → commit → it auto-deploys to veritix.io.

**Started:** 2026-06-23
**Environment:** veritix.io (Netlify frontend + Supabase backend, live since 2026-06-12)
**Build at start:** `VX_BUILD = 2026-06-23.2` · `VX_SHOW_TEST_TOOLS = false`

---

## How to use this doc
- Add a row to **Issue log** for anything that breaks, looks wrong, or feels off.
- Keep it quick — area + what you saw + (optional) steps. I'll triage, fix, and
  fill in the **Fix** column with the commit.
- Reset test data between passes: **Settings → Database → Danger zone → Delete
  all reports** (type `DELETE`; reports only — customers/jobs/settings stay).
- Confirm you're on the current build: footer should read the `VX_BUILD` above;
  if stale after a deploy, hard-refresh once (Ctrl+Shift+R).

---

## Validation focus (still pending real-world eyeball)
Per the competitive audit — these are verified in structure but want a real pass:

- [ ] **PDF print fidelity** — generate + print a real report PDF; check it's
      acceptable (Gotenberg vector container not wired → raster fallback for now).
- [ ] **Cross-device QR verify** — print a sealed report, scan its QR on a phone,
      confirm the public verify page shows the sealed report.
- [ ] **Email delivery** — send a report / invoice; confirm it arrives from
      noreply@veritix.io and renders.
- [ ] **Customer portal** — share a portal link; open on another device; check
      read access, e-sign/ack, work-request forms.
- [ ] **2-device concurrency** — two people editing / numbering reports at once;
      watch for clobbers or duplicate report numbers.
- [ ] **Full field flow** — Customer → Job → Report(s) → approve/seal → PDF →
      (optional) invoice → portal, with no re-entry.

---

## Issue log

| # | Date | Area | Severity | Observation / steps | Status | Fix (commit) |
|---|------|------|----------|---------------------|--------|--------------|
| _ex_ | 2026-06-23 | _Reports_ | _low_ | _Example row — replace me._ | open | — |

<!-- Add new rows above. Severity: low / med / high / blocker. Status: open / fixing / fixed / wontfix. -->

---

## Deferred / out of scope for this pilot
- **Stripe go-live** — NOT needed for this pilot (Carl, 2026-06-23). Online
  invoice payment stays in test mode; revisit before charging real customers.
- **Gotenberg vector PDF** — code supports `GOTENBERG_URL`; container not deployed.
  PDFs render via raster/print fallback until then.
- **AI vision photo-analysis** — built but HELD as a future update (on branch
  `feat/ai-vision`; see `VISION_SPEC.md`).
- **Live ERP/accounting API push** — CSV export is live; live API push deferred,
  awaiting provider choice + credentials.
