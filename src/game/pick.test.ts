import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Camera, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3 } from 'three';
import { applyMove, initialState } from './engine';
import { levels } from './levels';
import { Level, PlayState } from './types';
import { restingCamera, GAME_DIR } from '../world/framing';
import { BoardTouch, HOLD_MS, PICK_TOLERANCE_DP, pickAt, PickTarget, proxies, proxyGeometry, proxyMaterial, ProxyShape, RawPointer, TAP_SLOP_DP,
  TIE_DP, TOTEM_SCALE, Touchable, TouchHost } from '../world/pick';

/*
 * Touch selection, tested on the real levels through the play camera exactly as it frames each board on a phone (the
 * HUD's 124 dp top bar and 78 dp bottom bar plus the safe areas). Each piece's stand-ins are posed in the same frames as
 * in the game (see the pieces in src/world). The old per-piece tap boxes are rebuilt beside them for comparison.
 */

const HUD_TOP = 124, HUD_BOTTOM = 78;
interface Viewport { name: string; W: number; H: number; top: number; bottom: number; view?: 'tilt' | 'top' }
const PHONE: Viewport = { name: 'Pixel 9 (411x923 dp)', W: 411.4, H: 923.4, top: 48 + HUD_TOP, bottom: 24 + HUD_BOTTOM };
const VIEWPORTS: Viewport[] = [
  { name: 'compact (360x640 dp)', W: 360, H: 640, top: 24 + HUD_TOP, bottom: HUD_BOTTOM },
  PHONE,
  { name: '20:9 phone (393x873 dp)', W: 393, H: 873, top: 40 + HUD_TOP, bottom: 16 + HUD_BOTTOM },
  { name: 'tablet (800x1280 dp)', W: 800, H: 1280, top: 24 + HUD_TOP, bottom: 24 + HUD_BOTTOM },
  { ...PHONE, name: 'Pixel 9, top-down view', view: 'top' },
];

type Kind = 'mirror' | 'floe' | 'cannon' | 'totem';
interface Piece extends PickTarget {
  kind: Kind;
  cell: [number, number];
  /** The middle of the piece's main body: where a player aims. */
  aim: Object3D;
  /** The old tap box (1 cell wide, 1.4-1.7 tall) the piece had before. */
  old: { current: Object3D };
  /** The mirror's panel group, which turns. */
  panel?: Group;
}

const ref = (o: Object3D) => ({ current: o });
function stand(shape: ProxyShape, parent: Object3D) {
  const m = new Mesh(proxyGeometry[shape.kind], proxyMaterial);
  m.position.set(...shape.at);
  m.scale.set(...shape.size);
  parent.add(m);
  return m;
}
const oldMat = new MeshBasicMaterial();
function oldBox(w: number, h: number, y: number, parent: Object3D) {
  const m = new Mesh(new BoxGeometry(w, h, w), oldMat);
  m.position.y = y;
  parent.add(m);
  return m;
}

/** The board as the game builds it (pieces at their opening cells), with every tappable piece's stand-ins. */
function board(level: Level, state: PlayState = initialState(level)) {
  const scene = new Scene();
  const n = level.size, c0 = (n - 1) / 2;
  const root = new Group();
  root.position.set(-c0, 0, -c0);
  scene.add(root);
  const pieces: Piece[] = [];
  const at = (p: readonly [number, number]) => { const g = new Group(); g.position.set(p[0], 0, p[1]); root.add(g); return g; };
  for (const m of level.mirrors) {
    const g = at(m.position), body = new Group(), panel = new Group();
    g.add(body);
    panel.position.y = .72;
    panel.rotation.y = (state.orientations[m.id] ?? m.orientation) * Math.PI / 2 + Math.PI / 4;
    body.add(panel);
    const base = stand(proxies.mirror.base, body), glass = stand(proxies.mirror.panel, panel);
    pieces.push({ id: m.id, kind: 'mirror', cell: [...m.position], proxies: [ref(base), ref(glass)], aim: glass, old: ref(oldBox(1, 1.7, .75, g)), panel });
  }
  for (const f of level.floes) {
    const g = at(f.track[state.places[f.id] ?? f.at]!), body = new Group();
    g.add(body);
    const ice = stand(proxies.floe.ice, body);
    pieces.push({ id: f.id, kind: 'floe', cell: [...f.track[f.at]!], proxies: [ref(stand(proxies.floe.raft, body)), ref(ice)], aim: ice, old: ref(oldBox(1, 1.7, .75, g)) });
  }
  for (const e of level.emitters) {
    const g = at(e.position);
    const body = stand(proxies.cannon.body, g);
    pieces.push({ id: e.id, kind: 'cannon', cell: [...e.position], proxies: [ref(stand(proxies.cannon.foot, g)), ref(body)], aim: body, old: ref(oldBox(1, 1.4, .6, g)) });
  }
  for (const c of level.clusters) {
    const [tx, tz] = c.totem.position;
    const g = at(c.totem.position), scaled = new Group(), carved = new Group();
    scaled.scale.setScalar(TOTEM_SCALE);
    carved.rotation.y = Math.atan2(c.pivot[0] - tx, c.pivot[1] - tz);
    g.add(scaled); scaled.add(carved);
    const faces = stand(proxies.totem.faces, carved);
    pieces.push({ id: c.totem.id, kind: 'totem', cell: [tx, tz], proxies: [ref(stand(proxies.totem.plinth, carved)), ref(faces), ref(stand(proxies.totem.crown, carved))],
      aim: faces, old: ref(oldBox(1, 1.7, .8, g)) });
  }
  scene.updateMatrixWorld(true);
  return { scene, root, pieces, n };
}

