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
type Effect = keyof typeof sources;
export type Sfx = Effect | 'rotate';
/** Sky, Rainforest and Desert turns are mostly low knocks a phone speaker barely plays, so they sit a little higher. */
const volumes: Partial<Record<Effect, number>> = { pop: .45, whoosh: .3, zap: .22, type: .25, sizzle: .2, tick: .45, thunder1: .6, thunder2: .45, rotate0: .9, rotate1: .9, rotate2: .9, rotate3: .7, rotate4: .7, charge: .7, crystal: .55,
  awaken: .85, grind: .75, settle: .9, abyss: .95, swallow: .7 };

/**
 * Up to VOICES players per effect. Asked for again while it still rings (crystals lighting one after another, quick
 * taps), an effect starts on a free player; restarting the same one cut its last note off mid-ring.
 */
const VOICES = 3;
/** The same effect asked for again within this many ms (several crystals lit in one frame) plays once: identical copies in step only add up to one louder, clipping sound. */
const SAME_MOMENT_MS = 40;
/** How long a voice counts as ringing until its effect's real length is known. */
const RING_MS = 1500;
interface Voice { player: AudioPlayer; until: number }
const voices: Partial<Record<Effect, Voice[]>> = {};
/** Each effect's length in ms, reported by its first player once loaded. */
const lengths: Partial<Record<Effect, number>> = {};
const lastStart: Partial<Record<Effect, number>> = {};
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
/** A free player for `key`: an idle one, a new one (up to VOICES), or else the one closest to the end of its sound. */
function voiceFor(key: Effect, now: number) {
  const pool = (voices[key] ??= []);
  const idle = pool.find(v => v.until <= now);
  if (idle) return idle;
  if (pool.length < VOICES) {
    const player = createAudioPlayer(sources[key]);
    if (lengths[key] === undefined) {
      const sub = player.addListener('playbackStatusUpdate', s => {
        if (s.isLoaded && s.duration > 0) { lengths[key] = s.duration * 1000; sub.remove(); }
      });
    }
    const voice = { player, until: 0 };
    pool.push(voice);
    return voice;
  }
  return pool.reduce((a, b) => (a.until <= b.until ? a : b));
}
/**
 * Lets every effect go. Pausing is not enough when the game leaves the foreground: Android's expo-audio resumes every
 * player that was playing when the app left, so a half-heard effect (or the Devourer's whole sequence) came back on
 * return. New players are made on the next play.
 */
function releaseEffects() {
  for (const key of Object.keys(voices) as Effect[]) {
    voices[key]!.forEach(v => discard(v.player));
    delete voices[key];
  }
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
  configure(next: typeof options, isActive: boolean) {
    options = next; active = isActive;
    // Sound effects off, or the game sent away (another app, an ad): nothing keeps ringing, and nothing resumes later.
    if (!options.sound || !active) releaseEffects();
    sync();
  },
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
  stop(name: Effect) {
    for (const v of voices[name] ?? []) {
      v.until = 0;
      try { v.player.pause(); void v.player.seekTo(0).catch(() => undefined); } catch (cause) { fail(cause); }
    }
  },
  unlock() { if (!unlocked) { unlocked = true; sync(); } },
  play(name: Sfx, volume = 1) {
    if (name === 'pop' || name === 'rotate' || name === 'whoosh') audio.unlock();
    // A sequence's timer firing after the game was sent away stays silent too.
    if (!options.sound || !unlocked || !active) return;
    const key = (name === 'rotate' ? `rotate${chapter}` : name) as Effect;
    const now = Date.now();
    if (now - (lastStart[key] ?? -Infinity) < SAME_MOMENT_MS) return;
    lastStart[key] = now;
    try {
      const v = voiceFor(key, now);
      const p = v.player;
      v.until = now + (lengths[key] ?? RING_MS);
      p.volume = (volumes[key] ?? 1) * volume;
      // Effects let go while this one was starting (sound switched off, an ad or another app took the screen) leave it
      // silent; that is not a broken sound, so the player is not told some sounds are unavailable.
      const kept = () => voices[key]?.includes(v) ?? false;
      void p.seekTo(0).then(() => { if (kept()) p.play(); }).catch(cause => { if (kept()) fail(cause); });
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
    releaseEffects();
    discard(musicPlayer); discard(ambPlayer);
    musicPlayer = ambPlayer = undefined;
    loaded = -1;
  },
};
