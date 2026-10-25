import { BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DodecahedronGeometry, Euler, IcosahedronGeometry, Matrix4,
  OctahedronGeometry, PlaneGeometry, Quaternion, SphereGeometry, TorusGeometry, Vector3, BoxGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural miniature floating islands for the journey map, one family per chapter. Every island is built from simple
 * low-poly parts merged into a single geometry with baked shading (vertex colours: darker towards each part's base,
 * slight per-facet variation), so a whole chapter of islands draws in a handful of instanced draw calls.
 *
 * Design units: the island's walkable top is a disc of radius ~1 at y = 0, its rock hangs down to y ~ -1.7, and its
 * crystal dais sits at the centre. +z faces the viewer; landmarks stand on the back half so they rise behind the level
 * medallion instead of hiding it.
 */
export interface IslandParts {
  /** Lit, opaque terrain and props (MeshStandardMaterial, vertex colours). */
  solid: BufferGeometry;
  /** Self-lit accents: gold caps, runes, glowing crystals (MeshBasicMaterial, vertex colours). */
  glow?: BufferGeometry;
  /** Waterfall sheets (UV mapped, animated water). */
  water?: BufferGeometry;
}

/** Height of the top of the crystal dais, where the level crystal stands. */
export const DAIS_TOP = .12;
/** The dais stands behind the island's centre, so the level medallion (at the centre) never covers the crystal. */
export const DAIS_Z = -.3;
/** Landmark angles on the back half that keep clear of the dais: left-back and right-back. */
const SIDES = [Math.PI * 1.18, Math.PI * 1.82, Math.PI * 1.24];

type V3 = [number, number, number];
interface Part { p?: V3; r?: V3; s?: V3 | number; color: string; shade?: number; jitter?: number; noise?: number }

const tmpM = new Matrix4(), tmpQ = new Quaternion(), tmpS = new Vector3(), tmpP = new Vector3(), tmpE = new Euler();
const hash = (a: number, b: number, c: number) => { const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453; return s - Math.floor(s); };
const rng = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/**
 * Collects an island's parts. Each part's per-vertex work (noise, shading, transform, normals) is queued rather than
 * done on the spot, so a design can be built a few parts at a time across frames (see prepareIslands): on a phone's
 * JavaScript engine one design takes far longer than a frame.
 */
class Builder {
  solid: BufferGeometry[] = []; glow: BufferGeometry[] = []; water: BufferGeometry[] = [];
  private ops: (() => void)[] = [];
  private done = 0;
  constructor(readonly r: () => number) {}

  /** Runs queued parts until `until` (a performance.now() time); true once every part is ready. */
  run(until: number) {
    while (this.done < this.ops.length) {
      this.ops[this.done++]!();
      if (performance.now() >= until) break;
    }
    return this.done >= this.ops.length;
  }

  private prepare(source: BufferGeometry, part: Part, keepUv = false) {
    const g = source.index ? source.toNonIndexed() : source.clone();
    source.dispose();
    if (!keepUv) g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    const pos = g.getAttribute('position') as BufferAttribute;
    // Organic surfaces: displace each vertex by a hash of its position, so shared corners move together (no cracks).
    if (part.noise) for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = (hash(Math.round(x * 97), Math.round(y * 97), Math.round(z * 97)) - .5) * 2 * part.noise;
      pos.setXYZ(i, x * (1 + n), y * (1 + n * .5), z * (1 + n));
    }
    if (!keepUv) {
      g.computeBoundingBox();
      const box = g.boundingBox!, span = box.max.y - box.min.y || 1;
      const base = new Color(part.color), col = new Color();
      const colors = new Float32Array(pos.count * 3);
      const low = part.shade ?? .62, jitter = part.jitter ?? .08;
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) - box.min.y) / span;
        // One jitter per triangle gives each facet a slightly different tone.
        const k = (low + (1 - low) * Math.pow(t, .9)) * (1 + (hash(Math.floor(i / 3), part.color.length, 1) - .5) * jitter);
        col.copy(base).multiplyScalar(k);
        colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
      }
      g.setAttribute('color', new BufferAttribute(colors, 3));
    }
    const s = part.s ?? 1;
    tmpS.set(...(typeof s === 'number' ? [s, s, s] as V3 : s));
    tmpQ.setFromEuler(tmpE.set(...(part.r ?? [0, 0, 0])));
    tmpP.set(...(part.p ?? [0, 0, 0]));
    g.applyMatrix4(tmpM.compose(tmpP, tmpQ, tmpS));
    if (!keepUv) g.computeVertexNormals();
    return g;
  }
  add(geometry: BufferGeometry, part: Part) { this.ops.push(() => { this.solid.push(this.prepare(geometry, part)); }); }
  addGlow(geometry: BufferGeometry, part: Part) { this.ops.push(() => { this.glow.push(this.prepare(geometry, { shade: .85, jitter: 0, ...part })); }); }
  /** A waterfall pouring over the rim at angle `a`, `length` long. */
  addWaterfall(a: number, length: number, width = .26, radius = .98) {
    const g = new PlaneGeometry(width, length, 1, 4);
    const part: Part = { color: '#fff', p: [Math.cos(a) * radius, -length / 2 - .02, Math.sin(a) * radius], r: [0, Math.PI / 2 - a, 0] };
    this.ops.push(() => { this.water.push(this.prepare(g, part, true)); });
  }
  /** A point on the top, `a` radians round and `d` from the centre (back half: sin(a) < 0). */
  at(a: number, d: number, y = 0): V3 { return [Math.cos(a) * d, y, Math.sin(a) * d]; }
  build(): IslandParts {
    const merge = (list: BufferGeometry[]) => {
      if (!list.length) return undefined;
      const m = mergeGeometries(list, false);
      list.forEach(g => g.dispose());
      if (!m) return undefined;
      m.computeBoundingSphere();
      return m;
    };
    const solid = merge(this.solid);
    if (!solid) throw new Error('island has no solid parts');
    return { solid, glow: merge(this.glow), water: merge(this.water) };
  }
}

