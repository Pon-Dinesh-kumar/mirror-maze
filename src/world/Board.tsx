import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, BoxGeometry, CircleGeometry, Color, DoubleSide, Float32BufferAttribute, Group, OctahedronGeometry, Vector3, ConeGeometry, CylinderGeometry, DodecahedronGeometry, IcosahedronGeometry, InstancedMesh, MeshStandardMaterial, Object3D, SphereGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { useFrame } from './Canvas';
import { bakeAO, glowTexture } from './fx';
import { Look } from './look';
import { Instances, rng, Waterfall } from './env/common';

/** Shared clock so tiles and entities assemble together when a level appears. */
export const BoardClock = createContext({ born: { value: -1 } });
export const useAppear = (delay: number) => {
  const { born } = useContext(BoardClock);
  return (elapsed: number) => {
    if (born.value < 0) return 0;
    const t = Math.min(1, Math.max(0, (elapsed - born.value - delay) / .45));
    return t === 1 ? 1 : 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
  };
};

const tileGeo = bakeAO(new RoundedBoxGeometry(.96, .6, .96, 3, .08), .4, .9);
const footGeo = bakeAO(new RoundedBoxGeometry(.94, .7, .94, 2, .1), .32);
const ico = new IcosahedronGeometry(1, 1);
const dode = new DodecahedronGeometry(1, 0);
const cone = new ConeGeometry(1, 1, 6);
const cyl = new CylinderGeometry(1, 1, 1, 8);
const sphere = new SphereGeometry(1, 10, 8);
const disc = new CircleGeometry(1, 20);
const box = new BoxGeometry(1, 1, 1);
const octa = new OctahedronGeometry(1);

const tileTransform = new Object3D();

function Tiles({ size, look, chapter }: { size: number; look: Look; chapter: number }) {
  const top = useRef<InstancedMesh>(null);
  const foot = useRef<InstancedMesh>(null);
  const { born } = useContext(BoardClock);
  const done = useRef(false);
  const colored = useRef(false);
  const data = useMemo(() => {
    // Colours are parsed once here; the reveal animation below only moves the tiles.
    const out: { x: number; z: number; h: number; c: Color; f: Color; d: number; stretch: number }[] = [];
    const c0 = (size - 1) / 2;
    for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
      const edge = x === 0 || z === 0 || x === size - 1 || z === size - 1;
      out.push({ x, z, h: ((x * 7 + z * 13) % 5) * .01, c: new Color(look.tiles[(x * 5 + z * 3 + x * z) % look.tiles.length]!),
        f: new Color(look.foot[(x + z) % look.foot.length]!), d: Math.hypot(x - c0, z - c0) * .06, stretch: edge ? 1 + ((x + z * 2) % 3) * .3 : 1 });
    }
    return out;
  }, [size, look]);
  useLayoutEffect(() => { done.current = false; colored.current = false; }, [data]);
  useFrame(({ clock }) => {
    const tm = top.current, fm = foot.current;
    if (done.current || !tm || !fm) return;
    const o = tileTransform;
    const age = born.value < 0 ? 0 : clock.elapsedTime - born.value;
    const paint = !colored.current;
    for (let i = 0; i < data.length; i++) {
      const t = data[i]!;
      const k = Math.min(1, Math.max(0, (age - t.d) / .5));
      const ease = 1 - Math.pow(1 - k, 3);
      const drop = (1 - ease) * -7;
      o.position.set(t.x, -.3 + t.h + drop, t.z); o.scale.set(1, 1, 1); o.rotation.set(0, (1 - ease) * .6, 0); o.updateMatrix();
      tm.setMatrixAt(i, o.matrix);
      o.position.set(t.x, -.6 - .35 * t.stretch + drop, t.z); o.scale.set(1, t.stretch, 1); o.updateMatrix();
      fm.setMatrixAt(i, o.matrix);
      if (paint) { tm.setColorAt(i, t.c); fm.setColorAt(i, t.f); }
    }
    tm.instanceMatrix.needsUpdate = true; fm.instanceMatrix.needsUpdate = true;
    if (paint) {
      if (tm.instanceColor) tm.instanceColor.needsUpdate = true;
      if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
      colored.current = true;
    }
    if (age > 1.6) done.current = true;
  });
  const metal = chapter === 4;
  return <group>
    <instancedMesh ref={top} args={[tileGeo, undefined, size * size]} receiveShadow castShadow dispose={null} frustumCulled={false}>
      <meshStandardMaterial vertexColors roughness={look.tileRoughness} metalness={metal ? .6 : chapter === 3 ? .1 : 0} envMapIntensity={chapter === 3 ? 1.4 : 1} />
    </instancedMesh>
    <instancedMesh ref={foot} args={[footGeo, undefined, size * size]} dispose={null} frustumCulled={false}>
      <meshStandardMaterial vertexColors roughness={.95} metalness={metal ? .5 : 0} />
    </instancedMesh>
    {metal && <Seams size={size} />}
    {metal && <VoidAccents size={size} />}
  </group>;
}

