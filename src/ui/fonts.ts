import type React from 'react';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

export const fonts = { display: 'Lilita', bold: 'FredokaBold', semi: 'FredokaSemi', cinema: 'Cinzel', cinemaBold: 'CinzelBold' };

export interface GameTextProps {
  children: React.ReactNode;
  size?: number;
  color?: string;
  stroke?: string;
  strokeWidth?: number;
  depth?: number;
  font?: keyof typeof fonts;
  style?: StyleProp<TextStyle>;
  containerStyle?: ViewStyle;
  numberOfLines?: number;
  align?: 'center' | 'left' | 'right';
  /** One line, shrunk only where its room is too narrow for it (a 320 dp phone); it never grows. Native only. */
  fit?: boolean;
}
