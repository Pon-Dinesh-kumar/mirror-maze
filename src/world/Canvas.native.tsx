import React, { ComponentProps, useEffect } from 'react';
import { Canvas as NativeCanvas, useThree } from '@react-three/fiber/native';
import { perf, PERF_HUD } from './perf';
export { createPortal, useFrame, useThree } from '@react-three/fiber/native';

/** The expo-gl extensions on its WebGL context. */
interface ExpoContext { endFrameEXP(): void; flushEXP(): void }

/** React Native's task queue (new architecture), which React also schedules its work on. */
declare const nativeRuntimeScheduler: {
  unstable_scheduleCallback(priority: number, callback: () => void): unknown;
  unstable_cancelCallback(task: unknown): void;
  unstable_NormalPriority: number;
} | undefined;

/**
 * Runs the render loop as normal-priority tasks instead of inside requestAnimationFrame.
 *
 * React Native's scheduler runs tasks in deadline order. Frame callbacks are native work with a 0 ms deadline, while
 * React's non-urgent updates (anything not set straight from a touch: timers, the 3D scene's own React tree, the level
 * ready signal) get 5 s. When frames take the whole vsync interval, as on 120 Hz phones, every React update therefore
 * waited 5 s: a tap played its sound at once but the mirror turned seconds later, and each level stayed hidden behind its
 * loading cover. Queued as normal tasks, frames and React updates take turns in order. Same frames, same rate.
 */
function FairFrameLoop() {
  const get = useThree(s => s.get);
  useEffect(() => {
    const native = typeof nativeRuntimeScheduler === 'undefined' ? undefined : nativeRuntimeScheduler;
    const start = performance.now();
    let alive = true, queued = false, task: unknown, raf = 0;
    const frame = () => {
      queued = false;
      const state = get();
      // frameloop "never": the clock follows the timestamp given here, in seconds.
      if (alive && state.internal.active) state.advance((performance.now() - start) / 1000);
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      // At most one frame waits in the queue; a frame that is still waiting renders the newest state when it runs.
      if (queued) return;
      queued = true;
      task = native ? native.unstable_scheduleCallback(native.unstable_NormalPriority, frame) : setTimeout(frame, 0);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      if (!queued) return;
      if (native) native.unstable_cancelCallback(task); else clearTimeout(task as ReturnType<typeof setTimeout>);
    };
  }, [get]);
  return null;
}

// Never call setDpr on native. expo-gl allocates its drawing buffer once, at the view's native pixel size, so the renderer
// must run at PixelRatio.get() (R3F configures exactly that). A lower ratio does not shrink the buffer; it only shrinks the
// GL viewport inside it, which drew the scene into the bottom-left corner of the screen.
export function Canvas({ onCreated, children, ...props }: ComponentProps<typeof NativeCanvas>) {
  return <NativeCanvas {...props} frameloop="never" onCreated={state => {
    const renderer = state.gl;
    const context = renderer.getContext() as unknown as ExpoContext;
    // R3F presents after every render() call, but three also renders off-screen passes (environment maps) through
    // render(). Presenting those showed an undrawn, empty frame.
    const present = context.endFrameEXP.bind(context);
    context.endFrameEXP = () => { if (renderer.getRenderTarget() === null) present(); };
    // expo-gl replays JS-issued GL calls on its own GL thread and never makes JS wait. When the GPU is slower than the
    // frame loop (most phones at full resolution), frames pile up in that queue and every tap appears seconds late.
    // flushEXP() blocks until the GL thread has caught up, so at most one frame is ever queued.
    const render = renderer.render.bind(renderer);
    renderer.render = (scene, camera) => {
      if (renderer.getRenderTarget() !== null) { render(scene, camera); return; }
      if (!PERF_HUD) { context.flushEXP(); render(scene, camera); return; }
      const waitStart = performance.now();
      context.flushEXP();
      const encodeStart = performance.now();
      render(scene, camera);
      const end = performance.now();
      perf.frames++;
      perf.waitMs += encodeStart - waitStart;
      perf.jsMs += (waitStart - perf.frameStart) + (end - encodeStart);
      perf.draws = renderer.info.render.calls;
      perf.programs = renderer.info.programs?.length ?? 0;
      const size = state.get().size;
      perf.canvas = `${Math.round(size.width)}x${Math.round(size.height)}`;
    };
    // Shader error checks are blocking round trips to the GL thread for every new program; keep them in development only.
    renderer.debug.checkShaderErrors = __DEV__;
    perf.contexts++;
    onCreated?.(state);
  }}>{children}<FairFrameLoop /></NativeCanvas>;
}
