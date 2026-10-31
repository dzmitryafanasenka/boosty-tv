package io.github.dzmitryafanasenka.boostytv

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * The diagnostics log file (Story 8.3, SET-05, AD-14). JS reaches it only
 * through `src/shared/platform/logFile.ts`; the lines it gets are already
 * redacted by the JS Logger.
 *
 * - The file is `getExternalFilesDir(null)/logs/boostytv.log` (app-specific
 *   external storage, no permission), so
 *   `adb pull /sdcard/Android/data/<applicationId>/files/logs/` works on a
 *   release build, which is not debuggable (owner decision 2026-10-31).
 * - It is capped at 256 KB: an append that would pass the cap first moves
 *   the file to `boostytv.log.1`, replacing the older copy (at most 512 KB
 *   in total).
 * - Every call runs on one serial thread, in the order JS made it, so a
 *   `clear` sent after an `append` always runs after it and wins
 *   (AccountScope reset: no line of the previous account survives).
 *
 * Never reads back, logs or returns the content. A rejection carries a
 * fixed code and the exception's class name only (a message may hold a
 * path).
 */
class LogFileModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val executor: ExecutorService = Executors.newSingleThreadExecutor()

  override fun getName(): String = NAME

  /** Appends the lines (one per entry, newline-terminated); resolves true. */
  @ReactMethod
  fun append(lines: ReadableArray, promise: Promise) {
    val batch = ArrayList<String>(lines.size())
    for (index in 0 until lines.size()) {
      lines.getString(index)?.let { batch.add(it) }
    }
    run(promise) {
      appendBatch(batch)
      true
    }
  }

  /** Deletes the file and its rotated copy; resolves true when neither exists. */
  @ReactMethod
  fun clear(promise: Promise) {
    run(promise) {
      clearFiles()
      true
    }
  }

  /** The absolute path of the log directory, or null when there is no external files dir. */
  @ReactMethod
  fun location(promise: Promise) {
    run(promise) { logDir()?.absolutePath }
  }

  override fun invalidate() {
    // Queued tasks still run; nothing new is accepted.
    executor.shutdown()
    super.invalidate()
  }

  private fun run(promise: Promise, task: () -> Any?) {
    try {
      executor.execute {
        try {
          promise.resolve(task())
        } catch (error: Throwable) {
          promise.reject(E_LOG_FILE, error.javaClass.simpleName)
        }
      }
    } catch (error: Throwable) {
      // The executor is shut down (the bridge is going away).
      promise.reject(E_LOG_FILE, error.javaClass.simpleName)
    }
  }

  private fun logDir(): File? =
    reactApplicationContext.getExternalFilesDir(null)?.let { File(it, DIR_NAME) }

  private fun appendBatch(batch: List<String>) {
    if (batch.isEmpty()) {
      return
    }
    val dir = logDir() ?: throw IOException(NO_STORAGE)
    if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) {
      throw IOException(NO_DIR)
    }
    val text = StringBuilder()
    for (line in batch) {
      text.append(line).append('\n')
    }
    val bytes = text.toString().toByteArray(Charsets.UTF_8)
    val file = File(dir, FILE_NAME)
    val size = if (file.exists()) file.length() else 0L
    if (size > 0 && size + bytes.size > MAX_BYTES) {
      rotate(dir, file)
    }
    FileOutputStream(file, true).use { it.write(bytes) }
  }

  private fun rotate(dir: File, file: File) {
    val rotated = File(dir, ROTATED_NAME)
    if (rotated.exists() && !rotated.delete()) {
      throw IOException(NO_DELETE)
    }
    if (!file.renameTo(rotated)) {
      throw IOException(NO_RENAME)
    }
  }

  private fun clearFiles() {
    val dir = logDir() ?: return
    for (name in listOf(FILE_NAME, ROTATED_NAME)) {
      val file = File(dir, name)
      if (file.exists() && !(file.delete() && !file.exists())) {
        throw IOException(NO_DELETE)
      }
    }
  }

  companion object {
    const val NAME = "LogFile"
    private const val DIR_NAME = "logs"
    private const val FILE_NAME = "boostytv.log"
    private const val ROTATED_NAME = "boostytv.log.1"
    /** 256 KB per file; with the rotated copy at most 512 KB. */
    private const val MAX_BYTES = 256L * 1024L
    private const val E_LOG_FILE = "E_LOG_FILE"
    private const val NO_STORAGE = "no external files dir"
    private const val NO_DIR = "mkdirs failed"
    private const val NO_DELETE = "delete failed"
    private const val NO_RENAME = "rename failed"
  }
}