// Shared primitives, cloned per part.
const cyl = (top: number, bottom: number, h: number, seg = 12) => new CylinderGeometry(top, bottom, h, seg, 1);
const cone = (r: number, h: number, seg = 7, rows = 1) => new ConeGeometry(r, h, seg, rows);
const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
const blob = (r: number, detail = 0) => new IcosahedronGeometry(r, detail);
const rock = (r: number) => new DodecahedronGeometry(r, 0);
const ball = (r: number, w = 8, h = 6) => new SphereGeometry(r, w, h);
const spike = (r: number) => new OctahedronGeometry(r, 0);

interface Palette { top: string; rim: string; soil: string; rock: string; rockDark: string; stone: string }
const palettes: Palette[] = [
  { top: '#86c25c', rim: '#62a24a', soil: '#9a7a5c', rock: '#a38b7e', rockDark: '#5e4c46', stone: '#efe2c8' },
  { top: '#5f9a46', rim: '#457e38', soil: '#5c4936', rock: '#5a4c3e', rockDark: '#241b14', stone: '#7d8a72' },
  { top: '#ecca90', rim: '#d9ac6c', soil: '#c99a60', rock: '#c49260', rockDark: '#7e5631', stone: '#dcb67c' },
  { top: '#f2f9ff', rim: '#d2e8f8', soil: '#aed4ee', rock: '#9fc8e6', rockDark: '#3d6890', stone: '#e4f2fc' },
  { top: '#535a78', rim: '#3c4260', soil: '#2c3048', rock: '#3c3350', rockDark: '#110d1b', stone: '#6a7290' },
];

/** The floating landmass every island shares: top, rim, soil band, rock underside and hanging stones. */
function base(b: Builder, p: Palette, chapter: number, scale: number) {
  const r = b.r;
  b.add(cyl(1, .97, .16, 16), { p: [0, -.08, 0], color: p.top, noise: .05, shade: .8 });
  b.add(cyl(1.03, .92, .22, 16), { p: [0, -.25, 0], color: p.rim, noise: .07, shade: .55 });
  if (chapter === 2) {
    // Desert: a stepped sandstone mesa instead of a rocky spike.
    [[.9, .78, .32], [.74, .6, .3], [.56, .4, .3]].forEach(([top, bottom, h], k) =>
      b.add(cyl(top!, bottom!, h!, 10), { p: [0, -.5 - k * .3, 0], color: k % 2 ? p.rock : p.soil, noise: .06, shade: .6 }));
    b.add(cone(.36, .7, 8, 2), { p: [0, -1.55, 0], r: [Math.PI, 0, 0], color: p.rockDark, noise: .1, shade: .4 });
  } else if (chapter === 4) {
    // Void: a cratered asteroid.
    b.add(blob(.95, 1), { p: [0, -.75, 0], s: [1, .9 * scale, 1], color: p.rock, noise: .16, shade: .35, jitter: .18 });
  } else {
    b.add(cone(.94, 1.5 * scale, 11, 4), { p: [0, -1.06, 0], r: [Math.PI, 0, 0], color: p.rock, noise: .15, shade: .35, jitter: .14 });
    b.add(cyl(.98, .9, .2, 14), { p: [0, -.42, 0], color: p.soil, noise: .08, shade: .5 });
  }
  // Loose stones hanging under the island.
  for (let k = 0; k < 4; k++) {
    const a = r() * Math.PI * 2, d = .55 + r() * .4;
    b.add(rock(.12 + r() * .14), { p: [Math.cos(a) * d, -.75 - r() * .6, Math.sin(a) * d], r: [r() * 3, r() * 3, r() * 3], color: p.rockDark, shade: .5, jitter: .2 });
  }
  // The crystal's dais.
  b.add(cyl(.2, .24, .1, 10), { p: [0, DAIS_TOP - .05, DAIS_Z], color: p.stone, shade: .7 });
  b.add(cyl(.25, .27, .04, 10), { p: [0, .02, DAIS_Z], color: p.rim, shade: .8 });
}

