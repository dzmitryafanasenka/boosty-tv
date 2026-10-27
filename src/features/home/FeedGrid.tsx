import {
  POST_GRID_CARD_HEIGHT,
  POST_GRID_CARD_WIDTH,
  POST_GRID_COLUMNS,
  POST_GRID_DRAW_DISTANCE,
  POST_GRID_LIST_TOP_GAP,
  POST_GRID_RECYCLE_POOL,
  POST_GRID_ROW_HEIGHT,
  POST_GRID_SLOT_PADDING,
  PostGrid,
  postGridListAdapter,
  postGridRowLayout,
  postGridRows,
  visibleGridPosts,
  type PostGridProps,
  type PostRowItem,
} from '../../shared/ui';
import { t } from '../../shared/i18n';

/**
 * The «Новое в подписках» grid: the shared `PostGrid` (`shared/ui`, also
 * the Author page) with Главная's focus ids and testIDs. The names below
 * keep Story 3.1's API.
 */

/** Focus ids (docs/focus-map.md §1.5). */
export const FEED_CARD_PREFIX = 'home/feed/';
export const FEED_RETRY_ID = 'home/feed/retry';
export const feedCardId = (postId: string) => `${FEED_CARD_PREFIX}${postId}`;

export const FEED_COLUMNS = POST_GRID_COLUMNS;
export const FEED_CARD_WIDTH = POST_GRID_CARD_WIDTH;
export const FEED_CARD_HEIGHT = POST_GRID_CARD_HEIGHT;
export const FEED_ROW_HEIGHT = POST_GRID_ROW_HEIGHT;
export const FEED_SLOT_PADDING = POST_GRID_SLOT_PADDING;
export const FEED_LIST_TOP_GAP = POST_GRID_LIST_TOP_GAP;
export const FEED_DRAW_DISTANCE = POST_GRID_DRAW_DISTANCE;
export const FEED_RECYCLE_POOL = POST_GRID_RECYCLE_POOL;

export type FeedRowItem = PostRowItem;

export const visibleFeedPosts = visibleGridPosts;
export const feedRows = postGridRows;
export const feedRowLayout = postGridRowLayout;
export const gridListAdapter = postGridListAdapter;

export type FeedGridProps = Omit<
  PostGridProps,
  'cardIdPrefix' | 'retryId' | 'testIDPrefix' | 'loadMoreErrorLabel'
>;

export function FeedGrid(props: FeedGridProps) {
  return (
    <PostGrid
      {...props}
      cardIdPrefix={FEED_CARD_PREFIX}
      retryId={FEED_RETRY_ID}
      testIDPrefix="home/feed"
      loadMoreErrorLabel={t('home.feed.loadMoreError')}
    />
  );
}
