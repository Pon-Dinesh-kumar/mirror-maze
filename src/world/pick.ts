import { BoxGeometry, BufferGeometry, Camera, CylinderGeometry, Intersection, MeshBasicMaterial, Object3D, Raycaster, Vector2, Vector3 } from 'three';

/*
 * Touch selection on the 3D board.
 *
 * The board is seen at a slant through a perspective camera, so the pieces' screen outlines overlap: the top of a mirror
 * covers part of the one standing behind it. Selection therefore works in screen space, in dp (the units touches arrive
 * in), against stand-ins for each piece's visible body:
 *
 * 1. A touch on a piece's visible body selects it. Where two bodies overlap on screen, the one in front (the one seen
 *    there) wins.
 * 2. A touch that lands on no body selects the piece whose outline on screen is closest, if it is within
 *    PICK_TOLERANCE_DP. So a thumb that lands just off a small piece still gets it, while the gap between two pieces is
 *    split down the middle.
 * 3. Near ties go to the piece whose centre is closest to the touch, then to the one nearer the camera, then by id.
 *    The same touch on the same board always selects the same piece.
 *
 * A touch is a tap only if it stays within TAP_SLOP_DP of where it began, ends with a lift (not a cancel), and no second
 * finger joined it. A touch held for HOLD_MS shows the piece's projected light instead of turning it.
 * One touch makes at most one tap.
 */

/** How far (dp) a finger may move before the touch counts as a drag instead of a tap. */
export const TAP_SLOP_DP = 12;
/** How far (dp) outside a piece's visible outline a touch that lands on no piece still selects it. */
export const PICK_TOLERANCE_DP = 22;
/** Outline distances (dp) closer together than this count as a tie, settled by the distance to each piece's centre. */
export const TIE_DP = 1.5;
/** How long a piece must be held before its projected light is shown instead of turning it. */
export const HOLD_MS = 380;
/** The totem is drawn 12 % larger than its carving; its stand-ins are sized for the carving and scaled with it. */
export const TOTEM_SCALE = 1.12;

/** A box (`size` = width, height, depth) or an upright cylinder (`size` = diameter, height, diameter) at `at`. */
export interface ProxyShape { kind: 'box' | 'cylinder'; size: readonly [number, number, number]; at: readonly [number, number, number] }
const box = (w: number, h: number, d: number, y = 0): ProxyShape => ({ kind: 'box', size: [w, h, d], at: [0, y, 0] });
const cylinder = (r: number, h: number, y: number): ProxyShape => ({ kind: 'cylinder', size: [r * 2, h, r * 2], at: [0, y, 0] });

/**
 * Each piece's stand-ins, in the frame of the part of the piece they follow. They trace the solid body as drawn, not
 * its glows, rings or arrows.
 */
export const proxies = {
  /** Mirror: the base (in the piece's root, which scales and rocks) and the framed panel (in the panel, which turns). */
  mirror: { base: cylinder(.45, .14, .07), panel: box(.9, 1.06, .16) },
  /** Floe: the raft and the ice block around its mirror (in the floe's body, which glides and tilts). */
  floe: { raft: box(.9, .18, .9, .09), ice: box(.98, 1.32, .98, .76) },
  /** Cannon (in the piece's own frame, so not turning with its aim): the wide foot, then the body, barrel and rings. */
  cannon: { foot: cylinder(.55, .3, .15), body: cylinder(.45, 1.05, .825) },
  /** Totem (in its carved body, which faces its stones, inside the root scaled by TOTEM_SCALE): plinth, faces, crown. */
  totem: { plinth: cylinder(.44, .14, .07), faces: box(.5, 1.02, .46, .65), crown: box(.56, .4, .56, 1.32) },
} as const;

/** Unit shapes, scaled to each stand-in. Never drawn. */
export const proxyGeometry: Record<ProxyShape['kind'], BufferGeometry> = { box: new BoxGeometry(1, 1, 1), cylinder: new CylinderGeometry(.5, .5, 1, 16) };
export const proxyMaterial = new MeshBasicMaterial();

/** Points on each unit shape's outline: a box's corners, a cylinder's rims. Their screen hull is the shape's outline. */
const outlines: Record<ProxyShape['kind'], Vector3[]> = {
  box: [-.5, .5].flatMap(x => [-.5, .5].flatMap(y => [-.5, .5].map(z => new Vector3(x, y, z)))),
  cylinder: [-.5, .5].flatMap(y => Array.from({ length: 12 }, (_, i) => new Vector3(Math.cos(i * Math.PI / 6) * .5, y, Math.sin(i * Math.PI / 6) * .5))),
};

