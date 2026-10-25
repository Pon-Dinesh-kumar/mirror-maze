import { Progress, recordResult, totalShards } from '../game/progress';
import { levels } from '../game/levels';

export const STORAGE_KEY = 'mirror-maze:save:v1';
export const DEVELOPMENT_STORAGE_KEY = `${STORAGE_KEY}:development`;
export const MAX_LEVEL = 90;
/** Save version 2 belonged to the first 135-level campaign (27 levels per world). */
const V2_PER_WORLD = 27, V2_MAX_LEVEL = 135, PER_WORLD = 18, WORLDS = 5;
export interface Settings { sound: boolean; music: boolean; haptics: boolean; voice: boolean }
/** Story moments already shown: prologue, world intros, world-cleared outros, Heart forgings and the finale. */
export interface Seen { prologue: boolean; intros: number[]; outros: number[]; hearts: number[]; ending: boolean }
export interface SaveData { version: 3; progress: Progress; settings: Settings; seen: Seen; levelsSinceAd: number }
export const freshSave = (): SaveData => ({
  version: 3, progress: {}, settings: { sound: true, music: true, haptics: true, voice: true },
  seen: { prologue: false, intros: [], outros: [], hearts: [], ending: false }, levelsSinceAd: 0,
});
export const completedDevelopmentSave = (save: SaveData): SaveData => ({
  ...save,
  progress: Object.fromEntries(Array.from({ length: MAX_LEVEL }, (_, index) => [String(index + 1), { stars: 3, moves: levels[index]?.par ?? 1 }])),
  seen: { prologue: true, intros: [0, 1, 2, 3, 4], outros: [0, 1, 2, 3, 4], hearts: [0, 1, 2, 3, 4], ending: true },
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const numberList = (v: unknown) => Array.isArray(v) && v.every(n => Number.isInteger(n) && n >= 0 && n < 5) ? v as number[] : undefined;

function decodeSettings(settings: unknown) {
  if (!isObject(settings)) throw new Error('The saved settings could not be read.');
  const { sound, music, haptics } = settings;
  // Narration was added later, so older saves default to hearing it.
  const voice = settings.voice === undefined ? true : settings.voice;
  if (typeof sound !== 'boolean' || typeof music !== 'boolean' || typeof haptics !== 'boolean' || typeof voice !== 'boolean') throw new Error('The saved settings could not be read.');
  return { sound, music, haptics, voice };
}

function decodeProgress(raw: Record<string, unknown>, maxLevel: number): Progress {
  const progress: Progress = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!/^[1-9]\d*$/.test(id) || Number(id) > maxLevel || !isObject(entry) ||
      typeof entry.stars !== 'number' || !Number.isInteger(entry.stars) || entry.stars < 1 || entry.stars > 3 ||
      typeof entry.moves !== 'number' || !Number.isInteger(entry.moves) || entry.moves < 1) {
      throw new Error('The saved level results could not be read.');
    }
    progress[id] = { stars: entry.stars, moves: entry.moves };
  }
  return progress;
}

/**
 * Carries version 2 results (27 levels per world) onto the 18-level worlds. Each new level stands for one or two old ones
 * in order (1, 2, 1, 2 ...), so a world's last level still stands for its old finale. A new level counts as cleared only
 * when every old level it stands for was, with the fewest shards among them, so a fully cleared or perfected world stays
 * exactly that. Its best move count is the threshold of that rating on the new board.
 */
export function migrateV2Progress(old: Progress): Progress {
  const progress: Progress = {};
  for (let w = 0; w < WORLDS; w++) for (let j = 1; j <= PER_WORLD; j++) {
    const from = Math.floor((j - 1) * 1.5) + 1, to = Math.floor(j * 1.5);
    let stars = 3;
    for (let k = from; k <= to; k++) {
      const r = old[String(w * V2_PER_WORLD + k)];
      stars = r ? Math.min(stars, r.stars) : 0;
      if (!stars) break;
    }
    if (!stars) continue;
    const id = w * PER_WORLD + j, level = levels[id - 1];
    progress[String(id)] = { stars, moves: level ? (stars === 3 ? level.par : stars === 2 ? level.twoStar : level.maxMoves) : 1 };
  }
  return progress;
}

