import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyMove, boardOf, canRotate, clipToCrystals, footprint, glide, greedyPlay, initialState, key, losingSequence, placeOf, replay, solve, solveSliced,
  starsFor, sweepOf, tappables, traceBeam, traceState, turnBlocks, turnPoint, validateLevel, winningSequences } from './engine';
import { levels } from './levels';
import { chapters, LEVELS_PER_CHAPTER, mechanicTips } from './chapters';
import { heartsEarned, recordResult, SHARDS_PER_WORLD, totalStars, unlockedLevel, worldCleared, worldShards } from './progress';
import { Cluster, Level, PlayState, Point } from './types';

const base = (over: Partial<Level>): Level => ({
  id: 1, chapter: 0, index: 1, title: 't', beat: 'b', size: 5, emitters: [{ id: 'e1', position: [0, 2], direction: 'E' }], solutionAims: {}, solutionPlaces: {},
  solutionTurns: {}, maxMoves: 9, mirrors: [], targets: [], blockers: [], portals: [], splitters: [], clusters: [], floes: [], seals: [], gates: [], devourers: [],
  solution: {}, solutionMoves: [], par: 1, twoStar: 3, boss: false, mechanics: [], ...over,
});
const cluster = (over: Partial<Cluster>): Cluster => ({ id: 'r1', totem: { id: 't1', position: [4, 4] }, cells: [], pivot: [0, 0], turn: 1, ...over });
const cellsOf = (ps: Point[]) => ps.map(key).sort();

test('90 levels, 18 per chapter, each with a title and story beat', () => {
  assert.equal(LEVELS_PER_CHAPTER, 18);
  assert.equal(levels.length, 90);
  for (const c of chapters) assert.equal(c.levels.length, 18);
  for (const l of levels) assert.ok(l.title && l.beat);
  assert.equal(SHARDS_PER_WORLD, 54);
  assert.deepEqual(levels.filter(l => l.boss).map(l => l.index), [18, 18, 18, 18, 18]);
});

for (const level of levels) {
  test(`Level ${level.id} (${chapters[level.chapter]!.world} ${level.index}) is valid, its stored solution wins and par is optimal`, () => {
    assert.deepEqual(validateLevel(level), []);
  });
}

test('Each chapter teaches its own modifier, and no modifier appears before its chapter', () => {
  const has = (c: number, m: string) => levels.some(l => l.chapter === c && l.mechanics.includes(m as never));
  const first = (m: string) => levels.find(l => l.mechanics.includes(m as never))?.chapter;
  assert.ok(has(0, 'turn') && has(0, 'twin') && has(0, 'triple'), 'Sky Temples: hand-turned, twin and triple cannons');
  assert.ok(has(1, 'totem') && has(1, 'ride') && has(1, 'totems') && has(1, 'jam'), 'Rainforest: totems, riding cannons, two clusters and jams');
  assert.ok(has(2, 'seal'), 'Desert: solar seals');
  assert.ok(has(3, 'floe') && has(3, 'stop'), 'Ice Age: drift ice and floe stoppers');
  assert.ok(has(4, 'devourer') && has(4, 'portal'), 'The Void: the Light Devourer and wormholes');
  for (const m of ['totem', 'ride', 'totems', 'jam']) assert.equal(first(m), 1, `${m} first appears in the Rainforest`);
  assert.equal(first('seal'), 2); assert.equal(first('floe'), 3); assert.equal(first('stop'), 3);
  assert.equal(first('devourer'), 4); assert.equal(first('portal'), 4);
  // Each chapter's modifier is present across its whole chapter.
  assert.ok(levels.filter(l => l.chapter === 1).every(l => l.clusters.length > 0));
  assert.ok(levels.filter(l => l.chapter === 2).every(l => l.seals.length > 0));
  assert.ok(levels.filter(l => l.chapter === 3).every(l => l.floes.length > 0));
  assert.ok(levels.filter(l => l.chapter === 4).every(l => l.devourers.length > 0));
  assert.ok(levels.filter(l => l.chapter === 0 && l.index > 1).every(l => l.emitters.some(e => e.rotatable)), 'Sky Temples teaches the turning lens from level 2 on');
  assert.ok(levels.every(l => l.mechanics.includes('limit') && l.maxMoves > l.twoStar));
  for (const l of levels) for (const m of l.mechanics) assert.ok(m in mechanicTips, `tip for ${m}`);
  // The tip box above the bottom buttons shows three lines on a phone; longer tips were cut off on Android.
  for (const [m, tip] of Object.entries(mechanicTips)) assert.ok(tip.length <= 70, `the ${m} tip is ${tip.length} characters, too long for the tip box`);
});

