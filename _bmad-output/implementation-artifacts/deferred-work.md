# Deferred work

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-production-project-skeleton.md`
  summary: Document and wire the local release-signing procedure (keystore outside the repo, zipalign/apksigner or a gitignored keystore.properties) and verify a signed release installs and appears in the TV launcher.
  evidence: build.gradle has no signingConfigs and README/testing.md say "the owner signs locally" without a procedure; Story 9.1 owns release signing.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-production-project-skeleton.md`
  summary: Decide edgeToEdgeEnabled for TV and apply the DESIGN.md safe area (48/27 dp) in the shell.
  evidence: edgeToEdgeEnabled=true is kept from the 0.87 template without a TV rationale; overscan impact is unverified (maybe-false, would be medium). Settle on the device in Story 2.4.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-production-project-skeleton.md`
  summary: Re-evaluate the test-renderer react-reconciler 0.33.0 override when React Native Testing Library is added.
  evidence: test-renderer@1.3.1 expects react-reconciler ~0.34 (React ^19.3) while RN 0.87.1 pins React 19.2.3.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-production-project-skeleton.md`
  summary: Limit debug ABIs locally (e.g. arm64-v8a for the Chromecast) to cut the ~119 MB debug APK, and trim template leftovers in android/ (JSC flavor block, stale proguard comment).
  evidence: reactNativeArchitectures lists four ABIs; template comments remain. Cosmetic; no functional impact.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-library-compatibility-on-the-device.md`
  summary: Configure release builds for the 32-bit Chromecast (abiFilters armeabi-v7a, or ABI splits/AAB) so the APK fits the ~350 MB free storage.
  evidence: The 4-ABI debug APK (170 MB) failed with INSTALL_FAILED_INSUFFICIENT_STORAGE; only a manual -PreactNativeArchitectures flag is used today. Story 9.1.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-library-compatibility-on-the-device.md`
  summary: Add a Metro bundle check (react-native bundle --platform android --dev false) to CI once zod is a production dependency.
  evidence: Jest loads zod's CJS build, so removing @babel/plugin-transform-export-namespace-from would pass tests but break the release bundle.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-spike-phone-sign-in-and-token-persistence.md`
  summary: Production phone input must accept all valid E.164 lengths (at least 8 digits including the country code; the spike required 11-15) and trim whitespace before the "+".
  evidence: The spike's normalizePhone rejects valid numbers such as +47 plus 8 digits; Story 2.2.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-spike-phone-sign-in-and-token-persistence.md`
  summary: Production contract fixtures for phone auth must mirror the live shapes (sentTransport "gate", expiresIn 604800, 64-char opaque non-JWT tokens, invalid_sms_code, sms_gate_ratelimit).
  evidence: The spike flow test used sms/300000/JWT-like/invalid_code values; Story 1.5 produces the fixtures.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-spike-phone-sign-in-and-token-persistence.md`
  summary: Flow tests for restoring a stored session (mount read, E1 with the stored access token, malformed value) and for device_id memoization/retry when this logic moves into production auth/platform code.
  evidence: Spike tests start from an empty store, and spikeNative.getInstallId is fully mocked.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-spike-refresh-and-logout-behavior.md`
  summary: Settle the device_id dependency and refresh-token reuse detection on a fresh session (refresh with a foreign device_id first, then with the real one), and test a real network drop during refresh.
  evidence: The Story 1.4 device_id result is ambiguous because a rotated-out token had been reused just before; real network loss was only simulated. Needs owner approval; proposed at the start of Story 1.5 after re-sign-in.
  note: Story 1.5 (owner decision 2026-10-25) closed the device_id and reuse-detection parts as not needed for production, with no requests (api-contract §2.3/§8). Only the real network drop during refresh remains open.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-spike-refresh-and-logout-behavior.md`
  summary: Second-account isolation check for S10 (sign in as a different Boosty account after logout and confirm that no data from the first account is visible).
  evidence: No second account was available; required by CLAUDE.md (no cross-account leakage). Story 2.8 covers it in production.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-spike-refresh-and-logout-behavior.md`
  summary: Production refresh-coordinator tests: a late 401 after another caller's completed refresh (staggered timing), signOut/reload during an in-flight refresh, save failure on adopt, and expires_in edge values.
  evidence: The spike tests use uniform delays and sequential calls; requirements are listed in api-contract §2.3.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-spike-entitlement-errors-and-events-shapes.md`
  summary: Check whether content endpoints (E4/E5/E8) return 401 or an anonymous 200 for an expired or invalid access token, before the production session story.
  evidence: Story 1.5 saw 200 anonymous for a missing token on E8 and 401 on E1 for a corrupted token (1.4). If content endpoints answer 200 for a bad token, refresh would never fire. One E8 request with a corrupted Bearer settles it.
  note: Resolved in Story 1.6 (2026-10-25): E8 with a synthetic Bearer returns HTTP 200 as an anonymous viewer, not 401 (api-contract §7). The production session must validate the token via E1 at start and on resume; the session story owns that.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-spike-entitlement-errors-and-events-shapes.md`
  summary: E18 events pagination and E2 subscriptions paging beyond 30 are unverified.
  evidence: Story 1.5 saw 1 event with no cursor field, and 3 subscriptions with top-level offset/limit/total. Needs an account with more events and subscriptions.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-spike-entitlement-errors-and-events-shapes.md`
  summary: Phone-auth send limit (sms_gate_ratelimit on a first send) — window, threshold, and phone vs IP key are unknown.
  evidence: Story 1.5 sign-in was blocked about 2 h after 2 successful codes; the website got the same 429; it lifted at 19:45. Observe passively only; never trigger it on purpose.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-spike-entitlement-errors-and-events-shapes.md`
  summary: Feed cursor (`extra.offset`) format is not recorded; fixtures carry it as a placeholder, so pagination-merge tests need synthetic cursors.
  evidence: The sanitizer replaces every string; the spike did not log the cursor structure. A shape-only log (character classes, separators) on a later run would settle it.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-spike-entitlement-errors-and-events-shapes.md`
  summary: Fixture number rules live in two copies (contentShapesApi.ts sanitizer and scripts/check-fixtures.mjs), joined by a comment and a cross-check test only.
  evidence: The production fixture tooling should share one rules module when the sanitizer moves out of the spike.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-spike-entitlement-errors-and-events-shapes.md`
  summary: E15 live-stream 200 shape (an active stream) is unverified; both checked blogs returned 204.
  evidence: Needs a run while a subscribed blog is streaming.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-spike-authorized-playback-expiry-and-progress-round-trip.md`
  summary: Observe the CDN response after a real signed-URL expiry (pause over 24 h, then probe and play) and confirm one E8 re-resolve recovers it.
  evidence: Story 1.6 measured `expires` = 24 h; the 30 min and ≥2 h pauses were skipped by the owner because they cannot reach expiry. The re-resolve path worked after other player errors.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-spike-authorized-playback-expiry-and-progress-round-trip.md`
  summary: Production player: act on D-pad key up for seek, ignore a key up whose key down happened before the player got focus, and accumulate the target of repeated presses during an in-flight seek.
  evidence: Story 1.6 device run: the physical remote delivers only key up for left/right to useTVEventHandler; moving focus onto the player fired a seek; presses during a seek were computed from a stale position.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-spike-authorized-playback-expiry-and-progress-round-trip.md`
  summary: Production player: stay paused after the app returns from background or device sleep, and do not write E9 or keep a position until a new source has reached its start position.
  evidence: Story 1.6: after KEYCODE_WAKEUP playback resumed by itself; during a quality switch the spike wrote time_code=0 before the seek-after-load (fixed in the spike only).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-spike-authorized-playback-expiry-and-progress-round-trip.md`
  summary: Production player: cap adaptive HLS/DASH selection to the display and decoder (the Chromecast decoder failed once on 2560x1440 AVC High from adaptive HLS).
  evidence: Story 1.6: ERROR_CODE_DECODING_FAILED once on adaptive HLS 1440p right after a seek; MP4 1440p played fine; the E8 re-resolve recovered.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-spike-authorized-playback-expiry-and-progress-round-trip.md`
  summary: Decide the production API header profile: content requests must use the reference-like mobile Android profile for playable URLs; check whether phone auth and refresh work with it (one profile for all calls) or keep the web profile there.
  evidence: Story 1.6: URLs fetched with the web desktop profile (srcAg=CHROME_MAC) return HTTP 400 on the device player; the reference-like profile (srcAg=CHROME_ANDROID) plays. Auth/refresh were only tested with the web profile (1.3/1.4).
  note: Decided 2026-10-26 in docs/adr/0008-api-request-profiles.md (auth profile for phone auth and refresh, content profile for everything else). Per-endpoint device checks of the content profile are assigned there.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-spike-authorized-playback-expiry-and-progress-round-trip.md`
  summary: Production progress writes: serialize E9 (or ignore completions older than the newest sent), do not rely on a background/exit write completing, and decide whether a local `{postId, mediaId, positionSeconds}` copy reconciles on next start.
  evidence: Story 1.6 review: event writes are not serialized with progress writes, so an older PUT can land last; the background E9 during device sleep only completed after wake (testing.md sleep/wake row).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-spike-authorized-playback-expiry-and-progress-round-trip.md`
  summary: Production player: fall back when the re-resolved post no longer offers the same quality type (HLS or nearest), start over when `timeCode` is at or near the end, and clear the start-pending gate even if the seek-after-load lands more than 2 s from the target.
  evidence: Story 1.6 review: the spike stops on `no-type`, starts a finished video at its end, and keeps ignoring positions if the seek snaps away from the start (not observed: Media3 seeks landed exactly).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-spike-authorized-playback-expiry-and-progress-round-trip.md`
  summary: Media keys: verify key-down/key-up semantics of `useTVEventHandler` for media keys and define stop/next/previous, on a remote or keyboard that has media keys.
  evidence: Story 1.6: the Chromecast with Google TV remote has no media keys; the D-pad delivers only key up, so the spike's key-down media handling is unverified.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-spike-authorized-playback-expiry-and-progress-round-trip.md`
  summary: Update docs/feature-parity.md PLAY-01/03/04 with the Story 1.6 device evidence (playback formats, resume from timeCode, E9 round-trip, re-resolve) when Story 1.8 compiles the spike results.
  evidence: Story 1.6 review: the parity matrix still shows these as reference-only evidence.
  note: Resolved in Story 1.8 (2026-10-26): Live notes added to PLAY-01, PLAY-03, PLAY-04 and PLAY-10 in docs/feature-parity.md.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-spike-audio-and-files.md`
  summary: Verify S9 on the device once an accessible `audio_file` and `file` exist in a subscribed or followed blog: playback/pause/seek/sleep of `url + signedQuery`, the file QR scanned by a phone, whether audio/file hosts enforce `expire_time`, and the probe's abort-at-headers behavior.
  evidence: Story 1.7 found no sample in the 60 newest posts of each of 3 subscribed blogs (owner decision: auto-scan only). A re-run is one press of «Найти аудио и файлы» on spike/1-7-audio-files; following a free blog with public audio/file posts would supply a sample.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-spike-audio-and-files.md`
  summary: Check whether `Post.signedQuery` depends on the request profile (web vs the reference mobile profile), as the video URLs do.
  evidence: Story 1.7 measured signedQuery (user_id, content_id, expire_time = 24 h, sign) only on E4 with the web headers.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-spike-audio-and-files.md`
  summary: Record the live shape of the `video` content block (keys only) and decide its parity treatment.
  evidence: Story 1.7 saw `video` blocks in accessible posts; §4.1 has it only as REF.
