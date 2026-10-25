# Deferred work

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-production-project-skeleton.md`
  summary: Document and wire the local release-signing procedure (keystore outside the repo, zipalign/apksigner or a gitignored keystore.properties) and verify a signed release installs and appears in the TV launcher.
  evidence: build.gradle has no signingConfigs and README/testing.md say "the owner signs locally" without a procedure; Story 9.1 owns release signing.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-production-project-skeleton.md`
  summary: Decide edgeToEdgeEnabled for TV and apply the DESIGN.md safe area (48/27 dp) in the shell.
  evidence: edgeToEdgeEnabled=true is kept from the 0.87 template without a TV rationale; overscan impact is unverified (maybe-false, would be medium). Settle on the device in Story 2.4.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-production-project-skeleton.md`
  summary: Re-evaluate the test-renderer react-reconciler 0.33.0 override when React Native Testing Library is added.
  evidence: test-renderer@1.3.1 expects react-reconciler ~0.34 (React ^19.3) while RN 0.87.1 pins React 19.2.3.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-production-project-skeleton.md`
  summary: Limit debug ABIs locally (e.g. arm64-v8a for the Chromecast) to cut the ~119 MB debug APK, and trim template leftovers in android/ (JSC flavor block, stale proguard comment).
  evidence: reactNativeArchitectures lists four ABIs; template comments remain. Cosmetic; no functional impact.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-library-compatibility-on-the-device.md`
  summary: Configure release builds for the 32-bit Chromecast (abiFilters armeabi-v7a, or ABI splits/AAB) so the APK fits the ~350 MB free storage.
  evidence: The 4-ABI debug APK (170 MB) failed with INSTALL_FAILED_INSUFFICIENT_STORAGE; only a manual -PreactNativeArchitectures flag is used today. Story 9.1.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-library-compatibility-on-the-device.md`
  summary: Add a Metro bundle check (react-native bundle --platform android --dev false) to CI once zod is a production dependency.
  evidence: Jest loads zod's CJS build, so removing @babel/plugin-transform-export-namespace-from would pass tests but break the release bundle.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-spike-phone-sign-in-and-token-persistence.md`
  summary: Production phone input must accept all valid E.164 lengths (at least 8 digits including the country code; the spike required 11-15) and trim whitespace before the "+".
  evidence: The spike's normalizePhone rejects valid numbers such as +47 plus 8 digits; Story 2.2.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-spike-phone-sign-in-and-token-persistence.md`
  summary: Production contract fixtures for phone auth must mirror the live shapes (sentTransport "gate", expiresIn 604800, 64-char opaque non-JWT tokens, invalid_sms_code, sms_gate_ratelimit).
  evidence: The spike flow test used sms/300000/JWT-like/invalid_code values; Story 1.5 produces the fixtures.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-spike-phone-sign-in-and-token-persistence.md`
  summary: Flow tests for restoring a stored session (mount read, E1 with the stored access token, malformed value) and for device_id memoization/retry when this logic moves into production auth/platform code.
  evidence: Spike tests start from an empty store, and spikeNative.getInstallId is fully mocked.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-spike-refresh-and-logout-behavior.md`
  summary: Settle the device_id dependency and refresh-token reuse detection on a fresh session (refresh with a foreign device_id first, then with the real one), and test a real network drop during refresh.
  evidence: The Story 1.4 device_id result is ambiguous because a rotated-out token had been reused just before; real network loss was only simulated. Needs owner approval; proposed at the start of Story 1.5 after re-sign-in.
  note: Story 1.5 (owner decision 2026-10-25) closed the device_id and reuse-detection parts as not needed for production, with no requests (api-contract §2.3/§8). Only the real network drop during refresh remains open.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-spike-refresh-and-logout-behavior.md`
  summary: Second-account isolation check for S10 (sign in as a different Boosty account after logout and confirm that no data from the first account is visible).
  evidence: No second account was available; required by CLAUDE.md (no cross-account leakage). Story 2.8 covers it in production.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-spike-refresh-and-logout-behavior.md`
  summary: Production refresh-coordinator tests: a late 401 after another caller's completed refresh (staggered timing), signOut/reload during an in-flight refresh, save failure on adopt, and expires_in edge values.
  evidence: The spike tests use uniform delays and sequential calls; requirements are listed in api-contract §2.3.
