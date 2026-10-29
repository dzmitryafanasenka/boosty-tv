import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { HttpClient } from '../../shared/api';
import {
  isChosen,
  isMultipleVotable,
  isVotablePoll,
  pollBarPercent,
  pollPercent,
  type Poll,
  type PollOption,
} from '../../shared/entities/poll';
import { useZoneItem } from '../../shared/focus';
import { t, tf, tp } from '../../shared/i18n';
import { formatCount } from '../../shared/i18n/format';
import {
  CheckIcon,
  FocusableSurface,
  Spinner,
  Text,
  colors,
  components,
  requestHostFocus,
  rounded,
  spacing,
  type HostView,
  useReducedMotion,
} from '../../shared/ui';
import { usePollVote, type PollMutation } from './usePollVote';

const OPTION = components['poll-option'];
/** The accent check's box (DESIGN.md PollOption «chosen»). */
const CHECK_SIZE = 16;
/** Story 6.7: a multiple-choice option's check box (before the vote) and its tick. */
const CHECK_BOX_SIZE = 20;
const CHECK_BOX_ICON = 16;
/**
 * Story 6.6, DESIGN.md PollOption «Pending: pulsing accent outline». Local,
 * not tokens: `tokens.ts` must match the DESIGN.md frontmatter exactly, and
 * the frontmatter has no pending values. The color is the accent (as
 * `chosenMark`); one pulse is opacity 1 → `PENDING_PULSE_MIN` → 1 over
 * `PENDING_PULSE_MS`; reduced motion draws it steady.
 */
const PENDING_OUTLINE = colors.accent;
const PENDING_OUTLINE_WIDTH = 2;
const PENDING_PULSE_MS = 1200;
const PENDING_PULSE_MIN = 0.35;