function tree(b: Builder, at: V3, h: number, color: string) {
  b.add(cyl(.025, .035, h * .35, 5), { p: [at[0], h * .17, at[2]], color: '#6a4a32' });
  b.add(cone(h * .3, h * .75, 6), { p: [at[0], h * .62, at[2]], color, shade: .65 });
}

function sky(b: Builder, variant: number, boss: boolean) {
  const p = palettes[0]!, r = b.r;
  base(b, p, 0, boss ? 1.15 : 1);
  const templeA = SIDES[variant]!;
  const tp = b.at(templeA, boss ? .6 : .66);
  // A little temple: steps, columns, roof and pediment (or a gilded dome).
  const tw = boss ? .62 : .44;
  b.add(box(tw, .07, tw * .72), { p: [tp[0], .035, tp[2]], r: [0, -templeA, 0], color: p.stone });
  for (let k = 0; k < 4; k++) {
    const cx = (k % 2 ? 1 : -1) * tw * .38, cz = (k < 2 ? 1 : -1) * tw * .24;
    const c = Math.cos(-templeA), s = Math.sin(-templeA);
    b.add(cyl(.03, .034, tw * .62, 6), { p: [tp[0] + cx * c + cz * s, .07 + tw * .31, tp[2] - cx * s + cz * c], color: '#fbf3e4' });
  }
  b.add(box(tw * 1.04, .05, tw * .76), { p: [tp[0], .07 + tw * .64, tp[2]], r: [0, -templeA, 0], color: p.stone });
  if (boss || variant === 1) b.addGlow(new SphereGeometry(tw * .34, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), { p: [tp[0], .1 + tw * .64, tp[2]], color: '#f3be55' });
  else b.add(cone(tw * .62, tw * .26, 4), { p: [tp[0], .1 + tw * .74, tp[2]], r: [0, Math.PI / 4 - templeA, 0], s: [1, 1, .72], color: p.stone });
  if (boss) {
    const t2 = b.at(SIDES[(variant + 1) % 2]!, .62);
    b.add(cyl(.12, .15, .7, 8), { p: [t2[0], .35, t2[2]], color: p.stone });
    b.addGlow(cone(.15, .22, 8), { p: [t2[0], .81, t2[2]], color: '#f3be55' });
  }
  for (let k = 0; k < 3 + variant; k++) tree(b, b.at(Math.PI * (1.05 + r() * .9), .62 + r() * .3), .3 + r() * .2, k % 2 ? '#3f8a3a' : '#2f7a36');
  for (let k = 0; k < 5; k++) b.add(blob(.07 + r() * .05), { p: b.at(r() * Math.PI * 2, .8 + r() * .15, .03), color: '#5aa64a', shade: .7 });
  // Clouds hugging the base.
  for (let k = 0; k < 5; k++) {
    const a = r() * Math.PI * 2;
    b.add(ball(.18 + r() * .14, 7, 5), { p: [Math.cos(a) * 1.02, -.35 - r() * .25, Math.sin(a) * 1.02], s: [1.6, .7, 1.2], color: '#ffffff', shade: .82, jitter: .03 });
  }
  b.addWaterfall(.35 + variant * .4, 1.3);
}

