import { Cluster, Direction, Floe, Gate, Level, Mirror, Orientation, PlayState, Point, Seal, Trace, BeamSegment, BeamHit } from './types';

export const DELTA: Record<Direction, Point> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const REFLECT: Record<Orientation, Record<Direction, Direction>> = {
  0: { N: 'E', E: 'N', S: 'W', W: 'S' },
  1: { N: 'W', W: 'N', S: 'E', E: 'S' },
};
const LEFT: Record<Direction, Direction> = { N: 'W', W: 'S', S: 'E', E: 'N' };
const RIGHT: Record<Direction, Direction> = { N: 'E', E: 'S', S: 'W', W: 'N' };

export const key = (p: Point) => `${p[0]},${p[1]}`;
export const reflect = (d: Direction, o: Orientation) => REFLECT[o][d];
export const turnLeft = (d: Direction) => LEFT[d];
export const turnRight = (d: Direction) => RIGHT[d];
export const orientationFor = (incoming: Direction, outgoing: Direction): Orientation | undefined =>
  REFLECT[0][incoming] === outgoing ? 0 : REFLECT[1][incoming] === outgoing ? 1 : undefined;

/** Where the pieces stand, by cell: mirrors, solid cells (stones, cannons, totems), crystals, prisms, and each cannon's cell by id. */
export interface Pieces {
  mirrors: Map<string, Mirror>;
  blockers: Set<string>;
  targets: Map<string, string>;
  splitters: Set<string>;
  emitters: Map<string, Point>;
}
interface Index {
  /** The pieces as the level opens (every cluster unturned). */
  pieces: Pieces;
  mirrorsById: Map<string, Mirror>;
  portals: Map<string, Point>;
  gates: Map<string, Gate>;
  seals: Map<string, Seal>;
  floes: Map<string, Floe>;
  /** Devourer id per danger-zone cell. */
  zone: Map<string, string>;
  /** Seals in activation order. */
  sealOrder: Seal[];
  /** Rootbound clusters by their totem's id, and by every cell they cover as the level opens. */
  totems: Map<string, Cluster>;
  clusterAt: Map<string, Cluster>;
  /** The mirrors and cannons each cluster carries. */
  riders: Map<string, { mirrors: string[]; emitters: string[] }>;
  /** Cells holding something no cluster can move: what a turning cluster may never pass over or land on. */
  fixedCells: Set<string>;
  /** Board layouts per combination of cluster turns, and per-cluster footprints and swept cells per turn count. */
  layouts: Map<string, Pieces>;
  footprints: Map<string, Point[]>;
  sweeps: Map<string, Point[]>;
}
const indexCache = new WeakMap<Level, Index>();

/** The pieces with everything moved by `moved` (the identity as the level opens). */
function layout(level: Level, moved: (p: Point) => Point): Pieces {
  return {
    mirrors: new Map(level.mirrors.map(m => [key(moved(m.position)), m])),
    // Cannons and totems are solid: a beam that runs into one stops there.
    blockers: new Set([...level.blockers.map(b => key(moved(b))), ...level.emitters.map(e => key(moved(e.position))),
      ...(level.clusters ?? []).map(c => key(c.totem.position))]),
    targets: new Map(level.targets.map(t => [key(moved(t.position)), t.id])),
    splitters: new Set(level.splitters.map(s => key(moved(s.position)))),
    emitters: new Map(level.emitters.map(e => [e.id, moved(e.position)])),
  };
}

function indexOf(level: Level): Index {
  let idx = indexCache.get(level);
  if (!idx) {
    const zone = new Map<string, string>();
    for (const d of level.devourers ?? []) for (const p of d.zone) zone.set(key(p), d.id);
    const clusters = level.clusters ?? [];
    const clusterAt = new Map<string, Cluster>();
    for (const c of clusters) for (const p of c.cells) clusterAt.set(key(p), c);
    const riders = new Map(clusters.map(c => [c.id, {
      mirrors: level.mirrors.filter(m => clusterAt.get(key(m.position)) === c).map(m => m.id),
      emitters: level.emitters.filter(e => clusterAt.get(key(e.position)) === c).map(e => e.id),
    }]));
    const fixedCells = new Set<string>();
    const still = (p: Point) => { if (!clusterAt.has(key(p))) fixedCells.add(key(p)); };
    for (const x of [...level.emitters, ...level.mirrors, ...level.targets, ...level.splitters]) still(x.position);
    level.blockers.forEach(still);
    for (const p of level.portals) { fixedCells.add(key(p.position)); fixedCells.add(key(p.exit)); }
    for (const x of [...(level.seals ?? []), ...(level.gates ?? [])]) fixedCells.add(key(x.position));
    for (const k of zone.keys()) fixedCells.add(k);
    for (const f of level.floes ?? []) for (const p of f.track) fixedCells.add(key(p));
    for (const c of clusters) fixedCells.add(key(c.totem.position));
    idx = {
      pieces: layout(level, p => p),
      mirrorsById: new Map(level.mirrors.map(m => [m.id, m])),
      portals: new Map(level.portals.map(p => [key(p.position), p.exit])),
      gates: new Map((level.gates ?? []).map(g => [key(g.position), g])),
      seals: new Map((level.seals ?? []).map(s => [key(s.position), s])),
      floes: new Map((level.floes ?? []).map(f => [f.id, f])),
      zone,
      sealOrder: [...(level.seals ?? [])].sort((a, b) => a.order - b.order),
      totems: new Map(clusters.map(c => [c.totem.id, c])),
      clusterAt, riders, fixedCells, layouts: new Map(), footprints: new Map(), sweeps: new Map(),
    };
    indexCache.set(level, idx);
  }
  return idx;
}

