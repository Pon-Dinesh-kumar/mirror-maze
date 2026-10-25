import React, { useMemo } from 'react';
import { BoxGeometry, BufferAttribute, Color, ConeGeometry, CylinderGeometry, MeshStandardMaterial, PlaneGeometry } from 'three';
import { Look } from '../look';
import { Halo, Instances, Particles, rng } from './common';

const coneGeo = new ConeGeometry(1, 1, 7);
const cylGeo = new CylinderGeometry(1, 1, 1, 8);
const boxGeo = new BoxGeometry(1, 1, 1);
const mats = {
  sandstone: new MeshStandardMaterial({ color: '#d9b27a', roughness: .95, flatShading: true }),
  pyramid: new MeshStandardMaterial({ color: '#e0b878', roughness: .9, flatShading: true }),
  gold: new MeshStandardMaterial({ color: '#ffcf4a', metalness: 1, roughness: .25, emissive: '#ff9a10', emissiveIntensity: .5 }),
  palm: new MeshStandardMaterial({ color: '#7a5a36', roughness: 1 }),
  frond: new MeshStandardMaterial({ color: '#4f8f3a', roughness: .8, flatShading: true }),
  water: new MeshStandardMaterial({ color: '#2a9ab0', roughness: .05, metalness: .3, envMapIntensity: 1.6 }),
  dune: new MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
  paving: new MeshStandardMaterial({ roughness: .95 }),
};

