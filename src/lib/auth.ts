// Tiny session helper for the single shared-password login.
//
// On successful login we set an httpOnly cookie containing a token derived from
// SESSION_SECRET. The token is a SHA-256 hash of the secret, so it cannot be
// forged without knowing the secret, and only someone who typed the correct
// CONTROL_PASSWORD ever receives it.
//
// Uses the Web Crypto API (globalThis.crypto), which is available in both the
// Node.js runtime (route handlers) and the Edge runtime (middleware).

export const SESSION_COOKIE = "overlay_session";

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sessionToken(): Promise<string> {
  const secret = process.env.SESSION_SECRET || "insecure-dev-secret";
  const data = new TextEncoder().encode(`${secret}:overlay-session-v1`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return b64url(digest);
}

// Constant-time-ish string comparison.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function isValidSession(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  return safeEqual(token, await sessionToken());
}

// Pull the session cookie value straight off a Request's Cookie header.
export function sessionCookieFromRequest(req: Request): string | undefined {
  return req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.split("=")
    .slice(1)
    .join("=");
}
