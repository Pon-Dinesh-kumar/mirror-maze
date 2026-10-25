/** A caption's sentences: the narrator records each one on its own, and each appears on screen as it is spoken. */
export const phrases = (line: string) => line.split(/(?<=[.!?])\s+/);

/**
 * The fewest lines words of these `widths` fit in within `max` (with `gap` between words), broken at sentence ends
 * where possible (`ends`: the word counts at which a sentence ends; sentences appear one at a time) and otherwise as
 * evenly as possible (no lone word left on the last line). Returns the word indices of each line.
 */
export function balance(widths: number[], max: number, ends: Set<number>, gap: number) {
  const span = (a: number, b: number) => widths.slice(a, b).reduce((t, w) => t + w, 0) + gap * (b - a - 1);
  let count = 1;
  for (let i = 0, line = -gap; i < widths.length; i++) {
    if (line + gap + widths[i]! > max && line > 0) { count++; line = widths[i]!; } else line += gap + widths[i]!;
  }
  // Every way to cut the words into `count` lines (captions are a dozen words at most); keep the one with the most
  // breaks at sentence ends, then the one whose longest line is shortest.
  let best: number[] = [], widest = Infinity, aligned = -1;
  const search = (from: number, left: number, cuts: number[]) => {
    if (left === 1) {
      if (span(from, widths.length) > max) return;
      const all = [...cuts, widths.length];
      const w = Math.max(...all.map((end, k) => span(k ? all[k - 1]! : 0, end)));
      const a = cuts.filter(c => ends.has(c)).length;
      if (a > aligned || (a === aligned && w < widest)) { aligned = a; widest = w; best = all; }
      return;
    }
    for (let end = from + 1; end <= widths.length - left + 1; end++) if (span(from, end) <= max) search(end, left - 1, [...cuts, end]);
  };
  search(0, count, []);
  if (!best.length) return [widths.map((_, i) => i)];
  return best.map((end, k) => Array.from({ length: end - (k ? best[k - 1]! : 0) }, (_, j) => (k ? best[k - 1]! : 0) + j));
}
