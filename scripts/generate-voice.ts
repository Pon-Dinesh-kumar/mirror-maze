// Records the cinematic narration for every cutscene line with Piper, an offline neural text-to-speech engine,
// then gives it a warm, cinematic finish and writes a manifest of real durations so captions stay in sync.
// Requires .tools/piper (piper.exe + en_GB-jenny_dioco-medium voice). Run: npx tsx scripts/generate-voice.ts
//
// Piper reads a whole line in one breath with one fixed silence between sentences, and its delivery varies from run to
// run (some takes flat, some lively). So each sentence is recorded on its own, several times; the take with the most
// natural pitch movement and timing is kept, and the sentences are joined with pauses chosen for the line's mood.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
// lamejs ships as ESM only, so it is loaded with a dynamic import (see the bottom of this file).
let Mp3Encoder: typeof import('@breezystack/lamejs').Mp3Encoder;
import { chapters, ending, prologue } from '../src/game/chapters';
import { phrases } from '../src/game/captions';

const root = path.join(__dirname, '..');
const piper = path.join(root, '.tools', 'piper', 'piper', 'piper.exe');
const model = path.join(root, '.tools', 'piper', 'en_GB-jenny_dioco-medium.onnx');
const outDir = path.join(root, 'assets', 'voice');
const tmp = path.join(root, '.tools', 'piper', 'tmp');
const SR = 22050;
const TAU = Math.PI * 2;
/** Takes recorded per sentence. */
const TAKES = 8;
/** Every clip is levelled to the same integrated loudness (EBU R128 / ITU-R BS.1770), so no line jumps out. */
const LOUDNESS = -15;
/** Silence before the first word. */
const LEAD_MS = 120;

type Mood = 'calm' | 'dark' | 'awe' | 'triumph';
/** Every narrated line, with a slower, softer delivery for the most dramatic beats. */
interface Line { id: string; text: string; pace: number; mood: Mood }
const lines: Line[] = [];
prologue.forEach((text, i) => lines.push({ id: `prologue${i}`, text, pace: i === 2 || i === 3 ? 1.22 : 1.16, mood: i === 2 || i === 3 ? 'dark' : i === 4 ? 'awe' : 'calm' }));
chapters.forEach(c => {
  c.intro.forEach((text, i) => lines.push({ id: `intro${c.id}_${i}`, text, pace: 1.14, mood: i === c.intro.length - 1 ? 'awe' : 'calm' }));
  c.outro.forEach((text, i) => lines.push({ id: `outro${c.id}_${i}`, text, pace: 1.12, mood: i === 0 ? 'triumph' : 'calm' }));
  c.forge.forEach((text, i) => lines.push({ id: `forge${c.id}_${i}`, text, pace: 1.16, mood: i === 1 ? 'triumph' : 'awe' }));
});
ending.forEach((text, i) => lines.push({ id: `ending${i}`, text, pace: 1.2, mood: i === 3 ? 'calm' : 'awe' }));

/**
 * How each mood is read and finished: the pause between sentences, the low-end warmth, and the room around the voice
 * (reverb time in seconds and its level under the dry voice in dB).
 */
const moods: Record<Mood, { pause: number; warmth: number; rt: number; wet: number }> = {
  calm: { pause: 420, warmth: 2, rt: .9, wet: -17 },
  dark: { pause: 640, warmth: 3, rt: 1.3, wet: -13 },
  awe: { pause: 500, warmth: 2, rt: 1.15, wet: -14 },
  triumph: { pause: 380, warmth: 1.5, rt: 1, wet: -16 },
};

/** Spoken form: ellipses and commas give the voice room to breathe on dramatic lines. */
function spoken(text: string, mood: Mood) {
  let t = text.replace(/\.\.\./g, ', ').replace(/\s+/g, ' ').replace(/^[,\s]+/, '').trim();
  if (mood === 'dark') t = t.replace(/^Then /, 'Then, ');
  return t;
}

