import React, { createContext, ReactNode, useContext, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { GameText } from './GameText';
import { Gem } from './Art';
import { audio, Sfx } from '../services/audio';
import { looks } from '../world/look';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Base = 'green' | 'blue' | 'purple' | 'orange' | 'red' | 'gold' | 'sky' | 'stone' | 'slate' | 'lime' | 'teal' | 'sand' | 'ice' | 'magenta' | 'violet';
export type Tint = Base | 'primary' | 'secondary';
/** Jewel tones: [highlight, body, depth]. */
export const palette: Record<Base, { top: string; mid: string; bottom: string; rim: string; outline: string }> = {
  green: { top: '#8de07a', mid: '#2f9e4a', bottom: '#14572a', rim: '#0d3d1d', outline: '#06210f' },
  blue: { top: '#7ec4ff', mid: '#2a6fd0', bottom: '#123a82', rim: '#0c2a60', outline: '#061636' },
  purple: { top: '#c79bff', mid: '#7a3ad8', bottom: '#3c1680', rim: '#2a0e5c', outline: '#150632' },
  orange: { top: '#ffd08a', mid: '#e8781e', bottom: '#8a3a08', rim: '#5e2604', outline: '#2e1202' },
  red: { top: '#ff9a9a', mid: '#c8283c', bottom: '#6a0e1c', rim: '#480812', outline: '#24040a' },
  gold: { top: '#fff0b0', mid: '#e0a020', bottom: '#7a4a06', rim: '#583404', outline: '#2c1a02' },
  sky: { top: '#bfe8ff', mid: '#4f9ce0', bottom: '#1e4f8a', rim: '#123668', outline: '#081c38' },
  stone: { top: '#aab4c6', mid: '#5e6a82', bottom: '#2e3648', rim: '#20263a', outline: '#0e121e' },
  slate: { top: '#8aa0c8', mid: '#405a8a', bottom: '#1e2c4e', rim: '#141e3a', outline: '#080e1e' },
  lime: { top: '#c8ff8a', mid: '#4ec03a', bottom: '#1a6a22', rim: '#0e4a16', outline: '#06240a' },
  teal: { top: '#8afff0', mid: '#1fb0a0', bottom: '#0a5650', rim: '#063c38', outline: '#021e1c' },
  sand: { top: '#ffe8b8', mid: '#c8924a', bottom: '#6a4416', rim: '#4a2e0c', outline: '#241604' },
  ice: { top: '#e8faff', mid: '#4ab4ec', bottom: '#14527e', rim: '#0c3a5c', outline: '#041c30' },
  magenta: { top: '#ffb0ec', mid: '#d0309e', bottom: '#6a0a52', rim: '#4a063a', outline: '#24021c' },
  violet: { top: '#cdb4ff', mid: '#6a3ae0', bottom: '#2c1272', rim: '#1e0a52', outline: '#0e0428' },
};
export const goldFrame = ['#fff4cc', '#e6b85a', '#8a5a1e', '#e6b85a'] as const;
const nativeDriver = Platform.OS !== 'web';

export const ChapterUI = createContext(0);
export const useUI = () => {
  const chapter = useContext(ChapterUI);
  const look = looks[chapter]!;
  return { chapter, ui: look.ui, look };
};
export function usePalette(tint: Tint) {
  const { ui } = useUI();
  const base = (tint === 'primary' ? ui.primary : tint === 'secondary' ? ui.secondary : tint) as Base;
  return palette[base] ?? palette.blue;
}

function usePressBounce() {
  const scale = useRef(new Animated.Value(1)).current;
  return {
    scale,
    pressIn: () => Animated.spring(scale, { toValue: .95, useNativeDriver: nativeDriver, speed: 60, bounciness: 0 }).start(),
    pressOut: () => Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 16, bounciness: 8 }).start(),
  };
}

export function GameIcon({ name, size = 24, color = '#fff', outline = '#000000' }: { name: IconName; size?: number; color?: string; outline?: string }) {
  return <Ionicons name={name} size={size} color={color} selectable={false}
    style={{ textShadowColor: `${outline}aa`, textShadowOffset: { width: 0, height: 1.5 }, textShadowRadius: 3 }} />;
}

/** Primary call to action: a cut jewel set in a gold frame. */
export function ToyButton({ title, onPress, icon, tint = 'primary', height = 58, style, fontSize, disabled, sfx = 'pop', label }: {
  title?: string; onPress: () => void; icon?: IconName; tint?: Tint; height?: number; style?: ViewStyle;
  fontSize?: number; disabled?: boolean; sfx?: Sfx; label?: string;
}) {
  const themed = usePalette(tint);
  const p = disabled ? palette.stone : themed;
  const { scale, pressIn, pressOut } = usePressBounce();
  const radius = height * .3;
  return <View style={style}>
    <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} accessibilityState={{ disabled }} disabled={disabled}
      onPressIn={pressIn} onPressOut={pressOut} onPress={() => { audio.play(sfx); audio.haptic(); onPress(); }}>
      {({ pressed }) => <Animated.View style={[s.shadow, { borderRadius: radius + 2, transform: [{ scale }] }]}>
        <LinearGradient colors={goldFrame} locations={[0, .3, .7, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius + 2, padding: 2 }}>
          <LinearGradient colors={[p.top, p.mid, p.bottom]} locations={[0, .38, 1]} style={[s.face, { height, borderRadius: radius, paddingHorizontal: height * .4, opacity: pressed ? .88 : 1 }]}>
            <LinearGradient colors={['#ffffff55', '#ffffff00']} style={[s.gloss, { borderTopLeftRadius: radius, borderTopRightRadius: radius, height: height * .48 }]} />
            <View style={[s.facet, { borderRadius: radius - 2 }]} />
            {icon && <GameIcon name={icon} size={height * .4} />}
            {title && <GameText size={fontSize ?? height * .34} font="cinemaBold" strokeWidth={0} style={s.ctaText} fit>{title}</GameText>}
          </LinearGradient>
        </LinearGradient>
      </Animated.View>}
    </Pressable>
  </View>;
}

