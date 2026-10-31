import { useCallback, useMemo, useRef } from 'react';
import { View } from 'react-native';
import type { HttpClient } from '../../shared/api';
import { isChosen } from '../../shared/entities/poll';
import { usePendingConfirm } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { Text } from '../../shared/ui';
import type { PollDisplayProps } from './PollDisplay';
import { PollError } from './PollParts';
import { PollOptionStop } from './PollStops';
import { shownPollTitle, votersText } from './pollLabels';
import { pollStyles as styles } from './pollStyles';
import { usePollVote, type PollMutation } from './usePollVote';

export type SingleChoicePollProps = PollDisplayProps & {
  http: HttpClient;
  blogUrl: string;
  postId: string;
  optionIdPrefix: string;
};

/**
 * Story 6.6 (FR41, POLL-02/04, focus-map §4 I «Poll, single choice»): an
 * open single-choice poll. The root is not focusable; each option is a
 * stop (a ring, no scale; ↑ ↓ natively between them). 1st OK → pending
 * (a pulsing accent outline and «Нажмите OK ещё раз», on the chosen option
 * «…, чтобы отозвать»); a 2nd OK on the same option sends E11 with it, or
 * E12 on the chosen option (our improvement: the reference votes on one
 * click; `usePendingConfirm`). Moving focus off the option cancels pending.
 * While a request of this poll runs, OK on any option is ignored and the
 * option shows a spinner. The results change only from E10 (`applyPoll`);
 * focus stays on the option. A failure shows the inline error under the
 * poll, keeps the previous state and is never retried; the next OK clears
 * it.
 */
export function SingleChoicePoll({
  id,
  poll,
  onView,
  onFocus,
  http,
  blogUrl,
  postId,
  optionIdPrefix,
}: SingleChoicePollProps) {
  const { sendingKey, error, submit, isBusy, clearError } = usePollVote({
    http,
    blogUrl,
    postId,
    pollId: poll.id,
  });
  const confirm = usePendingConfirm<string>();
  const pendingId = confirm.pending;
  const { press, cancel } = confirm;
  // Latest values for the per-option callbacks (stable, so a memoized
  // option re-renders only for its own state).
  const latest = useRef({ poll, error });
  latest.current = { poll, error };

  const onPress = useCallback(
    (optionId: string) => {
      const now = latest.current;
      if (isBusy()) {
        // One request per poll (under this account): ignored while it runs.
        return;
      }
      if (now.error !== null) {
        clearError();
      }
      if (press(optionId) === 'armed') {
        return;
      }
      const mutation: PollMutation = isChosen(now.poll, optionId) ? 'retract' : 'vote';
      if (submit(mutation, [optionId], optionId)) {
        cancel();
      }
    },
    [submit, isBusy, clearError, press, cancel],
  );
  const onBlur = useCallback((optionId: string) => cancel(optionId), [cancel]);

  const title = poll.title.trim();
  // Stable label parts, so the memoized first and last options re-render only for their own state.
  const firstPrefix = useMemo(() => [t('poll.a11yPrefix'), title], [title]);
  const voters = votersText(poll);
  const lastSuffix = useMemo(() => [voters], [voters]);
  const lastIndex = poll.options.length - 1;
  return (
    <View testID={id} focusable={false} style={[styles.root, styles.surface]}>
      <Text variant="section" style={styles.title}>
        {shownPollTitle(poll)}
      </Text>
      {poll.options.map((option, index) => {
        const chosen = isChosen(poll, option.id);
        return (
          <PollOptionStop
            key={option.id}
            focusId={`${optionIdPrefix}${option.id}`}
            blockId={id}
            option={option}
            index={index}
            chosen={chosen}
            pending={pendingId === option.id ? (chosen ? 'retract' : 'vote') : null}
            sending={sendingKey === option.id}
            labelPrefix={index === 0 ? firstPrefix : null}
            // The voters line is off-screen when the last option is focused: its label says it.
            labelSuffix={index === lastIndex ? lastSuffix : null}
            onView={onView}
            onFocus={onFocus}
            onPress={onPress}
            onBlur={onBlur}
          />
        );
      })}
      <Text variant="body-s" color="text-secondary" style={styles.meta}>
        {voters}
      </Text>
      {error !== null ? <PollError blockId={id} error={error} /> : null}
    </View>
  );
}
