import React, { useMemo, useRef } from 'react';
import { ConeGeometry, CylinderGeometry, DodecahedronGeometry, Group, IcosahedronGeometry, MeshStandardMaterial } from 'three';
import { useFrame } from '../Canvas';
import { Look } from '../look';
import { Birds, Clouds, Instances, Particles, rng, Waterfall } from './common';

const rockGeo = new DodecahedronGeometry(1, 0);
const colGeo = new CylinderGeometry(.5, .55, 1, 10);
const coneGeo = new ConeGeometry(1, 1, 7);
const leafGeo = new IcosahedronGeometry(1, 0);
const mats = {
  rock: new MeshStandardMaterial({ color: '#9a857a', roughness: 1, flatShading: true }),
  rockDark: new MeshStandardMaterial({ color: '#7a6862', roughness: 1, flatShading: true }),
  grass: new MeshStandardMaterial({ color: '#6aa84f', roughness: .9, flatShading: true }),
  marble: new MeshStandardMaterial({ color: '#f1e2c6', roughness: .55 }),
  gold: new MeshStandardMaterial({ color: '#e8b04a', metalness: 1, roughness: .3 }),
  tree: new MeshStandardMaterial({ color: '#3f7f3a', roughness: .9, flatShading: true }),
};

export function Temple({ kind = 'columns', scale = 1 }: { kind?: 'columns' | 'dome' | 'tower'; scale?: number }) {
  const cols = kind === 'tower' ? 6 : 8;
  return <group scale={scale}>
    <mesh position={[0, .3, 0]} material={mats.marble}><boxGeometry args={[7, .6, 5]} /></mesh>
    <mesh position={[0, .75, 0]} material={mats.marble}><boxGeometry args={[6.2, .3, 4.2]} /></mesh>
    {Array.from({ length: cols }, (_, i) => {
      const a = (i / cols) * Math.PI * 2;
      const [x, z] = kind === 'columns' ? [((i % 4) - 1.5) * 1.7, i < 4 ? -1.5 : 1.5] : [Math.cos(a) * 2.2, Math.sin(a) * 1.6];
      return <mesh key={i} geometry={colGeo} material={mats.marble} position={[x, 2.6, z]} scale={[.55, 3.6, .55]} />;
    })}
    <mesh position={[0, 4.6, 0]} material={mats.marble}><boxGeometry args={[6.6, .5, 4.4]} /></mesh>
    {kind === 'columns' && <mesh position={[0, 5.55, 0]} rotation={[0, Math.PI / 4, 0]} scale={[4.8, 1.4, 3.3]} material={mats.marble}><coneGeometry args={[1, 1, 4]} /></mesh>}
    {kind === 'dome' && <mesh position={[0, 4.85, 0]} material={mats.gold}><sphereGeometry args={[2.1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>}
    {kind === 'tower' && <>
      <mesh position={[0, 6.6, 0]} material={mats.marble}><cylinderGeometry args={[1.6, 1.9, 3.5, 12]} /></mesh>
      <mesh position={[0, 9.2, 0]} material={mats.gold}><coneGeometry args={[1.9, 2.2, 12]} /></mesh>
    </>}
  </group>;
}

function FloatingIsland({ seed, size, temple, waterfall }: { seed: number; size: number; temple?: 'columns' | 'dome' | 'tower'; waterfall?: boolean }) {
  const ref = useRef<Group>(null);
  const parts = useMemo(() => {
    const r = rng(seed * 13 + 5);
    const rocks = Array.from({ length: 9 }, (_, i) => {
      const a = (i / 9) * Math.PI * 2;
      return { p: [Math.cos(a) * size * .55, -size * (.35 + r() * .3), Math.sin(a) * size * .55] as [number, number, number],
        r: [r() * 3, r() * 3, r()] as [number, number, number], s: [size * .45, size * (.45 + r() * .3), size * .4] as [number, number, number] };
    });
    const trees = Array.from({ length: 4 + Math.floor(r() * 4) }, () => {
      const a = r() * Math.PI * 2, d = size * (.45 + r() * .45), h = 2 + r() * 2.5;
      return { p: [Math.cos(a) * d, h / 2 + .2, Math.sin(a) * d] as [number, number, number], s: [.6, h, .6] as [number, number, number] };
    });
    const bushes = Array.from({ length: 6 }, () => {
      const a = r() * Math.PI * 2, d = size * (.5 + r() * .4);
      return { p: [Math.cos(a) * d, .4, Math.sin(a) * d] as [number, number, number], s: .5 + r() * .5 };
    });
    return { rocks, trees, bushes, phase: r() * 6 };
  }, [seed, size]);
  useFrame(({ clock }) => { if (ref.current) ref.current.position.y = Math.sin(clock.elapsedTime * .3 + parts.phase) * .6; });
  return <group ref={ref}>
    <mesh material={mats.grass} position={[0, 0, 0]}><cylinderGeometry args={[size, size * .92, .7, 10]} /></mesh>
    <mesh material={mats.rock} position={[0, -size * .9, 0]} rotation={[Math.PI, .3, 0]} scale={[size * .95, size * 1.9, size * .95]} geometry={coneGeo} />
    <Instances geometry={rockGeo} material={mats.rockDark} items={parts.rocks} />
    <Instances geometry={coneGeo} material={mats.tree} items={parts.trees} />
    <Instances geometry={leafGeo} material={mats.grass} items={parts.bushes} />
    {temple && <group position={[0, .35, 0]} scale={size / 6}><Temple kind={temple} /></group>}
    {waterfall && <Waterfall position={[size * .9, 0, 0]} height={size * 2.6} width={size * .25} rotationY={Math.PI / 2} />}
  </group>;
}

const islands: { p: [number, number, number]; size: number; temple?: 'columns' | 'dome' | 'tower'; waterfall?: boolean }[] = [
  { p: [0, 3, -42], size: 9, temple: 'columns', waterfall: true },
  { p: [-38, 8, -55], size: 6, temple: 'dome', waterfall: true },
  { p: [42, 14, -70], size: 7, temple: 'tower' },
  { p: [-62, -2, -12], size: 4, temple: 'columns' },
  { p: [58, -6, -10], size: 5, waterfall: true },
  { p: [-30, -10, 34], size: 3.5 },
  { p: [34, 4, 40], size: 4, temple: 'dome' },
  { p: [-14, 22, -90], size: 5, temple: 'tower', waterfall: true },
  { p: [-17, -18, -10], size: 4, temple: 'columns', waterfall: true },
  { p: [16, -24, -20], size: 5, temple: 'dome' },
  { p: [-14, -34, -34], size: 6, temple: 'tower', waterfall: true },
  { p: [18, -14, 2], size: 3 },
  { p: [-20, -12, -30], size: 2.5 },
];

/** Memoised so the static scenery is not reconciled again on every move. */
export const SkyTemples = React.memo(function SkyTemples({ look }: { look: Look }) {
  return <group>
    {islands.map((it, i) => <group key={i} position={it.p}><FloatingIsland seed={i + 1} size={it.size} temple={it.temple} waterfall={it.waterfall} /></group>)}
    <Clouds count={34} radius={[14, 150]} y={-44} spread={8} scale={[46, 16]} color="#f6e6f2" opacity={.95} seed={1} drift={.003} />
    <Clouds count={22} radius={[10, 90]} y={-16} spread={6} scale={[26, 10]} color="#ffffff" opacity={.7} seed={5} drift={.006} />
    <Clouds count={16} radius={[80, 180]} y={20} spread={14} scale={[44, 15]} color="#fff6ee" opacity={.55} seed={2} drift={.002} />
    <Birds count={9} radius={24} y={7} color="#5a5868" />
    <Particles count={70} area={[30, 16, 30]} center={[0, 3, 0]} color={look.particles} size={1.4} speed={.35} sway={1.2} seed={4} />
  </group>;
});
