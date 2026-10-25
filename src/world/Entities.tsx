import React, { useMemo, useRef } from 'react';
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, Sprite, SpriteMaterial } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { useFrame } from './Canvas';
import { glassMaterial, glowTexture, portalMaterial, sparkTexture } from './fx';
import { useAppear } from './Board';
import { Look } from './look';
import { Mirror, Orientation } from '../game/types';
import { proxies } from './pick';
import { proxyMesh, usePickTarget } from './Picker';

const frameGeo = new RoundedBoxGeometry(.9, 1.06, .16, 3, .06);
const blockGeo = new RoundedBoxGeometry(.9, .95, .9, 3, .1);
import type { BeamClock } from './Beam';

function Glow({ color, scale = 1, opacity = 1, position = [0, 0, 0], spark = false }: { color: string; scale?: number; opacity?: number; position?: [number, number, number]; spark?: boolean }) {
  return <sprite position={position} scale={[scale, scale, 1]} renderOrder={6}>
    <spriteMaterial map={spark ? sparkTexture : glowTexture} color={color} opacity={opacity} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
  </sprite>;
}

/** A short pooled burst of sprites, restarted whenever `trigger` changes. */
function Burst({ trigger, color, count = 8, spread = .8, rise = .6, size = .35, y = .2, duration = .7 }: {
  trigger: number; color: string; count?: number; spread?: number; rise?: number; size?: number; y?: number; duration?: number;
}) {
  const group = useRef<Group>(null);
  const start = useRef(-10);
  const last = useRef(trigger);
  const dirs = useMemo(() => Array.from({ length: count }, (_, i) => ({ a: (i / count) * Math.PI * 2 + i, s: .6 + (i % 3) * .25 })), [count]);
  useFrame(({ clock }) => {
    if (last.current !== trigger) { last.current = trigger; start.current = clock.elapsedTime; }
    const age = (clock.elapsedTime - start.current) / duration;
    const g = group.current;
    if (!g) return;
    g.visible = age < 1;
    if (age >= 1) return;
    g.children.forEach((c, i) => {
      const d = dirs[i]!;
      c.position.set(Math.cos(d.a) * spread * age * d.s, y + rise * age * d.s, Math.sin(d.a) * spread * age * d.s);
      const s = size * (1 - age * .6) * (age < .1 ? age * 10 : 1);
      c.scale.set(s, s, 1);
      ((c as Sprite).material as SpriteMaterial).opacity = 1 - age;
    });
  });
  return <group ref={group} visible={false}>
    {dirs.map((_, i) => <sprite key={i} renderOrder={7}><spriteMaterial map={glowTexture} color={color} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} /></sprite>)}
  </group>;
}

const dustColors = ['#f3dcc0', '#bfe8ff', '#ffd89a', '#ffffff', '#7ae8ff'];

