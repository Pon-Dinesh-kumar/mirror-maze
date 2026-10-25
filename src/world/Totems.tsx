import React, { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Euler, Group, InstancedMesh, Matrix4,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, OctahedronGeometry, PlaneGeometry, Quaternion, RingGeometry, Sprite, SpriteMaterial, TorusGeometry,
  Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { useFrame } from './Canvas';
import { glowTexture } from './fx';
import { useAppear } from './Board';
import { HintArrow } from './Entities';
import { proxies, TOTEM_SCALE } from './pick';
import { proxyMesh, usePickTarget } from './Picker';
import { key } from '../game/engine';
import { Cluster, Point } from '../game/types';

/*
 * Rootbound totems (Rainforest): the carved totem, the stones of its cluster, and the cinematic quarter turn. A cluster
 * shows which cells belong to it through its carved stones, and through an outline, corner marks, a pivot and a turn
 * arrow while its totem is held or turning. Nothing here decides anything: the rules hand over the turn count, and the
 * animation only eases between counts.
 */

/** Seconds of each phase of a totem's turn: it wakes, the stones strain, swing a quarter turn, then land. Tune here. */
export const WAKE = .34, STRAIN = .26, SWING = .92, LAND = .32;
/** Seconds from the tap until the stones hit home: the new light is traced from that moment. */
export const TURN_IMPACT = WAKE + STRAIN + SWING;
export const TURN_SECONDS = TURN_IMPACT + LAND;
/** An undo turns the stones straight back, quickly and without ceremony. */
export const UNDO_SECONDS = .42;
/** How long the outline lingers after landing before it fades. */
const LINGER = .45;
/** How long a refused tap flashes the cells in the way. */
const REFUSED_SECONDS = .9;
/** How brightly a cluster's edge is traced at rest. */
const IDLE_OUTLINE = .22;
/** The totem is drawn a little larger than a tile's other pieces, so it reads as the landmark it is. */

/** Each cluster's colour, by its order in the level: emerald, then amber, so two clusters never look alike. */
export const clusterColors = ['#3dffa0', '#ffc94a', '#8ad8ff'];

/** The turn in progress: clock time it began (-1 until its first frame), quarter turns shown before and after it. */
export interface TurnRun {
  start: number; from: number; to: number; cinematic: boolean;
  /** Beam distance the light falls back to while the stones turn (where the old and new light part ways). */
  limit: number;
  /** The light being shown when the turn began; the fallback ends once the new light replaces it. */
  old: unknown;
  /** Phase sounds already played, and whether the landing was reported. */
  fired: number; landed: boolean;
}
/** A cluster's animation state, shared by its rig, stones, guides and totem. Mutated only by the board's frame loop and effects. */
export interface TurnClock {
  /** Quarter turns shown at rest. Accumulated (never wrapped), so the stones never spin the long way round. */
  shown: number;
  run?: TurnRun;
  /** A refused tap waiting for its first frame, and the clock time it began flashing. */
  refuse: boolean; refusedAt: number;
}
export const newTurnClock = (shown: number): TurnClock => ({ shown, refuse: false, refusedAt: -10 });

/** Shared with the camera: how hard the board trembles right now (world units). */
export const boardShake = { value: 0 };

/** Where a cluster's turn stands at a moment. Every value is 0-1 except `steps` (quarter turns shown) and `lift`. */
export interface TurnPose { steps: number; wake: number; strain: number; swing: number; land: number; lift: number; elapsed: number; active: boolean; glow: number }
export const newPose = (): TurnPose => ({ steps: 0, wake: 0, strain: 0, swing: 0, land: 0, lift: 0, elapsed: -1, active: false, glow: 0 });

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Quintic smoothstep: no velocity or acceleration at either end (the lift, the undo). */
const smooth = (k: number) => k * k * k * (k * (k * 6 - 15) + 10);
/**
 * The swing: sine ease-in-out. It starts deliberately and settles without overshoot, but keeps visibly moving for most of
 * its time (on a phone the quintic curve left the stones looking stalled for its first and last fifth).
 */
const swingEase = (k: number) => (1 - Math.cos(Math.PI * k)) / 2;
const LIFT = .09;
/** How long the dust of a landing hangs in the air. */
const DUST_SECONDS = .75;

export function poseAt(tc: TurnClock, t: number, out: TurnPose): TurnPose {
  const r = tc.run;
  out.wake = out.strain = out.swing = out.land = out.lift = out.glow = 0;
  out.elapsed = -1;
  out.active = false;
  if (!r) { out.steps = tc.shown; return out; }
  if (r.start < 0) r.start = t;
  const e = t - r.start;
  out.elapsed = e;
  out.active = true;
  if (!r.cinematic) {
    out.steps = r.from + (r.to - r.from) * smooth(clamp01(e / UNDO_SECONDS));
    out.glow = Math.sin(Math.PI * clamp01(e / UNDO_SECONDS)) * .6;
    return out;
  }
  out.wake = clamp01(e / WAKE);
  out.strain = clamp01((e - WAKE) / STRAIN);
  const k = clamp01((e - WAKE - STRAIN) / SWING);
  out.swing = k;
  out.land = clamp01((e - TURN_IMPACT) / LAND);
  out.steps = r.from + (r.to - r.from) * swingEase(k);
  // The stones rise a little while they strain, ride the swing raised and drop home at its end, with a small settle.
  const up = LIFT * smooth(out.strain), drop = k > .82 ? (k - .82) / .18 : 0;
  out.lift = e >= TURN_IMPACT ? -.012 * Math.sin(Math.PI * Math.min(1, out.land * 2.5)) : up * (1 - drop * drop);
  // Outline brightness: fades in as the totem wakes, brightens as the stones strain, flashes on landing, then fades out.
  const linger = clamp01((e - TURN_SECONDS) / LINGER);
  out.glow = e < WAKE ? .7 * out.wake : e < WAKE + STRAIN ? .7 + .3 * out.strain : e < TURN_IMPACT ? .9 : e < TURN_SECONDS ? 1.6 - out.land * .6 : 1 - linger;
  return out;
}

/** Seconds since a refused tap began flashing (Infinity when none is showing). */
function refusedAge(tc: TurnClock, t: number) {
  if (tc.refuse) { tc.refuse = false; tc.refusedAt = t; }
  const age = t - tc.refusedAt;
  return age < REFUSED_SECONDS ? age : Infinity;
}

/** Turns a quarter-turn count into the rig's yaw: clockwise seen from above is a negative turn about +y. */
export const yawOf = (c: Cluster, steps: number) => -c.turn * steps * Math.PI / 2;

// ---------- Geometry ----------

interface Part { color: string; p?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] }
const tmpM = new Matrix4(), tmpQ = new Quaternion(), tmpE = new Euler(), tmpP = new Vector3(), tmpS = new Vector3();
/** A primitive placed, turned and painted with a flat vertex colour, ready to merge. Uvs are dropped so any mix merges. */
function part(g: BufferGeometry, { color, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] }: Part) {
  const out = g.index ? g.toNonIndexed() : g.clone();
  out.deleteAttribute('uv');
  out.applyMatrix4(tmpM.compose(tmpP.set(...p), tmpQ.setFromEuler(tmpE.set(...r)), tmpS.set(...s)));
  const c = new Color(color), n = out.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  out.setAttribute('color', new BufferAttribute(colors, 3));
  return out;
}
function merge(parts: BufferGeometry[]) {
  const g = mergeGeometries(parts, false)!;
  parts.forEach(x => x.dispose());
  g.computeBoundingSphere();
  return g;
}

