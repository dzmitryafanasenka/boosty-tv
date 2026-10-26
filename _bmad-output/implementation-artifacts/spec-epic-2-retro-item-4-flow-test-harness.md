---
title: 'Epic 2 retro item 4: shared flow-test harness'
type: 'refactor'
created: '2026-10-26'
status: 'done'
baseline_commit: 'fd09dbe049708cecda17e9f61a2f823e65f0632d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-retro-2026-10-26.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 2 retro finding A1 (action item 4): every flow test copies its own harness — the BackHandler mock, `settle()`, keychain mock helpers, FixtureTransport/native-module setup and the render/press/focus query helpers. The copies have already drifted (2.8 had to fix stacked `track()` wrappers), and Epic 3 will add many more flow tests.

**Approach:** Extract one test-only harness under `src/test/` and move the existing flow tests onto it, with no change to what any test asserts. New stories must reuse it.

## Boundaries & Constraints

**Always:**
- Pure test refactor: no file outside `src/test/` and the test files listed in the Code Map changes. The test count (649 at `fd09dbe`) and every test name stay the same.
- Each file keeps its current timing semantics. The copies differ on purpose (rounds 2/20/30; timers run every round, only the first 2 rounds, or not at all — e.g. `codeFlow` must not run the resend countdown down by accident). The harness parameterizes these; each file passes its own profile.
- Harness code lives only in `src/test/` (eslint element type `test`; app/features/shared already may not import it).
- Story-specific helpers stay local: route handlers, fixture constants, `track()` in `accountSwitchFlow`, AppState capture, `TVFocusGuideView` mock in `shellFlow`, `advance()`/`resendInText()` in `codeFlow`.

**Never:**
- No change to production code, `__mocks__/react-native-keychain.js`, jest config or `sessionRefresh.test.ts` (a unit test with no render).
- No global auto-mock of BackHandler (root `__mocks__` for a deep RN path would silently apply to every suite); each file still opts in with `jest.mock`.
- No assertion weakened, removed or rewritten to fit the harness.

</frozen-after-approval>

## Code Map

- `__tests__/{signInFlow,codeFlow,shellFlow,sessionFlow,expiredFlow,signOutFlow,accountSwitchFlow,demoFlow}.test.tsx` -- each defines its own BackHandler factory (all but `sessionFlow`/`demoFlow`), `settle`/`flush`, `renderApp`, `unmount`, `byTestId`, `visible`, `one`, `focusOn`, `press`, `type`, `submit`, `back`, `lastFocusTarget`, `topScreen`, `text`, `focusableIds`, keychain reset/seed in `beforeEach`, `native.AppInfo`/`InstallId` setup, `globalThis.fetch = createFixtureTransport(...)`.
- `src/shared/focus/__tests__/ModalHost.test.tsx` -- BackHandler factory copy (L10–40), plus a second `jest.requireMock` at L266.
- Drift to preserve: `one()` filter is `focusable === true` (shell, session), `=== true || onChangeText` (most), `!== undefined || onChangeText` (`codeFlow`, which finds disabled buttons). `press()` focuses first except in `codeFlow`/`signInFlow`. `text()` in `shellFlow` also accepts a node.
- `src/shared/api/fixtureTransport.ts` -- `createFixtureTransport`, `FixtureRequest`/`FixtureReply`; reuse, do not change.
- `src/shared/ui/requestHostFocus` -- mocked per file; the harness imports it and reads the mock's calls.
- `__mocks__/react-native-keychain.js` -- `__values`, `__reset`, `__failNext`; the harness only types and resets it.
- `.eslintrc.js` L55/L87 -- `src/test` is the `test` element; nothing to change.

## Tasks & Acceptance

