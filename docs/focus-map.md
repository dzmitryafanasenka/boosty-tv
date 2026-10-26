# Focus map

Normative focus contract for every screen of Boosty TV (Android TV, phase 1–3). UI stories implement this file; their component tests and device checks refer to its rows.

- **Sources:** the design focus map (`_bmad-output/planning-artifacts/design/claude-design-v1/docs/focus-map.md`, Russian) and its handoff (`docs/handoff-rn-tv.md` in the same package), with every override from `_bmad-output/planning-artifacts/ux-designs/ux-boosty-tv-2026-10-25/EXPERIENCE.md`. Architecture rules: AD-12 (focus identity and restoration), AD-13 (navigation model), AD-20 (phase gating) in the architecture spine, and [ADR 0007](adr/0007-navigation-js-stack.md). Device facts come from the Story 1.2–1.7 spike (`docs/testing.md`).
- **Precedence:** EXPERIENCE.md > this file > the design focus map > the mocks. A change to focus behavior updates this file in the same change.
- **Status:** written in Story 1.8 (2026-10-26) before any production screen. Nothing here is implemented yet. Device-only facts are marked *(device: …)*; everything else is design intent that the owning UI story must verify on the device.
- Screen ids (`A1` … `L5`) are those of the Claude Design package. User-facing labels stay in Russian, as they appear in the UI.

## 1. Global rules

### 1.1 Input

- Remote only: D-pad, OK (Select), Back, and media keys where the remote has them. No touch, no pointer, no hover action.
- Focus moves **natively** (react-native-tvos focus, `TVFocusGuideView`, `hasTVPreferredFocus`). There is no JS focus engine. Raw D-pad handling with `useTVEventHandler` is allowed in only three places: the player, the custom-period stepper and the audio block (AD-12).
- *(device: Story 1.6)* On the pinned Chromecast with Google TV remote, `useTVEventHandler` receives D-pad left/right **only as key up**; key down never reaches JS. Every raw D-pad handler acts on key up. Up/down and key repeat were not measured, so handlers treat up/down the same way until a device check shows otherwise (measured in Story 4.1 for the player and Story 5.4 for the period stepper).
- *(device: Story 1.6)* The arrow press that moves focus onto a raw-key area (the player, the audio block) must not also act inside it: the spike seeked on that press, because native focus moved on key down and the key up then reached the newly focused area. Rule: after `onFocus`, the area ignores the first key up in the same direction as the focus move if it arrives within a short window (the owning story measures the window on the device; Stories 4.1 and 6.4).
- *(device: Story 1.6)* The Chromecast with Google TV remote has **no media keys**. The media-key mapping (§4 G) applies to remotes and keyboards that have them; it is unverified on the device.
- *(device: Story 1.2)* Native focus movement with the physical remote works with the JS stack and the per-screen trap (owner check passed).

### 1.2 Zones and edges

- Zones: `sidebar ↔ content ↔ filters / side sheets ↔ grid ↔ dialogs`.
- ← from the first content column moves to the sidebar, on the **current** section item. → from the sidebar returns to the last content focus of that section.
- Zone and row transitions use `TVFocusGuideView` destinations. Row-to-row moves keep the horizontal position (the nearest card in the same column).
- **No wrap-around.** At a list or grid edge, a press does nothing except the zone transitions listed here.
- A sidebar section opens **only on OK**, never on focus. The selected section (current item) and the focused item are visually distinct.
- Exactly one focus target is visible. Focus scaling uses `transform`, never layout, and does not clip the focus ring.

### 1.3 Screen trap and layers

- *(device: Story 1.2, ADR 0007)* The JS stack keeps covered screens mounted. **Every stack screen** (Auth*, Shell, Author, Post, Player, SessionExpired) is wrapped in a `TVFocusGuideView` with `trapFocusUp/Down/Left/Right`; without it, D-pad reached the covered screen. The trap is part of the shared screen wrapper in `shared/focus`.
- Side sheets and dialogs trap focus the same way. Nothing behind an open sheet, dialog or QR can receive focus. On close, focus returns to the **initiator** (the element whose OK opened it).
- All overlays (dialog, sheet, QR, sign-out dialog) render in one modal host (AD-13).
- No invisible overlay may hold focus or consume keys.

### 1.4 Back order

Back always closes the topmost layer first (AD-13):

1. the modal host: system keyboard, then dialog / QR, then the deepest side-sheet level;
2. the player layers: settings submenu → settings sheet → overlay → exit;
3. the stack: pop to the previous screen;
4. in Shell: content → sidebar (current item) → Главная (sidebar item «Главная») → exit the app.

At the root (A1 Welcome, A11 Session expired, or the sidebar on Главная), Back exits the app to the system.

Modal Back contract (Story 2.7): the modal host adds its BackHandler listener in `open()`, before the content mounts, so it is newer than every screen listener and wins over them; a listener the dialog content adds on mount is newer still and sees Back first, returning true only to swallow Back (the sign-out dialog while «Выйти» is busy) and false to let the host close. Screens never add a Back listener while a dialog is open.

