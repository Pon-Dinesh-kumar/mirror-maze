import React from 'react';
import { StyleSheet, Text, TextStyle, View, useWindowDimensions } from 'react-native';
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

/**
 * How far the game's text follows the phone's font size setting. Up to "Large" (1.15) the layouts keep their shape; at
 * 1.3 the HUD's sunrays count was cut off, and at 2.0 labels overlapped the buttons and each other.
 */
const MAX_FONT_SCALE = 1.15;

// Native has no text stroke, so the outline is built from offset copies of the label.
export function GameText({ children, size = 20, color = '#fff', stroke = '#16306b', strokeWidth = 3, depth = 0,
  font = 'display', style, containerStyle, numberOfLines, align = 'center', fit }: GameTextProps) {
  const lines = { maxFontSizeMultiplier: MAX_FONT_SCALE, ...(fit ? { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: .6 } : { numberOfLines }) };
  // Android measures letter-spaced text a little narrower than it draws it, so the last letter wrapped onto a hidden
  // second line ("STOR" for STORY). Room for the spacing, split evenly so centred text stays centred.
  const spacing = StyleSheet.flatten(style)?.letterSpacing ?? 0;
  // Android scales letter spacing by the full font size setting, past the cap where the letters stop growing; above the
  // cap it is scaled back so the spacing stays in step with the letters.
  const { fontScale } = useWindowDimensions();
  const capped = spacing && fontScale > MAX_FONT_SCALE ? { letterSpacing: spacing * MAX_FONT_SCALE / fontScale } : undefined;
  const base: TextStyle = { fontFamily: fonts[font], fontSize: size, lineHeight: size * 1.18, textAlign: align, includeFontPadding: false,
    paddingHorizontal: spacing > 0 ? spacing / 2 + 1 : 0 };
  const copy = (key: string, x: number, y: number) =>
    <Text key={key} {...lines} accessible={false} importantForAccessibility="no-hide-descendants"
      style={[base, style, capped, { color: stroke, position: 'absolute', left: x, right: -x, top: y }]}>{children}</Text>;
  const outline = strokeWidth > 0 ? directions(strokeWidth) : [];
  return <View style={containerStyle}>
    {depth > 0 && outline.map((o, i) => copy(`d${i}`, o.x, o.y + depth))}
    {outline.map((o, i) => copy(`o${i}`, o.x, o.y))}
    <Text {...lines} style={[base, style, capped, { color }]}>{children}</Text>
  </View>;
}
