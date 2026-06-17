// ═════════════════════════════════════════════════════════════════════════
// api — Veritix public REST API (read-first)
// ═════════════════════════════════════════════════════════════════════════
// Key-authenticated programmatic access to an org's data, so customers and
// integrations can pull reports / jobs / customers / invoices / quotes without
// re-entry. Deploy with --no-verify-jwt so consumers authenticate ONLY with
// their Veritix key: `Authorization: Bearer vxk_…` (or `X-API-Key: vxk_…`).
//
// The key's SHA-256 hash is looked up in api_keys (one indexed query) → org_id.
// Everything is scoped to that org; reads use the service role.
//
//   GET /                      → API info + endpoint list
//   GET /reports               ?jobId= ?customerId= ?stage= ?method= ?include=html
//   GET /jobs                  ?customerId= ?status=
//   GET /customers
//   GET /invoices              ?customerId= ?status=
//   GET /quotes                ?customerId= ?status=
//   Common: ?limit (≤200, default 50) ?offset
//
// Secrets: auto-injected SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
// ═════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function envOrThrow(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
// deno-lint-ignore no-explicit-any
function asArray(v: any): any[] { return Array.isArray(v) ? v : []; }

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extractKey(req: Request): string {
  const xk = req.headers.get("x-api-key");
  if (xk && xk.trim().startsWith("vxk_")) return xk.trim();
  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) { const v = auth.slice(7).trim(); if (v.startsWith("vxk_")) return v; }
  return "";
}

// ── Write builders — validate + shape the fields for one resource. Return
// { fields } on success or { error } (→ 400). `existing` is the current record
// on PATCH, null on POST (so required fields are only enforced on create). ──
// deno-lint-ignore no-explicit-any
function buildCustomer(payload: any, existing: any): any {
  const name = existing ? (payload.name ?? existing.name) : payload.name;
  if (!name || typeof name !== "string" || !name.trim()) return { error: "name is required" };
  // deno-lint-ignore no-explicit-any
  const f: any = { name: name.trim().slice(0, 300) };
  ["vatNo", "billingAddress", "notes"].forEach((k) => { if (payload[k] !== undefined) f[k] = String(payload[k] ?? "").slice(0, 4000); });
  if (Array.isArray(payload.contacts)) f.contacts = payload.contacts.slice(0, 50);
  if (Array.isArray(payload.sites)) f.sites = payload.sites.slice(0, 50);
  if (Array.isArray(payload.portalEmails)) f.portalEmails = payload.portalEmails.slice(0, 20).map((e: unknown) => String(e).toLowerCase());
  return { fields: f };
}
// deno-lint-ignore no-explicit-any
async function buildJob(payload: any, existing: any, orgId: string, service: any): Promise<any> {
  const title = existing ? (payload.title ?? existing.title) : payload.title;
  if (!title || !String(title).trim()) return { error: "title is required" };
  const customerId = existing ? (payload.customerId ?? existing.customerId) : payload.customerId;
  if (!customerId) return { error: "customerId is required" };
  const { data } = await service.from("entities").select("value").eq("org_id", orgId).eq("key", "vx-customers-v1").maybeSingle();
  if (!asArray(data?.value).some((c) => c && c.id === customerId)) return { error: "customerId not found" };
  // deno-lint-ignore no-explicit-any
  const f: any = { title: String(title).trim().slice(0, 500), customerId };
  ["status", "startDate", "startTime", "endDate", "leadInspector", "scope", "notes"].forEach((k) => { if (payload[k] !== undefined) f[k] = (typeof payload[k] === "string") ? payload[k].slice(0, 4000) : payload[k]; });
  if (f.status && !["Pending", "Active", "Closed"].includes(f.status)) return { error: "status must be Pending, Active or Closed" };
  if (!existing && !f.status) f.status = "Pending";
  return { fields: f };
}

