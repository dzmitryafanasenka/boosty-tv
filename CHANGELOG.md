# Changelog

All notable changes to Boosty TV, an unofficial Boosty client for Android TV / Google TV.
Versions follow `MAJOR.MINOR.PATCH`; each release is tagged `v{version}` on GitHub Releases.
The Russian version of this file is [CHANGELOG.ru.md](CHANGELOG.ru.md); both list the same versions.

## [Unreleased]

## [1.2.0] - 2026-11-02

Read-only comments and a full-screen image viewer (Epic 11).

### Added
- Comments (read-only, Story 11.2): a post now shows its comment count in the header («· 29 комментариев») and a «Комментарии» block at the bottom, newest first. «Показать ещё» loads older comments, replies appear under each comment, and «Ещё ответы» loads the rest of a thread. Deleted or hidden comments show a note. Nothing can be written, liked or deleted.
- Image viewer: OK on an image in a post opens it full screen; ← → move between the post's images, Back returns to the post. OK on a comment with images opens that comment's images the same way.

### Notes
- Install from the app on 1.1.0: Settings → «Версия» → «Скачать и установить». The session is kept.

## [1.1.0] - 2026-11-02

Chapters in the player (Epic 10, Story 10.1).

### Added
- Player: chapters from a post's timestamps («Таймкоды»). The timeline shows a mark for each timestamp of the playing video, and the current chapter's name appears next to the elapsed time (it follows the target while you seek). Press ↑ on the timeline to open the chapter list: ← → pick a chapter, OK jumps to it, Back or ↓ closes the list. On remotes with media keys, Next and Previous jump between chapters. Videos without timestamps, live streams and the system video player are unchanged.

### Notes
- Install from the app on 1.0.0: Settings → «Версия» → «Скачать и установить». The session is kept.

## [1.0.0] - 2026-11-01

First stable release: the owner accepted the Android release after the full device regression (Story 9.5). Same code as 0.9.2.

### Notes
- Install from the app on 0.9.x: Settings → «Версия» → «Скачать и установить». The session is kept.

## [0.9.2] - 2026-11-01

Release candidate for 1.0.0: fixes from the performance, visual and accessibility passes.

### Fixed
- Home: returning from Settings to Home with a «Continue watching» card remembered keeps that card focused and the row's header visible.
- Search and author pages: after the filter sheet's «Period» list, Back returns focus to the «Filters» chip.
- Text field placeholders are easier to read (higher contrast).

### Changed
- Smoother scrolling of the post grids on Home and author pages (fewer rows drawn ahead).
- Secondary text in a focused row or tile is lighter, so it stays readable on the focus surface.
- Text grows with the system font size up to 1.3×, so labels keep fitting their buttons.
- Screen reader labels read as full sentences (for example, poll options and setting descriptions).

### Notes
- Install from the app on 0.9.1: Settings → «Версия» → «Скачать и установить». The session is kept.

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
