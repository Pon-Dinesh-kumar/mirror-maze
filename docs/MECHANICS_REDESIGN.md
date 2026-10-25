# Mirror Maze: difficulty modifier audit and redesign

> **Superseded for the Rainforest (2026-10-22).** The root networks described below (vines binding mirrors, `Level.roots`)
> have been removed from the whole game and replaced by **Rootbound Totems**: see [ROOTBOUND_TOTEMS.md](ROOTBOUND_TOTEMS.md).
> The Ice Age levels that used a vine (62, 65) were rebuilt without one, and the Void levels that used vines (80, 83, 84,
> 86, 87, 89, 90) now use a totem instead. Everything else in this document still describes the game.

Phase 1 (audit and recommendation) was written before any gameplay code changed. Phase 2 results are in
"Implementation and validation" at the end. Every number in the audit was computed from the shipped `levels.json` with
the game's own engine (`solve()` is an exhaustive breadth-first search, so "par" is the true optimum).

## 1. Inventory of the existing mechanics

| Mechanic | Data / engine | Where | Player decision it creates | Depends on |
| --- | --- | --- | --- | --- |
| Turnable mirror | `Mirror`, `orientations`, `applyMove` | all | which mirrors to flip | core |
| Fixed mirror, spare ("decoy") mirror, stone block | `fixed`, `d*` ids, `blockers` | all | constraints / red herrings | core |
| Several crystals | `targets` (pass-through) | all | one beam must serve several goals | core |
| **Rotating cannon** (approved) | `Emitter.rotatable`, `aims` | Ch1 identity, reused later | aiming, coordination of 2-3 cannons | core |
| Twin / triple cannons | `emitters[]`, branch per cannon | all chapters 13-18 | every crystal lit at once | core |
| Linked mirrors ("vine-bound") | `Mirror.link` groups (always pairs) | Ch2 5 levels, Ch4 4, Ch5 4 | coupled flips (2-for-1) | `groupOf`, `LinkVine` |
| Growing vines | `Vine.growAt`, `state.step` | Ch2 (17 levels), Ch5 3 | avoid a tile that closes after N moves | `boardOf`, `VinePiece`, HUD chip |
| Thornvines | `Vine.burnable`, `burning`/`burned` | Ch2 8 levels | light it one move early | `settle`, `VinePiece`, HUD chip |
| **Solar seals + gates** (approved) | `Seal`, `Gate`, `sealed`, ordered latch | Ch3 identity, Ch5 3 | ordered multi-objective, gates opening/closing | `settle`, `SealPiece`, `GatePiece`, HUD counter |
| Prism | `Splitter` (always splits left + right) | Ch3 12, Ch4 3, Ch5 6 | none of its own; one beam serves two goals | `traceBeam` branches |
| Cursed gem | `Hazard`, `hazardsLit` | Ch3 11, Ch4 9, Ch5 5 | "keep light off it" (no win while lit) | `CursedGem`, red HUD banner, `curse` sound |
| Frozen mirror | `Mirror.frozen`, `thawed` | Ch4 identity (18), Ch5 4 | none: light thaws on-path ice for free | `settle`, ice mesh in `MirrorPiece`, `thaw` sound |
| Glacier mirror + brazier | `glacier`, `Heater`, `heated` | Ch4 9 levels | light the brazier first (a switch) | `settle`, `HeaterPiece`, `burn`/`thaw` sounds |
| **Light Devourer / black hole** (approved) | `Devourer.zone`, `absorbed` | Ch5 identity | hazard avoidance, hard loss with rewind | `traceBeam`, `DevourerPiece`, fail screen |
| **Wormhole / teleporter** (approved) | `Portal {position, exit}` | Ch5 15 levels | spatial routing, direction preserved | `traceBeam`, `PortalPiece` |
| Hold-to-preview | `GhostBeam`, `onPreview` | all | see a move before spending it | UI only |

