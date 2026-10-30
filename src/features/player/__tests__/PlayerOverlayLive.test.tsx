/**
 * Story 7.2 (focus-map G9–G10): the overlay's live variant. The LIVE badge
 * and the elapsed time since `startTime` (ticking every second, none
 * without a start time) replace the timeline and the times; no ±10 s; the
 * gear only when the page says there is a real quality choice.
 */
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { t } from '../../../shared/i18n';
import {
  LIVE_ELAPSED_TICK_MS,
  PLAYER_BACK10_ID,
  PLAYER_FORWARD10_ID,
  PLAYER_PLAYPAUSE_ID,
  PLAYER_SETTINGS_ID,
  PLAYER_TIMELINE_ID,
  PlayerOverlay,
  liveElapsedSec,
} from '../PlayerOverlay';

const noop = () => {};
const START = 1_700_018_000;
const meta = { authorName: 'Автор', authorAvatarUrl: null, postTitle: 'Эфир', videoTitle: '' };

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

async function render(props: { live?: { startTime: number | null } | null; showSettings?: boolean }) {
  root = createRoot();
  const current = root;
  await act(async () => {
    current.render(
      <PlayerOverlay
        meta={meta}
        paused={false}
        positionSec={42}
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

describe('liveElapsedSec', () => {
  it('whole seconds since the start, never negative', () => {
    expect(liveElapsedSec(START, (START + 75) * 1000 + 999)).toBe(75);
    expect(liveElapsedSec(START, (START - 10) * 1000)).toBe(0);
  });
});

describe('the live overlay', () => {
  it('the LIVE badge and the elapsed time; no timeline, times or ±10 s; play/pause stays', async () => {
    jest.setSystemTime((START + 3725) * 1000);
    const r = await render({ live: { startTime: START }, showSettings: false });
    expect(text(r, 'player/live/badge')).toContain(t('author.live.badgeLive'));
    expect(text(r, 'player/live/elapsed')).toContain('1:02:05');
    for (const id of [PLAYER_TIMELINE_ID, 'player/elapsed', 'player/remaining', PLAYER_BACK10_ID, PLAYER_FORWARD10_ID]) {
      expect(has(r, id)).toBe(false);
    }
    expect(has(r, PLAYER_PLAYPAUSE_ID)).toBe(true);
    expect(text(r, 'player/title')).toContain('Эфир');
  });

  it('the elapsed time ticks every second', async () => {
    jest.setSystemTime((START + 59) * 1000);
    const r = await render({ live: { startTime: START }, showSettings: false });
    expect(text(r, 'player/live/elapsed')).toContain('0:59');
    await act(async () => {
      jest.advanceTimersByTime(LIVE_ELAPSED_TICK_MS);
    });
    expect(text(r, 'player/live/elapsed')).toContain('1:00');
    await act(async () => {
      jest.advanceTimersByTime(LIVE_ELAPSED_TICK_MS * 60);
    });
    expect(text(r, 'player/live/elapsed')).toContain('2:00');
  });

  it('no start time: the badge without an elapsed time', async () => {
    const r = await render({ live: { startTime: null }, showSettings: false });
    expect(has(r, 'player/live/badge')).toBe(true);
    expect(has(r, 'player/live/elapsed')).toBe(false);
  });

  it('the gear only with a real choice (owner decision 2026-10-30)', async () => {
    const without = await render({ live: { startTime: START }, showSettings: false });
    expect(has(without, PLAYER_SETTINGS_ID)).toBe(false);
    await act(async () => without.unmount());
    root = null;
    const withChoice = await render({ live: { startTime: START }, showSettings: true });
    expect(has(withChoice, PLAYER_SETTINGS_ID)).toBe(true);
  });

  it('a video keeps the timeline, the times, ±10 s and the gear', async () => {
    const r = await render({});
    for (const id of [PLAYER_TIMELINE_ID, 'player/elapsed', 'player/remaining', PLAYER_BACK10_ID, PLAYER_FORWARD10_ID, PLAYER_SETTINGS_ID]) {
      expect(has(r, id)).toBe(true);
    }
    expect(has(r, 'player/live')).toBe(false);
  });
});
