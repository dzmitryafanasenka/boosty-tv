package io.github.dzmitryafanasenka.boostytv

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.tv.TvContract
import android.net.Uri
import android.os.Build
import androidx.annotation.RequiresApi
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicReference

/**
 * «Продолжить просмотр» in the launcher (Story 12.5, IMP-04, FR67, ADR 0016):
 * one Android TV app preview channel (platform `TvContract`, API 26+) that
 * mirrors the local Continue history. JS reaches it only through
 * `src/shared/platform/launcherChannel.ts`.
 *
 * - `sync(channelName, cards)`: finds our channel by its
 *   `INTERNAL_PROVIDER_ID` (the provider returns only this app's rows),
 *   creates it once, never deletes it, and replaces its programs with
 *   `cards` (the new ones are inserted first, then the old ones deleted,
 *   so the channel is never empty in between). Story 12.4 device spike:
 *   Aero TV keeps its own copy of a deleted channel, so an empty Continue
 *   list is a neutral card, not a deletion. Resolves `"synced"`, or
 *   `"unsupported"` below API 26.
 * - `takePendingOpen()`: the card the user opened in the launcher, once
 *   (`MainActivity` stashes it from the launch intent and `onNewIntent`):
 *   `{target: "media", blogUrl, postId, mediaId}`, `{target: "home"}` or
 *   null. JS validates the ids against its local history; nothing here
 *   trusts them.
 *
 * Every provider call runs on one serial thread, never the UI thread.
 * Nothing is logged; a rejection carries a fixed code and the exception's
 * class name only (a message may hold a title or an intent URI).
 *
 * The card links are `boostytv://continue?blogUrl=…&postId=…&mediaId=…`
 * (URL-encoded) and `boostytv://home` (the neutral card and the channel
 * app link), received by `MainActivity`'s VIEW filter (scheme `boostytv`,
 * hosts `continue` and `home`). Story 12.5 device run: Aero TV ignores a
 * program's explicit-component intent (it starts the LEANBACK_LAUNCHER
 * intent) but fires a VIEW link. Any app can fire these links, so JS opens
 * a video only when its ids match the local Continue history (ADR 0016).
 */
class LauncherChannelModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val executor: ExecutorService = Executors.newSingleThreadExecutor()

  override fun getName(): String = NAME

  /** Replaces the channel's programs with `cards` (newest first); creates the channel once. */
  @ReactMethod
  fun sync(channelName: String, cards: ReadableArray, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      promise.resolve(OUTCOME_UNSUPPORTED)
      return
    }
    // Read on the calling thread: the bridge array is not used after this.
    val parsed = ArrayList<Card>(cards.size())
    for (index in 0 until cards.size()) {
      cards.getMap(index)?.let { card -> parseCard(card)?.let { parsed.add(it) } }
    }
    try {
      executor.execute {
        try {
          syncNow(reactApplicationContext, channelName, parsed)
          promise.resolve(OUTCOME_SYNCED)
        } catch (error: Throwable) {
          promise.reject(E_LAUNCHER_CHANNEL, error.javaClass.simpleName)
        }
      }
    } catch (error: RejectedExecutionException) {
      promise.reject(E_LAUNCHER_CHANNEL, error.javaClass.simpleName)
    }
  }

  /** The launcher card the user opened, once; null when there is none. */
  @ReactMethod
  fun takePendingOpen(promise: Promise) {
    when (val open = pending.getAndSet(null)) {
      null -> promise.resolve(null)
      is PendingOpen.Home ->
        promise.resolve(Arguments.createMap().apply { putString(KEY_TARGET, TARGET_HOME) })
      is PendingOpen.Media ->
        promise.resolve(
          Arguments.createMap().apply {
            putString(KEY_TARGET, TARGET_MEDIA)
            putString(KEY_BLOG_URL, open.blogUrl)
            putString(KEY_POST_ID, open.postId)
            putString(KEY_MEDIA_ID, open.mediaId)
          },
        )
    }
  }

  override fun invalidate() {
    // Queued tasks still run; nothing new is accepted.
    executor.shutdown()
    super.invalidate()
  }

  private fun parseCard(map: ReadableMap): Card? {
    val title = map.stringOrNull(KEY_TITLE) ?: return null
    val description = map.stringOrNull(KEY_DESCRIPTION)
    val poster = map.stringOrNull(KEY_POSTER_URL)
    return when (map.stringOrNull(KEY_TARGET)) {
      TARGET_HOME -> Card(title, description, poster, null)
      TARGET_MEDIA -> {
        val blogUrl = map.stringOrNull(KEY_BLOG_URL) ?: return null
        val postId = map.stringOrNull(KEY_POST_ID) ?: return null
        val mediaId = map.stringOrNull(KEY_MEDIA_ID) ?: return null
        Card(title, description, poster, PendingOpen.Media(blogUrl, postId, mediaId))
      }
      else -> null
    }
  }

  @RequiresApi(Build.VERSION_CODES.O)
  private fun syncNow(context: Context, channelName: String, cards: List<Card>) {
    val resolver = context.contentResolver
    val channelId = ensureChannel(context, channelName)
    val old = ArrayList<Long>()
    resolver
      .query(
        TvContract.buildPreviewProgramsUriForChannel(channelId),
        arrayOf(TvContract.PreviewPrograms._ID),
        null,
        null,
        null,
      )
      ?.use { cursor ->
        while (cursor.moveToNext()) {
          old.add(cursor.getLong(0))
        }
      }
    val banner = bannerUri(context)
    // All new programs first; the old ones go only after every insert
    // succeeded. A failed insert removes what this sync added and keeps the
    // old cards (an empty channel would leave Aero's stale copy).
    val inserted = ArrayList<Long>(cards.size)
    try {
    cards.forEachIndexed { index, card ->
      val values =
        ContentValues().apply {
          put(TvContract.PreviewPrograms.COLUMN_CHANNEL_ID, channelId)
          put(TvContract.PreviewPrograms.COLUMN_TYPE, TvContract.PreviewPrograms.TYPE_CLIP)
          put(TvContract.PreviewPrograms.COLUMN_TITLE, card.title)
          if (!card.description.isNullOrEmpty()) {
            put(TvContract.PreviewPrograms.COLUMN_SHORT_DESCRIPTION, card.description)
          }
          put(TvContract.PreviewPrograms.COLUMN_POSTER_ART_URI, card.posterUrl ?: banner)
          put(
            TvContract.PreviewPrograms.COLUMN_POSTER_ART_ASPECT_RATIO,
            TvContract.PreviewPrograms.ASPECT_RATIO_16_9,
          )
          // The launcher orders by weight, highest first: keep the JS order.
          put(TvContract.PreviewPrograms.COLUMN_WEIGHT, cards.size - index)
          put(
            TvContract.PreviewPrograms.COLUMN_INTENT_URI,
            openLink(card.open),
          )
        }
      val uri =
        resolver.insert(TvContract.PreviewPrograms.CONTENT_URI, values)
          ?: throw IllegalStateException("program insert")
      inserted.add(ContentUris.parseId(uri))
    }
    } catch (error: Throwable) {
      for (id in inserted) {
        try {
          resolver.delete(TvContract.buildPreviewProgramUri(id), null, null)
        } catch (_: Throwable) {
          // Best effort; the next sync replaces every program of the channel.
        }
      }
      throw error
    }
    for (id in old) {
      resolver.delete(TvContract.buildPreviewProgramUri(id), null, null)
    }
  }

  /** Our channel's id: found by `INTERNAL_PROVIDER_ID`, else created (never deleted). */
  @RequiresApi(Build.VERSION_CODES.O)
  private fun ensureChannel(context: Context, channelName: String): Long {
    val resolver = context.contentResolver
    val values =
      ContentValues().apply {
        put(TvContract.Channels.COLUMN_TYPE, TvContract.Channels.TYPE_PREVIEW)
        put(TvContract.Channels.COLUMN_DISPLAY_NAME, channelName)
        put(
          TvContract.Channels.COLUMN_APP_LINK_INTENT_URI,
          openLink(null),
        )
        put(TvContract.Channels.COLUMN_INTERNAL_PROVIDER_ID, CHANNEL_PROVIDER_ID)
      }
    val appLink = values.getAsString(TvContract.Channels.COLUMN_APP_LINK_INTENT_URI)
    var found: Long? = null
    var stale = false
    resolver
      .query(
        TvContract.Channels.CONTENT_URI,
        arrayOf(
          TvContract.Channels._ID,
          TvContract.Channels.COLUMN_INTERNAL_PROVIDER_ID,
          TvContract.Channels.COLUMN_DISPLAY_NAME,
          TvContract.Channels.COLUMN_APP_LINK_INTENT_URI,
        ),
        null,
        null,
        null,
      )
      ?.use { cursor ->
        while (found == null && cursor.moveToNext()) {
          if (cursor.getString(1) == CHANNEL_PROVIDER_ID) {
            found = cursor.getLong(0)
            stale = cursor.getString(2) != channelName || cursor.getString(3) != appLink
          }
        }
      }
    val existing = found
    if (existing != null) {
      // The name and the app link follow the current build: written only when they differ.
      if (stale) {
        resolver.update(TvContract.buildChannelUri(existing), values, null, null)
      }
      return existing
    }
    val uri =
      resolver.insert(TvContract.Channels.CONTENT_URI, values)
        ?: throw IllegalStateException("channel insert")
    return ContentUris.parseId(uri)
  }

  private fun bannerUri(context: Context): String =
    "android.resource://${context.packageName}/drawable/tv_banner"

  companion object {
    const val NAME = "LauncherChannel"
    /** The card links: `boostytv://continue?…` and `boostytv://home` (MainActivity's VIEW filter). */
    const val LINK_SCHEME = "boostytv"
    private const val HOST_CONTINUE = "continue"
    private const val HOST_HOME = "home"
    private const val CHANNEL_PROVIDER_ID = "continue"
    private const val KEY_TARGET = "target"
    private const val KEY_TITLE = "title"
    private const val KEY_DESCRIPTION = "description"
    private const val KEY_POSTER_URL = "posterUrl"
    private const val KEY_BLOG_URL = "blogUrl"
    private const val KEY_POST_ID = "postId"
    private const val KEY_MEDIA_ID = "mediaId"
    private const val TARGET_HOME = "home"
    private const val TARGET_MEDIA = "media"
    private const val OUTCOME_SYNCED = "synced"
    private const val OUTCOME_UNSUPPORTED = "unsupported"
    private const val E_LAUNCHER_CHANNEL = "E_LAUNCHER_CHANNEL"

    /** The last launcher open not yet taken by JS (memory only). */
    private val pending = AtomicReference<PendingOpen?>(null)

    /**
     * `MainActivity` hands every launch intent here (a fresh start and
     * `onNewIntent`). Ours (by action) becomes the pending open; any other
     * launch (the app tile, recents) drops an untaken one.
     */
    fun stash(intent: Intent?) {
      pending.set(
        try {
          val data = intent?.data
          if (
            intent == null ||
              intent.action != Intent.ACTION_VIEW ||
              data == null ||
              data.scheme != LINK_SCHEME ||
              (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
          ) {
            // The tile, recents, or anything that is not our link.
            null
          } else if (data.host == HOST_CONTINUE) {
            val blogUrl = data.getQueryParameter(KEY_BLOG_URL)
            val postId = data.getQueryParameter(KEY_POST_ID)
            val mediaId = data.getQueryParameter(KEY_MEDIA_ID)
            if (!blogUrl.isNullOrEmpty() && !postId.isNullOrEmpty() && !mediaId.isNullOrEmpty()) {
              PendingOpen.Media(blogUrl, postId, mediaId)
            } else {
              PendingOpen.Home
            }
          } else {
            // `boostytv://home`, or a host we do not know: Главная.
            PendingOpen.Home
          }
        } catch (_: Throwable) {
          // A malformed link from another app: open Главная.
          PendingOpen.Home
        },
      )
    }

    /** The link a card (or, with null, the neutral card and the channel link) opens. */
    private fun openLink(media: PendingOpen.Media?): String =
      if (media == null) {
        Uri.Builder().scheme(LINK_SCHEME).authority(HOST_HOME).build().toString()
      } else {
        Uri.Builder()
          .scheme(LINK_SCHEME)
          .authority(HOST_CONTINUE)
          .appendQueryParameter(KEY_BLOG_URL, media.blogUrl)
          .appendQueryParameter(KEY_POST_ID, media.postId)
          .appendQueryParameter(KEY_MEDIA_ID, media.mediaId)
          .build()
          .toString()
      }

    private fun ReadableMap.stringOrNull(key: String): String? =
      if (hasKey(key) && !isNull(key)) getString(key) else null
  }

  private class Card(
    val title: String,
    val description: String?,
    val posterUrl: String?,
    val open: PendingOpen.Media?,
  )

  private sealed class PendingOpen {
    object Home : PendingOpen()

    class Media(val blogUrl: String, val postId: String, val mediaId: String) : PendingOpen()
  }
}
