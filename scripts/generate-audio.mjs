// Synthesizes every original sound in the game and encodes it to MP3.
// Run: node scripts/generate-audio.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mp3Encoder } from '@breezystack/lamejs';

const SR = 22050;
const TAU = Math.PI * 2;
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'audio');
fs.mkdirSync(out, { recursive: true });
// A full run starts from an empty folder; an MM_ONLY run (see write) replaces only the files it names.
if (!process.env.MM_ONLY) for (const f of fs.readdirSync(out)) if (/\.(wav|mp3)$/.test(f)) fs.unlinkSync(path.join(out, f));

let seed = 11;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const noise = () => rand() * 2 - 1;
const midi = n => 440 * 2 ** ((n - 69) / 12);
const clamp = v => Math.max(-1, Math.min(1, v));
let total = 0;

/**
 * Sounds the game no longer uses (the cursed gem, thornvine fire, thawing ice and the vine rustle). They are still
 * rendered, because every sound draws from one seeded noise generator and skipping one would change every sound after
 * it, but never written.
 */
const RETIRED = new Set(['curse', 'burn', 'thaw', 'grow', 'devour']);
/**
 * Sounds rebuilt by the soft kit at the end of this file. Their first versions are still rendered where they were (for
 * the same reason as the retired ones) but only the soft kit's versions are written.
 */
const SUPERSEDED = new Set(['amb0', 'amb1', 'amb2', 'amb3', 'amb4', 'rotate0', 'rotate1', 'rotate2', 'rotate3', 'turn', 'zap', 'split', 'charge',
  'type', 'glide', 'grind', 'crystal', 'star1', 'star2', 'star3', 'win']);
let softKit = false;
/** `MM_ONLY=glide,seal` writes just those files and leaves every other asset untouched. */
const ONLY = process.env.MM_ONLY ? new Set(process.env.MM_ONLY.split(',')) : undefined;
function write(name, data, { peak = .9, kbps = 64, loop = false } = {}) {
  if (RETIRED.has(name) || (SUPERSEDED.has(name) && !softKit) || (ONLY && !ONLY.has(name))) return;
  if (loop) {
    // Fold the tail into the head so the loop point is seamless.
    const fade = Math.floor(SR * .5);
    for (let i = 0; i < fade; i++) { const k = i / fade; data[i] = data[i] * k + data[data.length - fade + i] * (1 - k); }
    data = data.subarray(0, data.length - fade);
  }
  let max = 0;
  for (const v of data) max = Math.max(max, Math.abs(v));
  if (!Number.isFinite(max) || max < 1e-4) throw new Error(`${name}: silent or invalid signal`);
  const gain = max > 0 ? peak / max : 1;
  const pcm = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) pcm[i] = Math.round(clamp(data[i] * gain) * 32760);
  const enc = new Mp3Encoder(1, SR, kbps);
  const chunks = [];
  for (let i = 0; i < pcm.length; i += 1152) chunks.push(Buffer.from(enc.encodeBuffer(pcm.subarray(i, i + 1152))));
  chunks.push(Buffer.from(enc.flush()));
  const buf = Buffer.concat(chunks);
  fs.writeFileSync(path.join(out, `${name}.mp3`), buf);
  total += buf.length;
}

const buffer = s => new Float32Array(Math.floor(s * SR));
function render(seconds, fn) { const d = buffer(seconds); for (let i = 0; i < d.length; i++) d[i] = fn(i / SR, i); return d; }
function mix(target, source, at, gain = 1, wrap = false) {
  const start = Math.floor(at * SR);
  for (let i = 0; i < source.length; i++) {
    let j = start + i;
    if (j >= target.length) { if (!wrap) break; j %= target.length; }
    if (j >= 0) target[j] += source[i] * gain;
  }
}
function reverb(data, wet = .25, size = 1, wrap = false) {
  const taps = [[1557, .5], [1617, .46], [1491, .44], [1422, .42], [1277, .4], [1356, .38]].map(([d, f]) => [Math.floor(d * size), f]);
  const res = Float32Array.from(data);
  for (const [delay, fb] of taps) {
    const line = new Float32Array(data.length);
    for (let pass = 0; pass < (wrap ? 2 : 1); pass++) for (let i = 0; i < data.length; i++) {
      const k = i - delay;
      line[i] = data[i] + (k >= 0 ? line[k] : wrap ? line[k + data.length] : 0) * fb;
    }
    for (let i = 0; i < data.length; i++) res[i] += line[i] * wet / taps.length;
  }
  return res;
}
// Filters
const lowpass = (data, cutoff) => { const a = 1 - Math.exp(-TAU * cutoff / SR); let y = 0; return data.map(x => (y += a * (x - y))); };
const highpass = (data, cutoff) => { const lp = lowpass(Float32Array.from(data), cutoff); return data.map((x, i) => x - lp[i]); };
function bandpass(data, freqFn, q = 4) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return data.map((x, i) => {
    const f = typeof freqFn === 'function' ? freqFn(i / SR) : freqFn;
    const w = TAU * f / SR, alpha = Math.sin(w) / (2 * q), cos = Math.cos(w), a0 = 1 + alpha;
    const y = ((alpha) * x - alpha * x2 - (-2 * cos) * y1 - (1 - alpha) * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  });
}
/** A 2nd-order (12 dB per octave) low-pass whose cutoff may move over time; cascaded, it leaves no hiss above the cutoff. */
function lowpass2(data, freqFn, q = Math.SQRT1_2) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return data.map((x, i) => {
    const f = typeof freqFn === 'function' ? freqFn(i / SR) : freqFn;
    const w = TAU * f / SR, alpha = Math.sin(w) / (2 * q), cos = Math.cos(w), a0 = 1 + alpha, b = (1 - cos) / 2;
    const y = (b * x + 2 * b * x1 + b * x2 + 2 * cos * y1 - (1 - alpha) * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  });
}
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) * d));
const noiseBuf = s => render(s, () => noise());

// Instruments
const bell = (f, len = 1.6, decay = 2.6, index = 1.8) => render(len, t =>
  Math.sin(TAU * f * t + index * Math.exp(-t * 4) * Math.sin(TAU * f * 3.5 * t)) * env(t, .002, decay) * .6 + Math.sin(TAU * f * 2 * t) * env(t, .002, decay * 2) * .15);
