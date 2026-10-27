import { act } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { mapPost, type Post } from '../../entities/post';
import { t } from '../../i18n';
import { formatCardDate } from '../../i18n/format';
import { createLogger } from '../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { e5Posts, feedPost, lockedPost } from '../../../test/feedFixtures';
import {
  PostCard,
  PostCardSkeleton,
  postCardHeight,
  postCardThumbHeight,
  postCardWidth,
} from '../PostCard';
import { components, focus, spacing } from '../tokens';

const ID = 'card';
/** Far from the fixture dates (Nov 2023): every card shows «d ммм yyyy». */
const NOW = new Date(2026, 9, 26, 12, 0).getTime();
const dateOf = (post: Post) => formatCardDate(post.publishedAt, NOW);
const evt = { nativeEvent: {} };

const asPost = (raw: unknown) => mapPost(raw, createLogger()) as Post;

async function render(post: Post, width = 162): Promise<Root> {
  const root = createRoot();
  await act(async () => {
    root.render(<PostCard post={post} width={width} nowMs={NOW} testID={ID} />);
  });
  return root;
}

const byId = (root: Root, testID: string) =>
  root.container.queryAll(node => node.props.testID === testID);
const host = (root: Root) =>
  byId(root, ID).filter(node => node.props.focusable !== undefined)[0];
const json = (root: Root) => JSON.stringify(root.container.toJSON());

function withData(data: unknown[], extra: Record<string, unknown> = {}): Post {
  return asPost(feedPost(1, { data, ...extra }));
}

const video = (id: string, duration?: number) => ({
  type: 'ok_video',
  id,
  title: 'v',
  ...(duration === undefined ? {} : { duration }),
});

describe('PostCard', () => {
  it.each([
    ['one video', () => withData([video('a', 600)]), t('postCard.badge.video')],
    ['three videos', () => withData([video('a'), video('b'), video('c')]), '3 видео'],
    ['audio', () => withData([{ type: 'audio_file', id: 'x', title: 'a', duration: 60 }]), t('postCard.badge.audio')],
    ['text and photo', () => asPost(e5Posts()[0]), t('postCard.badge.text')],
    ['poll', () => withData([{ type: 'poll', id: 1 }]), t('postCard.badge.poll')],
    ['file', () => withData([{ type: 'file', id: 'f', title: 'a.pdf' }]), t('postCard.badge.file')],
    ['locked', () => asPost(lockedPost()), t('postCard.badge.locked')],
  ])('badge for %s', async (_name, make, badge) => {
    const root = await render(make());
    expect(JSON.stringify(byId(root, `${ID}/badge`)[0].toJSON())).toContain(badge);
    await act(async () => root.unmount());
  });

  it('duration only when the API gives it', async () => {
    const withDuration = await render(withData([video('a', 3960)]));
    expect(byId(withDuration, `${ID}/duration`)).toHaveLength(1);
    expect(json(withDuration)).toContain('1:06:00');
    const without = await render(withData([video('a')]));
    expect(byId(without, `${ID}/duration`)).toHaveLength(0);
    const multi = await render(withData([video('a', 60), video('b', 60)]));
    expect(byId(multi, `${ID}/duration`)).toHaveLength(0);
  });

  it('locked: dimmed preview, lock glyph, «Нет доступа»; no price or subscribe action', async () => {
    const root = await render(asPost(lockedPost()));
    expect(byId(root, `${ID}/lock`)).toHaveLength(1);
    const [preview] = byId(root, `${ID}/preview`);
    expect(StyleSheet.flatten(preview.props.style).opacity).toBeLessThan(1);
    const text = json(root);
    expect(text).toContain(t('postCard.badge.locked'));
    for (const forbidden of ['₽', 'RUB', 'USD', 'Оформить', 'Подписаться', 'руб']) {
      expect(text).not.toContain(forbidden);
    }
    // One focusable element: the card itself.
    expect(root.container.queryAll(n => n.props.focusable === true)).toHaveLength(1);
  });

  it('an accessible card is not dimmed and has no lock', async () => {
    const root = await render(asPost(e5Posts()[1]));
    expect(byId(root, `${ID}/lock`)).toHaveLength(0);
    expect(StyleSheet.flatten(byId(root, `${ID}/preview`)[0].props.style).opacity).toBeUndefined();
  });

  it('no comment count anywhere, even when the post has comments', async () => {
    const raw = feedPost(1, { count: { comments: 5, likes: 5 } });
    const root = await render(asPost(raw));
    const text = json(root);
    expect(text).not.toMatch(/коммент/i);
    expect(text).not.toContain('"5"');
  });

  it('accessibility label: «Видео. {title}. {author}, {date}.» plus the duration', async () => {
    const post = asPost(feedPost(1));
    const root = await render(post);
    expect(dateOf(post)).toMatch(/^1[45] ноя 2023$/);
    expect(host(root).props.accessibilityLabel).toBe(
      `Видео. Post 1. redacted, ${dateOf(post)}. Длительность 1:06:00.`,
    );
    expect(host(root).props.accessibilityRole).toBe('button');
  });

  it('accessibility label of a locked card and a text card without a duration', async () => {
    const post = asPost(lockedPost());
    const locked = await render(post);
    expect(host(locked).props.accessibilityLabel).toBe(
      `Нет доступа. redacted. redacted, ${dateOf(post)}.`,
    );
  });

  it('title: the post title, else its first text, else «Без названия»', async () => {
    const fromText = await render(asPost(e5Posts()[2]));
    expect(json(fromText)).toContain('Sample text');
    const untitled = await render(withData([video('a')], { title: '' }));
    expect(json(untitled)).toContain(t('postCard.untitled'));
  });

  it('meta: author · date; a long author name ellipsizes, the date stays whole', async () => {
    const long = 'Илья MJTV Соколов и очень длинное имя автора канала';
    const raw = feedPost(1);
    (raw.user as Record<string, unknown>).name = long;
    const post = asPost(raw);
    const root = await render(post);
    const [author] = byId(root, `${ID}/author`);
    const [date] = byId(root, `${ID}/date`);
    expect(author.props.children).toBe(long);
    expect(author.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(author.props.style).flexShrink).toBe(1);
    expect(date.props.children).toBe(` · ${dateOf(post)}`);
    expect(StyleSheet.flatten(date.props.style).flexShrink).toBe(0);
  });

  it('focus states: ring and the post-card scale on focus, none on blur', async () => {
    const root = await render(asPost(feedPost(1)));
    expect(byId(root, `${ID}/ring`)).toHaveLength(0);
    await act(async () => host(root).props.onFocus(evt));
    expect(byId(root, `${ID}/ring`)).toHaveLength(1);
    await act(async () => host(root).props.onBlur(evt));
    expect(byId(root, `${ID}/ring`)).toHaveLength(0);
    expect(components['post-card'].scaleFocus).toBe(1.06);
  });

  it('OK does nothing without onPress (Post screen is Story 3.4)', async () => {
    const root = await render(asPost(feedPost(1)));
    await act(async () => {
      host(root).props.onClick?.(evt);
    });
    expect(host(root)).toBeDefined();
  });

  it('a preview that fails to load falls back to the placeholder', async () => {
    const root = await render(asPost(feedPost(1)));
    const [preview] = byId(root, `${ID}/preview`);
    await act(async () => preview.props.onError({ nativeEvent: {} }));
    expect(byId(root, `${ID}/preview`)).toHaveLength(0);
  });
});

