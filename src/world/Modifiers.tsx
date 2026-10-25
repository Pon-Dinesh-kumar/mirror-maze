import React, { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry,
  PlaneGeometry, SphereGeometry, Sprite, SpriteMaterial, TorusGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { useFrame } from './Canvas';
import { diskMaterial, disposeShader, glassMaterial, glowTexture, horizonMaterial } from './fx';
import { useAppear } from './Board';
import { HintArrow } from './Entities';
import { proxies } from './pick';
import { proxyMesh, usePickTarget } from './Picker';
import type { BeamClock } from './Beam';
import { Absorption, abyssPose } from './abyss';
import { Devourer, Floe, Gate, Orientation, Point, Seal } from '../game/types';
import { audio } from '../services/audio';

/*
 * The chapter modifiers on the board: drifting ice floes and their tracks (Ice Age), solar seals and their gates
 * (Desert) and the Light Devourer (The Void). Every piece only shows the state the rules hand it; the animations ease
 * between states and never decide anything.
 */

const ease = (from: number, to: number, dt: number, rate: number) => from + (to - from) * Math.min(1, dt * rate);

const discGeo = new CylinderGeometry(.42, .46, .1, 24);
const ringGeo = new TorusGeometry(.29, .025, 8, 40);
const studGeo = new SphereGeometry(.05, 10, 8);
const rayGeo = new ConeGeometry(.04, .2, 4);
const gemGeo = new OctahedronGeometry(.12, 0);
const plateGeo = new PlaneGeometry(1, 1);
const boxGeo = new BoxGeometry(1, 1, 1);

/** Seal and gate colours by seal order, so a gate shows which seal moves it. */
export const sealColors = ['#ffcf4a', '#6ae8ff', '#ff8ad8'];
const sandstone = new MeshStandardMaterial({ color: '#d2a86a', roughness: .9 });
const sandstoneDark = new MeshStandardMaterial({ color: '#a8804a', roughness: .95 });

/**
 * A solar seal: a sandstone dais with a sun ring and one stud per place in the order. Lit and active, it blazes gold and
 * its rays turn; lit too early (a lower-numbered seal still sleeps) it flickers red to say "not yet".
 */
export const SealPiece = React.memo(function SealPiece({ seal, active, lit, delay, sounds }: {
  seal: Seal; active: boolean; lit: boolean; delay: number; sounds: boolean;
}) {
  const root = useRef<Group>(null);
  const rays = useRef<Group>(null);
  const glow = useRef<Sprite>(null);
  const appear = useAppear(delay);
  const heat = useRef(active ? 1 : 0);
  const color = sealColors[(seal.order - 1) % sealColors.length]!;
  const mats = useMemo(() => ({
    ring: new MeshStandardMaterial({ color, metalness: .9, roughness: .3, emissive: color, emissiveIntensity: .15 }),
    gem: new MeshStandardMaterial({ color, roughness: .1, metalness: .2, emissive: color, emissiveIntensity: .2, flatShading: true }),
    stud: new MeshStandardMaterial({ color: '#ffe8a0', metalness: 1, roughness: .25 }),
  }), [color]);
  useEffect(() => () => Object.values(mats).forEach(m => m.dispose()), [mats]);
  const was = useRef(active);
  useEffect(() => {
    if (sounds && active && !was.current) { audio.play('seal', .8); audio.haptic('success'); }
    was.current = active;
  }, [active, sounds]);
  const locked = lit && !active;
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (root.current) root.current.scale.setScalar(Math.max(.001, appear(t)));
    heat.current = ease(heat.current, active ? 1 : 0, dt, 4);
    const h = heat.current;
    const flicker = locked ? .5 + .5 * Math.abs(Math.sin(t * 9)) : 0;
    mats.ring.emissiveIntensity = .15 + h * 1.6;
    mats.gem.emissiveIntensity = .2 + h * 2.4 + flicker * 1.5;
    mats.gem.emissive.set(locked ? '#ff3a3a' : color);
    if (rays.current) { rays.current.rotation.y = t * (.4 + h * 1.4); rays.current.scale.setScalar(.6 + h * .5); rays.current.visible = h > .05; }
    if (glow.current) { glow.current.material.opacity = h * .8 + flicker * .4; glow.current.material.color.set(locked ? '#ff4a3a' : color); }
  });
  return <group ref={root}>
    <mesh geometry={discGeo} material={sandstone} position={[0, .05, 0]} receiveShadow />
    <mesh geometry={ringGeo} material={mats.ring} position={[0, .11, 0]} rotation={[Math.PI / 2, 0, 0]} />
    {Array.from({ length: seal.order }, (_, i) => <mesh key={i} geometry={studGeo} material={mats.stud}
      position={[(i - (seal.order - 1) / 2) * .13, .12, .36]} />)}
    <mesh geometry={gemGeo} material={mats.gem} position={[0, .3, 0]} scale={[1, 1.4, 1]} />
    <group ref={rays} position={[0, .14, 0]}>{Array.from({ length: 8 }, (_, i) => <mesh key={i} geometry={rayGeo} material={mats.ring}
      position={[Math.cos(i * .785) * .4, 0, Math.sin(i * .785) * .4]} rotation={[0, -i * .785, -Math.PI / 2]} />)}</group>
    <sprite ref={glow} position={[0, .32, 0]} scale={[1.4, 1.4, 1]} renderOrder={6}>
      <spriteMaterial map={glowTexture} color={color} opacity={0} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </sprite>
  </group>;
});

