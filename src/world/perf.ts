/**
 * On-screen performance readout for diagnostic builds: set this to true to build one. It answers, on a real phone,
 * whether a frame is bound by JavaScript (scene traversal and GL command encoding) or by the GPU (time spent waiting for
 * the GL thread), and whether level changes rebuild the GL context or recompile shaders. A source constant rather than an
 * environment variable, so a cached bundle can never carry the readout into a normal build.
 */
export const PERF_HUD: boolean = false;

export const perf = {
  /** Frames presented, and the JS / GPU-wait milliseconds they took in total (the readout averages per second). */
  frames: 0, jsMs: 0, waitMs: 0,
  /** When the current frame's first callback ran. */
  frameStart: 0,
  /** Longest gap between two frames since the readout last looked: one huge gap means a stall, not a slow frame rate. */
  maxGapMs: 0,
  /** Draw calls in the last frame, including the shadow pass. */
  draws: 0,
  /** GL contexts created this session: more than one means the 3D scene was torn down and rebuilt. */
  contexts: 0,
  /** Compiled shader programs alive. */
  programs: 0,
  /** Reflection map per world: 'ok', 'plain' (rebuilt without the nebula) or 'off' (this GPU rendered it black). */
  env: [] as string[],
  /** How long the last board took from mounting to its first presented frame, in ms (-1 before the first). */
  loadMs: -1,
  /** The 3D canvas size in points, to compare with the window and app frame sizes (the journey map must match it). */
  canvas: '-',
};
