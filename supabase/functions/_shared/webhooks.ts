// ═════════════════════════════════════════════════════════════════════════
// SHARED — outbound webhook delivery
// ═════════════════════════════════════════════════════════════════════════
// deliverWebhooks() loads an org's enabled webhooks subscribed to an event and
// POSTs a signed JSON payload to each. Best-effort + fire-and-forget friendly:
// failures are recorded (last_status) but never thrown. The receiver verifies
// `X-Veritix-Signature: sha256=<hex>` = HMAC-SHA256(secret, rawBody).
// ═════════════════════════════════════════════════════════════════════════

// ── SSRF guard ───────────────────────────────────────────────────────────
// Webhook URLs are org-supplied and delivery is triggered by PUBLIC, token-
// authed customer actions (portal-submit). Without this a hook pointed at
// http://169.254.169.254/… or localhost would make our service-role function
// POST internal/metadata endpoints. We require https and refuse any private /
// loopback / link-local / metadata target, resolving hostnames to cut the
// DNS-rebinding window.
function isPrivateIp(ip: string): boolean {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;        // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true;                       // multicast / reserved
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::" || lower === "") return true;
  if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7));
  if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  return false;
}
export async function isSafeWebhookUrl(raw: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return false;
  if (/^[0-9.]+$/.test(host) || host.includes(":")) return !isPrivateIp(host); // IP literal
  try {
    const ips: string[] = [];
    for (const t of ["A", "AAAA"] as const) {
      try { (await Deno.resolveDns(host, t)).forEach((ip) => ips.push(ip)); } catch (_) { /* type may not resolve */ }
    }
    if (!ips.length) return false;
    return ips.every((ip) => !isPrivateIp(ip));
  } catch (_) { return false; }
}

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
        // SSRF guard — never POST to a private/internal/non-https target.
        if (!(await isSafeWebhookUrl(h.url))) {
          service.from("webhooks").update({ last_delivery_at: new Date().toISOString(), last_status: -1 }).eq("id", h.id).then(() => {}, () => {});
          return;
        }
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
