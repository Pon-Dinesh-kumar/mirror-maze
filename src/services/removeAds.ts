import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PlayBilling, PurchaseStatus } from '../../modules/google-play';
import { REMOVE_ADS_PRODUCT } from '../config/googlePlay';

/** Remembered apart from the journey save, so resetting progress never brings the ads back. */
const OWNED_KEY = 'mirror-maze:remove-ads';
/** When Google Play cannot be reached for the price, it is asked again after each of these waits (then on returning to the game). */
const PRICE_RETRY_MS = [5_000, 20_000, 60_000];

/**
 * The Remove Ads purchase (Google Play Billing, Android). The remembered answer applies at once on launch; Google Play
 * then confirms it, so a purchase made on another phone appears and a refunded one disappears. The price is Google
 * Play's own localised one, fetched once here and shown by every screen.
 */
export function useRemoveAds() {
  const [adFree, setAdFree] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [price, setPrice] = useState<string>();
  const priceRef = useRef<string>(undefined);
  priceRef.current = price;
  const [busy, setBusy] = useState(false);
  const own = useCallback((owned: boolean) => {
    setAdFree(owned);
    (owned ? AsyncStorage.setItem(OWNED_KEY, '1') : AsyncStorage.removeItem(OWNED_KEY))
      .catch(cause => console.warn('Could not remember the Remove Ads purchase', cause));
  }, []);
  useEffect(() => {
    let live = true;
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const loadPrice = () => {
      clearTimeout(retry);
      PlayBilling?.product(REMOVE_ADS_PRODUCT).then(p => { if (live) setPrice(p?.price ?? undefined); }, cause => {
        console.warn('Could not load the Remove Ads price', cause);
        const wait = PRICE_RETRY_MS[failures++];
        if (live && wait) retry = setTimeout(loadPrice, wait);
      });
    };
    void (async () => {
      const remembered = await AsyncStorage.getItem(OWNED_KEY).catch(() => null);
      if (!live) return;
      setAdFree(remembered === '1');
      setLoaded(true);
      if (!PlayBilling) return;
      PlayBilling.owned(REMOVE_ADS_PRODUCT).then(owned => { if (live) own(owned); }, cause => console.warn('Could not check the Remove Ads purchase', cause));
      loadPrice();
    })();
    // A pending purchase (e.g. paid in cash at a shop) that completes while the game is open.
    const sub = PlayBilling?.addListener('onPurchase', outcome => {
      if (outcome.status === 'purchased' && outcome.products.includes(REMOVE_ADS_PRODUCT)) own(true);
    });
    // Still no price (offline at launch, say): coming back to the game, including from Google Play's own sheet, asks again.
    const back = AppState.addEventListener('change', state => { if (state === 'active' && !priceRef.current) { failures = 0; loadPrice(); } });
    return () => { live = false; clearTimeout(retry); sub?.remove(); back.remove(); };
  }, [own]);

  const buy = useCallback(async (): Promise<PurchaseStatus> => {
    if (!PlayBilling) return 'unavailable';
    setBusy(true);
    try {
      const { status } = await PlayBilling.buy(REMOVE_ADS_PRODUCT);
      if (status === 'purchased' || status === 'owned') own(true);
      return status;
    } catch (cause) {
      // Google Play Billing could not even connect (no Play Store account, or an old Play Store).
      console.warn('Remove Ads purchase failed', cause);
      return 'unavailable';
    } finally {
      setBusy(false);
    }
  }, [own]);
  /** Asks Google Play again: 'restored', 'none' (this Play account has not bought it) or 'failed' (no connection). */
  const restore = useCallback(async (): Promise<'restored' | 'none' | 'failed'> => {
    if (!PlayBilling) return 'failed';
    setBusy(true);
    try {
      const owned = await PlayBilling.owned(REMOVE_ADS_PRODUCT);
      own(owned);
      return owned ? 'restored' : 'none';
    } catch (cause) {
      console.warn('Could not restore the Remove Ads purchase', cause);
      return 'failed';
    } finally {
      setBusy(false);
    }
  }, [own]);

  return { supported: !!PlayBilling, loaded, adFree, price, busy, buy, restore };
}
export type RemoveAds = ReturnType<typeof useRemoveAds>;