export const defaultAims = (level: Level): Record<string, Direction> => Object.fromEntries(level.emitters.map(e => [e.id, e.direction]));

/** `p` turned `n` quarter turns around `pivot`: clockwise for positive `n`, seen from above with north at the top. Exact for any valid pivot. */
export function turnPoint(p: Point, pivot: Point, n: number): Point {
  let dx = p[0] - pivot[0], dz = p[1] - pivot[1];
  for (let k = ((n % 4) + 4) % 4; k > 0; k--) [dx, dz] = [-dz, dx];
  // `+ 0` turns a -0 into 0, so keys and comparisons never see a negative zero.
  return [pivot[0] + dx + 0, pivot[1] + dz + 0];
}

/** How many quarter turns a cluster has made in a state (0-3). */
export const turnsOf = (c: Cluster, state: Pick<PlayState, 'turns'>) => state.turns?.[c.id] ?? 0;

/** The cells a cluster covers after `steps` taps. */
export function footprint(level: Level, c: Cluster, steps: number): Point[] {
  const idx = indexOf(level);
  const k = `${c.id}:${steps & 3}`;
  let cells = idx.footprints.get(k);
  if (!cells) { cells = c.cells.map(p => turnPoint(p, c.pivot, c.turn * steps)); idx.footprints.set(k, cells); }
  return cells;
}

/** The cell a point lies in, or both cells when it lies exactly on the line between them. */
function cellsAround(x: number, z: number): Point[] {
  const span = (v: number) => (Math.abs(v - Math.floor(v) - .5) < 1e-6 ? [Math.floor(v), Math.ceil(v)] : [Math.round(v)]);
  return span(x).flatMap(cx => span(z).map(cz => [cx + 0, cz + 0] as Point));
}

/**
 * Every cell a cluster's stones pass over or land on during its next tap from `steps`: the centre of each stone traces a
 * quarter circle around the pivot, sampled every tenth of a tile.
 */
export function sweepOf(level: Level, c: Cluster, steps: number): Point[] {
  const idx = indexOf(level);
  const k = `${c.id}:${steps & 3}`;
  let cells = idx.sweeps.get(k);
  if (cells) return cells;
  const out = new Map<string, Point>();
  for (const [x0, z0] of footprint(level, c, steps)) {
    const dx = x0 - c.pivot[0], dz = z0 - c.pivot[1];
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) * Math.PI / 2 / .1));
    for (let i = 1; i <= n; i++) {
      const a = c.turn * (i / n) * Math.PI / 2, cos = Math.cos(a), sin = Math.sin(a);
      for (const p of cellsAround(c.pivot[0] + dx * cos - dz * sin, c.pivot[1] + dx * sin + dz * cos)) out.set(key(p), p);
    }
  }
  cells = [...out.values()];
  idx.sweeps.set(k, cells);
  return cells;
}

/**
 * Why a cluster cannot turn right now: the cells its stones would pass over or land on that are off the board, hold a
 * piece that is not part of it, a totem, or another cluster's stones. Empty when the turn is free.
 */
export function turnBlocks(level: Level, state: Pick<PlayState, 'turns'>, c: Cluster): Point[] {
  const idx = indexOf(level);
  const own = new Set(footprint(level, c, turnsOf(c, state)).map(key));
  const others = new Set<string>();
  for (const o of level.clusters) if (o !== c) for (const p of footprint(level, o, turnsOf(o, state))) others.add(key(p));
  const n = level.size;
  return sweepOf(level, c, turnsOf(c, state)).filter(p => {
    const k = key(p);
    if (own.has(k)) return false;
    return p[0] < 0 || p[1] < 0 || p[0] >= n || p[1] >= n || idx.fixedCells.has(k) || others.has(k);
  });
}

/** The cell where whatever started on `p` stands in a state (it moves only if it rides a cluster). */
export function placeOf(level: Level, state: Pick<PlayState, 'turns'>, p: Point): Point {
  const c = indexOf(level).clusterAt.get(key(p));
  return c ? turnPoint(p, c.pivot, c.turn * turnsOf(c, state)) : p;
}

/** The rootbound cluster a totem turns, by the totem's id. */
export const clusterOfTotem = (level: Level, id: string) => indexOf(level).totems.get(id);
/** The cluster whose stones a piece starting on `p` rides, if any. */
export const clusterAt = (level: Level, p: Point) => indexOf(level).clusterAt.get(key(p));

/** The pieces as they stand after the clusters' turns, or undefined while every cluster is unturned (the opening layout). */
function piecesAt(level: Level, turns: Record<string, number> | undefined): Pieces | undefined {
  const clusters = level.clusters ?? [];
  if (!clusters.length || !turns) return undefined;
  const k = clusters.map(c => (turns[c.id] ?? 0) & 3).join('');
  if (!/[1-3]/.test(k)) return undefined;
  const idx = indexOf(level);
  let p = idx.layouts.get(k);
  if (!p) { p = layout(level, q => placeOf(level, { turns }, q)); idx.layouts.set(k, p); }
  return p;
}

