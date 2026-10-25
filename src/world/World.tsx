import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { AdditiveBlending, CatmullRomCurve3, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  OrthographicCamera, PerspectiveCamera, PMREMGenerator, Scene, SphereGeometry, Sprite, Texture, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three';
import { Canvas, useFrame, useThree } from './Canvas';
import { SceneBoundary } from './SceneBoundary';
import { looks, Look } from './look';
import { boardFit, CAMERA_FOV, frameBoard, GAME_DIR, portraitPull, TOP_DIR } from './framing';
import { BoardBody, BoardClock } from './Board';
import { BlockerPiece, HintArrow, MirrorPiece, PortalPiece, SplitterPiece } from './Entities';
import { Beam, BEAM_Y, BeamClock, divergence, GhostBeam, newAbyss, segmentsOf } from './Beam';
import { AbyssRun, DevourerPiece, FloePiece, FloeTrack, GatePiece, SealPiece, sealColors } from './Modifiers';
import { AbyssEffects } from './AbyssEffects';
import { absorptionOf, abyssPose, PULL, PULL_AT, voidFall } from './abyss';
import { boardShake, ClusterGuides, ClusterRig, clusterColors, ClusterStones, newPose, newTurnClock, poseAt, rigLocal, TotemPiece, TURN_IMPACT, TurnClock,
  TURN_SECONDS, UNDO_SECONDS, WAKE } from './Totems';
import { CHARGE_TIME, CrystalPiece, WinClock } from './Crystal';
import { LightSource } from './Sources';
import { PickBoard } from './Picker';
import { Amulet } from './Amulet';
import { gemGeometry, glowTexture, heartGeometry, skyMaterial } from './fx';
import { ShaderClock, SkyDome } from './env/common';
import { SkyTemples } from './env/Sky';
import { Rainforest, Storm } from './env/Rainforest';
import { Desert } from './env/Desert';
import { IceAge } from './env/IceAge';
import { EyeState, TheVoid } from './env/Void';
import { PerformanceStats } from './PerformanceStats';
import { IslandPrewarm, MapLayer } from './map/MapLayer';
import { perf, PERF_HUD } from './perf';
import { boardOf, canRotate, clipToCrystals, clusterAt, floeCell, footprint, glide, key, placeOf, replay, traceState, turnBlocks, turnLeft, turnRight,
  turnsOf } from '../game/engine';
import { Cluster, Direction, Emitter, Level, Mirror, PlayState, Point, Trace } from '../game/types';
import { audio } from '../services/audio';
import type { MapScroll } from '../game/mapLayout';
import type { Progress } from '../game/progress';
import { chapters } from '../game/chapters';

export type WorldMode = 'splash' | 'menu' | 'map' | 'prologue' | 'intro' | 'game' | 'complete' | 'fail' | 'outro' | 'forge' | 'ending';
export type { MapScroll } from '../game/mapLayout';
export interface WorldProps {
  chapter: number; mode: WorldMode; level: Level; state: PlayState; trace: Trace; boardKey: string;
  hint?: string; onTap?: (id: string) => void; onBlocked?: () => void;
  /** While a piece is held: the light as it would run after that tap, and the held piece. */
  preview?: Trace;
  previewId?: string;
  /** A piece is held (its id) or released (undefined). Must be stable. */
  onPreview?: (id: string | undefined) => void;
  /** Screen pixels reserved by the HUD above and below the board. */
  insets: { top: number; bottom: number }; dusk?: number;
  hearts: number[]; forging?: number; mapScroll?: MapScroll;
  /** Saved level results; the journey map's islands and crystals show them. */
  progress?: Progress;
  /** Play camera: cinematic tilt or near top-down. */
  view?: 'tilt' | 'top';
  /** Called with `boardKey` once that board has been drawn on screen, so a loading cover can lift. Must be stable. */
  onBoardReady?: (boardKey: string) => void;
  /** Called when a totem's stones hit home after a tap: the moment the new light may be shown. Must be stable. */
  onTurnDone?: () => void;
  /** Called once when a black hole has finished swallowing the board's light: the moment the defeat may be shown. Must be stable. */
  onDevourDone?: () => void;
}

const sunsetColor = new Color('#ff6a3a');
const noop = () => undefined;
/**
 * A new board spends its first frames compiling shaders and uploading meshes, which can stall a phone for a moment.
 * It stays hidden (and its entrance animation waits) for this many frames; by the last one the first has been presented.
 */
const WARMUP_FRAMES = 3;
/** When the current board finished warming up (clock seconds), or -1 while it is still warming up. */
interface StageReady { at: number }

/** Diagnostic builds: marks where each frame's work starts, for the on-screen readout. Runs before every other callback. */
function FrameStart() {
  useFrame(() => {
    const now = performance.now();
    if (perf.frameStart > 0) perf.maxGapMs = Math.max(perf.maxGapMs, now - perf.frameStart);
    perf.frameStart = now;
  }, -1000);
  return null;
}

/**
 * Keeps every compiled shader program for the whole session. three deletes a program once the last material using it is
 * disposed, so every level recompiled its board's shaders (seconds on a phone). The set of distinct programs is small
 * and fixed, so keeping them costs little memory.
 */
function KeepShaders() {
  const gl = useThree(s => s.gl);
  const kept = useMemo(() => new WeakSet<object>(), [gl]);
  useFrame(() => {
    const programs = gl.info.programs;
    if (!programs) return;
    // New programs are appended, and kept ones never leave, so only the unkept tail needs a look.
    for (let i = programs.length - 1; i >= 0; i--) {
      const program = programs[i]!;
      if (kept.has(program)) break;
      kept.add(program);
      program.usedTimes++;
    }
  });
  return null;
}
type EnvTarget = ReturnType<PMREMGenerator['fromScene']>;
/** Each world's reflection map; null when this device could not build a usable one, so reflections stay off. */
const environmentTargets = new WeakMap<object, Map<Look, EnvTarget | null>>();
const environmentGenerators = new WeakMap<object, PMREMGenerator>();

/** Renders the world's sky (and sun) into a reflection map. `nebula: false` leaves out the Void's nebula clouds. */
function buildEnvironment(pm: PMREMGenerator, look: Look, nebula: boolean): EnvTarget {
  const s = new Scene();
  const sky = skyMaterial();
  const skyGeometry = new SphereGeometry(10, 32, 16);
  const sunGeometry = new SphereGeometry(1.4, 12, 8);
  const sunMaterial = new MeshBasicMaterial({ color: new Color(look.sky.sun).multiplyScalar(4) });
  try {
    const u = sky.uniforms;
    u.uTop!.value.set(look.sky.top); u.uHorizon!.value.set(look.sky.horizon); u.uBottom!.value.set(look.sky.bottom);
    u.uSun!.value.set(look.sky.sun); u.uSunDir!.value.set(...look.sky.sunDir).normalize(); u.uSunSize!.value = look.sky.sunSize;
    u.uNebula!.value = nebula ? look.sky.nebula : 0;
    s.add(new Mesh(skyGeometry, sky));
    const sun = new Mesh(sunGeometry, sunMaterial);
    sun.position.set(...look.sky.sunDir).normalize().multiplyScalar(8);
    s.add(sun);
    return pm.fromScene(s, .03);
  } finally {
    sky.dispose(); skyGeometry.dispose(); sunGeometry.dispose(); sunMaterial.dispose();
  }
}

const PROBE_W = 32, PROBE_H = 16;
/**
 * Whether surfaces lit by `env` render correctly on this GPU. Some phone GPUs (seen on a Mali-G78) build a reflection
 * map that turns every surface sampling it pure black, whatever its own colour: the story's glowing Prism rendered as a
 * black shape. This draws two spheres that glow mid-grey on their own (one glossy like the Prism, one matte), lit only by
 * `env`, into a tiny off-screen image and reads it back. A correct map can only add light, so any black pixel on either
 * sphere means the map is broken.
 */
function environmentWorks(gl: WebGLRenderer, env: Texture) {
  const target = new WebGLRenderTarget(PROBE_W, PROBE_H, { depthBuffer: true });
  const scene = new Scene();
  scene.environment = env;
  const geometry = new SphereGeometry(1, 24, 12);
  const materials = [.05, 1].map(roughness => new MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: .5, roughness, metalness: .3 }));
  materials.forEach((m, i) => { const mesh = new Mesh(geometry, m); mesh.position.x = i ? 1 : -1; scene.add(mesh); });
  const camera = new OrthographicCamera(-2, 2, 1, -1, .1, 10);
  camera.position.z = 5;
  const pixels = new Uint8Array(PROBE_W * PROBE_H * 4);
  const previous = gl.getRenderTarget();
  try {
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    gl.readRenderTargetPixels(target, 0, 0, PROBE_W, PROBE_H, pixels);
  } finally {
    gl.setRenderTarget(previous);
    target.dispose(); geometry.dispose(); materials.forEach(m => m.dispose());
  }
  // Pixels well inside each sphere's disc (radius 8 px, centred at x = 8 and x = 24).
  for (let y = 0; y < PROBE_H; y++) for (let x = 0; x < PROBE_W; x++) {
    const cx = x < PROBE_W / 2 ? 8 : 24;
    if (Math.hypot(x + .5 - cx, y + .5 - 8) > 5.5) continue;
    const i = (y * PROBE_W + x) * 4;
    if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! < 60) return false;
  }
  return true;
}

