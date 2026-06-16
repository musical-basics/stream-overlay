"use client";

import { createClient } from "@supabase/supabase-js";

// Browser client. Uses the public anon key — read-only access per our RLS
// policies, plus Realtime subscriptions. Safe to ship to the client.
// Fallbacks keep `next build` from crashing when env isn't set (e.g. CI build
// step before vars are wired). Real values are used at runtime.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } },
});