// Read-modify-write one entity blob: append on POST, merge on PATCH.
// deno-lint-ignore no-explicit-any
async function writeEntity(service: any, orgId: string, key: string, idPrefix: string, method: string, id: string, payload: any, build: any): Promise<Response> {
  const { data } = await service.from("entities").select("value").eq("org_id", orgId).eq("key", key).maybeSingle();
  const arr = asArray(data?.value);
  const now = new Date().toISOString();
  // deno-lint-ignore no-explicit-any
  let rec: any;
  if (method === "PATCH") {
    if (!id) return jsonResponse({ error: "id required in path for update" }, 400);
    const idx = arr.findIndex((x) => x && x.id === id);
    if (idx < 0) return jsonResponse({ error: "not found" }, 404);
    const built = await build(payload, arr[idx], orgId, service);
    if (built.error) return jsonResponse({ error: built.error }, 400);
    rec = { ...arr[idx], ...built.fields, id, updatedAt: now };
    arr[idx] = rec;
  } else {
    const built = await build(payload, null, orgId, service);
    if (built.error) return jsonResponse({ error: built.error }, 400);
    rec = { id: idPrefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7), ...built.fields, createdAt: now, updatedAt: now };
    arr.push(rec);
  }
  const { error: wErr } = await service.from("entities").upsert({ org_id: orgId, key, value: arr }, { onConflict: "org_id,key" });
  if (wErr) return jsonResponse({ error: "write failed" }, 500);
  return jsonResponse(rec, method === "POST" ? 201 : 200);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...corsHeaders, "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-api-key, content-type" } });
  if (!["GET", "POST", "PATCH"].includes(req.method)) return jsonResponse({ error: "method not allowed" }, 405);

  // ── Authenticate by API key ──────────────────────────────────────────────
  const presented = extractKey(req);
  if (!presented) return jsonResponse({ error: "missing API key — send Authorization: Bearer vxk_…" }, 401);

  const service = createClient(envOrThrow("SUPABASE_URL"), envOrThrow("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const hash = await sha256hex(presented);
  const { data: keyRow, error: keyErr } = await service
    .from("api_keys").select("id,org_id,scopes,revoked_at").eq("key_hash", hash).maybeSingle();
  if (keyErr) return jsonResponse({ error: "auth lookup failed" }, 500);
  if (!keyRow || keyRow.revoked_at) return jsonResponse({ error: "invalid or revoked API key" }, 401);
  const orgId = keyRow.org_id as string;
  // Best-effort usage stamp (don't block the response on it).
  service.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id).then(() => {}, () => {});

  // ── Route ────────────────────────────────────────────────────────────────
  const url = new URL(req.url);
  let path = url.pathname;
  const i = path.indexOf("/api");
  path = i >= 0 ? path.slice(i + 4) : path;
  const segs = path.replace(/^\/+/, "").split("/").filter(Boolean);
  const resource = segs[0] || "";
  const id = segs[1] || "";

  // ── Writes (POST create / PATCH update) — require the 'write' scope ───────
  if (req.method === "POST" || req.method === "PATCH") {
    const scopes = Array.isArray(keyRow.scopes) ? keyRow.scopes : [];
    if (!scopes.includes("write")) return jsonResponse({ error: "this API key is read-only (no write scope)" }, 403);
    let payload: Record<string, unknown>;
    try { payload = await req.json(); } catch { return jsonResponse({ error: "invalid JSON body" }, 400); }
    if (resource === "customers") return await writeEntity(service, orgId, "vx-customers-v1", "cust", req.method, id, payload, buildCustomer);
    if (resource === "jobs") return await writeEntity(service, orgId, "vx-jobs-v1", "job", req.method, id, payload, buildJob);
    return jsonResponse({ error: "writes not supported for resource: " + resource + " (try customers, jobs)" }, 404);
  }

  const q = url.searchParams;
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(q.get("limit") || "", 10) || DEFAULT_LIMIT));
  const offset = Math.max(0, parseInt(q.get("offset") || "", 10) || 0);

  if (!resource) {
    return jsonResponse({
      object: "api", version: "1", org: orgId,
      endpoints: ["/reports", "/jobs", "/customers", "/invoices", "/quotes"],
      writes: ["POST /customers", "PATCH /customers/:id", "POST /jobs", "PATCH /jobs/:id"],
      writes_note: "Writes require a key with the 'write' scope.",
      auth: "Authorization: Bearer vxk_…", pagination: "?limit (≤200) &offset",
    });
  }

  // Load one entity blob for the org.
  // deno-lint-ignore no-explicit-any
  const loadBlob = async (key: string): Promise<any[]> => {
    const { data } = await service.from("entities").select("value").eq("org_id", orgId).eq("key", key).maybeSingle();
    return asArray(data?.value);
  };

  // deno-lint-ignore no-explicit-any
  let rows: any[] = [];
  try {
    if (resource === "reports") {
      // Prefer per-report rows; fall back to the blob (un-migrated org).
      const { data: rr } = await service.from("entities").select("value").eq("org_id", orgId).like("key", "vx-report::%");
      const src = (rr && rr.length) ? rr.map((r) => r.value).filter(Boolean) : await loadBlob("vx-reports-v1");
      const jobs = await loadBlob("vx-jobs-v1");
      const jobCust: Record<string, string> = {};
      jobs.forEach((j) => { if (j && j.id) jobCust[j.id] = j.customerId || ""; });
      const wantHtml = q.get("include") === "html";
      const fJob = q.get("jobId"), fCust = q.get("customerId"), fStage = q.get("stage"), fMethod = q.get("method");
      rows = src.filter((r) => r && (!fJob || r.jobId === fJob) && (!fStage || r.stage === fStage) && (!fMethod || r.method === fMethod) && (!fCust || jobCust[r.jobId] === fCust))
        .map((r) => {
          // deno-lint-ignore no-explicit-any
          const out: any = {
            reportNo: r.reportNo, method: r.method, revision: r.revision, stage: r.stage,
            verdict: r.verdict, jobId: r.jobId, customerId: jobCust[r.jobId] || null,
            subject: r.subject || "", inspector: r.inspector || "", examDate: r.examDate || "",
            createdAt: r.createdAt, acknowledgedBy: r.acknowledgedBy || "", acknowledgedAt: r.acknowledgedAt || "",
          };
          if (wantHtml) out.sealedHtml = r.sealedHtml || r.frozenHtml || "";
          return out;
        });
    } else if (resource === "jobs") {
      const fCust = q.get("customerId"), fStatus = q.get("status");
      rows = (await loadBlob("vx-jobs-v1")).filter((j) => j && (!fCust || j.customerId === fCust) && (!fStatus || j.status === fStatus))
        .map((j) => ({ id: j.id, title: j.title, customerId: j.customerId, status: j.status, startDate: j.startDate || null, startTime: j.startTime || null, endDate: j.endDate || null, leadInspector: j.leadInspector || "", scope: j.scope || "" }));
    } else if (resource === "customers") {
      rows = (await loadBlob("vx-customers-v1")).filter(Boolean)
        .map((c) => ({ id: c.id, name: c.name, vatNo: c.vatNo || "", billingAddress: c.billingAddress || "", contacts: asArray(c.contacts), sites: asArray(c.sites) }));
    } else if (resource === "invoices" || resource === "quotes") {
      const key = resource === "invoices" ? "vx-invoices-v1" : "vx-quotes-v1";
      const fCust = q.get("customerId"), fStatus = q.get("status");
      rows = (await loadBlob(key)).filter((d) => d && (!fCust || d.customerId === fCust) && (!fStatus || d.status === fStatus))
        .map((d) => {
          const subtotal = asArray(d.lineItems).reduce((s, li) => s + (Number(li.qty) || 0) * (Number(li.unitPrice) || 0), 0);
          const vatRate = Number(d.vatRate) || 0;
          const total = Math.round((subtotal * (1 + vatRate / 100)) * 100) / 100;
          return { id: d.id, number: d.number, type: d.type, status: d.status, customerId: d.customerId, jobId: d.jobId || null, issueDate: d.issueDate || null, dueDate: d.dueDate || null, currency: d.currency || "", subtotal: Math.round(subtotal * 100) / 100, vatRate, total };
        });
    } else {
      return jsonResponse({ error: "unknown resource: " + resource }, 404);
    }
  } catch (e) {
    return jsonResponse({ error: "read failed: " + String(e) }, 500);
  }

  const page = rows.slice(offset, offset + limit);
  return jsonResponse({ object: "list", url: "/" + resource, limit, offset, count: rows.length, has_more: offset + limit < rows.length, data: page });
});
