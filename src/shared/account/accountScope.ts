import { logger as appLogger, type Logger } from '../services/logger';
import type { AccountScopedStore } from './defineAccountScoped';

/**
 * AccountScope (AD-4): the only cleanup path for account-scoped data.
 *
 * - Stores are registered eagerly, once, in `src/app/bootstrap.ts`, which
 *   then seals the scope: a later (lazy) registration throws, and so does a
 *   duplicate name.
 * - The **first** registered store is the gate: the session (SecureStore,
 *   then memory). `reset()` runs it first; when it fails, `reset()`
 *   rejects with its error and no other store is touched. Only after it
 *   succeeded are the other stores reset, in registration order. A failure
 *   of one of them is logged and does not stop the rest (the session is
 *   already gone, so the UI must still leave the account).
 * - `reset()` bumps the generation once the gate succeeded, before the
 *   other stores run, so async writes that captured an older
 *   `generation()` are dropped by their writer; a failed gate leaves it
 *   unchanged. It is single-flight: a call while one runs gets the same
 *   promise.
 * - Logs only store names and the outcome.
 */

export type ResetResult = {
  /** Stores (besides the gate) whose reset failed; normally empty. */
  failed: string[];
};

export type AccountScope = {
  register(...stores: AccountScopedStore[]): void;
  /** Ends registration; `register` throws afterwards. */
  seal(): void;
  reset(): Promise<ResetResult>;
  /** Bumped by every `reset()`; async writers capture it and compare. */
  generation(): number;
  /** Test-only: the registered names, in registration (= reset) order. */
  registeredNames(): string[];
};

export type AccountScopeOptions = {
  /** Read on use, so a cycle with the logger's own store cannot bite. */
  logger?: () => Logger;
};

export function createAccountScope({
  logger = () => appLogger,
}: AccountScopeOptions = {}): AccountScope {
  const stores: AccountScopedStore[] = [];
  let sealed = false;
  let gen = 0;
  let running: Promise<ResetResult> | null = null;

  async function doReset(): Promise<ResetResult> {
    const [gate, ...rest] = stores;
    if (gate) {
      try {
        await gate.reset();
      } catch (error) {
        logger().error('account', 'reset failed', {
          store: gate.name,
          outcome: 'kept',
        });
        throw error;
      }
    }
    // The account is gone: async writes captured before this are dropped.
    // Not before the gate, so a failed gate leaves the generation as it was.
    gen += 1;
    const failed: string[] = [];
    for (const store of rest) {
      try {
        await store.reset();
      } catch {
        failed.push(store.name);
      }
    }
    // After the stores: the logger's ring was just cleared, so this line
    // is the first entry of the next account.
    logger().info('account', 'reset', {
      stores: stores.map(s => s.name).join(','),
      outcome: failed.length === 0 ? 'ok' : 'partial',
      failed: failed.length > 0 ? failed.join(',') : undefined,
    });
    return { failed };
  }

  return {
    register(...next) {
      if (sealed) {
        throw new Error('AccountScope is sealed: register stores in app/bootstrap.ts');
      }
      for (const store of next) {
        if (stores.some(s => s.name === store.name)) {
          throw new Error(`Account-scoped store registered twice: ${store.name}`);
        }
        stores.push(store);
      }
    },
    seal() {
      sealed = true;
    },
    reset() {
      if (!running) {
        running = doReset().finally(() => {
          running = null;
        });
      }
      return running;
    },
    generation: () => gen,
    registeredNames: () => stores.map(s => s.name),
  };
}

/** The app-wide scope, filled and sealed by `src/app/bootstrap.ts`. */
export const accountScope: AccountScope = createAccountScope();
