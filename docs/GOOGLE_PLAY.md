# Google Play: ads, Remove Ads, Play Games and cloud save

Mirror Maze earns from AdMob interstitials and a one-time **Remove Ads** purchase, and uses Google Play Games Services
for achievements, a leaderboard and a cloud save. Everything ships in a safe default state until you fill in the IDs
from the AdMob and Play Console dashboards (steps below):

| Feature | Before setup | After setup |
| --- | --- | --- |
| Interstitial ads | Google's **test** ads (labelled "Test Ad") | Your ad unit, real revenue |
| Remove Ads | Pause and Settings show it as "One-time purchase" (no price). Google Play answers "unavailable" until the app and product exist in Play Console | Your localised price on Pause and Settings (Home shows the icon only); a tap opens Google Play's purchase sheet |
| Play Games (achievements, leaderboard, cloud save) | Hidden. The SDK never starts | Automatic sign-in, Awards/Ranks on Home, cloud save |

All IDs live in two places:

- **`app.json`**: `androidAppId` (AdMob app ID) in the `react-native-google-mobile-ads` plugin, and `gamesAppId` (Play
  Games project ID) in the `./modules/google-play/app.plugin.js` plugin. These are native settings, so after changing them
  run `npx expo prebuild --platform android --clean` and rebuild.
- **`src/config/googlePlay.ts`**: the interstitial ad unit, the Remove Ads product ID, the achievement IDs and the
  leaderboard ID. Any build picks these up.

## How it behaves in the game

**Ads.** One interstitial after every third completed level, shown when the player taps NEXT LEVEL / CONTINUE (a natural
break), never during play or a cutscene. The count restarts only when an ad really played, so with no ad loaded (offline,
no fill) the next Continue tries again. In the EEA/UK, Google's consent form appears at launch; Settings > AD PRIVACY
reopens it (shown only where the law requires it). Ads are rated PG. Development builds always use test ads.

**Remove Ads.** A one-time, non-consumable product (`remove_ads`), offered to players as "Go ad-free forever". Pause and
Settings show the price before the tap, and a tap opens Google Play's purchase sheet directly (no screen of the game's
own in between). All three call the same purchase handler, and a second tap while Google Play is opening shares the
first purchase rather than starting another:
- **Home:** the crossed-out ads icon in the top bar, icon only (the price is in its spoken label).
- **Pause:** a full-width "GO AD-FREE FOREVER" button at the bottom, price on it, "One-time purchase" below the title.
- **Settings:** the same button, with RESTORE kept separate.

The price is Google Play's own localised one (fetched once and shared by all three), never hard-coded or converted.
Until Google Play answers, each says "One-time purchase" without a price; the game asks again a few times, and again
each time it comes back to the front. Cancelling Google Play's sheet returns to the same screen with nothing to dismiss;
other outcomes (pending, unavailable, failed) show a short message there. Once owned, Home shows "AD-FREE ACTIVE" and
nothing is offered again. Google Play is asked at every launch, so a purchase made on another phone with the same Play account
appears, and a refunded one is removed. The answer is also kept on the phone (apart from the journey save), so it works
offline and survives Settings > RESET. Purchases are acknowledged on the device (Google refunds unacknowledged purchases
after 3 days). There is no server, so purchases aren't verified server-side, which is a common trade-off for a small
Remove Ads unlock.

**Play Games.** Returning players are signed in automatically at launch. Others can sign in from Settings or by tapping
Awards / Ranks on Home. The game unlocks achievements and submits the total shard count after each change, and again at
sign-in, so progress earned before signing in still counts.

**Cloud save (Saved Games).** One save slot, `mirror-maze`, holding level results and story moments (settings and the ad
count stay on each phone). Whenever the journey changes it is merged with the cloud both ways: each level keeps its best
result, and a story moment seen on either phone counts. Nothing earned on either side is lost, so a new phone or a
reinstall picks up where the player left off, with a "journey restored" message. Settings > RESET also replaces the cloud
save (the confirmation says so). Development builds use a separate `mirror-maze-dev` slot, because they start fully
unlocked.

## Setup

### 1. AdMob

1. Create an AdMob account, then **Apps > Add app** (Android; choose "not listed yet" and link the store listing later).
2. Copy the **App ID** (`ca-app-pub-…~…`) into `app.json` > `androidAppId`.
3. **Ad units > Add > Interstitial**. Copy its ID (`ca-app-pub-…/…`) into `INTERSTITIAL_UNIT.android`.
4. **Privacy & messaging > European regulations**: create and publish a consent message for the app. Without it, no
   consent form appears and EEA ads are limited.
5. **app-ads.txt**: add a developer website to the Play Console listing, and serve the line AdMob gives you at
   `https://<your-site>/app-ads.txt`.
6. Never tap live ads on your own phone. Add it under **Settings > Test devices** before testing a release build with
   your real unit.

### 2. Play Console app

1. Create the app: Game, Free, and **Contains ads: Yes**.
2. Sign releases with your own upload key, not the Expo debug keystore the README build uses, and upload an `.aab`
   (`gradlew bundleRelease`; [RELEASE.md](RELEASE.md) has the key setup and the preflight). Use the **Internal testing**
   track: Billing and Play Games only fully work for installs from Google Play.
