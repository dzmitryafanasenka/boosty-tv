import { authFlowAccountStore } from '../features/auth';
import { accountScope } from '../shared/account';
import { focusRestorationAccountStore } from '../shared/focus';
import { loggerAccountStore } from '../shared/services/logger';
import { sessionAccountStore } from './session';

/**
 * Runs once, before `App` renders (imported first by `App.tsx`): registers
 * every account-scoped store with AccountScope (AD-4), then seals it, so a
 * lazy registration elsewhere throws. The session comes first: it is the
 * gate that must be cleared before anything else is reset.
 *
 * A new account-scoped store is declared in its owning module and added
 * here; `__tests__/accountScopeRegistry.test.js` fails otherwise.
 */
accountScope.register(
  sessionAccountStore,
  focusRestorationAccountStore,
  authFlowAccountStore,
  loggerAccountStore,
);
accountScope.seal();
