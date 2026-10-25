import React, { useRef } from 'react';
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, Sprite } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { useFrame } from './Canvas';
import { glowTexture, sparkTexture } from './fx';
import { useAppear } from './Board';
import { BEAM_Y } from './Beam';
import { Look } from './look';
import { Direction } from '../game/types';
import { proxies } from './pick';
import { proxyMesh, usePickTarget } from './Picker';

const idolGeo = new RoundedBoxGeometry(.62, .9, .62, 3, .1);
const yaw: Record<Direction, number> = { N: Math.PI, E: Math.PI / 2, S: 0, W: -Math.PI / 2 };
const gold = { color: '#e8b04a', metalness: 1, roughness: .28 } as const;

function Flare({ look, kick, z = .46, size = 1 }: { look: Look; kick: React.MutableRefObject<number>; z?: number; size?: number }) {
  const ref = useRef<Sprite>(null);
  const halo = useRef<Sprite>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const s = (.75 + Math.sin(t * 9) * .08 + kick.current * 1.4) * size;
    ref.current?.scale.set(s, s, 1);
    if (ref.current) ref.current.material.rotation = t * .8;
    halo.current?.scale.set(s * 2.2, s * 2.2, 1);
  });
  return <group position={[0, BEAM_Y, z]}>
    <sprite ref={halo} renderOrder={6}><spriteMaterial map={glowTexture} color={look.beam} opacity={.55} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} /></sprite>
    <sprite ref={ref} renderOrder={7}><spriteMaterial map={sparkTexture} color={look.beamGlow} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} /></sprite>
  </group>;
}

/** Chapter 1: a brass sun-lens telescope crowned with a turning sun disc. */
function SunLens({ look, kick, spin }: { look: Look; kick: React.MutableRefObject<number>; spin: React.RefObject<Group | null> }) {
  return <group>
    <mesh position={[0, .12, 0]} castShadow><cylinderGeometry args={[.42, .46, .24, 8]} /><meshStandardMaterial color="#9a8574" roughness={.9} flatShading /></mesh>
    <mesh position={[0, .3, 0]} castShadow><cylinderGeometry args={[.18, .24, .2, 12]} /><meshStandardMaterial {...gold} /></mesh>
    <group position={[0, BEAM_Y, -.02]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh castShadow><cylinderGeometry args={[.2, .27, .7, 20]} /><meshStandardMaterial color="#b0642a" metalness={.8} roughness={.3} /></mesh>
      {[-.28, 0, .26].map(y => <mesh key={y} position={[0, y, 0]}><torusGeometry args={[.265, .045, 8, 28]} /><meshStandardMaterial {...gold} /></mesh>)}
      <mesh position={[0, .37, 0]}><cylinderGeometry args={[.22, .2, .06, 24]} /><meshBasicMaterial color={look.beamGlow} toneMapped={false} /></mesh>
    </group>
    <group ref={spin} position={[0, BEAM_Y, .3]}>
      {Array.from({ length: 10 }, (_, i) => <mesh key={i} rotation={[0, 0, (i / 10) * Math.PI * 2]} position={[Math.cos((i / 10) * Math.PI * 2) * .42, Math.sin((i / 10) * Math.PI * 2) * .42, 0]}>
        <coneGeometry args={[.05, .16, 4]} /><meshStandardMaterial color="#ffd36a" emissive="#ff9a10" emissiveIntensity={.8} metalness={.6} roughness={.3} />
      </mesh>)}
    </group>
    <Flare look={look} kick={kick} />
  </group>;
}

/** Chapter 2: a mossy spirit idol whose carved mouth breathes rain-light (the Rainforest's light cannon, not a rootbound totem). */
function SpiritIdol({ look, kick, spin }: { look: Look; kick: React.MutableRefObject<number>; spin: React.RefObject<Group | null> }) {
  return <group>
    <mesh geometry={idolGeo} position={[0, .45, 0]} castShadow dispose={null}><meshStandardMaterial color="#5f6a58" roughness={.85} /></mesh>
    <mesh position={[0, .93, 0]} scale={[.38, .1, .38]}><icosahedronGeometry args={[1, 1]} /><meshStandardMaterial color="#3f8a36" flatShading /></mesh>
    {[-.14, .14].map(x => <mesh key={x} position={[x, .78, .315]}><sphereGeometry args={[.06, 10, 8]} /><meshBasicMaterial color={look.beam} toneMapped={false} /></mesh>)}
    <mesh position={[0, .9, .3]} rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[.16, .16, .04]} /><meshStandardMaterial color="#495244" /></mesh>
    <mesh position={[0, BEAM_Y, .312]}><torusGeometry args={[.13, .04, 8, 20]} /><meshStandardMaterial color="#c9a24a" metalness={.9} roughness={.3} /></mesh>
    <group ref={spin} position={[0, .45, 0]}>
      {[0, 1, 2].map(i => <mesh key={i} position={[Math.cos(i * 2.1) * .42, (i - 1) * .22, Math.sin(i * 2.1) * .42]}><sphereGeometry args={[.035, 6, 6]} /><meshBasicMaterial color="#c8ff7a" toneMapped={false} /></mesh>)}
    </group>
    {[[.31, .25, .1], [-.31, .55, -.05]].map(([x, y, z], i) => <mesh key={i} position={[x!, y!, z!]} rotation={[0, 0, .3]}><cylinderGeometry args={[.025, .025, .5, 5]} /><meshStandardMaterial color="#3d8a36" /></mesh>)}
    <Flare look={look} kick={kick} z={.36} />
  </group>;
}