function rainforest(b: Builder, variant: number, boss: boolean) {
  const p = palettes[1]!, r = b.r;
  base(b, p, 1, boss ? 1.15 : 1);
  // An overgrown ruin: two pillars and a cracked lintel, capped with moss.
  const ra = SIDES[variant]!, rp = b.at(ra, .64);
  const c = Math.cos(-ra), s = Math.sin(-ra);
  for (const side of [-1, 1]) {
    const h = .42 + (side > 0 ? 0 : .08) + (boss ? .2 : 0);
    b.add(box(.09, h, .09), { p: [rp[0] + side * .17 * c, h / 2, rp[2] - side * .17 * s], r: [0, -ra, 0], color: p.stone, shade: .55 });
  }
  b.add(box(.46, .07, .11), { p: [rp[0], .5 + (boss ? .2 : 0), rp[2]], r: [.06, -ra, .08], color: p.stone });
  b.add(blob(.12), { p: [rp[0], .56 + (boss ? .2 : 0), rp[2]], s: [1.8, .4, .9], color: '#3f7a36' });
  // Jungle trees: thick trunks and layered canopy.
  for (let k = 0; k < (boss ? 3 : 2); k++) {
    const t = b.at(Math.PI * (1.05 + k * .45 + r() * .2), .55 + r() * .3), h = .55 + r() * .3 + (boss && k === 1 ? .35 : 0);
    b.add(cyl(.035, .06, h, 6), { p: [t[0], h / 2, t[2]], color: '#4a3a2c', shade: .6 });
    for (let j = 0; j < 3; j++) b.add(blob(.16 + r() * .1), { p: [t[0] + (r() - .5) * .22, h + (r() - .3) * .12, t[2] + (r() - .5) * .22], s: [1.2, .75, 1.2], color: j % 2 ? '#2f6a34' : '#3f8a3e', shade: .6, noise: .1 });
  }
  for (let k = 0; k < 6; k++) {
    const f = b.at(r() * Math.PI * 2, .72 + r() * .2);
    b.add(cone(.08, .26, 4), { p: [f[0], .1, f[2]], r: [(r() - .5) * .8, r() * 3, (r() - .5) * .8], s: [1, 1, .35], color: '#3a8a3c', shade: .7 });
  }
  // Vines hanging over the rim, and glowing jungle fungus.
  for (let k = 0; k < 5; k++) {
    const a = r() * Math.PI * 2, l = .35 + r() * .55;
    b.add(cyl(.012, .012, l, 4), { p: [Math.cos(a) * .98, -.3 - l / 2, Math.sin(a) * .98], color: '#3d8a36', shade: .8, jitter: 0 });
  }
  for (let k = 0; k < 3; k++) b.addGlow(ball(.035, 6, 4), { p: b.at(Math.PI * (.1 + r() * 1.8), .8, .03), s: [1, .6, 1], color: '#ff8a4a' });
  b.addWaterfall(.5 + variant * .35, 1.5, .24);
}

function desert(b: Builder, variant: number, boss: boolean) {
  const p = palettes[2]!, r = b.r;
  base(b, p, 2, 1);
  // Sandstone pyramid with a golden capstone.
  const pa = boss ? Math.PI * 1.5 : SIDES[variant]!, pp = b.at(pa, boss ? .72 : .62), ps = boss ? .44 : .3;
  b.add(cone(ps, ps * 1.25, 4), { p: [pp[0], ps * .62, pp[2]], r: [0, Math.PI / 4 + pa, 0], color: '#e2ba7c', shade: .55, jitter: .04 });
  b.addGlow(cone(ps * .16, ps * .2, 4), { p: [pp[0], ps * 1.2, pp[2]], r: [0, Math.PI / 4 + pa, 0], color: '#ffcf4a' });
  // Obelisk.
  const ob = b.at(boss ? SIDES[1]! : SIDES[(variant + 1) % 2]!, .7);
  b.add(cyl(.03, .055, .48, 4), { p: [ob[0], .24, ob[2]], r: [0, Math.PI / 4, 0], color: p.stone, shade: .6 });
  b.addGlow(cone(.04, .07, 4), { p: [ob[0], .52, ob[2]], r: [0, Math.PI / 4, 0], color: '#ffcf4a' });
  if (boss) {
    const sp = b.at(SIDES[0]!, .62);
    b.add(box(.14, .12, .3), { p: [sp[0], .06, sp[2]], color: p.stone });
    b.add(box(.12, .14, .12), { p: [sp[0], .18, sp[2] + .12], color: p.stone });
    b.addGlow(box(.15, .1, .09), { p: [sp[0], .22, sp[2] + .11], color: '#f2c048' });
  }
  // Palms leaning over a small oasis.
  const oa = b.at(Math.PI * (.12 + variant * .1), .66);
  b.add(cyl(.2, .2, .02, 12), { p: [oa[0], .012, oa[2]], s: [1, 1, .7], color: '#2a9ab0', shade: 1, jitter: 0 });
  for (let k = 0; k < 2; k++) {
    const base0 = [oa[0] + (k ? .18 : -.16), 0, oa[2] - .08] as V3, lean = (k ? 1 : -1) * .1, h = .42 + r() * .12;
    for (let j = 0; j < 4; j++) b.add(cyl(.018, .024, h / 4 + .01, 5), { p: [base0[0] + lean * j / 4, h * (j + .5) / 4, base0[2]], r: [0, 0, -lean * .9], color: '#7a5a36', shade: .7 });
    for (let j = 0; j < 6; j++) b.add(cone(.05, .26, 4), { p: [base0[0] + lean, h + .02, base0[2]], r: [Math.cos(j * 1.05) * 1.25, j * 1.05, Math.sin(j * 1.05) * 1.25], s: [1, 1, .3], color: '#4f8f3a', shade: .7 });
  }
  for (let k = 0; k < 4; k++) b.add(ball(.16 + r() * .1, 8, 5), { p: b.at(r() * Math.PI * 2, .84, -.02), s: [1.5, .32, 1], color: '#f2d29a', shade: .85, jitter: .03 });
}

