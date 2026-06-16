import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Runs on the control-panel routes: refreshes the Supabase session and
// redirects unauthenticated users to /login. The overlay stays public.
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ["/admin/:path*"],
};
