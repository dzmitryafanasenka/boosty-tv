import { createContext, useContext } from 'react';

/**
 * Session state the Shell shows (Story 2.5), from App to the Shell route.
 * Features get it through props only (they never import `app`).
 */
export type SessionUi = {
  /** Cold-start E1 ended in `Network`: Главная shows the offline StateView. */
  homeOffline: boolean;
  /** «Повторить» is running E1. */
  retrying: boolean;
  onRetry: () => void;
  /** Debug builds only: the one live refresh check (Настройки row). */
  onCheckSession?: () => void;
  /** Debug builds only (Story 2.6): `expired` in memory only (Настройки row). */
  onExpireSession?: () => void;
};

export const SessionUiContext = createContext<SessionUi>({
  homeOffline: false,
  retrying: false,
  onRetry: () => {},
});

export function useSessionUi(): SessionUi {
  return useContext(SessionUiContext);
}
