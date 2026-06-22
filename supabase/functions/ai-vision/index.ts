// ═════════════════════════════════════════════════════════════════════════
// VERITIX NDT — ai-vision Edge Function
// ═════════════════════════════════════════════════════════════════════════
// Vision-based photo analysis for an inspection report. The client resolves the
// report's photos (which are NOT stored as base64 at rest — see the V14 photo
// model), downscales + re-encodes them to JPEG base64, and sends them here with
// a media-stripped text context. This function asks Claude to look at the images
// and flag visible indications (cracks, porosity, undercut, corrosion, surface
// prep), photo-quality problems, and obvious contradictions with the recorded
// verdict — returning structured findings the UI renders.
//
// Sibling of ai-review (which reasons over the report's *text* only). Same
// security model: JWT-gated, server-held Anthropic key, structured output,
// advisory only — the model never edits the report.
//
// Required secret (shared with ai-review):
//   ANTHROPIC_API_KEY — Anthropic API key (console.anthropic.com)
// Auto-injected by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY.
// ═════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
// Opus 4.8 — vision-capable; coordinates/perception map 1:1 to image pixels.
// Swap to a cheaper tier here if you want to trade accuracy for cost/latency.
const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 8000;

// Abuse / cost ceilings. The client already downscales to <=1568px JPEG, so a
// request past these is almost certainly un-downscaled originals.
const MAX_IMAGES = 6;
const MAX_TOTAL_B64_CHARS = 7_000_000; // ~5 MB of image bytes across the request
const MAX_CTX_CHARS = 120_000;
const ALLOWED_MEDIA = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const SYSTEM_PROMPT =
  `You are a senior NDT (non-destructive testing) visual interpreter for Veritix NDT Inspect. ` +
  `You are shown one or more inspection PHOTOS plus a compact JSON context for the report ` +
  `(method, verdict, defects, equipment — heavy media and HTML stripped). Each photo is ` +
  `introduced by a line "Image <id>:" so you can reference it.\n\n` +
  `Look at the images and report what is VISIBLE. Useful findings include:\n` +
  `• Indications — visible cracks, porosity, undercut, lack of fusion, spatter, corrosion/pitting, ` +
  `surface-prep or cleanliness problems, mechanical damage. Describe what and roughly where ` +
  `(in words, e.g. "weld toe, upper-left").\n` +
  `• Photo quality — blurred, over/under-exposed, no scale reference, wrong subject, or an image ` +
  `that cannot support the recorded result.\n` +
  `• Verdict mismatch — the photo plainly shows a condition that contradicts the report's recorded ` +
  `verdict (e.g. an obvious crack on a report marked Acceptable).\n\n` +
  `Rules: Base every finding strictly on what is visible — do NOT guess, quantify, or invent ` +
  `defects you cannot see. You are an ADVISORY aid, NOT a certified visual interpretation and NOT ` +
  `a substitute for the inspection method. When uncertain, say so and use low confidence. Set ` +
  `imageId on each finding to the image it refers to. Order findings most-severe first.\n\n` +
  `Set overallRisk: "fail" if any image plainly shows a likely-critical indication or contradicts ` +
  `the verdict; "warnings" if only minor/uncertain indications or quality issues; "pass" if the ` +
  `photos look clean and consistent with the report (return an empty findings array).`;

// Structured-output schema. JSON-schema limits for output_config.format apply:
// additionalProperties must be false; no numeric/length constraints.
const VISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      description:
        "One sentence: what the photos show overall and the headline concern, if any.",
    },
    overallRisk: { type: "string", enum: ["pass", "warnings", "fail"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          imageId: {
            type: "string",
            description: "The image id this finding refers to (e.g. \"p1\").",
          },
          type: {
            type: "string",
            enum: ["indication", "quality", "mismatch"],
          },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          description: {
            type: "string",
            description: "One or two plain sentences describing what is visible.",
          },
          location: {
            type: "string",
            description: "Where in the image, in words (may be empty).",
          },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["imageId", "type", "severity", "description", "confidence"],
      },
    },
  },
  required: ["summary", "overallRisk", "findings"],
};