/** Secondary action: a dark glass orb rimmed with the world's accent colour. */
export function RoundButton({ icon, onPress, tint, size = 50, label, caption, sfx = 'pop', badge }: {
  icon: IconName; onPress: () => void; tint?: Tint; size?: number; label: string; caption?: string; sfx?: Sfx; badge?: ReactNode;
}) {
  const { ui } = useUI();
  const p = usePalette(tint ?? 'secondary');
  const { scale, pressIn, pressOut } = usePressBounce();
  const ring = tint ? p.top : ui.accent;
  return <View style={{ alignItems: 'center' }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
      onPressIn={pressIn} onPressOut={pressOut} onPress={() => { audio.play(sfx); audio.haptic(); onPress(); }}>
      <Animated.View style={[s.shadow, { width: size, height: size, borderRadius: size / 2, transform: [{ scale }] }]}>
        <LinearGradient colors={tint ? [p.mid, p.bottom] : ['#2a2f48dd', '#0a0d1cee']}
          style={[s.orb, { width: size, height: size, borderRadius: size / 2, borderColor: `${ring}cc` }]}>
          <LinearGradient colors={['#ffffff38', '#ffffff00']} style={{ position: 'absolute', top: 1, left: size * .14, right: size * .14, height: size * .42, borderRadius: size }} />
          <GameIcon name={icon} size={size * .46} color={tint ? '#ffffff' : ui.accent} />
        </LinearGradient>
        {badge}
      </Animated.View>
    </Pressable>
    {caption && <GameText size={12} font="semi" strokeWidth={0} style={s.caption}>{caption}</GameText>}
  </View>;
}

export function Pill({ children, label, style }: { children: ReactNode; label?: string; style?: ViewStyle }) {
  const { ui } = useUI();
  return <View style={[s.pill, { borderColor: `${ui.accent}77` }, style]} accessibilityLabel={label}>{children}</View>;
}

export function ShardPill({ total, max }: { total: number; max?: number }) {
  const { look } = useUI();
  return <Pill label={`${total} crystal shards`}>
    <Gem size={20} color={look.crystal} />
    <GameText size={17} font="bold" strokeWidth={0} style={s.pillText}>{max ? `${total}/${max}` : String(total)}</GameText>
  </Pill>;
}
export const StarPill = ShardPill;

export function Panel({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { ui } = useUI();
  return <View style={[s.shadow, { borderRadius: 24 }, style]}>
    <LinearGradient colors={goldFrame} locations={[0, .3, .7, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 24, padding: 1.5 }}>
      <LinearGradient colors={[`${ui.panel[0].slice(0, 7)}f2`, `${ui.panel[1].slice(0, 7)}f8`]} style={s.panel}>{children}</LinearGradient>
    </LinearGradient>
  </View>;
}

export function Header({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return <View style={s.header}>
    <RoundButton icon="chevron-back" label="Back" size={46} onPress={onBack} sfx="whoosh" />
    <GameText size={24} font="cinemaBold" strokeWidth={0} style={s.title} containerStyle={{ flex: 1 }} numberOfLines={1}>{title}</GameText>
    {right ?? <View style={{ width: 46 }} />}
  </View>;
}

export function Toggle({ value, onChange, label, icon }: { value: boolean; onChange: (v: boolean) => void; label: string; icon: IconName }) {
  const { ui } = useUI();
  return <View style={s.toggleRow}>
    <GameIcon name={icon} size={22} color={ui.accent} />
    <GameText size={18} font="semi" strokeWidth={0} containerStyle={{ flex: 1 }} align="left" style={s.pillText}>{label}</GameText>
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }}
      onPress={() => { audio.play('pop'); audio.haptic(); onChange(!value); }} hitSlop={10}>
      <View style={[s.track, { backgroundColor: value ? `${ui.accent}cc` : '#ffffff22', borderColor: value ? ui.accent : '#ffffff44' }]}>
        <View style={[s.knob, { alignSelf: value ? 'flex-end' : 'flex-start' }]} />
      </View>
    </Pressable>
  </View>;
}

const s = StyleSheet.create({
  shadow: { shadowColor: '#000', shadowOpacity: .45, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 8 },
  face: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, overflow: 'hidden' },
  gloss: { position: 'absolute', top: 0, left: 0, right: 0 },
  facet: { position: 'absolute', top: 3, left: 3, right: 3, bottom: 3, borderWidth: 1, borderColor: '#ffffff30' },
  ctaText: { color: '#fff', letterSpacing: 1.5, textShadowColor: '#00000088', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 },
  orb: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, overflow: 'hidden' },
  caption: { color: '#fff', marginTop: 5, textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 36, borderRadius: 18, borderWidth: 1, backgroundColor: '#05081ab0' },
  pillText: { color: '#fff', textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  panel: { borderRadius: 22.5, padding: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4 },
  title: { color: '#fff', letterSpacing: 1, textShadowColor: '#000', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 6 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  track: { width: 56, height: 32, borderRadius: 16, padding: 3, borderWidth: 1.5, justifyContent: 'center' },
  knob: { width: 23, height: 23, borderRadius: 12, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: .4, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
});
