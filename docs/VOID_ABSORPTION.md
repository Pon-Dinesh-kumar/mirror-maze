# The Devourer's absorption (Void black hole defeat)

When the light enters a black hole's zone, the level is lost, exactly as before. The loss is no longer a message that
appears at once. The black hole wakes, grows, bends and drinks every beam on the board, the world goes dark around it,
it collapses, and only then does the defeat screen fade in. The rules are untouched: the cinematic only shows a loss the
rules have already decided.

## 1. The rule, unchanged

* `traceBeam` (`src/game/engine.ts`) still swallows a beam the moment it enters a devourer's zone cell, sets `absorbed`,
  and records a `devourer` hit. Every other light passes as before.
* The solver, the hint search, the move limit, the "this move feeds the Devourer" preview, and the rewind on the defeat
  screen work as before.
* The cinematic reads the trace the rules produced for the losing move. The record (`absorptionOf` in
  `src/world/abyss.ts`) holds:
  * the swallowing devourer;
  * the beam branch that entered, the cannon it came from, and its path of branches;
  * the point and path distance where it crossed the edge;
  * where every beam on the board ends.

  The puzzle is never re-traced during the animation.

## 2. Who does what

| Responsibility | Where |
| --- | --- |
| Detect the loss | The rules: `state.absorbed` and the `devourer` hit in the trace |
| Freeze play and guard the failure | `App.tsx`. The losing move locks all input and takes one token. The board's completion report, or a fallback timer, ends it once. The defeat screen appears only after that (waiting for the pause menu to close) |
| The timeline | `src/world/abyss.ts`: phase constants, `abyssPose(seconds)` (pure, allocation-free), `absorptionOf(trace)` |
| Run it once per failure | `BoardView` in `src/world/World.tsx`. One run per lost board starts when the light actually reaches the hole and ends only when the board is no longer lost (rewind) or remounts (retry). Repeated renders of the same lost board never restart it. It drives the beam uniforms, the darkness, the lights, the tremble, the sounds and the completion report |
| The black hole | `DevourerPiece` in `src/world/Modifiers.tsx` |
| Board-wide effects | `AbyssEffects` in `src/world/AbyssEffects.tsx`: darkness veil, impact flash, energy strands and motes |
| Light bending and draining | `beamMaterial` in `src/world/fx.ts`: shared uniforms; `Beam.tsx`: hit sparks and riding motes follow them |
| Sound | `scripts/generate-audio.mjs` (`abyss`, `swallow`), `src/services/audio.ts` (`stop`, `setHush`) |
| Defeat screen | `Fail` in `src/screens/Complete.tsx`. For this loss it fades in and plays no generic fail sound |

## 3. The sequence

