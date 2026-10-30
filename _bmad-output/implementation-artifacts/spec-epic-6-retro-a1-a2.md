---
title: 'Epic 6 retro follow-ups A1–A2'
type: 'bugfix'
created: '2026-10-30'
status: 'done'
route: 'oneshot'
baseline_commit: 'aedb8806f31bf46e0e20a3b7ea36d9b7fbbf8b29'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Epic 6 retrospective (`epic-6-retro-2026-10-30.md`) found three issues:
- **R1.** A post E8 refetch that started before a vote can land after the vote's E10. It then overwrites the `applyPoll` write, and the poll shows its pre-vote state after a successful vote.
- **R2.** After a 2xx E11/E12, E10 is sent even when the account generation changed (sign-out or account switch). After a sign-out it goes out anonymously; after a switch it carries the new account's token.
- **Architecture delta.** `shared/platform/qrRenderer.tsx` imports `shared/ui/tokens`, while `shared/ui/QrDialog.tsx` imports the port. That is a directory-level cycle.

**Approach:**
- **A1.** In `usePollVote`, stop after the mutation when the generation changed, so no E10 is sent. Before `applyPoll`, cancel the exact post query (as `trimPostsToFirstPage` does), then re-check the generation. Add host tests for both cases.
- **A2.** The QrRenderer port takes its background colour as a prop. `QrDialog` passes the `qr-dialog` token, and the port no longer imports `shared/ui`.

Owner decision (2026-10-30): A1 and A2 ship in one PR. No live vote is needed; host tests only.

</frozen-after-approval>

## Implementation Notes

- **R1.** TanStack `cancelQueries` reverts a cancelled fetch to its pre-fetch state. The vote's E10 is newer than any E8 that started before it, so cancelling, then calling `applyPoll`, leaves the voted poll in the cache.
- **R2.** The new test bumps the generation while E11 is still pending, then answers it with 200. It expects no E10. The existing test bumps the generation between E10's send and its answer, and still passes.
- **A2.** `QrCode` now takes a required `background` prop. `QrDialog` passes `components['qr-dialog'].qrBg`, which equals `colors['qr-bg']`. The foreground stays black inside the port. `docs/adr/0014-qr-rendering.md` and the port's doc comment are updated.
- **Review patch.** The generation is also checked before the cancel. `queryKeys.post` is not account-scoped, so an old account's late E10 must not cancel the new account's E8 of the same post.
- **Test detail.** TanStack v5 resolves a cancelled-with-revert `fetchQuery` with the previous data instead of rejecting it. The stale-E8 test therefore asserts the exact `cancelQueries` call plus the final cache.
- **Files changed:** `src/features/polls/usePollVote.ts`, `src/features/polls/__tests__/PollWidget.test.tsx`, `src/shared/platform/qrRenderer.tsx`, `src/shared/ui/QrDialog.tsx`, `docs/adr/0014-qr-rendering.md`, `docs/testing.md`, `deferred-work.md`.

## Verification

- Lint (`--max-warnings 0`), typecheck and `check:fixtures` are clean.
- `npm test` ×3: 2322 passed each run.
- Touched suites (`polls`, `QrDialog`, `postFlow`, `demoFlow`) ×30: 0 failed runs.
- The three new A1 tests each fail on the unfixed hook.
- No device run and no live vote.

## Review Triage Log

Blind Hunter, 12 findings:

1. The cancel runs before the generation check, so a late E10 can cancel the new account's E8. **medium.** Patched: check before the cancel, plus a test.
2. List-page fetches are not cancelled. **low.** Same as retro R3, which was accepted (list cards show no poll results). Documented in the hook comment.
3. The cancelled E8 is dropped and never re-issued. **low, rejected.** The revert keeps the previous data. The poll is rendered only from existing post data, so a vote never meets a query without data. A dropped refresh of the post body is rare and harmless.
4. No test for the check-then-cancel order. Patched together with 1; the test is red without the check.
5. No A1 test on the retract (E12) path. **low, rejected.** The early return is shared code after either mutation.
6. The «not chosen» assertion was vacuous. **low.** Patched: it now checks that the new account's vote is sent at once.
7. The stale-E8 test did not prove the cancel happened. **low.** Patched: it asserts the exact `cancelQueries` call. `fetchQuery` and an observer refetch share the query's single fetch, so cancelling covers both.
8. The token name in the spec intent is imprecise. **low.** Clarified in these notes; the frozen block is unchanged.
9. The foreground stays hardcoded in the port. **false.** This is a design choice: the port owns the black modules and the caller owns the light background, as the ADR documents.
10. No test that the port forwards `background`. **low, rejected.** `QrDialog.test.tsx` asserts the SVG `fill` equals the token the dialog passes.
11. No rule keeps the cycle from returning. **Deferred** (`deferred-work.md`).
12. The spec had no verification record. Patched (this section).
