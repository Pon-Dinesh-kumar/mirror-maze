export type Point = readonly [number, number];
export type Direction = 'N' | 'E' | 'S' | 'W';
export type Orientation = 0 | 1;

export interface Mirror {
  id: string;
  position: Point;
  orientation: Orientation;
  fixed: boolean;
}
export interface Target { id: string; position: Point }
export interface Portal { id: string; position: Point; exit: Point }
export interface Splitter { id: string; position: Point }
/** A light cannon. Rotatable cannons turn a quarter turn clockwise when tapped. */
export interface Emitter { id: string; position: Point; direction: Direction; rotatable?: boolean }
/**
 * Chapter 2: a rootbound cluster, a group of board cells set in carved stone and turned by its totem. A tap on the totem
 * turns the whole cluster a quarter turn around its pivot and carries every piece standing on it: each moves to its
 * turned cell, mirrors swap their slant and cannons turn their aim. The turn is refused (and costs no move) while any
 * cell the cluster's stones would pass over or land on is off the board or holds something that is not part of it.
 */
export interface Cluster {
  id: string;
  /** The totem that turns the cluster: its id is the tap, and it stands on its own cell outside every cluster. Light stops at it. */
  totem: { id: string; position: Point };
  /** The cells the cluster covers as the level opens. Every piece standing on one of them belongs to the cluster for good. */
  cells: Point[];
  /** What it turns around: a cell centre (whole numbers) or the corner where four cells meet (both coordinates end in .5). */
  pivot: Point;
  /** The way every tap turns it, seen from above with north at the top: 1 clockwise, -1 counter-clockwise. */
  turn: 1 | -1;
}
/**
 * Chapter 4: a mirror frozen into a drifting ice floe. It never turns. A tap glides it along its straight track the way
 * it faces, until the track ends or another floe stands in the way; at the end of its track it turns to face back.
 * `at` is its opening place on the track and `facing` (+1 towards the last cell, -1 towards the first) its opening way.
 */
export interface Floe { id: string; track: Point[]; at: number; facing: 1 | -1; orientation: Orientation }
/** Chapter 3: a solar seal. Light activates it for good, in `order` (1 first), and it flips every gate in `toggles`. */
export interface Seal { id: string; position: Point; order: number; toggles: string[] }
/** Chapter 3: a sandstone gate. A closed gate blocks light; every activated seal that toggles it flips it once. */
export interface Gate { id: string; position: Point; open: boolean }
/** Chapter 5: the Light Devourer. Any beam that enters one of its zone cells is swallowed and the level is lost. */
export interface Devourer { id: string; position: Point; zone: Point[] }

/**
 * `totem`: a level with rootbound totems; `ride`: a cannon stands on a cluster; `totems`: two or more clusters; `jam`: a
 * cluster the solution turns cannot turn at the start until another moves out of its way; `stop`: a floe that must stop
 * against another.
 */
export type Mechanic = 'mirror' | 'blocker' | 'fixed' | 'decoy' | 'multi' | 'totem' | 'ride' | 'totems' | 'jam' | 'splitter' | 'limit' | 'floe' | 'stop'
  | 'portal' | 'twin' | 'triple' | 'turn' | 'seal' | 'devourer';

export interface Level {
  id: number;
  chapter: number;
  index: number;
  title: string;
  beat: string;
  size: number;
  emitters: Emitter[];
  mirrors: Mirror[];
  targets: Target[];
  blockers: Point[];
  portals: Portal[];
  splitters: Splitter[];
  clusters: Cluster[];
  floes: Floe[];
  seals: Seal[];
  gates: Gate[];
  devourers: Devourer[];
  /** Mirror orientations, cannon aims, floe places and cluster turns once solved (the board as the stored solution leaves it). */
  solution: Record<string, Orientation>;
  solutionAims: Record<string, Direction>;
  solutionPlaces: Record<string, number>;
  solutionTurns: Record<string, number>;
  /** A verified shortest winning sequence of taps; its length is `par`. */
  solutionMoves: string[];
  /** 3 shards at or under `par` moves, 2 at or under `twoStar`, 1 for any win within `maxMoves`, 0 for a loss. */
  par: number;
  twoStar: number;
  maxMoves: number;
  boss: boolean;
  mechanics: Mechanic[];
}

export interface BeamSegment {
  from: Point;
  to: Point;
  /** Path distance from the emitter where this segment starts. */
  start: number;
  length: number;
  /** Ray branch index; prisms spawn child branches (see Trace.parents). */
  branch: number;
  exit?: boolean;
  blocked?: boolean;
}
export type HitKind = 'mirror' | 'blocker' | 'splitter' | 'portal' | 'target' | 'gate' | 'seal' | 'devourer';
export interface BeamHit { point: Point; at: number; kind: HitKind; branch: number; id?: string }
export interface Trace {
  segments: BeamSegment[];
  hits: BeamHit[];
  activated: string[];
  activatedAt: Record<string, number>;
  /** Mirrors and floes the light touches (cluster turns included: a turned mirror is still the same mirror). */
  litMirrors: string[];
  /** Seals the light crosses. */
  sealsLit: string[];
  /** The devourer that swallowed light during the last move, if any: the level is lost. */
  absorbed?: string;
  /** parents[branch] is the branch a prism split from (-1 for a cannon's own ray; branch k < emitters.length belongs to cannon k). */
  parents: number[];
  won: boolean;
  loop: boolean;
}
export interface PlayState {
  orientations: Record<string, Orientation>;
  aims: Record<string, Direction>;
  /** Each floe's place on its track, and the way its next glide goes. */
  places: Record<string, number>;
  facing: Record<string, 1 | -1>;
  /** Quarter turns each rootbound cluster has made since the level opened (0-3: a fourth turn brings it home). */
  turns: Record<string, number>;
  /** Activated solar seals. */
  sealed: Record<string, boolean>;
  /** Set when the last move sent light into a devourer: the level is lost. */
  absorbed?: string;
}
