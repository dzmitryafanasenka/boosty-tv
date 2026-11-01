---
title: 'Story 9.5: Full device regression and owner acceptance'
type: 'chore'
created: '2026-11-01'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'ae4d054cd394ff238a4ab700f6ea500be48749a3'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/docs/testing.md'
  - '{project-root}/docs/release.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Android build has never had a full regression on the pinned Chromecast with Google TV with a release build. The owner has not walked UJ-0 to UJ-7 with the physical remote, and has not accepted the release. Until the owner accepts, P3 is not closed, 1.0.0 is not published, and the SM-1 and SM-2 observation periods cannot start.

**Approach:**
- The agent runs the CLAUDE.md device checklist over adb on a release build, and closes the Epic 9 carry-ins.
- The owner walks UJ-0 to UJ-7 with the physical remote, following a short script, and reports.
- Failures are fixed in this story, or listed for the owner to accept.
- The owner accepts the release; then 1.0.0 is built and, with the owner's OK, published.

## Boundaries & Constraints

**Always:**
- **Owner decisions 2026-11-01:**
  - **Release sequence:** publish `0.9.2` first, as the release candidate. The TV updates to it in the app from 0.9.1, which is the first device run of the per-ABI path, and the regression runs on 0.9.2. After the owner accepts, publish `1.0.0` from the same code; the TV updates once more in the app.
  - **Sign-out journeys** (UJ-0, UJ-3, UJ-7, A3–A11): a joint session. The owner signs out and back in with the remote, and the agent reads the logs. There is no second account, so the account-switch check is listed as not verified.
  - **Network loss during playback:** skipped and listed as not verified.
  - **Chooser with 2+ external players:** skipped and listed as not verified; nothing extra is installed on the TV. Live at 1× is checked only if a subscribed author streams during the story.
- **Device runs:**
  - Owner-signed `assembleRelease` armeabi-v7a, installed with `adb install -r`; the session is kept.
  - Check the foreground before every key batch, and read the focused element before every OK.
  - Keep «Button Mapper» enabled and never reconfigure it.
  - Follow the `docs/testing.md` «Device rules».
- **Owner's progress (carry-in):**
  - An agent player visit is a single command, OK then a fixed sleep of 5 s or less then Back, with no dump, pause or seek in between. The 10 s write threshold can then never be reached.
  - Steps that pause or seek the owner's video (the player overlay, the settings sheet, quality change, resume) are the owner's, or need the owner's OK for that write.
  - Add this rule to «Device rules».
- **Evidence labels:** label every result agent over adb, emulator, owner or physical remote, and keep them apart. UJ-1's press count (5 or fewer, no autoplay) and the SM-5 remote-only walk count only when the owner did them.
- **Results:** record in `docs/testing.md` «Story 9.5». Use one table per checklist item and per journey, with the result, the evidence label and any deviation.
- **Failures:** fix in code, with a test, or list as a deviation for the owner. Never record a silent pass. The 9.3 and 9.4 guards stay green.
- **Releasing:** publishing a release, pushing a tag, and every sign-out on the TV need the owner's explicit OK at that moment. `1.0.0` is reserved for the owner's acceptance (`docs/release.md`).

**Never:**
- Signing in CI. Committing keystores, passwords, APKs, account data or signed URLs. Reading or printing the signing passwords.
- Uninstalling or clearing app data. A debug or demo build on the family TV. A silent in-app install.
- New features or design changes.
- Claiming a physical-remote, TalkBack or second-account check that the owner did not do.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Agent player visit | OK on a video of the owner's | Back within 5 s; no new or changed «Продолжить» entry | If a point was written anyway, record it and tell the owner |
| Chip after the sheet closes (carry-in) | Поиск / Автор: «Фильтры» → «Период» → Back → Back | Focus is on «Фильтры», and the chip stays focusable | If it fails, fix it with a reproduction test |
| In-app update, per-ABI | TV on 0.9.1, newer release published | The dialog offers the armeabi-v7a asset; the system installer runs only after OK and keeps the session | A wrong ABI or a digest mismatch is a release blocker |

</frozen-after-approval>

## Code Map

