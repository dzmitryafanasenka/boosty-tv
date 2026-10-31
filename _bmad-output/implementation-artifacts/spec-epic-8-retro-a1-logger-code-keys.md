---
title: 'Epic 8 retro A1: logger field keys with "code"'
type: 'bugfix'
created: '2026-10-31'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `isSecretFieldKey` (`src/shared/services/logger.ts`) redacts any field key whose compact form contains `code`. So `versionCode`, `latestVersionCode`, `errorCode`, `statusCode`, `countryCode`, `codec` and `decoder` are silently redacted. Epic 9's update check would lose `versionCode` in the diagnostics file (Epic 8 retro X1). No test checks real call-site keys either (X2).

**Approach:** Keep the contains-match for token, cookie, authorization, signedQuery and phone. Treat `code` as secret only in two cases: the key is exactly `code` (any case), or its compact form ends in a secret qualifier plus `code` (sms, otp, auth, verification, confirm, confirmation, onetime, pin, pass, access, security, login). Sig/signature stays as is. Add a source-scan test. It parses every non-test `src` file with the TypeScript compiler and collects the literal field keys passed as the third argument to `logger.debug|info|warn|error`. It fails if any key is redacted and not on an explicit allow-list of intended secrets.

</frozen-after-approval>

## Implementation Notes

- `src/shared/services/logger.ts`: `code` left the contains-list; `SECRET_CODE_KEY` (built from `CODE_QUALIFIERS`) matches `code(s)`, `codeVerifier`/`codeValue` and qualifier+`code(s)` on the compact key and on its last dotted segment. `challenge` joined `SECRET_KEY_PARTS` (CLAUDE.md: never log the challenge). This narrows Story 8.3's over-match: `statusCode`, `errorCode`, `versionCode`, `countryCode`, `codec`, `decoder` are now readable; bare `code` stays secret.
- `__tests__/loggerFieldKeys.test.js` (new): TypeScript-AST scan of non-test `src` files for logger field keys, including local wrappers that forward a spread parameter (`secureStore` `log`); unreadable fields arguments fail. Mutation checks: AudioBlock `{ code }` and an injected `smsCode` in the `secureStore` wrapper both fail it; `{ errorCode }` passes.
- `src/shared/services/__tests__/logger.test.ts`: secret/non-secret tables extended. `docs/testing.md` Story 8.3 redaction line updated.
- Checks: lint `--max-warnings 0` and typecheck clean; `npm test` ×3: 3080 passed.

## Review Triage Log

Blind Hunter (1 layer, oneshot):

| # | Finding | Verdict | Evidence / route |
|---|---------|---------|------------------|
| 1 | Scan misses the `secureStore` `log(...)` wrapper (spread fields) | medium | `secureStore.ts:142-143`; patched: wrapper detection + a coverage test |
| 2 | Non-literal fields args, foreign spreads, computed keys pass silently | medium | Patched: collected as `unverified`, asserted empty |
| 3 | Narrowing un-redacts real secret codes (`codeVerifier`, `mfaCode`, `recoveryCode`, `user.code` …) | high | Verified against the first regex; patched: more qualifiers, `codes?`, `code(verifier|value)`, last dotted segment |
| 4 | `codes` asserted not secret | medium | Patched: now secret |
| 5 | Qualifier list duplicated in the regex | low | Patched: built once from `CODE_QUALIFIERS` |
| 6 | `bypassCode`/`postalPinCode` over-redacted by the `pass`/`pin` suffix | low | Rare; over-redaction is the safe side; documented in the comment. rejected |
| 7 | `challenge` not a secret key word | medium | CLAUDE.md forbids logging it; patched |
| 8 | Spec unfinished | low | Finalized here |
| 9 | Sprint item still open | false | Closed after merge per the owner workflow |
| 10 | `docs/testing.md` vague, no host-check record | low | Patched: exact rule and checks |
| 11 | Scan scope (`src/test`, `.js` files) implicit | low | Header states it; `src` has no `.js` sources |