/** A sandstone gate: a slab between two pillars that slides down into the floor to open, glyph lit in its seal's colour. */
export const GatePiece = React.memo(function GatePiece({ gate, open, color, delay, sounds }: { gate: Gate; open: boolean; color: string; delay: number; sounds: boolean }) {
  const root = useRef<Group>(null);
  const slab = useRef<Group>(null);
  const appear = useAppear(delay);
  const lift = useRef(open ? 0 : 1);
  const glyph = useMemo(() => new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, toneMapped: false }), [color]);
  useEffect(() => () => glyph.dispose(), [glyph]);
  const was = useRef(open);
  useEffect(() => {
    if (sounds && open !== was.current) { audio.play('gate', .8); audio.haptic('heavy'); }
    was.current = open;
  }, [open, sounds]);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (root.current) root.current.scale.setScalar(Math.max(.001, appear(t)));
    lift.current = ease(lift.current, open ? 0 : 1, dt, 3.5);
    if (slab.current) {
      const l = lift.current;
      slab.current.position.y = -.5 + l * 1.02 + (l > .02 && l < .98 ? Math.sin(t * 60) * .008 : 0);
      slab.current.visible = l > .03;
    }
    glyph.emissiveIntensity = (open ? .5 : 1.1) + Math.sin(t * 2.5) * .2;
  });
  // The gate faces across the row it stands in; light from any side is stopped by the closed slab.
  return <group ref={root}>
    {[-1, 1].map(s => <group key={s} position={[s * .42, 0, 0]}>
      <mesh geometry={boxGeo} material={sandstoneDark} position={[0, .62, 0]} scale={[.14, 1.24, .2]} castShadow />
      <mesh geometry={boxGeo} material={sandstone} position={[0, 1.27, 0]} scale={[.2, .08, .26]} />
    </group>)}
    <mesh geometry={boxGeo} material={sandstone} position={[0, 1.27, 0]} scale={[1, .1, .22]} />
    <group ref={slab}>
      <mesh geometry={boxGeo} material={sandstone} position={[0, .5, 0]} scale={[.7, .98, .16]} castShadow />
      {[-1, 1].map(s => <mesh key={s} geometry={boxGeo} material={glyph} position={[0, .52, s * .085]} scale={[.42, .08, .01]} />)}
      {[-1, 1].map(s => <mesh key={`e${s}`} geometry={gemGeo} material={glyph} position={[0, .75, s * .086]} scale={[.6, .6, .15]} />)}
    </group>
  </group>;
});

const voidMats = {
  core: new MeshBasicMaterial({ color: '#000000' }),
  floor: new MeshBasicMaterial({ color: '#12031e', transparent: true, opacity: .72, depthWrite: false }),
  // A soft gravity well: the tiles around a black hole are darker the nearer they lie to it.
  well: new MeshBasicMaterial({ map: glowTexture, color: '#000000', transparent: true, opacity: .62, depthWrite: false }),
};
const coreGeo = new SphereGeometry(.3, 24, 16);
/** Where the hole's glowing parts sit in the draw order: after the darkness veil, so they stay the last light left. */
export const ABOVE_VEIL = 30;
const ORBITERS = 9;

/** A Devourer's absorption in progress: the rules' record of the loss, and the clock time the light reached the hole. */
export interface AbyssRun { record: Absorption; start: number }

