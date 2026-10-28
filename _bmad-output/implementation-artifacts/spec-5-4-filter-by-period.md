---
title: 'Story 5.4: Filter by period'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: 'b3fb2c167b70debed9792d8f4a6bfd88506640f5'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/docs/focus-map.md'
  - '{project-root}/docs/api-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The feed cannot be narrowed to a recent period or specific dates (FR29, FILTER-02; epics.md Story 5.4).

**Approach:** The filter sheet (Story 5.3) gets a «Период» row (value: the current period) under «Доступ». OK opens the period list: «За всё время» (default), «Последние 7 дней», «Последние 30 дней», «Последние 3 месяца» (radio) and «Свой период…» (nav; value = the custom range when active). A preset applies at once and returns to the sheet with focus on «Период». «Свой период…» opens a D-pad stepper: «С» and «По» groups of day / month / year fields; ↑/↓ change the focused value (raw keys), ←/→ move between fields, OK on a field → «Готово», ↑ from «Готово» → the first field; «Готово» applies and returns to the sheet on «Период». Back: stepper → list → sheet → chip. The period is symbolic in the Filter and the query key; the repository resolves it at request time to local start of the first day and end (23:59:59) of the last day as epoch-second `from_ts` / `to_ts` on E5.

**Decisions:**
- Period model (AD-18): `{kind:'all'} | {kind:'preset', days: 7|30|90} | {kind:'custom', fromDay, toDay}` (days as `YYYY-MM-DD` local calendar dates). A preset covers the last N days including today. `activeFilterCount` counts access and period sections; «Сбросить» resets both.
- Before relying on the params, verify live (debug build, counts and min/max post dates relative to the bounds only) that E5 honours `from_ts`/`to_ts` in seconds and whether the end is inclusive; record E5 period (LIVE) in `docs/api-contract.md`; if it does not behave, stop and report.
- Before building the stepper, measure on the pinned remote what raw ↑/↓ deliver (key down/up, repeat on hold) with a debug log of event type/action only; record in `docs/testing.md` and `docs/focus-map.md` §1.1. Act on key up unless the measurement shows otherwise; apply the entry guard (§1.1) when focus enters a field. The stepper is the second allowed raw-key place.
- Field limits: day 1…days of that month (clamped when month/year change), month 1–12 (short Russian month names), year 2015…current year; dates after today are not reachable.
- Owner decisions 2026-10-28: **an invalid range (from later than to) disables «Готово»** and shows «Дата «по» раньше даты «с»» under the fields; values never change on their own. **The stepper opens on the active custom range, else the last 30 days (today − 30 → today).** **The chip shows the one active section's value («Фильтры · Последние 7 дней» + 1); with two or more active sections, «Фильтры» and the count.**
- Owner decision 2026-10-28 (physical remote, after the first device build): **holding ↑/↓ on a stepper field must keep changing the value** (one step on the press, then repeated steps while held), like the Player's hold-to-seek; a step only on release is not acceptable.

## Boundaries & Constraints

**Always:** Filter stays plain serializable data; `Date.now()` only at request time in the repository path (no timestamps in keys or state); focus moves by explicit targets; copy in `ru`; tokens from `shared/ui`.

**Never:** No tags (5.5), no Поиск/Автор (5.6–5.7); no system date picker; no persistence across restart; no Apply button.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Preset | «Последние 7 дней» | E5 with `from_ts` = local 00:00 of today − 6, `to_ts` = today 23:59:59; focus «Период»; count 1 | E5 error → screen error behind |
| Custom | 1 авг 2026 – 25 сен 2026, «Готово» | E5 bounds 1 Aug 00:00:00 – 25 Sep 23:59:59 local | — |
| Invalid | from after to | «Готово» disabled + hint; no request | — |
| Day clamp | 31 + month → февраль | day becomes 28/29 | — |
| Back | stepper / list | stepper → list, list → sheet on «Период» (custom edits discarded) | — |
| Two sections | «Все посты» + 7 days | chip «Фильтры» + 2; «Сбросить» resets both | — |
| Key stability | same preset, clock moves | query key unchanged | — |

</frozen-after-approval>

## Code Map

