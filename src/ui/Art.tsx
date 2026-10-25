import React, { useEffect, useId, useRef } from 'react';
import { Animated, Easing, Platform, View, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Polygon, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';
import { fonts } from './fonts';

const nativeDriver = Platform.OS !== 'web';
const useSvgId = () => useId().replace(/[^a-zA-Z0-9]/g, '');
// Gradient <Stop offset> strings need a leading zero ("0.45", not ".45"): on Android, react-native-svg rejects ".45",
// draws the stop at 0 and logs a warning on every render.

const starPoints = (cx: number, cy: number, outer: number, inner: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
  }).join(' ');

export function Star({ size = 24, filled = true, style }: { size?: number; filled?: boolean; style?: ViewStyle }) {
  const id = useSvgId();
  return <View style={style} accessible={false}>
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={filled ? '#fff7b0' : '#b9c9e6'} />
          <Stop offset="0.45" stopColor={filled ? '#ffd02a' : '#7f97c4'} />
          <Stop offset="1" stopColor={filled ? '#ff8d00' : '#4f6596'} />
        </LinearGradient>
      </Defs>
      <Polygon points={starPoints(50, 56, 46, 22)} fill={filled ? '#9a4a00' : '#26375f'} />
      <Polygon points={starPoints(50, 52, 46, 22)} fill={`url(#s${id})`} stroke={filled ? '#8a3f00' : '#22335a'}
        strokeWidth={6} strokeLinejoin="round" />
      <Ellipse cx="40" cy="38" rx="9" ry="5" fill="#fff" opacity={filled ? .75 : .35} transform="rotate(-30 40 38)" />
    </Svg>
  </View>;
}

export function Gem({ size = 24, color = 'pink', style }: { size?: number; color?: string; style?: ViewStyle }) {
  const id = useSvgId();
  const c = color === 'pink' ? ['#ffd2f2', '#ff4fc3', '#b0127e', '#6a0b4d'] : color === 'gray' ? ['#e3ebf5', '#9aaac2', '#5e6c86', '#2c3651'] : ['#ffffff', color, color, '#1a1030'];
  return <View style={style} accessible={false}>
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={c[0]} /><Stop offset="0.5" stopColor={c[1]} /><Stop offset="1" stopColor={c[2]} />
        </LinearGradient>
      </Defs>
      <Polygon points="50,4 82,34 66,94 34,94 18,34" fill={`url(#g${id})`} stroke={c[3]} strokeWidth={6} strokeLinejoin="round" />
      <Polygon points="50,4 62,34 50,94 38,34" fill="#fff" opacity={.35} />
      <Polygon points="18,34 82,34 50,40" fill="#fff" opacity={.45} />
    </Svg>
  </View>;
}

export function Sunburst({ size = 360, color = '#fff6c2', spin = true }: { size?: number; color?: string; spin?: boolean }) {
  const id = useSvgId();
  const rotation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spin) return;
    const loop = Animated.loop(Animated.timing(rotation, { toValue: 1, duration: 24000, easing: Easing.linear, useNativeDriver: nativeDriver }));
    loop.start();
    return () => loop.stop();
  }, [rotation, spin]);
  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View pointerEvents="none" style={{ width: size, height: size, transform: [{ rotate }] }}>
    <Svg width={size} height={size} viewBox="-100 -100 200 200">
      <Defs>
        <RadialGradient id={`r${id}`} cx="0" cy="0" r="100" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={color} stopOpacity=".95" />
          <Stop offset="0.55" stopColor={color} stopOpacity=".35" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <G fill={`url(#r${id})`}>
        {Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2, w = .11;
          return <Polygon key={i} points={`0,0 ${Math.cos(a - w) * 100},${Math.sin(a - w) * 100} ${Math.cos(a + w) * 100},${Math.sin(a + w) * 100}`} />;
        })}
      </G>
      <Circle r="34" fill={`url(#r${id})`} />
    </Svg>
  </Animated.View>;
}