function ice(b: Builder, variant: number, boss: boolean) {
  const p = palettes[3]!, r = b.r;
  base(b, p, 3, boss ? 1.15 : 1);
  // Clusters of ice spires (a frozen citadel on the chapter finale).
  const spires = boss ? 7 : 3 + variant;
  for (let k = 0; k < spires; k++) {
    const a = Math.PI * (1.08 + (k / Math.max(1, spires - 1)) * .84) + (r() - .5) * .2;
    const at = b.at(a, (boss && k === 3 ? .75 : .62) + r() * .25), h = (boss && k === 3 ? .95 : .3 + r() * .4);
    b.add(spike(1), { p: [at[0], h * .5, at[2]], s: [.07 + r() * .05, h * .55, .07 + r() * .05], r: [(r() - .5) * .3, r() * 3, (r() - .5) * .3], color: k % 2 ? '#c4ecff' : '#e6f8ff', shade: .55, jitter: .12 });
  }
  // Frozen pond and snow drifts.
  b.add(cyl(.24, .24, .02, 12), { p: [...b.at(Math.PI * (.2 + variant * .3), .55, .012)] as V3, s: [1, 1, .75], color: '#a8dcf4', shade: 1, jitter: 0 });
  for (let k = 0; k < 4; k++) b.add(ball(.15 + r() * .1, 8, 5), { p: b.at(r() * Math.PI * 2, .82, -.02), s: [1.4, .38, 1], color: '#ffffff', shade: .85, jitter: .03 });
  // Icicles under the rim, and aurora-lit crystal shards.
  for (let k = 0; k < 8; k++) {
    const a = r() * Math.PI * 2, l = .2 + r() * .35;
    b.add(cone(.045, l, 5), { p: [Math.cos(a) * .9, -.36 - l / 2, Math.sin(a) * .9], r: [Math.PI, 0, 0], color: '#d6f0ff', shade: .7 });
  }
  for (let k = 0; k < 2; k++) b.addGlow(spike(1), { p: b.at(Math.PI * (1.2 + k * .5), .3, .1), s: [.035, .1, .035], color: '#7ff0ff' });
}