**The "backhoe".** No excavator, digger or backhoe exists anywhere in the code, scenery or level data. The only
chapter piece shaped like one is the Ice Age **brazier**: a bucket-shaped bowl on three splayed legs (`HeaterPiece`). It is
audited below as "glacier mirror + brazier".

## 2. Audit: which mechanics are weak, and why

Measured by deleting the modifier from each level and re-solving:

| Modifier | Levels | Optimum changed when removed | Verdict |
| --- | --- | --- | --- |
| Cursed gem | 25 | **3 of 17** checked levels (Ch3/Ch4); 14 unchanged | Weak, and redundant with the Devourer (both "keep light off X"). **Remove** (requested). |
| Growing vines | 20 | **4 of 18** Rainforest levels | Weak: an automatic timer that closes a tile. It punishes slow play but rarely changes the solution. **Remove.** |
| Thornvines | 8 | (inside the vine numbers) | Weak: "light it once, then route through" is a one-step switch, the same loop as a seal. **Remove.** |
| Frozen mirror | 22 | **0 of 22** levels without braziers | Decorative: the light reaches every mirror on its road anyway, so thawing is free. **Redesign.** |
| Glacier mirror + brazier ("backhoe") | 9 | **1 of 9** (level 67: 7 → 5) | A switch that unlocks a mirror. Too close to "light a seal to open a gate". **Remove.** |
| Prism | 21 | (structural) | No decision of its own, but in the Desert it lets one beam wake a seal and a crystal together. **Keep as a shared piece** in the Desert and Void; it no longer anchors the Ice Age. |
| Linked mirrors | 13 | 5 of 13 (coupling made par 1 shorter) | Genuinely strategic (coupled state). Under-used: only ever pairs. **Promote and deepen.** |
| Rotating cannon / seals / Devourer / wormholes | approved | seals add 1-4 taps to the optimum in 15 of 18 Desert levels; every wormhole lies on its level's solution | **Keep unchanged.** |

## 3. Candidate replacement mechanics

Each candidate was judged against the engine as it stands: a square grid, two-state mirrors, a pure `traceBeam`, a
`settle` pass for latched effects, and a breadth-first solver over a compact state key.

### A. Root networks (vine-bound mirrors, Lights-Out coupling)