function EnvMap({ look }: { look: Look }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    let targets = environmentTargets.get(gl);
    if (!targets) { targets = new Map(); environmentTargets.set(gl, targets); }
    const world = looks.indexOf(look);
    if (!targets.has(look)) {
      let pm = environmentGenerators.get(gl);
      const startedAt = performance.now();
      try {
        if (!pm) { pm = new PMREMGenerator(gl); environmentGenerators.set(gl, pm); }
        // The full sky first; if the device renders it wrong, the same sky without the Void's nebula clouds (a faint tint
        // in reflections); if that fails too, no reflections at all, which still looks far better than black surfaces.
        let built: EnvTarget | null = buildEnvironment(pm, look, true);
        let status = 'ok';
        if (!environmentWorks(gl, built.texture)) {
          built.dispose(); built = null; status = 'off';
          if (look.sky.nebula > 0) {
            built = buildEnvironment(pm, look, false);
            if (environmentWorks(gl, built.texture)) status = 'plain';
            else { built.dispose(); built = null; }
          }
          console.warn(`[Mirror Maze] World ${world + 1}: reflection map rendered black on this GPU; using ${status === 'plain' ? 'one without nebula' : 'none'}.`);
        }
        targets.set(look, built);
        perf.env[world] = status;
        if (__DEV__) {
          const sample = { type: 'pmrem', chapter: world, ms: Math.round(performance.now() - startedAt), cached: false, status };
          console.info('[Mirror Maze perf] PMREM generated', sample);
          if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mirror-maze-performance', { detail: sample }));
        }
      } catch (cause) {
        console.warn('Environment reflections unavailable', cause);
        return;
      }
    }
    const env = targets.get(look)?.texture ?? null;
    scene.environment = env;
    return () => { if (scene.environment === env) scene.environment = null; };
  }, [gl, scene, look]);
  return null;
}

function Lights({ look, storm, dusk = 0 }: { look: Look; storm?: Storm; dusk?: number }) {
  const sun = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const fade = useRef(0);
  const { scene } = useThree();
  const fogBase = useMemo(() => new Color(look.fog.color), [look.fog.color]);
  const fogDusk = useMemo(() => new Color('#5a2a3a'), []);
  // Parsed once: Color.set(string) runs a regex parse, far too costly to repeat every frame.
  const sunBase = useMemo(() => new Color(look.light.sun), [look.light.sun]);
  useFrame((_, dt) => {
    fade.current += (dusk - fade.current) * Math.min(1, dt * 1.5);
    const f = storm?.flash.value ?? 0;
    const d = fade.current;
    // A feeding black hole drains the lights too: a flicker at the impact, then they fade with the world.
    const dark = 1 - voidFall.dark * .75 - voidFall.flicker * .25;
    if (sun.current) { sun.current.intensity = (look.light.sunIntensity + f * 6) * (1 - d * .55) * dark; sun.current.color.copy(sunBase).lerp(sunsetColor, d * .6); }
    if (hemi.current) hemi.current.intensity = (look.light.hemi + f * 2) * (1 - d * .45) * dark;
    if (scene.fog && 'color' in scene.fog) scene.fog.color.copy(fogBase).lerp(fogDusk, d * .7);
  });
  const d = look.sky.sunDir;
  const n = Math.hypot(...d);
  return <>
    <hemisphereLight ref={hemi} args={[look.light.sky, look.light.ground, look.light.hemi]} />
    <directionalLight ref={sun} position={[d[0] / n * 14 + 2, Math.max(.45, d[1] / n) * 14 + 6, d[2] / n * 14 + 6]} color={look.light.sun}
      intensity={look.light.sunIntensity} castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-.0012} shadow-normalBias={.02}
      shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} shadow-camera-near={1} shadow-camera-far={60} />
    <directionalLight position={[-8, 4, -6]} color={look.light.fill} intensity={look.light.fillIntensity} />
  </>;
}


const boardModes: WorldMode[] = ['intro', 'game', 'complete', 'fail', 'outro'];
const prewarmModes: WorldMode[] = ['menu', 'complete', 'prologue', 'intro', 'outro'];

/** A cannon's aim relative to the stones it rides (the rig turns it the rest of the way). */
function aimOnStones(c: Cluster, aim: Direction, steps: number) {
  for (let k = 0; k < steps; k++) aim = (c.turn > 0 ? turnLeft : turnRight)(aim);
  return aim;
}

