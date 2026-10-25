# Rootbound Totems (Rainforest modifier)

Rootbound Totems replaced the Rainforest's connecting-vine modifier ("root networks") on 2026-10-22. A carved totem turns
an explicitly defined cluster of board cells a quarter turn around a pivot. Every mirror, stone, crystal, prism and light
cannon standing on the cluster moves with it. This document covers the rules, the data, what was removed, how the
mechanic is shown and animated, and how it was validated.

## 1. What was removed

The old modifier bound mirrors with vines: a tap turned the mirror and every mirror its vines touched. It is gone from
the whole game, because it was also used by two Ice Age levels and seven Void levels.

| Area | Removed |
| --- | --- |
| Level data | `Level.roots` and the `Root` type; vine edges in all 18 Rainforest levels, Ice Age 8 and 11 (62, 65) and Void 8, 11, 12, 14, 15, 17, 18 (80, 83, 84, 86, 87, 89, 90) |
| Rules | The vine adjacency index, `groupOf` (a tap turning several mirrors), vine validation, and the `link` / `chain` mechanic tags |
| Generator | The `roots` / `chain` / `crossRoot` spec fields and the `root-unused`, `root-idle`, `chain-unused` and vine `cross-unused` checks |
| 3D | `LinkVine`, the glowing tube drawn between bound mirrors, and the gold "turns with it" ring on held mirrors (`MirrorPiece.marked`) |
| HUD | The "THIS TAP TURNS N MIRRORS" chip and its vine icon |
| Audio | `grow`, the vine rustle played when a tap turned several mirrors (still rendered by the seeded generator, never written; the file is deleted) |
| Text | The Rainforest intro lines 2 and 3 (re-recorded), its "New in this world" list, the `link` and `chain` tips, and every Rainforest title and beat that mentioned vines |
| Tests | The vine rules, vine-chain and "vines matter" tests (replaced by totem tests, see 8) |

Kept on purpose, because it is ordinary scenery and connects nothing:

* the ferns, moss, mushrooms, puddles and short vines hanging under the board's rim (`Board.tsx`, `Rim`);
* the jungle's trees, canopy, trunk vines, ferns, ruins and waterfall (`env/Rainforest.tsx`);
* the vines on the Rainforest islands of the journey map (`map/islands.ts`).

The Rainforest's light cannon, a mossy carved block, used to be called the "Spirit Totem". It is now the **Spirit Idol**
in code and text, so it is never confused with a rootbound totem.

## 2. The rules

* **Cluster.** A cluster is an explicit, edge-connected set of cells, listed in the level data. It is never inferred from
  proximity or from anything drawn. Every piece standing on one of its cells when the level opens belongs to it for good.
  A cluster may carry mirrors (turnable or fixed), stones, crystals, prisms and light cannons. It can never carry
  wormholes, seals, gates, Devourer zones, floe tracks or totems.
* **Totem.** Each cluster has exactly one totem. The totem stands on its own cell outside every cluster, and light stops
  at it like a stone. Tapping the totem is the move; it costs one move like any other tap.
* **Pivot and angle.** The pivot is either a cell centre (whole coordinates) or the corner where four cells meet (both
  coordinates end in .5). Every tap turns the cluster by exactly 90 degrees, so every turned cell lands on a whole cell.
* **Direction.** Each cluster has one direction, `turn`: 1 is clockwise and -1 is counter-clockwise, seen from above with
  north at the top. A cluster never turns the other way, so undoing a quarter turn by playing takes three more taps.
* **What moves.** Each piece moves to its turned cell. Mirrors swap their slant, because a quarter-turned diagonal is the
  other diagonal; this applies to fixed mirrors too. Cannons turn their aim with the cluster: clockwise turns right,
  counter-clockwise turns left. Crystals, prisms and stones just move. Empty cells of the cluster move too: they are the
  cluster's own stones, and they keep blocking other clusters wherever they go. Turnable mirrors and turnable cannons on
  a cluster can still be turned by hand.
* **Legality.** A turn is legal only if every cell the stones pass over or land on is on the board and is free of
  anything outside the cluster: pieces, totems and other clusters' stones. To find the passed-over cells, each stone's
  centre is traced along its quarter circle, sampled every tenth of a tile; a point exactly on a cell edge counts both
  cells. A refused turn changes nothing and costs no move. A 2x2 turntable never leaves its own cells, so it can never be
  blocked. A swinging cluster (arm, bar, L, T or domino) can be blocked, which is what makes the order of turns matter.
