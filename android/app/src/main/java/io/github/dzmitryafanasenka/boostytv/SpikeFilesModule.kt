package io.github.dzmitryafanasenka.boostytv

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Story 1.5 spike only: writes already-sanitized fixture files to the app's
 * external files directory (`files/fixtures`) so they can be pulled with adb,
 * and clears that directory. JS passes only sanitizer output; this module
 * never receives raw response bodies.
 */
class SpikeFilesModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  private fun dir(): File? = reactApplicationContext.getExternalFilesDir(DIR)

  @ReactMethod
  fun write(name: String, text: String, promise: Promise) {
    try {
      if (!SAFE_NAME.matches(name)) {
        promise.reject(E_SPIKE_FILES, "Invalid file name")
        return
      }
      val target = dir() ?: run {
        promise.reject(E_SPIKE_FILES, "No external files directory")
        return
      }
      target.mkdirs()
      File(target, name).writeText(text, Charsets.UTF_8)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject(E_SPIKE_FILES, error.javaClass.simpleName, error)
    }
  }

  @ReactMethod
  fun clear(promise: Promise) {
    try {
      val target = dir()
      var deleted = 0
      target?.listFiles()?.forEach { if (it.isFile && it.delete()) deleted += 1 }
      promise.resolve(deleted)
    } catch (error: Throwable) {
      promise.reject(E_SPIKE_FILES, error.javaClass.simpleName, error)
    }
  }

  companion object {
    const val NAME = "SpikeFiles"
    private const val DIR = "fixtures"
    private const val E_SPIKE_FILES = "E_SPIKE_FILES"
    private val SAFE_NAME = Regex("^[a-z0-9-]{1,60}\\.json$")
  }
}
