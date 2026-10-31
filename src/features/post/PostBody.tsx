import { View } from 'react-native';
import { AudioBlock, type ResolveAudioSource } from '../player';
import { PollWidget } from '../polls';
import type { HttpClient } from '../../shared/api';
import type { PostBodyItem } from '../../shared/entities/post';
import type { StopFocusHandler, StopViewHandler } from '../../shared/focus';
import type { OpenPost, OpenQr, PlayAt, ResolveFileTarget } from './body/chipParts';
import { ExternalVideoChip } from './body/ExternalVideoChip';
import { FileChip } from './body/FileChip';
import { ImageStop, TeaserImage } from './body/ImageBlocks';
import { LinkChips } from './body/LinkChips';
import { BlockPlaceholder, EmojiParagraph, Heading, ParagraphStop } from './body/TextBlocks';

export type { OpenPost, OpenQr, PlayAt, ResolveFileTarget } from './body/chipParts';
export { IMAGE_STOP_MAX_HEIGHT, TEASER_IMAGE_GAP } from './body/ImageBlocks';
export { PostBodySkeleton } from './body/PostBodySkeleton';
export {
  PostPrimaryAction,
  PostVideoRows,
  type OpenPlayer,
  type PostPrimaryActionProps,
  type PostVideoRowsProps,
} from './body/VideoActions';

export type PostBodyProps = {
  items: readonly PostBodyItem[];
  /** `post/<postId>/block/` */
  idPrefix: string;
  onParagraphView: StopViewHandler;
  onParagraphFocus: StopFocusHandler;
  /** The tallest a teaser image may be (Story 3.6, fits the viewport). */
  imageMaxHeight: number;
  /** The column's measured inner width (teaser images); null until measured. */
  columnWidth: number | null;
  /** Story 6.3: OK on a chip opens the QrDialog. */
  onOpenQr?: OpenQr;
  /** Story 6.3: a file chip's QR target (a fresh E8). */
  resolveFile?: ResolveFileTarget;
  /** Story 6.3: OK on a link to another Boosty post opens it. */
  onOpenPost?: OpenPost;
  /** Story 6.3 (option b): OK on a timestamp link plays this post's video from that time. */
  onPlayAt?: PlayAt;
  /** Story 6.4: an audio block's source when playback starts (a fresh E8). */
  resolveAudio?: ResolveAudioSource;
  /** Story 6.4: false while Пост is not the focused route (a playing track pauses). */
  active?: boolean;
  /**
   * Story 6.6: voting in an open single-choice poll: the active session's
   * client, the post's identity (E10, the E8 query key) and the option focus
   * id prefix (`post/<postId>/poll/option/`). Absent: the poll is display only.
   * Story 6.7: also «Проголосовать» and «Отозвать голос» of an open
   * multiple-choice poll (`post/<postId>/poll/submit|retract`).
   */
  pollVote?: {
    http: HttpClient;
    blogUrl: string;
    postId: string;
    optionIdPrefix: string;
    submitId: string;
    retractId: string;
  };
};

/**
 * The post's blocks below the rows, in order (ids
 * `post/<postId>/block/<blockKey>`). Paragraphs, placeholders and a locked
 * post's teaser images are capped at the text measure, left-aligned (owner
 * decision 2026-10-27). A thin composer: each block kind lives in
 * `./body/` (text, images, link / file / external-video chips, the video
 * rows and the primary action); polls come from `features/polls`, audio
 * from `features/player`.
 */
export function PostBody({
  items,
  idPrefix,
  onParagraphView,
  onParagraphFocus,
  imageMaxHeight,
  columnWidth,
  onOpenQr,
  resolveFile,
  onOpenPost,
  onPlayAt,
  resolveAudio,
  active = true,
  pollVote,
}: PostBodyProps) {
  return (
    <>
      {items.map(item => {
        const id = `${idPrefix}${item.key}`;
        switch (item.kind) {
          case 'paragraph': {
            // Emoji only (no plain text): shown, never a focus stop.
            const paragraph =
              item.text.length === 0 ? (
                <EmojiParagraph key={item.key} id={id} segments={item.segments} />
              ) : (
                <ParagraphStop
                  key={item.key}
                  id={id}
                  text={item.text}
                  segments={item.segments}
                  onView={onParagraphView}
                  onFocus={onParagraphFocus}
                />
              );
            if (item.links.length === 0) {
              return paragraph;
            }
            // Story 6.3: the link chips right under their paragraph.
            return (
              <View key={item.key} testID={`${id}/links`}>
                {paragraph}
                <LinkChips
                  idPrefix={idPrefix}
                  links={item.links}
                  onView={onParagraphView}
                  onFocus={onParagraphFocus}
                  onOpenQr={onOpenQr}
                  onOpenPost={onOpenPost}
                  onPlayAt={onPlayAt}
                />
              </View>
            );
          }
          case 'file':
            return (
              <FileChip
                key={item.key}
                id={id}
                fileKey={item.key}
                title={item.title}
                sizeBytes={item.sizeBytes}
                onView={onParagraphView}
                onFocus={onParagraphFocus}
                onOpenQr={onOpenQr}
                resolveFile={resolveFile}
              />
            );
          case 'audio':
            return (
              <AudioBlock
                key={item.key}
                id={id}
                audioKey={item.key}
                title={item.title}
                durationSec={item.durationSec}
                resolveSource={resolveAudio}
                active={active}
                onView={onParagraphView}
                onFocus={onParagraphFocus}
              />
            );
          case 'externalVideo':
            return (
              <ExternalVideoChip
                key={item.key}
                id={id}
                url={item.url}
                youtubeId={item.youtubeId}
                onView={onParagraphView}
                onFocus={onParagraphFocus}
                onOpenQr={onOpenQr}
              />
            );
          case 'heading':
            return <Heading key={item.key} id={id} text={item.text} />;
          case 'poll':
            // Story 6.5: results, one focus stop; Story 6.6: an open
            // single-choice poll's options are stops that take a vote; Story
            // 6.7: an open multiple-choice poll's checkboxes and buttons.
            return (
              <PollWidget
                key={item.key}
                id={id}
                poll={item.poll}
                onView={onParagraphView}
                onFocus={onParagraphFocus}
                http={pollVote?.http}
                blogUrl={pollVote?.blogUrl}
                postId={pollVote?.postId}
                optionIdPrefix={pollVote?.optionIdPrefix}
                submitId={pollVote?.submitId}
                retractId={pollVote?.retractId}
              />
            );
          case 'image':
            return item.stop ? (
              <ImageStop
                key={item.key}
                id={id}
                url={item.url}
                width={item.width}
                height={item.height}
                columnWidth={columnWidth}
                onView={onParagraphView}
                onFocus={onParagraphFocus}
              />
            ) : (
              <TeaserImage
                key={item.key}
                id={id}
                url={item.url}
                width={item.width}
                height={item.height}
                maxHeight={imageMaxHeight}
                columnWidth={columnWidth}
              />
            );
          default:
            return <BlockPlaceholder key={item.key} id={id} kind={item.block} />;
        }
      })}
    </>
  );
}
