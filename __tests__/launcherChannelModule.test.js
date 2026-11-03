/**
 * Story 12.5: source-level guard for the native launcher channel
 * (`LauncherChannelModule.kt`, `MainActivity.kt`, the manifest). No JVM unit
 * tests run here, so this pins what the JS side and the spec rely on:
 * registration, one preview channel found by its internal provider id and
 * never deleted, programs replaced (new first, then the old ones), API 26+
 * only, one serial thread, the `boostytv://continue` / `boostytv://home`
 * card links and the one VIEW filter for them (Aero TV fires a program's
 * VIEW link, not an explicit-component intent), the pending open stashed
 * from the launch intent and `onNewIntent`, nothing logged and rejections carrying a class
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

  it('card and channel links: boostytv://continue?blogUrl&postId&mediaId (encoded by Uri.Builder) and boostytv://home', () => {
    expect(module_).toContain('LINK_SCHEME = "boostytv"');
    expect(module_).toContain('HOST_CONTINUE = "continue"');
    expect(module_).toContain('HOST_HOME = "home"');
    expect(module_).toMatch(/Uri\.Builder\(\)\.scheme\(LINK_SCHEME\)\.authority\(HOST_HOME\)/);
    expect(module_).toMatch(
      /\.authority\(HOST_CONTINUE\)\s*\.appendQueryParameter\(KEY_BLOG_URL, media\.blogUrl\)\s*\.appendQueryParameter\(KEY_POST_ID, media\.postId\)\s*\.appendQueryParameter\(KEY_MEDIA_ID, media\.mediaId\)/,
    );
    expect(module_).toContain('TvContract.PreviewPrograms.COLUMN_INTENT_URI,\n            openLink(card.open),');
    expect(module_).toContain('TvContract.Channels.COLUMN_APP_LINK_INTENT_URI,\n          openLink(null),');
    // The old explicit-component path is gone.
    expect(module_).not.toMatch(/ACTION_OPEN|OPEN_FROM_LAUNCHER|MainActivity::class|URI_INTENT_SCHEME|putExtra/);
  });

  it('the pending open: VIEW + boostytv only; continue with 3 non-empty params → media, else Главная; non-VIEW clears; recents ignored; read once', () => {
    expect(module_).toMatch(/intent\.action != Intent\.ACTION_VIEW \|\|\s*data == null \|\|\s*data\.scheme != LINK_SCHEME \|\|/);
    expect(module_).toContain('FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY');
    expect(module_).toMatch(/\) \{\s*\/\/ The tile, recents, or anything that is not our link\.\s*null\s*\} else if \(data\.host == HOST_CONTINUE\)/);
    expect(module_).toMatch(
      /if \(!blogUrl\.isNullOrEmpty\(\) && !postId\.isNullOrEmpty\(\) && !mediaId\.isNullOrEmpty\(\)\) \{\s*PendingOpen\.Media\(blogUrl, postId, mediaId\)\s*\} else \{\s*PendingOpen\.Home/,
    );
    expect(module_).toMatch(/\/\/ `boostytv:\/\/home`, or a host we do not know: Главная\.\s*PendingOpen\.Home/);
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

  it('the manifest: WRITE_EPG_DATA; MAIN/LAUNCHER plus one VIEW filter for boostytv://continue and boostytv://home only', () => {
    expect(manifest).toContain('<uses-permission android:name="com.android.providers.tv.permission.WRITE_EPG_DATA" />');
    const filters = manifest.split('<intent-filter>').slice(1).map(f => f.slice(0, f.indexOf('</intent-filter>')));
    expect(filters).toHaveLength(2);
    expect(filters[0]).toContain('android.intent.category.LEANBACK_LAUNCHER');
    expect(filters[0]).not.toContain('<data');
    const view = filters[1];
    expect(view).toContain('<action android:name="android.intent.action.VIEW" />');
    expect(view).toContain('<category android:name="android.intent.category.DEFAULT" />');
    expect(view).toContain('<category android:name="android.intent.category.BROWSABLE" />');
    expect(view.match(/<data [^>]*>/g)).toEqual([
      '<data android:scheme="boostytv" android:host="continue" />',
      '<data android:scheme="boostytv" android:host="home" />',
    ]);
    expect(view).not.toMatch(/pathPrefix|pathPattern|android:path=|autoVerify|https?"/);
  });
});
