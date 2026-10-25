import React, { useMemo } from 'react';
import { BufferAttribute, Color, ConeGeometry, MeshStandardMaterial, OctahedronGeometry } from 'three';
import { auroraMaterial } from '../fx';
import { Look } from '../look';
import { Clouds, Instances, Particles, rng } from './common';

const spireGeo = new OctahedronGeometry(1, 0);
const mats = {
  mountain: new MeshStandardMaterial({ vertexColors: true, roughness: .8, flatShading: true }),
  spire: new MeshStandardMaterial({ color: '#a8e6ff', roughness: .04, metalness: .15, transparent: true, opacity: .82, emissive: '#2a8ac8', emissiveIntensity: .35, envMapIntensity: 2.4, flatShading: true }),
  lake: new MeshStandardMaterial({ color: '#b9e2f4', roughness: .08, metalness: .25, envMapIntensity: 1.6 }),
  snow: new MeshStandardMaterial({ color: '#f4fbff', roughness: .7, flatShading: true }),
};
const mountainGeo = (() => {
  const g = new ConeGeometry(1, 1, 9, 4);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const rock = new Color('#5a7290'), snow = new Color('#f4fbff'), c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + .5;
    pos.setX(i, pos.getX(i) * (1 + Math.sin(i * 7.3) * .12));
    c.lerpColors(rock, snow, Math.min(1, Math.max(0, (y - .35) * 3.5)));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
})();

/** Memoised so the static scenery is not reconciled again on every move. */
export const IceAge = React.memo(function IceAge({ look }: { look: Look }) {
  const world = useMemo(() => {
    const r = rng(61);
    const mountains = Array.from({ length: 18 }, (_, i) => {
      const a = (i / 18) * Math.PI * 2 + r() * .3, d = 95 + r() * 70, h = 40 + r() * 55;
      return { p: [Math.cos(a) * d, -12 + h / 2, Math.sin(a) * d] as [number, number, number], s: [h * .55, h, h * .55] as [number, number, number], r: [0, r() * 3, 0] as [number, number, number] };
    });
    const spires = Array.from({ length: 46 }, () => {
      const a = r() * Math.PI * 2, d = 11 + Math.pow(r(), .8) * 40, h = 2 + r() * 10;
      return { p: [Math.cos(a) * d, -11 + h * .6, Math.sin(a) * d] as [number, number, number], s: [.6 + r() * 1.2, h, .6 + r() * 1.2] as [number, number, number], r: [(r() - .5) * .5, r() * 3, (r() - .5) * .5] as [number, number, number] };
    });
    const drifts = Array.from({ length: 30 }, () => { const a = r() * Math.PI * 2, d = 12 + r() * 50; return { p: [Math.cos(a) * d, -11.6, Math.sin(a) * d] as [number, number, number], s: [3 + r() * 5, .8 + r(), 3 + r() * 4] as [number, number, number] }; });
    return { mountains, spires, drifts };
  }, []);
  const aurora = useMemo(() => [auroraMaterial('#3dffb0', '#7a5aff'), auroraMaterial('#5affd8', '#ff6ae0'), auroraMaterial('#4affa0', '#3a9aff')], []);
  return <group>
    <Instances geometry={mountainGeo} material={mats.mountain} items={world.mountains} />
    <Instances geometry={spireGeo} material={mats.spire} items={world.spires} />
    <Instances geometry={spireGeo} material={mats.snow} items={world.drifts} />
    <mesh material={mats.lake} position={[0, -12, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[230, 32]} /></mesh>
    {aurora.map((m, i) => <mesh key={i} material={m} position={[(i - 1) * 50, 40 + i * 6, -110 + i * 15]} rotation={[.1, (i - 1) * .4, 0]}>
      <planeGeometry args={[170, 70, 1, 1]} />
    </mesh>)}
    <Clouds count={14} radius={[30, 120]} y={-9} spread={3} scale={[40, 10]} color="#dff2ff" opacity={.5} seed={14} drift={.003} />
    <Particles count={220} area={[44, 26, 44]} center={[0, 2, 0]} color="#ffffff" size={.32} speed={1.3} sway={1.4} seed={15} additive={false} />
    <Particles count={30} area={[24, 10, 24]} center={[0, 2, 0]} color={look.particles} size={.6} speed={.2} sway={1} seed={16} />
  </group>;
});