/** The living board in a state: gates that stand closed, the floe standing on each cell, and pieces moved by turned clusters. */
export interface BoardState { closedGates: Set<string>; floes: Map<string, Floe>; pieces?: Pieces }

export function gateOpen(level: Level, state: Pick<PlayState, 'sealed'>, gate: Gate) {
  let open = gate.open;
  for (const s of level.seals ?? []) if (state.sealed[s.id] && s.toggles.includes(gate.id)) open = !open;
  return open;
}

/** Where a floe stands in a state. */
export const floeCell = (f: Floe, state: Pick<PlayState, 'places'>): Point => f.track[state.places[f.id] ?? f.at]!;

export function boardOf(level: Level, state: Pick<PlayState, 'sealed' | 'places' | 'turns'>): BoardState {
  const closedGates = new Set<string>(), floes = new Map<string, Floe>();
  for (const g of level.gates ?? []) if (!gateOpen(level, state, g)) closedGates.add(g.id);
  for (const f of level.floes ?? []) floes.set(key(floeCell(f, state)), f);
  const pieces = piecesAt(level, state.turns);
  return pieces ? { closedGates, floes, pieces } : { closedGates, floes };
}

const NONE: Record<string, never> = Object.freeze({}) as Record<string, never>;
const startBoard = (level: Level) => boardOf(level, { sealed: NONE, places: NONE, turns: NONE });

interface Ray { pos: Point; dir: Direction; dist: number; branch: number; root: number }

/**
 * Traces every beam (every cannon, including prism branches) through the board. Pure and deterministic.
 * Branch k (k < emitters.length) is cannon k's own ray; prisms append child branches. `board` gives the gates, floes and
 * cluster-moved pieces of the moment (by default, the board as the level opens). A mirror's slant comes from
 * `orientations` when given there (cluster turns change even a fixed mirror's slant), else from the level.
 */
export function traceBeam(level: Level, orientations: Record<string, Orientation>, aims?: Record<string, Direction>, board: BoardState = startBoard(level)): Trace {
  const idx = indexOf(level);
  const at = board.pieces ?? idx.pieces;
  const segments: BeamSegment[] = [];
  const hits: BeamHit[] = [];
  const activatedAt: Record<string, number> = {};
  const lit = new Set<string>();
  const sealsLit = new Set<string>();
  let absorbed: string | undefined;
  const visited = new Set<string>();
  const parents: number[] = level.emitters.map(() => -1);
  const queue: Ray[] = level.emitters.map((e, i) => ({ pos: at.emitters.get(e.id) ?? e.position, dir: aims?.[e.id] ?? e.direction, dist: 0, branch: i, root: i }));
  let queueIndex = 0;
  const n = level.size;
  let loop = false;
  let budget = n * n * 16 * Math.max(1, level.emitters.length);
  while (queueIndex < queue.length && budget > 0) {
    const ray = queue[queueIndex++]!;
    let pos = ray.pos, dir = ray.dir, dist = ray.dist;
    const { branch, root } = ray;
    let runFrom = pos, runStart = dist;
    const flush = (to: Point, extra: Partial<BeamSegment> = {}) => {
      const length = Math.abs(to[0] - runFrom[0]) + Math.abs(to[1] - runFrom[1]);
      if (length > 0) segments.push({ from: runFrom, to, start: runStart, length, branch, ...extra });
    };
    /** Stops the beam at the face of a solid piece in the next cell. */
    const stopAtFace = (next: Point, kind: BeamHit['kind'], id?: string) => {
      const d = DELTA[dir];
      const face: Point = [next[0] - d[0] * .46, next[1] - d[1] * .46];
      flush(face, { blocked: true });
      hits.push({ point: face, at: dist + .54, kind, branch, ...(id ? { id } : {}) });
    };
    while (budget-- > 0) {
      const d = DELTA[dir];
      const next: Point = [pos[0] + d[0], pos[1] + d[1]];
      if (next[0] < 0 || next[1] < 0 || next[0] >= n || next[1] >= n) {
        flush([pos[0] + d[0] * .5, pos[1] + d[1] * .5], { exit: true });
        break;
      }
      const state = `${root}:${key(next)}:${dir}`;
      if (visited.has(state)) { loop = true; flush(next); break; }
      visited.add(state);
      const k = key(next);
      if (at.blockers.has(k)) { stopAtFace(next, 'blocker'); break; }
      const gate = idx.gates.get(k);
      if (gate && board.closedGates.has(gate.id)) { stopAtFace(next, 'gate', gate.id); break; }
      dist += 1;
      const eater = idx.zone.get(k);
      if (eater !== undefined) {
        // Swallowed: the beam ends inside the danger zone and the level is lost.
        flush(next, { blocked: true });
        absorbed ??= eater;
        hits.push({ point: next, at: dist, kind: 'devourer', branch, id: eater });
        break;
      }
      const seal = idx.seals.get(k);
      if (seal) { sealsLit.add(seal.id); hits.push({ point: next, at: dist, kind: 'seal', branch, id: seal.id }); }
      const target = at.targets.get(k);
      if (target !== undefined) {
        if (!(target in activatedAt) || activatedAt[target]! > dist) activatedAt[target] = dist;
        hits.push({ point: next, at: dist, kind: 'target', branch, id: target });
      }
      // A floe is a mirror wherever it stands; its frozen panel never turns.
      const floe = board.floes.get(k);
      const mirror = floe ? undefined : at.mirrors.get(k);
      if (floe || mirror) {
        flush(next);
        const id = floe ? floe.id : mirror!.id;
        lit.add(id);
        hits.push({ point: next, at: dist, kind: 'mirror', branch, id });
        dir = reflect(dir, floe ? floe.orientation : orientations[mirror!.id] ?? mirror!.orientation);
        pos = next; runFrom = next; runStart = dist;
        continue;
      }
      if (at.splitters.has(k)) {
        flush(next);
        hits.push({ point: next, at: dist, kind: 'splitter', branch });
        const left = parents.push(branch) - 1, right = parents.push(branch) - 1;
        queue.push({ pos: next, dir: turnLeft(dir), dist, branch: left, root }, { pos: next, dir: turnRight(dir), dist, branch: right, root });
        break;
      }
      const exit = idx.portals.get(k);
      if (exit) {
        flush(next);
        hits.push({ point: next, at: dist, kind: 'portal', branch }, { point: exit, at: dist, kind: 'portal', branch });
        pos = exit; runFrom = exit; runStart = dist;
        continue;
      }
      pos = next;
    }
  }
  const activated = Object.keys(activatedAt);
  return {
    segments, hits, activatedAt, activated, litMirrors: [...lit], sealsLit: [...sealsLit], ...(absorbed ? { absorbed } : {}), loop, parents,
    won: level.targets.length > 0 && level.targets.every(t => t.id in activatedAt) && !absorbed,
  };
}

