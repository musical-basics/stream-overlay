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

// Velocity → colour: soft notes are blue (hue 240), loud notes red (hue 0),
// sweeping through the rainbow in between. Used for both the lit key and its
// particle burst so a hard-struck note glows red and throws red sparks.
function velocityColor(velocity: number): string {
  const v = Math.max(1, Math.min(127, velocity));
  const hue = 240 * (1 - (v - 1) / 126);
  return `hsl(${hue} 100% 55%)`;
}

// Inward travel vector for a particle leaving a key on the given edge — i.e.
// "off the playing surface, toward the centre of the screen". `lateral` is the
// sideways spread along the edge; `dist` is how far it flies inward.
function inwardVector(edge: Edge, lateral: number, dist: number): [number, number] {
  if (edge === "top") return [lateral, dist]; // top keys: inward is downward
  if (edge === "bottom") return [lateral, -dist]; // bottom keys: inward is upward
  if (edge === "left") return [dist, lateral]; // left keys: inward is rightward
  return [-dist, lateral]; // right keys: inward is leftward
}

type Particle = {
  id: number;
  midi: number; // which key it belongs to (rendered inside that key's slot)
  color: string;
  tx: number; // end translate X (px)
  ty: number; // end translate Y (px)
  size: number; // px
  dur: number; // s
};

const MAX_PARTICLES = 160; // hard cap so fast playing can't pile up unbounded

// The overlay runs inside the admin panel's iframe, so a MIDI failure here is
// otherwise invisible: a dark keyboard looks identical whether the permission
// was denied, Chrome found no devices, or MIDI was never requested at all.
// Post the real state up to the parent (same origin only) so the panel can say
// which one it is. Harmless no-op in OBS, where there is no parent frame.
type MidiState =
  | "unsupported"
  | "skipped"
  | "error"
  | "ready"
  | "note"
  | "relay";

// One entry per input the browser can see, so the panel can offer a picker
// rather than the all-or-nothing listen we used to do.
type MidiInputInfo = { id: string; name: string };

function report(r: {
  state: MidiState;
  inputs?: MidiInputInfo[];
  message?: string;
  relay?: string;
  selectedId?: string; // "" means "listen to every input"
}) {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(
    { type: "midi-status", ...r },
    window.location.origin
  );
}

// Which input to listen to. Stored in localStorage rather than passed down from
// the panel, because the iframe connects to MIDI before the parent could post a
// choice — reading it here means the very first attach already honours it. Same
// origin as the panel, so both sides see the same value.
const INPUT_KEY = "midi-input-id";

