"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Item = {
  id: string;
  song: string;
  note: string;
  sort: number;
  created_at: string;
};

// CRUD for the "do not request / overplayed" list. Same model as the request
// queue (shared across helpers, live via Realtime) but no cap and with an
// optional note/reason instead of a requester.
export default function DoNotRequestQueue({ userId }: { userId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [song, setSong] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const dragIndex = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  async function load() {
    const { data } = await supabase
      .from("do_not_request")
      .select("id, song, note, sort, created_at")
      .order("sort", { ascending: true })
      .order("created_at", { ascending: true });
    if (data) setItems(data as Item[]);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("do-not-request-admin")
      .on(
        "postgres_changes",
        { event: "*", schema: "stream_overlay", table: "do_not_request" },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!song.trim()) return;
    const nextSort = items.length
      ? Math.max(...items.map((r) => r.sort)) + 1
      : 0;
    const { error } = await supabase.from("do_not_request").insert({
      song: song.trim(),
      note: note.trim(),
      sort: nextSort,
      helper_id: userId,
    });
    if (error) {
      setErr(error.message);
      return;
    }
    setSong("");
    setNote("");
  }

  async function remove(id: string) {
    setItems((prev) => prev.filter((r) => r.id !== id)); // optimistic
    await supabase.from("do_not_request").delete().eq("id", id);
  }

  // Persist a new order by writing each row's sort = its index.
  async function persistOrder(ordered: Item[]) {
    setItems(ordered); // optimistic
    await Promise.all(
      ordered.map((r, i) =>
        r.sort === i
          ? Promise.resolve()
          : supabase.from("do_not_request").update({ sort: i }).eq("id", r.id)
      )
    );
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
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
        <label style={{ margin: 0 }}>Do-not-request list</label>
        <span className="muted">{items.length}</span>
      </div>
      <p className="muted" style={{ margin: "8px 0 12px" }}>
        Overplayed or off-limits songs. Shows top-right on the overlay when the
        panel above is set to “Do-not-request”.
      </p>

      <form onSubmit={addItem}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            value={song}
            placeholder="Song (e.g. Rush E)"
            onChange={(e) => setSong(e.target.value)}
            style={{ flex: "2 1 180px" }}
          />
          <input
            type="text"
            value={note}
            placeholder="Note (optional, e.g. overplayed)"
            onChange={(e) => setNote(e.target.value)}
            style={{ flex: "2 1 180px" }}
          />
          <button
            className="btn-primary"
            type="submit"
            disabled={!song.trim()}
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

      {items.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>
          Nothing on the list.
        </p>
      ) : (
        <ul className="req-list">
          {items.map((r, i) => (
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
                {r.note && <span className="req-by">{r.note}</span>}
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
                  disabled={i === items.length - 1}
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
