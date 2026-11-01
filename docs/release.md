# Release

How the owner builds, signs, verifies, installs and publishes a Boosty TV release
(Story 9.1, AD-16). CI never signs: it builds an unsigned release only.

Every command block below runs from the repository root.

## Versioning

- `versionName` is `MAJOR.MINOR.PATCH` (`def appVersionName` in `android/app/build.gradle`).
  MINOR and PATCH are 0–99.
- `versionCode` is derived: `MAJOR*10000 + MINOR*100 + PATCH` (`0.9.0` → `900`). A higher
  version always has a higher code, so it installs over the previous release.
- A `versionName` in any other format fails the build at configuration time. CI checks the
  derived `versionCode` of the unsigned release APK.
- The tag is `v{versionName}` (for example `v0.9.0`). Story 9.2 compares the latest tag with
  the installed `versionName`, so keep this format.
- `0.9.0` is the first release. `1.0.0` is reserved for the owner's acceptance (Story 9.5).
- «Версия» in Настройки shows the native `versionName`.

## One-time setup (owner, outside the repository)

Create the release keystore once, outside the repository. It is a PKCS12 file; for PKCS12
the key password equals the store password.

```sh
mkdir -p ~/.keystores && chmod 700 ~/.keystores
keytool -genkeypair -v -storetype PKCS12 \
  -keystore ~/.keystores/boosty-tv-release.p12 \
  -alias boosty-tv -keyalg RSA -keysize 4096 -validity 10000
chmod 600 ~/.keystores/boosty-tv-release.p12
```

Add the four properties to `~/.gradle/gradle.properties` (never to the repository's
`android/gradle.properties`). `BOOSTYTV_RELEASE_STORE_FILE` must be an absolute path to the
existing file (`~` is not expanded).

```properties
BOOSTYTV_RELEASE_STORE_FILE=/Users/<you>/.keystores/boosty-tv-release.p12
BOOSTYTV_RELEASE_STORE_PASSWORD=<store password>
BOOSTYTV_RELEASE_KEY_ALIAS=boosty-tv
BOOSTYTV_RELEASE_KEY_PASSWORD=<the same store password>
```

Signing rules in `android/app/build.gradle`:

| Properties set | Result |
|---|---|
| all four | `app-release.apk`, signed with the release key |
| none (CI), or all blank | `app-release-unsigned.apk`, as before |
| one to three | the build fails before packaging (`checkReleaseSigning`); the message names the missing keys, never values |
| all four, but the store file is relative, uses `~` or does not exist | the build fails before packaging; the message names `BOOSTYTV_RELEASE_STORE_FILE`, never the path |

A blank (empty or whitespace-only) value counts as not set. `checkDemoModeOff` still blocks
the release bundle while `DEMO_MODE` is on.

## Backup and moving to another machine

Losing the key or its password means no later release can install over the installed one:
every TV would need an uninstall (sign-in and local progress lost).

- Back up the `.p12` file and its password in two independent places:
  - a password manager entry with the password and the `.p12` file attached;
  - an encrypted offline copy (for example an encrypted disk image on a USB drive) whose
    password is not stored next to it.
- Never put the file or the password in git, in an unencrypted cloud folder, in chat or in
  the release notes.
- Record the certificate SHA-256 next to the backup. It is not secret:

  ```sh
  keytool -list -v -storetype PKCS12 -keystore ~/.keystores/boosty-tv-release.p12 \
    -alias boosty-tv | grep SHA256
  ```

Restore on a new machine:

```sh
mkdir -p ~/.keystores && chmod 700 ~/.keystores
cp /path/to/backup/boosty-tv-release.p12 ~/.keystores/
chmod 600 ~/.keystores/boosty-tv-release.p12
```

Then add the four lines to `~/.gradle/gradle.properties` with the new absolute path, build,
and check that `apksigner verify --print-certs` (below) shows the same certificate SHA-256
as recorded.

## Build

1. Bump `appVersionName` in `android/app/build.gradle`.
2. Add the version to both `CHANGELOG.md` and `CHANGELOG.ru.md` (same versions in both).
3. Run the checks and the build:

