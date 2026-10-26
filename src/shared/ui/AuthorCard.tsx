import { memo, type Ref } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { Author } from '../entities/author';
import { t, tf } from '../i18n';
import { FocusableSurface, type FocusableSurfaceProps, type HostView } from './FocusableSurface';
import { Text } from './Text';
import { useItemState } from './useItemState';
import { colors, components, rounded, spacing } from './tokens';

/**
 * DESIGN.md AuthorCard (Story 3.2): the avatar on the left, then the blog
 * title (2 lines) and the owner name (1 line). No «Мой блог» label yet (its
 * flag is off), no price, no subscribe or manage action.
 *
 * The width is the grid's: the token width (232) leaves no horizontal focus
 * headroom in the 720 dp content (3 × 232 + 2 × 12 = 720), so the grid
 * passes a narrower tile (`authorCardWidth`), as the feed does for PostCard.
 */

const TOKENS = components['author-card'];
export const AUTHOR_CARD_HEIGHT = TOKENS.height;
const AVATAR = TOKENS.avatar;
const PADDING_X = spacing['6'];
const TEXT_GAP = spacing['6'];
const OWNER_GAP = spacing['1'];

/** Tile width for `columns` tiles in `contentWidth`, with focus headroom on both sides. */
export function authorCardWidth(contentWidth: number, columns: number): number {
  const inner =
    contentWidth - 2 * spacing['focus-headroom'] - (columns - 1) * spacing['author-tile-gap'];
  return Math.floor(inner / columns);
}

/** The visible title: the blog title, else «Без названия» (as PostCard). */
export function authorCardTitle(author: Author): string {
  return author.title.length > 0 ? author.title : t('postCard.untitled');
}

/** «{title}. {owner}», or the title alone without an owner name. */
export function authorCardA11yLabel(author: Author): string {
  const title = authorCardTitle(author);
  return author.ownerName ? tf('authorCard.a11y', { title, owner: author.ownerName }) : title;
}

export type AuthorCardProps = {
  author: Author;
  width: number;
  testID?: string;
  onFocus?: FocusableSurfaceProps['onFocus'];
  /** Not wired in Story 3.2 (the Author screen comes in 3.3). */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<HostView>;
};

function Avatar({ url, testID }: { url: string | null; testID?: string }) {
  // Recycled cells (ADR 0011): a failure belongs to one URL only.
  const [failed, setFailed] = useItemState(false, url ?? undefined);
  return url && !failed ? (
    <Image
      // Keyed by the URL: a recycled cell never shows the previous author's
      // avatar while the new one loads (only this view remounts).
      key={url}
      testID={testID}
      source={{ uri: url }}
      resizeMethod="resize"
      fadeDuration={0}
      style={styles.avatar}
      onError={() => setFailed(true)}
      accessibilityIgnoresInvertColors
    />
  ) : (
    <View
      testID={testID ? `${testID}-placeholder` : undefined}
      style={[styles.avatar, styles.placeholder]}
    />
  );
}

export function AuthorCardView({
  author,
  width,
  testID,
  onFocus,
  onPress,
  style,
  ref,
}: AuthorCardProps) {
  return (
    <FocusableSurface
      ref={ref}
      testID={testID}
      radius={TOKENS.radius}
      scaleFocus={TOKENS.scaleFocus}
      accessibilityRole="button"
      accessibilityLabel={authorCardA11yLabel(author)}
      onFocus={onFocus}
      onPress={onPress}
      style={style}
      resetKey={author.blogUrl}
      surfaceStyle={({ focused }) => [
        styles.surface,
        { width },
        focused && styles.surfaceFocused,
      ]}
    >
      {({ focused }) => (
        // Flat on purpose (Story 3.1 lesson: native view creation dominates
        // mount cost): the avatar Image, one layout-only column (flattened
        // by Fabric) and two Texts.
        <>
          <Avatar url={author.avatarUrl} testID={testID ? `${testID}/avatar` : undefined} />
          <View style={styles.text}>
            <Text
              testID={testID ? `${testID}/title` : undefined}
              variant="card-title"
              color={focused ? 'text' : 'text-card'}
              numberOfLines={2}
            >
              {authorCardTitle(author)}
            </Text>
            {author.ownerName ? (
              <Text
                testID={testID ? `${testID}/owner` : undefined}
                variant="meta"
                color="text-meta"
                numberOfLines={1}
                style={styles.owner}
              >
                {author.ownerName}
              </Text>
            ) : null}
          </View>
        </>
      )}
    </FocusableSurface>
  );
}

/**
 * Memoized: a tile re-renders only when its own props change (a focus move
 * re-renders only the focus state inside FocusableSurface).
 */
export const AuthorCard = memo(AuthorCardView);

/** DESIGN.md Skeleton: a non-focusable block with the tile's geometry. */
export function AuthorCardSkeleton({
  width,
  testID,
  style,
}: {
  width: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      testID={testID}
      style={[styles.surface, styles.skeleton, { width }, style]}
      focusable={false}
    >
      <View style={[styles.avatar, styles.placeholder]} />
      <View style={styles.text}>
        <View style={[styles.skeletonLine, styles.skeletonTitle]} />
        <View style={[styles.skeletonLine, styles.skeletonNext, styles.skeletonOwner]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // No `overflow` or `opacity`: the ring is a child of this view
  // (`surfaceRules.test.tsx`).
  surface: {
    height: AUTHOR_CARD_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PADDING_X,
    borderRadius: TOKENS.radius,
    backgroundColor: colors.surface,
  },
  surfaceFocused: {
    backgroundColor: colors['surface-focus-row'],
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: rounded.full,
  },
  placeholder: {
    backgroundColor: colors['surface-raised'],
  },
  text: {
    flex: 1,
    marginLeft: TEXT_GAP,
  },
  owner: {
    marginTop: OWNER_GAP,
  },
  skeleton: {
    backgroundColor: colors.skeleton,
  },
  skeletonLine: {
    height: spacing['6'],
    borderRadius: rounded.sm,
    backgroundColor: colors['surface-raised'],
  },
  skeletonTitle: {
    width: '80%',
  },
  skeletonOwner: {
    width: '50%',
  },
  skeletonNext: {
    marginTop: spacing['4'],
  },
});
