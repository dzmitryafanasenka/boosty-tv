/**
 * Typed root stack routes (ADR 0003 / ADR 0007). Params carry ids only,
 * never secrets: the phone and the challenge stay in `features/auth`'s
 * in-memory `authFlow`.
 */
export type RootStackParamList = {
  /** A1 */
  Welcome: undefined;
  /** A2–A4, A9, A10 */
  Phone: undefined;
  /** A5 (minimal until Story 2.3) */
  Code: undefined;
};
