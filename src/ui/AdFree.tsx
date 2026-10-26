import React, { useEffect, useId, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, G, Line, Mask, Rect, Text as SvgText } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import type { PurchaseStatus } from '../../modules/google-play';
import { audio } from '../services/audio';
import { fonts } from './fonts';
import { GameText } from './GameText';
import { GameIcon, goldFrame } from './Toy';

/**
 * The Remove Ads purchase as every screen offers it: Home, Pause and Settings all call the same `buy` (useRemoveAds),
 * which opens Google Play's purchase sheet at once. `price` is Google Play's own localised price, absent until Google
 * Play answers; without it the entry points say "One-time purchase" and never guess a price.
 */
export interface AdFree { owned: boolean; price?: string; busy: boolean; buy: () => Promise<PurchaseStatus> }

/** What Google Play reported once its purchase sheet closed. A cancel needs no message, and a purchase shows Google Play's own. */
export const purchaseNotice: Partial<Record<PurchaseStatus, string>> = {
  owned: 'You already own Ad-Free, so the ads are gone again.',
  pending: 'Your purchase is pending. The ads disappear as soon as Google Play confirms it.',
  unavailable: 'Google Play cannot sell Ad-Free right now. Please try again later.',
  failed: 'The purchase did not go through. Please try again.',
};

const nativeDriver = Platform.OS !== 'web';
/** The same gold-on-blue in every world, so the purchase always reads as one premium item rather than a world's menu button. */
export const AD_FREE_GOLD = '#ffd36a';
const navy = ['#24387a', '#0c1634'] as const;
const royal = ['#4a74e0', '#21409e', '#0f1f58'] as const;
const priceGold = ['#fff0b0', '#f2c24a', '#c98a14'] as const;
const TITLE = 'GO AD-FREE FOREVER';

/** A crossed-out "AD" tag. The slash cuts a clear gap through the tag, so it reads on any background. */
export function NoAdsIcon({ size = 24, color = AD_FREE_GOLD }: { size?: number; color?: string }) {
  const id = `noads${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return <View accessible={false} pointerEvents="none">
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Defs>
        <Mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
          <Rect x="0" y="0" width="48" height="48" fill="#ffffff" />
          <Line x1="8" y1="5" x2="40" y2="43" stroke="#000000" strokeWidth="9" strokeLinecap="round" />
        </Mask>
      </Defs>
      <G mask={`url(#${id})`}>
        <Rect x="3.5" y="10.5" width="41" height="27" rx="7" fill="none" stroke={color} strokeWidth="3.4" />
        <SvgText x="24" y="31.5" textAnchor="middle" fontFamily={fonts.bold} fontSize="19" fill={color}>AD</SvgText>
      </G>
      <Line x1="8" y1="5" x2="40" y2="43" stroke={color} strokeWidth="3.4" strokeLinecap="round" />
    </Svg>
  </View>;
}

/** One gentle shine across the button when it first appears; it never loops. */
function Glint({ width, delay }: { width: number; delay: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!width) return;
    const run = Animated.sequence([Animated.delay(delay), Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: nativeDriver })]);
    run.start();
    return () => run.stop();
  }, [v, width, delay]);
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, width: 36,
    transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-48, width + 12] }) }, { skewX: '-20deg' }] }}>
    <LinearGradient colors={['#ffffff00', '#fff6d055', '#ffffff00']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
  </Animated.View>;
}

function useWidth() {
  const [width, setWidth] = useState(0);
  return { width, onLayout: (e: { nativeEvent: { layout: { width: number } } }) => setWidth(Math.round(e.nativeEvent.layout.width)) };
}

const press = (onPress: () => void) => () => { audio.play('pop'); audio.haptic(); onPress(); };
const clamp = (min: number, max: number, v: number) => Math.max(min, Math.min(max, v));
/** Cinzel capitals run about .66 em (plus the letter spacing and GameText's padding for it); Lilita figures about .52 em. */
const titleWidth = (size: number) => TITLE.length * (.66 * size + .8) + 4;
const priceWidth = (price: string, size: number) => price.length * .52 * size;
const label = (price?: string) => (price ? `Remove ads forever, ${price}, one-time purchase` : 'Remove ads forever, one-time purchase');

/** True while the player has asked the system for less motion (Android: "Remove animations"). */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(r => { if (live) setReduced(r); }, () => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { live = false; sub.remove(); };
  }, []);
  return reduced;
}

/** How long the orb's shimmer takes to cross it, and how long it rests before the next one. */
const SHIMMER_MS = 1800;
const SHIMMER_REST_MS = 4400;

/**
 * A soft golden light that drifts slowly across the orb and its rim every few seconds. It runs on the native driver
 * (no JS work per frame), sits over the orb without taking any room, and stays away for anyone who asked for less motion.
 */
function Shimmer({ size }: { size: number }) {
  const still = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const run = Animated.loop(Animated.sequence([
      Animated.delay(SHIMMER_REST_MS),
      Animated.timing(v, { toValue: 1, duration: SHIMMER_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: nativeDriver }),
    ]));
    run.start();
    return () => { run.stop(); v.setValue(0); };
  }, [v, still]);
  if (still) return null;
  const band = size * .5;
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', top: -size * .25, bottom: -size * .25, left: 0, width: band,
    transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-band * 1.5, size + band * .5] }) }, { rotate: '22deg' }] }}>
    <LinearGradient colors={['#fff2c000', '#fff2c03d', '#fffbe866', '#fff2c03d', '#fff2c000']} locations={[0, .3, .5, .7, 1]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
  </Animated.View>;
}