- `src/shared/filters/filter.ts` -- add `Period` to `Filter`, frozen default `{access:'allowed', period:{kind:'all'}}`; `activeFilterCount` counts sections; a pure `periodBounds(period, nowMs)` → `{fromTs, toTs} | null` (local `new Date(y,m,d)` / `23:59:59`) with unit tests incl. DST-free math by calendar dates.
- `src/shared/filters/filtersStore.ts` -- `setPeriod(scope, period)` with equality no-op; `reset` unchanged.
- `src/shared/filters/FilterSheet.tsx` -- levels `'sheet'|'period'|'custom'` with a ref mirror, one `BackHandler` listener newer than the host's (pattern: `src/features/player/PlayerSettingsSheet.tsx` l.86-119), `[level]` focus effect with `focusSoon`; «Период» `SettingRow kind="nav"` with `value`; the reset → `allowed` focus rule kept. New `PeriodStepper.tsx` in the same module (`useTVEventHandler`; mock `src/test/tvEventMock.ts`; reference usage `src/features/player/PlayerScreen.tsx:85,874,950` key-up constant and entry guard).
- `src/shared/entities/post/postRepository.ts` -- `feedPath(cursor, filter, nowMs)` appends `from_ts`/`to_ts` when the period is not `all`; `feedPage` takes `now` (default `Date.now()`), callers unchanged otherwise (`useSubscriptionFeed.ts`, `feedRefresh.ts`, `App.tsx:378`).
- `src/features/home/HomeScreen.tsx:160-170` `chipLabels` -- one active section → its value, ≥ 2 → «Фильтры» + count; a11y from catalog.
- `src/shared/i18n/ru.ts` -- `filters.period.*` (row, presets, custom, «С», «По», «Готово», hint, invalid), genitive month names for the range value («1 августа 2026 — 25 сентября 2026»); short months exist at `date.*`.
- `src/app/dev/demo.ts` -- demo E5 honours `from_ts`/`to_ts` against its post dates.
- Design: `_bmad-output/planning-artifacts/design/claude-design-v1/Author Page.dc.html` l.81-177 (stepper layout: groups «С»/«По», boxes day 150 / month 180 / year 150 px tall 132, ▲/▼ on focus, summary line, «Готово»), `Boosty TV - D-L.dc.html:73-74`; DESIGN.md PeriodStepper row.

## Tasks & Acceptance

