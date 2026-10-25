import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { chapters, LEVELS_PER_CHAPTER } from '../game/chapters';
import { levels } from '../game/levels';
import { mapLayout, MapScroll, MapSection, REVEAL_POP, REVEAL_TRAVEL } from '../game/mapLayout';
import { Progress, SHARDS_PER_WORLD, totalShards, unlockedLevel, worldShards } from '../game/progress';
import { Seen } from '../services/storage';
import { fitTitle, Gem, TitleArt } from '../ui/Art';
import { fonts } from '../ui/fonts';
import { GameText } from '../ui/GameText';
import { GameIcon, RoundButton, ShardPill, useUI } from '../ui/Toy';
import { looks } from '../world/look';
import { audio } from '../services/audio';
import { isOpen, UNLOCK_ALL } from '../game/testing';

export type StoryKind = 'prologue' | 'intro' | 'outro' | 'forge' | 'ending';
/** `open`: playable but not yet played, which only happens in a test build where every level is open. */
type MedalState = 'locked' | 'open' | 'current' | 'done' | 'perfect';
const nativeDriver = Platform.OS !== 'web';
/**
 * Frames the 3D layer reports before the labels appear. By the third, the first frame with the islands is on screen: on
 * native, each render waits for the previous frame's GL work to finish.
 */
const LABELS_AFTER_FRAMES = 3;
const LAST = levels.length;
/** The furthest level the map has shown this session, so a fresh unlock can be played out when the map reopens. */
let lastSeenNext: number | undefined;

/** Gentle bobbing; inactive loops render still so a long map does not run hundreds of animations. */
function Loop({ children, duration, from = 0, to = -8, style, active = true }: { children: React.ReactNode; duration: number; from?: number; to?: number; style?: object; active?: boolean }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) { v.setValue(0); return; }
    const l = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: nativeDriver }),
      Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: nativeDriver }),
    ]));
    l.start();
    return () => l.stop();
  }, [v, duration, active]);
  return <Animated.View style={[style, { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [from, to] }) }] }]}>{children}</Animated.View>;
}

/** Expanding rings that call attention to the level to play next. */
function Beacon({ color, size }: { color: string; size: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const l = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1700, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver }));
    l.start();
    return () => l.stop();
  }, [v]);
  return <>{[0, .5].map(o => {
    const p = Animated.modulo(Animated.add(v, o), 1);
    return <Animated.View key={o} pointerEvents="none" style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2.5, borderColor: color,
      opacity: p.interpolate({ inputRange: [0, 1], outputRange: [.85, 0] }), transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }] }} />;
  })}</>;
}

const bezel: Record<MedalState, readonly [string, string, string, string]> = {
  locked: ['#c4cde0', '#68748f', '#262e44', '#8995b2'],
  open: ['#f4f6ff', '#b8c4e0', '#4a5878', '#d8e0f4'],
  current: ['#fff8dc', '#f0c460', '#8a5a1e', '#f6dc96'],
  done: ['#fff4cc', '#e2b456', '#80541c', '#e8c878'],
  perfect: ['#ffffff', '#ffd86a', '#a8661a', '#fff0b0'],
};

/**
 * A level medallion: a cut-jewel face in a polished bezel, sitting on its island. Locked levels are dark steel with a
 * lock; the level to play glows gold and pulses; cleared levels take the world's crystal colour; perfect clears get a
 * brighter bezel and a star.
 */
