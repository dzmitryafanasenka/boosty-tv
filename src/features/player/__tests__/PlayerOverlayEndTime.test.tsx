/**
 * Story 14.1 (our improvement, FR-65): «Закончится в H:MM» next to the
 * remaining time for a VOD with a known duration; now + remaining / speed on
 * the device clock; recomputed on position and speed changes and by a timer
 * (also while paused); none on live or without a duration.
 */
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { ENDS_AT_TICK_MS, PlayerOverlay } from '../PlayerOverlay';
import { END_TIME_HYSTERESIS_MS, endTimeMs, remainingWallMs, stableEndTime } from '../endTime';
import type { PlaybackSpeed } from '../speedPreference';
import { formatClockTime } from '../../../shared/i18n/format';

const noop = () => {};
const meta = { authorName: 'Автор', authorAvatarUrl: null, postTitle: 'Пост', videoTitle: '' };

let root: Root | null = null;

beforeEach(() => {
  jest.useFakeTimers();
  // Local-time constructor: the assertions do not depend on the host zone.
  jest.setSystemTime(new Date(2026, 10, 3, 21, 0, 0).getTime());
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
  positionSec?: number;
  durationSec?: number;
  rate?: PlaybackSpeed;
  paused?: boolean;
  live?: { startTime: number | null } | null;
};

function element(props: Props) {
  return (
    <PlayerOverlay
      meta={meta}
      paused={props.paused ?? false}
      positionSec={props.positionSec ?? 600}
      durationSec={props.durationSec ?? 3600}
      seekTargetSec={null}
      onTogglePause={noop}
      onTimelineFocus={noop}
      onPlayPauseFocus={noop}
      onSkip={noop}
      onControlFocus={noop}
      onOpenSettings={noop}
      onSettingsFocus={noop}
      rate={props.rate}
      live={props.live}
    />
  );
}

async function render(props: Props) {
  root = createRoot();
  const current = root;
  await act(async () => current.render(element(props)));
  return current;
}

async function rerender(r: Root, props: Props) {
  await act(async () => r.render(element(props)));
}

const has = (r: Root, testID: string) => r.container.queryAll(n => n.props.testID === testID).length > 0;
const text = (r: Root, testID: string) => {
  const node = r.container.queryAll(n => n.props.testID === testID)[0];
  return node ? JSON.stringify(node.props.children) : null;
};

describe('endTimeMs', () => {
  const now = new Date(2026, 10, 3, 21, 0, 0).getTime();
  it('now + remaining at 1×', () => {
    expect(formatClockTime(endTimeMs(now, 600, 3600, 1) as number)).toBe('21:50');
  });
  it('the speed divides the remaining media time', () => {
    expect(formatClockTime(endTimeMs(now, 600, 3600, 1.5) as number)).toBe('21:33');
    expect(formatClockTime(endTimeMs(now, 600, 3600, 0.5) as number)).toBe('22:40');
  });
  it('past midnight and the H:MM style', () => {
    const late = new Date(2026, 10, 3, 23, 50, 0).getTime();
    expect(formatClockTime(endTimeMs(late, 0, 1200, 1) as number)).toBe('0:10');
  });
  it('at or past the end: now', () => {
    expect(endTimeMs(now, 3600, 3600, 1)).toBe(now);
    expect(endTimeMs(now, 4000, 3600, 1)).toBe(now);
  });
  it('unknown duration or no positive rate: null', () => {
    expect(endTimeMs(now, 10, 0, 1)).toBeNull();
    expect(endTimeMs(now, 10, 3600, 0)).toBeNull();
  });
});

describe('remainingWallMs and stableEndTime', () => {
  it('remaining wall time at a speed', () => {
    expect(remainingWallMs(600, 3600, 1)).toBe(3_000_000);
    expect(remainingWallMs(600, 3600, 2)).toBe(1_500_000);
    expect(remainingWallMs(600, 0, 1)).toBeNull();
  });
  it('a wobble within the hysteresis keeps the shown value; a larger move replaces it', () => {
    expect(stableEndTime(null, 1000)).toBe(1000);
    expect(stableEndTime(1000, 1000 + END_TIME_HYSTERESIS_MS)).toBe(1000);
    expect(stableEndTime(1000, 1000 + END_TIME_HYSTERESIS_MS + 1)).toBe(1000 + END_TIME_HYSTERESIS_MS + 1);
    expect(stableEndTime(1000, null)).toBeNull();
  });
});

describe('the overlay end time', () => {
  it('playing at a minute edge: the position tick and the running clock do not flip the minute', async () => {
    // Raw end values 21:49:59.7, 21:50:00.2, 21:49:59.8, 21:50:00.3: without
    // the hysteresis the text would alternate «21:49» / «21:50».
    const steps: Array<[number, number, number]> = [
      [0, 700, 601],
      [1, 200, 601],
      [1, 800, 602],
      [2, 300, 602],
    ];
    jest.setSystemTime(new Date(2026, 10, 3, 21, 0, steps[0][0], steps[0][1]).getTime());
    const r = await render({ positionSec: steps[0][2], durationSec: 3600 });
    const first = text(r, 'player/endsAt');
    for (const [sec, ms, pos] of steps.slice(1)) {
      jest.setSystemTime(new Date(2026, 10, 3, 21, 0, sec, ms).getTime());
      await rerender(r, { positionSec: pos, durationSec: 3600 });
      expect(text(r, 'player/endsAt')).toBe(first);
    }
  });

  it('a VOD with a duration: «Закончится в 21:50» next to the remaining time', async () => {
    const r = await render({});
    expect(text(r, 'player/remaining')).toContain('50:00');
    expect(text(r, 'player/endsAt')).toContain('Закончится в 21:50');
  });

  it('follows a speed change and a position change (seek done)', async () => {
    const r = await render({});
    await rerender(r, { rate: 1.5 });
    expect(text(r, 'player/endsAt')).toContain('Закончится в 21:33');
    await rerender(r, { rate: 1.5, positionSec: 2400 });
    expect(text(r, 'player/endsAt')).toContain('Закончится в 21:13');
  });

  it('paused: the timer moves the clock on (at least once a minute)', async () => {
    const r = await render({ paused: true });
    expect(text(r, 'player/endsAt')).toContain('21:50');
    expect(ENDS_AT_TICK_MS).toBeLessThanOrEqual(60_000);
    await act(async () => {
      jest.advanceTimersByTime(2 * 60_000);
    });
    expect(text(r, 'player/endsAt')).toContain('21:52');
  });

  it('unknown duration: no end time (and no remaining)', async () => {
    const r = await render({ durationSec: 0 });
    expect(has(r, 'player/endsAt')).toBe(false);
    expect(has(r, 'player/remaining')).toBe(false);
  });

  it('live: no end time', async () => {
    const r = await render({ live: { startTime: null } });
    expect(has(r, 'player/endsAt')).toBe(false);
  });

  it('not focusable and not a live region', async () => {
    const r = await render({});
    const node = r.container.queryAll(n => n.props.testID === 'player/endsAt')[0];
    expect(node.props.focusable).toBeUndefined();
    expect(node.props.accessibilityLiveRegion).toBeUndefined();
  });
});