function BoardView({ level, state, trace, look, chapter, hint, onTap, onBlocked, onPreview, preview, previewId, sounds, ready, onReady, onTurnDone, onDevourDone }: {
  level: Level; state: PlayState; trace: Trace; look: Look; chapter: number; hint?: string; onTap?: (id: string) => void; onBlocked?: () => void;
  onPreview?: (id: string | undefined) => void; preview?: Trace; previewId?: string; sounds: boolean; ready: StageReady; onReady?: () => void;
  onTurnDone?: () => void; onDevourDone?: () => void;
}) {
  const clock = useMemo<BeamClock>(() => ({ reveal: { value: 0 }, boost: { value: 0 }, limit: { value: Infinity }, abyss: newAbyss() }), []);
  const win = useMemo<WinClock>(() => ({ start: -1 }), []);
  const born = useMemo(() => ({ value: -1 }), []);
  const boardClock = useMemo(() => ({ born }), [born]);
  const shown = useMemo(() => (trace.won ? clipToCrystals(trace) : trace), [trace]);
  const finish = useMemo(() => Math.max(0, ...Object.values(trace.activatedAt)), [trace]);
  const warmup = useRef(0);
  const mountedAt = useMemo(() => performance.now(), []);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useFrame(({ clock: c }) => {
    const t = c.elapsedTime;
    if (born.value < 0) {
      // Pieces stay hidden while the first frames compile and upload the board; the entrance plays once that is done.
      if (++warmup.current < WARMUP_FRAMES) return;
      born.value = ready.at = t;
      perf.loadMs = performance.now() - mountedAt;
      onReadyRef.current?.();
    }
    if (trace.won && win.start < 0 && clock.reveal.value >= finish - .01) win.start = t;
    const age = win.start < 0 ? -1 : t - win.start;
    clock.boost.value = age < 0 ? 0 : age < CHARGE_TIME ? (age / CHARGE_TIME) * 1.4 : Math.max(.35, 1.4 - (age - CHARGE_TIME) * 1.5);
  });
  const n = level.size, c0 = (n - 1) / 2;
  const delay = (p: readonly [number, number]) => .3 + Math.hypot(p[0] - c0, p[1] - c0) * .07;
  // Where the light first touches each mirror or floe (by id, so a piece riding a cluster keeps its glow as it moves)
  // and each prism (by cell).
  const hitAt = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of shown.hits) {
      const k = h.kind === 'mirror' ? h.id : h.kind === 'splitter' ? key(h.point) : undefined;
      if (k !== undefined && !m.has(k)) m.set(k, h.at);
    }
    return m;
  }, [shown]);
  const mirrorTaps = useMemo(() => onTap ? new Map([...level.mirrors, ...level.floes].map(m => [m.id, () => onTap(m.id)])) : undefined, [level, onTap]);
  const emitterTaps = useMemo(() => onTap ? new Map(level.emitters.filter(e => e.rotatable).map(e => [e.id, () => onTap(e.id)])) : undefined, [level, onTap]);
  const totemTaps = useMemo(() => onTap ? new Map(level.clusters.map(c => [c.totem.id, () => onTap(c.totem.id)])) : undefined, [level, onTap]);
  const blockedTap = useCallback(() => onBlocked?.(), [onBlocked]);
  const previews = useMemo(() => onPreview ? new Map([...level.mirrors, ...level.emitters, ...level.floes, ...level.clusters.map(c => c.totem)]
    .map(p => [p.id, (on: boolean) => onPreview(on ? p.id : undefined)])) : undefined, [level, onPreview]);

  // Rootbound clusters: each has a turn clock shared by its rig, stones, guides and totem. A change in the rules' turn
  // count starts a turn: a tap's cinematic quarter turn, or an undo's quick turn back.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the clocks start from the state the board mounts with
  const turnClocks = useMemo(() => new Map<string, TurnClock>(level.clusters.map(c => [c.id, newTurnClock(turnsOf(c, state))])), [level]);
  const seenTurns = useRef(state.turns);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useLayoutEffect(() => {
    const before = seenTurns.current;
    seenTurns.current = state.turns;
    if (before === state.turns) return;
    for (const c of level.clusters) {
      const d = (((turnsOf(c, state) - (before?.[c.id] ?? 0)) % 4) + 4) % 4;
      if (!d) continue;
      const tc = turnClocks.get(c.id)!;
      const from = tc.run ? tc.run.to : tc.shown;
      const step = d === 3 ? -1 : 1;
      // The light falls back to where the old and new light part ways, and regrows from there once the stones land.
      let limit = Infinity;
      if (step > 0) {
        const next = traceState(level, state);
        limit = divergence(segmentsOf(shown), segmentsOf(next.won ? clipToCrystals(next) : next));
      }
      tc.shown = from;
      tc.run = { start: -1, from, to: from + step, cinematic: step > 0, limit, old: shown, fired: 0, landed: false };
    }
  }, [level, state, turnClocks, shown]);
  const onTurnDoneRef = useRef(onTurnDone);
  onTurnDoneRef.current = onTurnDone;
  const onDevourDoneRef = useRef(onDevourDone);
  onDevourDoneRef.current = onDevourDone;
  useEffect(() => () => { boardShake.value = 0; voidFall.dark = 0; voidFall.flicker = 0; }, []);
  const pose = useMemo(newPose, []);

  // A black hole feeding: one guarded run per failure, taken from the rules' trace of the losing move. Further renders
  // of the same lost board never restart it; it ends only when the board is no longer lost (rewind) or remounts (retry).
  const abyssRun = useRef<AbyssRun>(undefined);
  const abyssCue = useRef({ sound: false, swallowed: 0, lastSwallow: -10, hush: 1, done: false });
  const abyssPoseNow = useMemo(() => abyssPose(-1), []);
  const hole = useMemo(() => level.devourers[0]?.position, [level]);
  useLayoutEffect(() => {
    if (trace.absorbed && !abyssRun.current) {
      const record = absorptionOf(trace);
      if (!record) return;
      const d = level.devourers.find(x => x.id === record.devourer)!;
      clock.abyss.hole.value.set(d.position[0], BEAM_Y, d.position[1]);
      abyssRun.current = { record, start: -1 };
      abyssCue.current = { sound: false, swallowed: 0, lastSwallow: -10, hush: 1, done: false };
    } else if (!trace.absorbed && abyssRun.current) {
      // The losing move was taken back: the hole lets go, the light and the world come back.
      abyssRun.current = undefined;
      clock.abyss.pull.value = 0; clock.abyss.drain.value = 0;
      voidFall.dark = 0; voidFall.flicker = 0;
      if (abyssCue.current.hush !== 1) audio.setHush(1);
    }
  }, [trace, level, clock]);

  // The director: totem turns (phase sounds, the light falling back and regrowing, the landing report) and a feeding
  // black hole (the light bent and drained into it, the world darkening, its sounds and the end report), and the
  // board's tremble from both.
  useFrame(({ clock: c }) => {
    const t = c.elapsedTime;
    let shake = 0, limit = Infinity;
    const run = abyssRun.current;
    if (run) {
      const cue = abyssCue.current;
      // It starts when the light actually reaches the hole, not at the tap.
      if (run.start < 0 && clock.reveal.value >= run.record.at - .01) run.start = t;
      if (run.start >= 0) {
        const e = t - run.start;
        const p = abyssPose(e, abyssPoseNow);
        clock.abyss.pull.value = p.pull;
        clock.abyss.reach.value = p.reach;
        clock.abyss.drain.value = p.drain * (run.record.reach + .6);
        voidFall.dark = p.dark;
        voidFall.flicker = p.impact < 1 ? Math.abs(Math.sin(t * 47)) * (1 - p.impact) : 0;
        shake = p.shake;
        if (!cue.sound) { cue.sound = true; if (sounds && e < .3) { audio.play('abyss'); audio.haptic('error'); } }
        // A swallow pulse as each beam's last light disappears into the hole (spaced, so they never stack).
        const drained = clock.abyss.drain.value;
        while (cue.swallowed < run.record.ends.length && drained >= run.record.ends[cue.swallowed]!) {
          cue.swallowed++;
          if (sounds && t - cue.lastSwallow > .18 && e < PULL_AT + PULL + .3) { cue.lastSwallow = t; audio.play('swallow', .8); }
        }
        if (sounds && Math.abs(p.hush - cue.hush) > .02) { cue.hush = p.hush; audio.setHush(p.hush); }
        if (p.done && !cue.done) { cue.done = true; onDevourDoneRef.current?.(); }
      }
    }
    for (const cl of level.clusters) {
      const tc = turnClocks.get(cl.id)!;
      const r = tc.run;
      if (!r) continue;
      const e = poseAt(tc, t, pose).elapsed;
      if (!r.cinematic) {
        if (e >= UNDO_SECONDS) { tc.shown = r.to; tc.run = undefined; }
        continue;
      }
      // Sounds only play on time: after the app was paused mid-turn, the late ones are skipped.
      const cue = (n: number, at: number, name: 'awaken' | 'grind' | 'settle') => {
        if (r.fired >= n || e < at) return;
        r.fired = n;
        if (sounds && e - at < .3) audio.play(name);
      };
      cue(1, 0, 'awaken'); cue(2, WAKE, 'grind'); cue(3, TURN_IMPACT, 'settle');
      if (e >= TURN_IMPACT && !r.landed) { r.landed = true; audio.haptic('heavy'); onTurnDoneRef.current?.(); }
      // Until the new light replaces the old one, the old one stays fallen back.
      if (e >= WAKE * .5 && (e < TURN_IMPACT || shownRef.current === r.old)) limit = Math.min(limit, r.limit);
      shake = Math.max(shake, pose.strain > 0 && pose.swing === 0 ? .022 * pose.strain : pose.swing > 0 && pose.swing < 1 ? .006 : 0,
        e >= TURN_IMPACT ? .055 * Math.exp(-(e - TURN_IMPACT) * 11) : 0);
      if (e >= TURN_SECONDS + .5) { tc.shown = r.to; tc.run = undefined; }
    }
    clock.limit.value = limit;
    boardShake.value = shake;
  });
  // AbyssEffects lays its motes out around the hole once per board.
  const holeAt = useMemo(() => (hole ? [hole[0], hole[1]] as [number, number] : undefined), [hole]);
  /** Which cluster each piece rides (by the cell it opens on), and what is in the way of each cluster's next turn. */
  const rides = useCallback((p: Point) => clusterAt(level, p), [level]);
  const blocks = useMemo(() => new Map(level.clusters.map(c => [c.id, turnBlocks(level, state, c).filter(p => p[0] >= 0 && p[1] >= 0 && p[0] < n && p[1] < n)])),
    [level, state, n]);
  const heldCluster = previewId ? level.clusters.find(c => c.totem.id === previewId)?.id : undefined;
  const mirrorEl = (m: Mirror, c?: Cluster) => {
    const o = state.orientations[m.id] ?? m.orientation;
    return <group key={m.id} position={c ? rigLocal(c, m.position) : [m.position[0], 0, m.position[1]]}>
      <MirrorPiece mirror={m} orientation={c ? ((o ^ (turnsOf(c, state) & 1)) as 0 | 1) : o} hint={hint === m.id}
        hitAt={hitAt.get(m.id)} clock={clock} look={look} chapter={chapter} delay={delay(m.position)}
        onTap={mirrorTaps?.get(m.id)} onBlocked={onBlocked} onPreview={previews?.get(m.id)} />
    </group>;
  };
  const emitterEl = (e: Emitter, c?: Cluster) => {
    const aim = state.aims[e.id] ?? e.direction;
    return <group key={e.id} position={c ? rigLocal(c, e.position) : [e.position[0], 0, e.position[1]]}>
      <LightSource id={e.id} direction={c ? aimOnStones(c, aim, turnsOf(c, state)) : aim} chapter={chapter} look={look} fire={state} delay={.25} rotatable={e.rotatable}
        hint={hint === e.id} onTap={onTap ? e.rotatable ? emitterTaps?.get(e.id) : blockedTap : undefined} onPreview={previews?.get(e.id)} />
      {hint === e.id && <HintArrow />}
    </group>;
  };
  const crystalEl = (t: Level['targets'][number], i: number, c?: Cluster) => <group key={t.id} position={c ? rigLocal(c, t.position) : [t.position[0], 0, t.position[1]]}>
    <CrystalPiece at={trace.activatedAt[t.id]} clock={clock} win={win} index={i} look={look} chapter={chapter}
      heart={level.boss && t.id === `c${level.targets.length}`} delay={delay(t.position)} sounds={sounds} />
  </group>;
  const blockerEl = (p: Point, c?: Cluster) => <group key={key(p)} position={c ? rigLocal(c, p) : [p[0], 0, p[1]]}><BlockerPiece chapter={chapter} delay={delay(p)} /></group>;
  const splitterEl = (s: Level['splitters'][number], c?: Cluster) => <group key={s.id} position={c ? rigLocal(c, s.position) : [s.position[0], 0, s.position[1]]}>
    <SplitterPiece hitAt={hitAt.get(key(placeOf(level, state, s.position)))} clock={clock} delay={delay(s.position)} />
  </group>;
  // The chapter modifiers as the rules see this board: which gates stand closed.
  const board = useMemo(() => boardOf(level, state), [level, state]);
  // Gates turn to face across the road the solved light takes through them.
  const gateTurn = useMemo(() => {
    const out = new Map<string, number>();
    if (!level.gates.length) return out;
    const solved = traceState(level, replay(level, level.solutionMoves));
    for (const g of level.gates) {
      const [gx, gz] = g.position;
      const along = solved.segments.find(sg => (sg.from[0] === sg.to[0] && sg.from[0] === gx && (gz - sg.from[1]) * (gz - sg.to[1]) <= 0)
        || (sg.from[1] === sg.to[1] && sg.from[1] === gz && (gx - sg.from[0]) * (gx - sg.to[0]) <= 0));
      out.set(g.id, along && along.from[1] === along.to[1] ? Math.PI / 2 : 0);
    }
    return out;
  }, [level]);
  const gateColor = (id: string) => {
    const seal = level.seals.find(x => x.toggles.includes(id));
    return seal ? sealColors[(seal.order - 1) % sealColors.length]! : sealColors[0]!;
  };
  return <BoardClock.Provider value={boardClock}><PickBoard active={!!onTap} color={look.ui.accent}>
    <group position={[-c0, 0, -c0]}>
      <BoardBody size={n} chapter={chapter} look={look} />
      {level.emitters.filter(e => !rides(e.position)).map(e => emitterEl(e))}
      {level.mirrors.filter(m => !rides(m.position)).map(m => mirrorEl(m))}
      {level.targets.map((t, i) => (rides(t.position) ? null : crystalEl(t, i)))}
      {level.blockers.filter(p => !rides(p)).map(p => blockerEl(p))}
      {level.splitters.filter(s => !rides(s.position)).map(s => splitterEl(s))}
      {level.clusters.map((c, ci) => {
        const tc = turnClocks.get(c.id)!, color = clusterColors[ci % clusterColors.length]!, held = heldCluster === c.id;
        const mine = (p: Point) => rides(p) === c;
        return <React.Fragment key={c.id}>
          <ClusterRig cluster={c} clock={tc}>
            <ClusterStones cluster={c} color={color} clock={tc} held={held} delay={delay(c.pivot)} />
            {level.emitters.filter(e => mine(e.position)).map(e => emitterEl(e, c))}
            {level.mirrors.filter(m => mine(m.position)).map(m => mirrorEl(m, c))}
            {level.targets.map((t, i) => (mine(t.position) ? crystalEl(t, i, c) : null))}
            {level.blockers.filter(mine).map(p => blockerEl(p, c))}
            {level.splitters.filter(s => mine(s.position)).map(s => splitterEl(s, c))}
          </ClusterRig>
          <ClusterGuides cluster={c} color={color} clock={tc} held={held} blocks={blocks.get(c.id)!} landing={footprint(level, c, turnsOf(c, state))}
            totem={c.totem.position} />
          <TotemPiece cluster={c} color={color} clock={tc} legal={canRotate(level, state, c.totem.id)} hint={hint === c.totem.id} delay={delay(c.totem.position)}
            onTap={totemTaps?.get(c.totem.id)} onBlocked={onBlocked} onPreview={previews?.get(c.totem.id)} />
        </React.Fragment>;
      })}
      {level.portals.flatMap(p => [p.position, p.exit].map((pt, i) => <group key={`${p.id}${i}`} position={[pt[0], 0, pt[1]]}>
        <PortalPiece delay={delay(pt)} exit={i === 1} />
      </group>))}
      {level.floes.map(f => <FloeTrack key={`${f.id}t`} floe={f} delay={delay(f.track[0]!)} />)}
      {level.floes.map(f => {
        const at = state.places[f.id] ?? f.at, to = glide(level, state, f);
        return <FloePiece key={f.id} floe={f} at={at} way={to ? (Math.sign(to.at - at) as 1 | -1) : 0} hint={hint === f.id}
          hitAt={hitAt.get(f.id)} clock={clock} delay={delay(f.track[f.at]!)} sounds={sounds}
          onTap={mirrorTaps?.get(f.id)} onBlocked={onBlocked} onPreview={previews?.get(f.id)} />;
      })}
      {level.seals.map(x => <group key={x.id} position={[x.position[0], 0, x.position[1]]}>
        <SealPiece seal={x} active={!!state.sealed[x.id]} lit={trace.sealsLit.includes(x.id)} delay={delay(x.position)} sounds={sounds} />
      </group>)}
      {level.gates.map(g => <group key={g.id} position={[g.position[0], 0, g.position[1]]} rotation={[0, gateTurn.get(g.id) ?? 0, 0]}>
        <GatePiece gate={g} open={!board.closedGates.has(g.id)} color={gateColor(g.id)} delay={delay(g.position)} sounds={sounds} />
      </group>)}
      {level.devourers.map(d => <group key={d.id} position={[d.position[0], 0, d.position[1]]}>
        <DevourerPiece devourer={d} run={abyssRun} delay={delay(d.position)} />
      </group>)}
      {holeAt && <AbyssEffects run={abyssRun} trace={trace} hole={holeAt} />}
      <Beam trace={shown} look={look} clock={clock} sounds={sounds} />
      {preview && <GhostBeam trace={preview} color={look.beamGlow} />}
    </group>
  </PickBoard></BoardClock.Provider>;
}

