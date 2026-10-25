import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { chapters } from '../game/chapters';
import { SHARDS_PER_WORLD } from '../game/progress';
import { Level } from '../game/types';
import { fitTitle, Gem, TitleArt } from '../ui/Art';
import { Confetti, PopIn, Pulse, SlideIn } from '../ui/Effects';
import { fonts } from '../ui/fonts';
import { GameText } from '../ui/GameText';
import { RoundButton, ToyButton, useUI } from '../ui/Toy';
import { audio, Sfx } from '../services/audio';

const nativeDriver = Platform.OS !== 'web';
const shadow = { textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 } as const;

function AwardShard({ index, earned, size, color }: { index: number; earned: boolean; size: number; color: string }) {
  const v = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const delay = 500 + index * 380;
    const t = earned ? setTimeout(() => { audio.play(`star${index + 1}` as Sfx, .8); audio.haptic(); }, delay + 260) : undefined;
    Animated.sequence([Animated.delay(delay), Animated.parallel([
      Animated.spring(v, { toValue: 1, friction: 5, tension: 140, useNativeDriver: nativeDriver }),
      Animated.timing(ring, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver }),
    ])]).start();
    return () => { if (t) clearTimeout(t); };
  }, [v, ring, index, earned]);
  return <View style={{ width: size * 1.2, height: size * 1.2, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ position: 'absolute', opacity: .5 }}><Gem size={size} color="gray" /></View>
    {earned && <Animated.View style={{ position: 'absolute', width: size * 1.2, height: size * 1.2, borderRadius: size, borderWidth: 3, borderColor: color,
      opacity: ring.interpolate({ inputRange: [0, .2, 1], outputRange: [0, 1, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [.6, 1.8] }) }] }} />}
    {earned && <Animated.View style={{ opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [2.4, 1] }) },
      { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-60, 0] }) }] }}><Gem size={size} color={color} /></Animated.View>}
  </View>;
}

function HeartProgress({ level, before, after }: { level: Level; before: number; after: number }) {
  const { ui } = useUI();
  const c = chapters[level.chapter]!;
  const v = useRef(new Animated.Value(before / SHARDS_PER_WORLD)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: after / SHARDS_PER_WORLD, duration: 900, delay: 1700, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [v, after]);
  return <View style={[s.heartCard, { borderColor: `${ui.accent}66` }]}>
    <Gem size={30} color={after === SHARDS_PER_WORLD ? c.heartColor : 'gray'} />
    <View style={{ flex: 1, gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <GameText size={12} font="cinemaBold" strokeWidth={0} style={{ color: '#fff', letterSpacing: 2 }}>{c.heart.toUpperCase()}</GameText>
        <GameText size={12} font="bold" strokeWidth={0} style={{ color: ui.accent }}>{`${after}/${SHARDS_PER_WORLD}`}</GameText>
      </View>
      <View style={s.track}>
        <Animated.View style={{ height: '100%', width: v.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }), borderRadius: 4, overflow: 'hidden' }}>
          <LinearGradient colors={['#ffffff', c.heartColor]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>
    </View>
  </View>;
}

export function Complete({ level, moves, stars, best, before, after, onNext, onReplay, onMap, onHome }: {
  level: Level; moves: number; stars: number; best: number; before: number; after: number;
  onNext: () => void; onReplay: () => void; onMap: () => void; onHome: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const safe = useSafeAreaInsets();
  const { ui, look } = useUI();
  const c = chapters[level.chapter]!;
  const boss = level.boss;
  const perfect = stars === 3;
  const headline = boss ? 'WORLD CLEARED' : perfect ? 'FLAWLESS' : 'LIGHT RESTORED';
  return <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
    <LinearGradient pointerEvents="none" colors={['#000000c8', '#00000060', '#00000000']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: height * .46 }} />
    <LinearGradient pointerEvents="none" colors={['#00000000', '#000000d0']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: height * .42 }} />
    {perfect && <Confetti count={30} colors={[look.crystal, ui.accent, '#ffffff', c.heartColor]} />}
    <View style={[s.top, { paddingTop: safe.top + 26 }]} pointerEvents="none">
      <GameText size={12} font="cinemaBold" strokeWidth={0} style={{ color: ui.accent, letterSpacing: 4 }}>{`${c.world.toUpperCase()} · LEVEL ${level.index}`}</GameText>
      <PopIn from={.6}><TitleArt lines={[headline]} width={Math.min(width * .9, 400)} size={fitTitle(headline, Math.min(width * .9, 400), 40)}
        fill={ui.title} stroke={ui.titleStroke} font={fonts.cinemaBold} /></PopIn>
      <View style={s.shards}>{[0, 1, 2].map(i => <AwardShard key={i} index={i} earned={i < stars} size={i === 1 ? 62 : 50} color={look.crystal} />)}</View>
      <SlideIn delay={1500}><GameText size={14} font="semi" strokeWidth={0} style={s.result}>
        {perfect ? `Perfect · ${moves} ${moves === 1 ? 'move' : 'moves'}` : `${moves} moves · perfect is ${level.par}. Replay for all 3 shards`}
      </GameText></SlideIn>
    </View>
    <View style={{ flex: 1 }} pointerEvents="none" />
    <View style={[s.bottom, { paddingBottom: safe.bottom + 16 }]} pointerEvents="box-none">
      <SlideIn delay={1600}><HeartProgress level={level} before={before} after={after} /></SlideIn>
      <GameText size={12} font="semi" strokeWidth={0} style={[s.best, { color: '#c8d0e8' }]}>{`Best: ${best} ${best === 1 ? 'move' : 'moves'}`}</GameText>
      <Pulse scale={1.03} duration={900}>
        <ToyButton title={boss ? 'CONTINUE' : 'NEXT LEVEL'} icon="play" height={60} fontSize={22} style={{ width: Math.min(width * .78, 330) }} onPress={onNext} sfx="whoosh" />
      </Pulse>
      <View style={s.row}>
        <RoundButton icon="home" label="Home" caption="Home" onPress={onHome} sfx="whoosh" />
        <RoundButton icon="refresh" label="Replay level" caption="Replay" onPress={onReplay} />
        <RoundButton icon="map" label="Journey map" caption="Map" onPress={onMap} sfx="whoosh" />
      </View>
    </View>
  </View>;
}

