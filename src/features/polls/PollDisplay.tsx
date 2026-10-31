import { isChosen, type Poll } from '../../shared/entities/poll';
import { useColumnStop, type StopFocusHandler, type StopViewHandler } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { FocusableSurface, Text, rounded } from '../../shared/ui';
import { ResultRow } from './PollParts';
import { pollAccessibilityLabel, shownPollTitle, votersText } from './pollLabels';
import { pollStyles as styles } from './pollStyles';

export type PollDisplayProps = {
  /** The focus id `post/<postId>/block/poll:<pollId>` (votable: the root's testID only). */
  id: string;
  poll: Poll;
  /** The host view by focus id (initial focus, the column's guide). */
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
};

/** Story 6.5: the whole poll is one focus stop; OK does nothing. */
export function PollDisplay({ id, poll, onView, onFocus }: PollDisplayProps) {
  const { ref, handleFocus } = useColumnStop(id, onView, onFocus);
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
        {shownPollTitle(poll)}
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
