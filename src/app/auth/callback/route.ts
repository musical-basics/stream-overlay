import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

// Landing point for Supabase auth emails (currently just password recovery).
// Swaps the one-time code for a session cookie, then forwards to `next`.
// The code verifier lives in a cookie set when the reset was requested, which
// is why the link only works in the browser that asked for it.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  // Only ever forward to a path on this site — never an absolute URL. A
  // leading "//" or "/\" is protocol-relative in browsers, so reject both.
  const requested = searchParams.get("next") ?? "/admin";
  const next = /^\/(?![/\\])/.test(requested) ? requested : "/admin";

  // Vercel terminates TLS upstream, and nextUrl.origin reports https:// even
  // on a plain-http local server — so rebuild the base from the real headers
  // and only fall back to origin if there's no Host at all.
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (/^(localhost|127\.0\.0\.1)(:|$)/.test(host ?? "") ? "http" : "https");
  const base = host ? `${proto}://${host}` : origin;

  if (!code) {
    return NextResponse.redirect(`${base}/forgot?error=missing-code`);
  }

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${base}/forgot?error=invalid-link`);
  }

  return NextResponse.redirect(`${base}${next}`);
}
