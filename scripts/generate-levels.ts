// Builds the 90 campaign levels (5 chapters x 18). Every candidate is verified by the BFS solver, so par is the true optimum,
// and each chapter's modifier must genuinely shape the solution: seals must be activated, every rootbound totem must be
// turned and the level must not be winnable as fast with its cluster frozen, floes must glide (and stop against each
// other where a level teaches it) and devourers must punish a tempting move. Every shard outcome (3, 2, 1 and 0) is
// proven reachable before a level is accepted. Seeded, so the same campaign is rebuilt every time.
// Run: npx tsx scripts/generate-levels.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyMove, canRotate, clusterAt, DELTA, footprint, greedyPlay, initialState, key, losingSequence, orientationFor, reflect, replay, solve,
  stateEncoder, sweepOf, tappables, traceBeam, traceState, turnBlocks, turnLeft, turnPoint, turnRight, winnableAt } from '../src/game/engine';
import { Cluster, Devourer, Direction, Emitter, Floe, Level, Mechanic, Mirror, Orientation, PlayState, Point } from '../src/game/types';

export const PER_CHAPTER = 18;

/** Rootbound cluster shapes: cells around a pivot at the origin (a corner where four cells meet, or a cell centre). */
const SHAPES = {
  /** A 2x2 turntable: it turns in place, so nothing can ever block it. */
  square: [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]],
  domino: [[0, 0], [1, 0]],
  bar: [[-1, 0], [0, 0], [1, 0]],
  ell: [[0, 0], [1, 0], [0, 1]],
  arm: [[0, 0], [1, 0], [2, 0]],
  tee: [[-1, 0], [0, 0], [1, 0], [0, 1]],
} satisfies Record<string, Point[]>;
export type Shape = keyof typeof SHAPES;

export interface Spec {
  size: number; emitters: number; rotatable: number; turns: number; pass: number; splitters: number; portals: number;
  fixed: number; blockers: number; decoys: number;
  /**
   * Rainforest rootbound totems: how many clusters, their shapes, and at most how many quarter turns each opens away from
   * home. `stone`: a cluster carries a stone that stands on the light's road at the start; `ride`: whether a cannon must,
   * may or must not ride a cluster; `jam`: a cluster the solution turns is blocked at the start until another clears its
   * way; `cross`: a cluster carries pieces of two cannons' beams; `ccw`: clusters may turn counter-clockwise.
   */
  totems: number; shapes: Shape[]; kMax: number; stone: boolean; ride: 'no' | 'must' | 'may'; jam: boolean; cross: boolean; ccw: boolean;
  /** Ice Age drift ice: path floes, stopper floes (parked to halt a path floe mid-track), and whether a stopper must leave the light's road again. */
  floes: number; stoppers: number; leave: boolean; trackMax: number;
  /** Solar seals and devourers. */
  seals: number; devourers: number; zone: number;
  minPar: number; maxPar: number;
  /** 0: any; 1: must beat a player who only taps lit pieces; 2: must also beat one who tries every tap. */
  trap: number; slack: number; boss: boolean;
}

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/** The taps floes need on their own: one glide each, two for a stopper that stays, three for one that must leave again. */
export const floeTaps = (s: Pick<Spec, 'floes' | 'stoppers' | 'leave'>) => s.floes - s.stoppers + s.stoppers * (s.leave ? 3 : 2);

/**
 * The difficulty plan. Per chapter: levels 1-3 teach the modifier, 4-6 add simple decisions, 7-9 combinations, 10-12
 * multi-step plans, 13-15 trade-offs with twin cannons, 16-18 finales with twin and triple cannons.
 */