function readWav(file: string) {
  const b = fs.readFileSync(file);
  let p = 12, data: Buffer | undefined, rate = SR;
  while (p < b.length) {
    const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(p + 12);
    if (id === 'data') data = b.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size % 2);
  }
  if (!data || rate !== SR) throw new Error(`${file}: unexpected WAV format (${rate} Hz)`);
  const out = new Float32Array(data.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = data.readInt16LE(i * 2) / 32768;
  return out;
}

function biquad(x: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i]! + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]!; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
/** RBJ cookbook filters. */
function filter(x: Float32Array, kind: 'hp' | 'lp' | 'shelfLow' | 'peak' | 'shelfHigh', f: number, q = .707, dB = 0) {
  const w = TAU * f / SR, cos = Math.cos(w), sin = Math.sin(w), alpha = sin / (2 * q), A = 10 ** (dB / 40);
  let b0, b1, b2, a0, a1, a2;
  if (kind === 'hp') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; }
  else if (kind === 'lp') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; }
  else if (kind === 'peak') { b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A; }
  else {
    const s = 2 * Math.sqrt(A) * alpha, sign = kind === 'shelfLow' ? 1 : -1;
    b0 = A * ((A + 1) - sign * (A - 1) * cos + s); b1 = sign * 2 * A * ((A - 1) - sign * (A + 1) * cos); b2 = A * ((A + 1) - sign * (A - 1) * cos - s);
    a0 = (A + 1) + sign * (A - 1) * cos + s; a1 = -sign * 2 * ((A - 1) + sign * (A + 1) * cos); a2 = (A + 1) + sign * (A - 1) * cos - s;
  }
  return biquad(x, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

/** Smooth compressor: evens out the delivery like a voice-over booth chain. */
function compress(x: Float32Array, threshold = .18, ratio = 3) {
  const y = new Float32Array(x.length);
  let envl = 0;
  const att = 1 - Math.exp(-1 / (SR * .005)), rel = 1 - Math.exp(-1 / (SR * .12));
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]!);
    envl += (a > envl ? att : rel) * (a - envl);
    const gain = envl > threshold ? (threshold + (envl - threshold) / ratio) / envl : 1;
    y[i] = x[i]! * gain;
  }
  return y;
}

/** Integrated loudness in LUFS (ITU-R BS.1770: K-weighting, 400 ms blocks, absolute and relative gates). */
function loudness(x: Float32Array) {
  const k = filter(filter(x, 'shelfHigh', 1681.97, .7072, 4), 'hp', 38.14, .5003);
  const block = Math.floor(SR * .4), step = Math.floor(SR * .1);
  const z: number[] = [];
  for (let s = 0; s + block <= k.length; s += step) {
    let e = 0;
    for (let i = s; i < s + block; i++) e += k[i]! * k[i]!;
    z.push(e / block);
  }
  const lufs = (v: number) => -.691 + 10 * Math.log10(v);
  const mean = (a: number[]) => a.reduce((p, v) => p + v, 0) / Math.max(1, a.length);
  const loud = z.filter(v => lufs(v) > -70);
  const gate = lufs(mean(loud)) - 10;
  return lufs(mean(loud.filter(v => lufs(v) > gate)));
}

/** Look-ahead peak limiter: catches the odd peak the levelling pushes past `ceiling`, without audible pumping. */
function limit(x: Float32Array, ceiling = .89) {
  const look = Math.floor(SR * .005), rel = 1 - Math.exp(-1 / (SR * .06));
  const y = new Float32Array(x.length);
  let env = 1;
  for (let i = 0; i < x.length; i++) {
    let need = 1;
    for (let j = i; j < Math.min(x.length, i + look); j++) need = Math.min(need, ceiling / Math.max(1e-9, Math.abs(x[j]!)));
    env = need < env ? need : env + (need - env) * rel;
    y[i] = x[i]! * env;
  }
  return y;
}

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array, inverse: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (inverse ? TAU : -TAU) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2;
        const tr = re[q]! * cr - im[q]! * ci, ti = re[q]! * ci + im[q]! * cr;
        re[q] = re[p]! - tr; im[q] = im[p]! - ti; re[p] = re[p]! + tr; im[p] = im[p]! + ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}
