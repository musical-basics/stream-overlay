"use client";

import { useEffect, useState } from "react";
import type { OverlayAspect } from "./OverlayCanvas";
import styles from "./MidiFrame.module.css";

// An 88-key piano (MIDI 21 = A0 .. MIDI 108 = C8) wrapped around the edge of
// the screen, Synthesia-style: keys light up in their side's colour when the
// matching MIDI note is played. Reads the local MIDI device via Web MIDI, so
// it works when the overlay runs as an OBS Browser source on the same machine.

type Edge = "left" | "bottom" | "right" | "top";

// Notes (mod 12) that are black keys: C# D# F# G# A#.
const BLACK = new Set([1, 3, 6, 8, 10]);

const A0 = 21; // lowest MIDI note on an 88-key piano

// Walk order around the frame. Counts differ per orientation but both total 88.
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

const D = "var(--frame-d)"; // key depth (how far each key sticks inward)

// Position + size for the slot a key occupies along its edge. Vertical edges
// run the full height; horizontal edges sit inset between them so corners stay
// clean. `p` is the index within the edge, in the walk direction.
function slotStyle(edge: Edge, p: number, count: number): React.CSSProperties {
  const seg = 100 / count;
  const hSpan = `((100% - 2 * ${D}) / ${count})`;
  switch (edge) {
    case "left": // top -> bottom
      return { left: 0, top: `${p * seg}%`, width: D, height: `${seg}%` };
    case "right": {
      // bottom -> top
      const fromTop = count - 1 - p;
      return { right: 0, top: `${fromTop * seg}%`, width: D, height: `${seg}%` };
    }
    case "bottom": // left -> right
      return {
        bottom: 0,
        height: D,
        left: `calc(${D} + ${p} * ${hSpan})`,
        width: `calc(${hSpan})`,
      };
    case "top": {
      // right -> left
      const fromLeft = count - 1 - p;
      return {
        top: 0,
        height: D,
        left: `calc(${D} + ${fromLeft} * ${hSpan})`,
        width: `calc(${hSpan})`,
      };
    }
  }
}

type KeyInfo = {
  midi: number;
  edge: Edge;
  isBlack: boolean;
  style: React.CSSProperties;
};

function buildKeys(aspect: OverlayAspect): KeyInfo[] {
  const keys: KeyInfo[] = [];
  let midi = A0;
  for (const [edge, count] of edgesFor(aspect)) {
    for (let p = 0; p < count; p++) {
      keys.push({
        midi,
        edge,
        isBlack: BLACK.has(midi % 12),
        style: slotStyle(edge, p, count),
      });
      midi++;
    }
  }
  return keys; // 88 keys, MIDI 21..108
}

export default function MidiFrame({ aspect }: { aspect: OverlayAspect }) {
  const [keys, setKeys] = useState<KeyInfo[]>(() => buildKeys(aspect));
  const [active, setActive] = useState<Set<number>>(new Set());

  useEffect(() => setKeys(buildKeys(aspect)), [aspect]);

  useEffect(() => {
    if (typeof navigator.requestMIDIAccess !== "function") return; // unsupported

    let cancelled = false;
    let access: MIDIAccess | null = null;

    const onMessage = (e: MIDIMessageEvent) => {
      const data = e.data;
      if (!data || data.length < 2) return;
      const cmd = data[0] & 0xf0;
      const note = data[1];
      const vel = data[2] ?? 0;
      const isOn = cmd === 0x90 && vel > 0;
      const isOff = cmd === 0x80 || (cmd === 0x90 && vel === 0);
      if (isOn) {
        setActive((prev) => {
          const next = new Set(prev);
          next.add(note);
          return next;
        });
      } else if (isOff) {
        setActive((prev) => {
          if (!prev.has(note)) return prev;
          const next = new Set(prev);
          next.delete(note);
          return next;
        });
      }
    };

    const attach = (m: MIDIAccess) =>
      m.inputs.forEach((input) => (input.onmidimessage = onMessage));

    navigator
      .requestMIDIAccess({ sysex: false })
      .then((m) => {
        if (cancelled) return;
        access = m;
        attach(m);
        m.onstatechange = () => attach(m); // re-attach on plug/unplug
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (access) access.inputs.forEach((input) => (input.onmidimessage = null));
    };
  }, []);

  return (
    <div className={styles.frame} aria-hidden>
      {keys.map((k) => (
        <div key={k.midi} className={styles.slot} style={k.style}>
          <div
            className={[
              styles.key,
              styles[k.edge],
              k.isBlack ? styles.black : styles.white,
              active.has(k.midi) ? styles.lit : "",
            ].join(" ")}
          />
        </div>
      ))}
    </div>
  );
}
