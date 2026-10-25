import React, { useEffect, useLayoutEffect, useMemo } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Euler, Group, InstancedBufferAttribute, InstancedMesh, Material, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Points, Quaternion, ShaderMaterial, Vector3 } from 'three';
import { createPortal, useFrame, useThree } from '../Canvas';
import { gemGeometry, glowTexture, mapBeamMaterial, mapBobGlsl, mapRiderMaterial, mapWaterMaterial, time } from '../fx';
import { looks } from '../look';
import { DAIS_TOP, DAIS_Z, islandParts, islandsReady, ISLAND_VARIANTS, prepareIslands } from './islands';
import { chapters, LEVELS_PER_CHAPTER } from '../../game/chapters';
import { ISLAND_TILT, islandScale, mapLayout, MapLayout, MapScroll, REVEAL_POP, REVEAL_TRAVEL } from '../../game/mapLayout';
import { Progress, unlockedLevel } from '../../game/progress';
import { isOpen } from '../../game/testing';

/** Distance of the map plane in front of the camera. Close enough that no world's fog reaches it. */
const D = 10;
/** The laser path floats this far in front of the islands so no rock or rim hides it; it is scaled to project identically. */
const BEAM_LIFT = .8;
const LAST = chapters.length * LEVELS_PER_CHAPTER;
/** Size of a level crystal, in island design units per gem unit. */
const GEM_S = .25;
/** The crystal hovers above its dais, clear of the level medallion in front of it. */
const GEM_LOCAL = new Vector3(0, DAIS_TOP + .62 * GEM_S + .2, DAIS_Z);
/** Self-light per world so islands stay readable in dark worlds (the stormy jungle, the Void) without relighting the world. */
const LIFT = [.04, .3, .06, .05, .26];
const sparkTint = ['#fff1c4', '#c8fbff', '#ffd27a', '#efe4ff', '#ffc4ec'];

/** `open`: playable but not yet played (test builds, where every level is open). */
type State = 'locked' | 'open' | 'current' | 'done' | 'perfect';
const stateOf = (progress: Progress, next: number, id: number): State =>
  id === next ? 'current' : progress[id] ? (progress[id]!.stars >= 3 ? 'perfect' : 'done') : isOpen(id, next) ? 'open' : 'locked';
/** Island tint: unexplored islands sink into night-blue shadow. */
const LOCKED_TINT = new Color(.46, .5, .66);
const LIT_TINT = new Color(1, 1, 1);

/** Adds the GPU island bob (and an optional spin about the island's up axis) to a built-in material. */
function floating<T extends Material>(material: T, key: string, bob: string, spin = '', lift = 0) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = time;
    shader.uniforms.uLift = { value: lift };
    const spinFn = spin ? /* glsl */`vec2 mapSpin(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
      float mapIslandPhase(){
        #ifdef USE_INSTANCING
          return instanceMatrix[3].x * 2.3 + instanceMatrix[3].y * 1.7;
        #else
          return 0.;
        #endif
      }\n` : '';
    shader.vertexShader = `uniform float uTime;\n${spin ? 'attribute float aGlow; varying float vGlow;\n' : ''}${spinFn}` + shader.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        ${spin ? `float mapAngle = (${spin}) * step(.01, aGlow); objectNormal.xz = mapSpin(objectNormal.xz, mapAngle);` : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${spin ? 'transformed.xz = mapSpin(transformed.xz, mapAngle); vGlow = aGlow;' : ''}
        ${bob}`);
    // Lit crystals glow with their own colour (dormant ones stay dark glass); terrain gets its world's lift.
    shader.fragmentShader = `uniform float uLift;\n${spin ? 'varying float vGlow;\n' : ''}` + shader.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * (uLift${spin ? ' + vGlow' : ''});`);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

