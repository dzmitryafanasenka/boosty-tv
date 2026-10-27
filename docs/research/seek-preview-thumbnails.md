# Seek preview thumbnails ("YouTube-like" scrubbing) — research

Date: 2026-10-27. Scope: research only. Nothing in `src/` or `android/` was changed.

Question: can the player show a preview frame of the target moment above the timeline thumb while the user scrubs a Boosty `ok_video`, on react-native-video 6.19.3 (Media3 1.8.0) on the Chromecast with Google TV 4K?

Labels: **LIVE** = observed in this research (request, artifact or device); **DOC** = primary documentation or source code, linked; **INFERRED** = reasoning from LIVE/DOC facts, not observed.

Status: this is **our improvement**, not a parity obligation. BoostBuddy has no seek previews (`docs/feature-parity.md` PLAY-05: 5 s D-pad seek, scrub bar, time text).

## Verdict

- **No ready-made thumbnails exist for Boosty videos.** The manifests carry no thumbnail or trick-play track (LIVE). Boosty's API does not expose OK's storyboard sprite (LIVE). Boosty's own website player does not show timeline previews either (from its code; see §2.3).
- Media3 1.8.0 could render DASH thumbnail tracks. react-native-video exposes none of it, and Boosty has no such track to render, so this path is **not feasible**.
- The only feasible path is to **generate previews on the device** from the lowest rendition that `playerUrls` already gives us. Our recommended spike is a second, muted, low-resolution ExoPlayer in its own small native view. It needs a custom native component and has unproven cost on the Chromecast. Adopt it only after a device spike passes measurable thresholds (§5).
- The YouTube-like seek UX without images (§6) is cheap and independent. Most of it is already built: the pending target, OK to commit, Back to cancel and the growing steps (`docs/focus-map.md` Player, `seekController.ts`).

## 1. Manifests (question 1)

**Method (LIVE, 2026-10-27).** We picked two free, publicly accessible posts with an `ok_video`: `nemagia` post `700da671-…` (2,069 s) and `zhivoygvozd` post `687d7f11-…` (3,512 s). We fetched them **anonymously** from the Mac with E8 (`?comments_limit=0&reply_limit=0`, content-profile mobile Android Chrome UA, no `Authorization`). We used no owner credentials and no device session.

The signed `hls` and `dash` URLs were fetched once, in memory, with an ExoPlayer-like UA and no Boosty headers. Only structure was printed; no manifest was written to disk. The URLs came out with `srcAg=CHROME_ANDROID` and were bound to the Mac's IP, as ADR 0008 predicts. The E8 `ok_video` key set was identical to the one in `api-contract.md` §3 (same 20 keys).

| Check | Result | Label |
|---|---|---|
| HLS master: tags | Only `#EXTM3U` and `#EXT-X-STREAM-INF` (6 variants, 144p–1080p, `QUALITY=`/`FRAME-RATE=` attributes). **No `EXT-X-IMAGE-STREAM-INF`, no `EXT-X-I-FRAME-STREAM-INF`, no `EXT-X-MEDIA`** (so no subtitle or WebVTT rendition either) | LIVE (both posts) |
| HLS media playlist | `EXT-X-VERSION:3`, `EXT-X-TARGETDURATION:13`, `EXTINF` 9–12 s TS segments, `EXT-X-ENDLIST`. **No `EXT-X-IMAGES-ONLY`, no `EXT-X-I-FRAMES-ONLY`, no `EXT-X-BYTERANGE`** | LIVE |
| DASH MPD | `isoff-on-demand:2011` profile, static, one Period, `SegmentBase` + `indexRange`. Two AdaptationSets: video (`video/mp4`, AVC, 144p–1080p) and audio (`audio/mp4`, AAC). **No `contentType="image"`, no `image/jpeg` mimeType, no `EssentialProperty` (`thumbnail_tile`), no trick-mode** | LIVE (both posts) |
| WebVTT thumbnail track | None. The DASH and HLS manifests reference no text or VTT, and E8 has no field for one | LIVE |
| DASH 144p `sidx` | 138 subsegments of ~15 s (13.6–15.0 s), each starting with a SAP (`subsegmentStartsWithSAP="1"`), 87–483 KB (avg 180 KB) | LIVE (`nemagia`) |
| Progressive `tiny` (144p MP4) | `Accept-Ranges: bytes`, `ftyp` then `moov` first ("faststart"); `moov` is ~2.5 MB for a 35 MB file; 690 sync samples over 2,069 s (a keyframe about every 3 s) | LIVE (`nemagia`) |

