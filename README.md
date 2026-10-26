# Mirror Maze — The Last Lightkeeper

A story-driven, portrait-first 3D light puzzle game for Android (and web/iOS), built with Expo SDK 54,
React Native, TypeScript and Three.js (React Three Fiber).

The Great Prism that carried light between five worlds has shattered, and the Void has opened its eye.
As the last Lightkeeper, you bend light through five worlds and gather every crystal shard to forge
five Hearts. Together, the Hearts seal the Void.

## The game

- **5 chapters × 18 levels = 90 solver-verified puzzles**, each with its own title and story line, and one deterministic
  modifier per world (below).
- **One scrolling journey map** through living 3D worlds: every level is a miniature floating island of its
  chapter (sky temples above the clouds, overgrown jungle ruins, pyramids and oases, ice spires, Void tech
  decks) with waterfalls, a level crystal on its dais and a jewelled medallion. Islands are joined by the
  chapter's own gameplay laser, lit up to the furthest level reached; the unexplored rest of the world lies
  under night mist. A fresh unlock plays out when the map reopens: the cleared crystals pop alight and the
  light races on to the next island. Moving between chapters swaps the 3D world behind a chapter gate.
- **Cutscenes with narration** for the prologue, every chapter intro, every chapter finale, each Heart
  forging and the ending. Each line is narrated by a female voice, and the captions appear in time with
  her. Every cutscene can be replayed from its chapter gate on the map.
- **Rewards**: up to 3 crystal shards per level. Clearing a chapter's final level opens the next world.
  Earning all 54 shards in a world forges that world's Heart into the Lightkeeper's Amulet. Forging all
  five Hearts plays the ending.
- **Google Play**: an AdMob interstitial after every third completed level (on Continue, never during play or a
  cutscene), a one-time **Remove Ads** purchase, and Google Play Games achievements, a Crystal Shards leaderboard
  and a cloud save that carries the journey to a new phone. Until the AdMob and Play Console IDs are filled in, ads
  are Google's test ads and Play Games stays hidden. Setup steps: [docs/GOOGLE_PLAY.md](docs/GOOGLE_PLAY.md).

### Mechanics and how difficulty grows

Every level has a **move limit**. One scoring rule applies everywhere, from the solver's optimal move count (par):
3 shards at par or fewer moves, 2 at par + 2, 1 for any win within the limit, and 0 for running out of moves or
feeding the Light Devourer. A win never needs a perfect score.

Every rule is deterministic: there is no randomness in play, and the same taps always give the same board and light.
Each world has one modifier, plus the supporting pieces it builds on:

| World | Light source | Modifier | Also |
| --- | --- | --- | --- |
| 1 Sky Temples | Sun Lens | **Hand-turned cannons**: tap a lens to turn it a quarter turn clockwise; glowing chevrons show its aim and where the next tap points it | Mirrors, stones, fixed gold mirrors, spare mirrors, twin and triple suns |
| 2 Rainforest | Spirit Idol | **Rootbound totems**: a tap on a carved totem turns its cluster of jade stones a quarter turn around a pivot, carrying every mirror, stone, crystal and idol on it (mirrors swap their slant, idols turn their aim). A turn is refused while anything stands in the stones' path. One turntable first, then stones on the light's road, riding idols, two clusters, and clusters in each other's way. Hold a totem to see its cluster, pivot, turn arrow and where the stones will land | Fixed mirrors, turning idols, twin and triple idols |
| 3 Desert | Eye of Ra | **Solar seals**: light activates a seal for good, numbered seals only in order, and each seal opens or closes its gates | Prisms, twin and triple suns |
| 4 Ice Age | Frost Lantern | **Drift ice**: frozen mirrors never turn; a tap glides one along its ice track until the track ends or another floe stands in the way (a chevron shows which way it goes next). Park one floe to stop another mid-track, then slide it out of the light's road | Turnable mirrors, twin and triple lanterns |
| 5 The Void | Star Engine | **The Light Devourer**: any light entering its red-edged zone is swallowed and the level is lost (with a one-move rewind). Hold any piece to preview its light first | Wormholes, then every earlier world's trick (turning cannons, rootbound totems, seals, drift ice, prisms), up to three cannons |

Each world's 18 levels follow the same curve: 1-3 teach the modifier, 4-6 add simple decisions, 7-9 combinations,
10-12 multi-step plans, 13-15 trade-offs with twin cannons, and 16-18 finales with twin and triple cannons. Difficulty
comes from the kind of reasoning a board needs (a cluster that must clear another's path, a stopper that must leave
again), not from extra clutter. The audit behind the current modifiers is in [docs/MECHANICS_REDESIGN.md](docs/MECHANICS_REDESIGN.md);
the rootbound totems, which replaced the Rainforest's vine networks, are specified in [docs/ROOTBOUND_TOTEMS.md](docs/ROOTBOUND_TOTEMS.md).

The level generator (`scripts/generate-levels.ts`) verifies every level with a breadth-first solver, so par is always the
true optimum, and only keeps a level whose modifier genuinely shapes the solution (the seals must be woken, every totem
must be turned and, frozen, cost at least two more taps or the win, a floe must glide and, where taught, stop against
another, a tempting move must feed the Devourer). It also proves that
3, 2, 1 and 0 shards are each reachable. Past each world's teaching levels, boards must defeat a simulated "follow the
beam" player, and bosses also beat a greedy player who tries every tap. `npx tsx scripts/level-report.ts` re-verifies all
90 levels and writes [docs/LEVEL_REPORT.md](docs/LEVEL_REPORT.md): each level's solution, solution length, star thresholds
and pass/fail.

