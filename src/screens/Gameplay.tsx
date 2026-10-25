import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { chapters, mechanicTips } from '../game/chapters';
import { starsFor } from '../game/engine';
import { introducedAt } from '../game/levels';
import { Level } from '../game/types';
import { fitTitle, Gem } from '../ui/Art';
import { Slam } from '../ui/Effects';
import { GameText } from '../ui/GameText';
import { GameIcon, IconName, RoundButton, useUI } from '../ui/Toy';
import { audio } from '../services/audio';

/** Fixed HUD heights (excluding safe areas). The camera frames the board between them, so it never shifts. */
export const HUD_TOP = 124;
export const HUD_BOTTOM = 78;
const nativeDriver = Platform.OS !== 'web';
const worldTags = ['SKY TEMPLES', 'RAINFOREST', 'DESERT', 'ICE AGE', 'THE VOID'];
const cheers = ['LIGHT RESTORED', 'BRILLIANT', 'RADIANT', 'FLAWLESS', 'DAZZLING'];
/** What the move budget is called in each world. */
const moveWords = ['SUNRAYS LEFT', 'SPIRIT LEFT', 'SUNLIGHT LEFT', 'WARMTH LEFT', 'STARLIGHT LEFT'];
/** When a level introduces several things at once, teach the newest, most surprising one. */
const tipPriority: Level['mechanics'] = ['mirror', 'devourer', 'seal', 'floe', 'stop', 'totem', 'jam', 'ride', 'totems', 'turn', 'triple', 'twin', 'portal',
  'splitter', 'multi', 'fixed', 'blocker', 'decoy'];

/** A short line above the board about what a chapter modifier is about to do. */
export interface HudStatus { icon: IconName; text: string; tone: 'danger' | 'warm' | 'calm' | 'gold' }
const tones: Record<HudStatus['tone'], { bg: string; border: string; icon: string }> = {
  danger: { bg: '#8a0f2ccc', border: '#ff6a8a', icon: '#ffd0d8' },
  warm: { bg: '#7a3408cc', border: '#ffb46a', icon: '#ffe0b0' },
  calm: { bg: '#0e4a24cc', border: '#7dff8a', icon: '#d8ffd8' },
  gold: { bg: '#5a4208cc', border: '#ffd36a', icon: '#fff0b8' },
};

function StatusChip({ status }: { status: HudStatus }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(v, { toValue: 1, friction: 6, tension: 140, useNativeDriver: nativeDriver }).start();
  }, [v]);
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (status.tone !== 'danger') { pulse.setValue(1); return; }
    const a = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: .6, duration: 420, useNativeDriver: nativeDriver }),
      Animated.timing(pulse, { toValue: 1, duration: 420, useNativeDriver: nativeDriver }),
    ]));
    a.start();
    return () => a.stop();
  }, [status.tone, pulse]);
  const t = tones[status.tone];
  return <Animated.View style={[s.status, { backgroundColor: t.bg, borderColor: t.border, opacity: Animated.multiply(v, pulse),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [.85, 1] }) }] }]}
    accessibilityLiveRegion="polite" accessibilityLabel={status.text.toLowerCase()}>
    <GameIcon name={status.icon} size={14} color={t.icon} />
    <GameText size={11.5} font="bold" strokeWidth={0} style={{ color: '#fff', letterSpacing: 1.1 }}>{status.text}</GameText>
  </Animated.View>;
}

function RatingShard({ lit, color, size }: { lit: boolean; color: string; size: number }) {
  const v = useRef(new Animated.Value(lit ? 1 : 0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const was = useRef(lit);
  useEffect(() => {
    if (was.current && !lit) {
      audio.play('tick');
      Animated.parallel([
        Animated.sequence([-1, 1, -1, 1, 0].map(x => Animated.timing(shake, { toValue: x, duration: 45, useNativeDriver: nativeDriver }))),
        Animated.timing(v, { toValue: 0, duration: 380, easing: Easing.in(Easing.quad), useNativeDriver: nativeDriver }),
      ]).start();
    } else if (lit) v.setValue(1);
    was.current = lit;
  }, [lit, v, shake]);
  return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <View style={StyleSheet.absoluteFill}><Gem size={size} color="gray" /></View>
    <Animated.View style={{ opacity: v, transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-4, 4] }) },
      { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1.5, 1] }) }] }}>
      <Gem size={size} color={color} />
    </Animated.View>
  </View>;
}

