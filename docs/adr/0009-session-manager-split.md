# ADR 0009: Split SessionManager into modules behind an unchanged facade

- Status: accepted (owner, 2026-10-26; Epic 2 retro action item 5; the split itself is a later, separate change)
- Executed 2026-10-27 (`_bmad-output/implementation-artifacts/spec-session-manager-split.md`), steps 1–9 one commit each: `2195e1f` types, `92589c8` codec, `9029355` core (+ `core.test.ts`), `bf47814` refreshHost (+ `refreshHost.test.ts`), `f708a90` signOut, `9b39f29` lifecycle, `1a5afa3` restore, `af663d9` signIn, `b8e2426` debug; `23fd74c` adds `codec.test.ts`. `sessionManager.test.ts` and `sessionRefresh.test.ts` were not edited. Line references below are to `697de1f`, before the split.
- Date: 2026-10-26
- Relates to: architecture spine AD-3 (session ownership), AD-4 (account scope); `docs/api-contract.md` §2.3 «Production refresh-coordinator requirements»; Epic 2 retro findings A2, A3, F7 (`_bmad-output/implementation-artifacts/epic-2-retro-2026-10-26.md`)
- Code references are to `main` at `697de1f`.

## Context

`src/shared/api/sessionManager.ts` has 609 lines. Stories 2.3–2.8 grew it into one closure (`createSessionManager`, L237–609) that owns these concerns:

| # | Concern | Where (`sessionManager.ts`) |
|---|---|---|
| C1 | Public contract: `SessionStatus`, `RestoreResult`, `SignInResult`, `ValidateResult`, `SignInArgs`, `SessionManager`, `AccountSwitchHook`, `CURRENT_USER_PATH` | L62–176, L223 |
| C2 | Stored-session and expiry-marker schemas, `decodeSession` (pure) | L178–220 |
| C3 | `SessionManagerDeps` and the factory's defaults | L225–245 |
| C4 | Mutable core: `status`, `session`, `previousAccountId`, `generation`, `signingOut`, `listeners`, the `enqueue` store queue, `setStatus`; `getStatus`/`subscribe` | L247–282, L523–529 |
| C5 | Refresh host adapter `host` (`current`, `isExpired`, `isCurrent`, `persist`, `adopt`, `expire` + the marker write) | L284–324 |
| C6 | Coordinator and `HttpClient` wiring | L326–332 |
| C7 | Restore: `readSession` and the single-flight `restore()` | L334–377, L530–543 |
| C8 | Sign-in: `validateWithE1`, `discardSaved`, `doSignIn`, the single-flight `signIn()` | L379–472, L544–562 |
| C9 | Account-switch hook holder: `accountSwitchHook`, `setAccountSwitchHook` | L246, L576–578 |
| C10 | Lifecycle: `doValidate`, single-flight `validate()`, `onAppStateChange` (`appState`) | L474–496, L580–584 |
| C11 | Sign-out | L498–514 |
| C12 | Expired-phone accessor `getExpiredPhone` | L563–574 |
| C13 | `authApi` pick (send/resend for A2/A5) | L586 |
| C14 | Debug hooks: `corrupt`, `debugCorruptAccessToken`, `debugExpireInMemory` (`__DEV__` only) | L516–520, L587–607 |

`refreshCoordinator.ts` was already extracted behind the `RefreshHost<S>` interface (`refreshCoordinator.ts:60-74`); it is the model for the other seams. The retro (A2) asked for a split plan before Epic 3 adds session concerns.

Public contract users, which the split must not change:
- `src/app/session.ts:27-29` (`createSessionManager()`), `src/app/dev/demo.ts:44-71` (`createSessionManager({...})`), `src/app/bootstrap.ts:38` (`setAccountSwitchHook`), `src/app/App.tsx` (`restore`, `getExpiredPhone`, `onAppStateChange`, `validate`, the debug hooks);
- `src/shared/api/index.ts:15-25` (exports `createSessionManager`, `SessionManagerDeps` and the types);
- `src/shared/api/__tests__/sessionManager.test.ts` (637 lines; `signIn`, `restore`, expiry marker/phone accessor, account-switch hook) and `__tests__/sessionRefresh.test.ts` (668 lines; proactive, 401, rejected, recoverable failures, cooldown, rotation, generation guard, sign-out). Both are black-box tests through `createSessionManager`.

### Do Epic 3 or Epic 4 add a session concern?

