import type { AchievementKey } from '../game/achievements';

/**
 * Store identifiers, filled in from the AdMob and Play Console dashboards (docs/GOOGLE_PLAY.md walks through each one).
 * The app ids are native settings and live in app.json instead: the AdMob app id in the react-native-google-mobile-ads
 * plugin, the Play Games project id in the google-play plugin.
 *
 * Until a value is filled in: ads use Google's test ad unit, and the matching achievement or leaderboard is skipped.
 */

/** AdMob interstitial ad unit ids ("ca-app-pub-…/…"). Development builds always use Google's test unit. */
export const INTERSTITIAL_UNIT: { android: string; ios: string } = { android: '', ios: '' };

/** The Remove Ads in-app product (Play Console > Monetize > In-app products). A one-time, non-consumable purchase. */
export const REMOVE_ADS_PRODUCT = 'remove_ads';

/** Play Games achievement ids ("CgkI…"), from Play Console > Play Games Services > Achievements. */
export const ACHIEVEMENT_IDS: Record<AchievementKey, string> = {
  firstLight: '',
  skyTemples: '',
  rainforest: '',
  desert: '',
  iceAge: '',
  theVoid: '',
  firstHeart: '',
  lightkeeper: '',
};

/** The "Crystal Shards" leaderboard id ("CgkI…"): total shards, higher is better. */
export const SHARDS_LEADERBOARD = '';