function camera(v: Viewport, n: number) {
  return restingCamera(n, v.W, v.H, v.top, v.bottom, v.view);
}
const v3 = new Vector3();
/** Where a world point lands on screen, in dp. */
function screen(cam: Camera, v: Viewport, p: Vector3) {
  v3.copy(p).project(cam);
  return [(v3.x + 1) / 2 * v.W, (1 - v3.y) / 2 * v.H] as [number, number];
}
const aimAt = (piece: Piece, cam: Camera, v: Viewport) => screen(cam, v, piece.aim.getWorldPosition(new Vector3()));

/** Screen bounds of a piece's stand-ins (and old box), so the many-sample tests only test pieces that could be near. */
function bounds(pieces: Piece[], cam: Camera, v: Viewport) {
  const box = new BoxGeometry(1, 1, 1), corners: Vector3[] = [];
  for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) corners.push(new Vector3(x, y, z));
  box.dispose();
  return new Map(pieces.map(p => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of [...p.proxies.map(r => r.current!), p.old.current]) {
      const g = (o as Mesh).geometry;
      g.computeBoundingBox();
      const b = g.boundingBox!;
      for (const c of corners) {
        const w = new Vector3(b.min.x + (c.x + .5) * (b.max.x - b.min.x), b.min.y + (c.y + .5) * (b.max.y - b.min.y), b.min.z + (c.z + .5) * (b.max.z - b.min.z)).applyMatrix4(o.matrixWorld);
        const [sx, sy] = screen(cam, v, w);
        x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
      }
    }
    const pad = PICK_TOLERANCE_DP + 4;
    return [p, [x0 - pad, y0 - pad, x1 + pad, y1 + pad] as const];
  }));
}

const ray = new Raycaster(), ndc = new Vector2();
/** The piece whose old tap box a touch hit first (how the game chose before): R3F delivered the click to the nearest box. */
function oldPick(pieces: Piece[], cam: Camera, v: Viewport, x: number, y: number) {
  ndc.set(x / v.W * 2 - 1, -(y / v.H) * 2 + 1);
  ray.setFromCamera(ndc, cam);
  let best: Piece | undefined, d = Infinity;
  for (const p of pieces) {
    const h = ray.intersectObject(p.old.current, false)[0];
    if (h && h.distance < d) { d = h.distance; best = p; }
  }
  return best;
}
/** The piece whose visible body is seen at (x, y): the nearest stand-in on the ray. */
function seen(pieces: Piece[], cam: Camera, v: Viewport, x: number, y: number) {
  ndc.set(x / v.W * 2 - 1, -(y / v.H) * 2 + 1);
  ray.setFromCamera(ndc, cam);
  let best: Piece | undefined, d = Infinity;
  for (const p of pieces) for (const r of p.proxies) {
    const h = ray.intersectObject(r.current!, false)[0];
    if (h && h.distance < d) { d = h.distance; best = p; }
  }
  return best;
}
function near(box: Map<Piece, readonly [number, number, number, number]>, x: number, y: number) {
  return [...box].filter(([, b]) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]).map(([p]) => p);
}

/** A piece's own outline distance from (x, y), in dp (0 on its visible body). */
const gapOf = (p: Piece, cam: Camera, v: Viewport, x: number, y: number) => pickAt([p], cam, v.W, v.H, x, y, Infinity)!.gap;
/**
 * The selection policy, checked at one point: the piece seen there wins; otherwise the closest outline within the
 * tolerance (or one tied with it), else nothing. The answer does not depend on the order the pieces are listed in.
 */
function obeys(pieces: Piece[], cam: Camera, v: Viewport, x: number, y: number, where: string) {
  const pick = pickAt(pieces, cam, v.W, v.H, x, y);
  assert.equal(pickAt([...pieces].reverse(), cam, v.W, v.H, x, y)?.target.id, pick?.target.id, `${where}: the same piece in any order`);
  const shown = seen(pieces, cam, v, x, y);
  if (shown) { assert.equal(pick?.target.id, shown.id, `${where}: the piece seen under the finger`); return pick; }
  const least = Math.min(...pieces.map(p => gapOf(p, cam, v, x, y)));
  if (least > PICK_TOLERANCE_DP) assert.equal(pick, undefined, `${where}: nothing within reach`);
  else assert.ok(pick && pick.gap <= least + TIE_DP, `${where}: ${pick?.target.id} at ${pick?.gap.toFixed(1)} dp, closest outline ${least.toFixed(1)} dp`);
  return pick;
}

const neighbours = (a: Piece, b: Piece) => Math.abs(a.cell[0] - b.cell[0]) + Math.abs(a.cell[1] - b.cell[1]) === 1;
const chapterLevels = (ch: number) => levels.filter(l => l.chapter === ch);

// ---------------------------------------------------------------------------------------------------------------------
// The selection policy on the real boards

