# Continue history in the launcher: Watch Next vs. an app channel — spike (Story 12.4)

Date: 2026-11-03. Scope: device spike only. The temporary probe (`TEMP124`) was removed before the commit; nothing of it ships.

Question: can the owner's launcher, Aero TV (`tv.aero.home`), show Boosty TV's «Продолжить просмотр» history, and through which system API?

Labels: **LIVE** = observed on the pinned Chromecast with Google TV 4K (Android 14, API 34) in this spike; **INFERRED** = reasoning from LIVE facts.

Status: our improvement (epic 12), not a parity obligation. Google TV certification for its own row is not a goal.

## Verdict

- **Watch Next: no-go for Aero.** A `WatchNextPrograms` row was inserted and confirmed in the provider, but Aero shows «Нет карточек · Boosty TV — Приложение пока не передало карточки для главного экрана» (LIVE).
- **App preview channel: go, with one open point.** A preview channel (`TvContract.Channels`, `TYPE_PREVIEW`) with one `PreviewPrograms` row appears in Aero's «Для тебя» area when the Boosty TV tile is focused («Boosty TV · Все каналы приложения»), and OK on the card opens Boosty TV (LIVE). This is how Aero shows other apps too: the Кинопоиск tile shows its channel «Популярное» with posters, title and description (LIVE). Open point: after the channel was deleted Aero kept showing the card, so whether updating or emptying a live channel refreshes Aero's copy is **UNVERIFIED**; Story 12.5 starts with that device check, because account isolation depends on it.
- **Stock launcher:** it runs in apps-only mode on this TV (no recommendation or continue rows), so neither API is visible there (LIVE). Not a goal.
- A follow-up story is added: Story 12.5 (FR67) publishes the Continue history as an app channel.
- The earlier assumption (planning, 2026-11-02) that Aero's «continue» row shows other apps' Watch Next programs is not confirmed: what Aero showed for other apps here were their preview channels. Not tested: a Watch Next row together with a browsable channel, and `requestChannelBrowsable`.

## Method (LIVE)

A temporary `BroadcastReceiver` in the release-like build, guarded by `android.permission.DUMP` (only `adb shell` could call it), wrote synthetic rows through the platform `android.media.tv.TvContract` (the API `androidx.tvprovider` wraps):

1. `op=insert`: one `WatchNextPrograms` row (`TYPE_CLIP`, `WATCH_NEXT_TYPE_CONTINUE`, title «Boosty TV — проба Watch Next», poster `android.resource://…/drawable/tv_banner`, 16:9, duration 60 min, position 20 min, engagement time now, intent URI to `MainActivity`).
2. `op=channel`: one `Channels` row (`TYPE_PREVIEW`, «Продолжить просмотр», app link to `MainActivity`) and one `PreviewPrograms` row in it (the same fields, titled «Boosty TV — проба канала», description «Синтетическая карточка для проверки лаунчера»).
3. `op=query` / `op=delete`: our own rows only (the provider returns and deletes only the caller's rows).

Commands: `adb shell am broadcast -n io.github.dzmitryafanasenka.boostytv/.WatchNextProbeReceiver --es op <insert|channel|query|delete>`, `adb logcat -s TEMP124`. Versions: Aero TV `tv.aero.home` 1.32 (versionCode 44); stock launcher `com.google.android.apps.tv.launcherx` as the default HOME; Boosty TV release-like build of branch `story/12-4-spike-watch-next-channel` on top of `9efea47` (still 1.2.0 / 10200). The probe's code is described here and in the spec; it is not kept in the repository.

No account data, no Boosty URLs and no signed values were written; logs had counts and row ids only. Before each key batch the foreground activity was checked; in Aero only D-pad moves were sent, plus one OK on our own synthetic card.

## Findings (LIVE)

| Check | Result |
|---|---|
| Write permission | Without `com.android.providers.tv.permission.WRITE_EPG_DATA` the insert fails with `SecurityException`. The permission is `prot=normal` on this device (granted at install, no prompt) |
| Watch Next row | Inserted (`query count=1`); Aero shows no card for Boosty TV, also after a force-stop and restart of Aero |
| Preview channel | Inserted with `browsable=0` (we did not call `requestChannelBrowsable`, which shows a system dialog). Aero still shows the card |
| Card content in Aero | Poster, title and short description are shown; no progress bar was visible for `LAST_PLAYBACK_POSITION_MILLIS` |
| OK on the card | Opens Boosty TV (`MainActivity` resumed) |
| Delete | `delete watchNext=1 channels=1`; afterwards `channels count=0`, `query count=0`. Deleting the channel removes its programs |
| Aero after delete | **The card stays visible** in Aero, also after a force-stop and restart of Aero: Aero keeps its own copy. We did not clear Aero's data |

Residual: the synthetic card «Boosty TV — проба канала» stays in Aero's cache on the owner's TV. It opens Boosty TV and contains no data. It should be replaced when Story 12.5 publishes the real channel; otherwise clearing Aero TV's cache in Android settings removes it (the owner's choice).

Screenshots (cropped to the card area; the Aero labels «Для тебя · Boosty TV · Все каналы приложения» are outside the crop and were read from the full-screen capture):

- Watch Next only: `img/12-4-aero-watch-next-no-cards.png`
- Preview channel card: `img/12-4-aero-preview-channel-card.png`

## Implications for the follow-up (INFERRED)

- Use one app channel «Продолжить просмотр» and keep it: update or replace its programs when the Continue history changes. Deleting the channel does not clear Aero's copy, so «Очистить всё» and sign-out should leave an up-to-date (possibly empty) channel rather than rely on deletion, and Aero's caching must be re-checked on the device.
- Programs carry no account data beyond what the viewer sees on the card: the video title and a poster. The poster must not be a signed URL (the feed's `defaultPreview` carries a CDN token, see the Continue row decision); use a token-free image or the app banner.
- The intent URI needs a deep link into the Player or Пост with a cold-start session check, and Back behaviour agreed with the owner.
- AccountScope reset (sign-out, account switch) must empty the channel.
- The permission `WRITE_EPG_DATA` must be added to the manifest in Story 12.5; minSdk stays 24 and the channel code runs only on API 26+.
- Sync on discrete Continue events (pause, exit, removal, «Очистить всё», finished), not on every periodic progress write; cap the channel at the Continue row's size.
