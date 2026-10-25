import React, { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Mesh, Object3D, PlaneGeometry, Points, ShaderMaterial, Sprite, Vector3 } from 'three';
import { useFrame, useThree } from './Canvas';
import { disposeShader, glowTexture, veilMaterial } from './fx';
import { BEAM_Y } from './Beam';
import { ABOVE_VEIL, AbyssRun } from './Modifiers';
import { abyssPose, GROW, GROW_AT, PULL, PULL_AT } from './abyss';
import { Trace } from '../game/types';

/** Energy strands sampled along the light, and loose motes from around the hole. */
const STRANDS = 36, MOTES = 12, COUNT = STRANDS + MOTES;
const quad = new PlaneGeometry(2, 2);
const tmp = new Vector3();

/** Deterministic noise for the effect's layout: the same failure always looks the same. */
const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/**
 * Everything a feeding black hole does to the rest of the board, drawn on top of it and never touching the rules:
 * the flash where the light crossed its edge, strands of energy torn from the light's actual path and streaming into
 * it, loose motes drawn inward while it grows, and the darkness spreading out from it until only the hole is left.
 * Reads the absorption from `run` and the board's light from `trace`; all pools are built once per board.
 */
export function AbyssEffects({ run, trace, hole }: { run: { current?: AbyssRun }; trace: Trace; hole: [number, number] }) {
  const { size } = useThree();
  const veil = useRef<Mesh>(null);
  const anchor = useRef<Object3D>(null);
  const flash = useRef<Sprite>(null);
  const points = useRef<Points>(null);
  const veilMat = useMemo(() => veilMaterial(), []);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(COUNT * 3), 3));
    g.setAttribute('aSize', new BufferAttribute(new Float32Array(COUNT), 1));
    return g;
  }, []);
  const material = useMemo(() => new ShaderMaterial({
    uniforms: { uMap: { value: glowTexture }, uColor: { value: new Color('#e2c8ff') }, uScale: { value: 1 } },
    vertexShader: /* glsl */`attribute float aSize; uniform float uScale; varying float vS;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vS = aSize; gl_PointSize = aSize * uScale / max(1., -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform sampler2D uMap; uniform vec3 uColor; varying float vS;
      void main(){ float a = texture2D(uMap, gl_PointCoord).a; if (vS <= 0. || a < .02) discard; gl_FragColor = vec4(uColor, a); }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
  }), []);
  useEffect(() => () => { geometry.dispose(); disposeShader(material); disposeShader(veilMat); }, [geometry, material, veilMat]);
  // Where each strand leaves the light (sampled along the rendered segments, weighted by length) and when it goes.
  const strands = useMemo(() => {
    const segs = trace.segments.filter(s => s.length > 0);
    const total = segs.reduce((a, s) => a + s.length, 0);
    return Array.from({ length: COUNT }, (_, i) => {
      if (i >= STRANDS || !total) {
        const a = hash(i) * Math.PI * 2, d = 1.4 + hash(i + 50) * 2.2;
        return { from: new Vector3(hole[0] + Math.cos(a) * d, BEAM_Y + (hash(i + 9) - .5) * .5, hole[1] + Math.sin(a) * d), at: GROW_AT + hash(i + 3) * GROW * .6,
          time: .9 + hash(i + 7) * .5, spin: (hash(i + 2) - .5) * 4, size: .12 + hash(i + 4) * .08 };
      }
      let pick = hash(i) * total, s = segs[0]!;
      for (const x of segs) { if (pick <= x.length) { s = x; break; } pick -= x.length; }
      const k = s.length ? pick / s.length : 0;
      return { from: new Vector3(s.from[0] + (s.to[0] - s.from[0]) * k, BEAM_Y, s.from[1] + (s.to[1] - s.from[1]) * k),
        at: PULL_AT + hash(i + 11) * PULL * .75, time: .45 + hash(i + 13) * .3, spin: (hash(i + 17) - .5) * 3, size: .16 + hash(i + 19) * .12 };
    });
  }, [trace, hole]);
  const pose = useMemo(() => abyssPose(-1), []);
  const center = useMemo(() => new Vector3(hole[0], .72, hole[1]), [hole]);
  useFrame(({ clock, camera, viewport }) => {
    const r = run.current;
    const live = !!r && r.start >= 0;
    const e = live ? clock.elapsedTime - r!.start : -1;
    const p = abyssPose(e, pose);
    if (veil.current) {
      veil.current.visible = live && p.dark > .002;
      if (veil.current.visible && anchor.current) {
        anchor.current.getWorldPosition(tmp).project(camera);
        const u = veilMat.uniforms;
        u.uCenter!.value.set(tmp.x, tmp.y);
        u.uAspect!.value = size.width / Math.max(1, size.height);
        u.uDark!.value = p.dark;
        u.uSpread!.value = p.spread;
        u.uWave!.value = p.wave;
      }
    }
    if (flash.current) {
      const f = live && p.impact < 1 ? Math.sin(Math.PI * p.impact) : 0;
      flash.current.visible = f > .01;
      if (f > .01) {
        flash.current.position.set(r!.record.point[0], BEAM_Y, r!.record.point[1]);
        flash.current.scale.setScalar(.6 + p.impact * 1.8);
        flash.current.material.opacity = f;
      }
    }
    const pts = points.current;
    if (!pts) return;
    pts.visible = live && e < PULL_AT + PULL + .6;
    if (!pts.visible) return;
    material.uniforms.uScale!.value = size.height * viewport.dpr * .9;
    const pos = geometry.getAttribute('position') as BufferAttribute, sz = geometry.getAttribute('aSize') as BufferAttribute;
    strands.forEach((s, i) => {
      const k = (e - s.at) / s.time;
      if (k <= 0 || k >= 1) { sz.setX(i, 0); return; }
      // Accelerating inward along a slight spiral, shrinking as it crosses the horizon.
      const q = k * k;
      tmp.copy(s.from).lerp(center, q);
      const swirl = s.spin * (1 - q) * .35 * Math.sin(k * Math.PI);
      const dx = tmp.x - center.x, dz = tmp.z - center.z;
      pos.setXYZ(i, tmp.x - dz * swirl, tmp.y, tmp.z + dx * swirl);
      sz.setX(i, s.size * (1 - q * .7));
    });
    pos.needsUpdate = true; sz.needsUpdate = true;
  });
  return <group>
    {/* A plain array, never a Vector3: on Android two copies of three are bundled, and a foreign Vector3 cannot be
        copied into `position`, so R3F would try to assign it and throw. */}
    <object3D ref={anchor} position={[hole[0], .72, hole[1]]} />
    <mesh ref={veil} geometry={quad} material={veilMat} frustumCulled={false} visible={false} renderOrder={ABOVE_VEIL - 2} />
    <sprite ref={flash} visible={false} renderOrder={ABOVE_VEIL}>
      <spriteMaterial map={glowTexture} color="#efd8ff" transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </sprite>
    <points ref={points} geometry={geometry} material={material} frustumCulled={false} visible={false} renderOrder={ABOVE_VEIL} />
  </group>;
}