/**
 * The Light Devourer: a black hole. At rest it is restrained: a core that stays truly dark, a thin violet-magenta event
 * horizon that ripples now and then, a slowly turning accretion disc, a few motes in orbit and a gravity well darkening
 * the tiles around it. Its zone is drawn on the floor, dark and edged in red where it meets safe tiles, so the swallowing
 * ground is always visible. When light enters it (`run`), it flashes at the edge, grows, drags its motes in, and finally
 * contracts with a burning rim, timed by the absorption timeline.
 */
export const DevourerPiece = React.memo(function DevourerPiece({ devourer, run, delay }: { devourer: Devourer; run: { current?: AbyssRun }; delay: number }) {
  const root = useRef<Group>(null);
  const disc = useRef<Mesh>(null);
  const core = useRef<Mesh>(null);
  const halo = useRef<Sprite>(null);
  const horizon = useRef<Mesh>(null);
  const orbit = useRef<Group>(null);
  const appear = useAppear(delay);
  // The Void's palette: magenta gas cooling into violet-indigo (the sky's Void Eye keeps its own orange disc).
  const disk = useMemo(() => { const m = diskMaterial([.95, .3, .8], [.42, .16, 1]); m.toneMapped = false; return m; }, []);
  const rim = useMemo(() => horizonMaterial(), []);
  const edge = useMemo(() => new MeshBasicMaterial({ color: '#ff2a5a', transparent: true, opacity: .8, depthWrite: false, toneMapped: false }), []);
  useEffect(() => () => { disposeShader(disk); disposeShader(rim); edge.dispose(); }, [disk, rim, edge]);
  const pose = useMemo(() => abyssPose(-1), []);
  const motes = useMemo(() => Array.from({ length: ORBITERS }, (_, i) => ({ r: .52 + (i % 3) * .17, speed: .7 + (i % 4) * .22, phase: i * 2.1, tilt: (i % 2 ? 1 : -1) * (.1 + (i % 3) * .06) })), []);
  const [cx, cz] = devourer.position;
  // Each hole ripples on its own rhythm.
  const rhythm = 6.5 + ((cx * 7 + cz * 3) % 5) * .4;
  // Zone tiles relative to the core, and the outer edges where the zone meets safe ground.
  const zone = useMemo(() => {
    const cells = new Set(devourer.zone.map(p => `${p[0]},${p[1]}`));
    const tiles = devourer.zone.map(p => [p[0] - cx, p[1] - cz] as const);
    const edges: { x: number; z: number; w: number; d: number }[] = [];
    for (const [x, z] of devourer.zone as Point[]) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (cells.has(`${x + dx},${z + dz}`)) continue;
      edges.push({ x: x - cx + dx * .47, z: z - cz + dz * .47, w: dx ? .05 : .96, d: dz ? .05 : .96 });
    }
    return { tiles, edges };
  }, [devourer, cx, cz]);
  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime;
    if (root.current) root.current.scale.setScalar(Math.max(.001, appear(t)));
    const r = run.current?.record.devourer === devourer.id ? run.current : undefined;
    const p = abyssPose(r && r.start >= 0 ? t - r.start : -1, pose);
    const feeding = !!r;
    // Grows to about twice its size, then contracts a little as it swallows the last light. The disc and halo stay
    // restrained while it grows: the threat reads from the size and the dark centre, not from a bright ball of glow.
    const size = 1 + p.grow * 1.1 - p.collapse * .3;
    const flash = p.impact > 0 && p.impact < 1 ? Math.sin(Math.PI * p.impact) : 0;
    disk.uniforms.uPulse!.value = .1 + Math.sin(t * 2) * .1 + flash * 1.1 + p.grow * .5 + p.pull * .45 - p.collapse * .6;
    if (disc.current) {
      disc.current.rotation.z = -t * (.6 + p.grow * 3 + p.pull * 5);
      disc.current.scale.setScalar(1.6 * (1 + p.grow * .7 + p.pull * .1 - p.collapse * .3));
    }
    if (core.current) core.current.scale.setScalar(size + Math.sin(t * 3) * .02);
    if (horizon.current) {
      horizon.current.quaternion.copy(camera.quaternion);
      // The horizon quad is four core radii wide, so the rim sits at a quarter of it whatever the hole's size.
      horizon.current.scale.setScalar(.3 * 4 * size);
      rim.uniforms.uCore!.value = .25;
      // Restrained at rest; the strongest light is kept for the impact and the collapse.
      rim.uniforms.uRim!.value = .62 + Math.sin(t * 1.3) * .06 + flash * 1.8 + p.grow * .35 + p.collapse * 1.8 * (1 - p.wave);
      const ripple = ((t + cx) % rhythm) / 1.6;
      rim.uniforms.uRipple!.value = feeding ? -1 : ripple < 1 ? ripple : -1;
    }
    if (halo.current) { halo.current.material.opacity = .3 + flash * .35 + p.grow * .08; halo.current.scale.setScalar((1.8 + flash * .8 + Math.sin(t * 2.4) * .1) * (1 + p.grow * .4)); }
    if (orbit.current) orbit.current.children.forEach((m, i) => {
      const o = motes[i]!;
      // Motes in a lazy orbit, dragged faster and inward while the hole feeds, until it swallows them.
      const inward = Math.max(0, 1 - p.grow * .3 - p.pull);
      const a = o.phase + t * o.speed * (1 + p.grow * 2 + p.pull * 6);
      const rr = o.r * size * inward;
      m.position.set(Math.cos(a) * rr, Math.sin(a * 1.3) * .08 + o.tilt * Math.sin(a) * rr, Math.sin(a) * rr);
      m.visible = inward > .05;
    });
    edge.opacity = .55 + Math.abs(Math.sin(t * (feeding ? 12 : 2.2))) * .4;
  });
  return <group ref={root}>
    <mesh geometry={plateGeo} material={voidMats.well} rotation={[-Math.PI / 2, 0, 0]} position={[0, .008, 0]} scale={3.6} />
    {zone.tiles.map(([x, z], i) => <mesh key={i} geometry={plateGeo} material={voidMats.floor} rotation={[-Math.PI / 2, 0, 0]} position={[x, .012, z]} scale={.96} />)}
    {zone.edges.map((e, i) => <mesh key={`e${i}`} geometry={plateGeo} material={edge} rotation={[-Math.PI / 2, 0, 0]} position={[e.x, .02, e.z]} scale={[e.w, e.d, 1]} />)}
    <group position={[0, .72, 0]}>
      <mesh ref={disc} geometry={plateGeo} material={disk} rotation={[-Math.PI / 2 + .35, 0, 0]} scale={1.6} renderOrder={ABOVE_VEIL} />
      <mesh ref={core} geometry={coreGeo} material={voidMats.core} />
      <mesh ref={horizon} geometry={plateGeo} material={rim} renderOrder={ABOVE_VEIL + 1} />
      <sprite ref={halo} renderOrder={ABOVE_VEIL - 1} scale={[1.8, 1.8, 1]}>
        <spriteMaterial map={glowTexture} color="#a83aff" opacity={.4} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </sprite>
      <group ref={orbit}>{motes.map((_, i) => <sprite key={i} scale={[.13, .13, 1]} renderOrder={ABOVE_VEIL}>
        <spriteMaterial map={glowTexture} color={i % 3 ? '#d8a8ff' : '#ffffff'} transparent opacity={.85} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </sprite>)}</group>
    </group>
  </group>;
});

