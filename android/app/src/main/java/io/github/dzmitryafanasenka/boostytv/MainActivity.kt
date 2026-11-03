package io.github.dzmitryafanasenka.boostytv

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "BoostyTV"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * Story 12.5: a launcher card (our preview channel) starts this activity
   * with its own intent; `LauncherChannelModule` keeps it for one
   * `takePendingOpen()`. A recreated activity (saved state) does not hand
   * its old intent over again.
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (savedInstanceState == null) {
      LauncherChannelModule.stash(intent)
    }
  }

  /** Story 12.5: a launcher card while the app runs (`singleTask`). */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    LauncherChannelModule.stash(intent)
  }

  /**
   * Hold-to-seek (Story 4.1): D-pad left/right key down (with repeats) and
   * key up go to the player first when it enabled `SeekKeysModule`; the event
   * is never consumed here.
   */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    SeekKeysModule.onKeyEvent(event)
    return super.dispatchKeyEvent(event)
  }
}