function convolve(x: Float32Array, h: Float32Array) {
  const n = x.length + h.length - 1;
  let N = 1;
  while (N < n) N <<= 1;
  const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
  ar.set(x); br.set(h);
  fft(ar, ai, false); fft(br, bi, false);
  for (let k = 0; k < N; k++) { const r = ar[k]! * br[k]! - ai[k]! * bi[k]!; ai[k] = ar[k]! * bi[k]! + ai[k]! * br[k]!; ar[k] = r; }
  fft(ar, ai, true);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = ar[i]! / N;
  return y;
}

/**
 * A smooth, dense room: a few early reflections, then a noise tail that decays over `rt` seconds and darkens as it fades
 * (air takes the highs first). Unlike a handful of feedback echoes, it has no metallic ring. Seeded, so every run of
 * this script builds the same room. Unit energy, so the mix level alone sets how wet it is.
 */
function room(rt: number) {
  const len = Math.floor(SR * rt * 1.1), ir = new Float32Array(len);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const [ms, g] of [[11, .5], [17, -.38], [23, .32], [31, -.27], [41, .22], [53, -.18]] as const) ir[Math.floor(ms / 1000 * SR)]! += g;
  const start = Math.floor(SR * .018);
  let lp = 0;
  for (let i = start; i < len; i++) {
    const t = i / SR, cut = 7000 - 5500 * Math.min(1, t / rt);
    lp += (1 - Math.exp(-TAU * cut / SR)) * (rand() - lp);
    ir[i]! += lp * Math.exp(-6.91 * t / rt) * Math.min(1, (i - start) / (SR * .03));
  }
  let e = 0;
  for (const v of ir) e += v * v;
  for (let i = 0; i < len; i++) ir[i]! /= Math.sqrt(e);
  return ir;
}

/** The sentence's sound without the silence Piper leaves around it, with short fades so the joins never click. */
function trim(x: Float32Array) {
  const gate = .012;
  let a = 0, b = x.length - 1;
  while (a < b && Math.abs(x[a]!) < gate) a++;
  while (b > a && Math.abs(x[b]!) < gate) b--;
  const y = x.slice(Math.max(0, a - Math.floor(SR * .025)), Math.min(x.length, b + Math.floor(SR * .06)));
  const fadeIn = Math.floor(SR * .004), fadeOut = Math.floor(SR * .02);
  for (let i = 0; i < fadeIn; i++) y[i]! *= i / fadeIn;
  for (let i = 0; i < fadeOut; i++) y[y.length - 1 - i]! *= i / fadeOut;
  return y;
}

/** Pitch track (YIN), one value per 10 ms frame: semitones above 100 Hz, or NaN where the voice is silent or unvoiced. */
function pitch(x: Float32Array) {
  const W = 640, hop = 220, minLag = Math.floor(SR / 420), maxLag = Math.floor(SR / 75);
  const out: number[] = [];
  const d = new Float64Array(maxLag + 1);
  for (let s = 0; s + W + maxLag < x.length; s += hop) {
    let e = 0;
    for (let i = 0; i < W; i++) e += x[s + i]! * x[s + i]!;
    if (e / W < 1e-4) { out.push(NaN); continue; }
    for (let tau = 1; tau <= maxLag; tau++) {
      let sum = 0;
      for (let i = 0; i < W; i++) { const v = x[s + i]! - x[s + i + tau]!; sum += v * v; }
      d[tau] = sum;
    }
    let run = 0, lag = 0;
    for (let tau = 1; tau <= maxLag; tau++) {
      run += d[tau]!;
      if (tau >= minLag && run > 0 && d[tau]! * tau / run < .15) {
        while (tau + 1 <= maxLag && d[tau + 1]! < d[tau]!) tau++;
        lag = tau; break;
      }
    }
    out.push(lag ? 12 * Math.log2(SR / lag / 100) : NaN);
  }
  return out;
}