export type PollWidgetProps = {
  /** The focus id `post/<postId>/block/poll:<pollId>` (votable: the root's testID only). */
  id: string;
  poll: Poll;
  /** The host view by focus id (initial focus, the column's guide). */
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
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

/** «N %»: the API's `fraction`, rounded. */
const percentText = (fraction: number) => tf('poll.percent', { n: String(pollPercent(fraction)) });

/** A vote count as a non-negative integer (the API's value, rounded). */
const votesOf = (counter: number) => (Number.isFinite(counter) && counter > 0 ? Math.round(counter) : 0);

/** «48 % · 1 210» (POLL-01: the percent and the option's vote count). */
const resultText = (option: PollOption) =>
  tf('poll.result', { percent: percentText(option.fraction), count: formatCount(option.counter) });

/** The option's text, else «Вариант N» (its 1-based position; display only). */
const optionText = (option: PollOption, index: number) =>
  option.text.trim() || tf('poll.optionFallback', { n: String(index + 1) });

const votersText = (poll: Poll) => tf('poll.voters', { n: formatCount(poll.counter) });

/** A part that already ends a sentence gets no added period (no «?.» or «..»). */
const ENDS_SENTENCE = /[.?!…]$/;

/** Label parts as sentences: each but the last ends with a period unless it already ends one. */
function joinSentences(parts: readonly string[]): string {
  return parts
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .map((part, i, all) => (i < all.length - 1 && !ENDS_SENTENCE.test(part) ? `${part}.` : part))
    .join(' ');
}

/**
 * The readable summary: «Опрос», the title (when there is one), each option
 * with its percent, vote count (and «ваш выбор»), the voters and, when
 * finished, «Опрос завершен».
 */
export function pollAccessibilityLabel(poll: Poll): string {
  return joinSentences([
    t('poll.a11yPrefix'),
    poll.title,
    ...poll.options.map((option, index) => {
      const votes = votesOf(option.counter);
      return tf(isChosen(poll, option.id) ? 'poll.a11yOptionChosen' : 'poll.a11yOption', {
        text: optionText(option, index),
        percent: percentText(option.fraction),
        count: `${formatCount(votes)} ${tp('poll.votes', votes)}`,
      });
    }),
    votersText(poll),
    poll.isFinished ? t('poll.finished') : '',
  ]);
}

/**
 * DESIGN.md PollWidget (Story 6.5, FR40, POLL-01/05): the poll's title,
 * each option with a result bar, its percent and vote count («48 % · 1 210»;
 * an option without text reads «Вариант N»), the user's choices (an
 * accent check), «Проголосовали: N» and, when finished, «Опрос завершен».
 * Results are always shown, also before a vote (the reference). Story
 * 6.6: an open single-choice poll with the vote props is `VotablePoll`
 * (each option a stop); Story 6.7: an open multiple-choice poll is
 * `MultiplePoll`; every other poll (finished, or no vote props) is one
 * focus stop (a ring, no scale, as
 * ImageStop) with no focusable option, and OK does nothing.
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
      <MultiplePoll
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
      <VotablePoll
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

type PollDisplayProps = Pick<PollWidgetProps, 'id' | 'poll' | 'onView' | 'onFocus'>;

/** Story 6.5: the whole poll is one focus stop; OK does nothing. */
function PollDisplay({ id, poll, onView, onFocus }: PollDisplayProps) {
  const zone = useZoneItem(id);
  const zoneRef = zone.ref;
  const ref = useCallback(
    (view: HostView | null) => {
      zoneRef?.(view);
      onView(id, view);
    },
    [zoneRef, onView, id],
  );
  const zoneOnFocus = zone.onFocus;
  const handleFocus = useCallback(() => {
    zoneOnFocus();
    onFocus(id);
  }, [zoneOnFocus, onFocus, id]);
  const title = poll.title.trim();
  return (
    <FocusableSurface
      ref={ref}
      testID={id}
      radius={rounded.md}
      // No scale: a column-wide block scaled past the column would overlap
      // the text around it; the ring marks focus. OK has no action yet.
      scaleFocus={1}
      scalePressed={1}
      accessibilityRole="text"
      accessibilityLabel={pollAccessibilityLabel(poll)}
      onFocus={handleFocus}
      style={styles.root}
      surfaceStyle={() => styles.surface}
    >
      <Text variant="section" style={styles.title}>
        {title.length > 0 ? title : t('poll.untitled')}
      </Text>
      {poll.options.map((option, index) => (
        <ResultRow
          key={option.id}
          blockId={id}
          option={option}
          index={index}
          chosen={isChosen(poll, option.id)}
        />
      ))}
      <Text variant="body-s" color="text-secondary" style={styles.meta}>
        {votersText(poll)}
      </Text>
      {poll.isFinished ? (
        <Text testID={`${id}/finished`} variant="body-s" color="text-secondary">
          {t('poll.finished')}
        </Text>
      ) : null}
    </FocusableSurface>
  );
}

/**
 * One result row, not focusable (Story 6.5 display; Story 6.7 a voted
 * multiple-choice poll): the result bar, the accent check on a chosen
 * option, the text and «48 % · 1 210».
 */
function ResultRow({
  blockId,
  option,
  index,
  chosen,
}: {
  blockId: string;
  option: PollOption;
  index: number;
  chosen: boolean;
}) {
  return (
    <View testID={`${blockId}/option/${option.id}`} focusable={false} accessible={false} style={styles.option}>
      <View
        testID={`${blockId}/option/${option.id}/bar`}
        style={[styles.bar, { width: `${pollBarPercent(option.fraction)}%` }]}
      />
      <View style={styles.optionContent}>
        {chosen ? (
          <View style={styles.check}>
            <CheckIcon testID={`${blockId}/option/${option.id}/chosen`} color={OPTION.chosenMark} size={CHECK_SIZE} />
          </View>
        ) : null}
        <Text variant="body" numberOfLines={2} style={styles.optionText}>
          {optionText(option, index)}
        </Text>
        <Text variant="body" color={chosen ? 'accent-text' : 'text-secondary'} style={styles.percent}>
          {resultText(option)}
        </Text>
      </View>
    </View>
  );
}

type VotablePollProps = PollDisplayProps & {
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
 * click). Moving focus off the option cancels pending. While a request of
 * this poll runs, OK on any option is ignored and the option shows a
 * spinner. The results change only from E10 (`applyPoll`); focus stays on
 * the option. A failure shows the inline error under the poll, keeps the
 * previous state and is never retried; the next OK clears it.
 */
function VotablePoll({ id, poll, onView, onFocus, http, blogUrl, postId, optionIdPrefix }: VotablePollProps) {
  const { sendingKey, error, submit, isBusy, clearError } = usePollVote({
    http,
    blogUrl,
    postId,
    pollId: poll.id,
  });
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Latest values for the per-option callbacks (stable, so a memoized
  // option re-renders only for its own state).
  const latest = useRef({ poll, pendingId, error });
  latest.current = { poll, pendingId, error };

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
      if (now.pendingId !== optionId) {
        setPendingId(optionId);
        return;
      }
      const mutation: PollMutation = isChosen(now.poll, optionId) ? 'retract' : 'vote';
      if (submit(mutation, [optionId], optionId)) {
        setPendingId(null);
      }
    },
    [submit, isBusy, clearError],
  );
  const onBlur = useCallback((optionId: string) => {
    setPendingId(prev => (prev === optionId ? null : prev));
  }, []);

  const title = poll.title.trim();
  const shownTitle = title.length > 0 ? title : t('poll.untitled');
  // Stable label parts, so the memoized first and last options re-render only for their own state.
  const firstPrefix = useMemo(() => [t('poll.a11yPrefix'), title], [title]);
  const voters = votersText(poll);
  const lastSuffix = useMemo(() => [voters], [voters]);
  const lastIndex = poll.options.length - 1;
  return (
    <View testID={id} focusable={false} style={[styles.root, styles.surface]}>
      <Text variant="section" style={styles.title}>
        {shownTitle}
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
      {error !== null ? (
        // Announced: focus stays on the option, so nothing else would be spoken.
        <Text
          testID={`${id}/error`}
          variant="body-s"
          color="error-text"
          accessibilityLiveRegion="polite"
          style={styles.error}
        >
          {t(error === 'vote' ? 'poll.voteFailed' : 'poll.retractFailed')}
        </Text>
      ) : null}
    </View>
  );
}

