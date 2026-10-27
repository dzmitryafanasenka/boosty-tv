import type { Logger } from '../../services/logger';
import { isAppError, type AppErrorKind } from '../appError';
import { userCurrentSchema } from '../dto/userCurrent';
import type { HttpClient } from '../httpClient';
import type { SessionCore } from './core';
import { CURRENT_USER_PATH, type ValidateResult } from './types';

export type SessionLifecycle = {
  /** E1 session check, single-flight. Never rejects; never moves focus. */
  validate(): Promise<ValidateResult>;
  /** Runs `validate()` on every change to `active`; null otherwise. */
  onAppStateChange(state: string): Promise<ValidateResult> | null;
};

/**
 * E1 validation (ADR 0009, C10): `GET /v1/user/current` over the content
 * client, at cold start and on every return to the foreground, because
 * content endpoints answer 200 as anonymous for a bad token (api-contract
 * §7) and never trigger the 401 path. Never logs the E1 body.
 */
export function createLifecycle({
  core,
  http,
  logger,
}: {
  core: SessionCore;
  http: HttpClient;
  logger: Logger;
}): SessionLifecycle {
  /**
   * The running E1, keyed by the session generation it started in: a
   * validate after a sign-in, a sign-out or a restore (the debug expiry
   * also bumps the generation) sends a new E1 rather than reusing a result
   * about the previous session. A refresh 400 `invalid_grant` does not bump
   * it.
   */
  let validating: { generation: number; promise: Promise<ValidateResult> } | null = null;
  let appState = 'active';

  async function doValidate(): Promise<ValidateResult> {
    if (core.getStatus() !== 'signedIn') {
      return { kind: 'skipped' };
    }
    try {
      await http.get(CURRENT_USER_PATH, userCurrentSchema);
      logger.info('session', 'E1 ok');
      return { kind: 'ok' };
    } catch (error) {
      const kind: AppErrorKind = isAppError(error) ? error.kind : 'Client';
      logger.warn('session', 'E1 failed', { kind });
      return kind === 'SessionExpired' ? { kind: 'expired' } : { kind: 'failed', error: kind };
    }
  }

  function validate(): Promise<ValidateResult> {
    const generation = core.generation();
    if (validating && validating.generation === generation) {
      return validating.promise;
    }
    const promise = doValidate().finally(() => {
      if (validating?.promise === promise) {
        validating = null;
      }
    });
    validating = { generation, promise };
    return promise;
  }

  return {
    validate,
    onAppStateChange(next) {
      const previous = appState;
      appState = next;
      return next === 'active' && previous !== 'active' ? validate() : null;
    },
  };
}
