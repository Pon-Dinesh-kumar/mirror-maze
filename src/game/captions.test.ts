import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chapters, ending, prologue } from './chapters';
import { balance, phrases } from './captions';

const story = [...prologue, ...chapters.flatMap(c => [...c.intro, ...c.outro, ...c.forge]), ...ending];

test('Every narrated caption has one recorded cue per sentence, in order and inside its clip', () => {
  // voiceClips.ts requires the mp3 files, so it is read as text here.
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'services', 'voiceClips.ts'), 'utf8');
  const clips = new Map([...manifest.matchAll(/^\s+("(?:[^"\\]|\\.)*"): \{ source: [^}]*?, ms: (\d+), cues: \[([\d, ]*)\] \},$/gm)]
    .map(m => [JSON.parse(m[1]!) as string, { ms: Number(m[2]), cues: m[3]!.split(',').map(Number) }]));
  for (const line of story) {
    const clip = clips.get(line);
    assert.ok(clip, `"${line}" has a recording`);
    assert.equal(clip.cues.length, phrases(line).length, `"${line}": one cue per sentence`);
    clip.cues.forEach((c, i) => assert.ok(c >= 0 && c < clip.ms && (i === 0 || c > clip.cues[i - 1]!), `"${line}": cue ${i} is in order`));
  }
});

// Word widths as Fredoka Bold sets them at the caption size (about 0.56 em per character, plus the outline).
const widthsOf = (words: string[], size: number) => words.map(w => w.length * size * .56 + 6);
for (const [width, size] of [[360, 22.3], [412, 25], [768, 25]] as const) {
  test(`Captions on a ${width} px wide screen fit, use the fewest lines, and break at sentence ends where they can`, () => {
    const max = width - 48 - 2;
    for (const line of story) {
      const parts = phrases(line).map(p => p.split(' '));
      const words = parts.flat();
      const ends = new Set(parts.map((_, i) => parts.slice(0, i + 1).reduce((n, p) => n + p.length, 0)));
      const widths = widthsOf(words, size);
      const lines = balance(widths, max, ends, 7);
      assert.deepEqual(lines.flat(), words.map((_, i) => i), `"${line}": every word once, in order`);
      const span = (l: number[]) => l.reduce((t, i) => t + widths[i]!, 0) + 7 * (l.length - 1);
      for (const l of lines) assert.ok(span(l) <= max, `"${line}": a line fits`);
      // No more lines than plain word wrapping needs.
      let greedy = 1;
      for (let i = 0, run = -7; i < widths.length; i++) { if (run + 7 + widths[i]! > max && run > 0) { greedy++; run = widths[i]!; } else run += 7 + widths[i]!; }
      assert.equal(lines.length, greedy, `"${line}": fewest lines`);
      // Where each sentence fits on its own lines, sentences start on a new line.
      if (lines.length >= parts.length && parts.every(p => span(p.map(w => words.indexOf(w))) <= max)) {
        let first = 0;
        for (const p of parts) { assert.ok(lines.some(l => l[0] === first), `"${line}": "${p.join(' ')}" starts a line`); first += p.length; }
      }
    }
  });
}

test('A long sentence is balanced rather than leaving one word on the last line', () => {
  const words = 'The Great Prism is whole again, and the Void closes its eye.'.split(' ');
  const widths = widthsOf(words, 25);
  const lines = balance(widths, 362, new Set([words.length]), 7);
  assert.ok(lines.every(l => l.length >= 2), lines.map(l => l.map(i => words[i]).join(' ')).join(' / '));
});
