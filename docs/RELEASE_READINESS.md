# Mirror Maze 4.0.0: Google Play release readiness

Audit of the release candidate on 2026-10-26, branch `release-hardening` (from `a70dab2` on `main`). How to build and
sign a release is in [RELEASE.md](RELEASE.md); store setup in [GOOGLE_PLAY.md](GOOGLE_PLAY.md).

## A. Overall readiness

**BLOCKED — RELEASE ISSUES REMAIN.**

The release candidate (RC4, commit `71b09f2`) passed every technical check that can be run here: target API 36,
16 KB page alignment, 64-bit code, Billing 9, only the necessary permissions, not debuggable, no source maps. It also
passed the full regression on an Android 16 device with 16 KB pages. What blocks submission is four things only the
developer can supply:

1. **An upload key.** The bundle is debug-signed, and Play Console rejects debug-signed bundles. The signing hook is
   ready; see RELEASE.md §1.
2. **The game's own AdMob IDs.** `app.json` still has Google's *sample* app ID and there is no interstitial unit, so a
   release would show "Test Ad" interstitials and earn nothing.
3. **A privacy policy URL.** Play requires it in Play Console **and inside the app**. The in-app link is built in and
   appears once `PRIVACY_POLICY_URL` is set.
4. **Play Console declarations.** The app, the `remove_ads` product, Data safety (draft in B.2), content rating, target
   audience, and the ads and advertising-ID declarations.

Once 1–3 are filled in and `npm run release:check` passes, the bundle is ready for the **Internal testing** track, where
the live purchase test must still be run. A green local build is not proof that Google Play will approve the app.

## B. Google Play checklist

**PASS** verified here · **FAIL** must be fixed before submission · **BLOCKED** needs something only the developer can
supply or do in Play Console · **N/A** does not apply. Requirements were checked against the official pages on
2026-10-26.

### Packaging and technical