const box = new BoxGeometry(1, 1, 1);
const plate = new RoundedBoxGeometry(.94, .07, .94, 2, .025);
const hubGeo = new CylinderGeometry(.2, .23, .09, 16);
const runeRing = new RingGeometry(.235, .285, 28);
const notch = new OctahedronGeometry(.05, 0);
const gemGeo = new OctahedronGeometry(.075, 0);
const STONE_TOP = .07;

/** The stones of a cluster around its pivot (local cells): carved plates, a hub at the pivot, and their rune inlays. */
function stoneGeometry(cells: Point[]) {
  const stones: BufferGeometry[] = [], runes: BufferGeometry[] = [];
  cells.forEach(([x, z], i) => {
    // Jade-carved plates, cooler and greener than any floor, differing slightly in tone like stones cut from different blocks.
    stones.push(part(plate, { color: ['#4f7d68', '#47735f', '#578570', '#4b7863'][i % 4]!, p: [x, STONE_TOP / 2, z] }));
    runes.push(part(runeRing, { color: '#ffffff', p: [x, STONE_TOP + .002, z], r: [-Math.PI / 2, 0, 0] }));
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      runes.push(part(notch, { color: '#ffffff', p: [x + dx! * .37, STONE_TOP + .004, z + dz! * .37], s: [dx ? 1.3 : .6, .12, dz ? 1.3 : .6] }));
    }
  });
  stones.push(part(hubGeo, { color: '#4f5a49', p: [0, .045, 0] }));
  runes.push(part(gemGeo, { color: '#ffffff', p: [0, .15, 0], s: [1, 1.5, 1] }));
  return { stones: merge(stones), runes: merge(runes) };
}

