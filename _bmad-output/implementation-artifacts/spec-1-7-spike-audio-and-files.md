---
title: 'Story 1.7: Spike — audio and files'
type: 'chore'
created: '2026-10-25'
status: 'done'
baseline_commit: 'f1e5b2ec597c97587c2188a8b3b6ceaa1f03af08'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/docs/api-contract.md'
  - '{project-root}/docs/testing.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** POST-06 (audio) and POST-07 (files as QR) rest on reference code only (api-contract §4.1, §8 item 6). It is unverified:
- whether `audio_file` (`url + Post.signedQuery`) plays, pauses, seeks and survives sleep on the device;
- whether a `file` link (`url + signedQuery`) shown as a QR opens on a phone;
- whether `signedQuery` expires, and how long the link lives.

The 1.5 scan found no accessible `audio_file` or `file` block on the first E4 page of the owner's 5 subscribed blogs.

**Approach:** On the throwaway branch `spike/1-7-audio-files` (Story 1.6 spike + `main`), a spike screen «Аудио и файлы»:
- scans the owner's subscriptions for accessible posts with `audio_file` and `file` blocks;
- plays the picked audio with `react-native-video`;
- shows the picked file link as a QR;
- records only sanitized shapes and statuses.

The results go to `docs/api-contract.md` (`LIVE`) and `docs/testing.md` (S9).

## Boundaries & Constraints

**Always:**
- **Allowed requests:** E2, and E4 (≤5 blogs, up to 3 pages each, paging only with the returned `extra.offset`). E8 with `comments_limit=0&reply_limit=0`, fetched with the Story 1.6 reference profile (`withApiProfile('reference')`).
- **Probes:** status-only probes of the audio/file URL (`Range: bytes=0-0`, aborted on 2xx; the Story 1.6 probe). Budget: at most 100 API requests per app run, shown on screen.
- **URL handling:** the signed URL is built in memory as `url + signedQuery`. It is shown only inside the QR. The `signedQuery` shape is logged via `describeUrlShape` (keys, value classes, no values) together with any expiry field.
- **Audio:** play/pause, seek ±10 s (D-pad on key up, as learned in 1.6), position/duration, buffering and errors. AppState transitions are logged. One automatic E8 re-resolve on a player error, matched by block id or else by the same `url`.
- **Logs:** go through `redactForLog`. No titles, URLs, `signedQuery` values or ids in logs; titles appear on screen only.
- **Device cleanup:** the logcat scan (signed URLs, `signedQuery` values, `Bearer `, 60+ char runs, phone digits) passes, then the buffer is cleared.

**Never:**
- Mutations (no E9: the reference keeps no audio progress); the comments endpoint.
- Downloading files to the TV (owner decision: no downloads).
- Persisting URLs.
- Production code; UI beyond the spike screen.
- Claiming owner-only checks (sound audible, phone scan) without the owner.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Find | E2 + E4 pages | Lists of accessible posts with `audio_file` / `file`, counts per kind | None found → recorded; that row stops |
| Audio play | Picked `audio_file` | load/duration, play, pause, seek ±10 s; probe status | Player error → one E8 re-resolve, then stop |
| Audio sleep/wake | Device sleeps while playing | AppState, player state after wake | — |
| File QR | Picked `file` | QR on screen; probe status, content type; `signedQuery` shape and expiry field | Probe non-2xx recorded |
| signedQuery lifetime | Any picked block | Expiry from the query shape if present; probe again at the end of the session (age recorded) | No expiry field → "unverified" |
| Empty `signedQuery` | Accessible post with an empty `signedQuery` | Recorded; probe of the bare `url` | — |

## Decisions (owner, 2026-10-25)

- **Source of samples:** auto-scan only (5 subscribed blogs, up to 3 E4 pages each). If no accessible `audio_file` or `file` is found, the row is recorded as "no sample" and that part of S9 stays unverified. No blog is typed in by the owner.
- **Phone scan:** allowed. The file link opens on the owner's phone and may download the file there.

</frozen-after-approval>

## Code Map

