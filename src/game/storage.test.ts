import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completedDevelopmentSave, decodeSave, freshSave, MAX_LEVEL, migrateV2Progress } from '../services/storage';
import { heartsEarned, unlockedLevel, worldCleared } from './progress';
import { levels } from './levels';
import { isOpen, UNLOCK_ALL } from './testing';

test('Normal builds keep levels locked until reached (the all-levels-open switch is for test builds only)', () => {
  assert.equal(UNLOCK_ALL, false, 'UNLOCK_ALL must stay false in the repository');
  assert.equal(isOpen(5, 5), true);
  assert.equal(isOpen(4, 5), true);
  assert.equal(isOpen(6, 5), false);
});

test('Development save completes every level and story moment', () => {
  const save = completedDevelopmentSave(freshSave());
  assert.equal(Object.keys(save.progress).length, MAX_LEVEL);
  assert.deepEqual(save.progress['1'], { stars: 3, moves: levels[0]!.par });
  assert.deepEqual(save.progress[String(MAX_LEVEL)], { stars: 3, moves: levels.at(-1)!.par });
  assert.deepEqual(save.seen, { prologue: true, intros: [0, 1, 2, 3, 4], outros: [0, 1, 2, 3, 4], hearts: [0, 1, 2, 3, 4], ending: true });
});

test('Progress, settings and story flags survive serialization', () => {
  const save = { ...freshSave(), progress: { 90: { stars: 3, moves: 7 } }, seen: { prologue: true, intros: [0, 1], outros: [0], hearts: [0], ending: false }, levelsSinceAd: 2 };
  assert.deepEqual(decodeSave(JSON.stringify(save)), save);
});

const v2 = (progress: Record<string, { stars: number; moves: number }>, seen = { prologue: true, intros: [0, 1], outros: [0], hearts: [0], ending: false }) =>
  JSON.stringify({ version: 2, progress, settings: { sound: false, music: true, haptics: true, voice: true }, seen, levelsSinceAd: 2 });
const range = (from: number, to: number, stars = 3) => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [String(from + i), { stars, moves: 4 }]));

test('Version 2 saves (27 levels per world) carry over to the 18-level worlds', () => {
  // World 1 perfected and world 2 played to old level 13 (on 2 shards from level 40).
  const decoded = decodeSave(v2({ ...range(1, 27), ...range(28, 39), ...range(40, 40, 2) }));
  assert.equal(decoded.version, 3);
  assert.equal(decoded.settings.sound, false);
  assert.deepEqual(decoded.seen, { prologue: true, intros: [0, 1], outros: [0], hearts: [0], ending: false });
  assert.equal(decoded.levelsSinceAd, 2);
  // A perfected world stays perfected and cleared, so its Heart and the open road to world 2 stay earned.
  assert.equal(worldCleared(decoded.progress, 0), true);
  assert.deepEqual(heartsEarned(decoded.progress), [0]);
  // Old world-2 levels 1-12 cover new levels 19-26; old level 13 (id 40, 2 shards) alone stands behind new level 27.
  assert.equal(decoded.progress['26']!.stars, 3);
  assert.equal(decoded.progress['26']!.moves, levels[25]!.par);
  assert.deepEqual(decoded.progress['27'], { stars: 2, moves: levels[26]!.twoStar });
  assert.equal(decoded.progress['28'], undefined);
  assert.equal(unlockedLevel(decoded.progress, MAX_LEVEL + 1), 28);
});

test('Migration never clears a world finale that was not cleared, and keeps the weakest rating', () => {
  const all26 = migrateV2Progress(range(1, 26));
  assert.equal(all26['18'], undefined, 'old level 27 unplayed: new finale 18 stays open');
  assert.equal(worldCleared(all26, 0), false);
  const mixed = migrateV2Progress({ ...range(1, 27), 2: { stars: 1, moves: 9 } });
  assert.equal(mixed['2']!.stars, 1, 'new level 2 stands for old levels 2 and 3');
  assert.equal(mixed['2']!.moves, levels[1]!.maxMoves);
  assert.deepEqual(heartsEarned(mixed), [], 'a world with a 1-shard level forges no Heart');
  const every = migrateV2Progress(range(1, 135));
  assert.equal(Object.keys(every).length, MAX_LEVEL);
  assert.deepEqual(heartsEarned(every), [0, 1, 2, 3, 4]);
});

test('Earlier v2 saves without Heart flags still load', () => {
  const old = v2({}, { prologue: true, intros: [0], outros: [] } as never);
  assert.deepEqual(decodeSave(old).seen, { prologue: true, intros: [0], outros: [], hearts: [], ending: false });
});
test('Prototype v1 saves keep settings only', () => {
  const v1 = { version: 1, progress: { 1: { stars: 3, moves: 1 } }, settings: { sound: false, music: true, haptics: false } };
  const decoded = decodeSave(JSON.stringify(v1));
  assert.deepEqual(decoded.progress, {});
  assert.equal(decoded.settings.sound, false);
});
test('Corrupt and invalid saves are rejected explicitly', () => {
  for (const raw of ['{', '{}', '{"version":4}', JSON.stringify({ ...freshSave(), progress: { 91: { stars: 3, moves: 1 } } }),
    v2({ 136: { stars: 3, moves: 1 } }),
    JSON.stringify({ ...freshSave(), seen: { prologue: 'yes', intros: [], outros: [] } }),
    JSON.stringify({ ...freshSave(), seen: { prologue: true, intros: [], outros: [], hearts: [9], ending: false } }),
    JSON.stringify({ ...freshSave(), settings: { music: 'yes' } })]) {
    assert.throws(() => decodeSave(raw));
  }
});
test('Saves from before narration existed default to narration on', () => {
  const old = { ...freshSave(), settings: { sound: true, music: false, haptics: true } };
  assert.deepEqual(decodeSave(JSON.stringify(old)).settings, { sound: true, music: false, haptics: true, voice: true });
  assert.throws(() => decodeSave(JSON.stringify({ ...freshSave(), settings: { sound: true, music: true, haptics: true, voice: 'loud' } })));
});
