import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, canRotate, initialState, key, replay, tappables, traceState } from './engine';
import { levels } from './levels';
import { ABYSS_SECONDS, absorptionOf, abyssPose, COLLAPSE, COLLAPSE_AT, DARKEN, GROW, HUSH_AT, IMPACT, PULL } from '../world/abyss';

test('The absorption runs five phases in order, each within its intended length, 3.5-5 s in all', () => {
  const within = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
  assert.ok(within(IMPACT, .3, .6), 'impact');
  assert.ok(within(GROW, .7, 1.2), 'growth');
  assert.ok(within(PULL, .8, 1.4), 'pull');
  assert.ok(within(DARKEN, .7, 1.2), 'darkness');
  assert.ok(within(COLLAPSE, .4, .7), 'collapse');
  assert.ok(within(ABYSS_SECONDS, 3.5, 5), `total ${ABYSS_SECONDS}`);
  assert.ok(HUSH_AT < ABYSS_SECONDS, 'a moment of near silence before the defeat screen');
});

test('The absorption pose: nothing at rest, gradual darkness and drain, a still camera before the defeat screen', () => {
  const rest = abyssPose(-1);
  assert.deepEqual([rest.dark, rest.pull, rest.drain, rest.shake, rest.wave, rest.hush, rest.done], [0, 0, 0, 0, 0, 1, false]);
  let last = abyssPose(0);
  for (let e = .05; e <= ABYSS_SECONDS + .5; e += .05) {
    const p = abyssPose(e);
    assert.ok(p.dark >= last.dark - 1e-9 && p.drain >= last.drain - 1e-9 && p.hush <= last.hush + 1e-9, `never brightens again (${e.toFixed(2)} s)`);
    assert.ok(p.dark <= 1 && p.pull <= 1, 'bounded');
    last = p;
  }
  const end = abyssPose(ABYSS_SECONDS);
  assert.ok(end.done && end.drain === 1 && end.dark > .85 && end.dark < 1, 'nearly black, with the hole still visible');
  assert.ok(end.shake < .002, 'the camera has settled before the defeat screen appears');
  assert.ok(abyssPose(COLLAPSE_AT + .1).shake > .02, 'it shakes at the collapse');
  // The world does not go black at once: darkness builds over the phases.
  assert.ok(abyssPose(IMPACT).dark < .05 && abyssPose(IMPACT + GROW).dark < .4 && abyssPose(COLLAPSE_AT).dark > .8);
});

test('A loss to the Devourer is recorded from the rules\' own trace: the beam, its cannon and its path', () => {
  let losses = 0;
  for (const l of levels.filter(x => x.devourers.length)) {
    const start = initialState(l);
    assert.equal(absorptionOf(traceState(l, start)), undefined, `level ${l.id}: the opening feeds nothing`);
    assert.equal(absorptionOf(traceState(l, replay(l, l.solutionMoves))), undefined, `level ${l.id}: the solution feeds nothing`);
    for (const id of tappables(l)) {
      if (!canRotate(l, start, id)) continue;
      const s = applyMove(l, start, id);
      const t = traceState(l, s);
      const record = absorptionOf(t);
      // Exactly when the rules say the light was swallowed, and never otherwise.
      assert.equal(!!record, !!s.absorbed, `level ${l.id} tap ${id}`);
      if (!record) continue;
      losses++;
      const d = l.devourers.find(x => x.id === record.devourer)!;
      assert.ok(d.zone.some(z => key(z) === key(record.point)), 'the light entered the zone itself');
      assert.ok(record.emitter < l.emitters.length && record.path[0] === record.emitter && record.path.at(-1) === record.branch, 'its path runs from a cannon');
      assert.ok(record.ends.every((v, i) => i === 0 || v > record.ends[i - 1]!) && record.reach >= record.at, 'its beam ends are ordered');
      assert.deepEqual(absorptionOf(traceState(l, s)), record, 'the same failure always gives the same record');
    }
  }
  assert.ok(losses > 0, 'the Void has opening moves that feed the Devourer');
});
