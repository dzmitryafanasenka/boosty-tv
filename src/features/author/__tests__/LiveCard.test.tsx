/**
 * Story 7.1: the LiveCard's copy helpers and the branches the flow tests do
 * not reach: the untitled fallback, a scheduled stream without a start
 * time, no access without a level name, needs-level on a scheduled stream,
 * the cover placeholder after a load error, and the role (Story 7.2: a
 * button with an OK action, else a summary); `liveCardPlayable`. Story
 * 7.4: the live details without likes, `LiveCardActions` (heart + count,
 * share only, the failure line), `liveLikeShown`, `liveLikeA11yLabel`.
 */
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import type { Stream } from '../../../shared/entities/stream';
import { t } from '../../../shared/i18n';
import { formatCount } from '../../../shared/i18n/format';
import { StyleSheet } from 'react-native';
import { colors, components } from '../../../shared/ui';
import { liveLikeShown } from '../useLiveLike';
import {
  LiveCard,
  LIKE_ERROR_HEIGHT,
  LIVE_ACTION_STOP_HEIGHT,
  LiveCardActions,
  liveCardA11yLabel,
  liveLikeA11yLabel,
  liveCardDetails,
  liveCardPlayable,
  liveCardState,
  liveCardStatus,
  liveCardTitle,
} from '../LiveCard';

const ID = 'author/b/live';
const base: Stream = {
  id: 's',
  title: 'Эфир',
  status: 'live',
  hasAccess: true,
  startTime: null,
  viewers: 0,
  likes: 0,
  isLiked: false,
  coverUrl: 'https://example.invalid/cover',
  levelName: null,
  hasLiveSources: true,
};
const stream = (overrides: Partial<Stream>): Stream => ({ ...base, ...overrides });

async function render(value: Stream): Promise<Root> {
  const root = createRoot();
  await act(async () => {
    root.render(<LiveCard testID={ID} stream={value} />);
  });
  return root;
}
const byId = (root: Root, testID: string) => root.container.queryAll(n => n.props.testID === testID);

describe('helpers', () => {
  it('an empty title reads «Эфир без названия»', () => {
    expect(liveCardTitle(stream({ title: '' }))).toBe(t('author.live.untitled'));
    expect(liveCardTitle(stream({ title: 'Эфир' }))).toBe('Эфир');
  });

  it('scheduled without a start time: «Время начала не указано»; likes only, no viewers', () => {
    const scheduled = stream({ status: 'scheduled', startTime: null, likes: 1 });
    expect(liveCardStatus(scheduled)).toBe(t('author.live.statusScheduledNoTime'));
    expect(liveCardDetails(scheduled)).toBe('1 лайк');
  });

  it('no access without a level name: «Нет доступа»; with one: «Нужен уровень «X»»', () => {
    expect(liveCardDetails(stream({ hasAccess: false }))).toBe(t('author.live.noAccess'));
    expect(liveCardDetails(stream({ hasAccess: false, levelName: 'Золото' }))).toBe('Нужен уровень «Золото»');
  });

  it('needs level on a scheduled stream: one state (needsLevel), the scheduled status, the level instead of counts', () => {
    const value = stream({ status: 'scheduled', hasAccess: false, levelName: 'Золото', likes: 5 });
    expect(liveCardState(value)).toBe('needsLevel');
    expect(liveCardA11yLabel(value)).toBe(
      `Эфир: Эфир. ${t('author.live.statusScheduledNoTime')}. Нужен уровень «Золото»`,
    );
  });
});

