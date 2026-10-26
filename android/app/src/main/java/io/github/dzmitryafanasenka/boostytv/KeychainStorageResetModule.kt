package io.github.dzmitryafanasenka.boostytv

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * ADR 0006 storage-reset helper. Deletes react-native-keychain's DataStore file
 * (`files/datastore/RN_KEYCHAIN.preferences_pb`) and a leftover `.tmp` copy, and
 * nothing else, so the library can save again after file-level corruption
 * (androidx `CorruptionException`). Ported from the Story 1.3 spike, with the
 * ADR 0006 production fixes: the result of `File.delete()` is checked, the
 * `.tmp` file is removed too, and a failure carries a non-sensitive reason.
 *
 * Depends on the private file name of react-native-keychain 10.0.0
 * (`PrefsStorageBase.KEYCHAIN_DATA = "RN_KEYCHAIN"`, DataStore suffix
 * `.preferences_pb`). The library is pinned; re-run the ADR 0006 gate on every
 * keychain update. Never reads or logs file contents. The install `device_id`
 * (InstallIdModule, SharedPreferences) is not touched.
 */
class KeychainStorageResetModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  /**
   * Resolves true when neither file exists after the call. Rejects with
   * `E_DELETE_FAILED` and a fixed reason when a file could not be deleted.
   */
  @ReactMethod
  fun deleteKeychainStorage(promise: Promise) {
    try {
      val dir = File(reactApplicationContext.filesDir, DATASTORE_DIR)
      val undeleted = listOf(FILE_NAME, "$FILE_NAME$TMP_SUFFIX").count { name ->
        val file = File(dir, name)
        file.exists() && !(file.delete() && !file.exists())
      }
      if (undeleted > 0) {
        promise.reject(E_DELETE_FAILED, "delete returned false")
        return
      }
      promise.resolve(true)
    } catch (error: Throwable) {
      // Class name only: the message may carry a path and is not needed.
      promise.reject(E_DELETE_FAILED, error.javaClass.simpleName, error)
    }
  }

  companion object {
    const val NAME = "KeychainStorageReset"
    private const val DATASTORE_DIR = "datastore"
    private const val FILE_NAME = "RN_KEYCHAIN.preferences_pb"
    private const val TMP_SUFFIX = ".tmp"
    private const val E_DELETE_FAILED = "E_DELETE_FAILED"
  }
}