* **State.** The only new state is `PlayState.turns[cluster.id]`, the number of quarter turns made (0-3). Positions are
  derived from it, never stored, so nothing can ever sit between cells. Orientations and aims are updated as described
  above.
* **Light.** Light is traced after the cluster's pieces have moved. Light never moves anything, so the order of light and
  turns cannot matter.

Overlapping clusters are not allowed: cells are unique across clusters, and the turn rules keep them from overlapping later.

## 3. Data structure

`src/game/types.ts`:

```ts
export interface Cluster {
  id: string;                               // 'r1'
  totem: { id: string; position: Point };   // the tap ('t1') and its cell, outside every cluster
  cells: Point[];                           // the cells covered as the level opens
  pivot: Point;                             // a cell centre [x, z], or a corner [x + .5, z + .5]
  turn: 1 | -1;                             // clockwise or counter-clockwise, a quarter turn per tap
}
// Level.clusters: Cluster[]; Level.solutionTurns: Record<clusterId, number>; PlayState.turns: Record<clusterId, 0-3>
```

Level 19 (Rainforest 1) as stored in `levels.json`:

```json
"clusters": [{ "id": "r1", "totem": { "id": "t1", "position": [4, 2] }, "cells": [[4, 4], [3, 4], [4, 3], [3, 3]],
  "pivot": [3.5, 3.5], "turn": 1 }], "solutionTurns": { "r1": 1 }
```

Engine entry points (`src/game/engine.ts`) are `turnPoint`, `footprint`, `sweepOf`, `turnBlocks`, `placeOf`,
`clusterOfTotem` and `clusterAt`. `traceBeam` reads a per-state layout of the moved pieces; layouts are cached per
combination of turns, and none is built while every cluster is unturned. `validateLevel` checks every rule in section 2.

## 4. How a cluster is shown

**At rest.** The cluster's cells are covered by jade-carved stone plates that are cooler and greener than any floor. A
faint rune ring is set in each plate, a stone hub marks the pivot, and a dim line traces the cluster's outer edge. The
totem's runes glow faintly in the cluster's colour. A carved arrow on its plinth shows which way it turns. The first
cluster is emerald and the second amber, so two clusters never look alike. Nothing connects the totem to its stones,
and nothing is drawn between pieces.

**Held** (press and hold the totem):

* the cluster's outline lights up with breathing corner brackets;
* the pivot shows a floor ring and a soft column of light;
* a curved arrow turns around the cluster on the side facing the camera;
* a ghost outline shows where the stones will land;
* the dashed preview beam shows the light after the turn;
* a status chip reads "THESE STONES TURN CLOCKWISE" (or COUNTER-CLOCKWISE).

If the turn is blocked, the cells in the way are marked in red and the chip reads "SOMETHING BLOCKS THESE STONES".
Releasing costs nothing.

**Refused tap.** The totem shudders, the outline and the blocking cells flash red, and the `bonk` sound plays. The
activation sequence never plays, and no move is spent.

## 5. The cinematic turn

All timings are constants at the top of `src/world/Totems.tsx` (`WAKE`, `STRAIN`, `SWING`, `LAND`) and can be tuned there.

| Phase | Time | What happens | Sound |
| --- | --- | --- | --- |
| A, wake | 0-0.34 s | The totem's runes ignite, a ring of light climbs its carvings, its crown shivers and four leaves fall from it. The outline fades in, and the ghost of the landing cells appears. | `awaken`: a carved-wood double click, then a low rumble |
| B, strain | 0.34-0.60 s | The joints between the stones flare, the pivot pulses, and the stones rise 0.09 tile. The board trembles slightly, and the light starts falling back to where the old and new light part ways. | `grind` starts |
| C, swing | 0.60-1.52 s | The whole cluster turns 90 degrees as one rig with a quintic ease-in-out: no velocity or acceleration at either end, and no overshoot. Emerald motes rise from the stones, leaves drift down, a faint rumble runs through the board, and the arrow creeps along its direction. | `grind`: stone grinding, a wooden creak and a low resonance |
| D, land | 1.52-1.84 s | The stones drop the last bit, dip 0.012 tile and settle exactly on the grid. A short camera shake, a dust ring and a leaf scatter follow, and the outline flashes once and fades. At the impact the game shows the new light, which regrows from the parting point and wakes crystals with their usual effect and sound. | `settle`: a deep impact, then an emerald shimmer |

