---
title: 'Story 1.8: Focus map and spike decision'
type: 'chore'
created: '2026-10-26'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/claude-design-v1/docs/focus-map.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-boosty-tv-2026-10-25/EXPERIENCE.md'
  - '{project-root}/docs/testing.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** UI stories need one normative English focus contract (UX-DR20, AD-12: `docs/focus-map.md` must exist before the first UI story). The only focus table today is the Russian design focus map, and EXPERIENCE.md overrides parts of it. The spike results of stories 1.2–1.7 are spread across per-story sections of `docs/testing.md`, with no per-scenario verdict and no go/no-go report. Epic 2 cannot start without the owner's explicit go on that report.

**Approach:**
- Write `docs/focus-map.md` in English. Start from the design focus map. Apply every EXPERIENCE.md override and component rule, ADR 0007 (per-screen trap, explicit restoration by content id with scroll-into-view and the fallback chain), AD-12/AD-13 (focus ids, single FocusRestoration store, Back order), AD-20 (phase-flagged entry points) and the device facts learned in the spike. These facts: the physical remote delivers D-pad only as key up to `useTVEventHandler` and has no media keys; S11 found E18 reachable.
- Add a «Spike report (Story 1.8)» section to `docs/testing.md`. It lists S1–S11, each marked passed / failed / not verified / not run on the physical device, with emulator results labeled separately (none were used). It also lists blockers and fallbacks with their ADRs, open risks with the owning later story, and a go/no-go recommendation.
- Carry the deferred parity-evidence update (PLAY-01/03/04 from 1.6, POST-06/07 from 1.7) into `docs/feature-parity.md` evidence cells only.
- Present the report to the owner. Epic 2 starts only on their explicit go.

</frozen-after-approval>

## Implementation Notes

- Branched `docs/1-8-focus-map-and-spike-decision` from `docs/1-7-spike-results`, because PR #7 (Story 1.7 docs) is still open; the 1.8 PR is stacked on it. Sprint status for 1.7 stays `review` until PR #7 is merged.
- New `docs/focus-map.md`: global rules (input facts from the device, zones, per-screen trap, Back order, focus ids, restoration with the fallback chain, skeletons, phase gating, keyboard), then per-screen tables A1–A11, Shell (sidebar, B, C), D/E/F/G/H/I, J/K/L, and a verification-ownership table.
- Choices made here (not in either source): A2 initial focus is the number field, with ← to the editable country code; block-scoped focus ids use the block id instead of the handoff's index `<n>`; the quality-before-playback list (PLAY-02) and the recovering state got rows; held-key seek acceleration is marked unverified because the remote delivers key up only.
- `docs/testing.md`: new «Spike report (Story 1.8)» section before «Results» (scenario verdicts S1–S11 + library compatibility, blockers and fallbacks with ADRs, open risks with owner stories, recommendation, owner decision pending). The pinned-device «Remote» row now records that the remote has no media keys.
- `docs/feature-parity.md`: Live evidence appended to PLAY-01/03/04 and POST-06/07 (closes the 1.6 deferred parity-update entry, which the 1.7 review also pointed to; a resolution note was added to it); the "nothing verified live yet" sentence now points to the spike report.
- The header-profile fallback (S6) has no ADR yet; the report says so and puts the ADR before Story 2.2.
- After review: the report states that S7 and S9 do not meet the plan's passed/failed exit criteria and makes the owner's acceptance a Go condition; added a deliverables table (no ADR for the sign-in method, the video library or the refresh coordinator; no poll or live-200 fixture); Live notes extended to AUTH-03..07, POST-08, PLAY-10 and EVT-01 with a stated rule. The focus map got sign-in, dialog, period and player ids, block keys from the fixtures (`text`/`link`/`list` have no id), the AudioBlock ← exception, the AD-19 audio/video rule, settings submenu, diagnostics, system-player and update-notice rows, the A11 mid-session rule, a testable focus-entry key-up guard and a full verification-ownership table.
- Checks run: relative links in `docs/focus-map.md`, `docs/testing.md` and `docs/feature-parity.md` resolve; every story number cited in the report and in focus-map §6 exists in `epics.md`; fixture block-id facts computed from `src/test/fixtures/boosty/*.json`. No code changed, so lint/typecheck/tests were not run. No device check (documentation only).

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | S7/S9 «not verified» outside the plan's passed/failed exit criteria | medium | patch | Spike plan §3 and Story 1.8 AC; report now names the gap and makes owner acceptance a Go condition |
| 2 | Spike deliverables (ADRs, fixtures) not checked | medium | patch | `docs/adr/` has no sign-in, video-library or refresh ADR; no poll fixture; deliverables table added |
| 3 | Header-profile ADR untracked | low | patch | Linked to its deferred-work entry; made a Go condition |
| 4 | Two 1.7 deferred items missing from the risks | low | patch | Rows added (signedQuery vs profile, `video` block) |
| 5 | Deferred parity entry not closed; PLAY-10 left out | low | patch | Note added to the 1.6 entry; PLAY-10 Live note |
| 6 | Uneven Live marks in feature-parity | low | patch | Rule stated; AUTH-03..07, POST-08, EVT-01 marked |
| 7 | IA coverage gaps (system player, update notice, diagnostics, submenus, J→live, A11 mid-session) | medium | patch | Rows and paragraphs added; update-notice focus left to Story 9.2 (non-blocking per its AC) |
| 8 | Missing or relative focus ids | low | patch | Ids added and spelled out; `filters/tags/load-more` |
| 9 | AudioBlock ← conflicts with the post column rule | medium | patch | Exception stated: ↑ ↓ leave the block |
| 10 | Focus-entry key-up rule untestable | medium | patch | Rewritten as a direction + time-window guard measured in 4.1/6.4 |
| 11 | Up/down and key-repeat measurement unowned | low | patch | Assigned to 4.1 and 5.4 |
| 12 | Audio vs video ordering undefined | medium | patch | AD-19 rule in the Post section |
| 13 | Verification ownership partial | low | patch | Table covers every section |
| 14 | Own choices not marked as such | low | patch | Marked «Story 1.8 decision» / «row added in Story 1.8», EXPERIENCE sources cited |
| 15 | Fallback key for id-less blocks undefined | medium | patch | Fixtures show `text`/`link`/`list` have no id; `<type>@<index>` rule |
| 16 | No verification record in the spec | low | patch | Checks-run note above; owner outcome is recorded after the presentation |
| 17 | Sign-out row omits the stored phone and FocusRestoration | low | patch | Row completed |
