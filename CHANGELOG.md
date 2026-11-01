# Changelog

All notable changes to Boosty TV, an unofficial Boosty client for Android TV / Google TV.
Versions follow `MAJOR.MINOR.PATCH`; each release is tagged `v{version}` on GitHub Releases.
The Russian version of this file is [CHANGELOG.ru.md](CHANGELOG.ru.md); both list the same versions.

## [0.9.0] - 2026-11-01

First signed release for testing on the family TV. `1.0.0` is reserved for the owner's acceptance.

### Added
- Sign-in with a phone number and a one-time code; the session survives restarts and refreshes itself. Quick re-login after expiry, sign-out and account switch without data leaks.
- Home feed of subscriptions with refresh, a «Continue watching» row, and filters by access, period and tags.
- Subscriptions grid with the «My blog» tile, author pages with search and filters, and search across subscriptions.
- Post screen: rich text, emoji, images, links, files and external videos via QR, locked posts.
- Video player: quality and speed selection, saved progress and resume, recovery from expired links and playback errors, sleep and audio focus handling, optional system video player.
- Inline audio in posts.
- Polls: single and multiple choice, voting and retracting.
- Live streams on author pages: playback, likes and sharing via QR; the events list.
- Hidden diagnostics for testing (log capture).
- Final launcher banner and adaptive icon.

### Notes
- Comments are intentionally not supported.
- Installing over an earlier test build signed with a different key fails; uninstall it once (sign in again; local progress is lost). Later releases install over this one and keep the session.
