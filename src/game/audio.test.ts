import { before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

/*
 * The sound service (src/services/audio.ts) against stand-in expo-audio players that behave like Android's: seekTo()
 * settles later, and a released player rejects every call ("Cannot use shared object that was already released").
 */

interface FakePlayer { source: unknown; released: boolean; plays: number; settle: (() => void)[]; volume: number; loop: boolean; playing: boolean }
const players: FakePlayer[] = [];
const released = () => Promise.reject(new Error('Cannot use shared object that was already released'));
/** When set, new players cannot load their sound at all (a missing codec, a damaged file). */
let broken = false;
function createAudioPlayer(source: unknown) {
  const p: FakePlayer = { source, released: false, plays: 0, settle: [], volume: 1, loop: false, playing: false };
  const unplayable = broken;
  players.push(p);
  return Object.assign(p, {
    seekTo: () => (p.released ? released() : unplayable ? Promise.reject(new Error('Source error')) : new Promise<void>(resolve => { p.settle.push(resolve); })),
    play: () => { if (p.released) throw new Error('Cannot use shared object that was already released'); p.plays++; p.playing = true; },
    pause: () => { p.playing = false; },
    remove: () => undefined,
    release: () => { p.released = true; },
    addListener: () => ({ remove() {} }),
  });
}
/** Lets every seek that is waiting finish, as Android does a moment later. */
const seeksFinish = async () => { for (const p of players) p.settle.splice(0).forEach(resolve => resolve()); for (let k = 0; k < 5; k++) await Promise.resolve(); };

// The sound files are bundled assets; here each is just a number, as Metro gives them.
(Module as unknown as { _extensions: Record<string, (m: { exports: unknown }) => void> })._extensions['.mp3'] = m => { m.exports = 1; };
mock.module('expo-audio', { namedExports: { createAudioPlayer, setAudioModeAsync: async () => undefined } });
mock.module('expo-haptics', { namedExports: {
  impactAsync: async () => undefined, notificationAsync: async () => undefined,
  ImpactFeedbackStyle: { Light: 'light', Heavy: 'heavy' }, NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
} });
mock.module('react-native', { namedExports: { Platform: { OS: 'android' } } });

let audio: typeof import('../services/audio').audio;
const notices: string[] = [];
before(async () => { ({ audio } = await import('../services/audio')); audio.onFailure(message => notices.push(message)); });
const on = { sound: true, music: true, haptics: true };
beforeEach(() => { notices.length = 0; audio.configure(on, true); });

test('A sound effect plays once its player is ready', async () => {
  audio.play('crystal');
  await seeksFinish();
  assert.ok(players.some(p => p.plays > 0 && !p.released));
  assert.deepEqual(notices, []);
});

test('A sound cut short because the game left the screen (an ad, another app) is not reported as a broken sound', async () => {
  audio.play('whoosh');
  // The interstitial opens before Android has finished preparing the tap's sound: every effect is let go.
  audio.configure(on, false);
  await seeksFinish();
  assert.deepEqual(notices, [], 'the player was told some sounds are unavailable on this device');
  audio.configure(on, true);
  audio.play('whoosh');
  await seeksFinish();
  assert.deepEqual(notices, []);
  assert.ok(players.some(p => p.plays > 0 && !p.released), 'after returning, effects play again');
});

test('A sound that really cannot play is still reported, once the player is told', async () => {
  broken = true;
  audio.play('seal');
  await seeksFinish();
  broken = false;
  assert.deepEqual(notices, ['Some sounds are unavailable on this device. The game still works.']);
});

test('Sound effects switched off while one is starting stay silent and report nothing', async () => {
  audio.play('zap');
  audio.configure({ ...on, sound: false }, true);
  await seeksFinish();
  assert.deepEqual(notices, []);
  assert.equal(players.filter(p => !p.released && p.plays > 0 && p.playing && p.loop === false).length, 0);
});
