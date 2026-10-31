---
title: 'Epic 8 retro A2: reconcile planning and parity docs to the Epic 8 as-built'
type: 'chore'
created: '2026-10-31'
status: 'done'
route: 'oneshot'
baseline_commit: '29c00d1f772528c916c981bc8c34448276e5ed02'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-retro-2026-10-31.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The planning docs still describe Epic 8 as planned, not as built. `epics.md` 8.2/8.3 say "Android chooser" and "internal storage". `epic-8-context.md` names `shared/platform/android`. `ARCHITECTURE-SPINE.md` AD-2 names a directory that never existed, AD-4 lacks the new device keys, and AD-14 says internal storage. `docs/feature-parity.md` PLAY-07 and PLAY-13 say "device: pending (owner)", although `docs/testing.md` records the device runs (Epic 8 retro A2, `epic-8-retro-item-40`).

**Approach:** One docs-only pass in the Epic 7 A3 style:
- the original text stays, and an *As built* note naming its evidence follows it;
- the per-port error rule and the `logFile` fail-closed note go in the spine (AD-2, AD-4);
- no code, no tests, no sprint status.

</frozen-after-approval>

## Implementation Notes

- `epics.md`: As built notes on FR50, Story 8.2 and Story 8.3.
- `ARCHITECTURE-SPINE.md`:
  - AD-2: flat port and adapter files, direct use from screens, per-port error contracts;
  - AD-4: the device keys, plus `logFile` fail-closed and not flag-gated;
  - AD-14: the external files dir and the redaction additions;
  - the diagram node renamed to `shared/platform adapters`.
- `epic-8-context.md`: an "As built" section.
- `docs/feature-parity.md`: PLAY-07 and PLAY-13 device status per `docs/testing.md`. The PLAY-13 notice wording now matches the code (X4); A5 will change the behaviour.
- After review: `docs/testing.md` Story 8.2 notice wording; `feature-parity.md` SET-05 (the A1 code rule, `challenge`) and PLAY-07's full not-checked list; `docs/focus-map.md` row K; PRD PLAY-13 line; ADR 0006 adapter path; inline pointers in `epic-8-context.md`; the `logFile.ts` header comment (its only users). X4/A5 refer to `epic-8-retro-2026-10-31.md` (X4: the fallback notice stays on every overlay show; A5: diagnostics polish).
- Verification: each note was checked against `src/` (`grep NativeModules src/shared/platform`, `logFile.ts`, `transport.ts` `logPath`, `logger.ts`, `bootstrap.ts`), `android/` (`ExternalPlayerModule.kt`) and `docs/testing.md`; `eslint src/shared/platform/logFile.ts` clean (comment-only code change).

## Review Triage Log

Blind Hunter (1 layer, oneshot); all checked against the code:

| # | Finding | Verdict | Route |
|---|---------|---------|-------|
| 1 | AD-2 NativeModules file list wrong (`appLifecycle` no; `deviceId`, `secureStore` yes) | medium | patched |
| 2 | AD-2 "one flat file per port" not general (KeyValueStore, PlayerEngine split; ports missing) | medium | patched |
| 3 | AD-2 direct adapter use understated; old rule not marked superseded; `logFileSink` AppState exception unmentioned | medium | patched |
| 4 | `logFile` contract incomplete (`location()` never rejects) | low | patched |
| 5 | `logFile.ts` header says only `logFileSink` uses it | low | patched |
| 6 | Two-step ExternalPlayer port (`prepare`/`launch`, pop first) not described | medium | patched (epics 8.2, context) |
| 7 | FR50/8.2 merge two device observations | low | patched |
| 8 | AD-14 path masking understated (`<seg>`) | low | patched |
| 9 | AD-14 hides free-text `code=` redaction and `challenge` scope | medium | patched (Epic 9 note: version code in a field) |
| 10 | SET-05 still says `code` contained → redacted | medium | patched |
| 11 | PLAY-07 not-checked list shorter than testing.md | medium | patched |
| 12 | testing.md 8.2 notice wording contradicts code | low | patched |
| 13 | PRD, focus-map K, ADR 0006 still stale | low | patched (EXPERIENCE.md already had an As built note) |
| 14 | AD-4 fail-closed note lacks consequence and scope | low | patched |
| 15 | epic-8-context lacks inline pointers and device coverage | low | patched |
| 16 | Spec gaps | low | patched here |

