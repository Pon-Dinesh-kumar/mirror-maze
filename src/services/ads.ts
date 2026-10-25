/**
 * Interstitial ad slot. The business model shows one ad after every third completed level,
 * at a natural break (when the player taps Continue), never during story cinematics or gameplay.
 *
 * The AdMob provider is registered by `startAds` (adMob.native.ts); web builds have none. Without a provider, or
 * while no ad has loaded (offline, no fill), this is a no-op and the game carries straight on.
 */
export interface AdProvider { ready(): boolean; showInterstitial(): Promise<void> }

let provider: AdProvider | undefined;
let pauseHooks: { pause: () => void; resume: () => void } | undefined;
let showing: Promise<boolean> | undefined;
export const AD_INTERVAL = 3;

export const ads = {
  setProvider(next: AdProvider | undefined) { provider = next; },
  /** Lets the app silence music and haptics while an ad is on screen. */
  setPauseHooks(hooks: typeof pauseHooks) { pauseHooks = hooks; },
  isDue(levelsSinceAd: number) { return levelsSinceAd >= AD_INTERVAL; },
  /**
   * Resolves once the ad has closed or failed, with whether one was shown; game flow always continues.
   * A second call while an ad is on screen waits for that same ad.
   */
  show(): Promise<boolean> {
    if (showing) return showing;
    const current = provider;
    if (!current?.ready()) return Promise.resolve(false);
    pauseHooks?.pause();
    showing = current.showInterstitial().then(() => true, cause => { console.warn('Interstitial failed', cause); return false; })
      .finally(() => { showing = undefined; pauseHooks?.resume(); });
    return showing;
  },
};