export function spec(c: number, i: number): Spec {
  const t = i / (PER_CHAPTER - 1);
  const boss = i === PER_CHAPTER - 1;
  const s: Spec = { size: 6, emitters: 1, rotatable: 0, turns: 2, pass: 0, splitters: 0, portals: 0, fixed: 0, blockers: 0, decoys: 0,
    totems: 0, shapes: ['square'], kMax: 1, stone: false, ride: 'may', jam: false, cross: false, ccw: false, floes: 0, stoppers: 0, leave: false, trackMax: 3,
    seals: 0, devourers: 0, zone: 0, minPar: 2, maxPar: 3, trap: 0, slack: 4, boss };
  const par = (a: number, b: number) => { s.minPar = a; s.maxPar = b; };
  if (c === 0) {
    // Sky Temples: mirrors first, then cannons the player turns by hand, then twin and triple cannons.
    s.size = i < 3 ? 4 : i < 7 ? 5 : i < 13 ? 6 : 7;
    s.emitters = i >= 15 ? 3 : i >= 12 ? 2 : 1;
    s.rotatable = i === 0 ? 0 : i < 12 ? 1 : i < 15 ? (i === 12 ? 1 : 2) : i === 17 ? 3 : 2;
    s.turns = i === 0 ? 1 : i === 1 ? 0 : i === 2 ? 1 : i < 9 ? 2 : s.emitters > 1 ? (s.emitters > 2 ? 1 : 2) : 3;
    s.pass = i >= 6 && i < 12 ? (i >= 9 ? 2 : 1) : 0;
    s.fixed = i >= 4 ? (i >= 10 ? 2 : 1) : 0;
    s.blockers = i >= 3 ? lerp(1, 4, t) : 0;
    // A spare mirror early on, so a cannon-only board can still be won in a few extra moves (fewer shards).
    s.decoys = i < 3 ? 1 : i >= 6 ? (i >= 11 ? 2 : 1) : 0;
    if (i === 0) par(1, 1); else if (i === 1) par(1, 2); else if (i === 2) par(2, 2);
    else if (i < 6) par(2, 3); else if (i < 9) par(3, 3); else if (i < 12) par(3, 4); else if (i < 15) par(3, 5); else if (!boss) par(4, 5); else par(5, 6);
    s.trap = i < 6 ? 0 : i < 12 ? i % 2 : 1;
    s.slack = i < 6 ? 6 : i < 15 ? 5 : 4;
  } else if (c === 1) {
    // Rainforest: rootbound totems turn clusters of carved stones a quarter turn, carrying the mirrors, stones and cannons
    // on them. One small turntable first, then clusters carrying a mirror and a stone, cannons riding a cluster, two
    // clusters, clusters standing in each other's way (the order of turns matters) and clusters serving two beams.
    s.size = i < 3 ? 5 : i < 9 ? 6 : 7;
    s.emitters = i === 15 || i === 17 ? 3 : i >= 12 ? 2 : 1;
    s.rotatable = i === 13 || i === 16 ? 1 : 0;
    s.totems = i < 9 ? 1 : 2;
    s.shapes = i < 3 ? ['square'] : i < 6 ? ['square', 'ell', 'domino'] : i < 9 ? ['square', 'ell', 'domino', 'bar'] : ['square', 'ell', 'domino', 'bar', 'arm', 'tee'];
    s.kMax = i < 3 ? 1 : i < 9 ? 2 : 3;
    s.stone = i >= 3 && i < 6;
    s.ride = i < 6 ? 'no' : i < 9 ? 'must' : 'may';
    s.jam = (i >= 12 && i < 15) || i === 16;
    s.cross = s.emitters > 1;
    s.ccw = i >= 9;
    s.turns = i === 0 ? 1 : i < 3 ? 2 : s.emitters > 2 ? 2 : s.emitters > 1 ? 3 : lerp(3, 4, t);
    s.pass = i >= 4 && s.emitters < 3 ? 1 : 0;
    s.fixed = i >= 3 ? (i >= 12 ? 2 : 1) : 0;
    s.blockers = lerp(1, 3, t);
    s.decoys = i < 2 ? 0 : lerp(1, 2, t);
    if (i === 0) par(1, 1); else if (i === 1) par(2, 2); else if (i === 2) par(2, 3); else if (i < 6) par(3, 4); else if (i < 9) par(3, 5);
    else if (i < 12) par(4, 5); else if (!boss) par(4, 6); else par(5, 7);
    s.trap = i < 3 ? 0 : boss ? 2 : 1;
    s.slack = i < 15 ? 5 : 4;
  } else if (c === 2) {
    // Desert: light the solar seals, in order, to move the gates; Ra's prisms let one beam serve a seal and a crystal.
    s.size = i < 4 ? 6 : 7;
    s.seals = i < 6 ? 1 : i < 15 ? 2 : boss ? 3 : 2;
    s.splitters = i >= 3 ? 1 : 0;
    s.emitters = i >= 15 ? 3 : i >= 12 ? 2 : 1;
    if (s.emitters > 2) s.splitters = 0;
    s.rotatable = i >= 13 && i % 2 === 1 ? 1 : 0;
    s.turns = s.emitters > 2 ? 1 : s.emitters > 1 ? 2 : lerp(2, 4, t);
    s.pass = i >= 4 && s.emitters < 3 ? 1 : 0;
    // Seals need spare mirrors upstream of their gate that can send the light to them first.
    s.turns = Math.max(s.turns, s.emitters > 1 ? 2 : i < 3 ? 3 : 4);
    s.fixed = 0;
    s.blockers = lerp(2, 4, t);
    s.decoys = lerp(1, 2, t);
    if (i === 0) par(2, 3); else if (i < 3) par(3, 4); else if (i < 9) par(3, 5); else if (i < 15) par(4, 6); else if (!boss) par(5, 7); else par(6, 8);
    s.trap = i < 2 ? 0 : boss ? 2 : 1;
    s.slack = 4;
  } else if (c === 3) {
    // Ice Age: frozen mirrors never turn, but their floes glide until something stops them. One floe, then floes that
    // must be parked against another, then stoppers that must slide out of the light's road again.
    s.size = i < 3 ? 5 : i < 6 ? 6 : 7;
    s.emitters = i === 15 || i === 17 ? 3 : i >= 12 ? 2 : 1;
    s.floes = i < 2 ? 1 : i < 12 ? 2 : s.emitters > 2 ? 2 : 3;
    s.stoppers = i === 3 || i >= 5 ? 1 : 0;
    s.leave = i >= 9 && i !== 12 && i !== 15;
    s.trackMax = i < 3 ? 3 : 4;
    s.rotatable = i === 11 || i === 14 || i === 16 ? 1 : 0;
    s.turns = s.emitters > 2 ? 2 : s.emitters > 1 ? 3 : i < 2 ? 2 : lerp(3, 4, t);
    s.pass = i >= 4 && s.emitters === 1 ? 1 : 0;
    s.fixed = i >= 3 ? 1 : 0;
    s.blockers = lerp(1, 3, t);
    s.decoys = lerp(1, 2, t);
    if (i === 0) par(1, 2); else if (i === 1) par(2, 2); else if (i === 2) par(2, 3); else if (i < 6) par(3, 4); else if (i < 9) par(4, 5);
    else if (i < 12) par(4, 6); else if (!boss) par(4, 6); else par(6, 8);
    s.trap = i < 2 ? 0 : boss ? 2 : 1;
    s.slack = 4;
  } else {
    // The Void: the Light Devourer swallows any stray beam; wormholes, then every earlier world's trick.
    s.size = 7;
    s.devourers = 1;
    s.zone = i < 3 ? 2 : i < 9 ? 3 : 5;
    s.portals = i >= 3 ? (i >= 12 && i % 2 === 1 ? 2 : 1) : 0;
    s.emitters = i >= 15 ? 3 : i >= 12 ? 2 : 1;
    s.floes = i >= 6 && i % 3 === 0 ? 1 : 0;
    s.totems = i >= 6 && i % 3 === 1 ? 1 : i >= 9 && i % 3 === 2 ? 1 : 0;
    s.shapes = ['square', 'ell', 'domino', 'bar'];
    s.kMax = 2;
    s.ccw = i >= 12;
    s.seals = i >= 10 && i % 3 === 1 ? 1 : 0;
    s.splitters = i >= 4 && i % 2 === 0 && s.emitters < 3 ? 1 : 0;
    s.rotatable = i >= 7 && i % 4 === 3 ? 1 : 0;
    s.turns = s.emitters > 2 ? 2 : s.emitters > 1 ? 2 : lerp(3, 4, t);
    s.pass = i >= 3 && s.emitters < 3 ? 1 : 0;
    s.fixed = lerp(1, 2, t);
    s.blockers = lerp(2, 3, t);
    s.decoys = lerp(1, 2, t);
    if (i === 0) par(2, 3); else if (i < 3) par(3, 4); else if (i < 6) par(3, 5); else if (i < 12) par(4, 6); else if (!boss) par(5, 7); else par(6, 8);
    s.trap = i < 2 ? 0 : boss ? 2 : 1;
    s.slack = 4;
  }
  s.rotatable = Math.min(s.rotatable, s.emitters);
  // Make sure there are enough turnable mirrors on the light's path to reach the target par. Floes are path mirrors
  // too, every fixed mirror needs one more, and every totem turn is a tap no mirror needs to supply.
  const cap = ({ 4: 2, 5: 3, 6: 5, 7: 6 } as Record<number, number>)[s.size]!;
  const need = () => s.minPar - s.rotatable - s.seals - floeTaps(s) + s.fixed - s.totems + s.floes;
  s.turns = Math.min(Math.max(s.turns, Math.ceil(need() / s.emitters)), s.emitters > 2 ? 3 : s.emitters > 1 ? 4 : cap);
  while (s.emitters * s.turns < need() && s.fixed > 0) s.fixed--;
  return s;
}

export function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const reasons: Record<string, number> = {};
const fail = (why: string): null => { reasons[why] = (reasons[why] ?? 0) + 1; return null; };
type Raw = Omit<Level, 'title' | 'beat' | 'id' | 'chapter' | 'index'>;