test('The removed modifiers are gone: no cursed gems, vines of any kind, thawing ice or braziers in any level', () => {
  const raw = JSON.parse(readFileSync(join(__dirname, 'levels.json'), 'utf8')) as Record<string, unknown>[];
  for (const l of raw) for (const field of ['hazards', 'vines', 'roots', 'heaters']) assert.ok(!(field in l), `level data still holds ${field}`);
  const gone = ['hazard', 'vine', 'burn', 'frozen', 'heater', 'link', 'chain'];
  for (const l of levels) {
    for (const m of l.mirrors) for (const field of ['frozen', 'glacier', 'link']) assert.ok(!(field in m), `level ${l.id} mirror ${m.id} still has ${field}`);
    for (const m of l.mechanics) assert.ok(!gone.includes(m), `level ${l.id} lists ${m}`);
  }
  for (const tip of Object.keys(mechanicTips)) assert.ok(!gone.includes(tip));
  const text = chapters.flatMap(c => [...c.levels.flat(), ...c.intro, ...c.newMechanics.map(m => m.text)]).join(' ').toLowerCase();
  for (const word of ['cursed', 'thornvine', 'vine', 'brazier', 'thaw', 'melt']) assert.ok(!text.includes(word), `chapter text still mentions ${word}`);
  for (const tip of Object.values(mechanicTips)) assert.ok(!tip.toLowerCase().includes('vine'), `a tip still mentions vines: ${tip}`);
});

test('Rootbound totems matter on every level that has them: each is turned, and frozen it costs at least two more taps or the win', () => {
  for (const l of levels.filter(x => x.clusters.length)) {
    for (const c of l.clusters) {
      assert.ok(l.solutionMoves.includes(c.totem.id), `level ${l.id}: totem ${c.totem.id} is never turned`);
      // Frozen where it opens: its stones never turn, and its totem is just a stone.
      const still: Level = { ...l, clusters: l.clusters.filter(x => x !== c), blockers: [...l.blockers, c.totem.position] };
      const plan = solve(still, initialState(still));
      assert.ok(!plan || plan.length >= l.par + 2, `level ${l.id}: without ${c.id} it is won in ${plan?.length} taps (par ${l.par})`);
    }
    if (l.mechanics.includes('jam')) {
      const start = initialState(l);
      assert.ok(l.clusters.some(c => l.solutionMoves.includes(c.totem.id) && !canRotate(l, start, c.totem.id)), `level ${l.id}: no cluster is jammed at the start`);
    }
  }
});

test('Rootbound totems: a tap turns the whole cluster a quarter turn around its pivot, carrying every piece on it', () => {
  // A 2x2 turntable around the corner (2.5, 2.5) carrying a mirror, a stone and a crystal; the cannon fires east along row 2.
  const c = cluster({ cells: [[2, 2], [3, 2], [2, 3], [3, 3]], pivot: [2.5, 2.5], totem: { id: 't1', position: [4, 4] } });
  const level = base({ size: 5, clusters: [c], mirrors: [{ id: 'm', position: [2, 3], orientation: 1, fixed: true }], blockers: [[3, 2]],
    targets: [{ id: 'x', position: [3, 3] }] });
  assert.deepEqual(validateLevel({ ...level, solutionMoves: [] }).filter(e => !e.includes('solution') && !e.includes('par') && !e.includes('unsolvable')), []);
  assert.deepEqual(turnPoint([0, -1], [0, 0], 1), [1, 0], 'clockwise: north turns to east');
  assert.deepEqual(turnPoint([0, -1], [0, 0], -1), [-1, 0], 'counter-clockwise: north turns to west');
  let s = initialState(level);
  assert.ok(tappables(level).includes('t1'));
  s = applyMove(level, s, 't1');
  assert.equal(s.turns.r1, 1);
  assert.deepEqual(placeOf(level, s, [2, 3]), [2, 2], 'the mirror moved from the south-west to the north-west stone');
  assert.deepEqual(placeOf(level, s, [3, 2]), [3, 3], 'the stone moved from the north-east to the south-east stone');
  assert.deepEqual(placeOf(level, s, [3, 3]), [2, 3], 'the crystal rode along too');
  assert.deepEqual(placeOf(level, s, [0, 2]), [0, 2], 'pieces off the cluster never move');
  assert.equal(s.orientations.m, 0, 'a quarter turn swaps even a fixed mirror\'s slant');
  // The cannon's beam now meets the mirror at (2,2), which sends it north, off the board: the crystal stays dark.
  const t1 = traceState(level, s);
  assert.ok(t1.litMirrors.includes('m'));
  assert.deepEqual(t1.hits.find(h => h.kind === 'mirror')!.point, [2, 2], 'light reflects off the mirror where it stands now');
  for (let k = 0; k < 3; k++) s = applyMove(level, s, 't1');
  assert.equal(s.turns.r1, 0, 'four quarter turns bring the cluster home');
  assert.deepEqual(s.orientations, initialState(level).orientations);
  assert.deepEqual(boardOf(level, s).pieces, undefined, 'home again, the opening layout is used');
  // Turning the other way round: counter-clockwise, the mirror goes from south-west to south-east.
  const ccw = { ...level, clusters: [{ ...c, turn: -1 as const }] };
  assert.deepEqual(placeOf(ccw, applyMove(ccw, initialState(ccw), 't1'), [2, 3]), [3, 3]);
});