All timings are constants at the top of `src/world/abyss.ts`. The clock starts when the light reaches the hole, not at
the tap (after a totem's turn, when its stones have landed and the new light arrives).

| Phase | Time | What happens | Sound (`abyss`) |
| --- | --- | --- | --- |
| 1 Impact | 0-0.45 s | The beam ends at the horizon, and its last stretch bends inward. A violet-white flash marks where it crossed. The rim flares, the board's lights flicker, and the orbiting motes speed up. | A sharp energy strike, a sub-bass pulse with its octave, a short reversed swell |
| 2 Growth | 0.45-1.45 s | The hole grows to about twice its size, and its accretion disc turns faster. A small camera impulse. Light near it starts to curve toward it, loose motes drift in from around it, and darkness gathers locally. | A rising low rumble, a swelling drone, fine crystalline particles |
| 3 Pull | 1.45-2.65 s | The light is drained from the cannons' end and runs into the hole behind a white-hot front, while the bend spreads over the whole board. The pieces it lit go dark as it passes: crystals empty, mirrors and prisms lose their glow. Energy strands torn from the actual light paths stream into the horizon. | Three suction sweeps over a descending tone, plus a `swallow` pulse each time a beam's last light disappears (spaced at least 0.18 s apart) |
| 4 Darkness | 2.65-3.55 s | Darkness spreads from the hole over the whole screen, in stages, and the scene's lights fade with it. The music and ambience fade to 15 %. | A hollow, vacuum-like resonance; nothing high is left |
| 5 Collapse | 3.55-4.10 s | The hole contracts, its rim burns brighter, one last violet pulse runs across the board, and a short camera shake follows. | A short heavy low impact and a compressed metallic, crystalline ring |
| Silence | 4.10-4.55 s | The scene settles: near black, the hole the only light. The camera is still. | Near silence |
| Defeat | from 4.55 s | "Swallowed by the dark" fades in over the dark scene (0.7 s), with Rewind, Retry and Map. The music and ambience fade back over 1.6 s. | none |

### Looks

* **The hole at rest:**
  * a core that stays truly black (a dark disc drawn over it, so it reads black from any angle);
  * a thin violet-magenta event horizon with a white-hot inner edge and a faint lensed echo ring, plus a gravitational
    ripple that runs outward every six to eight seconds;
  * the existing accretion disc, a little larger, and nine motes in orbit;
  * a soft gravity well that darkens nearby tiles.
  * The red-edged zone still shows exactly where light is lost.
* **The Void board:** faint violet energy cracks across a few tiles and a restrained violet-cyan rim light along a few
  stretches of the edge. Both are seeded and dim, so mirrors, wormholes and crystals stay the brightest things.
* **The darkness:** one screen-space veil whose darkness gathers around the hole's projected position and spreads
  outward. The hole's glowing parts draw after it, so they stay the last light left.

## 4. Lifecycle

* **Input.** Locked from the losing move until the defeat screen. The rest of the losing move's outcome waits too.
* **Once per failure.** One guarded run on the board and one token in the app. Sounds are fired once by the run (the
  `swallow` pulses are spaced), and the completion is reported once.
* **Pause.** The sequence plays on under the pause menu. When it ends, the defeat screen waits until the menu is closed
  with Resume. Restart and Home from the menu cancel it.
* **Background.** The long `abyss` sound is stopped when the app is sent away. The scene finishes on its own when the
  app returns, and the defeat screen waits for Resume as above. A fallback timer completes the loss if the board cannot
  report it.
* **Restart.** The board remounts, which resets every effect: hole size, light, darkness, camera, lights. The app stops
  `abyss` and `swallow` and restores the music and ambience.
* **Rewind** (on the defeat screen). The previous board comes back and is no longer lost, so the run ends and the beams,
  darkness, lights and hole return to normal.
* **Leaving.** Going home or to the map stops the sounds and restores the music and ambience.

## 5. Validation

Every result below comes from a real run.

| Check | Result |
| --- | --- |
| `npm test` | **236 / 236 pass**, including three new absorption tests in `src/game/abyss.test.ts` |
| Phase lengths | Each phase is within the brief's range, 4.55 s in all (tested) |
| Pose | Nothing happens at rest; darkness, drain and silence only ever grow; nearly black but not black at the end; the camera is still before the defeat screen (tested) |
| Trigger | On every Void level, a record exists exactly when the rules say a single opening tap feeds the Devourer, and never for the opening board or the stored solution. The recorded point lies in the zone, the path runs from a cannon, and the same failure always gives the same record (tested) |
| Rules unchanged | `traceBeam`, the solver and every level are untouched; the 90 level validity tests and outcome proofs pass unchanged |
| Web build | All new shaders compile (no console errors), and the sequence runs through to the faded-in defeat screen (headless Chrome) |
| Sounds | `abyss`'s measured loudness follows the timeline (strike at 0, growth from about 0.8 s, pull, the darkness bed, the collapse peak at about 3.6 s, silence by about 4.1 s), with a peak of 0.81 and no clipping. Every existing sound file stays byte-identical |

On the Pixel 9 emulator (release APK, all levels open), on the final boss (level 90):

* **The losing tap.**
  * The HUD flags the loss and the beams bend toward the hole.
  * The light drains from the cannons' end into it, and energy strands stream in.
  * The darkness spreads in stages until only the hole is lit, and it contracts at the collapse.
  * "Swallowed by the dark" then fades in over the dark scene.
* **Rewind.** Restores the board, moves, light and the hole's resting size.
* **Restart during the sequence.** Rebuilds a clean opening board.
* **Pause during the sequence.** The sequence finishes behind the menu, and the defeat screen appears only after Resume.
* **Errors.** No JS errors in any of these runs.

### Bugs found and fixed on the device

* **The board crashed on Android.** On load, React Three Fiber threw `Cannot assign to read-only property 'position'`.
  The hole's anchor was given a `Vector3` as its position. The Android bundle carries two copies of three.js (the log
  warns about it, and the warning predates this work), so R3F could not copy that foreign `Vector3` and tried to
  assign it. The fix passes a plain array, as the rest of the scene does. The web build has one copy of three.js and
  never showed the bug.
* **Colour.** The hole's ring burned yellow-white, because the shared accretion-disc shader's inner colour is orange.
  The disc now takes a palette: the Devourer's is magenta into violet-indigo, and the sky's Void Eye keeps its orange.
  Its resting glow was also toned down.

### Performance

Readings from the diagnostic readout on the same emulator and the same level (the final boss, one of the heaviest
boards). Each reading is one capture taken well apart from the others, so captures never disturb the window measured.
The baseline is the build from before this work, with the old one-shot flare.

| Build | At rest | 1.6 s after the losing tap |
| --- | --- | --- |
| Before | 30 FPS, 30-31 ms JS, 303 draw calls | 19 FPS, 46 ms JS, longest gap 196 ms |
| After | 30-33 FPS, 27-30 ms JS, 316 draw calls | 23-25 FPS, 37-39 ms JS, longest gap 84-137 ms |

* At rest the new hole and board details add 13 draw calls at the same frame rate.
* The cinematic costs no more than the old failure moment did.
* This board's 30 FPS on this emulator predates this work.
* This RTX-backed emulator does not reproduce every phone (memory notes: 120 Hz scheduling, Mali GPUs). Nobody has
  measured on a phone yet.

## 6. Limitations

* **Lensing.** Gravitational lensing is approximated: a lensed echo ring and an outward ripple on the horizon, plus the
  light bending in the beam shader. A true screen-space distortion would need an extra render pass, which was left out
  for mobile.
* **Background.** Stars, nebula, planets and the background particle field darken under the veil but are not pulled
  in. Only the board's own motes and energy strands are.
* **Audio review.** The sounds were checked by their measured envelopes and play without errors on the emulator.
  Nobody has listened to them on a phone speaker yet.
* **Reduced effects.** The game has no reduced-effects setting, so there was nothing to respect. The sequence uses the
  existing sound, music and haptics switches.
* **Duplicate three.js.** The Android bundle still carries two copies of three.js. This predates this work and is
  harmless as long as scene props use plain arrays, which they now all do.

## 7. Performance design

* **No React state changes during the sequence.** Every effect is driven per frame from the timeline.
* **Shared uniforms.** The light's bend and drain are four uniforms shared by every beam ribbon, so one value changes
  all of them. The ribbons were given 24 rows (from 8) so the bend stays smooth.
* **Darkness.** One full-screen quad, drawn only while the hole is feeding.
* **Draw calls.** The strands and motes are 48 points in one draw call. The flash is one sprite, the horizon one quad,
  and the cracks and rim lights one instanced mesh each.
* **Disposal.** Materials made per board are disposed on unmount. Shader programs are kept once per session, as the
  rest of the game does.
