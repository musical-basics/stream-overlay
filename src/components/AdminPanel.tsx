"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

type HistoryItem = { id: string; content: string | null; created_at: string };

export default function AdminPanel({
  userId,
  userEmail,
}: {
  userId: string;
  userEmail: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [status, setStatus] = useState<{ msg: string; ok: boolean }>({
    msg: "",
    ok: true,
  });
  const [applauseBusy, setApplauseBusy] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Load this helper's own submission history (RLS limits it to their rows).
  async function loadHistory() {
    const { data } = await supabase
      .from("stream_events")
      .select("id, content, created_at")
      .eq("event_type", "text_update")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setHistory(data as HistoryItem[]);
  }

  useEffect(() => {
    loadHistory();

    // Shared channel with the overlay — used to broadcast applause.
    const channel = supabase.channel("overlay");
    channel.subscribe();
    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function flash(msg: string, ok = true) {
    setStatus({ msg, ok });
  }

  async function pushText(content: string) {
    const { data, error } = await supabase
      .from("stream_events")
      .insert({ event_type: "text_update", content, helper_id: userId })
      .select("id, content, created_at")
      .single();

    if (error) {
      flash(error.message, false);
      return;
    }
    if (data) setHistory((prev) => [data as HistoryItem, ...prev]);
    flash("Pushed to stream ✓");
  }

  async function submitText(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    await pushText(text.trim());
  }

  async function markStreamStart() {
    const { error } = await supabase
      .from("stream_events")
      .insert({ event_type: "stream_start", content: null, helper_id: userId });
    flash(
      error ? error.message : "Stream start marked 🎬",
      !error
    );
  }

  async function fireApplause() {
    setApplauseBusy(true);
    const res = await channelRef.current?.send({
      type: "broadcast",
      event: "applause",
      payload: {},
    });
    flash(res === "ok" ? "Applause sent 👏" : "Applause sent 👏");
    setTimeout(() => setApplauseBusy(false), 1200);
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <main className="page">
      <div className="card" style={{ maxWidth: 640 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1>Control panel</h1>
          <button className="btn-ghost" onClick={logout}>
            Log out
          </button>
        </div>
        <p className="muted">
          Signed in as {userEmail}. Changes appear on the overlay instantly.
        </p>

        {/* ---- Now playing ---- */}
        <form onSubmit={submitText}>
          <label htmlFor="np">Now playing text</label>
          <textarea
            id="np"
            rows={3}
            value={text}
            placeholder="e.g. Now playing: Für Elise"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn-primary" type="submit">
              Submit to stream
            </button>
          </div>
        </form>

        {/* ---- Effects + markers ---- */}
        <hr className="divider" />
        <label>Effects &amp; markers</label>
        <div className="row" style={{ gap: 12 }}>
          <button
            className="btn-applause"
            style={{ flex: 1 }}
            onClick={fireApplause}
            disabled={applauseBusy}
          >
            {applauseBusy ? "👏 …" : "👏 Applause"}
          </button>
          <button className="btn-ghost" style={{ flex: 1 }} onClick={markStreamStart}>
            🎬 Mark stream start
          </button>
        </div>
        <div className={`status ${status.ok ? "ok" : "err"}`}>{status.msg}</div>

        {/* ---- History ---- */}
        <hr className="divider" />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <label style={{ margin: 0 }}>Your recent submissions</label>
          <Link className="link" href="/admin/export">
            Timestamp export →
          </Link>
        </div>

        {history.length === 0 ? (
          <p className="muted" style={{ marginTop: 12 }}>
            Nothing yet — your submissions will show here.
          </p>
        ) : (
          <ul className="history">
            {history.map((h) => (
              <li key={h.id}>
                <span className="history-text">{h.content}</span>
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => pushText(h.content ?? "")}
                  title="Push this to the stream again"
                >
                  Re-submit
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