Security finding for redaction rules (LIVE): HLS master variant URIs carry the signature as **path segments**, not as a query: `/expires/<signed>/srcIp/<signed>/…/sig/<signed>/…/id/<signed>/video/`. A redactor that strips only `?query` leaks the signature, the client IP and the CDN id. Any diagnostic that might print an HLS variant URI must redact the whole path.

Not checked: a post fetched with the owner's session (paid posts). OK serves both free and paid Boosty videos from the same `okcdn.ru` pipeline (same `playerUrls` types and key set), so we expect the same manifest shape (INFERRED).

## 2. OK and Boosty player metadata (question 2)

### 2.1 OK has storyboards for its own public videos (LIVE)

The public OK embed page (`https://ok.ru/videoembed/<movieId>`, anonymous) embeds player `metadata` with `movie.collageInfo`:

`{imageType: "COLLAGE", url: <iv.okcdn.ru signed: id, idx, tkn, type[, scl]>, frequency: 5|10, width: 80, height: 44, count: 103–136, tileWidth: 40, tileHeight: 3–4}`

We checked three public OK videos. Their collage images return HTTP 200 `image/jpeg`, 150–190 KB. That is one frame every 5–10 s, **80×44 px per frame**, in 40×N grids. The `tkn` is a server-issued token, so the URL cannot be built from a video id.

### 2.2 Boosty videos are not reachable through OK's public metadata (LIVE)

- `ok_video.vid` is a 13-character string. `ok.ru/videoembed/<vid>` returns OK's stub page (`vp_video_stub __na`) with no `data-options` and no metadata.
- `vid` is also not the id that appears in the CDN paths.
- E8 has no `collageInfo` or equivalent field (`api-contract.md` §3).
- No public, unauthenticated route to a Boosty video's collage was found. Building one would mean inventing an endpoint or token, which `CLAUDE.md` forbids.

Even if it were available, 80×44 px upscaled to a TV preview of ~320×180 would be visibly blurry (INFERRED).

### 2.3 Boosty's website player has no timeline previews (from code)

We read the public bundle `static.boosty.to/js/app.*.js` and its lazy chunks, fetched anonymously.

- The website embeds VK's player web component (`vk-video-player`, `registerPlayerWebComponent` from `vendor.*.js`).
- That player supports timeline previews through a per-video `previewThumbsData` (`links`, `countPerImage`, `countPerRow`, `countTotal`, `frameWidth`, `frameHeight`, `frequency`, `isUV`). It renders them as `.timeline-preview`.
- Boosty calls `initPlayer({videos: [{sources, title, thumbUrl, unitedVideoId, duration}], failoverHosts, fromTime, …})`. **It never passes `previewThumbsData`.** The `sources` are built from `playerUrls` only (`MPEG` 144p–2160p, `DASH_SEP`, `HLS`, live variants).

Not observed in a browser. We did not open the site in the owner's browser to avoid touching their signed-in session. A one-minute visual check on any free post would confirm it.

## 3. Engine support (question 3)