const marimba = (f, len = .7) => render(len, t => (Math.sin(TAU * f * t) * env(t, .003, 7) + Math.sin(TAU * f * 4 * t) * env(t, .001, 28) * .35) * .6);
const kalimba = (f, len = .9) => render(len, t => (Math.sin(TAU * f * t) * env(t, .002, 5) + Math.sin(TAU * f * 5.4 * t) * env(t, .001, 30) * .3 + Math.sin(TAU * f * 2.01 * t) * env(t, .002, 9) * .2) * .6);
function pluck(f, len = 1.2, bright = .5) {
  const period = Math.max(2, Math.round(SR / f));
  const line = Float32Array.from({ length: period }, () => noise());
  const d = buffer(len);
  let idx = 0;
  for (let i = 0; i < d.length; i++) {
    const cur = line[idx], nxt = line[(idx + 1) % period];
    line[idx] = (cur * (1 - bright) + nxt * bright) * .996;
    d[i] = cur * Math.min(1, (len - i / SR) * 8);
    idx = (idx + 1) % period;
  }
  return d;
}
const keys = (f, len = 1.8) => render(len, t => (Math.sin(TAU * f * t) + .4 * Math.sin(TAU * 2 * f * t) * Math.exp(-t * 3) + .2 * Math.sin(TAU * 3 * f * t) * Math.exp(-t * 6)) * env(t, .004, 2.2) * .5);
const saw = (f, t) => { let s = 0; for (let h = 1; h <= 12; h++) s += Math.sin(TAU * f * h * t) / h; return s * .55; };
const synthLead = (f, len) => lowpass(render(len, t => (saw(f, t) + saw(f * 1.006, t)) * env(t, .01, 3) * Math.min(1, (len - t) * 20) * .35), 2600);
const synthBass = (f, len) => lowpass(render(len, t => saw(f, t) * env(t, .005, 4) * Math.min(1, (len - t) * 30) * .6), 700);
const pad = (freqs, len, bright = 1) => render(len, t => {
  const a = Math.min(1, t / .5) * Math.min(1, (len - t) / .6);
  return freqs.reduce((s, f) => s + Math.sin(TAU * f * t) + .6 * Math.sin(TAU * f * 1.004 * t + 1) + .25 * bright * Math.sin(TAU * f * 2 * t), 0) * a * .05;
});
const bass = (f, len) => render(len, t => (Math.sin(TAU * f * t) + .45 * Math.sin(TAU * 2 * f * t)) * env(t, .005, 3.2) * Math.min(1, (len - t) * 30) * .55);
const kick = (g = 1) => render(.35, t => Math.sin(TAU * (45 * t + 110 / 26 * (1 - Math.exp(-t * 26)))) * Math.exp(-t * 9) * g);
const snare = () => { const n = highpass(noiseBuf(.25), 1500); return n.map((v, i) => (v * Math.exp(-i / SR * 18) + Math.sin(TAU * 190 * i / SR) * Math.exp(-i / SR * 30) * .5) * .5); };
const shaker = () => highpass(noiseBuf(.09), 5000).map((v, i) => v * Math.exp(-i / SR * 50) * .5);
const bongo = f => render(.3, t => Math.sin(TAU * f * (1 + .4 * Math.exp(-t * 40)) * t) * Math.exp(-t * 14) * .7);
const frameDrum = (low = true) => low
  ? render(.5, t => Math.sin(TAU * 70 * (1 + .5 * Math.exp(-t * 30)) * t) * Math.exp(-t * 7))
  : highpass(noiseBuf(.12), 2500).map((v, i) => v * Math.exp(-i / SR * 40) * .6);
const sparkle = (len = 1, base = 2000, count = 10) => {
  const d = buffer(len);
  for (let i = 0; i < count; i++) mix(d, bell(base * (1 + i * .13) * (i % 2 ? 1.5 : 1), .5, 9), i * len / count * .7, .35 * (1 - i / count / 1.5));
  return d;
};

// ---------- Music: one score per chapter ----------
function score({ bpm, bars, chords, roots, melody, lead, drums, padBright = 1, arp }) {
  const beat = 60 / bpm, len = bars * 4 * beat;
  const d = buffer(len);
  for (let bar = 0; bar < bars; bar++) {
    const c = bar % chords.length, t0 = bar * 4 * beat;
    mix(d, pad(chords[c].map(midi), 4 * beat, padBright), t0, 1, true);
    if (roots) for (const [b, off, l] of roots.pattern) mix(d, roots.inst(midi(roots.notes[c] + off), beat * l), t0 + b * beat, roots.gain, true);
    drums?.(d, t0, beat, bar);
    if (arp && bar >= arp.from) {
      const notes = [...chords[c], chords[c][0] + 12].map(n => n + arp.octave);
      for (let s = 0; s < arp.steps; s++) mix(d, arp.inst(midi(notes[s % notes.length]), arp.len), t0 + s * 4 * beat / arp.steps, arp.gain, true);
    }
  }
  melody.forEach((phrase, p) => {
    for (const [b, n, dur] of phrase) mix(d, lead(midi(n), Math.min(1.4, dur * beat + .35)), p * 8 * beat + b * beat, .55, true);
  });
  return reverb(d, .3, 1, true);
}
const A = [[0, 76, .5], [.5, 79, .5], [1, 81, 1], [2, 79, .5], [2.5, 76, .5], [3, 74, 1], [4, 76, .5], [4.5, 72, .5], [5, 69, 1.5], [6.5, 72, .5], [7, 76, 1]];
const B = [[0, 81, .5], [.5, 79, .5], [1, 77, 1], [2, 81, .5], [2.5, 84, .5], [3, 81, 1], [4, 86, .75], [4.75, 84, .25], [5, 83, 1], [6, 79, .5], [6.5, 81, .5], [7, 74, 1]];
const E = [[0, 81, .5], [.5, 79, .5], [1, 77, 1], [2, 76, .5], [2.5, 77, .5], [3, 79, 1], [4, 74, .5], [4.5, 76, .5], [5, 79, 1], [6, 76, .5], [6.5, 74, .5], [7, 72, 1]];
const pop8 = (d, t0, beat) => {
  [0, 2].forEach(b => mix(d, kick(.5), t0 + b * beat, 1, true));
  [1, 3].forEach(b => mix(d, snare(), t0 + b * beat, .35, true));
  for (let e = 0; e < 8; e++) mix(d, shaker(), t0 + e * beat / 2, e % 2 ? .4 : .7, true);
};
const transpose = (ph, k) => ph.map(([b, n, l]) => [b, n + k, l]);

write('music0', score({ bpm: 116, bars: 16, chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]],
  roots: { notes: [48, 45, 41, 43], pattern: [[0, 0, .9], [1.5, 0, .5], [2, 7, .9], [3.5, 0, .5]], inst: bass, gain: .7 },
  melody: [A, B, A, B, A, B, A, E], lead: marimba, drums: pop8,
  arp: { from: 8, octave: 24, steps: 8, len: .4, gain: .12, inst: (f, l) => bell(f, l, 9) } }), { loop: true });

write('music1', score({ bpm: 100, bars: 16, chords: [[57, 60, 64], [52, 55, 59], [53, 57, 60], [55, 59, 62]],
  roots: { notes: [45, 40, 41, 43], pattern: [[0, 0, 1.4], [2.5, 0, .8]], inst: bass, gain: .6 },
  melody: [transpose(A, -3), transpose(E, -3), transpose(A, -3), transpose(B, -5), transpose(A, -3), transpose(E, -3), transpose(B, -5), transpose(E, -3)].map(p => p.map(([b, n, l]) => [b, [0, 2, 5, 7, 9].includes(((n % 12) + 12 - 9) % 12) ? n : n - 1, l])),
  lead: kalimba,
  drums: (d, t0, beat) => {
    [[0, 220], [.75, 260], [1.5, 220], [2.5, 330], [3, 260], [3.5, 220]].forEach(([b, f]) => mix(d, bongo(f), t0 + b * beat, .5, true));
    for (let e = 0; e < 8; e++) mix(d, shaker(), t0 + e * beat / 2, .35, true);
    mix(d, kick(.4), t0, 1, true);
  } }), { loop: true });

const hijaz = [62, 63, 66, 67, 69, 70, 72, 74, 75, 78];
const desertPhrase = k => [[0, hijaz[4 + k], .5], [.5, hijaz[5 + k], .5], [1, hijaz[4 + k], 1], [2, hijaz[2 + k], .5], [2.5, hijaz[3 + k], .5], [3, hijaz[1 + k], 1],
  [4, hijaz[2 + k], .5], [4.5, hijaz[1 + k], .5], [5, hijaz[0 + k], 1.5], [6.5, hijaz[1 + k], .5], [7, hijaz[2 + k], 1]];
