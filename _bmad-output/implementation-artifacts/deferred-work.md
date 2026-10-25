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