/** Integer cells a set of beam segments passes through. */
function cellsOf(segs: { from: Point; to: Point; length: number }[]) {
  const out = new Set<string>();
  for (const s of segs) {
    const dx = Math.sign(s.to[0] - s.from[0]), dz = Math.sign(s.to[1] - s.from[1]);
    for (let k = 0; k <= Math.ceil(s.length); k++) out.add(`${Math.round(s.from[0] + dx * k)},${Math.round(s.from[1] + dz * k)}`);
  }
  return out;
}

/**
 * Where the light can reach within `depth` moves: each lit cell with the fewest moves that light it. Only states that
 * pass `when` count (for example, with every earlier seal already active).
 */
export function reachLight(level: Level, depth: number, when: (s: PlayState) => boolean = () => true, maxStates = 3000) {
  const encode = stateEncoder(level);
  const moves = tappables(level);
  const out = new Map<string, number>();
  const start = initialState(level);
  const seen = new Set([encode(start)]);
  let layer = [start];
  for (let d = 1; d <= depth && layer.length && seen.size < maxStates; d++) {
    const next: PlayState[] = [];
    for (const s of layer) for (const id of moves) {
      if (!canRotate(level, s, id)) continue;
      const ns = applyMove(level, s, id);
      const k = encode(ns);
      if (seen.has(k)) continue;
      seen.add(k);
      if (!ns.absorbed) next.push(ns);
      if (!when(ns)) continue;
      for (const c of cellsOf(traceState(level, ns).segments)) if (!out.has(c)) out.set(c, d);
    }
    layer = next;
  }
  return out;
}

/** Which cannon each lit mirror, floe or crystal belongs to on a traced board (a piece two beams cross belongs to both). */
function owners(level: Level, t: ReturnType<typeof traceBeam>) {
  const rootOf = (b: number): number => (b < level.emitters.length ? b : rootOf(t.parents[b]!));
  const out = new Map<string, Set<number>>();
  for (const h of t.hits) if ((h.kind === 'mirror' || h.kind === 'target') && h.id) out.set(h.id, new Set([...(out.get(h.id) ?? []), rootOf(h.branch)]));
  return out;
}

/** The level with one cluster frozen where it opens: its stones never turn and its totem is just a stone. */
const frozen = (level: Level, c: Cluster): Level => ({ ...level, clusters: level.clusters.filter(x => x !== c), blockers: [...level.blockers, c.totem.position] });

