import { PerspectiveCamera, Vector3 } from 'three';

/*
 * How the play camera frames the board. Shared by the camera director and by the touch-selection tests, so the tests
 * pick against exactly the projection a player sees.
 */

/** The play camera's lens. */
export const CAMERA_FOV = 38;
/** Cinematic tilt, and the near top-down view for reading big boards (still slightly tilted so pieces keep their depth). */
export const GAME_DIR = new Vector3(.12, .82, .56).normalize();
export const TOP_DIR = new Vector3(.04, .97, .24).normalize();

const origin = new Vector3(0, 0, 0);
const corner = new Vector3();

/**
 * Finds the camera distance and vertical offset that make the board fill the space between the HUD bars.
 * Projects the board's bounding corners, so the result is tight for any screen shape.
 */
export function frameBoard(cam: PerspectiveCamera, n: number, W: number, H: number, top: number, bottom: number, dir: Vector3) {
  if (W <= 0 || H <= 0) return { d: n * 2.2 + 4, offset: 0 };
  const half = n / 2 + .1;
  const regionH = Math.max(120, H - top - bottom);
  let d = n * 2.2 + 4;
  cam.aspect = W / H;
  cam.clearViewOffset();
  cam.updateProjectionMatrix();
  let minY = 0, maxY = 0;
  for (let iter = 0; iter < 4; iter++) {
    cam.position.copy(dir).multiplyScalar(d);
    cam.lookAt(origin);
    cam.updateMatrixWorld();
    let minX = 1e9, maxX = -1e9;
    minY = 1e9; maxY = -1e9;
    for (const x of [-half, half]) for (const z of [-half, half]) for (const y of [-.7, 1.7]) {
      corner.set(x, y, z).project(cam);
      minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
    }
    // A little margin so the idle drift and tap punches never push the board under the HUD.
    const needX = (maxX - minX) / 2 / .95;
    const needY = (maxY - minY) / 2 / (regionH / H * .95);
    d *= Math.max(needX, needY);
  }
  // Pixel shift that puts the board's projected centre in the middle of the free region.
  const centerPx = (1 - (minY + maxY) / 2) / 2 * H;
  const regionCenter = top + regionH / 2;
  return { d, offset: centerPx - regionCenter };
}

/** How much further back cinematic shots stand on a narrow (portrait) screen, so their subjects stay in frame. */
export const portraitPull = (aspect: number) => Math.min(1.75, Math.max(1, .7 / aspect));

const probe = new PerspectiveCamera(CAMERA_FOV, 1, .1, 900);
const ALL_AXES = new Vector3(1, 1, 1), step = new Vector3();
/**
 * For a cinematic shot of the board: how many times further from `target`, along the line to `eye`, the camera must
 * stand for the whole board (size `n`) to sit inside `box` on a W x H screen (normalised device coordinates: within
 * ±`x` sideways, between `bottom` and `top`). 1 when it already does. Moving along the line of sight keeps the shot's
 * angle and composition; only its distance changes. `along` limits the move to some axes (1 moves, 0 holds), for a
 * shot that must back away without sliding sideways into the scenery.
 */
export function boardFit(n: number, W: number, H: number, eye: Vector3, target: Vector3, box: { x: number; bottom: number; top: number },
  along = ALL_AXES) {
  if (W <= 0 || H <= 0) return 1;
  probe.aspect = W / H;
  probe.updateProjectionMatrix();
  const half = n / 2 + .1;
  const fits = (s: number) => {
    probe.position.copy(eye).sub(target).multiply(step.copy(along).multiplyScalar(s - 1).addScalar(1)).add(target);
    probe.lookAt(target);
    probe.updateMatrixWorld();
    for (const x of [-half, half]) for (const z of [-half, half]) for (const y of [-.7, 1.7]) {
      corner.set(x, y, z).project(probe);
      if (Math.abs(corner.x) > box.x || corner.y < box.bottom || corner.y > box.top) return false;
    }
    return true;
  };
  if (fits(1)) return 1;
  let lo = 1, hi = 3;
  if (!fits(hi)) return hi;
  for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
  return hi;
}

/** A camera posed as the play camera rests on a board of size `n` (no entrance sweep, idle drift or tap punch). */
export function restingCamera(n: number, W: number, H: number, top: number, bottom: number, view: 'tilt' | 'top' = 'tilt') {
  const cam = new PerspectiveCamera(CAMERA_FOV, W / H, .1, 900);
  const dir = view === 'top' ? TOP_DIR : GAME_DIR;
  const { d, offset } = frameBoard(cam, n, W, H, top, bottom, dir);
  cam.position.copy(dir).multiplyScalar(d);
  cam.lookAt(origin);
  cam.setViewOffset(W, H, 0, offset, W, H);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}
