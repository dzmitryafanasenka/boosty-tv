# Epic 6 Context: The complete post (P2)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn the Post screen built in Epic 3 (header on top, MediaRows, paragraph focus stops, inline links as plain text, neutral placeholders for every other block) into the complete reference post: styled text with inline emoji, inline images, QR chips for links, files and external (YouTube) video, an inline audio player, and polls that can be voted on and retracted. This closes the content part of BoostBuddy parity (POST-02, -03, -05, -06, -07; POLL-01..05). Comments stay excluded everywhere. Every remaining placeholder in an accessible post gets a real renderer, but unknown or malformed blocks must still degrade to a placeholder and never crash.

## Stories

- Story 6.1: Rich text, emoji and long posts
- Story 6.2: Images in posts
- Story 6.3: Links, files and external videos via QR
- Story 6.4: Inline audio
- Story 6.5: Poll display
- Story 6.6: Vote and retract in a single-choice poll
- Story 6.7: Multiple-choice poll

## Requirements & Constraints

- **Rich text:** `text`, `link` and `smile` fragments merge into one paragraph until `BLOCK_END`. `content` is a JSON string `[text, ?, [[style, from, len], …]]`. Style codes: 0 = bold, 2 = italic, 4 = underline. Any other code renders as normal text. A `content` that is not a JSON array renders as raw text. Emoji render inline at text size, and a missing emoji image must not break the paragraph. Live (Story 6.1): a range's `from` counts from the start of the paragraph (UTF-16 code units), not the fragment; each fragment's ranges are placed at its paragraph offset and clamped to that fragment. A `smile` is assumed to take one offset unit (unverified live: no smile seen). Story 6.3 must keep these offsets when it adds link chips.
- **Images:** shown inline, keeping their aspect ratio, max height 300 dp. Show a skeleton while loading. A failed image shows «Изображение недоступно», and the rest of the post is unaffected. Use a plain `{uri}` source with no auth headers.
- **Links, files, external video:** each opens a QrDialog («Откроется на телефоне»). The owner approved QR for all three. A file shows its title and size. An external `video` shows a YouTube thumbnail when the host is YouTube and is never played in the app. The file URL is `url + Post.signedQuery`. The signed query carries the account's user id, so the QR target is personal data. It is generated on the device, held in memory only, and never printed in full, logged, persisted or put in fixtures. Only lengths or shapes may be logged.
- **Audio:**
  - Play and pause; seek ±10 s. Shows title, position / duration and a thin progress bar.
  - The source is `url + signedQuery`, through `PlayerEngine`.
  - Only one playback app-wide: starting a video or another track stops the current one.
  - Leaving the post stops audio. Audio-focus loss pauses it and never auto-resumes.
  - Audio position is never persisted.
  - The reference also holds a wakelock during playback and pauses on "audio becoming noisy".
- **Polls:** show the title, options with result bars and percentages, the voter count («Проголосовал: N»), the user's choices (`answer`) and the finished state («Опрос завершен»). Results are visible before voting.
  - Single choice: vote (E11) or retract (E12). Each needs two OK presses on the same option (pending, then confirm). Moving focus cancels pending. This deliberate confirmation is our improvement: the reference votes on one click.
  - Multiple choice: OK toggles checks. «Проголосовать» is focusable only when at least one option is checked, and sends every checked id comma-joined. After a vote, the poll shows results with «Отозвать голос» (two OKs).
  - After every successful mutation, re-fetch the poll with E10. The E11 and E12 bodies are ignored.
  - On failure, show an inline error and keep the previous state. Never retry automatically; allow at most one request in flight per poll. The reference ignores errors silently, and we must not.
- **Unverified on the device (as of the audit):** no live `audio_file` or `file` sample was found. Audio playback, file-QR opening and `signedQuery` expiry enforcement rest on reference code only. Its `expire_time` is 24 h. No poll sample was observed live either. Each story must state what it verified on the device versus with fixtures, and must not claim device verification it did not do.
- **Tests:** a text parser with fixtures (styles, unknown codes, non-JSON content); poll mapping and mutation rules (no blind replay, single flight); a single-active-track rule; component tests for every PollOption state, image failure, and QR focus trap and return.

## Technical Decisions