Sources read: `_bmad-output/implementation-artifacts/epic-3-context.md`; `_bmad-output/planning-artifacts/epics.md` Epic 3 (Stories 3.1–3.6) and Epic 4 (Stories 4.1–4.7); the architecture spine `ARCHITECTURE-SPINE.md` AD-3, AD-4, AD-7, AD-11 (and AD-10, which AD-4 points to).

- **Epic 3: none.** Stories 3.1–3.6 only consume the session: «Given a signed-in user» (3.1), and repositories receive `session.http` from `src/app/session.ts` (epic-3-context «Technical Decisions»). The query cache is registered with `AccountScope`, not with SessionManager (AD-4, AD-7). The AD-7 resume invalidation belongs to `AppLifecycle`, not to `onAppStateChange`. Locked content is never a session signal (epic-3-context «Invalid token looks anonymous»).
- **Epic 4: Story 4.2 is the first.** «Given the session expires during playback, when a write is pending, then it is held and flushed after re-login only if the account generation is unchanged» (epics.md Story 4.2; AD-10 «On `SessionExpired`»). ProgressRepository must observe `expired` and the re-login. Story 4.1 has no session criterion. Story 4.4's expired *media URL* is AD-11 `MediaResolver`, not the session. Story 4.7's history reset is an `AccountScope` store.

## Decision

Split the closure into modules under `src/shared/api/session/`. `src/shared/api/sessionManager.ts` stays the facade: the same file, exports, types, `createSessionManager(deps)` signature and returned object. No behaviour, endpoint or feature changes; no new dependency.

### Target modules