write('music2', score({ bpm: 96, bars: 16, chords: [[50, 57, 62], [50, 54, 57], [48, 55, 60], [50, 57, 62]], padBright: .6,
  roots: { notes: [38, 38, 36, 38], pattern: [[0, 0, 1], [1.5, 0, .5], [2, 7, 1]], inst: (f, l) => pluck(f, l, .45), gain: .8 },
  melody: [0, 2, 0, 3, 0, 2, 3, 0].map(k => desertPhrase(k)), lead: (f, l) => pluck(f, l + .3, .5),
  drums: (d, t0, beat) => {
    [0, 1.5, 2].forEach(b => mix(d, frameDrum(true), t0 + b * beat, .7, true));
    [1, 2.5, 3, 3.5].forEach(b => mix(d, frameDrum(false), t0 + b * beat, .5, true));
  } }), { loop: true });

write('music3', score({ bpm: 76, bars: 12, chords: [[53, 57, 60, 64], [55, 59, 62, 67], [57, 60, 64, 69], [55, 59, 62, 66]], padBright: 1.3,
  roots: { notes: [41, 43, 45, 43], pattern: [[0, 0, 3.8]], inst: (f, l) => render(l, t => Math.sin(TAU * f * t) * Math.min(1, t * 2) * Math.min(1, (l - t) * 2) * .4), gain: .6 },
  melody: [A, B, A, E, B, E].map(p => transpose(p, 5).filter((_, i) => i % 2 === 0)), lead: (f, l) => bell(f, l + .8, 1.8, 1.2),
  arp: { from: 0, octave: 24, steps: 8, len: .6, gain: .08, inst: (f, l) => bell(f, l, 5, .8) } }), { loop: true });

write('music4', score({ bpm: 124, bars: 16, chords: [[60, 63, 67], [56, 60, 63], [58, 62, 65], [55, 59, 62]], padBright: 1.4,
  roots: { notes: [36, 32, 34, 31], pattern: [[0, 0, .45], [.5, 0, .45], [1, 12, .45], [1.5, 0, .45], [2, 0, .45], [2.5, 0, .45], [3, 12, .45], [3.5, 7, .45]], inst: synthBass, gain: .55 },
  melody: [A, B, A, E, A, B, A, E].map(p => transpose(p, -9).map(([b, n, l]) => [b, [0, 2, 3, 5, 7, 8, 10].includes(n % 12) ? n : n - 1, l])),
  lead: synthLead,
  drums: (d, t0, beat, bar) => {
    for (let q = 0; q < 4; q++) mix(d, kick(.8), t0 + q * beat, 1, true);
    [1, 3].forEach(b => mix(d, snare(), t0 + b * beat, .5, true));
    for (let e = 0; e < 8; e++) mix(d, shaker(), t0 + e * beat / 2 + beat / 4, .4, true);
    if (bar % 4 === 3) mix(d, snare(), t0 + 3.5 * beat, .4, true);
  },
  arp: { from: 4, octave: 12, steps: 16, len: .2, gain: .14, inst: (f, l) => synthLead(f, l) } }), { loop: true });

// ---------- Ambience loops ----------
function wind(len, base = 400, gust = .5) {
  const n = noiseBuf(len);
  return bandpass(n, t => base * (1 + .5 * Math.sin(t * .7) + .3 * Math.sin(t * 1.9 + 1)), 1.2)
    .map((v, i) => v * (1 - gust + gust * (.5 + .5 * Math.sin(i / SR * .9) * Math.sin(i / SR * .37 + 2))));
}
const bird = f => render(.35, t => Math.sin(TAU * (f + 900 * Math.sin(t * 40)) * t) * Math.sin(Math.PI * t / .35) * .3);
{ // Sky: soft wind and distant birds
  const d = wind(22, 380, .6);
  for (let i = 0; i < 7; i++) { const at = 1 + i * 2.9 + rand(); for (let k = 0; k < 3; k++) mix(d, bird(2400 + rand() * 1200), at + k * .18, .25); }
  write('amb0', d, { loop: true, kbps: 48, peak: .6 });
}
{ // Rainforest: heavy rain, drips, low thunder roll
  // The rain used to be flat white noise up to 11 kHz with a constant hiss on top, which played as TV static under the
  // whole chapter. Now a darker wash that swells slowly, with the leaf patter held below it.
  const swell = t => .8 + .2 * Math.sin(t * .8) * Math.sin(t * .31 + 1);
  const d = lowpass(lowpass(noiseBuf(22), 1500), 2600).map((v, i) => v * swell(i / SR));
  const leaves = lowpass(highpass(noiseBuf(22), 3000), 6000);
  for (let i = 0; i < d.length; i++) d[i] += leaves[i] * .12 * swell(i / SR + 2.3);
  // Each drip keeps one pitch (drawing a new one every sample turned it into a crackle). It still makes one draw per
  // sample, so every later sound renders exactly as before.
  for (let i = 0; i < 420; i++) {
    let f;
    mix(d, render(.03, t => { const r = rand(); f ??= 1800 + r * 2500; return Math.sin(TAU * f * t) * Math.exp(-t * 160); }), rand() * 21.5, .25 * rand());
  }
  mix(d, lowpass(noiseBuf(6), 120).map((v, i) => v * Math.sin(Math.PI * i / (6 * SR)) * 6), 9, .6);
  write('amb1', d, { loop: true, kbps: 48, peak: .6 });
}
{ // Desert: gusting wind with blowing sand
  const d = wind(22, 260, .8);
  const sand = highpass(noiseBuf(22), 5000);
  for (let i = 0; i < d.length; i++) d[i] += sand[i] * .18 * (.5 + .5 * Math.sin(i / SR * .9));
  write('amb2', d, { loop: true, kbps: 48, peak: .6 });
}
{ // Ice: whistling wind and deep ice groans
  const d = bandpass(noiseBuf(22), t => 900 + 400 * Math.sin(t * .5), 6).map(v => v * 2);
  const low = wind(22, 200, .5);
  for (let i = 0; i < d.length; i++) d[i] += low[i] * .7;
  for (const at of [3, 11, 17]) mix(d, render(1.6, t => Math.sin(TAU * (70 + 30 * Math.sin(t * 3)) * t) * Math.sin(Math.PI * t / 1.6) * .5), at, .5);
  write('amb3', d, { loop: true, kbps: 48, peak: .55 });
}
{ // Void: deep drone, shimmer and distant signals
  const d = render(22, t => (Math.sin(TAU * 41 * t) + Math.sin(TAU * 41.5 * t) * .8 + Math.sin(TAU * 61.5 * t) * .5 + Math.sin(TAU * 82 * t) * .3) * (.7 + .3 * Math.sin(t * .6)) * .3);
  const shimmer = bandpass(noiseBuf(22), t => 3000 + 1500 * Math.sin(t * .4), 8);
  for (let i = 0; i < d.length; i++) d[i] += shimmer[i] * .6;
  for (const at of [4, 13]) mix(d, render(1, t => Math.sin(TAU * (900 + 300 * Math.sin(t * 9)) * t) * Math.sin(Math.PI * t) * .08), at, 1);
  write('amb4', reverb(d, .4), { loop: true, kbps: 48, peak: .6 });
}

// ---------- Sound effects ----------
write('pop', render(.14, t => Math.sin(TAU * (520 + 900 * (1 - Math.exp(-t * 40))) * t) * env(t, .002, 34) * .8 + noise() * Math.exp(-t * 400) * .2));
write('whoosh', bandpass(noiseBuf(.5), t => 300 + 2200 * Math.sin(Math.PI * t / .5), 1.5).map((v, i) => v * Math.sin(Math.PI * i / (.5 * SR)) ** 2), { peak: .5 });
write('bonk', render(.25, t => (Math.sin(TAU * (180 - 60 * t) * t) * env(t, .002, 16) + Math.sin(TAU * 410 * t) * env(t, .001, 40) * .4) * .9), { peak: .7 });
write('type', render(.04, t => noise() * Math.exp(-t * 200) * .5 + Math.sin(TAU * 2200 * t) * Math.exp(-t * 150) * .4), { peak: .4 });
write('tick', render(.12, t => Math.sin(TAU * 1500 * t) * Math.exp(-t * 60)), { peak: .5 });

