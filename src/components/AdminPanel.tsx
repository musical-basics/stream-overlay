"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { parseYouTubeId } from "@/lib/youtube";
import RequestQueue from "./RequestQueue";

type HistoryItem = { id: string; content: string | null; created_at: string };

// Helpers may push to the stream at most once every 5 seconds.
const COOLDOWN_MS = 5000;

// Display name for the overlay, derived from the login email:
// "angena@musicalbasics.com" -> "Angena".
function displayName(email: string): string {
  const local = email.split("@")[0] || "Helper";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export default function AdminPanel({
  userId,
  userEmail,
}: {
  userId: string;
  userEmail: string;
}) {
  const router = useRouter();
  const helperName = displayName(userEmail);
  const [text, setText] = useState("");
  const [nowPlaying, setNowPlaying] = useState("");
  const [npSaving, setNpSaving] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatSaving, setChatSaving] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [status, setStatus] = useState<{ msg: string; ok: boolean }>({
    msg: "",
    ok: true,
  });
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [applauseBusy, setApplauseBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0); // seconds left until next push
  const [previewAspect, setPreviewAspect] = useState<"16x9" | "9x16">("16x9");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const midiChannelRef = useRef<RealtimeChannel | null>(null);
  const lastPushRef = useRef(0); // timestamp of the last successful push
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const isLionel = userEmail === "lionel@musicalbasics.com";

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

  // Load the current persistent "now playing" value so the field is pre-filled.
  async function loadNowPlaying() {
    const { data } = await supabase
      .from("now_playing")
      .select("song")
      .eq("id", 1)
      .maybeSingle();
    if (data) setNowPlaying(data.song ?? "");
  }

  // Load the current YouTube live-chat video id so the field is pre-filled.
  async function loadChatSettings() {
    const { data } = await supabase
      .from("chat_settings")
      .select("video_id")
      .eq("id", 1)
      .maybeSingle();
    if (data) setChatInput(data.video_id ?? "");
  }

  useEffect(() => {
    loadHistory();
    loadNowPlaying();
    loadChatSettings();

    // Shared channel with the overlay — used to broadcast applause.
    const channel = supabase.channel("overlay");
    channel.subscribe();
    channelRef.current = channel;

    // Separate channel for the MIDI-reconnect signal.
    const midiChannel = supabase.channel("midi");
    midiChannel.subscribe();
    midiChannelRef.current = midiChannel;

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(midiChannel);
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  function flash(msg: string, ok = true) {
    setStatus({ msg, ok });
    // Also surface a transient toast so confirmation is visible no matter which
    // control triggered it (the inline status line can be far down the panel).
    setToast({ msg, ok });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }

  // Start the 5-second visible countdown after a successful push.
  function startCooldown() {
    lastPushRef.current = Date.now();
    setCooldown(Math.ceil(COOLDOWN_MS / 1000));
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      const left = Math.ceil((COOLDOWN_MS - (Date.now() - lastPushRef.current)) / 1000);
      if (left <= 0) {
        setCooldown(0);
        if (cooldownTimer.current) clearInterval(cooldownTimer.current);
      } else {
        setCooldown(left);
      }
    }, 250);
  }

  async function pushText(content: string) {
    // Rate limit: at most one push per 5s (guarded on a timestamp ref so it
    // can't be bypassed by stale state).
    const since = Date.now() - lastPushRef.current;
    if (since < COOLDOWN_MS) {
      flash(`Wait ${Math.ceil((COOLDOWN_MS - since) / 1000)}s before submitting again`, false);
      return;
    }

    const trimmed = content.trim();
    if (!trimmed) return;

    const { data, error } = await supabase
      .from("stream_events")
      .insert({
        event_type: "text_update",
        content: trimmed,
        helper_id: userId,
        helper_name: helperName,
      })
      .select("id, content, created_at")
      .single();

    if (error) {
      flash(error.message, false);
      return;
    }
    if (data) setHistory((prev) => [data as HistoryItem, ...prev]);
    startCooldown();
    flash("Pushed to stream ✓");
  }

  async function submitText(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    await pushText(text.trim());
  }

  // Overwrite the persistent "now playing" value (singleton row, id = 1).
  // Not rate-limited like announcements — it's a standing field, not a push.
  async function saveNowPlaying(e: React.FormEvent) {
    e.preventDefault();
    setNpSaving(true);
    const { error } = await supabase.from("now_playing").upsert(
      {
        id: 1,
        song: nowPlaying.trim(),
        helper_id: userId,
        helper_name: helperName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    setNpSaving(false);
    flash(error ? error.message : "Now playing updated 🎶", !error);
  }

  // Set the YouTube live-chat embed (singleton row, id = 1). Accepts a full
  // YouTube URL or a bare video id; we extract the id before storing so the
  // overlay can build the live_chat embed URL directly.
  async function saveChatSettings(e: React.FormEvent) {
    e.preventDefault();
    setChatSaving(true);
    const videoId = parseYouTubeId(chatInput);
    const { error } = await supabase.from("chat_settings").upsert(
      {
        id: 1,
        video_id: videoId,
        helper_id: userId,
        helper_name: helperName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (!error) setChatInput(videoId); // reflect the normalized id back
    setChatSaving(false);
    flash(error ? error.message : "Live chat updated 💬", !error);
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

  async function refreshMidi() {
    await midiChannelRef.current?.send({
      type: "broadcast",
      event: "refresh",
      payload: {},
    });
    flash("MIDI reconnect sent 🎹");
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <main className="page">
      {toast && (
        <div
          className={`toast ${toast.ok ? "toast-ok" : "toast-err"}`}
          role="status"
          aria-live="polite"
        >
          {toast.msg}
        </div>
      )}
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

        {/* ---- Announcement ---- */}
        <form onSubmit={submitText}>
          <label htmlFor="np">Announcement text</label>
          <textarea
            id="np"
            rows={3}
            value={text}
            placeholder="e.g. Now playing: Für Elise"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row" style={{ marginTop: 14 }}>
            <button
              className="btn-primary"
              type="submit"
              disabled={cooldown > 0 || !text.trim()}
            >
              {cooldown > 0 ? `Wait ${cooldown}s…` : "Submit to stream"}
            </button>
          </div>
        </form>

        {/* ---- Now playing (persistent) ---- */}
        <hr className="divider" />
        <form onSubmit={saveNowPlaying}>
          <label htmlFor="nowplaying">Now playing (stays top-left on overlay)</label>
          <div className="row" style={{ gap: 10 }}>
            <input
              id="nowplaying"
              type="text"
              style={{ flex: 1 }}
              value={nowPlaying}
              placeholder="e.g. Clair de Lune — Debussy"
              onChange={(e) => setNowPlaying(e.target.value)}
            />
            <button className="btn-primary" type="submit" disabled={npSaving}>
              {npSaving ? "Saving…" : "Set"}
            </button>
          </div>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            Persistent — stays on screen until you change it. Clear it and hit
            Set to hide the label.
          </p>
        </form>

        {/* ---- Live chat embed (persistent) ---- */}
        <hr className="divider" />
        <form onSubmit={saveChatSettings}>
          <label htmlFor="chat">Live chat (YouTube — shown top-right on overlay)</label>
          <div className="row" style={{ gap: 10 }}>
            <input
              id="chat"
              type="text"
              style={{ flex: 1 }}
              value={chatInput}
              placeholder="YouTube live URL or video ID"
              onChange={(e) => setChatInput(e.target.value)}
            />
            <button className="btn-primary" type="submit" disabled={chatSaving}>
              {chatSaving ? "Saving…" : "Set"}
            </button>
          </div>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            Paste the live stream URL (or just the video ID) for the current
            stream. Clear it and hit Set to hide the chat.
          </p>
        </form>

        {/* ---- Request queue ---- */}
        <RequestQueue userId={userId} />

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

        {/* ---- Live preview ---- */}
        <hr className="divider" />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <label style={{ margin: 0 }}>Live preview</label>
          <div className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className={`btn-ghost btn-sm ${previewAspect === "16x9" ? "seg-active" : ""}`}
              onClick={() => setPreviewAspect("16x9")}
            >
              16:9
            </button>
            <button
              type="button"
              className={`btn-ghost btn-sm ${previewAspect === "9x16" ? "seg-active" : ""}`}
              onClick={() => setPreviewAspect("9x16")}
            >
              9:16
            </button>
          </div>
        </div>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Exactly what&apos;s on the overlay right now — submit text or hit
          Applause and watch it here (audio is muted in this preview).
        </p>
        <div className={`preview preview-${previewAspect}`}>
          <iframe
            title="Overlay preview"
            src={`/overlay/${previewAspect}?preview=1${isLionel ? "&midi=1" : ""}`}
            allow="midi"
          />
        </div>

        {isLionel && (
          <button
            className="btn-ghost"
            style={{ width: "100%", marginTop: 10 }}
            onClick={refreshMidi}
            title="Re-establish the MIDI connection on the overlay if it stops responding"
          >
            🎹 Refresh MIDI connection
          </button>
        )}

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
                  disabled={cooldown > 0}
                  title="Push this to the stream again"
                >
                  {cooldown > 0 ? `${cooldown}s` : "Re-submit"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