/** Chapter 3: the Eye of Ra, a golden sun disc on a sandstone dais. */
function EyeOfRa({ look, kick, spin }: { look: Look; kick: React.MutableRefObject<number>; spin: React.RefObject<Group | null> }) {
  return <group>
    {[0, 1].map(k => <mesh key={k} position={[0, .08 + k * .14, -.04]} castShadow><boxGeometry args={[.8 - k * .2, .14, .8 - k * .2]} /><meshStandardMaterial color={k ? '#d9b27a' : '#c49a5e'} roughness={.95} /></mesh>)}
    <mesh position={[0, .45, -.06]} castShadow><cylinderGeometry args={[.07, .1, .3, 8]} /><meshStandardMaterial {...gold} /></mesh>
    <group position={[0, BEAM_Y + .06, 0]}>
      <mesh><torusGeometry args={[.32, .07, 12, 32]} /><meshStandardMaterial color="#ffcf4a" metalness={1} roughness={.2} emissive="#ff8a00" emissiveIntensity={.35} /></mesh>
      <mesh position={[0, 0, -.03]}><circleGeometry args={[.3, 32]} /><meshStandardMaterial color="#c8681a" metalness={.8} roughness={.3} /></mesh>
      <mesh position={[0, 0, .02]} scale={[1, .55, 1]}><circleGeometry args={[.16, 24]} /><meshBasicMaterial color={look.beamGlow} toneMapped={false} /></mesh>
      {[-1, 1].map(s => <mesh key={s} position={[s * .36, .26, 0]} rotation={[0, 0, -s * .5]}><coneGeometry args={[.05, .22, 6]} /><meshStandardMaterial {...gold} /></mesh>)}
      <group ref={spin}>{Array.from({ length: 12 }, (_, i) => <mesh key={i} position={[Math.cos(i * .5236) * .5, Math.sin(i * .5236) * .5, -.02]} rotation={[0, 0, i * .5236 - Math.PI / 2]}>
        <coneGeometry args={[.035, .14, 3]} /><meshBasicMaterial color="#ffb02a" toneMapped={false} />
      </mesh>)}</group>
    </group>
    <Flare look={look} kick={kick} z={.12} size={1.1} />
  </group>;
}

