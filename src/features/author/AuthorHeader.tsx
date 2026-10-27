import { StyleSheet, View } from 'react-native';
import type { Author } from '../../shared/entities/author';
import { tf } from '../../shared/i18n';
import {
  AuthorAvatar,
  Text,
  authorCardTitle,
  colors,
  components,
  rounded,
  spacing,
} from '../../shared/ui';

const AVATAR = components.avatar.authorHeader;
/** The header row's fixed height (the avatar). */
export const AUTHOR_HEADER_HEIGHT = AVATAR;

/** «Автор: {title}. {owner}», or without the owner name. */
export function authorHeaderA11yLabel(author: Author): string {
  const title = authorCardTitle(author);
  return author.ownerName
    ? tf('author.a11yHeader', { title, owner: author.ownerName })
    : tf('author.a11yHeaderNoOwner', { title });
}

/**
 * The Author page header (Story 3.3, E3): the avatar (placeholder when
 * none), the blog title («Без названия» fallback) and the owner name line
 * only when present. Not focusable. No description, cover, counters, price
 * or subscribe action.
 */
export function AuthorHeader({ author, testID }: { author: Author; testID: string }) {
  return (
    <View
      testID={testID}
      style={styles.root}
      accessible
      accessibilityRole="header"
      accessibilityLabel={authorHeaderA11yLabel(author)}
    >
      <AuthorAvatar url={author.avatarUrl} testID={`${testID}/avatar`} size={AVATAR} />
      <View style={styles.text}>
        <Text testID={`${testID}/title`} variant="title-m" numberOfLines={1}>
          {authorCardTitle(author)}
        </Text>
        {author.ownerName ? (
          <Text
            testID={`${testID}/owner`}
            variant="meta"
            color="text-meta"
            numberOfLines={1}
            style={styles.owner}
          >
            {author.ownerName}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The header's skeleton: a non-focusable avatar circle and two lines. */
export function AuthorHeaderSkeleton({ testID }: { testID: string }) {
  return (
    <View testID={testID} style={styles.root} focusable={false}>
      <View style={[styles.skeletonAvatar]} />
      <View style={styles.text}>
        <View style={[styles.skeletonLine, styles.skeletonTitle]} />
        <View style={[styles.skeletonLine, styles.skeletonOwner]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    height: AUTHOR_HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing['focus-headroom'],
  },
  text: {
    flex: 1,
    marginLeft: spacing['6'],
  },
  owner: {
    marginTop: spacing['1'],
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
  skeletonTitle: {
    width: '40%',
  },
  skeletonOwner: {
    width: '25%',
    marginTop: spacing['4'],
  },
});
