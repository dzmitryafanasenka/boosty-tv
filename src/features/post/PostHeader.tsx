import type { Ref } from 'react';
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

/** «12 окт · 5 лайков», or the date alone when the post has no like count. */
export function postMetaLine(post: Post, nowMs?: number): string {
  const date = formatCardDate(post.publishedAt, nowMs);
  return post.likeCount === null ? date : tf('post.meta', { date, likes: likesLabel(post.likeCount) });
}

type AuthorRowProps = {
  post: Post;
  testID: string;
  onFocus: () => void;
  onPress: () => void;
  ref?: Ref<HostView>;
};

/** The author row: avatar and name; OK opens Автор. The left column's only focus stop. */
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
};

/**
 * The left column (focus-map §4 F): the author row (OK → Автор), the title
 * (≤ 6 lines; fallback: the first text, then «Без названия», as PostCard)
 * and the meta line «date · N лайков» (the like count is read-only, never
 * focusable; no comment count).
 */
export function PostHeader({
  post,
  authorId,
  onAuthorFocus,
  onAuthorPress,
  authorRef,
  nowMs,
}: PostHeaderProps) {
  return (
    <View testID="post/header">
      <AuthorRow
        ref={authorRef}
        post={post}
        testID={authorId}
        onFocus={onAuthorFocus}
        onPress={onAuthorPress}
      />
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
    </View>
  );
}

/** The left column's skeleton: an avatar circle and three lines, not focusable. */
export function PostHeaderSkeleton() {
  return (
    <View testID="post/header-skeleton" focusable={false}>
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
    width: '50%',
    marginLeft: spacing['4'],
  },
  skeletonTitle: {
    width: '90%',
    marginTop: spacing['8'],
  },
  skeletonTitleShort: {
    width: '60%',
    marginTop: spacing['4'],
  },
  skeletonMeta: {
    width: '40%',
    marginTop: spacing['6'],
  },
});