```sh
npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures
(cd android && ./gradlew clean assembleRelease)
# output: android/app/build/outputs/apk/release/app-release.apk
```

All four ABIs are built by default. `(cd android && ./gradlew assembleRelease
-PreactNativeArchitectures=armeabi-v7a)` builds only the Chromecast with Google TV ABI,
which is enough for a device check but not for a public release.

## Verify the signature

```sh
BT="$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)"
APK=android/app/build/outputs/apk/release/app-release.apk
"$BT/apksigner" verify --verbose --print-certs "$APK"
"$BT/aapt" dump badging "$APK" | grep -E '^package:|^native-code:'
```

Expected: `Verifies`, `Verified using v2 scheme ... true`, the release certificate DN
(not `CN=Android Debug`), the recorded certificate SHA-256, `versionName` / `versionCode` as
set, and (for a public release) all four ABIs in `native-code`.

The certificate DN is public in every APK signed with this key. The owner accepted their
name and city in it (2026-11-01).

## Install and update

```sh
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

- **Over a previous release (same key, higher `versionCode`):** the install succeeds and keeps
  the session and local progress.
- **Key switch (one time, approved 2026-11-01):** a build signed with the SDK debug key cannot
  be updated by the release key; `adb install -r` fails with
  `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Uninstall it once, then install:
  `adb uninstall io.github.dzmitryafanasenka.boostytv`. This signs the account out and loses
  local progress and «Продолжить».
- After the switch, agent device builds are also `assembleRelease` signed by Gradle with the
  owner's key from `~/.gradle/gradle.properties`, so they install over the family build and
  back. The agent never sees the passwords. A branch build replaces the family build until
  the next release is installed.
- Check the Google TV home: the banner and «Boosty TV» in the apps row, and «Версия» in
  Настройки.

## Publish on GitHub Releases

Only after the owner's explicit OK on the final notes and the APK. The public APK is built
from the `main` commit that gets the tag.

```sh
git switch main && git pull --ff-only
test -z "$(git status --porcelain)" || { echo "working tree not clean"; exit 1; }
npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run check:fixtures
(cd android && ./gradlew clean assembleRelease)

VERSION=0.9.0
OUT="$(mktemp -d)"
cp android/app/build/outputs/apk/release/app-release.apk "$OUT/boosty-tv-$VERSION.apk"
shasum -a 256 "$OUT/boosty-tv-$VERSION.apk"
# Write "$OUT/release-notes.md" (format below), then:
git tag -a "v$VERSION" -m "Boosty TV $VERSION"
git push origin "v$VERSION"
gh release create "v$VERSION" "$OUT/boosty-tv-$VERSION.apk" \
  --title "Boosty TV $VERSION" --notes-file "$OUT/release-notes.md"
rm -rf "$OUT"
```

`release-notes.md` format (Russian first, so the TV in Story 9.2 can show the part before
the first `---`; the blank lines around `---` keep GitHub from turning the Russian text
above it into a heading):

```markdown
<the version's section from CHANGELOG.ru.md>

---

<the version's section from CHANGELOG.md>

APK SHA-256: <shasum -a 256 of the attached APK>
Signing certificate SHA-256: <from apksigner verify --print-certs>
```

## Secret checklist

Before tagging and before publishing:

- [ ] `git status --porcelain` is empty, and no keystore or build output is tracked:
      `git ls-files | grep -Ei '\.(jks|keystore|p12|pem|apk|aab|idsig)$'` prints nothing.
- [ ] `git grep -n 'BOOSTYTV_RELEASE_[A-Z_]*=' -- ':!*.md' ':!.github/workflows/ci.yml'`
      prints nothing (CI's partial-set check passes the dummy value `ci-dummy` on purpose).
- [ ] `npm run check:fixtures` passes.
- [ ] The release notes contain no account data, phone numbers, tokens, signed media URLs or
      log excerpts.
- [ ] The only asset is the signed APK; `apksigner` shows the release certificate with the
      recorded SHA-256.
- [ ] `aapt dump badging` of the APK lists all four ABIs in `native-code`
      (`armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`).
- [ ] The APK was built with `DEMO_MODE = false` (the build enforces it).
