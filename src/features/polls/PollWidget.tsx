import { memo } from 'react';
import type { HttpClient } from '../../shared/api';
import { isMultipleVotable, isVotablePoll } from '../../shared/entities/poll';
import { MultipleChoicePoll } from './MultipleChoicePoll';
import { PollDisplay, type PollDisplayProps } from './PollDisplay';
import { SingleChoicePoll } from './SingleChoicePoll';

export {
  pollAccessibilityLabel,
  pollCheckOptionAccessibilityLabel,
  pollOptionAccessibilityLabel,
} from './pollLabels';

export type PollWidgetProps = PollDisplayProps & {
  /**
   * Story 6.6: voting. All four given and the poll open single-choice
   * (`isVotablePoll`) → each option is a focus stop (`<optionIdPrefix><optionId>`,
   * `post/<postId>/poll/option/`) taking a vote or retract on two OKs.
   * Otherwise the Story 6.5 display (one stop, OK inert).
   */
  http?: HttpClient;
  /** The post's blog (E10, the E8 query key). */
  blogUrl?: string;
  postId?: string;
  optionIdPrefix?: string;
  /**
   * Story 6.7: an open multiple-choice poll (`isMultipleVotable`) with the
   * vote props and both ids → «Проголосовать» (`post/<postId>/poll/submit`)
   * and «Отозвать голос» (`post/<postId>/poll/retract`).
   */
  submitId?: string;
  retractId?: string;
};

/**
 * DESIGN.md PollWidget (Story 6.5, FR40, POLL-01/05): the poll's title,
 * each option with a result bar, its percent and vote count («48 % · 1 210»;
 * an option without text reads «Вариант N»), the user's choices (an
 * accent check), «Проголосовали: N» and, when finished, «Опрос завершен».
 * Results are always shown, also before a vote (the reference). Story
 * 6.6: an open single-choice poll with the vote props is `SingleChoicePoll`
 * (each option a stop); Story 6.7: an open multiple-choice poll is
 * `MultipleChoicePoll`; every other poll (finished, or no vote props) is
 * `PollDisplay`, one focus stop (a ring, no scale, as ImageStop) with no
 * focusable option, and OK does nothing. A thin router: the labels are in
 * `pollLabels.ts`, the stops in `PollStops.tsx`, the focus ids and the
 * fallback order in `pollFocus.ts`.
 */
export const PollWidget = memo(function PollWidgetView({
  id,
  poll,
  onView,
  onFocus,
  http,
  blogUrl,
  postId,
  optionIdPrefix,
  submitId,
  retractId,
}: PollWidgetProps) {
  const canVote =
    http !== undefined && blogUrl !== undefined && postId !== undefined && optionIdPrefix !== undefined;
  if (canVote && submitId !== undefined && retractId !== undefined && isMultipleVotable(poll)) {
    return (
      <MultipleChoicePoll
        id={id}
        poll={poll}
        onView={onView}
        onFocus={onFocus}
        http={http}
        blogUrl={blogUrl}
        postId={postId}
        optionIdPrefix={optionIdPrefix}
        submitId={submitId}
        retractId={retractId}
      />
    );
  }
  if (canVote && isVotablePoll(poll)) {
    return (
      <SingleChoicePoll
        id={id}
        poll={poll}
        onView={onView}
        onFocus={onFocus}
        http={http}
        blogUrl={blogUrl}
        postId={postId}
        optionIdPrefix={optionIdPrefix}
      />
    );
  }
  return <PollDisplay id={id} poll={poll} onView={onView} onFocus={onFocus} />;
});
