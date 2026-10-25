import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';

const MIN_DPR = 1.1;

/**
 * Web only: trades pixel density for frame rate. The ratio is owned by the Canvas (`dpr` / `onChange`) and passed back
 * to it as its `dpr` prop; otherwise R3F resets the ratio to its default on every Canvas re-render.
 */
export function AdaptiveResolution({ maxDpr, dpr, onChange }: { maxDpr: number; dpr: number; onChange: (dpr: number) => void }) {
  const live = useRef(dpr);
  live.current = dpr;
  const elapsed = useRef(0);
  const frames = useRef(0);
  const slowWindows = useRef(0);
  const fastSeconds = useRef(0);

  useEffect(() => {
    const next = Math.min(maxDpr, Math.max(MIN_DPR, dpr));
    if (Math.abs(next - dpr) > .01) onChange(next);
  }, [maxDpr, dpr, onChange]);

  useFrame((_, delta) => {
    elapsed.current += delta;
    frames.current++;
    if (elapsed.current < 1.5) return;

    const fps = frames.current / elapsed.current;
    const current = live.current;
    if (fps < 36) {
      slowWindows.current++;
      fastSeconds.current = 0;
      if (slowWindows.current >= 2 && current > MIN_DPR) {
        const next = Math.max(MIN_DPR, Math.round((current - .1) * 100) / 100);
        if (next < current) onChange(next);
        slowWindows.current = 0;
      }
    } else {
      slowWindows.current = 0;
      if (fps >= 54 && current < maxDpr) {
        fastSeconds.current += elapsed.current;
        if (fastSeconds.current >= 8) {
          const next = Math.min(maxDpr, Math.round((current + .05) * 100) / 100);
          if (next > current) onChange(next);
          fastSeconds.current = 0;
        }
      } else fastSeconds.current = 0;
    }
    elapsed.current = 0;
    frames.current = 0;
  });

  return null;
}
