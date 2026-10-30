import { memo, useEffect, useState, type Ref } from 'react';
import { Image, StyleSheet, TVFocusGuideView, View } from 'react-native';
import type { AppErrorKind } from '../../shared/api';
import type { Stream } from '../../shared/entities/stream';
import { t, tf, tp } from '../../shared/i18n';
import { formatCount, formatStreamStart } from '../../shared/i18n/format';
import {
  Button,
  buttonInk,
  FocusableSurface,
  HeartIcon,
  Text,
  colors,
  components,
  rounded,
  spacing,
  typography,
  type FocusableSurfaceProps,
  type HostView,
} from '../../shared/ui';

/**
 * DESIGN.md LiveCard / UX-DR8 (Story 7.1, LIVE-01): the author's live or
 * scheduled stream, between the action row and the posts. A 192×108 cover
 * with the badge (LIVE on `colors.live`, or «Запланирован»), then the
 * status line, the title and one detail line:
 * - live: «N зрителей» (Story 7.4, owner decision Q1 a: with access the
 *   likes are on «Нравится» right of the card, so the line drops them;
 *   without access the level line replaces the counts anyway);
 * - scheduled: «Начало сегодня в 19:00» as the status, the likes only (no
 *   viewer count);
 * - needs a level (`hasAccess: false`, either status): «Нужен уровень
 *   «X»» in place of the counts; never a price.
 * One fixed size in every state (no reflow when a refetch changes it).
 * Story 7.2: OK (`onPress`) opens the live player when the card is playable
 * (`liveCardPlayable`), else the stream page's QR. Story 7.4: «Нравится» and
 * «Поделиться» are `LiveCardActions`, beside the card in the same block.
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
/** The block's width (the guide; see `liveCardBlockStyle`). */
const BLOCK_WIDTH = spacing['content-width'] - 2 * spacing['focus-headroom'];
/** Story 7.4: the gap between the card and the action column. */
const ACTIONS_GAP = spacing['8'];
/** Story 7.4: the like's failure slot: two `meta` lines. */
export const LIKE_ERROR_HEIGHT = 2 * typography.meta.lineHeight;
/** Story 7.4: one small button and the gap under it (the column's stops). */
export const LIVE_ACTION_STOP_HEIGHT = components['button-small'].height + spacing['3'];
/** Story 7.4: the action column's width: the rest of the block right of the card. */
const ACTIONS_WIDTH = BLOCK_WIDTH - TOKENS.width - ACTIONS_GAP;

export type LiveCardState = 'live' | 'scheduled' | 'needsLevel';

/** Exactly one state per stream: no access wins, then the status. */
export function liveCardState(stream: Stream): LiveCardState {
  return !stream.hasAccess ? 'needsLevel' : stream.status;
}

/**
 * Story 7.2 (LIVE-02): OK may open the live player: the stream is live, the
 * account has access, and E15 listed at least one live-edge URL. Every other
 * card (scheduled, needs a level, no URL) shows the stream page's QR.
 */
export function liveCardPlayable(stream: Stream): boolean {
  return stream.status === 'live' && stream.hasAccess && stream.hasLiveSources;
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
  // Story 7.4 (Q1 a): a live card with access shows its likes on «Нравится».
  return stream.status === 'live'
    ? count('author.live.viewers', stream.viewers)
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
  /** Story 7.2: OK: the live player or the QR (the page decides). */
  onPress?: () => void;
  ref?: Ref<HostView>;
};

function LiveCardView({ stream, testID, nowMs, onFocus, onPress, ref }: LiveCardProps) {
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
      // Story 7.2: OK opens the player or the QR (a button only with an action).
      accessibilityRole={onPress ? 'button' : 'summary'}
      accessibilityLabel={liveCardA11yLabel(stream, nowMs)}
      onFocus={onFocus}
      onPress={onPress}
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
  // Story 7.4: within the card's own vertical extent (top-aligned with it),
  // so ↓ from the card never finds «Поделиться» and the block never grows.
  actions: {
    width: ACTIONS_WIDTH,
    height: TOKENS.height,
    marginLeft: ACTIONS_GAP,
    marginTop: FOCUS_ROOM,
    alignItems: 'flex-start',
  },
  action: {
    marginBottom: spacing['3'],
  },
  // A fixed slot of two meta lines (no reflow when a failure appears).
  actionError: {
    alignSelf: 'stretch',
    height: LIKE_ERROR_HEIGHT,
  },
});

