/**
 * Story 14.2 (our improvement IMP-08): the overlay's «Таймер сна · 12:34» /
 * «Таймер сна · до конца» in the top band while a sleep timer runs; plain
 * tabular text (not focusable, no live region); none without a timer.
 */
import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { PLAYER_CONTROL_IDS, PLAYER_SLEEP_EXTEND_ID, PlayerOverlay, SLEEP_TICK_MS } from '../PlayerOverlay';
import { sleepClockNow, type SleepIndicator } from '../useSleepTimer';

const noop = () => {};
const meta = {
  authorName: 'Автор',
  authorAvatarUrl: null,
  postTitle: 'Пост',
  videoTitle: '',
};
const T0 = Date.UTC(2026, 10, 3, 20, 0, 0);

let root: Root | null = null;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
});

afterEach(async () => {
  if (root) {
    const current = root;
    root = null;
    await act(async () => current.unmount());
  }
  jest.useRealTimers();
});

type Extra = {
  sleepWarning?: { deadlineAt: number; onExtend: () => void; onExtendFocus: () => void } | null;
  sleepNotice?: boolean;
};

function element(
  sleep: SleepIndicator | null | undefined,
  live: { startTime: number | null } | null = null,
  extra: Extra = {},
) {
  return (
    <PlayerOverlay
      meta={meta}
      paused={false}
      positionSec={60}
      durationSec={600}
      seekTargetSec={null}
      onTogglePause={noop}
      onTimelineFocus={noop}
      onPlayPauseFocus={noop}
      onSkip={noop}
      onControlFocus={noop}
      onOpenSettings={noop}
      onSettingsFocus={noop}
      live={live}
      sleep={sleep}
      sleepWarning={extra.sleepWarning}
      sleepNotice={extra.sleepNotice}
    />
  );
}

async function render(
  sleep: SleepIndicator | null | undefined,
  live: { startTime: number | null } | null = null,
) {
  root = createRoot();
  const current = root;
  await act(async () => current.render(element(sleep, live)));
  return current;
}

const node = (r: Root) =>
  r.container.queryAll(n => n.props.testID === 'player/sleep')[0];
const shown = (r: Root) =>
  node(r) ? JSON.stringify(node(r).props.children) : null;

test('no timer: no indicator', async () => {
  const r = await render(undefined);
  expect(node(r)).toBeUndefined();
  root = null;
  await act(async () => r.unmount());
  const r2 = await render(null);
  expect(node(r2)).toBeUndefined();
});

test('a fixed timer: the wall-clock time left, ticking every second; tabular, not focusable, no live region', async () => {
  const r = await render({
    kind: 'deadline',
    deadlineAt: sleepClockNow() + 30 * 60_000,
  });
  expect(shown(r)).toBe('"Таймер сна · 30:00"');
  await act(async () => {
    jest.advanceTimersByTime(SLEEP_TICK_MS);
  });
  expect(shown(r)).toBe('"Таймер сна · 29:59"');
  expect(node(r).props.accessibilityLiveRegion).toBeUndefined();
  expect(node(r).props.focusable).toBeUndefined();
  expect(StyleSheet.flatten(node(r).props.style)).toMatchObject({
    fontVariant: ['tabular-nums'],
  });
  // Inside the top band.
  const top = r.container.queryAll(n => n.props.testID === 'player/top')[0];
  expect(top.queryAll(n => n.props.testID === 'player/sleep')).toHaveLength(1);
});

test('60 and 90 minutes show hours; never below 0:00', async () => {
  const r = await render({
    kind: 'deadline',
    deadlineAt: sleepClockNow() + 60 * 60_000,
  });
  expect(shown(r)).toBe('"Таймер сна · 1:00:00"');
  await act(async () =>
    r.render(
      element({
        kind: 'deadline',
        deadlineAt: sleepClockNow() + 90 * 60_000,
      }),
    ),
  );
  expect(shown(r)).toBe('"Таймер сна · 1:30:00"');
  await act(async () => {
    jest.advanceTimersByTime(91 * 60_000);
  });
  expect(shown(r)).toBe('"Таймер сна · 0:00"');
});

