# Android TV auth and playback spike plan (phase 0)

Goal: before any production screen is built, prove on a real Android TV device:
1. real sign-in;
2. token persistence;
3. session refresh;
4. authorized video playback;
5. progress resume;
6. logout.

All of it must work through a React Native (react-native-tvos) app with a D-pad only.

The spike code is throwaway and lives on a separate branch or directory. Its outputs are evidence, ADRs and contract updates, not features.

Inputs: `docs/feature-parity.md` (AUTH-*, PLAY-*), `docs/api-contract.md` (§2, §6, §7, §8).

## 0. Prerequisites (owner)

| # | Item | Why |
|---|---|---|
| P1 | Test device: **Chromecast with Google TV 4K** (confirmed by the owner 2026-10-25). Record the OS version, security patch and WebView version in `docs/testing.md` when the spike starts. | Physical-device evidence. An emulator is used only as a supplement and is reported separately. |
| P2 | (Owner confirmed 2026-10-25 that an account with subscriptions is available. Content coverage is checked at spike start.) A Boosty test account with at least one **paid** subscription whose posts contain `ok_video` (several videos per post if possible), `audio_file`, `file`, a single-choice and a multi-choice poll, and at least one **locked** post. | Entitlement and media coverage |
| P3 | Optionally, a second account | Account isolation and logout/relogin |
| P4 | ~~Sign-in method decision~~. **Resolved 2026-10-25: phone + one-time code.** The account in P2 must have a phone number linked. | — |
| P5 | Agreement that sanitized response samples may be stored as fixtures. Tokens, cookies, signed URLs and personal data are never stored. | Data handling |

## 1. Toolchain and dependency checks

1. Initialize a react-native-tvos project from the maintained TV Community CLI template.
2. Resolve the current stable versions from the primary docs at that time.
3. Record the exact versions, package manager, Node/JDK/Android SDK versions and the lockfile. Do not assume versions.
4. For each candidate library, verify against its docs and issue tracker, and then **on the device**, that it works with the selected RN TV version:

| Need | Candidate to evaluate first | Must verify |
|---|---|---|
| Embedded sign-in page | Not needed: phone auth was selected. Evaluate `react-native-webview` only if S1 fallback research is triggered. | — |
| Secure token storage | A Keystore-backed library, e.g. `react-native-keychain` (evaluate, not decided) | Keystore backing on the device's Android version. Survives app restart and update. Is wiped on logout. Has a future tvOS Keychain path. |
| Video | `react-native-video` (ExoPlayer/Media3 on Android) | HLS, DASH and MP4 playback. Seek, rate and source switching. Exposes error events with HTTP status if possible. Media key events with RN TV. Supports the tvOS target later (phase 4 only, not tested now). |

Architecture decisions to confirm in this step (see `docs/adr/0001`–`0003` and the architecture spine):
- Bootstrap: does the community template `--version 0.87.1` with `react-native` aliased to `react-native-tvos@0.87.1-1` build and run on the device? Record the exact steps.
- Do React Navigation native-stack and react-native-screens handle TV focus and Back correctly?
- Does react-native-keychain 10 work on the device, and does the corruption recovery path behave?
- Does Zod 4 work under Hermes? Does the hand-written ru plural selector work? Hermes has no `Intl.PluralRules`.
- What dp size does the device report (expected 960×540)?

If a candidate fails, record why and evaluate the next one before writing custom native code. Write an ADR for each decision (`docs/adr/`).

## 2. Spike scenarios

Each scenario records: device and build, steps, observed result, and sanitized evidence (status codes and field shapes, never values). Results go to `docs/testing.md`, and contract findings to `docs/api-contract.md` with the `LIVE` evidence level.

### S1. Sign-in: website in WebView (AUTH-01, AUTH-02). **Fallback research only**

Run S1 only if S2 hits a blocker, such as a captcha that cannot be passed on TV. Phone auth is the selected method.

1. Open `https://boosty.to` in the WebView and go to the sign-in UI.
2. Using **only the remote**, try each available site method. Accept the cookie banner. Handle a captcha if one appears.
3. Detect the `auth` cookie, parse `{accessToken, refreshToken, expiresAt}` and validate it with `GET /v1/user/current`.
4. Record:
   - which elements are unreachable by D-pad;
   - whether the TV keyboard opens in inputs;
   - whether a social sign-in (VK, Google, …) opens popups or new windows, and whether those work;
   - the units of `expiresAt`;
   - whether the cookie is HttpOnly.

Pass: a user completes sign-in with D-pad, Select, Back and the system keyboard, **without** a virtual cursor.

Fail: if a virtual cursor or touch is required, that is a **release blocker** for this method. Report it, do not hide it.

### S2. Sign-in: phone + one-time code (AUTH-03). **Primary method (approved 2026-10-25)**

Additional checks:
- The phone field and code field work with the TV system keyboard and D-pad only.
- Where the code arrives (SMS, messenger, Boosty app).
- The resend flow.
- Phone, challenge and code are never logged.

Fail: if a captcha is required and cannot be completed on TV, that is a release blocker. Report it to the owner and run S1 as research.

1. Native TV form for the phone number. Send the code. Enter the code with the system keyboard. Confirm.
2. Record:
   - error responses for a wrong code, an expired challenge, resend too soon and too many attempts;
   - whether captcha is demanded (see `RE-SPEC` `/auth/phone/mobile_captcha/send`);
   - `expires_in`.