test('Rootbound totems: cannons riding a cluster move with it and turn their aim, mirrors keep turning by hand', () => {
  // A domino turning around (1,1): the cannon on (2,1) facing west swings to (1,2) facing north, clockwise.
  const c = cluster({ cells: [[1, 1], [2, 1]], pivot: [1, 1], totem: { id: 't1', position: [0, 0] } });
  const level = base({ size: 4, emitters: [{ id: 'e1', position: [2, 1], direction: 'W' }], mirrors: [{ id: 'm', position: [1, 1], orientation: 0, fixed: false }],
    targets: [{ id: 'x', position: [1, 3] }], clusters: [c] });
  let s = applyMove(level, initialState(level), 't1');
  assert.deepEqual(placeOf(level, s, [2, 1]), [1, 2]);
  assert.equal(s.aims.e1, 'N', 'west turns to north');
  assert.equal(s.orientations.m, 1, 'the mirror on the hub turns in place');
  s = applyMove(level, s, 'm');
  assert.equal(s.orientations.m, 0, 'a mirror on a cluster still turns by hand');
  const ccw = { ...level, clusters: [{ ...c, turn: -1 as const }] };
  const s2 = applyMove(ccw, initialState(ccw), 't1');
  assert.deepEqual(placeOf(ccw, s2, [2, 1]), [1, 0]);
  assert.equal(s2.aims.e1, 'S', 'counter-clockwise, west turns to south');
  assert.deepEqual(traceState(ccw, s2).segments[0]!.from, [1, 0], 'the beam starts where the cannon stands now');
});

test('Rootbound totems: a turn is refused, costing nothing, when its stones would pass over or land on anything else or leave the board', () => {
  // An arm of three cells, (1,1) to (3,1), turning clockwise around (1,1): its stones sweep the quarter disc down to (1,3).
  const c = cluster({ cells: [[1, 1], [2, 1], [3, 1]], pivot: [1, 1], totem: { id: 't1', position: [0, 0] } });
  const free = base({ size: 5, emitters: [{ id: 'e1', position: [4, 4], direction: 'N' }], targets: [{ id: 'x', position: [0, 4] }], clusters: [c] });
  assert.deepEqual(cellsOf(footprint(free, c, 1)), cellsOf([[1, 1], [1, 2], [1, 3]]));
  assert.ok(cellsOf(sweepOf(free, c, 0)).includes('2,2'), 'the swing passes over the diagonal (2,2)');
  assert.ok(canRotate(free, initialState(free), 't1'));
  const blockedBy = (patch: Partial<Level>) => {
    const l = { ...free, ...patch };
    const s = initialState(l);
    assert.equal(canRotate(l, s, 't1'), false);
    assert.equal(applyMove(l, s, 't1'), s, 'a refused turn changes nothing');
    return cellsOf(turnBlocks(l, s, c));
  };
  assert.deepEqual(blockedBy({ blockers: [[1, 3]] }), ['1,3'], 'a stone where it would land');
  assert.deepEqual(blockedBy({ blockers: [[2, 2]] }), ['2,2'], 'a stone in the path of the swing');
  assert.deepEqual(blockedBy({ mirrors: [{ id: 'd', position: [3, 2], orientation: 0, fixed: false }] }), ['3,2'], 'a mirror in the path');
  assert.ok(blockedBy({ clusters: [{ ...c, totem: { id: 't1', position: [2, 2] } }] }).includes('2,2'), 'a totem in the path');
  const edge = { ...free, clusters: [{ ...c, cells: [[1, 3], [2, 3], [3, 3]] as Point[], pivot: [1, 3] as Point }] };
  assert.equal(canRotate(edge, initialState(edge), 't1'), false, 'it would swing off the board');
  assert.ok(turnBlocks(edge, initialState(edge), edge.clusters[0]!).some(p => p[1] > 4));
});

test('Rootbound totems: when one cluster stands in another\'s way, the order of the turns matters', () => {
  // r1 swings an arm from row 1 down column 1. r2, a domino turning counter-clockwise around (3,3), has a stone on (2,3)
  // in that swing until it turns it away to (3,4).
  const r1 = cluster({ cells: [[1, 1], [2, 1], [3, 1]], pivot: [1, 1], totem: { id: 't1', position: [0, 0] } });
  const r2 = cluster({ id: 'r2', cells: [[2, 3], [3, 3]], pivot: [3, 3], turn: -1, totem: { id: 't2', position: [4, 4] } });
  const level = base({ size: 5, emitters: [{ id: 'e1', position: [4, 0], direction: 'S' }], targets: [{ id: 'x', position: [0, 4] }], clusters: [r1, r2] });
  const s0 = initialState(level);
  assert.equal(canRotate(level, s0, 't1'), false, 'r1 is jammed by r2 at the start');
  assert.deepEqual(cellsOf(turnBlocks(level, s0, r1)), ['2,3']);
  assert.ok(canRotate(level, s0, 't2'));
  const s1 = applyMove(level, s0, 't2');
  assert.deepEqual(cellsOf(footprint(level, r2, s1.turns.r2!)), cellsOf([[3, 3], [3, 4]]));
  assert.ok(canRotate(level, s1, 't1'), 'once r2 has turned away, r1 is free');
  assert.deepEqual(cellsOf(footprint(level, r1, applyMove(level, s1, 't1').turns.r1!)), cellsOf([[1, 1], [1, 2], [1, 3]]));
});

