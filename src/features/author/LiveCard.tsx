import { memo, useEffect, useState, type Ref } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { Stream } from '../../shared/entities/stream';
import { t, tf, tp } from '../../shared/i18n';
import { formatCount, formatStreamStart } from '../../shared/i18n/format';
import {
  FocusableSurface,
  Text,
  colors,
  components,
  rounded,
  spacing,
  type FocusableSurfaceProps,
  type HostView,
} from '../../shared/ui';

/**
 * DESIGN.md LiveCard / UX-DR8 (Story 7.1, LIVE-01): the author's live or
 * scheduled stream, between the action row and the posts. A 192×108 cover
 * with the badge (LIVE on `colors.live`, or «Запланирован»), then the
 * status line, the title and one detail line:
 * - live: «N зрителей · M лайков»;
 * - scheduled: «Начало сегодня в 19:00» as the status, the likes only (no
 *   viewer count);
 * - needs a level (`hasAccess: false`, either status): «Нужен уровень
 *   «X»» in place of the counts; never a price.
 * One fixed size in every state (no reflow when a refetch changes it). OK
 * does nothing in Story 7.1 (owner decision 2026-10-30, Q2 b): watching is
 * Story 7.2, like and share Story 7.4.
 */

const TOKENS = components['live-card'];
const BADGE = components.badge;
const [COVER_WIDTH, COVER_HEIGHT] = TOKENS.cover.split('x').map(Number);
const PADDING = (TOKENS.height - COVER_HEIGHT) / 2;
/** Room above and below the card for the 1.03 scale and the ring. */
const FOCUS_ROOM = spacing['3'];
/** The gap between the action row (or the header) and the card's block. */
const LIVE_CARD_TOP = spacing['4'];
/** The whole block the card takes above the grid (for the grid's bounded height). */
export const LIVE_CARD_BLOCK_HEIGHT = LIVE_CARD_TOP + TOKENS.height + 2 * FOCUS_ROOM;

export type LiveCardState = 'live' | 'scheduled' | 'needsLevel';

/** Exactly one state per stream: no access wins, then the status. */
export function liveCardState(stream: Stream): LiveCardState {
  return !stream.hasAccess ? 'needsLevel' : stream.status;
}

export function liveCardTitle(stream: Stream): string {
  return stream.title.length > 0 ? stream.title : t('author.live.untitled');
}

function count(key: 'author.live.viewers' | 'author.live.likes', n: number): string {
  return tp(key, n).replace('{n}', formatCount(n));
}

export function liveCardStatus(stream: Stream, nowMs?: number): string {
  if (stream.status === 'live') {
    return t('author.live.statusLive');
  }
  return stream.startTime !== null
    ? tf('author.live.statusScheduled', { when: formatStreamStart(stream.startTime, nowMs) })
    : t('author.live.statusScheduledNoTime');
}

/** The detail line: the counts, or the level the stream needs (never a price). */
export function liveCardDetails(stream: Stream): string {
  if (!stream.hasAccess) {
    return stream.levelName !== null
      ? tf('author.live.needsLevel', { level: stream.levelName })
      : t('author.live.noAccess');
  }
  return stream.status === 'live'
    ? tf('author.live.stats', {
        viewers: count('author.live.viewers', stream.viewers),
        likes: count('author.live.likes', stream.likes),
      })
    : count('author.live.likes', stream.likes);
}

export function liveCardA11yLabel(stream: Stream, nowMs?: number): string {
  return tf('author.live.a11y', {
    title: liveCardTitle(stream),
    status: liveCardStatus(stream, nowMs),
    details: liveCardDetails(stream),
  });
}

export type LiveCardProps = {
  stream: Stream;
  testID: string;
  /** Epoch ms for the start time (tests); defaults to now. */
  nowMs?: number;
  onFocus?: FocusableSurfaceProps['onFocus'];
  ref?: Ref<HostView>;
};