const trackMats = {
  // Saturated cyan reads both on the Ice Age's near-white floor and on the Void's dark one.
  ice: new MeshBasicMaterial({ color: '#6fd0ff', transparent: true, opacity: .55, depthWrite: false, toneMapped: false }),
  rim: new MeshBasicMaterial({ color: '#2fb4ff', transparent: true, opacity: .95, depthWrite: false, toneMapped: false }),
  stop: new MeshBasicMaterial({ color: '#1a86e0', transparent: true, opacity: .85, depthWrite: false, toneMapped: false }),
  snow: new MeshStandardMaterial({ color: '#f4fbff', roughness: .7, flatShading: true }),
};
const snowGeo = new SphereGeometry(1, 7, 5);
const notchGeo = new CylinderGeometry(.09, .09, .01, 16);

/**
 * An ice track: a strip of clear ice across the tiles a floe can glide over, with a notch on every stop and a snow drift
 * at each end where the floe turns back.
 */
export const FloeTrack = React.memo(function FloeTrack({ floe, delay }: { floe: Floe; delay: number }) {
  const root = useRef<Group>(null);
  const appear = useAppear(delay);
  const first = floe.track[0]!, second = floe.track[1]!;
  const length = floe.track.length - 1;
  useFrame(({ clock }) => { if (root.current) root.current.scale.setScalar(Math.max(.001, appear(clock.elapsedTime))); });
  // Drawn from the first cell along local x, turned to run towards the second.
  return <group position={[first[0], 0, first[1]]} rotation={[0, Math.atan2(first[1] - second[1], second[0] - first[0]), 0]}>
    <group ref={root}>
      <mesh geometry={plateGeo} material={trackMats.ice} rotation={[-Math.PI / 2, 0, 0]} position={[length / 2, .018, 0]} scale={[length + .7, .56, 1]} renderOrder={2} />
      {[-1, 1].map(s => <mesh key={s} geometry={plateGeo} material={trackMats.rim} rotation={[-Math.PI / 2, 0, 0]} position={[length / 2, .02, s * .28]}
        scale={[length + .7, .035, 1]} renderOrder={3} />)}
      {floe.track.map((_, i) => <mesh key={i} geometry={notchGeo} material={trackMats.stop} position={[i, .022, 0]} renderOrder={3} />)}
      {[-.42, length + .42].map((x, i) => <mesh key={i} geometry={snowGeo} material={trackMats.snow} position={[x, .05, 0]} scale={[.12, .09, .3]} castShadow />)}
    </group>
  </group>;
});