const vistas: { pos: [number, number, number]; target: [number, number, number] }[] = [
  { pos: [15, 7, 22], target: [-4, 6, -42] },
  { pos: [9, 3, 17], target: [6, 10, -40] },
  { pos: [16, 5, 24], target: [-10, 10, -120] },
  { pos: [12, 4, 22], target: [0, 26, -140] },
  { pos: [9, 4, 24], target: [0, 20, -120] },
];
/** Where every chapter's flythrough comes to rest, looking down at the board. */
const INTRO_REST: [number, number, number] = [6, 9, 14];
const introPaths: [number, number, number][][] = [
  [[0, 60, 90], [-30, 20, 40], [-12, 6, 18], INTRO_REST],
  [[40, 4, 60], [18, -2, 30], [-6, 2, 18], INTRO_REST],
  [[-60, 30, -60], [-40, 10, 0], [-14, 5, 20], INTRO_REST],
  [[0, -4, 80], [20, 6, 40], [6, 12, 20], INTRO_REST],
  [[0, 30, -60], [30, 15, -10], [14, 8, 18], INTRO_REST],
];
/**
 * Where the board has to fit (normalised device coordinates) at the end of a chapter intro, clear of the title above
 * and the captions below, and in a chapter outro, above the captions (the beacon rises into the space above).
 */