function TitleCard({ level }: { level: Level }) {
  const v = useRef(new Animated.Value(0)).current;
  const { width } = useWindowDimensions();
  const { ui } = useUI();
  useEffect(() => {
    Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
      Animated.delay(1700),
      Animated.timing(v, { toValue: 2, duration: 500, easing: Easing.in(Easing.cubic), useNativeDriver: nativeDriver }),
    ]).start();
  }, [v]);
  return <Animated.View pointerEvents="none" style={[s.card, {
    opacity: v.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1, 2], outputRange: [1.15, 1, .96] }) }],
  }]}>
    <LinearGradient colors={['#00000000', '#000000b0', '#000000b0', '#00000000']} locations={[0, .2, .8, 1]} style={StyleSheet.absoluteFill} />
    <GameText size={13} font="cinemaBold" strokeWidth={0} style={{ color: ui.accent, letterSpacing: 4 }}>
      {level.boss ? `${chapters[level.chapter]!.world.toUpperCase()} · FINAL TRIAL` : `LEVEL ${level.index}`}
    </GameText>
    <GameText size={fitTitle(level.title, width - 48, Math.min(34, width * .085))} font="cinema" strokeWidth={0} style={s.cardTitle}>{level.title}</GameText>
    <View style={[s.rule, { backgroundColor: ui.accent }]} />
    <GameText size={15} font="semi" strokeWidth={0} style={s.cardBeat}>{level.beat}</GameText>
  </Animated.View>;
}

/** Three crystals lighting up in turn. */
function LoadingGems({ color }: { color: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const l = Animated.loop(Animated.timing(v, { toValue: 3, duration: 1100, easing: Easing.linear, useNativeDriver: nativeDriver }));
    l.start();
    return () => l.stop();
  }, [v]);
  return <View style={s.veilGems}>{[0, 1, 2].map(i => <Animated.View key={i} style={{
    opacity: v.interpolate({ inputRange: [i, i + .5, i + 1], outputRange: [.3, 1, .3], extrapolate: 'clamp' }),
    transform: [{ scale: v.interpolate({ inputRange: [i, i + .5, i + 1], outputRange: [.85, 1.15, .85], extrapolate: 'clamp' }) }],
  }}><Gem size={i === 1 ? 26 : 21} color={color} /></Animated.View>)}</View>;
}

/**
 * Covers the 3D view while a new board warms up (compiling and uploading it can take a moment on a phone), so the
 * player never sees an empty frame; it fades away once the board has been drawn. It also swallows taps on the
 * still-hidden board. The HUD stays above it.
 */
function LevelVeil({ visible }: { visible: boolean }) {
  const { look } = useUI();
  const v = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [shown, setShown] = useState(visible);
  useEffect(() => {
    if (visible) { setShown(true); v.setValue(1); return; }
    const a = Animated.timing(v, { toValue: 0, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver });
    a.start(({ finished }) => { if (finished) setShown(false); });
    return () => a.stop();
  }, [visible, v]);
  if (!shown) return null;
  // The world's own sky, so the cover reads as the scene fading in rather than a dark screen.
  return <Animated.View pointerEvents={visible ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, { opacity: v }]}
    accessibilityLabel="Loading level">
    <LinearGradient colors={[look.sky.top, look.sky.horizon, look.fog.color]} locations={[0, .55, 1]} style={StyleSheet.absoluteFill} />
    <LoadingGems color={look.crystal} />
  </Animated.View>;
}

