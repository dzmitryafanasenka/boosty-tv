# Boosty API contract (unofficial)

Status: **draft from reference-code audit.** The reference is BoostBuddy `1.16.0` (`b9acb6c`), audited 2026-10-25. See `docs/feature-parity.md` for the audit metadata and path shorthands (`cm/`, `am/`).

## Evidence levels

| Level | Meaning |
|---|---|
| `REF` | Request and fields are used by the shipped BoostBuddy 1.16.0 client (`cm/data/api/BoostyApi.kt`, `PhoneAuthApi.kt`, repositories). This is strong evidence that the endpoint worked for the reference author, but it is **not verified by us**. |
| `REF-DEAD` | Present in the reference client but not reachable from its UI. |
| `RE-SPEC` | Listed only in the reference's reverse-engineered `cm/data/api/openapi/boosty-api.yaml` ("extracted from the public web bundle and Android APK; not official"). Treat it as **unverified**. Do not build on it without a live check. |
| `LIVE` | Verified by this project on a real device or account. First entries: §2.2 phone sign-in (Story 1.3, 2026-10-25), §2.3 refresh and §2.4 logout (Story 1.4, 2026-10-25). |

Rules:
- Do not add endpoints that are not listed here.
- There is **no** Boosty device-code / QR authorization flow at any evidence level. Do not invent one.
- Any field marked "unverified" must be parsed defensively (optional, with a fallback).
- Update this file with `LIVE` evidence and sanitized fixtures (`src/test/fixtures/`) during the spike.

## 1. Transport

| Item | Value | Evidence |
|---|---|---|
| Base URL | `https://api.boosty.to/` | `REF` `cm/data/ktor/HttpClient.kt` |
| Auth header | `Authorization: Bearer <access_token>` on every API call, when a token exists | `REF` `tokenRefreshPlugin` |
| User-Agent | The main client uses a mobile Chrome UA. The refresh and phone-auth clients use a desktop Chrome UA. | `REF` `USER_AGENT`, `DESKTOP_USER_AGENT` |
| Web-style headers (refresh and phone-auth only) | `X-App: web`, `X-Locale: ru_RU`, `Referer: https://boosty.to/`, `Origin: https://boosty.to`, `Accept: application/json, text/plain, */*`; `Accept-Charset` removed; `X-From-Id: <device_id>` | `REF` `buildBoostyAuthHttpClient`, `doRefresh` |
| Body encoding for mutations | `application/x-www-form-urlencoded` | `REF` |
| JSON | camelCase fields; reference uses `ignoreUnknownKeys`-style tolerant DTOs (all fields nullable) | `REF` models |
| Timeouts (reference) | connect 15 s, request 30 s, socket 30 s | `REF` |
| `device_id` | A client-generated UUIDv4, persisted once per install and sent with refresh and phone auth | `REF` `SettingsRepository.getOrCreateDeviceId` |

Whether Boosty requires the UA or web headers on normal API calls is **unverified**. The spike should test the minimal header set.

## 2. Authentication

### 2.1 Website sign-in → `auth` cookie (`REF`)

- The client loads `https://boosty.to` in a WebView, and the user signs in on the official site.
- After sign-in, the cookie jar for boosty.to contains a cookie named `auth`. Its value is URL-encoded JSON:
  ```json
  { "accessToken": "<string>", "refreshToken": "<string>", "expiresAt": <number> }
  ```
- Units of `expiresAt` are **unverified**. The reference compares the value to epoch **seconds**. If the value is in milliseconds, the proactive refresh would never fire, and the reactive 401 path would still cover it.
- Validation: `GET /v1/user/current` must succeed. If it does not, the token is rejected.
- Evidence: `cm/components/auth/AuthComponent.kt` (`onCookiesChanged`, `parseCookies`, `checkToken`), `cm/data/repositories/models/AuthResponse.kt`.
- Risk: this relies on an internal website cookie format, not a public contract, so it can break without notice.