- **Boundaries:** post blocks live in `features/post`. PollWidget is exported from `features/polls/index.ts`, and AudioBlock from `features/player/index.ts`. `post → polls` and `post → player` are the only allowed cross-feature edges, enforced by eslint boundaries. Neither `features/polls` nor `entities/poll` exists yet.
- **Poll state:** there is no separate poll query key. The `poll` inside cached Posts is the single source. After E10, one helper, `entities/poll.applyPoll(pollId, poll)`, writes it into every cached post and page that contains the poll. Mutations follow the retry policy: no automatic retry, one in flight per entity.
- **Poll shape:** `{id, title[] (joined for display), isMultiple, isFinished, counter, answer[], options[{id, text, counter, fraction}]}`. Domain ids are strings. The reference drops a poll that lacks `id`, `isMultiple`, `isFinished`, non-empty `options`, or `counter`/`fraction` on an option. Our mapper should degrade to a placeholder, not crash.
- **External URLs:** `shared/entities/externalUrls.ts` builds every QR target (file, link, YouTube; later the stream page and the release page). The QR is rendered behind the `QrRenderer` platform port. `react-native-qrcode-svg` 6.3.27 was proven in the spike (200 dp, `ecl="M"`, white quiet zone), but it is not in the production `package.json` yet.
- **Signed query:** today the post DTO deliberately never parses `signedQuery` into the domain Post. Audio and file must read it beside the mapper, like `playerUrls`, and keep it in memory only. Until the audio/file host behavior is verified, follow the `ok_video` rules: fetch the post with the content (reference-like) profile, send no Boosty `Authorization` to the media host, and re-resolve once via E8 (same block id, else the same `url`) after a player error.
- **PlaybackArbiter** already exists, as built, in `src/shared/platform/playbackArbiter.ts` (the architecture text places it in `shared/services`). AudioBlock claims the slot and releases it on unmount. Audio-focus loss comes through `AppLifecycle` / `PlayerEngine`.
- **Focus ids:** `post/<postId>/block/<blockKey>`, where `<blockKey>` is `<type>:<id>` when the block has an id and `<type>@<index>` otherwise. Poll ids are `post/<postId>/poll/option/<optionId>`, `/poll/submit` and `/poll/retract`. The QR close button is `dialog/qr/close`. Never use an index when an id exists.
- **Other rules:** no new endpoints beyond E8 and E10–E12. Use tokens from `shared/ui/tokens.ts` (`poll-option`, `link-chip` with height 32 and a «QR» suffix, `qr-dialog` with qrSize 200 on `qr-bg`). Russian copy goes in `ru`. Images use RN `Image` with `resizeMethod="resize"` and `fadeDuration={0}`.

## UX & Interaction Patterns

- **Layout:** the Post screen is one scrolling column (owner decision 2026-10-27), not the two columns in older text.
  - Order: header, MediaRows, then the body.
  - Body text is capped at `text-measure` (600 dp). «Right-column width» in the story text means the column / text-measure width, as for teaser images.
  - The header and the rows may use the full content width.
- **Native focus only:**
  - ↑ ↓ walk the author, then the primary, then the rows, then the blocks.
  - ← from the first item of an element goes to the sidebar's current item.
  - ← → move inside a row: link chips, poll buttons.
  - Raw D-pad handling is allowed in AudioBlock only. There, ← → seek instead of reaching the sidebar.
  - AudioBlock must ignore the first key up in the direction of the focus move that landed on it. The story measures the time window on the device.
- **Focus stops:**
  - Every paragraph is a ParagraphStop: a `surface` background and a 2 dp accent bar, no scale.
  - Long paragraphs split at 600 characters so ↓ reaches the whole text.
  - ImageBlock, LinkChip, AudioBlock and PollOption are stops.
  - A finished poll is one stop.
  - LikeCount is not focusable. There is no comment counter.
- **Inline links:** as built, link text stays in the paragraph as plain text. Story 6.3 adds a LinkChip under the paragraph the link comes from, with OK opening the QR. A link without text is skipped.
- **QrDialog:**
  - It renders in the single modal host and traps focus.
  - «Закрыть» or Back closes it, and focus returns to the chip that opened it.
  - Back order is the modal first, then the stack.
- **Polls:**
  - No option is focused on entry: the normal ↓ reaches the options. For a multiple-choice poll, focus lands on the first option on entry from above.
  - Focus stays on the option through the whole vote flow.
  - PollOption states: default, chosen (accent check), pending (pulsing outline plus «Нажмите OK ещё раз», or «… чтобы отозвать»), sending (spinner), finished, and inline error.
- **Refetch:** image loading and refetch never move focus. If the focused element disappears, focus goes to the initial element.
- **Initial focus is unchanged:** the primary («Смотреть»/«Продолжить») on a post with video, else the first focusable block, else the author. On a locked post, focus starts on the author.
- **Locked posts:** they keep the Story 3.6 behavior: copy plus teaser, teaser images non-focusable and capped to fit the screen.
- **Leaving the post** while audio plays stops the audio. Opening the Player from the post also stops it, and it does not resume on return.