const INTRO_BOX = { x: .94, bottom: -.46, top: .4 };
const OUTRO_BOX = { x: .94, bottom: -.46, top: 1 };
/** Prologue: the moment the orbiting camera faces the Void Eye, between "Then the Void opened its eye" and the shatter. */
const EYE_FACING = 11.9;
const smooth = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const origin = new Vector3(0, 0, 0);
const fitEye = new Vector3(), fitTarget = new Vector3();
/** The intro's extra pull-back cranes up and back but never sideways: beside the board stand scenery (the jungle's trunks). */
const UP_AND_BACK = new Vector3(0, 1, 1);
/** Open sky high above every world's scenery, where the Amulet is displayed. */
const ALTAR: [number, number, number] = [0, 30, 0];
const tmpPos = new Vector3(), tmpTarget = new Vector3(), tmpScale = new Vector3();
const UP = new Vector3(0, 1, 0);

function CameraDirector({ mode, chapter, n, insets, mapScroll, view, pulse, won, devoured, stage, ready }: {
  mode: WorldMode; chapter: number; n: number; insets: { top: number; bottom: number }; mapScroll?: MapScroll; view: 'tilt' | 'top'; pulse: unknown; won: boolean;
  devoured: boolean; stage: string; ready: StageReady;
}) {
  const { camera, size } = useThree();
  const pos = useRef(new Vector3(0, 40, 90));
  const target = useRef(new Vector3(0, 0, 0));
  const offset = useRef(0);
  const projection = useRef({ width: 0, height: 0, offset: Number.NaN });
  const started = useRef({ mode: '' as string, at: 0, chapter: -1, stage: '' });
  /** The inputs the current board framing was computed for; compared field by field so no key string is built per frame. */
  const framing = useRef({ n: -1, W: -1, H: -1, top: -1, bottom: -1, view: '' as string, stage: '' as string, d: 10, offset: 0, intro: 1, outro: 1 });
  const punch = useRef({ last: pulse, at: -10 });
  const curve = useMemo(() => new CatmullRomCurve3(introPaths[chapter]!.map(p => new Vector3(...p))), [chapter]);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const sceneChanged = started.current.mode !== mode || started.current.chapter !== chapter || started.current.stage !== stage;
    if (sceneChanged) started.current = { mode, at: t, chapter, stage };
    const mt = t - started.current.at;
    const cam = camera as PerspectiveCamera;
    const W = size.width, H = size.height, aspect = W / Math.max(1, H);
    if (W <= 0 || H <= 0) return;
    // Portrait phones see far less horizontally; pull cinematic shots back so subjects stay in frame.
    const pf = portraitPull(aspect);
    const fk = framing.current;
    if (fk.n !== n || fk.W !== W || fk.H !== H || fk.top !== insets.top || fk.bottom !== insets.bottom || fk.view !== view || fk.stage !== stage) {
      const saved = { p: cam.position.clone(), q: cam.quaternion.clone() };
      // The intro's resting shot and the outro's shot (at either end of its sway), each moved back only if the board
      // would otherwise be cut off.
      const outroAt = (sway: number) => boardFit(n, W, H, fitEye.set(n * .4 + sway, 6, (n * 1.4 + 8) * pf), fitTarget.set(0, 5.5, 0), OUTRO_BOX);
      framing.current = { n, W, H, top: insets.top, bottom: insets.bottom, view, stage,
        ...frameBoard(cam, n, W, H, insets.top, insets.bottom, view === 'top' ? TOP_DIR : GAME_DIR),
        intro: boardFit(n, W, H, fitEye.set(...INTRO_REST).multiplyScalar(pf), origin, INTRO_BOX, UP_AND_BACK), outro: Math.max(outroAt(2), outroAt(-2)) };
      cam.position.copy(saved.p); cam.quaternion.copy(saved.q);
      projection.current.width = 0;
    }
    const fr = framing.current;
    let off = 0, k = 2.4;
    const v = vistas[chapter]!;
    switch (mode) {
      case 'game': case 'fail': {
        // Directed play camera: a sweeping reveal, a slow breathing drift, a punch on every tap and a push-in on victory.
        if (punch.current.last !== pulse) { punch.current.last = pulse; punch.current.at = t; }
        // The sweep waits for the board to warm up; until then the camera holds its opening pose.
        const pt = ready.at < 0 ? 0 : t - Math.max(started.current.at, ready.at);
        const reveal = Math.min(1, pt / 1.4), ease = 1 - Math.pow(1 - reveal, 3);
        const tap = Math.exp(-(t - punch.current.at) * 7) * .035;
        const drift = view === 'top' ? .4 : 1;
        const yawA = (1 - ease) * .65 + Math.sin(t * .23) * .028 * drift;
        const winPush = won ? Math.min(1, (t - punch.current.at) / 2.5) * .07 : 0;
        // A lost board steps back, except after the Devourer's absorption: that ends on a still, framed shot of the hole.
        const dist = fr.d * (mode === 'fail' && !devoured ? 1.12 : 1) * (1 + (1 - ease) * .35 - tap - winPush);
        tmpTarget.set(0, 0, 0);
        tmpPos.copy(view === 'top' ? TOP_DIR : GAME_DIR).applyAxisAngle(UP, yawA).multiplyScalar(dist);
        tmpPos.y += Math.sin(t * .31) * .12 * drift;
        off = fr.offset;
        k = pt < .05 ? 60 : 3.5;
        break;
      }
      case 'complete': {
        const a = Math.sin(t * .15) * .5, d = fr.d * 1.05;
        tmpTarget.set(0, .2, 0);
        tmpPos.set(Math.sin(a) * d * .56, d * .82, Math.cos(a) * d * .56);
        off = H * .04; k = 1.4;
        break;
      }
      case 'outro': {
        const rise = Math.min(mt, 4) / 4;
        tmpTarget.set(0, 1.5 + rise * 4, 0);
        tmpPos.set(Math.sin(t * .2) * 2 + n * .4, 3 + rise * 3, (n * 1.4 + 8) * pf);
        // On a narrow screen, back along the line of sight until the whole board sits above the captions.
        tmpPos.sub(tmpTarget).multiplyScalar(fr.outro).add(tmpTarget);
        k = 1.2;
        break;
      }
      case 'menu': case 'forge': {
        // The Amulet floats in open sky; scale distance so its ring spans ~78% of the screen width.
        tmpTarget.set(ALTAR[0], ALTAR[1] + (mode === 'menu' ? -.25 : .1), ALTAR[2]);
        const d = Math.max(7, 2.15 / (Math.tan((cam.fov * Math.PI) / 360) * aspect * .7)) * (mode === 'forge' ? .85 : 1);
        tmpPos.set(ALTAR[0] + Math.sin(t * .12) * .8, ALTAR[1] + .3 + Math.sin(t * .17) * .2, ALTAR[2] + d);
        // Centre the Amulet in the band between the title crest and the buttons. A negative view offset moves content down the screen.
        off = mode === 'menu' ? -H * .03 : 0; k = 1.8;
        break;
      }
      case 'map': {
        // Drift gently over each world's scenery while scrolling; stay level so the sky and props stay in frame.
        const p = mapScroll?.progress ?? 0;
        tmpTarget.set((p - .5) * 6, 1 - p * 3, -18);
        tmpPos.set(Math.sin(t * .08) * 2 - (p - .5) * 4, 7 - p * 4, 24 * pf);
        k = 2.2;
        break;
      }
      case 'intro': {
        const p = Math.min(1, mt / 10.5);
        const e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        curve.getPoint(e, tmpPos);
        const pathY = tmpPos.y;
        tmpTarget.set(...v.target).lerp(origin, Math.min(1, e * 1.3));
        // The portrait pull-back is taken from what the camera looks at, along its line of sight. (Scaled about the
        // world's centre, it pushed the opening shots into the scenery: against the Desert's great pyramid, into the
        // Void Eye, among the jungle's trunks.) Towards the end it grows, if needed, until the whole board fits between
        // the title and the captions. It never takes the camera below the designed path (the ground and the Ice Age's
        // lake lie beneath it), nor further from the world's centre than scaling about it did (past the glaciers).
        tmpScale.copy(UP_AND_BACK).multiplyScalar((fr.intro - 1) * smooth(.55, 1, e)).addScalar(1).multiplyScalar(pf);
        const reach = tmpPos.length() * Math.max(tmpScale.y, tmpScale.z);
        tmpPos.sub(tmpTarget).multiply(tmpScale).add(tmpTarget);
        if (tmpPos.length() > reach) tmpPos.setLength(reach);
        tmpPos.y = Math.max(tmpPos.y, pathY);
        k = 30;
        break;
      }
      case 'prologue': {
        const d = Math.max(9, 17 - mt * .4) * pf;
        // The orbit runs on the scene's own clock, timed so the camera faces the Void Eye (far behind the Prism) as the
        // narrator says it opens and as the Prism shatters. On the session clock a portrait screen, which sees only a
        // narrow slice of the orbit, usually missed the Eye altogether.
        const a = (mt - EYE_FACING) * .15;
        tmpTarget.set(0, 4, 0);
        tmpPos.set(Math.sin(a) * d, 5 + Math.sin(mt * .2), Math.cos(a) * d);
        if (mt > 12.8 && mt < 13.6) tmpPos.addScalar((Math.random() - .5) * .8);
        k = mt < .1 ? 60 : 2;
        break;
      }
      case 'ending': {
        tmpTarget.set(ALTAR[0], ALTAR[1] + .2, ALTAR[2]);
        const d = Math.max(7.4, 2.15 / (Math.tan((cam.fov * Math.PI) / 360) * aspect * .78)) + Math.max(0, mt - 5) * .5;
        tmpPos.set(ALTAR[0] + Math.sin(t * .1) * 1.5, ALTAR[1] + .6 + Math.max(0, mt - 5) * .3, ALTAR[2] + d);
        k = 1.4;
        break;
      }
      default: {
        tmpTarget.set(...v.target);
        tmpPos.set(v.pos[0] + Math.sin(t * .08) * 3, v.pos[1] + Math.sin(t * .11) * .8, v.pos[2] * pf);
        k = mode === 'splash' ? 1 : 1.6;
      }
    }
    const a = 1 - Math.exp(-dt * k);
    if (sceneChanged && mode === 'game') {
      pos.current.copy(tmpPos);
      target.current.copy(tmpTarget);
      offset.current = off;
    }
    pos.current.lerp(tmpPos, a);
    target.current.lerp(tmpTarget, a);
    offset.current += (off - offset.current) * a;
    cam.position.copy(pos.current);
    // A totem's turn trembles the board: applied after the smoothing, so the camera's easing never swallows it.
    const quake = mode === 'game' ? boardShake.value : 0;
    if (quake > 0) { cam.position.x += Math.sin(t * 53) * quake; cam.position.y += Math.sin(t * 61 + 1.3) * quake * .7; }
    cam.lookAt(target.current);
    if (projection.current.width !== W || projection.current.height !== H || Math.abs(projection.current.offset - offset.current) > .01) {
      cam.setViewOffset(W, H, 0, offset.current, W, H);
      cam.updateProjectionMatrix();
      projection.current = { width: W, height: H, offset: offset.current };
    }
  });
  return null;
}