- `src/app/spike/playbackApi.ts` -- reuse `withApiProfile`, `describeUrlShape`, `expiresInS`, `redactForLog`, `sec`. Add `audioFileCandidates`/`fileCandidates` (accessible posts only; block `url`, `title`, `duration`/`size`, `Post.signedQuery`) and `signedUrl(url, signedQuery)` (join with `?`/`&` correctly). Leave the existing exports unchanged.
- `src/app/spike/PlaybackCheck.tsx` -- patterns to copy: `callApi` with the budget, `probeStatus` (XHR, abort on 2xx), `useTVEventHandler` key-up seek with target accumulation, `startPendingRef`, AppState logging, recovery. Do not modify the file.
- `src/app/spike/contentShapesApi.ts` -- `buildSubscriptionsRequest`, `buildBlogPostsRequest` (add an optional `offset` argument), `buildPostRequest`, `subscriptionBlogUrls`, `postsOf`.
- `src/app/spike/QrCheck.tsx` -- `react-native-qrcode-svg` usage on the device (Story 1.2).
- `src/app/App.tsx` -- add the menu entry first; the title becomes 1.7.
- Device: `adb-25311HFDD69E8B-SKv3Ox._adb-tls-connect._tcp`. Release-like build, `-PreactNativeArchitectures=armeabi-v7a`, `adb install -r` only (the owner's session must survive). `SpikeNet` interceptor from 1.6 stays and shows host/auth flags for the audio/file hosts.

## Tasks & Acceptance

**Execution:**
- [x] `src/app/spike/playbackApi.ts` + test -- candidates for `audio_file`/`file`, `signedUrl`, and the E4 `offset` paging. Tests cover locked posts skipped, an empty `signedQuery`, query joining, and redaction of the joined URL.
- [x] `src/app/spike/AudioFilesCheck.tsx` + menu entry + test -- find (auto-scan), audio player with controls and logs, file QR with probe, the `signedQuery` shape, the budget counter. The test checks that no URL, `signedQuery` value or title reaches the console.
- [x] On the device: run the matrix; the owner checks the sound and scans the QR; logcat scan, then clear the buffer. (Find row run: no `audio_file`/`file` sample in 3 blogs × 3 pages, so the audio/file rows and the owner checks are recorded as not verified; logcat scan passed, buffer cleared.)
- [x] `docs/api-contract.md` §4.1/§6/§8 and `docs/testing.md` -- `LIVE` results for S9 and the file QR; update `docs/feature-parity.md` POST-06/POST-07 evidence only if results contradict it.

**Acceptance Criteria:**
- Given the run, when each matrix row completes, then its result is recorded with "agent via adb" or "owner" marked.
- Given the `SpikeNet` log, when audio/file hosts are requested, then no request carries `auth=true`.
- Given the logcat captured during the story, when it is scanned, then nothing sensitive matches.

## Implementation Notes

- Implemented by a subagent from this spec; the device runs (agent via adb, release-like build, `adb install -r`) found **no accessible `audio_file` or `file`** in the 60 newest posts of each of the owner's 3 subscribed blogs (180 posts, 131 accessible). Per the owner decision this is recorded as «no sample»; the audio, QR and lifetime rows stay unverified.
- Added during the run: a block-type summary (types seen: `text`, `link`, `ok_video`, `image`, `video`, `list`), then (review) nested `list` scanning and a per-page `signedQuery` summary.
- `Post.signedQuery` is non-empty on every accessible post, one shape (`user_id`, `content_id`, `expire_time` epoch s, `sign`), `expire_time` = 24 h after the response. The first re-scan missed `expire_time` (not in the expiry key list); fixed and re-run. The query carries the account's user id, so it is personal data as well as a credential.
- E4 `offset` paging verified (pages 2–3, HTTP 200). Device runs: 4 scans, 10 requests each.

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind, edge, verification-gap | Candidates and counts skip blocks nested in `list` items | medium | patch | Only `blockTypeSummary` walks lists; device verdict still holds (summary showed only `list>text`) |
| 2 | edge | Budget stop or failed E4 pages still end in «no sample» | medium | patch | `stopped`/failures not reflected; the device run had no failures (10 × 200) |
| 3 | blind | «No sample» claim broader than the scan | medium | patch | 60 newest posts per blog, `isLast=false`, E5 not scanned; docs narrowed |
| 4 | blind | `signedQuery` shape/expiry measurable on any accessible post | medium | patch | Post-level field; logged per page on a 10-request re-scan |
| 5 | blind, edge | `EXPIRY_KEY` `e`/`t` may be issued-at; negative values printed as expiry | low | patch | Keys dropped; past timestamps labeled |
| 6 | verification-gap | Recovery test cannot detect a lost resume seek | low | patch | `mockClear` + early `t=0` assertion |
| 7 | blind, edge | Probe "nothing downloaded" stated but never run on the device | low | patch | Docs mark it unverified |
| 8 | blind | `video` block type not tied to the contract | low | patch | Checked against §4.1; recorded as open if new |
| 9 | blind | QR shows a live signed link with no warning | low | patch | testing.md procedure note |
| 10 | blind | feature-parity.md not updated | low | defer | Same deferred entry as 1.6 (Story 1.8 compiles parity evidence) |
| 11 | verification-gap, blind | D-pad, AppState, scan caps, failed recovery E8 untested | low | defer | Spike screen; caps bounded by the tested 100 budget; device check needs a sample |
| 12 | edge, blind | Recovery races, start-pending freeze, duplicate keys, NaN duration, stale buffering, controls without audio, xhr throw, fragment URLs, empty offset, deep nesting | low | reject | Spike-only paths not reachable without a sample; production player rules are in deferred-work (1.6) |
| 13 | blind | Probe count not capped | low | reject | Status-only GETs on owner press; no sample to probe |
| 14 | blind | Size label as MB | low | reject | Spike screen text; unit stays "inferred" in api-contract |
| 15 | edge | `SpikeNet` cannot see XHR probes or the player | false | reject | Story 1.6 `SpikeNet` logged both XHR probe requests (`range` header) and react-native-video CDN requests through the shared OkHttp client |
| 16 | blind | Spec missing from the diff; sprint status mismatch; 1.6 flip bundled | false | reject | Spec excluded from the review diff on purpose; step 5 syncs status; 1.6 → done follows the merged PR #6 |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures` -- expected: exit 0.
- `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a` -- expected: BUILD SUCCESSFUL.