function Dunes() {
  const geo = useMemo(() => {
    const g = new PlaneGeometry(520, 520, 110, 110);
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const lo = new Color('#a8642e'), hi = new Color('#f2c47c'), c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const d = Math.hypot(x, z);
      let y = Math.sin(x * .045 + z * .02) * 4 + Math.sin(z * .07 - x * .03) * 2.5 + Math.sin((x + z) * .12) * .8;
      y *= Math.min(1, Math.max(0, (d - 12) / 25));
      pos.setY(i, y);
      c.lerpColors(lo, hi, Math.min(1, Math.max(0, (y + 4) / 9)));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  return <mesh geometry={geo} material={mats.dune} position={[0, -9, 0]} receiveShadow />;
}

function Pyramid({ p, s }: { p: [number, number, number]; s: number }) {
  return <group position={p}>
    <mesh material={mats.pyramid} rotation={[0, Math.PI / 4, 0]} position={[0, s * .45, 0]}><coneGeometry args={[s * .72, s * .9, 4]} /></mesh>
    <mesh material={mats.gold} rotation={[0, Math.PI / 4, 0]} position={[0, s * .86, 0]}><coneGeometry args={[s * .09, s * .1, 4]} /></mesh>
    <Halo position={[0, s * .9, 0]} color="#ffd36a" scale={s * .35} opacity={.5} />
  </group>;
}

function Palm({ p, h, lean }: { p: [number, number, number]; h: number; lean: number }) {
  const parts = useMemo(() => {
    const segs = Array.from({ length: 7 }, (_, i) => {
      const k = i / 7;
      return { p: [Math.sin(k * 1.2) * lean, k * h + h / 14, 0] as [number, number, number], s: [.28 - k * .1, h / 7 + .05, .28 - k * .1] as [number, number, number], r: [0, 0, -lean * .12 * k] as [number, number, number] };
    });
    const top: [number, number, number] = [Math.sin(1.2) * lean, h, 0];
    const fronds = Array.from({ length: 8 }, (_, i) => ({ p: top, r: [Math.cos(i * .785) * 1.25, i * .785, Math.sin(i * .785) * 1.25] as [number, number, number], s: [.45, 3.4, .08] as [number, number, number] }));
    return { segs, fronds };
  }, [h, lean]);
  return <group position={p}><Instances geometry={cylGeo} material={mats.palm} items={parts.segs} /><Instances geometry={coneGeo} material={mats.frond} items={parts.fronds} /></group>;
}

/** Memoised so the static scenery is not reconciled again on every move. */
export const Desert = React.memo(function Desert({ look }: { look: Look }) {
  const props = useMemo(() => {
    const r = rng(23);
    const obelisks = [[-9, -14], [10, -16], [-13, 4], [14, 2]].map(([x, z]) => ({ x: x!, z: z!, h: 9 + r() * 4 }));
    const columns = Array.from({ length: 8 }, () => { const a = r() * Math.PI * 2, d = 14 + r() * 14, h = 2 + r() * 6; return { p: [Math.cos(a) * d, -9 + h / 2, Math.sin(a) * d] as [number, number, number], s: [.9, h, .9] as [number, number, number] }; });
    const palms = Array.from({ length: 9 }, (_, i) => ({ p: [-34 + Math.cos(i * .7) * 10, -8.5, -26 + Math.sin(i * .7) * 7] as [number, number, number], h: 6 + r() * 4, lean: (r() - .5) * 3 }));
    return { obelisks, columns, palms };
  }, []);
  const sun = look.sky.sunDir;
  const n = Math.hypot(...sun);
  return <group>
    <Dunes />
    <Pyramid p={[-70, -9, -120]} s={64} />
    <Pyramid p={[30, -9, -160]} s={90} />
    <Pyramid p={[105, -9, -95]} s={42} />
    <Pyramid p={[-130, -9, -60]} s={34} />
    <Pyramid p={[-15, -9, -30]} s={18} />
    <Pyramid p={[17, -9, -40]} s={24} />
    {props.obelisks.map((o, i) => <group key={i} position={[o.x, -9, o.z]}>
      <mesh material={mats.sandstone} position={[0, o.h / 2, 0]} rotation={[0, Math.PI / 4, 0]}><cylinderGeometry args={[.45, .8, o.h, 4]} /></mesh>
      <mesh material={mats.gold} position={[0, o.h + .45, 0]} rotation={[0, Math.PI / 4, 0]}><coneGeometry args={[.5, .9, 4]} /></mesh>
    </group>)}
    <Instances geometry={cylGeo} material={mats.sandstone} items={props.columns} />
    {props.palms.map((p, i) => <Palm key={i} p={p.p} h={p.h} lean={p.lean} />)}
    <mesh material={mats.water} position={[-34, -8.4, -26]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[9, 32]} /></mesh>
    <Halo position={[sun[0] / n * 300, sun[1] / n * 300, sun[2] / n * 300]} color="#ffcf7a" scale={140} opacity={.6} />
    <Courtyard />
    <Particles count={160} area={[50, 12, 50]} center={[0, -2, 0]} color="#ffe0a8" size={.9} speed={-.4} sway={6} seed={12} additive={false} />
  </group>;
});

function Brazier({ p }: { p: [number, number, number] }) {
  return <group position={p}>
    <mesh material={mats.sandstone} position={[0, 1.2, 0]}><cylinderGeometry args={[.35, .5, 2.4, 8]} /></mesh>
    <mesh material={mats.gold} position={[0, 2.5, 0]}><cylinderGeometry args={[.7, .35, .4, 12]} /></mesh>
    <Halo position={[0, 3.1, 0]} color="#ff9a2a" scale={3.2} opacity={.9} />
    <Halo position={[0, 3.4, 0]} color="#fff0a0" scale={1.3} opacity={1} />
  </group>;
}

function Sphinx({ p, r }: { p: [number, number, number]; r: number }) {
  return <group position={p} rotation={[0, r, 0]} scale={1.3}>
    <mesh material={mats.sandstone} position={[0, .5, 0]}><boxGeometry args={[1.4, 1, 3.2]} /></mesh>
    <mesh material={mats.sandstone} position={[0, 1.55, 1.1]}><boxGeometry args={[1, 1.2, 1]} /></mesh>
    <mesh material={mats.gold} position={[0, 1.7, 1.05]}><boxGeometry args={[1.25, .9, .7]} /></mesh>
    <mesh material={mats.sandstone} position={[0, 1.65, 1.62]}><boxGeometry args={[.6, .6, .2]} /></mesh>
    {[-.45, .45].map(x => <mesh key={x} material={mats.sandstone} position={[x, .2, 1.9]}><boxGeometry args={[.4, .4, 1]} /></mesh>)}
  </group>;
}

/** A sunken temple courtyard right beneath the board, visible from the top-down gameplay camera. */
function Courtyard() {
  const tiles = useMemo(() => {
    const out: { p: [number, number, number]; s: [number, number, number]; c: string }[] = [];
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) {
      if (Math.abs(x) < 5 && Math.abs(z) < 5) continue;
      out.push({ p: [x * 2.2, -6.8 + ((x * 7 + z * 3) % 3) * .05, z * 2.2], s: [2.1, .4, 2.1], c: ['#d2a468', '#c4975c', '#ddb47a'][(x + z + 12) % 3]! });
    }
    return out;
  }, []);
  const cols = useMemo(() => [-1, 1].flatMap(sx => [-10, -5, 0, 5, 10].map(z => ({ p: [sx * 12, -2.5, z] as [number, number, number], s: [.9, 9, .9] as [number, number, number] }))), []);
  return <group>
    <Instances geometry={boxGeo} material={mats.paving} items={tiles} />
    <Instances geometry={cylGeo} material={mats.sandstone} items={cols} />
    {[-1, 1].map(sx => <mesh key={sx} material={mats.sandstone} position={[sx * 12, 2.2, 0]}><boxGeometry args={[1.6, .6, 22]} /></mesh>)}
    <Sphinx p={[-8.5, -6.6, 9]} r={.5} />
    <Sphinx p={[8.5, -6.6, 9]} r={-.5} />
    <Brazier p={[-8, -6.6, -8]} />
    <Brazier p={[8, -6.6, -8]} />
    <Brazier p={[-9.5, -6.6, 3]} />
    <Brazier p={[9.5, -6.6, 3]} />
    <Palm p={[-14, -6.6, 13]} h={8} lean={1.4} />
    <Palm p={[14.5, -6.6, 12]} h={7} lean={-1.2} />
    <Palm p={[-15, -6.6, -12]} h={9} lean={.9} />
  </group>;
}
