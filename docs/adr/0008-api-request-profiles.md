# ADR 0008: Two API request profiles — auth and content

- Status: accepted (owner, 2026-10-26, PR #10; written before Story 2.2 as a condition of the owner's Epic 2 go, `docs/testing.md` «Spike report»)
- Date: 2026-10-26
- Relates to: architecture spine AD-3 (SessionManager, refresh), AD-11 (media resolution); `docs/api-contract.md` §1, §2.2, §2.3, §6, §8 item 3

## Context

Boosty's signed CDN URLs depend on the client that fetched the post (Story 1.6, api-contract §6). The `srcAg` query value comes from the User-Agent of the E8 request:
- **desktop Chrome UA with web headers** (`X-App: web`, `Referer`, `Origin`) gives `CHROME_MAC` URLs, and every request from the device player for these URLs got HTTP 400;
- **mobile Android Chrome UA without web headers** gives `CHROME_ANDROID` URLs, which play.

Header sets verified on the device so far:

| Call | Header set used | Evidence |
|---|---|---|
| Phone auth send / confirm (`/auth/phone/verification_code/*`) | Web: desktop Chrome UA, `X-App: web`, `X-Locale: ru_RU`, `Referer`, `Origin`, `Accept`, `X-From-Id: <device_id>` | `LIVE` Story 1.3 |
| Refresh (`POST /oauth/token/`) | Web + `X-From-Id` | `LIVE` Story 1.4 |
| E1, E2, E3, E4, E5, E15, E18, E9 | Web, no `X-From-Id` | `LIVE` Stories 1.3–1.7 (none of these returns a played URL, except E4/E5, whose URLs were not played) |
| E8 with played media | Mobile Android Chrome UA + `Accept` only | `LIVE` Story 1.6 |

The reference client (BoostBuddy 1.16.0) uses the same split. Its main client sends a mobile Chrome UA on every content call. Only its phone-auth and refresh clients send the desktop UA with web headers (api-contract §1, `REF`).

An alternative was to test phone auth and refresh with the mobile profile, so one profile could serve every call. That test needs a new phone sign-in. Sign-ins are rate-limited (`sms_gate_ratelimit`, a block of about 2 h after a few sends; Story 1.5), and a failure would leave the owner signed out on the TV. Nothing the product needs depends on a single profile.

## Decision

`shared/api` has exactly two request profiles, chosen by the client, never per call site:

- **`auth` profile — `AuthApiClient`:** phone-auth send and confirm, and the refresh call made by SessionManager. Headers: desktop Chrome UA, `X-App: web`, `X-Locale: ru_RU`, `Referer: https://boosty.to/`, `Origin: https://boosty.to`, `Accept: application/json, text/plain, */*`, `X-From-Id: <device_id>`. Form-encoded bodies. No `Authorization`.
- **`content` profile — `HttpClient`:** every other `api.boosty.to` call, including E1 session validation, reads, E9 progress writes and other mutations. Headers: the mobile Android Chrome UA (the reference's `USER_AGENT` string), `Accept: application/json, text/plain, */*`, and `Authorization: Bearer <access_token>` from SessionManager. No web headers, no `X-From-Id`.
- The two UA strings are constants in one module of `shared/api`, with a comment that the content UA decides the CDN signature (`srcAg`). Changing either needs a device playback check.
- Hosts other than `api.boosty.to` (CDN, audio/file hosts, GitHub) get neither profile's Boosty headers and never `Authorization` (AD-11). The player uses its own UA.

## Consequences

- Playback works by construction. Every played URL comes from a `content`-profile request: E8 at play time, E15 for live streams.
- Phone auth and refresh keep the exact header set proven in Stories 1.3–1.4. No new sign-in experiment is needed.
- **Verified only with the web set, now sent with the content profile:** E1, E2, E3, E4, E5, E15, E18 and E9. The reference uses the mobile UA for them, so the risk is low, but it is unproven on our client. The first production story that sends each call checks it on the device and records the status in api-contract. E1 after the first sign-in is checked in Story 2.3, the feed and subscriptions in Stories 3.1 and 3.2, E9 in Story 4.2, E18 in Story 7.5. If an endpoint rejects the content profile, that endpoint moves to the `auth` header set (minus `X-From-Id`) with an amendment to this ADR. The played-media rule for E8/E15 still holds.
- Whether `Post.signedQuery` (audio and files) depends on the profile is still unverified (Story 1.7 measured it only with the web set). With this decision every post is fetched with the content profile, which matches the reference. Stories 6.3 and 6.4 verify it when a sample exists.
- `X-Locale` is not sent on content calls; whether it changes any response text is untested and not relied on.
- Tests: unit tests assert the exact header set per client and that `Authorization` never reaches a non-`api.boosty.to` host.
