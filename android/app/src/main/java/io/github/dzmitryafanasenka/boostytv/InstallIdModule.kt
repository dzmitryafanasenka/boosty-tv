package io.github.dzmitryafanasenka.boostytv

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.UUID

/**
 * Install-scoped `device_id` (docs/api-contract.md §1, epic 2 "AccountScope":
 * device-scoped). A UUIDv4 is generated once per install and kept in
 * non-secret SharedPreferences. It is not a credential, survives sign-out and
 * is not cleared by the keychain storage reset. Ported from the Story 1.3
 * spike; the same preferences file and key, so the spike install keeps its id.
 */
class InstallIdModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun getOrCreate(promise: Promise) {
    try {
      val prefs = reactApplicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val existing = prefs.getString(KEY, null)
      if (existing != null) {
        promise.resolve(existing)
        return
      }
      val created = UUID.randomUUID().toString()
      if (!prefs.edit().putString(KEY, created).commit()) {
        promise.reject(E_INSTALL_ID, "commit failed")
        return
      }
      promise.resolve(created)
    } catch (error: Throwable) {
      // Class name only: the message is not needed and never logged.
      promise.reject(E_INSTALL_ID, error.javaClass.simpleName, error)
    }
  }

  companion object {
    const val NAME = "InstallId"
    private const val PREFS = "boostytv_install"
    private const val KEY = "device_id"
    private const val E_INSTALL_ID = "E_INSTALL_ID"
  }
}