const Medal = memo(function Medal({ id, state, shards, pressed, shake, popKey }: {
  id: number; state: MedalState; shards: number; pressed: boolean; shake: number; popKey: number;
}) {
  const lvl = levels[id - 1]!;
  const look = looks[lvl.chapter]!;
  const heart = chapters[lvl.chapter]!.heartColor;
  const final = id === LAST, boss = lvl.boss;
  const size = final ? 62 : boss ? 56 : 48;
  const press = useRef(new Animated.Value(1)).current;
  const wobble = useRef(new Animated.Value(0)).current;
  const popIn = useRef(new Animated.Value(1)).current;
  useEffect(() => { Animated.spring(press, { toValue: pressed ? .9 : 1, speed: 40, bounciness: pressed ? 0 : 10, useNativeDriver: nativeDriver }).start(); }, [pressed, press]);
  useEffect(() => {
    if (!shake) return;
    Animated.sequence([-1, 1, -1, 1, 0].map(x => Animated.timing(wobble, { toValue: x, duration: 45, useNativeDriver: nativeDriver }))).start();
  }, [shake, wobble]);
  useEffect(() => {
    if (!popKey) return;
    popIn.setValue(.4);
    Animated.spring(popIn, { toValue: 1, friction: 4, tension: 160, useNativeDriver: nativeDriver }).start();
  }, [popKey, popIn]);
  const face = state === 'locked' ? ['#323a5a', '#141830'] as const
    : state === 'open' ? ['#46557e', '#1e2648'] as const
    : state === 'current' ? ['#fff4c8', '#f2b434', '#a8640c'] as const
    : [`${look.crystal}`, `${look.crystalGlow}`, '#24123a'] as const;
  return <Animated.View style={{ alignItems: 'center', transform: [{ translateX: wobble.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] }) }, { scale: Animated.multiply(press, popIn) }] }}>
    <View style={[s.medalShadow, { width: size * 1.1, height: size * .36, borderRadius: size, top: size * .78 }]} />
    {state === 'current' && <Beacon color="#ffe9a8" size={size} />}
    {(state === 'perfect' || state === 'current') && <View style={[s.medalGlow, { width: size * 1.5, height: size * 1.5, borderRadius: size, top: -size * .25,
      backgroundColor: state === 'perfect' ? '#ffd86a2e' : '#ffe9a83a' }]} />}
    <Loop duration={650} to={-6} active={state === 'current'}>
      <LinearGradient colors={bezel[state]} locations={[0, .35, .7, 1]} start={{ x: .1, y: 0 }} end={{ x: .9, y: 1 }}
        style={{ width: size, height: size, borderRadius: size / 2, padding: state === 'perfect' ? 3.5 : 3 }}>
        <LinearGradient colors={face} start={{ x: .2, y: 0 }} end={{ x: .8, y: 1 }} style={[s.medalFace, { borderRadius: size / 2 }]}>
          <View style={[s.facet, { borderRadius: size / 2 }]} />
          <LinearGradient colors={['#ffffff8a', '#ffffff00']} style={[s.gloss, { borderRadius: size }]} />
          {state === 'locked' ? <GameIcon name="lock-closed" size={size * .38} color="#8f9abb" outline="#000000" />
            : final ? <GameIcon name="eye" size={size * .48} color="#fff" />
            : boss ? <Gem size={size * .52} color={heart} />
            : <GameText size={size * .4} font="cinemaBold" strokeWidth={0} style={state === 'current' ? s.numDark : s.num}>{String(lvl.index)}</GameText>}
        </LinearGradient>
      </LinearGradient>
      {state === 'perfect' && <View style={[s.starBadge, { left: size * .64, top: -size * .1 }]}><GameIcon name="star" size={size * .36} color="#ffd84a" outline="#5a3000" /></View>}
    </Loop>
    {state === 'current' && <View style={s.play}><GameText size={10} font="cinemaBold" strokeWidth={0} style={{ color: '#3a2200', letterSpacing: 1.6 }}>PLAY</GameText></View>}
    {(state === 'done' || state === 'perfect') && <View style={s.shards}>
      {[1, 2, 3].map(i => <Gem key={i} size={i === 2 ? 15 : 12} color={i <= shards ? look.crystal : 'gray'} />)}
    </View>}
    {(boss || final) && <View style={[s.bossTag, { borderColor: `${heart}cc` }]}>
      <GameText size={9.5} font="cinemaBold" strokeWidth={0} style={{ color: '#fff', letterSpacing: 2 }}>{final ? 'THE VOID EYE' : 'FINAL TRIAL'}</GameText>
    </View>}
  </Animated.View>;
});

// Hit areas route through a ref so memoised nodes never re-render when the parent's callbacks change.
const handlers: { press?: (id: number) => void; down?: (id: number | undefined) => void } = {};

