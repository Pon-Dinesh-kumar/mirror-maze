import React, { useMemo, useRef } from 'react';
import { AdditiveBlending, CatmullRomCurve3, ConeGeometry, CylinderGeometry, DodecahedronGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, TubeGeometry, Vector3 } from 'three';
import { useFrame } from '../Canvas';
import { Look } from '../look';
import { Clouds, Instances, Particles, Rain, rng, Waterfall } from './common';
import { audio } from '../../services/audio';
import { voice } from '../../services/voice';

const trunkGeo = new CylinderGeometry(.5, .8, 1, 7);
const blobGeo = new IcosahedronGeometry(1, 1);
const leafGeo = new ConeGeometry(1, 1, 5);
const rockGeo = new DodecahedronGeometry(1, 0);
const mats = {
  trunk: new MeshStandardMaterial({ color: '#4a3a2c', roughness: 1 }),
  canopy: new MeshStandardMaterial({ color: '#2f6a34', roughness: .8, flatShading: true }),
  fern: new MeshStandardMaterial({ color: '#3a8a3c', roughness: .6, flatShading: true }),
  stone: new MeshStandardMaterial({ color: '#5f6a58', roughness: .9, flatShading: true }),
  moss: new MeshStandardMaterial({ color: '#3f7a36', roughness: .9, flatShading: true }),
  cliff: new MeshStandardMaterial({ color: '#3e4a40', roughness: 1, flatShading: true }),
  floor: new MeshStandardMaterial({ color: '#1d2e22', roughness: 1 }),
};

export interface Storm { flash: { value: number } }

function Lightning({ storm, onLight }: { storm: Storm; onLight: (v: number) => void }) {
  const bolt = useRef<Mesh>(null);
  const next = useRef(4);
  const strike = useRef(-10);
  const r = useMemo(() => rng(Date.now() % 100000 + 1), []);
  const mat = useMemo(() => new MeshBasicMaterial({ color: '#e8f0ff', transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }), []);
  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime;
    if (t > next.current) {
      strike.current = t;
      next.current = t + 5 + r() * 7;
      const a = r() * Math.PI * 2, d = 45 + r() * 50;
      const pts: Vector3[] = [];
      let x = Math.cos(a) * d, z = Math.sin(a) * d;
      for (let y = 45; y > -10; y -= 4 + r() * 3) { pts.push(new Vector3(x, y, z)); x += (r() - .5) * 8; z += (r() - .5) * 8; }
      const g = new TubeGeometry(new CatmullRomCurve3(pts, false, 'catmullrom', .1), 48, .35, 4, false);
      bolt.current?.geometry.dispose();
      if (bolt.current) bolt.current.geometry = g;
      const delay = .3 + (d - 45) / 50 * 1.5;
      // Distant thunder rolls under the narrator's words instead of over them.
      setTimeout(() => audio.play(d < 70 ? 'thunder1' : 'thunder2', voice.speaking() ? .4 : .9), delay * 1000);
    }
    const age = t - strike.current;
    const f = age < .08 ? 1 : age < .14 ? .25 : age < .22 ? .85 : Math.max(0, .85 - (age - .22) * 3);
    storm.flash.value = f * .55;
    onLight(f);
    if (bolt.current) { bolt.current.visible = age < .3; bolt.current.lookAt(camera.position.x, bolt.current.position.y, camera.position.z); }
  });
  return <mesh ref={bolt} material={mat} visible={false} frustumCulled={false} />;
}