/** A selectable piece: a stable id, and the stand-ins posed with it (any may be missing while it mounts). */
export interface PickTarget {
  readonly id: string;
  readonly proxies: readonly { readonly current: Object3D | null }[];
}
export interface Pick<T> {
  target: T;
  /** True when the touch landed on the piece's visible body. */
  direct: boolean;
  /** Distance (dp) from the touch to the piece's outline on screen: 0 for a direct hit. */
  gap: number;
}

const raycaster = new Raycaster();
const ndc = new Vector2();
const hits: Intersection[] = [];
const point = new Vector3();
const lo = new Vector3(), hi = new Vector3(), eye = new Vector3();
// Scratch space for one shape's screen outline: up to 32 points, their hull, and per-candidate scores.
const xs = new Float64Array(32), ys = new Float64Array(32), order: number[] = [], hull: number[] = [];
const gaps: number[] = [], centres: number[] = [], depths: number[] = [];

/**
 * The piece a touch at (x, y) selects, in dp from the canvas's top left, on a canvas `width` x `height` dp, as `camera`
 * renders it (its world matrices as last rendered). Undefined when the touch is on no piece and not close to one.
 */
export function pickAt<T extends PickTarget>(targets: readonly T[], camera: Camera, width: number, height: number, x: number, y: number,
  tolerance = PICK_TOLERANCE_DP): Pick<T> | undefined {
  if (!(width > 0 && height > 0)) return undefined;
  // 1. The visible body under the finger, nearest the camera first.
  ndc.set(x / width * 2 - 1, -(y / height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  let hit: T | undefined, hitAt = Infinity;
  for (const t of targets) {
    for (const p of t.proxies) {
      if (!p.current) continue;
      hits.length = 0;
      raycaster.intersectObject(p.current, false, hits);
      const d = hits[0]?.distance;
      if (d === undefined) continue;
      if (d < hitAt - 1e-6 || (d <= hitAt + 1e-6 && hit && t.id < hit.id)) { hit = t; hitAt = Math.min(d, hitAt); }
    }
  }
  hits.length = 0;
  if (hit) return { target: hit, direct: true, gap: 0 };
  // 2. The closest outline on screen, within the tolerance.
  let least = Infinity;
  camera.getWorldPosition(eye);
  gaps.length = centres.length = depths.length = 0;
  for (const t of targets) {
    let gap = Infinity, n = 0;
    lo.set(Infinity, Infinity, Infinity); hi.set(-Infinity, -Infinity, -Infinity);
    for (const p of t.proxies) {
      const o = p.current;
      if (!o) continue;
      const shape = (o as Object3D & { geometry?: BufferGeometry }).geometry === proxyGeometry.cylinder ? outlines.cylinder : outlines.box;
      let count = 0;
      for (const v of shape) {
        point.copy(v).applyMatrix4(o.matrixWorld);
        lo.min(point); hi.max(point);
        point.project(camera);
        xs[count] = (point.x + 1) / 2 * width;
        ys[count] = (1 - point.y) / 2 * height;
        count++;
      }
      gap = Math.min(gap, outlineGap(count, x, y));
      n++;
    }
    if (!n) { gaps.push(Infinity); centres.push(Infinity); depths.push(Infinity); continue; }
    point.addVectors(lo, hi).multiplyScalar(.5);
    depths.push(point.distanceTo(eye));
    point.project(camera);
    centres.push(Math.hypot((point.x + 1) / 2 * width - x, (1 - point.y) / 2 * height - y));
    gaps.push(gap);
    least = Math.min(least, gap);
  }
  if (least > tolerance) return undefined;
  // 3. Among the near-tied closest, the nearest centre, then the nearer piece, then the lowest id.
  let best = -1;
  for (let i = 0; i < targets.length; i++) {
    if (gaps[i]! > least + TIE_DP || gaps[i]! > tolerance) continue;
    if (best < 0) { best = i; continue; }
    const dc = centres[i]! - centres[best]!, dd = depths[i]! - depths[best]!;
    if (dc < 0 || (dc === 0 && (dd < 0 || (dd === 0 && targets[i]!.id < targets[best]!.id)))) best = i;
  }
  return { target: targets[best]!, direct: false, gap: gaps[best]! };
}

/** Distance from (x, y) to the convex hull of the first `count` points in xs/ys: 0 inside it. */
function outlineGap(count: number, x: number, y: number) {
  // Andrew's monotone chain, counter-clockwise in screen space.
  order.length = 0;
  for (let i = 0; i < count; i++) order.push(i);
  order.sort((a, b) => xs[a]! - xs[b]! || ys[a]! - ys[b]!);
  hull.length = 0;
  const cross = (o: number, a: number, b: number) => (xs[a]! - xs[o]!) * (ys[b]! - ys[o]!) - (ys[a]! - ys[o]!) * (xs[b]! - xs[o]!);
  for (const i of order) {
    while (hull.length >= 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, i) <= 0) hull.pop();
    hull.push(i);
  }
  const lower = hull.length + 1;
  for (let k = order.length - 2; k >= 0; k--) {
    const i = order[k]!;
    while (hull.length >= lower && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, i) <= 0) hull.pop();
    hull.push(i);
  }
  hull.pop();
  if (hull.length < 3) return Math.hypot(xs[hull[0]!]! - x, ys[hull[0]!]! - y);
  let inside = true, gap = Infinity;
  for (let k = 0; k < hull.length; k++) {
    const a = hull[k]!, b = hull[(k + 1) % hull.length]!;
    const ex = xs[b]! - xs[a]!, ey = ys[b]! - ys[a]!, px = x - xs[a]!, py = y - ys[a]!;
    if (ex * py - ey * px < 0) inside = false;
    const len = ex * ex + ey * ey;
    const s = len > 0 ? Math.max(0, Math.min(1, (px * ex + py * ey) / len)) : 0;
    gap = Math.min(gap, Math.hypot(px - ex * s, py - ey * s));
  }
  return inside ? 0 : gap;
}

