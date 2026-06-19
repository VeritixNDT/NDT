// ═════════════════════════════════════════════════════════════════════════
// stripe-webhook — mark an invoice Paid when Stripe confirms payment
// ═════════════════════════════════════════════════════════════════════════
// Stripe POSTs here (no Supabase session). We verify the Stripe-Signature
// against STRIPE_WEBHOOK_SECRET, and on `checkout.session.completed` with a
// paid status, flip the invoice (carried in the session metadata) to Paid in
// the org's vx-invoices-v1 store under the service role. The client picks the
// change up on its next sync / portal reload.
//
// Secrets: STRIPE_WEBHOOK_SECRET. Plus auto-injected SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY.
// DEPLOY WITH:  supabase functions deploy stripe-webhook --no-verify-jwt
//   (Stripe calls it with no Supabase JWT — the signature is the credential.)
// ═════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/cors.ts";
import { deliverWebhooks } from "../_shared/webhooks.ts";

function envOrThrow(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

const enc = new TextEncoder();
function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmacHex(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return hex(new Uint8Array(sig));
}
// Verify Stripe's `t=<ts>,v1=<sig>,...` header. Constant-time-ish compare;
// rejects signatures older than the tolerance (replay protection).
async function verifyStripe(raw: string, header: string, secret: string, toleranceSec = 300): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => {
    const i = p.indexOf("="); return [p.slice(0, i), p.slice(i + 1)];
  }));
  const t = parts["t"]; const v1 = parts["v1"];
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const expected = await hmacHex(`${t}.${raw}`, secret);
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  const sig = req.headers.get("Stripe-Signature") || "";
  const raw = await req.text();   // raw body is required for signature verification
  let ok = false;
  try { ok = await verifyStripe(raw, sig, envOrThrow("STRIPE_WEBHOOK_SECRET")); } catch { ok = false; }
  if (!ok) return jsonResponse({ error: "invalid signature" }, 400);

  // deno-lint-ignore no-explicit-any
  let event: any;
  try { event = JSON.parse(raw); } catch { return jsonResponse({ error: "invalid JSON" }, 400); }

  if (event?.type === "checkout.session.completed") {
    const s = event.data?.object || {};
    // Only a confirmed payment marks an invoice Paid. Stripe also fires
    // checkout.session.completed for async/delayed methods with
    // payment_status: "unpaid" — the old `|| s.status === "complete"` fallback
    // flipped those to Paid with no money received.
    const paid = s.payment_status === "paid";
    const orgId = s.metadata?.orgId;
    const invoiceId = s.metadata?.invoiceId;
    if (paid && orgId && invoiceId) {
      try {
        const service = createClient(
          envOrThrow("SUPABASE_URL"), envOrThrow("SUPABASE_SERVICE_ROLE_KEY"),
          { auth: { persistSession: false } },
        );
        const { data: row } = await service
          .from("entities").select("value").eq("org_id", orgId).eq("key", "vx-invoices-v1").maybeSingle();
        // deno-lint-ignore no-explicit-any
        const invoices: any[] = Array.isArray(row?.value) ? row!.value : [];
        const i = invoices.findIndex((x) => x && x.id === invoiceId);
        if (i >= 0 && invoices[i].status !== "Paid") {
          // Guard against under-collection (e.g. the invoice was edited after
          // checkout was created): the charge must cover the invoice total and
          // match its currency, or we leave it unpaid for manual reconciliation.
          const inv = invoices[i];
          // deno-lint-ignore no-explicit-any
          const sub = (Array.isArray(inv.lineItems) ? inv.lineItems : []).reduce((acc: number, li: any) => acc + (Number(li.qty) || 0) * (Number(li.unitPrice) || 0), 0);
          const expectedCents = Math.round(sub * (1 + (Number(inv.vatRate) || 0) / 100) * 100);
          const gotCents = Number(s.amount_total) || 0;
          const curOk = !inv.currency || !s.currency || String(inv.currency).toLowerCase() === String(s.currency).toLowerCase();
          if (!curOk || gotCents + 1 < expectedCents) {
            console.error("stripe-webhook amount/currency mismatch — NOT marking paid", JSON.stringify({ invoiceId, expectedCents, gotCents, invCurrency: inv.currency, sCurrency: s.currency }));
            return jsonResponse({ received: true, warning: "amount mismatch — left unpaid" });
          }
          invoices[i] = { ...invoices[i], status: "Paid", paidAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          await service.from("entities").update({ value: invoices }).eq("org_id", orgId).eq("key", "vx-invoices-v1");
          // Fan the payment out to the org's webhooks (signed, best-effort).
          await deliverWebhooks(service, orgId, "invoice.paid", { id: invoiceId, number: invoices[i].number, customerId: invoices[i].customerId, jobId: invoices[i].jobId, paidAt: invoices[i].paidAt });
        }
      } catch (e) {
        // Acknowledge to Stripe anyway (it retries on non-2xx); log for ops.
        console.error("stripe-webhook update failed", String(e));
      }
    }
  }
  return jsonResponse({ received: true });
});
