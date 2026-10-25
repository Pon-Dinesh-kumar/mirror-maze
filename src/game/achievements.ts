import { heartsEarned, Progress, worldCleared, WORLDS } from './progress';

export type AchievementKey = 'firstLight' | 'skyTemples' | 'rainforest' | 'desert' | 'iceAge' | 'theVoid' | 'firstHeart' | 'lightkeeper';

/**
 * Google Play Games achievements, in display order: what to create in Play Console (name, description, XP; the XP adds
 * up to 810 of the 1000 allowed). Each is earned from saved results alone, so a restored journey earns them again.
 */
export const ACHIEVEMENTS: { key: AchievementKey; name: string; description: string; points: number }[] = [
  { key: 'firstLight', name: 'First Light', description: 'Bend the light through your first mirror maze.', points: 10 },
  { key: 'skyTemples', name: 'The Fallen Sky', description: 'Restore the Sky Temples: clear all 18 levels of Chapter 1.', points: 50 },
  { key: 'rainforest', name: 'The Storm Canopy', description: 'Restore the Emerald Rainforest: clear all 18 levels of Chapter 2.', points: 75 },
  { key: 'desert', name: 'The Sinking Sun', description: 'Restore the Desert of Pyramids: clear all 18 levels of Chapter 3.', points: 100 },
  { key: 'iceAge', name: 'The Frozen Echo', description: 'Restore the Ice Age: clear all 18 levels of Chapter 4.', points: 125 },
  { key: 'theVoid', name: 'Heart of the Void', description: 'Cross the Void: clear all 18 levels of Chapter 5.', points: 150 },
  { key: 'firstHeart', name: 'Heartforged', description: 'Gather all 54 shards of one world to forge its Heart.', points: 100 },
  { key: 'lightkeeper', name: 'The Last Lightkeeper', description: 'Forge all five Hearts and seal the Void.', points: 200 },
];

const worldKeys: AchievementKey[] = ['skyTemples', 'rainforest', 'desert', 'iceAge', 'theVoid'];

export function earnedAchievements(progress: Progress): AchievementKey[] {
  const earned: AchievementKey[] = [];
  if (progress['1']) earned.push('firstLight');
  for (let w = 0; w < WORLDS; w++) if (worldCleared(progress, w)) earned.push(worldKeys[w]!);
  const hearts = heartsEarned(progress).length;
  if (hearts >= 1) earned.push('firstHeart');
  if (hearts === WORLDS) earned.push('lightkeeper');
  return earned;
}
