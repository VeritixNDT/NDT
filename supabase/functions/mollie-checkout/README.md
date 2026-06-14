# Online payments (Mollie) — `mollie-checkout` + `mollie-webhook`

Lets a customer pay an invoice from the portal with European methods (iDEAL,
Bancontact, SEPA, cards, and Wero as it rolls out). Veritix never touches card
data — Mollie hosts the payment page.

## Flow

1. Customer opens their portal (`#/portal/<token>`) → clicks **Pay online** on an
   unpaid invoice (`vxPortalPayInvoice` in `js/portal.js`).
2. `mollie-checkout` verifies the portal token, loads the invoice (service role),
   computes the total, and creates a **Mollie payment**; returns its checkout URL.
3. Browser redirects to Mollie's hosted page; the customer pays.
4. Mollie POSTs the payment id to `mollie-webhook`, which **fetches the payment
   from Mollie** (with our API key) and, if `status === "paid"`, flips the
   invoice to **Paid** (`paidAt`) in `vx-invoices-v1`.
5. Mollie returns the customer to `…#/portal/<token>?paid=<invoiceId>` (a soft
   "confirming your payment" banner; the invoice syncs to Paid once confirmed).

## Secrets

```bash
supabase secrets set MOLLIE_API_KEY="test_…"     # Mollie → Developers → API keys (use test_ first)
# Reused: PORTAL_SECRET, APP_URL, plus auto-injected SUPABASE_URL / SERVICE_ROLE_KEY.
```

One key powers both functions — there is no separate webhook secret (Mollie's
model is "look the payment up", so no signature to verify).

## Deploy

```bash
supabase functions deploy mollie-checkout --use-api
# Mollie calls the webhook with no Supabase JWT — disable the gateway gate:
supabase functions deploy mollie-webhook  --use-api --no-verify-jwt
```

The webhook URL Mollie will call (set automatically by mollie-checkout) is:
`https://mmgdqsilgwusehsqgyyj.supabase.co/functions/v1/mollie-webhook`
No dashboard webhook registration is needed — Mollie takes the `webhookUrl` per
payment. Just make sure `mollie-webhook` is deployed and reachable.

## Test

1. Use a **test_** API key. Make a customer → job → invoice, share a portal link.
2. Open the portal → **Pay online** → choose a method → on Mollie's test page pick
   the **"paid"** outcome (test mode lets you simulate paid/failed/expired).
3. Confirm the invoice flips to **Paid** (webhook) and the portal shows the banner.
4. Switch to a **live_** key for production (same flow, real methods + Wero).

## Notes

- Amount = invoice subtotal + single VAT rate (mirrors the client's `billCalc`),
  sent to Mollie as a 2-decimal string in the invoice's own currency.
- `webhookUrl` must be public HTTPS (the Supabase function URL is) — Mollie won't
  call localhost, so test the webhook against the deployed function.
- The webhook does a read-modify-write on the `vx-invoices-v1` entities blob;
  low-frequency, acceptable for now (revisit if invoices move to per-row entities).
- Admin-side "send a payment link" is a future add — the same `mollie-checkout`
  core can be reused behind a JWT-gated entry.