describe('PostCard geometry', () => {
  it('3 cards fit 720 dp with focus headroom on both sides (owner decision: 3 columns)', () => {
    const width = postCardWidth(spacing['content-width'], 3);
    expect(width).toBe(221);
    const used = 3 * width + 2 * spacing['card-gap-x'] + 2 * spacing['focus-headroom'];
    expect(used).toBeLessThanOrEqual(spacing['content-width']);
    // The scaled card and its ring stay inside the headroom.
    const growth = (width * (components['post-card'].scaleFocus - 1)) / 2 + 4;
    expect(growth).toBeLessThan(spacing['focus-headroom']);
  });

  it('16:9 preview and a fixed card height', () => {
    expect(postCardThumbHeight(162)).toBe(91);
    expect(postCardHeight(162)).toBe(91 + 8 + 32 + 4 + 16);
  });

  it('the skeleton has the card geometry and is not focusable', async () => {
    const root = createRoot();
    await act(async () => {
      root.render(<PostCardSkeleton width={162} testID="sk" />);
    });
    const [sk] = byId(root, 'sk');
    expect(StyleSheet.flatten(sk.props.style)).toMatchObject({ width: 162, height: postCardHeight(162) });
    expect(sk.props.focusable).toBe(false);
  });
});

describe('PostCard native view budget (Story 3.1 device profiling)', () => {
  /** Style keys that keep a View from being flattened away by Fabric. */
  const PAINT = /^(background|border|opacity|transform|overflow|shadow|elevation|zIndex)/;

  /** Host nodes, and the ones Fabric cannot flatten (layout-only Views are flattened). */
  async function count(post: Post) {
    const root = await render(post);
    const hosts = root.container.queryAll(n => typeof n.type === 'string');
    const native = hosts.filter(n => {
      if (n.type !== 'View') {
        return true;
      }
      const p = n.props;
      if (p.testID || p.nativeID || p.collapsable === false || p.focusable !== undefined) {
        return true;
      }
      if (Object.keys(p).some(k => k.startsWith('accessib') || k === 'pointerEvents')) {
        return true;
      }
      const style = StyleSheet.flatten(p.style) ?? {};
      return Object.keys(style).some(k => PAINT.test(k));
    });
    await act(async () => root.unmount());
    return { hosts: hosts.length, native: native.length };
  }

  it('a video card with a preview, duration and avatar: ≤ 9 native views (was 13)', async () => {
    const { hosts, native } = await count(asPost(feedPost(1)));
    expect(native).toBeLessThanOrEqual(9);
    expect(hosts).toBeLessThanOrEqual(10);
  });

  it('a locked card: ≤ 10 native views (the lock glyph is 2 views; was 14)', async () => {
    const { native } = await count(asPost(lockedPost()));
    expect(native).toBeLessThanOrEqual(10);
  });
});

beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());

describe('PostCard in a recycled cell (FlashList, ADR 0011)', () => {
  it('a new post in the same instance: no ring, no pressed state, no stale preview failure', async () => {
    const root = createRoot();
    const a = asPost(feedPost(1));
    const b = asPost(feedPost(2));
    await act(async () => {
      root.render(<PostCard post={a} width={221} nowMs={NOW} testID={ID} />);
    });
    await act(async () => host(root).props.onFocus(evt));
    await act(async () => byId(root, `${ID}/preview`)[0].props.onError({ nativeEvent: {} }));
    expect(byId(root, `${ID}/ring`)).toHaveLength(1);
    expect(byId(root, `${ID}/preview`)).toHaveLength(0);
    // The cell is reused for post b (same instance, same testID).
    await act(async () => {
      root.render(<PostCard post={b} width={221} nowMs={NOW} testID={ID} />);
    });
    expect(byId(root, `${ID}/ring`)).toHaveLength(0);
    expect(byId(root, `${ID}/preview`)).toHaveLength(1);
    expect(host(root).props.accessibilityLabel).toContain('Post 2');
    await act(async () => root.unmount());
  });

  it('a new author: the avatar shows again after a failure; pressed is cleared; the scale is at rest at once', async () => {
    const avatars = (r: Root) =>
      r.container.queryAll(n => n.type === 'Image' && String(n.props.source?.uri).includes('avatar'));
    const root = createRoot();
    const a = asPost(feedPost(1));
    const rawB = feedPost(2);
    (rawB.user as Record<string, unknown>).avatarUrl = 'https://example.invalid/avatar-b';
    const b = asPost(rawB);
    await act(async () => {
      root.render(<PostCard post={a} width={221} nowMs={NOW} testID={ID} />);
    });
    await act(async () => avatars(root)[0].props.onError({ nativeEvent: {} }));
    expect(avatars(root)).toHaveLength(0);
    await act(async () => host(root).props.onFocus(evt));
    await act(async () => host(root).props.onPressIn(evt));
    // The press animation runs toward the pressed scale.
    const timing = jest.spyOn(Animated, 'timing');
    const setValue = jest.spyOn(Animated.Value.prototype, 'setValue');
    await act(async () => {
      root.render(<PostCard post={b} width={221} nowMs={NOW} testID={ID} />);
    });
    // Reset during the render for post b: the scale jumps to rest (1), not
    // animated from the pressed/focused scale of post a.
    expect(setValue).toHaveBeenCalledWith(1);
    expect(setValue.mock.invocationCallOrder[0]).toBeLessThan(
      timing.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(focus['pressed-scale']).toBeLessThan(1);
    setValue.mockRestore();
    timing.mockRestore();
    expect(byId(root, `${ID}/ring`)).toHaveLength(0);
    expect(avatars(root)).toHaveLength(1);
    expect(avatars(root)[0].props.source.uri).toBe('https://example.invalid/avatar-b');
    await act(async () => root.unmount());
  });
});

describe('pinned (Author page, owner decision 2026-10-27)', () => {
  const pinned = asPost(feedPost(0, { isPinned: true }));

  it('with showPinned: the pin badge on the preview, the date line unchanged, «Закреплено.» starts the label', async () => {
    const root = createRoot();
    await act(async () => {
      root.render(<PostCard post={pinned} width={162} nowMs={NOW} testID={ID} showPinned />);
    });
    expect(byId(root, `${ID}/pin`)[0].props.children).toBe(t('postCard.pinned'));
    expect(byId(root, `${ID}/date`)[0].props.children).toBe(` · ${dateOf(pinned)}`);
    expect(host(root).props.accessibilityLabel).toMatch(/^Закреплено\. /);
    await act(async () => root.unmount());
  });

  it('without showPinned (Главная), or not pinned: no mark', async () => {
    const plain = await render(pinned);
    expect(byId(plain, `${ID}/pin`)).toHaveLength(0);
    expect(json(plain)).not.toContain('Закреплено');
    expect(host(plain).props.accessibilityLabel).not.toMatch(/Закреплено/);
    await act(async () => plain.unmount());
    const root = createRoot();
    await act(async () => {
      root.render(<PostCard post={asPost(feedPost(0))} width={162} nowMs={NOW} testID={ID} showPinned />);
    });
    expect(byId(root, `${ID}/pin`)).toHaveLength(0);
    expect(json(root)).not.toContain('Закреплено');
    expect(host(root).props.accessibilityLabel).not.toMatch(/Закреплено/);
    await act(async () => root.unmount());
  });
});
