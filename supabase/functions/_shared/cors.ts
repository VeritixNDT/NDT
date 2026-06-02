// ═════════════════════════════════════════════════════════════════════════
// SHARED CORS HEADERS for Veritix Edge Functions
// ═════════════════════════════════════════════════════════════════════════
// The app is a static SPA served from a different origin than the Supabase
// functions host, so every function call is a cross-origin request. The
// browser fires a CORS preflight (OPTIONS) before any POST that carries an
// Authorization header, and the function must answer it with these headers
// or the browser kills the real request before it leaves.
//
// We allow any origin (`*`) deliberately: these functions are gated by the
// caller's Supabase JWT, not by origin, and the app may be served from
// localhost during dev and several static hosts in prod. Tighten to an
// explicit allow-list here if you ever pin the app to one domain.
// ═════════════════════════════════════════════════════════════════════════

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // supabase-js sends `authorization` + `apikey` + `content-type`; the
  // `x-client-info` header is added automatically by the SDK.
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

/** Build a JSON Response with CORS headers already attached. */
export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}
