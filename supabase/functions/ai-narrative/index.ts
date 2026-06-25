// ═════════════════════════════════════════════════════════════════════════
// VERITIX NDT — ai-narrative Edge Function
// ═════════════════════════════════════════════════════════════════════════
// Drafts the prose description of a single NDT indication for the inspector.
// The client sends the structured finding it has on the form (method,
// indication type, location, dimension, orientation, material, applicable
// code); this function asks Claude to write one concise, code-appropriate
// narrative paragraph the inspector then edits. It is a DRAFTING aid — the
// returned text lands in an editable field and the inspector remains the
// author of record.
//
// Why server-side: the Anthropic API key is a secret. It MUST NOT ship in the
// static SPA. The browser only ever talks to this JWT-gated function; the key
// lives in a Supabase secret, exactly like ai-review / send-email.
//
// Design decisions (mirrors ai-review):
//   • JWT-gated. Every call verifies the caller's Supabase session — no anon
//     use (an open, billed LLM endpoint would be abused instantly).
//   • Structured output. The reply is constrained to { narrative } so the
//     client never has to parse free text.
//   • sonnet-4-6, not opus: drafting a paragraph from given facts is a
//     lower-stakes task than the pre-issue review gate; sonnet is the right
//     cost/latency trade-off here.
//   • No invented data. The prompt forbids adding findings, dispositions, or
//     measurements the inspector did not supply.
//
// Required secret (supabase secrets set ANTHROPIC_API_KEY=sk-ant-...):
//   ANTHROPIC_API_KEY — Anthropic API key (console.anthropic.com)
// Auto-injected by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY.
// ═════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
// Sonnet 4.6 — drafting prose from supplied facts. Swap to "claude-opus-4-8"
// for maximum fidelity or "claude-haiku-4-5" for lowest cost/latency.
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 700;
// A finding is a handful of short fields; anything larger is malformed input.
const MAX_FINDING_CHARS = 8_000;

const SYSTEM_PROMPT =
  `You are a senior NDT (non-destructive testing) inspector writing the indication ` +
  `description for an inspection report. You are given ONE indication as structured ` +
  `fields (method, indication type, location, dimension, orientation, material, and the ` +
  `applicable acceptance code). Write a single concise, professional paragraph (2–4 ` +
  `sentences) describing the indication as it would read in the report body.\n\n` +
  `Rules:\n` +
  `• Use only the facts provided. Do NOT invent measurements, locations, equipment, ` +
  `causes, or any detail not given. If a field is missing, simply omit it — never ` +
  `guess or write a placeholder.\n` +
  `• Preserve units and values exactly as supplied (e.g. "3.2 mm", "Ø60.3 × 5.0 mm").\n` +
  `• Match the method's terminology: MT (magnetic particle), PT (liquid penetrant), ` +
  `VT (visual), UT (ultrasonic). Reference the applicable code/standard if one is given.\n` +
  `• Describe the indication factually. Do NOT state an acceptance verdict, disposition, ` +
  `or pass/fail decision — that is the inspector's call and is recorded separately.\n` +
  `• Plain report prose. No bullet points, no headings, no preamble like "Here is" — ` +
  `return only the paragraph itself.`;

// Structured-output schema (output_config.format limits: no length constraints,
// additionalProperties must be false).
const NARRATIVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    narrative: {
      type: "string",
      description: "The indication description paragraph for the report body.",
    },
  },
  required: ["narrative"],
};

function envOrThrow(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

Deno.serve(async (req: Request): Promise<Response> => {
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
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonResponse({ error: "invalid session" }, 401);
  }

  // ── Parse + validate ────────────────────────────────────────────────────
  let payload: { finding?: unknown };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  const finding = payload?.finding;
  if (!finding || typeof finding !== "object") {
    return jsonResponse({ error: "finding object required" }, 400);
  }
  const findingJson = JSON.stringify(finding);
  if (findingJson.length > MAX_FINDING_CHARS) {
    return jsonResponse({ error: "finding too large" }, 413);
  }

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
        system: SYSTEM_PROMPT,
        output_config: {
          format: { type: "json_schema", schema: NARRATIVE_SCHEMA },
        },
        messages: [
          {
            role: "user",
            content:
              "Draft the indication description for this finding and return it as JSON.\n\n" +
              "```json\n" + findingJson + "\n```",
          },
        ],
      }),
    });
  } catch (e) {
    return jsonResponse({ error: `AI request failed: ${String(e)}` }, 502);
  }

  if (!aiResp.ok) {
    const detail = await aiResp.text().catch(() => "");
    return jsonResponse(
      { error: "AI provider rejected the request", detail },
      502,
    );
  }

  const data = await aiResp.json().catch(() => null);
  if (!data) {
    return jsonResponse({ error: "AI returned no parseable response" }, 502);
  }
  if (data.stop_reason === "refusal") {
    return jsonResponse({ error: "AI declined to draft this narrative" }, 502);
  }

  // Structured output lands in the (last) text block.
  const blocks = Array.isArray(data.content) ? data.content : [];
  const textBlock = [...blocks].reverse().find(
    (b: { type?: string }) => b?.type === "text",
  ) as { text?: string } | undefined;
  if (!textBlock?.text) {
    return jsonResponse({ error: "AI returned no narrative" }, 502);
  }
  let parsed: { narrative?: string };
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    return jsonResponse({ error: "AI returned malformed narrative" }, 502);
  }
  if (!parsed.narrative) {
    return jsonResponse({ error: "AI returned an empty narrative" }, 502);
  }

  return jsonResponse({ ok: true, narrative: parsed.narrative });
});