### 2.2 Phone and one-time-code sign-in (`REF`)

`POST /auth/phone/verification_code/send` (no Bearer)

| Form field | Value |
|---|---|
| `phone` | E.164, e.g. `+79990000000` |
| `device_os` | `web` |
| `device_id` | install UUID |
| `transport` | optional. Omitted on the first send. `gate` is used for "resend" |

Header: `X-From-Id: <device_id>`.

Response, as used by the reference:
```json
{ "data": { "phoneCode": { "code": "<challenge>", "sentTransport": "<string?>", "expiresIn": <ms?>, "phone": "<string?>" } } }
```
`expiresIn` is divided by 1000 in the reference, so it is presumably in milliseconds (unverified). The reference enforces a client-side 60 s resend cooldown, but the server-side limit is unknown.

`PUT /auth/phone/verification_code/confirm` (no Bearer)

| Form field | Value |
|---|---|
| `phone` | same as send |
| `code` | challenge `code` from send |
| `sms_code` | code entered by user |
| `device_os` | `web` |
| `device_id` | install UUID |

Response: `{ "access_token": "...", "refresh_token": "...", "expires_in": <seconds> }` (snake_case). The reference treats `expires_in` as seconds.

Error shapes: wrong code (400 `invalid_sms_code`) and resend rate limit (429 `sms_gate_ratelimit`) are `LIVE`, see below. Expired challenge and captcha required are still **unverified**. The reverse-engineered spec mentions `/auth/phone/mobile_captcha/send` (`RE-SPEC`), which suggests captcha can be required.

**This is the selected sign-in flow for Boosty TV** (owner decision 2026-10-25, feature-parity Q1). §2.1 is kept as reference knowledge and fallback research only.

#### Live evidence (Story 1.3)

Implementation guidance derived from the live run (for Stories 2.2/2.3):
- Keep a client resend cooldown (60 s, as the reference does). The server allowed a resend at 32 s, but rapid resends return 429 `sms_gate_ratelimit`.
- `sms_gate_ratelimit` can also come on the **first** send of a new sign-in (see «Rate limit, longer window» below), and the server gives no wait time. Show «Слишком много попыток. Попробуйте позже» with no countdown and no automatic retry. Every sign-in spends the limit, so the session must not be dropped without need.
- Detect captcha or extra verification only on the auth endpoints (send/resend/confirm) and only on non-2xx responses. Never scan successful bodies such as E1 (`/v1/user/current` carries many `flags.*` fields).
- Guard non-idempotent auth requests (send, confirm) with an in-flight ref, not React state, so that a held or auto-repeated remote key cannot fire them twice.

Recorded 2026-10-25 on the pinned Chromecast with Google TV 4K (Android TV 14), release-like build, branch `spike/1-3-phone-auth`. The owner typed the phone and the code with the physical remote. Results are taken from the spike's sanitized log.

The spike client (`src/app/spike/phoneAuthApi.ts`) sends exactly the two requests above plus E1:
- send/confirm: form-encoded body (`+` → `%2B`), headers `X-App: web`, `X-Locale: ru_RU`, `Referer: https://boosty.to/`, `Origin: https://boosty.to`, `Accept: application/json, text/plain, */*`, desktop Chrome `User-Agent`, `X-From-Id: <device_id>`, no `Authorization`;
- E1: the same web headers (no `X-From-Id`) plus `Authorization: Bearer`;
- `credentials: 'omit'`, so no cookie is sent or stored in the native cookie jar; one 30 s timeout; no automatic retry.

Recordings keep only the HTTP status, content type, `Retry-After`, key paths with value types and string lengths, and the values of `sentTransport`, `error`-like enums and `expiresIn`/`expires_in`. Phone, challenge, SMS code and tokens are never recorded. Whether this full header set is required was not tested (the minimal set is still open).

