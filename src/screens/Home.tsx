import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { chapters } from '../game/chapters';
import { levels } from '../game/levels';
import { Logo } from '../ui/Art';
import { PopIn, Pulse } from '../ui/Effects';
import { GameText } from '../ui/GameText';
import { GameIcon, IconName, RoundButton, ShardPill, ToyButton, useUI } from '../ui/Toy';
import { AdFree, AdFreeBadge, AdFreeOrb } from '../ui/AdFree';
import { UNLOCK_ALL } from '../game/testing';

/** A small orb under the main buttons (Google Play Games); shown only when it can work on this device. */
export interface HomeExtra { icon: IconName; caption: string; label: string; onPress: () => void }

export function Home({ total, next, chapter, hearts, onPlay, onMap, onSettings, extras, adFree, onAdFree }: {
  total: number; next: number; chapter: number; hearts: number[]; onPlay: () => void; onMap: () => void; onSettings: () => void; extras: HomeExtra[];
  /** Remove Ads, in the top bar away from PLAY: the crossed-out ads icon right after the shards (a tap opens Google Play), and a quiet badge once owned. */
  adFree?: AdFree; onAdFree: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const safe = useSafeAreaInsets();
  const { ui } = useUI();
  const c = chapters[chapter]!;
  const finished = next > levels.length;
  const logoW = Math.min(width * .84, 360, height * .4);
  return <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
    <LinearGradient pointerEvents="none" colors={['#000000a8', '#00000000']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: height * .36 }} />
    <LinearGradient pointerEvents="none" colors={['#00000000', '#000000c0']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: height * .38 }} />
    <View style={[s.top, { paddingTop: safe.top + 8 }]} pointerEvents="box-none">
      <RoundButton icon="settings-sharp" label="Settings" size={46} onPress={onSettings} />
      <View style={s.middle} pointerEvents="box-none">
        {/* On a narrow phone the label wraps after "TEST BUILD ·" (the other spaces don't break). */}
        {UNLOCK_ALL && <View style={s.testBadge} pointerEvents="none" accessibilityLabel="Test build, every level is open">
          <GameIcon name="flask" size={13} color="#ffe08a" />
          <GameText size={10.5} font="bold" strokeWidth={0} containerStyle={{ flexShrink: 1 }} style={{ color: '#fff', letterSpacing: 1.2 }}>
            {'TEST\u00a0BUILD\u00a0· ALL\u00a0OPEN'}</GameText>
        </View>}
        {adFree?.owned && <PopIn from={.8}><AdFreeBadge /></PopIn>}
      </View>
      <View style={s.right} pointerEvents="box-none">
        <ShardPill total={total} />
        {adFree && !adFree.owned && <PopIn from={.8} delay={350}><AdFreeOrb price={adFree.price} busy={adFree.busy} onPress={onAdFree} /></PopIn>}
      </View>
    </View>
    <View style={{ alignItems: 'center', marginTop: height < 720 ? -6 : 4 }} pointerEvents="none">
      <PopIn from={.6}><Logo width={logoW} /></PopIn>
    </View>
    <View style={{ flex: 1 }} pointerEvents="none" />
    <View style={[s.bottom, { paddingBottom: safe.bottom + 18 }]} pointerEvents="box-none">
      <View style={s.hearts} pointerEvents="none">
        <GameText size={12} font="cinemaBold" strokeWidth={0} style={{ color: ui.accent, letterSpacing: 4 }}>{`${hearts.length} OF 5 HEARTS FORGED`}</GameText>
      </View>
      <GameText size={13} font="bold" strokeWidth={0} style={s.chapter}>
        {!finished ? `Chapter ${c.number} · ${c.title}` : hearts.length === 5 ? 'The Void is sealed. Every world shines.' : 'Every world restored. Gather every shard to forge the Hearts.'}
      </GameText>
      <Pulse scale={1.03} duration={900}>
        <ToyButton title={finished ? 'JOURNEY MAP' : 'PLAY'} icon={finished ? 'map' : 'play'} height={64} fontSize={finished ? 22 : 26} onPress={onPlay} style={{ width: Math.min(width * .72, 320) }}
          label={finished ? 'Open the journey map' : `Play, level ${next}`} sfx="whoosh" />
      </Pulse>
      {!finished && <ToyButton title="JOURNEY MAP" icon="map" tint="secondary" height={46} fontSize={16} onPress={onMap} style={{ width: Math.min(width * .56, 250), marginTop: 12 }}
        label="Journey map" sfx="whoosh" />}
      {extras.length > 0 && <View style={s.extras} pointerEvents="box-none">
        {extras.map(x => <RoundButton key={x.caption} icon={x.icon} label={x.label} caption={x.caption} size={44} onPress={x.onPress} />)}
      </View>}
    </View>
  </View>;
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14 },
  middle: { flexShrink: 1, alignItems: 'center', gap: 6, marginHorizontal: 8 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  testBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, flexShrink: 1,
    backgroundColor: '#5a3a08d8', borderWidth: 1, borderColor: '#ffd36a' },
  bottom: { alignItems: 'center', paddingHorizontal: 20 },
  hearts: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 12, backgroundColor: '#05081a99', marginBottom: 10 },
  extras: { flexDirection: 'row', gap: 34, marginTop: 14 },
  chapter: { color: '#f0f3fb', marginBottom: 14, textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
});
