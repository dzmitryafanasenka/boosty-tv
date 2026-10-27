import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PlaceholderKind, PostBodyItem } from '../../shared/entities/post';
import { useZoneItem } from '../../shared/focus';
import { t } from '../../shared/i18n';
import {
  FocusableSurface,
  Text,
  colors,
  rounded,
  spacing,
  type HostView,
  type SurfaceState,
} from '../../shared/ui';

/** DESIGN.md ParagraphStop: the focused paragraph's accent bar. */
const BAR_WIDTH = 2;

type ParagraphStopProps = {
  id: string;
  text: string;
  /** The host view by focus id (initial focus, the column's guide). */
  onView: (id: string, view: HostView | null) => void;
  onFocus: (id: string) => void;
};

/**
 * DESIGN.md ParagraphStop: one paragraph, one focus stop (owner decision
 * 2026-10-27, option A, before Story 6.1's collapse). Focused: a subtle
 * `surface` background and a 2 dp accent bar on the left; no scale and no
 * ring. The bar's width is always reserved, so focus never reflows the text.
 * OK does nothing.
 */
const ParagraphStop = memo(function ParagraphStopView({ id, text, onView, onFocus }: ParagraphStopProps) {
  const zone = useZoneItem(id);
  const zoneRef = zone.ref;
  const ref = useCallback(
    (view: HostView | null) => {
      zoneRef?.(view);
      onView(id, view);
    },
    [zoneRef, onView, id],
  );
  const handleFocus = useCallback(() => {
    zone.onFocus();
    onFocus(id);
  }, [zone, onFocus, id]);
  const surfaceStyle = ({ focused }: SurfaceState) => [
    styles.paragraph,
    focused ? styles.paragraphFocused : null,
  ];
  return (
    <FocusableSurface
      ref={ref}
      testID={id}
      radius={rounded.sm}
      scaleFocus={1}
      ring={false}
      accessibilityRole="text"
      accessibilityLabel={text}
      onFocus={handleFocus}
      surfaceStyle={surfaceStyle}
      style={styles.gap}
    >
      <Text variant="body">{text}</Text>
    </FocusableSurface>
  );
});

/** The neutral, non-focusable placeholder of a block shown in later stories. */
function BlockPlaceholder({ id, kind }: { id: string; kind: PlaceholderKind }) {
  const label = t(`post.block.${kind}`);
  return (
    <View
      testID={id}
      focusable={false}
      accessible
      accessibilityLabel={label}
      style={[styles.placeholder, styles.gap]}
    >
      <Text variant="body-s" color="text-tertiary" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export type PostBodyProps = {
  items: readonly PostBodyItem[];
  /** `post/<postId>/block/` */
  idPrefix: string;
  onParagraphView: (id: string, view: HostView | null) => void;
  onParagraphFocus: (id: string) => void;
};

/** The right column's blocks, in order (ids `post/<postId>/block/<blockKey>`). */
export function PostBody({ items, idPrefix, onParagraphView, onParagraphFocus }: PostBodyProps) {
  return (
    <>
      {items.map(item =>
        item.kind === 'paragraph' ? (
          <ParagraphStop
            key={item.key}
            id={`${idPrefix}${item.key}`}
            text={item.text}
            onView={onParagraphView}
            onFocus={onParagraphFocus}
          />
        ) : (
          <BlockPlaceholder key={item.key} id={`${idPrefix}${item.key}`} kind={item.block} />
        ),
      )}
    </>
  );
}

/** The right column's skeleton: a few non-focusable text lines. */
export function PostBodySkeleton() {
  return (
    <View testID="post/body-skeleton" focusable={false}>
      {[100, 92, 96, 60, 0, 100, 88, 70].map((width, i) =>
        width === 0 ? (
          <View key={i} style={styles.skeletonBreak} />
        ) : (
          <View key={i} style={[styles.skeletonLine, { width: `${width}%` }]} />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: {
    marginBottom: spacing['6'],
  },
  paragraph: {
    paddingVertical: spacing['3'],
    paddingRight: spacing['4'],
    paddingLeft: spacing['4'],
    borderLeftWidth: BAR_WIDTH,
    borderLeftColor: 'transparent',
  },
  paragraphFocused: {
    backgroundColor: colors.surface,
    borderLeftColor: colors.accent,
  },
  placeholder: {
    paddingVertical: spacing['5'],
    paddingHorizontal: spacing['6'],
    borderRadius: rounded.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skeletonLine: {
    height: spacing['6'],
    borderRadius: rounded.sm,
    backgroundColor: colors.skeleton,
    marginBottom: spacing['4'],
  },
  skeletonBreak: {
    height: spacing['6'],
  },
});
