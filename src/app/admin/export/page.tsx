import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import ExportView from "@/components/ExportView";

export const dynamic = "force-dynamic";

// mm:ss, or h:mm:ss once past an hour (YouTube-chapter friendly).
function fmt(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export default async function ExportPage() {
  const server = await createSupabaseServer();
  const {
    data: { user },
  } = await server.auth.getUser();
  if (!user) redirect("/login?next=/admin/export");

  // Anchor = the most recent stream_start. Read everything via the service-role
  // client so the chapters include every helper's text updates, not just yours.
  const { data: starts } = await supabaseAdmin
    .from("stream_events")
    .select("created_at")
    .eq("event_type", "stream_start")
    .order("created_at", { ascending: false })
    .limit(1);

  const start = starts?.[0]?.created_at as string | undefined;

  let chapters = "";
  if (start) {
    const { data: events } = await supabaseAdmin
      .from("stream_events")
      .select("content, created_at")
      .eq("event_type", "text_update")
      .gte("created_at", start)
      .order("created_at", { ascending: true });

    const startMs = new Date(start).getTime();
    const lines = ["00:00 Stream Start"];
    for (const e of events ?? []) {
      const rel =
        (new Date(e.created_at as string).getTime() - startMs) / 1000;
      lines.push(`${fmt(rel)} ${e.content ?? ""}`.trimEnd());
    }
    chapters = lines.join("\n");
  }

  return (
    <main className="page">
      <div className="card" style={{ maxWidth: 640 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1>Timestamp export</h1>
          <Link className="link" href="/admin">
            ← Back
          </Link>
        </div>
        <p className="muted">
          Relative to the most recent “Mark stream start”. Paste into your
          YouTube description as chapters.
        </p>

        {start ? (
          <ExportView text={chapters} />
        ) : (
          <p className="status err">
            No “stream start” marked yet. Hit “Mark stream start” in the control
            panel when your recording begins.
          </p>
        )}
      </div>
    </main>
  );
}
