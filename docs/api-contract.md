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

Boosty TV decision: two request profiles, `auth` (phone auth, refresh: the web-style set) and `content` (every other call: mobile Android Chrome UA, `Accept`, Bearer), as in the reference. See [ADR 0008](adr/0008-api-request-profiles.md). The content profile is `LIVE` for E8 (Story 1.6) and E5 (Story 3.1: production release-like build on the pinned device, owner's session, 2026-10-26: HTTP 200 with the owner's subscribed posts, accessible posts with video previews and durations, several pages via `extra.offset`) and E2 (Story 3.2: same device and session, 2026-10-26: HTTP 200, the owner's 3 subscriptions with titles, owners and avatars) and E3/E4 (Story 3.3, `LIVE` (inferred from the rendered page; the release build logs nothing): same device and session, 2026-10-27, release-like build driven by adb: E3 rendered the blog's title, owner name and avatar; E4 rendered the blog's posts, accessible and locked (`hasAccess=false`, never an error), and paged through at least 3 pages via `extra.offset`. The release build logs nothing, so the 200 status is inferred from the rendered data: an E3 failure shows the full-page error and an E4 failure the posts error, neither appeared. As built, any E3 404 shows «Автор недоступен»: HttpClient keeps no 404 body, and only `blog_not_found` is verified live (§7); keeping the error code is deferred work); the other content endpoints are checked by the first production story that sends them. Story 3.4 (Пост) is the first production screen that sends E8 (`GET /v1/blog/{blogUrl}/post/{postId}?comments_limit=0&reply_limit=0`, content profile, the active session's client): it reads the post fields of §4 plus `count.likes` (a non-negative integer, else ignored); comments, reactions, prices, `playerUrls`, `signedQuery` and `timeCode` are not read; every E8 404 maps to «Пост недоступен» (only `not_found` is verified, §7). Story 4.1 (player) sends one more E8 with the same path and profile on every player open (`PostRepository.videoSources`) and reads `ok_video.playerUrls` of the one video it plays, for the player only (§6 «Production client (Story 4.1)»); the Post entity still carries no `playerUrls`, `signedQuery` or `timeCode`. Story 4.2 reads `ok_video.timeCode` from both E8s for the ProgressRepository only and sends E9 with the content profile (§6 «Production client: progress»); the Post entity still carries no `timeCode`.

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
- The limit lifted the same evening: one more send at 19:36 got 429, and the send at 19:45 got 200 (the code arrived; sign-in completed). That is about 2 h 15 min after the last successful code and about 1 h after the last rejected attempt. The window is hours, not a day; the exact value is unknown.
- The website gets the same 429. Its `device_id`, client and headers differ from ours, so the limit is server-side. It is keyed by the phone number or the IP address, not by `device_id` or our request format. Phone vs IP was not separated: the website attempt probably used the same home IP.
- The server does not say when sending is allowed again. The window and the threshold are unknown. Rejected attempts may extend the window; this was not tested and will not be tested on purpose.

#### Production client (Stories 2.2–2.3)

What the production code sends and how it reads the answers (`src/shared/api/authApiClient.ts`, `httpClient.ts`, `sessionManager.ts`; ADR 0008). Host-tested with sanitized mocks; the live status of each row is in the last column.

| Request | Client / profile | Method, URL | Form fields (in order) | Parsed as | Error mapping | Live status |
|---|---|---|---|---|---|---|
| Send | `AuthApiClient` / `auth` | `POST /auth/phone/verification_code/send` | `phone`, `device_os=web`, `device_id` | `data.phoneCode.code` required (non-empty); `sentTransport`, `expiresIn` optional, dropped when odd | 429 `sms_gate_ratelimit` → `TooManyAttempts`; transport/timeout → `Network`; everything else → `Unknown` | `LIVE` 2026-10-26 (Story 2.3, production build, owner): HTTP 200; the code arrived in Telegram |
| Resend | `AuthApiClient` / `auth` | `POST /auth/phone/verification_code/send` | `phone`, `transport=gate`, `device_os=web`, `device_id` | As send; the new `code` replaces the challenge | As send | Not sent in the Story 2.3 live run (not needed) |
| Confirm | `AuthApiClient` / `auth` | `PUT /auth/phone/verification_code/confirm` | `phone`, `code` (the challenge), `sms_code`, `device_os=web`, `device_id` | `access_token`, `refresh_token` non-empty strings; `expires_in` a finite number > 300 and ≤ 315 360 000 (10 years; seconds) | 400 `invalid_sms_code` → `WrongCode`; transport/timeout → `Network`; everything else (including 429 and any 200 that fails the schema) → `Unknown`. Nothing maps to `CodeExpired` | `LIVE` 2026-10-26 (Story 2.3): HTTP 200, tokens parsed and saved |
| E1 after confirm | `HttpClient` / `content` | `GET /v1/user/current` | — (`Authorization: Bearer <access_token>`) | Status 200 and `id` (number or non-empty string, stored as a string); the rest of the body is ignored | Any other status, a missing `id` or a transport failure → the tokens are dropped, nothing is saved; the challenge counts as spent, so A5 shows the A8 layout («Выслать новый код») with `Unknown` | `LIVE` 2026-10-26 (Story 2.3): **succeeded with the `content` profile** (the app reached SignedIn, which requires E1 200 with `id`). ADR 0008 check passed for E1. The release build logs no status line, so the exact code was not recorded |

Common rules:
- `auth` profile headers: desktop Chrome `User-Agent`, `X-App: web`, `X-Locale: ru_RU`, `Referer: https://boosty.to/`, `Origin: https://boosty.to`, `Accept: application/json, text/plain, */*`, `X-From-Id: <device_id>`, `Content-Type: application/x-www-form-urlencoded`; no `Authorization`. `content` profile: mobile Android Chrome `User-Agent`, `Accept`, `Authorization: Bearer`; nothing else. Unit tests assert the exact sets.
- `credentials: 'omit'` on every request; one 30 s timeout per request (`AbortController`, also covering the `device_id` read); no automatic retry of send, resend, confirm or E1.
- Same-argument single-flight: a repeated send/resend/confirm while one is in flight shares it; different arguments are rejected (`Unknown`) without a request. Send and resend share one slot.
- Session creation order: confirm → E1 → save the phone (`boostytv.phone`; a failure is logged and not fatal, and its ADR 0006 recovery runs before the session exists) → save `{accessToken, refreshToken, expiresAt, accountId}` (`boostytv.session`) → signed in. A failed session save clears both and shows `Unknown` in the A8 layout.
- Resend: every attempt, success or failure, restarts the 60 s client cooldown. `expiresAt` = confirm time + `expires_in` × 1000 ms.
- Logs carry only the operation, the outcome, the HTTP status and the path; never the phone, the challenge, the code, tokens, the `device_id` or a body.

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
- **Logout order:** clear `SecureStore` first (the stored phone, then the session entry, so a phone failure leaves the session untouched), then the in-memory session. A failed clear is surfaced.
- **`expires_in` validation:** accept only finite numbers above the 300 s proactive window. Otherwise keep the previous expiry, so that a refresh storm cannot occur.
- **Reuse detection (closed, not tested):** whether reusing a rotated-out refresh token revokes the whole token family is unknown. Owner decision 2026-10-25 (Story 1.5): not re-tested, because the client never reuses a refresh token on purpose and the burned-token case is already handled as "sign in again". The `device_id` question is closed the same way.

#### Production client (Story 2.5)

`src/shared/api/authApiClient.ts` (`refresh`), `refreshCoordinator.ts`, `sessionManager.ts`, `httpClient.ts`, `appError.ts`. Host-tested over `FixtureTransport` (`__tests__/sessionRefresh.test.ts`, `__tests__/sessionFlow.test.tsx`).

| Item | Behavior |
|---|---|
| Request | `AuthApiClient` / `auth` profile, `POST /oauth/token/`, form `grant_type=refresh_token`, `refresh_token`, `device_id` (the install id), `device_os=web`; 30 s timeout; never retried |
| Parsed as | `access_token` required (non-empty string). `refresh_token` optional: missing or empty keeps the old one. `expires_in` adopted only when finite, > 300 and ≤ 315 360 000 s; otherwise the previous `expiresAt` is kept |
| Expired | Only HTTP 400 with `error: "invalid_grant"` → status `expired`; nothing further is sent with these tokens. Story 2.6: the stored session is replaced, through the store queue, by a token-free expiry marker `{v:1, expired:true, accountId}`; the phone is kept for re-login (a failed marker write is logged and does not change the status). The app resets the stack to A11 «Сессия истекла»; a later cold start with the marker restores status `expired` (restore reason `expired`) and opens A11. Only the marker means `expired`: an empty session store is `signedOut` (reason `none`) even with a kept phone, because a first sign-in interrupted between the phone and session writes leaves that state. The stored phone is readable only while the status is `expired` (A11 → A2 prefill). The next sign-in overwrites the marker and reports `accountChanged` when the E1 id differs from the marker's (or the in-memory session's) account id, or none is known |
| Kept (still `signedIn`) | Any other status (400 other `error`, 401, 403 → `Client`; 429 → `RateLimited`; 5xx → `Server`), a transport failure or timeout (`Network`) and a 200 that fails the schema (`Parse`). The triggering request fails with that kind |
| Order | The new pair is written to SecureStore before it replaces the in-memory session. A failed write keeps the old pair in memory and storage (logged as an error; the request fails with `Client`) |
| Single flight | One refresh per session generation; proactive when `expiresAt − now < 300 s` (also for a past `expiresAt` after a restore); after a 401 only when the failed request used the still-current token, otherwise the request is retried with the current token. One retry of a GET after a 401; mutations are never re-sent |
| Cooldown | After a `failed` refresh no new refresh starts for 30 s in the same session generation (owner decision: no sequential refresh storm); requests that need one fail at once with the same kind, 401 renewals included. A proactive refresh that failed while the access token is not past `expiresAt` sends the request with the current token. Sign-in, restore and sign-out reset the cooldown |
| Sign-out | While the clears run, the coordinator sees no session: no refresh starts and no refreshed pair is written or adopted |
| Races | Sign-in, restore and sign-out bump a generation; every session write and clear runs in one queue. A late refresh result of an older generation is dropped and logged; a late rejection never turns `signedOut` into `expired` |
| E1 validation | `GET /v1/user/current` (content profile) in the background after the boot and on every `AppState` change to `active`, single-flight, with the AD-6 GET retries. A cold-start `Network` result shows Главная's offline StateView; the session is kept |
| Logs | Operation, outcome, status, path, booleans (`rotated`, `expiresIn` accepted). Never tokens, `Bearer`, the device id or a body |

#### Live evidence (Story 2.5)

Recorded 2026-10-26 on the pinned Chromecast with Google TV 4K, **debug build** (Metro), with the owner's stored session; one run, triggered by the agent through the debug-only Настройки row «Проверка обновления сессии» (key injected via adb). The row replaced the access token **in memory only** with a corrupted value of the same length; nothing else was altered. Paths and statuses from the app's sanitized log:

| Case | Request | Status | Notes | Level |
|---|---|---|---|---|
| E1 at cold start and on resume, content profile | `GET /v1/user/current` | **200** | One request each time, attempt 1 | `LIVE` |
| E1 with the corrupted access token, content profile | `GET /v1/user/current` | **401** | As in Story 1.4 (web profile) | `LIVE` |
| Refresh with the stored refresh token | `POST /oauth/token/` | **200** | `refresh_token` present (rotated), `expires_in` accepted by the > 300 s rule; the new pair was saved before use | `LIVE` |
| Retry of E1 with the new token | `GET /v1/user/current` | **200** | Then a cold start of the release-like build opened the Shell with the rotated session | `LIVE` |