**Execution:**
- [x] Device measurement of raw ↑/↓ and the live E5 period check; docs.
- [x] Period model, bounds, store, repository params, demo transport.
- [x] Sheet levels, period list, PeriodStepper, chip label rule.
- [x] Tests: `__tests__/homeFeedFlow.test.tsx` «Story 5.4» (every matrix row; existing 5.3 focusable-row lists updated), `periodBounds` unit tests (month ends, leap year, preset days, key stability), stepper component test with `tvEventMock` (key-up only, entry guard, clamp, disabled «Готово»).
- [x] Docs: `docs/focus-map.md` D8–D10 (ids, levels, raw-key note), `docs/feature-parity.md` FILTER-02 «Android (Story 5.4)» (presets = our improvement), `docs/api-contract.md` E5 period, `docs/testing.md` Story 5.4.
- [x] Device (release-like, owner's session, adb; foreground activity first): a preset, a custom range via the stepper, invalid range, Back levels; screenshots (list and stepper) to the owner before the review loop.

**Acceptance Criteria:**
- Given the suite, when run 3×, then all pass; `homeFeedFlow` and new suites 30/30; lint `--max-warnings 0`, typecheck, `check:fixtures` clean.

## Implementation Notes

- Live E5 (debug build, counts/booleans only): `from_ts`/`to_ts` are seconds and both bounds are inclusive (a `from_ts = to_ts = T` window returns the post published at `T`; a millisecond window returns nothing). Recorded in `docs/api-contract.md` «E5 period (LIVE)».
- Raw keys (adb-injected, debug build): ↑/↓ arrive as key up only; a long press arrives as `longUp`/`longDown` (key down + key up), never as `up`/`down`, with no repeats. The stepper acts on the key up of all four, one step each. The key up that enters a field can reach JS before or after the field's `onFocus`; the entry guard also counts a key up that arrived while «Готово» had focus. Physical-remote hold: see the Hold note below.
- Hold (owner decision 2026-10-28): `SeekKeysModule` also forwards DPAD_UP/DOWN; `PeriodStepper` subscribes (`subscribeSeekKeys`) while mounted, steps on the native key down (repeat 0) and on repeats at most every 150 ms (`STEPPER_HOLD_REPEAT_MS`), and skips React Native's key up of a press whose native key down was seen (no double step). The press that leaves «Готово» is ignored with its repeats; the entry guard applies to the native key down. The key-up step remains the fallback without the module. The Player ignores ↑/↓ seek keys. adb long press (one injected repeat): two steps; the owner confirmed the hold on the physical remote (2026-10-29).
- Review fixes: the entry guard is armed only when focus enters the fields from «Готово» (not on the open: that press is OK); the hint ends «OK — готово»; each box has TalkBack `increment` / `decrement` actions (one `stepCalendarField` step of that box).
- Cross-row ← →: a 2 dp `TVFocusGuideView` band at the end of the «С» row (→ «По: день») and the start of the «По» row (← «С: год»); both rows trap every side; the «По» row's destination is «С: день» only while «Готово» has focus.
- Device bug fixed: leaving a sheet level unmounts the focused row; native focus fell back to `nav/home` for a moment and Главная took content focus when the filtered cards arrived. Главная now never takes focus while a modal is open (`HomeScreen` `mayTakeFocus`).
- `SettingRow` `valueLines` (> 1: the value under the label, wrapping) for the «Период» and «Свой период…» rows: a custom range does not fit beside its label on 320 dp.
- `feedPage(http, cursor, filter, now = Date.now(), logger)`: `now` comes before `logger`; no caller passed a logger.
- The stepper reads today once when it opens (UI only, never stored in the Filter).
- Incident (debug run): a Fast Refresh moved focus, and a scripted OK opened the player on a «Продолжить просмотр» card for ≈ 15 s (that video's local progress moved by about a minute). Recorded in `docs/testing.md` «Story 5.4».

## Spec Change Log

## Review Triage Log

Iteration 0 (layers: blind-hunter 13, edge-case-hunter 9, verification-gap 0 gaps + 2 other).

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | blind, edge, vgap | Pages / head refresh of one feed key resolve `now` per request, so a preset feed crossing local midnight mixes old and new bounds | low | reject | Real (`feedPage` default `now = Date.now()`), but needs a preset feed open across midnight plus a page load or resume; the fix (pin `now` per infinite query through page params or meta) adds surface. |
| 2 | blind | Cached preset pages keep yesterday's window after midnight | low | reject | Same root as #1: the time-free key is by design; a refetch after `staleTime` re-resolves. |
| 3 | blind | Stepper hint never mentions OK → «Готово»; ↓ is trapped | medium | patch | `filters.period.hint` lists only ↑ ↓ and ← →; ↓ in both rows only steps. |
| 4 | blind | Entry guard armed on open drops a real first ↑/↓ within 500 ms | low | patch | `onFieldFocus` arms when `previous === null`; the open press is OK, never an arrow; a direct condition change. |
| 5 | blind | `adjustable` role without increment/decrement actions | medium | patch | `StepperBox` sets the role only; TalkBack adjust gestures do nothing. |
| 6 | blind | Default custom range (today − 30) differs from the 30-day preset (today − 29); 3 months = 90 days | false | reject | Both are owner decisions in the frozen block (stepper default today − 30 → today; preset model `days: 90`). |
| 7 | blind, edge | `periodBounds` accepts an inverted custom range | false | reject | The only writer is the stepper's «Готово», disabled while from > to; no other `setPeriod` caller builds a custom period. |
| 8 | blind, edge | Stepper's `today` stale if left open past midnight | low | reject | Needs the stepper open across midnight; the new day is reachable after reopening; the fix adds a clock watcher. |
| 9 | blind | `valueLines > 1` would break a radio row's layout; «Период» row always stacked | false | reject | Only `nav` rows pass `valueLines`; the stacked «Период» row was in the screenshots shown to the owner. |
| 10 | blind | A single long custom range in the chip may overflow | low | reject | `FilterChip` label is `numberOfLines={1}` (ellipsis, no overflow); checked again on the device after the patches. |
| 11 | blind | `onFieldPress` ignores `focusSoon`'s canceller | false | reject | After an unmount `doneView.current` is null and `requestHostFocus(null)` is a no-op; the two-frame window is not a user-reachable move. |
| 12 | blind | «a period change never moves focus out of the sheet» does not assert focus on «Период»; demoFlow copies the demo's locked-post rule | low | patch (focus part) | Focus assertion missing; the demoFlow copy is a test-only duplication with no failure in sight (rejected). |
| 13 | blind | Spec `in-review` vs sprint `in-progress`; E9 incident has no follow-up | false | reject | The statuses follow the workflow (sprint moves at step 5); the incident was reported to the owner in the session and is recorded in testing.md. |
| 14 | edge | Two quick presses: native down 2 before RN key up 1 → double step | false | reject | `MainActivity.dispatchKeyEvent` emits the `seekKey` event before `super.dispatchKeyEvent` for the same key event, and both go through the JS event queue in order, so RN key up 1 always precedes native down 2. |
| 15 | edge | A native repeat without its repeat-0 down steps unguarded | false | reject | The stepper opens only with OK; no arrow can be held across its mount, and «Готово» presses set `ignored` on repeat 0. |
| 16 | edge | Malformed custom day keys: count 1 while the label reads «За всё время» | false | reject | Day keys are written only through `formatDayKey` from the stepper. |
| 17 | edge | Opening clamps an active range outside the limits (values change on their own) | false | reject | A stored range was clamped by the same limits when created; only a clock moved back could change it. |
| 18 | edge | `level === 'custom'` with `today === null` renders the sheet | false | reject | `setToday` and `goTo('custom')` run in the same press handler (one batched render). |
| 19 | vgap | testing.md claims the resume refresh under a period is host-tested; no test covers it | low | patch | No test runs the resume refresh, «Обновить» or page 2 with a non-«all» period. |
| 20 | vgap | Player's ↑/↓ seek-key guard has no test | false | reject | Removing it fails typecheck (`swallowUp` is keyed `left`/`right`), as the layer itself noted. |

## Verification

**Commands:**
- `npm run lint -- --max-warnings 0 && npm run typecheck && npm run check:fixtures` -- clean.
- `npm test` ×3 -- all pass; `homeFeedFlow` 30×.

**Result (after the review fixes, 2026-10-29):** lint, typecheck, check:fixtures clean; `npm test` ×3: 1812 passed each; affected suites ×30: 0 failed runs. Device re-check of the fixes on a release-like rebuild (hint, first ↑ after open, single-section custom chip).
