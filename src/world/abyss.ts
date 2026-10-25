import { Point, Trace } from '../game/types';

/*
 * The Devourer's absorption: when light enters a black hole's zone, the hole wakes, grows, drags every beam on the board
 * into itself, the world goes dark, and only then does the defeat screen appear. This module is the pure part: the
 * failure record taken from the rules' own trace, and the timeline every effect, sound and the defeat screen follow.
 * Nothing here changes the puzzle; the rules decided the loss before any of this runs.
 */

/** Seconds of each phase. Tune here: everything (visuals, sounds, the defeat screen) follows these. */
export const IMPACT = .45, GROW = 1, PULL = 1.2, DARKEN = .9, COLLAPSE = .55, HUSH = .45;
export const GROW_AT = IMPACT, PULL_AT = GROW_AT + GROW, DARKEN_AT = PULL_AT + PULL, COLLAPSE_AT = DARKEN_AT + DARKEN, HUSH_AT = COLLAPSE_AT + COLLAPSE;
/** From the light touching the hole until the defeat screen may appear. */
export const ABYSS_SECONDS = HUSH_AT + HUSH;

/** What the rules recorded about a loss to the Devourer: which beam fed it, from where, along which path. */
export interface Absorption {
  devourer: string;
  /** Where the beam entered the zone, and how far along its path (in tiles) the light was when it did. */
  point: Point;
  at: number;
  /** The beam branch that entered, the cannon it came from, and the branches of its path (the branch and its parents). */
  branch: number;
  emitter: number;
  path: number[];
  /** Path distance where each light branch on the board ends, deduplicated and sorted: one swallow pulse each. */
  ends: number[];
  /** The farthest any light reaches: the drain is done when it has passed this. */
  reach: number;
}

/** The failure record from the trace the rules produced for the move; undefined when no light entered a black hole. */
export function absorptionOf(trace: Trace): Absorption | undefined {
  if (!trace.absorbed) return undefined;
  // The earliest hit on the swallowing devourer: the first light that crossed its edge.
  const hit = trace.hits.filter(h => h.kind === 'devourer' && h.id === trace.absorbed).sort((a, b) => a.at - b.at)[0];
  if (!hit) return undefined;
  const path: number[] = [];
  for (let b = hit.branch; b >= 0; b = trace.parents[b] ?? -1) path.unshift(b);
  const endOf = new Map<number, number>();
  for (const s of trace.segments) endOf.set(s.branch, Math.max(endOf.get(s.branch) ?? 0, s.start + s.length));
  const ends = [...new Set([...endOf.values()].map(v => Math.round(v * 4) / 4))].sort((a, b) => a - b);
  return { devourer: hit.id!, point: hit.point, at: hit.at, branch: hit.branch, emitter: path[0]!, path, ends, reach: Math.max(hit.at, ...ends) };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (k: number) => k * k * (3 - 2 * k);

/** Where the absorption stands `e` seconds after the light reached the hole (each value 0-1 unless noted). */
export interface AbyssPose {
  /** The impact flash at the edge, the hole's growth (0 idle size, 1 full size), and its final contraction. */
  impact: number; grow: number; collapse: number;
  /** How hard light and particles are pulled in, and how far from the hole the pull reaches (tiles). */
  pull: number; reach: number;
  /** How much of the light has drained into the hole, as a share of the farthest beam's length. */
  drain: number;
  /** Darkness of the world, and the radius of the darkened region (0 the hole only, 1 the whole screen). */
  dark: number; spread: number;
  /** The final pulse running across the board (0-1 while it travels). */
  wave: number;
  /** The board's tremble (world units), and the volume of the music and ambience (1 normal). */
  shake: number; hush: number;
  done: boolean;
}

/**
 * The pose `e` seconds after the light reached the hole (negative: nothing is happening). Writes into `out` when given,
 * so the effects that read it every frame allocate nothing.
 */
export function abyssPose(e: number, out = {} as AbyssPose): AbyssPose {
  const impact = clamp01(e / IMPACT), grow = smooth(clamp01((e - GROW_AT) / GROW)), pull = smooth(clamp01((e - PULL_AT) / PULL));
  const darken = smooth(clamp01((e - DARKEN_AT) / DARKEN)), collapse = clamp01((e - COLLAPSE_AT) / COLLAPSE);
  const sinceGrow = e - GROW_AT, sinceCollapse = e - COLLAPSE_AT;
  out.impact = impact; out.grow = grow; out.collapse = collapse;
  // Nearby light bends while the hole grows; once it pulls, the reach covers the whole board.
  out.pull = .25 * grow + .75 * pull;
  out.reach = 1.3 + grow * .9 + pull * 8;
  out.drain = pull;
  // A local shadow while it grows, then darkness spreading over everything in stages.
  out.dark = .28 * grow + .3 * pull + .3 * darken + .06 * collapse;
  out.spread = .18 + .22 * grow + .3 * pull + .5 * darken;
  out.wave = e >= COLLAPSE_AT ? clamp01(sinceCollapse / (COLLAPSE + HUSH * .6)) : 0;
  // A small impulse as the hole starts to grow, a faint rumble while it pulls, a short shake at the collapse.
  out.shake = Math.max(sinceGrow >= 0 && sinceGrow < .5 ? .045 * Math.exp(-sinceGrow * 7) : 0, pull > 0 && pull < 1 ? .006 : 0,
    sinceCollapse >= 0 && sinceCollapse < .6 ? .065 * Math.exp(-sinceCollapse * 9) : 0);
  out.hush = 1 - .85 * smooth(clamp01((e - PULL_AT) / (PULL + DARKEN)));
  out.done = e >= ABYSS_SECONDS;
  return out;
}

/** Shared with the scene's lights: how dark the world has gone (0-1) while a black hole feeds. */
export const voidFall = { dark: 0, flicker: 0 };