const failText = [
  { title: 'THE LIGHT FADES', line: 'The temple stays dark... for now.' },
  { title: 'THE STORM WINS', line: 'The rain swallows the light.' },
  { title: 'THE SUN HAS SET', line: 'Night falls over the pyramids.' },
  { title: 'THE ICE CLOSES IN', line: 'The frost locks the light away.' },
  { title: 'THE VOID GROWS', line: 'The Eye drinks the last of the light.' },
];

/** Lost to the Light Devourer: the light entered its zone. */
const devouredText = { title: 'SWALLOWED BY THE DARK', line: 'The Devourer drank your light.' };

export function Fail({ level, reason = 'moves', onRetry, onMap, onRewind }: {
  level: Level; reason?: 'moves' | 'devoured'; onRetry: () => void; onMap: () => void; onRewind?: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const safe = useSafeAreaInsets();
  const { ui } = useUI();
  const devoured = reason === 'devoured';
  const f = devoured ? devouredText : failText[level.chapter]!;
  // After the Devourer's absorption the scene has already said everything: the screen fades in quietly over the darkness.
  const fade = useRef(new Animated.Value(devoured ? 0 : 1)).current;
  useEffect(() => {
    if (!devoured) { audio.play('fail'); audio.haptic('error'); return; }
    const a = Animated.timing(fade, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver });
    a.start();
    return () => a.stop();
  }, [devoured, fade]);
  return <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="box-none">
    <LinearGradient pointerEvents="none" colors={['#000000d8', '#00000070', '#000000d8']} style={StyleSheet.absoluteFill} />
    <View style={[s.failBox, { paddingTop: safe.top + height * .16 }]} pointerEvents="box-none">
      <PopIn from={.5}><TitleArt lines={[f.title]} width={Math.min(width * .92, 420)} size={fitTitle(f.title, Math.min(width * .92, 420), 42)} fill={['#ffffff', '#ffc0b0', '#e04a3c']} stroke="#1a0404" font={fonts.cinemaBold} /></PopIn>
      <GameText size={16} font="semi" strokeWidth={0} style={[s.result, { marginTop: 4 }]}>{f.line}</GameText>
      <View style={[s.shards, { marginTop: 14, opacity: .8 }]} accessibilityLabel="No shards earned">
        {[1, 2, 3].map(i => <Gem key={i} size={i === 2 ? 40 : 32} color="gray" />)}
      </View>
      <View style={[s.failCard, { borderColor: devoured ? '#ff6a8a88' : `${ui.accent}55` }]}>
        <GameText size={14} font="semi" strokeWidth={0} style={{ color: '#e8ecf6' }}>{devoured
          ? 'Light that enters the red-edged zone is lost for good.'
          : `Out of moves. The crystals can be lit in just ${level.par}${level.par === 1 ? ' move' : ' moves'}.`}</GameText>
        <GameText size={13} font="semi" strokeWidth={0} style={{ color: ui.accent, marginTop: 6 }}>{devoured
          ? 'Hold a mirror or cannon to see where its light will go before you tap.'
          : 'Look before you tap, or use the bulb for a hint.'}</GameText>
      </View>
    </View>
    <View style={{ flex: 1 }} pointerEvents="none" />
    <View style={[s.bottom, { paddingBottom: safe.bottom + 22 }]} pointerEvents="box-none">
      {onRewind
        ? <ToyButton title="REWIND MOVE" icon="arrow-undo" height={60} fontSize={22} style={{ width: Math.min(width * .78, 330) }} onPress={onRewind} label="Rewind the last move" />
        : <ToyButton title="TRY AGAIN" icon="refresh" height={60} fontSize={22} style={{ width: Math.min(width * .78, 330) }} onPress={onRetry} label="Try again" />}
      <View style={s.row}>
        {onRewind && <RoundButton icon="refresh" label="Try again" caption="Retry" onPress={onRetry} />}
        <RoundButton icon="map" label="Journey map" caption="Map" onPress={onMap} sfx="whoosh" />
      </View>
    </View>
  </Animated.View>;
}

const s = StyleSheet.create({
  top: { alignItems: 'center', paddingHorizontal: 16 },
  shards: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 4 },
  result: { color: '#eef2fb', marginTop: 8, paddingHorizontal: 20, ...shadow },
  bottom: { alignItems: 'center', paddingHorizontal: 18, gap: 10 },
  heartCard: { flexDirection: 'row', alignItems: 'center', gap: 12, width: 320, maxWidth: '92%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, backgroundColor: '#05081ad0' },
  track: { height: 8, borderRadius: 4, backgroundColor: '#ffffff1f', overflow: 'hidden' },
  best: { marginBottom: 2 },
  row: { flexDirection: 'row', gap: 34, marginTop: 6 },
  failBox: { alignItems: 'center', paddingHorizontal: 18 },
  failCard: { marginTop: 18, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1, backgroundColor: '#05081ad0', maxWidth: 380 },
});
