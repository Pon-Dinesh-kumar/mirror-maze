import React, { useContext, useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, NormalBlending, PlaneGeometry, Points, ShaderMaterial, Sprite, SpriteMaterial, Vector3 } from 'three';
import { useFrame } from './Canvas';
import { BoardClock } from './Board';
import { Abyss, beamMaterial, disposeShader, ghostBeamMaterial, glowTexture, sparkTexture, time } from './fx';
import { Look } from './look';
import { Trace } from '../game/types';
import { audio } from '../services/audio';

export const BEAM_SPEED = 22;
export const BEAM_Y = .66;
/** How far a beam that leaves the board keeps travelling (in tiles) while it dissolves. */
const EXIT_TAIL = .55;
/** Enough rows along each ribbon that a beam bent toward a black hole curves smoothly. */
const ribbon = new PlaneGeometry(1, 1, 1, 24);

export interface BeamClock {
  reveal: { value: number };
  /** Extra brightness while the solved board charges its crystals. */
  boost: { value: number };
  /** How far along the light may stand: while a cluster's stones turn, the light falls back to here, then regrows. */
  limit: { value: number };
  /** A black hole's hold on the light (bend and drain); untouched unless the Devourer is feeding. */
  abyss: Abyss;
}
export const newAbyss = (): Abyss => ({ hole: { value: new Vector3() }, pull: { value: 0 }, reach: { value: 1 }, drain: { value: 0 } });

/** Where a black hole's pull moves a point of light (board coordinates, in place). */
export function pulled(abyss: Abyss, p: Vector3) {
  const pull = abyss.pull.value;
  if (pull <= 0) return p;
  const h = abyss.hole.value, r = abyss.reach.value;
  const dx = p.x - h.x, dz = p.z - h.z;
  return p.lerp(h, pull * .92 * Math.exp(-(dx * dx + dz * dz) / (r * r)));
}
const tmp = new Vector3();
/** How fast the light falls back (tiles per second) while stones it touches turn. */
const RETRACT_SPEED = BEAM_SPEED * .7;

interface Seg { from: [number, number]; to: [number, number]; start: number; length: number; exit: boolean; blocked: boolean; fadeFrom: number }

export function segmentsOf(trace: Trace): Seg[] {
  return trace.segments.map(s => {
    const dx = Math.sign(s.to[0] - s.from[0]), dz = Math.sign(s.to[1] - s.from[1]);
    const length = s.exit ? s.length + EXIT_TAIL : s.length;
    return { from: [s.from[0], s.from[1]], to: [s.from[0] + dx * length, s.from[1] + dz * length], start: s.start, length,
      exit: !!s.exit, blocked: !!s.blocked, fadeFrom: s.exit ? s.start + s.length - .35 : 1e9 };
  });
}

/** Distance along the old beam where the new one first differs, so only the changed part regrows. */
export function divergence(prev: Seg[], next: Seg[]) {
  let best = Infinity;
  const key = (s: Seg) => `${s.from}|${s.start}`;
  const old = new Map(prev.map(s => [key(s), s]));
  for (const s of next) {
    const o = old.get(key(s));
    if (!o) best = Math.min(best, s.start);
    else if (o.to[0] !== s.to[0] || o.to[1] !== s.to[1] || o.exit !== s.exit) best = Math.min(best, s.start + Math.min(o.length, s.length) - .5);
  }
  for (const o of prev) if (!next.some(s => key(s) === key(o))) best = Math.min(best, o.start);
  return Math.max(0, best);
}

function Ribbon({ seg, look, clock, width }: { seg: Seg; look: Look; clock: BeamClock; width: number }) {
  const mat = useMemo(() => beamMaterial(look.beam, look.beamGlow, look.beamStyle, clock.reveal, clock.boost, clock.abyss), [look, clock]);
  // Bright worlds (snow, sand) wash out additive light; a soft normal-blended under-glow keeps the beam readable.
  const under = useMemo(() => {
    const m = beamMaterial(look.beam, look.beam, look.beamStyle, clock.reveal, clock.boost, clock.abyss);
    m.blending = NormalBlending;
    return m;
  }, [look, clock]);
  useEffect(() => {
    for (const m of [mat, under]) {
      const u = m.uniforms;
      u.uA!.value.set(seg.from[0], BEAM_Y, seg.from[1]);
      u.uB!.value.set(seg.to[0], BEAM_Y, seg.to[1]);
      u.uStart!.value = seg.start; u.uLength!.value = seg.length; u.uFadeFrom!.value = seg.fadeFrom;
    }
    mat.uniforms.uWidth!.value = width;
    under.uniforms.uWidth!.value = width * .75;
  }, [seg, mat, under, width]);
  useEffect(() => () => { disposeShader(mat); disposeShader(under); }, [mat, under]);
  return <>
    {look.beamStyle >= 2 && look.beamStyle <= 3 && <mesh geometry={ribbon} material={under} renderOrder={4} frustumCulled={false} />}
    <mesh geometry={ribbon} material={mat} renderOrder={5} frustumCulled={false} />
  </>;
}