/** The beam as the board stands in `state` (a devourer that fed during the last move keeps the level lost). */
export function traceState(level: Level, state: PlayState): Trace {
  const t = traceBeam(level, state.orientations, state.aims, boardOf(level, state));
  return state.absorbed && !t.absorbed ? { ...t, absorbed: state.absorbed, won: false } : t;
}

/**
 * Presentation helper for a solved board: trims every beam branch so it ends inside the last crystal it feeds,
 * instead of continuing past it. Branches that feed no crystal are removed entirely.
 */
export function clipToCrystals(trace: Trace): Trace {
  const reach = new Map<number, number>();
  for (const h of trace.hits) {
    if (h.kind !== 'target') continue;
    for (let b = h.branch; b >= 0; b = trace.parents[b] ?? -1) reach.set(b, Math.max(reach.get(b) ?? -1, h.at));
  }
  const segments: BeamSegment[] = [];
  for (const s of trace.segments) {
    const end = reach.get(s.branch);
    if (end === undefined || end <= s.start) continue;
    const length = Math.min(s.length, end - s.start);
    const dx = Math.sign(s.to[0] - s.from[0]), dz = Math.sign(s.to[1] - s.from[1]);
    const clipped = length < s.length;
    segments.push({ ...s, length, to: [s.from[0] + dx * length, s.from[1] + dz * length], exit: s.exit && !clipped, blocked: s.blocked && !clipped });
  }
  const hits = trace.hits.filter(h => (reach.get(h.branch) ?? -1) >= h.at);
  return { ...trace, segments, hits };
}

const add = <T,>(record: Record<string, T>, id: string, value: T) => ({ ...record, [id]: value });

/**
 * Lets the light act on the board after a move: it activates solar seals in order. Seals flip gates, which changes
 * where the light goes, so the board is traced again until nothing more changes. Everything the light touched while
 * settling counts, including a devourer it fed.
 */
function settle(level: Level, base: PlayState): PlayState {
  const idx = indexOf(level);
  let s = base;
  let absorbed: string | undefined;
  for (let pass = 0; pass < 12; pass++) {
    const t = traceBeam(level, s.orientations, s.aims, boardOf(level, s));
    absorbed ??= t.absorbed;
    let { sealed } = s;
    let gatesMoved = false;
    for (const seal of idx.sealOrder) {
      if (sealed[seal.id] || !t.sealsLit.includes(seal.id)) continue;
      if (!idx.sealOrder.every(o => o.order >= seal.order || sealed[o.id])) continue;
      sealed = add(sealed, seal.id, true);
      if (seal.toggles.length) gatesMoved = true;
    }
    if (sealed !== s.sealed) s = { ...s, sealed };
    if (!gatesMoved) break;
  }
  if (absorbed) return { ...s, absorbed };
  return s;
}

export function initialState(level: Level): PlayState {
  const floes = level.floes ?? [];
  const clusters = level.clusters ?? [];
  return settle(level, {
    orientations: Object.fromEntries(level.mirrors.map(m => [m.id, m.orientation])), aims: defaultAims(level),
    places: floes.length ? Object.fromEntries(floes.map(f => [f.id, f.at])) : NONE,
    facing: floes.length ? Object.fromEntries(floes.map(f => [f.id, f.facing])) : NONE,
    turns: clusters.length ? Object.fromEntries(clusters.map(c => [c.id, 0])) : NONE,
    sealed: NONE,
  });
}

/**
 * Where a tap glides a floe: the way it faces (or, if that way is already blocked, the other way) until its track
 * ends or the next cell holds another floe. At a track end it turns to face back. Undefined when it cannot move at all.
 */
