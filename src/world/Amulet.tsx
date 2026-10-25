import React, { useMemo, useRef } from 'react';
import { AdditiveBlending, BufferGeometry, Color, CylinderGeometry, DodecahedronGeometry, Group, LatheGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, Sprite, Vector2 } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useFrame } from './Canvas';
import { glowTexture, heartGeometry, sparkTexture } from './fx';
import { chapters } from '../game/chapters';

const lathe = (pts: number[][], seg: number) => new LatheGeometry(pts.map(([x, y]) => new Vector2(x, y)), seg);
/** Five distinct cuts so every Heart reads as its own legendary stone. */
export const stoneGeometries: BufferGeometry[] = [
  heartGeometry.clone().scale(.62, .62, .62),
  (() => { const g = new CylinderGeometry(.42, .5, .9, 6, 1); return mergeVertices(g); })(),
  lathe([[0, -.62], [.52, .05], [.58, .16], [.36, .42], [0, .44]], 10),
  (() => { const g = lathe([[0, -.85], [.26, -.45], [.26, .45], [0, .85]], 6); return g; })(),
  new DodecahedronGeometry(.56, 0),
];
const prismGeometry = new OctahedronGeometry(1, 0);

/** One Heart stone: smoky and asleep until earned, then a living gem with an inner flame, rays and glints. */
export function HeartStone({ chapter, earned, scale = 1, intensity = 1 }: { chapter: number; earned: boolean; scale?: number; intensity?: number }) {
  const spin = useRef<Group>(null);
  const core = useRef<Mesh>(null);
  const halo = useRef<Sprite>(null);
  const rays = useRef<Group>(null);
  const glints = useRef<Group>(null);
  const color = chapters[chapter]!.heartColor;
  const geo = stoneGeometries[chapter]!;
  // Earned stones skip tone mapping so they stay deep, saturated jewels under any world's lighting; dormant ones are smoky glass with a faint ember of their colour.
  const { deep, dormant } = useMemo(() => {
    const c = new Color(color);
    const hex = (k: Color) => `#${k.getHexString()}`;
    return { deep: hex(c.clone().multiplyScalar(.32)), dormant: hex(c.clone().multiplyScalar(.14)) };
  }, [color]);
  const seed = chapter * 1.37;
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed;
    if (spin.current) { spin.current.rotation.y = t * (earned ? .7 : .15); spin.current.rotation.x = Math.sin(t * .6) * .15; spin.current.position.y = Math.sin(t * 1.4) * .06; }
    const beat = .75 + .25 * Math.sin(t * 2.6) + .1 * Math.sin(t * 7.1);
    if (core.current) (core.current.material as MeshBasicMaterial).opacity = earned ? .45 + .35 * beat : .16 + .12 * beat;
    if (halo.current) { const s = (earned ? 2 + beat * .4 : 1.2) * intensity; halo.current.scale.set(s, s, 1); halo.current.material.opacity = earned ? .5 * intensity : .14; }
    if (rays.current) { rays.current.rotation.z = t * .25; rays.current.visible = earned; }
    if (glints.current) glints.current.children.forEach((g, i) => {
      const k = (t * .55 + i * .37) % 1;
      const s = earned ? Math.max(0, Math.sin(k * Math.PI)) * .55 : 0;
      g.scale.set(s, s, 1);
      g.position.set(Math.cos(i * 2.4) * .32, Math.sin(i * 1.7) * .3, .35);
    });
  });
  return <group scale={scale}>
    <sprite ref={halo} renderOrder={1}><spriteMaterial map={glowTexture} color={color} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} /></sprite>
    <group ref={rays} position={[0, 0, -.2]}>
      {Array.from({ length: 6 }, (_, i) => <mesh key={i} rotation={[0, 0, (i / 6) * Math.PI]}>
        <planeGeometry args={[.07, 2.6]} /><meshBasicMaterial color={color} transparent opacity={.22} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>)}
    </group>
    <group ref={spin}>
      <mesh geometry={geo} dispose={null} renderOrder={3}>
        <meshStandardMaterial color={earned ? deep : dormant} emissive={earned ? color : deep} emissiveIntensity={earned ? .42 : .25}
          roughness={.16} metalness={earned ? .05 : .4} flatShading transparent opacity={earned ? .96 : .97} envMapIntensity={earned ? 1.8 : 1.3}
          toneMapped={!earned} />
      </mesh>
      <mesh ref={core} geometry={geo} scale={.6} dispose={null} renderOrder={4}>
        <meshBasicMaterial color={color} transparent opacity={.2} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
    <group ref={glints}>{[0, 1, 2].map(i => <sprite key={i} renderOrder={6}>
      <spriteMaterial map={sparkTexture} color="#ffffff" transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </sprite>)}</group>
  </group>;
}

const SOCKET_R = 1.55;
export const socketPosition = (i: number): [number, number, number] => {
  const a = Math.PI / 2 + (i / 5) * Math.PI * 2;
  return [Math.cos(a) * SOCKET_R, Math.sin(a) * SOCKET_R, 0];
};

/**
 * The Lightkeeper's Amulet: a golden ring holding the five Hearts around the shattered Great Prism.
 * `forging` animates one Heart flying into its socket; `complete` reunites the Prism.
 */