/** Invisible, natively scrolled touch target covering one island. */
const Hit = memo(function Hit({ id, locked, x, y, width }: { id: number; locked: boolean; x: number; y: number; width: number }) {
  const lvl = levels[id - 1]!;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Map level ${id}${locked ? ', locked' : `, ${lvl.title}`}`}
    style={{ position: 'absolute', left: x - width / 2, top: y - width * .42, width, height: width * .95 }}
    onPressIn={() => handlers.down?.(id)} onPressOut={() => handlers.down?.(undefined)} onPress={() => handlers.press?.(id)} />;
});

function StoryChip({ icon, label, onPress }: { icon: React.ComponentProps<typeof GameIcon>['name']; label: string; onPress: () => void }) {
  const { ui } = useUI();
  return <Pressable accessibilityRole="button" accessibilityLabel={`Watch ${label}`} onPress={onPress} hitSlop={6}
    style={({ pressed }) => [s.chip, { borderColor: `${ui.accent}cc`, transform: [{ scale: pressed ? .94 : 1 }] }]}>
    <GameIcon name={icon} size={13} color={ui.accent} />
    <GameText size={11} font="cinemaBold" strokeWidth={0} style={{ color: '#fff', letterSpacing: 1.5 }}>{label}</GameText>
  </Pressable>;
}

/** Shard progress towards a world's Heart: a slim bar under the chapter's stats. */
function HeartBar({ value, color }: { value: number; color: string }) {
  return <View style={s.bar}><LinearGradient colors={['#ffffff', color]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
    style={{ width: `${Math.max(3, Math.min(100, value * 100))}%`, height: '100%', borderRadius: 3 }} /></View>;
}

function Gate({ section, progress, width, next, hearts, seen, safeTop, active, onWatch }: {
  section: MapSection; progress: Progress; width: number; next: number; hearts: number[]; seen: Seen; safeTop: number; active: boolean; onWatch: (k: StoryKind, c: number) => void;
}) {
  const c = chapters[section.chapter]!;
  const look = looks[section.chapter]!;
  const ui = look.ui;
  const first = section.chapter * LEVELS_PER_CHAPTER + 1;
  const locked = !isOpen(first, next);
  const shards = worldShards(progress, section.chapter);
  const cleared = clearedIn(progress, section.chapter);
  const forged = hearts.includes(section.chapter);
  const veil = section.chapter === 0 ? ['#00000000', '#00000000', '#00000060', '#00000000'] : ['#00000000', ui.panel[1].slice(0, 7), ui.panel[1].slice(0, 7), '#00000000'];
  const ch = section.chapter;
  return <View style={{ position: 'absolute', top: section.gateTop, left: 0, width, height: section.gateH }} pointerEvents="box-none">
    {/* The veil is fully opaque between 30% and 70% of the gate; the 3D world swaps in that band, unseen. */}
    <LinearGradient pointerEvents="none" colors={veil as [string, string, string, string]} locations={[0, .3, .7, 1]} style={StyleSheet.absoluteFill} />
    <View style={[s.gateCard, { top: ch === 0 ? safeTop + 92 : section.gateH * .5 - 200 }]} pointerEvents="box-none">
      <Loop duration={2200} to={-6} active={active}><Gem size={70} color={forged ? c.heartColor : locked ? 'gray' : look.crystal} /></Loop>
      <View style={[s.kicker, { borderColor: `${ui.accent}55` }]}><GameText size={11.5} font="cinemaBold" strokeWidth={0} style={{ color: ui.accent, letterSpacing: 4 }}>{`CHAPTER ${c.number} · ${c.world.toUpperCase()}`}</GameText></View>
      <TitleArt lines={[c.title.toUpperCase()]} width={Math.min(width - 40, 420)} size={fitTitle(c.title, Math.min(width - 40, 420), 36)} fill={ui.title} stroke={ui.titleStroke} font={fonts.cinemaBold} />
      <GameText size={14} font="semi" strokeWidth={0} style={s.story}>{c.intro[0]}</GameText>
      <View style={[s.gateStats, { borderColor: `${ui.accent}66` }]} pointerEvents="none">
        {locked ? <View style={s.statRow}><GameIcon name="lock-closed" size={15} color={ui.accent} /><GameText size={12} font="bold" strokeWidth={0} style={s.statText}>
          {`Clear ${chapters[ch - 1]?.title ?? ''} to enter`}</GameText></View>
          : <>
            <View style={s.statRow}>
              <GameIcon name="flag" size={13} color={ui.accent} /><GameText size={12} font="bold" strokeWidth={0} style={s.statText}>{`${cleared}/${LEVELS_PER_CHAPTER}`}</GameText>
              <View style={s.dot} />
              <Gem size={14} color={look.crystal} /><GameText size={12} font="bold" strokeWidth={0} style={s.statText}>{`${shards}/${SHARDS_PER_WORLD}`}</GameText>
              <View style={s.dot} />
              <GameText size={12} font="bold" strokeWidth={0} style={[s.statText, forged && { color: c.heartColor }]}>{forged ? `${c.heart} forged` : `Forge the ${c.heart}`}</GameText>
            </View>
            <HeartBar value={shards / SHARDS_PER_WORLD} color={forged ? c.heartColor : look.crystal} />
          </>}
      </View>
      <View style={s.chips} pointerEvents="box-none">
        {ch === 0 && seen.prologue && <StoryChip icon="book" label="PROLOGUE" onPress={() => onWatch('prologue', 0)} />}
        {!locked && <StoryChip icon="play" label="STORY" onPress={() => onWatch('intro', ch)} />}
        {seen.outros.includes(ch) && <StoryChip icon="sunny" label="FINALE" onPress={() => onWatch('outro', ch)} />}
        {seen.hearts.includes(ch) && <StoryChip icon="diamond" label="HEART" onPress={() => onWatch('forge', ch)} />}
      </View>
    </View>
  </View>;
}

/**
 * Night mist over the part of a world not yet reached. It starts just past the level to play next (all of the world when
 * it is still locked) and recedes with every unlock.
 */
function Fog({ section, edge, width, until }: { section: MapSection; edge: Animated.Value; width: number; until: number }) {
  const tint = looks[section.chapter]!.ui.panel[1].slice(0, 7);
  // Runs on into the next gate's opaque veil (or the map's end), so it never stops in a visible line.
  const bottom = until;
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, width, top: 0, height: bottom, overflow: 'hidden' }}>
    <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: bottom + 600, transform: [{ translateY: edge }] }}>
      <LinearGradient colors={['#00000000', `${tint}5c`, `${tint}a8`]} locations={[0, .45, 1]} style={{ height: 300 }} />
      <View style={{ flex: 1, backgroundColor: `${tint}a8` }} />
    </Animated.View>
  </Animated.View>;
}

/** Screen-space weather for the world in view: sunlit dust, rain, sand, snow or stars. */
function Weather({ chapter, width, height }: { chapter: number; width: number; height: number }) {
  const parts = useMemo(() => Array.from({ length: chapter === 1 ? 26 : 16 }, (_, i) => ({ x: ((i * 61) % 100) / 100, d: 1 + (i % 4) * .35, o: (i * 37) % 100 / 100 })), [chapter]);
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    const l = Animated.loop(Animated.timing(v, { toValue: 1, duration: chapter === 1 ? 1400 : chapter === 4 ? 6000 : 9000, easing: Easing.linear, useNativeDriver: nativeDriver }));
    l.start();
    return () => l.stop();
  }, [v, chapter]);
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {parts.map((p, i) => {
      const phase = Animated.modulo(Animated.add(v, p.o), 1);
      if (chapter === 1) return <Animated.View key={i} style={[s.rain, { left: p.x * width, transform: [{ translateY: phase.interpolate({ inputRange: [0, 1], outputRange: [-60, height + 60] }) }, { rotate: '12deg' }] }]} />;
      if (chapter === 3) return <Animated.View key={i} style={[s.snow, { left: p.x * width, width: 3 + p.d * 2, height: 3 + p.d * 2, transform: [
        { translateY: phase.interpolate({ inputRange: [0, 1], outputRange: [-20, height + 20] }) },
        { translateX: phase.interpolate({ inputRange: [0, .5, 1], outputRange: [0, 18 * p.d, 0] }) }] }]} />;
      if (chapter === 2) return <Animated.View key={i} style={[s.sand, { top: p.o * height, transform: [{ translateX: phase.interpolate({ inputRange: [0, 1], outputRange: [-40, width + 40] }) }] }]} />;
      if (chapter === 4) return <Animated.View key={i} style={[s.star, { left: p.x * width, top: p.o * height, opacity: phase.interpolate({ inputRange: [0, .5, 1], outputRange: [.15, 1, .15] }) }]} />;
      return <Animated.View key={i} style={[s.dust, { left: p.x * width, transform: [{ translateY: phase.interpolate({ inputRange: [0, 1], outputRange: [height + 10, -10] }) }],
        opacity: phase.interpolate({ inputRange: [0, .2, .8, 1], outputRange: [0, .9, .9, 0] }) }]} />;
    })}
  </View>;
}

const stateFor = (progress: Progress, next: number, id: number): MedalState =>
  id === next ? 'current' : progress[id] ? (progress[id]!.stars >= 3 ? 'perfect' : 'done') : isOpen(id, next) ? 'open' : 'locked';
/** Levels of a chapter with a result (in normal play, everything before the next level). */
const clearedIn = (progress: Progress, chapter: number) =>
  Array.from({ length: LEVELS_PER_CHAPTER }, (_, i) => chapter * LEVELS_PER_CHAPTER + i + 1).filter(id => progress[id]).length;

export function JourneyMap({ progress, focus, scroll, seen, hearts, onChapter, onPlay, onBack, onWatch }: {
  progress: Progress; focus: number; scroll: MapScroll; seen: Seen; hearts: number[]; onChapter: (c: number) => void; onPlay: (id: number) => void; onBack: () => void;
  onWatch: (kind: StoryKind, chapter: number) => void;
}) {
  // The app root's real size, which the 3D canvas also fills. The window size can leave out an edge-to-edge navigation
  // bar (48 pt on some Samsung phones), and every chapter gate, being a multiple of the height, then slid the labels
  // further off their islands.
  const { width, height } = useSafeAreaFrame();
  const safe = useSafeAreaInsets();
  const { ui } = useUI();
  const layout = useMemo(() => mapLayout(width, height), [width, height]);
  const ref = useRef<ScrollView>(null);
  const next = unlockedLevel(progress, LAST + 1);
  const current = useRef(-1);
  const chapterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [chapter, setChapter] = useState(0);
  const [band, setBand] = useState(0);
  const [pressed, setPressed] = useState<number>();
  const [shake, setShake] = useState<{ id: number; n: number }>();
  const total = totalShards(progress);
  // A fresh unlock since the map was last open plays out: crystals pop, then the light races to the new island.
  const reveal = useMemo(() => {
    const from = lastSeenNext;
    lastSeenNext = next;
    return from !== undefined && next > from && next - from <= 3 ? { from, to: next } : undefined;
    // Decided once, when the map opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [phase, setPhase] = useState(reveal ? 0 : 2);
  // The labels layer follows exactly what the 3D islands drew this frame.
  const startY = layout.focusY(Math.min(focus, LAST));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only the opening position
  const initialOffset = useMemo(() => ({ x: 0, y: startY }), []);
  const shown = useRef(new Animated.Value(-startY)).current;
  // The labels wait for the islands under them: a first map visit spends its opening frames compiling and uploading them.
  const labelsIn = useRef(new Animated.Value(0)).current;
  const [islandsShown, setIslandsShown] = useState(false);
  const fogEdge = useRef(new Animated.Value(0)).current;

  const focusY = useCallback((id: number) => layout.focusY(id), [layout]);
  const update = useCallback((y: number) => {
    scroll.y = y;
    const c = layout.chapterAt(y);
    const sec = layout.sections[c]!;
    scroll.progress = Math.min(1, Math.max(0, (y + height / 2 - sec.levelsTop) / sec.levelsH));
    if (c !== current.current) {
      const initial = current.current < 0;
      current.current = c;
      setChapter(c);
      if (chapterTimer.current) clearTimeout(chapterTimer.current);
      if (initial) onChapter(c);
      else chapterTimer.current = setTimeout(() => { chapterTimer.current = undefined; onChapter(c); }, 180);
    }
    const bandSize = Math.max(240, height * .6);
    setBand(b => (Math.floor(b / bandSize) !== Math.floor(y / bandSize) ? Math.floor(y / bandSize) * bandSize : b));
  }, [layout, height, scroll, onChapter]);

  useEffect(() => {
    // Hand the value to the native driver once, so every per-frame update goes straight to the UI thread.
    if (Platform.OS !== 'web') Animated.timing(shown, { toValue: -startY, duration: 0, useNativeDriver: true }).start();
    let frames = 0, done = false;
    const show = () => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      setIslandsShown(true);
      Animated.timing(labelsIn, { toValue: 1, duration: 160, useNativeDriver: nativeDriver }).start();
    };
    // Should the 3D world never draw, the labels still appear.
    const fallback = setTimeout(show, 3000);
    scroll.onShown = y => {
      shown.setValue(-y);
      if (++frames === LABELS_AFTER_FRAMES) show();
    };
    return () => { clearTimeout(fallback); scroll.onShown = undefined; };
  }, [scroll, shown, labelsIn]);
  useEffect(() => () => { if (chapterTimer.current) clearTimeout(chapterTimer.current); }, []);
  useEffect(() => {
    const y = focusY(Math.min(focus, LAST));
    update(y);
    setBand(y);
    const t = setTimeout(() => ref.current?.scrollTo({ y, animated: false }), 30);
    return () => clearTimeout(t);
    // Jump only when the requested focus changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, width, height]);

  // The unlock sequence, in step with the 3D layer (see MapLayer.animateReveal).
  const fogLevel = phase < 2 && reveal ? reveal.from : next;
  useEffect(() => {
    fogEdge.setValue(layout.node(Math.min(fogLevel, LAST)).y + 90);
    // Only on layout changes; the reveal animates it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);
  useEffect(() => {
    if (!reveal) return;
    // Held at the state from before the unlock until the islands are on screen.
    scroll.reveal = { ...reveal, at: Infinity };
    return () => { scroll.reveal = undefined; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!reveal || !islandsShown) return;
    const at = performance.now() + 650;
    scroll.reveal = { ...reveal, at };
    const timers = [
      setTimeout(() => { setPhase(1); audio.play('crystal', .6); audio.haptic(); }, 650 + REVEAL_POP * 300),
      setTimeout(() => {
        Animated.timing(fogEdge, { toValue: layout.node(Math.min(reveal.to, LAST)).y + 90, duration: REVEAL_TRAVEL * 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: nativeDriver }).start();
      }, 650 + REVEAL_POP * 1000),
      setTimeout(() => { setPhase(2); audio.play('charge', .45); audio.haptic('success'); }, 650 + (REVEAL_POP + REVEAL_TRAVEL) * 1000),
    ];
    return () => timers.forEach(clearTimeout);
    // Plays once per opening, as soon as the islands are on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [islandsShown]);

  handlers.press = id => {
    const locked = !isOpen(id, next);
    if (locked) { audio.play('bonk'); audio.haptic('error'); setShake(s => ({ id, n: (s?.n ?? 0) + 1 })); return; }
    audio.play('whoosh'); onPlay(id);
  };
  handlers.down = setPressed;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => update(e.nativeEvent.contentOffset.y);
  const nearView = (y: number) => y > band - height * .8 && y < band + height * 1.6;
  const stateShown = (id: number): MedalState => {
    if (reveal && phase < 2) {
      if (id === reveal.to) return 'locked';
      if (id >= reveal.from && id < reveal.to) return phase === 0 ? (id === reveal.from ? 'current' : 'locked') : stateFor(progress, next, id);
    }
    return stateFor(progress, next, id);
  };
  const first = chapter * LEVELS_PER_CHAPTER + 1;
  const reached = clearedIn(progress, chapter);
  const chapterShards = worldShards(progress, chapter);
  const fogUntil = (sc: MapSection) => { const n = layout.sections[sc.chapter + 1]; return n ? n.gateTop + n.gateH * .45 : layout.total; };
  const fogSection = layout.sections[Math.min(chapters.length - 1, Math.floor((Math.min(next, LAST) - 1) / LEVELS_PER_CHAPTER))]!;

  return <View style={StyleSheet.absoluteFill}>
    <Weather chapter={chapter} width={width} height={height} />
    {/* Labels, drawn at the 3D layer's offset. Touch goes to the scroll view underneath. */}
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height: layout.total, opacity: labelsIn, transform: [{ translateY: shown }] }}>
      {next <= LAST && !UNLOCK_ALL && <Fog section={fogSection} edge={fogEdge} width={width} until={fogUntil(fogSection)} />}
      {layout.sections.filter(sc => !isOpen(sc.chapter * LEVELS_PER_CHAPTER + 1, next)).map(sc => <View key={sc.chapter} pointerEvents="none"
        style={{ position: 'absolute', left: 0, width, top: sc.levelsTop - 60, height: fogUntil(sc) - sc.levelsTop + 60 }}>
        <LinearGradient colors={['#00000000', `${looks[sc.chapter]!.ui.panel[1].slice(0, 7)}a0`]} locations={[0, .12]} style={StyleSheet.absoluteFill} />
      </View>)}
      {levels.map(l => {
        const n = layout.node(l.id);
        if (!nearView(n.y)) return null;
        const w = layout.islandWidth(l.id);
        const st = stateShown(l.id);
        return <View key={l.id} pointerEvents="none" style={{ position: 'absolute', left: n.x - w / 2, top: n.y - (l.boss ? 28 : 24), width: w, alignItems: 'center' }}>
          <Medal id={l.id} state={st} shards={progress[l.id]?.stars ?? 0} pressed={pressed === l.id} shake={shake?.id === l.id ? shake.n : 0}
            popKey={reveal && ((phase === 1 && l.id >= reveal.from && l.id < reveal.to) || (phase === 2 && l.id === reveal.to)) ? phase : 0} />
        </View>;
      })}
    </Animated.View>
    {/* Opens at the focused level (the first chapter's story card flashed at the top while the jump below caught up). */}
    <ScrollView ref={ref} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{ height: layout.total }}
      contentOffset={initialOffset}
      decelerationRate={Platform.OS === 'ios' ? 'normal' : .985}>
      {layout.sections.map(sc => nearView(sc.gateTop + sc.gateH / 2) && <Gate key={sc.chapter} section={sc} progress={progress} width={width} next={next} hearts={hearts}
        seen={seen} safeTop={safe.top} active onWatch={onWatch} />)}
      {levels.map(l => { const n = layout.node(l.id); return nearView(n.y) && <Hit key={l.id} id={l.id} locked={!isOpen(l.id, next)} x={n.x} y={n.y} width={layout.islandWidth(l.id)} />; })}
      <View style={[s.footer, { top: layout.total - 290, width }]} pointerEvents="box-none">
        <View style={s.footerGems} pointerEvents="none">{chapters.map(c => <Gem key={c.id} size={34} color={hearts.includes(c.id) ? c.heartColor : 'gray'} />)}</View>
        <GameText size={14} font="cinemaBold" strokeWidth={0} style={{ color: '#fff', letterSpacing: 3, marginTop: 10 }}>{hearts.length === 5 ? 'THE PRISM IS WHOLE' : 'FORGE ALL FIVE HEARTS'}</GameText>
        <GameText size={13} font="semi" strokeWidth={0} style={{ color: '#dfe6f5', marginTop: 4 }}>{hearts.length === 5 ? 'Dawn has returned to every world' : 'to close the Void Eye forever'}</GameText>
        {seen.ending && <View style={{ marginTop: 12 }}><StoryChip icon="star" label="WATCH ENDING" onPress={() => onWatch('ending', 4)} /></View>}
      </View>
    </ScrollView>
    <LinearGradient pointerEvents="none" colors={['#000000c8', '#00000066', '#00000000']} locations={[0, .6, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: safe.top + 118 }} />
    <View style={[s.header, { paddingTop: safe.top + 8 }]} pointerEvents="box-none">
      <RoundButton icon="home" label="Home" size={46} onPress={onBack} sfx="whoosh" />
      <View style={s.headerMid} pointerEvents="none">
        <GameText size={19} font="cinemaBold" strokeWidth={0} style={s.headerTitle}>THE JOURNEY</GameText>
        <GameText size={10.5} font="cinemaBold" strokeWidth={0} style={{ color: ui.accent, letterSpacing: 2.6, marginTop: 1 }}>{chapters[chapter]!.world.toUpperCase()}</GameText>
        <View style={s.headerStats}>
          <GameText size={10} font="bold" strokeWidth={0} style={s.headerStat}>{`${reached}/${LEVELS_PER_CHAPTER}`}</GameText>
          <View style={s.dot} />
          <Gem size={11} color={looks[chapter]!.crystal} />
          <GameText size={10} font="bold" strokeWidth={0} style={s.headerStat}>{`${chapterShards}/${SHARDS_PER_WORLD}`}</GameText>
        </View>
      </View>
      <ShardPill total={total} />
    </View>
    <LinearGradient pointerEvents="none" colors={['#00000000', '#00000088']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: safe.bottom + 96 }} />
    <View style={[s.heartsTag, { bottom: safe.bottom + 24, borderColor: `${ui.accent}77` }]} pointerEvents="none">
      <Gem size={15} color={hearts.length ? chapters[hearts[hearts.length - 1]!]!.heartColor : 'gray'} />
      <GameText size={11} font="bold" strokeWidth={0} style={{ color: '#fff', letterSpacing: 1.5 }}>{`${hearts.length}/5 HEARTS`}</GameText>
    </View>
    <View style={[s.jump, { bottom: safe.bottom + 16 }]}>
      <RoundButton icon="locate" label="Jump to current level" size={52} onPress={() => ref.current?.scrollTo({ y: focusY(Math.min(next, LAST)), animated: true })} />
    </View>
  </View>;
}

const shadow = { textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 } as const;
const s = StyleSheet.create({
  medalShadow: { position: 'absolute', backgroundColor: '#00000059' },
  medalGlow: { position: 'absolute' },
  medalFace: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  facet: { position: 'absolute', top: 3, left: 3, right: 3, bottom: 3, borderWidth: 1, borderColor: '#ffffff38' },
  gloss: { position: 'absolute', top: 1, left: '14%', right: '14%', height: '44%' },
  starBadge: { position: 'absolute' },
  num: { color: '#fff', ...shadow },
  numDark: { color: '#4a2a00', textShadowColor: '#fff6d0', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 1 },
  play: { marginTop: -5, paddingHorizontal: 9, paddingVertical: 2, borderRadius: 8, backgroundColor: '#ffe08a', borderWidth: 1, borderColor: '#8a5a1e' },
  shards: { flexDirection: 'row', alignItems: 'flex-end', gap: 1, marginTop: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, backgroundColor: '#05081aa8' },
  bossTag: { marginTop: 3, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, borderWidth: 1, backgroundColor: '#05081ad8' },
  gateCard: { position: 'absolute', left: 18, right: 18, alignItems: 'center' },
  story: { color: '#eef2fb', marginTop: 4, paddingHorizontal: 12, ...shadow },
  kicker: { marginTop: 8, paddingHorizontal: 12, paddingVertical: 3, borderRadius: 10, borderWidth: 1, backgroundColor: '#05081ab8' },
  gateStats: { alignItems: 'center', gap: 7, marginTop: 14, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, borderWidth: 1, backgroundColor: '#05081ad0' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statText: { color: '#fff' },
  bar: { alignSelf: 'stretch', height: 5, borderRadius: 3, backgroundColor: '#ffffff1f', overflow: 'hidden' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#ffffff88' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 32, borderRadius: 16, borderWidth: 1.5, backgroundColor: '#05081ae0' },
  footer: { position: 'absolute', left: 0, alignItems: 'center' },
  footerGems: { flexDirection: 'row', gap: 10 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 14 },
  headerMid: { alignItems: 'center', paddingTop: 1 },
  headerTitle: { color: '#fff', letterSpacing: 3, ...shadow },
  headerStats: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, paddingHorizontal: 9, paddingVertical: 2, borderRadius: 9, backgroundColor: '#05081a99' },
  headerStat: { color: '#e8edf8', letterSpacing: 1 },
  jump: { position: 'absolute', right: 16 },
  heartsTag: { position: 'absolute', left: 16, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, height: 30, borderRadius: 15, borderWidth: 1, backgroundColor: '#05081ad8' },
  rain: { position: 'absolute', top: 0, width: 1.5, height: 26, backgroundColor: '#cfefffaa', borderRadius: 1 },
  snow: { position: 'absolute', top: 0, borderRadius: 10, backgroundColor: '#ffffffdd' },
  sand: { position: 'absolute', left: 0, width: 22, height: 2, borderRadius: 1, backgroundColor: '#ffe1a088' },
  star: { position: 'absolute', width: 3, height: 3, borderRadius: 2, backgroundColor: '#fff' },
  dust: { position: 'absolute', top: 0, width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff3c8' },
});
