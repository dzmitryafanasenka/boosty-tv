/**
 * Story 7.1: the LiveCard's copy helpers and the branches the flow tests do
 * not reach: the untitled fallback, a scheduled stream without a start
 * time, no access without a level name, needs-level on a scheduled stream,
 * the cover placeholder after a load error, and the non-button role.
 */
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import type { Stream } from '../../../shared/entities/stream';
import { t } from '../../../shared/i18n';
import {
  LiveCard,
  liveCardA11yLabel,
  liveCardDetails,
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
  coverUrl: 'https://example.invalid/cover',
  levelName: null,
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

  it('the focusable surface is not announced as a button (OK does nothing in 7.1) and keeps the label', async () => {
    const root = await render(base);
    const host = root.container.queryAll(n => n.props.testID === ID && n.props.focusable === true)[0];
    expect(host.props.accessibilityRole).not.toBe('button');
    expect(host.props.accessibilityLabel).toBe(liveCardA11yLabel(base));
    await act(async () => root.unmount());
  });
});
