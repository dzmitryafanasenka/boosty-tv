import type { SectionId } from './phaseFlags';

/**
 * Typed root stack routes (ADR 0003 / ADR 0007). Params carry ids and flags
 * only, never secrets: the phone and the challenge stay in `features/auth`'s
 * in-memory `authFlow`; tokens stay in SessionManager.
 */
export type RootStackParamList = {
  /** A1. `signInAgain`: the stored session was corrupted and wiped. */
  Welcome: { signInAgain?: boolean } | undefined;
  /**
   * A2–A4, A9, A10. `fromExpired`: opened from A11 (a flag only; the
   * prefilled phone travels in `authFlow`'s in-memory draft).
   */
  Phone: { fromExpired?: boolean } | undefined;
  /** A5–A8 */
  Code: undefined;
  /** The signed-in Shell: sidebar + sections swapped in place (Story 2.4). */
  Shell: undefined;
  /**
   * D Автор (Story 3.3): one blog's header and posts. `blogUrl` already
   * passed `blogUrlSchema` (it came from an Author or Post entity).
   * `section`: the origin Shell section, the sidebar's current item
   * (default Подписки; Главная when opened from a post of the feed).
   */
  Author: { blogUrl: string; section?: SectionId };
  /**
   * F Пост (Story 3.4): one post by its identity (AD-9). `blogUrl` passed
   * `blogUrlSchema` in the post mapper. `section`: the origin Shell section,
   * the sidebar's current item (Главная from the feed, Подписки from Автор).
   */
  Post: { blogUrl: string; postId: string; section: SectionId };
  /** A11 Session expired (Story 2.6): the stack root after an expiry. */
  Expired: undefined;
  /** Debug builds only: «Проверка фокуса» (registered under `__DEV__`). */
  DevFocus: undefined;
  /** Debug builds only: the card detail pushed from «Проверка фокуса». */
  DevFocusDetail: { id: string };
};
