import type { ReactNode, Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Post } from '../../shared/entities/post';
import { tf, tp } from '../../shared/i18n';
import { formatCardDate } from '../../shared/i18n/format';
import {
  AuthorAvatar,
  FocusableSurface,
  Text,
  colors,
  components,
  focus,
  postCardTitle,
  rounded,
  spacing,
  type HostView,
  type SurfaceState,
} from '../../shared/ui';

const AVATAR = components.avatar.post;
const ROW = components['setting-row'];
/** The title's line limit (DESIGN.md Post screen). */
export const POST_TITLE_LINES = 6;

/** «5 лайков»; the `ru` forms carry `{n}`. */
export function likesLabel(n: number): string {
  return tp('post.likes', n).replace('{n}', String(n));
}

/** «29 комментариев» (Story 11.2); the `ru` forms carry `{n}`. */
export function commentCountLabel(n: number): string {
  return tp('post.commentCount', n).replace('{n}', String(n));
}

/**
 * «12 окт · 5 лайков · 29 комментариев» (Story 11.2): the date, then the like
 * count and the comment count, each left out when the API gives none (the
 * comment count also when the author turned comments off).
 */
export function postMetaLine(post: Post, nowMs?: number): string {
  const date = formatCardDate(post.publishedAt, nowMs);
  const head = post.likeCount === null ? date : tf('post.meta', { date, likes: likesLabel(post.likeCount) });
  // The author turned comments off: no count (the block says so instead).
  return post.commentCount === null || post.commentsDenied
    ? head
    : tf('post.metaMore', { head, part: commentCountLabel(post.commentCount) });
}

type AuthorRowProps = {
  post: Post;
  testID: string;
  onFocus: () => void;
  onPress: () => void;
  ref?: Ref<HostView>;
};

/**
 * The author row: avatar and name; OK opens Автор. The header's only focus
 * stop, as wide as its content (at most the text measure), at the left.
 */
function AuthorRow({ post, testID, onFocus, onPress, ref }: AuthorRowProps) {
  const surfaceStyle = ({ focused }: SurfaceState) => [
    styles.authorSurface,
    { backgroundColor: focused ? ROW.bgFocus : 'transparent' },
  ];
  return (
    <FocusableSurface
      ref={ref}
      testID={testID}
      radius={ROW.radius}
      scaleFocus={focus['scale-row']}
      accessibilityRole="button"
      accessibilityLabel={tf('post.a11yAuthor', { name: post.author.name })}
      onFocus={onFocus}
      onPress={onPress}
      surfaceStyle={surfaceStyle}
      style={styles.author}
    >
      <View style={styles.authorRow}>
        <AuthorAvatar url={post.author.avatarUrl} testID={`${testID}/avatar`} size={AVATAR} />
        <Text variant="button" numberOfLines={1} style={styles.authorName}>
          {post.author.name}
        </Text>
      </View>
    </FocusableSurface>
  );
}

export type PostHeaderProps = {
  post: Post;
  authorId: string;
  onAuthorFocus: () => void;
  onAuthorPress: () => void;
  authorRef?: Ref<HostView>;
  nowMs?: number;
  /**
   * Story 13.1: the author row only (a video post: the title and the meta
   * line move into `PostHero`).
   */
  authorOnly?: boolean;
  /** Story 13.1: the action row under the meta line («На телефоне»). */
  actions?: ReactNode;
};

/**
 * The header on top of the Post column (focus-map §4 F; owner decision
 * 2026-10-27, not pinned: it scrolls away with the content). The header
 * container spans the content width; inside it: the author row (OK → Автор,
 * as wide as its content), the title
 * (≤ 6 lines; fallback: the first text, then «Без названия», as PostCard)
 * and the meta line «date · N лайков · M комментариев» (Story 11.2; both
 * counts are read-only and never focusable; each is left out when the API
 * gives none). Story 13.1: a video post shows the author row only
 * (`authorOnly`; `PostHero` follows), any other post its `actions` («На
 * телефоне») under the meta line.
 */
export function PostHeader({
  post,
  authorId,
  onAuthorFocus,
  onAuthorPress,
  authorRef,
  nowMs,
  authorOnly = false,
  actions,
}: PostHeaderProps) {
  return (
    <View testID="post/header" style={styles.header}>
      <AuthorRow
        ref={authorRef}
        post={post}
        testID={authorId}
        onFocus={onAuthorFocus}
        onPress={onAuthorPress}
      />
      {authorOnly ? null : (
        <>
          <Text
            testID="post/title"
            variant="title-s"
            accessibilityRole="header"
            numberOfLines={POST_TITLE_LINES}
            style={styles.title}
          >
            {postCardTitle(post)}
          </Text>
          <Text testID="post/meta" variant="meta" color="text-meta" style={styles.meta}>
            {postMetaLine(post, nowMs)}
          </Text>
          {actions ? <View style={styles.actions}>{actions}</View> : null}
        </>
      )}
    </View>
  );
}

/** The header's skeleton: an avatar circle and three lines, not focusable. */
export function PostHeaderSkeleton() {
  return (
    <View testID="post/header-skeleton" focusable={false} style={styles.header}>
      <View style={styles.authorRow}>
        <View style={styles.skeletonAvatar} />
        <View style={[styles.skeletonLine, styles.skeletonName]} />
      </View>
      <View style={[styles.skeletonLine, styles.skeletonTitle]} />
      <View style={[styles.skeletonLine, styles.skeletonTitleShort]} />
      <View style={[styles.skeletonLine, styles.skeletonMeta]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Room between the header and the first row or paragraph.
  header: {
    marginBottom: spacing['10'],
  },
  author: {
    alignSelf: 'flex-start',
    maxWidth: spacing['text-measure'],
  },
  authorSurface: {
    minHeight: ROW.minHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing['4'],
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  authorName: {
    flexShrink: 1,
    marginLeft: spacing['4'],
  },
  title: {
    marginTop: spacing['8'],
  },
  meta: {
    marginTop: spacing['6'],
  },
  actions: {
    marginTop: spacing['8'],
  },
  skeletonAvatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: rounded.full,
    backgroundColor: colors.skeleton,
  },
  skeletonLine: {
    height: spacing['6'],
    borderRadius: rounded.sm,
    backgroundColor: colors.skeleton,
  },
  skeletonName: {
    width: '30%',
    marginLeft: spacing['4'],
  },
  skeletonTitle: {
    width: '80%',
    marginTop: spacing['8'],
  },
  skeletonTitleShort: {
    width: '50%',
    marginTop: spacing['4'],
  },
  skeletonMeta: {
    width: '20%',
    marginTop: spacing['6'],
  },
});