function LiveCardView({ stream, testID, nowMs, onFocus, ref }: LiveCardProps) {
  const state = liveCardState(stream);
  const live = stream.status === 'live';
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => setCoverFailed(false), [stream.coverUrl]);
  const cover = stream.coverUrl && !coverFailed ? stream.coverUrl : null;
  return (
    <FocusableSurface
      ref={ref}
      testID={testID}
      radius={rounded.lg}
      scaleFocus={TOKENS.scaleFocus}
      // Not a button while OK does nothing (Story 7.2 adds watching).
      accessibilityRole="summary"
      accessibilityLabel={liveCardA11yLabel(stream, nowMs)}
      onFocus={onFocus}
      style={styles.slot}
      surfaceStyle={({ focused }) => [
        styles.surface,
        { backgroundColor: focused ? colors['surface-raised'] : colors.surface },
      ]}
    >
      <View style={styles.cover}>
        {cover ? (
          <Image
            key={cover}
            testID={`${testID}/cover`}
            source={{ uri: cover }}
            resizeMode="cover"
            resizeMethod="resize"
            fadeDuration={0}
            onError={() => setCoverFailed(true)}
            style={styles.coverImage}
            accessibilityIgnoresInvertColors
          />
        ) : null}
        <Text
          testID={`${testID}/badge`}
          variant="badge"
          numberOfLines={1}
          style={[styles.badge, live ? styles.badgeLive : styles.badgeScheduled]}
        >
          {live ? t('author.live.badgeLive') : t('author.live.badgeScheduled')}
        </Text>
      </View>
      <View style={styles.text}>
        <Text testID={`${testID}/status`} variant="body-s" color="text-secondary" numberOfLines={1}>
          {liveCardStatus(stream, nowMs)}
        </Text>
        <Text variant="section" numberOfLines={2} style={styles.title}>
          {liveCardTitle(stream)}
        </Text>
        <Text
          testID={`${testID}/details`}
          variant="meta"
          color={state === 'needsLevel' ? 'accent-text' : 'text-meta'}
          numberOfLines={1}
          style={styles.details}
        >
          {liveCardDetails(stream)}
        </Text>
      </View>
    </FocusableSurface>
  );
}

export const LiveCard = memo(LiveCardView);

const styles = StyleSheet.create({
  slot: {
    alignSelf: 'flex-start',
    marginVertical: FOCUS_ROOM,
  },
  // Same size in every state; no `overflow` or `opacity` (the ring lives here).
  surface: {
    width: TOKENS.width,
    height: TOKENS.height,
    padding: PADDING,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cover: {
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
    borderRadius: rounded.md,
    backgroundColor: colors.skeleton,
    overflow: 'hidden',
  },
  coverImage: {
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
  },
  badge: {
    ...BADGE.text,
    position: 'absolute',
    top: spacing['3'],
    left: spacing['3'],
    height: BADGE.height,
    lineHeight: BADGE.height,
    textAlignVertical: 'center',
    borderRadius: BADGE.radius,
    paddingHorizontal: spacing['3'],
    color: colors.text,
    overflow: 'hidden',
  },
  badgeLive: {
    backgroundColor: TOKENS.badge,
  },
  badgeScheduled: {
    backgroundColor: BADGE.bg,
  },
  text: {
    flex: 1,
    marginLeft: spacing['8'],
    justifyContent: 'center',
  },
  title: {
    marginTop: spacing['2'],
  },
  details: {
    marginTop: spacing['2'],
  },
});

/** The guide's styles: the block above the grid (see `LIVE_CARD_BLOCK_HEIGHT`). */
export const liveCardBlockStyle = {
  marginTop: LIVE_CARD_TOP,
  marginLeft: spacing['focus-headroom'],
  height: TOKENS.height + 2 * FOCUS_ROOM,
  width: spacing['content-width'] - 2 * spacing['focus-headroom'],
} as const;
