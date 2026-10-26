package io.github.dzmitryafanasenka.boostytv

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

/**
 * App build facts for the UI (Story 2.4, «Настройки» › «Версия»). Exposes the
 * native `versionName` from the installed package as a constant, so JS reads
 * it synchronously. `PlatformConstants` does not carry it. Not a secret.
 */
class AppInfoModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  override fun getConstants(): Map<String, Any?> {
    val versionName =
      try {
        val context = reactApplicationContext
        context.packageManager.getPackageInfo(context.packageName, 0).versionName
      } catch (error: Exception) {
        null
      }
    return mapOf(VERSION_NAME to versionName)
  }

  companion object {
    const val NAME = "AppInfo"
    private const val VERSION_NAME = "versionName"
  }
}
