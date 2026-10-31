import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ParagraphLink } from '../../../shared/entities/post';
import { useColumnStop, type StopFocusHandler, type StopViewHandler } from '../../../shared/focus';
import { t, tf } from '../../../shared/i18n';
import { FocusableSurface, Text, focus, spacing } from '../../../shared/ui';
import {
  CHIP,
  ChipGuide,
  QrSuffix,
  chipStyles,
  chipSurface,
  type OpenPost,
  type OpenQr,
  type PlayAt,
} from './chipParts';

type LinkChipProps = {
  id: string;
  link: ParagraphLink;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
  onOpenQr?: OpenQr;
  onOpenPost?: OpenPost;
  onPlayAt?: PlayAt;
};

/** What OK on a link chip does: play at a time, open a post, else the QR. */
type LinkAction = 'play' | 'post' | 'qr';

/**
 * DESIGN.md LinkChip (Story 6.3, `link-chip` tokens): a 32 dp pill under its
 * paragraph with the link text and a «QR» suffix. OK opens the QrDialog for
 * the link (nothing opens on the TV); focus returns here when it closes. A
 * link to another Boosty post (owner decision 2026-10-29) reads «<text> ·
 * Открыть» with no QR suffix, and OK opens that post in the app instead. A
 * timestamp link to a video of this post (option b) reads «<text> ·
 * Смотреть» and OK plays that video from that time. Without the handler
 * (no route to push, the player off) a chip falls back to the QR.
 */
const LinkChip = memo(function LinkChipView({
  id,
  link,
  onView,
  onFocus,
  onOpenQr,
  onOpenPost,
  onPlayAt,
}: LinkChipProps) {
  const { ref, viewRef, handleFocus } = useColumnStop(id, onView, onFocus);
  const { text, url, post, timestamp } = link;
  const action: LinkAction =
    timestamp !== null && onPlayAt !== undefined
      ? 'play'
      : post !== null && onOpenPost !== undefined
        ? 'post'
        : 'qr';
  const onPress = useCallback(() => {
    if (action === 'play' && timestamp !== null) {
      onPlayAt?.(timestamp.mediaId, timestamp.seconds, id);
    } else if (action === 'post' && post !== null) {
      onOpenPost?.(post.blogUrl, post.postId);
    } else {
      onOpenQr?.(text, url, viewRef);
    }
  }, [action, timestamp, post, onPlayAt, onOpenPost, onOpenQr, id, text, url, viewRef]);
  // The action word is its own text, so a long link text is cut before it,
  // never the action (device: «… · От…»).
  const suffix =
    action === 'play' ? t('post.chip.watchSuffix') : action === 'post' ? t('post.chip.openSuffix') : null;
  const a11yLabel =
    action === 'play'
      ? tf('post.chip.a11yWatchAt', { label: text })
      : action === 'post'
        ? tf('post.chip.a11yOpenPost', { label: text })
        : tf('post.chip.a11y', { label: text });
  return (
    <FocusableSurface
      ref={ref}
      testID={id}
      radius={CHIP.height / 2}
      scaleFocus={focus['scale-button']}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      onFocus={handleFocus}
      surfaceStyle={chipSurface}
      style={styles.chipGap}
    >
      <View style={chipStyles.chipContent}>
        <Text variant="button-s" numberOfLines={1} style={chipStyles.chipLabel}>
          {text}
        </Text>
        {suffix === null ? (
          <QrSuffix testID={id} />
        ) : (
          <Text testID={`${id}/action`} variant="button-s" style={styles.actionSuffix}>
            {suffix}
          </Text>
        )}
      </View>
    </FocusableSurface>
  );
});

/** A paragraph's link chips (Story 6.3), in one wrapping row under it: ← → move between them. */
export function LinkChips({
  idPrefix,
  links,
  onView,
  onFocus,
  onOpenQr,
  onOpenPost,
  onPlayAt,
}: {
  idPrefix: string;
  links: readonly ParagraphLink[];
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
  onOpenQr?: OpenQr;
  onOpenPost?: OpenPost;
  onPlayAt?: PlayAt;
}) {
  return (
    <ChipGuide testID={`${idPrefix}${links[0].key}/guide`}>
      <View style={styles.chipRow}>
        {links.map(link => (
          <LinkChip
            key={link.key}
            id={`${idPrefix}${link.key}`}
            link={link}
            onView={onView}
            onFocus={onFocus}
            onOpenQr={onOpenQr}
            onOpenPost={onOpenPost}
            onPlayAt={onPlayAt}
          />
        ))}
      </View>
    </ChipGuide>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    maxWidth: spacing['text-measure'],
    marginTop: -spacing['3'],
    marginBottom: spacing['4'],
  },
  chipGap: {
    marginRight: spacing['4'],
    marginBottom: spacing['4'],
  },
  actionSuffix: {
    marginLeft: spacing['2'],
  },
});