const grind = (len, cutoff, grit) => lowpass(noiseBuf(len), cutoff).map((v, i) => {
  const t = i / SR;
  return v * Math.sin(Math.PI * t / len) * (1 + (rand() < grit ? 6 * rand() : 0)) * 2;
});
const thud = (f = 110) => render(.2, t => Math.sin(TAU * f * t) * Math.exp(-t * 25) + noise() * Math.exp(-t * 200) * .4);
{ const d = buffer(.5); mix(d, grind(.32, 900, .02), 0, 1); mix(d, thud(120), .3, .9); write('rotate0', d, { peak: .8 }); }
{ // Wood and vine creak with leaves
  const d = buffer(.6);
  mix(d, bandpass(render(.4, t => { const f = 190 + 80 * Math.sin(t * 22); return (Math.sin(TAU * f * t) > .6 ? 1 : 0) - .2; }), 900, 2), 0, 1);
  mix(d, highpass(noiseBuf(.3), 3000).map((v, i) => v * Math.exp(-i / SR * 8) * .4), .05, 1);
  mix(d, thud(160), .38, .6);
  write('rotate1', d, { peak: .75 });
}
{ const d = buffer(.55); mix(d, grind(.34, 700, .03), 0, 1); mix(d, highpass(noiseBuf(.4), 5000).map((v, i) => v * Math.exp(-i / SR * 6) * .5), 0, 1); mix(d, thud(100), .32, .9); write('rotate2', d, { peak: .8 }); }
{ // Ice scrape with crystalline clicks
  const d = buffer(.5);
  mix(d, bandpass(noiseBuf(.3), 4200, 3).map((v, i) => v * Math.sin(Math.PI * i / (.3 * SR)) * 2), 0, 1);
  for (const at of [.26, .3, .33]) mix(d, render(.05, t => Math.sin(TAU * (3000 + rand() * 2000) * t) * Math.exp(-t * 120)), at, .7);
  mix(d, thud(200), .3, .5);
  write('rotate3', d, { peak: .75 });
}
{ // Space servo
  const d = buffer(.5);
  mix(d, render(.32, t => (Math.sin(TAU * (300 + 500 * t / .32) * t) * .6 + Math.sin(TAU * 2 * (300 + 500 * t / .32) * t) * .3) * Math.sin(Math.PI * t / .32)), 0, .7);
  mix(d, render(.08, t => Math.sin(TAU * 1600 * t) * Math.exp(-t * 80) + noise() * Math.exp(-t * 300) * .4), .32, .8);
  write('rotate4', d, { peak: .75 });
}
// Light kit: a soft glassy shimmer when the beam re-routes (no harsh zap, no constant hum)
{
  const d = buffer(.6);
  mix(d, bandpass(noiseBuf(.35), t => 2500 + 2500 * t / .35, 5).map((v, i) => v * Math.sin(Math.PI * i / (.35 * SR)) * 1.4), 0, .6);
  [91, 96].forEach((n, i) => mix(d, bell(midi(n), .5, 9, .8), .03 + i * .04, .25));
  write('zap', reverb(d, .3), { peak: .35 });
}
// Charge: the solved board gathers light into its crystals before they bloom
{
  const len = 1.9, d = buffer(len);
  mix(d, render(len, t => {
    const k = t / len, f = 220 + 660 * k * k;
    return (Math.sin(TAU * f * t) * .3 + Math.sin(TAU * f * 1.5 * t) * .15 + Math.sin(TAU * f * 2 * t) * .1) * k * k * Math.min(1, (len - t) * 12);
  }), 0, .8);
  mix(d, highpass(noiseBuf(len), 3500).map((v, i) => v * Math.pow(i / (len * SR), 2) * .35), 0, 1);
  for (let i = 0; i < 9; i++) mix(d, bell(midi(84 + (i % 5) * 2), .4, 9, .6), .3 + i * .16, .08 + i * .015);
  write('charge', reverb(d, .3), { peak: .6 });
}
write('sizzle', highpass(noiseBuf(.45), 2500).map((v, i) => v * (rand() < .08 ? 1.6 : .5) * Math.exp(-i / SR * 6)), { peak: .3 });
{ const d = buffer(1.6); [84, 88, 91, 96].forEach((n, i) => mix(d, bell(midi(n), 1.3, 3), i * .055, .55)); mix(d, sparkle(1.1, 2600, 8), .05, .4); write('crystal', reverb(d, .35), { peak: .8 }); }
{ const d = buffer(.9); [0, 1, 2].forEach(i => mix(d, bell(midi(91 + i * 4), .7, 6), i * .03, .4)); mix(d, highpass(noiseBuf(.5), 6000).map((v, i) => v * Math.exp(-i / SR * 8) * .3), 0, 1); write('split', reverb(d, .3), { peak: .7 }); }
write('portal', reverb(render(.9, t => Math.sin(TAU * (200 + 1400 * t * t) * t + 3 * Math.sin(TAU * 7 * t)) * Math.sin(Math.PI * t / .9) * .6), .4), { peak: .7 });
{ // Cannon turn: a heavy ratchet of three clicks over a turning-stone grind, ending in a lock-in clunk
  const d = buffer(.7);
  mix(d, grind(.42, 600, .05), 0, .8);
  for (const at of [.06, .16, .26]) mix(d, render(.05, t => Math.sin(TAU * 1250 * t) * Math.exp(-t * 90) + noise() * Math.exp(-t * 260) * .5), at, .7);
  mix(d, thud(90), .4, 1);
  mix(d, render(.25, t => Math.sin(TAU * 520 * t) * Math.exp(-t * 18) * .25), .42, 1);
  write('turn', d, { peak: .8 });
}
{ // Curse: a shadow gem drinks the light; a falling minor growl with a dark breath
  const len = 1.1, d = buffer(len);
  mix(d, render(len, t => {
    const f = 140 * Math.pow(.55, t / len);
    return (Math.sin(TAU * f * t) * .5 + Math.sin(TAU * f * 1.19 * t) * .35 + Math.sin(TAU * f * 2.01 * t + Math.sin(TAU * 6 * t)) * .2) * env(t, .02, 3.2);
  }), 0, .9);
  mix(d, lowpass(noiseBuf(.8), 700).map((v, i) => v * Math.sin(Math.PI * i / (.8 * SR)) * 1.2), .05, .7);
  write('curse', reverb(d, .45), { peak: .7 });
}
{ // Ice crack, then melt hiss
  const d = buffer(1.2);
  for (let k = 0; k < 5; k++) mix(d, render(.08, t => noise() * Math.exp(-t * 90) + Math.sin(TAU * (2500 - k * 300) * t) * Math.exp(-t * 60) * .5), k * .05 + rand() * .02, .9);
  mix(d, highpass(noiseBuf(.9), 3000).map((v, i) => v * Math.sin(Math.PI * i / (.9 * SR)) * .5), .25, 1);
  write('thaw', d, { peak: .8 });
}
for (const [name, near] of [['thunder1', true], ['thunder2', false]]) {
  const d = buffer(4);
  if (near) mix(d, highpass(noiseBuf(.25), 1500).map((v, i) => v * Math.exp(-i / SR * 14)), 0, 1.2);
  const rumble = lowpass(lowpass(noiseBuf(4), 160), 120);
  for (let i = 0; i < d.length; i++) { const t = i / SR; d[i] += rumble[i] * 14 * (Math.exp(-t * .9) * (1 + .6 * Math.sin(t * 5) * Math.sin(t * 2.3))) * Math.min(1, t * 8); }
  write(name, reverb(d, .3, 1.6), { peak: near ? .95 : .7 });
}
[76, 79, 84].forEach((n, i) => {
  const d = buffer(1.2);
  mix(d, bell(midi(n + 12), 1.1, 3.5), 0, .6); mix(d, bell(midi(n + 19), 1, 4), .015, .25); mix(d, sparkle(.6, 3000 + i * 400, 6), .03, .35);
  write(`star${i + 1}`, reverb(d, .3), { peak: .85 });
});
{ // Level fanfare
  const d = buffer(3.2);
  [[72, 0], [76, .12], [79, .24], [84, .36], [79, .54], [84, .66]].forEach(([n, at]) => { mix(d, marimba(midi(n), .6), at, .8); mix(d, bell(midi(n + 12), .9, 4), at, .25); });
  [60, 64, 67, 72, 76].forEach(n => mix(d, pad([midi(n)], 2.3), .82, 1.6));
  [72, 76, 79, 84].forEach(n => mix(d, bell(midi(n), 2.2, 1.6), .82, .4));
  mix(d, bass(midi(48), 1.6), .82, .9); mix(d, kick(), .82, .6); mix(d, sparkle(1.6, 2400, 14), .9, .45);
  write('win', reverb(d, .4), { peak: .9 });
}
{ // Failure: a sinking, sympathetic phrase
  const d = buffer(1.8);
  [[67, 0], [66, .25], [65, .5], [60, .8]].forEach(([n, at]) => mix(d, keys(midi(n), 1), at, .7));
  write('fail', reverb(d, .4), { peak: .7 });
}
{ // Chapter heart restored: big swell and choir-like chord
  const d = buffer(5);
  mix(d, render(2, t => noise() * (t / 2) ** 3), 0, .25);
  [48, 55, 60, 64, 67, 72, 76].forEach(n => mix(d, pad([midi(n)], 3.2, 1.5), 1.9, 2.4));
  [72, 76, 79, 84, 88].forEach((n, i) => mix(d, bell(midi(n), 3, 1.2), 1.95 + i * .08, .5));
  mix(d, kick(1.4), 1.9, 1); mix(d, sparkle(2.5, 2200, 18), 2, .5);
  write('heart', reverb(d, .45, 1.4), { peak: .9 });
}
// Cinematic riser and impact for title cards
write('riser', highpass(render(2.2, t => (noise() * .3 + Math.sin(TAU * (200 + 800 * (t / 2.2) ** 2) * t) * .4) * (t / 2.2) ** 2), 300), { peak: .6 });
{
  const d = buffer(3);
  mix(d, render(2.5, t => Math.sin(TAU * (38 + 30 * Math.exp(-t * 4)) * t) * Math.exp(-t * 1.6)), 0, 1);
  mix(d, lowpass(noiseBuf(.5), 1200).map((v, i) => v * Math.exp(-i / SR * 10)), 0, .8);
  [36, 43, 48].forEach(n => mix(d, synthBass(midi(n), 2.2), 0, .4));
  write('boom', reverb(d, .4, 1.6), { peak: .95 });
}
// ---------- Chapter modifiers (added last so every earlier sound renders exactly as before) ----------
{ // Retired (the vine rustle of the old root networks); still rendered to keep the noise stream of later sounds unchanged
  const d = buffer(.9);
  mix(d, bandpass(noiseBuf(.8), t => 1800 + 1400 * t, 2).map((v, i) => v * Math.sin(Math.PI * Math.min(1, i / SR / .8)) * .9), 0, 1);
  mix(d, marimba(midi(55), .5), .05, .5); mix(d, marimba(midi(62), .5), .2, .45);
  write('grow', reverb(d, .25), { peak: .7 });
}
{ // A thornvine catches fire: crackles over a soft roar
  const d = buffer(1.3);
  mix(d, lowpass(noiseBuf(1.3), 600).map((v, i) => v * env(i / SR, .08, 2.2) * 1.4), 0, 1);
  for (let k = 0; k < 26; k++) mix(d, highpass(noiseBuf(.025), 2500).map((v, i) => v * Math.exp(-i / SR * 160)), rand() * 1.1, .6 + rand() * .6);
  write('burn', d, { peak: .75 });
}
{ // A solar seal wakes: a warm two-bell chime with a shimmer
  const d = buffer(1.8);
  mix(d, bell(midi(64), 1.7, 1.8), 0, .7); mix(d, bell(midi(71), 1.5, 2), .06, .45); mix(d, sparkle(.8, 2600, 8), .1, .3);
  write('seal', reverb(d, .4), { peak: .8 });
}
{ // A sandstone gate grinds open or shut and settles with a thud
  const d = buffer(1.1);
  mix(d, lowpass(noiseBuf(.9), 420).map((v, i) => v * Math.sin(Math.PI * Math.min(1, i / SR / .9)) * (1 + .4 * Math.sin(i / SR * 70))), 0, 1.4);
  mix(d, kick(.9), .82, .9);
  write('gate', reverb(d, .2), { peak: .75 });
}
{ // Retired (the old one-shot Devourer sound, replaced by 'abyss'); still rendered to keep later sounds unchanged
  const d = buffer(2);
  let phase = 0;
  mix(d, render(1.4, t => { phase += TAU * (260 * Math.exp(-t * 2.4) + 34) / SR; return Math.sin(phase) * Math.min(1, t * 6) * (1 - t / 1.4); }), 0, .8);
  mix(d, bandpass(noiseBuf(1.3), t => 2600 * Math.exp(-t * 2) + 120, 1.5).map((v, i) => v * (i / SR / 1.3) ** 2 * 1.6), 0, 1);
  mix(d, kick(1.3), 1.3, 1); mix(d, synthBass(midi(31), .7), 1.3, .5);
  write('devour', reverb(d, .35, 1.4), { peak: .9 });
}
{ // An ice floe glides along its track: a bright skate hiss that slows, then a soft knock and a crystal click as it stops
  const d = buffer(.75);
  mix(d, bandpass(noiseBuf(.5), t => 3800 - 2600 * t, 2.5).map((v, i) => v * Math.sin(Math.PI * Math.min(1, i / SR / .5)) * 1.3), 0, 1);
  mix(d, thud(240), .46, .55);
  for (const at of [.47, .51]) mix(d, render(.05, t => Math.sin(TAU * (3200 + rand() * 1500) * t) * Math.exp(-t * 110)), at, .45);
  write('glide', reverb(d, .3), { peak: .7 });
}
// ---------- Rootbound totems: one sound per phase of a totem's turn, timed to src/world/Totems.tsx ----------
{ // Awaken (tap): a carved-wood double click like a key turning in an old lock, then a restrained low rumble rising
  const d = buffer(.9);
  for (const [at, f] of [[0, 1180], [.07, 860]]) {
    mix(d, bandpass(noiseBuf(.06), f * 1.6, 5).map((v, i) => v * Math.exp(-i / SR * 70) * 2.2), at, 1.6);
    mix(d, render(.12, t => Math.sin(TAU * f * t) * Math.exp(-t * 45) + Math.sin(TAU * f * 2.7 * t) * Math.exp(-t * 90) * .3), at, 1);
  }
  // The rumble swells under the clicks and has mostly gone by the time the stones start to grind.
  mix(d, lowpass(lowpass(noiseBuf(.6), 140), 110).map((v, i) => v * Math.sin(Math.PI * Math.min(1, i / SR / .6)) * 7), .06, .5);
  mix(d, render(.6, t => (Math.sin(TAU * 55 * t) + Math.sin(TAU * 82.5 * t) * .5) * Math.min(1, t * 5) * Math.max(0, 1 - t / .6) * .35), .08, .7);
  write('awaken', reverb(d, .25, 1.2), { peak: .75 });
}
{ // Grind (strain and swing, 1.2 s): stone grinding over a wooden creak and a low emerald hum that swells and fades
  const len = 1.3, d = buffer(len);
  const shape = t => Math.min(1, t / .18) * Math.min(1, Math.max(0, (len - .08 - t) / .3));
  mix(d, lowpass(noiseBuf(len), 520).map((v, i) => { const t = i / SR; return v * shape(t) * (1 + .5 * Math.sin(t * 38) + (rand() < .015 ? 4 * rand() : 0)) * 2.4; }), 0, 1);
  mix(d, bandpass(render(len, t => { const f = 120 + 55 * Math.sin(t * 9) + 30 * Math.sin(t * 23); return ((Math.sin(TAU * f * t) > .55 ? 1 : 0) - .22) * shape(t); }), 700, 2.2), 0, .55);
  mix(d, render(len, t => (Math.sin(TAU * 98 * t) + Math.sin(TAU * 147 * t) * .6 + Math.sin(TAU * 196.4 * t) * .25) * (.75 + .25 * Math.sin(t * 11)) * shape(t) * .3), 0, 1);
  write('grind', reverb(d, .3, 1.3), { peak: .7 });
}
{ // Settle (landing): a deep stone impact with a short grit spray, then a bright emerald shimmer that rings out
  const d = buffer(1.6);
  mix(d, kick(1.2), 0, 1); mix(d, thud(70), 0, 1);
  mix(d, lowpass(noiseBuf(.35), 900).map((v, i) => v * Math.exp(-i / SR * 14) * 1.4), 0, .8);
  for (let k = 0; k < 10; k++) mix(d, highpass(noiseBuf(.02), 3000).map((v, i) => v * Math.exp(-i / SR * 200)), .02 + rand() * .2, .25 + rand() * .3);
  [76, 83, 88].forEach((n, i) => mix(d, bell(midi(n), 1.2, 2.6, .9), .1 + i * .06, .3));
  mix(d, sparkle(.9, 2900, 9), .14, .28);
  write('settle', reverb(d, .38, 1.3), { peak: .85 });
}
// ---------- The Devourer's absorption: one sequence timed to src/world/abyss.ts (impact 0, grow .45, pull 1.45,
// darken 2.65, collapse 3.55, silence from 4.1), and a short pulse for each beam it swallows ----------
{
  const len = 4.55, d = buffer(len);
  const span = (t, a, b, fadeIn = .15, fadeOut = .25) => Math.min(1, Math.max(0, (t - a) / fadeIn)) * Math.min(1, Math.max(0, (b - t) / fadeOut));
  // Impact: a sharp energy strike, a sub pulse (with its octave, so phone speakers carry it) and a short reversed swell.
  mix(d, highpass(noiseBuf(.06), 3000).map((v, i) => v * Math.exp(-i / SR * 70) * 1.6), 0, 1);
  mix(d, render(.12, t => Math.sin(TAU * (2400 * Math.exp(-t * 18) + 500) * t) * Math.exp(-t * 30) * .5), 0, 1);
  mix(d, render(.8, t => (Math.sin(TAU * 48 * t) + Math.sin(TAU * 96 * t) * .45) * Math.exp(-t * 4) * .9), 0, 1);
  mix(d, lowpass(noiseBuf(.4), 900).map((v, i) => v * Math.pow(i / (.4 * SR), 2.5) * 1.2), .06, .7);
  // Growth: a rising low rumble and a slowly swelling drone with fine crystalline particles above it.
  mix(d, lowpass(lowpass(noiseBuf(3.1), 260), 200).map((v, i) => { const t = i / SR; return v * 6 * Math.min(1, t / 1) * span(t + .45, .45, 3.55, .3, .6); }), .45, 1);
  mix(d, render(3.6, t => {
    const f = 55 * (1 + .05 * Math.min(1, t / 1)), g = span(t + .45, .45, 4.05, .6, .5);
    return (Math.sin(TAU * f * t) + Math.sin(TAU * f * 1.502 * t) * .55 + Math.sin(TAU * f * 2.004 * t) * .35) * (.6 + .4 * Math.sin(t * 1.7)) * g * .32;
  }), .45, 1);
  for (let k = 0; k < 22; k++) {
    const at = .55 + rand() * 1.9;
    mix(d, render(.25, t => Math.sin(TAU * (2200 + rand() * 2800) * t) * Math.exp(-t * 22)), at, .05 + .05 * (1 - (at - .55) / 1.9));
  }
  // Pull: three suction sweeps rushing inward over a falling tone as the light collapses into the hole.
  for (const at of [1.5, 1.86, 2.22]) {
    const n = .52;
    mix(d, bandpass(noiseBuf(n), t => 3200 * Math.exp(-t * 5) + 240, 3).map((v, i) => v * Math.sin(Math.PI * i / (n * SR)) * 2.4), at, .75);
  }
  { let phase = 0; mix(d, render(1.3, t => { phase += TAU * (90 + 610 * Math.exp(-t * 2.6)) / SR; return Math.sin(phase) * Math.sin(Math.PI * Math.min(1, t / 1.3)) * .38; }), 1.45, 1); }
  // Darkness: a hollow, vacuum-like resonance; nothing high is left.
  mix(d, bandpass(noiseBuf(1.3), 185, 9).map((v, i) => { const t = i / SR; return v * 9 * span(t, 0, 1.3, .35, .3); }), 2.6, 1);
  mix(d, render(1.2, t => (Math.sin(TAU * 41 * t) + Math.sin(TAU * 82 * t) * .5) * span(t, 0, 1.2, .3, .25) * .45), 2.65, 1);
  // Collapse: a short, heavy low impact and a compressed metallic, crystalline ring, then near silence.
  mix(d, kick(1.3), 3.55, 1);
  mix(d, render(.7, t => (Math.sin(TAU * 38 * t) + Math.sin(TAU * 76 * t) * .5) * Math.exp(-t * 6) * .9), 3.55, 1);
  for (const [f, g] of [[523, .3], [1307, .2], [2091, .14], [3137, .08]]) mix(d, render(1, t => Math.sin(TAU * f * t + 2 * Math.sin(TAU * f * 1.41 * t) * Math.exp(-t * 8)) * Math.exp(-t * 5)), 3.58, g);
  // Nothing below 30 Hz (it only eats a phone speaker's headroom), and a closing fade into the silence before the defeat.
  const out = highpass(reverb(d, .3, 1.5), 30).map((v, i) => v * Math.min(1, Math.max(0, (len - i / SR) / .45)));
  write('abyss', out, { peak: .85, kbps: 80 });
}
{ // Swallow: one beam's last light pulled through the horizon: a rushing inward sweep closing on a soft thump
  const n = .5, d = buffer(.62);
  mix(d, bandpass(noiseBuf(n), t => 2600 * Math.exp(-t * 6) + 280, 2.5).map((v, i) => v * Math.sin(Math.PI * i / (n * SR)) * 2), 0, 1);
  mix(d, render(.25, t => (Math.sin(TAU * 70 * t) + Math.sin(TAU * 140 * t) * .4) * Math.exp(-t * 14)), .4, .8);
  write('swallow', reverb(d, .25), { peak: .7 });
}
// ---------- Soft kit: the sounds heard on every move, and the ambience under every level ----------
// Their first versions leaned on raw noise: stone grinds whose grit was single-sample spikes (a crackle on every mirror
// turn), a hissing ice scrape, a square-wave creak, a noise sweep for the light, and ambience beds of broadband noise
// that a phone speaker, unable to play their low end, turned into a steady static as loud as the music. These keep
// each sound's part and each world's character, built from tones and smoothly filtered air instead.
softKit = true;
/** Noise behind a steep low-pass (24 dB per octave), so only its soft lower part is left; `cutoff` may move over time. */
const air = (len, cutoff) => lowpass2(lowpass2(noiseBuf(len), cutoff), cutoff);
/** A smooth slide (a mirror on its pivot, stone over sand): air that opens and closes with the motion, without grit. */
const slide = (len, lo, hi) => highpass(air(len, t => lo + (hi - lo) * Math.sin(Math.PI * Math.min(1, t / len))), lo * .5)
  .map((v, i) => v * Math.sin(Math.PI * i / (len * SR)) ** 2);