test('1. A tap on the middle of a mirror selects that mirror, on every level, chapter and screen', () => {
  let checked = 0;
  for (const v of VIEWPORTS) for (const level of levels) {
    const { pieces, n } = board(level), cam = camera(v, n);
    for (const p of pieces) {
      const [x, y] = aimAt(p, cam, v);
      const shown = seen(pieces, cam, v, x, y);
      // The middle of a piece standing behind a taller one can be hidden; those are covered by test 3 and the census.
      if (shown !== p) continue;
      const pick = pickAt(pieces, cam, v.W, v.H, x, y);
      assert.equal(pick?.target.id, p.id, `${v.name}, level ${level.id}: ${p.id} at its middle`);
      assert.ok(pick!.direct);
      checked++;
    }
  }
  assert.ok(checked > 3000, `${checked} pieces checked`);
});

test('2. A tap near the edge of a mirror selects it: on its visible edge, and just outside it', () => {
  let inside = 0, outside = 0;
  for (const level of levels) {
    const { pieces, n } = board(level), cam = camera(PHONE, n);
    for (const p of pieces.filter(q => q.kind === 'mirror')) {
      const [cx, cy] = aimAt(p, cam, PHONE);
      // Walk out from the middle in 16 directions to the last point where the mirror is still seen, then 6 dp further.
      for (let k = 0; k < 16; k++) {
        const dx = Math.cos(k * Math.PI / 8), dy = Math.sin(k * Math.PI / 8);
        let edge = -1;
        for (let r = 0; r < 80; r += .5) {
          if (seen(pieces, cam, PHONE, cx + dx * r, cy + dy * r) === p) edge = r; else if (edge >= 0) break;
        }
        if (edge < 2) continue;
        const ex = cx + dx * (edge - 1), ey = cy + dy * (edge - 1);
        if (seen(pieces, cam, PHONE, ex, ey) === p) {
          assert.equal(pickAt(pieces, cam, PHONE.W, PHONE.H, ex, ey)?.target.id, p.id, `level ${level.id} ${p.id}: on its edge`);
          inside++;
        }
        // Just off the edge, where no other piece is seen and no other outline is closer, the forgiving margin applies.
        const ox = cx + dx * (edge + 6), oy = cy + dy * (edge + 6);
        if (seen(pieces, cam, PHONE, ox, oy)) continue;
        // The mirror, unless another piece's outline is as close (within the tie band).
        const pick = obeys(pieces, cam, PHONE, ox, oy, `level ${level.id} ${p.id}, 6 dp off its edge`);
        assert.ok(pick, `level ${level.id} ${p.id}: 6 dp off its edge is within reach`);
        if (pick.target === p) outside++;
        else assert.ok(pick.gap <= gapOf(p, cam, PHONE, ox, oy) + TIE_DP);
      }
    }
  }
  assert.ok(inside > 1000 && outside > 1000, `${inside} edge taps, ${outside} near misses`);
});

test('3. A tap between two adjacent mirrors goes to the one seen there, else the closer outline, the same way every time', () => {
  let pairs = 0, between = 0;
  for (const v of [PHONE, VIEWPORTS[0]!]) for (const level of levels) {
    const { pieces, n } = board(level), cam = camera(v, n);
    const mirrors = pieces.filter(p => p.kind === 'mirror' || p.kind === 'floe');
    for (const a of mirrors) for (const b of mirrors) {
      if (a.id >= b.id || !neighbours(a, b)) continue;
      const [ax, ay] = aimAt(a, cam, v), [bx, by] = aimAt(b, cam, v);
      // Every point on the line between the two middles, and 4 dp to either side of it.
      for (let s = 0; s <= 1.0001; s += 1 / 32) for (const side of [-4, 0, 4]) {
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const x = ax + (bx - ax) * s - (by - ay) / len * side, y = ay + (by - ay) * s + (bx - ax) / len * side;
        const pick = obeys(pieces, cam, v, x, y, `${v.name} level ${level.id} between ${a.id} and ${b.id}`);
        // Repeated attempts at the same spot never alternate.
        for (let k = 0; k < 3; k++) assert.equal(pickAt(pieces, cam, v.W, v.H, x, y)?.target.id, pick?.target.id);
        if (!seen(pieces, cam, v, x, y)) between++;
      }
      pairs++;
    }
  }
  assert.ok(pairs > 150 && between > 1000, `${pairs} adjacent pairs, ${between} touches in the gaps between bodies`);
});

test("The policy holds over the whole board, on every level (phone) and on each chapter's busiest board (every screen)", () => {
  const busiest = [0, 1, 2, 3, 4].map(ch => chapterLevels(ch).reduce((a, b) => (b.mirrors.length + b.emitters.length + b.floes.length + b.clusters.length
    > a.mirrors.length + a.emitters.length + a.floes.length + a.clusters.length ? b : a)));
  let points = 0;
  for (const v of VIEWPORTS) for (const level of v === PHONE ? levels : busiest) {
    const { pieces, n } = board(level), cam = camera(v, n), box = bounds(pieces, cam, v);
    const step = v === PHONE ? 16 : 9;
    for (let x = 0; x < v.W; x += step) for (let y = v.top; y < v.H - v.bottom; y += step) {
      const close = near(box, x, y);
      if (!close.length) { assert.equal(pickAt(pieces, cam, v.W, v.H, x, y), undefined); continue; }
      obeys(close, cam, v, x, y, `${v.name} level ${level.id} at ${x.toFixed(0)},${y.toFixed(0)}`);
      points++;
    }
  }
  assert.ok(points > 30000, `${points} touches checked`);
});

