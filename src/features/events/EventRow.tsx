import { memo, useCallback, type Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Event } from '../../shared/entities/event';
import { t, tf } from '../../shared/i18n';
import { formatCardDate } from '../../shared/i18n/format';
import {
  AuthorAvatar,
  FocusableSurface,
  Text,
  colors,
  components,
  spacing,
  type FocusableSurfaceProps,
  type HostView,
  type SurfaceState,
} from '../../shared/ui';

const TOKENS = components['event-row'];
const BADGE = components.badge;

/** The row's text by type (Q3 a): a stream start, a new post or promo, else the generic text. */
export function eventText(event: Pick<Event, 'type'>): string {
  switch (event.type) {
    case 'video_stream_start':
      return t('events.text.streamStart');
    case 'post_new':
      return t('events.text.postNew');
    case 'promo_new':
      return t('events.text.promoNew');
    default:
      return t('events.text.generic');
  }
}

/** The author's name, or «Автор» when the event has none. */
export function eventAuthorName(event: Pick<Event, 'authorName'>): string {
  return event.authorName ?? t('events.noName');
}

/**
 * «{name}: {text}. {time}», prefixed with «Новое.» while unread; a stream
 * row also reads its visible «Эфир» chip before the time.
 */
export function eventRowA11yLabel(event: Event, nowMs?: number): string {
  const values = {
    name: eventAuthorName(event),
    text: eventText(event),
    chip: t('events.streamChip'),
    time: formatCardDate(event.time, nowMs),
  };
  if (event.kind === 'stream') {
    return event.isRead ? tf('events.a11yStream', values) : tf('events.a11yStreamUnread', values);
  }
  return event.isRead ? tf('events.a11y', values) : tf('events.a11yUnread', values);
}

export type EventRowProps = {
  event: Event;
  testID: string;
  onFocus?: FocusableSurfaceProps['onFocus'];
  /** OK (stable); called with the event's id. */
  onPress: (eventId: string) => void;
  ref?: Ref<HostView>;
  /** Test clock for the time line. */
  nowMs?: number;
};

/**
 * DESIGN.md EventRow (Story 7.5, `event-row` tokens): the unread dot (its
 * slot stays when read, so the rows line up), the avatar, the author's name
 * and the text on one ellipsized line, a «Эфир» chip for a stream start and
 * the time. Focused: ring, `surface-focus-row` and the row scale (no
 * reflow). `resetKey` is the event id (recycled rows, ADR 0011).
 */
export const EventRow = memo(function EventRowView({ event, testID, onFocus, onPress, ref, nowMs }: EventRowProps) {
  const surfaceStyle = useCallback(
    ({ focused }: SurfaceState) => [styles.surface, focused && { backgroundColor: TOKENS.bgFocus }],
    [],
  );
  const id = event.id;
  const press = useCallback(() => onPress(id), [onPress, id]);
  return (
    <FocusableSurface
      ref={ref}
      testID={testID}
      resetKey={id}
      radius={TOKENS.radius}
      scaleFocus={TOKENS.scaleFocus}
      accessibilityRole="button"
      accessibilityLabel={eventRowA11yLabel(event, nowMs)}
      onFocus={onFocus}
      onPress={press}
      surfaceStyle={surfaceStyle}
    >
      <View
        testID={event.isRead ? undefined : `${testID}/dot`}
        style={[styles.dot, !event.isRead && styles.dotUnread]}
      />
      <View style={styles.avatar}>
        <AuthorAvatar url={event.avatarUrl} size={TOKENS.avatar} testID={`${testID}/avatar`} />
      </View>
      <Text testID={`${testID}/line`} variant="body-s" color="text-card" numberOfLines={1} style={styles.line}>
        <Text variant="card-title">{eventAuthorName(event)}</Text>
        {tf('events.afterName', { text: eventText(event) })}
      </Text>
      {event.kind === 'stream' ? (
        <Text testID={`${testID}/chip`} variant="badge" numberOfLines={1} style={styles.chip}>
          {t('events.streamChip')}
        </Text>
      ) : null}
      <Text testID={`${testID}/time`} variant="meta" color="text-meta" numberOfLines={1} style={styles.time}>
        {formatCardDate(event.time, nowMs)}
      </Text>
    </FocusableSurface>
  );
});

/** A placeholder row of the skeleton (not focusable). */
export function EventRowSkeleton() {
  return (
    <View style={[styles.surface, styles.skeleton]} focusable={false}>
      <View style={styles.dot} />
      <View style={[styles.avatar, styles.skeletonAvatar]} />
      <View style={styles.skeletonLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  // No `overflow` or `opacity`: the ring is a child of this view.
  surface: {
    width: TOKENS.width,
    height: TOKENS.height,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing['6'],
    paddingRight: spacing['8'],
    backgroundColor: TOKENS.bg,
  },
  dot: {
    width: TOKENS.dot,
    height: TOKENS.dot,
    borderRadius: TOKENS.dot / 2,
  },
  dotUnread: {
    backgroundColor: colors.accent,
  },
  avatar: {
    width: TOKENS.avatar,
    height: TOKENS.avatar,
    marginLeft: spacing['6'],
  },
  line: {
    flex: 1,
    marginLeft: spacing['6'],
  },
  chip: {
    ...BADGE.text,
    height: BADGE.height,
    lineHeight: BADGE.height,
    textAlignVertical: 'center',
    borderRadius: BADGE.radius,
    paddingHorizontal: spacing['3'],
    marginLeft: spacing['6'],
    color: colors.text,
    backgroundColor: TOKENS.chip,
    overflow: 'hidden',
  },
  time: {
    marginLeft: spacing['6'],
  },
  skeleton: {
    backgroundColor: colors.skeleton,
    borderRadius: TOKENS.radius,
  },
  skeletonAvatar: {
    borderRadius: TOKENS.avatar / 2,
    backgroundColor: colors['surface-raised'],
  },
  skeletonLine: {
    flex: 1,
    height: 12,
    marginLeft: spacing['6'],
    marginRight: spacing['12'],
    borderRadius: 4,
    backgroundColor: colors['surface-raised'],
  },
});
