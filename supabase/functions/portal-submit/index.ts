// ═════════════════════════════════════════════════════════════════════════
// portal-submit — customer write-back channel (Portal v2, Pillar A keystone)
// ═════════════════════════════════════════════════════════════════════════
// PUBLIC (no Supabase session) — the HMAC portal token IS the credential, the
// same one portal-data / stripe-checkout verify. This is the ONLY way a
// customer writes anything, and it is deliberately append-only: every action
// is recorded as a write-once `vx-portal-event::<id>` row in the org's entity
// store. The customer can NEVER mutate a report / quote / invoice directly —
// the inspector's app ingests these events and applies them. Mirrors the
// per-report-row pattern so two events never clobber each other.
//
// Validates that the target document actually belongs to THIS customer before
// recording, so a stolen/guessed id can't attach an event to someone else's work.
//
// Body: { token, kind, payload }
//   kind = 'ack-report'     payload { reportNo, revision?, by?, note? }
//        | 'quote-decision' payload { quoteId, decision:'Accepted'|'Declined', by?, note? }
//        | 'work-request'   payload { title, method?, scope?, urgency?, site?, by? }
//        | 'comment'        payload { targetType, targetId, text, by? }
//
// Secrets: PORTAL_SECRET. Auto-injected: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
// ═════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { verifyPortalToken } from "../_shared/portal.ts";

const EVENT_PREFIX = "vx-portal-event::";
const ALLOWED_KINDS = new Set(["ack-report", "quote-decision", "work-request", "comment"]);
const MAX_TEXT = 4000;
const MAX_SHORT = 400;

function envOrThrow(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
// deno-lint-ignore no-explicit-any
function asArray(v: any): any[] { return Array.isArray(v) ? v : []; }
function clip(v: unknown, n: number): string { return String(v == null ? "" : v).slice(0, n); }

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  let body: { token?: string; kind?: string; payload?: Record<string, unknown> };
  try { body = await req.json(); } catch { return jsonResponse({ error: "invalid JSON body" }, 400); }

  const claims = await verifyPortalToken(String(body.token || ""), envOrThrow("PORTAL_SECRET"));
  if (!claims) return jsonResponse({ error: "This portal link is invalid or has expired." }, 401);
  const { orgId, customerId } = claims;

  const kind = String(body.kind || "");
  if (!ALLOWED_KINDS.has(kind)) return jsonResponse({ error: "unknown action" }, 400);
  const p = (body.payload && typeof body.payload === "object") ? body.payload : {};

  const service = createClient(
    envOrThrow("SUPABASE_URL"), envOrThrow("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  // Load the org slices we need to (a) scope the customer and (b) validate the
  // target belongs to them. Cheap: a handful of keys for one org.
  const { data: rows, error: readErr } = await service
    .from("entities").select("key,value").eq("org_id", orgId)
    .in("key", ["vx-customers-v1", "vx-jobs-v1", "vx-quotes-v1"]);
  if (readErr) return jsonResponse({ error: "could not load portal data" }, 500);
  const byKey: Record<string, unknown> = {};
  (rows || []).forEach((r) => { byKey[r.key] = r.value; });

  const cust = asArray(byKey["vx-customers-v1"]).find((c) => c && c.id === customerId);
  if (!cust) return jsonResponse({ error: "Customer not found." }, 404);
  const myJobIds = new Set(
    asArray(byKey["vx-jobs-v1"]).filter((j) => j && j.customerId === customerId).map((j) => j.id),
  );

  // ── Build + validate the event by kind ──────────────────────────────────
  // deno-lint-ignore no-explicit-any
  const ev: Record<string, any> = { kind, customerId, status: "new", by: clip(p.by, MAX_SHORT) };

  if (kind === "ack-report") {
    const reportNo = clip(p.reportNo, MAX_SHORT);
    if (!reportNo) return jsonResponse({ error: "reportNo required" }, 400);
    // Confirm a report with this number belongs to one of the customer's jobs
    // and has been issued (Approved/Sent). Reports live in per-report rows.
    const { data: reportRows } = await service
      .from("entities").select("value").eq("org_id", orgId).like("key", "vx-report::%");
    const reportsSource = (reportRows && reportRows.length)
      ? reportRows.map((r) => r.value).filter(Boolean)
      : asArray(byKey["vx-reports-v1"]);
    const ok = reportsSource.some((r) =>
      r && String(r.reportNo) === reportNo && myJobIds.has(r.jobId) &&
      (r.stage === "Approved" || r.stage === "Sent"));
    if (!ok) return jsonResponse({ error: "report not found for this customer" }, 404);
    ev.reportNo = reportNo;
    ev.revision = clip(p.revision, 16);
    ev.note = clip(p.note, MAX_TEXT);
  } else if (kind === "quote-decision") {
    const quoteId = clip(p.quoteId, MAX_SHORT);
    const decision = clip(p.decision, 16);
    if (decision !== "Accepted" && decision !== "Declined") {
      return jsonResponse({ error: "decision must be Accepted or Declined" }, 400);
    }
    const q = asArray(byKey["vx-quotes-v1"]).find((x) => x && x.id === quoteId);
    if (!q || q.customerId !== customerId) return jsonResponse({ error: "quote not found for this customer" }, 404);
    if (q.status !== "Sent") return jsonResponse({ error: "this quote is no longer awaiting a decision" }, 409);
    ev.quoteId = quoteId;
    ev.quoteNumber = clip(q.number, MAX_SHORT);
    ev.decision = decision;
    ev.note = clip(p.note, MAX_TEXT);
  } else if (kind === "work-request") {
    const title = clip(p.title, MAX_SHORT);
    if (!title) return jsonResponse({ error: "title required" }, 400);
    ev.title = title;
    ev.method = clip(p.method, MAX_SHORT);
    ev.scope = clip(p.scope, MAX_TEXT);
    ev.urgency = clip(p.urgency, 32);
    ev.site = clip(p.site, MAX_SHORT);
  } else if (kind === "comment") {
    const text = clip(p.text, MAX_TEXT);
    if (!text) return jsonResponse({ error: "text required" }, 400);
    ev.targetType = clip(p.targetType, 32);
    ev.targetId = clip(p.targetId, MAX_SHORT);
    ev.text = text;
  }

  // Stamp server-side (never trust a client clock for the audit record).
  ev.id = crypto.randomUUID();
  ev.at = new Date().toISOString();
  // Best-effort provenance for the audit trail.
  ev.ip = req.headers.get("x-forwarded-for") || "";

  const { error: writeErr } = await service
    .from("entities").upsert({ org_id: orgId, key: EVENT_PREFIX + ev.id, value: ev }, { onConflict: "org_id,key" });
  if (writeErr) return jsonResponse({ error: "could not record your action" }, 500);

  return jsonResponse({ ok: true, id: ev.id, at: ev.at });
});