/**
 * How natural a take sounds, from what can be measured: lively but sane pitch movement (flat readings are what make
 * synthetic narration sound robotic), no pitch breaks or glitches, no stalled pauses, and a length close to the typical
 * take (neither rushed nor dragged).
 */
function judge(x: Float32Array) {
  const f0 = pitch(x);
  const voiced = f0.filter(v => !Number.isNaN(v));
  const mean = voiced.reduce((a, v) => a + v, 0) / Math.max(1, voiced.length);
  const sd = Math.sqrt(voiced.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, voiced.length));
  const sorted = [...voiced].sort((a, b) => a - b);
  const range = sorted.length ? sorted[Math.floor(sorted.length * .9)]! - sorted[Math.floor(sorted.length * .1)]! : 0;
  let jumps = 0, pairs = 0, gap = 0, longest = 0;
  for (let i = 1; i < f0.length; i++) {
    if (!Number.isNaN(f0[i]!) && !Number.isNaN(f0[i - 1]!)) { pairs++; if (Math.abs(f0[i]! - f0[i - 1]!) > 6) jumps++; }
  }
  const fr = Math.floor(SR * .02);
  for (let s = 0; s + fr <= x.length; s += fr) {
    let e = 0;
    for (let i = s; i < s + fr; i++) e += x[i]! * x[i]!;
    gap = 10 * Math.log10(e / fr + 1e-12) < -40 ? gap + 20 : 0;
    longest = Math.max(longest, gap);
  }
  return { sd: Math.min(sd, 3.4), range: Math.min(range, 9), jumps: jumps / Math.max(1, pairs), longest, ms: x.length / SR * 1000 };
}

function encode(x: Float32Array, file: string) {
  const pcm = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) pcm[i] = Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32760);
  const enc = new Mp3Encoder(1, SR, 96);
  const chunks: Buffer[] = [];
  for (let i = 0; i < pcm.length; i += 1152) chunks.push(Buffer.from(enc.encodeBuffer(pcm.subarray(i, i + 1152))));
  chunks.push(Buffer.from(enc.flush()));
  fs.writeFileSync(file, Buffer.concat(chunks));
}

