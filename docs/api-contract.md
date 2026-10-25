# Boosty API contract (unofficial)

Status: **draft from reference-code audit.** The reference is BoostBuddy `1.16.0` (`b9acb6c`), audited 2026-10-25. See `docs/feature-parity.md` for the audit metadata and path shorthands (`cm/`, `am/`).

## Evidence levels

| Level | Meaning |
|---|---|
| `REF` | Request and fields are used by the shipped BoostBuddy 1.16.0 client (`cm/data/api/BoostyApi.kt`, `PhoneAuthApi.kt`, repositories). This is strong evidence that the endpoint worked for the reference author, but it is **not verified by us**. |
| `REF-DEAD` | Present in the reference client but not reachable from its UI. |
| `RE-SPEC` | Listed only in the reference's reverse-engineered `cm/data/api/openapi/boosty-api.yaml` ("extracted from the public web bundle and Android APK; not official"). Treat it as **unverified**. Do not build on it without a live check. |
| `LIVE` | Verified by this project on a real device or account. **No entry has this level yet.** |

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

Error shapes (wrong code, expired challenge, rate limit, captcha required) are **unverified**. The reverse-engineered spec mentions `/auth/phone/mobile_captcha/send` (`RE-SPEC`), which suggests captcha can be required.

**This is the selected sign-in flow for Boosty TV** (owner decision 2026-10-25, feature-parity Q1). §2.1 is kept as reference knowledge and fallback research only.

### 2.3 Token refresh (`REF`)

`POST /oauth/token/`

| Form field | Value |
|---|---|
| `grant_type` | `refresh_token` |
| `refresh_token` | stored refresh token |
| `device_id` | install UUID |
| `device_os` | `web` |

Headers: the web-style set above plus `X-From-Id`.

Response: `{ "access_token", "refresh_token"?, "expires_in"? }`. A new refresh token is stored if one is returned, so rotation is possible but unverified.

Reference policy, which we will reimplement rather than copy:
- Single-flight via a mutex.
- Proactive refresh when less than 300 s remain before expiry.
- On 401: refresh once and retry the original request once. If refresh fails, surface 401, which leads to the signed-out state.

Unverified: refresh-token lifetime, whether refresh tokens are single-use, the response when the refresh token is revoked, and whether `device_id` must match the id used at sign-in. The cookie flow has no `device_id` at sign-in, yet the reference refreshes those tokens with its own `device_id`.

An unused leftover in the reference, `BoostyApi.refreshToken`, sends `device_os=android` without headers. It is not used.

### 2.4 Logout

The reference makes **no server call**; it only clears local data. `DELETE /oauth/token` exists only at `RE-SPEC` level and is unverified. Do not depend on it until it is verified live.

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

1. The real `expires_in` from phone auth and refresh; refresh-token rotation and lifetime.
2. Phone-auth error shapes, captcha requirement, rate limits, challenge `expiresIn` units and code delivery channels.
3. Minimal required headers (UA, `X-App`, `X-From-Id`) for normal calls and for refresh.
4. Events (E18): response shape, pagination and the list of event types.
5. E8 with `comments_limit=0`.
6. Signed media URL TTL, the CDN error on expiry, and whether `signedQuery` for audio and files expires.
7. 401 vs 403 vs 404 bodies, so they can be modeled as distinct errors.
8. Whether E9 progress is reflected in `timeCode` on the next E8 and on the web.
9. Subscriptions pagination beyond 30.
