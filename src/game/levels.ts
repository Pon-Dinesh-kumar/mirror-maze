import raw from './levels.json';
import { chapters, LEVELS_PER_CHAPTER } from './chapters';
import { Level } from './types';

type Optional = 'clusters' | 'floes' | 'seals' | 'gates' | 'devourers' | 'solutionPlaces' | 'solutionTurns';
type RawLevel = Omit<Level, 'id' | 'chapter' | 'index' | 'title' | 'beat' | Optional> & Partial<Pick<Level, Optional>>;

export const levels: Level[] = (raw as unknown as RawLevel[]).map((data, i) => {
  const chapter = Math.floor(i / LEVELS_PER_CHAPTER);
  const index = (i % LEVELS_PER_CHAPTER) + 1;
  const [title, beat] = chapters[chapter]!.levels[index - 1]!;
  // Chapter modifiers are only stored where a level uses them.
  return { clusters: [], floes: [], seals: [], gates: [], devourers: [], solutionPlaces: {}, solutionTurns: {}, ...data, id: i + 1, chapter, index, title, beat };
});

export const levelsOfChapter = (chapter: number) => levels.slice(chapter * LEVELS_PER_CHAPTER, (chapter + 1) * LEVELS_PER_CHAPTER);


/** Mechanics that appear for the first time in each level, used for in-game tutorial tips. */
export const introducedAt: Record<number, Level['mechanics']> = (() => {
  const seen = new Set<string>();
  const out: Record<number, Level['mechanics']> = {};
  for (const l of levels) {
    out[l.id] = l.mechanics.filter(m => !seen.has(m));
    l.mechanics.forEach(m => seen.add(m));
  }
  return out;
})();
