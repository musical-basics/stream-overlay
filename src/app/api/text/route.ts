import { NextResponse } from "next/server";
import { isValidSession, sessionCookieFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const MAX_LEN = 280;

export async function POST(req: Request) {
  const token = sessionCookieFromRequest(req);

  if (!(await isValidSession(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let text = "";
  try {
    const body = await req.json();
    text = String(body?.text ?? "").slice(0, MAX_LEN);
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("overlay_state")
    .update({ now_playing: text, updated_at: new Date().toISOString() })
    .eq("id", 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, text });
}
