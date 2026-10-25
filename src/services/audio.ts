import { Platform } from 'react-native';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';

const sources = {
  pop: require('../../assets/audio/pop.mp3'),
  whoosh: require('../../assets/audio/whoosh.mp3'),
  bonk: require('../../assets/audio/bonk.mp3'),
  type: require('../../assets/audio/type.mp3'),
  tick: require('../../assets/audio/tick.mp3'),
  rotate0: require('../../assets/audio/rotate0.mp3'),
  rotate1: require('../../assets/audio/rotate1.mp3'),
  rotate2: require('../../assets/audio/rotate2.mp3'),
  rotate3: require('../../assets/audio/rotate3.mp3'),
  rotate4: require('../../assets/audio/rotate4.mp3'),
  zap: require('../../assets/audio/zap.mp3'),
  sizzle: require('../../assets/audio/sizzle.mp3'),
  crystal: require('../../assets/audio/crystal.mp3'),
  split: require('../../assets/audio/split.mp3'),
  portal: require('../../assets/audio/portal.mp3'),
  turn: require('../../assets/audio/turn.mp3'),
  thunder1: require('../../assets/audio/thunder1.mp3'),
  thunder2: require('../../assets/audio/thunder2.mp3'),
  star1: require('../../assets/audio/star1.mp3'),
  star2: require('../../assets/audio/star2.mp3'),
  star3: require('../../assets/audio/star3.mp3'),
  win: require('../../assets/audio/win.mp3'),
  charge: require('../../assets/audio/charge.mp3'),
  fail: require('../../assets/audio/fail.mp3'),
  heart: require('../../assets/audio/heart.mp3'),
  riser: require('../../assets/audio/riser.mp3'),
  boom: require('../../assets/audio/boom.mp3'),
  glide: require('../../assets/audio/glide.mp3'),
  awaken: require('../../assets/audio/awaken.mp3'),
  grind: require('../../assets/audio/grind.mp3'),
  settle: require('../../assets/audio/settle.mp3'),
  seal: require('../../assets/audio/seal.mp3'),
  gate: require('../../assets/audio/gate.mp3'),
  abyss: require('../../assets/audio/abyss.mp3'),
  swallow: require('../../assets/audio/swallow.mp3'),
};
const music = [
  require('../../assets/audio/music0.mp3'), require('../../assets/audio/music1.mp3'), require('../../assets/audio/music2.mp3'),
  require('../../assets/audio/music3.mp3'), require('../../assets/audio/music4.mp3'),
];
/**
 * Per-world music level. The tracks are peak-normalised, so the Ice Age's sustained pads came out about 5 dB louder
 * than the other worlds (-14 vs -19 LUFS); this brings it in line.
 */
const MUSIC_TRIM = [1, 1, 1, .56, 1];
const ambience = [
  require('../../assets/audio/amb0.mp3'), require('../../assets/audio/amb1.mp3'), require('../../assets/audio/amb2.mp3'),
  require('../../assets/audio/amb3.mp3'), require('../../assets/audio/amb4.mp3'),
];
export type Sfx = keyof typeof sources | 'rotate';
const volumes: Partial<Record<keyof typeof sources, number>> = { pop: .45, whoosh: .3, zap: .22, type: .25, sizzle: .2, tick: .45, thunder1: .6, thunder2: .45, rotate0: .7, rotate1: .7, rotate2: .7, rotate3: .7, rotate4: .7, charge: .7, crystal: .55,
  awaken: .85, grind: .75, settle: .9, abyss: .95, swallow: .7 };

const players: Partial<Record<keyof typeof sources, AudioPlayer>> = {};
let musicPlayer: AudioPlayer | undefined;
let ambPlayer: AudioPlayer | undefined;
let loaded = -1;
let chapter = 0;
let options = { sound: true, music: true, haptics: true };
let active = true;
let duck = 1;
let duckTimer: ReturnType<typeof setInterval> | undefined;
/** The world's music and ambience together, faded while a black hole swallows the light (1 normal). */
let hush = 1;
let hushTimer: ReturnType<typeof setInterval> | undefined;
const AMBIENCE = (c: number) => (c === 1 ? .3 : .24);
let unlocked = Platform.OS !== 'web';
let failureListener: ((message: string) => void) | undefined;
let chapterTimer: ReturnType<typeof setTimeout> | undefined;