type MultiplePollProps = VotablePollProps & {
  submitId: string;
  retractId: string;
};

/** Frames the retract → not-voted hand-off requests the first option's focus before it stops requesting. */
const HANDOFF_MAX_FRAMES = 10;
/** The first frame of the hand-off's focus request (after the option stops' layout). */
const HANDOFF_FIRST_FRAME = 2;

/**
 * Story 6.7 (FR57, POLL-03/04/05, focus-map §4 I «Poll, multiple choice»):
 * an open multiple-choice poll. Not voted (`answer` empty): each option is
 * a checkbox stop (OK toggles a local check, nothing is sent) and
 * «Проголосовать» under them sends E11 with every checked id in option
 * order (focusable only while at least one is checked; no extra confirm).
 * Voted: the results with the accent checks (not focusable) and «Отозвать
 * голос», the poll's only stop, which sends E12 on two OKs (pending, then
 * confirm; blur cancels). Every 2xx then E10 → `applyPoll` (usePollVote);
 * a failure shows the inline error under the poll and keeps the previous
 * state (and the checks).
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
function MultiplePoll({
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
}: MultiplePollProps) {
  const { sendingKey, error, submit, isBusy, clearError } = usePollVote({ http, blogUrl, postId, pollId: poll.id });
  const voted = poll.answer.length > 0;
  const [checks, setChecks] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState(false);
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
    setPending(false);
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
  const latest = useRef({ checkedIds, error, pending, voted });
  latest.current = { checkedIds, error, pending, voted };

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
    // to the author, the device bug).
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
    if (!now.pending) {
      setPending(true);
      return;
    }
    if (submit('retract', [], RETRACT_KEY)) {
      setPending(false);
    }
  }, [isBusy, clearError, submit]);
  const onActionFocus = useCallback(() => setActionFocused(true), []);
  const onActionBlur = useCallback(() => {
    setActionFocused(false);
    setPending(false);
    setHandoff(false);
  }, []);

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
  const shownPending = voted && pending;
  return (
    <View testID={id} focusable={false} style={[styles.root, styles.surface]}>
      <Text variant="section" style={styles.title}>
        {title.length > 0 ? title : t('poll.untitled')}
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
      {error !== null ? (
        // Announced: focus stays on the control, so nothing else would be spoken.
        <Text
          testID={`${id}/error`}
          variant="body-s"
          color="error-text"
          accessibilityLiveRegion="polite"
          style={styles.error}
        >
          {t(error === 'vote' ? 'poll.voteFailed' : 'poll.retractFailed')}
        </Text>
      ) : null}
    </View>
  );
}

/** The single-flight keys of the multiple-choice controls (`usePollVote` `sendingKey`). */
const SUBMIT_KEY = 'submit';
const RETRACT_KEY = 'retract';

