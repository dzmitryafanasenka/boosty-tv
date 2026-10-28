package io.github.dzmitryafanasenka.boostytv

import android.content.pm.ApplicationInfo
import android.util.Log
import android.view.KeyEvent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.lang.ref.WeakReference

/**
 * Hold-to-seek for the player (Story 4.1, owner decision) and hold-to-step
 * for the custom-period stepper (Story 5.4, owner decision). React Native
 * delivers D-pad arrows to JS only as key up on the pinned remote, so a held
 * key is invisible there. While a subscriber enables it, `MainActivity`
 * forwards every D-pad LEFT/RIGHT/UP/DOWN key down (with Android's
 * `repeatCount`) and key up as the `seekKey` device event `{key, action,
 * repeat}`. The event is not consumed: native focus handling is unchanged.
 *
 * Debuggable builds log one line per forwarded key under `BoostySeekKeys`
 * (key, action, repeat count; no content), for the device measurement.
 */
class SeekKeysModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  init {
    instance = WeakReference(this)
  }

  override fun getName(): String = NAME

  /** On while a subscriber (the player, the period stepper) listens, off otherwise. */
  @ReactMethod
  fun setEnabled(value: Boolean) {
    enabled = value
  }

  @ReactMethod fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) = Unit

  @ReactMethod fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Double) = Unit

  companion object {
    const val NAME = "SeekKeys"
    private const val EVENT = "seekKey"
    private const val TAG = "BoostySeekKeys"

    @Volatile private var enabled = false
    private var instance: WeakReference<SeekKeysModule>? = null

    /** Called by `MainActivity.dispatchKeyEvent` for every key event. */
    fun onKeyEvent(event: KeyEvent) {
      if (!enabled) {
        return
      }
      val key =
        when (event.keyCode) {
          KeyEvent.KEYCODE_DPAD_LEFT -> "left"
          KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
          KeyEvent.KEYCODE_DPAD_UP -> "up"
          KeyEvent.KEYCODE_DPAD_DOWN -> "down"
          else -> return
        }
      val action =
        when (event.action) {
          KeyEvent.ACTION_DOWN -> "down"
          KeyEvent.ACTION_UP -> "up"
          else -> return
        }
      val module = instance?.get() ?: return
      val context = module.reactApplicationContext
      if ((context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
        Log.d(TAG, "key=$key action=$action repeat=${event.repeatCount}")
      }
      if (!context.hasActiveReactInstance()) {
        return
      }
      context.emitDeviceEvent(
        EVENT,
        Arguments.createMap().apply {
          putString("key", key)
          putString("action", action)
          putInt("repeat", event.repeatCount)
        },
      )
    }
  }
}