/**
 * The Void board's age: faint violet energy cracks across a few tiles, and a restrained violet-cyan rim light along a
 * few stretches of its edge, as if the abyss were seeping through. Seeded per board size, merged into one mesh each,
 * and kept dim so mirrors, wormholes and crystals stay the brightest things on the board.
 */
function VoidAccents({ size }: { size: number }) {
  const { cracks, rims } = useMemo(() => {
    const r = rng(size * 17 + 5);
    const cracks: { p: [number, number, number]; r: [number, number, number]; s: [number, number, number] }[] = [];
    const tiles = Math.max(2, Math.round(size * .6));
    for (let k = 0; k < tiles; k++) {
      const x = Math.floor(r() * size), z = Math.floor(r() * size);
      // On top of the tile, which is raised by the same small step the tiles use.
      const y = ((x * 7 + z * 13) % 5) * .01 + .004;
      let cx = x - .3 + r() * .2, cz = z - .3 + r() * .6, a = r() * Math.PI;
      for (let seg = 0; seg < 3; seg++) {
        const len = .18 + r() * .16;
        a += (r() - .5) * 1.4;
        cracks.push({ p: [cx + Math.cos(a) * len / 2, y, cz + Math.sin(a) * len / 2], r: [0, -a, 0], s: [len, .006, .018] });
        cx += Math.cos(a) * len; cz += Math.sin(a) * len;
      }
    }
    const rims: { p: [number, number, number]; s: [number, number, number] }[] = [];
    for (let k = 0; k < 3; k++) {
      const side = Math.floor(r() * 4), from = Math.floor(r() * (size - 2)), span = 2 + Math.floor(r() * 2);
      const mid = from + span / 2 - .5, edge = side < 2 ? -.5 : size - .5;
      rims.push(side % 2 === 0 ? { p: [mid, -.04, edge], s: [span, .025, .03] } : { p: [edge, -.04, mid], s: [.03, .025, span] });
    }
    return { cracks, rims };
  }, [size]);
  const mats = useMemo(() => ({
    crack: new MeshStandardMaterial({ color: '#b98aff', emissive: '#8a4aff', emissiveIntensity: 1.1, transparent: true, opacity: .55, toneMapped: false }),
    rim: new MeshStandardMaterial({ color: '#9ad8ff', emissive: '#7a6aff', emissiveIntensity: 1.4, transparent: true, opacity: .6, toneMapped: false }),
  }), []);
  useEffect(() => () => { mats.crack.dispose(); mats.rim.dispose(); }, [mats]);
  return <group>
    <Instances geometry={box} material={mats.crack} items={cracks} />
    <Instances geometry={box} material={mats.rim} items={rims} />
  </group>;
}

function Seams({ size }: { size: number }) {
  const items = useMemo(() => {
    const out: { p: [number, number, number]; s: [number, number, number] }[] = [];
    for (let k = 0; k <= size; k++) {
      out.push({ p: [k - .5, .005, (size - 1) / 2], s: [.04, .02, size] });
      out.push({ p: [(size - 1) / 2, .005, k - .5], s: [size, .02, .04] });
    }
    return out;
  }, [size]);
  const mat = useMemo(() => new MeshStandardMaterial({ color: '#58e0ff', emissive: '#2ab8ff', emissiveIntensity: 2.2, toneMapped: false }), []);
  return <Instances geometry={box} material={mat} items={items} />;
}

