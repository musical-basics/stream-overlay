"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import MidiFrame from "./MidiFrame";
import RequestTicker from "./RequestTicker";
import NowPlaying from "./NowPlaying";
import ChatEmbed from "./ChatEmbed";
import styles from "./OverlayCanvas.module.css";

const EMOJIS = ["👏", "🎉", "👏🏽", "🙌", "✨", "👏🏼"];
const PER_BURST = 12; // "not too many"
const MAX_ON_SCREEN = 40;
// How long a message lingers before fading out on its own. A newer message
// always pre-empts this, so it's an upper bound, not a fixed lifetime.
const MESSAGE_TTL_MS = 15_000;

type FloatingEmoji = {
  id: number;
  char: string;
  left: number; // vw
  fontSize: number; // px
  duration: number; // s
  rise: number; // vh
  drift: number; // px
  rot: number; // deg
};

let emojiSeq = 0;

// A single announcement on screen. `id` changes per submission so React
// remounts the element and replays the enter/exit animations.
type Message = { id: number; text: string; name: string };

export type OverlayAspect = "16:9" | "9:16";

export default function OverlayCanvas({
  aspect = "16:9",
}: {
  aspect?: OverlayAspect;
}) {
  // Two slots: the incoming message (`current`, animates in) and the one it
  // replaced (`previous`, animates out). They overlap and animate together.
  const [current, setCurrent] = useState<Message | null>(null);
  const [previous, setPrevious] = useState<Message | null>(null);
  const currentRef = useRef<Message | null>(null);
  const seqRef = useRef(0);
  // Pending auto-dismiss timer for the message currently on screen.
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [emojis, setEmojis] = useState<FloatingEmoji[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // When embedded as a preview (?preview=1) we keep the visuals but skip the
  // clap audio, so the admin's preview doesn't duplicate the on-stream sound.
  const mutedRef = useRef(false);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    mutedRef.current = p.has("preview") || p.get("muted") === "1";
  }, []);

  // Swap in a new announcement, pushing the old one into the exiting slot.
  function showMessage(text: string, name: string) {
    if (!text) return;
    const msg: Message = { id: ++seqRef.current, text, name: name || "" };
    if (dismissRef.current) clearTimeout(dismissRef.current);
    setPrevious(currentRef.current);
    currentRef.current = msg;
    setCurrent(msg);
    // Auto-dismiss after the TTL unless a newer message replaces it first
    // (a replacement clears this timer above, so only the latest one fades).
    dismissRef.current = setTimeout(() => {
      if (currentRef.current?.id !== msg.id) return; // already replaced
      setPrevious(msg); // move it into the exiting (fade-out) slot
      currentRef.current = null;
      setCurrent(null);
    }, MESSAGE_TTL_MS);
  }

  // ---- Audio ----------------------------------------------------------------
  // Tries /public/applause.mp3 first; if it's missing or blocked, falls back to
  // a synthesized applause so the button always does something. OBS captures
  // this Browser source's audio automatically.
  function playApplause() {
    if (mutedRef.current) return; // preview: visuals only, no sound
    const audio = new Audio("/applause.mp3");
    audio.volume = 0.85;
    audio.play().catch(() => synthApplause());
  }

  function synthApplause() {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = audioCtxRef.current ?? new Ctx();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume();

      const dur = 2.6;
      const sr = ctx.sampleRate;
      const len = Math.floor(sr * dur);
      const buffer = ctx.createBuffer(1, len, sr);
      const data = buffer.getChannelData(0);

      // Base wash of noise that swells in and fades out.
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const swell = Math.min(1, t / 0.3) * Math.min(1, (dur - t) / 0.7);
        data[i] = (Math.random() * 2 - 1) * 0.45 * swell;
      }
      // Sparse louder "claps" on top.
      const claps = 70;
      const clapLen = Math.floor(sr * 0.02);
      for (let c = 0; c < claps; c++) {
        const start = Math.floor(Math.random() * (len - clapLen));
        for (let j = 0; j < clapLen; j++) {
          const env = 1 - j / clapLen;
          data[start + j] += (Math.random() * 2 - 1) * 0.5 * env;
        }
      }

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1800;
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0.85;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start();
    } catch {
      /* audio not available — emojis still fire */
    }
  }

  // ---- Emojis ---------------------------------------------------------------
  function spawnEmojis() {
    const batch: FloatingEmoji[] = [];
    for (let i = 0; i < PER_BURST; i++) {
      batch.push({
        id: emojiSeq++,
        char: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
        left: 5 + Math.random() * 90,
        fontSize: 34 + Math.random() * 34,
        duration: 3.5 + Math.random() * 2,
        rise: 85 + Math.random() * 25,
        drift: (Math.random() - 0.5) * 220,
        rot: (Math.random() - 0.5) * 80,
      });
    }
    setEmojis((prev) => {
      const next = [...prev, ...batch];
      return next.length > MAX_ON_SCREEN
        ? next.slice(next.length - MAX_ON_SCREEN)
        : next;
    });

    // Clean up this batch once its longest animation is done.
    const maxMs = Math.max(...batch.map((e) => e.duration)) * 1000 + 200;
    const ids = new Set(batch.map((e) => e.id));
    setTimeout(() => {
      setEmojis((prev) => prev.filter((e) => !ids.has(e.id)));
    }, maxMs);
  }

  function triggerApplause() {
    playApplause();
    spawnEmojis();
  }

  // ---- Realtime -------------------------------------------------------------
  useEffect(() => {
    // Initial state: the most recent text_update.
    supabase
      .from("stream_events")
      .select("content, helper_name")
      .eq("event_type", "text_update")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data[0]) showMessage(data[0].content ?? "", data[0].helper_name ?? "");
      });

    const channel = supabase
      .channel("overlay")
      // New text pushed from the control panel (persistent, via Postgres).
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "stream_overlay",
          table: "stream_events",
          filter: "event_type=eq.text_update",
        },
        (payload) => {
          const next = payload.new as { content?: string; helper_name?: string };
          showMessage(next.content ?? "", next.helper_name ?? "");
        }
      )
      // Applause (ephemeral, via Broadcast — never touches the DB).
      .on("broadcast", { event: "applause" }, () => triggerApplause())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (dismissRef.current) clearTimeout(dismissRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aspectClass = aspect === "9:16" ? styles.portrait : styles.landscape;

  return (
    <div className={`${styles.root} ${aspectClass}`}>
      <MidiFrame aspect={aspect} />
      <RequestTicker />
      <NowPlaying />
      <ChatEmbed />

      <div className={styles.announce}>
        {previous && (
          <div
            key={`prev-${previous.id}`}
            className={`${styles.slot} ${styles.exiting}`}
            onAnimationEnd={() =>
              setPrevious((p) => (p && p.id === previous.id ? null : p))
            }
          >
            <span className={styles.title}>{previous.text}</span>
            {previous.name && <span className={styles.by}>— {previous.name}</span>}
          </div>
        )}
        {current && (
          <div key={`cur-${current.id}`} className={`${styles.slot} ${styles.entering}`}>
            <span className={styles.title}>{current.text}</span>
            {current.name && <span className={styles.by}>— {current.name}</span>}
          </div>
        )}
      </div>

      {emojis.map((e) => (
        <span
          key={e.id}
          className={styles.emoji}
          style={
            {
              left: `${e.left}vw`,
              fontSize: `${e.fontSize}px`,
              animationDuration: `${e.duration}s`,
              "--rise": `${e.rise}vh`,
              "--drift": `${e.drift}px`,
              "--rot": `${e.rot}deg`,
            } as React.CSSProperties
          }
        >
          {e.char}
        </span>
      ))}
    </div>
  );
}
