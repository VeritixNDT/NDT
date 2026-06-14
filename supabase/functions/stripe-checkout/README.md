# Stripe payments — `stripe-checkout` + `stripe-webhook`

Lets a customer pay an invoice online from the portal. Veritix never touches
card data — Stripe hosts the payment page (Checkout).

## Flow

1. Customer opens their portal (`#/portal/<token>`) → clicks **Pay online** on an
   unpaid invoice (`vxPortalPayInvoice` in `js/portal.js`).
2. `stripe-checkout` verifies the portal token, loads the invoice (service role),
   computes the total, and creates a **Stripe Checkout Session**; returns its URL.
3. Browser redirects to Stripe's hosted page; the customer pays.
4. Stripe POSTs `checkout.session.completed` to `stripe-webhook`, which verifies
   the signature and flips the invoice to **Paid** (`paidAt`) in `vx-invoices-v1`.
5. Stripe returns the customer to `…#/portal/<token>?paid=<invoiceId>` (a
   "payment received" banner shows; the invoice syncs to Paid shortly after).

## Secrets

```bash
supabase secrets set STRIPE_SECRET_KEY="sk_live_…"        # Stripe → Developers → API keys
supabase secrets set STRIPE_WEBHOOK_SECRET="whsec_…"      # shown when you add the webhook (below)
# Reused: PORTAL_SECRET, APP_URL, plus auto-injected SUPABASE_URL / SERVICE_ROLE_KEY.
```

## Deploy

```bash
supabase functions deploy stripe-checkout --use-api
# The webhook is called by Stripe with NO Supabase JWT — disable the gateway gate:
supabase functions deploy stripe-webhook --use-api --no-verify-jwt
```

## Stripe dashboard setup

1. **API keys** → copy the secret key → `STRIPE_SECRET_KEY`.
2. **Developers → Webhooks → Add endpoint:**
   - URL: `https://mmgdqsilgwusehsqgyyj.supabase.co/functions/v1/stripe-webhook`
   - Event: `checkout.session.completed`
   - Copy the **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`, then
     re-run `supabase secrets set` and redeploy `stripe-webhook`.
3. Test with `sk_test_…` + a [test card](https://stripe.com/docs/testing) (4242 4242 4242 4242) before going live.

## Notes

- Amount = invoice subtotal + single VAT rate (mirrors the client's `billCalc`),
  in the invoice's own currency, sent to Stripe in minor units.
- The webhook does a read-modify-write on the `vx-invoices-v1` entities blob.
  Invoice payment is low-frequency, so the race window is acceptable for now;
  revisit if invoices ever move to per-row entities like reports did.
- Admin-side "send a payment link" (vs. customer self-serve) is a future add — the
  same `stripe-checkout` core can be reused behind a JWT-gated entry.