| Case | Request | Status | Sanitized shape | Level |
|---|---|---|---|---|
| Send, first time (no `transport`) | `POST …/send` | **200** `application/json` | `data.phoneCode{code: string (len 64), expiresIn: number = 604800, phone: string (len 13), sentTransport: string = "gate"}`. `sentTransport` is `gate` even on the first send. The code arrived in **Telegram** (owner-reported) | `LIVE` |
| Resend, 32 s after the send | `POST …/send` `transport=gate` | **200** | Same shape; a new challenge `code` is issued (`expiresIn` 604800, `sentTransport` `gate`). The server allowed a resend at 32 s, so the reference's 60 s client cooldown is stricter than the server | `LIVE` |
| Resend too soon (2 s and 5 s after the previous resend) | `POST …/send` `transport=gate` | **429** `application/json` | `{error: string = "sms_gate_ratelimit", error_description: string (len 48)}`. Maps to a rate-limited / too-many-attempts error for resend. The owner pressed resend three times in total, not once | `LIVE` |
| Confirm, wrong code | `PUT …/confirm` | **400** `application/json` | `{error: string = "invalid_sms_code", error_description: string (len 15)}`. Maps to a wrong-code error | `LIVE` |
| Confirm, correct code (latest challenge, 31 s after the resend) | `PUT …/confirm` | **200** | `{access_token: string (len 64), refresh_token: string (len 64), expires_in: number = 2592000}`. Tokens are 64-character opaque strings, **not JWTs**. `expires_in` = 2 592 000 = 30 days if seconds, which matches the reference's reading | `LIVE` |
| E1 with the new token | `GET /v1/user/current` | **200** | Large object, including many `flags.*` fields. Not recorded further | `LIVE` |
| Confirm, expired challenge | `PUT …/confirm` | **not verified** (the owner entered the real code within the window) | — | unverified |
| Too many confirm attempts | — | not triggered (owner decision) | — | unverified |
| Captcha demanded | any | **Not observed** in this session (send, 3 resends, wrong and correct confirm) | — | `LIVE` (not observed, not proof of absence) |
| `expiresIn` units (send) | — | 604800 is either about 10 min in milliseconds or 7 days in seconds | — | **unverified** |
| `expires_in` units (confirm) | — | 2592000. Seconds per the reference (30 days); the real lifetime is not measured (refresh returns the same value, Story 1.4) | — | unverified |

#### Rate limit, longer window (Story 1.5 sign-in attempt, 2026-10-25)

The Story 1.5 run needed a new sign-in after the Story 1.4 logout. Every send was rejected:

| Case | Request | Status | Sanitized shape | Level |
|---|---|---|---|---|
| First send of a new sign-in, about 1 h after the last successful code | `POST …/send` (no `transport`) | **429** `application/json` | `{error: "sms_gate_ratelimit", error_description: "To many attempts to send sms, sms-gate ratelimit"}` (server text, typo included). No `Retry-After`, `X-RateLimit-*` or `RateLimit-*` header. Response header names: `access-control-allow-*`, `access-control-expose-headers`, `cache-control`, `content-length`, `content-type`, `date`, `vary` | `LIVE` |
| The same, from the boosty.to website in a desktop browser (owner-reported) | `POST https://api.boosty.to/auth/phone/verification_code/send` | **429** | The same `error` and `error_description` | `LIVE` (owner) |

Facts:
- Two codes were sent successfully on 2026-10-25: 17:29 (send) and 17:30 (resend). After that, all eight requests were rejected with 429: two rapid resends at 17:30, then the first sends of a new sign-in at 18:34, 18:35, 18:42 and 18:52, plus one from the website.
- The website gets the same 429. Its `device_id`, client and headers differ from ours, so the limit is server-side. It is keyed by the phone number or the IP address, not by `device_id` or our request format. Phone vs IP was not separated: the website attempt probably used the same home IP.
- The server does not say when sending is allowed again. The window and the threshold are unknown. Rejected attempts may extend the window; this was not tested and will not be tested on purpose.

