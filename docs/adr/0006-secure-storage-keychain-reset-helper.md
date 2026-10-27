# ADR 0006: Keep react-native-keychain and add a native storage-reset helper

- Status: accepted by the owner (2026-10-25), with a verification gate. If the gate fails, the own Keystore module described under Alternatives applies. Gate: **passed** on the device (2026-10-25, see "Gate result").
- Date: 2026-10-25
- Superseded in part: Apple TV (tvOS) is out of scope (owner decision 2026-10-27).
- Amends: [ADR 0002](0002-secure-storage-keychain.md). The library choice stays; the corruption-recovery mechanism is added.

## Context
Story 1.2 checked react-native-keychain 10.0.0 on the Chromecast with Google TV 4K (Android TV 14). Results are in `docs/testing.md` (Story 1.2).

**Passed:**
- save and read (`KeystoreAESGCM_NoAuth` storage);
- persistence across force-stop, cold start and reinstall over the same signing key;
- ciphertext corruption. When the stored value is corrupted, `getGenericPassword` rejects with `CryptoFailedException`, `resetGenericPassword` succeeds, and the adapter returns «signed-out».

**Failed:** file-level corruption. When `files/datastore/RN_KEYCHAIN.preferences_pb` is overwritten with random bytes:
- every call (`get`, `set` and `reset`) rejects with `androidx.datastore.core.CorruptionException`;
- the adapter shows «signed-out» but can never save again until the app data is cleared, which is a permanent sign-in dead end (AD-3);
- the library has no API that deletes the file.

`getSecurityLevel()` reports `SECURE_SOFTWARE` on this device.

## Decision
Keep react-native-keychain behind the `SecureStore` port. Add a small native helper in `android/` that deletes the library's DataStore file. The helper is exposed through the `shared/platform/android` SecureStore adapter and does nothing else.

When any keychain call rejects with a storage/parse error (`CorruptionException`), the adapter:
1. calls the helper to delete the storage file;
2. calls `resetGenericPassword`;
3. reports «signed-out» («Войдите снова»).

There is no crash and no retry loop. No tokens, phone numbers or ciphertext are logged.

Error classification (CLAUDE.md: distinguish failures):
- **Storage unreadable** (`CorruptionException`): helper deletes the file, reset, «signed-out».
- **Stored value undecryptable** (`CryptoFailedException`, `KeyPermanentlyInvalidatedException`): reset, «signed-out».
- **Anything else** (for example a transient Keystore error right after boot): keep the stored data, report a recoverable storage error, and allow one retry. Do not sign out.

The spike's «any read error → wipe» was a deliberate simplification for the check screen only.

## Verification gate
Run the following in Story 1.3 (token persistence spike) or the SecureStore story, before production relies on this:

- After the file is overwritten with garbage, helper + reset leave the library able to `set` and `get` again **in the same process**. Also check after an app restart, if the in-process DataStore instance needs it.
- The full matrix still passes: kill, cold start, reboot, ciphertext corruption and file corruption.

If the library's in-process DataStore cannot recover without a restart, or the file name or location changes in a library update, switch to the alternative below with a new ADR. Callers do not change, because the `SecureStore` port isolates the implementation.

## Alternatives considered
- **Own Keystore module.** Kotlin code with an AES-GCM key in the Android Keystore and a deletable app-private store, behind the same port. This is the fallback if the gate fails. It gives full control, but the crypto code becomes ours.
- **expo-secure-store.** Needs Expo, which requires owner approval. Not tested.

## Consequences
- File-level recovery deletes the whole shared DataStore file, so it wipes **every** react-native-keychain entry, not only the failing service. Keep only data that may be lost together (session tokens, stored phone) in react-native-keychain.
- The production helper must check the result of `file.delete()` (not only `!exists()`), also remove a leftover `RN_KEYCHAIN.preferences_pb.tmp` if present, and report a non-sensitive failure reason. The spike helper did neither.
- The helper depends on the library's private file name (`RN_KEYCHAIN.preferences_pb`). Pin the library version, and re-run the gate on every keychain update.

## Gate result (Story 1.3, 2026-10-25): passed
Run on the pinned Chromecast with Google TV 4K, debug build (file edits need `run-as`), branch `spike/1-3-phone-auth`. Details are in `docs/testing.md` (Story 1.3).

- The helper is `KeychainStorageResetModule.deleteKeychainStorage()` (deletes only `files/datastore/RN_KEYCHAIN.preferences_pb`). On the JS side the rejection is `code=E_UNKNOWN_ERROR` with `androidx.datastore.core.CorruptionException` in the message; the classification matches on that class name.
- **File corruption: passed in the same process.** After the file was overwritten with random bytes, the first read rejected with `CorruptionException`; the helper deleted the file, reset succeeded, the result was «signed-out», and then `set` + `get` of a new value worked in the same process with no restart. The value also survived a later force-stop + cold start.
- Ciphertext corruption: passed (`CryptoFailedException` → reset → signed-out; save and read work afterwards).
- Transient non-corruption error (forced in the app): data kept, recoverable error, one retry, no sign-out.
- Kill and cold start: passed.
- Reboot: passed (release-like build, owner session with a real session). After `adb reboot` and a cold start, the stored session was read and E1 returned 200; `device_id` was unchanged.
- Result: the full matrix passes, so the own Keystore module alternative is not needed. Re-run the gate on every react-native-keychain update.
