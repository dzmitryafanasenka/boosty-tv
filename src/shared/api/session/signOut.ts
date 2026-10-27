import type { Logger } from '../../services/logger';
import type { SessionCore } from './core';

/**
 * Local sign-out (ADR 0009, C11; no server call). Bumps the generation and
 * hides the session from the coordinator while the clears run. SecureStore
 * first, then memory (api-contract §2.3 «Logout order»); the phone before
 * the session entry, so a phone failure leaves the stored session and
 * memory exactly as they were. A failed clear rejects with the store's
 * error and keeps the bumped generation (deferred-work, Story 2.7).
 */
export function createSignOut(core: SessionCore, logger: Logger): () => Promise<void> {
  return async function signOut(): Promise<void> {
    core.bumpGeneration();
    core.beginSignOut();
    try {
      await core.clearPhone();
      await core.clearSession();
    } finally {
      core.endSignOut();
    }
    core.clearMemory();
    logger.info('session', 'signed out');
    core.setStatus('signedOut');
  };
}
