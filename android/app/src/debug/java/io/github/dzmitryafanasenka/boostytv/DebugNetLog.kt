package io.github.dzmitryafanasenka.boostytv

import android.util.Log
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Debug builds only (Story 4.1; the `debug` source set, absent from release,
 * whose `DebugNetLog` is a no-op). Installs a network interceptor on React
 * Native's shared OkHttp client, which serves both JS `fetch` and
 * react-native-video's data source, and logs one line per request under the
 * `BoostyNet` tag: the host, whether an `Authorization` and a `Cookie` header are present (yes/no, never values),
 * and the HTTP status. It proves that no Boosty token reaches a CDN host.
 *
 * It never logs a path, a query, a header value or a body: signed CDN URLs
 * carry their signature there.
 */
object DebugNetLog {
  private const val TAG = "BoostyNet"

  fun install() {
    OkHttpClientProvider.setOkHttpClientFactory(
      OkHttpClientFactory {
        // The default builder keeps ReactCookieJarContainer, which the
        // player's data source requires (the CDN sets its own cookie).
        OkHttpClientProvider.createClientBuilder()
          .addNetworkInterceptor(HostAuthInterceptor())
          .build()
      },
    )
  }

  private class HostAuthInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
      val request = chain.request()
      val host = request.url.host
      val auth = if (request.header("Authorization") != null) "yes" else "no"
      val cookie = if (request.header("Cookie") != null) "yes" else "no"
      val response =
        try {
          chain.proceed(request)
        } catch (error: Exception) {
          Log.i(TAG, "net host=$host authorization=$auth cookie=$cookie error=${error.javaClass.simpleName}")
          throw error
        }
      Log.i(TAG, "net host=$host authorization=$auth cookie=$cookie status=${response.code}")
      return response
    }
  }
}