/** The guide's styles: the block above the grid (see `LIVE_CARD_BLOCK_HEIGHT`). */
export const liveCardBlockStyle = {
  marginTop: LIVE_CARD_TOP,
  marginLeft: spacing['focus-headroom'],
  height: TOKENS.height + 2 * FOCUS_ROOM,
  width: BLOCK_WIDTH,
} as const;

/** Story 7.4: the card and its actions side by side inside the block (no height change). */
export const liveCardRowStyle = {
  flexDirection: 'row',
  alignItems: 'flex-start',
} as const;

/** The like's a11y label: «Нравится, N» / «Вам нравится, N» (the visible label is the heart and N; owner decision Q1 a). */
export function liveLikeA11yLabel(stream: Pick<Stream, 'isLiked' | 'likes'>): string {
  return tf(stream.isLiked ? 'author.live.likedA11y' : 'author.live.likeA11y', { n: formatCount(stream.likes) });
}

export type LiveCardActionsProps = {
  stream: Stream;
  /** Owner decision Q2 a: «Нравится» only for a live stream with access; «Поделиться» always. */
  likeShown: boolean;
  likeId: string;
  shareId: string;
  /** The like's last failure (`error.<kind>` under the buttons); null: none. */
  likeError: AppErrorKind | null;
  /** A like request runs (OK on it is ignored by the toggle; announced as busy). */
  likeSending: boolean;
  likeHostRef: (view: HostView | null) => void;
  shareHostRef: (view: HostView | null) => void;
  onLikeFocus: () => void;
  onShareFocus: () => void;
  onLikePress: () => void;
  onSharePress: () => void;
  /** The column guide's destination (→ from the card): the like, else share. */
  entry: HostView | null;
};

/**
 * Story 7.4 (LIVE-04/05, docs/focus-map.md §4 D): «Нравится» (a heart and
 * the count, in the accent when liked) above «Поделиться», in a column
 * right of the card, inside the card's 120 dp: the block's height never
 * changes. The column is a `TVFocusGuideView` whose destination is the like
 * (else share), so → from the card always lands there; inside it ↑ ↓ move
 * natively, ← reaches the card. The failure line sits under the buttons, in
 * a slot that is always there (no reflow), as a polite live region.
 */
function LiveCardActionsView({
  stream,
  likeShown,
  likeId,
  shareId,
  likeError,
  likeSending,
  likeHostRef,
  shareHostRef,
  onLikeFocus,
  onShareFocus,
  onLikePress,
  onSharePress,
  entry,
}: LiveCardActionsProps) {
  const destinations = entry ? [entry] : [];
  return (
    <TVFocusGuideView testID="author/live/actions" destinations={destinations} style={styles.actions}>
      {likeShown ? (
        <Button
          ref={likeHostRef}
          testID={likeId}
          kind="secondary"
          size="small"
          label={formatCount(stream.likes)}
          accessibilityLabel={liveLikeA11yLabel(stream)}
          selected={stream.isLiked}
          icon={
            <HeartIcon
              testID={`${likeId}/heart${stream.isLiked ? '/filled' : ''}`}
              filled={stream.isLiked}
              color={buttonInk({ kind: 'secondary', selected: stream.isLiked })}
              size={16}
            />
          }
          accessibilityBusy={likeSending}
          onFocus={onLikeFocus}
          onPress={onLikePress}
          style={styles.action}
        />
      ) : null}
      <Button
        ref={shareHostRef}
        testID={shareId}
        kind="secondary"
        size="small"
        label={t('author.live.share')}
        accessibilityLabel={t('author.live.shareA11y')}
        onFocus={onShareFocus}
        onPress={onSharePress}
        style={styles.action}
      />
      <Text
        testID={`${likeId}/error`}
        variant="meta"
        color="error-text"
        numberOfLines={2}
        accessibilityLiveRegion="polite"
        style={styles.actionError}
      >
        {likeShown && likeError !== null ? t(`error.${likeError}`) : ''}
      </Text>
    </TVFocusGuideView>
  );
}

export const LiveCardActions = memo(LiveCardActionsView);
