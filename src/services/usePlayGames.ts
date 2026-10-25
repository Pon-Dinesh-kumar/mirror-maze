import { useCallback, useEffect, useRef, useState } from 'react';
import { PlayGames } from '../../modules/google-play';
import { ACHIEVEMENT_IDS, SHARDS_LEADERBOARD } from '../config/googlePlay';
import { earnedAchievements } from '../game/achievements';
import { totalShards } from '../game/progress';
import { CloudSave, cloudProgress, decodeCloud, describeJourney, encodeCloud, mergeSaves, sameJourney, SaveData } from './storage';
import type { useSave } from './useSave';

export type PlayGamesStatus = 'unavailable' | 'signedOut' | 'signedIn';
/** Development builds start fully opened (completedDevelopmentSave), so they keep a cloud save of their own. */
const SAVE_NAME = __DEV__ ? 'mirror-maze-dev' : 'mirror-maze';
const games = PlayGames?.isConfigured() ? PlayGames : null;

/**
 * Google Play Games: sign-in (automatic for returning players), achievements, the Crystal Shards leaderboard and the
 * cloud save. Whenever the journey changes, it is merged with the cloud save both ways, so playing on a new phone (or
 * after reinstalling) picks up where the player left off, and nothing earned on either side is lost.
 */
export function usePlayGames(save: ReturnType<typeof useSave>, onRestored: () => void) {
  const [status, setStatus] = useState<PlayGamesStatus>(games ? 'signedOut' : 'unavailable');
  const latest = useRef(save.data);
  latest.current = save.data;
  const restored = useRef(onRestored);
  restored.current = onRestored;
  const queue = useRef(Promise.resolve());
  /** After a reset, the next sync replaces the cloud save instead of merging it back in. */
  const replace = useRef(false);
  const reported = useRef(new Set<string>());
  const scored = useRef(-1);
  const { adopt, loaded } = save;

  useEffect(() => {
    games?.isAuthenticated().then(ok => setStatus(ok ? 'signedIn' : 'signedOut'), cause => console.warn('Play Games sign-in check failed', cause));
  }, []);

  const report = useCallback((journey: SaveData) => {
    if (!games) return;
    for (const key of earnedAchievements(journey.progress)) {
      const id = ACHIEVEMENT_IDS[key];
      if (!id || reported.current.has(id)) continue;
      reported.current.add(id);
      games.unlock(id).catch(cause => { reported.current.delete(id); console.warn('Achievement unlock failed', key, cause); });
    }
    const score = totalShards(journey.progress);
    if (SHARDS_LEADERBOARD && score !== scored.current) {
      scored.current = score;
      games.submitScore(SHARDS_LEADERBOARD, score).catch(cause => { scored.current = -1; console.warn('Score submission failed', cause); });
    }
  }, []);

  const sync = useCallback(() => {
    queue.current = queue.current.then(async () => {
      if (!games) return;
      const local = latest.current;
      const replacing = replace.current;
      let journey = local;
      try {
        const raw = await games.openSave(SAVE_NAME);
        let cloud: CloudSave | undefined;
        try {
          cloud = raw ? decodeCloud(raw) : undefined;
        } catch (cause) {
          // Never overwrite a cloud save this version cannot read (it may come from a newer version of the game).
          await games.discardSave();
          throw cause;
        }
        journey = cloud && !replacing ? mergeSaves(local, cloud) : local;
        if (cloud && sameJourney(journey, cloud)) await games.discardSave();
        else await games.commitSave(encodeCloud(journey), describeJourney(journey), cloudProgress(journey));
        if (replacing) replace.current = false;
        // A reset made while this sync ran wins: the next sync carries it to the cloud.
        if (!replace.current && !sameJourney(journey, local)) {
          adopt({ version: 3, progress: journey.progress, seen: journey.seen });
          restored.current();
        }
      } catch (cause) {
        console.warn('Play Games cloud save failed', cause);
      }
      if (!replace.current) report(journey);
    }).catch(cause => console.warn('Play Games sync failed', cause));
  }, [adopt, report]);

  // Each change to the journey (a cleared level, a story moment) reaches the cloud a moment later.
  useEffect(() => {
    if (status !== 'signedIn' || !loaded) return;
    const timer = setTimeout(sync, 1000);
    return () => clearTimeout(timer);
  }, [status, loaded, save.data.progress, save.data.seen, sync]);

  const signIn = useCallback(async () => {
    if (!games) return false;
    try {
      const ok = await games.signIn();
      setStatus(ok ? 'signedIn' : 'signedOut');
      return ok;
    } catch (cause) {
      console.warn('Play Games sign-in failed', cause);
      return false;
    }
  }, []);
  /** Opens Google Play's achievements or leaderboard screen, signing in first if needed. False if that failed. */
  const open = useCallback(async (screen: 'achievements' | 'leaderboard') => {
    if (!games || (status !== 'signedIn' && !(await signIn()))) return false;
    try {
      if (screen === 'achievements') await games.showAchievements();
      else if (SHARDS_LEADERBOARD) await games.showLeaderboard(SHARDS_LEADERBOARD);
      return true;
    } catch (cause) {
      console.warn('Play Games screen failed', screen, cause);
      return false;
    }
  }, [status, signIn]);
  /** The local journey was reset: carry the reset to the cloud save too. */
  const resetCloud = useCallback(() => { replace.current = true; reported.current.clear(); }, []);

  return { status, signIn, open, resetCloud, hasLeaderboard: !!SHARDS_LEADERBOARD };
}
export type PlayGamesState = ReturnType<typeof usePlayGames>;
