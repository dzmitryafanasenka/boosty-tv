---
title: "Product Brief: Boosty TV"
status: final
created: 2026-10-25
updated: 2026-10-25
---

# Product Brief: Boosty TV

_Working title. Not approved branding._

> Superseded in part: Apple TV (tvOS) is out of scope (owner decision 2026-10-27).

## Executive Summary

Boosty TV is an unofficial Boosty client for the television, operated entirely with a TV remote. It is built for one household: the owner and their family, sharing one Boosty account on a Chromecast with Google TV 4K. Android TV comes first, and Apple TV follows later.

Today the only custom Boosty client for Android TV is BoostBuddy. It works, but it was built on a mobile-first base and adapted to TV later. Navigating it with a remote is very inconvenient, and it signs the user out every few days. With phone-and-code sign-in, every logout means typing a code on the TV again. Boosty TV keeps BoostBuddy's capabilities, except comments, but is designed for the remote from the start, and keeps the session alive.

Success is personal and simple: the owner stops opening BoostBuddy at all.

## The Problem

- **Remote navigation is painful.** BoostBuddy's focus movement, lists and dialogs feel like a phone app driven by arrow keys. Its website sign-in even needed an on-screen "virtual cursor" to get through with a remote.
- **The session does not last.** The user is signed out every few days and has to sign in again on the TV. For a shared family device this is the most visible failure. Likely causes are in token-expiry handling and refresh (see `docs/feature-parity.md` AUTH-05 and `docs/api-contract.md` §2.3). They are unverified so far.
- **The alternatives are worse.** The Boosty website in a TV browser and casting from a phone both depend on a phone or a pointer. `[ASSUMPTION]` The owner has rejected them for daily use.

## The Solution

A native TV app (React Native for TV, no WebView UI and no own backend) that does one thing well: it gets the family from switching on the TV to watching subscribed Boosty content in a few remote presses, and it stays signed in.

- **Sign in once.** Sign in with a phone number and a one-time code, entered with the remote and the system keyboard. Secrets are stored in Android Keystore. Token refresh is single-flight and silent, so the household sees no sign-in screen for weeks, not days.
- **Remote-first browsing.** Subscriptions, the feed and author pages, with clear focus. Focus is restored when the user returns from a post or the player. Long lists stay smooth.
- **Video first.** Video uses the native player. It covers quality choice, speed and seeking, and resumes from the position stored on the Boosty server. When a signed link expires, playback recovers without restarting.
- **Everything else BoostBuddy can do, except comments.** That means text and images, audio, files and links (as QR codes), polls, live streams, search, filters and tags. The events list is our addition. See `docs/feature-parity.md` for the full list with evidence.

## What Makes This Different

No moat is needed for a one-household audience. The difference from BoostBuddy is execution:

1. **TV interaction designed from the start**: focus, Back behavior, overlays and media keys.
2. **A session that survives**: correct expiry handling, single-flight refresh, and distinct "session expired" and "no access" states instead of silent logouts.

## Who This Serves

- **Primary: the owner.** A technically fluent person who watches Boosty subscriptions on the TV and wants it to be effortless.
- **Secondary: family members** using the same account and device. They are not technical. They need the app to "just open and play", with no codes and no confusing screens. `[ASSUMPTION]` They mostly watch video and rarely use search or filters.

There is one Boosty account per device and no profiles.

## Success Criteria

| Signal | Target |
|---|---|
| Owner uses Boosty TV instead of BoostBuddy | BoostBuddy is not opened for 4 consecutive weeks `[ASSUMPTION: period]` |
| Session longevity | No forced re-login for at least 30 days of normal use on the test device `[ASSUMPTION: threshold, bounded by Boosty refresh-token lifetime, to be measured in spike S4]` |
| Time to video | From a cold app start, a subscribed video is playing in ≤ 5 remote presses `[ASSUMPTION]` |
| Resume | Re-opening a video resumes within a few seconds of where it was left, also after sleep or a reboot |
| Remote-only | Every flow, including sign-in, works with D-pad, OK, Back and media keys only |

## Scope

**In (Android TV, phased per CLAUDE.md):**
- Phase 0 is a spike that proves sign-in, secure persistence, refresh, entitled playback and resume on the real device.
- Phase 1 is a vertical slice: sign in → subscriptions/feed → post → video → resume → back with focus restored.
- Phase 2 completes parity with BoostBuddy minus comments, plus events.
- Phase 3 is polish and a release build installed on the family TV.

**Out:**
- comments;
- video download;
- light theme;
- multiple accounts or profiles;
- donations, analytics and tracking;
- an in-app APK installer (manual install or our own channel);
- a QR or companion sign-in;
- any own backend;
- the Boosty website features BoostBuddy does not have.

## Risks and Unknowns

- The Boosty API is unofficial and can change.
- Phone auth may require a captcha on TV. That would be a release blocker.
- Signed media URL lifetimes are unknown.
- How long Boosty refresh tokens live is unknown. It caps the session-longevity target.

## Vision

A calm, dependable family "Boosty channel" on the TV. It is switched on, it is already signed in, and it shows what is new from the authors the family supports. Its portable core is later reused for an Apple TV version. Because this is a personal project, success does not mean growth; it means the app quietly stops needing attention.