// ── OCR mode (Phase 2) ────────────────────────────────────────────────────
// Read text/values off an equipment label, calibration sticker, gauge, or
// material stamp and map each to one of the report's fillable fields, so the
// inspector can one-click "Apply" it. Still advisory — the client writes the
// value into the form only on the inspector's confirmation.
const OCR_SYSTEM =
  `You are reading text and values off inspection-equipment photos for Veritix NDT Inspect — ` +
  `equipment labels, calibration stickers, gauges/displays, material stamps, certificates. ` +
  `Extract the distinct field/value pairs you can CLEARLY read: e.g. serial number, model, ` +
  `manufacturer, calibration date / due date, certificate number, gauge reading, material grade, ` +
  `heat number.\n\n` +
  `You are given a list of the report's fillable fields as JSON ("Available fields"), each with a ` +
  `"key" and "label". For every value you read, set "suggestedKey" to the BEST-matching field key ` +
  `from that list, or "" if none fits. Use the exact key string.\n\n` +
  `Rules: Transcribe only what is legibly visible — do NOT guess characters, complete partial ` +
  `serials, or invent values. Use low confidence when the text is unclear and omit anything you ` +
  `cannot read. Set imageId to the image the value came from. This is an ADVISORY aid; the ` +
  `inspector confirms every value before it is applied.`;

const OCR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      description: "One sentence: what kind of label/sticker/stamp was read.",
    },
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: {
            type: "string",
            description: "What the value is, e.g. \"Serial number\", \"Calibration due\".",
          },
          value: { type: "string", description: "The value read, verbatim." },
          suggestedKey: {
            type: "string",
            description: "Best-matching field key from the provided list, or \"\".",
          },
          imageId: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["label", "value", "suggestedKey", "confidence"],
      },
    },
  },
  required: ["summary", "fields"],
};

// ── Consistency mode (Phase 3) ────────────────────────────────────────────
// Focused photo-vs-verdict check: does the visible evidence support the
// report's recorded verdict and defect entries, or contradict them? Returns a
// clear consistency call + an overallRisk suitable for an optional do-not-issue
// gate (fail only on a confident contradiction). Advisory.
const CONSISTENCY_SYSTEM =
  `You are a senior NDT QA reviewer for Veritix NDT Inspect performing a focused ` +
  `PHOTO-vs-VERDICT consistency check. You are shown the report's inspection PHOTOS plus its ` +
  `recorded result as JSON (verdict, defect entries, method). Each photo is introduced by ` +
  `"Image <id>:".\n\n` +
  `Judge ONE thing: does what is VISIBLE in the photos support the recorded verdict and defects, ` +
  `or contradict them? Examples of a contradiction: an obvious crack/porosity visible on a report ` +
  `marked "Acceptable"; a clean, sound weld on a report marked "Not acceptable" with no visible ` +
  `defect; a defect type/location in the photo that disagrees with the recorded defect entries.\n\n` +
  `Rules: Base the call strictly on what is visible. Photos that are unclear, off-subject, or simply ` +
  `do not show the graded feature are INCONCLUSIVE, not a contradiction — do NOT manufacture a ` +
  `contradiction from a poor photo. Set consistency to "contradicted" only when the image plainly ` +
  `disagrees with the verdict. This is ADVISORY and not a certified interpretation.\n\n` +
  `Set overallRisk: "fail" ONLY when consistency is "contradicted" with high confidence; ` +
  `"warnings" for a possible/low-confidence contradiction or notable concern; "pass" when the ` +
  `photos are consistent with the report or merely inconclusive (empty findings array is fine).`;

const CONSISTENCY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      description: "One sentence: do the photos support the recorded verdict?",
    },
    consistency: {
      type: "string",
      enum: ["consistent", "contradicted", "inconclusive"],
    },
    overallRisk: { type: "string", enum: ["pass", "warnings", "fail"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          imageId: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          description: {
            type: "string",
            description: "How the image agrees with or contradicts the verdict.",
          },
          location: { type: "string", description: "Where in the image (may be empty)." },
        },
        required: ["imageId", "severity", "description"],
      },
    },
  },
  required: ["summary", "consistency", "overallRisk", "findings"],
};

// Per-mode dispatch — system prompt, output schema, and response key.
const MODE_SYSTEM: Record<string, string> = {
  indications: SYSTEM_PROMPT,
  ocr: OCR_SYSTEM,
  consistency: CONSISTENCY_SYSTEM,
};
const MODE_SCHEMA: Record<string, unknown> = {
  indications: VISION_SCHEMA,
  ocr: OCR_SCHEMA,
  consistency: CONSISTENCY_SCHEMA,
};
const MODE_RESP_KEY: Record<string, string> = {
  indications: "vision",
  ocr: "ocr",
  consistency: "consistency",
};