test('5. A mirror beside a cannon: each gets its own taps, the cannon never takes the mirror\'s', () => {
  let pairs = 0;
  for (const v of VIEWPORTS) for (const level of levels) {
    const { pieces, n } = board(level), cam = camera(v, n);
    for (const m of pieces.filter(p => p.kind === 'mirror')) for (const c of pieces.filter(p => p.kind === 'cannon' && neighbours(p, m))) {
      for (const [p, other] of [[m, c], [c, m]] as const) {
        const [x, y] = aimAt(p, cam, v);
        if (seen(pieces, cam, v, x, y) !== p) continue;
        assert.equal(pickAt(pieces, cam, v.W, v.H, x, y)?.target.id, p.id, `${v.name} level ${level.id}: ${p.id} beside ${other.id}`);
      }
      pairs++;
    }
  }
  assert.ok(pairs > 50, `${pairs} mirror-cannon pairs`);
});

test('6. A mirror partly hidden behind a crystal or a block is still selected through it', () => {
  // The decorations are drawn but never selectable: a touch on the part of a mirror they hide still selects the mirror.
  let cases = 0;
  const decor = new MeshBasicMaterial();
  for (const level of levels) {
    const { scene, root, pieces, n } = board(level), cam = camera(PHONE, n);
    const blockers: Mesh[] = [];
    const place = (p: readonly [number, number], m: Mesh) => { m.position.x += p[0]; m.position.z += p[1]; root.add(m); blockers.push(m); };
    for (const t of level.targets) { const m = new Mesh(new CylinderGeometry(.42, .48, 1.6, 8), decor); m.position.y = .8; place(t.position, m); }
    for (const b of level.blockers) { const m = new Mesh(new BoxGeometry(.9, .95, .9), decor); m.position.y = .47; place(b, m); }
    scene.updateMatrixWorld(true);
    for (const p of pieces.filter(q => q.kind === 'mirror')) {
      // Scan the mirror's screen area for points where a decoration is in front of it.
      const [cx, cy] = aimAt(p, cam, PHONE);
      for (let dx = -30; dx <= 30; dx += 3) for (let dy = -40; dy <= 30; dy += 3) {
        const x = cx + dx, y = cy + dy;
        ndc.set(x / PHONE.W * 2 - 1, -(y / PHONE.H) * 2 + 1);
        ray.setFromCamera(ndc, cam);
        const front = ray.intersectObjects(blockers, false)[0];
        const behind = p.proxies.map(r => ray.intersectObject(r.current!, false)[0]).filter(Boolean).sort((a, b) => a!.distance - b!.distance)[0];
        if (!front || !behind || front.distance >= behind.distance || seen(pieces, cam, PHONE, x, y) !== p) continue;
        assert.equal(pickAt(pieces, cam, PHONE.W, PHONE.H, x, y)?.target.id, p.id, `level ${level.id}: ${p.id} behind a decoration`);
        cases++;
      }
    }
  }
  assert.ok(cases > 200, `${cases} hidden points`);
});

test('9. During a mirror\'s turn the touch follows the panel as drawn, mid-turn', () => {
  let checked = 0;
  for (const level of levels.filter(l => l.mirrors.length >= 4)) {
    const { scene, pieces, n } = board(level), cam = camera(PHONE, n);
    for (const p of pieces.filter(q => q.panel)) {
      // Halfway through its quarter turn (and overshooting a little, as the spring does).
      for (const extra of [Math.PI / 4, Math.PI / 2 + .08]) {
        p.panel!.rotation.y += extra;
        scene.updateMatrixWorld(true);
        const [x, y] = aimAt(p, cam, PHONE);
        if (seen(pieces, cam, PHONE, x, y) === p) { assert.equal(pickAt(pieces, cam, PHONE.W, PHONE.H, x, y)?.target.id, p.id); checked++; }
        p.panel!.rotation.y -= extra;
      }
      scene.updateMatrixWorld(true);
    }
  }
  assert.ok(checked > 300, `${checked} mid-turn taps`);
});

test("10. Pieces on the board's edges: selected at their middle, and just past their edge unless another outline is as close", () => {
  let edge = 0, kept = 0;
  for (const v of VIEWPORTS) for (const level of levels) {
    const { pieces, n } = board(level), cam = camera(v, n);
    for (const p of pieces.filter(q => q.cell[0] === 0 || q.cell[1] === 0 || q.cell[0] === n - 1 || q.cell[1] === n - 1)) {
      const [x, y] = aimAt(p, cam, v);
      if (seen(pieces, cam, v, x, y) === p) assert.equal(pickAt(pieces, cam, v.W, v.H, x, y)?.target.id, p.id);
      // Straight out past the board's edge, on the screen.
      const out = p.cell[0] === 0 ? [-1, 0] : p.cell[0] === n - 1 ? [1, 0] : p.cell[1] === 0 ? [0, -1] : [0, 1];
      const far = screen(cam, v, p.aim.getWorldPosition(new Vector3()).add(new Vector3(out[0]! * 3, 0, out[1]! * 3)));
      const len = Math.hypot(far[0] - x, far[1] - y), ux = (far[0] - x) / len, uy = (far[1] - y) / len;
      let r = 0;
      while (r < 200 && seen(pieces, cam, v, x + ux * r, y + uy * r) === p) r += .5;
      if (r >= 200 || seen(pieces, cam, v, x + ux * r, y + uy * r)) continue;
      for (const extra of [2, PICK_TOLERANCE_DP * .5, PICK_TOLERANCE_DP + 12]) {
        const pick = obeys(pieces, cam, v, x + ux * (r + extra), y + uy * (r + extra), `${v.name} level ${level.id}: ${extra.toFixed(0)} dp past ${p.id}`);
        if (extra === 2 && pick?.target === p) kept++;
      }
      edge++;
    }
  }
  assert.ok(edge > 2000 && kept / edge > .9, `${edge} edge pieces, ${kept} kept a touch 2 dp past their edge`);
});