Pass: tokens are obtained and `GET /v1/user/current` succeeds.

### S3. Token persistence (AUTH-04)

1. Store the tokens in the secure-storage candidate.
2. Kill the app, cold start it, and confirm that the session is restored without signing in again.
3. Reboot the device and repeat.
4. Check that no token appears in logcat, the RN dev menu or crash output.

Pass: the session survives a restart and a reboot, and no secret appears in logs.

### S4. Session refresh (AUTH-05, AUTH-06)

1. In a debug build, force the stored expiry into the past and call 5 APIs concurrently. Exactly **one** `POST /oauth/token/` must be sent, and all 5 calls must succeed.
2. Corrupt the access token (debug only), call an API, and expect 401 → one refresh → one retry → success.
3. Corrupt the refresh token as well. Expect a single failed refresh, then the signed-out state, with no loop and no request storm.
4. Record whether the refresh token rotates, and whether refresh fails when the `device_id` differs from the one used in phone auth. Use a debug build only.

### S5. Entitlement and error shapes (api-contract §7)

1. Fetch the feed, a blog page and a single post (`GET /v1/blog/{blog}/post/{id}` with `comments_limit=0`) for an **accessible** and a **locked** post.
2. Record `hasAccess`, `data` vs `teaser`, and whether `ok_video.playerUrls` is present.
3. Record the status codes and body shapes for: missing token (401), a nonexistent post (404?), a locked resource if it returns a status (403?), and rate limiting if it can be observed without abuse.

### S6. Authorized video playback (PLAY-01, PLAY-02, PLAY-05, PLAY-06, PLAY-07)

For an accessible `ok_video`:
1. Play HLS. Then switch quality to a progressive MP4 variant. Then to DASH, if offered. Position must be preserved at each switch.
2. Check: seek with D-pad, play/pause with Select and the media keys, speed 0.5×/2×, the elapsed/remaining display, and Back closing the settings, then the controls, then the player.
3. Measure the time to first frame, and record the decoder or format failures.
4. Confirm that **no Boosty Authorization header** is sent to CDN hosts. Check this with a debug network log, then redact it.

### S7. Media URL expiry and recovery (PLAY-10)

1. Start a video, record the time the URL was issued, and pause for increasing intervals (30 min, 2 h, longer if needed).
2. Resume, or seek to an unbuffered region.
3. Record the CDN error and HTTP status, then re-resolve via `GET post`, match by media `id`, and restore the position.
4. Record the observed URL TTL. Recovery attempts must be bounded (at most one automatic attempt, then a user Retry).

### S8. Progress (PLAY-03, PLAY-04)

1. Play to position X and exit.
2. Check that `PUT /v1/viewstat/video/{id}/timecode/` was sent, at most about once per 10 s of movement plus once on exit.
3. Re-open the post. `timeCode` ≈ X, and playback offers resume or start over.
4. Check on the Boosty website or app that the same position appears there.
5. Put the device to sleep during playback, wake it, and confirm that progress was written on pause or lifecycle change.

### S9. Audio and files (POST-06, POST-07)

1. Play an `audio_file` using `url + signedQuery`: play, pause and seek. Sleep the device and resume.
2. Record whether `signedQuery` expires.
3. For a `file`, show its link as a QR code (approved by the owner). Check that the QR opens on a phone and record how long the link stays valid.

### S10. Logout and relogin (AUTH-07)

1. Log out. Credentials are wiped from secure storage, the query cache is cleared, and no account-scoped data is visible.
2. Sign in as a second account (if P3 is available) and confirm that none of the first account's feed or progress is visible.

### S11. Events endpoint shape (EVT-01, our addition)

1. Call `GET /v1/notification/standalone/event/` and record the sanitized shape, the event types and whether pagination exists.
2. This is only a contract check. No UI is built in the spike.

### Debug logs (SET-05)

A debug-only log buffer is used during the spike. Before it is used, verify that it redacts tokens, cookies, phone numbers, codes and signed URLs.

## 3. Exit criteria

The spike is done when every scenario S2–S11 is either (S1 only if it was triggered):
- **passed** with physical-device evidence recorded in `docs/testing.md`, or
- **failed** with a written blocker and the alternatives that were tested.

Deliverables:
- `docs/testing.md`: pinned device, OS, WebView version, build configuration, and per-scenario results. Emulator results are labeled as emulator.
- `docs/api-contract.md`: entries upgraded to `LIVE`, plus newly observed error shapes.
- ADRs: sign-in method, secure storage, video library, and the refresh coordinator design.
- Sanitized fixtures for post, feed, poll, live stream and error bodies.

Explicit non-goals:
- production screens or design system work;
- tvOS builds;
- QR or companion sign-in (research note only, no working-looking QR screen);
- comments.

## 4. Risks known before the spike

| Risk | Impact | Mitigation |
|---|---|---|
| Phone auth requires a captcha or is rate-limited | Possible release blocker for sign-in | Measure in S2. Fall back to S1 research. Report to the owner. |
| The phone-auth API is internal and may change without notice | Sign-in breaks | Defensive parsing. Validate via `/v1/user/current`. Show a clear error state. |
| Signed URL TTL is short or unknown | Playback breaks after a pause | Bounded re-resolve (S7) |
| DASH-only or unusual formats on some videos | Playback failure | Prefer HLS, then DASH, then MP4. Show an explicit "unsupported media" state. |
| The reference trusted any TLS error in its WebView | Security | Never copy this. Keep default TLS validation. |