/** A soft knock of wood or stone: a pitched body and a brief overtone, eased in so it never clicks. */
const knock = (f, len = .22, decay = 26) => render(len, t =>
  (Math.sin(TAU * f * t) * env(t, .003, decay) + Math.sin(TAU * f * 2.71 * t) * env(t, .002, decay * 2.4) * .3) * .8);
/** A tone gliding from one pitch to another with its phase kept continuous; `shape(k)` is its level over k = 0–1. */
const glideTone = (len, from, to, shape) => {
  let ph = 0;
  return render(len, t => { const k = t / len; ph += TAU * (from + (to - from) * k) / SR; return Math.sin(ph) * shape(k); });
};
const swell = k => Math.sin(Math.PI * k) ** 2;
/**
 * The bell above, rendered at four times the rate and band-limited before coming back down. On high notes its upper
 * partials passed the top of the range and folded back as harsh, off-key tones; here they simply fade out.
 */
function cleanBell(f, len = 1.6, decay = 2.6, index = 1.8) {
  const up = 4, rate = SR * up;
  let x = new Float32Array(Math.floor(len * SR) * up);
  for (let i = 0; i < x.length; i++) {
    const t = i / rate;
    x[i] = Math.sin(TAU * f * t + index * Math.exp(-t * 4) * Math.sin(TAU * f * 3.5 * t)) * env(t, .002, decay) * .6 + Math.sin(TAU * f * 2 * t) * env(t, .002, decay * 2) * .15;
  }
  // lowpass2 works at the normal rate, so a quarter of the cutoff here is 9.5 kHz at the high one.
  for (let k = 0; k < 4; k++) x = lowpass2(x, 9500 / up);
  return Float32Array.from({ length: x.length / up }, (_, i) => x[i * up]);
}
const cleanSparkle = (len = 1, base = 2000, count = 10) => {
  const d = buffer(len);
  for (let i = 0; i < count; i++) mix(d, cleanBell(base * (1 + i * .13) * (i % 2 ? 1.5 : 1), .5, 9), i * len / count * .7, .35 * (1 - i / count / 1.5));
  return d;
};

