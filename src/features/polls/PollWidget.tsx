import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { isChosen, pollBarPercent, pollPercent, type Poll, type PollOption } from '../../shared/entities/poll';
import { useZoneItem } from '../../shared/focus';
import { t, tf, tp } from '../../shared/i18n';
import { formatCount } from '../../shared/i18n/format';
import {
  CheckIcon,
  FocusableSurface,
  Text,
  colors,
  components,
  rounded,
  spacing,
  type HostView,
} from '../../shared/ui';

const OPTION = components['poll-option'];
/** The accent check's box (DESIGN.md PollOption «chosen»). */
const CHECK_SIZE = 16;

export type PollWidgetProps = {
  /** The focus id `post/<postId>/block/poll:<pollId>`. */
  id: string;
  poll: Poll;
  /** The host view by focus id (initial focus, the column's guide). */
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
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
 * Results are always shown, also before a vote (the reference). In this
 * story the whole poll is one focus stop (a ring, no scale, as ImageStop)
 * and its options are not focusable; OK does nothing. Voting (Stories
 * 6.6–6.7) makes an open poll's options focusable.
 */
export const PollWidget = memo(function PollWidgetView({ id, poll, onView, onFocus }: PollWidgetProps) {
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
      {poll.options.map((option, index) => {
        const chosen = isChosen(poll, option.id);
        return (
          <View
            key={option.id}
            testID={`${id}/option/${option.id}`}
            focusable={false}
            accessible={false}
            style={styles.option}
          >
            <View
              testID={`${id}/option/${option.id}/bar`}
              style={[styles.bar, { width: `${pollBarPercent(option.fraction)}%` }]}
            />
            <View style={styles.optionContent}>
              {chosen ? (
                <View style={styles.check}>
                  <CheckIcon
                    testID={`${id}/option/${option.id}/chosen`}
                    color={OPTION.chosenMark}
                    size={CHECK_SIZE}
                  />
                </View>
              ) : null}
              <Text variant="body" numberOfLines={2} style={styles.optionText}>
                {optionText(option, index)}
              </Text>
              <Text
                variant="body"
                color={chosen ? 'accent-text' : 'text-secondary'}
                style={styles.percent}
              >
                {resultText(option)}
              </Text>
            </View>
          </View>
        );
      })}
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
});

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
});
