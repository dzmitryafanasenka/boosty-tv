/**
 * Story 12.5: source-level guard for the native launcher channel
 * (`LauncherChannelModule.kt`, `MainActivity.kt`, the manifest). No JVM unit
 * tests run here, so this pins what the JS side and the spec rely on:
 * registration, one preview channel found by its internal provider id and
 * never deleted, programs replaced (new first, then the old ones), API 26+
 * only, one serial thread, explicit-component intents with our own action
 * (no VIEW filter, no URL scheme), the pending open stashed from the launch
 * intent and `onNewIntent`, nothing logged and rejections carrying a class
 * name only. Aero TV's behaviour is a device check (docs/testing.md).
 */
const fs = require('fs');
const path = require('path');

const pkg = path.join('java', 'io', 'github', 'dzmitryafanasenka', 'boostytv');
const main = path.join(__dirname, '..', 'android', 'app', 'src', 'main');
const read = (...parts) => fs.readFileSync(path.join(main, ...parts), 'utf8');

const module_ = read(pkg, 'LauncherChannelModule.kt');
const activity = read(pkg, 'MainActivity.kt');
const nativePackage = read(pkg, 'BoostyNativePackage.kt');
const manifest = read('AndroidManifest.xml');

describe('LauncherChannelModule (Story 12.5)', () => {
  it('is registered as `LauncherChannel` with sync and takePendingOpen', () => {
    expect(nativePackage).toContain('LauncherChannelModule(reactContext)');
    expect(module_).toContain('const val NAME = "LauncherChannel"');
    expect(module_).toContain('fun sync(channelName: String, cards: ReadableArray, promise: Promise)');
    expect(module_).toContain('fun takePendingOpen(promise: Promise)');
  });

  it('API 26+ only, on one serial thread', () => {
    expect(module_).toMatch(/if \(Build\.VERSION\.SDK_INT < Build\.VERSION_CODES\.O\) \{\s*promise\.resolve\(OUTCOME_UNSUPPORTED\)/);
    expect(module_).toContain('Executors.newSingleThreadExecutor()');
    expect(module_).toContain('executor.execute');
  });

  it('one preview channel found by its internal provider id; created once, never deleted; no browsable request', () => {
    expect(module_).toContain('TvContract.Channels.TYPE_PREVIEW');
    expect(module_).toContain('TvContract.Channels.COLUMN_INTERNAL_PROVIDER_ID');
    expect(module_).toContain('CHANNEL_PROVIDER_ID = "continue"');
    expect(module_).toContain('resolver.insert(TvContract.Channels.CONTENT_URI, values)');
    expect(module_).not.toMatch(/delete\(\s*TvContract\.(buildChannelUri|Channels\.CONTENT_URI)/);
    expect(module_).not.toContain('requestChannelBrowsable');
    // The channel row is written only when its name or app link differ.
    expect(module_).toMatch(/if \(stale\) \{\s*resolver\.update\(TvContract\.buildChannelUri\(existing\), values, null, null\)/);
    expect(module_).toContain('cursor.getString(2) != channelName || cursor.getString(3) != appLink');
    expect(module_).not.toMatch(/WatchNext/);
  });

  it('programs are replaced: every new one inserted (a null insert throws), then the old ones deleted; a failure undoes the new ones and keeps the old', () => {
    const insert = module_.indexOf('resolver.insert(TvContract.PreviewPrograms.CONTENT_URI, values)');
    expect(insert).toBeGreaterThan(0);
    expect(module_).toMatch(/resolver\.insert\(TvContract\.PreviewPrograms\.CONTENT_URI, values\)\s*\?: throw IllegalStateException\("program insert"\)\s*inserted\.add\(ContentUris\.parseId\(uri\)\)/);
    // On a failure: delete the inserted ids, rethrow (the promise rejects), never reach the old ids.
    expect(module_).toMatch(/\} catch \(error: Throwable\) \{\s*for \(id in inserted\) \{[\s\S]{0,200}resolver\.delete\(TvContract\.buildPreviewProgramUri\(id\), null, null\)[\s\S]{0,200}throw error\s*\}\s*for \(id in old\) \{\s*resolver\.delete\(TvContract\.buildPreviewProgramUri\(id\), null, null\)/);
    for (const column of ['COLUMN_TITLE', 'COLUMN_SHORT_DESCRIPTION', 'COLUMN_POSTER_ART_URI', 'COLUMN_INTENT_URI', 'COLUMN_WEIGHT']) {
      expect(module_).toContain(`TvContract.PreviewPrograms.${column}`);
    }
    // No poster: the app banner.
    expect(module_).toContain('card.posterUrl ?: banner');
    expect(module_).toContain('/drawable/tv_banner');
  });

  it('card and channel intents: explicit MainActivity component with our action and string extras', () => {
    expect(module_).toContain('Intent(context, MainActivity::class.java)');
    expect(module_).toContain('ACTION_OPEN = "io.github.dzmitryafanasenka.boostytv.action.OPEN_FROM_LAUNCHER"');
    expect(module_).toContain('TvContract.Channels.COLUMN_APP_LINK_INTENT_URI');
    expect(module_).toContain('toUri(Intent.URI_INTENT_SCHEME)');
    expect(module_).not.toMatch(/Intent\.ACTION_VIEW|Uri\.parse/);
  });

  it('the pending open: ours by action only, launches from recents ignored, read once', () => {
    expect(module_).toMatch(/intent\.action != ACTION_OPEN/);
    expect(module_).toContain('FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY');
    expect(module_).toContain('private val pending = AtomicReference<PendingOpen?>(null)');
    expect(module_).toContain('pending.getAndSet(null)');
    expect(module_).toContain('pending.set(');
    expect(module_).not.toMatch(/@Volatile/);
  });

  it('MainActivity stashes the launch intent (not on recreation) and onNewIntent after setIntent', () => {
    expect(activity).toMatch(/if \(savedInstanceState == null\) \{\s*LauncherChannelModule\.stash\(intent\)/);
    expect(activity).toMatch(/override fun onNewIntent\(intent: Intent\) \{\s*super\.onNewIntent\(intent\)\s*setIntent\(intent\)\s*LauncherChannelModule\.stash\(intent\)/);
  });

  it('logs nothing; rejections carry the class name only', () => {
    expect(module_).not.toMatch(/\bLog\.[dviwe]\(|println\(/);
    expect(module_).not.toMatch(/reject\([^)]*message/);
    expect(module_).toMatch(/reject\(E_LAUNCHER_CHANNEL, error\.javaClass\.simpleName\)/);
  });

  it('the manifest: WRITE_EPG_DATA; no new intent-filter (only MAIN/LAUNCHER), no URL scheme', () => {
    expect(manifest).toContain('<uses-permission android:name="com.android.providers.tv.permission.WRITE_EPG_DATA" />');
    expect(manifest.match(/<intent-filter>/g)).toHaveLength(1);
    const filter = manifest.slice(manifest.indexOf('<intent-filter>'), manifest.indexOf('</intent-filter>'));
    expect(filter).not.toContain('<data');
    expect(filter).not.toContain('android.intent.action.VIEW');
  });
});
