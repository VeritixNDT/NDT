// ═════════════════════════════════════════════════════════════════════════
// SHARED — Customer-portal magic-link tokens (Phase 4)
// ═════════════════════════════════════════════════════════════════════════
// A portal token is a self-contained, HMAC-signed credential — NOT a Supabase
// auth session. Format:  base64url(payload) "." base64url(HMAC-SHA256(payload))
// payload = { orgId, customerId, exp }  (exp = epoch ms).
//
// portal-token mints it (admin-gated); portal-data verifies it (public). The
// signing secret lives in the PORTAL_SECRET env var — set a long random value
// and never expose it client-side.
// ═════════════════════════════════════════════════════════════════════════

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
async function hmac(data: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return new Uint8Array(sig);
}

export interface PortalClaims { orgId: string; customerId: string; exp: number; }

export async function signPortalToken(claims: PortalClaims, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = b64url(await hmac(body, secret));
  return body + "." + sig;
}

// Returns the claims when the signature is valid and unexpired, else null.
export async function verifyPortalToken(token: string, secret: string): Promise<PortalClaims | null> {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(await hmac(body, secret));
  // Length-checked constant-time-ish comparison.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  let claims: PortalClaims;
  try { claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))); }
  catch { return null; }
  if (!claims || !claims.orgId || !claims.customerId) return null;
  if (claims.exp && Date.now() > claims.exp) return null;
  return claims;
}

// ── Generic HMAC token (V47) ─────────────────────────────────────────────
// Same wire format as the portal token but claims-agnostic — used by the
// report-verify QR flow (claims { orgId, reportId }, long-lived: no exp).
// deno-lint-ignore no-explicit-any
export async function signToken(claims: Record<string, any>, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = b64url(await hmac(body, secret));
  return body + "." + sig;
}
// Verifies the signature (and exp if present); returns the claims or null.
// deno-lint-ignore no-explicit-any
export async function verifyToken(token: string, secret: string): Promise<Record<string, any> | null> {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(await hmac(body, secret));
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
    if (claims && claims.exp && Date.now() > claims.exp) return null;
    return claims;
  } catch { return null; }
}