*(device: Story 1.3)* With the system keyboard open, Back closes the keyboard first and focus stays on the text field.

### 1.5 Focus identity

Focus ids follow `<screen>/<zone>/<id>` with stable content ids, never list indices:

| Example | Element |
|---|---|
| `nav/home`, `nav/subs`, `nav/search`, `nav/events`, `nav/settings` | Sidebar items |
| `home/continue/<videoId>`, `home/feed/<postId>`, `home/feed/retry`, `home/action/filters`, `home/action/refresh` | Главная |
| `subs/tile/<blogUrl>`, `subs/tile/my-blog` | Подписки |
| `author/<blogUrl>/action/search \| filters \| reset`, `author/<blogUrl>/live`, `author/<blogUrl>/live/like`, `author/<blogUrl>/live/share`, `author/<blogUrl>/post/<postId>` | Автор |
| `auth/welcome/signin`, `auth/phone/country`, `auth/phone/number`, `auth/phone/send`, `auth/phone/back`, `auth/phone/to-welcome`, `auth/code/field`, `auth/code/<action>`, `auth/expired/relogin` | Sign-in (A1–A11; `<action>` = `resend`, `change-number`, `new-code`, `retry`; A9/A10 use `auth/phone/change-number` and `auth/phone/retry`, so they never share an id with A5) |
| `filters/access/<value>`, `filters/period`, `filters/tag/<tagId>`, `filters/tags/load-more`, `filters/reset`, `filters/period/<preset>`, `filters/period/custom/<from\|to>/<day\|month\|year>`, `filters/period/custom/done` | Filter sheet, period list and stepper |
| `search/field`, `search/action/filters`, `search/result/<postId>` | Поиск |
| `post/<postId>/primary`, `post/<postId>/restart`, `post/<postId>/author`, `post/<postId>/video/<videoId>`, `post/<postId>/block/<blockKey>`, `post/<postId>/poll/option/<optionId>`, `post/<postId>/poll/submit`, `post/<postId>/poll/retract` | Пост (`<blockKey>`: see below) |
| `player/timeline`, `player/playpause`, `player/settings`, `player/sheet/quality/<q>`, `player/sheet/speed/<v>`, `player/prequality/<q>`, `player/error/retry`, `player/error/back`, `player/ended/back` | Плеер |
| `events/row/<eventId>`, `settings/row/<key>`, `settings/diagnostics/<key>` | События, Настройки |
| `dialog/qr/close`, `dialog/signout/cancel`, `dialog/signout/confirm`, `state/<screen>/action` | Dialogs and StateView |

**Block keys (Story 1.8 decision).** The handoff used `/file/<n>` and `/link/<n>`. In the Story 1.5 fixtures (`src/test/fixtures/boosty/`), `ok_video` and `image` blocks carry an `id`; `text`, `link` and `list` blocks do not (`audio_file` and `file` had no sample). So `<blockKey>` is `<type>:<id>` when the block has an id, otherwise `<type>@<index in data[]>`. If a re-fetched post has a different block count, an index key is treated as gone and the fallback chain (§1.6) applies.

### 1.6 Restoration

- **FocusRestoration** is the only store of the return target: `{focusId, scrollOffset}` keyed by **route key + section id**, so every sidebar section keeps its own memory (AD-12). Only FocusRestoration decides the return focus. Other code may only call `setReturnFocus(routeKey, focusId)`, for example the player pointing at the next unfinished MediaRow (§4 G, Ended).
- Before navigating forward, the screen saves `{focusId, scrollOffset}`. On return:
  1. restore the scroll position;
  2. in a virtualized list, scroll the remembered item into view **by its index in the current data** (found by id), so the item is mounted;
  3. give that item focus (`hasTVPreferredFocus`).
- *(device: Story 1.2, ADR 0007)* After a pop, Android moves focus to the first focusable view of the screen. **Android's fallback focus is never relied on**: restoration is always explicit, on every screen.
- **Fallback chain** when the remembered id is gone (deleted, filtered out, finished): the neighbor by index in the same list → the first item of the zone → the nearest action above (the field, «Фильтры», «Назад»).
- Refetch, pagination, image loading and background updates **never move focus**. Page merges dedupe by id.
- **Skeletons:** while a screen in Shell shows a skeleton, focus stays on the sidebar's current item. When the first item loads, focus moves to the screen's initial element **only if** the user has not moved focus in the meantime. Screens outside Shell (sign-in, Post, Player) keep focus on the busy control or give none until the first focusable element exists.
- **Busy buttons:** while an action runs, the button shows a spinner and keeps focus; another OK is ignored.
- *(device: Story 2.4, debug build, adb)* Restoration by id on a 300-item virtualized list works (card 150 restored after push/pop; fallback to the neighbor and to the action above). The list needs a bounded viewport height (see `docs/testing.md`, Story 2.4).

### 1.7 Phase-gated entry points

Sidebar sections and in-screen entry points (filter chip, speed, «Мой блог», live card, search, События) render only when their `app/phaseFlags.ts` flag is on (AD-20). A hidden entry point is not focusable and is skipped by every transition in this file. When a row below names a hidden element, focus uses the next element in the same direction.