describe('component', () => {
  it('scheduled + needs level: «Запланирован» badge, the level line, no price or viewers', async () => {
    const root = await render(stream({ status: 'scheduled', hasAccess: false, levelName: 'Золото' }));
    const json = JSON.stringify(root.container.toJSON());
    expect(json).toContain(t('author.live.badgeScheduled'));
    expect(json).toContain('Нужен уровень «Золото»');
    expect(json).not.toMatch(/зрител|₽/);
    await act(async () => root.unmount());
  });

  it('a cover that fails to load leaves the placeholder (no image)', async () => {
    const root = await render(base);
    expect(byId(root, `${ID}/cover`)).toHaveLength(1);
    await act(async () => {
      byId(root, `${ID}/cover`)[0].props.onError({ nativeEvent: {} });
    });
    expect(byId(root, `${ID}/cover`)).toHaveLength(0);
    // The badge still shows on the placeholder.
    expect(byId(root, `${ID}/badge`).length).toBeGreaterThan(0);
    await act(async () => root.unmount());
  });

  it('without an OK action the surface is not announced as a button and keeps the label', async () => {
    const root = await render(base);
    const host = root.container.queryAll(n => n.props.testID === ID && n.props.focusable === true)[0];
    expect(host.props.accessibilityRole).not.toBe('button');
    expect(host.props.accessibilityLabel).toBe(liveCardA11yLabel(base));
    await act(async () => root.unmount());
  });

  it('Story 7.2: with an OK action it is a button (OK itself: authorFlow «Story 7.2»)', async () => {
    const onPress = jest.fn();
    const root = createRoot();
    await act(async () => {
      root.render(<LiveCard testID={ID} stream={base} onPress={onPress} />);
    });
    const host = root.container.queryAll(n => n.props.testID === ID && n.props.focusable === true)[0];
    expect(host.props.accessibilityRole).toBe('button');
    await act(async () => root.unmount());
  });
});

describe('liveCardPlayable (Story 7.2)', () => {
  it('live, with access and a live-edge URL only', () => {
    expect(liveCardPlayable(base)).toBe(true);
    expect(liveCardPlayable(stream({ status: 'scheduled' }))).toBe(false);
    expect(liveCardPlayable(stream({ hasAccess: false }))).toBe(false);
    expect(liveCardPlayable(stream({ hasLiveSources: false }))).toBe(false);
  });
});