test('Rootbound totems: every turn of every cluster in the campaign lands on whole cells inside the board, in every reachable state', () => {
  for (const l of levels.filter(x => x.clusters.length)) {
    const whole = (p: Point) => Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 0 && p[1] >= 0 && p[0] < l.size && p[1] < l.size;
    for (const c of l.clusters) for (let st = 0; st < 4; st++) for (const p of footprint(l, c, st)) assert.ok(Number.isInteger(p[0]) && Number.isInteger(p[1]), `level ${l.id} ${c.id}`);
    // Every state the player can reach within the move limit: pieces on whole, distinct cells, and no overlaps.
    const seen = new Set<string>();
    let layer = [initialState(l)];
    for (let d = 0; d < l.maxMoves && layer.length && seen.size < 4000; d++) {
      const next: PlayState[] = [];
      for (const s of layer) {
        const cells = [...l.mirrors.map(m => m.position), ...l.emitters.map(e => e.position), ...l.targets.map(t => t.position), ...l.blockers,
          ...l.splitters.map(x => x.position)].map(p => placeOf(l, s, p));
        assert.ok(cells.every(whole), `level ${l.id}: a piece left the grid`);
        assert.equal(new Set(cells.map(key)).size, cells.length, `level ${l.id}: two pieces share a cell`);
        const covered = l.clusters.flatMap(c => footprint(l, c, s.turns[c.id]!).map(key));
        assert.equal(new Set(covered).size, covered.length, `level ${l.id}: two clusters overlap`);
        assert.ok(!covered.some(k => l.clusters.some(c => key(c.totem.position) === k)), `level ${l.id}: a cluster covers a totem`);
        for (const id of tappables(l)) {
          if (!canRotate(l, s, id)) continue;
          const ns = applyMove(l, s, id);
          const k = JSON.stringify([ns.orientations, ns.aims, ns.turns, ns.sealed, ns.places]);
          if (!seen.has(k)) { seen.add(k); next.push(ns); }
        }
      }
      layer = next;
    }
  }
});

test('Rootbound totems: clusters must be explicit, connected, pivoted on the grid and carry nothing they cannot', () => {
  const ok = base({ size: 5, targets: [{ id: 'x', position: [4, 0] }], clusters: [cluster({ cells: [[1, 1], [2, 1]], pivot: [1, 1], totem: { id: 't1', position: [3, 3] } })] });
  const errors = (c: Partial<Cluster>, patch: Partial<Level> = {}) => validateLevel({ ...ok, ...patch, clusters: [{ ...ok.clusters[0]!, ...c }] });
  assert.ok(errors({ pivot: [1.5, 1] }).some(e => e.includes('pivot')), 'a pivot that would leave stones between cells');
  assert.ok(errors({ cells: [[1, 1], [3, 1]] }).some(e => e.includes('not connected')));
  assert.ok(errors({ cells: [[1, 1]] }).some(e => e.includes('two cells')));
  assert.ok(errors({ totem: { id: 't1', position: [2, 1] } }).some(e => e.includes('cannot turn')), 'a totem cannot stand on its own stones');
  assert.ok(errors({}, { portals: [{ id: 'p', position: [2, 1], exit: [4, 4] }] }).some(e => e.includes('cannot turn')), 'a cluster cannot carry a wormhole');
  assert.ok(errors({ cells: [[1, 1], [2, 1], [2, 1]] }).some(e => e.includes('listed twice')));
  assert.ok(errors({ turn: 2 as never }).some(e => e.includes('turn direction')));
});

test('Drift ice matters on every level that has it, and stopper levels really need a floe parked against another', () => {
  for (const l of levels.filter(x => x.floes.length)) {
    assert.ok(l.solutionMoves.some(id => id.startsWith('f')), `level ${l.id}: no floe glides in its solution`);
    if (!l.mechanics.includes('stop')) continue;
    const end = replay(l, l.solutionMoves);
    // Track cells are open ice, so a floe that ends mid-track can only have been stopped there by another floe.
    assert.ok(l.floes.some(f => end.places[f.id]! > 0 && end.places[f.id]! < f.track.length - 1), `level ${l.id}: no floe ends mid-track`);
  }
});

test('Gameplay is deterministic: the engine uses no randomness, and the same taps always give the same board and light', () => {
  const source = readFileSync(join(__dirname, 'engine.ts'), 'utf8');
  assert.ok(!/Math\.random|Date\.now\(\)\s*[%*]/.test(source.replace(/solveSliced[\s\S]*?\n}\n/, '')), 'no random numbers in the rules');
  for (const l of levels) {
    const a = replay(l, l.solutionMoves), b = replay(l, l.solutionMoves);
    assert.deepEqual(a, b);
    assert.deepEqual(traceState(l, a), traceState(l, b));
  }
});

