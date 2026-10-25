import React, { useMemo, useRef } from 'react';
import { AdditiveBlending, DodecahedronGeometry, Group, MeshStandardMaterial, Sprite } from 'three';
import { useFrame } from '../Canvas';
import { diskMaterial, glowTexture } from '../fx';
import { Look } from '../look';
import { Instances, Particles, rng } from './common';

const rockGeo = new DodecahedronGeometry(1, 0);
const rockMat = new MeshStandardMaterial({ color: '#4a4258', roughness: .9, flatShading: true });

export type EyeState = 'idle' | 'angry' | 'closing';

export function VoidEye({ state }: { state: EyeState }) {
  const root = useRef<Group>(null);
  const iris = useRef<Sprite>(null);
  const disk = useMemo(() => diskMaterial(), []);
  const scale = useRef(1);
  useFrame(({ clock, camera }, dt) => {
    const t = clock.elapsedTime;
    const angry = state === 'angry' ? 1 : 0;
    disk.uniforms.uPulse!.value = angry * (.4 + .3 * Math.sin(t * 4)) + Math.sin(t * .8) * .1;
    scale.current += ((state === 'closing' ? 0 : 1) - scale.current) * Math.min(1, dt * .8);
    if (root.current) { root.current.scale.setScalar(Math.max(.001, scale.current)); root.current.lookAt(camera.position); }
    if (iris.current) { const s = 9 + angry * 5 + Math.sin(t * (2 + angry * 4)) * 1.5; iris.current.scale.set(s, s, 1); }
  });
  return <group position={[0, 22, -120]}>
    <group ref={root}>
      <mesh material={disk} rotation={[1.25, 0, .2]}><planeGeometry args={[90, 90]} /></mesh>
      <mesh><sphereGeometry args={[12, 32, 16]} /><meshBasicMaterial color="#000000" fog={false} /></mesh>
      <sprite scale={[60, 60, 1]} renderOrder={-1}><spriteMaterial map={glowTexture} color="#7a2aff" opacity={.55} transparent depthWrite={false} blending={AdditiveBlending} fog={false} toneMapped={false} /></sprite>
      <sprite ref={iris} position={[0, 0, 12.5]}><spriteMaterial map={glowTexture} color="#ff2a3a" transparent depthWrite={false} blending={AdditiveBlending} fog={false} toneMapped={false} /></sprite>
    </group>
  </group>;
}

function Planet({ p, r, color, ring, emissive }: { p: [number, number, number]; r: number; color: string; ring?: string; emissive: string }) {
  const ref = useRef<Group>(null);
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt * .02; });
  return <group position={p} ref={ref}>
    <mesh><sphereGeometry args={[r, 40, 24]} /><meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={.25} roughness={.7} fog={false} /></mesh>
    {ring && <mesh rotation={[1.2, .3, 0]}><ringGeometry args={[r * 1.4, r * 2.2, 64]} /><meshBasicMaterial color={ring} transparent opacity={.45} side={2} fog={false} depthWrite={false} /></mesh>}
    <sprite scale={[r * 3.2, r * 3.2, 1]}><spriteMaterial map={glowTexture} color={emissive} opacity={.35} transparent depthWrite={false} blending={AdditiveBlending} fog={false} /></sprite>
  </group>;
}

/** Memoised so the static scenery is not reconciled again on every move. */
export const TheVoid = React.memo(function TheVoid({ look, eye }: { look: Look; eye: EyeState }) {
  const belt = useRef<Group>(null);
  const asteroids = useMemo(() => {
    const r = rng(91);
    return Array.from({ length: 80 }, () => {
      const a = r() * Math.PI * 2, d = 22 + r() * 40;
      return { p: [Math.cos(a) * d, -6 + (r() - .5) * 8, Math.sin(a) * d] as [number, number, number], r: [r() * 3, r() * 3, r() * 3] as [number, number, number], s: .3 + r() * r() * 2.4 };
    });
  }, []);
  useFrame((_, dt) => { if (belt.current) belt.current.rotation.y += dt * .015; });
  return <group>
    <VoidEye state={eye} />
    <Planet p={[-150, 40, -230]} r={22} color="#6a3aa8" emissive="#ff6ad8" ring="#d8a8ff" />
    <Planet p={[90, -14, -110]} r={8} color="#3a6aa8" emissive="#5ad8ff" />
    <Planet p={[150, 60, 40]} r={5} color="#a85a3a" emissive="#ff9a5a" ring="#ffcf9a" />
    <group ref={belt}><Instances geometry={rockGeo} material={rockMat} items={asteroids} /></group>
    <Particles count={700} area={[500, 300, 500]} color="#ffffff" size={2.2} speed={0} sway={0} seed={33} />
    <Particles count={60} area={[26, 12, 26]} center={[0, 2, 0]} color={look.particles} size={1.4} speed={.25} sway={1.2} seed={34} />
  </group>;
});