type PollCheckOptionProps = {
  /** `post/<postId>/poll/option/<optionId>` */
  focusId: string;
  blockId: string;
  option: PollOption;
  index: number;
  checked: boolean;
  labelPrefix: readonly string[] | null;
  labelSuffix: readonly string[] | null;
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
  onPress: (optionId: string) => void;
};

/** The checkbox option's readable label: text, percent, votes, then «отмечено» / «не отмечено». */
export function pollCheckOptionAccessibilityLabel(
  option: PollOption,
  index: number,
  { checked, prefix = [], suffix = [] }: { checked: boolean; prefix?: readonly string[]; suffix?: readonly string[] },
): string {
  const votes = votesOf(option.counter);
  return joinSentences([
    ...prefix,
    tf('poll.a11yOption', {
      text: optionText(option, index),
      percent: percentText(option.fraction),
      count: `${formatCount(votes)} ${tp('poll.votes', votes)}`,
    }),
    t(checked ? 'poll.a11yChecked' : 'poll.a11yUnchecked'),
    ...suffix,
  ]);
}

/**
 * Story 6.7: a multiple-choice option before the vote, a checkbox stop (the
 * 6.6 option stop's padding, ring and no scale). The check box at the left
 * is an empty outline or an accent fill (`poll-option.chosenMark`); it is
 * not the answered state's accent check, which shows only after the vote.
 * OK toggles it (no pending step).
 */
const PollCheckOption = memo(function PollCheckOptionView({
  focusId,
  blockId,
  option,
  index,
  checked,
  labelPrefix,
  labelSuffix,
  onView,
  onFocus,
  onPress,
}: PollCheckOptionProps) {
  const zone = useZoneItem(focusId);
  const zoneRef = zone.ref;
  const ref = useCallback(
    (view: HostView | null) => {
      zoneRef?.(view);
      onView(focusId, view);
    },
    [zoneRef, onView, focusId],
  );
  const zoneOnFocus = zone.onFocus;
  const handleFocus = useCallback(() => {
    zoneOnFocus();
    onFocus(focusId);
  }, [zoneOnFocus, onFocus, focusId]);
  const handlePress = useCallback(() => onPress(option.id), [onPress, option.id]);
  const inner = `${blockId}/option/${option.id}`;
  return (
    <FocusableSurface
      ref={ref}
      testID={focusId}
      radius={OPTION.radius}
      scaleFocus={1}
      scalePressed={1}
      accessibilityRole="checkbox"
      accessibilityLabel={pollCheckOptionAccessibilityLabel(option, index, {
        checked,
        prefix: labelPrefix ?? [],
        suffix: labelSuffix ?? [],
      })}
      accessibilityState={{ checked }}
      onFocus={handleFocus}
      onPress={handlePress}
      style={styles.optionStop}
      surfaceStyle={() => styles.optionSurface}
    >
      <View testID={inner} style={styles.optionClip}>
        <View testID={`${inner}/bar`} style={[styles.bar, { width: `${pollBarPercent(option.fraction)}%` }]} />
        <View style={styles.optionContent}>
          <View
            testID={`${inner}/box`}
            style={[styles.checkBox, checked ? styles.checkBoxChecked : null]}
          >
            {checked ? (
              <CheckIcon testID={`${inner}/checked`} color={colors['accent-ink']} size={CHECK_BOX_ICON} />
            ) : null}
          </View>
          <Text variant="body" numberOfLines={2} style={styles.optionText}>
            {optionText(option, index)}
          </Text>
          <Text variant="body" color="text-secondary" style={styles.percent}>
            {resultText(option)}
          </Text>
        </View>
      </View>
    </FocusableSurface>
  );
});