test('Moves never mutate the board they start from (undo and retry restore exact snapshots)', () => {
  const freeze = (s: PlayState) => { for (const v of Object.values(s)) if (v && typeof v === 'object') Object.freeze(v); return Object.freeze(s); };
  for (const l of levels) {
    let s = freeze(initialState(l));
    const restart = initialState(l);
    for (const id of l.solutionMoves) s = freeze(applyMove(l, s, id));
    assert.deepEqual(initialState(l), restart, `level ${l.id}: retry rebuilds the same opening board`);
  }
});

test('Splitters fork the beam into both perpendicular directions', () => {
  const level = base({ splitters: [{ id: 's1', position: [2, 2] }], targets: [{ id: 'a', position: [2, 0] }, { id: 'b', position: [2, 4] }] });
  const trace = traceBeam(level, {});
  assert.equal(trace.won, true);
  assert.equal(trace.activatedAt.a, trace.activatedAt.b);
});

test('Solved beams are clipped to end inside the last crystal of every branch', () => {
  const single = base({ targets: [{ id: 'a', position: [3, 2] }] });
  const clipped = clipToCrystals(traceBeam(single, {}));
  assert.equal(clipped.segments.length, 1);
  assert.deepEqual(clipped.segments[0]!.to, [3, 2]);
  assert.equal(clipped.segments[0]!.exit, false);
  const split = base({ splitters: [{ id: 's1', position: [2, 2] }], targets: [{ id: 'a', position: [2, 1] }, { id: 'b', position: [2, 4] }] });
  const ends = clipToCrystals(traceBeam(split, {})).segments.map(s => s.to.join(',')).sort();
  assert.deepEqual(ends, ['2,1', '2,2', '2,4']);
  for (const l of levels) {
    const t = traceState(l, replay(l, l.solutionMoves));
    const c = clipToCrystals(t);
    assert.ok(c.segments.every(s => !s.exit && !s.blocked), `level ${l.id} has a stray beam`);
    assert.deepEqual(c.activatedAt, t.activatedAt);
  }
});

test('Portals carry light to their exit without changing direction', () => {
  const level = base({ portals: [{ id: 'p', position: [1, 2], exit: [1, 4] }], targets: [{ id: 'a', position: [3, 4] }] });
  assert.equal(traceBeam(level, {}).won, true);
});

test('Blocked and exiting beams end at faces / board edge', () => {
  const blocked = traceBeam(base({ blockers: [[3, 2]], targets: [{ id: 'a', position: [4, 4] }] }), {});
  assert.equal(blocked.segments.at(-1)!.blocked, true);
  assert.ok(Math.abs(blocked.segments.at(-1)!.to[0] - 2.54) < 1e-9);
  const exit = traceBeam(base({ targets: [{ id: 'a', position: [4, 4] }] }), {});
  assert.equal(exit.segments.at(-1)!.exit, true);
});

test('Drift ice: a floe glides the way it faces until its track ends or another floe stands in the way', () => {
  // f rides row 2 from (1,2) to (4,2); g rides column 3 from (3,4) up to (3,2), crossing f's track at (3,2).
  const level = base({
    emitters: [{ id: 'e1', position: [0, 0], direction: 'E' }], targets: [{ id: 't', position: [4, 0] }],
    floes: [
      { id: 'f', track: [[1, 2], [2, 2], [3, 2], [4, 2]], at: 0, facing: 1, orientation: 0 },
      { id: 'g', track: [[3, 4], [3, 3], [3, 2]], at: 0, facing: 1, orientation: 1 },
    ],
  });
  let s = initialState(level);
  assert.deepEqual(glide(level, s, level.floes[0]!), { at: 3, facing: -1 }, 'f would glide to the end of its track and turn to face back');
  s = applyMove(level, s, 'g');
  assert.deepEqual([s.places.g, s.facing.g], [2, -1], 'g glides onto the crossing at the end of its track');
  s = applyMove(level, s, 'f');
  assert.deepEqual([s.places.f, s.facing.f], [1, 1], 'f halts in front of g and keeps facing the same way');
  s = applyMove(level, s, 'f');
  assert.deepEqual([s.places.f, s.facing.f], [0, 1], 'blocked straight ahead, it glides the other way to its track end and faces out again');
  s = applyMove(level, s, 'g');
  assert.equal(s.places.g, 0, 'g leaves the crossing');
  s = applyMove(level, s, 'f');
  assert.deepEqual([s.places.f, s.facing.f], [3, -1], 'with the crossing clear, f glides all the way');
  const boxed = base({ targets: [{ id: 't', position: [4, 0] }], floes: [
    { id: 'f', track: [[2, 2], [3, 2]], at: 0, facing: 1, orientation: 0 },
    { id: 'g', track: [[3, 4], [3, 3], [3, 2]], at: 2, facing: -1, orientation: 1 }] });
  const b0 = initialState(boxed);
  assert.equal(canRotate(boxed, b0, 'f'), false, 'boxed in both ways: the tap is refused and costs no move');
  assert.equal(applyMove(boxed, b0, 'f'), b0);
});