How it is built:

* The cluster's pieces are children of one group placed at the pivot. The rules hand over the turn count, and only that
  group's yaw and lift change per frame: no React state updates and no per-piece updates during the turn.
* The light is traced once, after the move, by the rules. It is never traced per frame.
* While the stones turn, the app keeps showing the old light, and the HUD's crystal count stays as it was. The new light
  replaces it at the impact.
* An undo turns the stones straight back in 0.42 s, without ceremony.

## 6. Integration

* **Input.** All input is locked from the tap until the stones land, then for 0.32 s more. Rapid taps cannot start
  overlapping turns, and phase sounds cannot overlap. Undo and hints are blocked during a turn.
* **Outcome.** A win, a Devourer loss or running out of moves is decided when the stones land. Crystal charge, the win
  fanfare and the fail screen follow from there.
* **Restart.** Restarting during a turn rebuilds the board, which cancels the animation, its sounds and the pending
  landing.
* **Undo.** Undo restores the exact previous snapshot (moves never mutate state), and the stones turn back.
* **Pause and background.** The board keeps animating under the pause menu. If the app is sent away mid-turn, a fallback
  timer completes the move. When the app returns, sounds whose moment has passed are skipped.
* **Saves.** The game saves only finished results (stars, best move count), never a board in progress, so there is no
  totem state to save or load. Saved results stay on their level ids.
* **Hints and preview.** The solver treats a totem as one more tap, and the hold preview works on totems as on any piece.

## 7. The 18 Rainforest levels

Values computed by `scripts/level-report.ts` and the engine. "Frozen" means the level with that cluster stuck where it
opens and its totem a plain stone: for every cluster in every level, the level then cannot be won at all.

