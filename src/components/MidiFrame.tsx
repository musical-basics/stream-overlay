"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import type { OverlayAspect } from "./OverlayCanvas";
import styles from "./MidiFrame.module.css";

// An 88-key piano (MIDI 21 = A0 .. 108 = C8) wrapped around the screen edge,
// Synthesia-style. White keys tile each edge contiguously; black keys are
// narrower/shorter and straddle the boundary between their two white
// neighbours, sitting on top. Keys light up in their side's colour when the
// matching MIDI note plays (read locally via the Web MIDI API).

type Edge = "left" | "bottom" | "right" | "top";

const BLACK = new Set([1, 3, 6, 8, 10]); // C# D# F# G# A#
const isBlack = (midi: number) => BLACK.has(((midi % 12) + 12) % 12);

const A0 = 21;

const D = "var(--frame-d)"; // white-key depth (inward)
const BD = `calc(0.62 * ${D})`; // black-key depth (shorter)

function edgesFor(aspect: OverlayAspect): Array<[Edge, number]> {
  return aspect === "9:16"
    ? [
        ["left", 26],
        ["bottom", 18],
        ["right", 26],
        ["top", 18],
      ]
    : [
        ["left", 18],
        ["bottom", 26],
        ["right", 18],
        ["top", 26],
      ];
}

type Placed = {
  midi: number;
  edge: Edge;
  black: boolean;
  along: number; // start fraction along the edge, in walk direction (0..1)
  len: number; // length fraction along the edge
};

// Lay out one edge's notes: whites tile [0,1]; blacks straddle white seams.
function placeEdge(edge: Edge, start: number, count: number): Placed[] {
  const notes = Array.from({ length: count }, (_, i) => start + i);
  const whiteIndex = new Map<number, number>();
  let w = 0;
  for (const n of notes) if (!isBlack(n)) whiteIndex.set(n, w++);
  const W = Math.max(1, w);
  const blackLen = 0.62 / W;

  const out: Placed[] = [];
  for (const n of notes) {
    if (!isBlack(n)) {
      const iw = whiteIndex.get(n)!;
      out.push({ midi: n, edge, black: false, along: iw / W, len: 1 / W });
    } else {
      // The white key just below a black note is always n-1.
      const prev = whiteIndex.get(n - 1);
      const boundary = prev === undefined ? 0 : (prev + 1) / W;
      let along = boundary - blackLen / 2;
      along = Math.max(0, Math.min(1 - blackLen, along));
      out.push({ midi: n, edge, black: true, along, len: blackLen });
    }
  }
  return out;
}

function buildKeys(aspect: OverlayAspect): Placed[] {
  const keys: Placed[] = [];
  let midi = A0;
  for (const [edge, count] of edgesFor(aspect)) {
    keys.push(...placeEdge(edge, midi, count));
    midi += count;
  }
  return keys; // 88 keys
}

// Map a placed key to absolute CSS. Vertical edges run the full height; the
// horizontal edges are inset by one white-key depth so they sit between the
// vertical bars (clean corners).
function styleFor(k: Placed): React.CSSProperties {
  const depth = k.black ? BD : D;
  const inner = `(100% - 2 * ${D})`;
  switch (k.edge) {
    case "left": // top -> bottom
      return { left: 0, top: `${k.along * 100}%`, height: `${k.len * 100}%`, width: depth };
    case "right": {
      const top = 1 - k.along - k.len; // walk is bottom -> top
      return { right: 0, top: `${top * 100}%`, height: `${k.len * 100}%`, width: depth };
    }
    case "bottom": // left -> right
      return {
        bottom: 0,
        height: depth,
        left: `calc(${D} + ${k.along} * ${inner})`,
        width: `calc(${k.len} * ${inner})`,
      };
    case "top": {
      const l = 1 - k.along - k.len; // walk is right -> left
      return {
        top: 0,
        height: depth,
        left: `calc(${D} + ${l} * ${inner})`,
        width: `calc(${k.len} * ${inner})`,
      };
    }
  }
}

