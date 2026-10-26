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
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-subscription-feed-on-the-home-screen.md`
  summary: Feed freshness (AD-7) — the feed refreshes only by explicit action (refetchOnMount off to avoid refetching every loaded page); add silent first-page invalidation on resume after staleTime, and invalidate the feed after a token refresh/re-login so an anonymous (all-locked) E5 page fetched before E1 validation does not linger. Decide the policy with the owner (what happens to deep scroll/focus when page 1 is replaced).
  evidence: Story 3.1 review: E5 starts in parallel with the cold-start E1 (a server-invalidated token yields a 200 anonymous page); a same-account re-login after A11 does not reset the query cache (AccountScope resets only on switch/sign-out); no resume invalidation exists.
  note: Owner decision 2026-10-26: the feed refreshes when the app returns from the background (AD-7 resume invalidation). Implement as its own small change before Story 3.2; re-login invalidation and the deep-scroll/focus policy when page 1 is replaced are settled in that change.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-subscription-feed-on-the-home-screen.md`
  summary: Before Story 3.4 relies on Shell refocus: `FocusZone.focusTarget` for Главная uses zone order (an arbitrary mounted card, no scroll restore) and the FocusZone remembers the retry/state-action id over the card entry; route Главная's refocus through `useFocusRestoration.restore()` and keep card-only memory.
  evidence: Edge-case review of Story 3.1 (`src/shared/focus/FocusZone.tsx:91-99`, `FeedGrid` retry row `onFocus`); harmless until a Post/Player return exists (3.4).
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-subscription-feed-on-the-home-screen.md`
  summary: Test that the demo transport pages through all 30 posts (320 with `longFeed`) and then stops, so the release latency check cannot silently run on one page.
  evidence: Verification-gap review: `demoFeedPage` cursor parsing is only exercised on page 1 (`__tests__/demoFlow.test.tsx:91`); the owner sees the card count during the device run.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-subscription-feed-on-the-home-screen.md`
  summary: PostCard for posts without a preview (polls, files) should show the author avatar on a plate (DESIGN.md PostCard anatomy); today it shows a plain placeholder plate.
  evidence: Review pass 2 of Story 3.1; no poll/file posts were seen in the owner's feed, so the gap is not visible yet — fold into the story that renders polls/files (Epic 6) or the 3.6 locked-card work.
