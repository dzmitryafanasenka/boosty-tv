import {
  createUpdateChecker,
  createUpdatePreference,
  createUpdateStore,
  type UpdateChecker,
  type UpdateStore,
} from '../features/update';
import { fetchTransport } from '../shared/api/transport';
import { getVersionName } from '../shared/platform/appInfo';
import { logger } from '../shared/services/logger';
import { phaseFlags } from './phaseFlags';
import { DEMO_ACTIVE } from './session';

/**
 * The app's update check (Story 9.2, FR-56, AD-16): one store (the known
 * newer release, the plaque) and one checker over the global `fetch`
 * (`fetchTransport`, never the Boosty `HttpClient`) and the device-scoped
 * update state. Off while `phaseFlags.updateCheck` is off and in the demo:
 * no request, no plaque, no hint.
 */
export const updateEnabled = (): boolean => phaseFlags.updateCheck && !DEMO_ACTIVE;

export const updateStore: UpdateStore = createUpdateStore();

export const updateChecker: UpdateChecker = createUpdateChecker({
  enabled: updateEnabled,
  transport: fetchTransport,
  logger,
  installedVersion: getVersionName,
  preference: createUpdatePreference(),
  store: updateStore,
});
