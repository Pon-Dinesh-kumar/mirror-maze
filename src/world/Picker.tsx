import React, { createContext, RefObject, useContext, useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, CircleGeometry, Group, MeshBasicMaterial, Object3D, RingGeometry, Vector3 } from 'three';
import { useFrame, useThree } from './Canvas';
import { BoardTouch, pickAt, PickTarget, proxyGeometry, proxyMaterial, ProxyShape, RawPointer, Touchable } from './pick';

/*
 * One touch handler for the whole board (see pick.ts for the selection policy). Pieces register what a tap on them does
 * and the invisible stand-ins that trace their bodies; the board listens to the canvas's pointer events, selects the
 * piece, shows a glow at its foot while the finger is down, and passes it at most one tap. Nothing runs between touches.
 */

/** What a selectable piece registers. */
export interface PickSpec extends Touchable {
  id: string;
  /** Radius of the selection glow at the piece's foot, in board cells. */
  ring: number;
}
interface Entry extends PickTarget, Touchable {
  readonly anchor: RefObject<Object3D | null>;
  readonly ring: number;
}
interface Registry { list: Entry[] }
const PickContext = createContext<Registry | undefined>(undefined);

/** Registers a piece with the board's touch handler while `spec` is given (only while the board takes taps). */
export function usePickTarget(spec: PickSpec | undefined, anchor: RefObject<Object3D | null>, parts: readonly RefObject<Object3D | null>[]) {
  const board = useContext(PickContext);
  const latest = useRef(spec);
  latest.current = spec;
  const id = spec?.id;
  // The refs are stable, so the first render's are kept; the spec is read when a touch needs it.
  const kept = useRef({ anchor, parts }).current;
  useEffect(() => {
    if (!board || id === undefined) return;
    const entry: Entry = {
      id,
      proxies: kept.parts,
      anchor: kept.anchor,
      get ring() { return latest.current?.ring ?? .6; },
      tap: () => latest.current?.tap(),
      get hold() { return latest.current?.hold; },
    };
    board.list.push(entry);
    return () => { board.list = board.list.filter(e => e !== entry); };
  }, [board, id, kept]);
}

const proxyProps = new Map<ProxyShape, object>();
/** Props for an invisible stand-in mesh: `<mesh ref={...} {...proxyMesh(proxies.mirror.base)} />`. */
export function proxyMesh(shape: ProxyShape) {
  let p = proxyProps.get(shape);
  if (!p) proxyProps.set(shape, p = {
    geometry: proxyGeometry[shape.kind], material: proxyMaterial, position: [...shape.at], scale: [...shape.size], visible: false, dispose: null,
  });
  return p;
}

const POINTER_TYPES = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave'] as const;
interface PointerSource {
  addEventListener(type: string, listener: (e: never) => void): void;
  removeEventListener(type: string, listener: (e: never) => void): void;
}

const ringGeo = new RingGeometry(.82, 1, 48);
const fillGeo = new CircleGeometry(.82, 48);
const at = new Vector3();
/** Glow timings (ms): fade in on press, fade away after a cancel, swell and fade after a tap. */
const IN_MS = 70, OUT_MS = 160, TAP_MS = 300;

/**
 * Takes the board's touches while `active`, and draws the selection glow in `color`. Wraps the board's pieces so they can
 * register.
 */
export function PickBoard({ active, color, children }: { active: boolean; color: string; children: React.ReactNode }) {
  const registry = useMemo<Registry>(() => ({ list: [] }), []);
  const get = useThree(s => s.get);
  const source = useThree(s => s.events.connected) as PointerSource | undefined;
  const glow = useRef<Group>(null);
  const mats = useMemo(() => [.85, .16].map(opacity => new MeshBasicMaterial({
    color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false, userData: { opacity },
  })), [color]);
  useEffect(() => () => mats.forEach(m => m.dispose()), [mats]);
  // The glow's state: which piece, since when (ms), and how the touch on it ended.
  const fx = useMemo(() => ({ target: undefined as Entry | undefined, since: 0, phase: 'off' as 'off' | 'on' | 'tap' | 'out', from: 0 }), []);
  const touch = useMemo(() => new BoardTouch<Entry>({
    pick: (x, y) => {
      const { camera, size } = get();
      return pickAt(registry.list, camera, size.width, size.height, x, y)?.target;
    },
    press: target => { fx.target = target; fx.phase = 'on'; fx.since = performance.now(); fx.from = 0; },
    release: (target, tapped) => {
      if (fx.target !== target) return;
      fx.from = mats[0]!.opacity / .85;
      fx.phase = tapped ? 'tap' : 'out';
      fx.since = performance.now();
    },
    after: (ms, fn) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); },
    soon: fn => queueMicrotask(fn),
  }), [get, registry, fx, mats]);
  useEffect(() => {
    if (!active || !source?.addEventListener) return;
    const on = (e: RawPointer) => touch.handle(e);
    for (const type of POINTER_TYPES) source.addEventListener(type, on);
    return () => {
      for (const type of POINTER_TYPES) source.removeEventListener(type, on);
      touch.cancel();
    };
  }, [active, source, touch]);
  useFrame(() => {
    const g = glow.current;
    if (!g) return;
    if (fx.phase === 'off') { if (g.visible) g.visible = false; return; }
    const target = fx.target, anchor = target?.anchor.current;
    const age = performance.now() - fx.since;
    let k = 0, swell = 1;
    if (fx.phase === 'on') k = Math.min(1, age / IN_MS);
    else if (fx.phase === 'tap') { const a = Math.min(1, age / TAP_MS); k = Math.max(fx.from, .6) * (1 - a) * (1 - a); swell = 1 + .2 * a; }
    else k = fx.from * Math.max(0, 1 - age / OUT_MS);
    if (!anchor || !g.parent || (fx.phase !== 'on' && k <= 0)) { fx.phase = 'off'; fx.target = undefined; g.visible = false; return; }
    anchor.getWorldPosition(at);
    g.parent.worldToLocal(at);
    g.position.set(at.x, at.y + .025, at.z);
    g.scale.setScalar(target.ring * swell);
    g.visible = true;
    for (const m of mats) m.opacity = (m.userData.opacity as number) * k;
  });
  return <PickContext.Provider value={active ? registry : undefined}>
    {children}
    <group ref={glow} visible={false}>
      <mesh geometry={ringGeo} material={mats[0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2} dispose={null} />
      <mesh geometry={fillGeo} material={mats[1]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2} dispose={null} />
    </group>
  </PickContext.Provider>;
}