function envOrThrow(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

interface ImageIn {
  id?: unknown;
  mediaType?: unknown;
  data?: unknown;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  // ── Authenticate the caller (same pattern as ai-review) ──────────────────
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

  // ── Parse + validate ─────────────────────────────────────────────────────
  let payload: {
    mode?: unknown;
    reportCtx?: unknown;
    images?: unknown;
    fieldOptions?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  const mode = (payload?.mode === "ocr" || payload?.mode === "consistency")
    ? payload.mode
    : "indications";

  const images = Array.isArray(payload?.images) ? payload.images as ImageIn[] : [];
  if (!images.length) {
    return jsonResponse({ error: "no photos to analyze" }, 400);
  }
  if (images.length > MAX_IMAGES) {
    return jsonResponse(
      { error: `too many photos — send at most ${MAX_IMAGES}` },
      413,
    );
  }

  let totalChars = 0;
  const imageBlocks: unknown[] = [];
  const introLines: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const media = typeof img?.mediaType === "string" ? img.mediaType : "";
    const data = typeof img?.data === "string" ? img.data : "";
    const id = typeof img?.id === "string" && img.id ? img.id : `p${i + 1}`;
    if (!ALLOWED_MEDIA.has(media) || !data) {
      return jsonResponse(
        { error: `image ${id}: unsupported format or empty data` },
        400,
      );
    }
    totalChars += data.length;
    if (totalChars > MAX_TOTAL_B64_CHARS) {
      return jsonResponse(
        { error: "photos too large — downscale before analysis" },
        413,
      );
    }
    introLines.push(`Image ${id}:`);
    imageBlocks.push({ type: "text", text: `Image ${id}:` });
    imageBlocks.push({
      type: "image",
      source: { type: "base64", media_type: media, data },
    });
  }

  // Compact text context (already media-stripped client-side). Cap defensively.
  let ctxJson = "";
  try {
    ctxJson = JSON.stringify(payload?.reportCtx ?? {});
  } catch {
    ctxJson = "{}";
  }
  if (ctxJson.length > MAX_CTX_CHARS) {
    ctxJson = ctxJson.slice(0, MAX_CTX_CHARS) + "…[truncated]";
  }

  // For OCR, give the model the report's fillable fields so it can map each
  // value it reads to a field key the client can one-click apply.
  let fieldOptsJson = "[]";
  if (mode === "ocr") {
    try {
      const fo = Array.isArray(payload?.fieldOptions) ? payload.fieldOptions : [];
      fieldOptsJson = JSON.stringify(fo).slice(0, 20_000);
    } catch {
      fieldOptsJson = "[]";
    }
  }

  // Image blocks come BEFORE the instruction text (recommended ordering).
  const instruction = mode === "ocr"
    ? "Read the values off the equipment label / sticker / stamp in the photo(s) " +
      "and return them as JSON, mapping each to a field key where possible.\n\n" +
      "Available fields:\n```json\n" + fieldOptsJson + "\n```\n\n" +
      "Report context (text only):\n```json\n" + ctxJson + "\n```"
    : mode === "consistency"
    ? "Decide whether the photo(s) above support the report's recorded verdict and " +
      "defects, and return the result as JSON.\n\n" +
      "Recorded result (text only):\n```json\n" + ctxJson + "\n```"
    : "Analyze the inspection photo(s) above and return findings as JSON.\n\n" +
      "Report context (text only):\n```json\n" + ctxJson + "\n```";
  const userContent = [
    ...imageBlocks,
    { type: "text", text: instruction },
  ];

  // ── Ask Claude ────────────────────────────────────────────────────────────
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
        system: MODE_SYSTEM[mode],
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: MODE_SCHEMA[mode] },
        },
        messages: [{ role: "user", content: userContent }],
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
    return jsonResponse({ error: "AI declined to analyze these photos" }, 502);
  }
  if (data.stop_reason === "max_tokens") {
    return jsonResponse(
      { error: "AI analysis was truncated — try fewer photos" },
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    return jsonResponse({ error: "AI returned malformed findings" }, 502);
  }

  // Return under a mode-specific key so the client renders the right UI.
  return jsonResponse({ ok: true, [MODE_RESP_KEY[mode]]: parsed });
});
