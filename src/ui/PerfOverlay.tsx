import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { perf } from '../world/perf';

/**
 * Diagnostic builds only (PERF_HUD in src/world/perf.ts): live render stats, large enough to read in a compressed screen
 * recording from a phone. JS = scene traversal and GL command encoding per frame; GPU = time spent waiting for the GL
 * thread; MAX = longest gap between frames in the last second; CTX > 1 means the GL context was rebuilt.
 */
export function PerfOverlay() {
  const safe = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const win = useWindowDimensions();
  const sizes = useRef('');
  sizes.current = `WIN ${Math.round(win.width)}x${Math.round(win.height)}  APP ${Math.round(frame.width)}x${Math.round(frame.height)}`;
  const [text, setText] = useState('PERF …');
  const last = useRef({ t: performance.now(), frames: 0, js: 0, wait: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now(), l = last.current;
      const frames = perf.frames - l.frames;
      const per = (total: number, before: number) => (frames ? Math.round((total - before) / frames) : 0);
      setText(`FPS ${Math.round(frames / ((now - l.t) / 1000))}  JS ${per(perf.jsMs, l.js)}ms  GPU ${per(perf.waitMs, l.wait)}ms  MAX ${Math.round(perf.maxGapMs)}ms\n`
        + `DRAWS ${perf.draws}  CTX ${perf.contexts}  SHADERS ${perf.programs}  LOAD ${perf.loadMs < 0 ? '-' : Math.round(perf.loadMs)}ms\n`
        + `ENV ${perf.env.map((e, i) => `W${i + 1}:${e}`).filter((_, i) => perf.env[i]).join(' ') || '-'}\n`
        + `${sizes.current}  3D ${perf.canvas}`);
      perf.maxGapMs = 0;
      last.current = { t: now, frames: perf.frames, js: perf.jsMs, wait: perf.waitMs };
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return <View pointerEvents="none" style={[s.box, { bottom: safe.bottom + 92 }]}>
    <Text style={s.text}>{text}</Text>
  </View>;
}

const s = StyleSheet.create({
  box: { position: 'absolute', left: 8, right: 8, alignItems: 'center' },
  text: { color: '#fff', backgroundColor: '#000000cc', fontFamily: 'monospace', fontWeight: '700', fontSize: 14, lineHeight: 19,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, textAlign: 'center' },
});