/** Chapter 4: a lantern of living ice with an aurora heart. */
function FrostLantern({ look, kick, spin }: { look: Look; kick: React.MutableRefObject<number>; spin: React.RefObject<Group | null> }) {
  return <group>
    <mesh position={[0, .1, 0]} castShadow><cylinderGeometry args={[.4, .46, .2, 7]} /><meshStandardMaterial color="#cfe6f6" roughness={.4} flatShading /></mesh>
    <mesh position={[0, BEAM_Y, 0]}><sphereGeometry args={[.17, 16, 12]} /><meshBasicMaterial color={look.beamGlow} toneMapped={false} /></mesh>
    <group ref={spin} position={[0, BEAM_Y, 0]}>
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return <mesh key={i} position={[Math.cos(a) * .27, Math.sin(i * 1.3) * .08, Math.sin(a) * .27]} rotation={[Math.sin(a) * .5, a, Math.cos(a) * .5]} scale={[.09, .3, .09]}>
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#bfe9ff" roughness={.04} metalness={.1} transparent opacity={.75} envMapIntensity={2.4} emissive="#6a5aff" emissiveIntensity={.35} flatShading />
        </mesh>;
      })}
    </group>
    <mesh position={[0, BEAM_Y + .38, 0]} scale={[.1, .26, .1]}><octahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#e8f6ff" roughness={.05} envMapIntensity={2} flatShading /></mesh>
    <Flare look={look} kick={kick} z={.28} />
  </group>;
}

/** Chapter 5: a star engine whose gyroscope rings hum with plasma. */
function StarEngine({ look, kick, spin }: { look: Look; kick: React.MutableRefObject<number>; spin: React.RefObject<Group | null> }) {
  return <group>
    <mesh position={[0, .1, 0]} castShadow><cylinderGeometry args={[.4, .48, .2, 6]} /><meshStandardMaterial color="#3a4058" metalness={.9} roughness={.25} /></mesh>
    <mesh position={[0, .32, 0]}><cylinderGeometry args={[.12, .16, .26, 12]} /><meshStandardMaterial color="#9aa8c8" metalness={1} roughness={.2} /></mesh>
    <group position={[0, BEAM_Y, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh><cylinderGeometry args={[.13, .17, .62, 20]} /><meshStandardMaterial color="#b8c4dc" metalness={1} roughness={.15} /></mesh>
      <mesh position={[0, .3, 0]}><cylinderGeometry args={[.1, .1, .04, 20]} /><meshBasicMaterial color={look.beamGlow} toneMapped={false} /></mesh>
    </group>
    <group ref={spin} position={[0, BEAM_Y, 0]}>
      {[0, 1, 2].map(i => <mesh key={i} rotation={[i * 1.05, i * .7, 0]}><torusGeometry args={[.32 + i * .05, .018, 8, 40]} />
        <meshStandardMaterial color="#ff8ae8" emissive={look.beam} emissiveIntensity={1.6} metalness={.6} roughness={.2} toneMapped={false} /></mesh>)}
    </group>
    <Flare look={look} kick={kick} z={.36} />
  </group>;
}

const sources = [SunLens, SpiritIdol, EyeOfRa, FrostLantern, StarEngine];

/** Ground turntable shown under cannons the player can turn: a geared ring with a clockwise arrow. */
function Turntable({ look, hint }: { look: Look; hint: boolean }) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => { if (ref.current) ref.current.rotation.y = -clock.elapsedTime * .8; });
  const color = hint ? '#9dff7a' : look.beamGlow;
  return <group position={[0, .03, 0]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[.5, .6, 48]} /><meshStandardMaterial color="#e8b04a" metalness={1} roughness={.3} side={2} /></mesh>
    {Array.from({ length: 16 }, (_, i) => <mesh key={i} position={[Math.cos(i / 16 * Math.PI * 2) * .64, .02, Math.sin(i / 16 * Math.PI * 2) * .64]} rotation={[0, -i / 16 * Math.PI * 2, 0]}>
      <boxGeometry args={[.08, .06, .07]} /><meshStandardMaterial color="#c8902e" metalness={1} roughness={.35} /></mesh>)}
    <group ref={ref}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .02, 0]}><ringGeometry args={[.7, .78, 40, 1, 0, Math.PI * 1.4]} />
        <meshBasicMaterial color={color} transparent opacity={.9} toneMapped={false} side={2} /></mesh>
      <mesh position={[.74, .02, 0]} rotation={[-Math.PI / 2, 0, Math.PI]}><circleGeometry args={[.15, 3]} />
        <meshBasicMaterial color={color} toneMapped={false} side={2} /></mesh>
    </group>
  </group>;
}

/**
 * Floor chevrons in front of a cannon the player turns: bright ones marching along its aim, and a dim arrow a quarter
 * turn clockwise showing where the next tap will point it.
 */
