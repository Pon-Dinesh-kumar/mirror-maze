import React, { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GameText } from './GameText';
import { balance, phrases } from '../game/captions';
import { audio } from '../services/audio';
import { voice } from '../services/voice';

const nativeDriver = Platform.OS !== 'web';

/** Darkened top and bottom edges keep HUD text readable over any 3D scene. */
export function Vignette({ strength = .55, top = .22, bottom = .3 }: { strength?: number; top?: number; bottom?: number }) {
  const a = Math.round(strength * 255).toString(16).padStart(2, '0');
  return <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <LinearGradient colors={[`#000000${a}`, '#00000000']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: `${top * 100}%` }} />
    <LinearGradient colors={['#00000000', `#000000${a}`]} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${bottom * 100}%` }} />
  </View>;
}

/** Fraction of the screen height each cinematic bar covers. */
export const LETTERBOX = .11;

/** Cinematic bars, each with a soft shade spilling onto the picture so captions and titles read over any scene. */
export function Letterbox({ show }: { show: boolean }) {
  const { height } = useWindowDimensions();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(v, { toValue: show ? 1 : 0, duration: 600, easing: Easing.inOut(Easing.cubic), useNativeDriver: nativeDriver }).start(); }, [show, v]);
  const bar = height * LETTERBOX;
  return <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <Animated.View style={[s.edge, { top: 0, height: bar * 1.6, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-bar * 1.6, 0] }) }] }]}>
      <View style={[s.bar, { height: bar }]} />
      <LinearGradient colors={['#00000055', '#00000000']} style={{ flex: 1 }} />
    </Animated.View>
    <Animated.View style={[s.edge, { bottom: 0, height: bar * 2.4, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [bar * 2.4, 0] }) }] }]}>
      <LinearGradient colors={['#00000000', '#0000004d', '#00000073']} locations={[0, .7, 1]} style={{ flex: 1 }} />
      <View style={[s.bar, { height: bar }]} />
    </Animated.View>
  </View>;
}

/** Caption text size: one size in every cutscene, scaled down on narrow phones. */
export const captionSize = (width: number) => Math.min(25, width * .062);
const WORD_GAP = 7;
/** A sentence appears this long before the narrator starts it, as subtitles lead speech. */
const CAPTION_LEAD = 80;
/** How long a caption takes to fade away before the next one (or the end of the scene). */
const CAPTION_OUT = 320;

/**
 * Cutscene caption, read aloud by the narrator. Each sentence fades in, word after word in a quick cascade, as the
 * narrator begins it (from the recording's sentence cues), and the whole caption fades out shortly before `hold` ms
 * (when the next caption or the end of the scene is due). Silent captions reveal their sentences at a reading pace.
 * Lines are broken evenly, so a caption never ends on a lone word.
 */
export function Caption({ text, size = 24, hold, narrate = true }: { text: string; size?: number; hold?: number; narrate?: boolean }) {
  const parts = useMemo(() => phrases(text).map(p => p.split(' ')), [text]);
  const words = useMemo(() => parts.flat(), [parts]);
  const shown = useMemo(() => words.map(() => new Animated.Value(0)), [words]);
  const out = useRef(new Animated.Value(1)).current;
  const [box, setBox] = useState(0);
  const [widths, setWidths] = useState<number[]>([]);
  const measured = useRef<number[]>([]);
  useEffect(() => { if (narrate) voice.say(text); }, [text, narrate]);
  useEffect(() => {
    const cues = narrate ? voice.cues(text) : undefined;
    let at = 0;
    const starts = cues ?? parts.map(p => { const s = at; at += 450 + p.length * 240; return s; });
    const timers: ReturnType<typeof setTimeout>[] = [];
    let first = 0;
    parts.forEach((p, i) => {
      const from = first;
      first += p.length;
      timers.push(setTimeout(() => {
        // The typing tick stands in for the narrator only when the caption is silent.
        if (!cues) audio.play('type', .3);
        Animated.stagger(45, p.map((_, k) => Animated.timing(shown[from + k]!, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }))).start();
      }, Math.max(0, starts[i]! - CAPTION_LEAD)));
    });
    if (hold) timers.push(setTimeout(() => Animated.timing(out, { toValue: 0, duration: CAPTION_OUT - 40, easing: Easing.in(Easing.quad), useNativeDriver: nativeDriver }).start(),
      Math.max(0, hold - CAPTION_OUT)));
    return () => timers.forEach(clearTimeout);
  }, [text, narrate, parts, shown, out, hold]);
  const ends = useMemo(() => new Set(parts.map((_, i) => parts.slice(0, i + 1).reduce((n, p) => n + p.length, 0))), [parts]);
  const lines = useMemo(() => (box && widths.length === words.length ? balance(widths, box - 2, ends, WORD_GAP) : []), [box, widths, words.length, ends]);
  const word = (i: number) => <Animated.View key={i} style={{ opacity: shown[i], transform: [{ translateY: shown[i]!.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) }] }}>
    <Word word={words[i]!} size={size} />
  </Animated.View>;
  return <View accessible accessibilityLabel={text} accessibilityLiveRegion="polite" style={s.caption} onLayout={e => setBox(e.nativeEvent.layout.width)}>
    {/* Each word measured once, off screen, so the lines can be balanced. */}
    {!lines.length && <View style={s.measure} pointerEvents="none">{words.map((w, i) => <View key={i} style={{ flexShrink: 0 }} onLayout={e => {
      measured.current[i] = e.nativeEvent.layout.width;
      if (measured.current.filter(v => v > 0).length === words.length) setWidths([...measured.current]);
    }}><Word word={w} size={size} /></View>)}</View>}
    <Animated.View style={{ opacity: out, alignItems: 'center' }}>
      {lines.map((line, k) => <View key={k} style={s.line}>{line.map(word)}</View>)}
    </Animated.View>
  </View>;
}
/** One caption word. Memoised: on native each word is a stack of outline copies. */
const Word = React.memo(function Word({ word, size }: { word: string; size: number }) {
  return <GameText size={size} font="bold" color="#ffffff" stroke="#000000" strokeWidth={3} style={{ lineHeight: size * 1.32 }}>{word}</GameText>;
});
export function Slam({ children, delay = 0, onImpact }: { children: ReactNode; delay?: number; onImpact?: () => void }) {
  const v = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const impact = useRef(onImpact);
  impact.current = onImpact;
  useEffect(() => {
    const t = setTimeout(() => impact.current?.(), delay + 260);
    Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: 280, easing: Easing.in(Easing.cubic), useNativeDriver: nativeDriver }),
      Animated.sequence([10, -8, 6, -4, 2, 0].map(x => Animated.timing(shake, { toValue: x, duration: 45, useNativeDriver: nativeDriver }))),
    ]).start();
    return () => clearTimeout(t);
  }, [v, shake, delay]);
  return <Animated.View style={{ opacity: v.interpolate({ inputRange: [0, .3, 1], outputRange: [0, 1, 1] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [2.6, 1] }) }, { translateX: shake }, { translateY: Animated.multiply(shake, .5) }] }}>{children}</Animated.View>;
}

/** Fades its children out (or back in) rather than letting them vanish in one frame. */
export function Fade({ visible, children, duration = 380 }: { visible: boolean; children: ReactNode; duration?: number }) {
  const v = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => { Animated.timing(v, { toValue: visible ? 1 : 0, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: nativeDriver }).start(); }, [visible, v, duration]);
  return <Animated.View pointerEvents="none" style={{ opacity: v }}>{children}</Animated.View>;
}

export function Curtain({ visible, color = '#000000', duration = 450 }: { visible: boolean; color?: string; duration?: number }) {
  const v = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => { Animated.timing(v, { toValue: visible ? 1 : 0, duration, useNativeDriver: nativeDriver }).start(); }, [visible, v, duration]);
  return <Animated.View pointerEvents={visible ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity: v }]} />;
}

const confettiColors = ['#ff4fc3', '#ffd84a', '#3fb4ff', '#5fe04a', '#b166ff', '#ff7a12', '#ffffff'];
function Piece({ index, width, height, colors }: { index: number; width: number; height: number; colors: string[] }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.timing(t, { toValue: 1, duration: 2600 + (index % 7) * 300, delay: (index % 12) * 90, easing: Easing.in(Easing.quad), useNativeDriver: nativeDriver }));
    anim.start();
    return () => anim.stop();
  }, [t, index]);
  return <Animated.View pointerEvents="none" style={{
    position: 'absolute', left: ((index * 37) % 100) / 100 * width, top: -20, width: 8 + (index % 3) * 3, height: 14 - (index % 3) * 2, borderRadius: 2,
    backgroundColor: colors[index % colors.length],
    transform: [
      { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, height + 40] }) },
      { translateX: t.interpolate({ inputRange: [0, .3, .6, 1], outputRange: [0, 22, -18, 10].map(v => v * (index % 2 ? 1 : -1)) }) },
      { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${(index % 2 ? 1 : -1) * (360 + index * 20)}deg`] }) },
    ],
  }} />;
}
export function Confetti({ count = 40, colors = confettiColors }: { count?: number; colors?: string[] }) {
  const { width, height } = useWindowDimensions();
  return <View style={StyleSheet.absoluteFill} pointerEvents="none">
    {Array.from({ length: count }, (_, i) => <Piece key={i} index={i} width={width} height={height} colors={colors} />)}
  </View>;
}