async function main() {
Mp3Encoder = (await import('@breezystack/lamejs')).Mp3Encoder;
if (!fs.existsSync(piper) || !fs.existsSync(model)) throw new Error('Piper is missing: download it into .tools/piper first (see README).');
// MM_ONLY=intro3_2 records just those lines; every other clip and its timing in the manifest is kept as it is (Piper's
// delivery varies a little between runs, so re-recording everything would change every line).
const only = process.env.MM_ONLY ? new Set(process.env.MM_ONLY.split(',')) : undefined;
const kept = new Map<string, { ms: number; cues: number[] }>();
if (only) {
  const clips = fs.readFileSync(path.join(root, 'src', 'services', 'voiceClips.ts'), 'utf8');
  for (const m of clips.matchAll(/voice\/(\w+)\.mp3'\), ms: (\d+), cues: \[([\d, ]*)\]/g)) kept.set(m[1]!, { ms: Number(m[2]), cues: m[3]!.split(',').map(Number) });
} else fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(tmp, { recursive: true });
const todo = lines.filter(l => !only || only.has(l.id));
for (const l of lines) if (only && !only.has(l.id) && !kept.has(l.id)) throw new Error(`${l.id} has no recording yet; include it in MM_ONLY`);

// Every take of every sentence, recorded in one Piper run per pace (the model loads once per run). The last sentence of
// a line is read a touch slower, as a narrator settles into the end of a thought.
const sentences = todo.flatMap(l => phrases(l.text).map((text, i, all) => ({ line: l, index: i, text: spoken(text, l.mood),
  pace: Math.round((l.pace + (all.length > 1 && i === all.length - 1 ? .04 : 0)) * 100) / 100 })));
for (const pace of [...new Set(sentences.map(s => s.pace))]) {
  const batch = sentences.filter(s => s.pace === pace).flatMap(s => Array.from({ length: TAKES }, (_, k) =>
    JSON.stringify({ text: s.text, output_file: path.join(tmp, `${s.line.id}_${s.index}_${k}.wav`) })));
  execFileSync(piper, ['--model', model, '--json-input', '--length_scale', String(pace), '--noise_scale', '.72', '--noise_w', '.9', '--sentence_silence', '0', '-q'],
    { input: batch.join('\n') + '\n', stdio: ['pipe', 'ignore', 'ignore'] });
}

const manifest: { id: string; text: string; ms: number; cues: number[] }[] = [];
for (const l of lines) {
  if (!todo.includes(l)) { manifest.push({ id: l.id, text: l.text, ...kept.get(l.id)! }); continue; }
  const fx = moods[l.mood];
  // The best take of each sentence.
  const parts = phrases(l.text).map((_, i) => {
    const takes = Array.from({ length: TAKES }, (_, k) => trim(readWav(path.join(tmp, `${l.id}_${i}_${k}.wav`))));
    const scores = takes.map(judge);
    const typical = [...scores.map(s => s.ms)].sort((a, b) => a - b)[Math.floor(TAKES / 2)]!;
    const score = (s: ReturnType<typeof judge>) => s.sd + s.range / 3 - 12 * s.jumps - 4 * Math.abs(s.ms / typical - 1) - (s.longest > 650 ? 1 : 0);
    const best = scores.reduce((b, s, k) => (score(s) > score(scores[b]!) ? k : b), 0);
    process.stdout.write(`${l.id}.${i}: take ${best} (pitch range ${scores[best]!.range.toFixed(1)} st, of ${scores.map(s => s.range.toFixed(1)).join('/')})\n`);
    return takes[best]!;
  });
  // Sentences joined with the mood's pause; each sentence's start is a caption cue.
  const pause = Math.floor(SR * fx.pause / 1000), lead = Math.floor(SR * LEAD_MS / 1000);
  const length = lead + parts.reduce((a, p) => a + p.length, 0) + pause * (parts.length - 1);
  let x = new Float32Array(length);
  const cues: number[] = [];
  let at = lead;
  for (const p of parts) { cues.push(Math.round(at / SR * 1000)); x.set(p, at); at += p.length + pause; }
  x = filter(x, 'hp', 75);
  x = filter(x, 'shelfLow', 220, .707, fx.warmth);
  x = filter(x, 'peak', 3200, 1.1, 1.5);
  x = filter(x, 'lp', 9500);
  x = compress(x);
  const spokenMs = Math.round(x.length / SR * 1000);
  // Level the dry voice, add the room, then level the result again and catch any stray peak.
  const level = (v: Float32Array) => { const g = 10 ** ((LOUDNESS - loudness(v)) / 20); return v.map(s => s * g); };
  const dry = level(x);
  const wet = convolve(dry, room(fx.rt));
  const g = 10 ** (fx.wet / 20);
  for (let i = 0; i < dry.length; i++) wet[i] = dry[i]! + wet[i]! * g;
  for (let i = dry.length; i < wet.length; i++) wet[i]! *= g;
  encode(limit(level(wet)), path.join(outDir, `${l.id}.mp3`));
  manifest.push({ id: l.id, text: l.text, ms: spokenMs, cues });
}
fs.rmSync(tmp, { recursive: true, force: true });
const body = manifest.map(m => `  ${JSON.stringify(m.text)}: { source: require('../../assets/voice/${m.id}.mp3'), ms: ${m.ms}, cues: [${m.cues.join(', ')}] },`).join('\n');
fs.writeFileSync(path.join(root, 'src', 'services', 'voiceClips.ts'),
  `// Generated by scripts/generate-voice.ts. Do not edit by hand.\n/**\n * Recorded narration per caption: its spoken length (excluding the reverb tail) and when each of its sentences begins\n * (ms from the start of the clip).\n */\nexport const voiceClips: Record<string, { source: number; ms: number; cues: number[] }> = {\n${body}\n};\n`);
console.log(`\nRecorded ${manifest.length} lines`);
}
void main();
