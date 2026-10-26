package expo.modules.googleplay

import android.app.Activity
import android.content.pm.PackageManager
import com.google.android.gms.games.PlayGames
import com.google.android.gms.games.SnapshotsClient
import com.google.android.gms.games.snapshot.Snapshot
import com.google.android.gms.games.snapshot.SnapshotMetadataChange
import com.google.android.gms.tasks.Task
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val APP_ID_KEY = "com.google.android.gms.games.APP_ID"
private const val RC_PLAY_GAMES_UI = 9004

/**
 * Google Play Games Services v2: sign-in, achievements, a leaderboard and one cloud save (Saved Games).
 *
 * The SDK only starts when the game's Play Console project id is in the manifest (see app.plugin.js). Without it
 * `isConfigured` is false and the game never calls anything else here.
 */
class PlayGamesModule : Module() {
  /** The cloud save opened by openSave, held until commitSave or discardSave closes it. */
  private var open: Snapshot? = null

  private val activity: Activity
    get() = appContext.currentActivity ?: throw Exceptions.MissingActivity()

  override fun definition() = ModuleDefinition {
    Name("PlayGames")

    Function("isConfigured") { configured() }

    AsyncFunction("isAuthenticated") { promise: Promise ->
      PlayGames.getGamesSignInClient(activity).isAuthenticated().settle(promise) { it.isAuthenticated }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("signIn") { promise: Promise ->
      PlayGames.getGamesSignInClient(activity).signIn().settle(promise) { it.isAuthenticated }
    }.runOnQueue(Queues.MAIN)

    // Unlocks and scores are queued by Play Games and sent when the device is online.
    AsyncFunction("unlock") { id: String ->
      PlayGames.getAchievementsClient(activity).unlock(id)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("submitScore") { id: String, score: Double ->
      PlayGames.getLeaderboardsClient(activity).submitScore(id, score.toLong())
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("showAchievements") { promise: Promise ->
      val host = activity
      PlayGames.getAchievementsClient(host).achievementsIntent.settle(promise) { host.startActivityForResult(it, RC_PLAY_GAMES_UI); null }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("showLeaderboard") { id: String, promise: Promise ->
      val host = activity
      PlayGames.getLeaderboardsClient(host).getLeaderboardIntent(id).settle(promise) { host.startActivityForResult(it, RC_PLAY_GAMES_UI); null }
    }.runOnQueue(Queues.MAIN)

    // Opens the cloud save (creating it if needed) and returns its text, or null when it is new. The save stays open
    // so the caller can merge and write back in one step.
    AsyncFunction("openSave") { name: String, promise: Promise ->
      val client = PlayGames.getSnapshotsClient(activity)
      open?.let { client.discardAndClose(it) }
      open = null
      client.open(name, true, SnapshotsClient.RESOLUTION_POLICY_HIGHEST_PROGRESS).addOnCompleteListener { task ->
        val snapshot = if (task.isSuccessful) task.result.data else null
        if (snapshot == null) {
          val conflict = if (task.isSuccessful) " (unresolved conflict)" else ""
          promise.reject("ERR_PLAY_GAMES_SAVE", "The cloud save could not be opened$conflict", task.exception)
          return@addOnCompleteListener
        }
        try {
          val bytes = snapshot.snapshotContents.readFully()
          open = snapshot
          promise.resolve(if (bytes.isEmpty()) null else String(bytes, Charsets.UTF_8))
        } catch (e: Exception) {
          client.discardAndClose(snapshot)
          promise.reject("ERR_PLAY_GAMES_SAVE", "The cloud save could not be read", e)
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("commitSave") { data: String, description: String, progress: Double, promise: Promise ->
      val snapshot = open
      if (snapshot == null) {
        promise.reject("ERR_PLAY_GAMES_SAVE", "No cloud save is open", null)
        return@AsyncFunction
      }
      open = null
      snapshot.snapshotContents.writeBytes(data.toByteArray(Charsets.UTF_8))
      val change = SnapshotMetadataChange.Builder().setDescription(description).setProgressValue(progress.toLong()).build()
      PlayGames.getSnapshotsClient(activity).commitAndClose(snapshot, change).settle(promise) { null }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("discardSave") {
      open?.let { PlayGames.getSnapshotsClient(activity).discardAndClose(it) }
      open = null
    }.runOnQueue(Queues.MAIN)
  }

  private fun configured(): Boolean {
    val context = appContext.reactContext ?: return false
    return try {
      val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
      !info.metaData?.get(APP_ID_KEY)?.toString().isNullOrBlank()
    } catch (e: PackageManager.NameNotFoundException) {
      false
    }
  }
}

private fun <T> Task<T>.settle(promise: Promise, result: (T) -> Any?) {
  addOnCompleteListener { task ->
    if (task.isSuccessful) {
      try {
        promise.resolve(result(task.result))
      } catch (e: Exception) {
        promise.reject("ERR_PLAY_GAMES", e.message ?: "Play Games request failed", e)
      }
    } else {
      promise.reject("ERR_PLAY_GAMES", task.exception?.message ?: "Play Games request failed", task.exception)
    }
  }
}