type PollActionStopProps = {
  /** `post/<postId>/poll/submit` or `…/retract` (it may change while focused). */
  focusId: string;
  label: string;
  /** «Проголосовать» (the accent button) vs «Отозвать голос» (secondary). */
  primary: boolean;
  /** Shown dimmed, OK inert, and not focusable unless `keepFocusable`. */
  disabled: boolean;
  /** Story 6.7 hand-off: drawn disabled but still focusable (focus is moving away). */
  keepFocusable?: boolean;
  sending: boolean;
  /** The pending hint shown in the label's place (with the pulsing outline); null when not pending. */
  pendingHint: string | null;
  accessibilityLabel: string;
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
  onPress: () => void;
  /** Native focus arrived (after the zone and `onFocus` are told). */
  onFocusChange?: () => void;
  onBlur?: () => void;
};

/**
 * Story 6.7: «Проголосовать» / «Отозвать голос». The DESIGN.md Button
 * colors (primary / secondary), on the option stop's terms: a ring, no
 * scale, vertical padding so the ring is not cut at the column's bottom.
 * Unlike `Button`, it takes a blur (pending cancel) and draws the pending
 * outline and hint. Its focus id may change while it is focused (a vote
 * turns «Проголосовать» into «Отозвать голос» on the same view): the zone
 * and the screen are then told the new id, and the ref re-registers the
 * view under it (a new ref callback: the old id is dropped first).
 */
function PollActionStop({
  focusId,
  label,
  primary,
  disabled,
  keepFocusable = false,
  sending,
  pendingHint,
  accessibilityLabel,
  onView,
  onFocus,
  onPress,
  onFocusChange,
  onBlur,
}: PollActionStopProps) {
  const zone = useZoneItem(focusId);
  const zoneRef = zone.ref;
  const ref = useCallback(
    (view: HostView | null) => {
      zoneRef?.(view);
      onView(focusId, view);
    },
    [zoneRef, onView, focusId],
  );
  const zoneOnFocus = zone.onFocus;
  const handleFocus = useCallback(() => {
    zoneOnFocus();
    onFocus(focusId);
  }, [zoneOnFocus, onFocus, focusId]);
  const focused = useRef(false);
  // The id changed under focus: track the new one before the screen's
  // refetch fallback (a parent effect) looks for the old one.
  const shownId = useRef(focusId);
  useLayoutEffect(() => {
    if (shownId.current !== focusId) {
      shownId.current = focusId;
      if (focused.current) {
        handleFocus();
      }
    }
  }, [focusId, handleFocus]);
  const onSurfaceFocus = useCallback(() => {
    focused.current = true;
    handleFocus();
    onFocusChange?.();
  }, [handleFocus, onFocusChange]);
  const onSurfaceBlur = useCallback(() => {
    focused.current = false;
    onBlur?.();
  }, [onBlur]);
  const kind = primary ? components['button-primary'] : components['button-secondary'];
  const textColor = disabled ? colors['text-disabled'] : kind.text;
  return (
    <FocusableSurface
      ref={ref}
      testID={focusId}
      radius={kind.radius}
      scaleFocus={1}
      scalePressed={1}
      disabled={disabled && !keepFocusable}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy: sending }}
      onFocus={onSurfaceFocus}
      onBlur={onSurfaceBlur}
      onPress={disabled ? undefined : onPress}
      style={styles.actionStop}
      surfaceStyle={({ focused: isFocused }) => [
        styles.actionSurface,
        {
          height: kind.height,
          paddingHorizontal: kind.paddingX,
          backgroundColor: disabled ? colors['surface-raised'] : isFocused ? kind.bgFocus : kind.bg,
        },
      ]}
    >
      <View style={styles.actionContent}>
        <Text
          testID={pendingHint !== null ? `${focusId}/pending` : undefined}
          variant="button"
          numberOfLines={1}
          style={{ color: textColor }}
        >
          {pendingHint ?? label}
        </Text>
        {sending ? (
          <View style={styles.spinner}>
            <Spinner testID={`${focusId}/sending`} color={textColor} />
          </View>
        ) : null}
      </View>
      {pendingHint !== null ? <PendingOutline testID={`${focusId}/outline`} radius={kind.radius} /> : null}
    </FocusableSurface>
  );
}

