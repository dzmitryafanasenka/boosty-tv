import { memo, useMemo } from 'react';
import type { OpenImages, ViewerImage } from '../ImageViewer';
import { StyleSheet, View } from 'react-native';
import type { Comment } from '../../../shared/entities/comment';
import { postBodyItems, type PostBodyItem } from '../../../shared/entities/post';
import { useColumnStop, type StopFocusHandler, type StopViewHandler } from '../../../shared/focus';
import { joinSentences, t, tf } from '../../../shared/i18n';
import { formatCardDate } from '../../../shared/i18n/format';
import { AuthorAvatar, FocusableSurface, Text, components, spacing, type SurfaceState } from '../../../shared/ui';
import { TeaserImage } from '../body/ImageBlocks';
import { BlockPlaceholder, EmojiParagraph, Heading } from '../body/TextBlocks';

const ROW = components['comment-row'];

/**
 * A comment's content items: the shared post block mapper with images and
 * without chips (links stay plain text, no QR); unknown blocks are skipped.
 */
export function commentItems(comment: Comment): PostBodyItem[] {
  return postBodyItems(comment.blocks, { images: true }).filter(
    item => !(item.kind === 'placeholder' && item.block === 'unknown'),
  );
}

/** The row's spoken text: «{name}. ответ {to}. {content}. {date}», without the missing parts. */
export function commentA11yLabel(comment: Comment, items: readonly PostBodyItem[], nowMs?: number): string {
  const content =
    comment.hidden === 'deleted'
      ? t('post.comments.deleted')
      : comment.hidden === 'blocked'
        ? t('post.comments.blocked')
        : items
            .map(item =>
              item.kind === 'paragraph' || item.kind === 'heading'
                ? item.text
                : item.kind === 'image'
                  ? t('post.block.image')
                  : item.kind === 'placeholder'
                    ? t(`post.block.${item.block}`)
                    : '',
            )
            .map(part => part.trim())
            .filter(part => part.length > 0)
            .join(' ');
  return joinSentences(
    [
      comment.author.name,
      comment.replyTo !== null ? tf('post.comments.replyTo', { name: comment.replyTo.name }) : '',
      content,
      formatCardDate(comment.createdAt, nowMs),
    ].filter(part => part.trim().length > 0),
  );
}

/**
 * The width of a comment's content column (its images' box): the row at
 * most the text measure, minus the row surface's horizontal padding, the
 * avatar and its gap; a reply also loses one indent step. Null until the
 * column is measured.
 */
export function commentContentWidth(columnWidth: number | null, isReply: boolean): number | null {
  if (columnWidth === null) {
    return null;
  }
  const row = Math.min(columnWidth, spacing['text-measure']) - (isReply ? ROW.indent : 0);
  return Math.max(0, row - 2 * ROW.gap - ROW.avatar - ROW.gap);
}

export type CommentRowProps = {
  /** `post/<postId>/` + `comment/<commentId>` (`postCommentId`). */
  id: string;
  comment: Comment;
  /** The column's measured inner width (images); null until measured. */
  columnWidth: number | null;
  /** A reply: shifted right by one indent step (its content is narrower). */
  isReply?: boolean;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
  /**
   * Story 11.2 (owner decision 2026-11-02): OK on a comment with images
   * opens the viewer on its first image (← → through this comment's
   * images); a comment without images keeps OK as a no-op.
   */
  onOpenImages?: OpenImages;
  nowMs?: number;
};

/**
 * DESIGN.md CommentRow (Story 11.2, COMM-01, read-only): one focus stop for
 * the whole comment. OK opens the image viewer on the comment's first image
 * when it has images (role button); without images OK does nothing (role
 * text). The avatar (or the placeholder),
 * the name and «ответ <name>» on a reply, the content (text with emoji and
 * images through the shared body pieces, none of them focusable; links as
 * plain text) and the date. A deleted or blocked comment shows its note
 * instead of the content and keeps its author and date. Focused: the ring
 * and the row surface, no scale (a 600 dp row scaled past the column would
 * overlap its neighbours). No reply, like, report or delete control.
 */
