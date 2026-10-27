package io.github.dzmitryafanasenka.boostytv

/**
 * Release builds: no network log (Story 4.1). The debug source set's
 * `DebugNetLog` installs the host/`Authorization` interceptor; here it does
 * nothing, so release has no interceptor and logs no request.
 */
object DebugNetLog {
  fun install() = Unit
}
