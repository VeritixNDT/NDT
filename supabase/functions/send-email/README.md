# `send-email` Edge Function

The single transactional-email entry point for Veritix. Everything the app
sends as email — member invites today; quotes, invoices, and customer-portal
links in later phases — goes through this one function.

## Why a function (and not the browser)

Sending email needs a provider API key, and that key must never ship in
client code. The function holds the secret, verifies the caller's Supabase
JWT, and renders the email body **server-side** from a fixed whitelist of
templates. The client only names a template type and passes structured data
— it can never supply raw HTML or an arbitrary body, so a signed-in user
can't turn the endpoint into a spam relay.

## Files

| File | Role |
|---|---|
| `index.ts` | HTTP entry: auth, validation, admin gating, Resend call |
| `templates.ts` | Server-side HTML/text templates (whitelist) |
| `../_shared/cors.ts` | Shared CORS headers + JSON response helper |

## Contract

`POST` with a Supabase user JWT in `Authorization: Bearer <token>`
(supabase-js does this automatically via `functions.invoke`).

```jsonc
// invite (admin-gated against org_members)
{ "type": "invite", "to": "new.user@example.com", "role": "inspector", "orgId": "<uuid>" }

// quote / invoice (JWT-gated only; rendered entirely from the payload)
{ "type": "invoice", "to": "client@example.com", "number": "INV-2026-001",
  "customerName": "ACME Ltd", "companyName": "Smart Veritas BV", "currency": "EUR",
  "subtotal": 2000, "vat": 420, "vatRate": 21, "total": 2420, "dueDate": "2026-07-01",
  "lineItems": [{ "description": "UT of welds", "qty": 10, "unitPrice": 150 }], "notes": "" }
```

Responses: `{ "ok": true, "id": "<resend-id>" }` on success; `{ "error": "..." }`
with a 4xx/5xx status otherwise. `invite` requires the caller be an **admin**
of `orgId` (verified server-side against `org_members` under the service role).
`quote`/`invoice` only require a valid session — the client computes the totals
and the template just formats them.

## Required secrets

```bash
supabase secrets set RESEND_API_KEY="re_..."
supabase secrets set EMAIL_FROM="Veritix <noreply@mail.smartveritas.com>"
supabase secrets set APP_URL="https://app.smartveritas.com"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically by the Supabase runtime — don't set them manually.

`APP_URL` is read only from this env, never from the client, so invite links
can't be spoofed toward a phishing domain.

## Deploy

```bash
supabase functions deploy send-email
```

The function uses verify-JWT (the default) — Supabase rejects unauthenticated
calls at the gateway before our code even runs.

## Adding a template (later phases)

1. Add a `render<Type>()` + a `case` in `templates.ts` → `renderTemplate()`.
2. Add the `type` to `ALLOWED_TYPES` in `index.ts`.
3. If it's org-scoped, add it to `ADMIN_ONLY_TYPES` and supply `orgId`.

## Local testing

```bash
supabase functions serve send-email --env-file ./supabase/.env.local
# then invoke with a real user JWT:
curl -i -X POST http://localhost:54321/functions/v1/send-email \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"type":"invite","to":"you@example.com","role":"inspector","orgId":"<uuid>"}'
```