test('Drift ice: a floe stops against another floe mid-track, and light reflects off a floe wherever it stands', () => {
  // f rides row 1 from (0,1) to (3,1); the stopper g rides column 2 from (2,3) up to (2,1).
  const level = base({
    emitters: [{ id: 'e1', position: [1, 4], direction: 'N' }], targets: [{ id: 't', position: [4, 1] }],
    floes: [
      { id: 'f', track: [[0, 1], [1, 1], [2, 1], [3, 1]], at: 0, facing: 1, orientation: 0 },
      { id: 'g', track: [[2, 1], [2, 2], [2, 3]], at: 2, facing: -1, orientation: 0 },
    ],
  });
  let s = initialState(level);
  assert.equal(traceState(level, s).won, false);
  s = applyMove(level, s, 'g');
  assert.equal(s.places.g, 0, 'g glides up onto the crossing');
  s = applyMove(level, s, 'f');
  assert.equal(s.places.f, 1, 'f halts against g, right above the cannon');
  assert.equal(s.facing.f, 1, 'stopped by a floe, not a track end: it keeps facing the same way');
  const lit = traceState(level, s);
  assert.ok(lit.litMirrors.includes('f'), 'the beam reflects off f at its new cell');
  assert.equal(lit.won, false, 'but g stands on the road and turns the light away');
  s = applyMove(level, s, 'g');
  assert.equal(s.places.g, 2, 'g slides back out of the road');
  assert.equal(traceState(level, s).won, true);
  assert.deepEqual(solve(level, initialState(level)), ['g', 'f', 'g']);
  assert.equal(boardOf(level, s).floes.get(key([1, 1]))?.id, 'f');
});

test('Drift ice: tracks must be straight open ice, crossing other tracks at most once', () => {
  const ok = base({ floes: [{ id: 'f', track: [[1, 1], [2, 1]], at: 0, facing: 1, orientation: 0 }], targets: [{ id: 't', position: [4, 4] }] });
  const errors = (patch: Partial<Level>) => validateLevel({ ...ok, ...patch });
  assert.ok(errors({ floes: [{ id: 'f', track: [[1, 1], [2, 2]], at: 0, facing: 1, orientation: 0 }] }).some(e => e.includes('straight')));
  assert.ok(errors({ floes: [{ id: 'f', track: [[1, 1]], at: 0, facing: 1, orientation: 0 }] }).some(e => e.includes('straight')));
  assert.ok(errors({ blockers: [[2, 1]] }).some(e => e.includes('overlaps a piece')));
  assert.ok(errors({ floes: [{ id: 'f', track: [[1, 1], [2, 1]], at: 2, facing: 1, orientation: 0 }] }).some(e => e.includes('off its track')));
  assert.ok(errors({ floes: [{ id: 'f', track: [[1, 1], [2, 1], [3, 1]], at: 0, facing: 1, orientation: 0 },
    { id: 'g', track: [[2, 1], [3, 1]], at: 1, facing: -1, orientation: 0 }] }).some(e => e.includes('along a line')));
});

test('Loops terminate', () => {
  const level = base({ portals: [{ id: 'p', position: [1, 2], exit: [0, 2] }], targets: [{ id: 'a', position: [4, 4] }] });
  const trace = traceBeam(level, {});
  assert.equal(trace.loop, true);
});

test('Chapter 1: hand-turned cannons rotate a quarter turn clockwise per tap, and the beam follows their aim', () => {
  const level = base({ emitters: [{ id: 'e1', position: [2, 2], direction: 'N', rotatable: true }], targets: [{ id: 'a', position: [2, 4] }] });
  let s = initialState(level);
  assert.ok(tappables(level).includes('e1'));
  s = applyMove(level, s, 'e1');
  assert.equal(s.aims.e1, 'E');
  assert.deepEqual(traceState(level, s).segments[0]!.to, [4.5, 2]);
  assert.deepEqual(solve(level, initialState(level)), ['e1', 'e1']);
  const fixed = base({});
  assert.equal(canRotate(fixed, initialState(fixed), 'e1'), false);
});

test('Chapter 3: lit solar seals activate for good, in numbered order, and flip their gates', () => {
  const level = base({
    emitters: [{ id: 'e1', position: [0, 2], direction: 'S', rotatable: true }], targets: [{ id: 'a', position: [4, 2] }],
    seals: [{ id: 's1', position: [0, 1], order: 1, toggles: ['g2'] }, { id: 's2', position: [0, 3], order: 2, toggles: ['g1'] }],
    gates: [{ id: 'g1', position: [2, 2], open: false }, { id: 'g2', position: [3, 0], open: true }],
  });
  let s = initialState(level);
  assert.deepEqual(traceState(level, s).sealsLit, ['s2']);
  assert.equal(s.sealed.s2, undefined, 'seal 2 cannot wake before seal 1');
  s = replay(level, ['e1', 'e1'], s); // aim W, then N across seal 1
  assert.equal(s.sealed.s1, true);
  assert.deepEqual([...boardOf(level, s).closedGates].sort(), ['g1', 'g2'], 'seal 1 closed the open gate g2');
  s = applyMove(level, s, 'e1'); // E: still blocked by g1
  assert.equal(traceState(level, s).won, false);
  s = applyMove(level, s, 'e1'); // S across seal 2, now in order
  assert.equal(s.sealed.s2, true);
  assert.ok(!boardOf(level, s).closedGates.has('g1'));
  s = replay(level, ['e1', 'e1', 'e1'], s); // round to E again
  assert.equal(traceState(level, s).won, true);
  assert.equal(s.sealed.s1 && s.sealed.s2, true, 'seals stay active once lit');
});