/** One pointer event as the canvas reports it: a DOM pointer event on the web, a touch on native (see Canvas.native). */
export interface RawPointer {
  type: string;
  offsetX: number;
  offsetY: number;
  pointerId?: number;
  /** Native: every finger on the screen (the lifting one excluded on release). */
  touches?: ArrayLike<unknown>;
  /** Web: the first pointer of its kind. */
  isPrimary?: boolean;
  /** Web: the mouse button; anything but the main one is ignored. */
  button?: number;
  /** When the finger actually moved (ms): `timeStamp` on the web, `timestamp` on native. */
  timeStamp?: number;
  timestamp?: number;
}

/** What the touch controller needs from its surroundings; the board supplies the real ones, the tests their own. */
export interface TouchHost<T> {
  /** The piece a touch at (x, y) selects (see pickAt). */
  pick(x: number, y: number): T | undefined;
  /** Feedback: a finger came down on `target`, or the touch on it ended (`tapped`: it became a tap). */
  press(target: T): void;
  release(target: T, tapped: boolean): void;
  /** Runs `fn` after `ms` (the hold timer), returning a cancel. */
  after(ms: number, fn: () => void): () => void;
  /** Runs `fn` once the event being handled and every event dispatched with it are done. */
  soon(fn: () => void): void;
}
export interface Touchable {
  /** The piece's own response to a tap: a turn, or a refusal it shows itself. */
  tap(): void;
  /** Shows (or hides) where the piece's light would go, for a press held HOLD_MS. Pieces that cannot move have none. */
  hold?: (on: boolean) => void;
}

/**
 * Turns the canvas's raw pointer events into at most one tap per touch, on the piece the touch began on.
 *
 * Native touches arrive from React Native's responder: a lift is `pointerup` (with `click` after it), the last lift is
 * followed by `pointerleave`, and a touch taken away (a system gesture, the app sent away) by `lostpointercapture`. A
 * cancelled touch is also reported as `pointerup` first, in the same dispatch. The tap therefore fires only once that
 * dispatch is over, and only if no cancel came with it. The web reports `pointercancel` instead, and its
 * `lostpointercapture` follows every touch's lift (the browser releasing the touch's implicit capture), so there it
 * only means a cancel while the finger is still down.
 */