const solidMaterials = looks.map((_, c) => floating(new MeshStandardMaterial({ vertexColors: true, roughness: c === 3 ? .45 : .88, metalness: c === 4 ? .3 : 0,
  envMapIntensity: c === 3 ? 1.3 : .9 }), 'map-solid', mapBobGlsl(), '', LIFT[c]));
const glowMaterial = floating(new MeshBasicMaterial({ vertexColors: true, toneMapped: false }), 'map-glow', mapBobGlsl());
const gemMaterial = floating(new MeshStandardMaterial({ roughness: .12, metalness: .15, flatShading: true, envMapIntensity: 1.6 }),
  'map-gem', mapBobGlsl(.32), 'uTime * 1.15 + mapIslandPhase()');

function haloMaterial() {
  return new ShaderMaterial({
    uniforms: { uTime: time, uMap: { value: glowTexture }, uScale: { value: 1 } },
    vertexShader: /* glsl */`attribute vec3 aColor; attribute float aSize, aPulse; uniform float uTime, uScale; varying vec3 vColor;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vColor = aColor;
        float pulse = 1. + aPulse * (.18 + .18 * sin(uTime * 3.2 + position.y * 9.));
        gl_PointSize = aSize * pulse * uScale / max(.001, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform sampler2D uMap; varying vec3 vColor;
      void main(){ float a = texture2D(uMap, gl_PointCoord).a; if (a < .01) discard; gl_FragColor = vec4(vColor, a); }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
  });
}

interface ChapterMap {
  chapter: number;
  /** Islands, crystals and halos: at the map plane. */
  islands: Group;
  /** Laser path and its motes: lifted towards the camera. */
  beams: Group;
  reveal: { value: number };
  /** Distance along the laser path at each level of the chapter. */
  along: number[];
  /** Per level: the island meshes and instance index it occupies, for unlock tints. */
  slots: { meshes: InstancedMesh[]; index: number }[];
  gems: InstancedMesh;
  gemMatrices: Matrix4[];
  halos: Points;
  haloMaterial: ShaderMaterial;
  riderMaterial: ShaderMaterial;
  dispose(): void;
}

const tmpQ = new Quaternion(), tmpP = new Vector3(), tmpS = new Vector3(), tmpE = new Euler(), tmpM = new Matrix4(), tmpV = new Vector3();

/** Builds one chapter's islands, crystals and laser path in map-plane coordinates (x right, y up, 1 unit = 1/k points). */
function buildChapter(c: number, layout: MapLayout, k: number, progress: Progress, next: number): ChapterMap {
  const look = looks[c]!;
  const first = c * LEVELS_PER_CHAPTER + 1;
  const islands = new Group(), beams = new Group();
  const disposables: { dispose(): void }[] = [];
  // Which design each level uses, and its island transform.
  const matrices: Matrix4[] = [];
  const designs: (number | 'boss')[] = [];
  for (let i = 0; i < LEVELS_PER_CHAPTER; i++) {
    const id = first + i, n = layout.node(id), w = layout.islandWidth(id);
    const s = islandScale(w) * k;
    const yaw = (((i * 0.618034 + c * .37) % 1) - .5) * .9;
    tmpQ.setFromEuler(tmpE.set(ISLAND_TILT, yaw, 0, 'XYZ'));
    matrices.push(new Matrix4().compose(tmpP.set((n.x - layout.width / 2) * k, -n.y * k, 0), tmpQ, tmpS.set(s, s, s)));
    designs.push(i === LEVELS_PER_CHAPTER - 1 ? 'boss' : (i * 2 + c) % ISLAND_VARIANTS);
  }
  const states = Array.from({ length: LEVELS_PER_CHAPTER }, (_, i) => stateOf(progress, next, first + i));
  const slots: ChapterMap['slots'] = Array.from({ length: LEVELS_PER_CHAPTER }, () => ({ meshes: [], index: 0 }));

  // Islands: one instanced mesh per design and layer.
  const groups = new Map<number | 'boss', number[]>();
  designs.forEach((d, i) => groups.set(d, [...(groups.get(d) ?? []), i]));
  for (const [design, members] of groups) {
    const parts = islandParts(c, design, design === 'boss' && first + LEVELS_PER_CHAPTER - 1 === LAST);
    const layers: [BufferGeometry | undefined, Material][] = [[parts.solid, solidMaterials[c]!], [parts.glow, glowMaterial], [parts.water, mapWaterMaterial]];
    for (const [geometry, material] of layers) {
      if (!geometry) continue;
      const mesh = new InstancedMesh(geometry, material, members.length);
      members.forEach((i, j) => {
        mesh.setMatrixAt(j, matrices[i]!);
        mesh.setColorAt(j, states[i] === 'locked' ? LOCKED_TINT : LIT_TINT);
        slots[i]!.meshes.push(mesh); slots[i]!.index = j;
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      if (material === mapWaterMaterial) mesh.renderOrder = 2;
      islands.add(mesh);
      disposables.push(mesh);
    }
  }

  // Level crystals: dormant dark glass until cleared, then lit in the world's crystal colour (brighter for a perfect clear).
  const gems = new InstancedMesh(gemGeometry, gemMaterial, LEVELS_PER_CHAPTER);
  const glow = new Float32Array(LEVELS_PER_CHAPTER);
  const crystal = new Color(look.crystal), white = new Color('#ffffff'), dormant = new Color('#4e5672'), col = new Color();
  const gemMatrices: Matrix4[] = [];
  const halo = { pos: [] as number[], color: [] as number[], size: [] as number[], pulse: [] as number[] };
  const gemScale = new Matrix4().makeScale(GEM_S, GEM_S, GEM_S);
  for (let i = 0; i < LEVELS_PER_CHAPTER; i++) {
    const st = states[i]!;
    const m = new Matrix4().copy(matrices[i]!).multiply(tmpM.makeTranslation(GEM_LOCAL.x, GEM_LOCAL.y, GEM_LOCAL.z)).multiply(gemScale);
    gemMatrices.push(m);
    gems.setMatrixAt(i, m);
    glow[i] = st === 'perfect' ? 1.25 : st === 'done' ? .85 : st === 'current' ? .22 : 0;
    gems.setColorAt(i, st === 'locked' || st === 'open' ? dormant : st === 'current' ? col.copy(crystal).lerp(white, .35) : st === 'perfect' ? col.copy(crystal).lerp(white, .25) : crystal);
    if (st !== 'locked' && st !== 'open') {
      tmpV.copy(GEM_LOCAL).applyMatrix4(matrices[i]!);
      const s = islandScale(layout.islandWidth(first + i)) * k;
      halo.pos.push(tmpV.x, tmpV.y, tmpV.z);
      const hc = new Color(st === 'perfect' ? '#ffe2a0' : st === 'current' ? '#fff4d6' : look.crystalGlow);
      halo.color.push(hc.r, hc.g, hc.b);
      halo.size.push(s * (st === 'perfect' ? 1.5 : st === 'current' ? 1.1 : 1));
      halo.pulse.push(st === 'current' ? 1 : 0);
    }
  }
  gems.geometry = gemGeometry.clone();
  gems.geometry.setAttribute('aGlow', new InstancedBufferAttribute(glow, 1));
  gems.instanceMatrix.needsUpdate = true;
  if (gems.instanceColor) gems.instanceColor.needsUpdate = true;
  gems.computeBoundingSphere();
  islands.add(gems);
  disposables.push(gems, gems.geometry);

  const haloGeo = new BufferGeometry();
  haloGeo.setAttribute('position', new BufferAttribute(new Float32Array(halo.pos), 3));
  haloGeo.setAttribute('aColor', new BufferAttribute(new Float32Array(halo.color), 3));
  haloGeo.setAttribute('aSize', new BufferAttribute(new Float32Array(halo.size), 1));
  haloGeo.setAttribute('aPulse', new BufferAttribute(new Float32Array(halo.pulse), 1));
  const haloMat = haloMaterial();
  const halos = new Points(haloGeo, haloMat);
  halos.frustumCulled = false;
  halos.renderOrder = 6;
  islands.add(halos);
  disposables.push(haloGeo, haloMat);

  // The laser path: one ribbon per hop, merged into a single mesh, with the gameplay beam's shading.
  const anchors = matrices.map(m => new Vector3(0, .07, 0).applyMatrix4(m));
  const unit = islandScale(186) * k * .8;
  const along = [0];
  for (let i = 1; i < anchors.length; i++) along.push(along[i - 1]! + anchors[i]!.distanceTo(anchors[i - 1]!) / unit);
  const rows = 9, segs = anchors.length - 1;
  const pos = new Float32Array(segs * rows * 2 * 3), aA = new Float32Array(segs * rows * 2 * 3), aB = new Float32Array(segs * rows * 2 * 3);
  const aStart = new Float32Array(segs * rows * 2), aLength = new Float32Array(segs * rows * 2), index: number[] = [];
  for (let s = 0; s < segs; s++) {
    const A = anchors[s]!, B = anchors[s + 1]!;
    for (let r = 0; r < rows; r++) for (let x = 0; x < 2; x++) {
      const v = (s * rows + r) * 2 + x;
      pos.set([x - .5, r / (rows - 1) - .5, 0], v * 3);
      aA.set([A.x, A.y, A.z], v * 3); aB.set([B.x, B.y, B.z], v * 3);
      aStart[v] = along[s]!; aLength[v] = along[s + 1]! - along[s]!;
    }
    for (let r = 0; r < rows - 1; r++) {
      const a = (s * rows + r) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const beamGeo = new BufferGeometry();
  beamGeo.setAttribute('position', new BufferAttribute(pos, 3));
  beamGeo.setAttribute('aA', new BufferAttribute(aA, 3));
  beamGeo.setAttribute('aB', new BufferAttribute(aB, 3));
  beamGeo.setAttribute('aStart', new BufferAttribute(aStart, 1));
  beamGeo.setAttribute('aLength', new BufferAttribute(aLength, 1));
  beamGeo.setIndex(index);
  const nextIndex = next - first;
  const reveal = { value: nextIndex <= 0 ? 0 : nextIndex >= LEVELS_PER_CHAPTER ? along[along.length - 1]! + 1 : along[nextIndex]! };
  const width = 24 * k;
  const beamMats = [mapBeamMaterial(look.beam, look.beamGlow, look.beamStyle, reveal, width)];
  // Bright worlds (sand, snow) wash out additive light; the gameplay beam adds the same soft under-glow.
  if (look.beamStyle >= 2 && look.beamStyle <= 3) beamMats.unshift(mapBeamMaterial(look.beam, look.beam, look.beamStyle, reveal, width * .75, true));
  beamMats.forEach((m, j) => {
    const mesh = new Mesh(beamGeo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4 + j;
    beams.add(mesh);
    disposables.push(m);
  });
  disposables.push(beamGeo);

  // Motes of light flowing along the lit path.
  const motesPerHop = 3, count = segs * motesPerHop;
  const rp = new Float32Array(count * 3), rb = new Float32Array(count * 3), rs = new Float32Array(count), rl = new Float32Array(count), rph = new Float32Array(count);
  for (let s = 0; s < segs; s++) for (let j = 0; j < motesPerHop; j++) {
    const v = s * motesPerHop + j, A = anchors[s]!, B = anchors[s + 1]!;
    rp.set([A.x, A.y, A.z], v * 3); rb.set([B.x, B.y, B.z], v * 3);
    rs[v] = along[s]!; rl[v] = along[s + 1]! - along[s]!; rph[v] = (j / motesPerHop + s * .137) % 1;
  }
  const riderGeo = new BufferGeometry();
  riderGeo.setAttribute('position', new BufferAttribute(rp, 3));
  riderGeo.setAttribute('aB', new BufferAttribute(rb, 3));
  riderGeo.setAttribute('aStart', new BufferAttribute(rs, 1));
  riderGeo.setAttribute('aLength', new BufferAttribute(rl, 1));
  riderGeo.setAttribute('aPhase', new BufferAttribute(rph, 1));
  const riderMat = mapRiderMaterial(sparkTint[look.beamStyle]!, reveal, 18 * k);
  const riders = new Points(riderGeo, riderMat);
  riders.frustumCulled = false;
  riders.renderOrder = 7;
  beams.add(riders);
  disposables.push(riderGeo, riderMat);

  return {
    chapter: c, islands, beams, reveal, along, slots, gems, gemMatrices, halos, haloMaterial: haloMat, riderMaterial: riderMat,
    dispose: () => disposables.forEach(d => d.dispose()),
  };
}

const easeInOut = (t: number) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const pop = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2));

/**
 * Builds the journey map's islands in the background while the player is elsewhere (home, results), a few milliseconds
 * per frame, starting with the chapter they are in, so the map opens with its islands already in place.
 */
export function IslandPrewarm({ chapter }: { chapter: number }) {
  const order = useMemo(() => [chapter, chapter + 1].filter(c => c < chapters.length), [chapter]);
  const done = useMemo(() => ({ value: false }), [order]);
  useFrame(() => { if (!done.value) done.value = prepareIslands(order, 3); });
  return null;
}

/**
 * The journey map's living worlds: every level as a miniature floating island of its chapter, joined by the chapter's own
 * laser light. It hangs in front of the camera and moves exactly with the map's scroll offset, so the screen's level
 * medallions (drawn by the map screen at the same offset) always sit on their islands.
 */
export function MapLayer({ scroll, progress }: { scroll: MapScroll; progress: Progress }) {
  const { camera, scene, size, viewport } = useThree();
  const cam = camera as PerspectiveCamera;
  const next = unlockedLevel(progress, LAST + 1);
  const W = size.width, H = size.height;
  const k = H > 0 ? (2 * D * Math.tan((cam.fov * Math.PI) / 360)) / H : 0;
  const layout = useMemo(() => mapLayout(W, H), [W, H]);
  const track = useMemo(() => new Group(), []);
  const lifted = useMemo(() => new Group(), []);
  // Chapters are built on demand, at most one per frame (the one in view first), so opening the map never stalls.
  const built = useMemo<(ChapterMap | undefined)[]>(() => chapters.map(() => undefined), [layout, k, progress, next]);
  useEffect(() => () => {
    built.forEach(b => { if (!b) return; track.remove(b.islands); lifted.remove(b.beams); b.dispose(); });
  }, [built, track, lifted]);
  const pixels = (H * viewport.dpr) / (2 * Math.tan((cam.fov * Math.PI) / 360));
  const ensure = (c: number) => {
    if (built[c] || !k) return;
    const b = buildChapter(c, layout, k, progress, next);
    b.haloMaterial.uniforms.uScale!.value = pixels;
    b.riderMaterial.uniforms.uScale!.value = pixels;
    built[c] = b;
    track.add(b.islands);
    lifted.add(b.beams);
  };
  // The map hangs off the camera, which must be in the scene graph for its children to render. A layout effect, so it is
  // there before the first map frame (a passive effect ran a frame late, and that first frame drew no islands).
  useLayoutEffect(() => {
    if (camera.parent) return;
    scene.add(camera);
    return () => { scene.remove(camera); };
  }, [scene, camera]);
  useEffect(() => {
    built.forEach(b => { if (b) { b.haloMaterial.uniforms.uScale!.value = pixels; b.riderMaterial.uniforms.uScale!.value = pixels; } });
  }, [built, pixels]);

  useFrame(() => {
    if (!k) return;
    const y = scroll.y;
    // Undo the camera's view offset (left over from other screens while it eases to zero) so islands stay on their marks.
    const off = cam.view?.enabled ? cam.view.offsetY : 0;
    track.position.set(0, (H / 2 + y - off) * k, -D);
    const f = (D - BEAM_LIFT) / D;
    lifted.position.set(0, (H / 2 + y - off) * k * f, -(D - BEAM_LIFT));
    lifted.scale.setScalar(f);
    // Only the chapters within reach of the screen are drawn (and built: the one in view now, the others one per frame).
    let builtThisFrame = false;
    for (let c = 0; c < chapters.length; c++) {
      const sec = layout.sections[c]!;
      const visible = sec.levelsTop - H < y + H * 1.2 && sec.levelsTop + sec.levelsH + H * .5 > y - H * .2;
      if (visible && !built[c]) { ensure(c); builtThisFrame = true; }
      const b = built[c];
      if (b) b.islands.visible = b.beams.visible = visible;
    }
    // Off-screen chapters are prepared in the background, nearest first: island designs a few ms per frame, then the map.
    if (!builtThisFrame) {
      const here = layout.chapterAt(y);
      const waiting = chapters.map((_, c) => c).filter(c => !built[c]).sort((a, b) => Math.abs(a - here) - Math.abs(b - here));
      const c = waiting[0];
      if (c !== undefined) { if (islandsReady(c)) ensure(c); else prepareIslands([c], 5); }
    }
    animateReveal();
    scroll.onShown?.(y);
  });

  /** A just-earned unlock: the cleared crystals pop alight, then the light races on to the newly reached island. */
  function animateReveal() {
    const r = scroll.reveal;
    if (!r) return;
    // Before the animation starts (t < 0) the map shows the state from before the unlock.
    const t = Math.max(0, (performance.now() - r.at) / 1000);
    const done = t > REVEAL_POP + REVEAL_TRAVEL + .6;
    for (const b of built) {
      if (!b) continue;
      const first = b.chapter * LEVELS_PER_CHAPTER + 1;
      const fromI = r.from - first, toI = r.to - first;
      if (toI < 0 || fromI > LEVELS_PER_CHAPTER) continue;
      const end = b.along.length - 1;
      const at = (i: number) => (i <= 0 ? 0 : i > end ? b.along[end]! + 1 : b.along[i]!);
      const travel = Math.min(1, Math.max(0, (t - REVEAL_POP) / REVEAL_TRAVEL));
      b.reveal.value = done ? at(toI) : at(fromI) + (at(toI) - at(fromI)) * easeInOut(travel);
      // Crystals of the newly cleared levels grow back in with a pop.
      for (let i = Math.max(0, fromI); i < Math.min(LEVELS_PER_CHAPTER, toI); i++) {
        const s = done ? 1 : Math.max(.001, pop(t / REVEAL_POP));
        b.gems.setMatrixAt(i, tmpM.copy(b.gemMatrices[i]!).multiply(new Matrix4().makeScale(s, s, s)));
      }
      b.gems.instanceMatrix.needsUpdate = true;
      // The newly reached island brightens out of the night as the light arrives.
      if (toI >= 0 && toI < LEVELS_PER_CHAPTER) {
        const slot = b.slots[toI]!;
        const lit = done ? 1 : Math.min(1, Math.max(0, (travel - .7) / .3));
        const tint = new Color().copy(LOCKED_TINT).lerp(LIT_TINT, lit);
        slot.meshes.forEach(m => { m.setColorAt(slot.index, tint); if (m.instanceColor) m.instanceColor.needsUpdate = true; });
      }
    }
    if (done) scroll.reveal = undefined;
  }

  return <>{createPortal(<><primitive object={track} /><primitive object={lifted} /></>, camera)}</>;
}