| Module | Responsibility | Concerns | Receives |
|---|---|---|---|
| `sessionManager.ts` (facade) | `SessionManagerDeps` and defaults; re-exports everything in `session/types.ts` unchanged; composes the modules; builds the coordinator and `http`; assembles the returned object, including the `authApi` pick | C3, C6, C13 | `deps` |
| `session/types.ts` (leaf) | The public types (`SessionStatus`, `RestoreResult`, `SignInResult`, `ValidateResult`, `SignInArgs`, `SessionManager`, `AccountSwitchHook`) and `CURRENT_USER_PATH`; imports nothing from `session/` or the facade | C1 | — |
| `session/codec.ts` (pure) | `storedSessionSchema`, `expiryMarkerSchema`, `StoredSession`, `ExpiryMarker`, `decodeSession`, and `encode` for both (today's `JSON.stringify` calls) | C2 | — |
| `session/core.ts` | `SessionCore`, the only holder of session state and of the stores (API below) | C4 | `sessionStore`, `phoneStore`, `logger` |
| `session/refreshHost.ts` | `createRefreshHost(core, logger): RefreshHost<StoredSession>`, including `expire` → the marker write | C5 | core, codec |
| `session/restore.ts` | `readSession`, the single-flight `restore()` and its `restoring` slot (L258), and `getExpiredPhone()` (the reads that serve the `expired` state) | C7, C12 | core, codec, types, logger |
| `session/signIn.ts` | `validateWithE1`, `discardSaved`, `doSignIn`, the single-flight `signIn()` and its `signingIn` slot (L259), the account-switch hook holder and `setAccountSwitchHook` | C8, C9 | core, codec, types, `authApi`, `createHttp`, `now`, logger, `deps.onAccountSwitch` |
| `session/signOut.ts` | `signOut()` | C11 | core, logger |
| `session/lifecycle.ts` | `validate()` (single-flight E1 over `http`) and its `validating` slot (L260), `onAppStateChange` and its `appState` (L261) | C10 | core, types, `http`, logger |
| `session/debug.ts` | `corrupt`, `debugCorruptAccessToken`, `debugExpireInMemory` | C14 | core, `validate`, logger |

The single-flight slots and `appState` are call-coordination state, not session state: each lives in the one module that runs that flow.

`SessionCore` API (every session-state change is a named transition; no module assigns a field):
- Reads: `getStatus()`, `subscribe(listener)`, `current()` (the session, or null), `previousAccountId()`, `generation()`, `isCurrent(g)`, `isSigningOut()`.
- Status and memory transitions:
  - `setStatus(next)` (dedupe, listener snapshot, the status log line, L273–282);
  - `bumpGeneration()` (restore L335, sign-in L450, sign-out L499, debug L600);
  - `resetForRestore()` (L335–337: bump, `session = null`, `previousAccountId = null`);
  - `adoptSignedIn(next)` (L468–470: `session = next`, `previousAccountId = null`, `signedIn`);
  - `restoreSignedIn(session)` (L374–375) and `restoreExpired(accountId)` (L368–369);
  - `adoptRefreshed(next, g)` (L297–303, false when stale, signed out or signing out);
  - `markExpired()` (L312–315: `previousAccountId = session.accountId`, `session = null`, `expired`; returns the account id);
  - `clearMemory()` (L510–511: `session = null`, `previousAccountId = null`);
  - `beginSignOut()` / `endSignOut()` (`signingOut`, L500 and L508);
  - `replaceAccessToken(token)` (L590, the debug rewrite in place).
- Storage, all writes and clears through the one queue:
  - `writeSessionIf(next, guard)`: runs `guard()` **inside** the queued op, before the write, and resolves `'stale'` when it fails (today's `persist`, L289–296, checks generation and `signingOut` inside `enqueue`);
  - `writeSession(raw)`, `clearSession()`, `writePhone(phone)`, `clearPhone()`;
  - unqueued `readSession()` and `readPhone()`, exactly where reads are unqueued today (L338, L568).

Rules for the modules:
- `core.ts` is the only holder of session state (`status`, `session`, `previousAccountId`, `generation`, `signingOut`, listeners) and the only module that touches a `SecureStore`. The other modules call its methods; none keeps its own copy of these values.
- Modules import `core.ts`, `codec.ts` and `types.ts` only, never each other or the facade. The facade re-exports `types.ts` unchanged, so `index.ts` and every caller keep their imports. `debug.ts` receives `validate` as a function from the facade.
- Runtime re-entry is allowed: on an account change, `signIn` awaits the hook, which is the app's `AccountScope.reset()`, whose gate calls this manager's own `signOut()` (`src/app/bootstrap.ts:38`, `src/app/session.ts:38`). That is a call through the app at runtime, not an import between `signIn.ts` and `signOut.ts`. Its reentrancy (the generation bump and the `signedOut` emission during a sign-in) stays covered by the black-box account-switch suites (`sessionManager.test.ts` «account-switch hook (Story 2.8)»).
- `session/` is private to `shared/api`: `index.ts` keeps exporting only the facade.
- Debug hooks: the facade loads `debug.ts` as `__DEV__ ? require('./session/debug') : null`, as `src/app/session.ts:11-12` does. As `src/app/session.ts:13-17` warns, the result must stay a local, unexported binding; an exported one is not folded away by the release minifier, and the debug code would be bundled. `__tests__/releaseBundle.test.js` guards this: L23 and L29 (the markers that must be absent from release, incl. `'debug: expired in memory'`) and L78 and L80 (the debug-bundle control). `debugExpireInMemory` calls `bumpGeneration()` and core's `markExpired()`, the same transition `refreshHost.expire` uses, minus the marker write; it does not copy `host.expire`.

### Invariant ownership after the split

| Invariant (AD-3 / AD-4 / api-contract §2.3) | Owner |
|---|---|
| SessionManager is the single reader and writer of tokens through SecureStore (AD-3) | `core.ts` (only holder of the stores and of `session`) |
| One store queue serializes every SecureStore write and clear (L264–271) | `core.ts` |
| Persist before adopt (§2.3) | `refreshCoordinator.ts` (unchanged order); `refreshHost.ts` keeps the guards, with the `persist` precondition evaluated inside the queued op (`core.writeSessionIf`, L289–296) |
| Generation guard: restore (L335), sign-in (L450), sign-out (L499) and `debugExpireInMemory` (L600) bump it; stale refresh results are dropped (§2.3 «Races») | `core.ts` (counter, `bumpGeneration`, `isCurrent`); checked in `refreshHost.ts` |
| The coordinator sees no session while sign-out runs (`host.current`, L286) | `signOut.ts` (`beginSignOut`/`endSignOut`); read in `refreshHost.ts` |
| `expired` is entered only on refresh 400 `invalid_grant` (the marker replaces the session, the phone stays; AD-3, Story 2.6), from the stored marker at restore (L367–370), or by the debug hook (L604, debug builds only) | `refreshHost.ts` (`expire`); `restore.ts` (marker); `debug.ts`; all through `core.ts` transitions |
| Corrupted store (readable, not a session or marker): `signedOut` first, then a best-effort queued clear whose failure is swallowed; result `wiped`, never a crash (AD-3, L356–365) | `restore.ts` |
| `restore()` never rejects: any error → `signedOut`, reason `unavailable` (L530–537) | `restore.ts` |
| Single-flight sign-in: the same `phone`/`challenge`/`smsCode` key returns the running promise; a different concurrent sign-in rejects with `AuthError('Unknown')` (L545–552) | `signIn.ts` |
| After confirm succeeded, every sign-in failure is `AuthError('Unknown')` with `challengeSpent` (L411) | `signIn.ts` |
| Sign-in order: confirm → E1 → compare id → hook → phone → session → `signedIn` (L48–57) | `signIn.ts` |
| Account reset before the new phone and account id are written (AD-4) | `signIn.ts` |
| Sign-out order: phone, then session, then memory; a failed clear is surfaced (§2.3 «Logout order») | `signOut.ts` |
| The UI sees only `status` (AD-3) | facade (public type) and `core.ts` |
| Never log the phone, challenge, code, tokens or the E1 body (L59) | every module; the facade passes one `logger`; the existing log-dump tests stay the guard |

### Extraction order

Smallest and pure seams first; one commit per step; `sessionManager.test.ts` and `sessionRefresh.test.ts` pass unchanged after each step.

1. `types.ts` (leaf; the facade re-exports it).
2. `codec.ts` (pure, no state).
3. `core.ts` (state, transitions, queue, store access); the closure still holds every flow.
4. `refreshHost.ts`.
5. `signOut.ts`.
6. `lifecycle.ts`.
7. `restore.ts` (with `getExpiredPhone`).
8. `signIn.ts` (largest, with the hook holder).
9. `debug.ts` (with the `__DEV__` require).

### Test strategy

- `sessionManager.test.ts` and `sessionRefresh.test.ts` are the contract. They are not edited in the split; a needed edit means the split changed behaviour and must stop there.
- New unit tests only for seams the facade tests reach awkwardly: `codec.test.ts` (session, marker, invalid JSON, wrong shape), `core.test.ts` (queue order and continuation after a rejection, `setStatus` dedupe and the listener snapshot, `isCurrent`), `refreshHost.test.ts` (stale `persist`/`adopt`/`expire`, a failed marker write is logged and keeps `expired`). Restore, sign-in, sign-out and lifecycle stay covered through the facade, without duplicates.
- Retro action item 7: the new async/timer unit tests (`core.test.ts`, `refreshHost.test.ts`) run ≥30 times in isolation before review; the full suite runs ≥3 times.
- Checks: `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` three times, `__tests__/releaseBundle.test.js`, and `assembleRelease`. No device behaviour changes; a cold start and resume on the pinned device are a cheap smoke check, recorded as such.

### Left out on purpose

- **Two generation counters (retro A3): kept separate.** SessionManager's guards refresh results against session changes and is bumped before the sign-out clears (L499); AccountScope's guards account-scoped async writes and is bumped only after the gate succeeds (`src/shared/account/accountScope.ts:95-97`, the Story 2.7 fix). Merging them changes behaviour. The split moves SessionManager's counter into `core.ts` unchanged. Story 4.2 relies on AccountScope's.
- **Failed sign-out keeps the bumped generation (`deferred-work.md`, Story 2.7 entry): kept separate.** A rollback is a behaviour change. After the split the decision sits in `signOut.ts` alone and can be taken with Story 4.2 or on its own.
- **`getExpiredPhone` reads outside the queue (retro F7): kept.** `core.readPhone` stays unqueued, which makes the gap visible without changing it.
- **`SignInResult.accountChanged` is dead (retro F4): kept**, as part of the stable contract.
- `refreshCoordinator.ts`, `httpClient.ts`, `authApiClient.ts`, `src/app/session.ts` and `src/app/dev/demo.ts` do not change.

### Timing

Owner decision (2026-10-26): the split runs between Epic 3 and Epic 4, as its own change right before Story 4.2, the first story with a session concern. Epic 3 starts now without it, because no Epic 3 story adds a session concern (see above). The split is tracked in `_bmad-output/implementation-artifacts/deferred-work.md` (entry "split SessionManager per ADR 0009 before Story 4.2").

## Consequences

- Story 4.2's expiry and re-login handling lands in a small module (or in ProgressRepository through `subscribe`), not in a 600-line closure.
- Each invariant has one owning module, so a review of a session change reads one file plus `core.ts`.
- `core.ts` becomes the single choke point for state and storage. A module that needs a new primitive adds it there, which keeps "single writer" and "one queue" visible in review.
- Until the split runs, Epic 3 must not add session concerns to `sessionManager.ts`. Any Epic 3 need that appears anyway goes to the owner first.
- Risk: during the split, a module could capture a state value instead of reading it through `core`, which would break the generation or `signingOut` guards. The unchanged black-box suites (generation guard, sign-out race) are the check.
