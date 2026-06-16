import { createClient } from "@supabase/supabase-js";

// Server-only client. Uses the SERVICE ROLE key, which bypasses RLS so we can
// write to the tables. NEVER import this into a client component.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-key";

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
