# Releasing to Google Play

How to build, sign and check a Mirror Maze release for Google Play. The last audit of the release candidate is in
[RELEASE_READINESS.md](RELEASE_READINESS.md). Store setup (AdMob, Play Console, Remove Ads, Play Games) is in
[GOOGLE_PLAY.md](GOOGLE_PLAY.md).

## 1. Before the first upload (once)

1. **Fill in the IDs** listed in [GOOGLE_PLAY.md](GOOGLE_PLAY.md): the AdMob app ID (`app.json`), the interstitial
   unit, and the privacy policy URL (`src/config/googlePlay.ts`, `PRIVACY_POLICY_URL`). Play Games is optional.
2. **Create the upload key.** Keep the keystore and its passwords out of the repository (`*.keystore` is git-ignored)
   and back them up. Losing the upload key means asking Google support to reset it.

   ```powershell
   keytool -genkeypair -v -keystore D:\keys\mirror-maze-upload.keystore -alias upload -keyalg RSA -keysize 4096 -validity 10000
   ```

3. **Tell Gradle where the key is**, in `%USERPROFILE%\.gradle\gradle.properties` (not the project's):

   ```properties
   MM_UPLOAD_STORE_FILE=D:/keys/mirror-maze-upload.keystore
   MM_UPLOAD_STORE_PASSWORD=...
   MM_UPLOAD_KEY_ALIAS=upload
   MM_UPLOAD_KEY_PASSWORD=...
   ```

   `plugins/withPlayRelease.js` signs release builds with this key when `MM_UPLOAD_STORE_FILE` is set. Without it,
   release builds keep the debug key: fine for sideloaded test APKs, rejected by Play Console.
4. In Play Console, enrol in **Play App Signing** (the default for new apps). Google then signs what players download;
   your upload key only proves the upload is yours.

## 2. Each release

1. Raise `expo.android.versionCode` in `app.json` (it must be higher than every build ever uploaded) and, if the
   player-facing version changes, `expo.version` and the "v4.0" caption in Settings (`src/screens/Modals.tsx`).
2. Check the test switches are off: `UNLOCK_ALL` (`src/game/testing.ts`) and `PERF_HUD` (`src/world/perf.ts`).
3. Verify and build:

   ```powershell
   npm ci
   npm run typecheck
   npm test
   npx tsx scripts/level-report.ts          # 90/90 levels pass -> docs/LEVEL_REPORT.md
   npx expo prebuild --platform android --clean
   cd android
   .\gradlew.bat bundleRelease --max-workers=2
   # -> android/app/build/outputs/bundle/release/app-release.aab
   .\gradlew.bat --stop
   ```

   Leave `reactNativeArchitectures` at its default (all four ABIs) for the bundle: Google Play gives each phone only its
   own. The `-PreactNativeArchitectures=arm64-v8a,x86_64` shortcut is for quick test APKs.
4. Run the preflight on the bundle. It checks the source configuration, the signer, target SDK, permissions, 16 KB page
   alignment, the Hermes bundle and source maps. For the bundle's manifest it needs
   [bundletool](https://github.com/google/bundletool/releases) (`bundletool-all-*.jar`):

   ```powershell
   $env:BUNDLETOOL = "D:\tools\bundletool-all.jar"
   npm run release:check -- android/app/build/outputs/bundle/release/app-release.aab
   ```

   Every line must be PASS (WARN lines need a look). Save the printed SHA-256 with the release notes.
5. Upload the `.aab` to the **Internal testing** track first. Billing and Play Games only fully work for installs from
   Google Play, so the purchase test pass in [GOOGLE_PLAY.md](GOOGLE_PLAY.md) runs there with license-tester accounts.

## Test APKs (sideload)

```powershell
cd android
.\gradlew.bat assembleRelease "-PreactNativeArchitectures=arm64-v8a,x86_64" --max-workers=2
npm run release:check -- android/app/build/outputs/apk/release/app-release.apk
```

A test APK signed with the debug key shows one WARN for its signer; that is expected.