export function Gameplay({ level, moves, lit, litIds, won, loading, view, onView, celebrate, canUndo, onPause, onRestart, onUndo, onHint, onRotate,
  status = [], devoured = false }: {
  level: Level; moves: number; lit: number; litIds: string[]; won: boolean; loading: boolean; view: 'tilt' | 'top'; onView: () => void; celebrate: boolean; canUndo: boolean;
  onPause: () => void; onRestart: () => void; onUndo: () => void; onHint: () => void; onRotate: (id: string) => void;
  status?: HudStatus[]; devoured?: boolean;
}) {
  const { width } = useWindowDimensions();
  const safe = useSafeAreaInsets();
  const { ui, look } = useUI();
  const rating = starsFor(level, moves);
  const fresh = introducedAt[level.id] ?? [];
  const tipKey = tipPriority.find(m => fresh.includes(m));
  const tip = tipKey ? mechanicTips[tipKey] : undefined;
  const limit = level.maxMoves;
  const left = limit ? limit - moves : 0;
  const cheer = useMemo(() => cheers[level.id % cheers.length]!, [level.id]);
  const nextLoss = rating === 3 ? level.par : rating === 2 ? level.twoStar : undefined;
  const many = level.targets.length > 5;
  return <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
    <LevelVeil visible={loading} />
    <LinearGradient pointerEvents="none" colors={['#000000a0', '#00000000']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: safe.top + HUD_TOP + 30 }} />
    <LinearGradient pointerEvents="none" colors={['#00000000', '#00000090']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: safe.bottom + HUD_BOTTOM + 30 }} />
    <View style={[s.top, { paddingTop: safe.top + 6, height: safe.top + HUD_TOP }]} pointerEvents="box-none">
      <View style={s.row} pointerEvents="box-none">
        <RoundButton icon="pause" label="Pause game" size={46} onPress={onPause} />
        <View style={[s.plaque, { borderColor: `${ui.accent}88` }]} pointerEvents="none">
          <Gem size={18} color={chapters[level.chapter]!.heartColor} />
          <GameText size={15} font="cinemaBold" strokeWidth={0} style={s.plaqueText}>{`${worldTags[level.chapter]} · ${level.index}`}</GameText>
          {level.boss && <GameIcon name="flame" size={16} color={ui.accent} />}
        </View>
        <RoundButton icon="bulb" label="Hint" size={46} onPress={onHint} />
      </View>
      <View style={[s.bar, { borderColor: `${ui.accent}55` }]} pointerEvents="none">
        <View style={s.cell} accessibilityLabel={`${moves} ${moves === 1 ? 'move' : 'moves'}${limit ? ` of ${limit}` : ''}`}>
          <GameText size={10} font="bold" strokeWidth={0} style={s.label}>{moveWords[level.chapter]}</GameText>
          <GameText size={24} font="cinemaBold" strokeWidth={0} style={[s.value, limit !== undefined && left <= 2 ? { color: '#ff8a6a' } : null]}>
            {limit ? String(Math.max(0, left)) : String(moves)}
          </GameText>
        </View>
        <View style={[s.cell, s.mid]} accessibilityLabel={`${rating} shards possible, perfect is ${level.par} moves`}>
          <View style={s.shards}>{[1, 2, 3].map(i => <RatingShard key={i} lit={i <= rating} color={look.crystal} size={i === 2 ? 28 : 23} />)}</View>
          <GameText size={10} font="bold" strokeWidth={0} style={s.label}>{nextLoss !== undefined ? `PERFECT IN ${level.par}` : 'KEEP GOING'}</GameText>
        </View>
        <View style={s.cell} accessibilityLabel={`${lit} of ${level.targets.length} crystals lit`}>
          <GameText size={10} font="bold" strokeWidth={0} style={s.label}>CRYSTALS</GameText>
          {many ? <GameText size={22} font="cinemaBold" strokeWidth={0} style={s.value}>{`${lit}/${level.targets.length}`}</GameText>
            : <View style={s.gems}>{level.targets.map(t => <Gem key={t.id} size={16} color={litIds.includes(t.id) ? look.crystal : 'gray'} />)}</View>}
        </View>
        {limit !== undefined && <View style={s.meter}>
          <LinearGradient colors={left <= 2 ? ['#ff9a5a', '#e8283c'] : ['#fff2a0', ui.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={{ width: `${Math.max(0, left / limit) * 100}%`, height: '100%' }} />
        </View>}
      </View>
    </View>
    <TitleCard key={level.id} level={level} />
    <View style={[s.statusStack, { top: safe.top + HUD_TOP + 6 }]} pointerEvents="none">
      {devoured && <StatusChip key="devoured" status={{ icon: 'skull', text: 'THE DEVOURER SWALLOWED THE LIGHT', tone: 'danger' }} />}
      {status.map(st => <StatusChip key={`${st.icon}:${st.tone}`} status={st} />)}
    </View>
    {celebrate && <View style={s.cheer} pointerEvents="none"><Slam>
      <GameText size={Math.min(40, width * .1)} font="cinema" strokeWidth={0} style={s.cheerText}>{cheer}</GameText>
    </Slam></View>}
    <View style={[s.bottom, { paddingBottom: safe.bottom + 12, height: safe.bottom + HUD_BOTTOM }]} pointerEvents="box-none">
      <RoundButton icon="refresh" label="Restart level" size={50} onPress={onRestart} />
      <View style={s.tipSlot} pointerEvents="none">
        {tip && moves === 0 && !won && <View style={[s.tipBox, { borderColor: `${ui.accent}99` }]}>
          <GameIcon name="sparkles" size={16} color={ui.accent} />
          <GameText size={13} font="semi" strokeWidth={0} align="left" containerStyle={{ flex: 1 }} style={{ color: '#fff', lineHeight: 17 }}>{tip}</GameText>
        </View>}
      </View>
      <View style={{ marginRight: 10 }}>
        <RoundButton icon={view === 'tilt' ? 'scan' : 'cube'} label={view === 'tilt' ? 'Top-down view' : 'Tilted view'} size={42} onPress={onView} />
      </View>
      <View style={{ opacity: canUndo && !won ? 1 : .35 }} pointerEvents={canUndo && !won ? 'auto' : 'none'}>
        <RoundButton icon="arrow-undo" label="Undo move" size={50} onPress={onUndo} />
      </View>
    </View>
    <View style={s.a11y} pointerEvents="none">
      {level.mirrors.map((m, i) => <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`Rotate mirror ${i + 1}${m.fixed ? ', fixed' : ''}`}
        disabled={m.fixed || won} onPress={() => onRotate(m.id)} style={s.a11yButton} />)}
      {level.emitters.filter(e => e.rotatable).map((e, i) => <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={`Turn cannon ${i + 1}`}
        disabled={won} onPress={() => onRotate(e.id)} style={s.a11yButton} />)}
      {level.floes.map((f, i) => <Pressable key={f.id} accessibilityRole="button" accessibilityLabel={`Slide ice floe ${i + 1}`}
        disabled={won} onPress={() => onRotate(f.id)} style={s.a11yButton} />)}
      {level.clusters.map((c, i) => <Pressable key={c.totem.id} accessibilityRole="button"
        accessibilityLabel={`Wake totem ${i + 1}, turning its stones ${c.turn > 0 ? 'clockwise' : 'counter-clockwise'}`}
        disabled={won} onPress={() => onRotate(c.totem.id)} style={s.a11yButton} />)}
    </View>
  </View>;
}

