import { createSessionManager, type SessionManager } from '../shared/api';
import { defineAccountScoped } from '../shared/account';
import { setQualityPreferenceKeyValueStore } from '../features/player';
import { setProgressKeyValueStore } from '../shared/services/progress';
import { DEMO_MODE } from './appConfig';
import type * as DemoModule from './dev/demo';

/**
 * Debug-only demo mode (Story 2.5, `appConfig.DEMO_MODE`): `__DEV__` is a
 * constant in Metro bundles, so in release the require is folded away and
 * the module is not bundled.
 */
const demo: typeof DemoModule | null =
  __DEV__ && DEMO_MODE ? require('./dev/demo') : null;

/**
 * The demo is running (the «ДЕМО» badge). `demo` itself stays a local
 * binding: an exported one is not folded away by the release minifier, and
 * the demo factory would be bundled (__tests__/releaseBundle.test.js).
 */
export const DEMO_ACTIVE = demo !== null;

/**
 * The session the app runs on, and its only owner: the real one (the
 * keychain and the real clients), or the demo's in-memory one. Features and
 * shared code never import a session singleton; they get what they need
 * from this one through props (Epic 2 retro, items 1–2).
 */
export const session: SessionManager = demo
  ? demo.createDemoSessionManager()
  : createSessionManager();

// The demo keeps its progress (Story 4.2 review) and its quality preference
// (Story 4.3) in memory: the owner's real `boostytv-account` and
// `boostytv-device` databases are never read, written or cleared.
if (demo) {
  setProgressKeyValueStore(demo.createDemoKeyValueStore());
  setQualityPreferenceKeyValueStore(demo.createDemoKeyValueStore());
}

/**
 * The session store (AD-4), the AccountScope gate: SecureStore (the
 * phone, then the session or expiry marker), then memory, including the
 * account id and the previous account id. Declared here, not in
 * `shared/api`, because the app chooses which session it runs on (the demo
 * never touches SecureStore). Local only: no server revoke.
 */
export const sessionAccountStore = defineAccountScoped('session', () => session.signOut());
