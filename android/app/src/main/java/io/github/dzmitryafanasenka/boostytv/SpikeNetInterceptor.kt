package io.github.dzmitryafanasenka.boostytv

import android.util.Log
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Story 1.6 spike only (branch spike/1-6-playback). A network interceptor on
 * the shared React Native OkHttp client, which serves both JS `fetch` and
 * react-native-video's OkHttpDataSource. For each request it logs the host,
 * whether an `Authorization` or `Cookie` header is present, and the HTTP
 * status, under the `SpikeNet` tag.
 *
 * It never logs paths, queries, header values or bodies: signed CDN URLs
 * carry their signature in the path and the query.
 */
class SpikeNetInterceptor : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request()
    val host = request.url.host
    val auth = request.header("Authorization") != null
    val cookie = request.header("Cookie") != null
    // Header names only (never values), sorted, for the CDN 400 diagnosis.
    val names = request.headers.names().sorted().joinToString(",")
    // Signed-URL diagnosis: does the connected edge IP equal the `urls`
    // query value, or the `srcIp` one? Flags only, never the addresses.
    val remote = chain.connection()?.socket()?.inetAddress?.hostAddress
    val urlsParam = request.url.queryParameter("urls")
    val edge =
      if (urlsParam == null) "-"
      else "urlsMatch=${urlsParam.split(',', ';').any { it == remote }} " +
        "urlsParts=${urlsParam.split(',', ';').size} " +
        "urlsEqSrcIp=${urlsParam == request.url.queryParameter("srcIp")} " +
        "urlsSame24=${urlsParam.substringBeforeLast('.') == remote?.substringBeforeLast('.')} " +
        "remoteKind=${if (remote == null) "none" else if (remote.contains(':')) "v6" else "v4"}"
    val response =
      try {
        chain.proceed(request)
      } catch (error: Exception) {
        Log.i(TAG, "net host=$host auth=$auth cookie=$cookie error=${error.javaClass.simpleName}")
        throw error
      }
    Log.i(
      TAG,
      "net host=$host auth=$auth cookie=$cookie status=${response.code} " +
        "proto=${response.protocol} headers=[$names] $edge",
    )
    return response
  }

  private companion object {
    const val TAG = "SpikeNet"
  }
}
