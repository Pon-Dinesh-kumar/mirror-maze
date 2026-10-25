import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { prologue } from '../game/chapters';
import { Logo } from '../ui/Art';
import { GameText } from '../ui/GameText';
import { Caption, captionSize, Letterbox, PopIn } from '../ui/Effects';
import { audio } from '../services/audio';

/**
 * Timed to the 3D prologue (the Prism shatters at 12.8s) and to the recorded narration,
 * so every line is fully spoken before the next begins. "The Prism shattered" waits for the blast to land.
 */
const beats = [.6, 4.6, 10.6, 13.3, 17.9];
const END = 24.2;

export function Prologue({ onDone }: { onDone: () => void }) {
  const { width } = useWindowDimensions();
  const safe = useSafeAreaInsets();
  const [line, setLine] = useState(-1);
  const [title, setTitle] = useState(false);
  const finished = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const finish = () => { if (!finished.current) { finished.current = true; audio.setDuck(1); doneRef.current(); } };
  useEffect(() => {
    audio.setDuck(.35);
    const timers = [
      ...beats.map((at, i) => setTimeout(() => setLine(i), at * 1000)),
      // Under the narrator's "Then the Void opened its eye", so a little below full level.
      setTimeout(() => audio.play('riser', .65), 10.6 * 1000),
      setTimeout(() => { audio.play('boom'); audio.haptic('heavy'); }, 12.8 * 1000),
      setTimeout(() => { setLine(-1); setTitle(true); audio.play('heart', .7); }, END * 1000),
      setTimeout(finish, (END + 3.2) * 1000),
    ];
    return () => { timers.forEach(clearTimeout); audio.setDuck(1); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
    <Letterbox show={!title} />
    <View style={s.caption} pointerEvents="none">
      {line >= 0 && <Caption key={line} text={prologue[line]!} size={captionSize(width)} hold={((beats[line + 1] ?? END) - beats[line]!) * 1000} />}
    </View>
    {title && <View style={s.title} pointerEvents="none"><PopIn from={.2}><Logo width={Math.min(width * .9, 420)} /></PopIn></View>}
    <Pressable accessibilityRole="button" accessibilityLabel="Skip story" onPress={() => { audio.play('pop'); finish(); }} style={[s.skip, { top: safe.top + 14 }]} hitSlop={10}>
      <GameText size={16} font="bold" strokeWidth={2} stroke="#000">SKIP ›</GameText>
    </Pressable>
  </View>;
}

const s = StyleSheet.create({
  caption: { position: 'absolute', left: 24, right: 24, bottom: '15%', alignItems: 'center' },
  title: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  // Absolutely positioned, so the SafeAreaView's padding does not move it; `top` comes from the inset, as in Story.tsx.
  // Without it the pill sat under the Android status bar, where taps never reach the app.
  skip: { position: 'absolute', right: 18, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, backgroundColor: '#00000066' },
});
