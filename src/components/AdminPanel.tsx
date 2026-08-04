"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { parseYouTubeId } from "@/lib/youtube";
import RequestQueue from "./RequestQueue";
import DoNotRequestQueue from "./DoNotRequestQueue";

type HistoryItem = { id: string; content: string | null; created_at: string };

// Top-right panel placement: % of overlay size, anchoring the panel's
// TOP-RIGHT corner. Null = the default CSS position.
type PanelPos = { x: number; y: number };

// Where the default CSS position (top: 13.6vmin; right: 7.5vmin) lands, in %,
// for each aspect — used to draw the drag chip before a custom spot is saved.
const DEFAULT_POS: Record<"16x9" | "9x16", PanelPos> = {
  "16x9": { x: 100 - 7.5 * (9 / 16), y: 13.6 },
  "9x16": { x: 100 - 7.5, y: 13.6 * (9 / 16) },
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

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
  const [panelMode, setPanelMode] = useState("chat"); // chat | blocklist | off
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const panelPosRef = useRef<PanelPos | null>(null); // latest drag pos, no re-render lag
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const [chatHealth, setChatHealth] = useState("");
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

  // Load the current chat settings (video id, panel mode, panel position).
  // Also called on Realtime changes so every helper's panel stays in sync —
  // hence the guards: don't clobber the video field mid-typing, and don't
  // fight the drag chip while it's being dragged. select("*") keeps this
  // working on DBs that predate the panel_x/panel_y columns.
  async function loadChatSettings() {
    const { data } = await supabase
      .from("chat_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (!data) return;
    if (document.activeElement?.id !== "chat") {
      setChatInput((data.video_id as string) ?? "");
    }
    setPanelMode(((data.panel_mode as string) ?? "chat") || "chat");
    if (!draggingRef.current) {
      const x = Number(data.panel_x);
      const y = Number(data.panel_y);
      const pos =
        data.panel_x != null && data.panel_y != null && isFinite(x) && isFinite(y)
          ? { x, y }
          : null;
      panelPosRef.current = pos;
      setPanelPos(pos);
    }
    checkChatHealth(((data.video_id as string) ?? "").trim());
  }

  // Ping our /api/chat route so admins can see chat problems (missing server
  // API key, video not live, bad id) that the overlay itself hides by design.
  async function checkChatHealth(videoId: string) {
    if (!videoId) {
      setChatHealth("");
      return;
    }
    try {
      const res = await fetch(`/api/chat?video=${encodeURIComponent(videoId)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        live?: boolean;
        error?: string;
        detail?: string;
      };
      if (data.error === "missing_api_key") {
        setChatHealth(
          "⚠️ The server is missing YOUTUBE_API_KEY (set it in Vercel → Settings → Environment Variables and redeploy) — chat can't load until then."
        );
      } else if (data.error) {
        setChatHealth(`⚠️ Chat check failed: ${data.detail || data.error}`);
      } else if (data.live) {
        setChatHealth("✅ Live chat connected.");
      } else {
        setChatHealth(
          "⏳ Video isn't live right now — chat will appear once the stream is live."
        );
      }
    } catch {
      setChatHealth("⚠️ Couldn't reach /api/chat to verify the chat setup.");
    }
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

    // Keep chat settings in sync across helper panels (and reflect the real
    // DB state, so a failed write can't leave this panel showing the wrong
    // mode indefinitely).
    const settingsChannel = supabase
      .channel("chat-settings-admin")
      .on(
        "postgres_changes",
        { event: "*", schema: "stream_overlay", table: "chat_settings" },
        () => loadChatSettings()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(midiChannel);
      supabase.removeChannel(settingsChannel);
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
    if (!error) {
      setChatInput(videoId); // reflect the normalized id back
      checkChatHealth(videoId);
    }
    setChatSaving(false);
    flash(error ? error.message : "Live chat updated 💬", !error);
  }

  // Switch what the top-right overlay panel shows (chat | blocklist | off).
  // Optimistic — reflect immediately, then persist (panel_mode only, so it
  // doesn't disturb the stored video id). If the write fails, revert so the
  // buttons never show a mode the overlay isn't actually in.
  async function savePanelMode(mode: string) {
    const prev = panelMode;
    setPanelMode(mode);
    const { error } = await supabase.from("chat_settings").upsert(
      {
        id: 1,
        panel_mode: mode,
        helper_id: userId,
        helper_name: helperName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) setPanelMode(prev);
    flash(
      error
        ? error.message
        : mode === "chat"
          ? "Overlay panel → Live chat 💬"
          : mode === "blocklist"
            ? "Overlay panel → Do-not-request 🚫"
            : "Overlay panel hidden",
      !error
    );
  }

  // Persist the dragged top-right panel position (or null = back to default).
  async function savePanelPos(pos: PanelPos | null) {
    const { error } = await supabase.from("chat_settings").upsert(
      {
        id: 1,
        panel_x: pos ? pos.x : null,
        panel_y: pos ? pos.y : null,
        helper_id: userId,
        helper_name: helperName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) {
      const stale = /panel_x|panel_y|schema cache/i.test(error.message);
      flash(
        stale
          ? "DB is missing panel_x/panel_y — run the updated supabase/schema.sql in the Supabase SQL editor"
          : error.message,
        false
      );
    } else {
      flash(pos ? "Panel position saved 📍" : "Panel back to default corner 📍");
    }
  }

  // ---- Drag chip over the live preview -------------------------------------
  // The chip marks the panel's top-right corner. Pointer capture keeps the
  // drag alive even though the preview is an iframe underneath.
  function chipPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
  }

  function chipPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!draggingRef.current) return;
    const rect = previewBoxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clamp(((e.clientX - rect.left) / rect.width) * 100, 10, 100);
    const y = clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 92);
    const pos = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    panelPosRef.current = pos;
    setPanelPos(pos);
  }

  function chipPointerUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    const pos = panelPosRef.current;
    if (pos) savePanelPos(pos);
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

        {/* ---- Top-right overlay panel ---- */}
        <hr className="divider" />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <label style={{ margin: 0 }}>Top-right overlay panel</label>
          <div className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className={`btn-ghost btn-sm ${panelMode === "chat" ? "seg-active" : ""}`}
              onClick={() => savePanelMode("chat")}
            >
              💬 Live chat
            </button>
            <button
              type="button"
              className={`btn-ghost btn-sm ${panelMode === "blocklist" ? "seg-active" : ""}`}
              onClick={() => savePanelMode("blocklist")}
            >
              🚫 Do-not-request
            </button>
            <button
              type="button"
              className={`btn-ghost btn-sm ${panelMode === "off" ? "seg-active" : ""}`}
              onClick={() => savePanelMode("off")}
            >
              Off
            </button>
          </div>
        </div>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Pick what shows in the overlay’s top-right corner. Both are editable
          below regardless of which is on screen.
        </p>

        {/* ---- Live chat embed (persistent) ---- */}
        <form onSubmit={saveChatSettings} style={{ marginTop: 14 }}>
          <label htmlFor="chat">Live chat video (YouTube)</label>
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
            stream.
          </p>
          {chatHealth && (
            <p
              className={chatHealth.startsWith("⚠️") ? "status err" : "muted"}
              style={{ margin: "8px 0 0" }}
            >
              {chatHealth}
            </p>
          )}
        </form>

        {/* ---- Do-not-request list ---- */}
        <DoNotRequestQueue userId={userId} />

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
          Applause and watch it here (audio is muted in this preview). Drag the
          📍 chip to reposition the top-right panel (chat / do-not-request);
          the chip marks the panel&apos;s top-right corner.
        </p>
        <div
          ref={previewBoxRef}
          className={`preview preview-${previewAspect}`}
        >
          <iframe
            title="Overlay preview"
            src={`/overlay/${previewAspect}?preview=1${isLionel ? "&midi=1" : ""}`}
            allow="midi"
          />
          {panelMode !== "off" && (
            <button
              type="button"
              className={`pos-chip ${dragging ? "pos-chip-drag" : ""}`}
              style={{
                left: `${(panelPos ?? DEFAULT_POS[previewAspect]).x}%`,
                top: `${(panelPos ?? DEFAULT_POS[previewAspect]).y}%`,
              }}
              onPointerDown={chipPointerDown}
              onPointerMove={chipPointerMove}
              onPointerUp={chipPointerUp}
              onPointerCancel={chipPointerUp}
              title="Drag to move the top-right panel"
            >
              📍 {panelMode === "chat" ? "Chat" : "Don't-request"}
            </button>
          )}
        </div>
        {panelPos && (
          <button
            className="btn-ghost btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => {
              panelPosRef.current = null;
              setPanelPos(null);
              savePanelPos(null);
            }}
          >
            ↺ Reset panel to default corner
          </button>
        )}

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
