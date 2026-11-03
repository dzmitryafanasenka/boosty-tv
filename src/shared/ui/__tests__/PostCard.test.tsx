import { act } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { mapPost, type Post } from '../../entities/post';
import { t } from '../../i18n';
import { formatCardDate } from '../../i18n/format';
import { createLogger } from '../../services/logger';
import {
  ProgressContext,
  createProgressStore,
  type ProgressRepository,
  type ProgressStore,
} from '../../services/progress';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { e5Posts, feedPost, lockedPost } from '../../../test/feedFixtures';
import {
  PostCard,
  PostCardSkeleton,
  postCardHeight,
  postCardThumbHeight,
  postCardWidth,
} from '../PostCard';
import {
  AudioIcon,
  FileIcon,
  PollIcon,
  TextPhotoIcon,
  VideoIcon,
  VideosIcon,
  type IconProps,
} from '../icons';
import { colors, components, focus, spacing } from '../tokens';

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

  it('a preview that fails to load falls back to the placeholder plate with the avatar', async () => {
    const root = await render(asPost(feedPost(1)));
    const [preview] = byId(root, `${ID}/preview`);
    await act(async () => preview.props.onError({ nativeEvent: {} }));
    expect(byId(root, `${ID}/preview`)).toHaveLength(0);
    expect(byId(root, `${ID}/placeholder`)).toHaveLength(1);
    expect(byId(root, `${ID}/placeholder-avatar`)).toHaveLength(1);
    await act(async () => root.unmount());
  });
});