type PollOptionStopProps = {
  /** `post/<postId>/poll/option/<optionId>` */
  focusId: string;
  /** The poll's block id (the inner testIDs: `<blockId>/option/<optionId>/…`). */
  blockId: string;
  option: PollOption;
  index: number;
  chosen: boolean;
  /** The pending hint: `vote` or `retract` (the chosen option); null when not pending. */
  pending: PollMutation | null;
  sending: boolean;
  /** The first option's label starts with «Опрос» and the title. */
  labelPrefix: readonly string[] | null;
  /** The last option's label ends with the voters («Проголосовали: N»). */
  labelSuffix: readonly string[] | null;
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
  onPress: (optionId: string) => void;
  onBlur: (optionId: string) => void;
};

/** The option's readable label: its text, percent, votes, «ваш выбор», then the pending hint or «Отправка». */
export function pollOptionAccessibilityLabel(
  option: PollOption,
  index: number,
  { chosen, pending, sending, prefix = [], suffix = [] }: {
    chosen: boolean;
    pending: PollMutation | null;
    sending: boolean;
    prefix?: readonly string[];
    suffix?: readonly string[];
  },
): string {
  const votes = votesOf(option.counter);
  return joinSentences([
    ...prefix,
    tf(chosen ? 'poll.a11yOptionChosen' : 'poll.a11yOption', {
      text: optionText(option, index),
      percent: percentText(option.fraction),
      count: `${formatCount(votes)} ${tp('poll.votes', votes)}`,
    }),
    sending
      ? t('poll.sending')
      : pending === 'retract'
        ? t('poll.pendingRetract')
        : pending === 'vote'
          ? t('poll.pendingVote')
          : '',
    ...suffix,
  ]);
}

/** DESIGN.md PollOption: default, chosen, pending, sending (Story 6.6). */
const PollOptionStop = memo(function PollOptionStopView({
  focusId,
  blockId,
  option,
  index,
  chosen,
  pending,
  sending,
  labelPrefix,
  labelSuffix,
  onView,
  onFocus,
  onPress,
  onBlur,
}: PollOptionStopProps) {
  const zone = useZoneItem(focusId);
  const zoneRef = zone.ref;
  const ref = useCallback(
    (view: HostView | null) => {
      zoneRef?.(view);
      onView(focusId, view);
    },
    [zoneRef, onView, focusId],
  );
  const zoneOnFocus = zone.onFocus;
  const handleFocus = useCallback(() => {
    zoneOnFocus();
    onFocus(focusId);
  }, [zoneOnFocus, onFocus, focusId]);
  const handlePress = useCallback(() => onPress(option.id), [onPress, option.id]);
  const handleBlur = useCallback(() => onBlur(option.id), [onBlur, option.id]);
  const inner = `${blockId}/option/${option.id}`;
  return (
    <FocusableSurface
      ref={ref}
      testID={focusId}
      radius={OPTION.radius}
      // No scale (as the 6.5 stop): the ring marks focus.
      scaleFocus={1}
      scalePressed={1}
      accessibilityRole="button"
      accessibilityLabel={pollOptionAccessibilityLabel(option, index, {
        chosen,
        pending,
        sending,
        prefix: labelPrefix ?? [],
        suffix: labelSuffix ?? [],
      })}
      accessibilityState={{ selected: chosen, busy: sending }}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPress={handlePress}
      style={styles.optionStop}
      surfaceStyle={() => styles.optionSurface}
    >
      <View testID={inner} style={styles.optionClip}>
        <View testID={`${inner}/bar`} style={[styles.bar, { width: `${pollBarPercent(option.fraction)}%` }]} />
        <View style={styles.optionContent}>
          {chosen ? (
            <View style={styles.check}>
              <CheckIcon testID={`${inner}/chosen`} color={OPTION.chosenMark} size={CHECK_SIZE} />
            </View>
          ) : null}
          <Text variant="body" numberOfLines={2} style={styles.optionText}>
            {optionText(option, index)}
          </Text>
          {sending ? (
            <View style={styles.spinner}>
              <Spinner testID={`${inner}/sending`} color={colors.accent} />
            </View>
          ) : null}
          {pending !== null ? (
            // In the result's place, one line: the option's height never changes (device:
            // a hint on its own line grew the option and clipped it at the column's bottom).
            <Text
              testID={`${inner}/pending`}
              variant="body"
              color="accent-text"
              numberOfLines={1}
              style={styles.percent}
            >
              {t(pending === 'retract' ? 'poll.pendingRetract' : 'poll.pendingVote')}
            </Text>
          ) : (
            <Text variant="body" color={chosen ? 'accent-text' : 'text-secondary'} style={styles.percent}>
              {resultText(option)}
            </Text>
          )}
        </View>
      </View>
      {pending !== null ? <PendingOutline testID={`${inner}/outline`} /> : null}
    </FocusableSurface>
  );
});

