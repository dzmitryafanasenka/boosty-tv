# Epic 10 Context: Player improvements (backlog, our improvements)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Add player features the owner asked for beyond BoostBuddy parity, planned after the 1.0.0 release (Epic 9). The first one shows a post's timestamps as YouTube-style chapter marks on the built-in player's timeline, so a family member can see how a long video is structured and jump to a part with the remote. None of this is a parity obligation. Every item must be labelled as our improvement in the docs, and none may change existing player behaviour where the feature does not apply.

## Stories

- Story 10.1: Chapter marks on the player timeline

## Requirements & Constraints

- Marks appear only for timestamps inside the playing video's duration. Timestamps outside it are ignored.
- While the controls are shown, the current chapter's name sits next to the elapsed time. During a D-pad scrub, the name follows the pending position. Seek behaviour itself does not change.
- Next/previous chapter seeks to the chapter's start. Progress is written by the usual rules: E9 after ≥ 10 s of movement, forced on pause, background, exit and end; a short visit (< 10 s, no pause) writes nothing; a seek away from a start overwrites the resume point once playback has moved ≥ 10 s, as with the Story 6.3 timestamp start.
- Do not add new focusable controls unless the owner approves them. Pick the chapter keys at spec time from the pinned remote.
- A video with no timestamps, a live stream, or the system video player (external handoff) shows no marks and no names, and nothing else changes.
- Open before the spec:
  - How a timestamp names its chapter: the link text or the line it sits on. The live link text contains the `m:ss` / `h:mm:ss` time; where the name comes from is not settled.
  - Which timestamps belong to which video in a multi-video post. `tmid` names the target video, but only 1 two-video post was seen live.
  - Whether timestamps exist in any form other than the known link shape.
- Never log a URL, id or title in any probe or diagnostic. Use shapes and counts only, in a temporary `__DEV__` probe that is removed before the commit (the Story 6.3 method).

## Technical Decisions

- The live timestamp format is known from Story 6.3: `https://boosty.to/<blogUrl>/posts/<postId>?t=<int seconds>&tmid=<ok_video id>`. These are `link` blocks, usually after a «Таймкоды» text. Of 1 327 live links, 1 304 point at a video of the same post; 23 point at another post. `t` is whole seconds and matches the time in the link text in 1 326 of 1 327 cases; when they differ, `t` wins.
- `shared/entities/externalUrls.timestampRef` already recognizes this shape: current post (blog compared case-insensitively), digit-only `t`, and `tmid` equal to one of the post's `ok_video` ids. The parsed result is `ParagraphLink.timestamp`. Reuse it; do not write a second parser.
- The Player already has a `PlayerStart` `{atSec}` option, clamped to the last second through the start gate. Route param: `start: {atSec}`.
- Positions and durations are integer seconds above `PlayerEngine`. Media identity is `MediaRef {blogUrl, postId, mediaId}`. Never use indices or URLs as keys, and never put signed URLs in route params or persisted state.
- Domain types carry no raw DTO fields. Parse defensively: a missing or odd timestamp must not break the post or the player.
- ProgressRepository is the only writer of E9 and the local history. A chapter jump goes through normal engine seeks.
- Player code layout: `PlayerScreen.tsx` only wires and renders. `usePlayerFocus.ts` handles focus per phase. `usePlayerKeys.ts` handles the entry guard, raw keys, native seek keys and Back layers. `seekController.ts` handles seek steps, the pending target and the bubble. `playbackMode.ts` holds the live vs. VOD differences. `usePlayerSettings.tsx` holds the sheet.
- Only `shared/platform` touches `NativeModules`. D-pad handlers are allowed only in the player, the period stepper and the audio block.

## UX & Interaction Patterns

- Overlay bottom band: Timeline (accent progress, thumb, thicker when focused, a bubble with the target time while seeking), then elapsed / remaining in tabular figures, then the controls row: −10 · play/pause · +10 · gear. Live has no track. Marks and the chapter name must fit this band without reflowing it. Use tokens only: no raw size or colour literals outside `src/shared/ui/tokens.ts`.
- Remote facts for choosing keys: the pinned Chromecast with Google TV remote has D-pad, OK, Back, Home and voice, with **no media keys and no Menu/Info**. React Native delivers D-pad events to JS only as key up. Holds use the native `SeekKeys` path.
- D-pad already in use on the player:
  - ← → seek: 5 s, accelerating; a hold-scrub pauses and waits for a commit.
  - ↑ ↓ show the overlay; ↓ moves from the timeline to the controls; ↑ moves back to the timeline.
  - OK toggles play/pause or commits a pending seek.
  - Back order: settings submenu → sheet → chapter strip (Story 10.1) → pending held seek → overlay → exit.
- Media key mapping (`next` / `previous`) exists but is unverified on the device.
- The settings sheet blocks every player key while open. The overlay never auto-hides during a pending scrub.

## Cross-Story Dependencies

- Builds on Story 6.3 (timestamp chips and `{atSec}` start), Story 4.1/4.3 (seek controller, controls row, native seek keys), Story 4.2 (progress rules), Story 7.2 and the live/VOD split (live mode has no timeline), and Story 8.2 (the system player bypasses the built-in timeline).
- Update `docs/focus-map.md` (player rows), `docs/feature-parity.md` (an "our improvement" row) and `docs/testing.md` (device checks), and update the wiki after the story.
