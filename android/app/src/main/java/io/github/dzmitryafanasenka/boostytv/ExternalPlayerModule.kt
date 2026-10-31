package io.github.dzmitryafanasenka.boostytv

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * «Системный видеоплеер» (Story 8.2, PLAY-13): hands one recording to an
 * installed Android player. JS reaches it only through
 * `src/shared/platform/externalPlayer.ts`.
 *
 * Two steps, so JS can leave the Player route (and restore the origin
 * focus while the app still has window focus) before another activity
 * covers it (Story 8.2 device run: focus restored after the external
 * activity opened was lost, the sidebar got it):
 * - `prepare(url, title, chooserTitle)` resolves the players and keeps the
 *   launch intent in memory: `"ready"` or `"none"`;
 * - `launch()` starts the kept intent once and drops it: `"opened"`, or
 *   `"none"` when nothing was prepared.
 *
 * `prepare` builds an `ACTION_VIEW` with the generic
 * video MIME type data plus the title extras the reference passes (`title`
 * for MX Player, `forcename` for Vimu). It resolves the activities for that
 * intent and drops this app and the Google TV framework stub (Google TV
 * resolves VIEW to that stub, which is not a player). Each real player gets
 * its own explicit intent (the same data, type and extras plus its
 * component), because the plain chooser showed no targets on the pinned
 * Google TV (Story 8.2 device run; owner decision 2026-10-31):
 * - none → `"none"`;
 * - one → `launch` opens that player directly;
 * - several → `launch` opens the chooser with those explicit intents (the
 *   first as the target, the rest as `EXTRA_INITIAL_INTENTS`).
 *
 * The URL is a signed CDN URL: it is never logged, kept only in memory
 * between `prepare` and `launch` (or the next `prepare`), and never
 * put in a rejection (an `ActivityNotFoundException` message carries the
 * intent with its data URI, so only the class name is passed on). No
 * headers are attached; the external player fetches the URL on its own.
 */
class ExternalPlayerModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  /** The prepared launch (memory only); dropped by `launch` and the next `prepare`. */
  private var pending: Intent? = null

  @ReactMethod
  fun prepare(url: String, title: String, chooserTitle: String, promise: Promise) {
    pending = null
    try {
      val context = reactApplicationContext
      val view =
        Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(Uri.parse(url), MIME_VIDEO)
          putExtra(EXTRA_TITLE, title)
          putExtra(EXTRA_FORCE_NAME, title)
        }
      val players =
        queryActivities(context.packageManager, view)
          .map { it.activityInfo }
          .filter { it.packageName != context.packageName && it.packageName != TV_STUB_PACKAGE }
          .distinctBy { it.packageName to it.name }
          .map { Intent(view).setComponent(ComponentName(it.packageName, it.name)) }
      if (players.isEmpty()) {
        promise.resolve(OUTCOME_NONE)
        return
      }
      pending =
        if (players.size == 1) {
          players[0]
        } else {
          Intent.createChooser(players[0], chooserTitle).apply {
            putExtra(Intent.EXTRA_INITIAL_INTENTS, players.drop(1).toTypedArray())
          }
        }
      promise.resolve(OUTCOME_READY)
    } catch (error: Throwable) {
      // Class name only: the message may contain the signed URI.
      promise.reject(E_EXTERNAL_PLAYER, error.javaClass.simpleName)
    }
  }

  @ReactMethod
  fun launch(promise: Promise) {
    val launch = pending
    pending = null
    if (launch == null) {
      promise.resolve(OUTCOME_NONE)
      return
    }
    try {
      val context = reactApplicationContext
      val activity = context.currentActivity
      if (activity != null) {
        activity.startActivity(launch)
      } else {
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(launch)
      }
      promise.resolve(OUTCOME_OPENED)
    } catch (error: Throwable) {
      // Class name only: the message may contain the signed URI.
      promise.reject(E_EXTERNAL_PLAYER, error.javaClass.simpleName)
    }
  }

  override fun invalidate() {
    pending = null
    super.invalidate()
  }

  /**
   * No `MATCH_DEFAULT_ONLY`: on the pinned Google TV (API 34) that flag
   * returns only the framework stub to this app, although File Commander's
   * player has CATEGORY_DEFAULT and `pm` resolves it (Story 8.2 device run).
   * The launches use explicit components, so CATEGORY_DEFAULT matching does
   * not decide which players are offered.
   */
  private fun queryActivities(pm: PackageManager, intent: Intent): List<ResolveInfo> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0L))
    } else {
      @Suppress("DEPRECATION")
      pm.queryIntentActivities(intent, 0)
    }

  companion object {
    const val NAME = "ExternalPlayer"
    private const val MIME_VIDEO = "video/*"
    /** MX Player's title extra (the reference passes it). */
    private const val EXTRA_TITLE = "title"
    /** Vimu's title extra (the reference passes it). */
    private const val EXTRA_FORCE_NAME = "forcename"
    /** Google TV resolves the video VIEW intent to this stub; it is not a player. */
    private const val TV_STUB_PACKAGE = "com.android.tv.frameworkpackagestubs"
    private const val OUTCOME_READY = "ready"
    private const val OUTCOME_OPENED = "opened"
    private const val OUTCOME_NONE = "none"
    private const val E_EXTERNAL_PLAYER = "E_EXTERNAL_PLAYER"
  }
}