function AimArrows({ look }: { look: Look }) {
  const march = useRef<Group>(null);
  useFrame(({ clock }) => {
    march.current?.children.forEach((c, i) => {
      const k = (clock.elapsedTime * 1.2 + i / 3) % 1;
      c.position.z = .72 + k * .55;
      ((c as Mesh).material as MeshBasicMaterial).opacity = Math.sin(k * Math.PI) * .95;
    });
  });
  const chevron = (opacity: number, key?: number) => <group key={key}>
    {[-1, 1].map(s => <mesh key={s} position={[s * .07, 0, -.04]} rotation={[-Math.PI / 2, 0, -s * .75]}>
      <planeGeometry args={[.06, .26]} /><meshBasicMaterial color={look.beamGlow} transparent opacity={opacity} depthWrite={false} toneMapped={false} side={2} />
    </mesh>)}
  </group>;
  return <group position={[0, .04, 0]}>
    <group ref={march}>{[0, 1, 2].map(i => <mesh key={i} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[.12, 3, -Math.PI / 2]} /><meshBasicMaterial color={look.beamGlow} transparent opacity={.9} depthWrite={false} toneMapped={false} side={2} />
    </mesh>)}</group>
    <group rotation={[0, -Math.PI / 2, 0]}><group position={[0, 0, .82]}>{chevron(.32)}</group></group>
  </group>;
}

export const LightSource = React.memo(function LightSource({ id, direction, chapter, look, fire, delay, rotatable, hint, onTap, onPreview }: {
  id: string; direction: Direction; chapter: number; look: Look; fire: unknown; delay: number; rotatable?: boolean; hint?: boolean; onTap?: () => void;
  onPreview?: (on: boolean) => void;
}) {
  const stand = useRef<Group>(null);
  const foot = useRef<Mesh>(null), body = useRef<Mesh>(null);
  const root = useRef<Group>(null);
  const aim = useRef<Group>(null);
  const spin = useRef<Group>(null);
  const kick = useRef(0);
  const last = useRef(fire);
  const appear = useAppear(delay);
  // Cannons always turn clockwise, so keep accumulating the yaw instead of snapping between the four angles.
  const yawState = useRef({ dir: direction, angle: yaw[direction], target: yaw[direction], vel: 0 });
  if (yawState.current.dir !== direction) {
    let d = yaw[direction] - yawState.current.target;
    while (d > 0) d -= Math.PI * 2;
    while (d <= -Math.PI * 2) d += Math.PI * 2;
    yawState.current.target += d;
    yawState.current.dir = direction;
  }
  useFrame(({ clock }, dt) => {
    if (last.current !== fire) { last.current = fire; kick.current = 1; }
    kick.current = Math.max(0, kick.current - dt * 3.5);
    const y = yawState.current, step = Math.min(dt, 1 / 30);
    y.vel += ((y.target - y.angle) * 160 - y.vel * 15) * step;
    y.angle += y.vel * step;
    if (aim.current) aim.current.rotation.y = y.angle;
    if (root.current) {
      root.current.scale.setScalar(Math.max(.001, appear(clock.elapsedTime)) * 1.2);
      root.current.position.z = -kick.current * .05;
    }
    if (spin.current) {
      if (chapter === 1 || chapter === 3) spin.current.rotation.y = clock.elapsedTime * .9;
      else if (chapter === 4) { spin.current.rotation.x = clock.elapsedTime * 1.4; spin.current.rotation.y = clock.elapsedTime * .9; }
      else spin.current.rotation.z = clock.elapsedTime * (.4 + kick.current * 3);
    }
  });
  usePickTarget(onTap && { id, ring: .78, tap: onTap, hold: rotatable ? onPreview : undefined }, stand, [foot, body]);
  const Source = sources[chapter] ?? SunLens;
  return <group ref={stand}>
    {rotatable && <Turntable look={look} hint={!!hint} />}
    <group ref={aim}>
      <group ref={root} scale={1.2}><Source look={look} kick={kick} spin={spin} /></group>
      {rotatable && <AimArrows look={look} />}
    </group>
    {onTap && <><mesh ref={foot} {...proxyMesh(proxies.cannon.foot)} /><mesh ref={body} {...proxyMesh(proxies.cannon.body)} /></>}
  </group>;
});
export const _mesh = (m: Mesh) => m;
