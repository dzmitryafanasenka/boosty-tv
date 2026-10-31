import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { isChosen } from '../../shared/entities/poll';
import { usePendingConfirm } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { Text, requestHostFocus, type HostView } from '../../shared/ui';
import { PollError, ResultRow } from './PollParts';
import { PollActionStop, PollCheckOption } from './PollStops';
import { joinSentences, pollAccessibilityLabel, shownPollTitle, votersText } from './pollLabels';
import { pollStyles as styles } from './pollStyles';
import type { SingleChoicePollProps } from './SingleChoicePoll';
import { usePollVote } from './usePollVote';

export type MultipleChoicePollProps = SingleChoicePollProps & {
  submitId: string;
  retractId: string;
};

/** Frames the retract → not-voted hand-off requests the first option's focus before it stops requesting. */
const HANDOFF_MAX_FRAMES = 10;
/** The first frame of the hand-off's focus request (after the option stops' layout). */
const HANDOFF_FIRST_FRAME = 2;

/** The single-flight keys of the multiple-choice controls (`usePollVote` `sendingKey`). */
const SUBMIT_KEY = 'submit';
const RETRACT_KEY = 'retract';

/**
 * Story 6.7 (FR57, POLL-03/04/05, focus-map §4 I «Poll, multiple choice»):
 * an open multiple-choice poll. Not voted (`answer` empty): each option is
 * a checkbox stop (OK toggles a local check, nothing is sent) and
 * «Проголосовать» under them sends E11 with every checked id in option
 * order (focusable only while at least one is checked; no extra confirm).
 * Voted: the results with the accent checks (not focusable) and «Отозвать
 * голос», the poll's only stop, which sends E12 on two OKs (pending, then
 * confirm; blur cancels; `usePendingConfirm`). Every 2xx then E10 →
 * `applyPoll` (usePollVote); a failure shows the inline error under the
 * poll and keeps the previous state (and the checks).
 *
 * The action control is ONE element at a stable position (key `action`):
 * «Проголосовать» and «Отозвать голос» are its two modes, so the focused
 * native view survives a vote (device, Story 6.7: Android moves focus to
 * the column's first focusable — the author — when the focused view is
 * removed or turns non-focusable, and a JS request cannot repair it). After
 * a vote focus simply stays on it (its id becomes `…/retract`). After a
 * retract it would turn into a disabled «Проголосовать» while focused: it
 * stays focusable (drawn disabled) while focus is handed to the first option,
 * and turns non-focusable once that option reports focus or the control
 * blurs (the requests stop after `HANDOFF_MAX_FRAMES` frames).
 *
 * The checks live here (by option id, never persisted): they survive a
 * failed vote and a refetch (ids gone from the poll are dropped), are
 * cleared when the poll turns voted, and go when the post unmounts.
 */