### 1.8 System keyboard

- OK on a text field opens the system IME. There is no custom on-screen keyboard.
- While the keyboard is open, the app does not intercept arrows.
- «Готово» (IME action) on: phone → «Получить код» if the number is valid, otherwise the field; code → submit; search → the first result, or the field if there are none.

## 2. Sign-in (A1–A11)

No sidebar. Each screen is a trapped stack screen.

| Screen | Initial focus | Arrows | OK | Back | Restoration |
|---|---|---|---|---|---|
| A1 Welcome | «Войти в Boosty» | — | → A2 | Exit the app | After sign-out or an account wipe, A1 opens with this initial focus |
| A2–A4 Phone (form, sending, invalid number) | Number field *(Story 1.8 decision: the design says «Поле»; with the editable country code, the number field is focused and ← reaches the code)* | ← from the number field → country code field, → back; ↓ from a field → «Получить код»; ← → between buttons; ↑ from the buttons → number field | Field: system keyboard. «Получить код»: send (busy spinner, focus kept) | → A1 | After «Готово»: «Получить код» if the number is valid E.164, otherwise the number field. After A4 (invalid): the number field |
| A2 after A11 (prefilled phone) | **«Получить код»** (EXPERIENCE override; the design map puts it on the field) | As A2 | As A2 | → A11 | — |
| A5–A8 Code (form, resend countdown, wrong code, expired) | Code field | ↓ → buttons; ← → between buttons; an unavailable «Выслать повторно» (countdown) is not focusable and is skipped | Field: system keyboard; «Готово» submits. Buttons as labeled | → A2 with the number kept | After resend: the code field. A7 wrong code: the code field, cleared *(device: Story 1.3 — the spike cleared it the same way)*. A8 expired: «Выслать новый код» |
| A9 Too many attempts | «Изменить номер» | ← → between buttons | As labeled | → A2 | — |
| A10 Extra verification / captcha | «Попробовать снова» | ← → | One send retry only | → A2 | A10 that cannot be passed is a release blocker; no other path is offered |
| A11 Session expired | «Войти снова» | — | → A2 with the stored phone (initial focus «Получить код») | Exit the app | After re-login with the same account id → Главная with its saved state; with a different account → Главная fresh |

