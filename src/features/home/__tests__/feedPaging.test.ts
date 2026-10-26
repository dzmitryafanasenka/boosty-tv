import type { PostPage } from '../../../shared/entities/post';
import {
  FEED_CARD_HEIGHT,
  FEED_CARD_WIDTH,
  FEED_COLUMNS,
  FEED_ROW_HEIGHT,
  FEED_SLOT_PADDING,
  feedRowLayout,
  feedRows,
  visibleFeedPosts,
  gridListAdapter,
} from '../FeedGrid';
import { components, focus, spacing } from '../../../shared/ui';
import { nextFeedCursor } from '../useSubscriptionFeed';

const page = (nextCursor: string | null): PostPage => ({ posts: [], nextCursor });

describe('nextFeedCursor', () => {
  it('the next cursor while it is new', () => {
    expect(nextFeedCursor(page('B'), [null, 'A'])).toBe('B');
  });

  it('null on the last page', () => {
    expect(nextFeedCursor(page(null), [null, 'A'])).toBeNull();
  });

  it('an immediate repeat stops', () => {
    expect(nextFeedCursor(page('A'), [null, 'A'])).toBeNull();
  });

  it('a cycle A → B → A stops', () => {
    expect(nextFeedCursor(page('A'), [null, 'A', 'B'])).toBeNull();
  });
});

describe('gridListAdapter', () => {
  it('scrolls by row: item index → row index', () => {
    const scrollToIndex = jest.fn();
    const scrollToOffset = jest.fn();
    const adapter = gridListAdapter({ current: { scrollToIndex, scrollToOffset } as never });
    expect(FEED_COLUMNS).toBe(3);
    adapter.scrollToIndex({ index: 9, animated: false, viewPosition: 0.5 });
    expect(scrollToIndex).toHaveBeenCalledWith({ index: 3, animated: false, viewPosition: 0.5 });
    adapter.scrollToIndex({ index: 2 });
    expect(scrollToIndex).toHaveBeenLastCalledWith({ index: 0 });
    adapter.scrollToIndex({ index: 5 });
    expect(scrollToIndex).toHaveBeenLastCalledWith({ index: 1 });
    adapter.scrollToOffset({ offset: 120, animated: false });
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 120, animated: false });
  });

  it('no list mounted: nothing happens', () => {
    const adapter = gridListAdapter({ current: null });
    expect(() => adapter.scrollToIndex({ index: 5 })).not.toThrow();
  });
});

describe('grid geometry (3 columns, focus room without a JS scroll)', () => {
  const H = spacing['focus-headroom'];
  const ringRoom = focus['ring-offset'] + focus['ring-width'];
  const scale = components['post-card'].scaleFocus;

  it('3 cards and 2 gaps fit the content with headroom on both sides', () => {
    expect(FEED_CARD_WIDTH).toBe(221);
    expect(3 * FEED_CARD_WIDTH + 2 * spacing['card-gap-x'] + 2 * H).toBeLessThanOrEqual(
      spacing['content-width'],
    );
    expect((FEED_CARD_WIDTH * (scale - 1)) / 2 + ringRoom).toBeLessThan(H);
  });

  it("each slot's vertical padding holds the scaled card's ring (native focus scroll reveals it)", () => {
    expect(FEED_SLOT_PADDING * 2).toBe(spacing['card-gap-y']);
    expect((FEED_CARD_HEIGHT * (scale - 1)) / 2 + ringRoom).toBeLessThan(FEED_SLOT_PADDING);
  });

  it('rows: card + gap; the first card starts one headroom below the list top', () => {
    expect(FEED_ROW_HEIGHT).toBe(FEED_CARD_HEIGHT + spacing['card-gap-y']);
    const first = feedRowLayout(null, 0);
    expect(first.offset + FEED_SLOT_PADDING).toBe(H);
    expect(feedRowLayout(null, 4)).toEqual({
      index: 4,
      length: FEED_ROW_HEIGHT,
      offset: first.offset + 4 * FEED_ROW_HEIGHT,
    });
  });
});

describe('feedRows', () => {
  const post = (id: string) => ({ id }) as never;

  it('chunks into rows of 3 keyed by the first post id; a growing last row keeps its key', () => {
    const ten = Array.from({ length: 10 }, (_, i) => post(`p${i}`));
    const rows = feedRows(ten);
    expect(rows.map(r => [r.key, r.start, r.posts.length])).toEqual([
      ['p0', 0, 3],
      ['p3', 3, 3],
      ['p6', 6, 3],
      ['p9', 9, 1],
    ]);
    const twelve = [...ten, post('p10'), post('p11')];
    expect(feedRows(twelve)[3]).toMatchObject({ key: 'p9', start: 9 });
    expect(feedRows([])).toEqual([]);
  });
});

describe('visibleFeedPosts (hold a trailing partial row while more pages may come)', () => {
  const posts = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }) as never);
  const ids = (list: ReadonlyArray<{ id: string }>) => list.map(p => p.id);

  it('more pages: only full rows', () => {
    expect(ids(visibleFeedPosts(posts(10), true))).toEqual(ids(posts(9)));
    expect(ids(visibleFeedPosts(posts(20), true))).toHaveLength(18);
    expect(visibleFeedPosts(posts(9), true)).toHaveLength(9);
  });

  it('the last page: everything', () => {
    expect(visibleFeedPosts(posts(10), false)).toHaveLength(10);
    expect(visibleFeedPosts(posts(20), false)).toHaveLength(20);
  });

  it('fewer than 3 posts: all, even with more pages', () => {
    expect(visibleFeedPosts(posts(1), true)).toHaveLength(1);
    expect(visibleFeedPosts(posts(2), true)).toHaveLength(2);
    expect(visibleFeedPosts(posts(0), true)).toHaveLength(0);
  });
});
