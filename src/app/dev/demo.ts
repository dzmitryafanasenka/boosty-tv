import {
  createAuthApiClient,
  createHttpClient,
  createSessionManager,
  type SessionManager,
} from '../../shared/api';
import { createFixtureTransport } from '../../shared/api/fixtureTransport';
import type { ReadResult, SecureStore } from '../../shared/platform/secureStore';

/**
 * Debug builds only (Story 2.5 demo mode; required under `__DEV__ &&
 * DEMO_MODE`, so release bundles never contain it). A SessionManager over
 * `FixtureTransport` and in-memory stores: a synthetic session, E1 answers
 * 200 with a synthetic id, confirm answers synthetic tokens (so a demo
 * sign-in on A5 lands; the id differs from the stored `demo`, so it runs the
 * account-switch hook, Story 2.8), every other request a 404. The keychain
 * is never touched, so the owner's stored session survives a demo run.
 */

const DEMO_SESSION = JSON.stringify({
  v: 1,
  accessToken: 'demo-access-token',
  refreshToken: 'demo-refresh-token',
  // Far ahead: the demo never refreshes.
  expiresAt: Date.now() + 365 * 24 * 3600 * 1000,
  accountId: 'demo',
});

function memoryStore(initial: string | null): SecureStore {
  let value = initial;
  return {
    read: async (): Promise<ReadResult> =>
      value === null ? { kind: 'empty' } : { kind: 'value', value },
    write: async next => {
      value = next;
    },
    clear: async () => {
      value = null;
    },
  };
}

export function createDemoSessionManager(): SessionManager {
  const transport = createFixtureTransport(request => {
    switch (request.path) {
      case '/v1/user/current':
        return { status: 200, body: { id: 1001 }, delayMs: 300 };
      case '/auth/phone/verification_code/confirm':
        return {
          status: 200,
          body: {
            access_token: 'demo-access-token-2',
            refresh_token: 'demo-refresh-token-2',
            expires_in: 2592000,
          },
        };
      default:
        return { status: 404, body: { error: 'not_found' } };
    }
  });
  return createSessionManager({
    authApi: createAuthApiClient({ transport, getDeviceId: async () => 'demo-device' }),
    createHttp: tokens => createHttpClient({ transport, tokens }),
    sessionStore: memoryStore(DEMO_SESSION),
    phoneStore: memoryStore(null),
  });
}
