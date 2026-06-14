// ═════════════════════════════════════════════════════════════════════════
// stripe-checkout — create a Stripe Checkout Session to pay one invoice
// ═════════════════════════════════════════════════════════════════════════
// PUBLIC to the customer portal (the HMAC portal token IS the credential — no
// Supabase session). Given { token, invoiceId }, it verifies the token, loads
// the invoice from the org store under the service role, confirms it belongs to
// that customer and is unpaid, then creates a Stripe Checkout Session (hosted
// payment page — Veritix never touches card data) and returns its URL. The
// browser redirects there; stripe-webhook flips the invoice to Paid on success.
//
// Secrets: STRIPE_SECRET_KEY, PORTAL_SECRET, APP_URL. Plus auto-injected
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
// Deploy with the default JWT gate (the portal's anon key satisfies the
// gateway; the token is the real credential), same as portal-data.
// ═════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { verifyPortalToken } from "../_shared/portal.ts";

function envOrThrow(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

// Mirror the client's billCalc: subtotal from line items + a single VAT rate.
// deno-lint-ignore no-explicit-any
function invoiceTotal(doc: any): number {
  const items = Array.isArray(doc?.lineItems) ? doc.lineItems : [];
  const subtotal = items.reduce(
    // deno-lint-ignore no-explicit-any
    (s: number, it: any) => s + (parseFloat(it?.qty) || 0) * (parseFloat(it?.unitPrice) || 0),
    0,
  );
  const rate = parseFloat(doc?.vatRate) || 0;
  return Math.round((subtotal + subtotal * rate / 100) * 100) / 100;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  let payload: { token?: string; invoiceId?: string };
  try { payload = await req.json(); } catch { return jsonResponse({ error: "invalid JSON body" }, 400); }
  const token = String(payload.token || "");
  const invoiceId = String(payload.invoiceId || "");
  if (!invoiceId) return jsonResponse({ error: "invoiceId required" }, 400);

  const claims = await verifyPortalToken(token, envOrThrow("PORTAL_SECRET"));
  if (!claims) return jsonResponse({ error: "This portal link is invalid or has expired." }, 401);
  const { orgId, customerId } = claims;

  const service = createClient(
    envOrThrow("SUPABASE_URL"), envOrThrow("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  const { data: row } = await service
    .from("entities").select("value").eq("org_id", orgId).eq("key", "vx-invoices-v1").maybeSingle();
  // deno-lint-ignore no-explicit-any
  const invoices: any[] = Array.isArray(row?.value) ? row!.value : [];
  const inv = invoices.find((i) => i && i.id === invoiceId && i.customerId === customerId);
  if (!inv) return jsonResponse({ error: "Invoice not found." }, 404);
  if (inv.status === "Paid") return jsonResponse({ error: "This invoice is already paid." }, 409);

  const total = invoiceTotal(inv);
  if (!(total > 0)) return jsonResponse({ error: "Nothing to pay on this invoice." }, 400);
  const currency = String(inv.currency || "EUR").toLowerCase();
  const amountMinor = Math.round(total * 100);

  const base = envOrThrow("APP_URL").replace(/\/+$/, "");
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", `${base}#/portal/${token}?paid=${encodeURIComponent(invoiceId)}`);
  form.set("cancel_url", `${base}#/portal/${token}`);
  form.set("client_reference_id", invoiceId);
  form.set("metadata[orgId]", String(orgId));
  form.set("metadata[invoiceId]", invoiceId);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", currency);
  form.set("line_items[0][price_data][unit_amount]", String(amountMinor));
  form.set("line_items[0][price_data][product_data][name]", `Invoice ${inv.number || invoiceId}`);

  let resp: Response;
  try {
    resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${envOrThrow("STRIPE_SECRET_KEY")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
  } catch (e) {
    return jsonResponse({ error: `payment provider unreachable: ${String(e)}` }, 502);
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    return jsonResponse({ error: "payment provider rejected the request", detail }, 502);
  }
  const session = await resp.json().catch(() => ({}));
  if (!session?.url) return jsonResponse({ error: "no checkout URL returned" }, 502);
  return jsonResponse({ ok: true, url: session.url });
});
