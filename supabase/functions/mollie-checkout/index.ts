// ═════════════════════════════════════════════════════════════════════════
// mollie-checkout — create a Mollie payment to pay one invoice
// ═════════════════════════════════════════════════════════════════════════
// PUBLIC to the customer portal (the HMAC portal token IS the credential — no
// Supabase session). Given { token, invoiceId }, it verifies the token, loads
// the invoice from the org store under the service role, confirms it belongs to
// that customer and is unpaid, then creates a Mollie payment (hosted checkout —
// iDEAL / Bancontact / SEPA / cards / Wero; Veritix never touches card data)
// and returns the checkout URL. The browser redirects there; mollie-webhook
// flips the invoice to Paid once Mollie confirms.
//
// Secrets: MOLLIE_API_KEY (test_… or live_…), PORTAL_SECRET, APP_URL. Plus
// auto-injected SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
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

  const supabaseUrl = envOrThrow("SUPABASE_URL");
  const service = createClient(
    supabaseUrl, envOrThrow("SUPABASE_SERVICE_ROLE_KEY"),
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
  const currency = String(inv.currency || "EUR").toUpperCase();

  const base = envOrThrow("APP_URL").replace(/\/+$/, "");
  const body = {
    amount: { currency, value: total.toFixed(2) },   // Mollie wants a 2-decimal STRING
    description: `Invoice ${inv.number || invoiceId}`,
    redirectUrl: `${base}#/portal/${token}?paid=${encodeURIComponent(invoiceId)}`,
    webhookUrl: `${supabaseUrl}/functions/v1/mollie-webhook`,
    metadata: { orgId: String(orgId), invoiceId },
  };

  let resp: Response;
  try {
    resp = await fetch("https://api.mollie.com/v2/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${envOrThrow("MOLLIE_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return jsonResponse({ error: `payment provider unreachable: ${String(e)}` }, 502);
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    return jsonResponse({ error: "payment provider rejected the request", detail }, 502);
  }
  const payment = await resp.json().catch(() => ({}));
  const url = payment?._links?.checkout?.href;
  if (!url) return jsonResponse({ error: "no checkout URL returned" }, 502);
  return jsonResponse({ ok: true, url });
});
