---
title: 'Epic 8 retro A4: split __tests__/playerFlow.test.tsx'
type: 'chore'
created: '2026-10-31'
status: 'in-progress'
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
