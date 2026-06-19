// ═════════════════════════════════════════════════════════════════════════
// VERITIX NDT — send-email Edge Function (Phase 0 foundation)
// ═════════════════════════════════════════════════════════════════════════
// The app's single transactional-email entry point. Everything that needs
// to leave the system as email — member invites today; quotes, invoices,
// and customer-portal links in later phases — goes through here.
//
// Design decisions:
//   • Template whitelist. The client names a template + passes structured
//     data; the HTML is rendered server-side (templates.ts). The client can
//     NEVER supply raw HTML or a free-choice recipient body, so a signed-in
//     user can't turn this into a spam relay.
//   • JWT-gated. The caller's Supabase session is verified on every call.
//     No anon sends.
//   • Admin-gated where it matters. Org-scoped templates (invite) verify
//     the caller is an admin of the target org via a service-role read of
//     org_members — RLS-independent and forge-proof.
//   • Resend as the provider. Set RESEND_API_KEY + a DKIM/SPF-verified
//     sending domain (see README). Don't roll your own SMTP.
//
// Required secrets (supabase secrets set ...):
//   RESEND_API_KEY   — Resend API key
//   EMAIL_FROM       — e.g. "Veritix <noreply@mail.smartveritas.com>"
//   APP_URL          — canonical app URL used to build links (e.g.
//                      https://app.smartveritas.com). NEVER taken from the
//                      client, so invite links can't be spoofed to phishing.
// Auto-injected by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY,
//   SUPABASE_SERVICE_ROLE_KEY.
// ═════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { renderTemplate } from "./templates.ts";

// Template types this function will render at all.
const ALLOWED_TYPES = new Set(["invite", "quote", "invoice", "portal-link", "notify"]);
// Subset that require the caller be an admin of `orgId`.
const ADMIN_ONLY_TYPES = new Set(["invite"]);

const RESEND_ENDPOINT = "https://api.resend.com/emails";

interface SendPayload {
  type?: string;
  to?: string;
  role?: string;
  orgId?: string;
}

function envOrThrow(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Anti-relay allow-list: the set of lowercased addresses that belong to THIS
// org's own data — customer contact + portal emails, and the org's own
// addresses. Customer-facing sends may only target one of these, so a signed-in
// user can't turn the function into a phishing relay to arbitrary recipients.
// deno-lint-ignore no-explicit-any
async function orgRecipientSet(svc: any, orgId: string): Promise<Set<string>> {
  const set = new Set<string>();
  const { data: rows } = await svc.from("entities").select("key,value")
    .eq("org_id", orgId).in("key", ["vx-customers-v1", "vx-company-v1"]);
  // deno-lint-ignore no-explicit-any
  (rows || []).forEach((r: any) => {
    if (r.key === "vx-customers-v1" && Array.isArray(r.value)) {
      // deno-lint-ignore no-explicit-any
      r.value.forEach((c: any) => {
        (Array.isArray(c?.portalEmails) ? c.portalEmails : []).forEach((e: unknown) => set.add(String(e).trim().toLowerCase()));
        (Array.isArray(c?.contacts) ? c.contacts : []).forEach((ct: { email?: string }) => { if (ct?.email) set.add(String(ct.email).trim().toLowerCase()); });
      });
    } else if (r.key === "vx-company-v1" && r.value) {
      const co = r.value as { email?: string; requestEmail?: string };
      [co.email, co.requestEmail].forEach((e) => { if (e) set.add(String(e).trim().toLowerCase()); });
    }
  });
  return set;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  // ── Authenticate the caller ─────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "missing bearer token" }, 401);
  }

  const supabaseUrl = envOrThrow("SUPABASE_URL");
  const anonKey = envOrThrow("SUPABASE_ANON_KEY");

  // A user-scoped client (forwards the caller's JWT) just to resolve who
  // they are. We do NOT use it for the admin check — that runs under the
  // service role below so RLS can't be tricked.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonResponse({ error: "invalid session" }, 401);
  }
  const caller = userData.user;

  // ── Parse + validate the request ────────────────────────────────────────
  let payload: SendPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  const type = String(payload.type || "");
  const to = String(payload.to || "").trim().toLowerCase();

  if (!ALLOWED_TYPES.has(type)) {
    return jsonResponse({ error: `unsupported template type: ${type}` }, 400);
  }
  if (!to || !isEmail(to)) {
    return jsonResponse({ error: "invalid recipient address" }, 400);
  }

  // Service-role client for trusted server-side reads (org membership,
  // org name). Never expose this key to the browser.
  const serviceClient = createClient(
    supabaseUrl,
    envOrThrow("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  // ── Authorise: every send is org-scoped, and the caller must belong to that
  // org. Without this any signed-in user (incl. a fresh trial signup) could
  // send branded mail from our verified domain to any address. ──────────────
  const orgId = String(payload.orgId || "");
  if (!orgId) return jsonResponse({ error: "orgId required" }, 400);
  const { data: membership } = await serviceClient
    .from("org_members").select("role")
    .eq("org_id", orgId).eq("user_id", caller.id).maybeSingle();
  if (!membership) return jsonResponse({ error: "not a member of this org" }, 403);
  if (ADMIN_ONLY_TYPES.has(type) && membership.role !== "admin") {
    return jsonResponse({ error: "admin access required" }, 403);
  }
  // Anti-relay: customer-facing sends may only target an address that exists in
  // this org's own data. Invites are exempt (an admin invites a new address).
  if (type !== "invite") {
    const allowed = await orgRecipientSet(serviceClient, orgId);
    if (!allowed.has(to)) {
      return jsonResponse({ error: "recipient is not a known contact for this organisation" }, 403);
    }
  }

  // ── Build the email per template ────────────────────────────────────────
  let rendered;
  try {
    if (type === "invite") {
      // Org name (for branding) + inviter display name.
      const { data: org } = await serviceClient
        .from("orgs")
        .select("name")
        .eq("id", orgId)
        .maybeSingle();

      const inviterName =
        (caller.user_metadata?.name as string | undefined) ||
        (caller.email ? caller.email.split("@")[0] : "");

      rendered = renderTemplate("invite", {
        orgName: org?.name || "",
        role: payload.role || "inspector",
        inviterName,
        signupUrl: envOrThrow("APP_URL"),
      });
    } else if (type === "quote" || type === "invoice" || type === "portal-link" || type === "notify") {
      // Document / link emails render entirely from the structured payload the
      // client sends — no DB lookup, JWT-gated only.
      rendered = renderTemplate(type, payload as unknown as Record<string, unknown>);
    } else {
      // ALLOWED_TYPES guards this, but keep the compiler + future-self honest.
      return jsonResponse({ error: `unhandled type: ${type}` }, 400);
    }
  } catch (e) {
    return jsonResponse({ error: `render failed: ${String(e)}` }, 500);
  }

  // ── Send via Resend ─────────────────────────────────────────────────────
  let resendResp: Response;
  try {
    resendResp = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${envOrThrow("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: envOrThrow("EMAIL_FROM"),
        to: [to],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
    });
  } catch (e) {
    return jsonResponse({ error: `email transport failed: ${String(e)}` }, 502);
  }

  if (!resendResp.ok) {
    const detail = await resendResp.text().catch(() => "");
    return jsonResponse(
      { error: "email provider rejected the message", detail },
      502,
    );
  }

  const result = await resendResp.json().catch(() => ({}));
  return jsonResponse({ ok: true, id: result?.id || null });
});