test('11. The same board on different screens: each piece is selected at its middle on every screen', () => {
  for (const ch of [0, 1, 2, 3, 4]) {
    // The most crowded board of each chapter.
    const level = chapterLevels(ch).reduce((a, b) => (board(b).pieces.length > board(a).pieces.length ? b : a));
    const { pieces, n } = board(level);
    const owners = VIEWPORTS.map(v => {
      const cam = camera(v, n);
      return pieces.map(p => {
        const [x, y] = aimAt(p, cam, v);
        return seen(pieces, cam, v, x, y) === p ? pickAt(pieces, cam, v.W, v.H, x, y)?.target.id : p.id;
      });
    });
    for (const o of owners) assert.deepEqual(o, pieces.map(p => p.id), `level ${level.id} (chapter ${ch + 1}, ${pieces.length} pieces)`);
  }
});

test('Census: every piece can be selected somewhere; the old tap boxes compared on thumb-sized misses', () => {
  // Every piece, every level, on the phone (tilted and top-down) and the compact screen: aim at the piece's middle with a
  // thumb's spread (the middle, then 5, 10 and 16 dp off it in 8 directions). A touch that lands on a piece's visible body
  // belongs to that piece; count how often each system gives it to another.
  const rows: string[] = [];
  const unreachable: string[] = [];
  for (const v of [PHONE, VIEWPORTS[0]!, VIEWPORTS[4]!]) {
    let onBody = 0, oldWrong = 0, newWrong = 0, misses = 0, oldMissAimed = 0, newMissAimed = 0;
    const byChapter = [0, 0, 0, 0, 0];
    for (const level of levels) {
      const { pieces, n } = board(level), cam = camera(v, n), box = bounds(pieces, cam, v);
      for (const p of pieces) {
        const [cx, cy] = aimAt(p, cam, v);
        let reachable = false;
        for (const [dx, dy] of thumb) {
          const x = cx + dx, y = cy + dy, close = near(box, x, y);
          const shown = seen(close, cam, v, x, y);
          const pick = pickAt(close, cam, v.W, v.H, x, y)?.target;
          const old = oldPick(close, cam, v, x, y);
          if (pick === p) reachable = true;
          if (shown === p) {
            onBody++;
            if (old !== p) { oldWrong++; byChapter[level.chapter]!++; }
            if (pick !== p) newWrong++;
          } else if (!shown) {
            misses++;
            if (old === p) oldMissAimed++;
            if (pick === p) newMissAimed++;
          }
        }
        if (!reachable && !scan(p, pieces, cam, v, box)) unreachable.push(`${v.name}: level ${level.id} ${p.id}`);
      }
    }
    assert.equal(newWrong, 0, `${v.name}: a touch on a visible piece always selects it`);
    rows.push(`# ${v.name}: ${onBody} touches on a piece's visible body; old boxes gave ${oldWrong} (${(oldWrong / onBody * 100).toFixed(1)}%) to another piece `
      + `[by chapter ${byChapter.join('/')}], now ${newWrong}. ${misses} thumb misses beside the aimed piece: old ${oldMissAimed} `
      + `(${(oldMissAimed / misses * 100).toFixed(0)}%) reached it, now ${newMissAimed} (${(newMissAimed / misses * 100).toFixed(0)}%)`);
  }
  for (const r of rows) console.log(r);
  console.log(`# pieces that cannot be selected anywhere: ${unreachable.length ? unreachable.join('; ') : 'none'}`);
  assert.deepEqual(unreachable, [], 'every piece can be selected from the play camera');
});
const thumb: [number, number][] = [[0, 0], ...[5, 10, 16].flatMap(r => Array.from({ length: 8 }, (_, k) => [Math.cos(k * Math.PI / 4) * r, Math.sin(k * Math.PI / 4) * r] as [number, number]))];
/** Is there any point (on a 2 dp grid over its screen area) where the piece is selected? */
function scan(p: Piece, pieces: Piece[], cam: Camera, v: Viewport, box: Map<Piece, readonly [number, number, number, number]>) {
  const b = box.get(p)!;
  for (let x = b[0]; x <= b[2]; x += 2) for (let y = b[1]; y <= b[3]; y += 2) if (pickAt(near(box, x, y), cam, v.W, v.H, x, y)?.target === p) return true;
  return false;
}