### 2.3 Token refresh (`REF`, partly `LIVE`)

`POST /oauth/token/`

| Form field | Value |
|---|---|
| `grant_type` | `refresh_token` |
| `refresh_token` | stored refresh token |
| `device_id` | install UUID |
| `device_os` | `web` |

Headers: the web-style set above plus `X-From-Id`.

Response: `{ "access_token", "refresh_token"?, "expires_in"? }`. A new refresh token is stored if one is returned. Rotation is `LIVE`-verified (Story 1.4, below): Boosty always returned a new refresh token, and the old one is rejected.

Reference policy, which we will reimplement rather than copy:
- Single-flight via a mutex.
- Proactive refresh when less than 300 s remain before expiry.
- On 401: refresh once and retry the original request once. If refresh fails, surface 401, which leads to the signed-out state.

Resolved in Story 1.4 (below): refresh tokens are single-use and rotate; a rejected refresh is HTTP 400 `invalid_grant`. Still unverified: refresh-token lifetime. Whether a `device_id` mismatch alone causes the rejection (the live result is ambiguous) is **closed as not needed for production** (owner decision 2026-10-25, Story 1.5; no requests sent): production always sends the same install `device_id`, and a rotated-out refresh token fails anyway, so neither answer changes client behavior. The cookie flow has no `device_id` at sign-in, yet the reference refreshes those tokens with its own `device_id`.

An unused leftover in the reference, `BoostyApi.refreshToken`, sends `device_os=android` without headers. It is not used.

#### Live evidence (Story 1.4)

Recorded 2026-10-25 on the pinned Chromecast with Google TV 4K (Android TV 14), release-like build, branch `spike/1-4-refresh-logout`, with the owner's session from Story 1.3. The agent ran each case once with keys injected via adb (owner-approved), reading results from the spike's sanitized log. The spike client (`src/app/spike/refreshCoordinator.ts`) sends the form above with the same web headers as §2.2 plus `X-From-Id`, no `Authorization`, `credentials: 'omit'`. "Corrupted" means the app altered its own stored copy of the token (same length, every alphanumeric character changed); no other token was ever sent.

| Case | Request | Status | Sanitized shape | Level |
|---|---|---|---|---|
| Refresh with a valid refresh token | `POST /oauth/token/` | **200** `application/json` | `{access_token: string (len 64), refresh_token: string (len 64), expires_in: number = 2592000}`. Same shape as the phone confirm response. A new access token every time | `LIVE` |
| Rotation | — | — | **Yes.** All 3 successful refreshes returned a `refresh_token` different from the one sent. Store the new refresh token after every refresh | `LIVE` |
| Reuse of the previous (rotated-out) refresh token | `POST /oauth/token/` | **400** `application/json` | `{error: string = "invalid_grant", error_description: string (len 29)}`. Refresh tokens are **single-use**. The access token issued by the newer refresh kept working (E1 200) right after the reuse attempt, so the reuse did not revoke the current access token. Whether it revoked the newer *refresh* token is not known (see the `device_id` row) | `LIVE` |
| Corrupted refresh token ("refresh rejected" signal) | `POST /oauth/token/` | **400** `application/json` | `{error: string = "invalid_grant", error_description: string (len 29)}`. This is the observed rejection signal: **HTTP 400 with `error = invalid_grant`** → «expired». Not 401 | `LIVE` |
| Refresh with a different `device_id` (random UUIDv4, also in `X-From-Id`), valid-looking current refresh token | `POST /oauth/token/` | **400** | `{error: string = "invalid_grant", error_description: string (len 29)}`, the same shape as an invalid token. E1 with the current access token still returned 200 afterwards. **Ambiguous:** this refresh token had not been used before, but the reuse attempt above had happened earlier in the same session, so the rejection is either a `device_id` binding or a revocation caused by that reuse. Not disambiguated (no extra refresh was sent; each case once) | `LIVE` (ambiguous) |
| E1 with a corrupted access token | `GET /v1/user/current` | **401** `application/json` | `{error: string = "unauthorized", error_description: string (len 22)}` | `LIVE` |
| `expires_in` units | — | — | `2592000` on every refresh, as at sign-in. Read as seconds (30 days); the real lifetime was not measured | unverified (units) |

