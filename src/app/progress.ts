import { createProgressRepository, progressStore, type ProgressRepository } from '../shared/services/progress';
import { session } from './session';

/**
 * The app's ProgressRepository (Story 4.2, AD-10): the active session's
 * content client and status (the real session, or the demo's, whose
 * FixtureTransport answers E9), over the account-scoped `progressStore`
 * (registered with AccountScope in `bootstrap.ts`). Provided to features
 * through `ProgressContext` in `App.tsx`; features never import it.
 */
export const progress: ProgressRepository = createProgressRepository({ session, store: progressStore });