export function Amulet({ hearts, forging, complete = false }: { hearts: number[]; forging?: number; complete?: boolean }) {
  const root = useRef<Group>(null);
  const prism = useRef<Group>(null);
  const prismHalo = useRef<Sprite>(null);
  const fly = useRef<Group>(null);
  const flash = useRef<Sprite>(null);
  const start = useRef(-1);
  const gold = useMemo(() => new MeshStandardMaterial({ color: '#e8b04a', metalness: 1, roughness: .22, envMapIntensity: 1.6 }), []);
  const darkGold = useMemo(() => new MeshStandardMaterial({ color: '#7a5420', metalness: 1, roughness: .4 }), []);
  const prismMat = useMemo(() => new MeshStandardMaterial({ color: '#ffffff', roughness: .03, metalness: .2, flatShading: true, transparent: true, opacity: .55, emissive: '#ffffff', emissiveIntensity: .1, envMapIntensity: 3 }), []);
  const count = hearts.length + (forging !== undefined && !hearts.includes(forging) ? 1 : 0);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (start.current < 0) start.current = t;
    const age = t - start.current;
    if (root.current) { root.current.rotation.y = Math.sin(t * .35) * .22; root.current.position.y = Math.sin(t * .8) * .08; }
    const whole = complete ? Math.min(1, Math.max(0, (age - 2.5) / 2)) : 0;
    if (prism.current) { prism.current.rotation.y = t * .5; prism.current.scale.setScalar(.42 + count * .035 + whole * .35); }
    prismMat.opacity = .35 + count * .08 + whole * .3;
    prismMat.emissive.setHSL((t * .07) % 1, .7, .55);
    // The reunited Prism glows and its halo swells, but stays below white-out, so its facets and the Hearts around it
    // still read through the light.
    prismMat.emissiveIntensity = .1 + count * .12 + whole * 1.1;
    if (prismHalo.current) { const s = 1.5 + count * .5 + whole * 4.5; prismHalo.current.scale.set(s, s, 1); prismHalo.current.material.opacity = .2 + count * .12 + whole * .1; }
    if (fly.current && forging !== undefined) {
      const k = Math.min(1, Math.max(0, (age - 2.4) / 1.3));
      const e = k * k * (3 - 2 * k);
      const [sx, sy] = socketPosition(forging);
      fly.current.position.set(sx * e, 2.4 * (1 - e) + sy * e + Math.sin(e * Math.PI) * .6, 2.2 * (1 - e));
      fly.current.scale.setScalar(Math.min(1, age / 1.2) * (2.1 - e * 1.4));
    }
    if (flash.current) {
      const at = forging !== undefined ? 3.7 : complete ? 4.4 : 1e9;
      const f = age > at ? Math.max(0, 1 - (age - at) * 1.2) : 0;
      flash.current.visible = f > 0;
      flash.current.scale.setScalar(2 + (1 - f) * 12);
      flash.current.material.opacity = f;
      if (forging !== undefined) { const [sx, sy] = socketPosition(forging); flash.current.position.set(sx, sy, .3); }
    }
  });
  return <group ref={root}>
    <mesh material={gold}><torusGeometry args={[SOCKET_R, .1, 16, 80]} /></mesh>
    <mesh material={darkGold} position={[0, 0, -.06]}><torusGeometry args={[SOCKET_R + .16, .05, 10, 80]} /></mesh>
    <mesh material={darkGold} position={[0, 0, -.06]}><torusGeometry args={[SOCKET_R - .17, .04, 10, 80]} /></mesh>
    {Array.from({ length: 5 }, (_, i) => {
      const a = Math.PI / 2 + ((i + .5) / 5) * Math.PI * 2;
      return <mesh key={i} material={gold} position={[Math.cos(a) * SOCKET_R, Math.sin(a) * SOCKET_R, 0]} rotation={[0, 0, a]}>
        <coneGeometry args={[.09, .32, 4]} /></mesh>;
    })}
    {Array.from({ length: 5 }, (_, i) => {
      const [x, y] = socketPosition(i);
      const a = Math.atan2(y, x);
      return <group key={i}>
        <mesh material={gold} position={[x * .55, y * .55, -.02]} rotation={[0, 0, a + Math.PI / 2]}><boxGeometry args={[.05, SOCKET_R * .9, .05]} /></mesh>
        <group position={[x, y, 0]}>
          <mesh material={gold}><torusGeometry args={[.5, .07, 12, 40]} /></mesh>
          <mesh material={darkGold} position={[0, 0, -.14]}><circleGeometry args={[.5, 32]} /></mesh>
          {(hearts.includes(i) || forging !== i) && <HeartStone chapter={i} earned={hearts.includes(i)} scale={.82} intensity={.8} />}
        </group>
      </group>;
    })}
    <group ref={prism}>
      <mesh geometry={prismGeometry} material={prismMat} scale={[1, 1.5, 1]} renderOrder={3} />
      <sprite ref={prismHalo}><spriteMaterial map={glowTexture} color="#ffffff" transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} /></sprite>
    </group>
    {forging !== undefined && !hearts.includes(forging) && <group ref={fly}><HeartStone chapter={forging} earned scale={.82} intensity={1.4} /></group>}
    <sprite ref={flash} visible={false} renderOrder={9}><spriteMaterial map={glowTexture} color="#ffffff" transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} /></sprite>
  </group>;
}
