// Synthesizes a short crowd-applause clip and writes public/applause.wav.
// Run: node scripts/gen-applause.mjs   (then encode to mp3 with ffmpeg)
//
// Model: applause = hundreds of individual "claps". Each clap is a brief burst
// of lightly low-passed white noise with a sharp attack and exponential decay,
// scattered randomly in time, panned across the stereo field. A density taper
// + master fade make it swell in and trail off naturally. Deterministic PRNG
// so the asset is reproducible.

import fs from "node:fs";

const sampleRate = 44100;
const dur = 4.0;
const n = Math.floor(sampleRate * dur);
const left = new Float32Array(n);
const right = new Float32Array(n);

let seed = 1337;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

// Density envelope: ramp in, hold, taper out — controls how many claps land.
function density(t) {
  const fin = Math.min(1, t / 0.3);
  const outStart = dur - 1.4;
  const fout = t < outStart ? 1 : Math.max(0, 1 - (t - outStart) / 1.4);
  return fin * fout;
}

const numClaps = 2400;
for (let c = 0; c < numClaps; c++) {
  const t0 = rand() * (dur - 0.12);
  if (rand() > density(t0)) continue; // thin claps out at the edges

  const i0 = Math.floor(t0 * sampleRate);
  const amp = (0.3 + rand() * 0.7) * 0.45;
  const tau = 0.008 + rand() * 0.022; // decay time (s)
  const pan = rand() * 2 - 1;
  const lGain = Math.cos(((pan + 1) * Math.PI) / 4); // equal-power pan
  const rGain = Math.sin(((pan + 1) * Math.PI) / 4);
  const clapLen = Math.floor(tau * 6 * sampleRate);
  const cutoff = 0.2 + rand() * 0.35; // one-pole low-pass coefficient
  let lp = 0;

  for (let j = 0; j < clapLen; j++) {
    const idx = i0 + j;
    if (idx >= n) break;
    const decay = Math.exp(-(j / sampleRate) / tau);
    const white = rand() * 2 - 1;
    lp += cutoff * (white - lp);
    const s = lp * decay * amp;
    left[idx] += s * lGain;
    right[idx] += s * rGain;
  }
}

// DC-blocking high-pass to clean up rumble.
function highpass(buf) {
  let prevIn = 0;
  let prevOut = 0;
  const R = 0.995;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = R * (prevOut + x - prevIn);
    prevOut = y;
    prevIn = x;
    buf[i] = y;
  }
}
highpass(left);
highpass(right);

// Master fade in/out so the clip starts and ends cleanly.
for (let i = 0; i < n; i++) {
  const t = i / sampleRate;
  const fin = Math.min(1, t / 0.15);
  const fout = t > dur - 1.0 ? Math.max(0, 1 - (t - (dur - 1.0)) / 1.0) : 1;
  const m = fin * fout;
  left[i] *= m;
  right[i] *= m;
}

// Normalize to ~ -1.5 dBFS.
let peak = 0;
for (let i = 0; i < n; i++)
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
const g = peak > 0 ? Math.pow(10, -1.5 / 20) / peak : 1;

// Write 16-bit stereo WAV.
const blockAlign = 4; // 2 channels * 2 bytes
const dataSize = n * blockAlign;
const out = Buffer.alloc(44 + dataSize);
out.write("RIFF", 0);
out.writeUInt32LE(36 + dataSize, 4);
out.write("WAVE", 8);
out.write("fmt ", 12);
out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20); // PCM
out.writeUInt16LE(2, 22); // channels
out.writeUInt32LE(sampleRate, 24);
out.writeUInt32LE(sampleRate * blockAlign, 28);
out.writeUInt16LE(blockAlign, 32);
out.writeUInt16LE(16, 34);
out.write("data", 36);
out.writeUInt32LE(dataSize, 40);

let off = 44;
for (let i = 0; i < n; i++) {
  const l = Math.max(-1, Math.min(1, left[i] * g));
  const r = Math.max(-1, Math.min(1, right[i] * g));
  out.writeInt16LE(Math.round(l * 32767), off);
  out.writeInt16LE(Math.round(r * 32767), off + 2);
  off += 4;
}

fs.writeFileSync("public/applause.wav", out);
console.log(`wrote public/applause.wav (${(dataSize / 1024).toFixed(0)} KB)`);