export function attempt(sp: Spec, rnd: () => number): Raw | null {
  const N = sp.size;
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
  const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
  const occ = new Set<string>();
  const beam = new Set<string>();
  const inb = (p: Point) => p[0] >= 0 && p[1] >= 0 && p[0] < N && p[1] < N;
  const free = (p: Point) => inb(p) && !occ.has(key(p));
  const add = (p: Point, d: Direction, k: number): Point => [p[0] + DELTA[d][0] * k, p[1] + DELTA[d][1] * k];
  const dirs: Direction[] = ['N', 'E', 'S', 'W'];
  const back = (d: Direction) => turnRight(turnRight(d));
  const parse = (k: string): Point => k.split(',').map(Number) as unknown as Point;

  // Cannons sit on the rim facing inward where possible, so they read as cannons rather than clutter.
  const emitters: Emitter[] = [];
  for (let e = 0; e < sp.emitters; e++) {
    let ok = false;
    for (let g = 0; g < 60 && !ok; g++) {
      const edge = rnd() < .85;
      let p: Point, d: Direction;
      if (edge) {
        const side = pick(dirs), along = Math.floor(rnd() * N);
        p = side === 'N' ? [along, 0] : side === 'S' ? [along, N - 1] : side === 'W' ? [0, along] : [N - 1, along];
        d = side === 'N' ? 'S' : side === 'S' ? 'N' : side === 'W' ? 'E' : 'W';
      } else { p = [Math.floor(rnd() * N), Math.floor(rnd() * N)]; d = pick(dirs); }
      if (!free(p) || beam.has(key(p)) || !free(add(p, d, 1)) || !free(add(p, d, 2)) || beam.has(key(add(p, d, 1)))) continue;
      emitters.push({ id: `e${e + 1}`, position: p, direction: d, ...(e < sp.rotatable ? { rotatable: true } : {}) });
      occ.add(key(p));
      ok = true;
    }
    if (!ok) return fail('emitter');
  }

  const mirrors: { p: Point; o: Orientation; din: Direction }[] = [];
  const targets: Point[] = [];
  const splitters: Point[] = [];
  const portals: [Point, Point][] = [];
  interface Task { pos: Point; dir: Direction; turns: number; pass: number; splits: number; portals: number }
  const share = (total: number, k: number, parts: number) => Math.floor(total / parts) + (k < total % parts ? 1 : 0);
  const stack: Task[] = emitters.map((e, k) => ({ pos: e.position, dir: e.direction, turns: sp.turns,
    pass: share(sp.pass, k, sp.emitters), splits: share(sp.splitters, k, sp.emitters), portals: share(sp.portals, k, sp.emitters) })).reverse();
  while (stack.length) {
    const task = stack.pop()!;
    let { pos, dir } = task;
    for (let guard = 0; ; guard++) {
      if (guard > 30) return fail('guard');
      const lengths: number[] = [];
      for (let L = 1; L < N; L++) {
        const p = add(pos, dir, L);
        if (!free(p)) break;
        if (!beam.has(key(p))) lengths.push(L);
      }
      if (!lengths.length) return fail('stuck');
      const done = task.turns === 0 && task.splits === 0 && task.portals === 0 && task.pass === 0;
      const events: string[] = done ? ['end'] : shuffle([
        ...(task.turns > 0 ? ['mirror', 'mirror', 'mirror'] : []),
        ...(task.splits > 0 ? ['split', 'split'] : []),
        ...(task.portals > 0 ? ['portal', 'portal'] : []),
        ...(task.pass > 0 ? ['pass'] : []),
      ]);
      const fits = (ev: string, L: number) => {
        const E = add(pos, dir, L);
        if (ev === 'pass') return free(add(E, dir, 1));
        if (ev === 'mirror') return [turnLeft(dir), turnRight(dir)].some(nd => free(add(E, nd, 1)));
        if (ev === 'split') return free(add(E, turnLeft(dir), 1)) && free(add(E, turnRight(dir), 1));
        return true;
      };
      let ev = '', choices: number[] = [];
      for (const candidate of events) {
        choices = lengths.filter(l => fits(candidate, l));
        if (choices.length) { ev = candidate; break; }
      }
      if (!ev) return fail('event');
      const longish = choices.filter(l => l >= 2);
      const L = pick(longish.length && rnd() < .75 ? longish : choices);
      const E = add(pos, dir, L);
      for (let k = 1; k <= L; k++) beam.add(key(add(pos, dir, k)));
      occ.add(key(E));
      if (ev === 'end') { targets.push(E); break; }
      if (ev === 'pass') { targets.push(E); task.pass--; pos = E; continue; }
      if (ev === 'mirror') {
        const nd = pick([turnLeft(dir), turnRight(dir)].filter(d => free(add(E, d, 1))));
        mirrors.push({ p: E, o: orientationFor(dir, nd)!, din: dir });
        task.turns--; dir = nd; pos = E; continue;
      }
      if (ev === 'split') {
        const l = turnLeft(dir), r = turnRight(dir);
        splitters.push(E);
        task.splits--;
        const half = (v: number) => { const a = Math.floor(v / 2 + (rnd() < .5 ? 0 : .5)); return [a, v - a] as const; };
        const [t1, t2] = half(task.turns), [p1, p2] = half(task.pass), [s1, s2] = half(task.splits), [q1, q2] = half(task.portals);
        stack.push({ pos: E, dir: r, turns: t2, pass: p2, splits: s2, portals: q2 });
        task.turns = t1; task.pass = p1; task.splits = s1; task.portals = q1;
        dir = l; pos = E; continue;
      }
      const exits: Point[] = [];
      for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
        const X: Point = [x, y];
        if (free(X) && !beam.has(key(X)) && free(add(X, dir, 1)) && Math.abs(x - E[0]) + Math.abs(y - E[1]) > 2) exits.push(X);
      }
      if (!exits.length) return fail('portal');
      const X = pick(exits);
      occ.add(key(X)); beam.add(key(X));
      portals.push([E, X]);
      task.portals--; pos = X;
    }
  }

  // Drift ice: some path mirrors are frozen into floes on straight tracks of open ice. A plain floe's track ends at its
  // solved cell, so one glide brings it home. A stopped floe's solved cell lies mid-track: it only halts there against a
  // stopper floe parked on the next cell, whose own track crosses there; a stopper on the light's road must leave again.
  interface FloePlan { m?: number; track: Point[]; solved: number; open: number; facing: 1 | -1; o: Orientation }
  const plans: FloePlan[] = [];
  const iced = new Set<number>();
  if (sp.floes) {
    const trackFree = (p: Point) => free(p) && !plans.some(f => f.track.some(q => key(q) === key(p)));
    /** The open cells from `from` (exclusive) going `d`, at most `max`. */
    const run = (from: Point, d: Direction, max: number) => {
      const out: Point[] = [];
      for (let k = 1; k <= max; k++) { const p = add(from, d, k); if (!trackFree(p)) break; out.push(p); }
      return out;
    };
    let stoppers = sp.stoppers;
    for (const i of shuffle(mirrors.map((_, k) => k))) {
      if (plans.filter(f => f.m !== undefined).length >= sp.floes) break;
      const m = mirrors[i]!;
      const out = reflect(m.din, m.o);
      if (stoppers > 0) {
        // Through the solved cell E: approach cells behind it, then the stop cell c just past it.
        const ways = shuffle(sp.leave ? [out] : [m.din, back(out)]);
        let made = false;
        for (const d of ways) {
          const c = add(m.p, d, 1);
          if (!trackFree(c) || beam.has(key(c)) !== sp.leave) continue;
          const approach = run(m.p, back(d), sp.trackMax - 2);
          if (!approach.length) continue;
          const side = shuffle([turnLeft(d), turnRight(d)]).map(p => ({ p, cells: run(c, p, 2) })).find(x => x.cells.length);
          if (!side) continue;
          const track = [...approach.reverse(), m.p, c];
          plans.push({ m: i, track, solved: approach.length, open: 0, facing: 1, o: m.o });
          iced.add(i);
          // The stopper's track starts on c and runs out to the side; it opens at the far end, facing c.
          const st = [c, ...side.cells.slice(0, 1 + Math.floor(rnd() * side.cells.length))];
          plans.push({ track: st, solved: sp.leave ? st.length - 1 : 0, open: st.length - 1, facing: -1, o: (rnd() < .5 ? 0 : 1) as Orientation });
          stoppers--;
          made = true;
          break;
        }
        if (made) continue;
      }
      // A plain floe: the track runs off one side of E, and the floe opens at its far end.
      const options = shuffle([...dirs]).map(d => ({ d, cells: run(m.p, d, sp.trackMax - 1) })).filter(x => x.cells.length);
      if (!options.length) continue;
      const { cells } = options[0]!;
      const len = 1 + Math.floor(rnd() * cells.length);
      const track = [m.p, ...cells.slice(0, len)];
      plans.push({ m: i, track, solved: 0, open: track.length - 1, facing: -1, o: m.o });
      iced.add(i);
    }
    if (plans.filter(f => f.m !== undefined).length < sp.floes || stoppers > 0) return fail('floe-space');
    for (const f of plans) for (const p of f.track) occ.add(key(p));
  }

  // Cells a wrongly turned mirror (or cannon) would shine into: the best spots for traps, seals and red herrings.
  const lure = new Set<string>();
  mirrors.forEach((m, i) => {
    if (iced.has(i)) return;
    const wrong = reflect(m.din, (1 - m.o) as Orientation);
    for (let k = 1; k <= 3; k++) { const p = add(m.p, wrong, k); if (!inb(p)) break; lure.add(key(p)); }
  });
  for (const e of emitters) if (e.rotatable) for (const d of dirs) if (d !== e.direction) for (let k = 1; k <= 3; k++) {
    const p = add(e.position, d, k); if (!inb(p)) break; lure.add(key(p));
  }

  const empty: Point[] = [];
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (!occ.has(`${x},${y}`) && !beam.has(`${x},${y}`)) empty.push([x, y]);
  const isEmpty = (k: string) => empty.some(p => key(p) === k);
  const claim = (k: string) => { const i = empty.findIndex(p => key(p) === k); if (i >= 0) empty.splice(i, 1); };
  const take = (count: number, prefer: (p: Point) => boolean, allowed: (p: Point) => boolean = () => true) => {
    const out: Point[] = [];
    for (let k = 0; k < count; k++) {
      const pool = empty.filter(allowed);
      if (!pool.length) break;
      const good = pool.filter(prefer);
      const p = pick(good.length && rnd() < .8 ? good : pool);
      empty.splice(empty.indexOf(p), 1);
      out.push(p);
    }
    return out;
  };
  const nearBeam = (p: Point) => dirs.some(d => beam.has(key(add(p, d, 1))));
  // Seals and devourers belong where a wrong turn sends the light, so stones and spare mirrors keep off those tiles.
  const keepClear = sp.seals || sp.devourers ? lure : new Set<string>();
  const clear = (p: Point) => !keepClear.has(key(p));
  const blockers = take(sp.blockers, nearBeam, clear);
  const decoys = take(sp.decoys, p => (keepClear.size ? nearBeam(p) : lure.has(key(p)) || nearBeam(p)), clear).map(p => ({ p, o: (rnd() < .5 ? 0 : 1) as Orientation }));
  if (blockers.length < sp.blockers || decoys.length < sp.decoys) return fail('space');

  const all: Mirror[] = [
    ...mirrors.filter((_, i) => !iced.has(i)).map((m, i) => ({ id: `m${i + 1}`, position: m.p, orientation: m.o, fixed: false })),
    ...decoys.map((m, i) => ({ id: `d${i + 1}`, position: m.p, orientation: m.o, fixed: false })),
  ];
  const sol = all.slice(0, mirrors.length - iced.size);
  const pool = shuffle([...sol]);
  for (let k = 0; k < sp.fixed && pool.length > 2; k++) pool.pop()!.fixed = true;
  const floeAt = (which: 'solved' | 'open'): Floe[] => plans.map((f, i) => ({ id: `f${i + 1}`, track: f.track, at: f[which], facing: which === 'open' ? f.facing : 1, orientation: f.o }));
  // Not used any more, but its draws stay so every board that had no vines keeps exactly the same random stream.
  shuffle(all.filter(m => !m.fixed));
  const carved = Object.fromEntries(all.map(m => [m.id, m.orientation])) as Record<string, Orientation>;
  const carvedAims = Object.fromEntries(emitters.map(e => [e.id, e.direction])) as Record<string, Direction>;
  // Engine indexes are cached per level object, so every change below creates a fresh object.
  let level: Level = {
    id: 0, chapter: 0, index: 0, title: '', beat: '', size: N,
    emitters, mirrors: all, targets: targets.map((p, i) => ({ id: `c${i + 1}`, position: p })),
    blockers, splitters: splitters.map((p, i) => ({ id: `s${i + 1}`, position: p })),
    portals: portals.map(([a, b], i) => ({ id: `p${i + 1}`, position: a, exit: b })), clusters: [], floes: floeAt('solved'),
    seals: [], gates: [], devourers: [],
    solution: carved, solutionAims: carvedAims, solutionPlaces: {}, solutionTurns: {}, solutionMoves: [], par: 0, twoStar: 0, maxMoves: 0, boss: sp.boss, mechanics: [],
  };
  const solved = traceBeam(level, carved, carvedAims);
  if (!solved.won) return fail('solution');
  const shone = cellsOf(solved.segments);

  // Scramble: tap a set of path mirrors, shuffle spare mirrors, swing turnable cannons away and send every floe to the far
  // end of its track. Rootbound clusters are turned back afterwards, so their quarter turns count towards the target par.
  const movable = all.filter(m => !m.fixed);
  const pathTaps = shuffle([...new Set(movable.filter(m => m.id.startsWith('m')).map(m => m.id))]);
  const orient = { ...carved };
  const aims = { ...carvedAims };
  const ks = Array.from({ length: sp.totems }, () => 1 + Math.floor(rnd() * sp.kMax));
  const want = sp.minPar + Math.floor(rnd() * (sp.maxPar - sp.minPar + 1));
  const turns = emitters.filter(e => e.rotatable).length;
  const totemTaps = ks.reduce((a, b) => a + b, 0);
  const taps = Math.min(pathTaps.length, Math.max(sp.turns === 0 || sp.floes || sp.totems ? 0 : 1, want - turns - sp.seals - floeTaps(sp) - totemTaps));
  const toggle = (id: string) => { orient[id] = orient[id] === 0 ? 1 : 0; };
  pathTaps.slice(0, taps).forEach(toggle);
  for (const d of movable.filter(m => m.id.startsWith('d'))) if (rnd() < .5) toggle(d.id);
  for (const e of emitters) if (e.rotatable) {
    const spin = 1 + Math.floor(rnd() * 3);
    let d = e.direction;
    for (let k = 0; k < 4 - spin; k++) d = turnRight(d);
    aims[e.id] = d;
  }
  level = { ...level, mirrors: all.map(m => ({ ...m, orientation: orient[m.id]! })), emitters: emitters.map(e => ({ ...e, direction: aims[e.id]! })), floes: floeAt('open') };

  // Rootbound totems: clusters are carved out of the solved board, then each is turned back k quarter turns, so the level
  // opens with its stones turned away from home. Every cell a cluster or its totem could ever use is kept free of seals,
  // gates and the Devourer, which could otherwise jam it for good.
  const orbit = new Set<string>();
  if (sp.totems) {
    const made = carveClusters(level, sp, ks, shone, rnd);
    if (!made) return fail('cluster-space');
    level = made;
    for (const m of level.mirrors) orient[m.id] = m.orientation;
    for (const e of level.emitters) aims[e.id] = e.direction;
    for (const c of level.clusters) {
      orbit.add(key(c.totem.position));
      for (let st = 0; st < 4; st++) for (const p of [...footprint(level, c, st), ...sweepOf(level, c, st)]) orbit.add(key(p));
    }
    for (const k of orbit) claim(k);
  }
  const opening = cellsOf(traceBeam(level, orient, aims).segments);
  // Path cells that hold no piece: where gates can stand across the light's road. Later cells leave more mirrors
  // upstream that can send the light elsewhere first.
  const along = new Map<string, number>();
  for (const sg of solved.segments) {
    const dx = Math.sign(sg.to[0] - sg.from[0]), dz = Math.sign(sg.to[1] - sg.from[1]);
    for (let k = 0; k <= Math.ceil(sg.length); k++) {
      const c = `${Math.round(sg.from[0] + dx * k)},${Math.round(sg.from[1] + dz * k)}`;
      along.set(c, Math.min(along.get(c) ?? Infinity, sg.start + k));
    }
  }
  const road = [...shone].filter(k => beam.has(k) && !occ.has(k) && !orbit.has(k));
  const late = (cells: string[]) => { const sorted = [...cells].sort((a, b) => (along.get(a) ?? 0) - (along.get(b) ?? 0)); return shuffle(sorted.slice(Math.floor(sorted.length / 2))); };

  /** A free cell the light really reaches off its road, preferring the fewest moves; optionally within `near`. */
  const reachable = (when?: (s: PlayState) => boolean, near?: (p: Point) => boolean, depth = 4) => {
    const reach = reachLight(level, depth, when, 6000);
    const spots = [...reach].filter(([c]) => isEmpty(c) && !shone.has(c) && !opening.has(c) && (!near || near(parse(c))));
    if (!spots.length) return undefined;
    const best = Math.min(...spots.map(([, d]) => d));
    const pool = spots.filter(([, d]) => d <= best + (rnd() < .5 ? 1 : 0)).map(([c]) => c);
    const spot = pick(pool);
    claim(spot);
    return parse(spot);
  };

  // Solar seals: each closed gate stands across the light's road; its seal lies where a different aim of the light reaches
  // (with every earlier seal already active), so the seals must be woken first, in order.
  const used = new Set<string>();
  if (sp.seals) {
    const roadFree = [...late(road), ...shuffle(road)];
    for (let j = 1; j <= sp.seals; j++) {
      const earlier = level.seals, gatesBefore = level.gates;
      let spot: Point | undefined;
      // A few gate positions are tried: the seal must be reachable while its gate still stands closed.
      for (let tries = 0; tries < 4 && !spot; tries++) {
        const g = roadFree.find(k => !used.has(k));
        if (!g) return fail('gate-space');
        used.add(g);
        level = { ...level, gates: [...gatesBefore, { id: `gate${j}`, position: parse(g), open: false }] };
        spot = reachable(s => earlier.every(x => s.sealed[x.id]), undefined, 4 + earlier.length);
      }
      if (!spot) return fail(`seal-space-${j}`);
      level = { ...level, seals: [...earlier, { id: `seal${j}`, position: spot, order: j, toggles: [`gate${j}`] }] };
    }
  }

  // The Light Devourer waits where a wrong turn sends the light, clear of both the opening and the solved beams.
  if (sp.devourers) {
    const devourers: Devourer[] = [];
    for (let k = 0; k < sp.devourers; k++) {
      const safe = (p: Point) => !shone.has(key(p)) && !opening.has(key(p));
      // Where a tempting move sends the light, so the danger is real; otherwise beside a wrong turn's path.
      const center = reachable() ?? take(1, p => lure.has(key(p)) || dirs.some(d => lure.has(key(add(p, d, 1)))), safe)[0];
      if (!center) return fail('devourer-space');
      const around = shuffle(dirs.map(d => add(center, d, 1)).filter(p => inb(p) && isEmpty(key(p)) && safe(p)));
      const zone = [center, ...around.slice(0, sp.zone - 1)];
      if (zone.length < Math.min(sp.zone, 2)) return fail('devourer-zone');
      zone.slice(1).forEach(p => claim(key(p)));
      devourers.push({ id: `void${k + 1}`, position: center, zone });
    }
    level = { ...level, devourers };
  }

  const start = initialState(level);
  const startTrace = traceState(level, start);
  if (startTrace.won) return fail('pre-solved');
  if (start.absorbed || Object.keys(start.sealed).length) return fail('opening-acts');
  const path = solve(level, start, 80000);
  if (!path) return fail('unsolved');
  if (path.length < sp.minPar) return fail('par-low');
  if (path.length > sp.maxPar) return fail('par-high');
  const end = replay(level, path);
  const endTrace = traceState(level, end);
  if (endTrace.loop) return fail('loop');
  // Every wormhole carries the solved light: the board shows it, so the answer uses it.
  const entered = new Set(endTrace.hits.filter(h => h.kind === 'portal').map(h => key(h.point)));
  if (level.portals.some(p => !entered.has(key(p.position)))) return fail('portal-unused');
  if (sp.rotatable && !path.some(id => id.startsWith('e'))) return fail('turn-unused');
  if (level.seals.some(s => !end.sealed[s.id])) return fail('seal-unused');
  const without = (patch: Partial<Level>) => { const l = { ...level, ...patch }; return solve(l, initialState(l), 80000); };
  if (level.floes.length) {
    if (!path.some(id => id.startsWith('f'))) return fail('floe-unused');
    // A floe halted mid-track can only have stopped against another floe; a stopper that had to leave is gone from beside it.
    const mid = level.floes.filter(f => end.places[f.id]! > 0 && end.places[f.id]! < f.track.length - 1);
    if (sp.stoppers && !mid.length) return fail('stop-unused');
    if (sp.leave) {
      const cells = new Set(level.floes.map(f => key(f.track[end.places[f.id]!]!)));
      const alone = mid.some(f => [-1, 1].every(d => { const q = f.track[end.places[f.id]! + d]; return !q || !cells.has(key(q)); }));
      if (!alone) return fail('stopper-stays');
    }
  }
  if (level.clusters.length) {
    // Every totem is turned in the best solution, and each matters: with its cluster frozen where it opens, the level
    // cannot be won at all, or only with at least two more taps.
    if (level.clusters.some(c => !path.includes(c.totem.id))) return fail('totem-unused');
    for (const c of level.clusters) {
      const still = frozen(level, c);
      const alt = solve(still, initialState(still), 80000);
      if (alt && alt.length < path.length + 2) return fail('totem-idle');
    }
    // A jam: a cluster the solution turns cannot turn at the start; another must move out of its way first.
    if (sp.jam && !level.clusters.some(c => path.includes(c.totem.id) && !canRotate(level, start, c.totem.id))) return fail('jam-unused');
    if (sp.cross) {
      // A cluster carries pieces of two cannons' beams (or one cannon and a piece of another's beam): turning it moves both.
      const own = owners(level, traceState(level, end));
      const across = level.clusters.some(c => {
        const cannons = new Set<number>();
        level.emitters.forEach((e, n) => { if (clusterAt(level, e.position) === c) cannons.add(n); });
        for (const p of [...level.mirrors, ...level.targets]) if (clusterAt(level, p.position) === c) own.get(p.id)?.forEach(n => cannons.add(n));
        return cannons.size >= 2;
      });
      if (!across) return fail('cross-unused');
    }
  }
  if (level.devourers.length) {
    // The Devourer must matter: a tempting first tap feeds it, or it guards a shortcut.
    const danger = tappables(level).some(id => canRotate(level, start, id) && applyMove(level, start, id).absorbed);
    const open = without({ devourers: [] });
    if (!danger && !(open && open.length < path.length)) return fail('devourer-idle');
  }
  if (sp.trap >= 1 && greedyPlay(level, start, path.length, true) !== null) return fail('trap1');
  if (sp.trap >= 2 && greedyPlay(level, start, path.length, false) !== null) return fail('trap2');
  const par = path.length, twoStar = par + 2, maxMoves = par + sp.slack;
  // Completion must stay possible without a perfect score, and running out of moves (or feeding the Devourer) must lose.
  const wins = winnableAt({ ...level, maxMoves }, maxMoves);
  if (![...wins].some(k => k > par && k <= twoStar)) return fail('no-two-star');
  if (![...wins].some(k => k > twoStar && k <= maxMoves)) return fail('no-one-star');
  if (!losingSequence({ ...level, par, twoStar, maxMoves })) return fail('no-loss');
  level = { ...level, par, twoStar, maxMoves, solutionMoves: path, solution: { ...end.orientations }, solutionAims: { ...end.aims },
    solutionPlaces: { ...end.places }, solutionTurns: { ...end.turns } };
  const mech = new Set<Mechanic>(['mirror', 'limit']);
  if (level.blockers.length) mech.add('blocker');
  if (level.mirrors.some(m => m.fixed)) mech.add('fixed');
  if (decoys.length) mech.add('decoy');
  if (level.targets.length > level.emitters.length) mech.add('multi');
  if (level.clusters.length) mech.add('totem');
  if (level.emitters.some(e => clusterAt(level, e.position))) mech.add('ride');
  if (level.clusters.length >= 2) mech.add('totems');
  if (level.clusters.some(c => path.includes(c.totem.id) && !canRotate(level, start, c.totem.id))) mech.add('jam');
  if (splitters.length) mech.add('splitter');
  if (level.floes.length) mech.add('floe');
  if (sp.stoppers) mech.add('stop');
  if (portals.length) mech.add('portal');
  if (level.emitters.length === 2) mech.add('twin');
  if (level.emitters.length >= 3) mech.add('triple');
  if (level.emitters.some(e => e.rotatable)) mech.add('turn');
  if (level.seals.length) mech.add('seal');
  if (level.devourers.length) mech.add('devourer');
  level.mechanics = [...mech];
  const { id: _i, chapter: _c, index: _x, title: _t, beat: _b, ...raw } = level;
  // Chapter modifiers are only stored where a level uses them.
  const lean = raw as Partial<Raw>;
  for (const k of ['clusters', 'floes', 'seals', 'gates', 'devourers'] as const) if (!lean[k]!.length) delete lean[k];
  if (!level.floes.length) delete lean.solutionPlaces;
  if (!level.clusters.length) delete lean.solutionTurns;
  return lean as Raw;
}