const floeMats = {
  raft: new MeshStandardMaterial({ color: '#d8f2ff', roughness: .2, metalness: .05, transparent: true, opacity: .9, envMapIntensity: 1.8, flatShading: true }),
  frame: new MeshStandardMaterial({ color: '#cfe6f6', metalness: .7, roughness: .22, emissive: '#2a6a9a', emissiveIntensity: .2 }),
  ice: new MeshStandardMaterial({ color: '#cfefff', roughness: .05, metalness: .1, transparent: true, opacity: .5, envMapIntensity: 2.2, emissive: '#3aa8d8',
    emissiveIntensity: .25, depthWrite: false }),
  arrow: new MeshBasicMaterial({ color: '#1fa2ff', transparent: true, opacity: .9, depthWrite: false, toneMapped: false }),
};
const raftGeo = new RoundedBoxGeometry(.9, .18, .9, 2, .07);
const frameGeo = new RoundedBoxGeometry(.9, 1.06, .16, 3, .06);
const iceGeo = new RoundedBoxGeometry(.98, 1.32, .98, 2, .12);
const chevronGeo = new ConeGeometry(.15, .26, 3);

/** Glide speed in tiles per second, and how far the floe overshoots and settles. */
const GLIDE = 7.5;

/**
 * A floe: a mirror frozen inside a block of ice riding a raft. It never turns, so it shows no turning ring; instead a
 * pair of chevrons on the ice ahead points the way its next glide goes, and greys out when it is boxed in. When the rules
 * move it, it glides there, leans into the stop and throws up a little ice spray.
 */
