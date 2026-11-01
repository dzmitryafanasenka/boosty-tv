package io.github.dzmitryafanasenka.boostytv

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * In-app update install (Story 9.2, FR-56, UPD-02; owner decision
 * 2026-11-01). JS reaches it only through `src/shared/platform/appUpdater.ts`,
 * and only after an explicit OK on «Скачать и установить». The system
 * installer asks the user again: there is no PackageInstaller session and
 * no silent install.
 *
 * - `download(url, sha256, size)`: one download at a time (a second one
 *   rejects `E_BUSY`). The URL must be this repository's release download
 *   URL over HTTPS; redirects are followed by hand, at most `MAX_REDIRECTS`,
 *   each over HTTPS to `ALLOWED_HOSTS` (github.com and GitHub's release-asset
 *   CDN hosts). `cancel()` also disconnects the active connection. No auth header or cookie is sent. The file
 *   goes to `cacheDir/updates/` (app-private), the SHA-256 is computed while
 *   writing, and a mismatch (`E_DIGEST`), a size other than the declared one
 *   (`E_SIZE`), a cancel (`E_CANCELLED`) or a failure (`E_NETWORK`,
 *   `E_STORAGE`) deletes the file. Progress goes out as the
 *   `appUpdaterProgress` device event `{received, total}`, throttled.
 *   Resolves with the file's name (not its path).
 * - `install(fileRef)`: `ACTION_INSTALL_PACKAGE` (the system package
 *   installer) with a FileProvider content URI and `EXTRA_RETURN_RESULT`;
 *   resolves `installed` / `cancelled` / `failed` from the activity result.
 * - `canRequestInstalls()`, `openInstallSettings()`: the «Установка
 *   неизвестных приложений» permission for this package.
 * - `cleanup()`: deletes every file in `cacheDir/updates/` (on start).
 *
 * Nothing is logged here. Rejections carry a fixed code and the exception's
 * class name only: a message may hold the URL or the path.
 */
class AppUpdaterModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private val executor: ExecutorService = Executors.newSingleThreadExecutor()
  private val running = AtomicBoolean(false)
  private val cancelled = AtomicBoolean(false)
  @Volatile private var installPromise: Promise? = null
  @Volatile private var activeConnection: HttpURLConnection? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = NAME

  override fun getConstants(): Map<String, Any?> =
    mapOf(SUPPORTED_ABIS to Build.SUPPORTED_ABIS.toList())

  @ReactMethod
  fun canRequestInstalls(promise: Promise) {
    try {
      val allowed =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          reactApplicationContext.packageManager.canRequestPackageInstalls()
        } else {
          // Below API 26 the per-app permission does not exist (the global
          // «Unknown sources» setting applies and the installer asks).
          true
        }
      promise.resolve(allowed)
    } catch (error: Throwable) {
      promise.reject(E_INSTALL, error.javaClass.simpleName)
    }
  }

  @ReactMethod
  fun openInstallSettings(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      promise.resolve(OUTCOME_NONE)
      return
    }
    try {
      val context = reactApplicationContext
      val intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
      val activity = context.currentActivity
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      promise.resolve(OUTCOME_OPENED)
    } catch (error: ActivityNotFoundException) {
      promise.resolve(OUTCOME_NONE)
    } catch (error: Throwable) {
      promise.reject(E_INSTALL, error.javaClass.simpleName)
    }
  }

  @ReactMethod
  fun download(url: String, sha256: String, size: Double, promise: Promise) {
    if (!running.compareAndSet(false, true)) {
      promise.reject(E_BUSY, "busy")
      return
    }
    cancelled.set(false)
    val expectedSize = size.toLong()
    val expectedDigest = sha256.lowercase()
    if (!url.startsWith(ASSET_URL_PREFIX) || !DIGEST_HEX.matches(expectedDigest) ||
      expectedSize <= 0L || expectedSize > MAX_BYTES
    ) {
      running.set(false)
      promise.reject(E_URL, "rejected")
      return
    }
    try {
      executor.execute {
        val dir = File(reactApplicationContext.cacheDir, DIR_NAME)
        val file = File(dir, FILE_NAME)
        val failure: String? =
          try {
            if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) {
              throw StorageFailure()
            }
            file.delete()
            fetch(url, file, expectedSize, expectedDigest)
            // A cancel during the last read or the digest step still wins.
            if (cancelled.get()) {
              throw Cancelled()
            }
            null
          } catch (error: Throwable) {
            // A cancel disconnects the connection: whatever that throws is the cancel.
            if (cancelled.get()) {
              E_CANCELLED
            } else {
              when (error) {
                is Cancelled -> E_CANCELLED
                is DigestMismatch -> E_DIGEST
                is SizeMismatch -> E_SIZE
                is UrlRejected -> E_URL
                is StorageFailure -> E_STORAGE
                else -> E_NETWORK
              }
            }
          }
        if (failure != null) {
          file.delete()
        }
        activeConnection = null
        // Cleared before the promise settles, so an install (or a new
        // download) sent right after the result is not refused as busy.
        running.set(false)
        if (failure == null) {
          promise.resolve(FILE_NAME)
        } else {
          promise.reject(failure, failure)
        }
      }
    } catch (error: Throwable) {
      // The executor is shut down (the bridge is going away).
      running.set(false)
      promise.reject(E_NETWORK, error.javaClass.simpleName)
    }
  }

  @ReactMethod
  fun cancel() {
    if (running.get()) {
      cancelled.set(true)
      // Ends a stalled connect or read at once instead of after the timeouts.
      try {
        activeConnection?.disconnect()
      } catch (error: Throwable) {
        // Already closed.
      }
    }
  }

  @ReactMethod
  fun install(fileRef: String, promise: Promise) {
    try {
      val context = reactApplicationContext
      val file = File(File(context.cacheDir, DIR_NAME), FILE_NAME)
      if (fileRef != FILE_NAME || running.get() || !file.isFile) {
        promise.resolve(OUTCOME_FAILED)
        return
      }
      val activity = context.currentActivity
      if (activity == null) {
        promise.resolve(OUTCOME_FAILED)
        return
      }
      val uri = FileProvider.getUriForFile(context, "${context.packageName}$AUTHORITY_SUFFIX", file)
      @Suppress("DEPRECATION")
      val intent =
        Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
          setDataAndType(uri, MIME_APK)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          putExtra(Intent.EXTRA_RETURN_RESULT, true)
        }
      installPromise?.resolve(OUTCOME_CANCELLED)
      installPromise = promise
      activity.startActivityForResult(intent, REQUEST_INSTALL)
    } catch (error: ActivityNotFoundException) {
      installPromise = null
      promise.resolve(OUTCOME_FAILED)
    } catch (error: Throwable) {
      installPromise = null
      promise.reject(E_INSTALL, error.javaClass.simpleName)
    }
  }

  @ReactMethod
  fun cleanup(promise: Promise) {
    try {
      executor.execute {
        try {
          if (!running.get()) {
            File(reactApplicationContext.cacheDir, DIR_NAME).listFiles()?.forEach { it.delete() }
          }
          promise.resolve(true)
        } catch (error: Throwable) {
          promise.reject(E_STORAGE, error.javaClass.simpleName)
        }
      }
    } catch (error: Throwable) {
      promise.reject(E_STORAGE, error.javaClass.simpleName)
    }
  }

  @ReactMethod fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) = Unit

  @ReactMethod fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Double) = Unit

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST_INSTALL) {
      return
    }
    val promise = installPromise ?: return
    installPromise = null
    promise.resolve(
      when (resultCode) {
        Activity.RESULT_OK -> OUTCOME_INSTALLED
        Activity.RESULT_CANCELED -> OUTCOME_CANCELLED
        else -> OUTCOME_FAILED
      },
    )
  }

  override fun onNewIntent(intent: Intent) = Unit

  override fun invalidate() {
    cancelled.set(true)
    installPromise = null
    executor.shutdown()
    reactApplicationContext.removeActivityEventListener(this)
    super.invalidate()
  }

  /** Follows the redirects by hand (HTTPS, GitHub hosts only), then streams and hashes the body. */
  private fun fetch(start: String, file: File, expectedSize: Long, expectedDigest: String) {
    var target = URL(start)
    var redirects = 0
    while (true) {
      if (cancelled.get()) {
        throw Cancelled()
      }
      if (!allowedUrl(target)) {
        throw UrlRejected()
      }
      val connection = target.openConnection() as HttpURLConnection
      activeConnection = connection
      try {
        connection.instanceFollowRedirects = false
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = READ_TIMEOUT_MS
        connection.useCaches = false
        connection.setRequestProperty("Accept", "application/octet-stream")
        val status = connection.responseCode
        if (status in 300..399) {
          val location = connection.getHeaderField("Location") ?: throw IOException("redirect")
          redirects += 1
          if (redirects > MAX_REDIRECTS) {
            throw UrlRejected()
          }
          target = URL(target, location)
          continue
        }
        if (status != HttpURLConnection.HTTP_OK) {
          throw IOException("status")
        }
        val length = connection.contentLengthLong
        if (length >= 0L && length != expectedSize) {
          throw SizeMismatch()
        }
        stream(connection, file, expectedSize, expectedDigest)
        return
      } finally {
        connection.disconnect()
      }
    }
  }

  private fun stream(connection: HttpURLConnection, file: File, expectedSize: Long, expectedDigest: String) {
    val digest = MessageDigest.getInstance("SHA-256")
    var received = 0L
    var lastEmit = 0L
    var lastPercent = -1L
    emitProgress(0L, expectedSize)
    connection.inputStream.use { input ->
      val output =
        try {
          FileOutputStream(file)
        } catch (error: IOException) {
          throw StorageFailure()
        }
      output.use {
        val buffer = ByteArray(BUFFER_BYTES)
        while (true) {
          if (cancelled.get()) {
            throw Cancelled()
          }
          val read = input.read(buffer)
          if (read < 0) {
            break
          }
          received += read
          if (received > expectedSize) {
            throw SizeMismatch()
          }
          digest.update(buffer, 0, read)
          try {
            it.write(buffer, 0, read)
          } catch (error: IOException) {
            throw StorageFailure()
          }
          val now = System.currentTimeMillis()
          val percent = received * 100L / expectedSize
          if (percent != lastPercent && now - lastEmit >= PROGRESS_INTERVAL_MS) {
            lastEmit = now
            lastPercent = percent
            emitProgress(received, expectedSize)
          }
        }
      }
    }
    if (cancelled.get()) {
      throw Cancelled()
    }
    if (received != expectedSize) {
      throw SizeMismatch()
    }
    val actual = digest.digest().joinToString("") { "%02x".format(it) }
    if (actual != expectedDigest) {
      throw DigestMismatch()
    }
    emitProgress(received, expectedSize)
  }

  private fun allowedUrl(url: URL): Boolean {
    if (url.protocol != "https" || url.userInfo != null) {
      return false
    }
    return url.host.lowercase() in ALLOWED_HOSTS
  }

  private fun emitProgress(received: Long, total: Long) {
    val context = reactApplicationContext
    if (!context.hasActiveReactInstance()) {
      return
    }
    context.emitDeviceEvent(
      EVENT_PROGRESS,
      Arguments.createMap().apply {
        putDouble("received", received.toDouble())
        putDouble("total", total.toDouble())
      },
    )
  }

  private class Cancelled : Exception()
  private class DigestMismatch : Exception()
  private class SizeMismatch : Exception()
  private class UrlRejected : Exception()
  private class StorageFailure : Exception()

  companion object {
    const val NAME = "AppUpdater"
    private const val SUPPORTED_ABIS = "supportedAbis"
    private const val EVENT_PROGRESS = "appUpdaterProgress"
    private const val ASSET_URL_PREFIX = "https://github.com/dzmitryafanasenka/boosty-tv/releases/download/"
    /** github.com and GitHub's release-asset CDN hosts only (not other user-content hosts). */
    private val ALLOWED_HOSTS =
      setOf("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")
    private val DIGEST_HEX = Regex("^[0-9a-f]{64}$")
    /** Matches `res/xml/update_file_paths.xml` (`cache-path` `updates/`). */
    const val DIR_NAME = "updates"
    private const val FILE_NAME = "update.apk"
    private const val AUTHORITY_SUFFIX = ".updates"
    private const val MIME_APK = "application/vnd.android.package-archive"
    private const val MAX_BYTES = 300L * 1024L * 1024L
    private const val MAX_REDIRECTS = 5
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 30_000
    private const val BUFFER_BYTES = 64 * 1024
    private const val PROGRESS_INTERVAL_MS = 250L
    private const val REQUEST_INSTALL = 9201
    private const val OUTCOME_OPENED = "opened"
    private const val OUTCOME_NONE = "none"
    private const val OUTCOME_INSTALLED = "installed"
    private const val OUTCOME_CANCELLED = "cancelled"
    private const val OUTCOME_FAILED = "failed"
    private const val E_BUSY = "E_BUSY"
    private const val E_CANCELLED = "E_CANCELLED"
    private const val E_NETWORK = "E_NETWORK"
    private const val E_DIGEST = "E_DIGEST"
    private const val E_SIZE = "E_SIZE"
    private const val E_URL = "E_URL"
    private const val E_STORAGE = "E_STORAGE"
    private const val E_INSTALL = "E_INSTALL"
  }
}
