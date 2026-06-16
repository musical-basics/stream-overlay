import { NextResponse } from "next/server";
import { isValidSession, sessionCookieFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const token = sessionCookieFromRequest(req);

  if (!(await isValidSession(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Inserting a row is the "fire applause" signal. The overlay listens for
  // INSERTs on this table via Supabase Realtime.
  const { error } = await supabaseAdmin.from("applause_events").insert({});

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