/** A turnable (or fixed) mirror. `orientation` is its slant as it stands (on a cluster's stones: relative to them). */
export const MirrorPiece = React.memo(function MirrorPiece({ mirror, orientation, hint, hitAt, clock, look, chapter, delay, onTap, onBlocked, onPreview }: {
  mirror: Mirror; orientation: Orientation; hint: boolean; hitAt?: number; clock: BeamClock; look: Look; chapter: number;
  delay: number; onTap?: () => void; onBlocked?: () => void; onPreview?: (on: boolean) => void;
}) {
  const root = useRef<Group>(null);
  const panel = useRef<Group>(null);
  const base = useRef<Mesh>(null), body = useRef<Mesh>(null);
  const ring = useRef<Group>(null);
  const glow = useRef<Sprite>(null);
  const appear = useAppear(delay);
  const spring = useRef({ angle: orientation * Math.PI / 2 + Math.PI / 4, target: orientation * Math.PI / 2 + Math.PI / 4, vel: 0 });
  const last = useRef(orientation);
  const wobble = useRef(0);
  if (last.current !== orientation) { spring.current.target += Math.PI / 2; last.current = orientation; }
  usePickTarget(onTap && {
    id: mirror.id, ring: .7, hold: mirror.fixed ? undefined : onPreview,
    tap: () => { if (mirror.fixed) { wobble.current = 1; onBlocked?.(); } else onTap(); },
  }, root, [base, body]);
  useFrame(({ clock: c }, dt) => {
    const t = c.elapsedTime;
    const s = spring.current;
    const step = Math.min(dt, 1 / 30);
    s.vel += ((s.target - s.angle) * 220 - s.vel * 17) * step;
    s.angle += s.vel * step;
    if (panel.current) panel.current.rotation.y = s.angle;
    wobble.current = Math.max(0, wobble.current - dt * 2.5);
    const a = appear(t);
    if (root.current) { root.current.scale.setScalar(Math.max(.001, a)); root.current.rotation.z = Math.sin(t * 40) * wobble.current * .08; }
    if (ring.current) {
      ring.current.rotation.y = -t * 1.2;
      ring.current.visible = !mirror.fixed;
    }
    const lit = hitAt !== undefined && clock.reveal.value >= hitAt && clock.abyss.drain.value <= hitAt;
    if (glow.current) {
      const target = lit ? .9 + Math.sin(t * 12) * .1 : 0;
      glow.current.material.opacity += (target - glow.current.material.opacity) * Math.min(1, dt * 10);
    }
  });
  const frameMat = mirror.fixed ? { color: '#c9d4e6', metalness: .9, roughness: .25 } : { color: look.frame, metalness: 1, roughness: .28, emissive: '#3a2200', emissiveIntensity: .25 };
  return <group>
    <group ref={root}>
      <mesh position={[0, .07, 0]} castShadow receiveShadow><cylinderGeometry args={[.4, .45, .14, 24]} />
        <meshStandardMaterial color={mirror.fixed ? '#7d8598' : chapter === 4 ? '#3a4058' : '#a8602c'} metalness={.6} roughness={.4} /></mesh>
      <mesh position={[0, .15, 0]}><cylinderGeometry args={[.33, .36, .05, 24]} /><meshStandardMaterial color={look.frame} metalness={1} roughness={.3} /></mesh>
      <group ref={panel} position={[0, .72, 0]}>
        <mesh geometry={frameGeo} castShadow dispose={null}><meshStandardMaterial {...frameMat} /></mesh>
        <mesh position={[0, 0, .083]} material={glassMaterial}><planeGeometry args={[.72, .88]} /></mesh>
        <mesh position={[0, 0, -.083]} rotation={[0, Math.PI, 0]} material={glassMaterial}><planeGeometry args={[.72, .88]} /></mesh>
        {[[-.39, -.47], [-.39, .47], [.39, -.47], [.39, .47]].map(([x, y], i) =>
          <mesh key={i} position={[x!, y!, 0]}><sphereGeometry args={[.065, 10, 8]} /><meshStandardMaterial color={mirror.fixed ? '#9fb3d4' : '#fff1a8'} metalness={1} roughness={.2} /></mesh>)}
        <sprite ref={glow} scale={[1.6, 1.6, 1]} renderOrder={6}>
          <spriteMaterial map={glowTexture} color="#bff6ff" opacity={0} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
        </sprite>
        {onTap && <mesh ref={body} {...proxyMesh(proxies.mirror.panel)} />}
      </group>
      {onTap && <mesh ref={base} {...proxyMesh(proxies.mirror.base)} />}
    </group>
    <group ref={ring} position={[0, .03, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[.5, .58, 40, 1, 0, Math.PI * 1.55]} />
        <meshBasicMaterial color={hint ? '#9dff7a' : '#7fe8ff'} transparent opacity={.85} toneMapped={false} side={2} /></mesh>
      <mesh position={[.54, 0, -.02]} rotation={[-Math.PI / 2, 0, Math.PI]}><circleGeometry args={[.13, 3]} />
        <meshBasicMaterial color={hint ? '#9dff7a' : '#7fe8ff'} toneMapped={false} side={2} /></mesh>
    </group>
    <Burst trigger={orientation} color={dustColors[chapter]!} count={9} spread={.9} rise={.35} size={.42} y={.12} />
    {hint && <HintArrow />}
  </group>;
});

export const HintArrow = React.memo(function HintArrow() {
  const ref = useRef<Group>(null);
  const pulse = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ref.current) { ref.current.position.y = 1.6 + Math.sin(t * 5) * .12; ref.current.rotation.y = t * 2; }
    if (pulse.current) { const k = (t * 1.4) % 1; pulse.current.scale.set(1 + k * .9, 1 + k * .9, 1); (pulse.current.material as MeshBasicMaterial).opacity = .9 * (1 - k); }
  });
  return <>
    <group ref={ref} position={[0, 1.6, .3]} scale={1.1}>
      <mesh rotation={[Math.PI, 0, 0]}><coneGeometry args={[.24, .36, 4]} /><meshStandardMaterial color="#9dff7a" emissive="#3fd01a" emissiveIntensity={1} /></mesh>
      <mesh position={[0, .32, 0]}><boxGeometry args={[.14, .34, .14]} /><meshStandardMaterial color="#9dff7a" emissive="#3fd01a" emissiveIntensity={1} /></mesh>
      <Glow color="#9dff7a" scale={1.3} opacity={.7} />
    </group>
    <mesh ref={pulse} position={[0, .05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[.55, .7, 40]} /><meshBasicMaterial color="#9dff7a" transparent opacity={.9} depthWrite={false} toneMapped={false} />
    </mesh>
  </>;
});

