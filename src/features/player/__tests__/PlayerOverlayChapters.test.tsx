/**
 * Story 10.1 (our improvement): chapter marks on the timeline and the
 * current chapter's name next to the elapsed time (following the pending
 * target); none on live or without chapters. Host render only: the
 * native layout and focus are device checks (docs/testing.md «Story 10.1»).
 */
import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import type { Chapter } from '../../../shared/entities/post';
import { components } from '../../../shared/ui';
import { ChapterStrip } from '../ChapterStrip';
import { PlayerOverlay, timelineA11yLabel } from '../PlayerOverlay';

const noop = () => {};
const meta = { authorName: 'Автор', authorAvatarUrl: null, postTitle: 'Пост', videoTitle: '' };
const CHAPTERS: Chapter[] = [
  { sec: 0, title: 'Вступление' },
  { sec: 225, title: 'Разбор' },
  { sec: 730, title: 'Итоги' },
];

let root: Root | null = null;

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(async () => {
  if (root) {
    const current = root;
    root = null;
    await act(async () => current.unmount());
  }
  jest.useRealTimers();
});

type Props = {
  chapters?: readonly Chapter[];
  positionSec?: number;
  seekTargetSec?: number | null;
  live?: { startTime: number | null } | null;
};

async function render({ positionSec = 300, seekTargetSec = null, ...props }: Props) {
  root = createRoot();
  const current = root;
  await act(async () => {
    current.render(
      <PlayerOverlay
        meta={meta}
        paused={false}
        positionSec={positionSec}
        durationSec={1200}
        seekTargetSec={seekTargetSec}
        onTogglePause={noop}
        onTimelineFocus={noop}
        onPlayPauseFocus={noop}
        onSkip={noop}
        onControlFocus={noop}
        onOpenSettings={noop}
        onSettingsFocus={noop}
        {...props}
      />,
    );
  });
  return current;
}

const nodes = (r: Root, testID: string) => r.container.queryAll(n => n.props.testID === testID);
const has = (r: Root, testID: string) => nodes(r, testID).length > 0;
const text = (r: Root, testID: string) => JSON.stringify(nodes(r, testID)[0]?.props.children ?? null);
const marks = (r: Root) =>
  r.container.queryAll(n => typeof n.props.testID === 'string' && n.props.testID.startsWith('player/mark/'));
const flat = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown>;

describe('chapter marks and the chapter name (Story 10.1)', () => {
  it('matrix «Happy path»: a mark per chapter except at 0; at 5:00 the name «Разбор»; the timeline label names it', async () => {
    const r = await render({ chapters: CHAPTERS });
    expect(marks(r).map(n => n.props.testID)).toEqual(['player/mark/225', 'player/mark/730']);
    expect(flat(nodes(r, 'player/mark/225')[0].props.style)).toMatchObject({ left: '18.75%' });
    expect(text(r, 'player/chapter')).toContain('Разбор');
    expect(nodes(r, 'player/chapter')[0].props.numberOfLines).toBe(1);
    expect(nodes(r, 'player/timeline')[0].props.accessibilityLabel).toBe(
      'Позиция 5:00 из 20:00. Глава: Разбор',
    );
  });

  it('a mark over the fill changes colour only (no layout change)', async () => {
    const r = await render({ chapters: CHAPTERS });
    const played = flat(nodes(r, 'player/mark/225')[0].props.style);
    const ahead = flat(nodes(r, 'player/mark/730')[0].props.style);
    expect(played.backgroundColor).toBe(components.timeline.markPlayed);
    expect(ahead.backgroundColor).toBe(components.timeline.mark);
    expect(played.width).toBe(ahead.width);
    expect(played.top).toBe(ahead.top);
    expect(played.bottom).toBe(ahead.bottom);
  });

  it('the name follows the pending target during a scrub', async () => {
    const r = await render({ chapters: CHAPTERS, positionSec: 300, seekTargetSec: 800 });
    expect(text(r, 'player/chapter')).toContain('Итоги');
    // The elapsed time stays the position.
    expect(text(r, 'player/elapsed')).toContain('5:00');
    // The timeline's label pairs the position with the chapter at the position.
    expect(nodes(r, 'player/timeline')[0].props.accessibilityLabel).toBe('Позиция 5:00 из 20:00. Глава: Разбор');
  });

  it('before the first chapter: no name', async () => {
    const r = await render({ chapters: [{ sec: 60, title: 'A' }], positionSec: 30 });
    expect(has(r, 'player/chapter')).toBe(false);
    expect(marks(r)).toHaveLength(1);
    expect(nodes(r, 'player/timeline')[0].props.accessibilityLabel).toBe('Позиция 0:30 из 20:00');
  });

  it('no chapters (the default): no marks, no name, the label as before', async () => {
    const r = await render({});
    expect(marks(r)).toHaveLength(0);
    expect(has(r, 'player/chapter')).toBe(false);
    expect(nodes(r, 'player/timeline')[0].props.accessibilityLabel).toBe(timelineA11yLabel(300, 1200));
  });

  it('live: no timeline, no marks, no name even when chapters are passed', async () => {
    const r = await render({ chapters: CHAPTERS, live: { startTime: null } });
    expect(has(r, 'player/timeline')).toBe(false);
    expect(marks(r)).toHaveLength(0);
    expect(has(r, 'player/chapter')).toBe(false);
  });
});

describe('the chapter strip items (Story 10.1)', () => {
  it('a title equal to the formatted time is not shown twice; another title gets its own line', async () => {
    root = createRoot();
    const current = root;
    await act(async () => {
      current.render(
        <ChapterStrip
          chapters={[
            { sec: 7, title: '0:07' },
            { sec: 225, title: 'Разбор' },
          ]}
          initialIndex={0}
          currentIndex={0}
          initialRef={() => {}}
          onSelect={noop}
          onItemFocus={noop}
        />,
      );
    });
    expect(has(current, 'player/chapters/7/time')).toBe(true);
    expect(has(current, 'player/chapters/7/title')).toBe(false);
    expect(text(current, 'player/chapters/225/title')).toContain('Разбор');
  });
});
