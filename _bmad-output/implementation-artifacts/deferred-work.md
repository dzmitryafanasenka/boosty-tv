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
  note: Still open. Story 2.8 (2026-10-26) implemented the production account-switch path (AccountScope.reset() before the new phone and session are written, guarded late writes) and host-tested it over FixtureTransport only; the owner decided against a device run and a spent sign-in, so S10 "second account" stays not verified on the device.
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
  status: Done 2026-10-28: Story 4.6 (pause on background/sleep, overlay paused on return) and Story 4.2 (no E9 before the start position).
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
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-welcome-screen-on-the-design-foundation.md`
  summary: Decide the font-scale policy (cap `maxFontSizeMultiplier` or let fixed-height controls grow) and check A1 and Button at the largest Android TV text size on the device.
  evidence: maybe-false (would be medium). Button has a fixed height with numberOfLines=1 and Text keeps allowFontScaling; A1 places the column and the footer absolutely, so a large system font scale may clip labels or overlap the footer. DESIGN.md sizes are "at default font scale" only. Settle in Story 9.4 (accessibility pass) by setting the device font scale to max and taking a screenshot.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-welcome-screen-on-the-design-foundation.md`
  summary: Bundle Golos Text for tvOS (Info.plist UIAppFonts) in phase 4; today the fonts exist only under android/app/src/main/assets/fonts.
  evidence: Typography tokens resolve fontFamily by PostScript name (`GolosText-Regular`, `GolosText-SemiBold`); without the iOS bundle entry tvOS would silently fall back to the system font.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-request-a-sign-in-code-by-phone.md`
  summary: Before the first live send in Story 2.3, check on the device that `NativeModules.InstallId` exists under the new architecture and `getOrCreate()` returns the same UUID across two calls and an app restart; then record the send request details (header set, `X-From-Id`, `device_os=web`, no `transport`, `credentials: 'omit'`, 30 s timeout, error mapping) in docs/api-contract.md §2.2.
  evidence: Story 2.2 ran no send by owner decision; every test fakes the native module, and the release build only proves the package links. A broken module would make every «Получить код» fail with Unknown.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-confirm-the-code-and-create-the-session.md`
  summary: Run the ADR 0006 corruption matrix with the production SecureStore and KeychainStorageResetModule on the device (debug build, run-as: corrupt RN_KEYCHAIN.preferences_pb → read → save → read; ciphertext corruption).
  evidence: maybe-false (would be medium). The production helper adds the delete-result check and `.tmp` removal, so the Story 1.3 gate does not cover it. Corrupting the file also deletes the spike session in the same DataStore file, so run it when the owner agrees (after the live sign-in, the production session would be lost too and need another sign-in).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-the-app-shell-sidebar-back-and-focus.md`
  summary: The `AppInfo` native module name and `versionName` key are checked only on the device; JS tests fake the module.
  evidence: Renaming `NAME`/`VERSION_NAME` in `AppInfoModule.kt` or dropping it from `BoostyNativePackage` keeps CI green and shows «неизвестна». Keep the device row in the regression checklist until native tests exist.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-the-app-shell-sidebar-back-and-focus.md`
  summary: `focusRestoration.forget` is never called and sign-out must call `focusRestoration.clear()` (Story 2.7, account isolation).
  evidence: Entries under removed route keys stay in memory for the app's lifetime; in-memory only, no persistence.
  note: Sign-out part resolved in Story 2.7 (2026-10-26): `focusRestoration` is an account-scoped store, cleared by `AccountScope.reset()` on sign-out (`__tests__/signOutFlow.test.tsx`, host test). `forget` for removed route keys stays open.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-the-app-shell-sidebar-back-and-focus.md`
  summary: Modal host behavior when the initiator unmounts, when the stack is reset, or when a second dialog opens while one is open (medium, unverified).
  evidence: Not reachable in 2.4. Settle when session-expiry/sign-out resets (Stories 2.5–2.7) or the first production dialog can run with a dialog open; add a fallback focus and close-on-reset.
  note: Partly resolved in Story 2.6 (2026-10-26): on `expired` the app closes the modal with `close({ restoreFocus: false })` before the reset to A11, so no focus request goes to the departing initiator (host test with the debug dialog; not run on the device). Sign-out (2.7) and a second dialog while one is open remain open.
  note: Sign-out reset part resolved in Story 2.7 (2026-10-26): after a successful sign-out the app closes the dialog with `close({ restoreFocus: false })`, then resets the stack to `[Welcome]` (host test; the device check covered only the dialog, not a real sign-out). A second dialog while one is open remains open.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-the-app-shell-sidebar-back-and-focus.md`
  summary: Modal Back priority relies on its BackHandler listener being the newest (medium, unverified).
  evidence: A screen that registers a Back listener while a dialog is open would handle Back under it. Settle with a documented contract in docs/focus-map.md (screens check `modal.isOpen()` first, or a central host handler) when the first production dialog lands.
  note: Story 2.7 (2026-10-26): `SignOutDialog` is the first production dialog and relies on this order: its own Back listener (swallows Back while «Выйти» is busy, otherwise returns false) must be newer than the host's. The host now registers its listener in `open()`, before the content mounts, and the contract is one line in docs/focus-map.md §1.4 (host tests; not run on the device).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-the-app-shell-sidebar-back-and-focus.md`
  summary: The owner noticed slower remote response on the 300-card «Проверка фокуса» list (debug build, Metro over the network).
  evidence: Observed with the physical remote on 2026-10-26, only on the debug build (dev-mode JS, no minification, dev checks); the release build has no 300-item list to compare. Measure D-pad latency on the first long production list (Epic 3 feed) in a release build on the pinned device before calling it acceptable.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-stay-signed-in-across-restarts-and-expiry.md`
  summary: Demo mode swaps only App's local SessionManager; the module-level `httpClient` export still targets the real network, so Epic 3 repositories must obtain the client from the active session (provider/context) instead of importing the singleton.
  evidence: `src/shared/api/sessionManager.ts` exports `httpClient = sessionManager.http`; `src/app/App.tsx` picks `demo.createDemoSessionManager()` locally.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-stay-signed-in-across-restarts-and-expiry.md`
  summary: Add a flow test that an `expired` transition after an offline cold start clears `homeOffline`, so the Shell after re-login shows the placeholder (fold into Story 2.6 with A11).
  evidence: `src/app/App.tsx` `setHomeOffline(false)` on `expired` has no covering test (verification-gap review).
  note: Resolved in Story 2.6 (2026-10-26): `__tests__/expiredFlow.test.tsx` «offline cold start → resume → invalid_grant → re-login» (host test).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-session-expired-and-quick-re-login.md`
  summary: A11 offers no way to remove the stored phone and the expiry marker's account id from a shared TV; Story 2.7 sign-out must decide whether A11 (or A1) gets a «Выйти»/forget path.
  evidence: After `expired` the phone and `{expired, accountId}` stay in SecureStore until a re-login or a sign-out, and sign-out is only reachable from the Shell.
  note: Closed as won't do in Story 2.7 (owner decision 2026-10-26): A11 keeps its one-button design; the phone and the expiry marker stay until the next sign-in or sign-out (sign-out works from `expired` too).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-session-expired-and-quick-re-login.md`
  summary: Add a unit test that `getExpiredPhone()` resolves null when the status changes (sign-out/sign-in) while the phone read is pending; fold into Story 2.7.
  evidence: `src/shared/api/sessionManager.ts` `getExpiredPhone` re-checks the status after the read; no test changes it mid-read (verification-gap review).
  note: Resolved in Story 2.7 (2026-10-26): `sessionManager.test.ts` «getExpiredPhone resolves null when the status changes mid-read (sign-out)».
- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-minimal-settings-and-sign-out.md`
  summary: A failed `signOut` keeps SessionManager's bumped generation, so a refresh that was in flight is dropped as stale and its already-spent refresh token later yields `invalid_grant`; decide whether a failed sign-out rolls the generation back.
  evidence: `src/shared/api/sessionManager.ts` `signOut` bumps `generation` before the clears and does not restore it in the failure path (edge-case review, Story 2.7).
- source_spec: none
  summary: Epic 2 retro action item 5 — plan a split of `SessionManager` before it gains Epic 3 concerns (design note/ADR), to run before Story 3.1.
  evidence: Split from the Epic 3 kickoff intent (owner choice 2026-10-26: item 4 first, then item 5, then Story 3.1 as separate runs).
  note: Planned 2026-10-26 in `docs/adr/0009-session-manager-split.md` (proposed). Owner decision: the split itself runs between Epic 3 and Epic 4, right before Story 4.2 (entry below), not before Story 3.1.
- source_spec: none
  summary: Story 3.1 (subscription feed on the Home screen), built on the shared flow-test harness from retro item 4; repositories take the HTTP client from `src/app/session.ts`; measure release-build D-pad latency on the 300+ fixture feed.
  evidence: Split from the Epic 3 kickoff intent (owner choice 2026-10-26: retro item 4 runs first).
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-retro-item-4-flow-test-harness.md`
  summary: `npx jest src/shared/focus/__tests__/ModalHost.test.tsx` run alone exits 1 although all 9 tests pass — a real-timer frame callback (`@react-native/jest-preset/jest/setup.js:51`, the "two frames later" focus restore) fires after the environment is torn down; fix the timer handling in the test.
  evidence: Reproduced on the untouched file at `fd09dbe` (exit 1) and after the harness refactor (exit 1); the full suite exits 0, so CI does not see it.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-retro-item-4-flow-test-harness.md`
  summary: Exempt `**/__tests__/**` from the `boundaries` "no import of src/test" policy in `.eslintrc.js`, so tests under `src/` can use the shared harness without `eslint-disable` comments.
  evidence: `src/shared/focus/__tests__/ModalHost.test.tsx` needs three `eslint-disable-next-line boundaries/dependencies` lines to import `src/test/flow.tsx` (review of retro item 4).
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-retro-item-5-session-manager-split-plan.md`
  summary: Split `SessionManager` per ADR 0009 (codec → core → refreshHost → signOut → lifecycle → restore → signIn → debug, facade unchanged) as its own change between Epic 3 and Epic 4, before Story 4.2.
  evidence: Owner decision 2026-10-26; Story 4.2 is the first story with a session concern (pending progress flushed after re-login only if the account generation is unchanged).
  status: Done 2026-10-27 in `_bmad-output/implementation-artifacts/spec-session-manager-split.md`: modules under `src/shared/api/session/` behind the unchanged `sessionManager.ts` facade (ADR 0009 steps 1–9, one commit each); the two contract suites unchanged; new `codec`, `core`, `refreshHost` unit tests. The «Left out on purpose» items (two generation counters, no sign-out rollback, unqueued `getExpiredPhone` read, `accountChanged`) stay open as before.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-subscription-feed-on-the-home-screen.md`
  summary: Feed freshness (AD-7) — the feed refreshes only by explicit action (refetchOnMount off to avoid refetching every loaded page); add silent first-page invalidation on resume after staleTime, and invalidate the feed after a token refresh/re-login so an anonymous (all-locked) E5 page fetched before E1 validation does not linger. Decide the policy with the owner (what happens to deep scroll/focus when page 1 is replaced).
  evidence: Story 3.1 review: E5 starts in parallel with the cold-start E1 (a server-invalidated token yields a 200 anonymous page); a same-account re-login after A11 does not reset the query cache (AccountScope resets only on switch/sign-out); no resume invalidation exists.
  note: Owner decision 2026-10-26: the feed refreshes when the app returns from the background (AD-7 resume invalidation). Implement as its own small change before Story 3.2; re-login invalidation and the deep-scroll/focus policy when page 1 is replaced are settled in that change.
  status: Done (pending owner check) 2026-10-26 in `_bmad-output/implementation-artifacts/spec-feed-refresh-on-resume.md`: after a resume E1 `ok`, one E5 page 1 when the cached feed is ≥ 60 s old (since its last write), collapsed into the cached first page (fresh copies win; page count, page params, scroll and the focused card kept; a gap replaces the cache with page 1); every successful sign-in resets the query cache. Remainder: an anonymous (all-locked) E5 result fetched in parallel with a cold-start E1 that then refreshes the token is not invalidated on the refresh; a later stale resume replaces only page 1's copies, so locked copies on deeper pages stay until those pages are fetched again (a full refetch, sign-in, or a cache reset).
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-subscription-feed-on-the-home-screen.md`
  summary: Before Story 3.4 relies on Shell refocus: `FocusZone.focusTarget` for Главная uses zone order (an arbitrary mounted card, no scroll restore) and the FocusZone remembers the retry/state-action id over the card entry; route Главная's refocus through `useFocusRestoration.restore()` and keep card-only memory.
  evidence: Edge-case review of Story 3.1 (`src/shared/focus/FocusZone.tsx:91-99`, `FeedGrid` retry row `onFocus`); harmless until a Post/Player return exists (3.4).
  status: Done 2026-10-27 in `_bmad-output/implementation-artifacts/spec-3-4-post-screen.md`: Главная registers a return restore with the Shell (`HomeFocusInfo.setReturnFocus`) that restores only a remembered card through `useFocusRestoration.restore()` (scroll, index, focus, fallback chain); the retry row and the StateView action still return through the zone.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-subscription-feed-on-the-home-screen.md`
  summary: Test that the demo transport pages through all 30 posts (320 with `longFeed`) and then stops, so the release latency check cannot silently run on one page.
  evidence: Verification-gap review: `demoFeedPage` cursor parsing is only exercised on page 1 (`__tests__/demoFlow.test.tsx:91`); the owner sees the card count during the device run.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-subscription-feed-on-the-home-screen.md`
  summary: PostCard for posts without a preview (polls, files) should show the author avatar on a plate (DESIGN.md PostCard anatomy); today it shows a plain placeholder plate.
  evidence: Review pass 2 of Story 3.1; no poll/file posts were seen in the owner's feed, so the gap is not visible yet — fold into the story that renders polls/files (Epic 6) or the 3.6 locked-card work.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-author-page.md`
  summary: Keep the 404 body's `error` code in AppError so only E3 `blog_not_found` maps to «Автор недоступен» (today every E3 404 does).
  evidence: HttpClient maps every 404 to `NotFound` and drops the body (`src/shared/api/appError.ts`); a path change or proxy 404 would show «Автор недоступен» with no retry. Review 3.3, finding 4.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-author-page.md`
  summary: The demo Author test should load demo-blog-1's second page and check 30 distinct cards.
  evidence: `__tests__/demoFlow.test.tsx` asserts only that some cards exist; a demo transport that ignored the cursor would pass. Dev-only. Review 3.3, finding 3.
- source_spec: `_bmad-output/implementation-artifacts/spec-author-posts-refresh.md`
  summary: Главная's resume head refresh merges while the load-more «Повторить» row is shown and focused; the merge clears the query error, so the row (and focus) likely vanish.
  evidence: Author skips the refresh in that state (`skipWhileError`); applying it to Главная breaks the pinned `homeFeedFlow` test that expects the merge. Unverified on Главная; needs an owner decision on the expected behaviour. Review of spec-author-posts-refresh, loop 2.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-post-screen.md`
  summary: Update docs/feature-parity.md for Epic 3 (feed, subscriptions, author page, post screen) with «Android (Story 3.x)» evidence, including the inline-link deviation from POST-02 (plain text until Story 6.3).
  evidence: No Epic 3 story updated the matrix; rows stay «not started» per its own rule. Review 3.4, finding 8.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-post-screen.md`
  summary: Demo mode: test opening a post from Автор (E8 `<blogUrl>-post-<n>` branch) and harden the demo E8 path parsing (escaped regex, safe decode).
  evidence: Only feed posts are pressed in demoFlow; dev-only. Review 3.4, finding 9.
- source_spec: `_bmad-output/implementation-artifacts/spec-post-header-layout.md`
  summary: Epic 4: decide where «Смотреть/Продолжить» and «С начала» sit in the header-on-top Post layout (in the header row vs right under it) and their place in the ↑ ↓ order.
  evidence: The owner moved the Post screen to a header on top (2026-10-27); focus-map F initial focus is «Смотреть», placement is open. Review of spec-post-header-layout.
- source_spec: `_bmad-output/implementation-artifacts/spec-post-header-layout.md`
  summary: Mark `Post Screen.dc.html` (Claude Design) as superseded by the header-on-top layout in the UX folder, or regenerate it.
  evidence: DESIGN.md records the owner decision; the mock still shows two columns.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-6-locked-posts.md`
  summary: Demo mode: a demoFlow test for the locked demo posts (with and without a level name) and a demo teaser with an image URL.
  evidence: Dev-only; demo teasers have no URL, so only the placeholder path runs in demo. Review 3.6, finding 10.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-retro-a1-pinned-head-refresh.md`
  summary: A head post deleted or hidden by the author stays in the cached head after a head refresh (the merge keeps cached copies) until a gap or the cache is collected (Epic 3 retro F2, second half).
  evidence: `mergePostsHead` → `mergePosts(fresh.posts, first.posts)`; opening such a post gives «Пост недоступен». Applies to Главная and Автор.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-retro-a3-home-head-refresh.md`
  summary: Главная: an empty last page 1 from a resume refresh while a card has focus empties the feed and leaves focus nowhere (the StateView does not take focus by itself); move focus to `nav/home` or the StateView action.
  evidence: Documented as a known edge in focus-map §3 B (A3 note); pre-existing before A3. Review of spec-epic-3-retro-a3.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-retro-a7-screen-focus-and-stack-routes.md`
  summary: `useHeldError` drops the held error when a retry is paused offline (status pending, fetchStatus paused, isFetching false), so the skeleton replaces the error StateView and its focused «Повторить».
  evidence: Inherited verbatim from the four pre-A7 copies (usePost, useAuthor, useSubscriptions, usePagedPosts); now in one place, `src/shared/api/useHeldError.ts`.
- source_spec: `_bmad-output/implementation-artifacts/spec-session-manager-split.md`
  summary: Session robustness review before or with Story 4.2 — pre-existing races surfaced by the split review: overlapping sign-outs share a boolean `signingOut`; a same-account sign-in can race an in-flight refresh between `bumpGeneration` and `adoptSignedIn`; `restore()` keeps `signedIn` while its read runs; restore vs a finishing sign-in; the `validate()` single-flight spans a generation change; `discardSaved` clears the expiry marker on a failed same-account re-login; `subscribe` dedupes by function identity; `markExpired`/`restoreSignedIn` rely on caller guards.
  evidence: All present verbatim in the pre-split closure (ADR 0009 kept behaviour); now each sits in one module (`session/core.ts`, `signIn.ts`, `restore.ts`, `lifecycle.ts`, `signOut.ts`). Add a `debugExpireInMemory`-during-refresh test and an eslint import restriction for `src/shared/api/session/` at the same time.
  status: Done 2026-10-27 in `_bmad-output/implementation-artifacts/spec-session-robustness.md`: sign-out depth counter (`core`), per-call `subscribe` entries, `markExpired` no-op without a session, restore drops a stale read (generation check), generation-keyed `validate()` single-flight, a failed same-account re-login write from `expired` keeps the phone and re-writes the marker (best effort); the bump→adopt window and «restore keeps `signedIn` while reading» are documented as harmless (ADR 0009 «Robustness pass»); `no-restricted-imports` overrides for `session/` asserted in `__tests__/boundaries.test.js`. The «dead token looks all-locked / E1» item is a separate entry.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-play-a-video-from-a-post.md`
  summary: Device check of a two-video post («Смотреть · Видео 1» → video 1; Back → «Смотреть»; OK on «Видео 2» → video 2; Back → that row).
  evidence: No multi-video post in the first ≈ 50 rows of Главная or ≈ 12 rows per author during the Story 4.1 run; host-tested only.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-play-a-video-from-a-post.md`
  summary: The timeline's focused state (5 dp track, 16 dp thumb, no ring) is subtle on the device; confirm with the owner whether it reads as focus from 2–3 m or needs a stronger cue.
  evidence: DESIGN.md Timeline says «thicker when focused»; screenshots from the Story 4.1 run.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-play-a-video-from-a-post.md`
  summary: The adaptive 1080p cap relies on the declared HLS/DASH variant bitrates from `onLoad` (`adaptiveBitrateCap`); before `onLoad` there is no cap, and a stream whose 1440p variant declares a lower bitrate than 1080p would not be capped.
  evidence: react-native-video 6.19.3 exposes only `maxBitRate` for adaptive limits on Android. Device: 360p → 720p → 1080p, no 1440p after the fix (Story 4.1).
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-play-a-video-from-a-post.md`
  status: Done 2026-10-28 in `_bmad-output/implementation-artifacts/spec-4-5-finishing-a-video.md`: the Ended return focus goes through `remember` on the player's removal (`endedFocus` in `PlayerRoute`).
  summary: Story 4.5 «Ended» relies on `setReturnFocus` to the next unfinished MediaRow, but the Post's content zone reads restoration through `peek`, so the one-shot override is never consumed; the player exit now uses `remember`. Decide the mechanism in 4.5.
  evidence: `src/app/stackRoutes.tsx` PlayerRoute exit; focus-map §4 G «Ended». Review 4.1, finding 14.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-play-a-video-from-a-post.md`
  summary: A post that the player's fresh E8 reports locked is shown «Нет доступа к этому видео» without re-validating the session (an invalid token returns 200 anonymous); validate with E1 first. Do with retro A6 / the session-robustness pass before 4.2.
  evidence: api-contract §7 («Content request with an expired or invalid token»); `PostRepository.videoSources`. Review 4.1, finding 15.
  status: Done 2026-10-27 in `_bmad-output/implementation-artifacts/spec-epic-3-retro-a6-locked-session-check.md`: the player's fresh E8 locked runs E1 through the SessionCheck port first (`expired` → A11, `ok` → one E8 refetch).
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-play-a-video-from-a-post.md`
  summary: Device-verify the Story 4.1 player paths that were host-tested only: the error states («Не удалось воспроизвести видео», «Нет доступа к этому видео», «Видео недоступно»), the buffering spinner (500 ms), the PlaybackArbiter (another playback stopped), the entry guard with the physical remote, and TalkBack on the Post «Смотреть», MediaRows and the player controls.
  evidence: No safe way to provoke them on the device during the Story 4.1 run; docs/testing.md «Story 4.1» «Not verified on the device».
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-play-a-video-from-a-post.md`
  summary: Backlog (owner decision 2026-10-27) — frame preview while scrubbing: a debug-only spike of a second muted ExoPlayer on the DASH 144p variant that renders the frame at the pending seek target. Accepted thresholds: preview frame p95 ≤ 500 ms; zero decoder errors on the main player while it runs. Measure on the pinned Chromecast before any production work.
  evidence: `docs/research/seek-preview-thumbnails.md`; Story 4.1 ships hold-scrub without a preview (the scrub pauses playback, bubble + thumb + fill only).
- source_spec: none
  summary: Validate the session with E1 before showing «all locked» content (player «Нет доступа», paged lists) — a dead token returns 200 anonymous; plus the live check whether E8/E4 return `hasAccess: true` with empty `data` (Epic 3 retro A6, review 4.1 finding 15).
  evidence: Split from the session-robustness pass (owner decision 2026-10-27): independent PR with its own live/device verification; do before or with Story 4.2.
  status: Done 2026-10-27 in `_bmad-output/implementation-artifacts/spec-epic-3-retro-a6-locked-session-check.md`: `src/shared/api/sessionCheck.ts` (SessionCheck port, per-trigger-point 5 min window, one `refetch` per window) provided by `App`; trigger points: the player's fresh E8, the Post screen's E8, Главная page 1 all locked (Автор excluded, owner decision). F5 live check: no `hasAccess: true` with empty `data` in 37 E5 and 23 E4 pages (api-contract §7). Retro item 14 closes after the merge.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-retro-a6-locked-session-check.md`
  summary: Flow-test that `sessionCheck.reset()` runs on a session status change (a locked check, sign-out → sign-in or A11 → re-login, then a locked answer within 5 min sends a new E1).
  evidence: Wired in `src/app/App.tsx` and unit-tested in `sessionCheck.test.ts` only; review A6 finding 13.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-progress-is-saved-and-playback-resumes.md`
  summary: Story 4.2 device checks still open — a multi-video post's per-row status and «Продолжить · Видео N» (the owner knows of no multi-video post), the physical-remote pass and TalkBack. Resume after exit / cold start, «С начала» and the live content-profile E9 passed (2026-10-28).
  evidence: docs/testing.md «Story 4.2» (adb + the owner's website check); host-tested in playerFlow «Multi-video».
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-progress-is-saved-and-playback-resumes.md`
  summary: A failed E9 is re-sent by itself at most 5 times (10 s apart) after the last trigger; a write still owed after that (offline at exit) is lost until that video plays again. The local entry is kept, so the TV resumes correctly; only the server copy (other devices, the website) lags.
  evidence: `src/shared/services/progress/progressRepository.ts` `MAX_AUTO_RETRIES`; a persisted outbox would need its own design.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-progress-is-saved-and-playback-resumes.md`
  summary: Feed and Author cards show no progress yet (FR-14); E4/E5 also carry `timeCode`, but only E8 feeds the ProgressRepository. The Continue view (Story 4.7) reads `progressStore.entries()`.
  evidence: Spec 4.2 «Never»; api-contract §3 «Video duration is in the feed».
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-progress-is-saved-and-playback-resumes.md`
  summary: A player retry («Повторить», a fresh E8) after «С начала» resumes from the local entry, which is written only after 10 s of movement or a pause; an error within the first seconds of a start over therefore resumes the older position.
  evidence: `PlayerScreen` `startMode` switches to `resume` after the first source's start.
  note: Resolved in Story 4.4 (2026-10-28, host-tested): a recovery or a retry after an engine error continues at the broken source's position (or its pending start: 0 for «С начала» before the start was reached), not the local entry. A retry after an E8 failure with no source played yet still uses the start mode.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-progress-is-saved-and-playback-resumes.md`
  summary: Flow-test E9 hold-on-expiry through the real HttpClient and SessionManager (E9 401 → failed refresh → `expired` → no sends while expired → one E9 with the latest position after a same-account re-login).
  evidence: Only `progressRepository.test.ts` with a fake session covers it; the order of the E9 rejection vs the status change in the refresh coordinator is not pinned (review finding 9).
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-progress-is-saved-and-playback-resumes.md`
  summary: Check whether `ok_video.preview` URLs carry a CDN token before Story 4.7 renders the stored `meta.previewUrl`; if signed, store none and re-read the preview from E8.
  evidence: Unverified (medium if true): the progress store persists `meta.previewUrl`; settle by inspecting one live E8 preview URL shape (redacted).
  note: Resolved in Story 4.7 (2026-10-28, debug build, names only): `preview` URLs had no query; the `defaultPreview` fallback carries `tkn`. A preview URL with any query is never written to (or read back from) disk; the card falls back to the in-memory feed post, else a neutral plate (docs/testing.md «Story 4.7»).
- source_spec: `_bmad-output/implementation-artifacts/spec-4-3-choose-video-quality.md`
  summary: Story 4.3 device checks still open — the physical remote, TalkBack, ±10 quick-press accumulation and +10 near the end, the side sheet's native focus trap at its edges, a pick the decoder cannot play (1440p). Sheet, list, «Авто · 1080p», a 720p pick at the same second, Back order, cold-start preference, icons and −10 passed over adb (2026-10-28).
  evidence: docs/testing.md «Story 4.3» (agent, adb).
- source_spec: `_bmad-output/implementation-artifacts/spec-4-3-choose-video-quality.md`
  summary: A picked height the decoder cannot play (e.g. 1440p AVC High on the pinned device) is not stored (the device store is written only after the picked source's `onLoad`), but it stays this run's in-memory choice: «Повторить» and later opens in the same app run re-play it, and the sheet is unreachable from the error state. A height that loaded and fails later (mid-stream decoder error) is stored. Story 4.4's recovery should fall back to the default order after a failure of a preferred source.
  evidence: Owner decision 2026-10-28 (a failing pick shows the existing start-failure error; recovery is Story 4.4); `PlayerScreen` `pickQuality`, `mediaResolver.pickSource`.
  note: Resolved in Story 4.4 (2026-10-28, host-tested): the first error of a picked height recovers once with the same height; after a failed recovery «Повторить» plays the default order and this run's in-memory choice becomes `auto` (the stored value is untouched). The sheet stays unreachable from the error state.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-3-choose-video-quality.md`
  summary: The Menu and Info keys open the sheet but are unverified on a real remote (the pinned Chromecast remote has neither); no Settings key code exists on Android (react-native-tvos maps only `menu` and `info`).
  evidence: `ReactAndroidHWInputDeviceHelper.kt` key map; focus-map §4 G Story 4.3 notes.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-3-choose-video-quality.md`
  summary: A quality switch while the new source has not reached its start (the `load`/`seek` gate) writes no progress until that seek lands; an exit in that window keeps the last written position (≤ 10 s old), and a retry after a switch resumes from that position, not the exact switch second.
  evidence: `PlayerScreen` start gate (`{kind: 'load', target}`); the same rule as a fresh source (Story 4.2: never a pre-seek t=0).
- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-recover-from-expired-links-and-playback-errors.md`
  summary: Story 4.4 device checks still open — only one start-failure recovery was checked over adb with the debug trigger (2026-10-28). Open: a mid-playback recovery at the same second, the error state after a second failure, the «Восстанавливаем воспроизведение…» screenshot for the owner (the copy now stays until the start position), a recovery while paused, the no-access exit to the Post, and the physical remote. A real 24 h signed-URL expiry is not waited for (unverified, as in Story 1.6).
  evidence: docs/testing.md «Story 4.4» (agent, adb + logcat + screencap, debug build); the debug trigger breaks only the player's next resolution, so mid-playback errors are host-tested only.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-recover-from-expired-links-and-playback-errors.md`
  summary: The recovery budget counts playback from progress steps (0 < Δ ≤ 5 s between progress events), not wall time; a stalled stream that reports no progress never gives the budget back, and a seek does not count. A manual «Повторить» does not refill the budget either (only 30 s of playback does).
  evidence: `src/features/player/recovery.ts` (`countPlayback`, `takeRecovery`); spec Decisions «Budget».
- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-recover-from-expired-links-and-playback-errors.md`
  summary: The no-access exit applies only after a source of this opening was ready (a recovery or a retry). A locked answer on the player's first E8 still shows «Нет доступа к этому видео» + «Назад» (Story 4.1 behavior); a locked retry after an E8 failure before any playback does too. The exit shows no message of its own: the Post's refetched locked notice is the message.
  evidence: `PlayerScreen` `everReady` / `noAccessExit`; spec Decisions «Fresh E8 results during recovery».
- source_spec: `_bmad-output/implementation-artifacts/spec-4-7-continue-watching-row-on-the-home-screen.md`
  summary: The Continue row is shown only with the feed grid (it is the grid's list header). With an empty feed («Новых постов нет»), a feed error or the offline view, the row is hidden even when the history has entries.
  evidence: `HomeScreen` renders `ContinueHeader` only in the `grid` phase.
  note: Owner decision 2026-10-28: the row shows only together with the feed (kept as built). Not an open question.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-7-continue-watching-row-on-the-home-screen.md`
  summary: Story 4.7 device rows still open — a locked or unavailable post opened from a Continue card, a natural end from a Continue card (focus → the neighbour), «Return» with a card that is not first (it moves first), more than 3 real entries (only in-memory copies were scrolled), reset by sign-out with entries on screen, the physical remote and TalkBack. The owner's screenshot review of Главная with the row is pending.
  evidence: docs/testing.md «Story 4.7» (agent, adb); these rows would write progress for videos the owner has not approved, so they stay host-tested until the owner picks videos.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-7-continue-watching-row-on-the-home-screen.md`
  summary: A Continue entry whose post later becomes locked or is deleted stays in the row until its player is opened (no E8 per card, spec decision).
  evidence: Spec Decisions «No E8 per card».
  note: Owner decision 2026-10-28, implemented (host-tested): when the player's E8 says locked (session checked; also the 4.4 no-access exit) or unavailable (E8 404 / the video gone), `ProgressRepository.forget` drops the entry (no request), so the card leaves the row and Главная focuses its neighbour, else the first feed card. Not run on the device.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-7-search-and-filters-inside-an-author.md`
  summary: An occasional jest run executes fewer tests than expected with no failure (one of 30 in Story 5.7, a similar one in Story 5.6).
  evidence: settled 2026-10-29 by a full log: «Test suite failed to run — A jest worker process was terminated by another process: signal=SIGSEGV» (postsHeadRefresh.test.ts, unchanged by the story); a Node/jest-worker crash on the host, not a test failure. Worth a look if it grows (e.g. `--workerIdleMemoryLimit`, Node version).

- source_spec: `_bmad-output/implementation-artifacts/spec-6-1-rich-text-emoji-and-long-posts.md`
  summary: Live `header` blocks (42 in the owner's posts) render as the unsupported placeholder; decide their rendering (reference behaviour not audited).
  evidence: Story 6.1 live probe counts in the spec's Implementation Notes and `docs/api-contract.md`.

- source_spec: `_bmad-output/implementation-artifacts/spec-6-1-rich-text-emoji-and-long-posts.md`
  summary: Verify with the first live `smile` sample that a smile counts as one style-offset unit, its field set, and how a failed inline image renders on Android.
  evidence: unverified (maybe-false; medium if wrong: every later range in that paragraph shifts by one); no smile seen in 612 live posts.

- source_spec: `_bmad-output/implementation-artifacts/spec-6-2-images-in-posts.md`
  summary: A post with many large images decodes all of them in the Post column's plain ScrollView; check a gallery-style post on the Chromecast for memory and scroll.
  evidence: unverified (maybe-false; medium if real: decoder memory on a low-RAM device); `resizeMethod="resize"` downsamples, but nothing is virtualized.

- source_spec: `_bmad-output/implementation-artifacts/spec-6-3-links-files-and-external-videos-via-qr.md`
  summary: Owner idea (2026-10-29): show a post's timestamps as chapter marks on the player timeline (as YouTube), and possibly jump to a timestamp from the post; plan with Epic 8 (player options).
  evidence: Owner request during Story 6.3; timestamps arrive as YouTube links with `t=` in the post text; the live format for Boosty videos is not checked yet.

- source_spec: `_bmad-output/implementation-artifacts/spec-6-3-links-files-and-external-videos-via-qr.md`
  summary: Device check of a file chip (busy state, the dialog with a signed target, «Не удалось открыть файл», «Нет доступа к файлу», the accessibility labels while busy and after a failure) and an owner phone scan of a file QR (no photo kept).
  evidence: Story 6.3 checked link and YouTube chips on the device only; the file path is host-tested.

- source_spec: `_bmad-output/implementation-artifacts/spec-6-4-inline-audio.md`
  summary: The screen stays on while an AudioBlock is paused with its source held (react-native-video keep-screen-on); the reference holds the wakelock only while playing. Owner decision 2026-10-29: keep as is for now; a later option is to release the source after a long pause.
  evidence: Device check in Story 6.4: `KEEP_SCREEN_ON` present 2 s after a pause, released after Back.
- source_spec: `_bmad-output/implementation-artifacts/spec-6-6-vote-and-retract-in-a-single-choice-poll.md`
  summary: Add the PollOption pending-outline values (accent, 2 dp, 1.2 s pulse to opacity 0.35) to the DESIGN.md frontmatter, then move them from local constants in PollWidget.tsx into tokens.ts `poll-option`.
  evidence: tokens.test.js requires tokens.ts to match DESIGN.md exactly and DESIGN.md has no pending tokens; changing DESIGN.md is the owner's call (Story 6.6 review).
- source_spec: `_bmad-output/implementation-artifacts/spec-6-6-vote-and-retract-in-a-single-choice-poll.md`
  summary: Add a demoFlow test that votes, changes and retracts on the demo open poll (demo transport E10–E12).
  evidence: demo.ts routes E10–E12 in memory but no test presses OK in demo mode; a path regex or form-parse slip would show «Не удалось отправить голос» unnoticed (Story 6.6 verification-gap review).
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-6-retro-a1-a2.md`
  summary: Add an ESLint `no-restricted-imports` rule (or a boundaries.test.js case) that forbids `src/shared/platform/**` from importing `src/shared/ui/**`.
  evidence: A2 removed the only platform → ui import, but no rule keeps the cycle from returning (Blind Hunter review of the A1–A2 fix).
- source_spec: `_bmad-output/implementation-artifacts/spec-7-2-watch-a-live-stream.md`
  summary: Live play after a long pause or a background/sleep return remounts the same signed live URL; consider a quiet E15 re-fetch on a stale play so an expired URL does not spend the single automatic recovery.
  evidence: maybe-false, medium if true — the live URL lifetime was never observed (no live sample); a live stream played across a sleep, or a pause longer than the URL lifetime, would settle it (Story 7.2 review).
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-7-retro-a2-live-and-focus-refactor.md`
  summary: Fix the flaky playerFlow «Expired URL» assertion `JSON.stringify(playerLogs)).not.toMatch(/example\.invalid|312|v1/)`, which also matches the digits of a log timestamp (e.g. 1793373531280); assert on the log messages and fields without `time`.
  evidence: pre-existing; one failed run in 30 during the A2 verification, caused by a timestamp containing «312» (`__tests__/playerFlow.test.tsx:2386`).
  status: Done 2026-10-31 in `_bmad-output/implementation-artifacts/spec-retro-post-split-and-boundary-tests.md`: the logs are serialized without `time` before the leak check (playerFlow «Expired URL», and the same latent issue in eventsFlow «Malformed»).
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-7-retro-a2-live-and-focus-refactor.md`
  summary: Finish the PlayerScreen live/VOD split before Epic 8 Story 8.1. A2 extracted `useLivePlayback` (live media, ended, epoch, unplayable exit, copy), but most of the roughly 20 `isLive` branches stay in `PlayerScreen.tsx`: retryable, the overlay focus target, live `pickQuality`, play after a pause, seek disabled, live `onEnd`, the recovery target.
  evidence: the remaining branches mutate screen refs and state (`gate`, `heldByLifecycle`, `seek`, `setBuffering`, `setPaused`, `showOverlay`), so moving them needs a designed seam (for example an engine-state reducer), not callbacks; `PlayerScreen.tsx` went only from 1514 to 1477 lines (A2 Implementation Notes).
  status: Done 2026-10-31 in `_bmad-output/implementation-artifacts/spec-player-live-vod-split.md`: the live/VOD decisions are one `PlaybackMode` per mode (`playbackMode.ts`, pure intents); `usePlaybackSession` owns the engine state and refs and executes the intents (no reducer: native callbacks read the refs synchronously); `playerPhase.ts`, `usePlayerSource`, `usePlayerSettings`, `usePlayerFocus`, `usePlayerProgress` and `usePlayerKeys` hold the other concerns. `PlayerScreen.tsx` 1477 → about 410 lines, no live/VOD branch outside the mode construction and the render.