/** Thin strips along a cluster's outer edges, the seams between its stones, and L marks on its outer corners (local cells). */
function lineGeometry(cells: Point[]) {
  const has = new Set(cells.map(key));
  const at = (x: number, z: number) => has.has(key([x + 0, z + 0]));
  const outline: BufferGeometry[] = [], seams: BufferGeometry[] = [], corners: BufferGeometry[] = [];
  for (const [x, z] of cells) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ex = x + dx * .5, ez = z + dz * .5;
      if (!at(x + dx, z + dz)) outline.push(part(box, { color: '#ffffff', p: [ex + dx * .02, .085, ez + dz * .02], s: dx ? [.05, .02, 1.04] : [1.04, .02, .05] }));
      else if (dx > 0 || dz > 0) seams.push(part(box, { color: '#ffffff', p: [ex, .075, ez], s: dx ? [.035, .012, .86] : [.86, .012, .035] }));
    }
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      if (at(x + sx, z) || at(x, z + sz)) continue;
      const cx = x + sx * .56, cz = z + sz * .56;
      corners.push(part(box, { color: '#ffffff', p: [cx - sx * .13, .09, cz], s: [.3, .03, .07] }));
      corners.push(part(box, { color: '#ffffff', p: [cx, .09, cz - sz * .13], s: [.07, .03, .3] }));
    }
  }
  return { outline: merge(outline), seams: seams.length ? merge(seams) : undefined, corners: merge(corners) };
}

/** A flat curved arrow around the origin at radius `r`, counter-clockwise seen from above (mirror it for clockwise). */
function arrowGeometry(r: number, span: number, mid: number) {
  const a0 = mid - span / 2;
  const arc = new TorusGeometry(r, .045, 6, 40, span);
  const parts = [part(arc, { color: '#ffffff', r: [0, 0, a0] })];
  arc.dispose();
  const head = new ConeGeometry(.13, .26, 3);
  const a1 = a0 + span;
  parts.push(part(head, { color: '#ffffff', p: [Math.cos(a1) * r, Math.sin(a1) * r, 0], r: [0, 0, a1], s: [1, 1, .3] }));
  head.dispose();
  // Laid flat: the torus lies in the xy plane; turning it about x puts it on the floor with angles running counter-clockwise.
  const g = merge(parts);
  g.applyMatrix4(tmpM.makeRotationX(-Math.PI / 2));
  return g;
}

// ---------- Materials ----------

const stoneMat = new MeshStandardMaterial({ vertexColors: true, roughness: .78, metalness: .05 });
const glowMat = (color: string, opacity: number) => new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false,
  blending: AdditiveBlending, side: DoubleSide });

// ---------- The rig: everything that turns ----------

/**
 * A cluster's turning rig: a group at the pivot whose yaw is the shown quarter turns, raised while it swings. The
 * cluster's stones and pieces are its children, placed relative to the pivot as the level opens, so the whole turn is a
 * single transform per frame.
 */
export function ClusterRig({ cluster, clock, children }: { cluster: Cluster; clock: TurnClock; children: React.ReactNode }) {
  const rig = useRef<Group>(null);
  const pose = useMemo(newPose, []);
  useFrame(({ clock: c }) => {
    const p = poseAt(clock, c.elapsedTime, pose);
    if (!rig.current) return;
    rig.current.rotation.y = yawOf(cluster, p.steps);
    rig.current.position.y = p.lift;
  });
  return <group position={[cluster.pivot[0], 0, cluster.pivot[1]]}>
    <group ref={rig} rotation={[0, yawOf(cluster, clock.shown), 0]}>{children}</group>
  </group>;
}

/** Where a piece standing on `p` (as the level opens) sits inside its cluster's rig. */
export const rigLocal = (c: Cluster, p: Point): [number, number, number] => [p[0] - c.pivot[0], STONE_TOP, p[1] - c.pivot[1]];

/**
 * The carved stones of a cluster (inside its rig): plates with rune inlays that glow faintly at rest, seams that light up
 * as the mechanism unlocks, and the outline and corner marks that show exactly which cells the totem turns.
 */