export class BoardTouch<T extends Touchable> {
  private phase: 'idle' | 'pressed' | 'void' = 'idle';
  private pointer = -1;
  private x0 = 0;
  private y0 = 0;
  private held = false;
  private downAt: number | undefined;
  private readonly fingers = new Set<number>();
  private target: T | undefined;
  private pending: T | undefined;
  private stopHold: (() => void) | undefined;

  constructor(private readonly host: TouchHost<T>, private readonly slop = TAP_SLOP_DP, private readonly holdMs = HOLD_MS) {}

  /** True while one finger rests on the board, still a possible tap or hold. */
  get pressing() { return this.phase === 'pressed'; }

  handle(e: RawPointer) {
    switch (e.type) {
      case 'pointerdown': return this.down(e);
      case 'pointermove': return this.move(e);
      case 'pointerup': return this.up(e);
      case 'pointercancel': return this.cancel();
      // Native events carry `touches`; DOM pointer events never do.
      case 'lostpointercapture': if (this.phase === 'pressed' || e.touches) this.cancel(); return;
      // A finger that leaves the canvas while still down is not a tap. After a lift this is a no-op.
      case 'pointerleave': if (this.phase === 'pressed') this.cancel(); return;
    }
  }

  private down(e: RawPointer) {
    if (e.button !== undefined && e.button > 0) return;
    const id = e.pointerId ?? -1, touches = e.touches?.length;
    // The first finger down: anything remembered from an earlier touch whose end was never reported is stale.
    if (touches === 1 || e.isPrimary === true) this.fingers.clear();
    this.fingers.add(id);
    if (this.fingers.size > 1 || (touches ?? 1) > 1) {
      // A second finger: a gesture, never a tap.
      this.abandon();
      this.phase = 'void';
      return;
    }
    this.abandon();
    this.phase = 'pressed';
    this.pointer = id;
    this.x0 = e.offsetX; this.y0 = e.offsetY;
    this.held = false;
    this.downAt = e.timeStamp ?? e.timestamp;
    const target = this.target = this.host.pick(e.offsetX, e.offsetY);
    if (!target) return;
    this.host.press(target);
    if (target.hold) this.stopHold = this.host.after(this.holdMs, () => {
      this.stopHold = undefined;
      if (this.phase !== 'pressed' || this.target !== target) return;
      this.held = true;
      target.hold?.(true);
    });
  }

  private move(e: RawPointer) {
    if (this.phase !== 'pressed' || (e.pointerId ?? -1) !== this.pointer || this.held) return;
    if (Math.hypot(e.offsetX - this.x0, e.offsetY - this.y0) > this.slop) { this.abandon(); this.phase = 'void'; }
  }

  private up(e: RawPointer) {
    const id = e.pointerId ?? -1;
    this.fingers.delete(id);
    if (this.phase === 'pressed' && id === this.pointer) {
      const target = this.target;
      // A quick tap whose lift was handled late (a long frame) can find the hold timer already fired. The events' own
      // times say how long the finger was down: under HOLD_MS it is a tap, and the preview shown meanwhile goes away.
      const upAt = e.timeStamp ?? e.timestamp;
      if (this.held && this.downAt !== undefined && upAt !== undefined && upAt - this.downAt < this.holdMs) {
        this.held = false;
        target?.hold?.(false);
      }
      if (this.held || !target || Math.hypot(e.offsetX - this.x0, e.offsetY - this.y0) > this.slop) this.abandon();
      else {
        this.clearHold();
        this.target = undefined;
        this.pending = target;
        this.host.release(target, true);
        this.host.soon(() => {
          if (this.pending !== target) return;
          this.pending = undefined;
          target.tap();
        });
      }
      this.phase = 'void';
    }
    if (!this.fingers.size || e.touches?.length === 0) { this.fingers.clear(); this.phase = 'idle'; }
  }

  /** The touch was taken away: nothing it began happens, including a tap whose lift was reported with the cancel. */
  cancel() {
    this.pending = undefined;
    this.abandon();
    this.fingers.clear();
    this.phase = 'idle';
  }

  /** Ends the current touch without a tap: stops the hold timer, hides a shown preview and the selection. */
  private abandon() {
    this.clearHold();
    const target = this.target;
    this.target = undefined;
    if (!target) return;
    if (this.held) { this.held = false; target.hold?.(false); }
    this.host.release(target, false);
  }

  private clearHold() {
    this.stopHold?.();
    this.stopHold = undefined;
  }
}