Saves from the earlier 135-level campaign carry over: each new level stands for one or two old ones in order, counts as
cleared when all of them were, and keeps the fewest shards among them, so cleared and perfected worlds (and their Hearts)
stay exactly that.

### Feel

- A cinematic play camera: a sweeping reveal when the level opens, a gentle drift, a small push on every
  tap and a slow push-in on victory. A **tilt / top-down** toggle helps on the larger boards.
- An animated beam styled for each world (sunbeam, rain spirit, solar fire, aurora frost, void plasma).
  It ends a little past the board edge. When you win, the light charges into each crystal, then bursts.
- Synthesised audio for every effect, plus music and ambience per world (`scripts/generate-audio.mjs`).

## Run

This Windows workspace keeps a portable Node.js in `.tools` (git-ignored). On a fresh machine, install
Node.js 22.14+, then:

```powershell
npm ci
npm run web          # browser preview
npx expo start --lan # Expo Go (SDK 54) on a phone
```

## Build the Android APK

Requires JDK 17 and the Android SDK (platform 36, build-tools 36, NDK 27.1).

```powershell
npx expo prebuild --platform android --clean
cd android
.\gradlew.bat assembleRelease
# -> android/app/build/outputs/apk/release/app-release.apk
```

Without an upload key, the release build is signed with the Expo template's debug keystore. It installs directly on any
device (sideload). For Google Play, build a signed `.aab` with your upload key and run the preflight: see
[docs/RELEASE.md](docs/RELEASE.md).

## Regenerating content

```powershell
npx tsx scripts/generate-levels.ts   # 90 levels -> src/game/levels.json (seeded: rebuilds the same campaign)
npx tsx scripts/level-report.ts      # re-verifies every level -> docs/LEVEL_REPORT.md
node scripts/generate-audio.mjs      # sound effects, music, ambience -> assets/audio
npx tsx scripts/generate-voice.ts    # narration -> assets/voice + src/services/voiceClips.ts
node scripts/generate-icons.cjs      # app icon and splash -> assets/images (needs `npm i --no-save sharp`)
```

Narration is recorded offline with [Piper](https://github.com/rhasspy/piper) using the
`en_GB-jenny_dioco-medium` voice. Each sentence is recorded several times and the take with the most natural
pitch movement and timing is kept; sentences are joined with pauses chosen for the line's mood, given a soft
room, and every clip is levelled to the same loudness (-15 LUFS). The real clip length and each sentence's start
are written into `voiceClips.ts`, so captions appear sentence by sentence as the narrator speaks. A full run
re-records every line (Piper varies between runs); `MM_ONLY=intro3_2,...` re-records just those lines.
Download `piper_windows_amd64.zip` and the voice `.onnx`/`.onnx.json` files into `.tools/piper` to
regenerate.

## Architecture

| Area | Responsibility |
| --- | --- |
| `App.tsx` | Screen flow, moves/undo, win timeline, rewards, story beats, cutscene replays |
| `src/game/engine.ts` | Pure, deterministic rules: tracing (multi-cannon, prisms, portals, gates, floes, pieces moved by rootbound clusters, Devourer zones), moves (cluster turns and their legality, floe glides) and the settle step (seals in order), BFS solver, greedy-player and outcome analysis |
| `src/game/levels.json` + `chapters.ts` | Generated levels, story text, titles, tutorial tips |
| `src/world/` | Three.js world: per-chapter environments, board, pieces (modifiers in `Modifiers.tsx`, rootbound totems and their turn in `Totems.tsx`), beam shaders and the hold-to-preview route, camera director, Amulet |
| `src/world/map/` + `src/game/mapLayout.ts` | Journey map: procedural chapter islands (instanced, built in background slices), laser path and crystals in a camera-locked layer, layout shared with the map screen |
| `src/screens/` | Splash, prologue, home, journey map, chapter intro, gameplay HUD, results, story cutscenes, popups |
| `src/ui/` | Buttons, panels, SVG title art, effects, diagnostic performance overlay |
| `src/services/` | Saves (validated, versioned, cloud merge), audio, narration, haptics, ads (AdMob), Remove Ads, Play Games |
| `modules/google-play/` | Local Expo module (Kotlin): Google Play Games Services v2 and Google Play Billing |

## Tests

```powershell
npm run typecheck
npm test
```

There are 268 tests. Every level is checked to be valid, unsolved at the start, with a stored solution that wins on its
last tap and an optimal par. Every level is also proven to support all four outcomes within its move limit, by playing
real tap sequences under the actual rules: 3, 2 and 1 shards, plus a 0-shard loss. Other tests cover each chapter
modifier (cluster turns, their legality and ordering, and whole-cell landing in every reachable state; floe glides and
stoppers; seal order and gate toggles; the Devourer),
determinism and immutable moves (undo and retry), the anti-greedy guarantees, rewards and Heart rules, version 2 save
migration, the ad cadence, Play Games achievements and the cloud save merge, and the journey map's layout (every island on screen and in order on small to tablet screens) and island
geometry.