function voidIsland(b: Builder, variant: number, boss: boolean, finale: boolean) {
  const p = palettes[4]!, r = b.r;
  base(b, p, 4, 1);
  // Tech seams across the deck.
  for (let k = -1; k <= 1; k++) {
    b.addGlow(box(1.5, .012, .016), { p: [0, .005, k * .4], color: '#58d8ff' });
    b.addGlow(box(.016, .012, 1.5), { p: [k * .4, .005, 0], color: '#58d8ff' });
  }
  // Pylons with pink light cores, and violet crystal growths.
  for (let k = 0; k < 2 + (variant % 2); k++) {
    const at = b.at(Math.PI * (1.15 + k * .35 + variant * .05), .7);
    b.add(cyl(.04, .07, .38, 6), { p: [at[0], .19, at[2]], color: '#4a5070', shade: .6 });
    b.addGlow(spike(.06), { p: [at[0], .43, at[2]], color: '#ff6ae6' });
  }
  for (let k = 0; k < 5; k++) {
    const a = r() * Math.PI * 2, d = .3 + r() * .6;
    b.addGlow(spike(1), { p: [Math.cos(a) * d, -.6 - r() * .7, Math.sin(a) * d], s: [.05, .14, .05], r: [r() * 2, r() * 3, r() * 2], color: r() < .5 ? '#c45aff' : '#ff4fd8' });
  }
  // Debris orbiting below, and a faint energy ring.
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + r(), d = 1.15 + r() * .25;
    b.add(rock(.05 + r() * .07), { p: [Math.cos(a) * d, -.5 - r() * .5, Math.sin(a) * d], r: [r() * 3, r() * 3, 0], color: '#3a3448', shade: .6, jitter: .2 });
  }
  b.addGlow(new TorusGeometry(1.22, .012, 4, 48), { p: [0, -.5, 0], r: [Math.PI / 2 + .18, 0, .1], color: '#8a5aff' });
  if (boss) {
    // The Void Eye's gate: a great ring of plasma standing behind the dais.
    const gp = b.at(Math.PI * 1.5, .8);
    b.addGlow(new TorusGeometry(finale ? .5 : .38, .045, 6, 40), { p: [gp[0], finale ? .62 : .5, gp[2]], color: finale ? '#ff4fb0' : '#c46aff' });
    b.add(new TorusGeometry(finale ? .58 : .45, .05, 5, 40), { p: [gp[0], finale ? .62 : .5, gp[2] - .02], color: '#2a2e44', shade: .7 });
    if (finale) b.add(ball(.36, 14, 10), { p: [gp[0], .62, gp[2] - .05], color: '#06040c', shade: 1, jitter: 0 });
  }
}

/** Number of ordinary island designs per chapter (the finale has its own). */
export const ISLAND_VARIANTS = 3;

const cache = new Map<string, IslandParts>();
const inProgress = new Map<string, Builder>();
const keyOf = (chapter: number, variant: number | 'boss', finale: boolean) => `${chapter}:${variant}:${finale}`;

function builderFor(chapter: number, variant: number | 'boss', finale: boolean) {
  const key = keyOf(chapter, variant, finale);
  let b = inProgress.get(key);
  if (b) return b;
  const boss = variant === 'boss';
  const v = boss ? 0 : variant;
  b = new Builder(rng(chapter * 97 + (boss ? 50 : v * 13) + 7));
  if (chapter === 0) sky(b, v, boss);
  else if (chapter === 1) rainforest(b, v, boss);
  else if (chapter === 2) desert(b, v, boss);
  else if (chapter === 3) ice(b, v, boss);
  else voidIsland(b, v, boss, finale);
  inProgress.set(key, b);
  return b;
}

function finish(key: string, b: Builder) {
  const parts = b.build();
  inProgress.delete(key);
  cache.set(key, parts);
  return parts;
}

/** Every design a chapter's islands use. */
export const chapterDesigns = (chapter: number, chapterCount = 5): [number | 'boss', boolean][] =>
  [...Array.from({ length: ISLAND_VARIANTS }, (_, v) => [v, false] as [number, boolean]), ['boss', chapter === chapterCount - 1]];

/** The island design for a chapter: `variant` 0..ISLAND_VARIANTS-1, or 'boss' for the chapter finale. Built once, then cached. */
export function islandParts(chapter: number, variant: number | 'boss', finale = false): IslandParts {
  const key = keyOf(chapter, variant, finale);
  const hit = cache.get(key);
  if (hit) return hit;
  const b = builderFor(chapter, variant, finale);
  b.run(Infinity);
  return finish(key, b);
}

/** Whether all of a chapter's island designs are built. */
export const islandsReady = (chapter: number) => chapterDesigns(chapter).every(([v, f]) => cache.has(keyOf(chapter, v, f)));

/**
 * Builds island designs in the background: works through `chapters` in order for at most `budgetMs`, then stops until
 * called again (once per frame). True when they are all built. Lets the map's islands be ready before they are needed
 * without ever stalling a frame for long.
 */
export function prepareIslands(chapters: number[], budgetMs: number) {
  const until = performance.now() + budgetMs;
  for (const c of chapters) for (const [v, f] of chapterDesigns(c)) {
    const key = keyOf(c, v, f);
    if (cache.has(key)) continue;
    const b = builderFor(c, v, f);
    if (!b.run(until)) return false;
    finish(key, b);
    if (performance.now() >= until) return false;
  }
  return true;
}