Implementation guidance derived from the live run (for the session stories):
- Treat refresh **400 `invalid_grant`** as «refresh rejected» → «expired». Keep 5xx, 429, timeouts and transport errors as recoverable with the tokens kept. The exact `error_description` text was not recorded and must not be matched on.
- Refresh tokens rotate and are single-use: persist the new pair atomically after every successful refresh, and never send a refresh token twice (single-flight). A lost refresh response (for example a timeout after the server answered) can leave the client with a burned refresh token; the next refresh then gets `invalid_grant` and the user must sign in again. This is a known risk of single-use tokens, not a reason to retry the refresh.
- Always send the install's own `device_id`; a different one is rejected (at least in the circumstances above).

Production refresh-coordinator requirements (from the Story 1.4 review; binding for the session stories):
- **Rejection signal:** only `400` with `error: "invalid_grant"` means «expired». Any other 4xx/5xx/429/timeout keeps the tokens (the spike predicate was narrowed to match; tests cover 400 other-error, 401 and 403).
- **Timeouts:** every refresh and API request has a timeout (`AbortController`). A hung refresh must not hold the single-flight promise forever.
- **Persist before adopt:** refresh tokens are single-use, so the new pair is written to `SecureStore` before it replaces the in-memory session. A failed or throwing save is surfaced as a distinct result, not only a log line.
- **Burned-token risk:** a 200 that cannot be parsed, or a lost response after the server processed the refresh, has probably consumed the refresh token. Treat these as "session may be lost": keep the current state, but expect `invalid_grant` on the next refresh and show «Войдите снова» calmly, without a loop.
- **Races:** a session generation guards `signOut`/`reload` against an in-flight refresh. A late rejection never turns «signed-out» into «expired»; a late success after `reload` is persisted or explicitly discarded with a log entry. No null dereference.
- **Logout order:** clear `SecureStore` first, then the in-memory session. A failed clear is surfaced.
- **`expires_in` validation:** accept only finite numbers above the 300 s proactive window. Otherwise keep the previous expiry, so that a refresh storm cannot occur.
- **Reuse detection (closed, not tested):** whether reusing a rotated-out refresh token revokes the whole token family is unknown. Owner decision 2026-10-25 (Story 1.5): not re-tested, because the client never reuses a refresh token on purpose and the burned-token case is already handled as "sign in again". The `device_id` question is closed the same way.

### 2.4 Logout

The reference makes **no server call**; it only clears local data. `DELETE /oauth/token` exists only at `RE-SPEC` level and is unverified. Do not depend on it until it is verified live.

`LIVE` (Story 1.4, 2026-10-25, device): local-only logout clears the secure store (read back = empty) and the in-memory session; the install `device_id` is unchanged; a call after logout sends no request. No server call is made, so the server-side session is presumably not revoked: the last refresh token probably stays valid on the server until it expires or is used (not tested).

## 3. Endpoints used by the reference (`REF`)

All of these are under `https://api.boosty.to` and use a Bearer token.