function Prologue() {
  const prism = useRef<Group>(null);
  const shards = useRef<Group>(null);
  const flash = useRef<Sprite>(null);
  const start = useRef(-1);
  const mat = useMemo(() => new MeshStandardMaterial({ color: '#ffffff', roughness: .05, metalness: .3, emissive: '#ffffff', emissiveIntensity: .5, flatShading: true, transparent: true, opacity: .92 }), []);
  useFrame(({ clock, size }) => {
    if (start.current < 0) start.current = clock.elapsedTime;
    const t = clock.elapsedTime - start.current;
    const shattered = t > 12.8;
    if (prism.current) { prism.current.visible = !shattered; prism.current.rotation.y = t * .4; prism.current.position.y = 4 + Math.sin(t) * .2; }
    mat.emissive.setHSL((t * .08) % 1, .8, .55);
    // A narrow screen sees a far narrower slice of the scene, so the Hearts burst apart more slowly sideways: they cross
    // the frame at the speed they do on a wide screen instead of leaving it within a blink.
    const aspect = size.width / Math.max(1, size.height);
    const spread = Math.min(1, portraitPull(aspect) * aspect / (16 / 9));
    if (shards.current) shards.current.children.forEach((s, i) => {
      const a = (i / 5) * Math.PI * 2 + t * (shattered ? .2 : 1.2);
      const rad = shattered ? 1.6 + (t - 12.8) * 6 * spread : 1.6;
      s.position.set(Math.cos(a) * rad, 4 + (shattered ? (i - 2) * (t - 12.8) * 1.4 : Math.sin(t * 2 + i) * .3), Math.sin(a) * rad);
      s.scale.setScalar(shattered ? Math.max(.001, 1 - (t - 12.8) * .2) : t > 4.5 ? .8 : .001);
      s.rotation.y = t * 3;
    });
    if (flash.current) { const f = t > 12.8 ? Math.max(0, 1 - (t - 12.8) * 1.4) : 0; flash.current.scale.setScalar(1 + f * 40); flash.current.material.opacity = f; }
  });
  return <group>
    <group ref={prism}><mesh material={mat} scale={[2, 2.8, 2]}><octahedronGeometry args={[1, 0]} /></mesh>
      <sprite scale={[9, 9, 1]}><spriteMaterial map={glowTexture} color="#ffffff" opacity={.5} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} /></sprite>
    </group>
    <group ref={shards}>{chapters.map(c => <group key={c.id}>
      <mesh geometry={heartGeometry} scale={.5}><meshStandardMaterial color={c.heartColor} emissive={c.heartColor} emissiveIntensity={1.4} flatShading /></mesh>
      <sprite scale={[2.4, 2.4, 1]}><spriteMaterial map={glowTexture} color={c.heartColor} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} /></sprite>
    </group>)}</group>
    <sprite ref={flash} position={[0, 4, 0]}><spriteMaterial map={glowTexture} color="#ffffff" opacity={0} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} /></sprite>
  </group>;
}

