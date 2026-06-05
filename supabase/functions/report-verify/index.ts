// ═════════════════════════════════════════════════════════════════════════
// report-verify — public report-authenticity check via QR (V47)
// ═════════════════════════════════════════════════════════════════════════
// PUBLIC (no session). A printed report carries a QR encoding
// <APP_URL>#/verify/<token>. This validates the HMAC token { orgId, reportId }
// and returns that ONE report's sealed PDF (frozen HTML) + verification
// metadata, so a client/third party can confirm it's genuine. Only
// Approved/Sent reports are verifiable; drafts are never exposed and report
// numbers can't be enumerated (the signed token is the credential).
//
// Secrets: PORTAL_SECRET. Plus auto-injected SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY.
// ═════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { verifyToken } from "../_shared/portal.ts";

function envOrThrow(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

const HTML_PREFIX = "vx-report-html::";
const REPORT_PREFIX = "vx-report::";
// Matches the client's _vxReportKey: explicit id, else reportNo::revision.
// deno-lint-ignore no-explicit-any
function reportKey(r: any): string {
  return r.id || (r.reportNo != null ? String(r.reportNo) + "::" + String(r.revision || "") : "");
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  let payload: { token?: string };
  try { payload = await req.json(); } catch { return jsonResponse({ error: "invalid JSON body" }, 400); }

  const claims = await verifyToken(String(payload.token || ""), envOrThrow("PORTAL_SECRET"));
  if (!claims || !claims.orgId || !claims.reportId) {
    return jsonResponse({ error: "This verification link is invalid." }, 401);
  }
  const orgId = String(claims.orgId);
  const reportId = String(claims.reportId);

  const service = createClient(
    envOrThrow("SUPABASE_URL"), envOrThrow("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  // Report metadata. The client now syncs each report as its own row
  // (vx-report::<key>) instead of one vx-reports-v1 blob — read that directly
  // by key. Dual-read the old blob as a fallback for un-migrated orgs.
  // deno-lint-ignore no-explicit-any
  let r: any = null;
  const { data: rptRow, error: rptErr } = await service
    .from("entities").select("value").eq("org_id", orgId).eq("key", REPORT_PREFIX + reportId).maybeSingle();
  if (rptErr) return jsonResponse({ error: "could not load report" }, 500);
  if (rptRow?.value) {
    r = rptRow.value;
  } else {
    const { data: blobRow, error } = await service
      .from("entities").select("value").eq("org_id", orgId).eq("key", "vx-reports-v1").maybeSingle();
    if (error) return jsonResponse({ error: "could not load report" }, 500);
    // deno-lint-ignore no-explicit-any
    const reports: any[] = Array.isArray(blobRow?.value) ? (blobRow!.value as any[]) : [];
    r = reports.find((x) => x && reportKey(x) === reportId) || null;
  }
  if (!r) return jsonResponse({ error: "Report not found." }, 404);
  if (r.stage !== "Approved" && r.stage !== "Sent") {
    return jsonResponse({ error: "This report is not an approved version." }, 403);
  }

  // Sealed HTML: prefer the per-report row, dual-read inline for un-migrated orgs.
  let sealedHtml = r.sealedHtml || r.frozenHtml || "";
  const { data: htmlRow } = await service
    .from("entities").select("value").eq("org_id", orgId).eq("key", HTML_PREFIX + reportId).maybeSingle();
  if (htmlRow?.value) {
    // deno-lint-ignore no-explicit-any
    const h = htmlRow.value as any;
    sealedHtml = h.sealedHtml || h.frozenHtml || sealedHtml;
  }

  // deno-lint-ignore no-explicit-any
  const company = ((await service.from("entities").select("value").eq("org_id", orgId).eq("key", "vx-company-v1").maybeSingle()).data?.value as any) || {};

  return jsonResponse({
    reportNo: r.reportNo, method: r.method, revision: r.revision, verdict: r.verdict,
    stage: r.stage, createdAt: r.createdAt, approvedBy: r.approvedBy || "", sealedAt: r.sealedAt || "",
    sealedHtml,
    company: { name: company.name || "", logo: company.logo || "", color: company.color || "#185FA5" },
  });
});