// Ambience: each bed sits under its world's music, and nothing in it hisses; the only high sounds are tones.
const breeze = (len, base, gust) => highpass(air(len, t => base * (1 + .3 * Math.sin(t * .5) + .2 * Math.sin(t * 1.3 + 1))), 90)
  .map((v, i) => { const t = i / SR; return v * (1 - gust + gust * (.5 + .5 * Math.sin(t * .45) * Math.sin(t * .23 + 2))); });
const chirp = f => glideTone(.16, f, f * 1.25, k => swell(k) * (.75 + .25 * Math.sin(TAU * 3 * k)));
{ // Sky: a soft breeze rising and falling, and distant birds
  const d = breeze(22, 420, .6);
  for (let i = 0; i < 7; i++) { const at = 1 + i * 2.9 + rand(); for (let k = 0; k < 3; k++) mix(d, chirp(2500 + rand() * 900), at + k * .17, .025); }
  write('amb0', d, { loop: true, kbps: 48, peak: .6 });
}
{ // Rainforest: soft rain on the leaves, round drops, and a far roll of thunder
  const swellAt = t => .8 + .2 * Math.sin(t * .8) * Math.sin(t * .31 + 1);
  const d = highpass(air(22, 1000), 120);
  const patter = lowpass2(lowpass2(bandpass(noiseBuf(22), 1600, .9), 2200), 2200);
  for (let i = 0; i < d.length; i++) { const t = i / SR; d[i] = (d[i] + patter[i] * .2) * swellAt(t); }
  for (let i = 0; i < 300; i++) {
    const f = 1300 + rand() * 1400, at = rand() * 21.5, g = .006 + .014 * rand();
    let ph = 0;
    mix(d, render(.08, t => { ph += TAU * f * (1 + 2.5 * t) / SR; return Math.sin(ph) * env(t, .0015, 70); }), at, g);
  }
  mix(d, air(6, 120).map((v, i) => v * Math.sin(Math.PI * i / (6 * SR)) * 6), 9, .6);
  write('amb1', d, { loop: true, kbps: 48, peak: .3 });
}
{ // Desert: warm gusting wind, and a little sand lifted by each gust
  const gust = t => .55 + .45 * Math.sin(t * .9 + .5) * Math.sin(t * .37 + 2);
  const d = highpass(air(22, t => 300 * (1 + .45 * Math.sin(t * .7) + .25 * Math.sin(t * 1.9 + 1))), 80).map((v, i) => v * gust(i / SR));
  const sand = highpass(air(22, 2400), 1000);
  for (let i = 0; i < d.length; i++) d[i] += sand[i] * .18 * gust(i / SR) ** 2;
  write('amb2', d, { loop: true, kbps: 48, peak: .6 });
}
{ // Ice: an airy whistle over low wind, and deep ice groans
  const whistle = lowpass2(bandpass(noiseBuf(22), t => 900 + 300 * Math.sin(t * .5), 6), 1500);
  const d = highpass(air(22, t => 240 * (1 + .4 * Math.sin(t * .6))), 70);
  for (let i = 0; i < d.length; i++) d[i] += whistle[i] * (.35 + .15 * Math.sin(i / SR * .3));
  for (const at of [3, 11, 17]) mix(d, render(1.6, t => Math.sin(TAU * (70 + 30 * Math.sin(t * 3)) * t) * Math.sin(Math.PI * t / 1.6) * .5), at, .2);
  write('amb3', d, { loop: true, kbps: 48, peak: .55 });
}
{ // Void: deep drone, a slow glassy shimmer and distant signals
  const d = render(22, t => (Math.sin(TAU * 41 * t) + Math.sin(TAU * 41.5 * t) * .8 + Math.sin(TAU * 61.5 * t) * .5 + Math.sin(TAU * 82 * t) * .3) * (.7 + .3 * Math.sin(t * .6)) * .3);
  // Three high tones drifting in and out (the shimmer was band-passed noise near 3–4.5 kHz, a hiss).
  for (const [f, rate, at] of [[2093, .11, 0], [2637, .07, 2], [3136, .09, 4]]) {
    mix(d, render(22, t => Math.sin(TAU * f * t + .6 * Math.sin(TAU * .3 * t + at)) * (.5 - .5 * Math.cos(TAU * rate * t + at)) ** 2 * .035), 0, 1);
  }
  for (const at of [4, 13]) {
    let ph = 0;
    mix(d, render(1, t => { ph += TAU * (900 + 300 * Math.sin(t * 9)) / SR; return Math.sin(ph) * Math.sin(Math.PI * t) * .06; }), at, 1);
  }
  write('amb4', reverb(d, .4), { loop: true, kbps: 48, peak: .6 });
}