test('Chapter 5: light entering the Devourer\'s zone is swallowed and the level is lost at once', () => {
  const level = base({
    targets: [{ id: 'a', position: [4, 4] }], mirrors: [{ id: 'm', position: [2, 2], orientation: 0, fixed: false }],
    devourers: [{ id: 'x', position: [2, 4], zone: [[2, 4], [2, 3]] }],
  });
  const start = initialState(level);
  assert.equal(start.absorbed, undefined);
  const s = applyMove(level, start, 'm');
  assert.equal(s.absorbed, 'x');
  const t = traceState(level, s);
  assert.equal(t.absorbed, 'x');
  assert.equal(t.won, false);
  assert.equal(canRotate(level, s, 'm'), false, 'nothing can be played after a swallowed beam');
  assert.equal(t.hits.at(-1)!.kind, 'devourer');
  assert.equal(solve(level, start), null);
  assert.equal(greedyPlay(level, start, 3, false), null);
});

test('Stars and idempotent best results', () => {
  const l = levels[10]!;
  assert.equal(starsFor(l, l.par), 3);
  assert.equal(starsFor(l, l.twoStar), 2);
  assert.equal(starsFor(l, l.twoStar + 1), 1);
  assert.equal(starsFor(l, l.maxMoves), 1);
  assert.equal(starsFor(l, l.maxMoves + 1), 0);
  for (const x of levels) assert.ok(x.twoStar === x.par + 2 && x.maxMoves > x.twoStar, `level ${x.id}: 3 at par, 2 at par + 2, 1 within the limit`);
  const first = recordResult({}, 1, 3, 1);
  assert.deepEqual(recordResult(first, 1, 1, 9), first);
  assert.equal(totalStars(first), 3);
  assert.equal(unlockedLevel(first, 90), 2);
});

test('Clearing a world opens the next; only 54/54 shards forge its Heart', () => {
  const p: Record<string, { stars: number; moves: number }> = {};
  for (let i = 1; i <= 18; i++) p[i] = { stars: 3, moves: 1 };
  assert.equal(worldCleared(p, 0), true);
  assert.equal(unlockedLevel(p, 91), 19);
  assert.deepEqual(heartsEarned(p), [0]);
  p[5] = { stars: 2, moves: 4 };
  assert.equal(worldShards(p, 0), 53);
  assert.deepEqual(heartsEarned(p), []);
  assert.equal(worldCleared(p, 0), true);
  for (let i = 1; i <= 90; i++) p[i] = { stars: 3, moves: 1 };
  assert.deepEqual(heartsEarned(p), [0, 1, 2, 3, 4]);
});

test('Every cannon fires; a beam stops at another cannon', () => {
  const level = base({
    emitters: [{ id: 'e1', position: [0, 1], direction: 'E' }, { id: 'e2', position: [0, 3], direction: 'E' }],
    targets: [{ id: 'a', position: [3, 1] }, { id: 'b', position: [3, 3] }],
  });
  assert.equal(traceBeam(level, {}).won, true);
  const into = base({ emitters: [{ id: 'e1', position: [0, 1], direction: 'E' }, { id: 'e2', position: [3, 1], direction: 'S' }], targets: [{ id: 'a', position: [4, 1] }] });
  assert.equal(traceBeam(into, {}).activated.length, 0);
});

test('Wormholes are one-way and never duplicate the beam: light entering the exit tile passes straight through', () => {
  const level = base({ portals: [{ id: 'p', position: [1, 2], exit: [3, 0] }], targets: [{ id: 'a', position: [4, 0] }] });
  const t = traceBeam(level, {});
  assert.equal(t.won, true);
  assert.equal(t.hits.filter(h => h.kind === 'portal').length, 2, 'one entry and one exit');
  assert.equal(new Set(t.segments.map(s => s.branch)).size, 1, 'still a single beam');
  const back = base({ emitters: [{ id: 'e1', position: [3, 4], direction: 'N' }], portals: [{ id: 'p', position: [1, 2], exit: [3, 2] }],
    targets: [{ id: 'a', position: [3, 0] }] });
  assert.equal(traceBeam(back, {}).won, true, 'the exit tile is not an entrance');
});