## Cross-Story Dependencies

- **6.1 and 6.3 share the paragraph builder.** 6.1 adds styles and emoji to the as-built merge-and-split logic. 6.3 then turns the link fragments into chips under the paragraph and keeps the link text inline. The 600-character split must keep working with styled spans.
- **6.3 introduces shared pieces** that 6.4 and Epics 7 and 9 reuse: QrDialog, `QrRenderer`, `externalUrls` and the in-memory `signedQuery` reading. Story 7.4 (stream share) and Story 9.2 (release page) also use QrDialog.
- **6.4 depends on Epic 4's `PlayerEngine` and PlaybackArbiter**, and on reading `signedQuery` (shared with 6.3).
- **6.5 creates `features/polls`, `entities/poll` and `applyPoll`.** 6.6 and 6.7 build on them, and 6.7 reuses 6.6's pending/confirm and single-flight logic.
- **A deferred item lands here:** PostCards for polls and files without a preview should show the author avatar on a plate. Fold it into 6.3 or 6.5.
- **Docs to update:** `docs/feature-parity.md` (Android evidence for POST and POLL rows), `docs/focus-map.md` §4 F/H/I, and `docs/testing.md` with device rows.

## Contradictions and open points (as-built and owner decisions win)

- **Collapse vs. focus stops:** Story 6.1 and the UX state table ask for long text «collapsed with an expand action». As built (owner decision A, 2026-10-27), every paragraph is already a focus stop with no collapse. Confirm with the owner whether collapse is still wanted, or whether 6.1 keeps the as-built stops.
- **Column layout:** Story 6.2 and the DESIGN ImageBlock say «full right-column width». The single-column layout replaced that, so use the column / text-measure width.
- **Poll refresh:** FR41 and the focus map say the poll is re-fetched (E10) after a vote. Story 6.6's wording «E10 returns the updated poll» means the same sequence: E11/E12, then E10, then `applyPoll`.
- **Where the poll lives:** the API contract models the poll as top-level `Post.poll`, but the current DTO also knows a `poll` *block* type. No live poll sample exists, so verify which shape real posts use.
- **Unverified audio, files and polls:** no live sample exists. Audio, file and poll stories may only be verifiable with fixtures and the demo unless a sample post is found. The owner's rule is auto-scan only.
- **Signed query policy:** reading `signedQuery` changes a documented DTO rule ("never parsed into the post") and needs a deliberate, tested in-memory path.

## As-built reconciliation (2026-10-31)

Epic 6 is done. Where this context differs from the as-built, the as-built wins. Sources: Epic 6 retro A5, closed by Epic 7 retro A3 (`spec-epic-7-retro-a3-planning-reconcile.md`).

- **Collapse vs. focus stops:** resolved. There is no collapse (Story 6.1, owner decision 2026-10-29 Q1 a). Every paragraph is a stop, and a paragraph over 600 characters is split.
- **Column layout:** images use the one column's width, capped at `text-measure` and 300 dp tall. A focused image gets the ring with no scale (Story 6.2).
- **QR:** `react-native-qrcode-svg` is pinned at **6.3.26**, not the spiked 6.3.27, under the two-week age rule (ADR 0014). `react-native-svg` is 15.15.5 (ADR 0013).
- **Chips** (Story 6.3, owner decisions 2026-10-29): a Boosty post link opens the post in the app («· Открыть»). A timestamp link plays the video at that second («· Смотреть»). `header` blocks render as non-focusable headings.
- **Where the poll lives:** live posts carry the poll top-level only, so it renders after the body (Story 6.5, `docs/focus-map.md` I).
- **Poll interaction:**
  - In a single-choice poll, two OK presses on another option change the vote (Story 6.6 Q1 a).
  - A failed vote or retract shows one line per mutation, whatever the error kind. This is an accepted exception, recorded in ARCHITECTURE-SPINE AD-5.
  - `usePollVote`'s generation-keyed in-flight state is the AD-4 exception, now through `src/shared/account/generationKeyed.ts`.
- **Live samples:** audio and file blocks were found live in Stories 6.3 and 6.4 (api-contract §4.1), and so was one single-choice poll. No multiple-choice sample exists.
- **The deferred PostCard item:** the avatar-on-a-plate placeholder for cards without a preview landed separately (`spec-post-card-no-preview-placeholder.md`, 2026-10-30).