const sparkTint = ['#fff1c4', '#c8fbff', '#ffd27a', '#efe4ff', '#ffc4ec'];

function Spark({ point, at, clock, kind, sounds, look }: { point: readonly [number, number]; at: number; clock: BeamClock; kind: string; sounds: boolean; look: Look }) {
  const ref = useRef<Sprite>(null);
  const mat = useMemo(() => new SpriteMaterial({ map: sparkTexture, color: kind === 'blocker' ? look.beam : sparkTint[look.beamStyle], transparent: true,
    depthWrite: false, blending: AdditiveBlending, toneMapped: false }), [kind, look]);
  const born = useRef(-1);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock: c }) => {
    const on = clock.reveal.value >= at && clock.abyss.drain.value <= at;
    if (on && born.current < 0) {
      born.current = c.elapsedTime;
      if (sounds && kind === 'splitter') audio.play('split', .5);
      if (sounds && kind === 'portal') audio.play('portal', .4);
    }
    if (!on) born.current = -1;
    const age = born.current < 0 ? 0 : c.elapsedTime - born.current;
    const base = kind === 'blocker' ? .75 : .65;
    const s = on ? base + Math.sin(c.elapsedTime * (kind === 'blocker' ? 31 : 12)) * .12 + Math.max(0, 1 - age * 3.5) : 0;
    ref.current?.scale.set(s, s, 1);
    mat.rotation = c.elapsedTime * (kind === 'blocker' ? 4 : 1.2);
    if (ref.current) ref.current.position.copy(pulled(clock.abyss, tmp.set(point[0], BEAM_Y, point[1])));
  });
  return <sprite ref={ref} material={mat} position={[point[0], BEAM_Y, point[1]]} renderOrder={7} />;
}

