# Epic 3 Context: Find and open a post (P1)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The family browses what they are subscribed to and opens a post: Главная shows the «Новое в подписках» feed, Подписки shows the author grid, an Author page lists one creator's posts, and the Post screen shows the header, one MediaRow per video, the text, and honest locked-content copy, without ever crashing on unknown or malformed data. This is the second half of the P1 vertical slice (sign in → feed → post → video → resume); Epic 4 attaches the player to the MediaRows built here. Stories 3.1–3.5 are done and device-accepted (plus feed/author head refresh and the one-column Post layout); Story 3.6 (Locked posts) is implemented and checked on the device by adb from Автор (`docs/testing.md` «Story 3.6»), pending review and the owner's acceptance. Where newer long-term docs (`docs/api-contract.md`, `docs/focus-map.md`, `docs/testing.md`, ADRs 0007–0012, DESIGN.md/EXPERIENCE.md) or owner decisions contradict the epics text, the newer source wins.

## Stories

- Story 3.1: Subscription feed on the Home screen (done)
- Story 3.2: Subscriptions grid (done)
- Story 3.3: Author page (done)
- Story 3.4: Post screen (done)
- Story 3.5: Media rows in a post (done)
- Story 3.6: Locked posts

## Requirements & Constraints

- **Endpoints (no others):** E5 feed, E2 subscriptions, E3 blog header, E4 author posts, E8 post (`GET /v1/blog/{blogUrl}/post/{postId}?comments_limit=0&reply_limit=0`). All run on the content profile and are LIVE on the device. Every content call sends `comments_limit=0&reply_limit=0`.
- **Locked = HTTP 200**, never 403: `hasAccess=false` (missing → true) or empty `data`; `teaser[]` present (usually an image block); `signedQuery` empty; no `ok_video`/`playerUrls`. Same in E4, E5 and E8. A locked post is never an error or a session problem.
- **Level name:** sanitized live fixtures show a post-level `subscriptionLevel` object on locked posts with a `name` plus price/promo fields. Parse **only** `name`, optional and lenient; never parse or show price, `currencyPrices`, promos, payment or a subscribe action. Already parsed: `src/shared/api/dto/post.ts` reads only `subscriptionLevel.name`, mapped to `Post.levelName` (null when blank). No name → copy without the level.
- **Invalid or missing token looks anonymous:** content endpoints return 200 all-locked, not 401. Always attach the token, rely on E1 validation (start/resume) before trusting `hasAccess=false`, and never phrase locked copy as a session problem.
- **Locked copy (exact):** «Нет доступа. Этот пост доступен подписчикам уровня «…». Оформить подписку можно на сайте или в приложении Boosty.» No price, no button.
- **Comments excluded everywhere:** ignore `count.comments`/`comments`; no counter, focus stop or request.
- **Defensive parsing:** drop (log post id only) posts missing `id`, `createdAt`, `int_id`, `user.name` or a safe `user.blogUrl`; unknown blocks → `Block.Unknown`; any block shape in `data` or `teaser` must not crash.
- **Secrets:** `playerUrls`, `signedQuery`, `timeCode` never reach the domain, UI, query keys, routes, logs or fixtures.
- **Verification:** Chromecast with Google TV 4K, release-like build `-PreactNativeArchitectures=armeabi-v7a`, owner's session; label adb vs physical remote; mocks are never device results. Full suite ×3, new/changed flow tests ×30; lint (`--max-warnings 0`), typecheck, `check:fixtures` clean; PRs only after review fixes. The locked post was checked on the device in 3.6 (agent, adb, from Автор; the feed entry path and the physical remote not yet).

## Technical Decisions