| Level | Title | Board | Cannons | Clusters (carried pieces) | Verified solution | Par |
| --- | --- | --- | --- | --- | --- | --- |
| 19 | The Waking Stones | 5x5 | 1 | 2x2 turntable CW (mirror, crystal) | `t1` | 1 |
| 20 | Under the Storm | 5x5 | 1 | 2x2 turntable CW (mirror) | `m2 t1` | 2 |
| 21 | Root Shrine | 5x5 | 1 | 2x2 turntable CW (mirror) | `m1 m2 t1` | 3 |
| 22 | Moss Temple | 6x6 | 1 | 2x2 turntable CW (mirror, stone on the light's road) | `m1 m2 t1` | 3 |
| 23 | Firefly Hollow | 6x6 | 1 | 2x2 turntable CW (fixed mirror, crystal, stone) | `m2 m3 t1` | 3 |
| 24 | The Strangler Fig | 6x6 | 1 | 2x2 turntable CW (fixed mirror, stone) | `m3 t1 t1` | 3 |
| 25 | Riding Light | 6x6 | 1 | 2x2 turntable CW (idol, crystal) | `m2 m3 t1` | 3 |
| 26 | Rain Shrine | 6x6 | 1 | 2x2 turntable CW (two mirrors, idol) | `m1 m3 t1` | 3 |
| 27 | Serpent Stair | 6x6 | 1 | 2x2 turntable CW (idol, crystal) | `m1 m3 t1 t1` | 4 |
| 28 | Twin Totems | 7x7 | 1 | arm CW (fixed mirror); 2x2 turntable CCW (mirror, stone) | `m1 m3 t1 t2 t2` | 5 |
| 29 | Jaguar Stones | 7x7 | 1 | 2x2 turntable CW (fixed mirror, stone); T CCW (two mirrors, crystal) | `m1 m3 t1 t2 t2` | 5 |
| 30 | Knotted Grove | 7x7 | 1 | 2x2 turntable CW (two mirrors); L CCW (idol) | `m3 d1 t1 t2` | 4 |
| 31 | Locked Roots | 7x7 | 2 | bar CW (idol), jammed; T CCW (mirror, crystal) | `t2 t2 t1 t1 t1` | 5 |
| 32 | Twin Springs | 7x7 | 2 | T CW (two mirrors), jammed; L CCW (crystal, stone) | `e1 e1 e1 t2 t1` | 5 |
| 33 | Mist Falls | 7x7 | 2 | bar CCW (mirror), jammed; T CCW (two crystals) | `m2 m4 m6 t2 t1 t1` | 6 |
| 34 | Storm Eye | 7x7 | 3 | two 2x2 turntables CCW (idol, crystal / fixed mirror, idol) | `m3 t1 t2 t2 t2` | 5 |
| 35 | Thunder King | 7x7 | 2 | T CCW (mirror, crystal), jammed; bar CCW (mirror) | `e1 t2 t1 t1` | 4 |
| 36 | The Life Heart | 7x7 | 3 | 2x2 turntable CW (fixed mirror, stone); 2x2 turntable CCW (two mirrors, idol) | `m3 m4 m5 m6 t1 t2 t2` | 7 |

How the levels progress:

* 1-3: one small turntable and a single totem.
* 4-6: a mirror and a stone on the same stones. The stone stands on the light's road at the start, and the turn carries
  it off while bringing the mirror in.
* 7-9: the idol (cannon) rides the stones, so position and aim change together.
* 10-12: two clusters. The second turns the other way, so each arrow has to be read.
* 13-15: jams. One cluster opens across another's path, so it must be turned first, while two beams depend on the same
  stones.
* 16-18: triple and twin idols, hand-turned idols, fixed mirrors and two totems combined. The boss also defeats a greedy
  player who tries every tap.

Seals, wormholes and the Devourer are not used in the Rainforest. Rootbound totems also appear as "an earlier world's
trick" in seven Void levels (80, 83, 84, 86, 87, 89, 90), where they replaced the vines.

## 8. Validation

Every result below comes from running the real engine or the real app. No value was entered by hand.

| Check | Result |
| --- | --- |
| `npm test` | **233 / 233 pass** |
| `npx tsx scripts/level-report.ts` | **90 / 90 levels pass** (valid board, stored solution legal and winning on its last tap, par is the BFS optimum, and 3/2/1/0-shard outcomes each reached by real tap sequences); written to `docs/LEVEL_REPORT.md` |
| Regeneration | Building the five chapters reproduces `levels.json` byte for byte, with no spec relaxed on any level |
| Untouched levels | 63 of 90 levels are byte-identical to before. The 27 that changed are exactly the 27 that held vines (19-36, 62, 65, 80, 83, 84, 86, 87, 89, 90) |
| Old modifier gone | No `roots`/`vines` field in any level, no `link`/`chain` tag, no tip or chapter text mentioning vines (tested) |
| Every cluster valid | Explicit connected cells, a grid pivot, a totem on its own cell, nothing it cannot carry (`validateLevel`, all 25 totem levels) |
| Whole cells | In every state reachable within the move limit on all 25 totem levels, every piece stands on a whole cell inside the board, no two share one, clusters never overlap and never cover a totem (tested) |
| Orientations | Fixed and turnable mirrors swap slant per quarter turn, cannons turn their aim clockwise or counter-clockwise, four turns bring everything home (tested on hand-built boards) |
| Refusals | Stones in the landing cells or in the swing, a mirror, a totem, another cluster's stones and the board edge all refuse the turn; a refused turn returns the same state object and costs no move (tested) |
| Order | A hand-built jam: the first cluster is refused until the second turns away, then it turns home (tested); every level tagged `jam` has a cluster the solution turns that is refused at the start (tested) |
| Totems matter | Every totem is turned in its level's optimal solution, and frozen it leaves the level unsolvable: 34 of 34 clusters in 25 levels (the test requires at least two extra taps; every one is in fact unsolvable) |
| Light | Traced once per move after the pieces move; every solved light ends in its crystals, uses every wormhole, and runs in no loop (tested on all 90) |
| Restart and undo | Moves never mutate the state they start from (frozen-object test on all 90 solutions); restart rebuilds an identical opening |
| Approved mechanics | Turning cannons, seals and gates, the Devourer and wormholes: their tests pass unchanged, and Sky Temples and Desert levels are byte-identical |
| Hints | The sliced hint search returns exactly what `solve()` returns from a mid-game state on every level (tested) |
| Audio | The three new sounds were synthesized and their loudness envelopes checked against the phase timings (click at the tap, grind from 0.34 s, impact at 1.52 s). Every existing sound file stays byte-identical |

### On a representative mobile build (Pixel 9 emulator, release APK, all levels open)

* **Chapter intro.** The re-recorded narration and the new "New in this world" card show on screen.
* **Rainforest 1.** At rest the jade cluster reads clearly.
* **Holding the totem.**
  * Shows the outline, corner brackets, the clockwise arrow and the dashed future light.
  * Shows the chips "THIS MOVE LIGHTS EVERY CRYSTAL" and "THESE STONES TURN CLOCKWISE".
  * Releasing costs no move.
* **Tapping the totem.** Screen-recorded on the device:
  * the totem wakes and the outline appears at +0.2 s;
  * the stones rise;
  * the 2x2 swings as one piece with its mirror and crystal;
  * the stones land, the light regrows along the new route, and the crystal lights at +2.0 s;
  * the level ends "Flawless, 1 move".
* **Rainforest 13 (jam).**
  * Tapping the jammed totem flashes its outline red and leaves the move count at 10.
  * Restart during a turn rebuilds the board's opening cleanly.
  * Undo after a turn swings the stones back and restores the move.

Tuned after these runs:

* The swing now eases with a sine curve. The quintic curve left the stones looking stalled for a fifth of the swing at each end.
* The red marks on blocking cells are drawn over the pieces in the way. They had been hidden under other clusters' plates
  and a crystal's pedestal.
* The dust puff lasts longer and is larger, and the leaves are larger.

The tuned swing was re-recorded on the diagnostic build (Rainforest 4). The motion spreads evenly over about 0.7 s of
frames, the stone leaves the light's road, and the beam then runs on to the mirror the turn brought in.

### Performance

Diagnostic build (`PERF_HUD`) on the same emulator, Rainforest 4. Each value is one reading of the on-screen readout,
which averages the second before it. The readings were taken 4-5 s apart, so a screenshot never disturbed the next one.

| Moment | FPS | JS per frame | GPU wait | Longest frame gap | Draw calls |
| --- | --- | --- | --- | --- | --- |
| At rest | 51 | 16 ms | 2 ms | 85 ms | 132 |
| Mid-swing of a totem turn | 53 | 15 ms | 2 ms | 45 ms | 155 |
| After an ordinary mirror tap | 54 | 13 ms | 2 ms | 58 ms | 131 |

* A turn costs about what an ordinary move costs. It adds about 24 draw calls while its outline, guides and particles
  show, with no extra GPU wait.
* The GL context was never rebuilt (`CTX 1`), and the shader count stayed flat across turns (43).
* Back-to-back captures one second apart dragged both the totem turn and a plain mirror tap down to 35-49 FPS. That
  dip comes from the captures, not from the turn.
* Memory notes from earlier sessions warn that this RTX-backed emulator hides phone-only lag (120 Hz scheduling, Mali
  GPUs). A phone run with the diagnostic APK (`build-output/mirror-maze-DIAGNOSTIC.apk`) is the remaining check.

How the turn is kept cheap:

* Per frame, a turn changes one group's transform per turning cluster. No React state changes during the turn: React
  renders once at the tap and once at the landing.
* Geometry is built once and merged:
  * a cluster's plates, runes, outline, seams and corner marks are one mesh each;
  * the totem's body, crown and runes are shared by every totem.
* Particles are small pooled sets (12 motes, 10 leaves in one instanced mesh, 10 dust sprites). They are hidden unless a
  turn is playing.
* Materials made per cluster are disposed when the board unmounts.
* The light is traced once per move, never per frame. Layouts of moved pieces are cached per combination of turns.

## 9. Limitations

* **Swept cells.** A turn is blocked by what the stones' centres pass over, traced along their quarter circles. The
  corners of a swinging plate can visually brush a neighbouring piece without blocking. Turntables never leave their
  own cells, so they cannot be blocked at all.
* **Undo animation.** Undo plays a quick 0.42 s turn back, without the wake and landing ceremony. The light switches at
  once, as it does for any other undo.
* **Refused taps by accessibility button.** A tap through the screen-reader button on a blocked totem plays the refusal
  sound but not the red flash, which belongs to the 3D tap.
* **Audio review.** The sounds were checked by their measured envelopes and play without errors on the emulator. Nobody
  has listened to them on a phone speaker yet.
* **Levels with improved par.** Saved results stay on their level ids. On the 27 rebuilt levels, an old best move count
  can be lower than the new par.
