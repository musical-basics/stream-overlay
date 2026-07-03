"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser (anon) client. Persists the auth session to cookies via @supabase/ssr
// so the server/middleware can read it. Also used for Realtime subscriptions.
// Fallbacks keep `next build` from crashing when env isn't wired yet.
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabase = createBrowserClient(url, anonKey, {
  db: { schema: "stream_overlay" },
  // MIDI is relayed as a batched broadcast ~20x/sec, so a modest cap is plenty
  // and keeps Realtime message volume (and cost) down.
  realtime: { params: { eventsPerSecond: 30 } },
});