- `docs/testing.md`: «Device rules» (lines 18–28) gets the player-visit rule; the new section «Story 9.5» holds the results.
- `docs/release.md`: Versioning, Build, Verify the signature, Publish on GitHub Releases, Secret checklist. Follow it as written.
- `android/app/build.gradle:81` `appVersionName`: the version bump (`versionCode` is derived from it).
- `src/shared/services/progress/progressRepository.ts:40` `WRITE_MOVEMENT_SEC = 10`: why a visit under 10 s with no pause writes nothing. Do not change it.
- `src/features/update/releaseInfo.ts`, `src/shared/platform/appUpdater.ts`, `AppUpdaterModule.kt`: the per-ABI asset choice and digest check. Read only, unless a failure is found.
- `src/features/search/SearchScreen.tsx`, `src/features/author/useAuthorActionRowFocus.ts`: the guard that ignores focus while the sheet is open (from 9.4). The carry-in race is here.
- `_bmad-output/implementation-artifacts/deferred-work.md`: close the 9.4 entries for the player-visit rule, the chip race and the player overlay labels.
- `CHANGELOG.md` / `CHANGELOG.ru.md`: an entry for each published version.

## Tasks & Acceptance

**Execution:**
- [x] `docs/testing.md`: add the player-visit rule to «Device rules».
- [x] Agent regression (agent over adb) on a release build: D-pad browsing, long lists, filter apply and reset, keyboard close, multiple media, Back hierarchy, sleep and resume, the carry-in chip race, plus the joint sign-out session as decided. Record each item as its row is done.
- [x] Release candidate: bump to `0.9.2`, add the changelog entries, build and verify per `docs/release.md`, publish on the owner's OK, and update the TV in the app from 0.9.1 (per-ABI row).
- [x] Owner remote script: a short Russian checklist for UJ-0 to UJ-7 in chat, with what to press and what to expect. Record the owner's results labelled physical remote.
- [x] Fix every failure, with a test, or list it as a deviation.
- [x] Release: after the owner's acceptance, bump to `1.0.0`, add the changelog entries, build and verify, publish on the owner's OK, and update the TV in the app.
- [x] `deferred-work.md`: close the carry-ins; record what stays unverified.

**Acceptance Criteria:**
- Given the release build, when every checklist item is run, then each has a labelled result or a deviation the owner accepted.
- Given the owner's remote walk, when UJ-0 to UJ-7 are done, then each passes, UJ-1 takes 5 presses or fewer, and resume lands within ±10 s.
- Given the results, when the owner explicitly accepts the release, then the acceptance and its date are recorded, which starts SM-1 and SM-2.

## Implementation Notes

- The player-visit rule is in «Device rules». The agent's only player visit, which used it, wrote nothing.
- `0.9.2` was published from `main` `3b66624` (PR #93). The owner updated the TV in the app from 0.9.1. The installed `base.apk` hash equals the armeabi-v7a asset digest, so the per-ABI path works on the device.
- Agent regression on `0.9.2`: every item passed and no code changed. The chip race was not reproduced in 18 runs, so it is closed.
- The owner signed out and back in with the remote (UJ-0, UJ-7, A3–A11). The owner then walked UJ-1, UJ-2, UJ-4 and UJ-6 with the remote and reported «всё прошло». Not verified:
  - UJ-3, since an expiry cannot be forced;
  - UJ-5, unless someone was streaming;
  - the account switch, network loss and the chooser, as the owner decided.
- Owner acceptance 2026-11-01: «всё прошло, принимаю релиз, выпускай 1.0.0». `1.0.0` is the same code as 0.9.2.
- No failures were found, so nothing was fixed and no deviation was listed.

## Spec Change Log

## Review Triage Log

Iteration 0: the diff since the baseline is documentation, the version bump, the changelogs and story artifacts. No source under `src/` or `android/` changed except `appVersionName`. The orchestrator reviewed it inline against `docs/release.md` and the spec rather than launching the three reviewer layers. No findings.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures`: all green.
- `(cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a)`: the owner-signed device build.

**Manual checks:**
- The device rows in `docs/testing.md` «Story 9.5», each labelled. The owner's remote walk and acceptance are recorded in the owner's words.