test('«До конца видео»: «Таймер сна · до конца»', async () => {
  const r = await render({ kind: 'end' });
  expect(shown(r)).toBe('"Таймер сна · до конца"');
});

test('live: the indicator shows too', async () => {
  const r = await render(
    { kind: 'deadline', deadlineAt: sleepClockNow() + 15 * 60_000 },
    { startTime: null },
  );
  expect(shown(r)).toBe('"Таймер сна · 15:00"');
});

test('a new deadline shows its own time left at once (never a stale clock), after time passed', async () => {
  const r = await render({
    kind: 'deadline',
    deadlineAt: sleepClockNow() + 15 * 60_000,
  });
  // Time passes without a tick re-render (the overlay hidden in between, say).
  await act(async () => {
    jest.advanceTimersByTime(5 * 60_000 + 500);
  });
  await act(async () =>
    r.render(
      element({
        kind: 'deadline',
        deadlineAt: sleepClockNow() + 30 * 60_000,
      }),
    ),
  );
  expect(shown(r)).toBe('"Таймер сна · 30:00"');
});

test('the device clock changing does not move the time left', async () => {
  const r = await render({
    kind: 'deadline',
    deadlineAt: sleepClockNow() + 30 * 60_000,
  });
  jest.setSystemTime(T0 + 3 * 60 * 60_000);
  await act(async () => {
    jest.advanceTimersByTime(SLEEP_TICK_MS);
  });
  expect(shown(r)).toBe('"Таймер сна · 29:59"');
});

describe('the warning and the notice (owner decisions 2026-11-03, after review)', () => {
  test('«Ещё 15 мин» (focusable, its a11y label) next to «Пауза через 1:00», ticking; the «Таймер сна · …» line is replaced; OK → onExtend', async () => {
    const onExtend = jest.fn();
    const deadlineAt = sleepClockNow() + 60_000;
    root = createRoot();
    const r = root;
    await act(async () =>
      r.render(
        element({ kind: 'deadline', deadlineAt }, null, { sleepWarning: { deadlineAt, onExtend, onExtendFocus: noop } }),
      ),
    );
    const button = r.container.queryAll(n => n.props.testID === PLAYER_SLEEP_EXTEND_ID && n.props.focusable === true)[0];
    expect(button.props.accessibilityLabel).toBe('Ещё 15 минут до паузы');
    expect(PLAYER_CONTROL_IDS.has(PLAYER_SLEEP_EXTEND_ID)).toBe(true);
    const countdown = () =>
      JSON.stringify(r.container.queryAll(n => n.props.testID === 'player/sleep/countdown')[0].props.children);
    expect(countdown()).toBe('"Пауза через 1:00"');
    expect(node(r)).toBeUndefined();
    await act(async () => {
      jest.advanceTimersByTime(SLEEP_TICK_MS);
    });
    expect(countdown()).toBe('"Пауза через 0:59"');
    await act(async () => button.props.onClick({ nativeEvent: {} }));
    expect(onExtend).toHaveBeenCalledTimes(1);
    const top = r.container.queryAll(n => n.props.testID === 'player/top')[0];
    expect(top.queryAll(n => n.props.testID === 'player/sleep/warning')).toHaveLength(1);
  });

  test('«Пауза по таймеру сна» in the top band only with `sleepNotice`', async () => {
    root = createRoot();
    const r = root;
    await act(async () => r.render(element(null, null, { sleepNotice: true })));
    const notice = r.container.queryAll(n => n.props.testID === 'player/sleep/notice')[0];
    expect(JSON.stringify(notice.props.children)).toBe('"Пауза по таймеру сна"');
    await act(async () => r.render(element(null, null, { sleepNotice: false })));
    expect(r.container.queryAll(n => n.props.testID === 'player/sleep/notice')).toHaveLength(0);
  });
});