/** Chapter cleared: a beacon of the chapter's light climbs into the sky and opens the road onward. */
function Beacon({ chapter }: { chapter: number }) {
  const gem = useRef<Group>(null);
  const column = useRef<Mesh>(null);
  const start = useRef(-1);
  const color = looks[chapter]!.crystal;
  useFrame(({ clock }) => {
    if (start.current < 0) start.current = clock.elapsedTime;
    const t = clock.elapsedTime - start.current;
    const e = 1 - Math.pow(1 - Math.min(1, t / 3), 3);
    if (gem.current) { gem.current.position.y = 1 + e * 4.5; gem.current.rotation.y = t * 2; gem.current.scale.setScalar(.3 + e * .7); }
    if (column.current) { const k = Math.max(0, Math.min(1, (t - 2.6) * 2)); column.current.scale.set(k * 1.2 + .001, 1, k * 1.2 + .001); (column.current.material as MeshBasicMaterial).opacity = k * .5; }
  });
  return <group>
    <group ref={gem}>
      <mesh geometry={gemGeometry}><meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} flatShading roughness={.1} /></mesh>
      <sprite scale={[5, 5, 1]}><spriteMaterial map={glowTexture} color={color} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} /></sprite>
    </group>
    <mesh ref={column} position={[0, 105, 0]}><cylinderGeometry args={[.6, .6, 200, 16, 1, true]} />
      <meshBasicMaterial color={color} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} toneMapped={false} fog={false} /></mesh>
  </group>;
}

