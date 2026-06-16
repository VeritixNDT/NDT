// ═════════════════════════════════════════════════════════════════════════
// portal-data — read-only customer data for the portal (Phase 4)
// ═════════════════════════════════════════════════════════════════════════
// PUBLIC (no Supabase session) — the HMAC token IS the credential. Validates
// { token }, then service-role reads the org's entity blobs and returns ONLY
// that customer's jobs, approved/sent (sealed) reports, quotes, and invoices,
// plus minimal company branding. Drafts / in-progress work are never exposed.
//
// Secrets: PORTAL_SECRET. Plus auto-injected SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY.
// ═════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { verifyPortalToken } from "../_shared/portal.ts";

function envOrThrow(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

// deno-lint-ignore no-explicit-any
function asArray(v: any): any[] { return Array.isArray(v) ? v : []; }

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  let payload: { token?: string };
  try { payload = await req.json(); } catch { return jsonResponse({ error: "invalid JSON body" }, 400); }
  const token = String(payload.token || "");

  const claims = await verifyPortalToken(token, envOrThrow("PORTAL_SECRET"));
  if (!claims) return jsonResponse({ error: "This portal link is invalid or has expired." }, 401);
  const { orgId, customerId } = claims;

  const service = createClient(
    envOrThrow("SUPABASE_URL"), envOrThrow("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  const KEYS = ["vx-customers-v1", "vx-jobs-v1", "vx-reports-v1", "vx-quotes-v1", "vx-invoices-v1", "vx-company-v1"];
  const { data: rows, error } = await service
    .from("entities").select("key,value").eq("org_id", orgId).in("key", KEYS);
  if (error) return jsonResponse({ error: "could not load portal data" }, 500);

  const byKey: Record<string, unknown> = {};
  (rows || []).forEach((r) => { byKey[r.key] = r.value; });

  // Per-report sealed-HTML rows (vx-report-html::<reportId>). The client moved
  // the heavy frozenHtml/sealedHtml snapshots out of the vx-reports-v1 blob into
  // write-once per-report rows. Dual-read: prefer the inline value if a report
  // still carries it (un-migrated org), else look it up here by report id.
  const HTML_PREFIX = "vx-report-html::";
  const htmlById: Record<string, { sealedHtml?: string; frozenHtml?: string }> = {};
  const { data: htmlRows } = await service
    .from("entities").select("key,value").eq("org_id", orgId).like("key", HTML_PREFIX + "%");
  (htmlRows || []).forEach((r) => {
    const id = String(r.key).slice(HTML_PREFIX.length);
    // deno-lint-ignore no-explicit-any
    if (id) htmlById[id] = (r.value as any) || {};
  });

  // Per-report metadata rows (vx-report::<key>). The client moved reports out of
  // the single vx-reports-v1 blob into one row per report. Read those; fall back
  // to the blob for un-migrated orgs (zero per-report rows).
  const REPORT_PREFIX = "vx-report::";
  const { data: reportRows } = await service
    .from("entities").select("value").eq("org_id", orgId).like("key", REPORT_PREFIX + "%");
  // deno-lint-ignore no-explicit-any
  const reportsSource: any[] = (reportRows && reportRows.length)
    ? reportRows.map((r) => r.value).filter(Boolean)
    : asArray(byKey["vx-reports-v1"]);

  const customers = asArray(byKey["vx-customers-v1"]);
  const cust = customers.find((c) => c && c.id === customerId);
  if (!cust) return jsonResponse({ error: "Customer not found." }, 404);

  const jobs = asArray(byKey["vx-jobs-v1"]).filter((j) => j && j.customerId === customerId);
  const jobIds = new Set(jobs.map((j) => j.id));

  const reports = reportsSource
    .filter((r) => r && jobIds.has(r.jobId) && (r.stage === "Approved" || r.stage === "Sent"))
    .map((r) => {
      // Match the client's _vxReportKey: prefer an explicit id, else the
      // stable composite reportNo::revision (older reports have no id).
      const rkey = r.id || (r.reportNo != null ? String(r.reportNo) + "::" + String(r.revision || "") : "");
      const h = (rkey && htmlById[rkey]) || {};
      return {
        reportNo: r.reportNo, method: r.method, revision: r.revision, createdAt: r.createdAt,
        verdict: r.verdict, jobId: r.jobId, stage: r.stage,
        sealedHtml: r.sealedHtml || h.sealedHtml || h.frozenHtml || r.frozenHtml || "",
        acknowledgedBy: r.acknowledgedBy || "", acknowledgedAt: r.acknowledgedAt || "",
        examDate: r.examDate || "",
      };
    });

  const quotes = asArray(byKey["vx-quotes-v1"]).filter((q) => q && q.customerId === customerId && (q.status === "Sent" || q.status === "Accepted"));
  const invoices = asArray(byKey["vx-invoices-v1"]).filter((i) => i && i.customerId === customerId);

  // The customer's own submitted requests (work requests + date-change asks),
  // so the portal can show them what they've sent. Append-only event rows.
  const EVENT_PREFIX = "vx-portal-event::";
  const { data: evRows } = await service
    .from("entities").select("value").eq("org_id", orgId).like("key", EVENT_PREFIX + "%");
  const requests = asArray(evRows ? evRows.map((r) => r.value) : [])
    .filter((e) => e && e.customerId === customerId && (e.kind === "work-request" || e.kind === "date-change"))
    .map((e) => ({
      id: e.id, kind: e.kind, at: e.at, title: e.title || "", method: e.method || "",
      urgency: e.urgency || "", site: e.site || "", scope: e.scope || "",
      requestedDate: e.requestedDate || "", reason: e.reason || "", jobTitle: e.jobTitle || "",
    }))
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));

  // deno-lint-ignore no-explicit-any
  const company = (byKey["vx-company-v1"] as any) || {};

  return jsonResponse({
    company: { name: company.name || "", logo: company.logo || "", color: company.color || "#185FA5", footer: company.footer || "" },
    customer: { name: cust.name || "", id: cust.id },
    jobs, reports, quotes, invoices, requests,
  });
});
