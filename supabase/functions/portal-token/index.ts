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
import { signPortalToken } from "../_shared/portal.ts";

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

  let payload: { orgId?: string; customerId?: string };
  try { payload = await req.json(); } catch { return jsonResponse({ error: "invalid JSON body" }, 400); }
  const orgId = String(payload.orgId || "");
  const customerId = String(payload.customerId || "");
  if (!orgId || !customerId) return jsonResponse({ error: "orgId and customerId required" }, 400);

  // Verify the caller is an admin of this org (service role — RLS-independent).
  const service = createClient(supabaseUrl, envOrThrow("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: membership } = await service
    .from("org_members").select("role").eq("org_id", orgId).eq("user_id", caller.id).maybeSingle();
  if (!membership || membership.role !== "admin") return jsonResponse({ error: "admin access required" }, 403);

  const exp = Date.now() + TOKEN_TTL_MS;
  const token = await signPortalToken({ orgId, customerId, exp }, envOrThrow("PORTAL_SECRET"));
  const base = envOrThrow("APP_URL").replace(/\/+$/, "");
  const url = `${base}#/portal/${token}`;
  return jsonResponse({ ok: true, token, url, expiresAt: new Date(exp).toISOString() });
});
