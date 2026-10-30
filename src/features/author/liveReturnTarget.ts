/**
 * Epic 7 retro A2: the one focus-target rule of the Author page's live block
 * (the LiveCard, «Нравится», «Поделиться»), shared by the return focus
 * (`useAuthorLiveActions`) and card loss (`useAuthorLiveFocus`). Pure.
 */

/** Which element of the live block an id is. */
export type LiveFocusRole = 'live' | 'like' | 'share';

/** Where focus goes for a live-block element that is gone (or still shown). */
export type LiveReturnTarget = LiveFocusRole | 'firstPost';

/** Which elements are mounted now (`grid`: the page shows its post grid). */
export type LiveBlockShown = { card: boolean; like: boolean; share: boolean; grid: boolean };

/** The live-block role of a focus id; null for any other id. */
export function liveFocusRole(
  current: string | null,
  ids: { liveId: string; likeId: string; shareId: string },
): LiveFocusRole | null {
  return current === ids.liveId ? 'live' : current === ids.likeId ? 'like' : current === ids.shareId ? 'share' : null;
}

/**
 * The one target rule for focus on the live block (docs/focus-map.md §4 D):
 * - the element itself while shown;
 * - «Нравится» gone, «Поделиться» shown → «Поделиться»;
 * - «Нравится» / «Поделиться» gone, the card shown → the card;
 * - all gone with the grid shown → the first post (where the card was);
 * - else null (the caller's own fallback).
 * Each caller keeps its own guard (active route, no modal). The loss paths
 * pass `card: false` for card loss, so they never get `'live'`.
 */
export function liveReturnTarget(current: LiveFocusRole | null, shown: LiveBlockShown): LiveReturnTarget | null {
  if (current === null) {
    return null;
  }
  if (current === 'live' && shown.card) {
    return 'live';
  }
  if ((current === 'like' && shown.like) || (current === 'share' && shown.share)) {
    return current;
  }
  if (current === 'like' && shown.share) {
    return 'share';
  }
  if (current !== 'live' && shown.card) {
    return 'live';
  }
  return shown.grid ? 'firstPost' : null;
}