function fail(cause: unknown) {
  console.warn('Optional audio unavailable', cause);
  failureListener?.('Some sounds are unavailable on this device. The game still works.');
}
const musicLevel = () => .3 * MUSIC_TRIM[chapter]! * duck * hush;
/** Steps `value` from `from` to `to` over `ms` in 50 ms steps (at once when `ms` is 0); returns the running timer. */
function ramp(from: number, to: number, ms: number, apply: (v: number) => void) {
  if (ms <= 0) { apply(to); return undefined; }
  const steps = Math.max(1, Math.round(ms / 50));
  let k = 0;
  const timer = setInterval(() => {
    k++;
    apply(from + (to - from) * (k / steps));
    if (k >= steps) clearInterval(timer);
  }, 50);
  return timer;
}
function loop(source: number, volume: number) {
  const p = createAudioPlayer(source);
  p.loop = true;
  p.volume = volume;
  return p;
}
/**
 * Silences a player and frees it at once. On Android, expo-audio's remove() only forgets the player: it went on
 * playing until the garbage collector freed it, so after a change of world the old world's music and ambience kept
 * looping under the new one's (for over a minute on the journey map).
 */
export function discard(p: AudioPlayer | undefined) {
  if (!p) return;
  try { p.pause(); p.remove(); p.release(); } catch (cause) { console.warn('Could not release a sound', cause); }
}
function sync() {
  try {
    const on = active && unlocked;
    if (loaded !== chapter) {
      discard(musicPlayer); discard(ambPlayer);
      musicPlayer = ambPlayer = undefined;
      loaded = chapter;
    }
    if (on && options.music) {
      musicPlayer ??= loop(music[chapter], musicLevel());
      musicPlayer.volume = musicLevel();
      if (!musicPlayer.playing) musicPlayer.play();
    } else musicPlayer?.pause();
    if (on && options.sound) {
      ambPlayer ??= loop(ambience[chapter], AMBIENCE(chapter));
      ambPlayer.volume = AMBIENCE(chapter) * hush;
      if (!ambPlayer.playing) ambPlayer.play();
    } else ambPlayer?.pause();
  } catch (cause) { fail(cause); }
}

export const audio = {
  init() { void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).catch(() => undefined); },
  onFailure(listener: (message: string) => void) { failureListener = listener; },
  configure(next: typeof options, isActive: boolean) { options = next; active = isActive; sync(); },
  setChapter(next: number, afterScroll = false) {
    if (chapterTimer) clearTimeout(chapterTimer);
    chapterTimer = undefined;
    if (afterScroll) {
      chapterTimer = setTimeout(() => {
        chapterTimer = undefined;
        if (next !== chapter) { chapter = next; sync(); }
      }, 180);
    } else if (next !== chapter) { chapter = next; sync(); }
  },
  /** Lowers the music under cinematic stingers, gliding there over `ms` so a cutscene never starts or ends with a jump. */
  setDuck(level: number, ms = 700) {
    if (duckTimer) clearInterval(duckTimer);
    duckTimer = ramp(duck, level, ms, v => {
      duck = v;
      try { if (musicPlayer) musicPlayer.volume = musicLevel(); } catch (cause) { fail(cause); }
    });
  },
  /** Fades the world's music and ambience to `level` (0-1) at once, or over `ms` (cancelling any fade in progress). */
  setHush(level: number, ms = 0) {
    if (hushTimer) clearInterval(hushTimer);
    hushTimer = ramp(hush, level, ms, v => {
      hush = v;
      try {
        if (musicPlayer) musicPlayer.volume = musicLevel();
        if (ambPlayer) ambPlayer.volume = AMBIENCE(chapter) * hush;
      } catch (cause) { fail(cause); }
    });
  },
  /** Stops a sound effect at once (a sequence cut short by a restart or by leaving the level). */
  stop(name: keyof typeof sources) {
    const p = players[name];
    if (!p) return;
    try { p.pause(); void p.seekTo(0).catch(() => undefined); } catch (cause) { fail(cause); }
  },
  unlock() { if (!unlocked) { unlocked = true; sync(); } },
  play(name: Sfx, volume = 1) {
    if (name === 'pop' || name === 'rotate' || name === 'whoosh') audio.unlock();
    if (!options.sound || !unlocked) return;
    const key = (name === 'rotate' ? `rotate${chapter}` : name) as keyof typeof sources;
    try {
      const p = (players[key] ??= createAudioPlayer(sources[key]));
      p.volume = (volumes[key] ?? 1) * volume;
      void p.seekTo(0).then(() => p.play()).catch(fail);
    } catch (cause) { fail(cause); }
  },
  haptic(kind: 'tap' | 'success' | 'error' | 'heavy' = 'tap') {
    if (!options.haptics || Platform.OS === 'web') return;
    const run = kind === 'success' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : kind === 'error' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      : kind === 'heavy' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void run.catch(() => undefined);
  },
  dispose() {
    if (chapterTimer) clearTimeout(chapterTimer);
    chapterTimer = undefined;
    if (hushTimer) clearInterval(hushTimer);
    hushTimer = undefined;
    if (duckTimer) clearInterval(duckTimer);
    duckTimer = undefined;
    Object.values(players).forEach(discard);
    for (const key of Object.keys(players)) delete players[key as keyof typeof sources];
    discard(musicPlayer); discard(ambPlayer);
    musicPlayer = ambPlayer = undefined;
    loaded = -1;
  },
};
