import React from 'react';
import { StyleSheet, Text, TextStyle, View } from 'react-native';
import { fonts, GameTextProps } from './fonts';
export { fonts } from './fonts';
export type { GameTextProps } from './fonts';

const directions = (w: number) => {
  const steps = w > 2.5 ? 16 : 8;
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return { x: Math.round(Math.cos(a) * w * 10) / 10, y: Math.round(Math.sin(a) * w * 10) / 10 };
  });
};

// Native has no text stroke, so the outline is built from offset copies of the label.
export function GameText({ children, size = 20, color = '#fff', stroke = '#16306b', strokeWidth = 3, depth = 0,
  font = 'display', style, containerStyle, numberOfLines, align = 'center' }: GameTextProps) {
  // Android measures letter-spaced text a little narrower than it draws it, so the last letter wrapped onto a hidden
  // second line ("STOR" for STORY). Room for the spacing, split evenly so centred text stays centred.
  const spacing = StyleSheet.flatten(style)?.letterSpacing ?? 0;
  const base: TextStyle = { fontFamily: fonts[font], fontSize: size, lineHeight: size * 1.18, textAlign: align, includeFontPadding: false,
    paddingHorizontal: spacing > 0 ? spacing / 2 + 1 : 0 };
  const copy = (key: string, x: number, y: number) =>
    <Text key={key} numberOfLines={numberOfLines} accessible={false} importantForAccessibility="no-hide-descendants"
      style={[base, style, { color: stroke, position: 'absolute', left: x, right: -x, top: y }]}>{children}</Text>;
  const outline = strokeWidth > 0 ? directions(strokeWidth) : [];
  return <View style={containerStyle}>
    {depth > 0 && outline.map((o, i) => copy(`d${i}`, o.x, o.y + depth))}
    {outline.map((o, i) => copy(`o${i}`, o.x, o.y))}
    <Text numberOfLines={numberOfLines} style={[base, style, { color }]}>{children}</Text>
  </View>;
}