export function MultipleChoicePoll({
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
}: MultipleChoicePollProps) {
  const { sendingKey, error, submit, isBusy, clearError } = usePollVote({ http, blogUrl, postId, pollId: poll.id });
  const voted = poll.answer.length > 0;
  const [checks, setChecks] = useState<ReadonlySet<string>>(() => new Set());
  const confirm = usePendingConfirm<typeof RETRACT_KEY>();
  const { press, cancel } = confirm;
  /** Retract → not voted while the action control is focused: focus goes to the first option first. */
  const [handoff, setHandoff] = useState(false);
  const [shownVoted, setShownVoted] = useState(voted);
  /** Whether the action control holds focus (its onFocus / onBlur). */
  const [actionFocused, setActionFocused] = useState(false);
  if (shownVoted !== voted) {
    // The poll changed mode (React's «state from the previous render»): no
    // pending retract survives it, a vote clears the checks, and a retract
    // under focus starts the hand-off in this same render (never committed
    // as non-focusable while focused).
    setShownVoted(voted);
    cancel();
    if (voted) {
      setChecks(prev => (prev.size === 0 ? prev : new Set()));
      setHandoff(false);
    } else if (actionFocused) {
      setHandoff(true);
    }
  }
  // A refetched poll without a checked option: drop its id.
  useEffect(() => {
    setChecks(prev => {
      const ids = new Set(poll.options.map(option => option.id));
      const kept = [...prev].filter(optionId => ids.has(optionId));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [poll.options]);
  /** The checked ids in option order (what E11 sends). */
  const checkedIds = useMemo(
    () => poll.options.filter(option => checks.has(option.id)).map(option => option.id),
    [poll.options, checks],
  );
  const latest = useRef({ checkedIds, error, voted });
  latest.current = { checkedIds, error, voted };

  // The option views by focus id (the hand-off's focus target), then the caller's.
  const views = useRef(new Map<string, HostView>());
  const trackView = useCallback(
    (focusId: string, view: HostView | null) => {
      if (view) {
        views.current.set(focusId, view);
      } else {
        views.current.delete(focusId);
      }
      onView(focusId, view);
    },
    [onView],
  );
  const firstOptionId = `${optionIdPrefix}${poll.options[0].id}`;
  const trackFocus = useCallback(
    (focusId: string) => {
      if (focusId.startsWith(optionIdPrefix)) {
        // The hand-off is done once an option holds focus.
        setHandoff(false);
      }
      onFocus(focusId);
    },
    [onFocus, optionIdPrefix],
  );
  useEffect(() => {
    if (!handoff) {
      return;
    }
    let frames = 0;
    let frame = 0;
    // Device (Story 6.7): the option stops mount in this commit with no
    // layout yet; a focus request now makes the column scroll to their
    // y = 0 (the post's top). So the request starts once they are laid out
    // (a couple of frames) and repeats every frame until an option reports
    // focus (which ends the hand-off), within a bound. On give-up only the
    // requests stop: the control stays focusable until it blurs or an option
    // reports focus (turning it non-focusable while focused would drop focus
    // to the author, the device bug). A bounded per-frame retry, not the
    // «now and after two frames» `focusSoon` (Epic 7 retro A2 left it alone).
    const tick = () => {
      frames += 1;
      if (frames >= HANDOFF_MAX_FRAMES) {
        return;
      }
      if (frames >= HANDOFF_FIRST_FRAME) {
        requestHostFocus(views.current.get(firstOptionId));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [handoff, firstOptionId]);

  const onToggle = useCallback(
    (optionId: string) => {
      if (isBusy()) {
        return;
      }
      if (latest.current.error !== null) {
        clearError();
      }
      setChecks(prev => {
        const next = new Set(prev);
        if (next.has(optionId)) {
          next.delete(optionId);
        } else {
          next.add(optionId);
        }
        return next;
      });
    },
    [isBusy, clearError],
  );
  const onAction = useCallback(() => {
    const now = latest.current;
    if (isBusy()) {
      return;
    }
    if (!now.voted) {
      if (now.checkedIds.length === 0) {
        return;
      }
      if (now.error !== null) {
        clearError();
      }
      submit('vote', now.checkedIds, SUBMIT_KEY);
      return;
    }
    if (now.error !== null) {
      clearError();
    }
    if (press(RETRACT_KEY) === 'armed') {
      return;
    }
    if (submit('retract', [], RETRACT_KEY)) {
      cancel();
    }
  }, [isBusy, clearError, submit, press, cancel]);
  const onActionFocus = useCallback(() => setActionFocused(true), []);
  const onActionBlur = useCallback(() => {
    setActionFocused(false);
    cancel();
    setHandoff(false);
  }, [cancel]);

  const title = poll.title.trim();
  const firstPrefix = useMemo(() => [t('poll.a11yPrefix'), title], [title]);
  const voters = votersText(poll);
  // The last option tells a screen-reader user that a submit step follows
  // (the disabled «Проголосовать» is not focusable yet).
  const lastSuffix = useMemo(() => [t('poll.submitHint'), voters], [voters]);
  const lastIndex = poll.options.length - 1;
  // Either key: the mode may flip while a request runs (OK stays ignored).
  const sending = sendingKey === SUBMIT_KEY || sendingKey === RETRACT_KEY;
  const label = t(voted ? 'poll.retract' : 'poll.submit');
  const shownPending = voted && confirm.pending === RETRACT_KEY;
  return (
    <View testID={id} focusable={false} style={[styles.root, styles.surface]}>
      <Text variant="section" style={styles.title}>
        {shownPollTitle(poll)}
      </Text>
      {voted ? (
        <>
          {poll.options.map((option, index) => (
            <ResultRow
              key={option.id}
              blockId={id}
              option={option}
              index={index}
              chosen={isChosen(poll, option.id)}
            />
          ))}
        </>
      ) : (
        <>
          {poll.options.map((option, index) => (
            <PollCheckOption
              key={option.id}
              focusId={`${optionIdPrefix}${option.id}`}
              blockId={id}
              option={option}
              index={index}
              checked={checks.has(option.id)}
              labelPrefix={index === 0 ? firstPrefix : null}
              labelSuffix={index === lastIndex ? lastSuffix : null}
              onView={trackView}
              onFocus={trackFocus}
              onPress={onToggle}
            />
          ))}
        </>
      )}
      <Text variant="body-s" color="text-secondary" style={styles.meta}>
        {voters}
      </Text>
      <PollActionStop
        key="action"
        focusId={voted ? retractId : submitId}
        label={label}
        primary={!voted}
        disabled={!voted && checkedIds.length === 0}
        keepFocusable={handoff}
        sending={sending}
        pendingHint={shownPending ? t('poll.pendingRetract') : null}
        accessibilityLabel={
          voted
            ? // The results are not focusable: the only stop reads them.
              joinSentences([
                pollAccessibilityLabel(poll),
                label,
                sending ? t('poll.sending') : shownPending ? t('poll.pendingRetract') : '',
              ])
            : joinSentences([label, sending ? t('poll.sending') : ''])
        }
        onView={onView}
        onFocus={onFocus}
        onPress={onAction}
        onFocusChange={onActionFocus}
        onBlur={onActionBlur}
      />
      {error !== null ? <PollError blockId={id} error={error} /> : null}
    </View>
  );
}