export function ClusterStones({ cluster, color, clock, held, delay }: { cluster: Cluster; color: string; clock: TurnClock; held: boolean; delay: number }) {
  const local = useMemo(() => cluster.cells.map(p => [p[0] - cluster.pivot[0], p[1] - cluster.pivot[1]] as Point), [cluster]);
  const geo = useMemo(() => ({ ...stoneGeometry(local), ...lineGeometry(local) }), [local]);
  const mats = useMemo(() => ({ runes: glowMat(color, .4), seams: glowMat(color, 0), outline: glowMat(color, IDLE_OUTLINE), corners: glowMat(color, 0) }), [color]);
  useEffect(() => () => {
    Object.values(geo).forEach(g => g?.dispose());
    Object.values(mats).forEach(m => m.dispose());
  }, [geo, mats]);
  const root = useRef<Group>(null);
  const corners = useRef<Mesh>(null);
  const motes = useRef<Group>(null);
  const appear = useAppear(delay);
  const pose = useMemo(newPose, []);
  const red = useMemo(() => new Color('#ff4a3a'), []), base = useMemo(() => new Color(color), [color]);
  const seeds = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const [x, z] = local[i % local.length]!;
    const a = i * 2.4;
    return { x: x + Math.cos(a) * .42, z: z + Math.sin(a) * .42, s: .7 + (i % 4) * .15, d: (i % 5) * .08 };
  }), [local]);
  const show = useRef(0);
  useFrame(({ clock: c }, dt) => {
    const t = c.elapsedTime;
    const p = poseAt(clock, t, pose);
    const refused = refusedAge(clock, t);
    if (root.current) root.current.scale.setScalar(Math.max(.001, appear(t)));
    // Held: steady and readable. Turning: follows the turn. Refused: a short red pulse.
    const want = Math.max(held ? .85 : 0, p.glow, refused < Infinity ? 1 - refused / REFUSED_SECONDS : 0);
    show.current += (want - show.current) * Math.min(1, dt * (want > show.current ? 14 : 6));
    const s = show.current;
    const tint = refused < Infinity && !p.active ? red : base;
    mats.outline.color.copy(tint).multiplyScalar(Math.max(1, s));
    // At rest a dim line still traces the cluster's edge, so which cells it holds is readable without a tap.
    mats.outline.opacity = Math.max(IDLE_OUTLINE, Math.min(1, s) * (.75 + Math.sin(t * 5) * .1));
    mats.corners.color.copy(tint);
    mats.corners.opacity = Math.min(1, s);
    if (corners.current) corners.current.scale.setScalar(1 + Math.sin(t * 4.5) * .03 * Math.min(1, s));
    // The joints between stones flare as the mechanism unlocks, then cool.
    const joints = Math.max(p.strain * (1 - p.swing * .6), p.land > 0 ? (1 - p.land) * .8 : 0, held ? .25 : 0);
    mats.seams.opacity = joints;
    mats.runes.opacity = .4 + Math.sin(t * 1.3 + cluster.pivot[0]) * .05 + Math.max(joints, p.wake * .5) * .9;
    if (motes.current) {
      motes.current.visible = p.swing > 0 && p.land < 1;
      if (motes.current.visible) motes.current.children.forEach((m, i) => {
        const sd = seeds[i]!;
        const k = clamp01((p.swing + p.land * .4 - sd.d) / .9);
        m.position.set(sd.x, .1 + k * 1.1 * sd.s, sd.z);
        const size = .42 * sd.s * Math.sin(Math.PI * k);
        m.scale.set(size, size, 1);
      });
    }
  });
  return <group ref={root}>
    <mesh geometry={geo.stones} material={stoneMat} receiveShadow castShadow />
    <mesh geometry={geo.runes} material={mats.runes} renderOrder={3} />
    {geo.seams && <mesh geometry={geo.seams} material={mats.seams} renderOrder={3} />}
    <mesh geometry={geo.outline} material={mats.outline} renderOrder={3} />
    <mesh ref={corners} geometry={geo.corners} material={mats.corners} renderOrder={3} />
    <group ref={motes} visible={false}>{seeds.map((_, i) => <sprite key={i} renderOrder={7}>
      <spriteMaterial map={glowTexture} color={color} transparent opacity={.8} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </sprite>)}</group>
  </group>;
}

// ---------- Guides: what stays put while the stones turn ----------

const leafGeo = (() => { const g = new ConeGeometry(.12, .36, 4); g.scale(1, 1, .25); return g; })();
const leafMat = new MeshStandardMaterial({ color: '#4f9a3c', roughness: .7, flatShading: true, side: DoubleSide });
const dustMat = new SpriteMaterial({ map: glowTexture, color: '#bfae8c', transparent: true, opacity: 0, depthWrite: false });
const markGeo = new PlaneGeometry(.86, .86);
const crossGeo = new BoxGeometry(.62, .03, .07);
const LEAVES = 10, DUST = 10, MARKS = 8;
const dummy = new Object3D();

