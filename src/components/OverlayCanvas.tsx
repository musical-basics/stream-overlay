"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./OverlayCanvas.module.css";

const EMOJIS = ["👏", "🎉", "👏🏽", "🙌", "✨", "👏🏼"];
const PER_BURST = 12; // "not too many"
const MAX_ON_SCREEN = 40;

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

export default function OverlayCanvas() {
  const [text, setText] = useState("");
  const [emojis, setEmojis] = useState<FloatingEmoji[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // ---- Audio ----------------------------------------------------------------
  // Tries /public/applause.mp3 first; if it's missing or blocked, falls back to
  // a synthesized applause so the button always does something. OBS captures
  // this Browser source's audio automatically.
  function playApplause() {
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
    // Initial state.
    supabase
      .from("overlay_state")
      .select("now_playing")
      .eq("id", 1)
      .single()
      .then(({ data }) => {
        if (data) setText(data.now_playing ?? "");
      });

    const channel = supabase
      .channel("overlay-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "overlay_state" },
        (payload) => {
          const next = payload.new as { now_playing?: string };
          setText(next.now_playing ?? "");
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "applause_events" },
        () => triggerApplause()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.root}>
      <div className={`${styles.lowerThird} ${text ? styles.show : ""}`}>
        <span className={styles.title}>{text}</span>
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
