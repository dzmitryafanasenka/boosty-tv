import type { Logger } from '../../services/logger';
import type { SessionCore } from './core';
import type { ValidateResult } from './types';

/**
 * Debug-only session hooks (ADR 0009, C14). The facade loads this module
 * with `__DEV__ ? require('./session/debug') : null` into a local binding,
 * so release bundles do not contain it (`__tests__/releaseBundle.test.js`).
 */
export type DebugHooks = {
  debugCorruptAccessToken: () => Promise<ValidateResult>;
  debugExpireInMemory: () => void;
};

/** Same length, every alphanumeric character changed. */
function corrupt(token: string): string {
  return token.replace(/[A-Za-z0-9]/g, c =>
    /\d/.test(c) ? String((Number(c) + 5) % 10) : c === 'x' || c === 'X' ? 'q' : 'x',
  );
}

export function createDebugHooks({
  core,
  validate,
  logger,
}: {
  core: SessionCore;
  validate: () => Promise<ValidateResult>;
  logger: Logger;
}): DebugHooks {
  return {
    debugCorruptAccessToken() {
      const session = core.current();
      if (core.getStatus() === 'signedIn' && session) {
        core.replaceAccessToken(corrupt(session.accessToken));
        logger.info('session', 'debug: access token corrupted in memory');
      }
      return validate();
    },
    debugExpireInMemory() {
      if (core.getStatus() === 'signedIn' && core.current()) {
        // As the refresh host's `expire`, minus the marker write: storage
        // is untouched.
        core.bumpGeneration();
        logger.info('session', 'debug: expired in memory');
        core.markExpired();
      }
    },
  };
}
