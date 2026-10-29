---
title: 'Story 6.3: Links, files and external videos via QR'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_commit: '93b969adf40974ad8a4cfa7e7a89abd28fc5a08a'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/docs/api-contract.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Links, files and external videos in a post are dead ends on the TV: link text is plain, and `file` and `video` blocks are placeholders (FR35, POST-05/07; epics.md Story 6.3).

**Approach:**
- A paragraph's links get LinkChips under it: the link text plus a «QR» suffix. The text also stays inline.
- A `file` block becomes a FileChip (title and size). An external `video` block becomes a chip with a YouTube thumbnail when the host is YouTube.
- OK on any chip opens the shared QrDialog in the modal host. It shows the title, a QR generated on the device, «Откроется на телефоне» and «Закрыть». Focus is trapped in the dialog. «Закрыть» or Back returns focus to the chip.
- New shared pieces for 6.4 and Epics 7 and 9: `QrDialog` (`shared/ui`), the `QrRenderer` platform port (`shared/platform`), and `externalUrls` (`shared/entities`).

**Decisions:**
- Owner decision 2026-10-25 (feature-parity §12): QR for links, files and external videos; nothing opens on the TV. An external video is never played in the app.
- QR library: `react-native-qrcode-svg` **6.3.26**, exact pin, behind `QrRenderer`. It renders at 200 dp, `ecl="M"`, with a white quiet zone. 6.3.27, which the spike proved, was published 2026-10-21, less than 14 days before this story (project policy, as with zustand in Story 5.3). 6.3.26 depends on the already-pinned `react-native-svg` 15.15.5.
- A file's QR target is `file.url + Post.signedQuery`, built only when OK is pressed:
  - from a fresh E8 (content profile) read beside the mapper, like `playerUrls`, and held in memory for the dialog only;
  - never put into the domain `Post`, a query cache or a fixture; never logged or printed, only its length;
  - the dialog never shows it as text.