- **Session HTTP:** repositories receive `session.http` from `src/app/session.ts` via props; `shared/api` has no singletons. Images and non-`api.boosty.to` hosts get no Boosty headers.
- **Layers:** screens use only hooks, `shared/ui`, `shared/focus`. Post data comes only from `shared/entities/post` (`PostRepository`, one `mapPost`, one Zod DTO in `shared/api/dto/post.ts`, `Block` union, `postBodyItems`, `videoRowsOf`/`MediaRef`); extend these, never copy. Typed id-only routes (`Post {blogUrl, postId, section}`, `Author {blogUrl, section?}`).
- **Server state (ADR 0010):** TanStack Query; keys only from `queryKeys.ts` (`post(blogUrl, postId)` etc.); query `retry: false`; account-scoped cache reset on account change and sign-in. Feed and Author lists refresh their head on resume / stale reopen via `refreshPostsHead`; the Post screen is not refreshed on resume.
- **Lists (ADR 0011):** FlashList 2.3.3 row grids of 3; recycled cells reset per-item state (`useItemState`, `FocusableSurface resetKey`); list images `resizeMethod="resize"`, `fadeDuration={0}`; keep card trees flat (native view budget tests on PostCard and MediaRow).
- **Navigation (ADRs 0007, 0012):** Author and Post are JS-stack screens with the shared sidebar (`post/nav/<section>`, current item = origin section), `popTo('Shell')` handshake for sidebar OK, Back pops.
- **Phase gating:** `phaseFlags.player` is off; MediaRows have no action and no button role while it is off. Search, filters, «Обновить», «Мой блог», live card stay off.
- **SessionManager split (ADR 0009)** happens before Story 4.2; Epic 3 adds nothing to `sessionManager.ts`.
- **Shared test pieces:** flow harness `src/test/flow.tsx` + `backHandlerMock.ts`, `FixtureTransport` (only HTTP mock), `src/test/postFixtures.ts`/`feedFixtures.ts`, sanitized fixtures in `src/test/fixtures/boosty/` (`e8-post-locked.json`, `e8-no-token.json`, `e4-blog-posts-2.json` contain locked posts).

## UX & Interaction Patterns

- **PostCard locked state already exists** (3.1): dimmed preview, lock glyph, «Нет доступа» badge, no comment count. Open item for 3.6 (or Epic 6): a card without a preview should show the author avatar on a plate.
- **Post screen = one column, header on top** (owner decision 2026-10-27; supersedes two columns and `Post Screen.dc.html`): header (author row → Автор, title ≤ 6 lines, date · read-only likes), then MediaRows (full width), then body (paragraph stops and neutral non-focusable placeholders, text capped ≈ 600 dp). Header is not pinned. The locked copy and later the Epic 4 buttons go in or right under the header.
- **Locked post:** header + teaser blocks (placeholders/paragraphs via the existing body rendering) + the no-access copy; no MediaRows (a teaser video stays a placeholder); initial focus on the author. Copy is informational, not a button.
- **Focus:** initial = first MediaRow, else first paragraph, else author; locked → author. ↑ ↓ walk author → rows → paragraphs in one column guide (trapped at its ends, destination = last focused element); ← → sidebar current item; → back to the remembered element. Skeleton keeps focus on the sidebar; content takes focus only if the user has not moved. Native focus scroll only, never a JS scroll on focus.
- **Ids:** `post/<postId>/author`, `post/<postId>/video/<mediaId>`, `post/<postId>/block/<type>:<id>|<type>@<index>`, `state/post/action`. Every focusable has a Russian a11y label from `ru`; tokens only from `shared/ui/tokens.ts`.
- **States:** E8 404 → «Пост недоступен» + «Назад» (no «Повторить»); other failures → `error.<kind>` + «Повторить». Back returns to the origin card by id with the fallback chain (neighbor → first → action above).

## Cross-Story Dependencies

- 3.6 extends the Post entity/DTO (level name), the Post screen header area and the locked focus rule built in 3.4/3.5/header-layout; card-level locked UI from 3.1 is reused, not rebuilt.
- Open Epic 3 follow-ups: update `docs/feature-parity.md` for Epic 3 in one pass (incl. the inline-link deviation from POST-02); E3 404 error-code retention; demo E8 coverage (dev-only).
- Downstream: SessionManager split before 4.2; Epic 4 adds «Смотреть/Продолжить», «С начала» (placement in or under the header still to decide), progress on MediaRow/`MediaRef`; Epic 6 replaces block placeholders and adds styles/collapse; Epic 7 adds the live card.
