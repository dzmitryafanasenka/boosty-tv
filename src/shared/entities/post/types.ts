import type { Poll } from '../poll/types';

/**
 * The Post entity (AD-8, AD-9): portable domain types, no raw DTO fields.
 *
 * Never part of the domain: `timeCode` (progress is read only through Epic
 * 4's ProgressRepository), `playerUrls` and `signedQuery` (signed, 24 h,
 * account-scoped), comments and prices. Identity is `post.id` and, for
 * media, the `ok_video` id; never an index or a URL.
 */

export type ListItem = {
  blocks: Block[];
  items: ListItem[];
};

/** A style of a text run (api-contract §4.1 codes: 0 bold, 2 italic, 4 underline). */
export type TextStyle = 'bold' | 'italic' | 'underline';

/**
 * One style range of a `text`/`link` fragment (Story 6.1): `from` and `len`
 * are JavaScript string offsets (UTF-16 code units). Live, `from` counts
 * from the start of the fragment's paragraph (api-contract §4.1 «Text
 * styles and smile (LIVE)»), so the paragraph builder places the range and
 * clamps it to the fragment. `from` ≥ 0, `len` > 0 (other ranges are dropped).
 */
export type TextSpan = { style: TextStyle; from: number; len: number };

export type Block =
  | {
      type: 'text';
      /** Plain text of the fragment. */
      text: string;
      /** Its style ranges (Story 6.1); unknown codes are dropped. */
      spans: TextSpan[];
      /** `modificator: BLOCK_END`: the paragraph ends here. */
      paragraphEnd: boolean;
    }
  | { type: 'link'; text: string; spans: TextSpan[]; url: string | null }
  /**
   * An inline emoji (Story 6.1): its image (`mediumUrl`, else `largeUrl`,
   * else `smallUrl`), a plain URL loaded with no auth headers; null when the
   * block has none (the emoji takes no space).
   */
  | { type: 'smile'; name: string; url: string | null }
  | {
      type: 'image';
      id: string | null;
      url: string | null;
      width: number | null;
      height: number | null;
    }
  | {
      type: 'ok_video';
      /** Media identity (progress, routes); never the URL. */
      id: string;
      title: string;
      /** Seconds, when the API gives it. */
      durationSec: number | null;
      previewUrl: string | null;
    }
  | { type: 'audio_file'; id: string | null; title: string; durationSec: number | null }
  /**
   * A file (Story 6.3): its title and size only. Its `url` needs
   * `Post.signedQuery` (403 without it, live): it is read beside the mapper
   * from a fresh E8 when the QR opens (`PostRepository.fileTarget`), never
   * kept here.
   */
  | { type: 'file'; id: string | null; title: string; sizeBytes: number | null }
  /**
   * An external video page (Story 6.3; live: a YouTube `watch` URL): never
   * played in the app, only shown as a QR. `url` is null unless it is an
   * absolute http(s) URL.
   */
  | { type: 'video'; url: string | null }
  /**
   * A heading (Story 6.3, owner decision 2026-10-29 Q1 b; not in the
   * reference): `content` in the `text` format, its plain text here.
   */
  | { type: 'header'; text: string }
  | { type: 'poll'; id: string | null }
  | { type: 'list'; items: ListItem[] }
  /** Any other or malformed block: the unsupported-block placeholder. */
  | { type: 'unknown'; rawType: string };

export type BlockType = Block['type'];

/**
 * What the card badge says (DESIGN.md PostCard): Видео, N видео, Аудио,
 * Текст и фото, Опрос, Файл, Нет доступа.
 */
export type PostKind =
  | { kind: 'video' }
  | { kind: 'videos'; count: number }
  | { kind: 'audio' }
  | { kind: 'poll' }
  | { kind: 'file' }
  | { kind: 'text' }
  | { kind: 'locked' };

export type PostAuthor = {
  name: string;
  blogUrl: string;
  avatarUrl: string | null;
};

export type Post = {
  id: string;
  intId: number;
  /** Empty when the post has no title. */
  title: string;
  /** Epoch seconds: `publishTime`, else `createdAt`. */
  publishedAt: number;
  author: PostAuthor;
  /** False when `hasAccess` is false, or `data` is empty and there is no usable top-level poll (api-contract §7, Story 6.5). */
  hasAccess: boolean;
  blocks: Block[];
  /** Shown when the post is locked (usually one image). */
  teaser: Block[];
  kind: PostKind;
  /** First video preview → first image → teaser image → none. */
  previewUrl: string | null;
  /** Seconds, only for a post with exactly one video whose duration is known. */
  durationSec: number | null;
  /** The level name, only if the post carries one. Never a price. */
  levelName: string | null;
  /** `count.likes` (read-only, Story 3.4); null when the API gives none. */
  likeCount: number | null;
  /** `isPinned`: the author pinned it (E4 puts it first); the Author page marks it. */
  pinned: boolean;
  /**
   * Story 6.5: the post's poll (live: the top-level `poll`, api-contract
   * §4.2). Null when there is none, the post is locked (a teaser shows no
   * poll, Story 3.6) or the poll is malformed (`pollUnsupported`).
   */
  poll: Poll | null;
  /**
   * Story 6.5: an accessible post carries a top-level `poll` that the
   * mapper rejected (the reference would drop it): the body shows the
   * «Опрос» placeholder instead. `id`: its raw `id` as a string, when it has
   * one (a `poll` block of that id, or an id-less one, shows the
   * placeholder in place). Null when there is no rejected poll.
   */
  pollUnsupported: { id: string | null } | null;
};

/** One E5 page: the posts and the opaque cursor of the next page. */
export type PostPage = {
  posts: Post[];
  /** Null on the last page (`isLast`, or no `extra`/`offset`). */
  nextCursor: string | null;
};

/**
 * E8: the post, or `unavailable` for a missing one (404 `not_found`:
 * «Пост недоступен», no retry).
 */
export type PostResult = { kind: 'ok'; post: Post } | { kind: 'unavailable' };

/**
 * A playable item (AD-9): the post's blog, the post and the `ok_video` id.
 * The only media identity for keys, focus ids, routes and progress (Epic
 * 4); never an index, a URL, `timeCode` or a signed value.
 */
export type MediaRef = {
  blogUrl: string;
  postId: string;
  mediaId: string;
};

/**
 * One MediaRow of the Post screen (Story 3.5): a video of an accessible
 * post, in block order. `index` is its position among the rows (0-based;
 * the row reads «Видео {index + 1}»), for display only, never identity.
 */
export type VideoRow = {
  ref: MediaRef;
  index: number;
  /** Empty when the video has no title. */
  title: string;
  /** Seconds, when the API gives it. */
  durationSec: number | null;
  previewUrl: string | null;
};

/**
 * Story 4.2: receives a video's server progress (`ok_video.timeCode`, whole
 * seconds) from an E8. Only the ProgressRepository provides one; the value
 * never enters the Post entity, a query cache value, a route or a log.
 */
export type ServerProgressSink = (mediaId: string, positionSec: number) => void;
