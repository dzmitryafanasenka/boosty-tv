package io.github.dzmitryafanasenka.boostytv

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider

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
    // Story 1.6 spike only: the shared OkHttp client (JS fetch and
    // react-native-video) gets the host/auth-flag interceptor. The default
    // builder already sets ReactCookieJarContainer, which the player's
    // DataSourceUtil requires. No HTTP disk cache, so signed media responses
    // are not stored.
    OkHttpClientProvider.setOkHttpClientFactory(
      OkHttpClientFactory {
        OkHttpClientProvider.createClientBuilder()
          .addNetworkInterceptor(SpikeNetInterceptor())
          .build()
      },
    )
    loadReactNative(this)
  }
}