// Mirror turns, one per world (the Void's servo is unchanged): a soft slide on the pivot and a settled knock.
{ const d = buffer(.5); mix(d, slide(.3, 400, 1100), 0, .6); mix(d, knock(196, .24, 22), .27, .5); mix(d, knock(587, .14, 36), .27, .6); write('rotate0', d, { peak: .75 }); }
{ // Wood and vine: a low creak, a brush of leaves, a wooden knock
  const d = buffer(.55);
  const creak = k => swell(k) * (.75 + .25 * Math.sin(TAU * 5 * k));
  mix(d, glideTone(.34, 220, 280, creak), 0, .25); mix(d, glideTone(.34, 440, 560, creak), 0, .18); mix(d, glideTone(.34, 660, 840, creak), 0, .08);
  mix(d, slide(.28, 900, 2000), .02, .3);
  mix(d, knock(262, .22, 24), .32, .6); mix(d, knock(523, .12, 40), .32, .55);
  write('rotate1', d, { peak: .75 });
}
{ // Sandstone: a slide over sand and a warm, settled thud
  const d = buffer(.55);
  mix(d, slide(.34, 300, 900), 0, .8); mix(d, slide(.26, 1100, 2200), .03, .2);
  mix(d, knock(147, .26, 20), .31, .55); mix(d, knock(440, .12, 36), .31, .55);
  write('rotate2', d, { peak: .75 });
}
{ // Ice: a cool glassy slide and three small crystal glints as it settles
  const d = buffer(.55);
  mix(d, slide(.3, 700, 1700), 0, .45);
  [98, 102, 105].forEach((n, i) => mix(d, cleanBell(midi(n), .3, 14, .4), .25 + i * .035, .16));
  mix(d, knock(294, .2, 26), .27, .5);
  write('rotate3', d, { peak: .7 });
}
{ // Cannon turn: three soft ratchet clicks over a turning-stone rumble, settling with a clunk
  const d = buffer(.7);
  mix(d, slide(.42, 220, 600), 0, .8);
  for (const at of [.06, .16, .26]) mix(d, knock(980, .06, 75), at, .45);
  mix(d, knock(90, .3, 18), .4, 1);
  mix(d, render(.25, t => Math.sin(TAU * 520 * t) * env(t, .003, 18) * .25), .42, 1);
  write('turn', d, { peak: .8 });
}
{ // The light takes its new path: a soft rising glint of glass (it plays on every move, so it stays light and short)
  const d = buffer(.6);
  mix(d, glideTone(.3, 1500, 2300, swell), 0, .3);
  [91, 96].forEach((n, i) => mix(d, cleanBell(midi(n), .5, 9, .5), .03 + i * .045, .28));
  write('zap', reverb(d, .3), { peak: .35 });
}
{ const d = buffer(.9); [0, 1, 2].forEach(i => mix(d, cleanBell(midi(91 + i * 4), .7, 6), i * .03, .4)); write('split', reverb(d, .3), { peak: .7 }); }
// A crystal lights, the stars of the results, and the level fanfare: as before, with band-limited bells.
{ const d = buffer(1.6); [84, 88, 91, 96].forEach((n, i) => mix(d, cleanBell(midi(n), 1.3, 3), i * .055, .55)); mix(d, cleanSparkle(1.1, 2600, 8), .05, .4); write('crystal', reverb(d, .35), { peak: .8 }); }
[76, 79, 84].forEach((n, i) => {
  const d = buffer(1.2);
  mix(d, cleanBell(midi(n + 12), 1.1, 3.5), 0, .6); mix(d, cleanBell(midi(n + 19), 1, 4), .015, .25); mix(d, cleanSparkle(.6, 3000 + i * 400, 6), .03, .35);
  // Lower than the first versions' .85, which encoded star2 over full scale (it clipped when decoded).
  write(`star${i + 1}`, reverb(d, .3), { peak: .75 });
});
{
  const d = buffer(3.2);
  [[72, 0], [76, .12], [79, .24], [84, .36], [79, .54], [84, .66]].forEach(([n, at]) => { mix(d, marimba(midi(n), .6), at, .8); mix(d, cleanBell(midi(n + 12), .9, 4), at, .25); });
  [60, 64, 67, 72, 76].forEach(n => mix(d, pad([midi(n)], 2.3), .82, 1.6));
  [72, 76, 79, 84].forEach(n => mix(d, cleanBell(midi(n), 2.2, 1.6), .82, .4));
  mix(d, bass(midi(48), 1.6), .82, .9); mix(d, kick(), .82, .6); mix(d, cleanSparkle(1.6, 2400, 14), .9, .45);
  write('win', reverb(d, .4), { peak: .9 });
}
{ // Charge: the solved board gathers light into its crystals before they bloom
  const len = 1.9, d = buffer(len);
  mix(d, render(len, t => {
    const k = t / len, f = 220 + 660 * k * k;
    return (Math.sin(TAU * f * t) * .3 + Math.sin(TAU * f * 1.5 * t) * .15 + Math.sin(TAU * f * 2 * t) * .1) * k * k * Math.min(1, (len - t) * 12);
  }), 0, .8);
  mix(d, render(len, t => { const k = t / len; return (Math.sin(TAU * 2637 * t) + Math.sin(TAU * 3136 * t) * .6) * k ** 3 * (.6 + .4 * Math.sin(TAU * 7 * t)) * Math.min(1, (len - t) * 12) * .05; }), 0, 1);
  for (let i = 0; i < 9; i++) mix(d, cleanBell(midi(84 + (i % 5) * 2), .4, 9, .6), .3 + i * .16, .08 + i * .015);
  write('charge', reverb(d, .3), { peak: .6 });
}
write('type', render(.04, t => Math.sin(TAU * 1900 * t) * env(t, .0015, 160) * .5), { peak: .4 });
{ // An ice floe glides along its track: a smooth skate that slows, then a soft knock and a crystal click as it stops
  const d = buffer(.75);
  mix(d, lowpass2(bandpass(noiseBuf(.5), t => 1700 - 900 * t / .5, 1.6), 2600).map((v, i) => v * Math.sin(Math.PI * Math.min(1, i / SR / .5)) * 1.3), 0, 1);
  mix(d, knock(240, .2, 25), .46, .55);
  for (const [at, n] of [[.47, 100], [.51, 103]]) mix(d, cleanBell(midi(n), .25, 16, .4), at, .12);
  write('glide', reverb(d, .3), { peak: .7 });
}
{ // Grind (strain and swing, 1.2 s): stone grinding over a wooden groan and a low emerald hum that swells and fades
  const len = 1.3, d = buffer(len);
  const shape = t => Math.min(1, t / .18) * Math.min(1, Math.max(0, (len - .08 - t) / .3));
  mix(d, air(len, 650).map((v, i) => { const t = i / SR; return v * shape(t) * (1 + .5 * Math.sin(t * 38)) * 4; }), 0, 1);
  let ph = 0;
  mix(d, render(len, t => {
    ph += TAU * (120 + 55 * Math.sin(t * 9) + 30 * Math.sin(t * 23)) / SR;
    return (Math.sin(ph) * .4 + Math.sin(2 * ph) * .3 + Math.sin(4 * ph) * .2 + Math.sin(6 * ph) * .1) * shape(t);
  }), 0, .3);
  mix(d, render(len, t => (Math.sin(TAU * 98 * t) + Math.sin(TAU * 147 * t) * .6 + Math.sin(TAU * 196.4 * t) * .25) * (.75 + .25 * Math.sin(t * 11)) * shape(t) * .3), 0, 1);
  write('grind', reverb(d, .3, 1.3), { peak: .7 });
}
console.log(`Generated ${fs.readdirSync(out).length} MP3 files, ${(total / 1024).toFixed(0)} KB total`);