function Rim({ size, chapter, seed = 5 }: { size: number; chapter: number; seed?: number }) {
  const r = useMemo(() => rng(seed + chapter * 11), [seed, chapter]);
  const ring = useMemo(() => {
    const pts: [number, number][] = [];
    for (let i = 0; i < size; i++) pts.push([i, -.55], [-.55, i], [size - .45, i], [i, size - .45]);
    return pts;
  }, [size]);
  const mats = useMemo(() => ({
    grass: new MeshStandardMaterial({ color: '#5ea64a', roughness: .9, flatShading: true }),
    moss: new MeshStandardMaterial({ color: '#3f7a36', roughness: .7, flatShading: true }),
    fern: new MeshStandardMaterial({ color: '#2f8a3c', roughness: .8, flatShading: true }),
    sand: new MeshStandardMaterial({ color: '#d9a464', roughness: 1 }),
    snow: new MeshStandardMaterial({ color: '#e8f2fa', roughness: .6 }),
    ice: new MeshStandardMaterial({ color: '#7fd0ff', roughness: .05, metalness: .1, transparent: true, opacity: .85, envMapIntensity: 2, emissive: '#1a6aa8', emissiveIntensity: .3 }),
    flower: new MeshStandardMaterial({ color: '#ff8fd0', emissive: '#551133', emissiveIntensity: .3 }),
    shroom: new MeshStandardMaterial({ color: '#ff6a3a', emissive: '#ff3a1a', emissiveIntensity: .6 }),
    vine: new MeshStandardMaterial({ color: '#3d8a36' }),
    pot: new MeshStandardMaterial({ color: '#b5643a', roughness: .8 }),
    puddle: new MeshStandardMaterial({ color: '#1c2a26', roughness: .02, metalness: .4, envMapIntensity: 1.6 }),
  }), []);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]!;
  if (chapter === 0) {
    const tufts = ring.filter(() => r() < .75).map(([x, z]) => ({ p: [x, -.12, z] as [number, number, number], s: [.45 + r() * .2, .26 + r() * .1, .36] as [number, number, number], r: [0, r() * 3, 0] as [number, number, number] }));
    const flowers = tufts.filter(() => r() < .35).map(t => ({ p: [t.p[0] + .1, .14, t.p[2]] as [number, number, number], s: .06 }));
    const vines = ring.filter(() => r() < .35).map(([x, z]) => { const l = .6 + r() * 1.2; return { p: [x, -.6 - l / 2, z] as [number, number, number], s: [.03, l, .03] as [number, number, number] }; });
    return <group><Instances geometry={ico} material={mats.grass} items={tufts} castShadow /><Instances geometry={sphere} material={mats.flower} items={flowers} /><Instances geometry={cyl} material={mats.vine} items={vines} /></group>;
  }
  if (chapter === 1) {
    const ferns = ring.filter(() => r() < .7).flatMap(([x, z]) => Array.from({ length: 4 }, (_, k) => ({
      p: [x, .05, z] as [number, number, number], r: [Math.cos(k * 1.6) * .9, k * 1.6, Math.sin(k * 1.6) * .9] as [number, number, number], s: [.14, .9, .05] as [number, number, number] })));
    const moss = Array.from({ length: Math.round(size * size * .3) }, () => ({ p: [Math.floor(r() * size) + (r() - .5) * .5, .02, Math.floor(r() * size) + (r() - .5) * .5] as [number, number, number], s: [.25 + r() * .2, .04, .2 + r() * .2] as [number, number, number] }));
    const shrooms = ring.filter(() => r() < .18).map(([x, z]) => ({ p: [x + .1, .08, z] as [number, number, number], s: [.14, .08, .14] as [number, number, number] }));
    const puddles = Array.from({ length: Math.round(size * .6) }, () => ({ p: [Math.floor(r() * size) + .15, .012, Math.floor(r() * size) - .15] as [number, number, number], r: [-Math.PI / 2, 0, 0] as [number, number, number], s: .18 + r() * .12 }));
    const vines = ring.filter(() => r() < .5).map(([x, z]) => { const l = 1 + r() * 2; return { p: [x, -.6 - l / 2, z] as [number, number, number], s: [.035, l, .035] as [number, number, number] }; });
    return <group><Instances geometry={cone} material={mats.fern} items={ferns} castShadow /><Instances geometry={ico} material={mats.moss} items={moss} />
      <Instances geometry={sphere} material={mats.shroom} items={shrooms} /><Instances geometry={disc} material={mats.puddle} items={puddles} /><Instances geometry={cyl} material={mats.vine} items={vines} /></group>;
  }
  if (chapter === 2) {
    const drifts = ring.filter(() => r() < .65).map(([x, z]) => ({ p: [x, -.18, z] as [number, number, number], s: [.6 + r() * .3, .22 + r() * .12, .5] as [number, number, number] }));
    const pots = ring.filter(() => r() < .12).map(([x, z]) => ({ p: [x, .1, z] as [number, number, number], s: [.16, .24, .16] as [number, number, number] }));
    return <group><Instances geometry={sphere} material={mats.sand} items={drifts} /><Instances geometry={sphere} material={mats.pot} items={pots} castShadow /></group>;
  }
  if (chapter === 3) {
    const caps = ring.filter(() => r() < .8).map(([x, z]) => ({ p: [x, -.08, z] as [number, number, number], s: [.55, .2 + r() * .1, .45] as [number, number, number] }));
    const icicles = ring.filter(() => r() < .7).map(([x, z]) => { const l = .5 + r() * 1.3; return { p: [x, -.62 - l / 2, z] as [number, number, number], r: [Math.PI, 0, 0] as [number, number, number], s: [.08 + r() * .06, l, .08] as [number, number, number] }; });
    const shards = [[-.7, -.7], [size - .3, -.7], [-.7, size - .3], [size - .3, size - .3]].flatMap(([x, z]) => Array.from({ length: 4 }, (_, k) => ({
      p: [x! + (r() - .5) * .4, .3, z! + (r() - .5) * .4] as [number, number, number], r: [(r() - .5) * .7, r() * 3, (r() - .5) * .7] as [number, number, number], s: [.12, .5 + r() * .7 + (k === 0 ? .4 : 0), .12] as [number, number, number] })));
    return <group><Instances geometry={sphere} material={mats.snow} items={caps} /><Instances geometry={cone} material={mats.ice} items={icicles} /><Instances geometry={octa} material={mats.ice} items={shards} castShadow /></group>;
  }
  return <Pylons size={size} />;
}

