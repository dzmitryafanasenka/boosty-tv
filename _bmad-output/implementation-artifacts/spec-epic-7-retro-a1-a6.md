---
title: 'Epic 7 retro follow-ups A1 and A6'
type: 'bugfix'
created: '2026-10-30'
status: 'done'
route: 'oneshot'
baseline_commit: '519868a7648d0e08c94aa2acd8fcedbd0cd2e99a'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-retro-2026-10-30.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Epic 7 retrospective (`epic-7-retro-2026-10-30.md`) found three issues:
- **F1/F2.** A like's settled overlay is dropped only when the page's `stream` reference changes. If an E15 poll during E17 already carried the like (with a newer count), the success write produces deep-equal data. TanStack's structural sharing then keeps the object, so the stale optimistic count (358 instead of 400) sticks.
- **Heartbeat log.** The heartbeat warning logs `kind: 'Unknown'`, which is not an `AppErrorKind`.
- **A6.** The device rules live only in agent memory, not in `docs/testing.md`.

**Approach:**
- **A1.** After the success write, if the query value did not change, drop the overlay at once; otherwise keep the settled overlay until the page sees the write (no frame with the old value). Add an `authorFlow` test.
- The heartbeat falls back to `'Client'`, as the like and the media resolver do.
- **A6.** Add a «Device rules (agent over adb)» section to `docs/testing.md`.

Owner decision (2026-10-30): A1 and A6 in one PR.

</frozen-after-approval>

## Implementation Notes

- **`src/features/author/useLiveLike.ts`.** On success, check the cached value before the relative `setQueryData`. The overlay is deleted at once when nothing changes for the page: the cached stream already has the target `isLiked`, or it is another stream, or there is none. This is a value check, so it does not depend on structural sharing. Otherwise the overlay is marked settled, as before. The hook and field doc comments are updated.
- **`src/features/player/useLiveHeartbeat.ts`.** The kind fallback is now `'Client'`.
- **`__tests__/authorFlow.test.tsx`.** Two new tests, both red on the unfixed hook:
  - like: a poll mid-flight already says liked, 400 → after E17 200 the label shows 400; a later poll (410) shows at once, so no overlay is left;
  - unlike: a poll mid-flight already says not liked, 300 → the label shows 300.
- **`docs/testing.md`.** New «Device rules» section covering the foreground check, a screenshot before each OK, the owner-content progress threshold (`epic-6-retro-item-32`), outward actions, and secrets in probes.
- **Traceability.** The heartbeat kind fix is part of `epic-7-retro-item-33` (A1 lists it). The device-rules section is `epic-7-retro-item-38` (A6) and covers `epic-6-retro-item-32`.
- **Rebase.** Rebased onto `main` after PR #72 (the retro) merged.
- No device run, by design (host-only fix).

## Review Triage Log

Blind Hunter:
- **Retro file and sprint items missing.** **False** after the rebase onto `main` (PR #72).
- **Stale `Overlay.settled` doc.** **Low**, patched.
- **Early drop depends on structural sharing.** **Medium robustness**, patched: a value check.
- **Comments narrower than the code.** **Low**, patched.
- **Test gaps (unlike direction, no overlay left behind).** **Low**, patched. The cache assertion is kept as context; the label assertion proves the fix.
- **The heartbeat `'Client'` fallback is untested.** **Low, rejected:** a one-word fallback, the same as the like and the resolver.
- **No threshold value in the rules.** **Low**, patched: 10 s or any pause, `WRITE_MOVEMENT_SEC`.
- **Commands not concrete.** **Low**, patched: `adb shell` prefixes, the package name, the screencap/uiautomator commands, the bundle grep.
- **Spec framing.** **Low**, patched: the traceability line.