/**
 * Carves `sp.totems` rootbound clusters out of a board laid out as solved, and turns cluster j back `ks[j]` quarter turns.
 * Returns the board as it opens (every piece on a cluster moved, mirrors re-slanted, cannons re-aimed), or null when the
 * board has no room. Each cluster holds what its level teaches (a path mirror; a stone on the light's road at the start;
 * a riding cannon), its totem stands beside it, clear of every cell any cluster could ever pass over, and the turns home
 * are legal in at least one order. On jam levels the second cluster opens across the first one's way home, so the first
 * is blocked at the start and only frees up once the second has turned home.
 */
function carveClusters(solvedLevel: Level, sp: Spec, ks: number[], shone: Set<string>, rnd: () => number): Level | null {
  const N = sp.size;
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
  const inb = (p: Point) => p[0] >= 0 && p[1] >= 0 && p[0] < N && p[1] < N;
  let level = solvedLevel;
  /** Moves every piece standing on the `on` cells by `move`, re-slanting mirrors and re-aiming cannons for `k` turns back. */
  const turnBack = (l: Level, on: Set<string>, move: (p: Point) => Point, k: number, turn: 1 | -1): Level => {
    const at = (p: Point) => on.has(key(p));
    const aim = (d: Direction) => { for (let n = 0; n < k; n++) d = (turn > 0 ? turnLeft : turnRight)(d); return d; };
    return {
      ...l,
      mirrors: l.mirrors.map(m => (at(m.position) ? { ...m, position: move(m.position), orientation: (k % 2 ? 1 - m.orientation : m.orientation) as Orientation } : m)),
      emitters: l.emitters.map(e => (at(e.position) ? { ...e, position: move(e.position), direction: aim(e.direction) } : e)),
      targets: l.targets.map(t => (at(t.position) ? { ...t, position: move(t.position) } : t)),
      splitters: l.splitters.map(s => (at(s.position) ? { ...s, position: move(s.position) } : s)),
      blockers: l.blockers.map(b => (at(b) ? move(b) : b)),
    };
  };
  /** Every cell holding a piece of any kind, a floe track, a cluster stone (unturned) or a totem. */
  const taken = (l: Level) => {
    const out = new Set<string>();
    for (const x of [...l.emitters, ...l.mirrors, ...l.targets, ...l.splitters]) out.add(key(x.position));
    for (const b of l.blockers) out.add(key(b));
    for (const p of l.portals) { out.add(key(p.position)); out.add(key(p.exit)); }
    for (const f of l.floes) for (const p of f.track) out.add(key(p));
    for (const c of l.clusters) { out.add(key(c.totem.position)); for (const p of c.cells) out.add(key(p)); }
    return out;
  };
  /**
   * Cells a new cluster may not cover, at home or where it opens: portals, floe tracks, totems, and the earlier clusters'
   * cells over their whole orbit (so the clusters never meet, and any order of turns works) or, on jam levels, only where
   * they open, where they end and what they sweep on the way (so a later cluster can stand in an earlier one's reach).
   */
  const unridable = (l: Level, whole: boolean) => {
    const out = new Set<string>();
    for (const p of l.portals) { out.add(key(p.position)); out.add(key(p.exit)); }
    for (const f of l.floes) for (const p of f.track) out.add(key(p));
    for (const c of l.clusters) {
      out.add(key(c.totem.position));
      const steps = whole ? [0, 1, 2, 3] : Array.from({ length: solvedTurns[c.id]! }, (_, st) => st);
      for (const st of steps) for (const p of [...footprint(l, c, st), ...sweepOf(l, c, st)]) out.add(key(p));
      for (const p of footprint(l, c, solvedTurns[c.id]!)) out.add(key(p));
    }
    return out;
  };
  const solvedTurns: Record<string, number> = {};
  for (let j = 0; j < sp.totems; j++) {
    const k = ks[j]!;
    // On jam levels the second cluster is the jammer: it opens across the first cluster's way home and must move first.
    const jamNow = sp.jam && j > 0;
    const first = level.clusters[0];
    /** The cells the first cluster's first turn needs clear: what its stones pass over and land on, beyond where they stand. */
    const need = jamNow ? (() => {
      const own = new Set(footprint(level, first!, 0).map(key));
      return sweepOf(level, first!, 0).filter(p => inb(p) && !own.has(key(p)));
    })() : [];
    let made: Level | undefined;
    for (let tries = 0; tries < (jamNow ? 240 : 80) && !made; tries++) {
      // A turntable never leaves its own cells, so nothing could ever stand in its way: a cluster to be jammed must swing.
      const shape = pick(sp.jam && j === 0 ? sp.shapes.filter(s => s !== 'square') : sp.shapes);
      const corner = shape === 'square';
      let pivot: Point = corner ? [Math.floor(rnd() * (N - 1)) + .5, Math.floor(rnd() * (N - 1)) + .5] : [Math.floor(rnd() * N), Math.floor(rnd() * N)];
      const spin = Math.floor(rnd() * 4);
      const turn: 1 | -1 = sp.ccw && (j === 1 || rnd() < .3) ? -1 : 1;
      if (jamNow) {
        // Placed so that one of its stones opens exactly on a cell the first cluster's turn needs: that stone, turned
        // back k quarter turns from home, lands there, which fixes the pivot.
        if (!need.length) return null;
        const offs = SHAPES[shape];
        const off = offs[Math.floor(rnd() * offs.length)]!;
        const q = pick(need), r = turnPoint(off, [0, 0], spin - turn * k);
        pivot = [q[0] - r[0], q[1] - r[1]];
      }
      const home = SHAPES[shape].map(o => turnPoint([pivot[0] + o[0], pivot[1] + o[1]], pivot, spin));
      if (!home.every(inb)) continue;
      // Home stays clear of every earlier cluster's whole orbit (or, for a jammer, of the first cluster's way home).
      const blocked = unridable(level, !jamNow);
      if (home.some(p => blocked.has(key(p)))) continue;
      const homeSet = new Set(home.map(key));
      const holds = <T extends { position: Point }>(xs: T[]) => xs.filter(x => homeSet.has(key(x.position)));
      const pathMirrors = holds(level.mirrors).filter(m => m.id.startsWith('m'));
      const cannons = holds(level.emitters);
      // A jammer matters through the way it blocks, so it may carry anything (or nothing) except a cannon.
      if (jamNow ? cannons.length : sp.ride === 'must' ? !cannons.length : sp.ride === 'no' ? cannons.length || !pathMirrors.length : !pathMirrors.length && !cannons.length) continue;
      const back = (p: Point) => turnPoint(p, pivot, -turn * k);
      const opening = home.map(back);
      if (!opening.every(inb)) continue;
      // The cells it opens on are free, apart from its own pieces still standing at home. A jammer opens on the cells the
      // first cluster's turn needs (but never on that cluster itself).
      const others = taken(level);
      const openBlocked = jamNow ? new Set([...unridable({ ...level, clusters: [] }, true), ...footprint(level, first!, 0).map(key), ...footprint(level, first!, solvedTurns[first!.id]!).map(key),
        key(first!.totem.position)]) : blocked;
      if (opening.some(p => !homeSet.has(key(p)) && (others.has(key(p)) || openBlocked.has(key(p))))) continue;
      if (jamNow && !opening.some(p => need.some(q => key(q) === key(p)))) continue;
      let next = level;
      if (sp.stone) {
        // A stone rides the cluster: clear of the solved light at home, but standing on its road when the level opens.
        const spots = home.filter(p => !others.has(key(p)) && !shone.has(key(p)) && shone.has(key(back(p))) && !level.emitters.some(e => key(e.position) === key(back(p))));
        if (!holds(level.blockers.map(b => ({ position: b }))).some(b => shone.has(key(back(b.position))))) {
          if (!spots.length) continue;
          next = { ...next, blockers: [...next.blockers, pick(spots)] };
        }
      }
      next = turnBack(next, homeSet, back, k, turn);
      const c: Cluster = { id: `r${j + 1}`, totem: { id: `t${j + 1}`, position: [-1, -1] }, cells: opening, pivot, turn };
      next = { ...next, clusters: [...next.clusters, c] };
      // The totem: on a free cell beside the cluster's stones, off the solved light, and clear of every cell any cluster
      // can ever cover or pass over, so a totem never stands in a cluster's way.
      const free = taken(next), orbits = new Set<string>();
      for (const x of next.clusters) for (let st = 0; st < 4; st++) for (const p of [...footprint(next, x, st), ...sweepOf(next, x, st)]) orbits.add(key(p));
      const spots: Point[] = [];
      for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) {
        const p: Point = [x, z];
        if (free.has(key(p)) || orbits.has(key(p)) || shone.has(key(p))) continue;
        if (!opening.some(q => Math.abs(q[0] - x) <= 1 && Math.abs(q[1] - z) <= 1)) continue;
        spots.push(p);
      }
      if (!spots.length) continue;
      const side = spots.filter(p => opening.some(q => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) === 1));
      const spot = pick(side.length ? side : spots);
      next = { ...next, clusters: [...level.clusters, { ...c, totem: { ...c.totem, position: spot } }] };
      // Its turns home must be legal with the earlier clusters where they open and where they end, so any order works.
      // A jammer instead goes home first (the first cluster still where it opens), and only then is the first one free.
      const me = next.clusters.at(-1)!;
      const at = (mine: number, others: 'open' | 'home') => Object.fromEntries(next.clusters.map(x => [x.id, x === me ? mine : others === 'open' ? 0 : solvedTurns[x.id]!]));
      let legal = true;
      for (let st = 0; st < k && legal; st++) legal = !turnBlocks(next, { turns: at(st, 'open') }, me).length;
      if (!jamNow) for (let st = 0; st < k && legal; st++) legal = !turnBlocks(next, { turns: at(st, 'home') }, me).length;
      if (!legal) continue;
      if (jamNow) {
        const f = next.clusters[0]!, kf = solvedTurns[f.id]!;
        if (!turnBlocks(next, { turns: at(0, 'open') }, f).length) continue;
        for (let st = 0; st < kf && legal; st++) legal = !turnBlocks(next, { turns: { ...at(k, 'open'), [f.id]: st } }, f).length;
        if (!legal) continue;
      }
      solvedTurns[c.id] = k;
      made = next;
    }
    if (!made) return null;
    level = made;
  }
  return level;
}

