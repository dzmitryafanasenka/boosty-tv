# Changelog

All notable changes to Boosty TV, an unofficial Boosty client for Android TV / Google TV.
Versions follow `MAJOR.MINOR.PATCH`; each release is tagged `v{version}` on GitHub Releases.
The Russian version of this file is [CHANGELOG.ru.md](CHANGELOG.ru.md); both list the same versions.

## [0.9.1] - 2026-11-01

Update check and in-app update.

### Added
- Update check: once a day and on OK on «Версия» in Settings, the app checks this project's GitHub Releases. When a newer version exists, a short notice appears and «Версия» shows the new version.
- In-app update: «Скачать и установить» downloads the APK for the TV's processor, verifies it and opens the Android installer. The first time, Android asks you to allow installs from this app. A QR to the release page is shown if something fails.
- Releases now include an APK per processor type (smaller download) and the universal APK.

### Notes
- Install 0.9.1 once by hand over 0.9.0 (0.9.0 has no update check). Later versions can be installed from the app; the session is kept.

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
