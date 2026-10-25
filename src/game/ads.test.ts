import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ads, AD_INTERVAL } from '../services/ads';

test('An ad is due after every third completed level', () => {
  assert.equal(AD_INTERVAL, 3);
  assert.deepEqual([0, 1, 2, 3, 4].map(ads.isDue), [false, false, false, true, true]);
});

test('Without a provider no ad is shown and flow continues', async () => {
  ads.setProvider(undefined);
  assert.equal(await ads.show(), false);
});

test('Audio pauses during an ad and resumes even if the ad fails', async () => {
  const calls: string[] = [];
  ads.setPauseHooks({ pause: () => calls.push('pause'), resume: () => calls.push('resume') });
  ads.setProvider({ ready: () => true, showInterstitial: async () => { calls.push('ad'); } });
  assert.equal(await ads.show(), true);
  ads.setProvider({ ready: () => true, showInterstitial: async () => { throw new Error('no fill'); } });
  assert.equal(await ads.show(), false);
  assert.deepEqual(calls, ['pause', 'ad', 'resume', 'pause', 'resume']);
  ads.setProvider(undefined);
  ads.setPauseHooks(undefined);
});

test('An ad that has not loaded is skipped without pausing the game', async () => {
  const calls: string[] = [];
  ads.setPauseHooks({ pause: () => calls.push('pause'), resume: () => calls.push('resume') });
  ads.setProvider({ ready: () => false, showInterstitial: async () => { calls.push('ad'); } });
  assert.equal(await ads.show(), false);
  assert.deepEqual(calls, []);
  ads.setProvider(undefined);
  ads.setPauseHooks(undefined);
});

test('A second tap while an ad is up waits for that ad instead of showing another', async () => {
  let shown = 0, close = () => {};
  ads.setProvider({ ready: () => true, showInterstitial: () => { shown++; return new Promise<void>(resolve => { close = resolve; }); } });
  const first = ads.show(), second = ads.show();
  close();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(shown, 1);
  ads.setProvider(undefined);
});