- `externalUrls` accepts only `http:`/`https:` URLs. Anything else (e.g. `javascript:`, empty) gives no chip.
- YouTube: the id comes from `youtube.com/watch?v=`, `youtu.be/`, `/embed/` and `/shorts/` URLs. The thumbnail is `https://img.youtube.com/vi/<id>/hqdefault.jpg`, a plain `{uri}` with no headers. A thumbnail failure leaves the chip with its text.
- Chips are focus stops: `post/<postId>/block/<blockKey>` for file and video, and `post/<postId>/block/<paragraphKey>/link/<n>` for links. Duplicate URLs inside one paragraph collapse to one chip.
- Owner decision 2026-10-29 (Q1 b): `header` blocks (42 live in the owner's posts, not rendered by the reference — our addition) render as a bold, non-focusable heading line in the body flow, ending the paragraph in progress; an empty header is dropped. Their live keys are checked in the same probe; if the text field is not found, they stay placeholders and this is reported.
- Owner decision 2026-10-29: the spec is kept whole (~2700 tokens).
- Owner check 2026-10-29: a link chip's QR (6.3.26) scanned with the owner's phone opened the right page. Timestamp links: superseded below (owner decision 2026-10-29, option b).
- Owner decision 2026-10-29 (option b, added during review, our improvement over the reference; supersedes «timestamp links keep a QR chip»): a timestamp link that points at a video of the current post opens the Player for that video at that time instead of the QR. Its chip reads «<text> · Смотреть»; OK opens the Player for that `MediaRef` with a start position in seconds (a new Player start option beside `beginning`/resume; progress is written by the usual rules — owner decision 2026-10-29: a timestamp start overwrites the resume point after 10 s, as YouTube; the device incident that overwrote one video's resume point is not restored, by the owner's choice). Which links count and how the video and the time are read is settled by a live check first (debug build, shapes and counts only, never a URL): host, path, the time parameter (`t=`, `#t=`, `?time=`…) and its format, and how a link names the post's video when the post has several. If the format does not let the app tell the target video and time reliably, stop and report. A timestamp link to another video or an unrecognised one keeps its normal chip (QR, or «Открыть» for a Boosty post).
- Owner decision 2026-10-29 (added before review, our improvement over the reference): a link to another Boosty post opens that post in the app instead of the QR. A post link is `https://(www.)boosty.to/<blogUrl>/posts/<postId>` (query and fragment ignored; `blogUrl` must pass `blogUrlSchema`, `postId` a plain non-empty segment). Its chip reads «<text> · Открыть» (no QR suffix); OK pushes the Пост route for that `{blogUrl, postId}` with the current post's sidebar origin; Back pops back to the same chip (focus restored by id). The linked post's own rules apply (locked → the Story 3.6 teaser, missing → «Пост недоступен»). A link to the current post, a blog page or any other Boosty URL keeps the QR chip.
- Before relying on it, verify live (debug build, keys, counts and statuses only, never a URL; removed before the commit):
  - the `file` and `video` blocks' keys;
  - whether `file.url` needs `signedQuery`: the HTTP status of a HEAD to the target with and without it;
  - whether `video.url` is always an external page.

  Record «File and video blocks (LIVE)» in `docs/api-contract.md`. If a file cannot be opened from its URL, stop and report.

## Boundaries & Constraints

**Always:**
- Focus moves by explicit targets. Initial focus is unchanged (primary, else the first stop, else the author).
- Locked posts keep Story 3.6.
- Copy in `ru`; tokens `link-chip` (32 dp, «QR» suffix) and `qr-dialog` (qrSize 200 on `qr-bg`).
- Layering: no HTTP in components; E8 goes through `PostRepository`.

**Never:**
- Open a URL or a browser on the TV.
- Forward the Boosty `Authorization` header to a file host.
- Persist or log a signed URL.
- Audio (6.4) or polls (6.5–6.7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Link | paragraph with 2 links (one repeated) | inline text + 2 chips under the paragraph | non-http URL → no chip |
| Open QR | OK on a chip | QrDialog: title, QR, «Откроется на телефоне», focus «Закрыть» | — |
| Close | «Закрыть» or Back | dialog closes, focus back on the chip | — |
| File | `file` with title and size | chip «<title> · <size>» | OK → fresh E8; failure → inline error on the chip, no dialog |
| YouTube | `video` with a youtu.be URL | chip with the thumbnail | thumbnail fails → text chip |
| Other video | `video` with a non-YouTube page | text chip, QR to the page | — |
| Header | `header` block with text | bold heading line, not focusable; next paragraph separate | empty → dropped |
| Timestamp | «0:00 Вступление» linking this post's video at 0 s | chip «0:00 Вступление · Смотреть»; OK → Player for that video from that time; Back → the same chip | another video or unknown format → its normal chip |
| Boosty post link | link `https://boosty.to/<blog>/posts/<id>` | chip «<text> · Открыть»; OK → Пост of that post; Back → the same chip | a link to the current post or a blog page → QR chip |
| Privacy | file QR | the signed URL never appears in text, logs or the cache | — |

</frozen-after-approval>

## Code Map

- `package.json`, `package-lock.json` -- `react-native-qrcode-svg` 6.3.26, exact. Its deps `qrcode`, `prop-types` and `text-encoding` resolve through npm. Record it in an ADR (`docs/adr/0014-qr-rendering.md`).
- New `src/shared/platform/qrRenderer.tsx` -- `QrCode({value, size})` wrapping the library (`ecl="M"`, white background, quiet zone). Mockable in Jest.
- New `src/shared/entities/externalUrls.ts` (+ tests) -- `safeHttpUrl`, `youtubeId` / `youtubeThumbnail`, `fileTarget(url, signedQuery)` (`?`/`&` join as `videoSources` does).
- New `src/shared/ui/QrDialog.tsx` -- modal content (`useModal().open(<QrDialog …/>, chipRef)`). `dialog/qr/close` takes initial focus with a request plus `hasTVPreferredFocus`. Back is the modal host's.
- `src/shared/entities/post/postBody.ts` -- paragraph items gain `links: {key, text, url}[]` (from link fragments, deduped by URL, safe URLs only). New items `{kind:'file'; key; title; sizeBytes}`, `{kind:'externalVideo'; key; url; youtubeId}` and `{kind:'heading'; key; text}` (not a stop). `isFocusStop` includes them.
- `src/shared/entities/post/types.ts`, `dto/post.ts`, `mapPost.ts` -- the `video` block `{type:'video'; url}` and the `header` block `{type:'header'; text}` (field per the live check). The `file` block keeps `url` beside the mapper only, as `playerUrls`: never in the domain.
- `src/shared/entities/post/postRepository.ts` -- `fileTarget(http, blogUrl, postId, fileKey)`: a fresh E8 with the raw `file.url` + `signedQuery`, resolved by block id, else by index. Returns a value never stored.
- `src/features/post/PostBody.tsx` -- `LinkChip`, `FileChip`, `ExternalVideoChip` on `link-chip` tokens. OK opens the QrDialog with the chip as initiator. A file chip shows a busy state while E8 runs and an inline «Не удалось открыть файл» on failure.
- `src/shared/entities/externalUrls.ts` -- add `boostyPostRef(url) → {blogUrl, postId} | null` (+ tests: hosts, query/fragment, invalid blog, missing id, blog page).
- `src/features/post/PostScreen.tsx`, `src/app/stackRoutes.tsx` (`PostRoute`) -- an `onOpenPost(blogUrl, postId)` from a Пост that pushes another Пост with the same origin (the Author-from-Post pattern, guarded by `navigation.isFocused()`), and the chip's return focus by id.
- Player start (`src/app/routes.ts`, `src/app/stackRoutes.tsx`, `src/features/player`) -- a start position in seconds beside `beginning`, through the existing resume path (no new engine API); Back from the Player returns to the chip.
- `src/shared/i18n/ru.ts` -- `qr.*` («Откроется на телефоне», «Закрыть»), chip labels, size format (КБ/МБ).
- `src/app/dev/demo.ts` -- demo file, video and links.
- Fixtures: extend `e8-post-accessible.json` (synthetic, marked) with a link, a file and a YouTube video. `check:fixtures` must still pass: no real URL.
- Tests: `externalUrls.test.ts`, `postBody.test.ts`, `__tests__/postFlow.test.tsx` «Story 6.3» (every matrix row, focus trap and return, Back order modal → stack, no signed value in a log spy).

## Tasks & Acceptance

**Execution:**
- [x] Live check of `file`/`video`/`header` keys and the file target status (probe removed); `docs/api-contract.md`.
- [x] Dependency + ADR 0014; `QrRenderer`, `externalUrls`, `QrDialog`.
- [x] Builder items, repository `fileTarget`, chips in `PostBody`; demo; copy.
- [x] Tests for every matrix row; docs: feature-parity POST-02/05/07, focus-map F (chips, QR F7), testing.md Story 6.3.
- [ ] Device (release-like, adb, owner's session): a link chip and a file or video chip open the QR; Back returns to the chip (done by the agent: link + YouTube chip); **the owner scans one QR with a phone** (done: a link chip, the right page opened) (no photo of a file QR is kept: it carries a live signed link).

**Acceptance Criteria:**
- Given the suite, when run 3×, then everything passes; the touched suites pass 30/30; lint `--max-warnings 0`, typecheck and `check:fixtures` are clean.

## Implementation Notes

- Live (debug build, temporary probe `TEMP63`, removed): `file` keys `complete,id,isInvalid,size,title,type,url`; the file host answers 403 to the bare `url` and 200/206 to `url + signedQuery` from a fresh E8, so the file opens from its URL with the query (no stop needed). `video` keys `type,url` (2 samples, both `youtube.com/watch`). `header` keys `content,modificator,type`; `content` is the text JSON on all 21, so headers render (not placeholders). Recorded in `docs/api-contract.md` §4.1 «File and video blocks (LIVE)».
- Metro: `react-native-qrcode-svg` imports `react-native-svg/css`, which needs `@react-native/assets-registry/registry`, absent on react-native-tvos 0.87.1; `metro.config.js` resolves it to `react-native/asset-registry` (ADR 0014). Jest maps `react-native-svg/css` to a mock.
- Device fix: Android's focus search skipped a narrow, left-aligned chip under a full-width paragraph (it weighs the horizontal center offset). Each chip row / chip is wrapped in a full-measure `TVFocusGuideView autoFocus` (native focus facility, no JS engine); re-checked on the device.
- Live-feed links become chips one per line, so a post with timecode links gets one chip per timecode. Option a (each a QR chip) was superseded by option b: a timestamp chip to this post's video plays it at that time.
- Boosty post link (owner decision added before review): `boostyPostRef` in `externalUrls`; `postBodyItems` marks `ParagraphLink.post` unless it is the current post (`selfPost`); the chip reads «<text> · Открыть»; `PostRoute.onOpenPost` pushes `Post` with the same origin, guarded by `navigation.isFocused()`; the return focus is the content zone's remembered chip. Device: an Антонов post's «Полезные ссылки» chip opened the linked Пост; Back returned to the chip.
- Timestamp links (option b): live probe `TEMP63C` (removed) — all 1 327 timestamp links are `boosty.to/<blog>/posts/<post>?t=<int seconds>&tmid=<ok_video id>`; 1 304 target this post's video (api-contract §4.1 «Timestamp links (LIVE)»). `externalUrls.timestampRef`; `ParagraphLink.timestamp`; chip «<text> · Смотреть» (the action word is a separate text so a long link text never hides it); `PlayerStart` gained `{atSec}` (clamped to the last second, through the existing start gate); route param `start: {atSec}`; the Player's exit returns focus to the chip. Player off → QR. Device: OK on «1:57 · Смотреть» started at 1:57 (2:07 seen a few seconds later), Back → the chip; the visit exceeded 10 s, so it overwrote this video's progress («Осталось 19 мин» → «Осталось 108 мин»).
- An accessible `audio_file` post was seen in a subscribed blog during the device check (useful for Story 6.4).

## Spec Change Log

- 2026-10-29 (implementation): link chips also apply to `list` item lines (each item its own chips), and an external `video` without an http(s) URL stays the neutral «Видео» placeholder. Chips sit inside a full-measure autoFocus focus guide (device finding above). The spec's "join as `videoSources` does" refers to the Story 1.7 spike's `signedUrl` join (`videoSources` has none); `fileTarget` follows that join and also drops a URL fragment.

## Review Triage Log

Iteration 0 (layers: blind-hunter 15, edge-case-hunter 9, verification-gap 1 gap).

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | blind | Empty `signedQuery` gives a bare file URL QR that answers 403 | medium | patch | The live probe recorded 403 for the bare URL; `fileTarget` now returns `unavailable`. |
| 2 | blind, edge | A `locked` file result shows the generic error | low | patch | Distinct «Нет доступа к файлу»; Unauthorized goes through HttpClient's session handling as everywhere. |
| 3 | blind, edge | The index fallback can return another file under the shown title | low | patch | The fallback now also matches the title. |
| 4 | blind, edge | An «Открыть» chip without `onOpenPost` does nothing | low | patch | Falls back to the QR. |
| 5 | blind, edge | Case-sensitive self-post check | low | patch | `blogUrl` compared case-insensitively. |
| 6 | edge | A host-less authority passes `safeHttpUrl` | low | patch | Direct correction. |
| 7 | blind | `youtubeId` misses `/live/` | low | patch | Cheap addition with a test. |
| 8 | edge | `formatFileSize` shows «1024 КБ» | low | patch | Unit advances after rounding. |
| 9 | edge | QR `onError` sets parent state during render | maybe-false | patch | Deferred; avoids a React warning either way. |
| 10 | vgap | No test for a late file E8 after leaving the Пост | low | patch | Test added. |
| 11 | blind, edge | Headings now render in locked teasers; docs say placeholders | low | patch (doc) | Intended; POST-08 and focus-map now say so. |
| 12 | blind | `testing.md` lists the owner's link scan as not verified | low | patch (doc) | Contradiction removed; the file QR scan stays open. |
| 13 | blind | The file chip has no device evidence | low | defer | Needs a post with an accessible file opened on the TV and a phone scan; recorded. |
| 14 | blind | Post links can grow the stack (A→B→A…) | low | reject | User-driven, as Author↔Post; Back unwinds each hop. |
| 15 | blind | Identical labels for several external videos | low | reject | 3 live video blocks across the feed; a post with several is rare. |
| 16 | blind | The dialog does not show the destination host | low | reject | A presentation idea, not a defect. |
| 17 | blind | Index-based ids for link chips and id-less videos | low | reject | Live `video` blocks carry no id; within a paragraph the order is stable. |
| 18 | blind | Long URLs make dense, hard-to-scan QRs | low | reject | `onError` covers unencodable values; the owner scanned a real link. |
| 19 | blind | AC not evidenced after the last change | false | reject | The coordinator ran the full suite ×3 (2069) after the addition; ×30 runs after the patches. |
| 20 | blind | Status files disagree | false | reject | Statuses move at finalize. |
| 21 | edge | A late file E8 with a modal open is silently dropped | low | reject | Rare; the user started another action. |

Iteration 1 (after the timestamp addition; layers: blind-hunter 14, edge-case-hunter 9, verification-gap 2 gaps). Rows of iteration 0 with unchanged code are carried, not re-verified.

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 22 | blind | `testing.md` and Implementation Notes still say timestamps keep a QR chip | low | patch (doc) | Superseded by option b. |
| 23 | blind | `externalUrls.fileTarget` comment says the bare-URL QR is shown | low | patch | The repository returns `unavailable` since #1. |
| 24 | blind | The file chip's failure is not in its accessibility label | low | patch | Folded in, like the busy state. |
| 25 | vgap | No flow test for an id-less file chip | low | patch | Test added through `useFileTarget`. |
| 26 | blind | POST-04 does not say a timestamp start writes the resume point; links to another post drop `t`; Tests columns stale; duplicate test mention | low | patch (doc) | Direct doc corrections. |
| 27 | blind | ADR lacks licences of transitive deps; lockfile check not stated | low | patch (doc) | Direct doc addition. |
| 28 | blind | A stale file QR (24 h signature) is never re-resolved | low | patch (doc) | Recorded in api-contract; expiry unverified. |
| 29 | blind | The deferred file-chip entry omits unverified items | low | patch (doc) | Entry aligned with testing.md. |
| 30 | blind, edge, vgap | `{atSec}` is not clamped when the duration is unknown at the start | low | reject | Live targets are `ok_video` VOD, which report a duration at load; an unclamped seek to the linked second is the intended value; the edge's «seek to 0» would be wrong. |
| 31 | edge | Repeated `t`/`tmid` parameters: the last wins | low | reject | None in 1 327 live links. |
| 32 | edge | A late file E8 after a focus move on the same Пост opens the dialog | low | reject | The user asked for that file; the dialog returns focus to the chip. |
| 33 | edge | A `locked` file result does not refetch the post | low | reject | The chip says «Нет доступа к файлу»; the post refreshes on its own rules. |
| 34 | edge | Several raw file blocks with the same id | low | reject | Ids are unique live; the index path checks the title. |
| 35 | edge | Unauthorized on the file E8 shows the chip error | low | carried | As #2: HttpClient's session handling owns expiry. |
| 36 | edge | Linked post `blogUrl` casing not normalised before push | low | reject | The query key and progress key use the post id; a cased blog URL only names the route. |
| 37 | edge | Post links can grow the stack | low | carried | As #14. |
| 38 | blind | `package-lock.json` missing from the review diff | false | reject | Excluded from the review diff on purpose; the ADR now states how it was checked. |
| 39 | blind | A post with only an external video gets the «Текст и фото» badge | low | reject | The badge rules are Story 3.x's; an external video is not playable in the app. |
| 40 | edge, blind | A late file E8 with a modal open is dropped silently | low | carried | As #21. |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- expected: clean.
- `npm test` ×3 -- expected: all pass.

**Result (after review loop 1, 2026-10-29):** lint, typecheck, check:fixtures clean; `npm test` ×3: 2101 passed each; `playerFlow` + `postFlow` + `src/features` + `src/shared/{entities,i18n,ui}` ×30: 972 passed each run, 0 failed runs. The installed release-like build has the timestamp chips but predates the loop-1 patches (host-tested only).
