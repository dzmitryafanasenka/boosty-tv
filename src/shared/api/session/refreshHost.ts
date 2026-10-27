import type { Logger } from '../../services/logger';
import type { RefreshHost } from '../refreshCoordinator';
import { encode, type ExpiryMarker, type StoredSession } from './codec';
import type { SessionCore } from './core';

/**
 * The refresh coordinator's view of the session (ADR 0009, C5). The
 * coordinator persists before it adopts; this adapter keeps the guards: no
 * session while sign-out runs, a stale generation drops the result, and the
 * `persist` precondition is evaluated inside the queued write.
 *
 * `expire` is the only production entry into `expired` from a live session
 * (refresh 400 `invalid_grant`): the stored session is replaced by the
 * token-free expiry marker, the phone stays for re-login.
 */
export function createRefreshHost(core: SessionCore, logger: Logger): RefreshHost<StoredSession> {
  return {
    current: () => {
      const session = core.current();
      return core.getStatus() === 'signedIn' && session && !core.isSigningOut()
        ? { session, generation: core.generation() }
        : null;
    },
    isExpired: () => core.getStatus() === 'expired',
    isCurrent: g => core.isCurrent(g),
    persist: (next, g) =>
      core.writeSessionIf(next, () => core.isCurrent(g) && !core.isSigningOut()),
    adopt: (next, g) => core.adoptRefreshed(next, g),
    expire(g) {
      if (!core.isCurrent(g) || core.getStatus() !== 'signedIn') {
        logger.info('session', 'late rejection dropped');
        return false;
      }
      // Nothing further is sent with these tokens; the stored session is
      // replaced by the expiry marker (the phone stays for re-login). A
      // failed write is logged and does not change the status.
      const accountId = core.markExpired();
      if (accountId) {
        const marker: ExpiryMarker = { v: 1, expired: true, accountId };
        core.writeSession(encode(marker)).catch(() => {
          logger.error('session', 'expiry marker not saved');
        });
      }
      return true;
    },
  };
}
