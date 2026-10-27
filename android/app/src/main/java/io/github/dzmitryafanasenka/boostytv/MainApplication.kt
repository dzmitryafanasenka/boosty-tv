package io.github.dzmitryafanasenka.boostytv

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(BoostyNativePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Debug builds: log host + Authorization yes/no per request (Story 4.1,
    // the CDN header check). Release: a no-op (src/release).
    DebugNetLog.install()
    loadReactNative(this)
  }
}
