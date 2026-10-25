import React, { useMemo, useRef } from 'react';
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Sprite } from 'three';
import { useFrame } from './Canvas';
import { gemGeometry, glowTexture, heartGeometry, shardGeometry, sparkTexture } from './fx';
import { useAppear } from './Board';
import { BeamClock } from './Beam';
import { Look } from './look';
import { audio } from '../services/audio';

/** Shared timeline for the solved-board celebration. `start` is the clock time charging began, or -1. */
export interface WinClock { start: number }
export const CHARGE_TIME = 1.7;
const GEM_BOTTOM = -.62;
const pedestalColors = ['#d7c3a6', '#6f7b68', '#d9b27a', '#cfe6f6', '#3a3f58'];

export const CrystalPiece = React.memo(function CrystalPiece({ at, clock, win, index, look, chapter, heart, delay, sounds }: {
  at?: number; clock: BeamClock; win: WinClock; index: number; look: Look; chapter: number; heart: boolean; delay: number; sounds: boolean;
}) {
  const root = useRef<Group>(null);
  const gem = useRef<Group>(null);
  const fill = useRef<Mesh>(null);
  const halo = useRef<Sprite>(null);
  const flash = useRef<Sprite>(null);
  const pillar = useRef<Mesh>(null);
  const motes = useRef<Group>(null);
  const rings = useRef<Group>(null);
  const shell = useRef<MeshStandardMaterial>(null);
  const lit = useRef(0);
  const wasLit = useRef(false);
  const appear = useAppear(delay);
  const geo = heart ? heartGeometry : gemGeometry;
  const bottom = heart ? -.9 : GEM_BOTTOM;
  const moteSeeds = useMemo(() => Array.from({ length: 10 }, (_, i) => ({ a: i * .628, h: (i % 5) * .25, r: .9 + (i % 3) * .25 })), []);
  useFrame(({ clock: c }, dt) => {
    const t = c.elapsedTime;
    const on = at !== undefined && clock.reveal.value >= at && clock.abyss.drain.value <= at;
    if (on && !wasLit.current && sounds && win.start < 0) { audio.play('crystal', .55); audio.haptic(); }
    wasLit.current = on;
    lit.current += ((on ? 1 : 0) - lit.current) * Math.min(1, dt * 6);
    const charging = win.start >= 0;
    const age = charging ? t - win.start - index * .08 : -1;
    const charge = charging ? Math.min(1, Math.max(0, age / CHARGE_TIME)) : 0;
    const burst = charging ? Math.max(0, age - CHARGE_TIME) : -1;
    const L = lit.current;
    const level = .35 * L + .65 * charge * charge;
    if (root.current) root.current.scale.setScalar(Math.max(.001, appear(t)) * (heart ? 1.25 : 1));
    if (gem.current) {
      const shake = charge > .6 && burst < 0 ? Math.sin(t * 70) * .02 * charge : 0;
      gem.current.position.set(shake, 1.05 + Math.sin(t * 2) * .06 + L * .1 + charge * .35, 0);
      gem.current.rotation.y = t * (.5 + L * 1.5 + charge * 7);
      const pulse = burst >= 0 ? 1 + Math.max(0, .35 - burst * .8) : 1 + charge * .18;
      gem.current.scale.setScalar(pulse);
    }
    if (fill.current) {
      const s = Math.max(.02, level);
      const k = heart ? .7 * 1.02 : 1.02;
      fill.current.scale.set(k, k * s, k);
      fill.current.position.y = bottom * k * (1 - s);
      (fill.current.material as MeshBasicMaterial).opacity = level * .75;
    }
    if (shell.current) shell.current.emissiveIntensity = .15 + L * .5 + charge * 1.6 + (burst >= 0 ? Math.max(0, 2 - burst * 2) : 0);
    if (halo.current) {
      const s = 1.2 + L * 1.3 + charge * 2.4 + Math.sin(t * 7) * .15 * L;
      halo.current.scale.set(s, s, 1);
      halo.current.material.opacity = .3 + L * .5 + charge * .2;
    }
    if (motes.current) {
      motes.current.visible = charge > 0 && charge < 1;
      motes.current.children.forEach((m, i) => {
        const sd = moteSeeds[i]!;
        const k = 1 - charge;
        m.position.set(Math.cos(sd.a + t * 3) * sd.r * k, (sd.h - .4) * k + 1.05 + charge * .35, Math.sin(sd.a + t * 3) * sd.r * k);
      });
    }
    if (rings.current) rings.current.children.forEach((r, i) => {
      const k = ((t * 1.3 + i / 3) % 1);
      r.visible = charging && burst < 0;
      r.scale.set(1 + k * 1.6, 1 + k * 1.6, 1);
      ((r as Mesh).material as MeshBasicMaterial).opacity = (1 - k) * .7 * charge;
    });
    if (flash.current) {
      const f = burst >= 0 ? Math.max(0, 1 - burst * 1.6) : 0;
      flash.current.visible = f > 0;
      flash.current.scale.setScalar(2 + (1 - f) * 7);
      flash.current.material.opacity = f;
    }
    if (pillar.current) {
      const p = burst >= 0 ? Math.min(1, burst * 4) * Math.max(0, 1 - Math.max(0, burst - .9) * .8) : 0;
      pillar.current.visible = p > 0;
      pillar.current.scale.set(.2 + p * .8, 1, .2 + p * .8);
      (pillar.current.material as MeshBasicMaterial).opacity = p * .55;
    }
  });
  return <group ref={root}>
    <mesh position={[0, .1, 0]} castShadow receiveShadow><cylinderGeometry args={[.42, .48, .2, 8]} /><meshStandardMaterial color={pedestalColors[chapter]} flatShading roughness={.8} /></mesh>
    <mesh position={[0, .24, 0]}><cylinderGeometry args={[.36, .4, .1, 24]} /><meshStandardMaterial color={look.frame} metalness={1} roughness={.3} /></mesh>
    <mesh position={[0, .3, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[.22, .34, 32]} /><meshBasicMaterial color={look.crystalGlow} toneMapped={false} /></mesh>
    <group ref={rings} position={[0, .32, 0]}>
      {[0, 1, 2].map(i => <mesh key={i} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[.4, .48, 40]} />
        <meshBasicMaterial color={look.crystal} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} /></mesh>)}
    </group>
    <group ref={gem} position={[0, 1.05, 0]}>
      <mesh geometry={geo} castShadow dispose={null} scale={heart ? .7 : 1}>
        <meshStandardMaterial ref={shell} color={look.crystal} emissive={look.crystalGlow} emissiveIntensity={.2} flatShading roughness={.05} metalness={.25}
          envMapIntensity={2} />
      </mesh>
      {/* The rising "liquid light" is drawn on top of the opaque gem so the fill level stays readable from every angle. */}
      <mesh ref={fill} geometry={geo} dispose={null} renderOrder={3} scale={heart ? .7 : 1}>
        <meshBasicMaterial color={look.beamGlow} transparent opacity={.4} depthWrite={false} depthTest={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <sprite ref={halo} renderOrder={6}><spriteMaterial map={glowTexture} color={look.crystalGlow} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} /></sprite>
    </group>
    {[[-.32, .38, .1, .5], [.3, .34, -.12, -.6], [.05, .34, .32, .2]].map(([x, y, z, r], i) =>
      <mesh key={i} geometry={shardGeometry} position={[x!, y!, z!]} rotation={[r!, 0, r!]} dispose={null}>
        <meshStandardMaterial color={look.crystal} emissive={look.crystalGlow} emissiveIntensity={.4} flatShading />
      </mesh>)}
    <group ref={motes} visible={false}>{moteSeeds.map((_, i) => <sprite key={i} scale={[.3, .3, 1]} renderOrder={7}>
      <spriteMaterial map={sparkTexture} color={look.beamGlow} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </sprite>)}</group>
    <sprite ref={flash} position={[0, 1.4, 0]} visible={false} renderOrder={9}>
      <spriteMaterial map={glowTexture} color="#ffffff" transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </sprite>
    <mesh ref={pillar} position={[0, 7, 0]} visible={false}><cylinderGeometry args={[.5, .5, 12, 20, 1, true]} />
      <meshBasicMaterial color={look.crystal} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} side={2} /></mesh>
  </group>;
});