/** Memoised so the static scenery is not reconciled again on every move. */
export const Rainforest = React.memo(function Rainforest({ look, storm, onLight }: { look: Look; storm: Storm; onLight: (v: number) => void }) {
  const jungle = useMemo(() => {
    const r = rng(41);
    const trunks: { p: [number, number, number]; s: [number, number, number]; r?: [number, number, number] }[] = [];
    const canopy: { p: [number, number, number]; s: [number, number, number]; c: string }[] = [];
    const vines: { p: [number, number, number]; s: [number, number, number] }[] = [];
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, d = 10 + Math.pow(r(), .7) * 55;
      const x = Math.cos(a) * d, z = Math.sin(a) * d - (d < 16 ? 4 : 0);
      if (z > 6 && Math.abs(x) < 12) continue;
      const h = 14 + r() * 18, w = .7 + r() * .8;
      trunks.push({ p: [x, -14 + h / 2, z], s: [w, h, w], r: [(r() - .5) * .08, 0, (r() - .5) * .08] });
      for (let k = 0; k < 4; k++) canopy.push({ p: [x + (r() - .5) * 5, -14 + h + (r() - .3) * 3, z + (r() - .5) * 5], s: [3 + r() * 3, 1.8 + r() * 1.5, 3 + r() * 3], c: ['#2c6430', '#36783a', '#245a2c', '#3f8a3e'][k]! });
      for (let k = 0; k < 2; k++) { const l = 4 + r() * 8; vines.push({ p: [x + (r() - .5) * 4, -14 + h - l / 2, z + (r() - .5) * 4], s: [.06, l, .06] }); }
    }
    const ferns: { p: [number, number, number]; r: [number, number, number]; s: [number, number, number] }[] = [];
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2, d = 7 + r() * 9;
      for (let k = 0; k < 5; k++) ferns.push({ p: [Math.cos(a) * d, -4 + r() * 2, Math.sin(a) * d], r: [Math.cos(k * 1.3) * 1.1, k * 1.3, Math.sin(k * 1.3) * 1.1], s: [.5, 3.5 + r() * 2, .12] });
    }
    return { trunks, canopy, vines, ferns };
  }, []);
  return <group>
    <Instances geometry={trunkGeo} material={mats.trunk} items={jungle.trunks} />
    <Instances geometry={blobGeo} material={mats.canopy} items={jungle.canopy} />
    <Instances geometry={trunkGeo} material={mats.moss} items={jungle.vines} />
    <Instances geometry={leafGeo} material={mats.fern} items={jungle.ferns} />
    <group position={[0, -6, -24]}>
      {[-5, 5].map(x => <mesh key={x} position={[x, 5, 0]} material={mats.stone}><boxGeometry args={[2.4, 14, 2.4]} /></mesh>)}
      <mesh position={[0, 12.6, 0]} material={mats.stone}><boxGeometry args={[13, 2, 2.8]} /></mesh>
      <mesh position={[0, 13.8, 0]} material={mats.moss} scale={[6, .6, 1.6]} geometry={blobGeo} />
      <Instances geometry={rockGeo} material={mats.stone} items={[{ p: [-8, -1, 2], s: [2, 1.6, 2] }, { p: [7, -1.5, 3], s: [2.6, 1.4, 2] }, { p: [1, -2, 4], s: [1.6, 1, 1.6] }]} />
    </group>
    <mesh position={[18, 4, -48]} material={mats.cliff} scale={[30, 36, 10]} geometry={rockGeo} />
    <Waterfall position={[10, 22, -40]} height={36} width={5} />
    <mesh position={[0, -14, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.floor}><circleGeometry args={[200, 24]} /></mesh>
    <Clouds count={18} radius={[8, 60]} y={-9} spread={4} scale={[26, 8]} color="#9fb8ac" opacity={.55} seed={7} drift={.006} />
    <Clouds count={12} radius={[40, 140]} y={34} spread={10} scale={[60, 18]} color="#40524c" opacity={.85} seed={8} drift={.01} />
    <Rain />
    <Particles count={60} area={[24, 10, 24]} center={[0, 1, 0]} color={look.particles} size={1.1} speed={.12} sway={1.6} seed={9} />
    <Lightning storm={storm} onLight={onLight} />
  </group>;
});

export const _unused = (g: Group) => g;