/** The pending option's accent outline, pulsing (steady with reduced motion). */
function PendingOutline({ testID, radius = OPTION.radius }: { testID: string; radius?: number }) {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(1);
      return;
    }
    const half = PENDING_PULSE_MS / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: PENDING_PULSE_MIN, duration: half, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: half, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reducedMotion]);
  return <Animated.View testID={testID} pointerEvents="none" style={[styles.outline, { borderRadius: radius, opacity }]} />;
}

const styles = StyleSheet.create({
  // Android scrolls a focused view flush with the column's edge (device,
  // Stories 6.4, 6.5): the vertical padding keeps the ring (offset 2 +
  // width 2) inside the scrolled rectangle, so a last-block poll's ring is
  // not cut off at the column's bottom.
  root: {
    alignSelf: 'stretch',
    maxWidth: spacing['text-measure'],
    paddingVertical: spacing['3'],
    marginBottom: spacing['3'],
  },
  surface: {
    padding: spacing['5'],
    borderRadius: rounded.md,
    backgroundColor: colors.surface,
  },
  title: {
    marginBottom: spacing['4'],
  },
  option: {
    minHeight: OPTION.height,
    borderRadius: OPTION.radius,
    backgroundColor: colors['surface-raised'],
    overflow: 'hidden',
    justifyContent: 'center',
    marginBottom: spacing['3'],
  },
  bar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: OPTION.resultBar,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing['5'],
    paddingVertical: spacing['2'],
  },
  check: {
    marginRight: spacing['3'],
  },
  optionText: {
    flex: 1,
  },
  percent: {
    marginLeft: spacing['5'],
  },
  meta: {
    marginTop: spacing['2'],
  },
  error: {
    marginTop: spacing['2'],
  },
  // Story 6.6: an option stop. The surface sets no overflow (the ring would
  // be clipped); the inner view clips the result bar.
  // The vertical padding (not a margin) keeps the ring (offset 2 + width 2)
  // inside the rectangle Android scrolls into view: with a margin the
  // focused option's ring was cut at the column's bottom (device, Story
  // 6.6), as the 6.5 stop's was.
  optionStop: {
    paddingVertical: spacing['3'],
  },
  optionSurface: {
    minHeight: OPTION.height,
    borderRadius: OPTION.radius,
    backgroundColor: colors['surface-raised'],
  },
  optionClip: {
    minHeight: OPTION.height,
    borderRadius: OPTION.radius,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  spinner: {
    marginLeft: spacing['3'],
  },
  // Story 6.7: the check box of a multiple-choice option before the vote.
  checkBox: {
    width: CHECK_BOX_SIZE,
    height: CHECK_BOX_SIZE,
    marginRight: spacing['3'],
    borderRadius: rounded.sm,
    borderWidth: 2,
    borderColor: colors['text-secondary'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxChecked: {
    borderColor: OPTION.chosenMark,
    backgroundColor: OPTION.chosenMark,
  },
  // Story 6.7: «Проголосовать» / «Отозвать голос», left-aligned under the
  // options; the padding keeps the ring inside the scrolled rectangle.
  actionStop: {
    alignSelf: 'flex-start',
    paddingVertical: spacing['3'],
  },
  actionSurface: {
    justifyContent: 'center',
  },
  actionContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  outline: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: OPTION.radius,
    borderWidth: PENDING_OUTLINE_WIDTH,
    borderColor: PENDING_OUTLINE,
  },
});
