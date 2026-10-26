/**
 * Typed root stack routes (ADR 0003 / ADR 0007). Params carry ids and flags
 * only, never secrets: the phone and the challenge stay in `features/auth`'s
 * in-memory `authFlow`; tokens stay in SessionManager.
 */
export type RootStackParamList = {
  /** A1. `signInAgain`: the stored session was corrupted and wiped. */
  Welcome: { signInAgain?: boolean } | undefined;
  /** A2–A4, A9, A10 */
  Phone: undefined;
  /** A5–A8 */
  Code: undefined;
  /** The signed-in Shell: sidebar + sections swapped in place (Story 2.4). */
  Shell: undefined;
  /** Debug builds only: «Проверка фокуса» (registered under `__DEV__`). */
  DevFocus: undefined;
  /** Debug builds only: the card detail pushed from «Проверка фокуса». */
  DevFocusDetail: { id: string };
};