1. **Player:** taps a mirror; every mirror joined to it by a vine turns too, but only one vine away (vines don't chain).
2. **State:** the same orientations as today; a tap XORs the mirror and its vine neighbours. Order never matters, only which mirrors are tapped.
3. **Strategy:** taps have side effects. The obvious "fix each wrong mirror" plan breaks the neighbours. In a chain A-B-C, tapping B turns all three, and to turn only B you tap A, B and C. Players reason about which combination of taps leaves exactly the right mirrors turned.
4. **Distinct:** no aiming, no hazard, no relocation, no ordered objective. It is the only mechanic about the side effects of a single tap.
5. **18-level curve:** pairs (2-for-1) → a pair where one end must stay put → chains of three (the middle tap) → two networks → vines that join mirrors on different cannons' beams (twin) → triple-cannon networks where fixing one beam disturbs another.
6. **Tutorial:** "Vines bind mirrors. Turning one turns every mirror its vines touch." Holding a mirror highlights exactly which mirrors will turn.
7. **Theme:** the Rainforest intro already says "The Void's vines have bound the old mirrors together. Turn one, and its twin turns too."
8. **Support:** direct. `groupOf` and `LinkVine` exist; groups become graph edges.
9. **Risks:** low. No new per-frame work; the solver state is unchanged.
10. **Validation:** the solver handles it. A level is accepted only if the decoupled optimum does not also solve the coupled board (the vines must change the answer).

### B. Drift ice (sliding frozen mirrors)

1. **Player:** taps a frozen mirror. It can't turn, but its ice floe glides along a straight ice track until it reaches the end of the track or meets another floe.
2. **State:** each floe has a track index and a facing (+1/-1) along its track. Light treats a floe as a mirror wherever it stands.
3. **Strategy:** the choice moves from *which way* a mirror faces to *where* it stands. Floes stop only against other floes, so to park a floe mid-track you must first slide another floe into its way, and often slide it out again afterwards because it now blocks the light. That is ordering and spatial planning.
4. **Distinct:** cannons change a beam's direction at its source; wormholes move the beam; floes move the reflector and block each other. No light-activated switch is involved.
5. **18-level curve:** one floe, two-cell track → longer tracks with turnable mirrors → crossing tracks (whoever is at the crossing blocks the other) → a floe used as a stopper → a stopper that must leave the light's road afterwards → twin and triple lanterns sharing floes.
6. **Tutorial:** "Frozen mirrors can't turn, but the ice slides. Tap to glide it until something stops it." An arrow on the floe shows which way it goes next; holding previews the light.
7. **Theme:** ice, sliding, frozen-in-place mirrors. It keeps the Ice Age's frozen-mirror identity and the intro line "Ice-locked mirrors will not turn".
8. **Support:** a new piece type. `traceBeam` reads floe positions from the board state, and the state key gains positions.
9. **Risks:** medium. It needs a new animated piece and a track on the floor; per-frame cost is one eased position per floe. A hidden "facing" would confuse players, so it is drawn as a chevron.
10. **Validation:** the solver over positions. Generator checks: the solution slides a floe, and on stopper levels the final board holds a floe mid-track (provably stopped by another floe).

### C. Twin-light crystals (convergence)

1. **Player:** brings two different beams (two cannons, or both halves of a prism) onto one crystal at the same time.
2. **State:** none new. Win requires `beamsAt(crystal) >= 2`.
3. **Strategy:** rendezvous routing gives prisms a purpose.
4. **Distinct:** partly. It is another "complete several objectives" goal, overlapping the Solar Seals' multi-objective role.
5. **Curve:** prism rejoin → two cannons meet → meeting with blockers.
6. **Tutorial:** short.
7. **Theme:** fits the Desert or Void better than ice or jungle.
8. **Support:** direct (count branches per target).
9. **Risks:** low engine risk. The beam visuals need a "half-lit" crystal state.
10. **Validation:** the solver handles it.

*Rejected* as a chapter identity: it overlaps the seals' multi-objective role and needs two beams on every board.

### D. Fading light (bounce budget)

1. **Player:** routes light that dies after N reflections.
2. **State:** a per-ray counter.
3. **Strategy:** shortest-route economy.
4. **Distinct:** yes, but it mostly removes options rather than adding decisions.
5. **Curve:** shrinking budgets, which is exactly "difficulty by restriction" the brief rules out.
6. **Tutorial:** short, but the dimming is hard to read on a phone.
7. **Theme:** neutral.
8. **Support:** trivial.
9. **Risks:** low.
10. **Validation:** easy.

*Rejected*: it adds restriction, not reasoning.

### Also considered and rejected

- *Light-planted seeds* (lit tiles sprout permanent mirrors): the same "light latches a board change" loop as Solar Seals.
- *Heliotrope mirrors* (flip whenever lit): automatic behaviour the player doesn't control, hard to predict.
- *Water gates / flood channels*: excluded by the brief, since they are switch-gated routes.

## 4. Recommendation

| Chapter | Identity (kept / new) | Supporting pieces |
| --- | --- | --- |
| 1 Sky Temples | **Rotating cannons** (approved, levels unchanged) | fixed mirrors, stones, twin/triple cannons |
| 2 Rainforest | **Root networks** (new, replaces growing vines and thornvines) | turning spirit totems late, twin/triple |
| 3 Desert | **Solar seals** (approved) | prisms, turning Eye of Ra; cursed gems removed |
| 4 Ice Age | **Drift ice** (new, replaces frozen/glacier mirrors and braziers) | ordinary mirrors, a few root vines, twin/triple lanterns |
| 5 The Void | **Black holes + wormholes** (approved) | every earlier world's trick: cannons, vines, seals, drift ice, prisms; cursed gems, growing vines and thawing removed |

Why these two: they are the only candidates that add a new *kind* of reasoning. Root networks are about the side
effects of a tap, and drift ice is about position and mutual blocking. Both are fully deterministic, readable from the
board, previewable by holding, and searchable by the existing solver. Both reuse the existing look: vine tubes and
frozen-mirror ice.

**Affected levels:** Rainforest 19-36 and Ice Age 55-72 are rebuilt around the new mechanics. Desert 37-54 and Void
73-90 are rebuilt without cursed gems, vines and thawing. Sky Temples 1-18 keep exactly the same boards. Level ids,
titles' slots, story, cutscenes, map and saves are unchanged (saved results stay attached to their level ids).

**The four approved mechanics stay intact:** `rotatable` cannons, `Devourer` zones and the absorb-and-rewind loss,
`Portal` entry/exit (one-way, direction preserved, loop-guarded), and `Seal`/`Gate` with ordered latching and the
"SOLAR SEALS n/m" HUD counter. Their engine code paths are not modified.

## 5. Implementation and validation

### Rules as implemented

- **Root networks** (`Level.roots: { id, a, b }[]`, `groupOf` in `src/game/engine.ts`). A tap flips the tapped mirror
  and every mirror one vine away. Vines may only join turnable mirrors. Holding a mirror turns the rings of every mirror
  the tap would turn gold, makes its vines glow, and shows a "THIS TAP TURNS N MIRRORS" chip above the board.
- **Drift ice** (`Level.floes: { id, track, at, facing, orientation }[]`, `glide` in `src/game/engine.ts`).
  - A floe is a fixed-orientation mirror riding a straight track of open ice. A tap glides it the way it faces until
    its track ends or the next cell holds another floe.
  - It turns to face back only at a track end. If its way is blocked at once, it glides the other way. If it is boxed
    in, the tap is refused and costs no move.
  - A chevron on the ice shows the next glide. Tracks are validated: straight, two or more cells, nothing standing on
    them, and crossing other tracks at most once.

### Code changes

| Area | Files |
| --- | --- |
| Rules, solver, validation | `src/game/types.ts`, `src/game/engine.ts`, `src/game/levels.ts` |
| Campaign | `scripts/generate-levels.ts` (new specs and checks), `src/game/levels.json` (regenerated, seeded) |
| Text and tutorials | `src/game/chapters.ts` (mechanics lists, tips, Rainforest/Ice beats, Desert level 8 and 10), Ice intro line re-recorded (`assets/voice/intro3_2.mp3`, `src/services/voiceClips.ts`) |
| 3D pieces | `src/world/Modifiers.tsx` (`FloePiece`, `FloeTrack`; vines, braziers, glacier ice removed), `src/world/Entities.tsx` (cursed gem and thaw removed; turn highlight; vine pulse), `src/world/World.tsx`, `src/world/Beam.tsx` |
| HUD | `src/screens/Gameplay.tsx` (cursed banner removed, tip order, floe accessibility buttons), `App.tsx` (status chips, sounds) |
| Audio | new `glide` sound; `curse`, `thaw` and `burn` retired (`scripts/generate-audio.mjs`, `src/services/audio.ts`) |
| Tools | `MM_ONLY` for `generate-audio.mjs` and `generate-voice.ts`, so a single asset can be regenerated without wiping the folder |
| Tests and reports | `src/game/engine.test.ts`, `scripts/level-report.ts`, `docs/LEVEL_REPORT.md`, `README.md` |

### Chapter by chapter

| Chapter | 1-3 teach | 4-6 decide | 7-9 combine | 10-12 plan | 13-15 trade-offs | 16-18 finale | Avg par |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sky Temples | mirror, turning lens | stones, fixed mirrors | multi-crystal | 3-4 step aims | twin lenses | triple lenses | 3.28 |
| Rainforest | a vine pair (2-for-1), then a chain whose hub alone is wrong | chains with fixed mirrors | three vines | chains plus a turning totem | vines joining two totems' beams | triple totems | 4.00 |
| Desert | one seal | prisms serving seal + crystal | two ordered seals | 5-tap seal orders | twin suns, turning Eye | triple suns, three seals | 4.39 |
| Ice Age | one floe, then two | first stopper floe | stoppers plus vines | stopper must leave the road again | twin lanterns, four floes | triple lanterns | 4.22 |
| The Void | Devourer only | wormholes | floe / vine / prism with the Devourer | seals and vine chains in the Void | twin engines, two wormholes | triple engines | 4.50 |

From Rainforest level 4 and Ice Age level 3 on (Desert and Void level 3, Sky level 13), every board defeats a simulated
player who only taps lit pieces, and every boss also defeats one who tries every tap.

### Validation (all numbers from runs of the real engine)

| Check | Result |
| --- | --- |
| `npm test` | **229 / 229 pass** (engine, levels, map, save, shaders, ads) |
| `npx tsx scripts/level-report.ts` | **90 / 90 levels pass**: valid board, stored solution legal and winning on its last tap, par = BFS optimum, 3/2/1/0-shard outcomes each reached by real tap sequences |
| Determinism | no randomness in the rules (source scan); every solution replays identically; full generator run reproduces `levels.json` byte for byte |
| Sky Temples untouched | levels 1-18 identical to before (18 / 18) |
| Vines matter | on all 27 vine levels the vine-free optimum does not win in par (optimum longer in 15, shorter in 11, same length but a different plan in 1), and every solution taps a vine-bound mirror |
| Drift ice matters | all 22 floe levels need a glide; all 14 stopper levels end with a floe parked mid-track, which only a stopper can cause |
| Approved mechanics | cannon, seal, Devourer, wormhole and loop tests unchanged and passing; every seal woken in every seal level; every wormhole on its level's solved light; no solved light loops; wormholes one-way with no beam duplication |
| Restart / undo | moves never mutate the state they start from (frozen-object test on all 90 solutions); restart rebuilds an identical opening; checked on the emulator too |
| Stars | par < twoStar = par + 2 < maxMoves on every level, and the 3/2/1/0 outcomes are proven per level |
| Hints | from 1,080 random mid-game states (12 per level) every board is still winnable and the solver finds a path; slowest 281 ms on a desktop (sliced on phones, so no freeze) |
| Tutorials | every mechanic has a tip of at most 70 characters (longer ones were cut off on Android, now a test); no chapter text mentions removed mechanics |

### On-device check (Pixel_9 emulator, release APKs)

- Test build:
  - Opens on the "TEST BUILD · ALL OPEN" badge.
  - The Ice Age intro plays the new narrated line.
  - The new "New in this world" list shows.
  - Ice level 1 is won by one glide (3 shards).
  - Ice level 4's stopper solution works (3 shards).
  - Rainforest level 3: holding the hub shows "THIS TAP TURNS 3 MIRRORS" with gold rings, and releasing costs no move. One tap turns three mirrors, undo restores it, and the three-tap solution wins.
  - Restart restores the opening.
- Normal build: level 2 stays locked on the map after a fresh install.

### Limitations and notes

- **Closing gates.** The seal rules allow a seal to shut an open gate, and level 46's beat promised it, but no level in
  the old or new campaign ever contained one: the generator's step never found a spot. Searching properly, a closing
  gate lengthens the optimum in about 1% of attempts or fewer, so the promise was removed from the text instead. The
  engine still supports closing gates.
- **Saves.** Saved results stay on their level ids (save v3, no migration). Rainforest, Desert, Ice Age and Void
  boards changed, so an old best move count can be lower than a new par.
- **Visual checks.** Hold-to-preview was checked on the emulator only; the web harness can only tap.
- **Hint timing.** The slowest hint search (281 ms on a desktop) will take noticeably longer on a slow phone,
  though the game keeps animating while it runs.
