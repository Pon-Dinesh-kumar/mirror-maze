import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import { discard } from './audio';
import { voiceClips } from './voiceClips';

/**
 * Cinematic narration for cutscenes: pre-recorded voice clips (see scripts/generate-voice.ts), one per caption.
 * Each clip's real length drives how long its caption stays up, and its sentence cues when each sentence appears, so
 * text and voice stay in sync.
 */
let enabled = true;
/** Clips still sounding, with the moment each finishes speaking (its reverb tail rings on a little longer). */
let playing: { player: AudioPlayer; spokenUntil: number }[] = [];
const GAP_MS = 650;
/** The longest reverb tail recorded after the last word. */
const TAIL_MS = 1600;

function release(entry: (typeof playing)[number]) {
  playing = playing.filter(p => p !== entry);
  discard(entry.player);
}

export const voice = {
  configure(on: boolean) {
    enabled = on;
    if (!on) voice.stop();
  },
  /** True when this caption will be spoken aloud. */
  speaks(text: string) { return enabled && !!voiceClips[text]; },
  /** True while the narrator is mid-sentence (not counting a reverb tail), so loud ambient sounds can step back. */
  speaking() { return playing.some(p => p.spokenUntil > Date.now()); },
  say(text: string) {
    const clip = voiceClips[text];
    // A line still being spoken is cut; one that has finished keeps its reverb tail under the new line, so lines
    // follow each other without an audible chop.
    playing.filter(p => p.spokenUntil > Date.now()).forEach(release);
    if (!enabled || !clip) return;
    try {
      const entry = { player: createAudioPlayer(clip.source), spokenUntil: Date.now() + clip.ms };
      entry.player.volume = 1;
      entry.player.play();
      playing.push(entry);
      setTimeout(() => { if (playing.includes(entry)) release(entry); }, clip.ms + TAIL_MS);
    } catch (cause) { console.warn('Narration unavailable', cause); }
  },
  stop() { [...playing].forEach(release); },
  /** How long a caption should stay up: until the narrator has finished it, or `minMs` when silent. */
  pace(text: string, minMs: number) {
    const clip = voiceClips[text];
    return enabled && clip ? Math.max(minMs * .8, clip.ms + GAP_MS) : minMs;
  },
  /** When each sentence of a spoken caption begins (ms from the start of its clip); undefined when it is silent. */
  cues(text: string) {
    const clip = voiceClips[text];
    return enabled && clip ? clip.cues : undefined;
  },
};