| # | Method & path | Purpose | Params / body | Response fields used |
|---|---|---|---|---|
| E1 | `GET /v1/user/current` | Validate session, profile | — | `id`, `blogUrl?` |
| E2 | `GET /v1/user/subscriptions` | Subscriptions | `limit=30`, `with_follow=true` | `data[].blog{title, blogUrl, owner{name, avatarUrl?}}` (1.16.0 stopped parsing price fields after a crash). No pagination is used. Possible top-level `offset/limit/total` are commented out. |
| E3 | `GET /v1/blog/{blogUrl}` | Blog header | — | `title`, `blogUrl`, `owner{name, avatarUrl}` |
| E4 | `GET /v1/blog/{blogUrl}/post/` | Blog posts | `limit` (20), `offset?` (opaque string), `comments_limit=0`, `reply_limit=0`, `is_only_allowed?`, `only_bought?`, `from_ts?`, `to_ts?` (epoch s), `tags_ids?` (comma-joined) | `data[]: Post`, `extra{offset, isLast}` |
| E5 | `GET /v1/feed/post/` | Feed | `limit` (10), `offset?`, `comments_limit=0`, `reply_limit=0`, `only_allowed?`, `only_bought?`, `tags_ids?`, `from_ts?`, `to_ts?` | `data.posts[]: Post`, `extra` |
| E6 | `GET /v1/search/feed/post/` | Feed search | E5 params + `search_query` | `data.searchPosts[].post: Post`, `extra` |
| E7 | `GET /v1/search/blog/post/` | Blog search | `blog_url`, `search_query`, E4 params (with `is_only_allowed`) | `data.searchPosts[].post: Post`, `extra` |
| E8 | `GET /v1/blog/{blogUrl}/post/{postId}` | Single post (the reference uses it to refresh media URLs and `timeCode`) | `comments_limit`, `reply_limit` (the reference sends 20. **We must send 0**. That 0 is accepted on this endpoint is unverified; it is accepted on E4/E5) | `Post` (top level, no `data` wrapper) |
| E9 | `PUT /v1/viewstat/video/{videoId}/timecode/` | Save playback progress | form `time_code` = integer seconds | body ignored |
| E10 | `GET /v1/blog/{blogUrl}/poll/{pollId}` | Refresh poll | — | `data.poll: Poll` |
| E11 | `POST /v1/poll/{pollId}/vote` | Vote | form `answer` = comma-joined option ids | body ignored |
| E12 | `DELETE /v1/poll/{pollId}/vote` | Retract vote | — | body ignored |
| E13 | `GET /v1/search/feed/tag/` | Feed tags (filter) | `limit` (100), `offset?` | `data.searchTags[]{tag{id, title}, rank}`, `extra{offset, isLast}` |
| E14 | `GET /v1/blog/{blogUrl}/post/tag/` | Blog tags | — | `data[]{id, title}` |
| E15 | `GET /v1/blog/{blogUrl}/video_stream` | Active or scheduled live stream | — | **`204 No Content` = none.** Otherwise: `id`, `int_id`, `title`, `isOnline`, `isTemplate`, `hasAccess`, `startTime` (epoch s), `signedQuery`, `isLiked`, `data[]` (content blocks incl. `ok_stream`/`ok_video`), `teaser[]`, `count{viewers, likes}`, `subscriptionLevel{name, currencyPrices{RUB, USD, EUR}}` |
| E16 | `PUT /v1/blog/{blogUrl}/video_stream/heartbeat/viewer` | Live viewer heartbeat (every 30 s) | `stop=true` query param on exit | body discarded |
| E17 | `POST` / `DELETE /v1/blog/{blogUrl}/video_stream/like` | Like / unlike a stream | — | body discarded |
| E18 | `GET /v1/notification/standalone/event/` | Events (`REF-DEAD`: not reachable from the reference UI; approved for Boosty TV as our addition, but needs `LIVE` verification first) | Pagination params unknown | `data.notificationStandalone{events[]{id, isRead, type, eventTime (epoch s), blog{blogUrl}, author?, aggregation?}, count{total, unread, byEventType[]}, updateTime}`. Known `type`: `video_stream_start`; DTO comments list other types (`post_new`, …). |

Excluded by product scope; **never call**:

