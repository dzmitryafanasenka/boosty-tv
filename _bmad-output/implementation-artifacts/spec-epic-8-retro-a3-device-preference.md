---
title: 'Epic 8 retro A3: one device-preference factory'
type: 'refactor'
created: '2026-10-31'
status: 'in-progress'
baseline_commit: 'fa9eb3170648e9005c0c1479b882c192e9a8c4c3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-retro-2026-10-31.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Four device-scoped preference stores are near-identical copies of about 50 lines each, and they already drift (Epic 8 retro D1–D3, P1):
- `qualityPreference.ts`, `speedPreference.ts` and `externalPlayerPreference.ts` in `features/player`;
- `createDiagnosticsCapture` in `shared/services/logFileSink.ts`.

They differ in their verb (`write` vs `set`) and their placement. Their tests repeat the same six cases, and `session.ts` wires four demo setters. Epic 9 will add another device value.

**Approach:**
- One generic `createDevicePreference<T>` in `src/shared/storage/devicePreference.ts`, plus one `usePreference` hook.
- Each store becomes a thin definition (key, parse, serialize, fallback, log scope and label) with the same public API and behaviour as today.
- The diagnostics capture keeps its side effects (sink enable/disable, `clearLogs`) as a wrapper and moves out of `logFileSink.ts`.
- Behaviour-preserving: no user-visible change and no change to stored keys or values.

## Boundaries & Constraints

**Always:**
- The stored keys and formats stay byte-identical: `player.quality.v1`, `player.speed.v1`, `player.external.v1` and `diagnostics.capture.v1`, each with its current parse and serialize.
- Semantics kept exactly:
  - one read per app run, kept in memory, single-flight;
  - a pick made during the read wins;
  - a write updates memory first and stores in the background;
  - a failed read or write, or a synchronous `kv()` throw, only logs a warning with no value;
  - an unreadable or junk stored value gives the fallback;
  - `forget()` (tests only) drops memory, never the store.
- Quality keeps `remember()` (memory only) and its null fallback. Speed falls back to 1×; external and capture fall back to off.
- One device KV setter for all device preferences (`setDevicePreferenceKeyValueStore`). `session.ts` calls it once for demo mode, before the warm reads. The per-store setters go, and every test that used them is updated.
- One verb: `write`. `diagnosticsCapture.set` becomes `write`.
- Layering:
  - `shared/storage` depends only on `shared/platform` (KeyValueStore) and `shared/services/logger`;
  - player stores stay in `features/player`;
  - the capture preference moves to `src/shared/services/diagnosticsCapture.ts` (the sink stays in `logFileSink.ts`).
- None of these stores is registered with AccountScope. `__tests__/accountScopeRegistry.test.js` stays green unchanged.

**Never:**
- No new dependency and no storage migration.
- No change to `usePlayerSource` / `PlayerEntry` engine gating. Migrate a call site to `usePreference` only where it is a plain peek, then read, then setState (`useExternalPlayerPreference`, `DiagnosticsScreen`'s toggle state).
- No UI or copy change.

</frozen-after-approval>

## Code Map

- `src/features/player/speedPreference.ts` -- the template of the shared logic: `getStored` (sync throw → rejection), single-flight `read` (pick wins), `write` with try/catch plus `.catch` logging, `forget`, module setter, singleton. Keep `PLAYBACK_SPEEDS`, `parseSpeed`, `serializeSpeed`, `speedLabel` and `DEFAULT_SPEED`.
- `src/features/player/qualityPreference.ts` -- the same shape plus `remember()` and a `QualityKey | null` value. Keep `parseQualityPreference` and `serializeQualityPreference`.
- `src/features/player/externalPlayerPreference.ts` -- the same shape plus `useExternalPlayerPreference(enabled)` (l.124). Re-express the hook through `usePreference` with the same return shape.
- `src/shared/services/logFileSink.ts` l.215-327 -- `createDiagnosticsCapture(kv, sink)`. `read` applies the stored value to the sink (on enables it, off clears the file). `set` writes and applies. `clearLogs` returns a boolean. Move it to `diagnosticsCapture.ts` on top of the factory, keep `apply` semantics, and rename `set` to `write` (callers: `DiagnosticsScreen.tsx`, tests).
- `src/app/session.ts` l.40-62 -- four demo setters become one. The two warm reads stay, gated by their flags.
- `src/features/settings/DiagnosticsScreen.tsx` l.41-61 -- the peek/read/alive pattern → `usePreference`. Keep the rejection fallback to off.
- Tests:
  - `speedPreference.test.ts`, `externalPlayerPreference.test.ts`, the store part of `qualityPreference.test.ts` and `logFileSink.test.ts` «createDiagnosticsCapture»: fold their store cases into one `src/shared/storage/__tests__/devicePreference.test.ts`, parameterised over the four definitions;
  - keep the store-specific parse/label cases;
  - grep the flow tests for `set*PreferenceKeyValueStore` / `setDiagnosticsCaptureKeyValueStore` / `.forget()` and update them.

## Tasks & Acceptance

**Execution:**
- [ ] `src/shared/storage/devicePreference.ts` (+ test) -- `createDevicePreference<T>({ key, parse, serialize, fallback, scope, label })` → `{ peek, read, write, forget }`; quality adds `remember`; `setDevicePreferenceKeyValueStore`; `usePreference(store, enabled)`.
- [ ] The four stores -- re-expressed on the factory; public API unchanged except `diagnosticsCapture.set` → `write`; the capture moves to `shared/services/diagnosticsCapture.ts`.
- [ ] `session.ts`, `DiagnosticsScreen.tsx`, `useExternalPlayerPreference` -- wiring and hook adoption.
- [ ] Tests -- the parameterised suite plus updated flows. All existing flow tests (`playerFlow`, `homeFeedFlow`, `diagnosticsFlow`, `demoFlow`, `signOutFlow`) pass unchanged in meaning.
- [ ] Docs -- `ARCHITECTURE-SPINE.md` AD-4 As built (the factory and the single setter), `docs/testing.md` with a short entry for this change.

**Acceptance Criteria:**
- Given the same stored values as before, when the app starts, then the quality, speed, «Системный видеоплеер» and «Запись логов» values are identical to before.
- Given demo mode, when any device preference is written, then `boostytv-device` is never touched.
- Given the change, then the line count across the four store files plus the factory is lower than the four store files today.

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npx tsc --noEmit && npm run check:fixtures && npm test` -- expected: all clean and green.