export function Ribbon({ text, width = 260, colors = ['#b56cff', '#6a2fd6'], edge = '#3b1580', fontSize = 18 }:
  { text: string; width?: number; colors?: [string, string]; edge?: string; fontSize?: number }) {
  const id = useSvgId();
  return <Svg width={width} height={width * 0.2} viewBox="0 0 300 60">
    <Defs>
      <LinearGradient id={`b${id}`} x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={colors[0]} /><Stop offset="1" stopColor={colors[1]} />
      </LinearGradient>
    </Defs>
    <Path d="M6 18 L40 18 L40 52 L6 52 L20 35 Z" fill={edge} stroke="#1d0b45" strokeWidth={3} strokeLinejoin="round" />
    <Path d="M294 18 L260 18 L260 52 L294 52 L280 35 Z" fill={edge} stroke="#1d0b45" strokeWidth={3} strokeLinejoin="round" />
    <Path d="M30 8 Q150 -2 270 8 L270 46 Q150 36 30 46 Z" fill={`url(#b${id})`} stroke="#1d0b45" strokeWidth={4} strokeLinejoin="round" />
    <Path d="M38 12 Q150 3 262 12" stroke="#fff" strokeOpacity={.45} strokeWidth={3} fill="none" />
    <SvgText x="150" y={28 + fontSize * .36} textAnchor="middle" fontFamily={fonts.display} fontSize={fontSize} fill="#2a0c5c" stroke="#2a0c5c" strokeWidth={5} strokeLinejoin="round">{text}</SvgText>
    <SvgText x="150" y={28 + fontSize * .36} textAnchor="middle" fontFamily={fonts.display} fontSize={fontSize} fill="#fffbe8">{text}</SvgText>
  </Svg>;
}