3. **App content**:
   - **Ads:** yes.
   - **Target audience:** 13+. Choosing younger ages brings in the Families policy, which needs a different ad setup.
   - **Data safety:** AdMob collects the IP address (approximate location), app interactions, diagnostics and the
     advertising ID / app set ID, and shares them for advertising, analytics and fraud prevention, encrypted in transit
     ([Google's list](https://developers.google.com/admob/android/privacy/play-data-disclosure)). Google Play Billing
     collects purchase history. Play Games (once enabled) collects game progress. The full draft is in
     [RELEASE_READINESS.md](RELEASE_READINESS.md).
   - **Content rating:** fill in the questionnaire.

### 3. Remove Ads product

1. Set up a payments profile (**Monetize > Monetization setup**).
2. **Monetize > Products > One-time products**: create a product with the ID **`remove_ads`** (this must match
   `REMOVE_ADS_PRODUCT`), name "Remove Ads", your price, then activate it. The product only becomes available after an
   `.aab` with the Billing library has been uploaded.
3. **Settings > License testing**: add your Gmail accounts. Their purchases are free test purchases.

### 4. Play Games Services

1. **Grow users > Play Games Services > Setup and management > Configuration**: create a new Play Games project for this
   app.
2. **Credentials**: add an **Android** credential (package `com.lightkeeper.mirrormaze`) for each key that signs builds
   you will run:
   - **Play app signing key:** the SHA-1 is under Play Console > Setup > App signing. This covers installs from Google
     Play.
   - **Your upload key:** for APKs you sideload.
   - **The current test builds:** these are signed with the Expo debug keystore, SHA-1
     `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`.

   Sign-in fails for any build whose key isn't listed.
3. **Saved games**: turn it **On** in the game's properties (the cloud save needs it).
4. **Achievements**: create these 8 (they total 810 XP). Then copy each ID (`CgkI…`) into `ACHIEVEMENT_IDS` under its key:

   | Key | Name | Description | XP |
   | --- | --- | --- | --- |
   | `firstLight` | First Light | Bend the light through your first mirror maze. | 10 |
   | `skyTemples` | The Fallen Sky | Restore the Sky Temples: clear all 18 levels of Chapter 1. | 50 |
   | `rainforest` | The Storm Canopy | Restore the Emerald Rainforest: clear all 18 levels of Chapter 2. | 75 |
   | `desert` | The Sinking Sun | Restore the Desert of Pyramids: clear all 18 levels of Chapter 3. | 100 |
   | `iceAge` | The Frozen Echo | Restore the Ice Age: clear all 18 levels of Chapter 4. | 125 |
   | `theVoid` | Heart of the Void | Cross the Void: clear all 18 levels of Chapter 5. | 150 |
   | `firstHeart` | Heartforged | Gather all 54 shards of one world to forge its Heart. | 100 |
   | `lightkeeper` | The Last Lightkeeper | Forge all five Hearts and seal the Void. | 200 |

   The same list is in `src/game/achievements.ts`.
5. **Leaderboards**: create "Crystal Shards" (numeric, no decimals, **larger is better**, limits 0 to 270). Copy its ID
   into `SHARDS_LEADERBOARD`. The Ranks orb on Home appears once this is set.
6. **Testers**: add your accounts. Until the Play Games configuration is published, only testers can sign in.
7. Copy the numeric **project ID** shown under the game's name into `app.json` > `gamesAppId`.
8. **Review and publish** the Play Games configuration when ready.
9. Rebuild: `npx expo prebuild --platform android --clean`, then the Gradle build.

### 5. Test pass (internal testing install)

- [ ] A test ad appears after the 3rd level when tapping NEXT LEVEL, and the next level plays normally after it closes.
- [ ] Pause and Settings show your price. Each opens Google Play's purchase sheet at once, and
  cancelling it returns to the same screen. Buy it with a license tester: ads stop, Home shows "AD-FREE ACTIVE" and
  Settings says "Ad-free active".
- [ ] Reinstall: ads stay removed. Settings > RESTORE confirms it.
- [ ] Play Games signs in. Clearing level 1 pops "First Light". Awards and Ranks open Google's screens.
- [ ] Clear app data (or use a second phone with the same account) and sign in: "journey restored" appears with the
      progress back.

## Code map

| File | Role |
| --- | --- |
| `modules/google-play/` | Local Expo module: `PlayGamesModule.kt` (Play Games v2 22.1.0) and `PlayBillingModule.kt` (Billing 9.1.0), the TypeScript API in `index.ts`, and `app.plugin.js` (project ID in the manifest; without one, the SDK's start-up provider is removed) |
| `patches/react-native-google-mobile-ads+17.0.0.patch` | A two-line nullability fix so AdMob 17.0.0 compiles on React Native 0.81 (applied by `postinstall`; drop it when upgrading to RN 0.86+ and AdMob 17.1+) |
| `src/services/ads.ts` | The ad slot: every third level, skip when nothing has loaded, pause audio during an ad |
| `src/services/adMob.native.ts` | AdMob: consent, SDK start, interstitial loading and retry, privacy form (`adMob.ts` is the empty web version) |
| `src/services/removeAds.ts` | `useRemoveAds`: owned state, price, buy, restore |
| `src/services/usePlayGames.ts` | `usePlayGames`: sign-in, achievements, leaderboard, cloud save sync |
| `src/services/storage.ts` | Cloud save format and the merge (`encodeCloud`, `decodeCloud`, `mergeSaves`) |
| `src/game/achievements.ts` | The achievement list and when each is earned |
| `src/config/googlePlay.ts` | Every ID to fill in |
