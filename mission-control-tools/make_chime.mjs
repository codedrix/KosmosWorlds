// make_chime.mjs -- writes audio/chime.wav: the soft two-note chime for a new approval.
//
// @kosmos-system Content (KosmosWorlds) -- Mission Control (DB-043)
// @kosmos-owner  Content lane
//
// Two bell-like notes (C6 then E6, 140 ms apart), each a fundamental plus a quiet
// octave, a 6 ms attack and an exponential decay, peak about -12 dBFS: noticeable
// across the room, never startling. 22.05 kHz mono 16-bit WAV (WAV or OGG only).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 22050;
const SECONDS = 1.2;
const n = Math.round(RATE * SECONDS);
const samples = new Float32Array(n);
const note = (start, freq, gain) => {
  const s0 = Math.round(start * RATE);
  for (let i = s0; i < n; i++) {
    const t = (i - s0) / RATE;
    const env = Math.min(1, t / 0.006) * Math.exp(-t * 4.2);
    samples[i] += gain * env * (Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(2 * Math.PI * freq * 2 * t));
  }
};
note(0.0, 1046.5, 0.22);
note(0.14, 1318.5, 0.2);
const pcm = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "mission-control", "audio", "chime.wav");
fs.writeFileSync(out, Buffer.concat([header, pcm]));
console.log(`wrote ${out} (${44 + pcm.length} bytes)`);