Phone-field rules: the country code is editable, defaults to `+7`, and accepts any E.164 country code (owner uses `+375`). Validity is E.164, not a fixed digit count (the design map's «10 цифр» is superseded).

Implementation notes (Story 2.2, device-verified by adb unless noted):
- A2 routing uses two `TVFocusGuideView` destinations: the field row → the number field, the button row → «Получить код». So ↓ from either field lands on «Получить код» and ↑ from either button on the number, whatever the geometry. Inside a row, focus moves natively.
- Moving focus to a text field (initial focus, after «Готово», after A4, on return to A2) calls `requestTVFocus()` on the field's non-collapsable host view, which focuses the input natively **without** opening the IME. `TextInput.focus()` is never used for this: it opens the keyboard.
- Every return to A1 or A2 (Back, «Назад», «Изменить номер») focuses the target explicitly when the route regains focus.
- Story 2.3 replaced the minimal A5 of Story 2.2 (which had only «Изменить номер»).

Implementation notes (Story 2.3, host tests only; A5 is reached only through a real send, so its device check is the owner's live sign-in):
- A5 ids: `auth/code/field`, `auth/code/submit` («Войти»), `auth/code/resend`, `auth/code/change-number`; A8 replaces «Войти» and «Выслать повторно» with `auth/code/new-code`.
- Like A2, the field row and the button row are `TVFocusGuideView` destinations: ↓ from the field lands on «Войти» (A8: «Выслать новый код»), ↑ from a button on the field. The field is focused with `requestTVFocus()` on its host view (the IME does not open).
- «Выслать повторно» is `disabled` (not focusable) during the 60 s countdown; the sub-label «через 0:42» sits under it. When the countdown ends the button becomes focusable and the hint «Код не пришёл? Можно запросить ещё раз.» appears; focus does not move.
- After a resend (success or failure) and after A7, focus goes to the code field; every resend attempt restarts the 60 s countdown. After A8 «Выслать новый код» succeeds, the form comes back with the field cleared and focused; after it fails, the button is locked by the countdown (sub-label «через 1:00») and focus goes to the field.
- When confirm succeeded but E1 or the session save failed, the challenge is spent: A5 switches to the A8 layout with `error.Unknown` and «Выслать новый код» focused.
- The inline errors, the resend hint and A1's «Войдите снова» are polite live regions (TalkBack announces them without a focus move). Network and unknown confirm errors leave focus where it is (the busy button keeps it).
- After a successful sign-in the stack is replaced by the Shell (Story 2.4; it replaced the temporary SignedIn screen of Story 2.3). A sign-in that finishes after Back from A5 still opens the Shell, because the session exists.
- Startup: a splash with no focusable element until the stored session is read; A1 after a wiped (corrupted) store shows «Войдите снова» above «Войти в Boosty» (focus unchanged).
- A9 also offers «На первый экран» (`auth/phone/to-welcome`, → A1), as in the mock. A10 hides «Попробовать снова» after its one retry; focus then goes to «Изменить номер» (host tests only).

Implementation notes (Story 2.6, host tests; the device rows are in `docs/testing.md`):
- A11 is the `Expired` route (`src/features/auth/ExpiredScreen.tsx`) in the shared screen wrapper. Its only focusable element is «Войти снова» (`auth/expired/relogin`), focused initially and explicitly whenever A11 is the focused route again (Back from A2). Back is not intercepted: A11 is the stack root, so the app exits.
- `expired` from any screen: the app first closes an open modal **without** a focus return to its initiator (the screen behind is going away), clears Главная's offline view, then resets the stack to `[Expired]`. Before the navigator is ready, the reset happens on `onReady`. An existing `[Expired]` stack is not reset again.
- OK on A11 reads the stored phone (status-gated), splits it into the country code and number by the ITU-T calling code list, and opens A2 with the flag `fromExpired` (the phone travels only in `authFlow`'s in-memory draft). The button is busy while the phone is read. With a valid prefilled draft, A2's initial focus is «Получить код»; with no phone or an unknown code, A2 opens empty (`+7`) with focus on the number field. Later returns to A2 (Back from A5) focus the number field as before. «Назад» and Back on A2 pop to A11; A9's «На первый экран» also pops to A11 in this flow.
- After the re-login the stack is replaced by the Shell on Главная. FocusRestoration uses the constant Shell key `shell` (not the route key, which a reset changes): the same account id keeps every entry; a different id (or no previous id) clears FocusRestoration first.

## 3. Shell: sidebar and sections

| Screen | Initial focus | Arrows | OK | Back | Restoration |
|---|---|---|---|---|---|
| Sidebar | The current section item | ↑ ↓ between items (no wrap); → last content focus of the current section | Open the section (content swaps in place; sections are not stack entries) | On Главная: exit the app. Elsewhere: → Главная, focus on `nav/home` | → returns to the section's remembered content focus |
| B Главная (B1–B4) | The first «Продолжить просмотр» card; if the row is hidden (no history), the first feed card | Rows and a 3-column feed grid *(owner decision 2026-10-26, device review)*. ↓ from «Продолжить» → the same column of the first feed row. ↑ from the first feed row → «Фильтры» / «Обновить». ↑ from there → «Продолжить». ← from the first column → sidebar | «Продолжить» card → Player at the saved position. Feed card → Post. «Фильтры» → filter sheet. «Обновить» → reload | → sidebar (`nav/home`) | After Post/Player: the same card (by id) and scroll. «Обновить»: focus stays on the button with «Обновляем…» (EXPERIENCE › Component Patterns); the remembered card id is kept, so ↓ returns to it, or to the fallback chain if it is gone *(Story 1.8 reading of «focus stays on the same card»)* |
| B5 Load-more error | «Повторить» (inline row at the end of the grid) | ↑ → the last row | Reload the page; on success → the first new card | → sidebar | — |
| B6 Skeleton | Sidebar current item (§1.6) | — | — | → as sidebar | — |
| C Подписки (C1–C3) | «Мой блог» tile when its flag is on, otherwise the first author tile | 3-column grid; ← from the first column → sidebar | → D Автор | → sidebar → Главная | After Автор: the same tile by `blogUrl` |
| C3 No subscriptions | No focusable content; focus stays on the sidebar item | → does nothing | — | → Главная | — |

Implementation notes (Story 2.4, device-verified by adb unless noted):
- Shell: `src/app/Shell.tsx`. The sidebar is a `TVFocusGuideView` with `trapFocusUp/Down/Left` and the current item as its destination; the content is a `FocusZone` (`src/shared/focus`) with `trapFocusUp/Down` whose destination is the section's remembered element (FocusRestoration under the Shell route key + section id), else the section's initial element. Главная has no focusable content, so → from the sidebar does nothing there.
- Zone tracking for Back uses the items' focus events; a covered Shell ignores them (Android fallback focus may land on a covered screen).
- Настройки (Story 2.4 part): `settings/row/version` (info row, OK does nothing) is the initial content focus; debug builds add `settings/row/focus-check` («Проверка фокуса»).
- Главная offline (Story 2.5, host-tested; not run on the device): a cold-start E1 that ends in `Network` shows the StateView «Нет подключения к интернету» with «Повторить» (`home/offline/retry`, a FocusZone item). E1 never moves focus: it stays on `nav/home`; OK on the current Главная item (or →) moves focus to «Повторить». While E1 runs again the button is busy and keeps focus. When E1 succeeds the placeholder returns and, if «Повторить» had focus, focus goes to `nav/home` explicitly. Back from «Повторить» → `nav/home`, as for any content.
- Restoration: `useFocusRestoration` restores scroll, then (only when the id's current index differs from the remembered one) `scrollToIndex` by that index, then focuses the item once mounted (the list must provide `getItemLayout`); a user move, blur or unmount cancels the pending focus; fallback neighbor by index → first item → the action above. The modal host focuses the initiator before the unmount, right after it and two frames later (only the last one stuck on the device).

Implementation notes (Story 3.1; device results in `docs/testing.md` «Story 3.1»):
- Главная (`src/features/home/HomeScreen.tsx`): the header «Новое в подписках», then a recycling FlashList (ADR 0011) of 3-column rows (owner decision 2026-10-26, device review) with a bounded height (window − 2 × safe-y − header − gap) and `removeClippedSubviews={false}`. The list's items are rows of 3 posts keyed by the first post id (one item type, fixed row height), so a growing last row keeps its key. Cards are 221 wide: (720 − 2 × 12 headroom − 2 × 16 gap) / 3.
- Focus scroll: each card's focusable view carries half the row gap (11) as vertical padding, so Android's native focus scroll (which puts the focused view flush with the list edge) keeps the scaled card and its ring visible. No JS scroll runs on focus: an earlier JS `scrollToOffset` on focus raced the native scroll on fast ↓ and focus jumped columns. FlashList keeps about 3 rows drawn beyond the viewport (`drawDistance`) so the next row exists when Android's focus search runs; the recycle pool holds 6 rows.
- Partial last row: while more pages may come (and the next page has not failed), a trailing partial row is held back and shown with the next page (E5 pages are 10 posts, so with 3 columns the last row would be 1 card wide; a fast ↓ that outran the next page moved focus into it, i.e. into column 1; device run by adb). ↓ from the last full row then hits the end guide and keeps the column. On the last page the partial row is shown; fewer than 3 posts are always shown. Restoration uses the shown cards only, so a remembered card in a held row falls back by the chain.
- End of the list: a focus guide under the last row (`home/feed/end-guide`) has the focused card as its destination, so ↓ from the last row (also while the next page loads) stays on that card. The loading spinner is not focusable; the arriving page never moves focus.
- Keep scroll on return (owner decision 2026-10-26): Главная remounted with cached cards (Back from another section) opens at the remembered card's row and then the remembered offset; focus stays on the sidebar and → lands on the remembered card (the zone destination).
- Recycling (ADR 0011): recycled cards reset their focus/pressed state and image state per post. FlashList #1843 (focus jumping on a data change) was not reproduced on the device (adb, 2026-10-26); the earlier frame-timed re-focus was removed because it reverted the user's own ↓ during mount hitches. A future fix for a data-change jump must key off D-pad events, not frame timing.
- Render cost: cards and rows are memoized with stable props; a focus move re-renders only the focus state of the two cards, a page append re-renders no existing card. A pending card focus (a card that mounts after the list's layout pass) lands only while the Shell is active and focus is still on `nav/home`, a feed card or a Главная action; if the card never mounts, focus gives up to `nav/home`. The FocusZone updates its guide destination only when an item (un)mount can change it (the remembered, the initial or the current destination item).
- Ids: cards `home/feed/<postId>`, the load-more row `home/feed/retry`, the empty/error StateView action `state/home/action`. Every card and action is a content FocusZone item, so ← reaches `nav/home`, → returns to the remembered card, and Back from content goes to `nav/home`. Cards also report to FocusRestoration (route key `shell`, section `home`) with their index and the scroll offset.
- Skeleton (B6): two non-focusable rows; focus stays on `nav/home`. When the first cards arrive while Главная is shown, focus moves to them only if the Shell is the focused route and the last focused Shell element is still `nav/home` (or nothing yet), or the StateView action that was just pressed. The target is FocusRestoration's remembered card (fallback chain), else the first card. Cards already cached when Главная mounts (Back from another section) do not take focus; a section opened with OK on «Главная» restores the remembered card (scroll, index, then focus).
- Empty («Новых постов нет» + «Обновить») and full error (`error.<kind>` + «Повторить»): the StateView does not take focus by itself, like the offline view of Story 2.5; → or OK on «Главная» reaches the action. While a retry runs the action stays mounted and busy (focus kept). Success with cards → the first card; still failing → focus stays.
- Load more: a card of the last row getting focus, or the list nearing its end, requests the next page. Pages append and dedupe by `post.id`; focus never moves. A failed page shows the inline row (B5) with «Повторить»; OK reloads that page only; on success the first new card is focused if focus is still on «Повторить».
- Opened with OK on «Главная», the first cards (or the empty/error action) take focus only if focus is still on `nav/home` when they arrive; a move within the sidebar during the skeleton wins. Opened with OK while offline: focus goes to «Повторить» (`home/offline/retry`).
- A load-more retry that adds no new card and removes the row focuses the last card. A page that adds no new card but has a next cursor loads the next page by itself (no focus move), at most 3 times in a row; then auto-paging stops (with no card, «Новых постов нет» shows) until a user action (focus in the last row, «Повторить», «Обновить»). Otherwise «Новых постов нет» shows only when there is no next page.
- OK on a feed card does nothing until Story 3.4 (owner decision 2026-10-26).
- A covered or closing Shell never takes focus (a page that arrives during the reset to A11 does not steal A11's focus).
- Resume refresh (owner decision 2026-10-26, host-tested; `spec-feed-refresh-on-resume.md`): after a resume E1 `ok` with a cached feed at least 60 s old, page 1 is fetched once and its new posts go on top; loaded pages stay. The rows regroup and remount (rows are keyed by their first post id), so when the shown ids change other than by an append and a feed card had focus (read in a layout effect right after the commit), that card (by id) is scrolled into view at its new row (if its index moved) and focused again. If the move puts it into the held partial row, that row is shown while the card has focus. A card that is gone (a gap: the cache became page 1 alone) follows the fallback chain (neighbor by index → first card → the action above), else the first card. Focus on the sidebar, a StateView action or «Повторить» is never taken, and a covered Shell never takes focus. The trigger is the head change, never frame timing. A prepend never auto-fetches a further page (only an append changes the last post).

Overrides applied here: **no LIVE card on Главная** (a live stream appears on Главная only if the feed is proven to return stream posts; until then OK on a feed card always opens Post). For more than 30 subscriptions the grid shows «Показаны первые 30» (text only, not focusable) instead of the design's «28 из 55» counter (EXPERIENCE › Visual references › Overrides).

## 4. Content screens

### D Автор and the filter sheet

| Screen | Initial focus | Arrows | OK | Back | Restoration |
|---|---|---|---|---|---|
| D Автор (D1–D7) | The live card if a stream is live, otherwise the first post | Action row (search, «Фильтры», «Сбросить») ↔ live card ↔ 3-column post grid *(owner decision 2026-10-26, device review)*. From the live card: → «Нравится», ↓ from «Нравится» → «Поделиться». ← from the first column → sidebar | Search field: system keyboard. «Фильтры»: filter sheet. Live card: live player if live and `hasAccess`, otherwise QR to the stream page. «Нравится»: optimistic toggle, no double send while in flight. «Поделиться»: QR. Post → F | Active search: clear it, focus on the search field. Otherwise pop to the previous screen (C, F or J) | After Post/Player: the same card. Stream ended: the first post (where the live card was) |
| D Filter sheet (D8) | The selected «Доступ» value | ↑ ↓ in one column (access values, «Период», tags, «Загрузить ещё», «Сбросить»); ← → nothing | Every change applies at once (no Apply button); the list behind refetches while focus stays in the sheet. Tag: toggle check. «Загрузить ещё»: next tag page, focus stays. «Сбросить»: reset | Close; focus → «Фильтры» chip (shows the active count) | «Сбросить» appears only for non-default filters; when it disappears after a reset, focus → «Доступные мне» |
| D Period list (D9) | The current period | ↑ ↓ | Select → back to the sheet, focus on «Период»; «Свой период…» → D10 | → sheet, focus on «Период» | — |
| D Custom period (D10) | «С: день» | ← → between day, month and year fields (and the «по» group); ↑ ↓ change the value (raw keys, §1.1); OK on a field → «Готово»; ↑ from «Готово» → the first field | «Готово» → sheet, focus on «Период» | → period list | — |

The same sheet and period rows apply to the filter sheet opened from Главная and Поиск; its initiator is that screen's «Фильтры».

### E Поиск

| Screen | Initial focus | Arrows | OK | Back | Restoration |
|---|---|---|---|---|---|
| E Поиск (E1–E10) | Search field (label «Поиск по подпискам») | → «Фильтры»; ↓ → results; ↑ from the first result row → field; ← from the field or first column → sidebar | Field: system keyboard; result → F | Keyboard open: close it (focus on the field). Otherwise → sidebar | After «Готово»: the first result, or the field if there are none. After Post: the same query, filters and result card |
| E Nothing found | «Сбросить фильтры» when filters are active, otherwise the field | ↑ → field | Reset filters | → sidebar | — |

### F Пост

| Screen | Initial focus | Arrows | OK | Back | Restoration |
|---|---|---|---|---|---|
| F Post (F1–F6) | «Смотреть» / «Продолжить» (targets the first unfinished media). No video: the first focusable block on the right. Locked post: the author | Left column (primary, «С начала» only when progress > 0, author) ↑ ↓; → into the right column. Right column: ↑ ↓ between blocks; ← → inside a row (inline links, poll buttons); ← from a row's first element → left column | Primary / MediaRow → Player for exactly that media. File, link, YouTube → QR dialog. Author → D. Image, paragraph: nothing | Pop to the source (B, D, E or J). Audio stops | After Player: the initiator (primary or that MediaRow). After a natural end: see G Ended. After QR: the initiator |
| F Unsupported block | Not focusable unless it has an action | — | — | — | — |
| F QR dialog (F7) | «Закрыть» | — | Close | Close | The initiator (file row, link, «Поделиться», live card) |

**AudioBlock exception:** ← and → seek inside the block, so ← does not move to the left column from an audio row; ↑ ↓ leave the block first. **Single playback (AD-19):** opening the Player from the post stops a playing AudioBlock; it does not resume on return, and focus returns to the initiator as usual.

Block focus stops: ImageBlock (so tall images scroll into view), each paragraph of expanded long text (ParagraphStop), LinkChip, AudioBlock, MediaRow, PollOption. LikeCount is **not** focusable. A finished poll is one focus stop. Comments are not shown and have no counter or focus stop.

### G Плеер

Raw keys (`useTVEventHandler`, key up, §1.1). Seek steps: overlay hidden or timeline focused → 5 s per press; repeated presses during an in-flight seek **build on the pending target**, never on the stale position *(device: Story 1.6)*. Acceleration while a key is held needs key-repeat events; whether this remote sends them is unverified, so the player story measures it before relying on it.

| Screen | Initial focus | Arrows | OK | Back | Restoration |
|---|---|---|---|---|---|
| G Playing, no overlay | The player surface | ← → seek and show the overlay with the bubble; ↑ ↓ show the overlay | Pause + show the overlay | Exit the player (E9 write) | Exit → the initiator on the origin screen |
| G Overlay (G2–G4) | Timeline | Timeline: ← → seek; ↓ → controls. Controls: ← → between them; ↑ → timeline | Timeline: play/pause. Control: its action (e.g. «Настройки» → sheet) | Hide the overlay | — |
| G Settings sheet (G5–G7) | «Качество» | ↑ ↓ | Row → submenu | Submenu → sheet → close, focus → «Настройки» | Quality option: reload at the same position, store the preference, close the sheet, focus → «Настройки». Speed option (recordings only): select and close the submenu |
| G Quality before playback (PLAY-02, no automatic pick; row added in Story 1.8) | The first listed quality | ↑ ↓ | Start playback with that quality | Close without playing; → the initiator | — |
| G Recovering («Восстанавливаем воспроизведение…»; row added in Story 1.8) | No focusable action | — | — | Exit the player | On success the previous focus (surface or overlay) |
| G Error (G8) | «Повторить» | ← → «Повторить» / «Назад» | As labeled | Exit the player | — |
| G Live (G9–G10) | Play/pause | ← → between controls; no seeking | As labeled; resume jumps to the live edge | Hide the overlay → exit | — |
| G Stream ended (G11) | «Назад» | — | Exit | Exit | D Автор: the first post (where the live card was) |

- **Overlay visibility:** shown on OK, any arrow, pause and media keys. It auto-hides only while playing; it **never** hides while paused, while seeking, with the sheet open or on an error.
- **Media keys** (where the remote has them; unverified on the device): Play/Pause toggles; FF and Next seek forward; Rew, Prev and Step-back seek backward; Stop exits with an E9 write; Menu, Info and Settings open the settings sheet.
- **Ended** (≥ 95 % watched or < 30 s left counts as finished; playback is not interrupted at the threshold). When a recording actually ends, a final E9 write, then exit: from a post → `setReturnFocus` on the next unfinished MediaRow, or the primary button if there is none; from Главная → the neighbor of the removed «Продолжить» card, or the first feed card if the row is now empty. No autoplay.
- **Resume from sleep or background:** the player stays paused with the overlay shown and focus on the timeline *(device: Story 1.6 — the spike resumed by itself after wake; production must not)*.
- **Media not entitled:** exit to the initiator with the no-access message.
- **Session expired in the player:** best-effort E9 write, then A11.

### H Audio, I Polls

| Screen | Initial focus | Arrows | OK | Back | Restoration |
|---|---|---|---|---|---|
| H AudioBlock | The block (one focus target in the post's right column) | ← → seek 10 s (raw keys, key up); ↑ ↓ leave the block | Play/pause | Leave the post; audio stops | Only one track plays app-wide; audio-focus loss pauses it |
| I Poll, single choice | Options in order (no option is focused on entry; the post's normal ↑ ↓ reaches them) | ↑ ↓ between options | 1st OK: pending («Нажмите OK ещё раз»); 2nd OK on the same option: vote. On the chosen option: 1st OK pending «Нажмите OK ещё раз, чтобы отозвать», 2nd OK retracts. Moving focus cancels pending | Leave the post | After every response the poll is re-fetched; focus stays on the option. On failure: inline error, previous state kept, no automatic retry |
| I Poll, multiple choice | The first option on entry from above | ↑ ↓; «Проголосовать» is focusable only while at least one option is checked | Option: toggle the check. «Проголосовать»: send (no extra confirm) | Leave the post | After voting: results with «Отозвать голос» (two OKs: pending, then confirm) |
| I Finished poll | The whole poll is one stop | — | Nothing | Leave the post | — |

## 5. Events, settings and states

| Screen | Initial focus | Arrows | OK | Back | Restoration |
|---|---|---|---|---|---|
| J События (flag-gated; E18 shape verified in Story 1.5, paging not) | The first event | ↑ ↓; ← → sidebar | → D Автор; for a live event the author page opens with focus on the live card (OK there opens the live player; it does not start from J directly) | → sidebar | After Автор: the same row by event id |
| K Настройки (K1–K3) | The first row | ↑ ↓; ← → sidebar | Row by kind: nav → submenu or sheet; toggle → flips at once; radio → selects and closes the submenu; check → toggles; info → nothing. 7 OKs on «Версия» reveal diagnostics | → sidebar. In diagnostics or a submenu → back to Настройки, focus on the row that opened it | — |
| K Settings submenu or sheet | The selected value (radio), otherwise the first row | ↑ ↓ | Per SettingRow kind; radio selects and closes the submenu | Close, focus on the row that opened it | — |
| K Diagnostics (SET-05, revealed) | The log-capture toggle | ↑ ↓; ← → sidebar | Toggle; the info rows (how to fetch logs via adb) are not activatable | → Настройки, focus on «Версия» | — |
| K «Системный видеоплеер» handoff (PLAY-13, Android only) | — | — | With the toggle on, OK on a media row opens the quality list (as G Quality before playback), then the Android chooser | The external app owns Back; on return to Boosty TV, focus is on the initiator (no progress is tracked) | «Внешний плеер не найден» → the built-in player opens instead |
| Update notice (FR-56, Story 9.2; non-blocking) | None: the notice never takes or traps focus when it appears on its own | — | Shows the version, changelog and a QR to the release page; nothing is installed | Does not consume Back | Story 9.2 decides where the notice is focusable and records the row here |
| K Sign-out dialog (K4) | «Отмена» | ← → «Отмена» / «Выйти» | «Выйти»: `AccountScope.reset()` — secure storage first (the stored phone, then the session or expiry marker), then every other account-scoped store (FocusRestoration, the sign-in draft, the log ring; later the query cache, the continue-watching history and filters) → A1. «Отмена»: close | Close (same as «Отмена»); ignored while «Выйти» is busy | Cancel → «Выйти из аккаунта» |
| L StateView (loading error, empty, offline, unavailable) | Its single action («Повторить», «Обновить», «Назад»; none for C3) | ← → sidebar (inside Shell) | The action | As the screen | After success: the first element of the loaded list |
| Cold start offline | Главная StateView «Повторить» | ← → sidebar | Retry | → sidebar | The session is kept; this is not A11 |
| Content unavailable (404) | «Назад» | — | Pop | Pop | No «Повторить» |

Implementation notes (Story 2.7; the dialog rows device-verified by adb, the sign-out itself host-tested only by owner decision):
- Настройки: `settings/row/version` (info, the initial content focus), then `settings/row/signout` «Выйти из аккаунта» (nav row, no subtitle); the `__DEV__` rows follow. ↑ ↓ between rows, no wrap.
- OK on the row opens the dialog in the modal host with the row as the initiator. Ids `dialog/signout/cancel` (preferred focus) and `dialog/signout/confirm`, in one row: ← → move natively; ↑ ↓ and the edges are trapped. «Отмена» or Back closes it and focus returns to the row.
- «Выйти» is busy while `AccountScope.reset()` runs; a repeated OK, «Отмена» and Back are ignored meanwhile. Success: the modal closes **without** a focus return, the stack is reset to `[Welcome]` and A1's «Войти в Boosty» takes the initial focus («Войдите снова» is not shown). Failure (a SecureStore clear rejects): the dialog stays with the polite error line «Не удалось выйти из аккаунта. Попробуйте ещё раз.», focus stays on «Выйти» (nothing moves it), and OK retries.

**Session expired mid-session:** A11 replaces the stack from any screen (Shell, Post, Player). FocusRestoration entries survive the sign-in flow only for the same account id; after re-login the app lands on Главная with its remembered focus, not on the screen where the session expired.

**Account switch:** when the signed-in `E1.id` differs from the stored account id, all account state is wiped and Главная opens fresh with its initial focus (§3). The same id keeps every FocusRestoration entry that is still valid.

## 6. Verification ownership

| Rule | Verified by |
|---|---|
| Sidebar, Главная, «Продолжить», «Обновить», Подписки, «Мой блог» | Stories 3.1, 3.2, 4.7, 5.1, 5.2 |
| Автор, live card, like and share | Stories 3.3, 7.1, 7.4 |
| Поиск | Stories 5.6, 5.7 |
| Post, media rows, locked post, blocks, QR | Stories 3.4–3.6, 6.1–6.3 |
| Player quality, recovery, Ended | Stories 4.3–4.5 |
| Live player, stream ended | Stories 7.2, 7.3 |
| События | Story 7.5 |
| Settings, sign-out dialog, account switch | Stories 2.7, 2.8 |
| System player, diagnostics, speed | Stories 8.1–8.3 |
| Update notice | Story 9.2 |
| StateView and global states | Each owning screen story; Story 9.5 regression |
| Screen trap, explicit restoration by id, long virtualized list, Back order in Shell | Story 2.4 (device) |
| Sign-in focus rows A1–A11 | Stories 2.1–2.3, 2.6 |
| Player raw keys, key-up behavior, up/down and key repeat (held-seek acceleration), focus-entry key-up guard, seek accumulation, sleep/wake | Stories 4.1, 4.6 |
| Media keys | Unverified until a remote or keyboard with media keys is available |
| Filter sheet, period stepper (including raw up/down key-up semantics), tags | Stories 5.3–5.5 |
| Polls, audio (including the focus-entry key-up guard) | Stories 6.4–6.7 |
| Full regression with the physical remote | Story 9.5 |
