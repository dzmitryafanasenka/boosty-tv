/**
 * Story 8.1 review: the settings sheet's levels when its data changes under
 * an open submenu; Story 14.2: the «Таймер сна» row and submenu. The full
 * sheet flows (open, Back order, picks) are in
 * `__tests__/playerQualityFlow.test.tsx` «quality (Story 4.3)»,
 * `__tests__/playerSpeedFlow.test.tsx` «Story 8.1» and
 * `__tests__/playerSleepFlow.test.tsx` «Story 14.2».
 */
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { requestHostFocus } from '../../../shared/ui/requestHostFocus';
import {
  PLAYER_SHEET_ID,
  PLAYER_SHEET_QUALITY_ID,
  PLAYER_SHEET_SLEEP_ID,
  PLAYER_SHEET_SPEED_ID,
  PlayerSettingsSheet,
  createSettingsSheetModel,
  sleepRowId,
  speedRowId,
  type SettingsSheetData,
} from '../PlayerSettingsSheet';

jest.mock('../../../shared/ui/requestHostFocus', () => ({ requestHostFocus: jest.fn() }));

const focusMock = requestHostFocus as jest.Mock;
let root: Root | null = null;

beforeEach(() => {
  jest.useFakeTimers();
  focusMock.mockClear();
});

afterEach(async () => {
  if (root) {
    const current = root;
    root = null;
    await act(async () => current.unmount());
  }
  jest.useRealTimers();
});

const has = (r: Root, testID: string) => r.container.queryAll(n => n.props.testID === testID).length > 0;
const press = async (r: Root, testID: string) => {
  const [node] = r.container.queryAll(n => n.props.testID === testID && n.props.focusable === true);
  await act(async () => node.props.onClick({ nativeEvent: {} }));
};
const frames = async () => {
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
};
const BASE: SettingsSheetData = {
  quality: true,
  options: ['auto', 720],
  selected: 'auto',
  autoHeight: null,
  speed: 1,
  sleep: 'off',
  sleepEnd: true,
};
const focusables = (r: Root, testID: string) =>
  r.container
    .queryAll(n => n.props.testID === testID)[0]
    .queryAll(n => n.props.focusable === true)
    .map(n => n.props.testID as string);
async function mount(data: SettingsSheetData, onPickSleep = jest.fn()) {
  const model = createSettingsSheetModel(data);
  root = createRoot();
  const current = root;
  await act(async () => {
    current.render(
      <PlayerSettingsSheet model={model} onPick={jest.fn()} onPickSpeed={jest.fn()} onPickSleep={onPickSleep} onClosed={jest.fn()} />,
    );
  });
  await frames();
  return { model, current };
}
const lastFocus = () => (focusMock.mock.calls.at(-1)?.[0] as { props?: { testID?: string } } | undefined)?.props?.testID;

test('the speed row going away while its submenu is open: the sheet, focus on «Качество» (never the quality submenu)', async () => {
  const { model, current } = await mount(BASE);
  await press(current, PLAYER_SHEET_SPEED_ID);
  await frames();
  expect(has(current, `${PLAYER_SHEET_SPEED_ID}/menu`)).toBe(true);
  expect(lastFocus()).toBe(speedRowId(1));
  focusMock.mockClear();
  await act(async () => model.set({ ...BASE, speed: null }));
  await frames();
  expect(has(current, `${PLAYER_SHEET_SPEED_ID}/menu`)).toBe(false);
  expect(has(current, `${PLAYER_SHEET_QUALITY_ID}/menu`)).toBe(false);
  expect(has(current, PLAYER_SHEET_ID)).toBe(true);
  expect(has(current, PLAYER_SHEET_SPEED_ID)).toBe(false);
  expect(lastFocus()).toBe(PLAYER_SHEET_QUALITY_ID);
});

describe('Story 14.2: «Таймер сна»', () => {
  test('the row is last, «Выкл» by default; the submenu lists Выкл, 15/30/60/90 мин and «До конца видео», «Выкл» checked and focused', async () => {
    const onPickSleep = jest.fn();
    const { current } = await mount(BASE, onPickSleep);
    expect(focusables(current, PLAYER_SHEET_ID)).toEqual([PLAYER_SHEET_QUALITY_ID, PLAYER_SHEET_SPEED_ID, PLAYER_SHEET_SLEEP_ID]);
    const row = current.container.queryAll(n => n.props.testID === PLAYER_SHEET_SLEEP_ID && n.props.focusable === true)[0];
    expect(row.props.accessibilityLabel).toBe('Таймер сна Выкл');
    focusMock.mockClear();
    await press(current, PLAYER_SHEET_SLEEP_ID);
    await frames();
    expect(focusables(current, `${PLAYER_SHEET_SLEEP_ID}/menu`)).toEqual(
      (['off', 15, 30, 60, 90, 'end'] as const).map(sleepRowId),
    );
    expect(sleepRowId('off')).toBe('player/sheet/sleep/off');
    expect(lastFocus()).toBe(sleepRowId('off'));
    await press(current, sleepRowId(30));
    expect(onPickSleep).toHaveBeenCalledWith(30);
  });

  test('«До конца видео» is not offered without a known duration or on live (`sleepEnd` false)', async () => {
    const { current } = await mount({ ...BASE, sleepEnd: false });
    await press(current, PLAYER_SHEET_SLEEP_ID);
    await frames();
    expect(focusables(current, `${PLAYER_SHEET_SLEEP_ID}/menu`)).toEqual(
      (['off', 15, 30, 60, 90] as const).map(sleepRowId),
    );
  });

  test('«До конца видео» chosen, then no longer offered: still listed, checked and focused', async () => {
    const { current } = await mount({ ...BASE, sleep: 'end', sleepEnd: false });
    focusMock.mockClear();
    await press(current, PLAYER_SHEET_SLEEP_ID);
    await frames();
    expect(focusables(current, `${PLAYER_SHEET_SLEEP_ID}/menu`)).toEqual(
      (['off', 15, 30, 60, 90, 'end'] as const).map(sleepRowId),
    );
    const end = current.container.queryAll(n => n.props.testID === sleepRowId('end') && n.props.focusable === true)[0];
    expect(end.props.accessibilityState).toMatchObject({ selected: true });
    expect(lastFocus()).toBe(sleepRowId('end'));
  });

  test('the row shows the current choice; its submenu focuses it', async () => {
    const { current } = await mount({ ...BASE, sleep: 60 });
    const label = (id: string) =>
      current.container.queryAll(n => n.props.testID === id && n.props.focusable === true)[0].props.accessibilityLabel;
    expect(label(PLAYER_SHEET_SLEEP_ID)).toBe('Таймер сна 60 мин');
    await press(current, PLAYER_SHEET_SLEEP_ID);
    await frames();
    expect(lastFocus()).toBe(sleepRowId(60));
  });

  test('live without a quality choice: «Таймер сна» is the only row and gets the initial focus', async () => {
    const { current } = await mount({ ...BASE, quality: false, speed: null, sleepEnd: false });
    expect(focusables(current, PLAYER_SHEET_ID)).toEqual([PLAYER_SHEET_SLEEP_ID]);
    expect(lastFocus()).toBe(PLAYER_SHEET_SLEEP_ID);
  });
});
