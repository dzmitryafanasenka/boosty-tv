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
 * installed Android player through the system chooser. JS reaches it only
 * through `src/shared/platform/externalPlayer.ts`.
 *
 * `open(url, title, chooserTitle)` builds an `ACTION_VIEW` with the generic video MIME type
 * data plus the title extras the reference passes (`title` for MX Player,
 * `forcename` for Vimu). It resolves the activities for that intent and
 * drops this app and the Google TV framework stub (Google TV resolves VIEW
 * to that stub, which is not a player). None left → `"none"`; otherwise the
 * chooser opens with those two excluded (`EXTRA_EXCLUDE_COMPONENTS`) and the
 * promise resolves `"opened"`.
 *
 * The URL is a signed CDN URL: it is never logged, never stored and never
 * put in a rejection (an `ActivityNotFoundException` message carries the
 * intent with its data URI, so only the class name is passed on). No
 * headers are attached; the external player fetches the URL on its own.
 */
class ExternalPlayerModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun open(url: String, title: String, chooserTitle: String, promise: Promise) {
    try {
      val context = reactApplicationContext
      val view =
        Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(Uri.parse(url), MIME_VIDEO)
          putExtra(EXTRA_TITLE, title)
          putExtra(EXTRA_FORCE_NAME, title)
        }
      val resolved = queryActivities(context.packageManager, view)
      val excluded =
        resolved
          .map { it.activityInfo }
          .filter { it.packageName == context.packageName || it.packageName == TV_STUB_PACKAGE }
          .map { ComponentName(it.packageName, it.name) }
      if (resolved.size - excluded.size <= 0) {
        promise.resolve(OUTCOME_NONE)
        return
      }
      val chooser =
        Intent.createChooser(view, chooserTitle).apply {
          putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, excluded.toTypedArray())
        }
      val activity = context.currentActivity
      if (activity != null) {
        activity.startActivity(chooser)
      } else {
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(chooser)
      }
      promise.resolve(OUTCOME_OPENED)
    } catch (error: Throwable) {
      // Class name only: the message may contain the signed URI.
      promise.reject(E_EXTERNAL_PLAYER, error.javaClass.simpleName)
    }
  }

  private fun queryActivities(pm: PackageManager, intent: Intent): List<ResolveInfo> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      pm.queryIntentActivities(
        intent,
        PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong()),
      )
    } else {
      @Suppress("DEPRECATION")
      pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
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
    private const val OUTCOME_OPENED = "opened"
    private const val OUTCOME_NONE = "none"
    private const val E_EXTERNAL_PLAYER = "E_EXTERNAL_PLAYER"
  }
}