test('Every wormhole lies on its level\'s solved light, and no solved light runs in a loop', () => {
  for (const l of levels) {
    const t = traceState(l, replay(l, l.solutionMoves));
    assert.equal(t.loop, false, `level ${l.id}`);
    const entered = new Set(t.hits.filter(h => h.kind === 'portal').map(h => key(h.point)));
    for (const p of l.portals) assert.ok(entered.has(key(p.position)), `level ${l.id}: wormhole ${p.id} is never used`);
  }
});

/** Plays taps from the opening board under the real rules: the level ends on a win, a swallowed beam or the last move. */
function play(level: Level, taps: string[]) {
  let s = initialState(level);
  for (let k = 0; k < taps.length; k++) {
    s = applyMove(level, s, taps[k]!);
    if (traceState(level, s).won) return { won: true, moves: k + 1, shards: starsFor(level, k + 1) };
    if (s.absorbed) return { won: false, moves: k + 1, shards: 0 };
    if (k + 1 >= level.maxMoves) return { won: false, moves: k + 1, shards: 0 };
  }
  return { won: false, moves: taps.length, shards: 0 };
}

for (const level of levels) {
  test(`Level ${level.id}: 3, 2, 1 and 0 shards are all reachable with legitimate taps within ${level.maxMoves} moves`, () => {
    const wins = winningSequences(level, level.maxMoves);
    assert.deepEqual(play(level, level.solutionMoves), { won: true, moves: level.par, shards: 3 });
    assert.deepEqual(play(level, wins.get(level.par)!), { won: true, moves: level.par, shards: 3 });
    const two = [...wins.keys()].find(k => k > level.par && k <= level.twoStar);
    assert.ok(two, 'a 2-shard win exists');
    assert.deepEqual(play(level, wins.get(two)!), { won: true, moves: two, shards: 2 });
    const one = [...wins.keys()].find(k => k > level.twoStar && k <= level.maxMoves);
    assert.ok(one, 'a 1-shard win exists, so completion never needs a perfect score');
    assert.deepEqual(play(level, wins.get(one)!), { won: true, moves: one, shards: 1 });
    const lose = losingSequence(level);
    assert.ok(lose, 'the level can be lost');
    assert.equal(play(level, lose.taps).shards, 0);
    assert.ok(!wins.has(0) && Math.min(...wins.keys()) === level.par, 'nothing wins faster than par');
  });
}

test('Past each chapter\'s teaching levels, the "tap the last mirror the light hits" strategy fails', () => {
  const from = [12, 3, 2, 2, 2];
  for (const l of levels.filter(x => x.index > from[x.chapter]!)) {
    assert.equal(greedyPlay(l, initialState(l), l.par, true), null, `level ${l.id} is solvable by following the beam`);
  }
  for (const l of levels.filter(x => x.boss)) assert.equal(greedyPlay(l, initialState(l), l.par, false), null, `boss ${l.id} is greedy-solvable`);
});

test('Difficulty climbs: par and cannons grow across the journey', () => {
  const avg = (c: number, f: (l: Level) => number) => levels.filter(l => l.chapter === c).reduce((s, l) => s + f(l), 0) / LEVELS_PER_CHAPTER;
  for (let c = 1; c < 5; c++) assert.ok(avg(c, l => l.par) >= avg(c - 1, l => l.par) - .35, `par dips in chapter ${c + 1}`);
  for (let c = 0; c < 5; c++) {
    const ch = levels.filter(l => l.chapter === c);
    const third = (k: number) => ch.slice(k * 6, k * 6 + 6).reduce((s, l) => s + l.par, 0) / 6;
    assert.ok(third(0) < third(1) && third(1) < third(2), `chapter ${c + 1} grows harder in thirds`);
    assert.ok(ch.slice(12).some(l => l.emitters.length >= 2) && ch.slice(15).some(l => l.emitters.length === 3), `chapter ${c + 1} ends with twin and triple cannons`);
  }
  assert.equal(levels.at(-1)!.emitters.length, 3);
});

test('The sliced hint search returns exactly what solve() returns, for every level', () => {
  for (const level of levels) {
    // Scramble a few taps in too, so the search starts from a state the player could really be in.
    let start = initialState(level);
    for (const id of tappables(level).slice(0, 3)) {
      const next = applyMove(level, start, id);
      if (!next.absorbed) start = next;
    }
    const queue: (() => void)[] = [];
    let result: string[] | null | undefined;
    // A zero budget pauses after every step: the most sliced the search can be.
    solveSliced(level, start, path => { result = path; }, { budgetMs: 0, schedule: run => queue.push(run) });
    while (result === undefined && queue.length) queue.shift()!();
    assert.deepEqual(result, solve(level, start), `level ${level.id}`);
  }
});

test('A cancelled sliced search never reports a result', () => {
  const level = levels.at(-1)!;
  const queue: (() => void)[] = [];
  let reported = false;
  const cancel = solveSliced(level, initialState(level), () => { reported = true; }, { budgetMs: 0, schedule: run => queue.push(run) });
  cancel();
  while (queue.length) queue.shift()!();
  assert.equal(reported, false);
});