function LayeredWord({ x, y, size, text, fill, stroke, depth, font = fonts.display, weight = .17, letterSpacing = 0 }:
  { x: number; y: number; size: number; text: string; fill: string; stroke: string; depth: number; font?: string; weight?: number; letterSpacing?: number }) {
  const common = { x, textAnchor: 'middle' as const, fontFamily: font, fontSize: size, letterSpacing };
  return <G>
    {[...Array(depth)].map((_, i) => <SvgText key={i} {...common} y={y + depth - i} fill={stroke} stroke={stroke} strokeWidth={size * weight} strokeLinejoin="round">{text}</SvgText>)}
    <SvgText {...common} y={y} fill={stroke} stroke={stroke} strokeWidth={size * weight} strokeLinejoin="round">{text}</SvgText>
    <SvgText {...common} y={y} fill={fill}>{text}</SvgText>
    <SvgText {...common} y={y} fill="none" stroke="#ffffff" strokeWidth={size * .012} opacity={.55}>{text}</SvgText>
  </G>;
}
export function TitleArt({ lines, width = 320, size = 64, fill = ['#fffbd0', '#ffd93a', '#ff8a00'], stroke = '#6b2500', label, font }:
  { lines: string[]; width?: number; size?: number; fill?: [string, string, string]; stroke?: string; label?: string; font?: string }) {
  const id = useSvgId();
  const lineH = size * 1.02;
  const h = lineH * lines.length + size * .3;
  return <View accessibilityRole="header" accessibilityLabel={label ?? lines.join(' ')}>
    <Svg width={width} height={width * h / 400} viewBox={`0 0 400 ${h}`}>
      <Defs>
        <LinearGradient id={`t${id}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={fill[0]} /><Stop offset="0.45" stopColor={fill[1]} /><Stop offset="1" stopColor={fill[2]} />
        </LinearGradient>
      </Defs>
      {lines.map((line, i) => <LayeredWord key={i} x={200} y={lineH * (i + 1) - size * .1} size={size} text={line}
        fill={`url(#t${id})`} stroke={stroke} depth={font ? Math.round(size / 18) : Math.round(size / 12)} font={font} weight={font ? .08 : .17} letterSpacing={font ? 2 : 0} />)}
    </Svg>
  </View>;
}

export function ThemeArt({ kind, width, height }: { kind: string; width: number; height: number }) {
  const id = useSvgId();
  const sky: Record<string, [string, string]> = {
    space: ['#1a0f4a', '#6a3fb0'], water: ['#0a5d7a', '#1fb5b0'], ice: ['#5fa8e8', '#dff3ff'], forest: ['#1f5a3a', '#7fc45a'],
  };
  const [a, b] = sky[kind] ?? ['#4fa6f2', '#ffd6a8'];
  return <Svg width={width} height={height} viewBox="0 0 200 100" preserveAspectRatio="xMidYMid slice">
    <Defs><LinearGradient id={`k${id}`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={a} /><Stop offset="1" stopColor={b} /></LinearGradient></Defs>
    <Path d="M0 0H200V100H0Z" fill={`url(#k${id})`} />
    {kind === 'space' && <G>
      {Array.from({ length: 26 }, (_, i) => <Circle key={i} cx={(i * 37) % 200} cy={(i * 23) % 100} r={i % 4 ? .8 : 1.6} fill="#fff" opacity={.9} />)}
      <Circle cx="150" cy="40" r="20" fill="#ff8ad8" /><Ellipse cx="150" cy="40" rx="34" ry="7" fill="none" stroke="#ffd6f5" strokeWidth="3" />
      <Path d="M30 70 h40 v10 h-40z M45 55 h10 v40 h-10z" fill="#c9d6ff" /><Circle cx="50" cy="75" r="6" fill="#7fe8ff" />
    </G>}
    {kind === 'water' && <G>
      {Array.from({ length: 12 }, (_, i) => <Circle key={i} cx={20 + (i * 47) % 170} cy={15 + (i * 29) % 70} r={2 + (i % 3) * 2} fill="none" stroke="#c9fbff" strokeWidth="1.5" opacity={.8} />)}
      <Path d="M20 100 Q25 70 18 50 M30 100 Q38 75 32 55 M170 100 Q160 72 172 48" stroke="#4fe08a" strokeWidth="5" fill="none" strokeLinecap="round" />
      <Path d="M90 100 q10 -26 20 0 q8 -18 16 0z" fill="#ff7aa8" />
    </G>}
    {kind === 'ice' && <G>
      <Polygon points="0,100 45,35 80,100" fill="#ffffff" /><Polygon points="50,100 110,20 170,100" fill="#eaf6ff" />
      <Polygon points="120,100 165,45 200,100" fill="#ffffff" /><Polygon points="110,20 98,40 110,36 122,40" fill="#bfe3ff" />
      {Array.from({ length: 10 }, (_, i) => <Circle key={i} cx={(i * 41) % 200} cy={(i * 17) % 60} r={1.6} fill="#fff" />)}
    </G>}
    {kind === 'forest' && <G>
      {[20, 55, 95, 140, 180].map((x, i) => <G key={i}><Path d={`M${x} 100 v-14`} stroke="#6b3f1f" strokeWidth="4" /><Polygon points={`${x - 18},${88 - i % 2 * 6} ${x},${40 + (i % 3) * 8} ${x + 18},${88 - i % 2 * 6}`} fill={i % 2 ? '#2f8f43' : '#3fae4f'} /></G>)}
      {Array.from({ length: 9 }, (_, i) => <Circle key={i} cx={(i * 43) % 200} cy={20 + (i * 19) % 50} r={2} fill="#fff59a" />)}
      <Path d="M108 100 q0 -10 -8 -10 h16 q-8 0 -8 10z" fill="#ff5a5a" />
    </G>}
  </Svg>;
}

const heartColors = ['#ff4fc3', '#3dff8a', '#ffb21e', '#6fe8ff', '#b46bff'];

/** Title wordmark: an engraved silver MIRROR over a gold MAZE, with the subtitle glowing beneath. */
export function Logo({ width = 330 }: { width?: number }) {
  const id = useSvgId();
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: nativeDriver }),
      Animated.timing(glow, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: nativeDriver }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [glow]);
  return <View accessible accessibilityRole="header" accessibilityLabel="Mirror Maze, The Last Lightkeeper">
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden aria-hidden>
      <Svg width={width} height={width * .45} viewBox="0 116 400 180">
        <Defs>
          <LinearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ffffff" /><Stop offset="0.45" stopColor="#dfe9f6" /><Stop offset="0.55" stopColor="#8fa3bf" /><Stop offset="1" stopColor="#e6eef8" />
          </LinearGradient>
          <LinearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#fff6cf" /><Stop offset="0.42" stopColor="#ffd56a" /><Stop offset="0.58" stopColor="#c98a22" /><Stop offset="1" stopColor="#ffe08a" />
          </LinearGradient>
        </Defs>
        <LayeredWord x={200} y={186} size={62} text="MIRROR" fill={`url(#s${id})`} stroke="#141a33" depth={4} font={fonts.cinema} weight={.09} letterSpacing={4} />
        <LayeredWord x={200} y={256} size={78} text="MAZE" fill={`url(#g${id})`} stroke="#2a1604" depth={5} font={fonts.cinema} weight={.09} letterSpacing={8} />
        <Path d="M78 280 H160 M240 280 H322" stroke="#ffd56a" strokeWidth={1.5} opacity={.8} />
        <Polygon points="200,273 206,280 200,287 194,280" fill="#ffd56a" />
      </Svg>
      <Animated.View style={{ alignItems: 'center', marginTop: -width * .015, opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [.82, 1] }) }}>
        <Svg width={width * .8} height={width * .07} viewBox="0 0 320 28">
          <SvgText x="160" y="20" textAnchor="middle" fontFamily={fonts.cinemaBold} fontSize="17" letterSpacing={5} fill="#000000" opacity={.6} stroke="#000" strokeWidth={4}>THE LAST LIGHTKEEPER</SvgText>
          <SvgText x="160" y="20" textAnchor="middle" fontFamily={fonts.cinemaBold} fontSize="17" letterSpacing={5} fill="#ffe8b0">THE LAST LIGHTKEEPER</SvgText>
        </Svg>
      </Animated.View>
    </View>
  </View>;
}
/** Largest Cinzel title size (capped at `max`) that keeps `text` on one line within `width`. */
export const fitTitle = (text: string, width: number, max: number) => Math.min(max, Math.floor(width / (text.length * .78)));