| Method & path | Reason |
|---|---|
| `GET /v1/blog/{blogUrl}/post/{postId}/comment/` (`limit`, `reply_limit`, `order=top`, `offset`, `parent_id`) | Comments are excluded (CLAUDE.md) |
| GitHub `GET api.github.com/repos/slartus/BoostBuddy/releases/latest` | Reference self-update. Not a Boosty API and not our release channel |

## 4. Post object (`REF`)

```text
Post {
  id: string                 // stable post id (required by reference)
  int_id: number             // snake_case in JSON
  title: string?
  createdAt: number          // epoch seconds (required by reference)
  signedQuery: string?       // appended to audio/file URLs
  hasAccess: boolean?        // reference default: true when missing
  user: { name, avatarUrl?, blogUrl }   // author; required
  data: ContentBlock[]?      // full content when accessible
  teaser: ContentBlock[]?    // shown when !hasAccess or data empty
  count: { likes?, comments? }
  poll: Poll?
}
```

The reference **drops** a post when `id`, `createdAt`, `int_id` or `user.name` is missing. Boosty TV should do the same, or show a degraded card, but must not crash.

### 4.1 Content blocks (`data[]`, `teaser[]`)

The type is selected by `type`. Fields come from `ContentResponse`.

| `type` | Fields used | Notes |
|---|---|---|
| `text` | `content` (JSON string `[text, ?, [[styleCode, from, len], …]]`), `modificator` (`BLOCK_END` ends a paragraph) | Style codes: `0` bold, `2` italic, `4` underline, other values are normal. If `content` is not a JSON array, it is used as raw text. |
| `link` | `content` (same JSON format), `url`, `modificator` | Inline link inside the paragraph |
| `smile` | `name`, `smallUrl?`, `mediumUrl?`, `largeUrl?` | Inline emoji image |
| `image` | `url` | — |
| `ok_video` | `id` (media id, used for progress), `vid`, `title?`, `preview?` or `defaultPreview?`, `playerUrls[]{type, url}`, `timeCode?` (seconds, saved progress) | Dropped if no usable URL or no preview. **`id` is the progress identity, never the URL.** |
| `ok_stream` | as `ok_video`. `playerUrls` include `live_*` and `live_playback_*` | The reference keeps only live-edge URLs and drops `live_playback_*` (DVR) |
| `video` | `url` | External player page (e.g. YouTube) |
| `audio_file` | `url`, `title?`, `duration` (seconds) | Playable URL = `url + Post.signedQuery` |
| `file` | `url`, `title?`, `size?` (bytes, inferred) | Download URL = `url + Post.signedQuery` |
| anything else | — | Must render as an "unsupported block" placeholder |

`fileType` (for example `MP3`) is present in the DTO but unused.

### 4.2 Poll

```text
Poll { id: int, title: string[] (joined for display), isMultiple: bool, isFinished: bool,
       counter: int (voters), answer: int[] (user's chosen option ids),
       options: [{ id: int, text: string, counter: int, fraction: int (percent) }] }
```
Required by the reference: `id`, `isMultiple`, `isFinished`, a non-empty `options`, and `counter` and `fraction` on each option.

## 5. Pagination

- Cursor-based. `extra.offset` is an **opaque string** and must be passed back verbatim as `offset`.
- End of list: `extra.isLast == true`. When `extra` or `extra.offset` is missing, the reference treats it as having no next page.
- Page sizes used: feed 10, blog 20, feed tags 100.
- Merge rule (reference): append, then deduplicate by post `id`, keeping the first occurrence.
- Unverified: whether the cursor stays stable while new posts arrive, and how long a cursor is valid.
- Subscriptions (E2): no pagination in the reference. Whether `offset` is supported is unverified.

## 6. Media URLs and quality mapping

`playerUrls[].type` → quality, from `cm/data/repositories/models/Posts.kt` `VideoQuality.of`:

