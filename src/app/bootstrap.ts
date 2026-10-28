import { authFlowAccountStore } from '../features/auth';
import { accountScope } from '../shared/account';
import { filtersAccountStore } from '../shared/filters';
import { focusRestorationAccountStore } from '../shared/focus';
import { loggerAccountStore } from '../shared/services/logger';
import { progressAccountStore } from '../shared/services/progress';
import { queryCacheAccountStore } from './queryClient';
import { session, sessionAccountStore } from './session';

/**
 * Runs once, before `App` renders (imported first by `App.tsx`): registers
 * every account-scoped store with AccountScope (AD-4), then seals it, so a
 * lazy registration elsewhere throws. The session comes first: it is the
 * gate that must be cleared before anything else is reset.
 *
 * A new account-scoped store is declared in its owning module and added
 * here; `__tests__/accountScopeRegistry.test.js` fails otherwise.
 *
 * Story 2.8: the active session (real, or the demo's in-memory one) gets
 * `accountScope.reset()` as its account-switch hook, so a sign-in with a
 * different account wipes every store before the new phone and session are
 * written. The demo's gate is its own in-memory sign-out: the keychain is
 * never touched. Unlike sign-out (which leaves the account anyway), a
 * partial reset fails the switch: the hook throws when any store failed, so
 * the sign-in fails as spent and nothing of the new account is stored.
 */
export async function accountSwitchHook(): Promise<void> {
  const { failed } = await accountScope.reset();
  if (failed.length > 0) {
    throw new Error(`account switch: stores not reset: ${failed.join(',')}`);
  }
}

accountScope.register(
  sessionAccountStore,
  focusRestorationAccountStore,
  authFlowAccountStore,
  loggerAccountStore,
  queryCacheAccountStore,
  progressAccountStore,
  filtersAccountStore,
);
accountScope.seal();
session.setAccountSwitchHook(accountSwitchHook);
