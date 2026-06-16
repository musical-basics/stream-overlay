import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

// Server client wired to Next's cookie store. Use in Server Components and
// Route Handlers to read the logged-in user.
export async function createSupabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    db: { schema: "stream_overlay" },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component where cookies are read-only — the
          // middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
