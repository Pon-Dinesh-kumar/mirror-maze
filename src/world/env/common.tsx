import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, NormalBlending, BufferAttribute, BufferGeometry, Color, ConeGeometry, DoubleSide, Group, InstancedMesh, Material, Mesh, MeshStandardMaterial, Object3D, ShaderMaterial, Shape, ShapeGeometry, SphereGeometry, Sprite } from 'three';
import { useFrame, useThree } from '../Canvas';
import { cloudTexture, disposeShader, glowTexture, skyMaterial, time, waterMaterial } from '../fx';
import { Look } from '../look';

export const rng = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

export function ShaderClock() {
  useFrame(({ clock }) => { time.value = clock.elapsedTime; });
  return null;
}

/** Gradient / storm / nebula sky that always surrounds the camera. */
export function SkyDome({ look, flash, dusk }: { look: Look; flash?: { value: number }; dusk?: number }) {
  const mesh = useRef<Mesh>(null);
  const mat = useMemo(() => skyMaterial(), []);
  useLayoutEffect(() => {
    const u = mat.uniforms;
    u.uTop!.value.set(look.sky.top); u.uHorizon!.value.set(look.sky.horizon); u.uBottom!.value.set(look.sky.bottom);
    u.uSun!.value.set(look.sky.sun); u.uSunDir!.value.set(...look.sky.sunDir).normalize();
    u.uSunSize!.value = look.sky.sunSize; u.uStorm!.value = look.sky.storm; u.uNebula!.value = look.sky.nebula; u.uStars!.value = look.sky.stars;
  }, [look, mat]);
  useFrame(({ camera }) => {
    mesh.current?.position.copy(camera.position);
    mat.uniforms.uFlash!.value = flash?.value ?? 0;
    mat.uniforms.uDusk!.value += ((dusk ?? 0) - mat.uniforms.uDusk!.value) * .03;
  });
  return <mesh ref={mesh} material={mat} renderOrder={-10} frustumCulled={false}><sphereGeometry args={[400, 32, 16]} /></mesh>;
}

export function Clouds({ count, radius, y, spread = 6, scale = [22, 9], color = '#ffffff', opacity = .85, seed = 1, drift = .01, fog = true }: {
  count: number; radius: [number, number]; y: number; spread?: number; scale?: [number, number]; color?: string; opacity?: number; seed?: number; drift?: number; fog?: boolean;
}) {
  const group = useRef<Group>(null);
  // Keyed on the tuple values: callers pass inline arrays, which are new objects on every render.
  const [r0, r1] = radius, [sx, sy] = scale;
  const items = useMemo(() => {
    const r = rng(seed * 97 + 13);
    return Array.from({ length: count }, () => {
      const a = r() * Math.PI * 2, d = r0 + r() * (r1 - r0), s = .6 + r() * .8;
      return { p: [Math.cos(a) * d, y + (r() - .5) * spread, Math.sin(a) * d] as [number, number, number], s: [sx * s, sy * s] as [number, number], o: opacity * (.6 + r() * .4) };
    });
  }, [count, r0, r1, y, spread, sx, sy, opacity, seed]);
  useFrame((_, dt) => { if (group.current) group.current.rotation.y += dt * drift; });
  return <group ref={group}>
    {items.map((c, i) => <sprite key={i} position={c.p} scale={[c.s[0], c.s[1], 1]}>
      <spriteMaterial map={cloudTexture} color={color} opacity={c.o} transparent depthWrite={false} fog={fog} />
    </sprite>)}
  </group>;
}

