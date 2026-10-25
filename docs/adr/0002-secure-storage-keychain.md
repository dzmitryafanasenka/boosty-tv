# ADR 0002: Secure storage with react-native-keychain plus corruption recovery

- Status: accepted (pending verification in spike S3)
- Date: 2026-10-25

## Context
Tokens and the stored phone must live in Keystore-backed storage (CLAUDE.md). The candidates were:
- react-native-keychain 10.0.0: Keystore AES-GCM by default. Last released 2025-03. Has open Android DataStore issues (#820, #801, #818).
- expo-secure-store: requires Expo, which needs owner approval.
- react-native-encrypted-storage: abandoned.
- An own Kotlin module.

## Decision
Use react-native-keychain behind the `SecureStore` port. The port treats storage-corruption errors as unrecoverable for the stored data: it wipes the store and moves the session to `signedOut` with a «Войдите снова» message. It never crashes or keeps failing.

## Consequences
If spike S3 shows instability, replace the adapter with an own Keystore module. Callers do not change, because the port isolates the implementation. The source is AD-2 and AD-3 in the architecture spine.