export function glide(level: Level, state: Pick<PlayState, 'places' | 'facing'>, f: Floe): { at: number; facing: 1 | -1 } | undefined {
  const taken = new Set<string>();
  for (const o of level.floes) if (o.id !== f.id) taken.add(key(floeCell(o, state)));
  const at = state.places[f.id] ?? f.at;
  const free = (i: number) => i >= 0 && i < f.track.length && !taken.has(key(f.track[i]!));
  let dir = state.facing[f.id] ?? f.facing;
  if (!free(at + dir)) dir = (-dir) as 1 | -1;
  if (!free(at + dir)) return undefined;
  let i = at;
  while (free(i + dir)) i += dir;
  const end = dir > 0 ? i === f.track.length - 1 : i === 0;
  return { at: i, facing: end ? (-dir as 1 | -1) : dir };
}

export function canRotate(level: Level, state: PlayState, id: string) {
  if (state.absorbed) return false;
  const e = level.emitters.find(x => x.id === id);
  if (e) return !!e.rotatable;
  const idx = indexOf(level);
  const f = idx.floes.get(id);
  if (f) return glide(level, state, f) !== undefined;
  const c = idx.totems.get(id);
  if (c) return turnBlocks(level, state, c).length === 0;
  const m = idx.mirrorsById.get(id);
  return !!m && !m.fixed;
}

/** Every distinct tap a player can make on this level: turnable cannons, turnable mirrors, floes and totems. */
export function tappables(level: Level): string[] {
  return [...level.emitters.filter(e => e.rotatable).map(e => e.id), ...level.mirrors.filter(m => !m.fixed).map(m => m.id), ...(level.floes ?? []).map(f => f.id),
    ...(level.clusters ?? []).map(c => c.totem.id)];
}

/**
 * A cluster's quarter turn: it counts one more turn, and every mirror it carries swaps its slant (a quarter turn of a
 * diagonal mirror is the other diagonal) while every cannon it carries turns its aim with it.
 */
function turnCluster(level: Level, state: PlayState, c: Cluster): PlayState {
  const ride = indexOf(level).riders.get(c.id)!;
  const next: PlayState = { ...state, turns: { ...state.turns, [c.id]: (turnsOf(c, state) + 1) % 4 } };
  if (ride.mirrors.length) {
    const orientations = { ...state.orientations };
    for (const id of ride.mirrors) orientations[id] = orientations[id] === 0 ? 1 : 0;
    next.orientations = orientations;
  }
  if (ride.emitters.length) {
    const aims = { ...state.aims };
    for (const id of ride.emitters) aims[id] = (c.turn > 0 ? turnRight : turnLeft)(aims[id] ?? 'N');
    next.aims = aims;
  }
  return next;
}

export function applyMove(level: Level, state: PlayState, id: string): PlayState {
  if (!canRotate(level, state, id)) return state;
  let next: PlayState = { ...state };
  const idx = indexOf(level);
  const f = idx.floes.get(id), c = idx.totems.get(id);
  if (level.emitters.some(e => e.id === id)) next.aims = { ...state.aims, [id]: turnRight(state.aims[id] ?? 'N') };
  else if (f) {
    const to = glide(level, state, f)!;
    next.places = { ...state.places, [id]: to.at };
    next.facing = { ...state.facing, [id]: to.facing };
  } else if (c) next = turnCluster(level, state, c);
  else next.orientations = { ...state.orientations, [id]: state.orientations[id] === 0 ? 1 : 0 };
  return settle(level, next);
}

/** Plays a sequence of taps from the opening board. */
export function replay(level: Level, taps: string[], from = initialState(level)): PlayState {
  return taps.reduce((s, id) => applyMove(level, s, id), from);
}

/** Every tile a beam passes through. */
export function beamTiles(trace: Trace): Set<string> {
  const out = new Set<string>();
  for (const s of trace.segments) {
    const dx = Math.sign(s.to[0] - s.from[0]), dz = Math.sign(s.to[1] - s.from[1]);
    for (let k = 0; k <= Math.ceil(s.length); k++) out.add(`${Math.round(s.from[0] + dx * k)},${Math.round(s.from[1] + dz * k)}`);
  }
  return out;
}

/** A compact key for a play state: equal keys behave identically from here on (used by every search). */
export function stateEncoder(level: Level) { return encoder(level); }

function encoder(level: Level) {
  const movable = level.mirrors.filter(m => !m.fixed);
  const turning = level.emitters.filter(e => e.rotatable);
  const floes = level.floes ?? [];
  const seals = level.seals ?? [];
  // A cluster's turns also fix the slant of the fixed mirrors and the aim of the unturnable cannons it carries.
  const clusters = level.clusters ?? [];
  return (s: PlayState) => movable.map(m => s.orientations[m.id]).join('') + turning.map(e => s.aims[e.id]).join('')
    + floes.map(f => `${s.places[f.id]}${s.facing[f.id]! > 0 ? '+' : '-'}`).join('') + seals.map(x => (s.sealed[x.id] ? 1 : 0)).join('')
    + clusters.map(c => turnsOf(c, s)).join('') + (s.absorbed ? 'X' : '');
}

/** States expanded between pause points of a sliced search; small enough that a slice never overshoots its budget by much. */
const SOLVE_STEP = 16;

