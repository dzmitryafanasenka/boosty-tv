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

Boosty TV decision: two request profiles, `auth` (phone auth, refresh: the web-style set) and `content` (every other call: mobile Android Chrome UA, `Accept`, Bearer), as in the reference. See [ADR 0008](adr/0008-api-request-profiles.md). The content profile is `LIVE` for E8 (Story 1.6) and E5 (Story 3.1: production release-like build on the pinned device, owner's session, 2026-10-26: HTTP 200 with the owner's subscribed posts, accessible posts with video previews and durations, several pages via `extra.offset`) and E2 (Story 3.2: same device and session, 2026-10-26: HTTP 200, the owner's 3 subscriptions with titles, owners and avatars) and E3/E4 (Story 3.3, `LIVE` (inferred from the rendered page; the release build logs nothing): same device and session, 2026-10-27, release-like build driven by adb: E3 rendered the blog's title, owner name and avatar; E4 rendered the blog's posts, accessible and locked (`hasAccess=false`, never an error), and paged through at least 3 pages via `extra.offset`. The release build logs nothing, so the 200 status is inferred from the rendered data: an E3 failure shows the full-page error and an E4 failure the posts error, neither appeared. As built, any E3 404 shows «Автор недоступен»: HttpClient keeps no 404 body, and only `blog_not_found` is verified live (§7); keeping the error code is deferred work); the other content endpoints are checked by the first production story that sends them.

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
| E1 | `GET /v1/user/current` | Validate session, profile | — | `id`, `blogUrl?` |
| E2 | `GET /v1/user/subscriptions` | Subscriptions | `limit=30`, `with_follow=true` | `data[].blog{title, blogUrl, owner{name, avatarUrl?}}` (1.16.0 stopped parsing price fields after a crash). No pagination is used. Possible top-level `offset/limit/total` are commented out. |
| E3 | `GET /v1/blog/{blogUrl}` | Blog header | — | `title`, `blogUrl`, `owner{name, avatarUrl}` |
| E4 | `GET /v1/blog/{blogUrl}/post/` | Blog posts | `limit` (20), `offset?` (opaque string), `comments_limit=0`, `reply_limit=0`, `is_only_allowed?`, `only_bought?`, `from_ts?`, `to_ts?` (epoch s), `tags_ids?` (comma-joined) | `data[]: Post`, `extra{offset, isLast}` |
| E5 | `GET /v1/feed/post/` | Feed | `limit` (10), `offset?`, `comments_limit=0`, `reply_limit=0`, `only_allowed?`, `only_bought?`, `tags_ids?`, `from_ts?`, `to_ts?` | `data.posts[]: Post`, `extra` |
| E6 | `GET /v1/search/feed/post/` | Feed search | E5 params + `search_query` | `data.searchPosts[].post: Post`, `extra` |
| E7 | `GET /v1/search/blog/post/` | Blog search | `blog_url`, `search_query`, E4 params (with `is_only_allowed`) | `data.searchPosts[].post: Post`, `extra` |
| E8 | `GET /v1/blog/{blogUrl}/post/{postId}` | Single post (the reference uses it to refresh media URLs and `timeCode`) | `comments_limit`, `reply_limit` (the reference sends 20. **We must send 0**. 0 is accepted: `LIVE`, Story 1.5) | `Post` (top level, no `data` wrapper) |
| E9 | `PUT /v1/viewstat/video/{videoId}/timecode/` | Save playback progress | form `time_code` = integer seconds | body ignored. **HTTP 200** on every write; the value comes back as `ok_video.timeCode` on the next E8 and on the website (`LIVE`, Story 1.6, §6) |
| E10 | `GET /v1/blog/{blogUrl}/poll/{pollId}` | Refresh poll | — | `data.poll: Poll` |
| E11 | `POST /v1/poll/{pollId}/vote` | Vote | form `answer` = comma-joined option ids | body ignored |
| E12 | `DELETE /v1/poll/{pollId}/vote` | Retract vote | — | body ignored |
| E13 | `GET /v1/search/feed/tag/` | Feed tags (filter) | `limit` (100), `offset?` | `data.searchTags[]{tag{id, title}, rank}`, `extra{offset, isLast}` |
| E14 | `GET /v1/blog/{blogUrl}/post/tag/` | Blog tags | — | `data[]{id, title}` |
| E15 | `GET /v1/blog/{blogUrl}/video_stream` | Active or scheduled live stream | — | **`204 No Content` = none.** Otherwise: `id`, `int_id`, `title`, `isOnline`, `isTemplate`, `hasAccess`, `startTime` (epoch s), `signedQuery`, `isLiked`, `data[]` (content blocks incl. `ok_stream`/`ok_video`), `teaser[]`, `count{viewers, likes}`, `subscriptionLevel{name, currencyPrices{RUB, USD, EUR}}` |
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
| `list` (`LIVE`, Story 1.5) | `items[]{data: ContentBlock[], items[]}` | Nested list of blocks. Not in the reference. Render the text of the nested blocks (our improvement) or fall back to the placeholder |
| anything else | — | Must render as an "unsupported block" placeholder |

`fileType` (for example `MP3`) is present in the DTO but unused.

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
- The `video` block's live field set (keys only) and whether its `url` is always an external page.
- Whether `audio_file`/`file` URLs reject requests after `expire_time`, and whether `signedQuery` depends on the request profile (E4 here used web-style headers; no `srcAg`-like key was seen).

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

### Audio and file URLs (`audio_file`, `file`)

These are not `playerUrls`: the URL is the block `url` plus `Post.signedQuery` (§4.1, `REF`). `Post.signedQuery` is `?user_id=…&content_id=…&expire_time=…&sign=…` with `expire_time` 24 h ahead (`LIVE`, Story 1.7). Whether the media host enforces `expire_time`, whether the query depends on the request profile (no `srcAg`-like key was seen), and which host serves audio and files are **unverified**: Story 1.7 found no accessible sample (§4.1 «Live evidence (Story 1.7)»). Until verified, apply the `ok_video` rules: fetch the post with the reference profile before playing, send no Boosty `Authorization` to the media host, keep the URL in memory only, and re-resolve once via E8 (same block `id`, else the same `url`) after a player error.

## 7. Entitlement and error semantics

| Situation | Signal (reference evidence) | Status |
|---|---|---|
| Post not accessible to the user | HTTP **200**, `hasAccess=false`, `data` empty (`[]`), `teaser` present (an image block), `signedQuery` empty string. Same in E4 and E8 | `LIVE` (Story 1.5) |
| Video inside an inaccessible post | Absent: `data` is empty, so there is no `ok_video` and no `playerUrls`. Only the teaser image is returned | `LIVE` (Story 1.5) |
| Live stream requires a subscription level | `hasAccess=false`, `subscriptionLevel{name, currencyPrices}` | `REF` |
| No live stream | HTTP **204**, empty body, on E15 | `LIVE` (Story 1.5) |
| Unauthorized / expired access token | HTTP **401** `{error: "unauthorized", error_description}` on E1 (`/v1/user/current`) without a token, and with a corrupted token (Story 1.4) | `LIVE` |
| **Content request without a token** | E8 for a post the user can access returns HTTP **200** as for an anonymous viewer: `hasAccess=false`, empty `data`, teaser only. **Not a 401.** Observed on one paid post; free posts without a token were not checked, so the general rule is inferred. A missing `Authorization` header on content endpoints looks like "locked", not like a session problem. The client must always attach the token when signed in and must not show "subscribe to access" for posts fetched without one | `LIVE` (one post, Story 1.5) |
| **Content request with an expired or invalid token** | E8 with a synthetic 64-character Bearer returns HTTP **200 as an anonymous viewer** (`hasAccess=false`, empty `data`, no `error`), **not 401**. So an invalid or expired token on content endpoints never triggers the 401 refresh path and makes everything look locked. The session must be validated separately: proactive refresh by expiry, and E1 (which does return 401) at app start and on resume before trusting `hasAccess=false`. One request on E8; E4/E5 inferred to behave the same | `LIVE` (E8, Story 1.6) |
| Nonexistent post | E8 with a random UUID: HTTP **404** `{error: "not_found", error_description}` | `LIVE` (Story 1.5) |
| Nonexistent blog | E3 with a random slug: HTTP **404** `{error: "blog_not_found", error_description}` | `LIVE` (Story 1.5) |
| 403, 410, 429 (content), 5xx | **Not observed.** A locked post is a 200 with `hasAccess=false`, not a 403. 429 was seen only on the phone-auth send (§2.2) | unverified. **Do not treat 403 as an expired session.** Map unobserved 4xx to a generic non-retried error |
| Network failure | Generic | — |

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
