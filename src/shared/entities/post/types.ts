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

export type Block =
  | {
      type: 'text';
      /** Plain text of the fragment (style ranges are Epic 6). */
      text: string;
      /** `modificator: BLOCK_END`: the paragraph ends here. */
      paragraphEnd: boolean;
    }
  | { type: 'link'; text: string; url: string | null }
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
  | { type: 'file'; id: string | null; title: string; sizeBytes: number | null }
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
  /** False when `hasAccess` is false or `data` is empty (api-contract §7). */
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
};

/** One E5 page: the posts and the opaque cursor of the next page. */
export type PostPage = {
  posts: Post[];
  /** Null on the last page (`isLast`, or no `extra`/`offset`). */
  nextCursor: string | null;
};