const shadow = { textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 } as const;
const s = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, gap: 8, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 560, height: 50 },
  plaque: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, height: 36, borderRadius: 18, borderWidth: 1, backgroundColor: '#05081ab8' },
  plaqueText: { color: '#fff', letterSpacing: 1.5, ...shadow },
  bar: { flexDirection: 'row', width: '100%', maxWidth: 560, height: 58, borderRadius: 18, borderWidth: 1, backgroundColor: '#05081aa8', overflow: 'hidden' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  mid: { flex: 1.3, borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#ffffff1a' },
  label: { color: '#c8d0e8', letterSpacing: 1.5 },
  value: { color: '#fff', ...shadow },
  shards: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  gems: { flexDirection: 'row', gap: 3, marginTop: 3 },
  meter: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: '#ffffff18' },
  card: { position: 'absolute', top: '30%', left: 0, right: 0, alignItems: 'center', paddingVertical: 26, paddingHorizontal: 24 },
  cardTitle: { color: '#fff', marginTop: 6, ...shadow, textShadowRadius: 10 },
  rule: { width: 60, height: 2, marginVertical: 10, borderRadius: 1 },
  cardBeat: { color: '#e8ecf6', ...shadow },
  tipSlot: { flex: 1, paddingHorizontal: 10, justifyContent: 'flex-end' },
  tipBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, backgroundColor: '#05081ad8' },
  cheer: { position: 'absolute', top: '24%', left: 0, right: 0, alignItems: 'center' },
  cheerText: { color: '#fff', letterSpacing: 3, ...shadow, textShadowRadius: 14 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, maxWidth: 620, alignSelf: 'center' },
  statusStack: { position: 'absolute', left: 12, right: 12, alignItems: 'center', gap: 6 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, borderWidth: 1, maxWidth: '100%' },
  veilGems: { position: 'absolute', top: '66%', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 10 },
  a11y: { position: 'absolute', left: 0, bottom: 0, flexDirection: 'row', opacity: 0 },
  a11yButton: { width: 2, height: 2 },
});