describe('PostCard without a preview (owner decision 2026-10-30)', () => {
  /** A post without a preview; `avatar` null removes the author's avatar. */
  function noPreview(data: unknown[], avatar?: string | null, extra: Record<string, unknown> = {}): Post {
    const raw = feedPost(1, { data, teaser: [], ...extra });
    if (avatar !== undefined) {
      (raw.user as Record<string, unknown>).avatarUrl = avatar;
    }
    const post = asPost(raw);
    expect(post.previewUrl).toBeNull();
    return post;
  }
  const poll = [{ type: 'poll', id: 1 }];
  const plateOf = (root: Root) => byId(root, `${ID}/placeholder`)[0];

  it('the plate (surface-raised, not the skeleton colour) with the author avatar centred and sized from the thumb', async () => {
    const root = await render(noPreview(poll), 221);
    const plate = StyleSheet.flatten(plateOf(root).props.style);
    expect(plate.backgroundColor).toBe(colors['surface-raised']);
    expect(plate.backgroundColor).not.toBe(colors.skeleton);
    expect(plate).toMatchObject({ width: 221, height: postCardThumbHeight(221), alignItems: 'center', justifyContent: 'center' });
    const [avatar] = byId(root, `${ID}/placeholder-avatar`);
    expect(avatar.type).toBe('Image');
    const size = Math.round(postCardThumbHeight(221) * 0.5);
    expect(StyleSheet.flatten(avatar.props.style)).toMatchObject({ width: size, height: size });
    expect(byId(root, `${ID}/type-icon`)).toHaveLength(0);
    // Badge, title and the meta row are unchanged.
    expect(JSON.stringify(byId(root, `${ID}/badge`)[0].toJSON())).toContain(t('postCard.badge.poll'));
    expect(byId(root, `${ID}/author`)).toHaveLength(1);
    await act(async () => root.unmount());
  });

  const KINDS: [string, string, unknown[], (props: IconProps) => React.JSX.Element][] = [
    ['video', 'VideoIcon', [video('a', 60)], VideoIcon],
    ['videos', 'VideosIcon', [video('a'), video('b')], VideosIcon],
    ['audio', 'AudioIcon', [{ type: 'audio_file', id: 'x', title: 'a', duration: 60 }], AudioIcon],
    ['text', 'TextPhotoIcon', [{ type: 'text', content: '["Sample text","unstyled",[]]', modificator: '' }], TextPhotoIcon],
    ['poll', 'PollIcon', poll, PollIcon],
    ['file', 'FileIcon', [{ type: 'file', id: 'f', title: 'a.pdf' }], FileIcon],
  ];

  /** The type icon a card draws (no avatar), as JSON. */
  async function glyphOf(data: unknown[]): Promise<string> {
    const root = await render(noPreview(data, null));
    const glyph = JSON.stringify(byId(root, `${ID}/type-icon`)[0].toJSON());
    await act(async () => root.unmount());
    return glyph;
  }

  it.each(KINDS)('no avatar: a %s post draws %s in the secondary text colour, sized from the thumb', async (kind, _name, data, Icon) => {
    const post = noPreview(data, null);
    expect(post.kind.kind).toBe(kind);
    const root = await render(post);
    expect(byId(root, `${ID}/placeholder-avatar`)).toHaveLength(0);
    const [icon] = byId(root, `${ID}/type-icon`);
    const size = Math.round(postCardThumbHeight(162) * 0.3);
    expect(icon.props.width).toBe(size);
    // The TYPE_ICONS mapping: the glyph equals a standalone render of the expected icon.
    const expected = createRoot();
    await act(async () => {
      expected.render(<Icon color={colors['text-secondary']} size={size} testID={`${ID}/type-icon`} />);
    });
    expect(JSON.stringify(icon.toJSON())).toBe(JSON.stringify(byId(expected, `${ID}/type-icon`)[0].toJSON()));
    await act(async () => expected.unmount());
    await act(async () => root.unmount());
  });

  it('each kind draws a different icon (all 6)', async () => {
    const shapes = new Set<string>();
    for (const [, , data] of KINDS) {
      shapes.add(await glyphOf(data));
    }
    expect(shapes.size).toBe(6);
  });

  it('an avatar that fails to load: the type icon instead', async () => {
    const root = await render(noPreview(poll));
    await act(async () => byId(root, `${ID}/placeholder-avatar`)[0].props.onError({ nativeEvent: {} }));
    expect(byId(root, `${ID}/placeholder-avatar`)).toHaveLength(0);
    expect(byId(root, `${ID}/type-icon`)).toHaveLength(1);
    expect(byId(root, `${ID}/placeholder`)).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it('a failed preview and a failed avatar: the plate with the type icon', async () => {
    const root = await render(asPost(feedPost(1)));
    await act(async () => byId(root, `${ID}/preview`)[0].props.onError({ nativeEvent: {} }));
    await act(async () => byId(root, `${ID}/placeholder-avatar`)[0].props.onError({ nativeEvent: {} }));
    expect(byId(root, `${ID}/type-icon`)).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it('locked without a preview: the plate, then the lock glyph on top; the avatar is dimmed; no type icon', async () => {
    const raw = lockedPost();
    (raw as Record<string, unknown>).teaser = [];
    const post = asPost(raw);
    expect(post.previewUrl).toBeNull();
    const root = await render(post);
    const hosts = root.container.queryAll(n => typeof n.type === 'string');
    const plateAt = hosts.indexOf(plateOf(root));
    const lockAt = hosts.indexOf(byId(root, `${ID}/lock`)[0]);
    expect(plateAt).toBeGreaterThanOrEqual(0);
    expect(lockAt).toBeGreaterThan(plateAt);
    const [avatar] = byId(root, `${ID}/placeholder-avatar`);
    expect(StyleSheet.flatten(avatar.props.style).opacity).toBeLessThan(1);
    expect(JSON.stringify(byId(root, `${ID}/badge`)[0].toJSON())).toContain(t('postCard.badge.locked'));
    await act(async () => avatar.props.onError({ nativeEvent: {} }));
    expect(byId(root, `${ID}/type-icon`)).toHaveLength(0);
    expect(byId(root, `${ID}/lock`)).toHaveLength(1);
    await act(async () => root.unmount());
  });

  /** A locked post without a teaser (no preview); `avatar` null removes the avatar. */
  function lockedNoPreview(avatar?: string | null): Post {
    const raw = lockedPost();
    (raw as Record<string, unknown>).teaser = [];
    if (avatar !== undefined) {
      (raw.user as Record<string, unknown>).avatarUrl = avatar;
    }
    const post = asPost(raw);
    expect(post.previewUrl).toBeNull();
    return post;
  }

  it('locked without a preview and without an avatar: the plate and the lock only', async () => {
    const root = await render(lockedNoPreview(null));
    expect(byId(root, `${ID}/placeholder`)).toHaveLength(1);
    expect(byId(root, `${ID}/placeholder-avatar`)).toHaveLength(0);
    expect(byId(root, `${ID}/type-icon`)).toHaveLength(0);
    expect(byId(root, `${ID}/lock`)).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it('locked: the plate itself is not dimmed, while a locked preview Image is', async () => {
    const plate = await render(lockedNoPreview());
    expect(StyleSheet.flatten(plateOf(plate).props.style).opacity).toBeUndefined();
    await act(async () => plate.unmount());
    const withPreview = await render(asPost(lockedPost()));
    expect(StyleSheet.flatten(byId(withPreview, `${ID}/preview`)[0].props.style).opacity).toBeLessThan(1);
    await act(async () => withPreview.unmount());
  });

  describe('in a recycled cell (FlashList, ADR 0011)', () => {
    async function cell(first: Post) {
      const root = createRoot();
      const show = (post: Post) =>
        act(async () => {
          root.render(<PostCard post={post} width={221} nowMs={NOW} testID={ID} />);
        });
      await show(first);
      return { root, show };
    }

    it('preview → no preview → preview', async () => {
      const withPreview = asPost(feedPost(1));
      const { root, show } = await cell(withPreview);
      expect(byId(root, `${ID}/preview`)).toHaveLength(1);
      expect(byId(root, `${ID}/placeholder`)).toHaveLength(0);
      await show(noPreview(poll));
      expect(byId(root, `${ID}/preview`)).toHaveLength(0);
      expect(byId(root, `${ID}/placeholder-avatar`)).toHaveLength(1);
      await show(withPreview);
      expect(byId(root, `${ID}/preview`)).toHaveLength(1);
      expect(byId(root, `${ID}/placeholder`)).toHaveLength(0);
      await act(async () => root.unmount());
    });

    it('author A’s avatar failed (icon) → author B with a working avatar: the avatar again', async () => {
      const { root, show } = await cell(noPreview(poll, 'https://example.invalid/avatar-a'));
      await act(async () => byId(root, `${ID}/placeholder-avatar`)[0].props.onError({ nativeEvent: {} }));
      expect(byId(root, `${ID}/type-icon`)).toHaveLength(1);
      await show(noPreview(poll, 'https://example.invalid/avatar-b', { id: 'feed-post-b' }));
      const [avatar] = byId(root, `${ID}/placeholder-avatar`);
      expect(avatar.props.source.uri).toBe('https://example.invalid/avatar-b');
      expect(byId(root, `${ID}/type-icon`)).toHaveLength(0);
      await act(async () => root.unmount());
    });

    it('no preview → locked no preview: the avatar dimmed, no icon, the lock on top', async () => {
      const { root, show } = await cell(noPreview(poll));
      expect(StyleSheet.flatten(byId(root, `${ID}/placeholder-avatar`)[0].props.style).opacity).toBeUndefined();
      await show(lockedNoPreview());
      expect(StyleSheet.flatten(byId(root, `${ID}/placeholder-avatar`)[0].props.style).opacity).toBeLessThan(1);
      expect(byId(root, `${ID}/type-icon`)).toHaveLength(0);
      expect(byId(root, `${ID}/lock`)).toHaveLength(1);
      await act(async () => root.unmount());
    });
  });

  it('the a11y label is the same with or without a preview', async () => {
    const withPreview = await render(asPost(feedPost(1)));
    const label = host(withPreview).props.accessibilityLabel;
    await act(async () => byId(withPreview, `${ID}/preview`)[0].props.onError({ nativeEvent: {} }));
    expect(host(withPreview).props.accessibilityLabel).toBe(label);
    await act(async () => withPreview.unmount());
  });

  it('the loading skeleton keeps the skeleton colour and has no plate', async () => {
    const root = createRoot();
    await act(async () => {
      root.render(<PostCardSkeleton width={162} testID="sk" />);
    });
    const colours = root.container
      .queryAll(n => typeof n.type === 'string')
      .map(n => StyleSheet.flatten(n.props.style)?.backgroundColor)
      .filter(Boolean);
    expect(colours.length).toBeGreaterThan(0);
    expect(new Set(colours)).toEqual(new Set([colors.skeleton]));
    await act(async () => root.unmount());
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
  async function count(post: Post, failPreview = false) {
    const root = await render(post);
    if (failPreview) {
      await act(async () => byId(root, `${ID}/preview`)[0].props.onError({ nativeEvent: {} }));
    }
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

  it('the same card without its preview (avatar path): exactly one native view more (the plate and the avatar Image)', async () => {
    const post = asPost(feedPost(1));
    const preview = await count(post);
    const placeholder = await count(post, true);
    expect(placeholder.native).toBe(preview.native + 1);
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

describe('Story 12.2: local progress on a video card', () => {
  let store: ProgressStore;
  const memoryKv = () => {
    const data = new Map<string, string>();
    return {
      get: async (key: string) => data.get(key) ?? null,
      set: async (key: string, value: string) => {
        data.set(key, value);
      },
      remove: async (key: string) => {
        data.delete(key);
      },
      clear: async () => {
        data.clear();
      },
    };
  };
  const put = (post: Post, mediaId: string, positionSec: number, durationSec: number | null = 3600) =>
    store.put({
      ref: { blogUrl: post.author.blogUrl, postId: post.id, mediaId },
      positionSec,
      durationSec,
      updatedAt: Date.now(),
      meta: { title: '', postTitle: post.title, authorName: post.author.name, previewUrl: null, durationSec },
    });

  async function renderWith(post: Post, width = 162): Promise<Root> {
    const root = createRoot();
    await act(async () => {
      root.render(
        <ProgressContext.Provider value={{ store } as unknown as ProgressRepository}>
          <PostCard post={post} width={width} nowMs={NOW} testID={ID} />
        </ProgressContext.Provider>,
      );
    });
    return root;
  }
  const fillWidth = (root: Root) => {
    const [fill] = byId(root, `${ID}/progress`)[0].queryAll(
      n => n.props.style !== undefined && n.props.testID === undefined,
    );
    return (StyleSheet.flatten(fill.props.style) as { width: number }).width;
  };

  beforeEach(() => {
    store = createProgressStore({ kv: memoryKv, scope: { generation: () => 0 }, logger: createLogger(), debounceMs: 10 });
  });

  it('no entry: no line, no badge, the label unchanged', async () => {
    const post = withData([video('a', 3600)]);
    const root = await renderWith(post);
    expect(byId(root, `${ID}/progress`)).toHaveLength(0);
    expect(byId(root, `${ID}/watched`)).toHaveLength(0);
    expect(host(root).props.accessibilityLabel).not.toMatch(/Прогресс/);
    await act(async () => root.unmount());
  });

  it('in progress (12:00 of 60:00): the line at 20 % on the preview\'s bottom edge; the label ends «осталось 48 мин»', async () => {
    const post = withData([video('a', 3600)]);
    put(post, 'a', 720);
    const root = await renderWith(post);
    const track = StyleSheet.flatten(byId(root, `${ID}/progress`)[0].props.style) as { top: number; width: number };
    expect(track).toMatchObject({
      top: postCardThumbHeight(162) - components.timeline.trackHeight,
      width: 162,
      backgroundColor: colors['overlay-badge'],
    });
    expect(fillWidth(root)).toBe(Math.round(162 * 0.2));
    expect(byId(root, `${ID}/watched`)).toHaveLength(0);
    expect(host(root).props.accessibilityLabel).toMatch(/осталось 48 мин\.$/);
    // The card keeps its height.
    const scale = StyleSheet.flatten(byId(root, `${ID}/scale`)[0].props.style) as { height?: number };
    expect(scale.height ?? postCardHeight(162)).toBe(postCardHeight(162));
    await act(async () => root.unmount());
  });

  it('finished: a full line and «Просмотрено» at the bottom left; the duration chip stays; the label ends «просмотрено»', async () => {
    const post = withData([video('a', 3600)]);
    put(post, 'a', 3590);
    const root = await renderWith(post);
    expect(fillWidth(root)).toBe(162);
    const badge = byId(root, `${ID}/watched`)[0];
    expect(JSON.stringify(badge.toJSON())).toContain(t('post.video.status.watched'));
    expect(StyleSheet.flatten(badge.props.style)).toMatchObject({
      left: spacing['3'],
      top: postCardThumbHeight(162) - spacing['3'] - components.badge.height,
    });
    expect(byId(root, `${ID}/duration`)).toHaveLength(1);
    expect(byId(root, `${ID}/badge`)).toHaveLength(1);
    expect(host(root).props.accessibilityLabel).toMatch(/просмотрено\.$/);
    await act(async () => root.unmount());
  });

  it('an unknown duration: no line, no badge', async () => {
    const post = withData([video('a')]);
    put(post, 'a', 720, null);
    const root = await renderWith(post);
    expect(byId(root, `${ID}/progress`)).toHaveLength(0);
    expect(byId(root, `${ID}/watched`)).toHaveLength(0);
    await act(async () => root.unmount());
  });

  it('a server-only position: the card is unchanged', async () => {
    const post = withData([video('a', 3600)]);
    store.setServerPosition('a', 720);
    const root = await renderWith(post);
    expect(byId(root, `${ID}/progress`)).toHaveLength(0);
    expect(host(root).props.accessibilityLabel).not.toMatch(/Прогресс/);
    await act(async () => root.unmount());
  });

  it('several videos: 1 watched + 2 in progress → the line of video 2; all watched → «Просмотрено»', async () => {
    const post = withData([video('a', 3600), video('b', 3600), video('c', 3600)]);
    put(post, 'a', 3500);
    put(post, 'b', 1800);
    put(post, 'c', 600);
    const root = await renderWith(post);
    expect(fillWidth(root)).toBe(Math.round(162 * 0.5));
    expect(byId(root, `${ID}/watched`)).toHaveLength(0);
    await act(async () => {
      put(post, 'b', 3500);
      put(post, 'c', 3500);
    });
    expect(fillWidth(root)).toBe(162);
    expect(byId(root, `${ID}/watched`)).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it('several videos: 1 watched, 2 not started → no line, no badge', async () => {
    const post = withData([video('a', 3600), video('b', 3600)]);
    put(post, 'a', 3500);
    const root = await renderWith(post);
    expect(byId(root, `${ID}/progress`)).toHaveLength(0);
    expect(byId(root, `${ID}/watched`)).toHaveLength(0);
    await act(async () => root.unmount());
  });

  it('not a video post, or locked: unchanged even with an entry for its id', async () => {
    const audio = withData([{ type: 'audio_file', id: 'x', title: 'a', duration: 60 }]);
    put(audio, 'x', 30, 60);
    const locked = asPost(lockedPost());
    const r1 = await renderWith(audio);
    expect(byId(r1, `${ID}/progress`)).toHaveLength(0);
    await act(async () => r1.unmount());
    const r2 = await renderWith(locked);
    expect(byId(r2, `${ID}/progress`)).toHaveLength(0);
    expect(byId(r2, `${ID}/watched`)).toHaveLength(0);
    await act(async () => r2.unmount());
  });

  it('follows the store: an entry appears, then is removed (Story 12.1) → the line goes', async () => {
    const post = withData([video('a', 3600)]);
    const root = await renderWith(post);
    expect(byId(root, `${ID}/progress`)).toHaveLength(0);
    await act(async () => put(post, 'a', 720));
    expect(byId(root, `${ID}/progress`)).toHaveLength(1);
    await act(async () => store.removeLocal('a'));
    expect(byId(root, `${ID}/progress`)).toHaveLength(0);
    await act(async () => root.unmount());
  });
});