const blockLooks = [
  { color: '#a9a7b5', top: '#5fa64a' }, { color: '#5d6a5a', top: '#3f8a36' }, { color: '#d4ae78', top: '#e8c58c' },
  { color: '#7fb8e0', top: '#ffffff' }, { color: '#2e3346', top: '#5ae0ff' },
];
export const BlockerPiece = React.memo(function BlockerPiece({ chapter, delay }: { chapter: number; delay: number }) {
  const root = useRef<Group>(null);
  const appear = useAppear(delay);
  useFrame(({ clock }) => { if (root.current) root.current.scale.setScalar(Math.max(.001, appear(clock.elapsedTime))); });
  const l = blockLooks[chapter]!;
  const ice = chapter === 3, metal = chapter === 4;
  return <group ref={root}><group position={[0, .47, 0]}>
    <mesh geometry={blockGeo} castShadow receiveShadow dispose={null}>
      <meshStandardMaterial color={l.color} roughness={ice ? .05 : metal ? .3 : .95} metalness={metal ? .8 : 0} transparent={ice} opacity={ice ? .8 : 1} envMapIntensity={ice ? 2 : 1} />
    </mesh>
    {metal ? <mesh position={[0, 0, .456]}><boxGeometry args={[.7, .06, .01]} /><meshBasicMaterial color={l.top} toneMapped={false} /></mesh>
      : <mesh position={[0, .47, 0]} scale={[.42, .08, .4]}><icosahedronGeometry args={[1, 1]} /><meshStandardMaterial color={l.top} flatShading roughness={.9} /></mesh>}
    {chapter === 2 && [[-.2, .1], [.15, -.12], [0, .25]].map(([x, y], i) => <mesh key={i} position={[x!, y!, .456]}><boxGeometry args={[.16, .04, .01]} /><meshStandardMaterial color="#8a5a2a" /></mesh>)}
  </group></group>;
});

export const SplitterPiece = React.memo(function SplitterPiece({ hitAt, clock, delay }: { hitAt?: number; clock: BeamClock; delay: number }) {
  const prism = useRef<Group>(null);
  const glow = useRef<Sprite>(null);
  const root = useRef<Group>(null);
  const appear = useAppear(delay);
  useFrame(({ clock: c }, dt) => {
    const t = c.elapsedTime;
    if (prism.current) { prism.current.rotation.y = t * .6; prism.current.position.y = .85 + Math.sin(t * 1.6) * .05; }
    if (root.current) root.current.scale.setScalar(Math.max(.001, appear(t)));
    const lit = hitAt !== undefined && clock.reveal.value >= hitAt && clock.abyss.drain.value <= hitAt;
    if (glow.current) { const target = lit ? 1 : .25; glow.current.material.opacity += (target - glow.current.material.opacity) * Math.min(1, dt * 8); }
  });
  return <group ref={root}>
    <mesh position={[0, .12, 0]} castShadow><cylinderGeometry args={[.42, .46, .24, 6]} /><meshStandardMaterial color="#e8b04a" metalness={1} roughness={.3} /></mesh>
    <group ref={prism} position={[0, .85, 0]}>
      <mesh castShadow><cylinderGeometry args={[.42, .42, 1, 3]} />
        <meshStandardMaterial color="#fff6e0" roughness={.02} metalness={.2} transparent opacity={.75} envMapIntensity={2.5} emissive="#ffb84a" emissiveIntensity={.35} /></mesh>
      <sprite ref={glow} scale={[2, 2, 1]} renderOrder={6}><spriteMaterial map={sparkTexture} color="#ffe6a0" opacity={.25} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} /></sprite>
      <Glow color="#7affd8" scale={.6} position={[.25, 0, 0]} opacity={.5} />
      <Glow color="#ff7ad8" scale={.6} position={[-.25, 0, 0]} opacity={.5} />
    </group>
  </group>;
});

export const PortalPiece = React.memo(function PortalPiece({ delay, exit }: { delay: number; exit?: boolean }) {
  const ring = useRef<Mesh>(null);
  const root = useRef<Group>(null);
  const appear = useAppear(delay);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.rotation.z = clock.elapsedTime * (exit ? -1 : 1);
    if (root.current) root.current.scale.setScalar(Math.max(.001, appear(clock.elapsedTime)));
  });
  return <group ref={root}>
    <mesh position={[0, .07, 0]}><cylinderGeometry args={[.38, .44, .14, 24]} /><meshStandardMaterial color="#3a3f58" metalness={.9} roughness={.3} /></mesh>
    <group position={[0, .72, 0]} rotation={[0, Math.PI / 4, 0]}>
      <mesh ref={ring}><torusGeometry args={[.42, .07, 12, 40]} /><meshStandardMaterial color="#d8b8ff" emissive="#8a3cff" emissiveIntensity={1.6} metalness={.6} roughness={.2} /></mesh>
      <mesh material={portalMaterial}><circleGeometry args={[.4, 40]} /></mesh>
      <Glow color="#b07aff" scale={2} opacity={.7} />
    </group>
  </group>;
});

