import type { ReadResult } from '../../platform/secureStore';
import type { Logger } from '../../services/logger';
import { decodeSession } from './codec';
import type { SessionCore } from './core';
import type { RestoreResult } from './types';

export type SessionRestore = {
  /** Reads the stored session (again) and keeps it in memory. Never rejects. */
  restore(): Promise<RestoreResult>;
  /**
   * The stored phone while the status is `expired` (the A11 → A2 prefill),
   * else null. Never rejects. The read is not queued (ADR 0009, retro F7).
   */
  getExpiredPhone(): Promise<string | null>;
};

/**
 * Restore (ADR 0009, C7 and C12): the single-flight read of the stored
 * session at start, and the reads that serve the `expired` state. Only the
 * stored expiry marker means `expired`; a readable value that is neither a
 * session nor a marker is treated as corrupted: `signedOut` first, then a
 * best-effort queued clear (result `wiped`). Never logs a stored value.
 *
 * `restore()` runs at cold start only (App mount, the UI gated on `boot`).
 * It is not blocked while `signedIn` (a reload while a refresh is in flight
 * drops the late result through the generation). If the generation moves
 * while the read runs (a sign-in or a sign-out; the debug expiry also bumps
 * it, a refresh 400 `invalid_grant` does not), the read is stale: restore
 * writes no state and reports the current status.
 */
export function createRestore(core: SessionCore, logger: Logger): SessionRestore {
  let restoring: Promise<RestoreResult> | null = null;

  /** The current status as a restore result (a stale read changes nothing). */
  function currentResult(): RestoreResult {
    switch (core.getStatus()) {
      case 'signedIn':
        return { status: 'signedIn' };
      case 'expired':
        return { status: 'expired', reason: 'expired' };
      case 'signedOut':
        return { status: 'signedOut', reason: 'none' };
    }
  }

  async function readSession(): Promise<RestoreResult> {
    core.resetForRestore();
    const generation = core.generation();
    let result: ReadResult;
    try {
      result = await core.readSession();
    } catch (error) {
      if (core.isCurrent(generation)) {
        throw error;
      }
      result = { kind: 'unavailable' };
    }
    if (!core.isCurrent(generation)) {
      logger.info('session', 'restore read dropped: session changed');
      return currentResult();
    }
    if (result.kind === 'empty') {
      // No session, whatever the phone store holds: a kept phone alone may
      // come from a sign-in interrupted between the phone and session writes,
      // so only the expiry marker means `expired`.
      core.setStatus('signedOut');
      return { status: 'signedOut', reason: 'none' };
    }
    if (result.kind !== 'value') {
      core.setStatus('signedOut');
    }
    if (result.kind === 'wiped') {
      return { status: 'signedOut', reason: 'wiped' };
    }
    if (result.kind === 'unavailable') {
      return { status: 'signedOut', reason: 'unavailable' };
    }
    const decoded = decodeSession(result.value);
    if (!decoded) {
      // Readable but not a session: treat as corrupted, start clean.
      logger.warn('session', 'stored session unreadable; clearing');
      core.setStatus('signedOut');
      try {
        await core.clearSession();
      } catch {
        // Logged by the store; the next start tries again.
      }
      return { status: 'signedOut', reason: 'wiped' };
    }
    if (decoded.kind === 'expired') {
      core.restoreExpired(decoded.accountId);
      return { status: 'expired', reason: 'expired' };
    }
    // A past `expiresAt` is kept as is: the first request refreshes
    // proactively (and E1 runs right after the boot).
    core.restoreSignedIn(decoded.session);
    return { status: 'signedIn' };
  }

  return {
    restore() {
      if (!restoring) {
        restoring = readSession()
          .catch((): RestoreResult => {
            logger.error('session', 'restore failed');
            core.setStatus('signedOut');
            return { status: 'signedOut', reason: 'unavailable' };
          })
          .finally(() => {
            restoring = null;
          });
      }
      return restoring;
    },
    async getExpiredPhone() {
      if (core.getStatus() !== 'expired') {
        return null;
      }
      try {
        const phone = await core.readPhone();
        // The status may have changed while reading.
        return core.getStatus() === 'expired' && phone.kind === 'value' ? phone.value : null;
      } catch {
        return null;
      }
    },
  };
}