test('Pruning the candidates by screen area (as the tests do for speed) never changes a selection', () => {
  const level = levels.find(l => l.chapter === 4 && l.boss) ?? levels[levels.length - 1]!;
  const { pieces, n } = board(level), cam = camera(PHONE, n), box = bounds(pieces, cam, PHONE);
  for (let x = 0; x < PHONE.W; x += 7) for (let y = PHONE.top; y < PHONE.H - PHONE.bottom; y += 7)
    assert.equal(pickAt(near(box, x, y), cam, PHONE.W, PHONE.H, x, y)?.target.id, pickAt(pieces, cam, PHONE.W, PHONE.H, x, y)?.target.id);
});

test('The camera\'s idle drift does not change which piece is under a finger', () => {
  // The play camera breathes (a slight yaw and bob). Selection uses the camera as last drawn, so it follows the drift.
  const level = levels.find(l => l.mirrors.length >= 8)!;
  const { pieces, n } = board(level), still = camera(PHONE, n);
  const drift = still.clone() as PerspectiveCamera;
  const d = still.position.length();
  drift.position.copy(GAME_DIR).applyAxisAngle(new Vector3(0, 1, 0), .028).multiplyScalar(d);
  drift.position.y += .12;
  drift.lookAt(0, 0, 0);
  drift.updateMatrixWorld();
  for (const p of pieces) {
    const [x, y] = aimAt(p, drift, PHONE);
    if (seen(pieces, drift, PHONE, x, y) === p) assert.equal(pickAt(pieces, drift, PHONE.W, PHONE.H, x, y)?.target.id, p.id);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Taps, drags, holds, multiple fingers and cancels

interface Fake extends Touchable { id: string }
function rig(pick: (x: number, y: number) => Fake | undefined = () => undefined, log: string[] = []) {
  let now = 0;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const micro: (() => void)[] = [];
  const host: TouchHost<Fake> = {
    pick,
    press: t => log.push(`press ${t.id}`),
    release: (t, tapped) => log.push(`${tapped ? 'lift' : 'drop'} ${t.id}`),
    after: (ms, fn) => { const t = { at: now + ms, fn, live: true }; timers.push(t); return () => { t.live = false; }; },
    soon: fn => micro.push(fn),
  };
  const touch = new BoardTouch(host);
  const flush = () => { while (micro.length) micro.shift()!(); };
  return {
    log, touch,
    /** One dispatch (as React Native delivers a responder event and its follow-ups), then pending microtasks. */
    native: (...events: RawPointer[]) => { for (const e of events) touch.handle(e); flush(); },
    /** Browser events, each its own task. */
    web: (...events: RawPointer[]) => { for (const e of events) { touch.handle(e); flush(); } },
    /** Browser events delivered in one go, as Chrome delivers a touch's lift: pointerup, then lostpointercapture. */
    webBatch: (...events: RawPointer[]) => { for (const e of events) touch.handle(e); flush(); },
    wait: (ms: number) => {
      now += ms;
      for (const t of timers) if (t.live && t.at <= now) { t.live = false; t.fn(); }
    },
  };
}
const piece = (id: string, log: string[], hold = true): Fake => ({ id, tap: () => log.push(`tap ${id}`), hold: hold ? on => log.push(`hold ${on ? 'on' : 'off'} ${id}`) : undefined });
/** Native touches as React Native reports them: `touches` lists the fingers still down. */
const fingers = (n: number) => Array.from({ length: n }, () => ({}));
const nat = (type: string, x: number, y: number, id = 0, down = 1): RawPointer => ({ type, offsetX: x, offsetY: y, pointerId: id, touches: fingers(down) });
const web = (type: string, x: number, y: number, id = 1, extra: Partial<RawPointer> = {}): RawPointer => ({ type, offsetX: x, offsetY: y, pointerId: id, isPrimary: id === 1, button: 0, ...extra });

test('4. Two mirrors tapped in quick succession: each turns once, in order', () => {
  const log: string[] = [];
  const a = piece('m1', log), b = piece('m2', log);
  const r = rig(x => (x < 100 ? a : b));
  r.native(nat('pointerdown', 50, 50));
  r.wait(60);
  r.native(nat('pointerup', 51, 50, 0, 0), nat('click', 51, 50, 0, 0), nat('pointerleave', 51, 50, 0, 0));
  r.wait(90);
  r.native(nat('pointerdown', 150, 52));
  r.wait(70);
  r.native(nat('pointerup', 150, 52, 0, 0), nat('click', 150, 52, 0, 0), nat('pointerleave', 150, 52, 0, 0));
  assert.deepEqual(log.filter(l => l.startsWith('tap')), ['tap m1', 'tap m2']);
});

test('7. A drag across a mirror never turns it; a finger that rolls a few dp is still a tap', () => {
  const log: string[] = [];
  const a = piece('m1', log), b = piece('m2', log);
  const r = rig(x => (x < 100 ? a : b));
  // A drag from one mirror over the other.
  r.native(nat('pointerdown', 60, 50));
  for (let x = 64; x <= 150; x += 4) r.native(nat('pointermove', x, 50));
  r.native(nat('pointerup', 150, 50, 0, 0), nat('click', 150, 50, 0, 0), nat('pointerleave', 150, 50, 0, 0));
  // Out past the slop and back: still a drag.
  r.native(nat('pointerdown', 60, 50));
  r.native(nat('pointermove', 60 + TAP_SLOP_DP + 2, 50));
  r.native(nat('pointermove', 60, 50));
  r.native(nat('pointerup', 60, 50, 0, 0), nat('pointerleave', 60, 50, 0, 0));
  // A fast flick with no move reported before the lift.
  r.native(nat('pointerdown', 60, 50));
  r.native(nat('pointerup', 60 + TAP_SLOP_DP + 5, 50, 0, 0), nat('pointerleave', 60 + TAP_SLOP_DP + 5, 50, 0, 0));
  assert.deepEqual(log.filter(l => l.startsWith('tap')), []);
  // A thumb that rolls 8 dp is a tap, on the mirror where it came down.
  r.native(nat('pointerdown', 96, 50));
  r.native(nat('pointermove', 100, 52));
  r.native(nat('pointermove', 104, 50));
  r.native(nat('pointerup', 104, 50, 0, 0), nat('click', 104, 50, 0, 0), nat('pointerleave', 104, 50, 0, 0));
  assert.deepEqual(log.filter(l => l.startsWith('tap')), ['tap m1']);
});

test('8. Two fingers never turn anything, however they come and go', () => {
  const log: string[] = [];
  const a = piece('m1', log), b = piece('m2', log);
  const r = rig(x => (x < 100 ? a : b));
  // Native: a second finger joins, then both lift, in either order.
  r.native(nat('pointerdown', 50, 50, 0, 1));
  r.native(nat('pointerdown', 150, 50, 1, 2));
  r.native(nat('pointerup', 150, 50, 1, 1), nat('click', 150, 50, 1, 1));
  r.native(nat('pointerup', 50, 50, 0, 0), nat('click', 50, 50, 0, 0), nat('pointerleave', 50, 50, 0, 0));
  r.native(nat('pointerdown', 50, 50, 0, 1));
  r.native(nat('pointerdown', 150, 50, 1, 2));
  r.native(nat('pointerup', 50, 50, 0, 1), nat('click', 50, 50, 0, 1));
  r.native(nat('pointerup', 150, 50, 1, 0), nat('click', 150, 50, 1, 0), nat('pointerleave', 150, 50, 1, 0));
  // A pinch held long enough to have been a hold shows no preview either.
  r.native(nat('pointerdown', 50, 50, 0, 1));
  r.wait(100);
  r.native(nat('pointerdown', 150, 50, 1, 2));
  r.wait(HOLD_MS * 2);
  r.native(nat('pointerup', 150, 50, 1, 1));
  r.native(nat('pointerup', 50, 50, 0, 0), nat('pointerleave', 50, 50, 0, 0));
  // Web: two pointers.
  r.web(web('pointerdown', 50, 50, 1), web('pointerdown', 150, 50, 2, { isPrimary: false }), web('pointerup', 150, 50, 2, { isPrimary: false }), web('pointerup', 50, 50, 1));
  assert.deepEqual(log.filter(l => l.startsWith('tap') || l.startsWith('hold')), []);
  // Afterwards a plain tap works again.
  r.native(nat('pointerdown', 150, 50));
  r.native(nat('pointerup', 150, 50, 0, 0), nat('click', 150, 50, 0, 0), nat('pointerleave', 150, 50, 0, 0));
  assert.deepEqual(log.filter(l => l.startsWith('tap')), ['tap m2']);
});

test('A cancelled touch does nothing, even when the cancel arrives as a lift (React Native reports pointerup first)', () => {
  const log: string[] = [];
  const a = piece('m1', log);
  const r = rig(() => a);
  // Native: a system gesture takes the touch. The responder ends the touch (pointerup, click) and terminates it, in one dispatch.
  r.native(nat('pointerdown', 50, 50));
  r.native(nat('pointerup', 50, 50, 0, 0), nat('click', 50, 50, 0, 0), nat('lostpointercapture', 50, 50, 0, 0));
  // Web: the browser cancels the pointer.
  r.web(web('pointerdown', 50, 50), web('pointercancel', 50, 50), web('pointerup', 50, 50));
  // A finger dragged off the canvas while down.
  r.web(web('pointerdown', 50, 50), web('pointerleave', 50, 50), web('pointerup', 50, 50));
  // A preview being held when the app is interrupted is put away.
  r.native(nat('pointerdown', 50, 50));
  r.wait(HOLD_MS + 10);
  r.native(nat('lostpointercapture', 50, 50, 0, 0));
  assert.deepEqual(log.filter(l => l.startsWith('tap')), []);
  assert.deepEqual(log.filter(l => l.startsWith('hold')), ['hold on m1', 'hold off m1']);
  // On the web, a capture lost while the finger is still down is a cancel too.
  r.web(web('pointerdown', 50, 50), web('lostpointercapture', 50, 50), web('pointerup', 50, 50));
  assert.deepEqual(log.filter(l => l.startsWith('tap')), []);
  // Chrome follows every touch's lift with lostpointercapture (the release of its implicit capture), in the same
  // dispatch, before any microtask runs: that is a normal tap.
  r.web(web('pointerdown', 50, 50));
  r.webBatch(web('pointerup', 50, 50), web('lostpointercapture', 50, 50), web('pointerleave', 50, 50));
  assert.deepEqual(log.filter(l => l.startsWith('tap')), ['tap m1']);
});

test('Hold: a held piece shows its light and does not turn on release; quick taps never show it', () => {
  const log: string[] = [];
  const a = piece('m1', log), fixed = piece('m2', log, false);
  const r = rig(x => (x < 100 ? a : fixed), log);
  r.native(nat('pointerdown', 50, 50));
  r.wait(HOLD_MS - 1);
  assert.deepEqual(log, ['press m1']);
  r.wait(1);
  // A small slide while held keeps the preview; lifting puts it away without a turn.
  r.native(nat('pointermove', 50 + TAP_SLOP_DP * 2, 50));
  r.native(nat('pointerup', 50 + TAP_SLOP_DP * 2, 50, 0, 0), nat('click', 70, 50, 0, 0), nat('pointerleave', 70, 50, 0, 0));
  assert.deepEqual(log, ['press m1', 'hold on m1', 'hold off m1', 'drop m1']);
  // A piece that cannot move has no preview: a long press is still just a tap on it (it shows its refusal).
  r.native(nat('pointerdown', 150, 50));
  r.wait(HOLD_MS * 2);
  r.native(nat('pointerup', 150, 50, 0, 0), nat('click', 150, 50, 0, 0), nat('pointerleave', 150, 50, 0, 0));
  assert.deepEqual(log.slice(4), ['press m2', 'lift m2', 'tap m2']);
});

test('A quick tap whose lift is handled late (a long frame) is still a tap; a real hold is still a hold', () => {
  const log: string[] = [];
  const a = piece('m1', log);
  const r = rig(() => a, log);
  // Native: the finger was down 120 ms by the touch timestamps, but the lift is handled after the hold timer fired.
  r.native({ ...nat('pointerdown', 50, 50), timestamp: 1000 });
  r.wait(HOLD_MS + 200);
  r.native({ ...nat('pointerup', 50, 50, 0, 0), timestamp: 1120 }, nat('click', 50, 50, 0, 0), nat('pointerleave', 50, 50, 0, 0));
  assert.deepEqual(log.filter(l => !l.startsWith('press')), ['hold on m1', 'hold off m1', 'lift m1', 'tap m1']);
  log.length = 0;
  // Web: the same, by the events' timeStamp.
  r.web({ ...web('pointerdown', 50, 50), timeStamp: 5000 });
  r.wait(HOLD_MS + 200);
  r.webBatch({ ...web('pointerup', 50, 50), timeStamp: 5090 }, web('lostpointercapture', 50, 50));
  assert.deepEqual(log.filter(l => l.startsWith('tap')), ['tap m1']);
  log.length = 0;
  // Held for 600 ms by the timestamps: a preview, no turn.
  r.native({ ...nat('pointerdown', 50, 50), timestamp: 9000 });
  r.wait(HOLD_MS + 200);
  r.native({ ...nat('pointerup', 50, 50, 0, 0), timestamp: 9600 }, nat('pointerleave', 50, 50, 0, 0));
  assert.deepEqual(log.filter(l => !l.startsWith('press')), ['hold on m1', 'hold off m1', 'drop m1']);
});

test('A touch that starts on no piece does nothing, even if it ends on one', () => {
  const log: string[] = [];
  const a = piece('m1', log);
  const r = rig(x => (x < 100 ? a : undefined));
  r.native(nat('pointerdown', 150, 50));
  r.native(nat('pointerup', 95, 50, 0, 0), nat('click', 95, 50, 0, 0), nat('pointerleave', 95, 50, 0, 0));
  r.native(nat('pointerdown', 150, 50));
  r.native(nat('pointerup', 150, 50, 0, 0), nat('click', 150, 50, 0, 0), nat('pointerleave', 150, 50, 0, 0));
  assert.deepEqual(log, []);
});

test('12. One tap on a real board: one turn and one move, however many events the lift brings', () => {
  const level = levels.find(l => l.mirrors.some(m => !m.fixed) && !l.clusters.length && !l.floes.length)!;
  const { pieces, n } = board(level), cam = camera(PHONE, n);
  let state = initialState(level), moves = 0;
  const target = pieces.find(p => p.kind === 'mirror' && !level.mirrors.find(m => m.id === p.id)!.fixed)!;
  const touchable = new Map(pieces.map(p => [p.id, { id: p.id, proxies: p.proxies, tap: () => { state = applyMove(level, state, p.id); moves++; } }]));
  const touch = new BoardTouch({
    pick: (x, y) => { const id = pickAt(pieces, cam, PHONE.W, PHONE.H, x, y)?.target.id; return id ? touchable.get(id) : undefined; },
    press: () => {}, release: () => {}, after: () => () => {}, soon: fn => queueMicrotask(fn),
  });
  const before = state.orientations[target.id] ?? level.mirrors.find(m => m.id === target.id)!.orientation;
  const [x, y] = aimAt(target, cam, PHONE);
  // Native: down, a jittery hold, then the lift with its click and leave, plus a stray duplicate lift.
  for (const e of [nat('pointerdown', x, y), nat('pointermove', x + 1, y), nat('pointermove', x + 2, y - 1), nat('pointerup', x + 2, y - 1, 0, 0),
    nat('click', x + 2, y - 1, 0, 0), nat('pointerleave', x + 2, y - 1, 0, 0), nat('pointerup', x + 2, y - 1, 0, 0)]) touch.handle(e);
  return Promise.resolve().then(() => {
    assert.equal(moves, 1);
    assert.equal(state.orientations[target.id], before ^ 1);
  });
});
