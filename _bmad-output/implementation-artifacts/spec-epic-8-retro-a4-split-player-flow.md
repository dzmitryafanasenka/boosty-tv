---
title: 'Epic 8 retro A4: split __tests__/playerFlow.test.tsx'
type: 'chore'
created: '2026-10-31'
status: 'done'
route: 'dispatch'
baseline_commit: '203804003e21de25ebde1f0cbbcb6bc60f019a1e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-retro-2026-10-31.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `__tests__/playerFlow.test.tsx` has 4415 lines and 192 tests. Every player story since 4.1 added to it, including 8.2's hand-off, while 8.3 got its own flow file (Epic 8 retro S1/A4, `epic-8-retro-item-42`).

**Approach:** Move the shared harness into a test helper. Split the file by story area into several flow test files. Every test keeps its exact name and body: the move is mechanical and adds no new assertions.

## Boundaries & Constraints

**Always:**
- The same 192 tests pass, with identical full names (the `describe` path plus the test name). I compare the sorted name list before and after. The before list is `/private/tmp/claude-501/-Users-dzmitryafanasenka-Documents-Projects-js-boosty/d998e7e2-636f-4943-a058-23b274887697/scratchpad/pf-before-names.txt`.
- The shared setup (constants, fixtures, the `createFlow` instance, the mutable E8/E9/E15/E16 handlers, `beforeEach`/`afterEach`, helpers such as `failPastRecovery`) moves to `src/test/playerFlowHarness.tsx`.
  - It registers the hooks through one exported function (for example `usePlayerFlowHarness()`), called at the top of each file.
  - Mutable handlers are reached through setters or a returned object, not reassigned imports.
- `jest.mock(...)` calls must stay at the top of each test file, because babel-jest hoists them only there. Repeat the same mock block in each file.
- Target files, each a coherent area:
  - `playerFlow.test.tsx` (open, errors, overlay/keys/seek, arbiter, the 4.1 review fixes, 6.3 timestamps);
  - `playerProgressFlow.test.tsx` (4.2);
  - `playerQualityFlow.test.tsx` (4.3);
  - `playerRecoveryFlow.test.tsx` (4.4, the debug broken URL, 4.6 sleep/audio focus);
  - `liveFlow.test.tsx` (7.2);
  - `playerSpeedFlow.test.tsx` (8.1);
  - `externalPlayerFlow.test.tsx` (8.2).
- Doc references to `playerFlow` «Story X» are updated to the new file names: `docs/testing.md`, `docs/feature-parity.md`, and spec Implementation Notes are not edited.

**Never:**
- No change to production code.
- No renamed, merged, deleted or rewritten tests, and no new tests.
- No weakening of the mocks.

</frozen-after-approval>

## Code Map

- `__tests__/playerFlow.test.tsx` l.1-300 -- the harness: imports, `jest.mock` block (l.78-92), `createFlow` (l.96), constants and fixtures (l.103-175), `beforeEach` (l.176), `afterEach` (l.224), helpers (l.245-300). The describes start at l.301 (4.1), 343, 417, 562, 661, 1393, 1441, 1545 (4.2), 1866 (4.3), 2304 (4.4), 2688 (debug), 2740 (4.6), 2895 (6.3), 2969 (7.2), 3691 (8.1), 4057 (8.2).
- `src/test/flow.tsx`, `src/test/playerEngineMock.tsx` -- existing helpers to reuse.
- `__tests__/diagnosticsFlow.test.tsx` -- an example of a separate flow file.

## Tasks & Acceptance

**Execution:**
- [x] `src/test/playerFlowHarness.tsx` -- the shared harness.
- [x] The seven test files -- the describes moved verbatim.
- [x] Docs -- references updated.

**Acceptance Criteria:**
- Given the split, when `npx jest` runs the seven files, then exactly the 192 tests listed in the before file pass with identical full names.
- Given the full suite, then the total test count is unchanged (3104) and lint and typecheck are clean.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npx tsc --noEmit && npm test` -- expected: clean, 3104 passed.

## Implementation Notes

- Split commit `7be0ce2`: `src/test/playerFlowHarness.tsx` plus seven files (68 / 13 / 19 / 27 / 33 / 15 / 17 tests). Test bodies are byte-identical apart from the `handlers.` prefix on the mutable E8/E9/E15/E16/transport handlers.
- Verification (coordinator): the sorted full names of the seven files equal the pre-split list (192; the SHA-256 prefix is recorded in `docs/testing.md`); lint and typecheck clean; `npm test` ×3: 3104 passed; the seven files ×30: 0 failed runs.
- Review patches: a double-registration guard in `setupPlayerFlowHarness`; the `playerFlow.test.tsx` header (scope and split note); `docs/testing.md` (scope incl. 4.5 and Epic 3 A6, a missed 4.2 reference, historical names marked «now `X`», the seven-file command, the name-list hash).

## Review Triage Log

Blind Hunter (1 layer):

| # | Finding | Verdict | Route |
|---|---------|---------|-------|
| 1 | `handlers` reachable both as an export and as the return value | low | Harmless; rejected |
| 2 | No guard against registering hooks twice | low | patched (throws) |
| 3 | The seven `jest.mock` copies are not checked for drift | low | Adds assertions beyond scope; rejected |
| 4 | `handlers.transport` starts as a cast `undefined` | low | Unchanged from the single file; rejected |
| 5 | The A6 describe keeps its own transport routing copy | low | Pre-existing, moved verbatim; rejected |
| 6 | No `afterEach` unmount of roots after an early failure | low | Pre-existing behaviour; rejected (a test change beyond scope) |
| 7 | Exported `URL`/`BACK` names | low | Renaming would edit test bodies (spec: verbatim); rejected |
| 8 | `playerFlow.test.tsx` header not updated | low | patched |
| 9 | Scope summary omits 4.5 and Epic 3 A6 | low | patched |
| 10 | Missed 4.2 reference in `docs/testing.md` | low | patched |
| 11 | Historical entries mix old and new file names | low | patched («now `X`») |
| 12 | No reproducible seven-file command | low | patched |
| 13 | Spec open; evidence only in the scratchpad | low | patched (hash and count in docs; status done) |

