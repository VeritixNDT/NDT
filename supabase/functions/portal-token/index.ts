// ═════════════════════════════════════════════════════════════════════════
// portal-token — mint a customer-portal magic-link token (Phase 4)
// ═════════════════════════════════════════════════════════════════════════
// Admin-gated. Given { orgId, customerId }, verifies the caller is an admin
// of that org, then returns a 24h HMAC-signed token + the portal URL. The
// admin shares/emails the URL to the customer; portal-data validates it.
//
// Secrets: PORTAL_SECRET (token signing), APP_URL (link base). Plus the
// auto-injected SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.
// ═════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { signPortalToken, signToken } from "../_shared/portal.ts";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function envOrThrow(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "missing bearer token" }, 401);

  const supabaseUrl = envOrThrow("SUPABASE_URL");
  const anonKey = envOrThrow("SUPABASE_ANON_KEY");

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonResponse({ error: "invalid session" }, 401);
  const caller = userData.user;

  let payload: { orgId?: string; customerId?: string; reportId?: string; kind?: string; contactEmail?: string };
  try { payload = await req.json(); } catch { return jsonResponse({ error: "invalid JSON body" }, 400); }
  const orgId = String(payload.orgId || "");
  const kind = payload.kind === "verify" ? "verify" : "portal";
  const customerId = String(payload.customerId || "");
  const reportId = String(payload.reportId || "");
  if (!orgId) return jsonResponse({ error: "orgId required" }, 400);
  if (kind === "portal" && !customerId) return jsonResponse({ error: "customerId required" }, 400);
  if (kind === "verify" && !reportId) return jsonResponse({ error: "reportId required" }, 400);

  // Verify the caller is an admin of this org (service role — RLS-independent).
  const service = createClient(supabaseUrl, envOrThrow("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: membership } = await service
    .from("org_members").select("role").eq("org_id", orgId).eq("user_id", caller.id).maybeSingle();
  if (!membership) return jsonResponse({ error: "not a member of this org" }, 403);
  // Portal links stay admin-only; verify tokens may be minted by any member
  // (they only expose an already-approved report for an authenticity check).
  if (kind === "portal" && membership.role !== "admin") return jsonResponse({ error: "admin access required" }, 403);

  const secret = envOrThrow("PORTAL_SECRET");
  const base = envOrThrow("APP_URL").replace(/\/+$/, "");

  // V47: report-verify QR token — long-lived (no exp) so a printed report's QR
  // keeps verifying indefinitely. reportId is the client's _vxReportKey
  // (id || reportNo::revision).
  if (kind === "verify") {
    const token = await signToken({ orgId, reportId, k: "v" }, secret);
    return jsonResponse({ ok: true, token, url: `${base}#/verify/${token}` });
  }

  // Portal v2: optionally scope the link to ONE contact + their portal role.
  // The role is read from the stored contact (authoritative — not client-set).
  // Without a contactEmail the link stays customer-wide / full-access.
  const contactEmail = String(payload.contactEmail || "").trim().toLowerCase();
  let contactClaims: { contactEmail?: string; contactName?: string; role?: string } = {};
  if (contactEmail) {
    const { data: custRow } = await service
      .from("entities").select("value").eq("org_id", orgId).eq("key", "vx-customers-v1").maybeSingle();
    // deno-lint-ignore no-explicit-any
    const customers: any[] = Array.isArray(custRow?.value) ? custRow!.value : [];
    const cust = customers.find((c) => c && c.id === customerId);
    const contact = cust && Array.isArray(cust.contacts)
      ? cust.contacts.find((k: { email?: string }) => k && String(k.email || "").trim().toLowerCase() === contactEmail)
      : null;
    if (!contact) return jsonResponse({ error: "contact not found for this customer" }, 404);
    const role = (contact.portalRole === "viewer" || contact.portalRole === "billing") ? contact.portalRole : "approver";
    contactClaims = { contactEmail, contactName: contact.name || "", role };
  }

  const exp = Date.now() + TOKEN_TTL_MS;
  const token = await signPortalToken({ orgId, customerId, exp, ...contactClaims }, secret);
  return jsonResponse({ ok: true, token, url: `${base}#/portal/${token}`, expiresAt: new Date(exp).toISOString(), contact: contactClaims.contactEmail || null, role: contactClaims.role || null });
});