**Execution:**
- [x] `src/test/backHandlerMock.ts` -- the BackHandler mock module (handler stack, `addEventListener`/`remove`, `pressBack`, `exitApp` jest.fn), default-exported as in the copies -- one source for `jest.mock('react-native/Libraries/Utilities/BackHandler', () => require('<rel>/src/test/backHandlerMock'))`.
- [x] `src/test/flow.tsx` -- `settle({rounds, timerRounds})`, `render(element, settleOpts)`, `unmount`, node queries (`byTestId`, `visible`, `one` with a filter option, `focusOn`, `press` with focus/settle options, `type`, `submit`, `back`, `focusableIds`, `text`, `topScreen(root, ids)`, `lastFocusTarget`), keychain helpers (`keychain()` typed accessor, `resetKeychain(seed)` that resets and clears the three mocks), `installFixtureTransport(handler)` and `installNativeModules({...})`/`clearNativeModules()` -- the shared harness.
- [x] the 9 files in the Code Map -- import from the harness, delete their copies, keep story-specific helpers -- remove duplication without changing assertions.

**Acceptance Criteria:**
- Given the refactored suite, when `npm test` runs, then 42 suites / 649 tests pass, three full runs in a row, and each refactored file passes 30 runs in isolation (retro item 7).
- Given the tree, when grepping `__tests__` and `src/**/__tests__` for `pressBack: ()`, `function settle`, `function flush(`, `function lastFocusTarget`, `function byTestId`, then the only hits are `src/test/` (and `sessionRefresh.test.ts`'s unit `flush`).
- Given the git diff, when comparing `expect(` lines per file, then none were removed or changed.
- Given `npm run lint -- --max-warnings 0` and `npm run typecheck`, then both pass.

## Implementation Notes

- **Profile API.** Timing-dependent helpers come from `createFlow(profile)`, so call sites keep their `press(root, id)` / `settle()` shape. A profile holds the default `settle` (`rounds`, `timerRounds`), optional `renderSettle`/`backSettle` overrides, the `one()` filter (`focusable` | `focusableOrInput` | `declaredOrInput`), `pressFocuses` and `submitSettles`. Per-call overrides are partial settle options (`settle({ timerRounds: 0 })`, `press(root, id, { settle: NO_TIMERS })`). Stateless helpers (`byTestId`, `visible`, `text`, `focusableIds`, `topScreen(root, ids)`, `lastFocusTarget`, `unmount`, `render(element, opts)`, `settle(opts)`) are plain exports.
- **Profiles used:** signInFlow 2/2 (`flush(false)` → `settle({ timerRounds: 0 })`); codeFlow 20/0 with render and Back at 20/2 (`settle(true)` → `settle(TIMERS)`), `declaredOrInput`, no focus on press; shellFlow 20/2, `focusable`; sessionFlow 30/30, `focusable`; expiredFlow, signOutFlow, accountSwitchFlow 30/30, `focusableOrInput`, submit settles (signOutFlow's `timers = false` paths → `NO_TIMERS`); demoFlow 20/20 with `pressFocuses: 'sameAct'`; ModalHost 0/0 (no settling, as before).
- **Signatures kept for unchanged `expect(` lines:** `focusableIds(target, within?)` accepts both shellFlow's `(root, node)` and signOutFlow's `(node)`; `text()` accepts a root or a node; ModalHost imports `byTestId as byId`.
- **Moved assertion:** the only `expect(` line no longer in the test files is `one()`'s `expect(nodes).toHaveLength(1)` (one per file, ModalHost's `focusable()` included); it now runs inside the harness `one()` on every call, unchanged. Every other `expect(` line is identical per file (sorted multiset diff against `fd09dbe`).
- **Deviation (Code Map gap):** `ModalHost.test.tsx` lives under `src/shared`, and the `boundaries` policy forbids `shared` → `test` for every file in it, tests included. `.eslintrc.js` is out of scope, so its three harness imports carry `eslint-disable-next-line boundaries/dependencies` with a reason. A later lint change could exempt `**/__tests__/**` from that policy instead.
- **Behavior notes:** `resetKeychain()` also clears `getGenericPassword` in files that did not clear it before (codeFlow, shellFlow, demoFlow), so call records only cover the current test. `focusOn()` calls `onFocus(` strictly for every profile; expiredFlow, signOutFlow and accountSwitchFlow used `onFocus?.(`, and every target there has the prop. `backHandlerMock.reset()` (empties the handler stack and clears `exitApp`) runs in the `beforeEach` of every file that mocks BackHandler. Before, only some files cleared `exitApp`, and none of them reset the stack. `installNativeModules()` accepts any module name, and `clearNativeModules()` deletes exactly what it installed, so codeFlow (`KeychainStorageReset`) and demoFlow (`InstallId`) install through it and have no manual deletes. demoFlow's in-test `byId`/`press`/`type`/`top` now come from the harness: profile `pressFocuses: 'sameAct'` gives focus and OK in one `act()`, as before, and `top()` wraps `topScreen`. signInFlow and codeFlow keep their raw `fetchMock` routing, and shellFlow keeps its inline fetch stub (story-specific; FixtureTransport would change the replies).
- **Verification result.** `npm test` ×3: 42 suites / 649 tests, exit 0. The 8 `__tests__` flow files: 30/30 isolated runs each. `ModalHost.test.tsx` alone: 9/9 tests pass in 30/30 runs, but `npx jest <file>` exits 1 every time, both here and at `fd09dbe` (5/5 on the untouched file). The cause is a real-timer callback (`@react-native/jest-preset/jest/setup.js:51`, a frame timer from the "two frames later" focus restore) that fires after the environment is torn down. It predates this change, and fixing it would change the file's timing, so this pure refactor leaves it alone. It is a follow-up for the Epic 3 test-infra work.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | `focusOn()` used `onFocus?.()`, so shellFlow/sessionFlow focus steps could pass vacuously (blind, edge, verification-gap) | medium | patch: strict `onFocus(` in every profile; all 649 tests still pass, so every target has the prop |
| 2 | The shared BackHandler stack is never reset; a test that throws before unmount leaks handlers into later tests (blind, edge) | low | patch: `backHandlerMock.reset()` in each mocking file's `beforeEach` |
| 3 | `flow.tsx` header says nothing under shared may import it, but `ModalHost.test.tsx` does (blind) | low | patch: header now says "no production code"; the lint-policy exemption for `__tests__` is deferred |
| 4 | `demoFlow` kept local `byId`/`press`/`type`/`top` copies (blind) | low | patch: harness helpers, `pressFocuses: 'sameAct'` keeps focus+OK in one `act()` |
| 5 | `NativeModuleFakes` only took `AppInfo`/`InstallId`, leaving manual deletes in codeFlow/demoFlow (blind) | low | patch: any module name; manual deletes removed |
| 6 | `epic-3-context.md` says 3.1 lands the harness and split plan, names `flow.ts`, counts 7 files (blind) | low | patch: rewritten to the owner's run order and the real files |
| 7 | `ModalHost.test.tsx` alone exits 1 (blind, edge, verification-gap) | low | defer: reproduced at `fd09dbe`, pre-existing; deferred-work entry added |
| 8 | Two ACs not met as written; verification grep cannot prove "no net loss" (blind) | low | rejected: the fix is editing this spec; the moved `one()` `expect` and the ModalHost exit are recorded in Implementation Notes |
| 9 | `back()`/`lastFocusTarget()` give opaque errors when their mock is missing (blind, edge) | low | rejected: a new file hits it once and the TypeError names `pressBack`/`mock`; guards add surface for no observed case |
| 10 | `clearNativeModules()` deletes instead of restoring pre-existing modules (blind, edge) | low | rejected: no installed name pre-exists in `NativeModules` under the jest preset; the old copies deleted the same way |
| 11 | `mockClear` keeps queued `mockImplementationOnce` on keychain mocks (edge) | maybe-false | rejected: codeFlow:609's once-implementation is consumed in its test (verification-gap checked); no unconsumed queue shown, at most low |
| 12 | `timerRounds > rounds` or negative values are not validated (edge) | low | rejected: no caller passes them; a guard adds branches |
| 13 | Harness has no tests of its own (blind) | low | rejected: all 649 flow/unit tests exercise every profile path |
| 14 | `focusableIds(target, within?)` two-shape signature; mandatory `FlowProfile` fields; two `settle` exports (blind) | low | rejected: cosmetic; the signature keeps `expect(` lines unchanged and the plain `settle` needs full options, so misuse is a type error |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck` -- expected: no errors.
- `npm test` (×3) -- expected: 649 passed.
- `for i in $(seq 30); do npx jest <file> --silent || break; done` per refactored file -- expected: no failure.
- `git diff fd09dbe -- '__tests__' 'src/**/__tests__' | grep '^-.*expect('` -- expected: only lines re-added unchanged (moved), no net loss.
