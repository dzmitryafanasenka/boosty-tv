/**
 * Story 4.1: the network log that proves no `Authorization` header reaches a
 * CDN host is debug-only. Source-level guard: the interceptor lives in the
 * `debug` source set; the `release` one is a no-op with no interceptor and no
 * logging; `main` only calls `DebugNetLog.install()`. The log line carries the
 * host and a yes/no flag, never the URL, a query or a header value.
 */
const fs = require('fs');
const path = require('path');

const pkg = path.join('java', 'io', 'github', 'dzmitryafanasenka', 'boostytv');
const src = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', ...parts), 'utf8');

const debug = src('debug', pkg, 'DebugNetLog.kt');
const release = src('release', pkg, 'DebugNetLog.kt');
const main = src('main', pkg, 'MainApplication.kt');

describe('DebugNetLog (Story 4.1)', () => {
  it('debug: an interceptor on the shared OkHttp client that logs host and Authorization yes/no only', () => {
    expect(debug).toContain('OkHttpClientProvider.setOkHttpClientFactory');
    expect(debug).toContain('addNetworkInterceptor(HostAuthInterceptor())');
    expect(debug).toContain('request.url.host');
    expect(debug).toContain('request.header("Authorization") != null');
    const logged = debug.match(/Log\.i\(TAG, "[^"]*"\)/g) ?? [];
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).not.toMatch(/\$\{?(request\.url\b(?!\.host)|url\b|query|path|encodedPath)/);
    }
    expect(debug).not.toMatch(/encodedPath|\.query\b|queryParameter|header\("Authorization"\)(?! != null)/);
  });

  it('release: a no-op with no interceptor and no logging', () => {
    expect(release).toMatch(/fun install\(\) = Unit/);
    expect(release).not.toMatch(/Interceptor|Log\.|OkHttp/);
  });

  it('main calls install() and never names the interceptor', () => {
    expect(main).toContain('DebugNetLog.install()');
    expect(main).not.toMatch(/HostAuthInterceptor|Interceptor/);
  });
});