function build(c: number, i: number): Raw {
  let sp = spec(c, i);
  for (let a = 0; ; a++) {
    if (a > 0 && a % 2500 === 0) {
      // Rarely a spec is too tight for the board; ease the trap rule first, then the target par.
      sp = sp.trap > 1 ? { ...sp, trap: sp.trap - 1 } : { ...sp, minPar: Math.max(1, sp.minPar - 1), maxPar: sp.maxPar + (a % 5000 === 0 ? 1 : 0), trap: Math.max(0, sp.trap - (a % 5000 === 0 ? 1 : 0)) };
      console.warn(`\nrelaxing chapter ${c + 1} level ${i + 1}: par ${sp.minPar}-${sp.maxPar} trap ${sp.trap}`, JSON.stringify(reasons));
    }
    const found = attempt(sp, mulberry((c * 1000 + i) * 7919 + a));
    if (found) return found;
  }
}

if (process.env.MM_DEBUG) {
  const [c, i] = process.env.MM_DEBUG.split(',').map(Number);
  const sp = spec(c!, i!);
  let ok = 0;
  const t0 = Date.now();
  for (let a = 0; a < Number(process.env.MM_TRIES ?? 400); a++) if (attempt(sp, mulberry(a))) ok++;
  console.log(JSON.stringify(sp), 'ok', ok, `${Date.now() - t0}ms`, reasons);
  process.exit(0);
}
const out: Raw[] = [];
const only = process.env.MM_CHAPTER === undefined ? undefined : Number(process.env.MM_CHAPTER);
for (let c = 0; c < 5; c++) {
  if (only !== undefined && c !== only) continue;
  const t0 = Date.now();
  for (let i = 0; i < PER_CHAPTER; i++) {
    const found = build(c, i);
    out.push(found);
    process.stdout.write(`${c * PER_CHAPTER + i + 1}:${found.par}/${found.emitters.length} `);
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)}s)`);
}
if (only === undefined) {
  writeFileSync(join(__dirname, '..', 'src', 'game', 'levels.json'), JSON.stringify(out));
  console.log(`Wrote ${out.length} levels`);
} else if (process.env.MM_OUT) {
  // One chapter at a time (chapters can be built in parallel and merged in order).
  writeFileSync(process.env.MM_OUT, JSON.stringify(out));
  console.log(`Wrote chapter ${only + 1} to ${process.env.MM_OUT}`);
}
