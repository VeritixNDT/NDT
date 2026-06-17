// ═════════════════════════════════════════════════════════════════════════
// pdf-render — server-side VECTOR PDF rendering (true no-dialog download)
// ═════════════════════════════════════════════════════════════════════════
// Takes report/pack HTML and returns a real, vector (selectable-text, full
// print-resolution) PDF — the quality the client-side html2canvas raster can't
// match. Supabase Edge can't run a browser itself, so this proxies the HTML to
// a Chromium-based renderer chosen by env (swappable adapter):
//
//   PDF_ENGINE = "gotenberg" (default) | "pdfshift"
//     gotenberg:  GOTENBERG_URL (e.g. https://gotenberg.yourhost.com)
//                 PDF_RENDER_SECRET (optional shared header)
//     pdfshift:   PDFSHIFT_API_KEY
//
// Until an engine is configured it returns 503 and the client falls back to the
// existing html2pdf raster / print-dialog path — so deploying this is safe.
//
// Auth (dual, like portal-data): a valid portal token in the body OR a real
// Supabase user session in the Authorization header. The recipient/engine is
// fixed server-side, and the HTML is the caller's own — not a spam/SSRF relay.
//
// Secrets: PORTAL_SECRET + the engine config above. Auto-injected: SUPABASE_URL,
// SUPABASE_ANON_KEY.
// ═════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { verifyPortalToken } from "../_shared/portal.ts";

const MAX_HTML = 8_000_000; // ~8MB — packs carry inline base64 images

function env(n: string): string { return Deno.env.get(n) || ""; }
function envOrThrow(n: string): string { const v = Deno.env.get(n); if (!v) throw new Error(`missing env ${n}`); return v; }

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  let body: { html?: string; filename?: string; token?: string };
  try { body = await req.json(); } catch { return jsonResponse({ error: "invalid JSON body" }, 400); }

  const html = String(body.html || "");
  if (!html) return jsonResponse({ error: "html required" }, 400);
  if (html.length > MAX_HTML) return jsonResponse({ error: "html too large" }, 413);
  let filename = String(body.filename || "document.pdf").replace(/[^\w.\- ]+/g, "").trim().slice(0, 120) || "document.pdf";
  if (!/\.pdf$/i.test(filename)) filename += ".pdf";

  // ── Authenticate: portal token OR a Supabase user session ────────────────
  let authed = false;
  const portalSecret = env("PORTAL_SECRET");
  if (body.token && portalSecret) {
    const claims = await verifyPortalToken(String(body.token), portalSecret);
    if (claims) authed = true;
  }
  if (!authed) {
    const authHeader = req.headers.get("Authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      try {
        const uc = createClient(envOrThrow("SUPABASE_URL"), envOrThrow("SUPABASE_ANON_KEY"), {
          global: { headers: { Authorization: authHeader } },
        });
        const { data } = await uc.auth.getUser();
        if (data?.user) authed = true;
      } catch (_) { /* fall through to 401 */ }
    }
  }
  if (!authed) return jsonResponse({ error: "unauthorized" }, 401);

  // ── Render via the configured engine ─────────────────────────────────────
  const engine = (env("PDF_ENGINE") || "gotenberg").toLowerCase();
  let pdf: ArrayBuffer | null = null;
  try {
    if (engine === "gotenberg") {
      const base = env("GOTENBERG_URL");
      if (!base) return jsonResponse({ error: "pdf engine not configured" }, 503);
      const fd = new FormData();
      fd.append("files", new Blob([html], { type: "text/html" }), "index.html");
      fd.append("preferCssPageSize", "true");   // honour the report's @page A4
      fd.append("printBackground", "true");
      fd.append("marginTop", "0"); fd.append("marginBottom", "0");
      fd.append("marginLeft", "0"); fd.append("marginRight", "0");
      const headers: Record<string, string> = {};
      const secret = env("PDF_RENDER_SECRET");
      if (secret) headers["X-Render-Secret"] = secret;
      const r = await fetch(base.replace(/\/$/, "") + "/forms/chromium/convert/html", { method: "POST", body: fd, headers });
      if (!r.ok) { const d = await r.text().catch(() => ""); return jsonResponse({ error: "render failed", detail: d.slice(0, 300) }, 502); }
      pdf = await r.arrayBuffer();
    } else if (engine === "pdfshift") {
      const key = env("PDFSHIFT_API_KEY");
      if (!key) return jsonResponse({ error: "pdf engine not configured" }, 503);
      const r = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
        method: "POST",
        headers: { "Authorization": "Basic " + btoa("api:" + key), "Content-Type": "application/json" },
        body: JSON.stringify({ source: html, format: "A4", margin: "0", use_print: true, disable_javascript: true }),
      });
      if (!r.ok) { const d = await r.text().catch(() => ""); return jsonResponse({ error: "render failed", detail: d.slice(0, 300) }, 502); }
      pdf = await r.arrayBuffer();
    } else {
      return jsonResponse({ error: "unknown pdf engine: " + engine }, 500);
    }
  } catch (e) {
    return jsonResponse({ error: "render error: " + String(e) }, 502);
  }

  if (!pdf) return jsonResponse({ error: "no pdf produced" }, 502);
  return new Response(pdf, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"` },
  });
});
