// ═════════════════════════════════════════════════════════════════════════
// webhook-emit — let the app emit client-side events to webhooks
// ═════════════════════════════════════════════════════════════════════════
// Events like report.approved / report.sent / quote.sent / invoice.sent happen
// in the app, not the backend. The app POSTs { event, orgId, data } here; we
// verify the caller's Supabase session + org membership, then fan the event out
// to the org's webhooks (signed, best-effort). Server-side events (portal
// decisions, invoice.paid) are delivered directly from their own functions.
//
// JWT-gated. Auto-injected: SUPABASE_URL / SUPABASE_ANON_KEY / SERVICE_ROLE.
// ═════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { deliverWebhooks, WEBHOOK_EVENTS } from "../_shared/webhooks.ts";

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
  const userClient = createClient(envOrThrow("SUPABASE_URL"), envOrThrow("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return jsonResponse({ error: "invalid session" }, 401);

  let body: { event?: string; orgId?: string; data?: unknown };
  try { body = await req.json(); } catch { return jsonResponse({ error: "invalid JSON body" }, 400); }
  const event = String(body.event || "");
  const orgId = String(body.orgId || "");
  if (!WEBHOOK_EVENTS.includes(event)) return jsonResponse({ error: "unknown event" }, 400);
  if (!orgId) return jsonResponse({ error: "orgId required" }, 400);

  const service = createClient(envOrThrow("SUPABASE_URL"), envOrThrow("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  // Confirm the caller belongs to the org they're emitting for.
  const { data: member } = await service.from("org_members").select("org_id").eq("org_id", orgId).eq("user_id", userData.user.id).maybeSingle();
  if (!member) return jsonResponse({ error: "not a member of this org" }, 403);

  await deliverWebhooks(service, orgId, event, body.data || {});
  return jsonResponse({ ok: true });
});