| Requirement | Status | Evidence |
| --- | --- | --- |
| Target API 36 for new apps and updates (since 2026-08-31; extension to 2026-11-01) — [target-sdk](https://developer.android.com/google/play/requirements/target-sdk) | PASS | `targetSdkVersion 36`, compileSdk 36 (aapt2) |
| Android App Bundle | PASS | `bundleRelease` artifact (section I) |
| 64-bit native code — [64-bit](https://developer.android.com/google/play/requirements/64-bit) | PASS | arm64-v8a, x86_64 (plus armeabi-v7a, x86) |
| 16 KB page size (64-bit, targetSdk ≥ 35; updates blocked from 2027-02-01) — [page sizes](https://developer.android.com/guide/practices/page-sizes) | PASS | all 64 `.so` files have 2^14-aligned LOAD segments (preflight, cross-checked with NDK `llvm-objdump`); bundle config `PAGE_ALIGNMENT_16K`; `zipalign -c -P 16` passes; runs natively (`pageSizeCompat=0`) on an Android 16 image with `PAGE_SIZE 16384` |
| Play Billing Library ≥ 8 (v7 cut-off 2026-08-31, extension 2026-11-01) — [deprecation FAQ](https://developer.android.com/google/play/billing/deprecation-faq) | PASS | `billing:9.1.0`, supported until 2028-08-31 |
| Upload-key signing, Play App Signing — [app signing](https://developer.android.com/studio/publish/app-signing) | **BLOCKED** | no upload keystore exists. The RC is debug-signed (`CN=Android Debug`); the `MM_UPLOAD_*` signing hook is in place |
| Application ID, versionCode, versionName | PASS (confirm) | `com.lightkeeper.mirrormaze`, versionCode 4, 4.0.0. The versionCode must exceed anything already uploaded |
| Not debuggable; no test switches or development paths | PASS | no `application-debuggable`; `UNLOCK_ALL=false`, `PERF_HUD=false`; `__DEV__` folded out of the Hermes bundle (the development-only save slot string `mirror-maze-dev` is absent) |
| Only necessary permissions — [permissions policy](https://support.google.com/googleplay/android-developer/answer/9888170) | PASS (was FAIL) | 11 permissions, all from the game, AdMob, Billing or AndroidX. Removed: `RECORD_AUDIO`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `READ/WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW` |
| Foreground-service type declaration (targetSdk ≥ 34) | N/A (was required) | no foreground-service permission or service left |
| Exported components (Android 12+) | PASS | launcher activity; Google's Play Games shortcut activity; WorkManager `SystemJobService` (`BIND_JOB_SERVICE`); two receivers guarded by `DUMP` |
| Cleartext traffic | PASS | no `usesCleartextTraffic` or network config in the release manifest, so the platform default (blocked) applies |
| Android 16 large screens (orientation ignored at sw ≥ 600 dp) — [behaviour changes](https://developer.android.com/about/versions/16/behavior-changes-16) | PASS (was defect) | `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY`: verified letterboxed on a 2560x1600 display. **Stops working at targetSdk 37** (see H) |
| Predictive back (targetSdk 36) | PASS | `enableOnBackInvokedCallback="false"`; system Back works on every screen (H.2) |
| Edge-to-edge (enforced at targetSdk 36) | PASS | all screens inset by the status/navigation bars, gesture and 3-button navigation (section C) |

### Privacy, ads, data

| Requirement | Status | Evidence |
| --- | --- | --- |
| Privacy policy in Play Console **and** in the app — [User Data](https://support.google.com/googleplay/android-developer/answer/10144311) | **BLOCKED** | no policy URL exists. The in-app link (Settings, under the version line) appears once `PRIVACY_POLICY_URL` is set |
| Data safety form — [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469) | **BLOCKED** | draft answers in B.2; the developer submits |
| "Contains ads" and advertising-ID declarations | **BLOCKED** | Play Console. `AD_ID` is declared: answer "yes, advertising" |
| Consent (EEA/UK/CH) through Google UMP | PASS (code) / BLOCKED (console) | `AdsConsent.gatherConsent()` before `initialize()`, and a privacy options entry in Settings where required. An AdMob consent message must be published |
| The game's own AdMob IDs | **BLOCKED** | sample app ID `ca-app-pub-3940256099942544~…` and no interstitial unit: only test ads |
| Ads don't cover controls or interrupt play | PASS | interstitials only after NEXT LEVEL / CONTINUE on every 3rd clear, no banners; verified: test interstitial shown, closed, next level loads |
| Target audience / Families | **BLOCKED** | the developer's choice. 13+ keeps the current ad setup; under-13 needs child-directed ad settings and no `AD_ID` |
| No secrets, keys or test credentials shipped | PASS | pattern scan of tracked files; only public IDs; no `.env`; keystores git-ignored |
| Logging | PASS | release logs only failure warnings (no purchase tokens or IDs); perf logging is `__DEV__`-only |

### Billing

| Requirement | Status | Evidence |
| --- | --- | --- |
| `remove_ads` exists and is active in Play Console | **BLOCKED** | the product is not created yet |
| Localised price from Play (`formattedPrice`), never hard-coded | PASS | `PlayBillingModule.describe`; `removeAds.test.ts` (price test) |
| Acknowledgement | PASS (code) | acknowledged on purchase and again on every launch query (Play refunds unacknowledged purchases after 3 days) |
| Cancelled, pending, failed and unavailable never grant | PASS | `removeAds.test.ts`: all six outcomes; on device, an unavailable Billing service reports "did not go through" without granting |
| Restore, reinstall, refund | PASS (logic) / BLOCKED (live) | tests cover launch confirmation, refund removal and restore; live verification needs Internal testing and a license tester |
| No double purchase | PASS (was defect) | fixed; regression test |
| No production purchase bypass | PASS | ownership comes only from Play (`purchased`, `owned`, `queryPurchases`) or its cached answer |

### B.2 Data safety: draft answers (developer to confirm)

The game has no server, account or analytics SDK. Progress and settings stay on the phone (and in Android's own Auto
Backup to the player's Google Drive, which is not collection by the developer).

| Play data type | Collected | Shared | Purpose | Source |
| --- | --- | --- | --- | --- |
| Approximate location (from IP address) | Yes | Yes | Advertising, analytics, fraud prevention | Google Mobile Ads SDK ([Google's list](https://developers.google.com/admob/android/privacy/play-data-disclosure)) |
| App interactions | Yes | Yes | Advertising, analytics, fraud prevention | Google Mobile Ads SDK |
| Crash logs / diagnostics | Yes | Yes | Advertising, analytics, fraud prevention | Google Mobile Ads SDK |
| Device or other IDs (advertising ID, app set ID) | Yes | Yes | Advertising, analytics, fraud prevention | Google Mobile Ads SDK |
| Purchase history | Yes | No | App functionality (Remove Ads) | Google Play Billing |
| Game progress, player ID | Only once Play Games is configured | No | App functionality (cloud save) | Play Games Services (off in this build: no project ID, the SDK never starts) |

Encrypted in transit: yes. Deletion: nothing is stored on a server. The advertising ID is reset or deleted in Android
settings, and Settings > RESET erases local progress (and the cloud save once Play Games is on).

### B.3 Store listing: items to supply

None of these are in the repository, and none were invented:
- App name, short and full description.
- 512x512 icon (the 1024x1024 `assets/images/icon.png` can be scaled).
- 1024x500 feature graphic.
- At least 2 phone screenshots. Play allows at most a 2:1 aspect; the Pixel 9's 1080x2424 captures exceed that, so
  capture at e.g. 1080x2160.
- Privacy policy URL, support email, and a developer website for `app-ads.txt`.
- Content rating questionnaire, target audience, and the ads and advertising-ID declarations.

## C. Test results

| Suite | Total | Passed | Failed | Skipped | Flaky | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Typecheck (`tsc --noEmit`) | — | clean | — | — | — | |
| Unit + integration (`npm test`, node:test) | 280 | 280 | 0 | 0 | none in 5 full runs | 268 before; +8 Remove Ads entitlement (`removeAds.test.ts`), +4 sound service (`audio.test.ts`). Native boundaries (Billing, expo-audio, AsyncStorage, React) are stand-ins; the hooks and services are real |
| Level configuration audit (`scripts/level-report.ts`) | 90 | 90 | 0 | 0 | — | every level: valid board, stored solution wins, par is the true optimum, 3/2/1/0-shard outcomes all played under the real rules, losable; hint search matches `solve()` on every level |
| Release preflight (`npm run release:check`) on the RC4 bundle | 20 checks (+4 INFO) | 15 | 4 | — | — | 1 WARN (Play Games not configured, optional). The 4 FAILs are the blocked items in A |
| On-device E2E (Android 16, 16 KB) | see below | | | | | adb-driven, every result checked by screenshot or system state |
| Code coverage | not measured | | | | | |

**On-device flows (RC1 → RC4), all PASS unless noted:**
- **Update and launch:** fresh install of the old build → prologue (skip) → chapter intro (skip, BEGIN) → level 1 solved
  → **update to the RC keeps progress** (shards, seen prologue).
- **Levels:** 1–18 cleared (level 19 played), with the taps projected from the game's own camera for each screen size. Hint, move, Undo
  (counter restored), Restart, Replay, the out-of-moves fail screen and TRY AGAIN all work.
- **Story and cutscenes:** boss level 18 → WORLD CLEARED 54/54 → Heart forge cutscene → Chapter 1 outro → Chapter 2 intro
  → level 19. Narration and captions play; the voice track stops when the scene ends.
- **Ads:** after the 3rd clear, NEXT LEVEL shows the AdMob test interstitial; closing it returns to the next level. With
  no network, NEXT continues at once without an ad. The counter resets only when an ad really shows.
- **Remove Ads** (no Play account on the emulator): the price falls back to "One-time purchase" and is retried; buy shows
  "did not go through" without granting; restore shows "Could not reach Google Play"; both buttons are disabled while
  busy. A live purchase was **not** run (needs Play Console + license tester).
- **Navigation and settings:** Sound effects toggled off and on in Pause (no false notice since RC2); the persistence of
  all four toggles is covered by unit tests. Pause opens from the HUD and from system Back. Back closes overlays and
  returns Home from the map and from results. Back on Home (exit) was not exercised.
- **Lifecycle:** Home key mid-level → return shows Pause with the attempt intact. Screen lock/unlock → same.
  `RUNNING_CRITICAL` trim → survives. Process killed in the background → relaunch keeps progress. Force-stop → cold
  start keeps progress. Audio tracks: in game 2 playing (music + ambience); backgrounded 0; locked 0; resumed 2. No
  sound continues after leaving.
- **Offline:** launch, the journey map and play all work offline; Billing and ads fail quietly.
- **Rapid taps:** 22 consecutive taps across screen transitions all registered. Two dropped taps were seen earlier,
  only while the emulator's keyboard-notification heads-up was disturbing the window, and could not be reproduced.

**Screen matrix (Android 16 emulator, `wm size` / `wm density`):** Home, Settings, Journey Map, gameplay HUD, Pause and
results captured at each size, and a level solved with projected taps at each.

| Configuration | dp | Result |
| --- | --- | --- |
| 720x1280 @360 | 320x569 | RC1: Pause "RESTAR/T", JOURNEY MAP on 2 lines, tips cut; amulet overlaps the logo subtitle (H.1). **RC2+: fixed** except the amulet |
| 480x854 @240 (low density) | 320x569 | same as above; **fixed** in RC2+ |
| 1080x1920 @480 (16:9) | 360x640 | the 360 dp tip clipping below (fixed in RC2); otherwise all screens fit except the amulet overlap (H.1) |
| 1080x2400 @480 | 360x800 | RC1: 11 of 16 tips cut after 3 lines. **RC2+: fixed** (verified level 1's 69-character tip) |
| 1080x2400 @440 | 393x873 | RC1: the longest tips cut; **RC2+ fixed**; otherwise correct |
| 1080x2424 @420 (Pixel 9) | 411x923 | correct; RC4 Pause and Settings panels pixel-identical to RC1 (PSNR ∞) |
| 1320x2868 @480 | 440x956 | correct |
| 1080x2640 @420 (22:9) | 411x1005 | correct |
| 2560x1600 @320 (landscape tablet, sw 800) | 1280x800 | RC1-before: portrait lock ignored, layout broken. **RC2+: letterboxed portrait** |
| 3-button navigation | 411x923 (48 dp bar) | every control above the bar |
| Pixel 9 display cutout (punch hole) | 54 dp top inset | correct on every screen. The emulator's "tall cutout" overlay did not apply: not covered |
| Font size 115% | 411x923 | correct |
| Font size 130% / 200% | 411x923 | RC2: HUD sunrays count cut off; at 200% the plaque covered Pause/Hint and the stats bar clipped. **RC4: correct** (text capped at 1.15x) |

## D. Device coverage

| Device | Android | Display | Purpose |
| --- | --- | --- | --- |
| Emulator `MM_API36_16K`: Pixel 9 profile, **Google Play 16 KB page-size image** | 16 (API 36), `PAGE_SIZE 16384` | 1080x2424 @420 dpi, 60 Hz, plus every `wm` configuration in C | all functional, lifecycle, matrix and performance tests |
| Emulator `MM_API37_16K`: Pixel 9 profile, Google Play 16 KB image | 17 (API 37), `PAGE_SIZE 16384` | 1080x2424 @420, and 2560x1600 @320 | forward-compatibility smoke test of RC4. Fresh install runs natively on 16 KB pages; prologue, intro and level 1 pass; the large screen is letterboxed (the opt-out still applies at targetSdk 36); no game frame-rate override; 0 crashes. Gameplay frame rate was low for the old build too (E, H) |
| Host | Windows 11, RTX 3050 (host GPU through gfxstream) | | emulator host; free RAM was 0.3-2 GB throughout (other sessions, browsers) |

**Limitations.** No physical phone was available, so every number here is from emulators on a loaded host. The memory
notes record phone-only problems (120 Hz scheduler starvation, Mali reflection maps) that an emulator cannot show. Not
covered:
- armeabi-v7a (32-bit ARM) code, which is in the bundle.
- A real low-end GPU and a 120 Hz display.
- A live Play purchase, and Play Games (not configured).

The 2 GB Play image thrashed in its first hour after boot: the low-memory killer killed even the foreground game twice
while Play Store updated apps. After disabling apps the game never uses on that test AVD, it was not killed again.
Real 2 GB phones run Android Go images.

## E. Performance results

Measured on the Android 16 emulator, so these are not phone figures. Frame pacing comes from SurfaceFlinger present
times on the app's layer (`dumpsys SurfaceFlinger --latency`).

| Measure | Old 4.0 APK | Release candidate | Notes |
| --- | --- | --- | --- |
| Cold launch to first frame (`am start -W`, process killed) | 1.17-1.76 s | 307-340 ms (5 runs, RC4); 0.4-2.2 s across earlier runs | the first launch after an install is the slowest (1.2-2.2 s). "First frame" is the splash; Home follows after fonts and the save load |
| Home, frame rate | 53.6-57.1 fps (p50 16.8-17.5 ms) | 57.7-59.9 fps (p50 16.7 ms) | old build and RC1 back to back in one session; RC4 after the soak |
| Gameplay, frame rate | 54.5-55.1 fps (level 6) | 56.9-57.2 fps (level 6, RC1); 60.0 fps, p99 20.6 ms (level 19, RC4 after the soak) | an earlier RC1 reading of ~29 fps was host memory pressure and did not repeat |
| App memory, Home | 237-240 MB PSS | 223-267 MB PSS | grows to ~270 MB in play |
| Long session (soak, RC4, totem level 19) | — | PSS 227 MB at start, 259 MB after cycle 1 (map islands and assets warm), then 271-282 MB through cycle 6; native heap 103-115 MB with no trend; threads 162 → 139; at most 6 audio players, 2-3 playing; 0 crashes, 0 low-memory kills | 6 cycles × (5 level restarts + Pause > Home + map scrolled + back + PLAY), 5 minutes. Gameplay afterwards: 60.0 fps, p99 20.6 ms. A longer soak on a phone is still recommended |
| Android 17 emulator: Home / gameplay (level 2) | 59.8 fps / 16.5-28.8 fps | 59.9 fps / 18.9-28.3 fps | same session, back to back: the gameplay slowdown is equal for both builds, so it is not from this release. Android 16 on the same host ran gameplay at 57-60 fps. Whether real Android 17 phones are affected is unknown (H) |
| Crashes / ANRs from the app | — | 0 | the only kills were the emulator's low-memory killer during first-boot thrashing (D) |

No renderer, shader, asset or game-logic changes were made, so frame-time behaviour on phones is unchanged by this
release. Two unchanged earlier findings still apply: the game is JS-bound on phones, and a friend's S21 FE ran it at
~25-30 fps.

## F. Defects fixed

| # | Defect | Reproduction | Root cause | Minimal fix | Files | Regression test |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | The native Google Play Billing and Play Games code was not in the repository | `git ls-files modules` listed only the JS side; the Kotlin sources, module `build.gradle` and manifest existed only on this disk | `.gitignore` rule `android/` (meant for the generated project) also matched `modules/google-play/android/` | anchored the rules (`/android/`, `/ios/`), ignored only the module's `build/` and `.gradle/`, added the 4 sources | `.gitignore`, `modules/google-play/android/**` | every RC builds from the committed tree; preflight |
| 2 | The release declared 6 permissions and 2 foreground services the game never uses (microphone, media-playback service, storage, overlay) | `aapt2 dump badging` of the shipped APK | Expo template defaults, plus expo-audio's library manifest (recording and lock-screen services) | `android.blockedPermissions`; a config plugin removes the two services. They are never started: no recorder, no lock-screen controls, `shouldPlayInBackground: false` | `app.json`, `plugins/withPlayRelease.js` | preflight "only the expected permissions" (11) |
| 3 | Remove Ads: a second tap before the button re-rendered as busy asked Google Play to sell twice | `removeAds.test.ts` "two taps…" failed: `PlayBilling.buy` called twice | `busy` is React state, so two taps in one slow frame both saw it false. On a cold Billing connection both calls queued and the native side launched twice, orphaning the first promise (button stuck busy) | the purchase in flight is kept in a ref and shared until it settles | `src/services/removeAds.ts` | `src/game/removeAds.test.ts` (8 tests) |
| 4 | False "Some sounds are unavailable on this device" notice after every interstitial and when turning Sound effects off; its OK panel covered Restart/Undo | Android 16: NEXT with an ad due → close the ad → notice. Pause → Sound effects off → notice (`ERR_USING_RELEASED_SHARED_OBJECT`) | regression from `a70dab2` (effects released when sound is off or the game is inactive): a tap sound's `seekTo(0).then(play)` settled after its player was released, and the failure path told the player | a sound whose voice was let go meanwhile stays silent and is not reported; real failures still are | `src/services/audio.ts` | `src/game/audio.test.ts` (4 tests; 2 fail without the fix) + device re-check |
| 5 | Android 16 large screens: the portrait lock was ignored and the layout stretched into landscape | 2560x1600 @320 dpi: `ignoreOrientationRequest=true`, not letterboxed | targetSdk 36 behaviour change at sw ≥ 600 dp | `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY`: portrait, letterboxed, as before. Not `appCategory="game"`, which also opts the app into Android's game default frame rate (GameManager gave it a 60 fps default) | `plugins/withPlayRelease.js` | preflight property check; before/after screenshots |
| 6 | 320 dp phones: Pause "RESTART" wrapped mid-word; JOURNEY MAP on 2 lines | 720x1280 @360 and 480x854 @240 | ToyButton titles had no line limit | titles stay on one line, shrinking only when the button is too narrow (never grows) | `src/ui/Toy.tsx`, `src/ui/GameText.tsx`, `src/ui/fonts.ts` | matrix; panels pixel-identical at 411 dp |
| 7 | First-time tips cut after 3 lines on 320, 360 and 393 dp phones (11 of 16 tips at 360 dp) | 360x800: level 2 "…Its arrow" without "shows its aim." | the tip box was measured against the bottom bar's fixed height | the box is anchored to the bar's floor and sized by its text; long tips grow upward until the first move | `src/screens/Gameplay.tsx` | matrix at 320 and 360 dp |
| 8 | System font size 130%+: HUD sunrays count cut off; at 200% labels overlapped Pause/Hint and each other | font_scale 1.3 and 2.0 | text followed any system scale; RN Android also scales letter spacing by the full scale even when glyphs are capped | GameText caps at 1.15x ("Large") and scales letter spacing back above the cap; no change at 1.0 or 1.15 | `src/ui/GameText.tsx` | font matrix 1.0/1.15/1.3/2.0 on RC4 |

Also fixed: `docs/GOOGLE_PLAY.md` described a price beside the Home icon (removed in `a70dab2`) and an incomplete
Data safety list; the README named platform/build-tools 35 (the build uses 36).

## G. Modified-file inventory

| File | Why |
| --- | --- |
| `.gitignore` | defect 1 |
| `modules/google-play/android/` (4 files) | defect 1: now tracked, contents unchanged |
| `app.json` | defect 2 (`blockedPermissions`); registers the release plugin |
| `plugins/withPlayRelease.js` (new) | defects 2 and 5; opt-in upload-key signing (`MM_UPLOAD_*` Gradle properties, debug key otherwise) |
| `src/services/removeAds.ts` | defect 3 |
| `src/services/audio.ts` | defect 4 |
| `src/ui/GameText.tsx`, `src/ui/fonts.ts`, `src/ui/Toy.tsx` | defects 6 and 8 |
| `src/screens/Gameplay.tsx` | defect 7 |
| `src/config/googlePlay.ts`, `src/screens/Modals.tsx` | in-app privacy policy link: Play requirement, inert until `PRIVACY_POLICY_URL` is set |
| `src/game/removeAds.test.ts`, `src/game/audio.test.ts` (new) | regression and entitlement tests |
| `package.json` | `npm test` enables Node's module mocks; `release:check` script |
| `scripts/release-check.mjs` (new) | Play preflight for the source and a built APK or AAB |
| `docs/RELEASE.md` (new), `docs/RELEASE_READINESS.md` (new), `docs/GOOGLE_PLAY.md`, `README.md` | release documentation |
| `docs/LEVEL_REPORT.md` | regenerated: date and timing only, every level row identical |

## H. Outstanding issues

**Needs the developer:**
1. Upload keystore and Play App Signing enrolment (RELEASE.md §1).
2. The game's own AdMob app ID and interstitial unit; publish the EEA consent message; `app-ads.txt`.
3. A privacy policy URL (Play Console + `PRIVACY_POLICY_URL`).
4. Play Console: create the app and the `remove_ads` product, Data safety (B.2), content rating, target audience, ads
   and advertising-ID declarations, and the store listing (B.3). Confirm versionCode 4 is higher than any earlier upload.
5. On the Internal testing track: a live purchase with a license tester, restore after reinstall, refund removal
   (GOOGLE_PLAY.md §5).
6. A physical-device pass: at least one low-end phone, one 120 Hz phone (Samsung/Mali), and one 32-bit-only ARM phone
   if supporting them matters.
7. **An Android 17 phone.** On the Android 17 emulator image, gameplay ran at 16-29 fps (Home 60 fps) for the old 4.0
   build and the release candidate alike, while Android 16 on the same host ran it at 57-60 fps. The release changed
   nothing in rendering, so this predates it. Whether it is the emulator's GPU path or the platform is unknown; check
   frame rate on a real Android 17 phone (the PERF_HUD diagnostic build shows JS vs GPU time).

**Found, not changed (need approval because they would change the look):**
- **H.1 Home amulet on 16:9 and short screens.** At 360x640 dp and 320x569 dp (and in the letterboxed tablet window),
  the 3D Hearts amulet overlaps the logo subtitle "THE LAST LIGHTKEEPER" and the "0 OF 5 HEARTS FORGED" label. The
  amulet is sized to ~78% of the screen width and doesn't consider height. Proposed fix: also limit its size by the
  height between logo and buttons (`World.tsx`, menu camera distance), which changes only those screens. Nothing
  interactive is covered.
- **H.2 Back on a cutscene's first showing goes Home** without marking it seen. It can be watched again from the map.
- **H.3 Double tap on NEXT LEVEL while an interstitial loads** starts the next level twice. This is benign (no reward is
  duplicated: results are recorded once, behind the move lock).
- **H.4** After a reinstall, an owner of Remove Ads may see the ad SDK start (and the EEA consent form) before Play
  confirms ownership. No ad is shown.
- **H.5 Targeting API 37** (Play's likely 2027 requirement) ends the large-screen opt-out. Then either declare
  `appCategory="game"` (accepting Android's game default frame rate, 60 fps on many 120 Hz phones) or design a
  large-screen layout.
- **H.6 Dependencies.** `npm audit` reports 12 issues, all in build-time tooling (Expo CLI, Metro, PostCSS, node-forge,
  image-size, undici, uuid via `xcode`); nothing runs on the player's device. The suggested "fix" is a downgrade to
  Expo 44, so none were applied. `expo-asset` is 12.0.13 where SDK 54 expects ~12.0.14: no issue observed, left as is.
- **H.7 Loop dropouts** (from an earlier session): the loop MP3s have no gapless header (13-50 ms gap per repeat).

**Changes made to this machine (not the repository):**
- Installed Android cmdline-tools (checksum-verified) and the API 36 and API 37 16 KB Google Play images.
- The shared emulator binary updated 37.1.11 → 37.2.12 as a dependency of the images.
- Created AVDs `MM_API36_16K` / `MM_API37_16K` under `D:\Android\avd`. On `MM_API36_16K`, Play Store, the keyboard and
  12 Google apps are disabled to stop low-memory thrashing.
- The `Pixel_9` AVD was shut down with the user's approval and is otherwise untouched.

## I. Build artifacts

| Artifact | Commit | Application ID / version | Signing | SHA-256 |
| --- | --- | --- | --- | --- |
| `build-output/mirror-maze-4.0.0-vc4-rc4.aab` (final candidate, 57.8 MB, 4 ABIs) | `71b09f2` | `com.lightkeeper.mirrormaze` 4.0.0, versionCode 4 | **debug key**: must be rebuilt with the upload key before upload | `99c989ce8772d2bacaf1cc471ba72cace4e9526b6da9dfe7d10fc33015bab96d` |
| `build-output/mirror-maze-4.0.0-vc4-rc4-universal.apk` (from the bundle, for sideloading) | `71b09f2` | same | debug key (same key as earlier test APKs, so it updates them in place) | `49bebb39141278eab17916fac75c2d5f9c49839025ed2c7aea89f777aa0839d4` |
| `build-output/mirror-maze-4.0.0-vc4-rc1/2/3.aab` | `93ed1cc` / `d9864bf` / `c4c97ce` | same | debug key | superseded, kept for comparison |

`build-output/` is git-ignored. Rebuilding with the upload key changes only the signature; rerun the preflight on that
bundle and keep its SHA-256 with the release notes.

## J. Final scope confirmation

**No intentional change to gameplay, levels, scoring, progression, art, animation, camera paths, cutscenes, audio
design or monetisation.** The 90 levels are verified unchanged. Ads still show every 3rd clear on NEXT/CONTINUE, and
Remove Ads keeps its product, placement and flow.

What a player can notice, all of it corrections toward the intended design:
- **Narrow phones:** a too-long button label shrinks instead of wrapping (320 dp), and long tips grow upward instead of
  being cut (320-393 dp).
- **Large font sizes** (above "Large"): text grows to 1.15x and stops there, so the layout no longer breaks.
- **Tablets and unfolded foldables on Android 16:** the game is letterboxed in portrait instead of stretched sideways.
- **Ads and Sound:** the false "sounds unavailable" notice no longer appears after ads or when turning sound off.
- **Settings:** shows a "Privacy policy" link once a URL is configured; today it shows nothing new.

At the Pixel 9's size with default text, the Pause and Settings panels are pixel-identical to the previous build.