export function PopIn({ children, delay = 0, from = .3 }: { children: ReactNode; delay?: number; from?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([Animated.delay(delay), Animated.spring(v, { toValue: 1, friction: 5, tension: 120, useNativeDriver: nativeDriver })]).start();
  }, [v, delay]);
  return <Animated.View style={{ opacity: v.interpolate({ inputRange: [0, .2, 1], outputRange: [0, 1, 1] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) }] }}>{children}</Animated.View>;
}

export function SlideIn({ children, delay = 0, from = 40, hideAfter }: { children: ReactNode; delay?: number; from?: number; hideAfter?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const steps = [Animated.delay(delay), Animated.timing(v, { toValue: 1, duration: 420, easing: Easing.out(Easing.back(1.4)), useNativeDriver: nativeDriver })];
    if (hideAfter) steps.push(Animated.delay(hideAfter), Animated.timing(v, { toValue: 0, duration: 380, easing: Easing.in(Easing.cubic), useNativeDriver: nativeDriver }));
    Animated.sequence(steps).start();
  }, [v, delay, hideAfter]);
  return <Animated.View pointerEvents="box-none" style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }] }}>{children}</Animated.View>;
}

function loopAnim(v: Animated.Value, duration: number) {
  return Animated.loop(Animated.sequence([
    Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: nativeDriver }),
    Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: nativeDriver }),
  ]));
}
export function Bob({ children, distance = 6, duration = 1200 }: { children: ReactNode; distance?: number; duration?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { const l = loopAnim(v, duration); l.start(); return () => l.stop(); }, [v, duration]);
  return <Animated.View style={{ transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -distance] }) }] }}>{children}</Animated.View>;
}
export function Pulse({ children, scale = 1.06, duration = 700 }: { children: ReactNode; scale?: number; duration?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { const l = loopAnim(v, duration); l.start(); return () => l.stop(); }, [v, duration]);
  return <Animated.View style={{ transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, scale] }) }] }}>{children}</Animated.View>;
}

const s = StyleSheet.create({
  edge: { position: 'absolute', left: 0, right: 0 },
  bar: { backgroundColor: '#000' },
  caption: { alignSelf: 'stretch', alignItems: 'center' },
  measure: { position: 'absolute', top: 0, left: 0, width: 10000, flexDirection: 'row', columnGap: WORD_GAP, opacity: 0 },
  line: { flexDirection: 'row', justifyContent: 'center', columnGap: WORD_GAP },
});