/** Themed motes riding along the beam: sun dust, rain spirits, embers, snow glints or plasma sparks. */
function Riders({ segs, clock, look }: { segs: Seg[]; clock: BeamClock; look: Look }) {
  const ref = useRef<Points>(null);
  const riders = useMemo(() => {
    const out: { seg: Seg; u: number; speed: number; wob: number }[] = [];
    for (const s of segs) {
      const count = Math.max(1, Math.round(s.length * 2.2));
      for (let i = 0; i < count; i++) out.push({ seg: s, u: (i + ((i * 37) % 10) / 10) / count, speed: .9 + ((i * 13) % 7) / 10, wob: i * 1.7 });
    }
    return out.slice(0, 160);
  }, [segs]);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(riders.length * 3), 3));
    g.setAttribute('aSize', new BufferAttribute(new Float32Array(riders.length), 1));
    return g;
  }, [riders]);
  const material = useMemo(() => new ShaderMaterial({
    uniforms: { uMap: { value: glowTexture }, uColor: { value: new Color(sparkTint[look.beamStyle]) }, uScale: { value: 1 } },
    vertexShader: /* glsl */`attribute float aSize; uniform float uScale; varying float vS;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vS = aSize; gl_PointSize = aSize * uScale / max(1., -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform sampler2D uMap; uniform vec3 uColor; varying float vS;
      void main(){ float a = texture2D(uMap, gl_PointCoord).a; if (vS <= 0. || a < .02) discard; gl_FragColor = vec4(uColor, a); }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
  }), [look]);
  useEffect(() => () => { geometry.dispose(); disposeShader(material); }, [geometry, material]);
  useFrame(({ size, viewport }, dt) => {
    const pos = geometry.getAttribute('position') as BufferAttribute, sz = geometry.getAttribute('aSize') as BufferAttribute;
    material.uniforms.uScale!.value = size.height * viewport.dpr * .9;
    const t = time.value, style = look.beamStyle, r = clock.reveal.value;
    riders.forEach((p, i) => {
      p.u = (p.u + dt * p.speed * 2.6 / p.seg.length) % 1;
      const s = p.seg, along = s.start + p.u * s.length;
      const dx = s.to[0] - s.from[0], dz = s.to[1] - s.from[1];
      let x = s.from[0] + dx * p.u, z = s.from[1] + dz * p.u, y = BEAM_Y;
      const side = Math.sin(t * 6 + p.wob) * .09;
      if (style === 1) { x += Math.cos(t * 8 + p.wob) * .1 * Math.abs(Math.sign(dz)); z += Math.cos(t * 8 + p.wob) * .1 * Math.abs(Math.sign(dx)); y += Math.sin(t * 8 + p.wob) * .1; }
      else if (style === 2) y += ((t * .9 + p.wob) % 1) * .35;
      else if (style === 4) { y += (Math.random() - .5) * .14; x += (Math.random() - .5) * .08; }
      else y += side;
      pulled(clock.abyss, tmp.set(x, y, z));
      pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
      const fade = s.exit ? Math.max(0, 1 - (along - s.fadeFrom)) : 1;
      sz.setX(i, along <= r && along >= clock.abyss.drain.value ? (style === 3 ? .16 + (Math.sin(t * 20 + p.wob) > .7 ? .2 : 0) : .22) * fade : 0);
    });
    pos.needsUpdate = true; sz.needsUpdate = true;
  });
  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} renderOrder={8} />;
}

/** Bright tips racing ahead while the beam (re)grows, plus a soft dissolve where it leaves the board. */
function Heads({ segs, clock, look }: { segs: Seg[]; clock: BeamClock; look: Look }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const r = clock.reveal.value;
    ref.current?.children.forEach((child, i) => {
      const s = segs[i];
      if (!s) { child.visible = false; return; }
      const k = (r - s.start) / s.length;
      child.visible = k > 0 && k < 1 && (!s.exit || r < s.fadeFrom);
      if (child.visible) child.position.set(s.from[0] + (s.to[0] - s.from[0]) * k, BEAM_Y, s.from[1] + (s.to[1] - s.from[1]) * k);
    });
  });
  return <group ref={ref}>
    {segs.map((_, i) => <sprite key={i} scale={[.85, .85, 1]} renderOrder={8}>
      <spriteMaterial map={glowTexture} color={look.beamGlow} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </sprite>)}
  </group>;
}

export function Beam({ trace, look, clock, sounds }: { trace: Trace; look: Look; clock: BeamClock; sounds: boolean }) {
  const segs = useMemo(() => segmentsOf(trace), [trace]);
  const prev = useRef<Seg[]>([]);
  const total = useMemo(() => Math.max(0, ...segs.map(s => s.start + s.length)), [segs]);
  useEffect(() => {
    clock.reveal.value = Math.min(clock.reveal.value, divergence(prev.current, segs));
    prev.current = segs;
  }, [segs, clock]);
  const { born } = useContext(BoardClock);
  // The light starts travelling with the board's entrance, after its warm-up frames.
  useFrame((_, dt) => {
    if (born.value < 0) return;
    const r = clock.reveal, limit = clock.limit.value;
    r.value = r.value > limit ? Math.max(limit, r.value - dt * RETRACT_SPEED) : Math.min(total, limit, r.value + dt * BEAM_SPEED);
  });
  const width = .46 + (look.beamStyle === 4 ? .08 : 0);
  return <group>
    {segs.map(s => <Ribbon key={`${s.from}:${s.to}:${s.start}`} seg={s} look={look} clock={clock} width={width} />)}
    {trace.hits.filter(h => h.kind !== 'target').map((h, i) => <Spark key={`${h.kind}:${h.point}:${h.at}:${i}`} point={[h.point[0], h.point[1]]}
      at={h.at} clock={clock} kind={h.kind} sounds={sounds} look={look} />)}
    <Riders segs={segs} clock={clock} look={look} />
    <Heads segs={segs} clock={clock} look={look} />
  </group>;
}

function GhostRibbon({ seg, color }: { seg: Seg; color: string }) {
  const mat = useMemo(() => ghostBeamMaterial(color), [color]);
  useEffect(() => {
    const u = mat.uniforms;
    u.uA!.value.set(seg.from[0], BEAM_Y + .02, seg.from[1]);
    u.uB!.value.set(seg.to[0], BEAM_Y + .02, seg.to[1]);
    u.uStart!.value = seg.start; u.uLength!.value = seg.length;
  }, [seg, mat]);
  useEffect(() => () => disposeShader(mat), [mat]);
  return <mesh geometry={ribbon} material={mat} renderOrder={9} frustumCulled={false} />;
}

/** A pulsing marker where the projected light would end up: a crystal it would wake, or the Devourer it would feed. */
function GhostMark({ point, danger }: { point: readonly [number, number]; danger: boolean }) {
  const ref = useRef<Sprite>(null);
  useFrame(({ clock }) => {
    const k = .7 + Math.abs(Math.sin(clock.elapsedTime * (danger ? 9 : 4))) * .5;
    ref.current?.scale.set(k * (danger ? 1.5 : 1.1), k * (danger ? 1.5 : 1.1), 1);
  });
  return <sprite ref={ref} position={[point[0], BEAM_Y, point[1]]} renderOrder={9}>
    <spriteMaterial map={danger ? sparkTexture : glowTexture} color={danger ? '#ff2a4a' : '#ffffff'} opacity={danger ? .95 : .55} transparent depthWrite={false}
      blending={AdditiveBlending} toneMapped={false} />
  </sprite>;
}

/**
 * The route a held piece would send the light along, drawn as faint marching dashes over the real beam, in red where it
 * would end inside the Devourer. Purely a preview: nothing on the board changes.
 */
export function GhostBeam({ trace, color }: { trace: Trace; color: string }) {
  const segs = useMemo(() => segmentsOf(trace), [trace]);
  const danger = !!trace.absorbed;
  const marks = trace.hits.filter(h => h.kind === 'target' || h.kind === 'devourer');
  return <group>
    {segs.map(s => <GhostRibbon key={`${s.from}:${s.to}:${s.start}`} seg={s} color={danger ? '#ff5a6a' : color} />)}
    {marks.map((h, i) => <GhostMark key={`${h.point}:${i}`} point={h.point} danger={h.kind === 'devourer'} />)}
  </group>;
}
