"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Req = {
  id: string;
  song: string;
  requester: string;
  sort: number;
  created_at: string;
};

const MAX = 5;

// Shared request queue (max 5). Helpers add/delete/reorder; everything is
// live across helpers and the overlay ticker via Realtime.
export default function RequestQueue({ userId }: { userId: string }) {
  const [reqs, setReqs] = useState<Req[]>([]);
  const [song, setSong] = useState("");
  const [requester, setRequester] = useState("");
  const [err, setErr] = useState("");
  const dragIndex = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  async function load() {
    const { data } = await supabase
      .from("requests")
      .select("id, song, requester, sort, created_at")
      .order("sort", { ascending: true })
      .order("created_at", { ascending: true });
    if (data) setReqs(data as Req[]);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("requests-admin")
      .on(
        "postgres_changes",
        { event: "*", schema: "stream_overlay", table: "requests" },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function addRequest(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!song.trim()) return;
    if (reqs.length >= MAX) {
      setErr(`Queue is full (max ${MAX}). Remove one first.`);
      return;
    }
    const nextSort = reqs.length ? Math.max(...reqs.map((r) => r.sort)) + 1 : 0;
    const { error } = await supabase.from("requests").insert({
      song: song.trim(),
      requester: requester.trim(),
      sort: nextSort,
      helper_id: userId,
    });
    if (error) {
      setErr(error.message);
      return;
    }
    setSong("");
    setRequester("");
  }

  async function remove(id: string) {
    setReqs((prev) => prev.filter((r) => r.id !== id)); // optimistic
    await supabase.from("requests").delete().eq("id", id);
  }

  // Persist a new order by writing each row's sort = its index.
  async function persistOrder(ordered: Req[]) {
    setReqs(ordered); // optimistic
    await Promise.all(
      ordered.map((r, i) =>
        r.sort === i
          ? Promise.resolve()
          : supabase.from("requests").update({ sort: i }).eq("id", r.id)
      )
    );
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= reqs.length || from === to) return;
    const next = [...reqs];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    persistOrder(next);
  }

  function onDrop(to: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    setOverIndex(null);
    if (from === null) return;
    move(from, to);
  }

  return (
    <>
      <hr className="divider" />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <label style={{ margin: 0 }}>Request queue</label>
        <span className="muted">
          {reqs.length}/{MAX}
        </span>
      </div>
      <p className="muted" style={{ margin: "8px 0 12px" }}>
        Add a request when the streamer confirms it. Drag, or use ▲▼, to
        reorder. Shows live on the overlay ticker.
      </p>

      <form onSubmit={addRequest}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            value={song}
            placeholder="Song (e.g. Für Elise)"
            onChange={(e) => setSong(e.target.value)}
            style={{ flex: "2 1 180px" }}
          />
          <input
            type="text"
            value={requester}
            placeholder="Requested by (e.g. pianoman123)"
            onChange={(e) => setRequester(e.target.value)}
            style={{ flex: "2 1 180px" }}
          />
          <button
            className="btn-primary"
            type="submit"
            disabled={!song.trim() || reqs.length >= MAX}
            style={{ flex: "1 1 90px" }}
          >
            Add
          </button>
        </div>
      </form>
      {err && (
        <div className="status err" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}

      {reqs.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>
          No requests yet.
        </p>
      ) : (
        <ul className="req-list">
          {reqs.map((r, i) => (
            <li
              key={r.id}
              className={`req-item ${overIndex === i ? "req-over" : ""}`}
              draggable
              onDragStart={() => (dragIndex.current = i)}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIndex(i);
              }}
              onDragLeave={() => setOverIndex((o) => (o === i ? null : o))}
              onDrop={() => onDrop(i)}
            >
              <span className="req-num">{i + 1}</span>
              <span className="req-grip" title="Drag to reorder">
                ⠿
              </span>
              <span className="req-main">
                <span className="req-song">{r.song}</span>
                {r.requester && <span className="req-by">by {r.requester}</span>}
              </span>
              <span className="req-actions">
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => move(i, i + 1)}
                  disabled={i === reqs.length - 1}
                  title="Move down"
                >
                  ▼
                </button>
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => remove(r.id)}
                  title="Remove"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
