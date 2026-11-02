import { memo, useCallback, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useColumnStop, type StopFocusHandler, type StopViewHandler } from '../../../shared/focus';
import { tf } from '../../../shared/i18n';
import { formatDuration } from '../../../shared/i18n/format';
import { FocusableSurface, PlayIcon, Text, colors, focus, spacing, type SurfaceState } from '../../../shared/ui';
import { CHIP, ChipGuide, type OpenQr, type PlayAt } from './chipParts';

/**
 * Story 13.2 (mockup `Chapters`, `link-chip` tokens): the content of a
 * timestamp chip, «▶ time  title» on one line (the title ellipsized), or
 * «▶ time» without a title. The time is semibold in the accent text colour;
 * focused, the chip inverts (light fill, dark ink) and the time loses its
 * accent. `list`: the time gets its minimum width, so a chapter list lines
 * its titles up.
 */
export function TimeChipContent({
  testID,
  seconds,
  title,
  focused,
  list,
}: {
  testID: string;
  seconds: number;
  /** Null: the time alone. */
  title: string | null;
  focused: boolean;
  list: boolean;
}) {
  const ink = focused ? styles.inkFocused : null;
  return (
    <View style={styles.content}>
      <PlayIcon testID={`${testID}/play`} color={focused ? CHIP.inkFocusTime : colors['accent-text']} size={CHIP.playSize} />
      <Text
        testID={`${testID}/time`}
        variant="card-title"
        color="accent-text"
        numberOfLines={1}
        style={[styles.time, list ? styles.timeList : null, ink]}
      >
        {formatDuration(seconds)}
      </Text>
      {title !== null ? (
        <Text testID={`${testID}/title`} variant="body-s" numberOfLines={1} style={[styles.title, ink]}>
          {title}
        </Text>
      ) : null}
    </View>
  );
}

/** The timestamp chip's surface: `surface-raised`, inverted when focused. */
export const timeChipSurface = ({ focused }: SurfaceState) => [
  styles.surface,
  { backgroundColor: focused ? CHIP.bgFocusTime : CHIP.bg },
];

/** The chip's title, or null when the line had none (the title is then the time itself). */
const shownTitle = (title: string, seconds: number) => (title === formatDuration(seconds) ? null : title);

/** The TalkBack label of a timestamp chip that plays: «Смотреть с 0:20: Что тут происходит?». */
export function watchFromLabel(seconds: number, title: string | null): string {
  const time = formatDuration(seconds);
  return title === null ? tf('post.chip.a11yWatchFromTime', { time }) : tf('post.chip.a11yWatchFrom', { time, title });
}

type TimestampChipProps = {
  id: string;
  mediaId: string;
  seconds: number;
  title: string;
  url: string;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
  onOpenQr?: OpenQr;
  onPlayAt?: PlayAt;
};

/**
 * Story 13.2: a text line that starts with a timestamp of this post's video,
 * as one chip «▶ time  title» (a column stop in its own full-measure guide,
 * like a FileChip, so ↑ ↓ reach it from wide paragraphs). OK plays the video
 * from that second (Story 6.3 `onPlayAt`; focus returns here after the
 * Player); without `onPlayAt` (the player off) OK opens the link's QR.
 */
export const TimestampChip = memo(function TimestampChipView({
  id,
  mediaId,
  seconds,
  title,
  url,
  onView,
  onFocus,
  onOpenQr,
  onPlayAt,
}: TimestampChipProps) {
  const { ref, viewRef, handleFocus } = useColumnStop(id, onView, onFocus);
  const shown = shownTitle(title, seconds);
  const time = formatDuration(seconds);
  const label = shown === null ? time : tf('post.chip.timeLabel', { time, title: shown });
  const plays = onPlayAt !== undefined;
  const onPress = useCallback(() => {
    if (onPlayAt !== undefined) {
      onPlayAt(mediaId, seconds, id);
    } else {
      onOpenQr?.(label, url, viewRef);
    }
  }, [onPlayAt, onOpenQr, mediaId, seconds, id, label, url, viewRef]);
  return (
    <ChipGuide testID={`${id}/guide`}>
      <FocusableSurface
        ref={ref}
        testID={id}
        radius={CHIP.height / 2}
        scaleFocus={focus['scale-row']}
        accessibilityRole="button"
        accessibilityLabel={plays ? watchFromLabel(seconds, shown) : tf('post.chip.a11y', { label })}
        onPress={onPress}
        onFocus={handleFocus}
        surfaceStyle={timeChipSurface}
        style={styles.alone}
      >
        {({ focused }) => <TimeChipContent testID={id} seconds={seconds} title={shown} focused={focused} list />}
      </FocusableSurface>
    </ChipGuide>
  );
});

/** Consecutive timestamp lines (Story 13.2): one tight list, in post order. */
export function TimestampList({ testID, children }: { testID: string; children: ReactNode }) {
  return (
    <View testID={testID} style={styles.list}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    height: CHIP.height,
    maxWidth: spacing['text-measure'],
    paddingLeft: CHIP.timePadLeft,
    paddingRight: CHIP.timePadRight,
    justifyContent: 'center',
    // The mockup scales the focused chip from its left edge.
    transformOrigin: 'left',
  },
  alone: {
    alignSelf: 'flex-start',
    maxWidth: spacing['text-measure'],
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: CHIP.timeGap,
  },
  time: {
    flexShrink: 0,
  },
  timeList: {
    minWidth: CHIP.timeMinWidth,
  },
  title: {
    flexShrink: 1,
  },
  inkFocused: {
    color: CHIP.inkFocusTime,
  },
  list: {
    gap: CHIP.listGap,
    marginBottom: spacing['6'],
  },
});