/**
 * Home: the crossed-out ads icon alone in a gold-rimmed orb (Google Play's price is in its spoken label). A tap opens
 * Google Play's purchase sheet straight away.
 */
export function AdFreeOrb({ price, busy, onPress, size = 46 }: { price?: string; busy: boolean; onPress: () => void; size?: number }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label(price)} accessibilityState={{ disabled: busy }} disabled={busy} hitSlop={8}
    onPress={press(onPress)} style={({ pressed }) => ({ opacity: busy ? .7 : 1, transform: [{ scale: pressed ? .95 : 1 }] })}>
    <View style={[s.shadow, { borderRadius: size / 2 }]}>
      <LinearGradient colors={goldFrame} locations={[0, .3, .7, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ width: size, height: size, borderRadius: size / 2, padding: 1.5, overflow: 'hidden' }}>
        <LinearGradient colors={navy} style={[s.center, { flex: 1, borderRadius: size / 2, overflow: 'hidden' }]}>
          <LinearGradient colors={['#ffffff38', '#ffffff00']} pointerEvents="none"
            style={{ position: 'absolute', top: 1, left: size * .14, right: size * .14, height: size * .42, borderRadius: size }} />
          <NoAdsIcon size={size * .6} />
        </LinearGradient>
        <Shimmer size={size} />
      </LinearGradient>
    </View>
  </Pressable>;
}

/** Home, once owned: a quiet badge in place of the icon (it never sells again). */
export function AdFreeBadge() {
  return <View style={s.badge} accessible accessibilityLabel="Ad-free active">
    <GameIcon name="checkmark-circle" size={15} color={AD_FREE_GOLD} />
    <GameText size={10} font="cinemaBold" strokeWidth={0} numberOfLines={1} color="#ffe7a8" style={{ letterSpacing: 1.4 }}>AD-FREE ACTIVE</GameText>
  </View>;
}

/**
 * Pause and Settings: the full-width purchase button, the price on it in a gold tag. A tap opens Google Play's
 * purchase sheet; anything Google Play reports back (other than a cancel or a purchase) appears just below.
 */
export function AdFreeButton({ adFree }: { adFree: AdFree }) {
  const { width, onLayout } = useWidth();
  const [status, setStatus] = useState<PurchaseStatus>();
  const notice = status && purchaseNotice[status];
  const { price, busy } = adFree;
  // The title stays on one line beside the price: a long price (e.g. "IDR 29.000") shrinks its tag first, then the
  // title. `room` is the face less the icon, the gaps, the padding and the tag's own padding.
  const room = width - 99;
  const priceSize = width && price ? clamp(14, 19, (room - titleWidth(12.5)) / (price.length * .52)) : 19;
  const titleSize = width ? clamp(10.5, 14, ((room - (price ? priceWidth(price, priceSize) : 0) - 4) / TITLE.length - .8) / .66) : 13;
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label(price)} accessibilityState={{ disabled: busy }} disabled={busy}
      onPress={press(() => { setStatus(undefined); void adFree.buy().then(setStatus); })}
      style={({ pressed }) => [s.shadow, { borderRadius: 18, opacity: busy ? .7 : 1, transform: [{ scale: pressed ? .98 : 1 }] }]}>
      <LinearGradient colors={goldFrame} locations={[0, .3, .7, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 18, padding: 2 }}>
        <LinearGradient colors={royal} locations={[0, .45, 1]} style={s.button} onLayout={onLayout}>
          <LinearGradient colors={['#ffffff40', '#ffffff00']} style={s.gloss} pointerEvents="none" />
          <View style={s.facet} pointerEvents="none" />
          <NoAdsIcon size={34} />
          <View style={{ flex: 1 }}>
            <GameText size={titleSize} font="cinemaBold" strokeWidth={0} numberOfLines={1} align="left" color={AD_FREE_GOLD} style={[s.lift, { letterSpacing: .8 }]}>
              {TITLE}</GameText>
            <GameText size={11.5} font="semi" strokeWidth={0} numberOfLines={1} align="left" color="#e4eaf8" style={s.lift}>One-time purchase</GameText>
          </View>
          {price && <LinearGradient colors={priceGold} style={s.price}>
            <GameText size={priceSize} font="display" strokeWidth={0} numberOfLines={1} color="#2c1a02">{price}</GameText>
          </LinearGradient>}
          <Glint width={width} delay={500} />
        </LinearGradient>
      </LinearGradient>
    </Pressable>
    {notice && <View style={s.note}>
      <GameIcon name={status === 'pending' ? 'time' : 'alert-circle'} size={20} color={AD_FREE_GOLD} />
      <GameText size={13} font="semi" strokeWidth={0} align="left" containerStyle={{ flex: 1 }} color="#eef2fb">{notice}</GameText>
    </View>}
  </View>;
}

const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  shadow: { shadowColor: '#000', shadowOpacity: .45, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 7 },
  lift: { textShadowColor: '#000000aa', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 30, paddingHorizontal: 11, borderRadius: 15, borderWidth: 1,
    borderColor: '#ffd36a66', backgroundColor: '#05081ab0' },
  button: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingVertical: 8, paddingLeft: 12, paddingRight: 9, borderRadius: 16, overflow: 'hidden' },
  gloss: { position: 'absolute', top: 0, left: 0, right: 0, height: '48%', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  facet: { position: 'absolute', top: 3, left: 3, right: 3, bottom: 3, borderRadius: 13, borderWidth: 1, borderColor: '#ffffff26' },
  price: { minWidth: 64, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#fff6d8' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
});