/**
 * Guides around a cluster that do not turn with it (in board cells): the pivot marker and turn arrow, the ghost of where
 * the stones will land, red marks on whatever stands in their way, and the leaves and dust the turn shakes loose.
 */
export function ClusterGuides({ cluster, color, clock, held, blocks, landing, totem }: {
  cluster: Cluster; color: string; clock: TurnClock; held: boolean;
  /** Cells in the way of the next turn (empty when it is free). */
  blocks: Point[];
  /** Cells on the edge of where the stones will land, for the dust. */
  landing: Point[];
  totem: Point;
}) {
  const radius = useMemo(() => Math.max(...cluster.cells.map(p => Math.hypot(p[0] - cluster.pivot[0], p[1] - cluster.pivot[1]))) + .78, [cluster]);
  // The arrow sits on the side facing the camera (south), where nothing else on the board hides it.
  const arrow = useMemo(() => arrowGeometry(radius, 1.25, cluster.turn > 0 ? Math.PI / 2 : -Math.PI / 2), [radius, cluster.turn]);
  const lines = useMemo(() => lineGeometry(cluster.cells.map(p => [p[0] - cluster.pivot[0], p[1] - cluster.pivot[1]] as Point)), [cluster]);
  const mats = useMemo(() => {
    // The red marks glow through whatever stands in the way, so a blocking crystal or mirror lights up red itself.
    const red = glowMat('#ff3a2a', 0);
    red.depthTest = false;
    return { arrow: glowMat(color, 0), ghost: glowMat(color, 0), pivot: glowMat(color, 0), red };
  }, [color]);
  useEffect(() => () => {
    arrow.dispose(); Object.values(lines).forEach(g => g?.dispose());
    Object.values(mats).forEach(m => m.dispose());
  }, [arrow, lines, mats]);
  const arrowRef = useRef<Group>(null);
  const ghost = useRef<Group>(null);
  const pivot = useRef<Group>(null);
  const marks = useRef<Group>(null);
  const leaves = useRef<InstancedMesh>(null);
  const dust = useRef<Group>(null);
  const pose = useMemo(newPose, []);
  const show = useRef(0);
  const seeds = useMemo(() => Array.from({ length: LEAVES }, (_, i) => ({ a: i * 2.39, r: .3 + (i % 3) * .35, spin: 2 + (i % 4), fromTotem: i < 4, d: (i % 5) * .07 })), []);
  const [px, pz] = cluster.pivot;
  useFrame(({ clock: c }, dt) => {
    const t = c.elapsedTime;
    const p = poseAt(clock, t, pose);
    const refused = refusedAge(clock, t);
    const want = Math.max(held ? 1 : 0, p.active ? Math.min(1, p.glow) : 0);
    show.current += (want - show.current) * Math.min(1, dt * (want > show.current ? 14 : 6));
    const s = show.current;
    mats.arrow.opacity = s * (.7 + Math.sin(t * 6) * .15);
    if (arrowRef.current) {
      arrowRef.current.visible = s > .01;
      // The arrow creeps along its own direction while the stones swing, so it reads as motion, not decoration.
      arrowRef.current.rotation.y = yawOf(cluster, p.swing * .25);
    }
    // Pivot: a ring on the floor and a soft glow above it, pulsing as the stones strain.
    if (pivot.current) {
      pivot.current.visible = s > .01;
      const pulse = p.strain > 0 && p.swing < 1 ? 1 + Math.sin(p.strain * Math.PI) * .5 : 1;
      pivot.current.scale.setScalar(pulse);
      mats.pivot.opacity = s * .9;
    }
    // Where the stones will land: shown while held and as the turn begins, gone once they swing.
    const preview = held && !blocks.length ? 1 : p.active && clock.run?.cinematic ? (1 - p.swing) * Math.min(1, p.wake * 2) : 0;
    mats.ghost.opacity = preview * .45;
    if (ghost.current) {
      ghost.current.visible = preview > .01;
      ghost.current.rotation.y = yawOf(cluster, (clock.run?.cinematic ? clock.run.from : clock.shown) + 1);
    }
    // Cells in the way: red while held, or flashing after a refused tap.
    const r = refused < Infinity ? (1 - refused / REFUSED_SECONDS) * (.6 + .4 * Math.abs(Math.sin(refused * 18))) : held ? .55 + Math.sin(t * 6) * .2 : 0;
    mats.red.opacity = r;
    if (marks.current) {
      marks.current.visible = r > .01 && blocks.length > 0;
      marks.current.children.forEach((m, i) => {
        const b = blocks[i];
        m.visible = !!b;
        if (b) m.position.set(b[0] - px, 0, b[1] - pz);
      });
    }
    // Leaves: a few shaken from the totem's crown as it wakes, more drifting down over the stones as they swing.
    const lm = leaves.current;
    if (lm) {
      const live = p.active && !!clock.run?.cinematic && p.elapsed < TURN_SECONDS + .3;
      lm.visible = live;
      if (live) {
        seeds.forEach((sd, i) => {
          const k = sd.fromTotem ? clamp01((p.elapsed - sd.d) / 1.3) : clamp01((p.elapsed - WAKE - STRAIN - sd.d) / 1.5);
          const ox = sd.fromTotem ? totem[0] - px : Math.cos(sd.a) * sd.r * radius * .6, oz = sd.fromTotem ? totem[1] - pz : Math.sin(sd.a) * sd.r * radius * .6;
          const fall = sd.fromTotem ? 1.35 * (1 - k) + .05 : 2.4 * (1 - k) + .05;
          const blow = p.land > 0 ? p.land * .6 : 0;
          dummy.position.set(ox + Math.sin(k * 6 + sd.a) * .25 + Math.cos(sd.a) * blow, Math.max(.06, fall), oz + Math.cos(k * 5 + sd.a) * .2 + Math.sin(sd.a) * blow);
          dummy.rotation.set(k * sd.spin, sd.a + k * 3, k * sd.spin * .7);
          dummy.scale.setScalar(k > 0 && k < 1 ? 1 : 0.001);
          dummy.updateMatrix();
          lm.setMatrixAt(i, dummy.matrix);
        });
        lm.instanceMatrix.needsUpdate = true;
      }
    }
    // Dust: a low ring puffs out where the stones land, and hangs a moment after they settle.
    if (dust.current) {
      const k = clamp01((p.elapsed - TURN_IMPACT) / DUST_SECONDS);
      const on = !!clock.run?.cinematic && p.elapsed >= TURN_IMPACT && k < 1;
      dust.current.visible = on;
      if (on) dust.current.children.forEach((d, i) => {
        const q = landing[i % Math.max(1, landing.length)];
        if (!q) { d.visible = false; return; }
        d.visible = true;
        // Two puffs per stone, thrown out on either side of the line from the pivot.
        const side = i < landing.length ? .35 : -.35;
        const ox = q[0] - px, oz = q[1] - pz, len = Math.hypot(ox, oz) || 1;
        const ux = ox / len, uz = oz / len, spread = 1 - (1 - k) * (1 - k);
        d.position.set(ox + (ux - uz * side) * spread * .55, .14 + spread * .3, oz + (uz + ux * side) * spread * .55);
        const size = .6 + spread * 1.2;
        d.scale.set(size, size * .65, 1);
      });
      dustMat.opacity = on ? .7 * (1 - k) : 0;
    }
  });
  return <group position={[px, 0, pz]}>
    <group ref={arrowRef} visible={false}><mesh geometry={arrow} material={mats.arrow} position={[0, .1, 0]} scale={[1, 1, cluster.turn > 0 ? -1 : 1]} renderOrder={4} /></group>
    <group ref={pivot} visible={false}>
      <mesh material={mats.pivot} position={[0, .1, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}><ringGeometry args={[.16, .23, 32]} /></mesh>
      <sprite position={[0, .55, 0]} scale={[.6, 1.1, 1]} renderOrder={6}>
        <spriteMaterial map={glowTexture} color={color} transparent opacity={.55} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </sprite>
    </group>
    <group ref={ghost} visible={false}>
      <mesh geometry={lines.outline} material={mats.ghost} renderOrder={4} />
      <mesh geometry={lines.corners} material={mats.ghost} renderOrder={4} />
    </group>
    {/* Above any cluster's stone plates and drawn after the pieces, so a blocking cell always shows its mark. */}
    <group ref={marks} visible={false}>{Array.from({ length: MARKS }, (_, i) => <group key={i}>
      <mesh geometry={markGeo} material={mats.red} position={[0, STONE_TOP + .02, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={9} />
      <mesh geometry={crossGeo} material={mats.red} position={[0, STONE_TOP + .05, 0]} rotation={[0, Math.PI / 4, 0]} renderOrder={9} />
      <mesh geometry={crossGeo} material={mats.red} position={[0, STONE_TOP + .05, 0]} rotation={[0, -Math.PI / 4, 0]} renderOrder={9} />
    </group>)}</group>
    <instancedMesh ref={leaves} args={[leafGeo, leafMat, LEAVES]} visible={false} frustumCulled={false} dispose={null} />
    <group ref={dust} visible={false}>{Array.from({ length: DUST }, (_, i) => <sprite key={i} material={dustMat} renderOrder={5} />)}</group>
  </group>;
}

// ---------- The totem ----------

/** The carved totem: a stone plinth with roots gripping it, three stacked wooden faces, a leaf crown and an emerald gem. */
function totemGeometry() {
  const wood = ['#6e4b2f', '#7a5534', '#684830'], dark = '#4c3222', stone = '#5c6453';
  const body: BufferGeometry[] = [], leaves: BufferGeometry[] = [], runes: BufferGeometry[] = [];
  const plinth = new CylinderGeometry(.4, .44, .14, 8);
  body.push(part(plinth, { color: stone, p: [0, .07, 0], r: [0, Math.PI / 8, 0] }));
  plinth.dispose();
  const root = new ConeGeometry(.05, .3, 5);
  for (let i = 0; i < 5; i++) {
    const a = i * 1.257 + .3;
    body.push(part(root, { color: '#4a3424', p: [Math.cos(a) * .3, .16, Math.sin(a) * .3], r: [0, -a, -Math.PI / 2 + .35] }));
  }
  root.dispose();
  const tiers = [[.46, .34, .42, .31], [.42, .32, .4, .64], [.38, .28, .36, .94]] as const;
  tiers.forEach(([w, h, d, y], i) => {
    body.push(part(box, { color: wood[i]!, p: [0, y, 0], s: [w, h, d] }));
    // A brow over each face, a dark mouth below, and the eye slits as rune inlays.
    body.push(part(box, { color: dark, p: [0, y + h * .36, d / 2 + .02], s: [w + .06, .05, .08] }));
    body.push(part(box, { color: '#2e1f16', p: [0, y - h * .28, d / 2 + .005], s: [w * .5, .04, .02] }));
    for (const s of [-1, 1]) runes.push(part(box, { color: '#ffffff', p: [s * w * .22, y + h * .1, d / 2 + .012], s: [.08, .04, .02] }));
    for (const s of [-1, 1]) runes.push(part(box, { color: '#ffffff', p: [s * (w / 2 + .006), y, 0], s: [.012, h * .6, .05] }));
  });
  const beak = new ConeGeometry(.05, .14, 4);
  body.push(part(beak, { color: dark, p: [0, .62, .23], r: [Math.PI / 2, 0, 0] }));
  beak.dispose();
  body.push(part(box, { color: dark, p: [0, 1.12, 0], s: [.5, .07, .46] }));
  const frond = new ConeGeometry(.08, .48, 4);
  for (let i = 0; i < 7; i++) {
    const a = i * .9;
    leaves.push(part(frond, { color: ['#3f8a3c', '#4fa046', '#357a34'][i % 3]!, p: [Math.cos(a) * .12, 1.3, Math.sin(a) * .12], r: [Math.sin(a) * .7, 0, -Math.cos(a) * .7] }));
  }
  frond.dispose();
  const band = new TorusGeometry(.42, .018, 6, 32);
  runes.push(part(band, { color: '#ffffff', p: [0, .145, 0], r: [Math.PI / 2, 0, 0] }));
  band.dispose();
  return { body: merge(body), leaves: merge(leaves), runes: merge(runes) };
}
let sharedTotem: ReturnType<typeof totemGeometry> | undefined;
const totemBodyMat = new MeshStandardMaterial({ vertexColors: true, roughness: .82, flatShading: true });
const totemLeafMat = new MeshStandardMaterial({ vertexColors: true, roughness: .7, flatShading: true });

/**
 * A rootbound totem. Its runes glow faintly at rest, in its cluster's colour, with a carved arrow on its plinth showing
 * which way its stones turn. Tapped, it wakes: the runes ignite, a pulse climbs its carvings and its leaves shiver. A tap
 * the stones cannot obey makes it shudder instead (and costs nothing).
 */
export const TotemPiece = React.memo(function TotemPiece({ cluster, color, clock, legal, hint, delay, onTap, onBlocked, onPreview }: {
  cluster: Cluster; color: string; clock: TurnClock; legal: boolean; hint: boolean; delay: number;
  onTap?: () => void; onBlocked?: () => void; onPreview?: (on: boolean) => void;
}) {
  const geo = useMemo(() => (sharedTotem ??= totemGeometry()), []);
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const plinth = useRef<Mesh>(null), faces = useRef<Mesh>(null), top = useRef<Mesh>(null);
  const crown = useRef<Mesh>(null);
  const pulse = useRef<Mesh>(null);
  const glow = useRef<Sprite>(null);
  const appear = useAppear(delay);
  const pose = useMemo(newPose, []);
  const wobble = useRef(0);
  const mats = useMemo(() => ({ runes: glowMat(color, .5), pulse: glowMat(color, 0), arrow: glowMat(color, .5) }), [color]);
  const arrow = useMemo(() => arrowGeometry(.32, 1.9, cluster.turn > 0 ? Math.PI / 2 : -Math.PI / 2), [cluster.turn]);
  useEffect(() => () => { Object.values(mats).forEach(m => m.dispose()); arrow.dispose(); }, [mats, arrow]);
  usePickTarget(onTap && {
    id: cluster.totem.id, ring: .8, hold: onPreview,
    tap: () => { if (!legal) { wobble.current = 1; clock.refuse = true; onBlocked?.(); } else onTap(); },
  }, root, [plinth, faces, top]);
  const [tx, tz] = cluster.totem.position;
  // The carved faces look towards the stones they turn.
  const facing = Math.atan2(cluster.pivot[0] - tx, cluster.pivot[1] - tz);
  const base = useMemo(() => new Color(color), [color]);
  useFrame(({ clock: c }, dt) => {
    const t = c.elapsedTime;
    const p = poseAt(clock, t, pose);
    const cinematic = !!clock.run?.cinematic && p.active;
    if (root.current) root.current.scale.setScalar(Math.max(.001, appear(t)) * TOTEM_SCALE);
    wobble.current = Math.max(0, wobble.current - dt * 2.2);
    // Runes: a faint breath at rest; ignite as the totem wakes, hold while the stones turn, flare as they land.
    const ignite = cinematic ? (p.elapsed < TURN_IMPACT ? .4 + p.wake * 2.4 : 2.8 * (1 - p.land) + .4) : .45 + Math.sin(t * 1.6 + tx) * .12;
    mats.runes.color.copy(base).multiplyScalar(Math.max(1, ignite));
    mats.runes.opacity = Math.min(1, ignite);
    mats.arrow.opacity = Math.min(1, .45 + (cinematic ? p.glow * .5 : 0));
    // A ring of light climbs the carvings as the totem wakes.
    if (pulse.current) {
      const on = cinematic && p.wake < 1;
      pulse.current.visible = on;
      if (on) { pulse.current.position.y = .12 + p.wake * 1.15; mats.pulse.opacity = Math.sin(Math.PI * p.wake) * .9; }
    }
    if (body.current) {
      // A shudder while the stones strain, and a quick shake when a tap is refused.
      const strain = cinematic && p.strain > 0 && p.swing < .2 ? .012 * (1 - p.swing * 5) : 0;
      body.current.position.x = Math.sin(t * 47) * (strain + wobble.current * .03);
      body.current.rotation.z = Math.sin(t * 31) * wobble.current * .05;
    }
    if (crown.current) crown.current.rotation.y = Math.sin(t * .8 + tz) * .06 + (cinematic && p.wake < 1 ? Math.sin(t * 26) * .08 * (1 - p.wake) : 0);
    if (glow.current) {
      const g = cinematic ? Math.max(p.wake, 1 - p.land) : .35;
      glow.current.material.opacity = Math.min(1, g * .9);
      glow.current.scale.setScalar(.7 + g * .7);
    }
  });
  return <group position={[tx, 0, tz]}>
    <group ref={root}>
      <group ref={body} rotation={[0, facing, 0]}>
        <mesh geometry={geo.body} material={totemBodyMat} castShadow receiveShadow dispose={null} />
        <mesh ref={crown} geometry={geo.leaves} material={totemLeafMat} castShadow dispose={null} />
        <mesh geometry={geo.runes} material={mats.runes} renderOrder={3} dispose={null} />
        <mesh position={[0, 1.27, 0]} scale={[1, 1.5, 1]}><octahedronGeometry args={[.09, 0]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>
        <sprite ref={glow} position={[0, 1.27, 0]} scale={[1, 1, 1]} renderOrder={6}>
          <spriteMaterial map={glowTexture} color={color} transparent opacity={.3} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
        </sprite>
        <mesh ref={pulse} material={mats.pulse} rotation={[Math.PI / 2, 0, 0]} visible={false} renderOrder={5}><torusGeometry args={[.3, .025, 6, 28]} /></mesh>
        {onTap && <><mesh ref={plinth} {...proxyMesh(proxies.totem.plinth)} /><mesh ref={faces} {...proxyMesh(proxies.totem.faces)} />
          <mesh ref={top} {...proxyMesh(proxies.totem.crown)} /></>}
      </group>
      <mesh geometry={arrow} material={mats.arrow} position={[0, .15, 0]} scale={[1, 1, cluster.turn > 0 ? -1 : 1]} renderOrder={4} />
    </group>
    {hint && <HintArrow />}
  </group>;
});
