# Touch selection on the 3D board

A tap meant for one mirror sometimes turned the mirror next to it. This was worst on the tilted play camera, where
mirrors stand close together and overlap on screen. This document covers the cause, the new selection system, its
rules and settings, and how it was tested.

## 1. The cause

Each tappable piece (mirror, ice floe, cannon, totem) carried its own invisible tap box, a full board cell wide and 1.4
to 1.7 cells tall. React Three Fiber (R3F) gave each touch to the nearest box along the touch ray.

* **The boxes were much bigger than the pieces.** On the tilted camera, the box of the piece in front covers part of the
  piece standing behind it, often the upper part of that piece's mirror panel, which is exactly where a thumb aims. The
  box in front is nearer the camera, so it won. A player who could see mirror B under their thumb got mirror A turned.
* **Measured on every level:** of thumb-sized touches (the middle of a piece, then 5, 10 and 16 dp off it in eight
  directions) that landed on a piece's visible body, the old boxes gave **7.8 %** to a different piece on a Pixel 9 and
  7.5 % on a compact 360 x 640 phone. Every chapter was affected. The near top-down view, where the boxes barely
  overlap, was at 0.2 %.

R3F's touch handling on Android added three more ways to turn a piece by accident:

* **Drags.** A touch counted as a tap after moving up to 20 dp.
* **Second fingers.** Lifting any finger could count as a tap, so two-finger gestures could turn pieces.
* **Cancelled touches.** When the system takes a touch away (a system gesture, the app being interrupted), React
  Native reports the touch ending (`pointerup`, then `click`) before the cancel. R3F treated that as a tap.

## 2. The new system

The per-piece tap boxes are gone. One touch handler serves the whole board.

| Part | Where |
| --- | --- |
| Selection rules, tap/drag/hold/cancel rules, stand-in shapes | `src/world/pick.ts` (pure, no React; the tests run the same code) |
| The board's touch handler, piece registration, selection glow | `src/world/Picker.tsx` (`PickBoard`, `usePickTarget`, `proxyMesh`) |
| Pieces register their tap and their stand-ins | `MirrorPiece` (`Entities.tsx`), `FloePiece` (`Modifiers.tsx`), `LightSource` (`Sources.tsx`), `TotemPiece` (`Totems.tsx`) |
| The play camera's framing, shared with the tests | `src/world/framing.ts` (moved out of `World.tsx`, unchanged) |

### How a touch is read

* The board listens to the canvas's own pointer stream (the target React Three Fiber connects its events to). On
  Android these are the touches React Native's responder reports. On the web they are DOM pointer events.
* **Coordinates.** Touch positions arrive in dp relative to the canvas (`offsetX` / `offsetY`), the same units and
  origin as the canvas size. The safe areas and the HUD offset are already inside the camera's projection, through the
  view offset that frames the board between the HUD bars. Device pixel ratio plays no part.
* **Camera.** Selection uses the camera and piece poses as last drawn, so the camera's idle drift, a mirror half way
  through its turn, a floe gliding, or a cluster swinging round are all read as the player sees them.

### Which piece a touch selects

The selection is made once, when the finger comes down.

1. **Direct hit.** A touch on a piece's visible body selects that piece. Each tappable piece has invisible stand-ins
   that trace its solid body as drawn: a mirror's base and framed panel (the panel turns with the mirror), a floe's raft
   and ice block, a cannon's foot and body, a totem's plinth, carved faces and crown. Glows, rings, arrows and the
   decorations around a piece are left out. Where two bodies overlap on screen, the one nearer the camera wins,
   because it is the one seen there.
2. **Closest outline.** A touch that lands on no body selects the piece whose outline on screen is closest, if it is
   within `PICK_TOLERANCE_DP` (22 dp). Outlines are the stand-ins projected to the screen. The gap between two pieces
   is therefore split down the middle, and a thumb landing just off a small piece still gets it. No piece's 3D shape
   was enlarged.
3. **Ties.** Outlines within `TIE_DP` (1.5 dp) of the closest are tied. The tie goes to the piece whose centre is
   closest to the touch, then to the one nearer the camera, then to the lower id. The same touch on the same board
   always selects the same piece, whatever order the pieces are listed in.

Only tappable pieces take part. Crystals, blocks, gates, seals, portals and the Devourer never take a touch and never
hide a piece from it. Only the picker's own stand-ins are tested, never the whole scene.

### Which touches count