/** The search behind solve(). It pauses (yields) every SOLVE_STEP expansions so it can also run spread across frames. */
function* searchSteps(level: Level, start: PlayState, maxStates: number): Generator<void, string[] | null, void> {
  const encode = encoder(level);
  const moves = tappables(level);
  if (traceState(level, start).won) return [];
  if (start.absorbed) return null;
  const visited = new Map<string, { prev: string | null; move: string | null }>();
  visited.set(encode(start), { prev: null, move: null });
  let frontier: PlayState[] = [start];
  let expanded = 0;
  while (frontier.length && visited.size < maxStates) {
    const next: PlayState[] = [];
    for (const s of frontier) {
      const sk = encode(s);
      for (const g of moves) {
        if (!canRotate(level, s, g)) continue;
        const ns = applyMove(level, s, g);
        const nk = encode(ns);
        if (visited.has(nk)) continue;
        visited.set(nk, { prev: sk, move: g });
        if (traceState(level, ns).won) {
          const path: string[] = [];
          let cur: string | null = nk;
          while (cur) { const v: { prev: string | null; move: string | null } = visited.get(cur)!; if (v.move) path.unshift(v.move); cur = v.prev; }
          return path;
        }
        // A swallowed beam ends the level: nothing follows from there.
        if (!ns.absorbed) next.push(ns);
        if (++expanded % SOLVE_STEP === 0) yield;
      }
    }
    frontier = next;
  }
  return null;
}

/** Breadth-first search over orientations, cannon aims, floe places, cluster turns and seal state. Returns the shortest list of taps, or null. */
export function solve(level: Level, start: PlayState, maxStates = 200000): string[] | null {
  const steps = searchSteps(level, start, maxStates);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * Exactly the search solve() runs, spread over short slices so a long search on a big board never freezes rendering.
 * The first slice runs immediately, so small boards still answer synchronously. Returns a function that cancels it.
 */
export function solveSliced(level: Level, start: PlayState, onDone: (path: string[] | null) => void,
  { budgetMs = 8, schedule = (run: () => void) => { setTimeout(run, 0); }, maxStates = 200000 }:
  { budgetMs?: number; schedule?: (run: () => void) => void; maxStates?: number } = {}): () => void {
  const steps = searchSteps(level, start, maxStates);
  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    const until = Date.now() + budgetMs;
    for (;;) {
      const r = steps.next();
      if (r.done) { onDone(r.value); return; }
      if (Date.now() >= until) break;
    }
    schedule(run);
  };
  run();
  return () => { cancelled = true; steps.return(null); };
}

/** How good a board looks to a player who can only judge what the light is doing right now. */
function appeal(t: Trace, s: PlayState) {
  let inside = 0;
  for (const seg of t.segments) inside += seg.exit ? seg.length - .5 : seg.length;
  return t.activated.length * 10 + inside * .05 + Object.keys(s.sealed).length * 4;
}

/**
 * Simulates an impatient player who always makes the single tap that looks best right now.
 * `litOnly` restricts them to pieces the light is touching (the "tap the last mirror the light hits" strategy); cannons
 * and totems, big and obvious, are always tried. Returns the number of taps they need to win, or null if they do not win
 * within `limit` (or feed a devourer).
 */
export function greedyPlay(level: Level, start: PlayState, limit: number, litOnly: boolean): number | null {
  let s = start;
  const moves = tappables(level);
  const seen = new Set<string>();
  const encode = encoder(level);
  const totems = indexOf(level).totems;
  for (let step = 1; step <= limit; step++) {
    const t = traceState(level, s);
    const lit = new Set(t.litMirrors);
    let best: PlayState | null = null, bestScore = -Infinity;
    for (const id of moves) {
      if (!canRotate(level, s, id)) continue;
      if (litOnly && !level.emitters.some(e => e.id === id) && !totems.has(id) && !lit.has(id)) continue;
      const ns = applyMove(level, s, id);
      const nt = traceState(level, ns);
      if (nt.won) return step;
      // A player can see the danger zone and never steps into it on purpose.
      if (ns.absorbed) continue;
      const score = appeal(nt, ns) - (seen.has(encode(ns)) ? 100 : 0);
      if (score > bestScore) { bestScore = score; best = ns; }
    }
    if (!best) return null;
    seen.add(encode(s));
    s = best;
  }
  return null;
}

/**
 * For each exact move count up to `upTo` at which the level can be won (a winning tap ends the level immediately), one
 * tap sequence that does it. Used to prove every shard outcome is reachable with legitimate play.
 */
export function winningSequences(level: Level, upTo: number): Map<number, string[]> {
  const encode = encoder(level);
  const moves = tappables(level);
  const out = new Map<number, string[]>();
  const start = initialState(level);
  let layer = new Map<string, { s: PlayState; path: string[] }>([[encode(start), { s: start, path: [] }]]);
  for (let k = 1; k <= upTo && layer.size; k++) {
    const next = new Map<string, { s: PlayState; path: string[] }>();
    for (const { s, path } of layer.values()) for (const id of moves) {
      if (!canRotate(level, s, id)) continue;
      const ns = applyMove(level, s, id);
      if (traceState(level, ns).won) { if (!out.has(k)) out.set(k, [...path, id]); continue; }
      if (ns.absorbed) continue;
      const nk = encode(ns);
      if (!next.has(nk)) next.set(nk, { s: ns, path: [...path, id] });
    }
    layer = next;
  }
  return out;
}