function Pylons({ size }: { size: number }) {
  const lights = useRef<Object3D>(null);
  useFrame(({ clock }) => { lights.current?.children.forEach((c, i) => c.scale.setScalar(.6 + .4 * Math.abs(Math.sin(clock.elapsedTime * 2 + i)))); });
  const corners: [number, number][] = [[-.75, -.75], [size - .25, -.75], [-.75, size - .25], [size - .25, size - .25]];
  return <group>
    {corners.map(([x, z], i) => <group key={i} position={[x, 0, z]}>
      <mesh castShadow position={[0, .5, 0]}><cylinderGeometry args={[.12, .2, 1.2, 6]} /><meshStandardMaterial color="#454b62" metalness={.8} roughness={.3} /></mesh>
      <mesh position={[0, 1.15, 0]}><octahedronGeometry args={[.16]} /><meshStandardMaterial color="#ff8ae8" emissive="#ff3ad0" emissiveIntensity={2} toneMapped={false} /></mesh>
    </group>)}
    <group ref={lights}>{corners.map(([x, z], i) => <sprite key={i} position={[x, 1.15, z]} scale={[1.1, 1.1, 1]}>
      <spriteMaterial map={glowTexture} color="#ff5ae0" transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </sprite>)}</group>
  </group>;
}