function decodeSeen(seen: Record<string, unknown>): Seen {
  const intros = numberList(seen.intros), outros = numberList(seen.outros);
  // hearts/ending were added after v2 shipped to testers, so they default when absent.
  const hearts = seen.hearts === undefined ? [] : numberList(seen.hearts);
  const ending = seen.ending === undefined ? false : seen.ending;
  if (typeof seen.prologue !== 'boolean' || !intros || !outros || !hearts || typeof ending !== 'boolean') throw new Error('The saved story progress could not be read.');
  return { prologue: seen.prologue, intros, outros, hearts, ending };
}

export function decodeSave(raw: string): SaveData {
  const data: unknown = JSON.parse(raw);
  if (!isObject(data)) throw new Error('This save is damaged.');
  // Version 1 belonged to the 30-level prototype; its level layouts no longer exist, so only settings carry over.
  if (data.version === 1) return { ...freshSave(), settings: decodeSettings(data.settings) };
  if ((data.version !== 2 && data.version !== 3) || !isObject(data.progress) || !isObject(data.seen)) throw new Error('This save is damaged or from an unsupported version.');
  const progress = data.version === 2 ? migrateV2Progress(decodeProgress(data.progress, V2_MAX_LEVEL)) : decodeProgress(data.progress, MAX_LEVEL);
  const ads = data.levelsSinceAd;
  if (typeof ads !== 'number' || !Number.isInteger(ads) || ads < 0) throw new Error('The saved data could not be read.');
  return { version: 3, progress, settings: decodeSettings(data.settings), seen: decodeSeen(data.seen), levelsSinceAd: ads };
}

/**
 * The part of a save that follows the player between devices (Google Play Games cloud save): level results and story
 * moments. Settings and the ad counter stay on each device.
 */
export interface CloudSave { version: 3; progress: Progress; seen: Seen }
type Journey = Pick<SaveData, 'progress' | 'seen'>;

const sorted = (list: number[]) => [...new Set(list)].sort((a, b) => a - b);
/** A canonical text form: two journeys with the same results and story moments encode identically. */
export const encodeCloud = ({ progress, seen }: Journey) => JSON.stringify({
  version: 3, progress,
  seen: { prologue: seen.prologue, intros: sorted(seen.intros), outros: sorted(seen.outros), hearts: sorted(seen.hearts), ending: seen.ending },
});
export function decodeCloud(raw: string): CloudSave {
  const data: unknown = JSON.parse(raw);
  if (!isObject(data) || data.version !== 3 || !isObject(data.progress) || !isObject(data.seen)) throw new Error('The cloud save is damaged or from an unsupported version.');
  return { version: 3, progress: decodeProgress(data.progress, MAX_LEVEL), seen: decodeSeen(data.seen) };
}
export const sameJourney = (a: Journey, b: Journey) => encodeCloud(a) === encodeCloud(b);

/**
 * Combines this device's journey with the cloud's. Progress only ever grows, so nothing is lost: each level keeps its
 * most shards and fewest moves, and a story moment seen on either device counts as seen.
 */
export function mergeSaves(local: SaveData, cloud: Journey): SaveData {
  let progress = local.progress;
  for (const [id, r] of Object.entries(cloud.progress)) progress = recordResult(progress, Number(id), r.stars, r.moves);
  const a = local.seen, b = cloud.seen;
  const seen: Seen = {
    prologue: a.prologue || b.prologue, ending: a.ending || b.ending,
    intros: sorted([...a.intros, ...b.intros]), outros: sorted([...a.outros, ...b.outros]), hearts: sorted([...a.hearts, ...b.hearts]),
  };
  return { ...local, progress, seen };
}

/** Orders cloud saves for Google Play's conflict resolution (the furthest journey wins); never decreases as a journey grows. */
export const cloudProgress = ({ progress }: Journey) => Object.keys(progress).length * 1000 + totalShards(progress);
/** The line Google Play shows for the cloud save. */
export const describeJourney = ({ progress }: Journey) => {
  const cleared = Object.keys(progress).length;
  return `${cleared} of ${MAX_LEVEL} levels cleared · ${totalShards(progress)} crystal shards`;
};