/** Exact move counts at which the level can be won. */
export function winnableAt(level: Level, upTo: number): Set<number> {
  return new Set(winningSequences(level, upTo).keys());
}

/**
 * A losing sequence, if one exists: every move spent without winning (the 0-shard "out of moves" outcome), or, failing
 * that, a move that feeds a devourer.
 */
export function losingSequence(level: Level): { taps: string[]; devoured: boolean } | undefined {
  const encode = encoder(level);
  const moves = tappables(level);
  const start = initialState(level);
  let layer = new Map<string, { s: PlayState; path: string[] }>([[encode(start), { s: start, path: [] }]]);
  let devoured: string[] | undefined;
  for (let k = 1; k <= level.maxMoves && layer.size; k++) {
    const next = new Map<string, { s: PlayState; path: string[] }>();
    for (const { s, path } of layer.values()) for (const id of moves) {
      if (!canRotate(level, s, id)) continue;
      const ns = applyMove(level, s, id);
      if (ns.absorbed) { devoured ??= [...path, id]; continue; }
      if (traceState(level, ns).won) continue;
      const nk = encode(ns);
      if (!next.has(nk)) next.set(nk, { s: ns, path: [...path, id] });
    }
    layer = next;
  }
  const outOfMoves = layer.values().next().value;
  if (outOfMoves) return { taps: outOfMoves.path, devoured: false };
  return devoured ? { taps: devoured, devoured: true } : undefined;
}

/** True if a player can spend every move without ever winning (the 0-shard "out of moves" outcome). */
export function canRunOut(level: Level): boolean {
  const lose = losingSequence(level);
  return !!lose && !lose.devoured;
}

export function starsFor(level: Level, moves: number): number {
  if (moves > level.maxMoves) return 0;
  return moves <= level.par ? 3 : moves <= level.twoStar ? 2 : 1;
}

/** A floe track: at least two cells in one straight, unbroken row or column. */
function straightTrack(track: Point[]) {
  if (track.length < 2) return false;
  const dx = track[1]![0] - track[0]![0], dz = track[1]![1] - track[0]![1];
  if (Math.abs(dx) + Math.abs(dz) !== 1) return false;
  return track.every((p, i) => p[0] === track[0]![0] + dx * i && p[1] === track[0]![1] + dz * i);
}

