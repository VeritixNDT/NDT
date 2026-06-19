// ═════════════════════════════════════════════════════════════════════════
// VERITIX NDT — ai-insights Edge Function
// ═════════════════════════════════════════════════════════════════════════
// AI over the org's inspection history. Two modes:
//   • mode "digest" — an inspection trend digest from a compact, media-stripped
//     summary of the org's reports (pass-rate trends, recurring issues,
//     recommendations).
//   • mode "query"  — a natural-language question answered ONLY from that same
//     data (an "ask your asset data" assistant), with the reports it relied on.
//
// Same security posture as ai-review: JWT-gated (no anon use of a billed LLM),
// the Anthropic key is a Supabase secret, structured JSON output, advisory only.
// The client sends a stripped dataset (no media/HTML); we never pull or mutate.
//
// Required secret: ANTHROPIC_API_KEY. Auto-injected: SUPABASE_URL, SUPABASE_ANON_KEY.
// ═════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 8000;
const MAX_DATA_CHARS = 280_000;

const SYSTEM_DIGEST =
  `You are a senior NDT (non-destructive testing) data analyst for Veritix NDT Inspect. ` +
  `You are given a media-stripped JSON summary of an organisation's inspection reports ` +
  `(method, verdict, dates, customer, job, inspector, defect counts). Produce a concise, ` +
  `factual trend digest a QA manager would value.\n\n` +
  `Base EVERY statement strictly on the data given — never invent reports, numbers, customers, ` +
  `or trends. If the data is too thin for a trend, say so rather than guessing. Quantify where ` +
  `you can (e.g. "acceptable rate 88% over 42 reports"). Focus on: pass/fail trends over time and ` +
  `by method, recurring defect types or problem areas, customers or assets that stand out, and ` +
  `concrete, actionable recommendations. Keep it tight and specific.`;

const SYSTEM_QUERY =
  `You are an analyst assistant for Veritix NDT Inspect. Answer the user's question using ONLY the ` +
  `media-stripped JSON summary of the organisation's inspection reports provided. ` +
  `Never invent data. If the answer is not in the data, say so plainly. Quantify and cite the ` +
  `specific report numbers (or customers/jobs) you relied on. Be concise and direct.`;

const DIGEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    period: { type: "string", description: "The span the data covers, e.g. \"Apr–Jun 2026\" or \"last 50 reports\"." },
    headline: { type: "string", description: "One-sentence headline of the overall inspection picture." },
    trends: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          detail: { type: "string", description: "One or two sentences, quantified where possible." },
          direction: { type: "string", enum: ["up", "down", "flat"] },
        },
        required: ["label", "detail", "direction"],
      },
    },
    recurringIssues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          issue: { type: "string" },
          where: { type: "string", description: "Which method / customer / asset it concentrates in." },
          severity: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["issue", "where", "severity"],
      },
    },
    recommendations: { type: "array", items: { type: "string" } },
  },
  required: ["period", "headline", "trends", "recurringIssues", "recommendations"],
};

const QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string", description: "Direct answer grounded in the data." },
    references: { type: "array", items: { type: "string" }, description: "Report numbers / customers / jobs relied on." },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["answer", "references", "confidence"],
};

function envOrThrow(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  // ── Authenticate the caller ─────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "missing bearer token" }, 401);
  const userClient = createClient(envOrThrow("SUPABASE_URL"), envOrThrow("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonResponse({ error: "invalid session" }, 401);

  // ── Parse + validate ────────────────────────────────────────────────────
  let payload: { mode?: string; question?: string; data?: unknown };
  try { payload = await req.json(); } catch { return jsonResponse({ error: "invalid JSON body" }, 400); }
  const mode = payload?.mode === "query" ? "query" : "digest";
  const data = payload?.data;
  if (!data || typeof data !== "object") return jsonResponse({ error: "data object required" }, 400);
  const question = String(payload?.question || "").slice(0, 2000);
  if (mode === "query" && !question.trim()) return jsonResponse({ error: "question required for query mode" }, 400);

  const dataJson = JSON.stringify(data);
  if (dataJson.length > MAX_DATA_CHARS) {
    return jsonResponse({ error: "dataset too large — send a stripped summary (no media/HTML)" }, 413);
  }

  const system = mode === "query" ? SYSTEM_QUERY : SYSTEM_DIGEST;
  const schema = mode === "query" ? QUERY_SCHEMA : DIGEST_SCHEMA;
  const userContent = mode === "query"
    ? `Question: ${question}\n\nInspection data (JSON):\n\`\`\`json\n${dataJson}\n\`\`\``
    : `Produce a trend digest from this inspection data (JSON):\n\`\`\`json\n${dataJson}\n\`\`\``;

  // ── Ask Claude ──────────────────────────────────────────────────────────
  let aiResp: Response;
  try {
    aiResp = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": envOrThrow("ANTHROPIC_API_KEY"),
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "adaptive" },
        system,
        output_config: { effort: "medium", format: { type: "json_schema", schema } },
        messages: [{ role: "user", content: userContent }],
      }),
    });
  } catch (e) {
    return jsonResponse({ error: `AI request failed: ${String(e)}` }, 502);
  }

  if (!aiResp.ok) {
    const detail = await aiResp.text().catch(() => "");
    return jsonResponse({ error: "AI provider rejected the request", detail }, 502);
  }
  const respData = await aiResp.json().catch(() => null);
  if (!respData) return jsonResponse({ error: "AI returned no parseable response" }, 502);
  if (respData.stop_reason === "refusal") return jsonResponse({ error: "AI declined this request" }, 502);
  if (respData.stop_reason === "max_tokens") return jsonResponse({ error: "AI response was truncated — narrow the question or data" }, 502);

  const blocks = Array.isArray(respData.content) ? respData.content : [];
  const textBlock = [...blocks].reverse().find((b: { type?: string }) => b?.type === "text") as { text?: string } | undefined;
  if (!textBlock?.text) return jsonResponse({ error: "AI returned nothing" }, 502);
  let result: unknown;
  try { result = JSON.parse(textBlock.text); } catch { return jsonResponse({ error: "AI returned malformed output" }, 502); }

  return jsonResponse({ ok: true, mode, result });
});
