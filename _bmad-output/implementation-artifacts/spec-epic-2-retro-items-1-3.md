---
title: 'Epic 2 retro items 1–3: one session owner, demo auth offline, dead Back branch'
type: 'bugfix'
created: '2026-10-26'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-retro-2026-10-26.md'
  - '{project-root}/docs/focus-map.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Epic 2 retrospective (`_bmad-output/implementation-artifacts/epic-2-retro-2026-10-26.md`) left three blocking items before the owner accepts the epic:
- **F1.** A2/A5 send and resend call the global `authApiClient`, so a debug demo run sends real requests to Boosty.
- **F2.** `shared/api` exports the real `sessionManager` and `httpClient` singletons, which bypass the app's session choice (`src/app/session.ts`).
- **F5.** The `modal.isOpen()` branch in the Shell Back handler is unreachable since the modal host registers its listener in `open()`.

**Approach:**
- **One owner of the session.** `src/app/session.ts` owns the only app session: it creates the real `SessionManager` itself, or the demo one. `shared/api` no longer exports `sessionManager` or `httpClient`.
- **Auth through the session.** `SessionManager` exposes its `authApi`, and App passes the active session's send/resend to A2/A5 as props, as it already does with `signIn`. The demo fixture answers send-code, so a demo run sends nothing to Boosty.
- **Single Back owner.** Delete the dead Shell branch; the modal host stays the single owner of Back while a modal is open (`docs/focus-map.md` §1.4).
- No visible behaviour change in the real app.

</frozen-after-approval>

## Implementation Notes

- **Item 1.** `SessionManager` exposes `authApi` narrowed to `Pick<AuthApiClient, 'sendCode' | 'resendCode'>`, so confirm and refresh stay behind `signIn` and the refresh coordinator. `PhoneScreen` takes a `sendCode` prop and `CodeScreen` a `resendCode` prop, both passed by App from `session.authApi`. `src/app/dev/demo.ts` answers `/auth/phone/verification_code/send` with a synthetic challenge. `__tests__/demoFlow.test.tsx` used to expect the send to reach the global fetch, that is the bug itself; it now expects no fetch at all.
- **Item 2.** `shared/api` no longer creates or exports the `sessionManager` and `httpClient` singletons, and no longer exports `authApiClient`; `createSessionManager` still defaults to it internally. `src/app/session.ts` creates the real manager with `createSessionManager()`, or the demo one. The flow tests import `session` from `src/app/session` (`accountSwitchFlow`, `expiredFlow`, `signOutFlow`; `codeFlow` and `signInFlow` spy on `session.signIn` and `session.authApi.sendCode`).
- **Item 3.** The `modal.isOpen()` branch and the `useModal` import are removed from the Shell Back handler, and a comment cites the modal host's ownership of Back (`docs/focus-map.md` §1.4). `focusNav` is a stable `useCallback([])`, so the Shell listener re-registers only on a route focus change, which cannot happen under an open modal.
- **Checks.** `npm run lint -- --max-warnings 0`, `npm run typecheck` and `npm test` (649 tests; three full runs green) pass, as do `npm run check:fixtures` and the release JS bundle, which contains neither `createDemoSessionManager` nor `demo-challenge`. `assembleRelease` gives BUILD SUCCESSFUL. Not run on the device: there is no visible change in the real app.

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | `authApiClient` is still exported from `shared/api`, so a feature could re-import it and send real requests in demo | medium | patch: export removed (`src/shared/api/index.ts`); the only remaining use is `createSessionManager`'s internal default |
| 2 | `SessionManager.authApi` exposes `confirmCode` and `refresh` to screens | low | patch: narrowed to `Pick<'sendCode' \| 'resendCode'>` |
| 3 | `signInFlow` spies on the removed `api.authApiClient` | low | patch: spies on `session.authApi.sendCode` |
| 4 | Stale `sessionManager.restore()` comments in `App.tsx` | low | patch |
| 5 | Tests alias `session as sessionManager` | low | patch: renamed to `session` |
| 6 | Comment nits (`demo.ts` wrap, `resendCode` JSDoc) | low | patch |
| 7 | No lint rule against deep imports of the API singletons | low | rejected: the barrel no longer exports them; a deep import of `shared/api/authApiClient` is a deliberate bypass, and the fix adds config for no observed case |
| 8 | Demo resend and an F5 Back-order regression are not tested | low | rejected: resend uses the same prop path as send (tested); Back under a dialog is covered by `__tests__/shellFlow.test.tsx:471` and `ModalHost.test.tsx` |
| 9 | Shell's listener could re-register while a modal is open | false | `focusNav` is `useCallback(…, [])` (`src/app/Shell.tsx:140`); `useFocusEffect` re-runs only on a route focus change, which an in-Shell modal does not cause |
| 10 | `docs/api-contract.md` describes the old singleton model | false | L132 and L204 only list source files; no claim about singletons |
| 11 | The spec had empty Implementation Notes and `context: []` | low | patch: filled in |