const particleVertex = /* glsl */`
  attribute float aSeed; uniform float uTime, uSpeed, uSize, uSway, uScale; uniform vec3 uArea;
  varying float vAlpha;
  void main(){
    vec3 p = position * uArea;
    float h = uArea.y;
    p.y = mod(p.y + h * .5 - uTime * uSpeed * (.6 + aSeed * .8), h) - h * .5;
    p.x += sin(uTime * .7 + aSeed * 40.) * uSway;
    p.z += cos(uTime * .5 + aSeed * 23.) * uSway;
    vec4 mv = modelViewMatrix * vec4(p, 1.);
    gl_PointSize = uSize * uScale * (.5 + aSeed) / max(1., -mv.z);
    vAlpha = (.55 + .45 * sin(uTime * 3. + aSeed * 60.)) * smoothstep(h * .5, h * .3, abs(p.y));
    gl_Position = projectionMatrix * mv;
  }`;

/** GPU-animated motes, snow, embers, dust or fireflies: zero per-frame CPU work. */
export function Particles({ count, area, center = [0, 0, 0], color, size = 1, speed = .5, sway = .5, seed = 1, additive = true }: {
  count: number; area: [number, number, number]; center?: [number, number, number]; color: string; size?: number; speed?: number; sway?: number; seed?: number; additive?: boolean;
}) {
  const { size: view, viewport } = useThree();
  const geometry = useMemo(() => {
    const r = rng(seed * 31 + 7);
    const g = new BufferGeometry();
    const pos = new Float32Array(count * 3), s = new Float32Array(count);
    for (let i = 0; i < count; i++) { pos[i * 3] = r() - .5; pos[i * 3 + 1] = r() - .5; pos[i * 3 + 2] = r() - .5; s[i] = r(); }
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new BufferAttribute(s, 1));
    return g;
  }, [count, seed]);
  // Keyed on the area values, not the array: callers pass an inline array, and a new material on every render
  // leaked the old one and re-initialised it on the GPU.
  const [ax, ay, az] = area;
  const material = useMemo(() => new ShaderMaterial({
    uniforms: { uTime: time, uSpeed: { value: speed }, uSize: { value: size }, uSway: { value: sway }, uArea: { value: [ax, ay, az] }, uScale: { value: 300 }, uColor: { value: new Color(color) }, uMap: { value: glowTexture } },
    vertexShader: particleVertex,
    fragmentShader: /* glsl */`uniform vec3 uColor; uniform sampler2D uMap; varying float vAlpha;
      void main(){ float a = texture2D(uMap, gl_PointCoord).a * vAlpha; if (a < .01) discard; gl_FragColor = vec4(uColor, a); }`,
    transparent: true, depthWrite: false, blending: additive ? AdditiveBlending : NormalBlending, toneMapped: false,
  }), [speed, size, sway, ax, ay, az, color, additive]);
  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  useEffect(() => () => { disposeShader(material); }, [material]);
  useLayoutEffect(() => { material.uniforms.uScale!.value = view.height * viewport.dpr * .9; }, [material, view.height, viewport.dpr]);
  return <points geometry={geometry} material={material} position={center} frustumCulled={false} />;
}

const RAIN_AREA: [number, number, number] = [36, 26, 36];

/** Rain streaks: line segments animated in the vertex shader. */
export function Rain({ count = 1400, area = RAIN_AREA, opacity = .45 }: { count?: number; area?: [number, number, number]; opacity?: number }) {
  const [ax, ay, az] = area;
  const geometry = useMemo(() => {
    const r = rng(77);
    const g = new BufferGeometry();
    const pos = new Float32Array(count * 6), seed = new Float32Array(count * 2), end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = r() - .5, y = r() - .5, z = r() - .5, s = r();
      pos.set([x, y, z, x, y, z], i * 6); seed.set([s, s], i * 2); end.set([0, 1], i * 2);
    }
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new BufferAttribute(seed, 1));
    g.setAttribute('aEnd', new BufferAttribute(end, 1));
    return g;
  }, [count]);
  const material = useMemo(() => new ShaderMaterial({
    uniforms: { uTime: time, uArea: { value: [ax, ay, az] }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */`attribute float aSeed, aEnd; uniform float uTime; uniform vec3 uArea; varying float vA;
      void main(){ vec3 p = position * uArea; float h = uArea.y;
        p.y = mod(p.y + h * .5 - uTime * (16. + aSeed * 8.), h) - h * .5;
        p += vec3(.18, 1., .06) * aEnd * (.55 + aSeed * .35);
        p.x -= p.y * .12;
        vA = aEnd; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); }`,
    fragmentShader: /* glsl */`uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(.78, .88, .95, uOpacity * (.3 + vA * .7)); }`,
    transparent: true, depthWrite: false,
  }), [ax, ay, az, opacity]);
  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  useEffect(() => () => { disposeShader(material); }, [material]);
  return <lineSegments geometry={geometry} material={material} frustumCulled={false} />;
}