| Item | Finding | Label |
|---|---|---|
| Media3 version | react-native-video 6.19.3 pins `RNVideo_media3Version=1.8.0` (`node_modules/react-native-video/android/gradle.properties`); the app does not override it. Modules: exoplayer, dash, hls, smoothstreaming, okhttp datasource, ui | LIVE |
| DASH thumbnails | Since Media3 1.3.0: "Add support for DASH thumbnails. Grid images are cropped and individual thumbnails are provided to `ImageOutput` close to their presentation times". It adds `ExoPlayer.setImageOutput` and `DefaultTrackSelector` image-track selection. Non-square grids since 1.4.0. The 1.8.0 jars contain `exoplayer/image/ImageRenderer`, `ImageOutput`, `DefaultTrackSelector.selectImageTrack`, and `DashManifestParser` handles `thumbnail_tile`/`tileCountHorizontal`/`tileCountVertical` | DOC ([RELEASENOTES](https://github.com/androidx/media/blob/release/RELEASENOTES.md)), LIVE (class inspection) |
| HLS image playlists | The 1.8.0 `HlsPlaylistParser` knows `EXT-X-I-FRAME-STREAM-INF` and `EXT-X-I-FRAMES-ONLY`, but **not** `EXT-X-IMAGE-STREAM-INF`/`EXT-X-IMAGES-ONLY` (no such strings in the class) | LIVE (class inspection) |
| Scrubbing mode | `ExoPlayer.setScrubbingModeEnabled(boolean)` and `ScrubbingModeParameters` were added in 1.8.0. The release note: "optimizes the player for many frequent seeks (for example, from a user dragging a scrubber bar around)". It uses `MediaCodec` decode-only buffers and a higher codec operating rate. Present in the 1.8.0 jar. Later fixes: 1.9.0 (stuck on a DASH thumbnail track while scrubbing), 1.10.1 (image updates in scrubbing mode) | DOC (RELEASENOTES), LIVE (jar) |
| react-native-video exposure | **None.** Its Android sources have no `setImageOutput`, image track, thumbnail, `setScrubbingModeEnabled` or `SeekParameters` reference. `ReactExoplayerView` builds its own `DefaultRenderersFactory`. The JS API has no thumbnail or scrubbing prop | LIVE (grep of `node_modules/react-native-video/android/src` and `src`) |

Conclusion: even with a thumbnail track, using it would need a native patch or fork of react-native-video. Without a track there is nothing to render.

## 4. Fallbacks: generate previews on the device (question 4)

Device facts (LIVE, `adb shell getprop`/`/proc`, read-only):

- Model `Chromecast`, board `sabrina` (Amlogic), Android 14 (SDK 34).
- 4 CPU cores, max 1.908 GHz, 1.98 GB RAM.
- The vendor `media_codecs_amlogic_video.xml` declares `c2.amlogic.avc.decoder` with `concurrent-instances max=9` and `blocks-per-second` up to 1,036,800. That is a declaration, not proof of real parallel throughput.

### A. Second muted low-resolution ExoPlayer (recommended spike)

- **How.** A dedicated native view (Kotlin, our own ViewManager/Fabric component, not react-native-video) owns a second ExoPlayer. It plays the lowest DASH video representation (144p/240p from the same `dash` URL; the MPD's audio set can be disabled) or the `tiny` progressive URL. It renders into a small `TextureView`/`SurfaceView` placed above the timeline thumb.
- **Seeking.** The preview player stays paused. Each pending target change does `seekTo` with `SeekParameters.CLOSEST_SYNC` or `PREVIOUS_SYNC`, with scrubbing mode on, debounced (for example ≥150–200 ms, the same cadence as the native hold-repeat, 200 ms).
- **Granularity.** One keyframe every ~3 s (`tiny`) or every ~15 s subsegment (DASH 144p, possibly denser inside) (LIVE §1), which is ample for a preview.
- **Inputs.** The URL comes from the same in-memory E8 already resolved for playback (same client, `srcAg`); it is never persisted and gets no Boosty headers. The CDN cookie works as for the main player.
- **Cost.** A new native module and view, focus-free and non-interactive; lifecycle (create on the first scrub of a session, release on player exit, background or error); a JS bridge for `setTarget(ms)`/`onFrameReady`; error mapping (any error just hides the preview, it never re-resolves on its own); tests. Plus the device spike in §5. It touches `PlayerEngineView`'s neighbourhood but not react-native-video.
- **Risks on the Chromecast (INFERRED, unmeasured).**
  - Two AVC decoders at once (1080p main + 144p preview): the declared limit allows it, but Amlogic decode bandwidth and memory under 2 GB may cause main-playback frame drops. The main player already hit a decoder failure at 1440p once (`api-contract.md` §6).
  - Extra network: each seek fetches a partial segment (DASH 144p avg 180 KB per 15 s). Rapid holds can queue many requests; the debounce is mandatory.
  - Latency: a cold seek costs a CDN round trip plus a decode, likely hundreds of ms. Previews may lag the bubble during fast holds, so show the frame only when it matches the current target.
  - Live (`ok_stream`) has no seek and no preview.

### B. `MediaMetadataRetriever` on the `tiny` progressive URL

- `setDataSource(url, headers)` plus `getScaledFrameAtTime(us, OPTION_CLOSEST_SYNC, w, h)` (API 27+) ([DOC](https://developer.android.com/reference/android/media/MediaMetadataRetriever)).
- **Pros.** No surface needed, and output is a `Bitmap` that RN can show.
- **Cons.**
  - It uses the platform media HTTP stack, not our OkHttp client or cookie jar, and its UA differs. Story 1.6 showed no-UA probes get 200 and a desktop UA gets 400 on `CHROME_ANDROID` URLs, but the platform UA is untested (unverified).
  - It must read the ~2.5 MB `moov` before the first frame (LIVE size).
  - Each call blocks a thread and is known to be slow over HTTP (seconds per frame is common; INFERRED, not measured here).
  - There is no cancellation of an in-flight frame.
- Worse than A for interactive scrubbing. It may suit the pre-generation in C.

### C. Background sprite pre-generation (later option)

- **How.** After playback starts, a low-priority native worker reads the DASH 144p `sidx` (LIVE: SAP at every ~15 s subsegment). It range-fetches only the first keyframe of each subsegment and decodes it with `MediaExtractor`/`MediaCodec` (or B). Frames go into a memory-only cache keyed by `mediaId`, covering about 138 frames for a 35-minute video.
- **Pros.** Instant previews once built, and no work during the scrub itself.
- **Cons.**
  - The most native code of all options.
  - CPU and network compete with the main playback on a weak device.
  - The cache must be account-scoped and wiped on logout like other sensitive caches (`CLAUDE.md`).
  - Gives ~15 s granularity.
- Consider it only if A's latency fails and B is too slow.

### D. Seek the main player while scrubbing (no separate preview)

The main video itself shows the target frame full-screen as the user scrubs. This is what Leanback does by default without a seek data provider (§6), and Media3 scrubbing mode targets this case.

- **Cons.**
  - react-native-video exposes neither scrubbing mode nor `SeekParameters`, so each step is a full seek on 1080p HLS/DASH.
  - It conflicts with the current "pending target, commit on OK, Back cancels" model, because cancel would need a seek back.
  - It wastes bandwidth.
- Not recommended on the current engine.

### Not feasible

- **Native thumbnail tracks.** None exist (§1).
- **OK collage for Boosty videos.** There is no public route (§2.2), and it would need an invented API.
- **The website's previews.** There are none (§2.3).

## 5. Recommended next step: a device spike for option A (no production code)

This should be a throwaway debug-only spike, run with the owner's agreement. The release-like build must stay installed (`adb install -r`), and the spike must not sign in or out.

1. Debug build: a minimal native preview view plus a second ExoPlayer on the 144p DASH representation of a video the session can play.
2. Measure on the Chromecast:
   - seek-to-frame latency (p50/p95) for single steps and for a 200 ms hold cadence;
   - main-player dropped frames (`DecoderCounters`) at 1080p while previewing;
   - CPU and memory (`dumpsys meminfo`, `top`);
   - any decoder error.
3. Proposed pass thresholds, for the owner to confirm:
   - p95 preview latency ≤ 500 ms;
   - no main-player decoder errors;
   - dropped frames during scrubbing not visibly worse than without the preview.
4. If it passes, write an ADR (second decoder, native view, no react-native-video patch) and a story. If it fails, try C, or ship §6 without images.

Effort is described without time estimates:

- §6 UX polish is small: mostly existing code.
- Option A is one native module and view, plus a JS bridge, tests and a device matrix.
- Option C is larger than A.
- Native thumbnail tracks cannot be implemented (no source).

## 6. YouTube-like seek UX baseline

| Aspect | Reference behaviour | Source | Our current state |
|---|---|---|---|
| Preview strip | YouTube on Android TV: pressing up opens the seek bar, which shows thumbnails while scrubbing. YouTube TV (the live-TV service) enlarged the preview thumbnail in 2019 | Secondary press: [Android Central](https://androidcentral.com/youtube-rolling-out-fresh-interface-android-tv), [Android Police 2019](https://www.androidpolice.com/2019/07/01/youtube-tv-update-adds-progressive-fast-forward-new-suggestions-ui-and-more/), [9to5Google](https://9to5google.com/?p=298068). Not observed on the device (we avoided playing YouTube on the owner's Google account) | Bubble with the target time, no image |
| Step sizes | YouTube TV: progressive fast-forward, "15-second, 30-second, and 1-minute increments", faster the longer the button is held | Android Police 2019 (YouTube TV service, not the YouTube app) | 5, 5, 10, 10, 20, 30 s growth; hold repeats every 200 ms (`focus-map.md`) |
| Pause while scrubbing | Leanback (Google's Android TV playback reference): `onSeekStarted` calls `pause()`; on finish it resumes `play()` if playback was playing before | DOC: [`PlaybackTransportControlGlue.java`](https://github.com/androidx/androidx/blob/androidx-main/leanback/leanback/src/main/java/androidx/leanback/media/PlaybackTransportControlGlue.java) | Playback continues while a target is pending (owner decision 2026-10-27) |
| Commit | Leanback with a seek data provider: no `seekTo` during scrubbing; one `seekTo(lastUserPosition)` on finish. Without a provider it seeks on every change | DOC: same file | OK or Play/Pause commits; quick presses auto-commit after 600 ms |
| Cancel | Leanback: a cancelled seek returns to the position saved at start (without a provider) or simply never seeks (with a provider) | DOC: same file | Back cancels (no engine seek); 5 s idle cancels |
| Thumbnail data model | Leanback `PlaybackSeekDataProvider`: "provide seeking data and thumbnails to UI"; a sorted, fixed list of seek positions; `getThumbnail(index, callback)` is called on the UI thread with increasing or decreasing index, so prefetch can follow the direction, and a pending callback is replaced | DOC: [`PlaybackSeekDataProvider.java`](https://github.com/androidx/androidx/blob/androidx-main/leanback/leanback/src/main/java/androidx/leanback/widget/PlaybackSeekDataProvider.java) | — (useful contract for option A/C: snap previews to keyframe positions, prefetch in the scrub direction, drop stale requests) |

The preview-image half of the baseline does not fit our current "keep playing while pending" decision in one respect. Option A's preview view sits above the thumb while the main video keeps playing underneath, which is acceptable. Pausing during the scrub would lower the decoder load during previews, so the spike should measure both (INFERRED).

## 7. What was not checked, and why

- **A paid post's manifests with the owner's session.** It would need the owner's tokens off the device or a debug build. The free public posts come from the same pipeline (INFERRED same shape).
- **The website player observed in a browser.** We avoided the owner's signed-in browser; the evidence comes from the bundle code.
- **YouTube's Android TV app on the device.** Playing it would add to the owner's YouTube history; we used press reports and Leanback sources instead.
- **Any on-device measurement of options A–C.** That needs a debug build and the owner's agreement; no app code was to change.
- **The `MediaMetadataRetriever` platform UA against `srcAg`-bound URLs.** Untested.

## Evidence hygiene

- No signed URL, query, token, cookie or `Authorization` value is recorded here.
- Manifests were parsed in memory only. The public static JS bundles used for §2.3 were deleted from the scratchpad after inspection.
- No Boosty headers were sent to CDN hosts, and no comments API was requested.