/** A cratered asteroid, flattened on top where the board rests. Built once per board size. */
function asteroidGeometry(size: number) {
  const g = new IcosahedronGeometry(1, 5);
  const r = rng(size * 31 + 7);
  const waves = Array.from({ length: 4 }, (_, k) => ({ a: new Vector3(r() - .5, r() - .5, r() - .5).normalize(), f: 2.5 + k * 3.1, p: r() * 6, amp: .16 / (k + 1) }));
  const craters = Array.from({ length: 9 }, () => ({ c: new Vector3(r() - .5, -r() * .9, r() - .5).normalize(), size: .18 + r() * .22, depth: .06 + r() * .08 }));
  const pos = g.attributes.position!;
  const colors = new Float32Array(pos.count * 3);
  const v = new Vector3(), col = new Color();
  const rx = size * .78, ry = size * .62, top = .06;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let n = 1;
    for (const w of waves) n += Math.sin(v.dot(w.a) * w.f + w.p) * w.amp;
    let pit = 0;
    for (const c of craters) {
      const d = v.angleTo(c.c) / c.size;
      if (d < 1) pit = Math.max(pit, c.depth * (1 - d * d));
      else if (d < 1.3) n += c.depth * .5 * (1 - (d - 1) / .3);
    }
    n -= pit;
    let y = v.y * n * ry;
    const flat = y > -top;
    // The top is rough rock rather than a plate: small bumps, rising into a ragged lip at the rim.
    if (flat) y = -top + (n - 1) * .9 + Math.max(0, Math.hypot(v.x, v.z) - .8) * 2.2;
    pos.setXYZ(i, v.x * n * rx, y, v.z * n * rx);
    const shade = flat ? .2 + (n - 1) * .8 : .26 + v.y * .1 + (n - 1) * .9 - pit * 1.6;
    col.setHSL(.74, .25, Math.max(.04, Math.min(.22, shade * .7)));
    colors.set([col.r, col.g, col.b], i * 3);
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

function Asteroid({ size }: { size: number }) {
  const c = (size - 1) / 2;
  const geo = useMemo(() => asteroidGeometry(size), [size]);
  const debris = useRef<Group>(null);
  const veins = useRef<Group>(null);
  const items = useMemo(() => {
    const r = rng(size * 13 + 3);
    const shards = Array.from({ length: 9 }, () => {
      const a = r() * Math.PI * 2, d = size * (.35 + r() * .35);
      return { p: [Math.cos(a) * d, -size * (.18 + r() * .3), Math.sin(a) * d] as [number, number, number], r: [r() * 1.5 - .75, a, r() * 1.5 - .75] as [number, number, number],
        s: .14 + r() * .16, l: .5 + r() * .6, color: r() < .5 ? '#c45aff' : '#ff4fd8' };
    });
    const rocks = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2 + r() * .3, d = size * (.95 + r() * .35);
      return { a, d, y: -size * .25 + (r() - .5) * 1.4, s: .12 + r() * .3, spin: r() * 2 };
    });
    return { shards, rocks };
  }, [size]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (debris.current) {
      debris.current.rotation.y = t * .06;
      debris.current.children.forEach((m, i) => { m.rotation.x = t * (items.rocks[i]?.spin ?? 1); m.rotation.z = t * .7; });
    }
    veins.current?.children.forEach((s, i) => s.scale.setScalar(1.6 + Math.sin(t * 2 + i * 1.3) * .5));
  });
  return <group position={[c, -.95, c]}>
    <mesh geometry={geo} receiveShadow castShadow dispose={null}>
      <meshStandardMaterial vertexColors roughness={1} metalness={.05} flatShading emissive="#12041f" emissiveIntensity={.3} />
    </mesh>
    {items.shards.map((s, i) => <mesh key={i} position={s.p} rotation={s.r} scale={[s.s, s.l, s.s]}>
      <octahedronGeometry args={[1, 0]} /><meshStandardMaterial color={s.color} emissive={s.color} emissiveIntensity={2.2} roughness={.2} flatShading toneMapped={false} />
    </mesh>)}
    <group ref={veins}>{items.shards.map((s, i) => <sprite key={i} position={s.p}>
      <spriteMaterial map={glowTexture} color={s.color} opacity={.7} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </sprite>)}</group>
    <group ref={debris}>{items.rocks.map((k, i) => <mesh key={i} position={[Math.cos(k.a) * k.d, k.y, Math.sin(k.a) * k.d]} scale={k.s} castShadow>
      <dodecahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#3a3448" roughness={.9} flatShading />
    </mesh>)}</group>
    <mesh position={[0, -size * .25, 0]} rotation={[-Math.PI / 2 + .12, 0, .2]}>
      <ringGeometry args={[size * .95, size * 1.35, 64]} />
      <meshBasicMaterial color="#8a5aff" transparent opacity={.12} side={DoubleSide} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </mesh>
  </group>;
}

