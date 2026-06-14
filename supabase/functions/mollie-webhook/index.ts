// ═════════════════════════════════════════════════════════════════════════
// mollie-webhook — mark an invoice Paid when Mollie confirms payment
// ═════════════════════════════════════════════════════════════════════════
// Mollie POSTs `id=<paymentId>` (form-encoded, no session, no signature). The
// security model is "look it up": we GET the payment from Mollie with our own
// API key and only act on it if Mollie itself reports status `paid`. A forged
// id either 404s or isn't ours, so no signature check is needed. On a paid
// payment we flip the invoice (carried in the payment metadata) to Paid in the
// org's vx-invoices-v1 store under the service role.
//
// Secrets: MOLLIE_API_KEY. Plus auto-injected SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY.
// DEPLOY WITH:  supabase functions deploy mollie-webhook --no-verify-jwt
//   (Mollie calls it with no Supabase JWT.)
// ═════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/cors.ts";

function envOrThrow(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  // Mollie sends application/x-www-form-urlencoded: id=tr_xxxxxxxx
  const raw = await req.text();
  const id = new URLSearchParams(raw).get("id") || "";
  if (!id) return jsonResponse({ received: true });   // ack non-payment pings

  const key = envOrThrow("MOLLIE_API_KEY");
  let payment: Record<string, unknown> = {};
  try {
    const pr = await fetch(`https://api.mollie.com/v2/payments/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!pr.ok) return jsonResponse({ received: true });   // unknown id / not ours — ack so Mollie stops retrying
    payment = await pr.json();
  } catch (e) {
    // Transient — return 500 so Mollie retries the webhook later.
    return jsonResponse({ error: `lookup failed: ${String(e)}` }, 500);
  }

  if (payment?.status === "paid") {
    // deno-lint-ignore no-explicit-any
    const meta = (payment as any).metadata || {};
    const orgId = meta.orgId;
    const invoiceId = meta.invoiceId;
    if (orgId && invoiceId) {
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
          invoices[i] = { ...invoices[i], status: "Paid", paidAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          await service.from("entities").update({ value: invoices }).eq("org_id", orgId).eq("key", "vx-invoices-v1");
        }
      } catch (e) {
        // Return 500 so Mollie retries (the invoice didn't get marked).
        return jsonResponse({ error: `update failed: ${String(e)}` }, 500);
      }
    }
  }
  return jsonResponse({ received: true });
});