export const CommentRow = memo(function CommentRowView({
  id,
  comment,
  columnWidth,
  isReply = false,
  onView,
  onFocus,
  onOpenImages,
  nowMs,
}: CommentRowProps) {
  const { ref, viewRef, handleFocus } = useColumnStop(id, onView, onFocus);
  const items = useMemo(() => (comment.hidden === null ? commentItems(comment) : []), [comment]);
  const images = useMemo<ViewerImage[]>(
    () => items.flatMap(item => (item.kind === 'image' ? [{ url: item.url }] : [])),
    [items],
  );
  const opens = onOpenImages !== undefined && images.length > 0;
  const baseLabel = useMemo(() => commentA11yLabel(comment, items, nowMs), [comment, items, nowMs]);
  const label = opens ? joinSentences([baseLabel, t('post.imageViewer.a11yOpenComment')]) : baseLabel;
  const surfaceStyle = ({ focused }: SurfaceState) => [
    styles.surface,
    focused ? styles.surfaceFocused : null,
  ];
  const textWidth = commentContentWidth(columnWidth, isReply);
  return (
    <FocusableSurface
      ref={ref}
      testID={id}
      radius={ROW.radius}
      scaleFocus={1}
      scalePressed={1}
      accessibilityRole={opens ? 'button' : 'text'}
      accessibilityLabel={label}
      onPress={opens ? () => onOpenImages(images, 0, viewRef) : undefined}
      onFocus={handleFocus}
      surfaceStyle={surfaceStyle}
      style={styles.row}
    >
      <View style={styles.line}>
        <AuthorAvatar url={comment.author.avatarUrl} testID={`${id}/avatar`} size={ROW.avatar} />
        <View style={styles.main}>
          <View style={styles.names}>
            <Text testID={`${id}/name`} variant="button" numberOfLines={1} style={styles.name}>
              {comment.author.name}
            </Text>
            {comment.replyTo !== null ? (
              <Text testID={`${id}/reply-to`} variant="meta" color="text-meta" numberOfLines={1} style={styles.replyTo}>
                {tf('post.comments.replyTo', { name: comment.replyTo.name })}
              </Text>
            ) : null}
          </View>
          {comment.hidden !== null ? (
            <Text testID={`${id}/hidden`} variant="body-s" color="text-tertiary" style={styles.note}>
              {t(comment.hidden === 'deleted' ? 'post.comments.deleted' : 'post.comments.blocked')}
            </Text>
          ) : (
            <View testID={`${id}/content`} style={styles.content}>
              {items.map(item => {
                const itemId = `${id}/content/${item.key}`;
                switch (item.kind) {
                  case 'paragraph':
                    return <EmojiParagraph key={item.key} id={itemId} segments={item.segments} />;
                  case 'heading':
                    return <Heading key={item.key} id={itemId} text={item.text} />;
                  case 'image':
                    return (
                      <TeaserImage
                        key={item.key}
                        id={itemId}
                        url={item.url}
                        width={item.width}
                        height={item.height}
                        maxHeight={ROW.imageMaxHeight}
                        columnWidth={textWidth}
                      />
                    );
                  case 'placeholder':
                    return <BlockPlaceholder key={item.key} id={itemId} kind={item.block} />;
                  default:
                    return null;
                }
              })}
            </View>
          )}
          <Text testID={`${id}/date`} variant="meta" color="text-meta">
            {formatCardDate(comment.createdAt, nowMs)}
          </Text>
        </View>
      </View>
    </FocusableSurface>
  );
});

const styles = StyleSheet.create({
  row: {
    marginBottom: ROW.rowGap,
  },
  surface: {
    paddingVertical: ROW.rowGap,
    paddingHorizontal: ROW.gap,
  },
  surfaceFocused: {
    backgroundColor: ROW.bgFocus,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  main: {
    flex: 1,
    marginLeft: ROW.gap,
  },
  names: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  name: {
    flexShrink: 1,
  },
  replyTo: {
    flexShrink: 1,
    marginLeft: ROW.gap,
  },
  note: {
    marginVertical: ROW.rowGap,
  },
  content: {
    marginTop: ROW.rowGap,
  },
});