| Boosty `type` values | Quality | Used |
|---|---|---|
| `tiny`, `mobile` | 144p | yes |
| `lowest` | 240p | yes |
| `low` | 360p | yes |
| `sd`, `medium` | 480p | yes |
| `hd`, `high` | 720p | yes |
| `full`, `full_hd`, `fullhd` | 1080p | yes |
| `quad`, `quad_hd`, `quadhd` | 1440p | yes |
| `ultra`, `ultra_hd`, `ultrahd` | 2160p | yes |
| `hls`, `live_hls`, `live_playback_hls`, `live_ondemand_hls`, `ondemand_hls`, `ondemand_hls_live` | HLS (adaptive) | yes |
| `dash`, `dash_uni`, `dash_sep`, `live_dash`, `live_playback_dash`, `ondemand_dash`, `ondemand_dash_live` | DASH (adaptive) | yes |
| `mp4`, `webm`, `av1`, `webrtc`, `rtmp`, `live_cmaf`, unknown | — | ignored |

Entries with an empty `url` are ignored. The reference's 4320p enum value has no source string mapped to it.

- The URLs are **signed CDN URLs**, already authorized. The reference plays them **without** sending the Boosty Bearer token. Boosty TV must not forward auth headers to CDN hosts either.
- Expiry: the reference re-fetches the post (E8) or stream (E15) after any player error, finds the block with the same `id`, and re-picks the same quality. The URL lifetime and the exact CDN error (HTTP status) are **unverified**. The spike must measure both.
- Do not persist URLs. Persist only `{postId, mediaId, positionSeconds}`. The server-side copy is E9.

## 7. Entitlement and error semantics

| Situation | Signal (reference evidence) | Status |
|---|---|---|
| Post not accessible to the user | `hasAccess=false` and/or empty `data`, with `teaser` present | `REF`. Exact rules unverified |
| Video inside an inaccessible post | Presumably absent from `data`. Not checked | unverified |
| Live stream requires a subscription level | `hasAccess=false`, `subscriptionLevel{name, currencyPrices}` | `REF` |
| No live stream | HTTP **204** on E15 | `REF` |
| Unauthorized / expired access token | HTTP **401** | `REF` |
| 403, 404, 410, 429, 5xx | **Not distinguished** by the reference. Each is a generic error with a message | unverified. Must be recorded live. **Do not treat 403 as an expired session.** |
| Network failure | Generic | — |

Retry policy for Boosty TV (our policy, not the reference's):
- Idempotent GETs: bounded retry with backoff for network errors and 5xx.
- 401: one refresh, then one retry.
- Mutations (E9, E11, E12, E16, E17): never replayed automatically after an ambiguous failure. E9 is the only exception: it can be re-sent with the latest position, because the last write wins.

## 8. Unverified items to resolve in the spike

1. The real lifetime behind `expires_in` (2592000 from phone auth and refresh) and the refresh-token lifetime. Rotation and the rejection signal are resolved (§2.3, Story 1.4). The `device_id`-mismatch and refresh-token-reuse questions are closed as not needed for production (owner decision 2026-10-25, §2.3).
2. Phone auth (partly resolved in Story 1.3, see §2.2 "Live evidence"): still open are the expired-challenge shape, the confirm attempt limit, whether captcha can be demanded, the challenge `expiresIn` units, the exact server resend window (a resend was allowed at 32 s and rejected at 2–5 s), and the longer send limit (window, threshold, phone vs IP; §2.2 «Rate limit, longer window»).
3. Minimal required headers (UA, `X-App`, `X-From-Id`) for normal calls and for refresh.
4. Events (E18): response shape, pagination and the list of event types.
5. E8 with `comments_limit=0`.
6. Signed media URL TTL, the CDN error on expiry, and whether `signedQuery` for audio and files expires.
7. 401 vs 403 vs 404 bodies, so they can be modeled as distinct errors.
8. Whether E9 progress is reflected in `timeCode` on the next E8 and on the web.
9. Subscriptions pagination beyond 30.