Nothing new about the server was observed: the shapes match Story 1.4.

### 2.4 Logout

The reference makes **no server call**; it only clears local data. `DELETE /oauth/token` exists only at `RE-SPEC` level and is unverified. Do not depend on it until it is verified live.

`LIVE` (Story 1.4, 2026-10-25, device): local-only logout clears the secure store (read back = empty) and the in-memory session; the install `device_id` is unchanged; a call after logout sends no request. No server call is made, so the server-side session is presumably not revoked: the last refresh token probably stays valid on the server until it expires or is used (not tested).

## 3. Endpoints used by the reference (`REF`)

All of these are under `https://api.boosty.to` and use a Bearer token.

| # | Method & path | Purpose | Params / body | Response fields used |
|---|---|---|---|---|
| E1 | `GET /v1/user/current` | Validate session, profile | — | `id`, `blogUrl?`. Boosty TV: the session (validate, the sign-in check) reads `id` only; `blogUrl` is read only by `UserRepository.current` (Story 5.2, content profile, the `me` query) for «Мой блог». A missing, blank or unsafe `blogUrl` (fails the E2 `blogUrlSchema` rule, §5) is absent, never a parse failure. `blogUrl` presence is in the sanitized fixture `e1-user-current.json`; a live answer with it was not observed by the app (the owner's account showed no tile, Story 5.2). Epic 5 retro A3: Главная's «Обновить» re-sends the `me` E1 when it failed or had no `blogUrl` (only once Подписки has filled the query; never with `myBlog` off). Cost: an account without a blog sends one E1 per «Обновить» after a visit to Подписки |
| E2 | `GET /v1/user/subscriptions` | Subscriptions | `limit=30`, `with_follow=true` | `data[].blog{title, blogUrl, owner{name, avatarUrl?}}` (1.16.0 stopped parsing price fields after a crash). No pagination is used. Possible top-level `offset/limit/total` are commented out. |
| E3 | `GET /v1/blog/{blogUrl}` | Blog header (Story 5.2: Подписки also sends it for the own blog, with the Author page's query key, to decide and draw «Мой блог»; `unavailable` or a failure → no tile) | — | `title`, `blogUrl`, `owner{name, avatarUrl}` |
| E4 | `GET /v1/blog/{blogUrl}/post/` | Blog posts (Story 5.2: Подписки sends page 1 for the own blog, with the Author page's default params and query key, to decide «Мой блог»; the reference's `limit=1` is not used. A failed own-blog E1/E3/E4 is not re-sent when Подписки mounts again. While Подписки is mounted, the resume head refresh also refreshes this page 1, because it observes `authorPosts(ownBlogUrl)`. Epic 5 retro A3: Главная's «Обновить» re-sends this page 1 (one request, trimmed to page 1 first) when it failed or was empty, and the own E3 when it was not `ok`; a shown tile sends nothing) | `limit` (20), `offset?` (opaque string), `comments_limit=0`, `reply_limit=0`, `is_only_allowed`, `only_bought` (Story 5.7: always sent, `only_bought=false`), `from_ts?`, `to_ts?` (epoch s), `tags_ids?` (comma-joined); see «E4 filters (LIVE)» | `data[]: Post`, `extra{offset, isLast}`. A pinned post (`isPinned: true`) comes first, out of date order (seen live on 2 of 3 blogs, 2026-10-27); the app keeps that order and marks the card with a pin badge on the Author page |
| E5 | `GET /v1/feed/post/` | Feed (Story 5.3: Главная always sends the access params of the active `feed` Filter, see «E5 access params (LIVE)» below; Story 5.4: plus `from_ts`/`to_ts` for a period other than «За всё время», see «E5 period (LIVE)»; Story 5.5: plus `tags_ids` when tags are checked, see «E5 tags (LIVE)») | `limit` (10), `offset?`, `comments_limit=0`, `reply_limit=0`, `only_allowed?`, `only_bought?`, `tags_ids?`, `from_ts?`, `to_ts?` | `data.posts[]: Post`, `extra` |
| E6 | `GET /v1/search/feed/post/` | Feed search (Story 5.6: Поиск по подпискам, content profile, see «E6 (LIVE)» and «E6 access (LIVE)») | `limit` (10), `comments_limit=0`, `reply_limit=0`, the E5 access / period / tag params of the `search` Filter, `search_query`, `offset?` | `data.searchPosts[].post: Post`, `extra{offset, isLast}` |
| E7 | `GET /v1/search/blog/post/` | Blog search (Story 5.7: «Поиск в блоге» on Автор, content profile, see «E7 (LIVE)») | `blog_url`, `limit` (20), `comments_limit=0`, `reply_limit=0`, the E4 access / period / tag params of the route's Filter, `search_query`, `offset?` | `data.searchPosts[].post: Post`, `extra{offset, isLast}` |
| E8 | `GET /v1/blog/{blogUrl}/post/{postId}` | Single post (the reference uses it to refresh media URLs and `timeCode`) | `comments_limit`, `reply_limit` (the reference sends 20. **We must send 0**. 0 is accepted: `LIVE`, Story 1.5) | `Post` (top level, no `data` wrapper) |
| E9 | `PUT /v1/viewstat/video/{videoId}/timecode/` | Save playback progress | form `time_code` = integer seconds | body ignored. **HTTP 200** on every write; the value comes back as `ok_video.timeCode` on the next E8 and on the website (`LIVE`, Story 1.6, §6, web profile). Sent by the app with the content profile since Story 4.2 (§6 «Production client: progress»; content profile `LIVE`, Story 4.2: the website showed the written position) |
| E10 | `GET /v1/blog/{blogUrl}/poll/{pollId}` | Refresh poll (Story 6.6: after every 2xx E11/E12) | — | `data.poll: Poll` (`LIVE`, Story 6.6: see «Poll votes (LIVE)») |
| E11 | `POST /v1/poll/{pollId}/vote` | Vote | form `answer` = comma-joined option ids | body ignored. HTTP 200; a second E11 with another option moves a single-choice vote (`LIVE`, Story 6.6) |
| E12 | `DELETE /v1/poll/{pollId}/vote` | Retract vote | — | body ignored. HTTP 200 (`LIVE`, Story 6.6) |
| E13 | `GET /v1/search/feed/tag/` | Feed tags (filter; Story 5.5: the filter sheet's tag level, content profile, see «E13 (LIVE)») | `limit` (100), `offset?` | `data.searchTags[]{tag{id, title}, rank}`, `extra{offset, isLast}` |
| E14 | `GET /v1/blog/{blogUrl}/post/tag/` | Blog tags (Story 5.7: the filter sheet's tag level on Автор, see «E14 (LIVE)») | — | `data[]{id, title}` (`count` not read) |
| E15 | `GET /v1/blog/{blogUrl}/video_stream` | Active or scheduled live stream (Story 7.1: the Author page's LiveCard; Story 7.2: the live player's sources; content profile, see «E15 (LIVE)»; the 200 shape and the `ok_stream` mapping are still `REF`) | — | **`204 No Content` = none.** Otherwise: `id`, `int_id`, `title`, `isOnline`, `isTemplate`, `hasAccess`, `startTime` (epoch s), `signedQuery`, `isLiked`, `data[]` (content blocks incl. `ok_stream`/`ok_video`), `teaser[]`, `count{viewers, likes}`, `subscriptionLevel{name, currencyPrices{RUB, USD, EUR}}` |
| E16 | `PUT /v1/blog/{blogUrl}/video_stream/heartbeat/viewer` | Live viewer heartbeat (every 30 s) | `stop=true` query param on exit | body discarded |
| E17 | `POST` / `DELETE /v1/blog/{blogUrl}/video_stream/like` | Like / unlike a stream | — | body discarded |
| E18 | `GET /v1/notification/standalone/event/` | Events (`REF-DEAD`: not reachable from the reference UI; approved for Boosty TV as our addition; shape `LIVE` in Story 1.5) | Pagination params unknown (no cursor seen) | `data.notificationStandalone{events[]{id, isRead, type, eventTime (epoch s), blog{blogUrl}, author?, aggregation?}, count{total, unread, byEventType[]}, updateTime}`. The full type list is in «Live evidence (Story 1.5)» below. The observed `target_new` event had `target{…}` and no `blog`. |

#### Live evidence (Story 1.5)

Recorded 2026-10-25 on the pinned device, release-like build, branch `spike/1-5-entitlement-errors-events`. One run of 15 requests (`src/app/spike/ContentShapesCheck.tsx`, agent-driven via adb after the owner signed in). Sanitized fixtures for every response except E1 with a token are in `src/test/fixtures/boosty/` (`npm run check:fixtures`). The run was repeated once after the number sanitizing was tightened; the results were the same.

| Endpoint | Status | Observed shape (keys and types; values sanitized) | Level |
|---|---|---|---|
| E2 subscriptions | **200** | Top level `{offset, limit, total, data[]}`. `limit=30` echoed. `data[].blog{title, blogUrl, owner{name, avatarUrl, id, hasAvatar}, flags…}`, plus subscription fields (`levelId`, `subscriptionLevel`, `price`, `onTime`, `nextPayTime`, `isPaused`…) | `LIVE` |
| E3 blog | **200** | Blog object (`title`, `blogUrl`, `owner`, `count`, `isSubscribed`, `subscription`, `accessRights`, `signedQuery`, `flags`…) | `LIVE` |
| E4 blog posts | **200** | `{data: Post[20], extra{offset: string, isLast: boolean}}` | `LIVE` |
| E5 feed | **200** | `{data{posts: Post[10], blogs, counters}, extra{offset: string, isLast: boolean}}` | `LIVE` |
| E8 single post, `comments_limit=0&reply_limit=0` | **200** | `Post` at the top level, no `data` wrapper. `comments_limit=0` is accepted | `LIVE` |
| E15 live stream (2 blogs) | **204** | Empty body: no stream | `LIVE` |
| E18 events | **200** | `data.notificationStandalone{events[]{id, type, eventTime, isRead, author{id, name, avatarUrl, hasAvatar, isOfficial}, aggregation{id, type}, target?}, count{total, unread, byEventType[]{type, total, unread}}, updateTime}`. No `extra`, offset or other cursor in the response (1 event) | `LIVE` |

Facts:
- **E18 types** listed in `count.byEventType`: `blog_stat_report_failed`, `blog_stat_report_ok`, `bundle_buy`, `donation_new`, `level_subscribers_limit_reached`, `message_buy`, `post_buy`, `post_comment_new`, `post_comment_new_reply`, `post_new`, `promo_new`, `referal_new_blogger`, `referal_new_user`, `subscriber_new`, `support_ticket_update`, `target_new`, `video_stream_start`. The one observed event was `target_new` (with a `target` object). EVT-01 (events list) is verified as reachable. Paging is **unverified**: one event, no cursor field. The comment event types are never shown (comments are excluded).
- **Video duration is in the feed:** `ok_video.duration` (seconds) and `timeCode` are present in E4 and E5 items, not only in E8.
- `ok_video` keys: `id`, `vid`, `title`, `duration`, `timeCode`, `preview`, `defaultPreview`, `previewId`, `playerUrls[]`, `width`, `height`, `status`, `uploadStatus`, `complete`, `isInvalid`, `failoverHost`, `viewsCounter`, `showViewsCounter`, `url`. `playerUrls` had 19 entries, 9 with a non-empty URL: `tiny`, `lowest`, `low`, `medium`, `high`, `full_hd`, `quad_hd`, `hls`, `dash`. The empty ones included `ultra_hd`, `live_*`, `ondemand_*`, `dash_uni`, `live_cmaf`, so empty URLs must be skipped (§6).
- Post keys also include `publishTime`, `intId` (besides `int_id`), `sortOrder`, `tags`, `reactionCounters`, `contentCounters`, `frame{previous, next}`, `isDeleted`, `isBlocked`, `isPublished`, `isWaitingVideo`, `price`, `currencyPrices`, `subscriptionLevel`, and a `comments` field (ignored: comments are excluded).
- A content block type **`list`** was seen: `{type: "list", items[]{data: ContentBlock[], items[]}}` (nested lists of text blocks). It is not handled by the reference (§4.1).

Excluded by product scope; **never call**:

| Method & path | Reason |
|---|---|
| `GET /v1/blog/{blogUrl}/post/{postId}/comment/` (`limit`, `reply_limit`, `order=top`, `offset`, `parent_id`) | Comments are excluded (CLAUDE.md) |
| GitHub `GET api.github.com/repos/slartus/BoostBuddy/releases/latest` | Reference self-update. Not a Boosty API and not our release channel |

### E5 access params (`LIVE`, Story 5.3)

The reference (`FeedRepository`, 1.16.0) sends `only_allowed = (access == Allowed)` and `only_bought = (access == Bought)`, each only when not null; Boosty TV always sends both, after `reply_limit`:

| Filter value | Params |
|---|---|
| «Доступные мне» (default) | `only_allowed=true&only_bought=false` |
| «Все посты» | `only_allowed=false&only_bought=false` |
| «Только купленные» | `only_allowed=false&only_bought=true` |

The opaque `offset` follows them on later pages. Before Story 5.3 the app sent no access params.

Live check (debug build with a temporary counts-only log, removed before the commit; Chromecast with Google TV 4K, the owner's session, 2026-10-28; HTTP 200 for every request; only counts and booleans were logged, never ids, titles or URLs):

| Request | Page 1 | Locked (`hasAccess: false`) | `extra` |
|---|---|---|---|
| No access params | 10 posts | 0 | `isLast: false`, `offset` present |
| «Доступные мне» | 10 posts, the **same 10 posts** as without params | 0 (page 2: 0 of 10) | `isLast: false` |
| «Все посты» | 10 posts, 6 of them shared with the no-params page | 4 (page 2: 8 of 10) | `isLast: false` |
| «Только купленные» | 1 post (not on the no-params page 1) | 0 | `isLast: true`, `offset` present |

So the server's default without params behaved like «Доступные мне» on page 1 for this account, «Все посты» adds locked posts (never an error), and «Только купленные» returned the purchased post as a one-post last page. One account, one run; the no-params comparison covered page 1 only. Locked posts under «Все посты» are ordinary (`hasAccess: false`), so the all-locked session check (§7) runs only under «Доступные мне». An empty «Только купленные» page (no purchases) was not seen live (this account has one); it is host-tested with the existing empty-page shape. Shape fixture: `src/test/fixtures/boosty/e5-feed-only-bought.json` (a one-post last page built from the sanitized `e5-feed.json` post; the live run logged counts only, no body was captured).

### E5 period (`LIVE`, Story 5.4)

The reference (`FilterComponent`, `DateRangePickerDialog`, 1.16.0) sends `from_ts` and `to_ts` in epoch seconds, normalized to the local start and end of day. Boosty TV sends them after the access params, before `offset`, only when the period is not «За всё время»:

| Period | Params |
|---|---|
| «За всё время» (default) | none |
| «Последние N дней» (N = 7, 30, 90) | `from_ts` = local 00:00:00 of today − (N − 1), `to_ts` = local 23:59:59 of today |
| «Свой период…» (from, to) | `from_ts` = local 00:00:00 of the first day, `to_ts` = local 23:59:59 of the last day |

The Filter and the query key hold the period symbolically; `PostRepository.feedPage` resolves it with `Date.now()` when the request is sent, so the bounds move only when the local day changes.

Live check (debug build with a temporary log, removed before the commit; Chromecast with Google TV 4K, the owner's session, 2026-10-28; HTTP 200 for every request; only counts and booleans were logged, never ids, titles, dates or URLs). `T` is the newest default page-1 post's publish time as the app maps it (`publishTime`, else `createdAt`):

| Request (default access params) | Result |
|---|---|
| `from_ts=T&to_ts=T` | 1 post, the newest one: **both bounds inclusive**, compared with that publish time |
| `from_ts=T−30 d&to_ts=T−1` | 10 posts, not the newest one, all inside the bounds, more pages |
| `from_ts=T+1&to_ts=T+30 d` | 0 posts, last page |
| `from_ts=T−1 h&to_ts=T+1 h` | 1 post (the newest one) |
| The same window in milliseconds | 0 posts: the server reads seconds |
| «Последние 7 дней» (from the app) | page 1: 2 posts, every one inside the bounds, last page |
| «Последние 30 дней» | page 1: 10, page 2: 9 (last), every post inside the bounds |
| «Последние 3 месяца» | pages 1–2: 10 + 10, more pages, every post inside the bounds |
| «Свой период…» 28 Sep – 26 Oct 2026 | page 1: 10, page 2: 8 (last), every post inside the bounds |

So E5 honours `from_ts`/`to_ts` in seconds with both ends inclusive; 23:59:59 as the end of the last day therefore includes a post published in that last second. Paging (`offset`, `isLast`) works as without a period. One account, one run; E4 was checked later (Story 5.7, «E4 filters (LIVE)»).

### E13 (`LIVE`, Story 5.5)

Boosty TV sends `GET /v1/search/feed/tag/?limit=100`, then `&offset=<extra.offset>` (opaque, verbatim, URL-encoded) for the next page, only on an explicit «Загрузить ещё». `TagRepository.feedTagsPage` reads `data.searchTags[].tag{id, title}`; `rank` is not read. One item without a non-negative integer (or non-empty string) `id` or a non-blank `title` is dropped and counted in the log (no value logged), never the page; a missing `data.searchTags` is `Parse`. Paging stops on `isLast` or a missing `extra`/`offset` (`TagRepository`), or on a cursor already used (`useFeedTags`, no loop). Ids become strings; a string id must be digits only (a comma would split `tags_ids`).

Live check (debug build with a temporary counts-only log, removed before the commit; Chromecast with Google TV 4K, the owner's session, 2026-10-29; only keys, types, counts and booleans were logged, never ids, titles or URLs): HTTP 200; top level `{data, extra}`; `data` has only `searchTags`; 45 items, each `{tag, rank}` with `tag{id, title}`; every `id` a number, all 45 distinct; every `title` a non-blank string; `rank` a number; `extra{offset: string, isLast: true}`. So this account's tags fit in one page: a second page and the «Загрузить ещё» path were **not** seen live (host-tested and in the demo only). Sanitized shape fixtures: `src/test/fixtures/boosty/e13-feed-tags-1.json` (`isLast: false`) and `e13-feed-tags-2.json` (`isLast: true`); the two-page split is synthetic (the live run logged counts only, no body was captured).

### E5 tags (`LIVE`, Story 5.5)

The reference sends the selected tag ids as one comma-joined `tags_ids`. Boosty TV sends `tags_ids` after the access and period params, before `offset`, only when at least one tag is checked: the ids **sorted** (string order), each URL-encoded, joined by a literal `,` (`tags_ids=12,3`). The Filter keeps `{id, title}` per tag in selection order; the query key holds the sorted ids only, so A+B and B+A are one request and one cache entry.

Live check (same run; default access params, `limit` 20/50 for the probe requests only; HTTP 200 for every request; counts and booleans only). A = the tag most frequent on the unfiltered page 1:

| Request | Result |
|---|---|
| Unfiltered (`limit=20`) | 20 posts, 8 with tags, 6 distinct tags, all 6 among the E13 tags |
| `tags_ids=A` (`limit=50`) | 50 posts, **every one carries A**, more pages; the 4 unfiltered posts with A all in it |
| `tags_ids=B`, B never on a post with A (on that page) | 16 posts, every one carries B, last page |
| `tags_ids=A,B` (that B) | **0 posts**, last page |
| `tags_ids=B'` (second run: B' seen together with A) | 1 post, carrying A and B' |
| `tags_ids=A,B'` | 1 post, carrying A and B' |
| `A,B` encoded as `A%2CB`, and `B,A` | the same posts as `A,B` |

So E5 honours `tags_ids` and **intersects** the listed tags: a post must carry every listed tag (a union would have returned at least A's 50 posts). A literal and an encoded comma behave the same; the order does not matter. One account, two runs; E4 was checked later (Story 5.7, «E4 filters (LIVE)»).

### E6 (`LIVE`, Story 5.6)

The reference (`BoostyApi.feedSearch`, `FeedRepository.searchData`, `develop`) sends `limit=10`, `comments_limit=0`, `reply_limit=0`, the feed's access, tag and period params and `search_query`; it reads `data.searchPosts[].post` and `extra`. Boosty TV sends `GET /v1/search/feed/post/?limit=10&comments_limit=0&reply_limit=0&only_allowed=…&only_bought=…[&from_ts=…&to_ts=…][&tags_ids=…]&search_query=<URL-encoded>[&offset=<extra.offset>]` (the same builders as E5, from the `search` Filter; the query is trimmed by the app, never logged; `HttpClient` logs the path without the query string). `PostRepository.feedSearchPage` reads `data.searchPosts[].post` through the one post mapper; an item without a `post` object is dropped and counted in the log (no value), a malformed post is dropped by the mapper, never the page; a missing `data.searchPosts` is `Parse`. `headline`, `rank` and `data.blogs` are not read. Paging as E5 (`isLast`, a missing `extra`/`offset`, a used cursor).

Live check (debug build with Metro and a temporary counts-only log, removed before the commit; Chromecast with Google TV 4K, the owner's session, 2026-10-29; HTTP 200 for every request; only keys, types, counts and booleans were logged, never ids, titles, the query or URLs). `Q` = the longest word (9 Cyrillic letters) of the newest default E5 post's title:

| Request (default access params unless noted) | Result |
|---|---|
| `search_query=Q` | top level `{data, extra}`; `data` keys `blogs`, `searchPosts`; 10 items, each `{post, rank, headline}`, every `post` an object; 0 locked; `extra{offset: string, isLast: false}`; the newest feed post (whose title gave `Q`) is among them; 6 of 10 carry `Q` literally in the title or text blocks (the rest match otherwise: stemming or fields the app does not read) |
| The same through `PostRepository.feedSearchPage` | 10 mapped posts, a next cursor |
| Pages 2 and 3 (`offset` = the previous `extra.offset`) | 10 + 10 posts, **no overlap** with the earlier pages, a new cursor each time, `isLast: false` |
| «Все посты» (`only_allowed=false&only_bought=false`) | 10 posts, 0 locked (this query) |
| «Только купленные» | 0 posts, last page |
| «Последние 7 / 30 дней», «Последние 3 месяца» | 1 / 4 / 8 posts, last page, **every one inside the bounds** |
| A custom range in 2030 | 0 posts |
| `tags_ids` = a tag carried by a result | 10 posts, **every one carries that tag**, more pages |
| A one-letter query (`а`) | 0 posts, last page (no match on a single letter) |
| A nonsense Latin query | 0 posts, last page (`searchPosts: []`, `extra` present) |
| `Q & #` (spaces, `&`, `#` encoded) | HTTP 200, 10 posts (the encoding keeps it one param) |

So E6 has the reference's shape, pages by the opaque cursor without overlap, and honours the period, tag and «Только купленные» params together with `search_query`. «Все посты» returned no locked post for this query, so the access split under search was not proven here beyond «Только купленные»; one account, one run. The split was proven later with targeted queries (Epic 5 retro A2, «E6 access (LIVE)» below). Sanitized shape fixtures: `src/test/fixtures/boosty/e6-feed-search-1.json` (3 items, `isLast: false`) and `e6-feed-search-2.json` (2 items, `isLast: true`), built from the sanitized E5 posts (the live run logged counts only, no body was captured).

### E6 access (`LIVE`, Epic 5 retro A2)

Story 5.6 left the E6 access split unproven: its query matched no locked post, and its «Только купленные» check matched no purchased post. Story 5.7 found that E7 ignores both access params, so E6 was checked again with queries that match the posts in question.

Live check (debug build with Metro and a temporary counts-only probe mounted by the Shell, removed before the commit; Chromecast with Google TV 4K, the owner's session, 2026-10-29; every request succeeded; only counts and booleans were logged, never ids, titles, the query or URLs). The probe read E5 «Все посты» (6 pages: 60 posts, 43 locked) and E5 «Только купленные» (1 post, accessible, the account's one purchased post, from a blog the account does not follow). Each query `Q` was the longest word (7–11 letters) of the target post's title. E6 was read up to 3 pages per access value, through `PostRepository.feedSearchPage`:

| Target and query | «Доступные мне» (`only_allowed=true&only_bought=false`) | «Все посты» (`only_allowed=false&only_bought=false`) | «Только купленные» (`only_allowed=false&only_bought=true`) |
|---|---|---|---|
| Locked post 1 | 2 results, 0 locked, target absent | 3 results, 1 locked, **target present** | 0 results |
| Locked post 2 | 0 results | 1 result, locked, **target present** | 0 results |
| Locked post 3 | 30 results (3 pages, more to come), 0 locked, target absent | 30 results, 1 locked, **target present** | 0 results |
| The purchased post | 1 result, the target | 1 result, the target | **1 result, the target**, 0 results outside the purchased set |

So E6 honours both access params together with `search_query`. `only_allowed=true` drops locked posts that `only_allowed=false` returns. `only_bought=true` returns the purchased post and nothing else: queries that match accessible posts the account did not buy, or locked posts, return 0 results. E6 also searches a purchased post from a blog the account does not follow, as E5 «Только купленные» lists it. Unlike E7 (below), E6 needs no client-side drop of locked results, and Поиск keeps all three access values. The purchased post's query matched only that post under every access value, so that row alone does not separate the values; the locked rows show that `only_bought=true` filters. One account, one run.

### E4 filters (`LIVE`, Story 5.7)

The reference (`BlogRepository`, `BoostyApi.blogPosts`, SHA `87c0852`) sends `is_only_allowed = (access == Allowed)` and `only_bought = (access == Bought)`, plus the feed's period and tag params. Boosty TV sends `GET /v1/blog/{blogUrl}/post/?limit=20&comments_limit=0&reply_limit=0&is_only_allowed=<true|false>&only_bought=false[&from_ts=…&to_ts=…][&tags_ids=…][&offset=…]` (the same period and tag builders as E5, from the Author route's Filter):

| Filter value (Автор) | Params |
|---|---|
| «Доступные мне» (default, owner decision 2026-10-29 Q2 a) | `is_only_allowed=true&only_bought=false` |
| «Все посты» | `is_only_allowed=false&only_bought=false` |
| «Только купленные» | not offered on Автор (owner decision 2026-10-29, A a): the server ignores `only_bought=true` |

Live check (debug build with Metro and a temporary counts-only log, removed before the commit; Chromecast with Google TV 4K, the owner's session, 2026-10-29; HTTP 200 for every request; only keys, types, counts and booleans were logged, never ids, titles, the query or URLs). Blogs A, B, C = the three subscriptions (B has 14 locked posts on its page 1), D = the blog of the account's one purchased post (found through E5 «Только купленные», not subscribed):

| Request | Result |
|---|---|
| No access params | A, C: 20 posts, 0 locked; **B: 20 posts, 14 locked**; D: 20, 3 locked. A blog's server default is «Все посты» (unlike E5) |
| `is_only_allowed=true&only_bought=false` | B: 20, **0 locked** (6 shared with the no-params page); D: 20, 0 locked |
| `is_only_allowed=false&only_bought=false` | the no-params page (B: 14 locked) |
| `is_only_allowed=false&only_bought=true` | **the «Все посты» page on every blog** (B: 20 with 14 locked; D: 20 with 3 locked, the purchased post not among them): `only_bought` is ignored |
| `only_bought=true` alone / `is_only_allowed=true&only_bought=true` | the no-params page / the «Доступные мне» page |
| Pages 2 of «Все посты» (`offset`) | 20 posts, no overlap with page 1 |
| `from_ts=T&to_ts=T` (T = the newest allowed post's publish time) | 1 post, the newest: both bounds inclusive (A, B, C) |
| `from_ts=T−30 d&to_ts=T−1` / `T+1..T+30 d` | posts all inside the bounds, not the newest / 0 posts |
| Presets 7 / 30 / 90 days (from the app's builder) | every post inside the bounds (A: 2 / 8 / 20+, B: 0 / 9 / 11, C: 0 / 2 / 9) |
| `tags_ids=X` (the tag most frequent on A's page) | 20 posts, every one carries X, including the 8 unfiltered posts with X |
| `tags_ids=Y` (never with X) / `X,Y` | 16 posts all carrying Y / **0**: intersected, as E5 |

So E4 honours `is_only_allowed`, the period and the tags, and ignores `only_bought`; the reference's blog «Только купленные» therefore shows «Все посты». One account, one run. No body was captured: shape fixtures stay `e4-blog-posts-1.json` / `-2.json`.

### E7 (`LIVE`, Story 5.7)

Boosty TV sends `GET /v1/search/blog/post/?blog_url=<encoded>&limit=20&comments_limit=0&reply_limit=0&is_only_allowed=…&only_bought=false[&from_ts=…&to_ts=…][&tags_ids=…]&search_query=<URL-encoded>[&offset=<extra.offset>]` (the trimmed query, never logged). `PostRepository.blogSearchPage` parses it as E6 (`data.searchPosts[].post` through the one post mapper; an item without a `post` object dropped and counted; a missing `data.searchPosts` is `Parse`). Under «Доступные мне» the Author page drops results with `hasAccess: false` (owner decision 2026-10-29, B a); a page left empty with a next cursor goes through the shared auto-fetch rule (at most 3 in a row).

Live check (same run; `Q` = the longest word of the newest allowed post's title):

| Request | Result |
|---|---|
| `search_query=Q` (A) | top level `{data, extra}`; `data` keys `searchPosts` only; items `{post, rank, headline, blog}`, every `post` an object of that blog; 20 results, the newest post among them; `extra{offset: string, isLast: false}`; through `blogSearchPage`: 20 mapped posts and a cursor |
| Page 2 (`offset`) | 18 results, no overlap, last page |
| Presets 7 / 30 / 90 days | 1 / 4 / 8 results, every one inside the bounds |
| `tags_ids` = a tag carried by a result | 13 results, every one carries it |
| A nonsense Latin query | 0 results, last page |
| **D, a title word of the purchased post, every access combination** | the identical page every time: 20 results, **1 locked**, the purchased post included, also with `is_only_allowed=true`: **E7 ignores both access params** |

Sanitized shape fixture: `src/test/fixtures/boosty/e7-blog-search-1.json` (3 items, one locked, `isLast: false`), built from the sanitized E4 posts (the live run logged counts only).

### E14 (`LIVE`, Story 5.7)

`TagRepository.blogTags` sends `GET /v1/blog/{blogUrl}/post/tag/` (no params) and reads `data[]{id, title}`; `count` is not read. One item without a non-negative integer (or digits-only string) `id` or a non-blank `title` is dropped and counted in the log, never the list; a `data` that is not an array is `Parse`. Live (same run): top level `{data}` only, `data` an array of `{id, title, count}`: 13, 23 and 10 tags on A, B, C, every `id` a number and distinct, every `title` a non-blank string; one page (no cursor); every tag seen on A's and C's posts was in E14. Sanitized shape fixture: `src/test/fixtures/boosty/e14-blog-tags.json`.

### E15 (`LIVE` for 204 only, Story 7.1)

**Live probe (2026-10-30):** the pinned device (Chromecast with Google TV 4K), the existing debug APK installed with `adb install -r` over the release-like build (session kept), Metro, the owner's session; a temporary counts-only `__DEV__` probe (`TEMP71`, mounted by the Shell, removed before the commit) sent E2, then E15 for every subscribed blog with the content profile, logging status counts and, for a body, its key set and value types only. Result: **3 blogs, 3 × HTTP 204, empty body** (the body parsed as `undefined`). No 200 was seen, so the 200 shape below stays `REF` (BoostBuddy `StreamRepository.fetchActive`, `LiveStreamCard.kt`).

**Production client (Story 7.1):** `StreamRepository.fetchActive` (`src/shared/entities/stream`) is the only caller. `GET /v1/blog/{blogUrl}/video_stream` (the blog must pass `blogUrlSchema`, else `AppError('Client')` before a request), content profile, no query params, **no AD-6 retry** (`retry: false`: a failed first load shows no card; a shown card is polled anyway). The query key is `['stream', blogUrl]` in the account-scoped cache.
- A 204, or any 2xx with an empty body → no stream.
- A 200 goes through `mapStream` (lenient Zod, `src/shared/api/dto/stream.ts`; Story 7.2 adds the `hasLiveSources` flag, computed by `liveSourcesOf`, no URL kept). Required with their types: `id` (non-empty string or finite number), `isOnline` (boolean), `hasAccess` (boolean); a missing one or another type → no card and a warning with the issue count only. Read when present: `title`, `isTemplate` (missing → false), `startTime` (epoch s, > 0), `count{viewers, likes}` (non-negative integers, else 0), `subscriptionLevel.name` (trimmed), the cover (the first `teaser[]` image `url`, else the first `data[]` block's `preview` / `defaultPreview`, http(s) only; which one the reference shows is not verified). Never read: `signedQuery`, `data[]` player URLs (only the player-only `liveSourcesOf` reads them, Story 7.2), `isLiked` (Story 7.4), `currencyPrices` (prices are never shown).
- Status: `isOnline` → live; else `isTemplate` → scheduled; neither (e.g. a stream that just ended) → no card (logged at info with the two booleans only). `startTime` counts only as epoch seconds (0 < value < 1e11), else none.
- `hasAccess: false` is a result (the needs-level card), never an error or a session check. Every failure (network, 5xx, 401 after the one renewal, other 4xx) on the first load → no card, no error UI; on a poll → the last card stays.
- Refresh: one E15 on every Author open (`staleTime: 0`); then every 30 s while the Author route is focused, the app is in the foreground and a card is shown (owner decision 2026-10-30, Q1 a; the reference polls only a scheduled stream), and on resume (an E1 `ok` invalidates every observed `['stream']` query). Главная, Подписки and Поиск never send E15.

Synthetic shape fixtures (labelled `"synthetic": true`, built from the reference field list, no live 200 sample): `src/test/fixtures/boosty/e15-video-stream-live.json`, `-scheduled.json`, `-locked.json` (live and `hasAccess: false` with `subscriptionLevel{name, currencyPrices}`). The live 204s: `e15-video-stream-1.json`, `-2.json` (Story 1.5).

**Live player (Story 7.2, `REF`: no live 200 and no `ok_stream` sample was ever observed):** `StreamRepository.liveSources` sends the same E15 (content profile, no AD-6 retry) on every live Player open (query key `['liveSource', blogUrl]`, its own root, `gcTime` 1 s, never refetched by itself, never persisted) and once more as the player's one automatic recovery after an engine error.
- `ok_stream` mapping (`REF`: BoostBuddy `ContentResponse` `ok_stream`, `RootComponent.resolveLiveStream`): each `data[]` block with `type: "ok_stream"` carries `playerUrls[]{type, url}`, parsed entry by entry (`okStreamSourcesDtoSchema`, `playerUrlDtoSchema`; a bad entry is skipped, not the list). An `ok_video` in a stream body is ignored.
- Candidates (`liveSourcesOf`): only `live_hls` and `live_dash` with a non-empty URL. `live_playback_*` (the DVR window) is dropped as in the reference; `live_ondemand_hls` is dropped too (an on-demand copy, not the live edge: our reading of the type name, unverified), and so are `live_cmaf`, VOD, progressive and unknown types. HLS first, then DASH, each in the API's order; the player plays the first. The quality list follows §6 «Production client (Story 4.3)» rules, so live candidates give «Авто» only and the gear is hidden (owner decision 2026-10-30: shown only with more than one entry).
- Results: a 204, an empty or malformed body, or a stream that is not `isOnline` → no live stream («Стрим завершён» in the player). `hasAccess: false` or no candidate → not playable: the player leaves and Автор shows the QR of `https://boosty.to/{blog}/streams/video_stream` (`boostyStreamUrl`). Never a session check, never an error.
- The URLs are signed CDN URLs: they reach the PlayerEngine only (no `headers`, so no Boosty `Authorization`; the engine's own User-Agent), never a route param, the `Stream` entity (a `hasLiveSources` flag only), storage, a log or a fixture value (the synthetic fixture uses `https://example.invalid/live-*`). Whether the live URLs are bound to the client profile like `ok_video` (`srcAg`, §6) and how the CDN answers an expired or ended live URL are **unverified**.
- Exit (any path) invalidates `['stream', blogUrl]`, so the Author card refreshes. No E9 and no ProgressRepository call for a live stream.

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
| `text` | `content` (JSON string `[text, ?, [[styleCode, from, len], …]]`), `modificator` (`BLOCK_END` ends a paragraph) | Style codes: `0` bold, `2` italic, `4` underline, other values are normal. If `content` is not a JSON array, it is used as raw text. **`from` counts from the start of the paragraph, not the fragment** (UTF-16 code units; `LIVE`, Story 6.1, below). |
| `link` | `content` (same JSON format), `url`, `modificator` | Inline link inside the paragraph |
| `smile` | `name`, `smallUrl?`, `mediumUrl?`, `largeUrl?` | Inline emoji image |
| `image` | `url` | — |
| `ok_video` | `id` (media id, used for progress), `vid`, `title?`, `preview?` or `defaultPreview?`, `playerUrls[]{type, url}`, `timeCode?` (seconds, saved progress) | Dropped if no usable URL or no preview. **`id` is the progress identity, never the URL.** |
| `ok_stream` | as `ok_video`. `playerUrls` include `live_*` and `live_playback_*` | The reference keeps only live-edge URLs and drops `live_playback_*` (DVR) |
| `video` | `url` | External player page (e.g. YouTube; `LIVE`, Story 6.3: keys `type`, `url`) |
| `header` (`LIVE`, Story 6.3) | `content` (the `text` format), `modificator` (empty) | Not in the reference. A heading line (our addition) |
| `audio_file` | `url`, `title?`, `duration` (seconds) | Playable URL = `url + Post.signedQuery` (`LIVE`, Story 6.4: 403 without the query, 200 `audio/mpeg` with it) |
| `file` | `url`, `title?`, `size?` (bytes, inferred) | Download URL = `url + Post.signedQuery` (`LIVE`, Story 6.3: 403 without the query, 200 with it) |
| `list` (`LIVE`, Story 1.5) | `items[]{data: ContentBlock[], items[]}` | Nested list of blocks. Not in the reference. Render the text of the nested blocks (our improvement) or fall back to the placeholder |
| anything else | — | Must render as an "unsupported block" placeholder |

`fileType` (for example `MP3`) is present in the DTO but unused.

#### Text styles and smile (LIVE, Story 6.1, 2026-10-29)

A temporary counts-only probe (`__DEV__`, removed before the commit; it logged only counts, types and booleans, never text, URLs or titles) ran on the pinned device in a debug build with Metro, in the owner's session. It read E5 (content profile, default access params, 10 pages of 20, paged with `extra.offset`) and E2 → E4 for the 3 subscribed blogs (8 pages each). 32 requests, all HTTP 200. It scanned `data[]` and `teaser[]` of 612 posts (512 with a non-empty `data`), including blocks nested in `list` items.

| Item | Result | Level |
|---|---|---|
| `content` format | All 17 386 non-empty `text`/`link` contents were JSON arrays; the second element was always a string; the third always an array. No raw-text content was seen | `LIVE` |
| Style codes | 1 694 ranges: code `0` (bold) 732, `2` (italic) 48, `4` (underline) 914. No other code. 909 of the underline ranges are on `link` fragments (Boosty underlines links) | `LIVE` |
| Range shape | Every range was `[code, from, len]` with three integers; none negative; 18 had `len = 0` (ignored) | `LIVE` |
| **Range offsets** | **`from` counts from the start of the paragraph** (the merged `text`/`link` fragments since the last `BLOCK_END` or non-inline block), not from the fragment. All 1 694 ranges lie inside their own fragment's slot at paragraph offsets; 762 of them lie outside the fragment when read as fragment offsets (every later fragment of a paragraph). The unit is the UTF-16 code unit: 30 ranges in paragraphs with astral characters (emoji in the text) fit only as UTF-16, not as code points. The reference agrees: `mergeText` adds each fragment's styles at `from` in the paragraph's `AnnotatedString` builder | `LIVE` |
| `smile` blocks | **None** in the 612 posts (so no live keys or URL presence). The `smile` field set (`name`, `smallUrl?`, `mediumUrl?`, `largeUrl?`) and how many offset units a smile takes in a paragraph stay `REF` (Boosty TV counts one, as the reference's inline content) | unverified (`REF`) |
| Other block types seen | `text`, `link`, `ok_video`, `image`, `video` (3), `list` (11), **`file` (9)** and **`header` (42)**. `file` is a first live sample for Story 6.3 (keys not logged). `header` is not in the reference; it renders as the unsupported-block placeholder (keys not logged) | `LIVE` (types only) |

Boosty TV (Story 6.1): each fragment's ranges are placed at its offset in the paragraph and clamped to the fragment, so a range never styles another fragment's text. Unknown codes are normal text; a malformed range list drops only the styles.

#### File and video blocks (LIVE, Story 6.3, 2026-10-29)

A temporary probe (`__DEV__`, `TEMP63`, removed before the commit; it logged only counts, key names with value types, booleans, host classes and HTTP statuses, never a URL, title, text or query value) ran on the pinned device in a debug build with Metro, in the owner's session. It read E5 (content profile, 10 pages of 20, paged with `extra.offset`) and E2 → E4 for the 3 subscribed blogs (8 pages each): 32 requests, all HTTP 200, 612 posts. Blocks were deduplicated by post id and position (a post can come from both E5 and E4). For up to 3 accessible files it sent one fresh E8 each (content profile) and status-only requests to the file host (no Boosty `Authorization`, the app's default headers; the range GET was aborted at the headers).

| Item | Result | Level |
|---|---|---|
| `file` keys | 6 distinct blocks, all `complete` (boolean), `id` (string), `isInvalid` (null), `size` (number), `title` (string), `type`, `url` (string). `url` is an `https` URL on a `boosty.to` host without a query, on accessible posts whose `signedQuery` is non-empty | `LIVE` |
| `file` target | For 3 files: HEAD to `url` alone → **403** (`application/json`); HEAD to `url + signedQuery` (the fresh E8's, joined with `?`) → **200** (`application/octet-stream`, `Content-Length` present); a `Range: bytes=0-0` GET → 403 bare, **206** signed. So a file opens only with `signedQuery`. The fresh E8 found the same block by `id` with the same `url`. The joined target was 192 characters (a QR at `ecl=M` holds it). Whether the host rejects it after `expire_time` stays unverified | `LIVE` |
| `video` keys | 2 distinct blocks: `type`, `url` only. Both `url`s were `https` `youtube.com/watch?v=…` pages (no `youtu.be`, `embed` or `shorts` form seen; those are parsed per the reference's behavior and tests only). No non-YouTube sample, so «always an external page» rests on these 2 plus the reference | `LIVE` (2 samples) |
| `header` keys | 21 distinct blocks (the 42 of Story 6.1 counted repeats across E5/E4): all `content` (string), `modificator` (empty string), `type`. `content` is the `text` JSON array on all 21, with a non-empty text and no style ranges. 20 follow a paragraph end (`BLOCK_END`), 1 an image; all are followed by a `text` block | `LIVE` |

Boosty TV (Story 6.3): a `file` is a FileChip (title and size); OK sends a fresh E8 (`PostRepository.fileTarget`, the file by block id, else by index) and joins `url` + `signedQuery` (`shared/entities/externalUrls.fileTarget`: a leading `?`/`&` dropped, `?` or `&` join). An empty `signedQuery` gives no target (the bare URL answers 403), and an id-less file found by index must still carry the shown title, else no target. The target carries the ~24 h signature (`expire_time`) and is resolved once per OK: a QrDialog left open is not refreshed, so a very old open dialog may show an expired link (whether the host enforces `expire_time` is unverified); closing and pressing OK again resolves a fresh one. The target is held only by the QrDialog: never in the Post entity, a query cache, storage, a log or a fixture; no request goes to the file host from the TV. A `video` with an http(s) `url` is a chip (YouTube thumbnail when the host is YouTube) whose QR is the page; any other scheme or an empty `url` stays the placeholder. A `header` is a non-focusable heading with the `content` text (owner decision 2026-10-29, Q1 b); an empty one is dropped. A link fragment's `url` is used only when it is http(s).

#### Timestamp links (LIVE, Story 6.3, 2026-10-29)

A temporary probe (`__DEV__`, `TEMP63C`, removed before the commit; it logged only path shapes with placeholders, query key names, value classes, booleans and counts, never a URL, id or title) ran on the pinned device in a debug build with Metro, in the owner's session: E2, then E4 (content profile, `is_only_allowed=true`, up to 4 pages of 20) for the subscribed blogs, 13 requests, all HTTP 200. It read the `link` blocks after a «Таймкоды» text in each post.

| Item | Result | Level |
|---|---|---|
| Posts with «Таймкоды» | 101 (100 with one `ok_video`, 1 with two) | `LIVE` |
| Link shape | All 1 327 links: `https://boosty.to/<blogUrl>/posts/<postId>?t=<int>&tmid=<id>`; no fragment, no other host, no other time key | `LIVE` |
| Target video | 1 304 links: `<blogUrl>`/`<postId>` are the post's own and `tmid` equals the `id` (media id) of one of the post's `ok_video` blocks. 23 links point at another post (`tmid` not a video of this post) | `LIVE` |
| Time | `t` is whole seconds (digits only); it equals the `m:ss`/`h:mm:ss` time in the link text for 1 326 of 1 327 links (1 differs; `t` wins) | `LIVE` |

Boosty TV (Story 6.3, owner decision 2026-10-29, option b): `shared/entities/externalUrls.timestampRef` accepts only this shape — the current post (blog compared case-insensitively), `t` as digits, `tmid` one of the post's `ok_video` ids — and the chip plays that video from `t` (the Player clamps it into the video). Any other link keeps its chip (QR, or «Открыть» for another post).

#### Audio blocks (LIVE, Story 6.4, 2026-10-29)

A temporary probe (`__DEV__`, `TEMP64`, mounted by the Shell, removed before the commit; it logged only counts, key names with value types, booleans, host classes, lengths and HTTP statuses, never a URL, title, text or query value) ran on the pinned device in a debug build with Metro, in the owner's session. It read E2, then E4 (content profile, default Filter, `is_only_allowed=true`, up to 8 pages of 20) for the 3 subscribed blogs, including blocks nested in `list` items. For the audio block found it sent one fresh E8 (content profile) and status-only requests to the audio host with the app's default headers (no Boosty `Authorization`; the range GET was aborted at the headers).

| Item | Result | Level |
|---|---|---|
| Sample | 1 `audio_file` block in the scanned posts: the sample post (Илья MJTV Соколов, «Когда метроном - твой враг!», accessible, `signedQuery` 128 characters). The fresh E8 found the same block by `id` | `LIVE` (one block) |
| `audio_file` keys | `album` (string), `artist` (string), `complete` (boolean), `duration` (number, **present, > 0**), `fileType` (string), `id` (string), `isInvalid` (null), `showViewsCounter` (boolean), `size` (number), `timeCode` (number), `title` (string), `track` (string), `type`, `uploadStatus` (null), `url` (string), `viewsCounter` (number). `url` is an `https` URL on a `boosty.to` host without a query. `timeCode` exists on audio too; Boosty TV never reads or writes it (audio progress is not persisted, parity) | `LIVE` |
| Source | HEAD to `url` alone → **403** (`application/json`); HEAD to `url + signedQuery` (the fresh E8's, joined with `?`; keys `user_id`, `content_id`, `expire_time`, `sign`) → **200** `audio/mpeg`, `Content-Length` present, `Accept-Ranges: bytes`; a `Range: bytes=0-0` GET → 403 bare, **206** signed. The joined URL was 192 characters | `LIVE` |
| Playback | The production AudioBlock played it on the pinned device (react-native-video 6.19.3 / Media3 1.8.0, `progressive`, no headers): first sound about 2 s after OK; ±10 s seeks; pause; Home paused it (the AudioTrack `paused`); Back released the player (`docs/testing.md` «Story 6.4») | `LIVE` |

Boosty TV (Story 6.4): an `audio_file` of an accessible post is an AudioBlock; OK sends a fresh E8 (`PostRepository.audioSource`: the block by id, else by index with the shown title, as `fileTarget`) and plays `url` + `signedQuery` (`externalUrls.fileTarget` join). An empty `signedQuery` gives no source (the bare URL answers 403): the block shows «Не удалось воспроизвести» and never plays a bare URL. The URI is held only by the AudioBlock's state and the engine's props: never in the Post entity, a query cache, storage, a log or a fixture. An engine error re-resolves once (a fresh E8) and resumes at the last position; a source resolved ≥ 23 h ago is resolved again before a resume. Whether the host enforces `expire_time` stays unverified.

#### Live evidence (Story 1.7, 2026-10-25): no sample in the scanned posts

The Story 1.7 spike screen («Аудио и файлы», `src/app/spike/AudioFilesCheck.tsx`) scanned the owner's subscriptions on the pinned device (release-like build, started by the agent via adb keys): E2, then E4 (web-style headers) for every subscribed blog (3 blogs; the cap was 5), 3 pages each, paged only with the returned `extra.offset` (§5). 10 API requests per run, all HTTP 200. Four runs gave the same counts.

**Scope of «no sample»:** only the **60 newest posts of each of the 3 subscribed blogs** (180 posts) were seen. Page 3 still had `isLast=false`, so older posts were not scanned. E5 (feed) and E4 filters were not used. «No sample» means «none in these 180 posts», not «none in the account».

| Item | Result | Level |
|---|---|---|
| `audio_file` blocks | **None** in `data[]` of the 131 accessible posts, including blocks nested in `list` items. Locked posts (49 of 180, all in one blog) have an empty `data`, so their blocks cannot be seen | `LIVE` (no sample, scope above) |
| `file` blocks | **None**, as above | `LIVE` (no sample, scope above) |
| Block types seen in accessible posts | `text`, `link`, `ok_video`, `image`, `video`, `list` (with nested `text`). No other type name that could stand for audio or a file. `video` is in the table above (`REF`: external player page, `url`); its live keys were not logged in this story, so its field set stays unaudited | `LIVE` (types only) |
| E4 paging with `offset` | Every page returned `extra.offset` with `isLast=false`; passing the offset back verbatim (URL-encoded) returned the next 20 posts (HTTP 200) | `LIVE` |
| `Post.signedQuery` presence | **Non-empty on all 131 accessible posts**, also on posts without any audio or file block. Empty on locked posts (§7) | `LIVE` |
| `Post.signedQuery` shape | Leading `?`, then exactly 4 keys: `user_id` (7 digits), `content_id` (7 or 8 digits), `expire_time` (10 digits, epoch seconds), `sign` (64-character opaque value). Values never recorded. It carries the account's user id, so it is account-scoped personal data: never log, persist or put it in fixtures | `LIVE` |
| `Post.signedQuery` expiry | `expire_time` is **86 399–86 400 s (24 h) after the E4 response** on every accessible post, the same window as the `ok_video` `expires` (§6). Whether the server rejects a link after `expire_time` is **unverified** (no audio/file URL was requested) | `LIVE` (field), unverified (enforcement) |
| Playback of `url + signedQuery`, seek, sleep/wake | **Not verified** (no sample) | unverified (`REF`) |
| `file` link opened from a QR on a phone | **Not verified** (no sample) | unverified (`REF`) |
| Status-only probe (`Range: bytes=0-0`, aborted at the headers, nothing downloaded) | **Not verified on the device:** 0 probes ran (nothing to probe). Covered by a Jest test with a fake XHR only | unverified |

POST-06 and POST-07 rest on the reference code until a subscribed blog has an accessible `audio_file` or `file` post within the scanned range (owner decision 2026-10-25: auto-scan only, no blog typed in). The spike screen is ready for a re-run: it builds `url + signedQuery` in memory (dropping a leading `?`/`&` of the query and joining with `?` or `&`), logs the `signedQuery` shape (keys and value classes only) and the expiry field, plays audio with react-native-video, shows a file link only as a QR, and probes the URL status.

Open:
- ~~The `video` block's live field set (keys only) and whether its `url` is always an external page.~~ Story 6.3: keys `type`, `url`; both samples were YouTube pages (above).
- Whether `audio_file`/`file` URLs reject requests after `expire_time`, and whether `signedQuery` depends on the request profile (E4 here used web-style headers; no `srcAg`-like key was seen).

### 4.2 Poll

```text
Poll { id: int, title: string[] (joined for display), isMultiple: bool, isFinished: bool,
       counter: int (voters), answer: int[] (user's chosen option ids),
       options: [{ id: int, text: string, counter: int, fraction: int (percent) }] }
```
Required by the reference: `id`, `isMultiple`, `isFinished`, a non-empty `options`, and `counter` and `fraction` on each option.

#### Polls (LIVE, Story 6.5, 2026-10-29)

A temporary probe (`__DEV__`, `TEMP65`, mounted by the Shell, removed before the commit; it logged only counts, key names with value types, booleans and feed/blog positions, never a title, option text, id, URL or user data) ran on the pinned device in a debug build with Metro, in the owner's session. It read E5 (content profile, `only_allowed=true`, 10 pages of 20, paged with `extra.offset`), then E2 → E4 for every subscribed blog (3 blogs; `is_only_allowed=false`, up to 10 pages of 20 each, stopping on `isLast`), then one E8 for each post with a poll. 37 requests, all HTTP 200. Posts were deduplicated by id across E5 and E4.

| Scope | Pages | Posts (new after dedup) |
|---|---|---|
| E5 feed | 10 | 200 |
| Blog 1 (E4) | 10 (not the end) | 76 |
| Blog 2 (E4) | 10 (not the end) | 169 |
| Blog 3 (E4) | 5 (`isLast`) | 48 |
| Total | 35 | 493 (363 accessible) |

| Item | Result | Level |
|---|---|---|
| Where the poll lives | **1 post** with a poll (accessible; in the feed and in blog 3, its 34th post). It is the **top-level `poll`** only: **no `poll` block** in `data[]` or `teaser[]` of any of the 493 posts (including `list` items). Its E8 `data[]` is `text` blocks only. No locked post carried a poll | `LIVE` (one sample) |
| `poll` keys | `counter` (number), `defaultLang` (string), `hasOther` (boolean), `id` (number), `isFinished` (boolean, `false`), `isMultiple` (boolean, `false`), `options` (array, 2), `title` (array of strings). The same in the E8 | `LIVE` |
| `answer` | **Absent** (no key) in E5, E4 and E8. The owner had not voted on it (presumably): whether `answer` appears after a vote, and its element type, stay `REF` (Story 6.6) | `LIVE` (absent), `REF` (present) |
| Option keys | `counter` (number), `fraction` (number), `id` (number), `text` (string), `voters` (object `{data, extra}`, never read) | `LIVE` |
| `fraction` | An **integer** percent on both options; the fractions sum to 100. The option `counter`s sum to the poll's `counter` (single choice) | `LIVE` |
| Other poll shapes | No multiple-choice or finished poll was seen; those states rest on the reference. The voted state was seen in Story 6.6 (see «Poll votes (LIVE)»). Story 6.7: the multiple-choice `answer` (several ids) and a multi-id E11 are tested with the synthetic fixture `e10-poll-multiple.json` and the demo only (Story 6.5 scan: 1 single-choice poll in 493 posts) | unverified (`REF`); voted `LIVE` |

Boosty TV (Story 6.5): `Post.poll` comes from the top-level `poll` of an accessible post (a locked post shows no poll). `entities/poll.mapPoll` keeps the ids as strings, joins `title` with «, » (the reference's `joinToString()`), defaults a `counter` that is not a non-negative integer to 0 and a missing `answer` to none chosen, keeps the first of duplicate option ids (1 and "1" alike), drops an option that lacks `id`, `counter` or `fraction` on its own (owner decision 2026-10-29, option a: the reference's `mapNotNull`), and returns null — the «Опрос» placeholder, never a crash — when `id`, `isMultiple` or `isFinished` is missing or no valid option is left. The poll renders where a `poll` block with its id sits, else after the body (the live case). Each option shows «N %» (`fraction` rounded) and its `counter` (POLL-01); the bar is `fraction`% clamped to 0…100. A usable poll is content: a post with `hasAccess` not false whose only content is the poll is accessible (§7). No E10 is sent in this story.

#### Poll votes (LIVE, Story 6.6, 2026-10-29)

A temporary probe (`__DEV__`, `TEMP66`, in `PollRepository.fetchPoll` and on the PollWidget's mount, removed before the commit; it logged only status codes, key names with value types, `answer` element types, the index of the option each `answer` id matches, and the options' `fraction`/`counter` numbers, never a title, option text or user data) ran on the pinned device in a debug build with Metro, in the owner's session, on the one live poll (Стас Асафьев's, open single-choice, 2 options). The agent voted, changed the vote and retracted it from the app with adb key events (owner decision 2026-10-29, Q2 a). **The poll ended retracted** (counts back to their starting values).

| Item | Result | Level |
|---|---|---|
| E10 envelope | HTTP 200, `{data: {poll}}`: `body` has only `data`, `data` only `poll`. `poll` keys before a vote: `counter`, `defaultLang`, `hasOther`, `id`, `isFinished`, `isMultiple`, `options` (2), `title` (array, 1); no `answer` key. Each option: `counter`, `fraction` (integer), `id`, `text`, and **`voters` (an object; its keys were not logged)**. `mapPoll` maps it (no `answer` → none chosen) | `LIVE` |
| E11 vote | `POST /v1/poll/{pollId}/vote` form `answer=<optionId>` → **HTTP 200**, sent once. The next E10 has **`answer: [<number>]`** (the voted option's id) and an **`other` key (string)**; the voted option's `counter` and the poll `counter` grew by 1 | `LIVE` |
| E11 vote change | With a vote on option 2, E11 with option 1 → **HTTP 200**. E10: `answer` = [option 1], option 1 +1, option 2 −1, poll `counter` unchanged. The server moves the vote; no E12 is needed (owner decision Q1 a confirmed) | `LIVE` |
| E12 retract | `DELETE /v1/poll/{pollId}/vote` → **HTTP 200**. E10: no `answer` key, no `other` key, counts back to the values before the vote | `LIVE` |
| `fraction` | Integer percent; it stayed 12/88 across ±1 vote of 1 643 (the server rounds) | `LIVE` |
| Failures | Not provoked live. E11/E12 are never retried or replayed (HttpClient: no retry for a non-GET, no replay after a 401); any failure → the inline error, the previous state kept; one request per poll id app-wide | Boosty TV rule; host tests |

Boosty TV (Story 6.6): `PollRepository.fetchPoll` reads E10 with `pollRefreshDtoSchema` (`data.poll`, lenient; the poll goes through the one `mapPoll`). No `data.poll`, a poll `mapPoll` drops, or a poll with another id → `Parse`; after a 2xx mutation the caller then invalidates the post's E8 query and shows no error. `applyPoll` writes the E10 poll into every cached post and list page holding it, keeping each query's `dataUpdatedAt`. The fixture `e10-poll.json` has the live keys and value types (values synthetic; the options' `voters` object is left out: its content was not logged). `check:fixtures` treats `answer` elements as ids (synthetic 1001–9999).

Boosty TV (Story 6.7, multiple choice; **unverified live**, no sample): E11 sends form `answer` = every checked option id, comma-joined in option order (the reference's `joinToString(",")`), then E10 as for a single choice; E12 retracts the whole vote. The voted state is a non-empty `answer`. `e10-poll-multiple.json` is **synthetic** (not live-sanitized): `isMultiple: true`, `answer` with two ids; its fractions are only 0/100 under the `check:fixtures` rule, so they add up past 100, as a multiple-choice poll's shares may. No multiple-choice vote was sent live. A 2xx multi E11 followed by an E10 (or E8) that still shows no `answer` leaves the checks and an enabled «Проголосовать»: the vote is treated as not recorded (multi-id E11 is unverified live).

## 5. Pagination

- Cursor-based. `extra.offset` is an **opaque string** and must be passed back verbatim as `offset`.
- End of list: `extra.isLast == true`. When `extra` or `extra.offset` is missing, the reference treats it as having no next page.
- Page sizes used: feed 10, blog 20, blog search 20, feed tags 100 (blog tags: one page).
- Merge rule (reference): append, then deduplicate by post `id`, keeping the first occurrence.
- `LIVE` (Story 1.7): E4 pages 2 and 3 fetched with the previous `extra.offset` (URL-encoded) returned the next posts, HTTP 200, for 3 blogs.
- Unverified: whether the cursor stays stable while new posts arrive, and how long a cursor is valid.
- Subscriptions (E2): no pagination in the reference. Whether `offset` is supported is unverified.
- E2 notes (Story 3.2):
  - `total` is not the item count: the live account returned `total` 5 with 3 items in `data` (sanitized fixture `e2-subscriptions.json`). What it counts is unverified. The client therefore shows «Показаны первые N» only when `data` reached the limit (30 raw items) **and** `total > 30`.
  - `owner.hasAvatar`: read as "the avatar URL is a real avatar"; `false` → the client shows its placeholder even if `avatarUrl` is set. The `false` case was not observed live (all 3 items had `hasAvatar: true`).
  - Top-level `offset` and `limit` are ignored (one request, no paging). Subscription fields (`price`, `currencyPrices`, `subscriptionLevel`, payment times) are never parsed.
  - A `blogUrl` with whitespace, `/`, `?`, `#`, `%` or `..` drops the item (it becomes a focus id, a key and a path segment); a missing or blank `title` keeps it with the «Без названия» fallback.

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
- Expiry: the reference re-fetches the post (E8) or stream (E15) after any player error, finds the block with the same `id`, and re-picks the same quality. The URL lifetime is 24 h (below); the CDN error after a real expiry is **unverified**.

### Live evidence (Story 1.6, 2026-10-25, physical device)

Signed `ok_video` URLs from E8, played with react-native-video 6.19.3 (Media3 1.8.0 over the React Native OkHttp client) on the pinned Chromecast. Values never recorded; only query keys, value classes and statuses.

- **The signature is bound to the client profile of the request that fetched the post.** The query has `cmd=videoPlayerCdn`, `expires` (epoch ms), `srcIp` (= the device's egress IP), `srcAg` (client family), `sig`, `urls`, `ms`, `clientType`, `id`, `type`, `ct`, `pr`, `ch`, `zs`, `scl`. `srcAg` follows the E8 request's User-Agent: `CHROME_MAC` for a desktop Chrome UA with web headers, `CHROME_ANDROID` for the reference's mobile Android Chrome UA without `X-App`/`Referer`/`Origin` (BoostBuddy `composeApp/src/commonMain/kotlin/ru/slartus/boostbuddy/data/ktor/HttpClient.kt` `USER_AGENT`, commit `87c0852044d9b98b3ee1e94a544e78e250f4b5c9`; only the UA string and the header choice are reused, no code). The spike's reference profile sends only `Accept` and that UA, so `X-Locale` was dropped too; whether `X-Locale` matters is untested.
  - `CHROME_MAC` URLs: every request from the device player got **HTTP 400, body `8`**, whatever the User-Agent, `Referer` or `Origin`. Unplayable.
  - `CHROME_ANDROID` URLs: the player (Media3 UA) and a probe with no UA or with only `Referer` get **200**. A desktop Chrome UA on the same URL gets **HTTP 400, body `10`**.
  - **Rule for Boosty TV:** fetch posts whose media will be played (at least E8, and E4/E5 if their URLs are played directly) with the reference-like profile, mobile Android Chrome UA and no web headers, and play with the player's own UA. Whether auth, refresh and other endpoints need the web headers stays §8 item 3.
- **Lifetime:** `expires` is 86 400 s (24 h) after the response on every fetch. The CDN response after expiry was not observed (a pause over 24 h was not run; owner decision). Treat any player HTTP error as "re-resolve once via E8".
- **Headers to the CDN:** none of Boosty's. Requests carry only `Accept-Encoding`, `Connection`, `Host`, `User-Agent`, plus `Cookie` after the first response: the CDN sets its own cookie and the shared React Native cookie jar returns it to the same host. No `Authorization` (`LIVE`).
- **Re-resolve:** after a player error, one E8, the block with the same `ok_video.id` and `playerUrls` type, a seek to the last position → playback resumed (`LIVE`, after a decoder error and after the 400s).
- **Formats:** HLS, MP4 144p–1440p and DASH all play and keep the position across switches (seek after load). TTFF 0.9–2.5 s (one 6.9 s outlier).
- **Decoder limit:** once, adaptive HLS switched to 2560×1440 AVC High (`avc1.640032`, 8 Mbit/s) and the hardware decoder failed (`ERROR_CODE_DECODING_FAILED`). Not reproduced with MP4 1440p. Production should cap adaptive selection to what the display and decoder support, and keep the single re-resolve as the fallback.
- **E9:** HTTP 200 for every write at a ~10 s cadence, on pause, on exit and on background. A write of `t=1743` came back as `timeCode=1743` on the next E8, and a later `t=1802` showed as 30:02 on the website (`LIVE`). Write only after a new source has reached its start position: a new source reports `t=0` before the seek-after-load, and the spike once wrote that 0.
- Do not persist URLs. Persist only `{postId, mediaId, positionSeconds}`. The server-side copy is E9.

### Production client (Story 4.1)

What the production player sends and reads (`src/shared/entities/post/videoSources.ts`, `postRepository.ts` `videoSources`, `src/features/player/mediaResolver.ts`). Host-tested over FixtureTransport with the sanitized live E8; the device rows are in `docs/testing.md` «Story 4.1».

| Item | Behavior |
|---|---|
| Request | A fresh E8 (`GET /v1/blog/{blogUrl}/post/{postId}?comments_limit=0&reply_limit=0`, content profile) on every player open and on every «Повторить» in the player; the same request and mapper as Пост. TanStack Query key `['mediaSource', blogUrl, postId, mediaId]` (ids only), never refetched by itself while the player shows, `gcTime` 1 s after the player unmounts, never persisted |
| Parsed | The `ok_video` with `id = MediaRef.mediaId` in `data[]`: each `playerUrls[]` entry on its own (`{type: string, url: string}`; a malformed entry is skipped, not the list), mapped by the table above; empty URLs and unused types skipped. The post's author, title and the block's `title` for the overlay |
| Source order | The preferred quality (Story 4.3; none in 4.1), else HLS, else DASH (a non-live type first: `hls` before `live_hls`), else the highest progressive at or below 1080p (else the lowest above it) |
| Results | `hasAccess=false` (or empty `data`) → locked («Нет доступа к этому видео», no retry); 404 or the media id missing from the post → unavailable («Видео недоступно»); no usable source or any E8 failure → «Не удалось воспроизвести видео» + «Повторить» (one fresh E8). A player error → the automatic recovery (Story 4.4, below) |
| Recovery (Story 4.4) | The first player error (also before `onLoad`) sends **one** fresh E8 (same path, content profile, `PostRepository.videoSources`), finds the same `ok_video.id` and picks the same quality key (`auto` = HLS/DASH, else the height; the default order when the fresh E8 lacks it; the preference is not changed), then seeks to the current position (or the pending start) after `onLoad`. At most one automatic E8 per error episode: the budget comes back after the recovered source played 30 s. A second error or a failed E8 → the error state; «Повторить» sends one E8 (the default order when a non-`auto` quality had chosen the broken source). A locked answer runs the SessionCheck port first (§7); still locked → the player exits to Пост, whose E8 is invalidated and refetched. 404 or the video gone → «Видео недоступно». Which CDN status an expired URL gets is still unverified, so every player error is treated alike; nothing logs a URL, id or position. Host-tested over FixtureTransport only |
| Playback | react-native-video 6.19.3 (Media3) with the source URL only: no `headers`, so the player sends its own User-Agent and no `Authorization` (React Native's shared OkHttp client with its cookie jar). Adaptive selection capped at 1080p: once the tracks are loaded, `maxBitRate` = the highest declared bitrate of a track at or below 1080p (the 1440p AVC High variant failed on the pinned device in Story 1.6, and HLS climbed to 1440p again in the first Story 4.1 run without this cap) |
| Memory only | Signed URLs live in the query cache entry and the engine's props only: never in route params, the post query, storage, logs or fixtures. The engine adapter reports errors with a short native code only, never a message |

### Production client: progress (Story 4.2)

What the production app sends and reads for progress (`src/shared/services/progress/`, `src/shared/entities/post/postRepository.ts` `onServerProgress`). Host-tested over FixtureTransport; the device rows are in `docs/testing.md` «Story 4.2».

| Item | Behavior |
|---|---|
| Read | `ok_video.timeCode` (seconds, floored) of an accessible post's `data[]`, from Пост's E8 and the player's fresh E8 (`okVideoTimeCodeDtoSchema`: `id`, `timeCode`; a missing or wrong-typed value is no value). Handed to `ProgressRepository.onServerProgress(mediaId, sec)`; never stored on the Post entity, in a query cache value, a route or a log. Kept in memory only (account-scoped) |
| Resume | The local entry's position when one exists, else the server `timeCode` (ADR 0004); 0 when none, when finished (≥ 95 % or < 30 s left) or at/after the end. «С начала» starts at 0 |
| Write | E9 `PUT /v1/viewstat/video/{mediaId}/timecode/` (the media id URL-encoded as one segment), form `time_code` = integer seconds, `Content-Type: application/x-www-form-urlencoded`, **content profile** (the active session's `HttpClient`, Bearer), body ignored. Only after the start position is reached (never a new source's pre-seek `t=0`); when the position moved ≥ 10 s since the last trigger; forced on a user pause (not a hold-scrub pause), background, Stop/Back/«Назад»/unmount and the end. **Short visits** (owner decision 2026-10-28): a player session (an open, a replay after the end, «С начала», a retry's new source) writes nothing, neither E9 nor the local entry, until it moved ≥ 10 s from its start position or the user paused; exit, background and end before that write nothing, so reopening a finished video or a brief «С начала» never erases progress |
| Concurrency | One E9 in flight per video; a trigger meanwhile sends the latest position after it lands. A write that lands after an account reset is ignored |
| Failure | Never replayed blindly (AD-6, E9 is the only re-sendable mutation): the latest position, no sooner than 10 s after the failure, at most 5 times by itself (a later trigger sends again). Not shown to the user |
| Session | A write that fails while the session is `expired` (or is asked for while it is) is held, latest position only, and sent when the session is `signedIn` again with the same `AccountScope.generation()`; a sign-out or account switch drops it |
| Local copy | Account-scoped KeyValueStore (async-storage 3.1.1, database `boostytv-account`, key `progress.v1`): per media id `{ref, positionSec, durationSec, updatedAt, meta}` (meta: video title, post title, author name, the preview URL only when it has no query (Story 4.7: `defaultPreview` URLs carry a `tkn` CDN token; one with a query or fragment stays in memory only), duration; never a media URL). Removal (Story 4.7, owner decision 2026-10-28): when the player's E8 says locked and the session check verified it (E1 ok, not offline), or unavailable (E8 404 / the video gone), `ProgressRepository.forget` drops that video's entry, written to disk at once; no request is sent, at most 200 entries, newest kept. Memory at once, disk debounced 2 s (at once on forced events). Wiped by AccountScope |
| Live status | **`LIVE` with the content profile** (Story 4.2, 2026-10-28, pinned device, release-like build, the owner's session and pick: the first feed post): the app exited playback at ≈ 1:12 and the website then showed 1:14 for that video (owner). The release build logs nothing, so HTTP 200 is inferred from the stored value. Story 1.6 had verified E9 with the web profile only |

### Audio and file URLs (`audio_file`, `file`)

These are not `playerUrls`: the URL is the block `url` plus `Post.signedQuery` (§4.1; `LIVE` for files in Story 6.3 and for audio in Story 6.4: 403 bare, 200 signed, both on a `boosty.to` host). `Post.signedQuery` is `?user_id=…&content_id=…&expire_time=…&sign=…` with `expire_time` 24 h ahead (`LIVE`, Story 1.7). Whether the media host enforces `expire_time` and whether the query depends on the request profile (no `srcAg`-like key was seen; only the content profile was used live) are still **unverified**. The `ok_video` rules apply: fetch the post with the content (reference-like) profile before playing, send no Boosty `Authorization` to the media host, keep the URL in memory only, and re-resolve once via E8 (same block `id`, else the same index and title) after a player error (Story 6.4).

## 7. Entitlement and error semantics

| Situation | Signal (reference evidence) | Status |
|---|---|---|
| Post not accessible to the user | HTTP **200**, `hasAccess=false`, `data` empty (`[]`), `teaser` present (an image block), `signedQuery` empty string. Same in E4 and E8 | `LIVE` (Story 1.5) |
| Video inside an inaccessible post | Absent: `data` is empty, so there is no `ok_video` and no `playerUrls`. Only the teaser image is returned | `LIVE` (Story 1.5) |
| Live stream requires a subscription level | `hasAccess=false`, `subscriptionLevel{name, currencyPrices}` | `REF` |
| No live stream | HTTP **204**, empty body, on E15 | `LIVE` (Story 1.5; Story 7.1: 3 of 3 subscribed blogs, 2026-10-30) |
| Unauthorized / expired access token | HTTP **401** `{error: "unauthorized", error_description}` on E1 (`/v1/user/current`) without a token, and with a corrupted token (Story 1.4) | `LIVE` |
| **Content request without a token** | E8 for a post the user can access returns HTTP **200** as for an anonymous viewer: `hasAccess=false`, empty `data`, teaser only. **Not a 401.** Observed on one paid post; free posts without a token were not checked, so the general rule is inferred. A missing `Authorization` header on content endpoints looks like "locked", not like a session problem. The client must always attach the token when signed in and must not show "subscribe to access" for posts fetched without one | `LIVE` (one post, Story 1.5) |
| **Content request with an expired or invalid token** | E8 with a synthetic 64-character Bearer returns HTTP **200 as an anonymous viewer** (`hasAccess=false`, empty `data`, no `error`), **not 401**. So an invalid or expired token on content endpoints never triggers the 401 refresh path and makes everything look locked. The session must be validated separately: proactive refresh by expiry, and E1 (which does return 401) at app start and on resume before trusting `hasAccess=false`. One request on E8; E4/E5 inferred to behave the same | `LIVE` (E8, Story 1.6) |
| Accessible post with empty `data` (`hasAccess: true`, `data: []`) | **Not observed.** Debug-build counter (count and post ids only, removed afterwards) over 37 E5 pages (`limit=10`) and 23 E4 pages (`limit=20`) of the 3 subscribed blogs, owner's session, 2026-10-27: 0 posts with `hasAccess: true` and an empty or missing `data`. The mapper keeps treating such a post as locked (`hasAccess = dto.hasAccess !== false && blocks.length > 0`), except (Story 6.5) when it carries a usable top-level `poll`: a poll is content too, so a post whose only content is a poll is accessible (not observed live; the one live poll post had `text` blocks) | not observed (60 pages, one account; Epic 3 retro A6) |
| Nonexistent post | E8 with a random UUID: HTTP **404** `{error: "not_found", error_description}` | `LIVE` (Story 1.5) |
| Nonexistent blog | E3 with a random slug: HTTP **404** `{error: "blog_not_found", error_description}` | `LIVE` (Story 1.5) |
| 403, 410, 429 (content), 5xx | **Not observed.** A locked post is a 200 with `hasAccess=false`, not a 403. 429 was seen only on the phone-auth send (§2.2) | unverified. **Do not treat 403 as an expired session.** Map unobserved 4xx to a generic non-retried error |
| Network failure | Generic | — |

Client handling of «locked» (Epic 3 retro A6, `src/shared/api/sessionCheck.ts`): because a dead token answers 200 as anonymous, three trigger points run E1 (`SessionManager.validate()`, single-flight) before they trust a locked answer: the player's fresh E8, the Post screen's E8, and Главная's page 1 when it has posts and every one is `hasAccess: false` (owner decision 2026-10-27; the Author page is excluded, a blog whose posts are all locked is ordinary; Story 5.3: only under the «Доступные мне» Filter, an all-locked page under «Все посты» or «Только купленные» is ordinary). E1 → 401 → refresh 400 `invalid_grant` → `expired` → A11. E1 200 (also after a silent refresh) → the locked query is refetched **once**. A failure (`Network`, 5xx…) → the locked state as before. A window (at most one E1 per trigger point per 5 min, one refetch per window, handed only to a caller that is still mounted) is kept only after `ok` or `expired`; a failed or skipped E1 drops it, so the next locked answer checks again. A clock that moved back ends the window; every session status change resets the windows. A failed post-`ok` refetch keeps the locked state (no error copy). The locked UI stays on screen while E1 runs. `hasAccess: false` or a 403 alone is never treated as an expired session. **Known gap:** the window is per trigger point, so a session that dies within 5 min after an `ok` at that trigger point is noticed only after the window (or on the next resume E1). E5 with a dead token is still inferred, not observed (only E8 was checked live).

Retry policy for Boosty TV (our policy, not the reference's):
- Idempotent GETs: bounded retry with backoff for network errors and 5xx.
- 401: one refresh, then one retry.
- Mutations (E9, E11, E12, E16, E17): never replayed automatically after an ambiguous failure. E9 is the only exception: it can be re-sent with the latest position, because the last write wins.

## 8. Unverified items to resolve in the spike

1. The real lifetime behind `expires_in` (2592000 from phone auth and refresh) and the refresh-token lifetime. Rotation and the rejection signal are resolved (§2.3, Story 1.4). The `device_id`-mismatch and refresh-token-reuse questions are closed as not needed for production (owner decision 2026-10-25, §2.3).
2. Phone auth (partly resolved in Story 1.3, see §2.2 "Live evidence"): still open are the expired-challenge shape, the confirm attempt limit, whether captcha can be demanded, the challenge `expiresIn` units, the exact server resend window (a resend was allowed at 32 s and rejected at 2–5 s), and the longer send limit (window, threshold, phone vs IP; §2.2 «Rate limit, longer window»).
3. Minimal required headers (UA, `X-App`, `X-From-Id`) for normal calls and for refresh. Partly resolved: content requests whose media URLs are played must use the reference-like profile (mobile Android Chrome UA, no web headers), because the signed URLs follow the request's client family (Story 1.6, §6). Decided without that test ([ADR 0008](adr/0008-api-request-profiles.md)): auth and refresh keep the verified web-style set; every other call uses the reference-like content profile. E9 was verified only with the web profile (Story 1.6 sent E9 with the web headers and E8 with the reference profile in the same session).
4. Events (E18): shape and event types resolved (§3 «Live evidence (Story 1.5)»). Open: pagination (no cursor field in a 1-event response).
5. ~~E8 with `comments_limit=0`~~: accepted, HTTP 200 (Story 1.5).
6. ~~Signed media URL TTL~~: 24 h by `expires` (Story 1.6, §6). Still open: the CDN error after a real expiry (needs a pause over 24 h), and whether `signedQuery` for audio and files expires. Story 1.7: `Post.signedQuery` carries `expire_time` (epoch s) = **24 h** after the response on every accessible post (§4.1 «Live evidence (Story 1.7)»). Still open: whether audio/file hosts enforce it. No accessible `audio_file` or `file` block was found in the 60 newest posts of each of the 3 subscribed blogs, so audio playback, the file QR and the enforcement stay unverified.
7. 401 and 404 bodies resolved (§7). 403 was not observed: locked content is a 200 with `hasAccess=false`.
8. ~~Whether E9 progress is reflected in `timeCode` on the next E8 and on the web~~: yes, exact round-trip on E8 and the website (Story 1.6, §6).
9. Subscriptions pagination beyond 30: E2 returns top-level `offset`, `limit`, `total`; whether `offset` pages further was not tested (3 subscriptions).
