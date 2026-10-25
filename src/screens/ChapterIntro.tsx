import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chapters } from '../game/chapters';
import { fitTitle, TitleArt } from '../ui/Art';
import { Caption, captionSize, Fade, Letterbox, PopIn, Slam } from '../ui/Effects';
import { fonts } from '../ui/fonts';
import { GameText } from '../ui/GameText';
import { GameIcon, IconName, Panel, ToyButton, useUI } from '../ui/Toy';
import { audio } from '../services/audio';
import { voice } from '../services/voice';

/** Cinematic onboarding for a chapter, timed to the camera flythrough in the 3D world (10.5s). */
export function ChapterIntro({ chapter, onDone }: { chapter: number; onDone: () => void }) {
  const { width } = useWindowDimensions();
  const safe = useSafeAreaInsets();
  const { ui } = useUI();
  const c = chapters[chapter]!;
  const [stage, setStage] = useState(0);
  const [line, setLine] = useState(-1);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    audio.setDuck(.4);
    audio.play('riser', .8);
    // Each caption stays up long enough for the narrator to read it.
    let at = 3300;
    const starts = c.intro.map(text => { const s = at; at += voice.pace(text, 2500); return s; });
    const timers = [
      setTimeout(() => setStage(1), 1100),
      ...starts.map((s, i) => setTimeout(() => setLine(i), s)),
      setTimeout(() => { setStage(2); setLine(-1); audio.setDuck(1); }, at),
    ];
    return () => { timers.forEach(clearTimeout); audio.setDuck(1); };
  }, [c]);
  return <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
    <Letterbox show={stage < 2} />
    {stage >= 1 && <View style={s.title} pointerEvents="none"><Fade visible={stage < 2}>
      <Slam onImpact={() => { audio.play('boom'); audio.haptic('heavy'); }}>
        <GameText size={18} font="cinemaBold" color={ui.accent} strokeWidth={2} stroke="#000" style={{ letterSpacing: 6 }}>{`CHAPTER ${c.number}`}</GameText>
        <TitleArt lines={[c.title.toUpperCase()]} width={Math.min(width - 30, 460)} size={fitTitle(c.title, Math.min(width - 30, 460), 44)} fill={ui.title} stroke={ui.titleStroke} font={fonts.cinemaBold} />
        <GameText size={16} font="bold" strokeWidth={2} stroke="#000">{c.world}</GameText>
      </Slam>
    </Fade></View>}
    <View style={s.caption} pointerEvents="none">
      {line >= 0 && <Caption key={line} text={c.intro[line]!} size={captionSize(width)} hold={voice.pace(c.intro[line]!, 2500)} />}
    </View>
    {stage >= 2 && <View style={s.card} pointerEvents="box-none">
      <PopIn from={.7}><Panel style={{ width: Math.min(width - 32, 420) }}>
        <GameText size={14} font="cinemaBold" color={ui.accent} strokeWidth={0} style={{ letterSpacing: 4 }}>{chapter === 0 ? 'HOW TO PLAY' : 'NEW IN THIS WORLD'}</GameText>
        <View style={{ gap: 10, marginVertical: 14 }}>
          {c.newMechanics.map(m => <View key={m.text} style={s.mech}>
            <View style={[s.icon, { borderColor: ui.panelBorder }]}><GameIcon name={m.icon as IconName} size={24} outline={ui.tint} /></View>
            <GameText size={17} font="bold" strokeWidth={0} color="#ffffff" align="left" containerStyle={{ flex: 1 }}>{m.text}</GameText>
          </View>)}
        </View>
        <ToyButton title="BEGIN" icon="play" height={58} onPress={() => doneRef.current()} sfx="whoosh" label="Begin chapter" />
      </Panel></PopIn>
    </View>}
    {stage < 2 && <Pressable accessibilityRole="button" accessibilityLabel="Skip intro" onPress={() => { audio.play('pop'); voice.stop(); setStage(2); setLine(-1); }} style={[s.skip, { top: safe.top + 14 }]} hitSlop={10}>
      <GameText size={16} font="bold" strokeWidth={2} stroke="#000">SKIP ›</GameText>
    </Pressable>}
  </View>;
}

const s = StyleSheet.create({
  title: { position: 'absolute', top: '18%', left: 0, right: 0, alignItems: 'center' },
  caption: { position: 'absolute', left: 24, right: 24, bottom: '15%', alignItems: 'center' },
  card: { position: 'absolute', left: 0, right: 0, bottom: '8%', alignItems: 'center' },
  mech: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 46, height: 46, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff1a' },
  // Absolutely positioned, so the SafeAreaView's padding does not move it; `top` comes from the inset (see Prologue.tsx).
  skip: { position: 'absolute', right: 18, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, backgroundColor: '#00000066' },
});