| Rule | Setting |
| --- | --- |
| A tap must stay within `TAP_SLOP_DP` of where it came down. A touch that moves further is a drag and does nothing, even if it comes back. | 12 dp (R3F's old limit: 20) |
| A touch held for `HOLD_MS` shows where the piece's light would go. Releasing hides it again and turns nothing (as before). Pieces that cannot move have no preview. | 380 ms |
| A second finger cancels the touch. Nothing happens until every finger has lifted. | |
| A press shorter than `HOLD_MS` by the events' own timestamps is a tap. This holds even if a long frame delayed the lift past the hold timer: the preview that timer showed is put away and the piece turns. | |
| A cancelled touch does nothing, including a cancel React Native reports as a lift. The tap is made only after the whole event dispatch, and only if no cancel came with it: a microtask, so no delay a player can feel. | |
| On the web, the browser's `lostpointercapture` follows every touch's lift (the release of its implicit capture), in the same dispatch. There it means a cancel only while the finger is still down. On Android, React Native reports a taken-away touch this way; those events carry the `touches` list, which DOM events never have. | |
| A finger that slides off the canvas while down does nothing. | |
| A touch that came down on no piece does nothing, even if it lifts over one. | |
| One touch makes at most one tap, on the piece it came down on. | |

The tap then does exactly what the piece's old tap did:

* a mirror, floe or cannon turns or glides;
* a fixed mirror, a boxed-in floe or an illegal totem shows its refusal;
* a totem starts its turn.

Move counting, undo, restart, the 160 ms spacing between moves and the input lock during a totem's turn or the
Devourer's absorption are all unchanged in `App.tsx`.

### Feedback

While a finger rests on a piece, a soft ring in the chapter's accent colour lights under that piece's foot (the piece
actually selected, not where the touch landed). A tap makes the ring swell and fade in about 0.3 s. A drag or a cancel
fades it in 0.16 s. It is one small ring and disc, drawn only while shown.

### Cost

* **Between touches, nothing runs.** The ring's frame callback returns at once while the ring is hidden.
* **On a touch.** Picking happens once, on the first contact: one ray against 2 or 3 small stand-ins per tappable
  piece, then, only if nothing was hit, 8 to 24 projected points per stand-in. Scratch buffers are reused, so nothing
  large is allocated.
* **Fewer raycasts than before.** R3F's own event system has no tappable objects left during play, so its raycast on
  every finger movement is now empty. Before, it tested every tap box on every `pointermove`.
* **No new dependency.**

## 3. Tests

`src/game/pick.test.ts` builds every level's board headlessly, using the same stand-in shapes in the same frames as the
game. It views each board through the exact play camera on five screens:

* compact 360 x 640 dp;
* Pixel 9 (411 x 923 dp);
* a 20:9 phone (393 x 873 dp);
* a tablet (800 x 1280 dp);
* the Pixel 9 in top-down view.

Each screen includes its safe areas plus the HUD's 124 dp top and 78 dp bottom bars. The old tap boxes are rebuilt
beside the new stand-ins for comparison.

| # | Brief | Test |
| --- | --- | --- |
| 1 | Centre of a mirror | Every piece on every level and screen is selected by a touch on its visible middle (3,385 checks) |
| 2 | Near a mirror's edge | 16 directions per mirror: 1 dp inside its visible edge selects it; 6 dp outside, it is selected unless another outline is as close |
| 3 | Between two adjacent mirrors | 186 adjacent pairs walked middle to middle (and 4 dp to each side). The piece seen wins, else the closest outline; repeated attempts never alternate; the answer is the same in any piece order |
| 4 | Two mirrors in quick succession | Two taps 150 ms apart turn each once, in order |
| 5 | Mirror beside a cannon | Each keeps its own taps on every screen |
| 6 | Mirror partly hidden by a decoration | Points where a crystal or block is in front of a mirror still select the mirror |
| 7 | Dragging across a mirror | A drag over a mirror, out-and-back past the slop, and a flick with no reported move do nothing; an 8 dp thumb roll is still a tap |
| 8 | Multi-touch | A second finger (either lift order, held past the hold time, or on the web) turns nothing and shows no preview; a plain tap works afterwards |
| 9 | During a turn | The touch follows a mirror's panel mid-turn and overshooting |
| 10 | Board edges | Edge pieces are selected at their middle, and just past their edge unless another outline is as close; nothing is selected beyond reach |
| 11 | Different screens | The busiest board of each chapter: every piece selected at its middle on all five screens |
| 12 | One tap, one move | A real level: down, jitter, lift with its `click` and `pointerleave`, plus a stray duplicate lift, gives one turn and one move |

There are also these tests:

* **The policy over whole boards.** Every point on a 16 dp grid over every level on the phone, plus a 9 dp grid over
  each chapter's busiest board on all screens. Each point checks the piece seen, else the closest outline within the
  tie band, else nothing; the same answer in any piece order.
* **Cancels.** A React Native cancel (lift reported first), a web `pointercancel`, a web capture lost while the finger
  is down, sliding off the canvas, and an interrupted hold preview. Also Chrome's own order for a normal lift
  (`pointerup` and `lostpointercapture` in one dispatch), which must stay a tap.
* **Holds.** The preview, and no preview for pieces that cannot move. A quick tap whose lift is handled late (after
  the hold timer) is still a tap on both platforms; a real 600 ms press is still a hold.
* **Starting on no piece.**
* **The camera's idle drift.**
* **The tests' own shortcut** (screen-area pruning) never changes a selection.

### Results

`npm test`: **256 / 256 pass** (20 new). `tsc --noEmit` is clean.

The census over every level:

| Screen | Touches on a piece's visible body | Old boxes gave to another piece | Now |
| --- | --- | --- | --- |
| Pixel 9, tilted | 11,422 | 892 (7.8 %) | 0 |
| Compact phone, tilted | 11,291 | 850 (7.5 %) | 0 |
| Pixel 9, top-down | 11,577 | 25 (0.2 %) | 0 |

**Pieces that cannot be told apart from the play camera: none.** Every piece on every level can be selected somewhere
on all three screens checked. Where a tall piece in front (usually a totem or a cannon's rings) covers part of the one
behind, that covered part belongs to the front piece. The piece behind is still selected by its visible part, or by a
touch beside it.

## 4. On the device

These checks ran on the Pixel 9 emulator (1080 x 2424, release APK, all levels open).

* **Coordinates.** The touch points were computed with the test code's camera for the device's real insets (status bar
  54 dp, navigation bar 24 dp). They matched the screen: each piece's predicted centre fell on its drawn centre.
* **Taps the old boxes got wrong.** On each level below, the touch is on one piece's visible body, which the old tap
  boxes gave to the piece in front of it.

| Level | Touch (px) | Seen under the finger | Old build (the previous APK) | New build |
| --- | --- | --- | --- | --- |
| 6, Sky Temples | 722, 1073 | Back mirror m2's glass | **Front mirror m1 turned** | m2 turned (Sunrays 9 → 8) |
| 20, Rainforest | 385, 1277 | Totem t1's carved faces | (not run) | The totem woke and its cluster turned (Spirit 7 → 6) |
| 21, Rainforest | 604, 1049 | Back mirror m1's glass | **Front mirror m2 turned** | m1 turned (Spirit 8 → 7) |
| 53, Desert | 499, 1384 | Mirror m2 | (not run) | m2 turned, m6 in front unchanged (Sunlight 9 → 8) |
| 63, Ice Age | 902, 1363 | Floe f1's ice | (not run) | The floe glided one cell, m2 in front unchanged (Warmth 9 → 8) |
| 73, The Void | 372, 1476 | Mirror m2 | (not run) | m2 turned, m3 in front unchanged (Starlight 6 → 5) |

* **Feedback.** While a finger is down on a mirror, the gold ring shows under that mirror's foot.
* **Drag.** A 114 dp drag across a mirror turned nothing.
* **Hold.** A 1.4 s hold turned nothing.
* **Two fingers.** Fingers were injected through the emulator console, since `adb input` has only one pointer. Second
  finger lifted first, first finger lifted first, and a pinch held 0.9 s: nothing turned and the ring did not stay lit.
  A one-finger tap the same way turned the mirror.
* **Interruption.** A finger down on a mirror, then HOME, then the lift, then back to the game. Android cancelled the
  touch: nothing turned and nothing stayed selected.
* **`adb shell input motionevent CANCEL`.** React Native drops this one ("ACTION_CANCEL … no corresponding
  ACTION_DOWN"), because the tool gives the cancel its own down time. The board then saw a touch that never ended, and
  the next touch cleared it. Android's own cancels keep the touch's down time; the HOME check above uses one.
* **Errors.** No JS errors in the log.
* **The final build.** The first device run (above) used the build before the two web fixes below. On the final
  test APK, level 6 was checked again: the HOME interruption, the two-finger gestures, the touch on the back mirror's
  glass (m2 turned, 9 → 8) and a plain tap on the front mirror (m1 turned, 8 → 7). All as expected, with no JS errors.

### Web (headless Chrome)

* **Real touch input.** Chrome's touch emulation reached the board as pointer events with the right coordinates.
* **The bug this exposed.** Chrome follows every touch lift with `lostpointercapture` in the same dispatch. The first
  version took that for a cancel, so web touch taps did nothing (mouse clicks worked). Fixed and tested, as above.
* **Quick taps.** Under the software GPU, Chrome stamped even a 70 ms synthetic touch as a 435–1,047 ms press, so the
  harness cannot make a quick touch tap. Quick taps were sent as real `PointerEvent`s on the canvas instead.
  * Level 6: the touch on the back mirror's glass turned m2 (9 → 8), a tap on the front mirror turned m1 (8 → 7), and
    a drag and a two-finger touch turned nothing (7).
  * No console errors.

## 5. Limitations

* **The stand-ins are simple shapes.** Boxes and 16-sided cylinders trace each body to within about a dp at play size.
  Thin parts (a frost lantern's spike, a crown's leaf tips) are slightly outside them. A touch there still selects the
  piece through the outline rule.
* **The tolerance is one number.** `PICK_TOLERANCE_DP` (22 dp) and `TAP_SLOP_DP` (12 dp) are constants in `pick.ts`,
  tuned for phones. They have not been tuned on a real hand on a real phone.
* **Camera.** The game has no camera gestures, so "drag" only ever means "not a tap".
