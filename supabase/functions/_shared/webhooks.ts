// ═════════════════════════════════════════════════════════════════════════
// SHARED — outbound webhook delivery
// ═════════════════════════════════════════════════════════════════════════
// deliverWebhooks() loads an org's enabled webhooks subscribed to an event and
// POSTs a signed JSON payload to each. Best-effort + fire-and-forget friendly:
// failures are recorded (last_status) but never thrown. The receiver verifies
// `X-Veritix-Signature: sha256=<hex>` = HMAC-SHA256(secret, rawBody).
// ═════════════════════════════════════════════════════════════════════════

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
export async function deliverWebhooks(service: any, orgId: string, event: string, data: any): Promise<void> {
  try {
    const { data: hooks } = await service
      .from("webhooks").select("id,url,secret,events,enabled").eq("org_id", orgId).eq("enabled", true);
    if (!hooks || !hooks.length) return;
    // deno-lint-ignore no-explicit-any
    const subscribed = hooks.filter((h: any) => Array.isArray(h.events) && (h.events.includes("*") || h.events.includes(event)));
    if (!subscribed.length) return;
    const body = JSON.stringify({ event, at: new Date().toISOString(), org: orgId, data });
    await Promise.allSettled(subscribed.map(async (h: { id: string; url: string; secret: string }) => {
      let status = 0;
      try {
        const sig = await hmacHex(h.secret || "", body);
        const r = await fetch(h.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Veritix-Event": event, "X-Veritix-Signature": "sha256=" + sig },
          body,
          signal: AbortSignal.timeout(8000),
        });
        status = r.status;
      } catch (_) { status = 0; }
      service.from("webhooks").update({ last_delivery_at: new Date().toISOString(), last_status: status }).eq("id", h.id).then(() => {}, () => {});
    }));
  } catch (_) { /* never throw — webhooks must not break the caller */ }
}

export const WEBHOOK_EVENTS = [
  "report.approved", "report.sent", "report.acknowledged",
  "quote.sent", "quote.accepted", "quote.declined",
  "invoice.sent", "invoice.paid",
  "job.requested",
];
