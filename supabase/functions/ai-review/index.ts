// ═════════════════════════════════════════════════════════════════════════
// VERITIX NDT — ai-review Edge Function
// ═════════════════════════════════════════════════════════════════════════
// Pre-issue AI review of an inspection report. The client sends a stripped,
// structured copy of one report (heavy media/HTML removed); this function asks
// Claude to flag problems an inspector or approver might miss — missing data,
// readings that contradict the verdict, out-of-band survey values, compliance
// gaps — and returns structured findings the UI renders.
//
// Why server-side: the Anthropic API key is a secret. It MUST NOT ship in the
// static SPA. The browser only ever talks to this JWT-gated function; the key
// lives in a Supabase secret, exactly like RESEND_API_KEY for send-email.
//
// Design decisions:
//   • JWT-gated. Every call verifies the caller's Supabase session. No anon use
//     (an open LLM endpoint billed to us would be abused instantly).
//   • Structured output. We constrain Claude's reply to a JSON schema
//     (output_config.format) so the client always gets parseable findings.
//   • Advisory only. The model never edits the report; it returns findings the
//     human reviewer acts on. Wrong-but-recoverable, low cost-of-error.
//
// Required secret (supabase secrets set ANTHROPIC_API_KEY=sk-ant-...):
//   ANTHROPIC_API_KEY — Anthropic API key (console.anthropic.com)
// Auto-injected by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY.
// ═════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
// Opus 4.8 — most capable; this is a compliance-grade review where missing a
// real defect is the costly error. Swap to "claude-sonnet-4-6" or
// "claude-haiku-4-5" here if you want to trade some accuracy for cost/latency.
const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 8000;
// Reject absurdly large payloads — the client strips heavy fields, so a report
// over this is almost certainly un-stripped media. ~280K chars ≈ well under the
// model context but a sane abuse ceiling.
const MAX_REPORT_CHARS = 280_000;

const SYSTEM_PROMPT =
  `You are a senior NDT (non-destructive testing) QA reviewer for Veritix NDT Inspect. ` +
  `You review one inspection report BEFORE it is issued to a customer, catching problems an ` +
  `inspector or approver might miss. You are given the report as JSON: structured fields only ` +
  `(heavy media, photos, and rendered HTML have been stripped — their absence is NOT a finding).\n\n` +
  `Report only REAL, actionable issues. Check for:\n` +
  `• Missing required data — no inspector, no equipment or calibration reference, missing exam/report ` +
  `dates, missing acceptance criteria, blank or placeholder readings ("", "TBD", "—").\n` +
  `• Internal inconsistency — the stated verdict (e.g. "Acceptable" / "Not acceptable") disagrees with ` +
  `the readings against the acceptance band; some survey points are out of limits but the report is ` +
  `marked Acceptable, or all points pass but it is marked Not acceptable.\n` +
  `• Out-of-band readings — numeric survey values outside the method's acceptance limits (ferrite % ` +
  `outside the FN band, hardness outside the HV/HRC limits, PMI grade/element mismatch).\n` +
  `• Logical/date errors — exam date after the report date, revision or supersession oddities, units ` +
  `that look wrong or transposed.\n` +
  `• Compliance — unregistered/uncertified equipment or inspector used where the method requires it.\n\n` +
  `Rules: Do NOT invent issues. If a field is plausibly optional, or you genuinely cannot tell, do not ` +
  `flag it. Reference the specific field or survey point in each finding. Keep each message to one or ` +
  `two plain sentences the inspector can act on. Order findings most-severe first.\n\n` +
  `Set overallRisk: "fail" if any high-severity finding exists; "warnings" if only medium/low findings; ` +
  `"pass" if the report looks complete and self-consistent (return an empty findings array).`;

// Structured-output schema. Note JSON-schema limits for output_config.format:
// no numeric/string length constraints, additionalProperties must be false.
const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      description: "One sentence: is this report safe to issue, and the headline concern if not.",
    },
    overallRisk: { type: "string", enum: ["pass", "warnings", "fail"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          area: {
            type: "string",
            description: "Short label for what the finding is about, e.g. \"Verdict\", \"Equipment\", \"FN point 3\".",
          },
          message: { type: "string", description: "One or two actionable sentences." },
        },
        required: ["severity", "area", "message"],
      },
    },
  },
  required: ["summary", "overallRisk", "findings"],
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
  let payload: { report?: unknown };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  const report = payload?.report;
  if (!report || typeof report !== "object") {
    return jsonResponse({ error: "report object required" }, 400);
  }
  const reportJson = JSON.stringify(report);
  if (reportJson.length > MAX_REPORT_CHARS) {
    return jsonResponse(
      { error: "report too large — strip media/HTML before review" },
      413,
    );
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
        thinking: { type: "adaptive" },
        system: SYSTEM_PROMPT,
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: REVIEW_SCHEMA },
        },
        messages: [
          {
            role: "user",
            content:
              "Review this NDT inspection report and return findings as JSON.\n\n" +
              "```json\n" + reportJson + "\n```",
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
    return jsonResponse(
      { error: "AI declined to review this report" },
      502,
    );
  }
  if (data.stop_reason === "max_tokens") {
    return jsonResponse(
      { error: "AI review was truncated — report may be unusually large" },
      502,
    );
  }

  // Structured output lands in the (last) text block; thinking blocks precede it.
  const blocks = Array.isArray(data.content) ? data.content : [];
  const textBlock = [...blocks].reverse().find(
    (b: { type?: string }) => b?.type === "text",
  ) as { text?: string } | undefined;
  if (!textBlock?.text) {
    return jsonResponse({ error: "AI returned no findings" }, 502);
  }
  let review: unknown;
  try {
    review = JSON.parse(textBlock.text);
  } catch {
    return jsonResponse({ error: "AI returned malformed findings" }, 502);
  }

  return jsonResponse({ ok: true, review });
});
