/** Per-level best result. `stars` is the crystal-shard rating (1-3); the field name is kept for save compatibility. */
export interface Result { stars: number; moves: number }
export type Progress = Record<string, Result>;

export const LEVELS_PER_WORLD = 18;
export const SHARDS_PER_WORLD = LEVELS_PER_WORLD * 3;
export const WORLDS = 5;

export const totalStars = (progress: Progress) => Object.values(progress).reduce((sum, p) => sum + p.stars, 0);
export const totalShards = totalStars;
export const unlockedLevel = (progress: Progress, count: number) => {
  let next = 1;
  while (next < count && progress[String(next)]) next++;
  return next;
};
export function recordResult(progress: Progress, id: number, stars: number, moves: number): Progress {
  const previous = progress[String(id)];
  return { ...progress, [id]: { stars: Math.max(previous?.stars ?? 0, stars), moves: Math.min(previous?.moves ?? Infinity, moves) } };
}

export function worldShards(progress: Progress, world: number) {
  let sum = 0;
  for (let i = 1; i <= LEVELS_PER_WORLD; i++) sum += progress[world * LEVELS_PER_WORLD + i]?.stars ?? 0;
  return sum;
}

export const worldCleared = (progress: Progress, world: number) => !!progress[(world + 1) * LEVELS_PER_WORLD];

/** A world's Heart is forged only when every one of its 18 levels holds all three shards. */
export const heartsEarned = (progress: Progress) =>
  Array.from({ length: WORLDS }, (_, w) => w).filter(w => worldShards(progress, w) === SHARDS_PER_WORLD);
