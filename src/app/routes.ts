import type { MediaRef } from '../shared/entities/post';
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
  /**
   * G Плеер (Story 4.1): one video by its identity (AD-9) and where it was
   * opened from: the origin route's key and the focus id of the element
   * whose OK opened it (`post/<postId>/primary` or a MediaRow), so exit
   * returns focus there. Ids only: never a URL, `signedQuery` or `timeCode`.
   * `start` (Story 4.2): `beginning` for «С начала» (starts at 0); absent or
   * `resume`: the resume point (ProgressRepository). `origin.sectionId`
   * (Story 4.7): the FocusRestoration section of the origin (`home` for a
   * Главная «Продолжить просмотр» card on the Shell); absent: `main`.
   */
  Player: {
    ref: MediaRef;
    origin: { routeKey: string; focusId: string; sectionId?: string };
    start?: 'resume' | 'beginning';
  };
  /** A11 Session expired (Story 2.6): the stack root after an expiry. */
  Expired: undefined;
  /** Debug builds only: «Проверка фокуса» (registered under `__DEV__`). */
  DevFocus: undefined;
  /** Debug builds only: the card detail pushed from «Проверка фокуса». */
  DevFocusDetail: { id: string };
};
