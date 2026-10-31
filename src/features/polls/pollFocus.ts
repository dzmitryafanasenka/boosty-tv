import { isMultipleVotable, isVotablePoll, type Poll } from '../../shared/entities/poll';

/**
 * A poll's focus ids under a screen's content prefix (docs/focus-map.md
 * §1.5; Пост passes `post/<postId>/`): Story 6.6 the option stops
 * (`<prefix>poll/option/<optionId>`), Story 6.7 «Проголосовать» and
 * «Отозвать голос» (`<prefix>poll/submit`, `<prefix>poll/retract`). The
 * poll's own block stop (Story 6.5) is the screen's block id and is passed
 * in where needed.
 */
export type PollFocusIds = {
  /** Every poll focus id starts with it (`<prefix>poll/`). */
  prefix: string;
  optionIdPrefix: string;
  submitId: string;
  retractId: string;
};

export function pollFocusIds(contentPrefix: string): PollFocusIds {
  const prefix = `${contentPrefix}poll/`;
  return {
    prefix,
    optionIdPrefix: `${prefix}option/`,
    submitId: `${prefix}submit`,
    retractId: `${prefix}retract`,
  };
}

export const pollOptionFocusId = (ids: PollFocusIds, optionId: string) => `${ids.optionIdPrefix}${optionId}`;

/**
 * The poll's first stop when it is the screen's first stop, or null when
 * that is the poll's block stop (a display-only poll). Story 6.6: a votable
 * poll's first option (a stray OK only reaches pending). Story 6.7: an open
 * multiple-choice poll's first option (OK only toggles a check), or
 * «Отозвать голос» once voted (its only stop).
 */
export function pollFirstStopId(poll: Poll, ids: PollFocusIds): string | null {
  if (isVotablePoll(poll)) {
    return pollOptionFocusId(ids, poll.options[0].id);
  }
  if (isMultipleVotable(poll)) {
    return poll.answer.length > 0 ? ids.retractId : pollOptionFocusId(ids, poll.options[0].id);
  }
  return null;
}

/**
 * Where focus goes when the focused poll stop `gone` vanished (a refetch or
 * a vote changed the poll), in order; the screen takes the first mounted
 * one. Story 6.6: a vanished option (the poll became finished or multiple,
 * or the option was dropped) → another option, else the poll's block stop.
 * Story 6.7: «Проголосовать» gone after a vote → «Отозвать голос» first;
 * otherwise (including «Отозвать голос» gone after a retract) the options,
 * «Отозвать голос», then the block stop.
 */
export function pollFallbackOrder(poll: Poll, ids: PollFocusIds, blockId: string, gone: string): string[] {
  const optionIds = poll.options.map(option => pollOptionFocusId(ids, option.id));
  return gone === ids.submitId
    ? [ids.retractId, ...optionIds, blockId]
    : [...optionIds, ids.retractId, blockId];
}