function Base({ size, chapter, look }: { size: number; chapter: number; look: Look }) {
  const c = (size - 1) / 2;
  const rocks = useMemo(() => {
    const r = rng(size * 7 + chapter);
    const palette = chapter === 3 ? ['#e8f4ff', '#bfdcef', '#9ec4e0'] : chapter === 1 ? ['#5a6152', '#4d5446', '#646b58'] : ['#a28a7a', '#8f7a72', '#b49a86', '#7d6c69'];
    return Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2, d = size * (.26 + r() * .18);
      return { p: [c + Math.cos(a) * d, -1.5 - r() * 1.2, c + Math.sin(a) * d] as [number, number, number], r: [r() * 3, r() * 3, r()] as [number, number, number],
        s: [size * (.2 + r() * .1), 1 + r() * .8, size * (.18 + r() * .1)] as [number, number, number], c: palette[i % palette.length] };
    });
  }, [size, chapter, c]);
  const rockMat = useMemo(() => new MeshStandardMaterial({ roughness: chapter === 3 ? .2 : 1, flatShading: true, metalness: chapter === 3 ? .1 : 0 }), [chapter]);
  if (chapter === 2) {
    return <group position={[c, 0, c]}>
      {[0, 1, 2].map(k => <mesh key={k} position={[0, -1.25 - k * 1.1, 0]} receiveShadow>
        <boxGeometry args={[size + .4 + k * 1.1, 1.1, size + .4 + k * 1.1]} /><meshStandardMaterial color={['#c99a5e', '#b98a50', '#a87a44'][k]} roughness={.95} />
      </mesh>)}
      <mesh position={[0, -4.6, 0]} rotation={[Math.PI, Math.PI / 4, 0]}><coneGeometry args={[size * .62, 3, 4]} /><meshStandardMaterial color="#8a6234" roughness={1} flatShading /></mesh>
      {[-1, 1].map(s => <mesh key={s} position={[0, -2.2, s * (size / 2 + 1.2)]}><boxGeometry args={[1.4, .2, 1.4]} /><meshStandardMaterial color="#d6a86a" /></mesh>)}
    </group>;
  }
  if (chapter === 4) return <Asteroid size={size} />;
  return <group>
    <Instances geometry={dode} material={rockMat} items={rocks} />
    <mesh position={[c, -2.9, c]} rotation={[Math.PI, .3, 0]}><coneGeometry args={[size * .48, size * .8, 7]} /><meshStandardMaterial color={chapter === 3 ? '#cfe6f6' : chapter === 1 ? '#4a5244' : '#8a7468'} flatShading roughness={chapter === 3 ? .2 : 1} /></mesh>
    {chapter !== 3 && <Waterfall position={[size - .4, -.6, c + .8]} height={chapter === 1 ? 6 : 3.2} width={.7} rotationY={Math.PI / 2} />}
  </group>;
}

export const BoardBody = React.memo(function BoardBody({ size, chapter, look }: { size: number; chapter: number; look: Look }) {
  return <group>
    <Tiles size={size} look={look} chapter={chapter} />
    <Rim size={size} chapter={chapter} />
    <Base size={size} chapter={chapter} look={look} />
  </group>;
});
