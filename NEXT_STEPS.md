# Next steps

Last updated 2026-05-17 at commit `d0eadae`. Phase 1 (Supabase transport
swap) is fully shipped — see `SUPABASE_SETUP.md` "What's shipped vs
deferred" for the boundary.

## Carl — next session

1. **Build report templates in the PDF editor** (Settings → PDF editor,
   desktop only).
2. **Create real reports** against those templates to exercise the
   `vx-reports-v1` / `vx-defects-v1` data flow end-to-end on Supabase.
3. **Cross-device check**: with the second-browser inspector session,
   confirm a teammate edit fires the realtime toast + auto-rerender on
   the admin browser. (Realtime is verified; this is a real-data
   sanity check.)

## Outstanding from Phase 1

- **CSS cascade smoke-test** — never walked through. Open the app and
  click through Overview / Reports / Defects / Settings sub-sections /
  PDF editor / both themes. Flag anything mis-styled. The refactor
  re-ordered the CSS link chain (`tokens → base → components →
  features → editor → print`); theoretically equivalent but worth
  eyeballing.

## Next product priority

- **Reports feature work** — the module is shipped (~1.9k lines in
  `js/reports.js`) but hasn't been exercised with real data. Once
  Carl's PDF templates exist and reports are being created, surface
  any gaps or polish items here.

## Deferred — Phase 2 (infra)

See `SUPABASE_SETUP.md` for the full list. Short version: normalised
`reports` / `defects` / `inspectors` tables, real email delivery for
invites (Supabase Edge Function), members listing UI, plan / billing /
Stripe surfaces.

## Deferred — Phase 3 (production hardening)

Email confirmation on, real Site URLs, SRI on CDN scripts, deploy
pipeline (Vercel / Netlify / Cloudflare Pages), rate limiting on
signup.