describe('Story 7.4: like and share', () => {
  const LIKE = `${ID}/like`;
  const SHARE = `${ID}/share`;
  const focusable = (root: Root, testID: string) =>
    root.container.queryAll(n => n.props.testID === testID && n.props.focusable === true)[0];

  async function renderActions(value: Stream, overrides: Partial<Parameters<typeof LiveCardActions>[0]> = {}) {
    const root = createRoot();
    const props = {
      stream: value,
      likeShown: liveLikeShown(value),
      likeId: LIKE,
      shareId: SHARE,
      likeError: null,
      likeSending: false,
      likeHostRef: () => {},
      shareHostRef: () => {},
      onLikeFocus: () => {},
      onShareFocus: () => {},
      onLikePress: jest.fn(),
      onSharePress: jest.fn(),
      entry: null,
      ...overrides,
    };
    await act(async () => {
      root.render(<LiveCardActions {...props} />);
    });
    return { root, props };
  }

  it('the live details drop the likes (they are on «Нравится»); scheduled keeps them', () => {
    expect(liveCardDetails(stream({ viewers: 3, likes: 9 }))).toBe('3 зрителя');
    expect(liveCardDetails(stream({ status: 'scheduled', likes: 9 }))).toBe('9 лайков');
  });

  it('liveLikeShown: live with access only', () => {
    expect(liveLikeShown(base)).toBe(true);
    expect(liveLikeShown(stream({ status: 'scheduled' }))).toBe(false);
    expect(liveLikeShown(stream({ hasAccess: false }))).toBe(false);
  });

  it('the like label names the state and the count', () => {
    expect(liveLikeA11yLabel({ isLiked: false, likes: 357 })).toBe('Нравится, 357');
    expect(liveLikeA11yLabel({ isLiked: true, likes: 1358 })).toBe(`Вам нравится, ${formatCount(1358)}`);
  });

  it('not liked: an outline heart and the count in the button ink; share below', async () => {
    const { root } = await renderActions(stream({ likes: 357 }));
    const like = focusable(root, LIKE);
    expect(like.props.accessibilityRole).toBe('button');
    expect(like.props.accessibilityLabel).toBe('Нравится, 357');
    expect(like.props.accessibilityState).toMatchObject({ selected: false });
    expect(byId(root, `${LIKE}/heart`)).toHaveLength(1);
    expect(byId(root, `${LIKE}/heart/filled`)).toHaveLength(0);
    // The heart is drawn in the label's ink.
    expect(root.container.queryAll(n => n.props.stroke === colors.text).length).toBeGreaterThan(0);
    expect(JSON.stringify(root.container.toJSON())).toContain('357');
    expect(focusable(root, SHARE).props.accessibilityLabel).toBe(t('author.live.shareA11y'));
    expect(JSON.stringify(root.container.toJSON())).toContain(t('author.live.share'));
    await act(async () => root.unmount());
  });

  it('liked: a filled heart in the accent, the count in the accent ink, selected', async () => {
    const { root } = await renderActions(stream({ likes: 358, isLiked: true }));
    const like = focusable(root, LIKE);
    expect(like.props.accessibilityLabel).toBe('Вам нравится, 358');
    expect(like.props.accessibilityState).toMatchObject({ selected: true });
    expect(byId(root, `${LIKE}/heart/filled`)).toHaveLength(1);
    // Heart and count share the selected ink (`accent-text`).
    const heart = root.container.queryAll(n => n.props.stroke === colors['accent-text']);
    expect(heart.length).toBeGreaterThan(0);
    expect(heart[0].props.fill).toBe(colors['accent-text']);
    expect(JSON.stringify(root.container.toJSON())).toContain(colors['accent-text']);
    await act(async () => root.unmount());
  });

  it.each([
    ['scheduled', stream({ status: 'scheduled' })],
    ['needs a level', stream({ hasAccess: false })],
  ])('%s: «Поделиться» only', async (_name, value) => {
    const { root } = await renderActions(value);
    expect(focusable(root, LIKE)).toBeUndefined();
    expect(focusable(root, SHARE)).toBeDefined();
    await act(async () => root.unmount());
  });

  it('while a request runs the like keeps its button role and OK action, and reports busy', async () => {
    const { root, props } = await renderActions(base, { likeSending: true });
    const like = focusable(root, LIKE);
    expect(like.props.accessibilityRole).toBe('button');
    expect(like.props.accessibilityState).toMatchObject({ busy: true });
    // The label stays (no spinner variant).
    expect(byId(root, `${LIKE}/spinner`)).toHaveLength(0);
    expect(JSON.stringify(root.container.toJSON())).toContain(formatCount(base.likes));
    expect(props.onLikePress).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it('the column fits the card\'s 120 dp: two small buttons, their gaps and the two-line failure slot', () => {
    expect(2 * LIVE_ACTION_STOP_HEIGHT + LIKE_ERROR_HEIGHT).toBeLessThanOrEqual(components['live-card'].height);
  });

  it('the failure line reads error.<kind> in a fixed two-line slot (the error ink); empty without an error', async () => {
    const { root } = await renderActions(base, { likeError: 'RateLimited' });
    const line = byId(root, `${LIKE}/error`)[0];
    expect(line.props.accessibilityLiveRegion).toBe('polite');
    expect(line.props.numberOfLines).toBe(2);
    const style = StyleSheet.flatten(line.props.style);
    expect(style.height).toBe(LIKE_ERROR_HEIGHT);
    expect(style.color).toBe(colors['error-text']);
    expect(JSON.stringify(line.props.children)).toContain(t('error.RateLimited'));
    await act(async () => root.unmount());
    const clean = await renderActions(base);
    expect(byId(clean.root, `${LIKE}/error`)).toHaveLength(1);
    expect(byId(clean.root, `${LIKE}/error`)[0].props.children).toBe('');
    await act(async () => clean.root.unmount());
  });
});