export default function MidiFrame({ aspect }: { aspect: OverlayAspect }) {
  const [keys, setKeys] = useState<Placed[]>(() => buildKeys(aspect));
  const [active, setActive] = useState<Set<number>>(new Set());
  // Lets the "Refresh MIDI connection" broadcast re-run the connect routine.
  const reconnectRef = useRef<() => void>(() => {});
  // Channel used to relay notes (OBS can't read Web MIDI, so a real browser
  // broadcasts notes and the OBS overlay lights up from them).
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Set/clear a lit key. Shared by local MIDI and relayed broadcasts.
  const applyNote = useCallback((note: number, on: boolean) => {
    setActive((prev) => {
      if (on) {
        if (prev.has(note)) return prev;
        const next = new Set(prev);
        next.add(note);
        return next;
      }
      if (!prev.has(note)) return prev;
      const next = new Set(prev);
      next.delete(note);
      return next;
    });
  }, []);

  useEffect(() => setKeys(buildKeys(aspect)), [aspect]);

  useEffect(() => {
    if (typeof navigator.requestMIDIAccess !== "function") return; // unsupported

    // Only fire the MIDI permission request in the real overlay (OBS) or when
    // explicitly allowed (?midi=1). In an admin preview (?preview=1) we skip it
    // unless midi=1 is also present, so only Lionel's panel prompts for MIDI —
    // helpers just see the (unlit) keyboard frame.
    const params = new URLSearchParams(window.location.search);
    const allowMidi = !params.has("preview") || params.get("midi") === "1";
    if (!allowMidi) return;

    let cancelled = false;
    let access: MIDIAccess | null = null;

    const onMessage = (e: MIDIMessageEvent) => {
      const data = e.data;
      if (!data || data.length < 2) return;
      const cmd = data[0] & 0xf0;
      const note = data[1];
      const vel = data[2] ?? 0;
      const on = cmd === 0x90 && vel > 0;
      const off = cmd === 0x80 || (cmd === 0x90 && vel === 0);
      if (!on && !off) return;
      const lit = on;
      applyNote(note, lit); // light locally
      // Relay to other overlay instances (notably the OBS one, which can't
      // read Web MIDI itself).
      channelRef.current?.send({
        type: "broadcast",
        event: "note",
        payload: { note, on: lit },
      });
    };

    const attach = (m: MIDIAccess) =>
      m.inputs.forEach((input) => (input.onmidimessage = onMessage));

    const connect = () => {
      navigator
        .requestMIDIAccess({ sysex: false })
        .then((m) => {
          if (cancelled) return;
          access = m;
          attach(m);
          m.onstatechange = () => attach(m);
          setActive(new Set()); // clear any stuck/lit notes on (re)connect
        })
        .catch(() => {});
    };

    connect();

    // A real reconnect must re-acquire the device from the browser. Web MIDI
    // caches the granted MIDIAccess, so re-calling requestMIDIAccess won't
    // re-scan a keyboard that dropped — it just re-binds the same stale (often
    // empty) input list. Reloading the page forces the browser to enumerate
    // MIDI devices from scratch. This only runs in the MIDI-capable overlay
    // (Lionel's preview / a Web-MIDI browser); OBS has no Web MIDI, so its
    // reconnect stays the default no-op and the stream never flashes.
    reconnectRef.current = () => window.location.reload();

    return () => {
      cancelled = true;
      reconnectRef.current = () => {};
      if (access) access.inputs.forEach((input) => (input.onmidimessage = null));
    };
  }, [applyNote]);

  // Realtime channel: relays notes between overlay instances and carries the
  // admin "Refresh MIDI connection" signal. The OBS overlay (no Web MIDI)
  // lights up purely from the relayed "note" broadcasts.
  useEffect(() => {
    const channel = supabase
      .channel("midi")
      .on("broadcast", { event: "refresh" }, () => reconnectRef.current())
      .on("broadcast", { event: "note" }, (msg) => {
        const p = (msg.payload ?? {}) as { note?: number; on?: boolean };
        if (typeof p.note === "number") applyNote(p.note, !!p.on);
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [applyNote]);

  return (
    <div className={styles.frame} aria-hidden>
      {keys.map((k) => (
        <div key={k.midi} className={styles.slot} style={styleFor(k)}>
          <div
            className={[
              styles.key,
              styles[k.edge],
              k.black ? styles.black : styles.white,
              active.has(k.midi) ? styles.lit : "",
            ].join(" ")}
          />
        </div>
      ))}
    </div>
  );
}
