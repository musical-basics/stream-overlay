import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

// Refreshes the Supabase session cookie and gates the /admin area. Anyone not
// logged in who hits /admin* is bounced to /login.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Time-box the auth lookup. If Supabase Auth is slow/unreachable, don't let
  // the whole /admin route hang until Vercel kills it with a 504
  // (MIDDLEWARE_INVOCATION_TIMEOUT). Instead fail open to the page, which does
  // its own server-side getUser() check and redirects to /login if there's
  // genuinely no session — so this never exposes the panel.
  let user = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("auth-timeout")), 3000);
    });
    const res = await Promise.race([supabase.auth.getUser(), timeout]);
    user = res.data.user;
  } catch {
    return response; // slow/unreachable auth — let the page gate the request
  } finally {
    clearTimeout(timer);
  }

  if (!user && request.nextUrl.pathname.startsWith("/admin")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