/** Builds one InstancedMesh from a list of transforms. */
export function Instances({ geometry, material, items, castShadow = false }: {
  geometry: BufferGeometry; material: Material;
  items: { p: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] | number; c?: string }[]; castShadow?: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new Object3D(), col = new Color();
    items.forEach((it, i) => {
      o.position.set(...it.p);
      o.rotation.set(...(it.r ?? [0, 0, 0]));
      if (typeof it.s === 'number') o.scale.setScalar(it.s); else o.scale.set(...(it.s ?? [1, 1, 1]));
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (it.c) m.setColorAt(i, col.set(it.c));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={castShadow} dispose={null} />;
}

export function Waterfall({ position, height = 6, width = 1.6, rotationY = 0 }: { position: [number, number, number]; height?: number; width?: number; rotationY?: number }) {
  return <group position={position} rotation={[0, rotationY, 0]}>
    <mesh position={[0, -height / 2, 0]} material={waterMaterial}><planeGeometry args={[width, height]} /></mesh>
    <sprite position={[0, -height, .3]} scale={[width * 3, width * 2, 1]}>
      <spriteMaterial map={cloudTexture} color="#ffffff" opacity={.7} transparent depthWrite={false} />
    </sprite>
  </group>;
}

/** Wing outlines in the span (x) / chord (y) plane; laid flat into x-z when built. */
function wingGeometry(outer: boolean) {
  const s = new Shape();
  if (!outer) {
    s.moveTo(0, .16); s.quadraticCurveTo(.3, .22, .56, .15); s.lineTo(.56, -.1);
    s.quadraticCurveTo(.28, -.2, 0, -.18); s.closePath();
  } else {
    s.moveTo(0, .15); s.quadraticCurveTo(.36, .14, .74, -.02); s.lineTo(.6, -.08); s.lineTo(.62, -.12);
    s.lineTo(.46, -.12); s.lineTo(.46, -.15); s.quadraticCurveTo(.2, -.14, 0, -.1); s.closePath();
  }
  const g = new ShapeGeometry(s, 6);
  g.rotateX(-Math.PI / 2);
  return g;
}
const innerWing = wingGeometry(false), outerWing = wingGeometry(true);
const birdBody = new SphereGeometry(1, 12, 8);
const beakGeo = new ConeGeometry(.04, .14, 6).rotateX(Math.PI / 2);
const tailGeo = new ConeGeometry(.16, .3, 3).rotateX(-Math.PI / 2).scale(1, .2, 1);

/** Seabirds circling in loose flocks: two-part wings that fold on the upstroke, banking turns and long glides. */
export function Birds({ count = 8, radius = 26, y = 9, color = '#2a2a3a', seed = 3 }) {
  const group = useRef<Group>(null);
  const mats = useMemo(() => ({
    body: new MeshStandardMaterial({ color: '#f8f4ee', roughness: .7 }),
    wing: new MeshStandardMaterial({ color: '#f2eee8', roughness: .75, side: DoubleSide }),
    tip: new MeshStandardMaterial({ color, roughness: .8, side: DoubleSide }),
    beak: new MeshStandardMaterial({ color: '#f0a030', roughness: .5 }),
  }), [color]);
  const birds = useMemo(() => {
    const r = rng(seed);
    // Birds fly in small groups that share a path, offset into a loose V.
    return Array.from({ length: count }, (_, i) => {
      const flock = Math.floor(i / 3), slot = i % 3;
      return { a: flock * 2.1 + r() * .2 - slot * .05, d: radius * (.75 + flock * .18) + (slot - 1) * 1.6, h: y + flock * 2.5 + r() * 1.5 + slot * .3,
        s: .9 + r() * .4, sp: .07 + flock * .015, phase: r() * 6, wob: r() * 6 };
    });
  }, [count, radius, y, seed]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    group.current?.children.forEach((b, i) => {
      const d = birds[i]!;
      const a = d.a + t * d.sp;
      b.position.set(Math.cos(a) * d.d, d.h + Math.sin(t * .5 + d.wob) * .9, Math.sin(a) * d.d);
      b.rotation.set(Math.sin(t * .5 + d.wob) * -.12, -a, -.35);
      // Bursts of flapping between long glides.
      const glide = Math.max(0, Math.sin(t * .35 + d.phase));
      const amp = .15 + .75 * (1 - glide);
      const w = t * 7.5 + d.phase;
      const inner = Math.sin(w) * amp, outer = Math.sin(w - .9) * amp * .9;
      const [l, r] = [b.children[0]!, b.children[1]!];
      l.rotation.z = inner; r.rotation.z = -inner;
      // Outer wings sit inside the mirrored wing groups, so both bend with the same local sign.
      l.children[1]!.rotation.z = outer * .8; r.children[1]!.rotation.z = outer * .8;
      b.children[2]!.position.y = -inner * .04;
    });
  });
  return <group ref={group}>
    {birds.map((d, i) => <group key={i} scale={d.s}>
      {[1, -1].map(side => <group key={side} position={[side * .1, .02, .02]} scale={[side, 1, 1]}>
        <mesh geometry={innerWing} material={mats.wing} />
        <group position={[.55, 0, 0]}><mesh geometry={outerWing} material={mats.tip} /></group>
      </group>)}
      <group>
        <mesh geometry={birdBody} material={mats.body} scale={[.12, .11, .36]} />
        <mesh geometry={birdBody} material={mats.body} position={[0, .06, .32]} scale={.1} />
        <mesh geometry={beakGeo} material={mats.beak} position={[0, .05, .45]} />
        <mesh geometry={tailGeo} material={mats.body} position={[0, 0, -.42]} />
      </group>
    </group>)}
  </group>;
}
export function GodRays({ dir, color = '#fff2c8', count = 5, opacity = .12 }: { dir: [number, number, number]; color?: string; count?: number; opacity?: number }) {
  const ref = useRef<Group>(null);
  const len = Math.hypot(...dir);
  const n = dir.map(v => v / len) as [number, number, number];
  useFrame(({ clock }) => {
    ref.current?.children.forEach((c, i) => {
      ((c as Mesh).material as { opacity: number }).opacity = opacity * (.6 + .4 * Math.sin(clock.elapsedTime * .3 + i * 1.7));
    });
  });
  return <group ref={ref} position={[n[0] * 120, n[1] * 120, n[2] * 120]}>
    {Array.from({ length: count }, (_, i) => <mesh key={i} rotation={[0, Math.atan2(n[0], n[2]), (i - count / 2) * .14 - .9]}>
      <planeGeometry args={[5 + i * 2, 260]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} blending={AdditiveBlending} side={DoubleSide} fog={false} />
    </mesh>)}
  </group>;
}

export function Halo({ position, color, scale, opacity = 1 }: { position: [number, number, number]; color: string; scale: number; opacity?: number }) {
  const ref = useRef<Sprite>(null);
  return <sprite ref={ref} position={position} scale={[scale, scale, 1]}>
    <spriteMaterial map={glowTexture} color={color} opacity={opacity} transparent depthWrite={false} blending={AdditiveBlending} fog={false} toneMapped={false} />
  </sprite>;
}
