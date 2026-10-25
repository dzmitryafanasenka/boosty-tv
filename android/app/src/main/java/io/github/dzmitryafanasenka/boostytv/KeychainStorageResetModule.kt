package io.github.dzmitryafanasenka.boostytv

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * ADR 0006 storage-reset helper. Deletes react-native-keychain's DataStore file
 * (files/datastore/RN_KEYCHAIN.preferences_pb) and nothing else, so the library
 * can save again after file-level corruption (androidx CorruptionException).
 *
 * Depends on the private file name of react-native-keychain 10.0.0
 * (PrefsStorageBase.KEYCHAIN_DATA = "RN_KEYCHAIN", DataStore suffix
 * ".preferences_pb"). Re-run the ADR 0006 gate on every keychain update.
 * Never logs file contents.
 */
class KeychainStorageResetModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  /** Resolves true when the file no longer exists after the call. */
  @ReactMethod
  fun deleteKeychainStorage(promise: Promise) {
    try {
      val file = File(File(reactApplicationContext.filesDir, DATASTORE_DIR), FILE_NAME)
      if (file.exists()) {
        file.delete()
      }
      promise.resolve(!file.exists())
    } catch (error: Throwable) {
      promise.reject(E_DELETE_FAILED, error.javaClass.simpleName, error)
    }
  }

  companion object {
    const val NAME = "KeychainStorageReset"
    private const val DATASTORE_DIR = "datastore"
    private const val FILE_NAME = "RN_KEYCHAIN.preferences_pb"
    private const val E_DELETE_FAILED = "E_DELETE_FAILED"
  }
}