export const FloePiece = React.memo(function FloePiece({ floe, at, way, hint, hitAt, clock, delay, sounds, onTap, onBlocked, onPreview }: {
  floe: Floe; at: number; way: 0 | 1 | -1; hint: boolean; hitAt?: number; clock: BeamClock; delay: number; sounds: boolean;
  onTap?: () => void; onBlocked?: () => void; onPreview?: (on: boolean) => void;
}) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const raft = useRef<Mesh>(null), ice = useRef<Mesh>(null);
  const glow = useRef<Sprite>(null);
  const arrows = useRef<Group>(null);
  const spray = useRef<Group>(null);
  const appear = useAppear(delay);
  const pos = useRef({ x: floe.track[at]![0], z: floe.track[at]![1], lean: 0, wobble: 0, sprayAt: -10 });
  const arrowMats = useMemo(() => [floeMats.arrow.clone(), floeMats.arrow.clone()], []);
  useEffect(() => () => arrowMats.forEach(m => m.dispose()), [arrowMats]);
  const last = useRef(at);
  useEffect(() => {
    if (last.current === at) return;
    last.current = at;
    if (sounds) { audio.play('glide', .8); audio.haptic(); }
  }, [at, sounds]);
  usePickTarget(onTap && {
    id: floe.id, ring: .72, hold: onPreview,
    tap: () => { if (way === 0) { pos.current.wobble = 1; onBlocked?.(); } else onTap(); },
  }, root, [raft, ice]);
  const angle = (floe.orientation as Orientation) * Math.PI / 2 + Math.PI / 4;
  const first = floe.track[0]!, second = floe.track[1]!;
  const dx = second[0] - first[0], dz = second[1] - first[1];
  useFrame(({ clock: c }, dt) => {
    const t = c.elapsedTime;
    const p = pos.current;
    const [tx, tz] = floe.track[at]!;
    // Glide at a steady speed, then settle with a small lean into the stop.
    const ddx = tx - p.x, ddz = tz - p.z, dist = Math.hypot(ddx, ddz);
    const step = Math.min(dist, GLIDE * Math.min(dt, 1 / 20));
    if (dist > 1e-3) {
      p.x += ddx / dist * step; p.z += ddz / dist * step;
      p.lean = Math.min(1, p.lean + dt * 6);
      if (dist - step < 1e-3) { p.wobble = 1; p.sprayAt = t; }
    } else p.lean = Math.max(0, p.lean - dt * 5);
    p.wobble = Math.max(0, p.wobble - dt * 3);
    if (root.current) {
      root.current.position.set(p.x, 0, p.z);
      root.current.scale.setScalar(Math.max(.001, appear(t)));
    }
    if (body.current) {
      const moving = dist > 1e-3 ? Math.sign(ddx * dx + ddz * dz) : 0;
      // Tilt along the track while gliding, rock once on arrival.
      const tilt = moving * p.lean * .09 + Math.sin(t * 30) * p.wobble * .06;
      body.current.rotation.set(dz ? tilt : 0, 0, dx ? -tilt : 0);
      body.current.position.y = Math.sin(t * 1.6 + first[0] * 2.1 + first[1]) * .015;
    }
    if (arrows.current) {
      arrows.current.visible = way !== 0 && dist < .05;
      arrows.current.position.set(dx * way * .7, .05, dz * way * .7);
      arrows.current.rotation.y = Math.atan2(dx * way, dz * way);
      arrows.current.children.forEach((ch, i) => {
        const k = (t * 1.3 + i * .5) % 1;
        ch.position.z = k * .3;
        ((ch as Mesh).material as MeshBasicMaterial).opacity = Math.sin(k * Math.PI) * (hint ? 1 : .8);
      });
    }
    if (spray.current) {
      const age = (t - p.sprayAt) / .6;
      spray.current.visible = age < 1;
      if (age < 1) spray.current.children.forEach((ch, i) => {
        const a = i * 1.26;
        ch.position.set(Math.cos(a) * .5 * age, .1 + Math.sin(age * Math.PI) * .35, Math.sin(a) * .5 * age);
        const s = .3 * (1 - age);
        ch.scale.set(s, s, 1);
        ((ch as Sprite).material as SpriteMaterial).opacity = 1 - age;
      });
    }
    const lit = hitAt !== undefined && clock.reveal.value >= hitAt && clock.abyss.drain.value <= hitAt;
    if (glow.current) {
      const target = lit ? .9 + Math.sin(t * 12) * .1 : 0;
      glow.current.material.opacity += (target - glow.current.material.opacity) * Math.min(1, dt * 10);
    }
  });
  return <group>
    <group ref={root} position={[floe.track[at]![0], 0, floe.track[at]![1]]}>
      <group ref={body}>
        <mesh geometry={raftGeo} material={floeMats.raft} position={[0, .09, 0]} castShadow receiveShadow />
        <group position={[0, .74, 0]} rotation={[0, angle, 0]}>
          <mesh geometry={frameGeo} material={floeMats.frame} castShadow />
          <mesh position={[0, 0, .083]} material={glassMaterial}><planeGeometry args={[.72, .88]} /></mesh>
          <mesh position={[0, 0, -.083]} rotation={[0, Math.PI, 0]} material={glassMaterial}><planeGeometry args={[.72, .88]} /></mesh>
          <sprite ref={glow} scale={[1.6, 1.6, 1]} renderOrder={6}>
            <spriteMaterial map={glowTexture} color="#bff6ff" opacity={0} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
          </sprite>
        </group>
        <mesh geometry={iceGeo} material={floeMats.ice} position={[0, .76, 0]} renderOrder={4} />
        {onTap && <><mesh ref={raft} {...proxyMesh(proxies.floe.raft)} /><mesh ref={ice} {...proxyMesh(proxies.floe.ice)} /></>}
      </group>
      <group ref={arrows}>{arrowMats.map((m, i) => <mesh key={i} geometry={chevronGeo} material={m} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, .3]} />)}</group>
      <group ref={spray} visible={false}>{[0, 1, 2, 3, 4].map(i => <sprite key={i} renderOrder={7}>
        <spriteMaterial map={glowTexture} color="#e8fbff" transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </sprite>)}</group>
      {hint && <HintArrow />}
    </group>
  </group>;
});