function savedInputId(): string {
  try {
    return window.localStorage.getItem(INPUT_KEY) ?? "";
  } catch {
    return ""; // private mode / blocked storage: fall back to all inputs
  }
}

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
  // note -> velocity (1..127) for currently-held keys; drives the lit colour.
  const [active, setActive] = useState<Map<number, number>>(new Map());
  const [particles, setParticles] = useState<Particle[]>([]);
  const partSeq = useRef(0);
  // note -> edge, so a particle burst knows which way to fly. Kept in a ref so
  // spawnParticles stays stable (doesn't re-bind the MIDI handlers).
  const edgeByMidi = useRef<Map<number, Edge>>(new Map());
  // Lets the "Refresh MIDI connection" broadcast re-run the connect routine.
  const reconnectRef = useRef<() => void>(() => {});
  // Rejoins the relay channel if it has dropped. Called from the MIDI event
  // path — which Chrome never throttles — so a hidden tab heals itself.
  const repairRelayRef = useRef<() => void>(() => {});
  // Channel used to relay notes (OBS can't read Web MIDI, so a real browser
  // broadcasts notes and the OBS overlay lights up from them).
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Note events awaiting relay. We batch a frame's worth into ONE broadcast
  // instead of one-per-event, which keeps Realtime message volume (and cost)
  // low while preserving every note, its velocity, and its particle burst.
  const pendingRef = useRef<Array<{ note: number; on: boolean; vel: number }>>([]);

  // Throw a small velocity-coloured particle burst off the pressed key.
  const spawnParticles = useCallback((note: number, velocity: number) => {
    const edge = edgeByMidi.current.get(note);
    if (!edge) return;
    const color = velocityColor(velocity);
    const count = 3 + Math.round((velocity / 127) * 5); // 3..8, louder = more
    const batch: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const dist = 30 + Math.random() * 32 + (velocity / 127) * 28; // louder = higher
      const lateral = (Math.random() - 0.5) * 26;
      const size = 4 + Math.random() * 4;
      const dur = 0.5 + Math.random() * 0.4;
      const [tx, ty] = inwardVector(edge, lateral, dist);
      batch.push({ id: partSeq.current++, midi: note, color, tx, ty, size, dur });
    }
    setParticles((prev) => {
      const next = [...prev, ...batch];
      return next.length > MAX_PARTICLES
        ? next.slice(next.length - MAX_PARTICLES)
        : next;
    });
    const ids = new Set(batch.map((b) => b.id));
    const maxMs = Math.max(...batch.map((b) => b.dur)) * 1000 + 120;
    setTimeout(
      () => setParticles((prev) => prev.filter((p) => !ids.has(p.id))),
      maxMs
    );
  }, []);

  // Set/clear a lit key (with its velocity). Shared by local MIDI and relayed
  // broadcasts. A note-on also throws a particle burst.
  const applyNote = useCallback(
    (note: number, on: boolean, velocity = 100) => {
      setActive((prev) => {
        if (on) {
          const next = new Map(prev);
          next.set(note, velocity);
          return next;
        }
        if (!prev.has(note)) return prev;
        const next = new Map(prev);
        next.delete(note);
        return next;
      });
      if (on) spawnParticles(note, velocity);
    },
    [spawnParticles]
  );

  useEffect(() => setKeys(buildKeys(aspect)), [aspect]);

  // Keep the note→edge lookup in sync with the current layout.
  useEffect(() => {
    const m = new Map<number, Edge>();
    for (const k of keys) m.set(k.midi, k.edge);
    edgeByMidi.current = m;
  }, [keys]);

  useEffect(() => {
    if (typeof navigator.requestMIDIAccess !== "function") {
      report({ state: "unsupported" }); // e.g. OBS's browser — relay-only
      return;
    }

    // Only fire the MIDI permission request in the real overlay (OBS) or when
    // explicitly allowed (?midi=1). In an admin preview (?preview=1) we skip it
    // unless midi=1 is also present, so only Lionel's panel prompts for MIDI —
    // helpers just see the (unlit) keyboard frame.
    const params = new URLSearchParams(window.location.search);
    const allowMidi = !params.has("preview") || params.get("midi") === "1";
    if (!allowMidi) {
      report({ state: "skipped" });
      return;
    }

    let cancelled = false;
    let access: MIDIAccess | null = null;

    // Heartbeat so the panel can distinguish "device attached but silent"
    // (cable/keyboard problem) from "notes arriving". Throttled to 1/sec —
    // it's a liveness signal, not a note stream.
    let lastPing = 0;
    const pingNote = () => {
      const now = performance.now();
      if (now - lastPing < 1000) return;
      lastPing = now;
      report({ state: "note" });
    };

    // Relay batching, driven by the MIDI events themselves rather than by a
    // wall-clock interval. Chrome clamps timers in a hidden tab to 1/sec, and
    // to 1/min once it has been hidden for five minutes ("intensive
    // throttling") — and this tab sits hidden behind OBS for a whole stream,
    // which is what used to kill the relay a few minutes in. Incoming MIDI is
    // never throttled, so a note both fills the batch and pushes it out; the
    // timer below is only a trailing backstop for the last note of a phrase.
    const BATCH_MS = 50;
    let lastSend = 0;
    let trailing: ReturnType<typeof setTimeout> | null = null;

    const flushNow = () => {
      if (trailing) {
        clearTimeout(trailing);
        trailing = null;
      }
      const batch = pendingRef.current;
      if (batch.length === 0) return;
      pendingRef.current = [];
      lastSend = performance.now();
      // Every flush is also a chance to notice the socket died and rebuild it.
      repairRelayRef.current();
      channelRef.current?.send({
        type: "broadcast",
        event: "notes",
        payload: { e: batch },
      });
    };

    const scheduleFlush = () => {
      const wait = BATCH_MS - (performance.now() - lastSend);
      if (wait <= 0) {
        flushNow();
        return;
      }
      if (!trailing) trailing = setTimeout(flushNow, wait);
    };

    const onMessage = (e: MIDIMessageEvent) => {
      const data = e.data;
      if (!data || data.length < 2) return;
      const cmd = data[0] & 0xf0;
      const note = data[1];
      const vel = data[2] ?? 0;
      const on = cmd === 0x90 && vel > 0;
      const off = cmd === 0x80 || (cmd === 0x90 && vel === 0);
      if (!on && !off) return;
      applyNote(note, on, vel); // light + spark locally, immediately
      pingNote();
      // Queue for a batched relay so a fast passage becomes a few messages
      // instead of hundreds, then push it out on this same (unthrottled) event.
      pendingRef.current.push({ note, on, vel });
      scheduleFlush();
    };

    // Bind the message handler to the chosen input only (or to all of them when
    // nothing is chosen). Every input is unbound first, so switching devices
    // can't leave the previous one still feeding notes in. If the saved input
    // has gone away — keyboard unplugged, port renumbered — we fall back to
    // listening to everything rather than going silently dead, and tell the
    // panel the selection didn't stick by reporting the id we actually used.
    const attach = (m: MIDIAccess) => {
      const wanted = savedInputId();
      const inputs: MidiInputInfo[] = [];
      let matched = false;
      m.inputs.forEach((input) => {
        inputs.push({ id: input.id, name: input.name || "unnamed device" });
        if (wanted && input.id === wanted) matched = true;
      });
      const selectedId = matched ? wanted : "";
      m.inputs.forEach((input) => {
        input.onmidimessage =
          selectedId && input.id !== selectedId ? null : onMessage;
      });
      report({ state: "ready", inputs, selectedId });
    };

    const connect = () => {
      navigator
        .requestMIDIAccess({ sysex: false })
        .then((m) => {
          if (cancelled) return;
          access = m;
          attach(m);
          m.onstatechange = () => attach(m);
          setActive(new Map()); // clear any stuck/lit notes on (re)connect
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // Denied permission / blocked by policy used to vanish here, leaving
          // no way to tell why the keyboard stayed dark.
          report({
            state: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        });
    };

    connect();

    // The panel writes the new choice to localStorage, then posts this so we
    // re-bind immediately — no reload, no dropped stream. Notes still held on
    // the old input would never get their note-off, so clear the lit keys.
    const onSelect = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string };
      if (d?.type !== "midi-select" || !access) return;
      setActive(new Map());
      attach(access);
    };
    window.addEventListener("message", onSelect);

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
      window.removeEventListener("message", onSelect);
      if (trailing) clearTimeout(trailing);
      if (access) access.inputs.forEach((input) => (input.onmidimessage = null));
    };
  }, [applyNote]);

  // Realtime channel: relays notes between overlay instances and carries the
  // admin "Refresh MIDI connection" signal. The OBS overlay (no Web MIDI)
  // lights up purely from the relayed "note" broadcasts.
  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let joined = false;
    let disposing = false;
    let lastRejoin = 0;
    // Bumped per channel built, so a late status callback from a channel we
    // already discarded can't report over a healthy replacement.
    let gen = 0;

    const open = () => {
      const myGen = ++gen;
      const ch = supabase
        .channel("midi")
        .on("broadcast", { event: "refresh" }, () => reconnectRef.current())
        .on("broadcast", { event: "notes" }, (msg) => {
          const p = (msg.payload ?? {}) as {
            e?: Array<{ note?: number; on?: boolean; vel?: number }>;
          };
          if (!Array.isArray(p.e)) return;
          for (const ev of p.e) {
            if (typeof ev.note === "number")
              applyNote(ev.note, !!ev.on, ev.vel ?? 100);
          }
        })
        .subscribe((status) => {
          if (cancelled || myGen !== gen) return;
          joined = status === "SUBSCRIBED";
          report({ state: "relay", relay: status });
          // A throttled tab misses Realtime's heartbeat and the server hangs
          // up. Rebuild rather than sitting there silently disconnected.
          if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          )
            rejoin();
        });
      channel = ch;
      channelRef.current = ch;
    };

    // Tear down and rebuild the channel, rate-limited so a flapping socket
    // can't spin. The guard uses a timestamp comparison, not a timer, so it
    // still works when the tab is throttled.
    const rejoin = () => {
      if (cancelled || disposing) return;
      const now = performance.now();
      if (now - lastRejoin < 2000) return;
      lastRejoin = now;
      disposing = true;
      const old = channel;
      channel = null;
      channelRef.current = null;
      if (old) supabase.removeChannel(old);
      disposing = false;
      supabase.realtime.connect(); // no-op if the socket is already up
      open();
    };

    open();
    repairRelayRef.current = () => {
      if (!joined) rejoin();
    };

    // Coming back to the tab is the other natural moment to check the socket.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !joined) rejoin();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      repairRelayRef.current = () => {};
      document.removeEventListener("visibilitychange", onVisible);
      channelRef.current = null;
      if (channel) supabase.removeChannel(channel);
    };
  }, [applyNote]);

  // Group live particles by key so each slot renders only its own.
  const partsByMidi = new Map<number, Particle[]>();
  for (const p of particles) {
    const list = partsByMidi.get(p.midi);
    if (list) list.push(p);
    else partsByMidi.set(p.midi, [p]);
  }

  return (
    <div className={styles.frame} aria-hidden>
      {keys.map((k) => {
        const vel = active.get(k.midi);
        const parts = partsByMidi.get(k.midi);
        return (
          <div key={k.midi} className={styles.slot} style={styleFor(k)}>
            <div
              className={[
                styles.key,
                styles[k.edge],
                k.black ? styles.black : styles.white,
                vel ? styles.lit : "",
              ].join(" ")}
              // Velocity colour overrides the per-edge --c on the lit key only.
              style={vel ? ({ "--c": velocityColor(vel) } as React.CSSProperties) : undefined}
            />
            {parts?.map((p) => (
              <span
                key={p.id}
                className={styles.particle}
                style={
                  {
                    "--pc": p.color,
                    "--tx": `${p.tx}px`,
                    "--ty": `${p.ty}px`,
                    "--size": `${p.size}px`,
                    "--dur": `${p.dur}s`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