function WorldContent(props: WorldProps) {
  const { chapter, mode, level } = props;
  const envChapter = mode === 'prologue' || mode === 'ending' ? 4 : chapter;
  const look = looks[envChapter]!;
  const boardLook = looks[chapter]!;
  const { gl } = useThree();
  useEffect(() => () => {
    const targets = environmentTargets.get(gl);
    targets?.forEach(target => target?.dispose());
    targets?.clear();
    environmentTargets.delete(gl);
    environmentGenerators.get(gl)?.dispose();
    environmentGenerators.delete(gl);
  }, [gl]);
  const storm = useMemo<Storm>(() => ({ flash: { value: 0 } }), []);
  useEffect(() => { gl.toneMappingExposure = look.light.exposure; }, [gl, look]);
  const eye: EyeState = mode === 'ending' ? 'closing' : mode === 'prologue' || (chapter === 4 && level.index >= 24 && boardModes.includes(mode)) ? 'angry' : 'idle';
  const showBoard = boardModes.includes(mode);
  const sounds = mode === 'game' || mode === 'complete';
  const forgeHearts = props.forging !== undefined ? props.hearts.filter(h => h !== props.forging) : props.hearts;
  const { boardKey, onBoardReady } = props;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a fresh warm-up for every new board
  const stageReady = useMemo<StageReady>(() => ({ at: -1 }), [boardKey]);
  const boardReady = useCallback(() => onBoardReady?.(boardKey), [onBoardReady, boardKey]);
  return <>
    <color attach="background" args={[look.fog.color]} />
    <fog key={envChapter} attach="fog" args={[look.fog.color, look.fog.near, look.fog.far]} />
    <ShaderClock />
    <KeepShaders />
    {PERF_HUD && <FrameStart />}
    <EnvMap look={look} />
    <Lights look={look} storm={envChapter === 1 ? storm : undefined} dusk={props.dusk} />
    <SkyDome look={look} flash={storm.flash} dusk={props.dusk} />
    {envChapter === 0 && <SkyTemples look={look} />}
    {envChapter === 1 && <Rainforest look={look} storm={storm} onLight={noop} />}
    {envChapter === 2 && <Desert look={look} />}
    {envChapter === 3 && <IceAge look={look} />}
    {envChapter === 4 && <TheVoid look={look} eye={eye} />}
    {showBoard && <BoardView key={props.boardKey} level={level} state={props.state} trace={props.trace} look={boardLook} chapter={chapter}
      hint={mode === 'game' ? props.hint : undefined} onTap={mode === 'game' ? props.onTap : undefined} onBlocked={props.onBlocked} sounds={sounds}
      onPreview={mode === 'game' ? props.onPreview : undefined} preview={mode === 'game' ? props.preview : undefined}
      previewId={mode === 'game' ? props.previewId : undefined}
      ready={stageReady} onReady={boardReady} onTurnDone={props.onTurnDone} onDevourDone={props.onDevourDone} />}
    {(mode === 'menu' || mode === 'forge' || mode === 'ending') && <group key={`${mode}:${props.forging}`} position={ALTAR}>
      <pointLight position={[0, 1.5, 4]} intensity={30} distance={14} color="#fff2dc" />
      <pointLight position={[-3, -2, 2]} intensity={14} distance={10} color={look.light.fill} />
      <Amulet hearts={forgeHearts} forging={mode === 'forge' ? props.forging : undefined} complete={mode === 'ending'} />
    </group>}
    {mode === 'prologue' && <Prologue />}
    {mode === 'outro' && <Beacon chapter={chapter} />}
    {mode === 'map' && props.mapScroll && props.progress && <MapLayer scroll={props.mapScroll} progress={props.progress} />}
    {/* Calm moments (menus, results, cutscenes) prepare the journey map's islands in the background. */}
    {prewarmModes.includes(mode) && <IslandPrewarm chapter={chapter} />}
    {__DEV__ && <PerformanceStats mode={mode} chapter={chapter} stage={props.boardKey} />}
    <CameraDirector mode={mode} chapter={envChapter} n={level.size} insets={props.insets} mapScroll={props.mapScroll} view={props.view ?? 'tilt'}
      pulse={props.state} won={props.trace.won} devoured={!!props.trace.absorbed} stage={props.boardKey} ready={stageReady} />
  </>;
}

const cameraOptions = { fov: CAMERA_FOV, near: .1, far: 900, position: [0, 40, 90] as [number, number, number] };
const glOptions = { antialias: true, powerPreference: 'high-performance' as const };
const canvasStyle = { flex: 1 };

/**
 * Memoised: every render here re-configures the R3F root and reconciles the whole 3D tree, so it should only happen
 * when a scene input actually changes. Callers must pass stable `onTap` / `onBlocked` callbacks.
 */
export const World = React.memo(function World(props: WorldProps) {
  const onTapRef = useRef(props.onTap);
  const onBlockedRef = useRef(props.onBlocked);
  const onPreviewRef = useRef(props.onPreview);
  const onTurnDoneRef = useRef(props.onTurnDone);
  onTapRef.current = props.onTap;
  onBlockedRef.current = props.onBlocked;
  onPreviewRef.current = props.onPreview;
  onTurnDoneRef.current = props.onTurnDone;
  const onTap = useCallback((id: string) => onTapRef.current?.(id), []);
  const onBlocked = useCallback(() => onBlockedRef.current?.(), []);
  const onPreview = useCallback((id: string | undefined) => onPreviewRef.current?.(id), []);
  const onTurnDone = useCallback(() => onTurnDoneRef.current?.(), []);
  const onDevourDoneRef = useRef(props.onDevourDone);
  onDevourDoneRef.current = props.onDevourDone;
  const onDevourDone = useCallback(() => onDevourDoneRef.current?.(), []);
  // collapsable={false}: with pointerEvents 'auto' and only layout styles, Fabric flattens this view away, so every switch
  // between gameplay and another screen re-parented the GL view. Android then destroyed its surface and the whole 3D
  // context, and the scene was rebuilt from scratch (seconds of empty screen on a phone at every level start).
  return <View style={StyleSheet.absoluteFill} pointerEvents={props.mode === 'game' ? 'auto' : 'none'} collapsable={false}>
    <SceneBoundary>
      <Canvas shadows camera={cameraOptions} style={canvasStyle} gl={glOptions}>
        <WorldContent {...props} onTap={onTap} onBlocked={onBlocked} onPreview={onPreview} onTurnDone={onTurnDone} onDevourDone={onDevourDone} />
      </Canvas>
    </SceneBoundary>
  </View>;
});
