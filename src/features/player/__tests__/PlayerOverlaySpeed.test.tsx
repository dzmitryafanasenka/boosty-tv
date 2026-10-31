/**
 * Story 8.1 (owner decision Q1 a, our improvement): while the rate is not
 * 1, the overlay shows a small «N×» label next to the elapsed time; none at
 * 1× and none on live. The times stay media time.
 */
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { PlayerOverlay } from '../PlayerOverlay';
import type { PlaybackSpeed } from '../speedPreference';

const noop = () => {};
const meta = { authorName: 'Автор', authorAvatarUrl: null, postTitle: 'Пост', videoTitle: '' };

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

async function render(props: { rate?: PlaybackSpeed; live?: { startTime: number | null } | null }) {
  root = createRoot();
  const current = root;
  await act(async () => {
    current.render(
      <PlayerOverlay
        meta={meta}
        paused={false}
        positionSec={125}
        durationSec={600}
        seekTargetSec={null}
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

const has = (r: Root, testID: string) => r.container.queryAll(n => n.props.testID === testID).length > 0;
const text = (r: Root, testID: string) => {
  const node = r.container.queryAll(n => n.props.testID === testID)[0];
  return node ? JSON.stringify(node.props.children) : null;
};

describe('the overlay speed label', () => {
  it('1× (and the default): no label', async () => {
    const r = await render({ rate: 1 });
    expect(has(r, 'player/speed')).toBe(false);
    expect(text(r, 'player/elapsed')).toContain('2:05');
    await act(async () => r.unmount());
    root = null;
    const byDefault = await render({});
    expect(has(byDefault, 'player/speed')).toBe(false);
  });

  it.each<[PlaybackSpeed, string]>([
    [1.5, '1.5×'],
    [0.75, '0.75×'],
    [3, '3×'],
  ])('rate %p → «%s» next to the elapsed media time; the remaining time is media time', async (rate, expected) => {
    const r = await render({ rate });
    expect(text(r, 'player/speed')).toContain(expected);
    expect(text(r, 'player/elapsed')).toContain('2:05');
    expect(text(r, 'player/remaining')).toContain('7:55');
  });

  it('live: no label, whatever the rate', async () => {
    const r = await render({ rate: 2, live: { startTime: null } });
    expect(has(r, 'player/speed')).toBe(false);
  });
});
