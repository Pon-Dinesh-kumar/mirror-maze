import { Platform } from 'react-native';
import mobileAds, { AdEventType, AdsConsent, AdsConsentPrivacyOptionsRequirementStatus, InterstitialAd, MaxAdContentRating, TestIds } from 'react-native-google-mobile-ads';
import { AdProvider, ads } from './ads';
import { INTERSTITIAL_UNIT } from '../config/googlePlay';

let starting = false, started = false;

/**
 * Starts Google AdMob and registers the interstitial with the ad slot: asks for consent where the law requires it
 * (Google's consent form, EEA/UK), then loads the first ad so it is ready by the third level. Safe to call repeatedly;
 * if it could not start (offline, no consent), a later call tries again.
 */
export function startAds() {
  if (starting || started) return;
  starting = true;
  void (async () => {
    try {
      // A stale consent form must not block ads that were already consented to, so a failure here is only logged.
      await AdsConsent.gatherConsent().catch(cause => console.warn('Ad consent could not be updated', cause));
      if (!(await AdsConsent.getConsentInfo()).canRequestAds) return;
      await mobileAds().setRequestConfiguration({ maxAdContentRating: MaxAdContentRating.PG });
      await mobileAds().initialize();
      ads.setProvider(interstitials());
      started = true;
    } catch (cause) {
      console.warn('Ads could not start', cause);
    } finally {
      starting = false;
    }
  })();
}

/** Google's privacy options form, which players in consent regions must be able to reopen (Settings). */
export const adPrivacy = {
  async required() {
    try { return (await AdsConsent.getConsentInfo()).privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED; }
    catch { return false; }
  },
  async show() { await AdsConsent.showPrivacyOptionsForm(); },
};

function interstitials(): AdProvider {
  const own = Platform.OS === 'ios' ? INTERSTITIAL_UNIT.ios : INTERSTITIAL_UNIT.android;
  const ad = InterstitialAd.createForAdRequest(__DEV__ || !own ? TestIds.INTERSTITIAL : own);
  let shown: { resolve: () => void; reject: (cause: unknown) => void } | undefined;
  let failures = 0, retry: ReturnType<typeof setTimeout> | undefined;
  const load = () => { clearTimeout(retry); ad.load(); };
  const finish = (cause?: unknown) => {
    const s = shown;
    shown = undefined;
    if (cause === undefined) s?.resolve(); else s?.reject(cause);
  };
  ad.addAdEventListener(AdEventType.LOADED, () => { failures = 0; });
  ad.addAdEventListener(AdEventType.ERROR, error => {
    if (shown) { finish(error); load(); return; }
    // Offline or no fill: try again later, backing off from 30 s to 10 min.
    retry = setTimeout(load, Math.min(30_000 * 2 ** failures++, 600_000));
  });
  ad.addAdEventListener(AdEventType.CLOSED, () => { finish(); load(); });
  load();
  return {
    ready: () => ad.loaded,
    showInterstitial: () => new Promise<void>((resolve, reject) => {
      shown = { resolve, reject };
      ad.show().catch(cause => { finish(cause); load(); });
    }),
  };
}