export function validateLevel(level: Level): string[] {
  const errors: string[] = [];
  const cells = new Set<string>();
  const ids = new Set<string>();
  const inBounds = (p: Point) => p.every(v => Number.isInteger(v) && v >= 0 && v < level.size);
  const occupy = (p: Point, what: string) => {
    if (!inBounds(p)) errors.push(`${what} out of bounds ${key(p)}`);
    if (cells.has(key(p))) errors.push(`${what} overlaps ${key(p)}`);
    cells.add(key(p));
  };
  if (!level.emitters.length) errors.push('no light cannon');
  for (const e of level.emitters) occupy(e.position, e.id);
  for (const m of level.mirrors) occupy(m.position, m.id);
  for (const t of level.targets) occupy(t.position, t.id);
  for (const b of level.blockers) occupy(b, 'blocker');
  for (const s of level.splitters) occupy(s.position, s.id);
  for (const p of level.portals) { occupy(p.position, p.id); occupy(p.exit, `${p.id}-exit`); }
  for (const s of level.seals) occupy(s.position, s.id);
  for (const g of level.gates) occupy(g.position, g.id);
  for (const d of level.devourers) {
    occupy(d.position, d.id);
    if (!d.zone.some(p => key(p) === key(d.position))) errors.push(`${d.id} is outside its own zone`);
    for (const p of d.zone) if (key(p) !== key(d.position)) occupy(p, `${d.id}-zone`);
  }
  // Floe tracks are open ice: no other piece stands on them, and two tracks may only cross at a single cell.
  const trackOf = new Map<string, string>();
  for (const f of level.floes) {
    if (!straightTrack(f.track)) errors.push(`${f.id} track is not a straight line of two or more cells`);
    if (!Number.isInteger(f.at) || f.at < 0 || f.at >= f.track.length) errors.push(`${f.id} starts off its track`);
    if (f.facing !== 1 && f.facing !== -1) errors.push(`${f.id} has a bad facing`);
    const shared = new Map<string, number>();
    for (const p of f.track) {
      if (!inBounds(p)) errors.push(`${f.id} track out of bounds ${key(p)}`);
      if (cells.has(key(p))) errors.push(`${f.id} track overlaps a piece at ${key(p)}`);
      const other = trackOf.get(key(p));
      if (other) shared.set(other, (shared.get(other) ?? 0) + 1);
    }
    for (const [other, count] of shared) if (count > 1) errors.push(`${f.id} and ${other} tracks overlap along a line`);
    for (const p of f.track) trackOf.set(key(p), f.id);
  }
  const starts = level.floes.map(f => key(f.track[f.at] ?? [-1, -1]));
  if (new Set(starts).size !== starts.length) errors.push('two floes start on the same cell');
  // Rootbound clusters: explicit, connected cells on the board, a pivot that keeps every turned cell on the grid, and a
  // totem on its own cell. Only mirrors, cannons, crystals, prisms and stones can ride a cluster.
  for (const c of level.clusters) occupy(c.totem.position, c.totem.id);
  const riding = new Set([...level.emitters, ...level.mirrors, ...level.targets, ...level.splitters].map(x => key(x.position)));
  for (const b of level.blockers) riding.add(key(b));
  const covered = new Set<string>();
  for (const c of level.clusters) {
    if (c.turn !== 1 && c.turn !== -1) errors.push(`${c.id} has a bad turn direction`);
    const half = (v: number) => Math.abs(v - Math.floor(v) - .5) < 1e-9;
    if (!(c.pivot.every(Number.isInteger) || c.pivot.every(half))) errors.push(`${c.id} pivot must be a cell centre or a corner where four cells meet`);
    if (c.cells.length < 2) errors.push(`${c.id} needs at least two cells`);
    const own = new Set<string>();
    for (const p of c.cells) {
      if (!inBounds(p)) errors.push(`${c.id} cell out of bounds ${key(p)}`);
      if (own.has(key(p)) || covered.has(key(p))) errors.push(`${c.id} cell ${key(p)} is listed twice or shared with another cluster`);
      own.add(key(p));
      covered.add(key(p));
      if (cells.has(key(p)) && !riding.has(key(p))) errors.push(`${c.id} covers ${key(p)}, which holds a piece that cannot turn`);
    }
    // Connected along cell edges, so the stones read as one carved slab.
    const todo: Point[] = c.cells.slice(0, 1), reach = new Set(todo.map(key));
    while (todo.length) {
      const p = todo.pop()!;
      for (const d of Object.values(DELTA)) {
        const q: Point = [p[0] + d[0], p[1] + d[1]];
        if (own.has(key(q)) && !reach.has(key(q))) { reach.add(key(q)); todo.push(q); }
      }
    }
    if (reach.size !== own.size) errors.push(`${c.id} cells are not connected`);
    const xs = c.cells.map(p => p[0]), zs = c.cells.map(p => p[1]);
    if (c.pivot[0] < Math.min(...xs) - .5 || c.pivot[0] > Math.max(...xs) + .5 || c.pivot[1] < Math.min(...zs) - .5 || c.pivot[1] > Math.max(...zs) + .5) {
      errors.push(`${c.id} pivot lies outside its cells`);
    }
  }
  for (const f of level.floes) if (f.track.some(p => covered.has(key(p)))) errors.push(`${f.id} track lies on a cluster, which cannot carry it`);
  for (const e of [...level.emitters, ...level.mirrors, ...level.targets, ...level.splitters, ...level.portals, ...level.floes,
    ...level.seals, ...level.gates, ...level.devourers, ...level.clusters, ...level.clusters.map(c => c.totem)]) {
    if (ids.has(e.id)) errors.push(`duplicate id ${e.id}`);
    ids.add(e.id);
  }
  const orders = level.seals.map(s => s.order).sort((a, b) => a - b);
  if (orders.some((o, i) => o !== i + 1)) errors.push('seals must be numbered 1, 2, 3 ...');
  for (const s of level.seals) for (const g of s.toggles) if (!level.gates.some(x => x.id === g)) errors.push(`${s.id} toggles missing gate ${g}`);
  // A malformed board cannot be played, so the play checks below only run on a sound one.
  if (errors.length) return errors;
  const start = initialState(level);
  const opening = traceState(level, start);
  if (opening.won) errors.push('already solved');
  if (start.absorbed) errors.push('the opening beam feeds a devourer');
  if (Object.keys(start.sealed).length) errors.push('the opening beam already wakes a seal');
  // The stored solution must win exactly on its last tap, and leave the board as recorded.
  let s = start;
  level.solutionMoves.forEach((id, i) => {
    if (!canRotate(level, s, id)) errors.push(`solution tap ${i + 1} (${id}) is not allowed`);
    s = applyMove(level, s, id);
    const won = traceState(level, s).won;
    if (won !== (i === level.solutionMoves.length - 1)) errors.push(`stored solution ${won ? 'wins early' : 'does not win'} at tap ${i + 1}`);
  });
  if (level.solutionMoves.length !== level.par) errors.push(`stored solution has ${level.solutionMoves.length} taps but par is ${level.par}`);
  if (level.mirrors.some(m => (s.orientations[m.id] ?? m.orientation) !== level.solution[m.id])) errors.push('stored solution board does not match');
  if (level.emitters.some(e => s.aims[e.id] !== level.solutionAims[e.id])) errors.push('stored solution aims do not match');
  if (level.floes.some(f => s.places[f.id] !== level.solutionPlaces[f.id])) errors.push('stored solution floe places do not match');
  if (level.clusters.some(c => turnsOf(c, s) !== (level.solutionTurns[c.id] ?? 0))) errors.push('stored solution cluster turns do not match');
  if (traceState(level, s).loop) errors.push('the solved light runs in a loop');
  const path = solve(level, start);
  if (!path) errors.push('unsolvable');
  else if (path.length !== level.par) errors.push(`par ${level.par} but shortest solution is ${path.length}`);
  if (!(level.par < level.twoStar && level.twoStar < level.maxMoves)) errors.push('star thresholds must satisfy par < twoStar < maxMoves');
  return errors;
}
