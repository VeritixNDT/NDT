# ai-review Edge Function

Pre-issue AI review of an inspection report. The SPA sends a **stripped,
structured** copy of one report; this function asks Claude to flag problems an
inspector or approver might miss and returns structured findings.

- **Surface (UI):** `js/ai-review.js` → the **✦ AI** button on each report row
  in Reports. Calls `sb.functions.invoke('ai-review', { body: { report } })`.
- **Why server-side:** the Anthropic API key is a secret and must never ship in
  the static SPA. The browser only ever talks to this JWT-gated function.
- **Advisory only:** the model never edits the report — it returns findings a
  qualified human acts on. Low cost-of-error.

## How it works

1. JWT-gated — verifies the caller's Supabase session (`auth.getUser`). No anon
   use (an open, billed LLM endpoint would be abused instantly).
2. Validates the `report` object and rejects oversized payloads (un-stripped
   media) with 413.
3. Calls Anthropic Messages API (`claude-opus-4-8`, adaptive thinking, medium
   effort) with `output_config.format` (JSON schema) so the reply is always
   parseable structured findings: `{ summary, overallRisk, findings[] }`.

## Secret

```
ANTHROPIC_API_KEY   — Anthropic API key (console.anthropic.com → API keys)
```

Set it in `supabase/.env.prod` (git-ignored), then push:

```powershell
$env:NODE_EXTRA_CA_CERTS="$env:USERPROFILE\corp-ca-bundle.pem"   # corporate TLS
$env:SUPABASE_ACCESS_TOKEN="sbp_…"
supabase secrets set --project-ref mmgdqsilgwusehsqgyyj --env-file ./supabase/.env.prod
```

## Deploy

Public-facing (default JWT verification — the anon key satisfies the gateway,
the user's JWT is verified inside the function):

```powershell
supabase functions deploy ai-review --project-ref mmgdqsilgwusehsqgyyj --use-api
```

## Model / cost knob

`MODEL` in `index.ts` is `claude-opus-4-8` (most capable — missing a real defect
is the costly error here). To trade some accuracy for lower cost/latency, swap
it to `claude-sonnet-4-6` or `claude-haiku-4-5` — no other change needed.
