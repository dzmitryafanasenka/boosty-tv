/**
 * An account-scoped store (AD-4): data that belongs to the signed-in
 * account and must be wiped on sign-out (and, from Story 2.8, on an account
 * switch). The owning module declares it next to the data it owns, and
 * `src/app/bootstrap.ts` registers it with `accountScope` before the app
 * renders. `__tests__/accountScopeRegistry.test.js` fails when a declared
 * store is not registered.
 *
 * This file imports nothing, so any module (the logger included) can
 * declare its store without an import cycle.
 */
export type AccountScopedStore = {
  /** Unique, short and log-safe (it is logged). */
  readonly name: string;
  /** Wipes the store. A rejection or a throw means the store is not clear. */
  reset(): void | Promise<void>;
};

export function defineAccountScoped(
  name: string,
  reset: () => void | Promise<void>,
): AccountScopedStore {
  return Object.freeze({ name, reset });
}
