/**
 * Story 8.1 review: the settings sheet's levels when its data changes under
 * an open submenu. The full sheet flows (open, Back order, picks) are in
 * `__tests__/playerFlow.test.tsx` «quality (Story 4.3)» and «Story 8.1».
 */
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { requestHostFocus } from '../../../shared/ui/requestHostFocus';
import {
  PLAYER_SHEET_ID,
  PLAYER_SHEET_QUALITY_ID,
  PLAYER_SHEET_SPEED_ID,
  PlayerSettingsSheet,
  createSettingsSheetModel,
  speedRowId,
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
const lastFocus = () => (focusMock.mock.calls.at(-1)?.[0] as { props?: { testID?: string } } | undefined)?.props?.testID;

test('the speed row going away while its submenu is open: the sheet, focus on «Качество» (never the quality submenu)', async () => {
  const model = createSettingsSheetModel({ options: ['auto', 720], selected: 'auto', autoHeight: null, speed: 1 });
  root = createRoot();
  const current = root;
  await act(async () => {
    current.render(<PlayerSettingsSheet model={model} onPick={jest.fn()} onPickSpeed={jest.fn()} onClosed={jest.fn()} />);
  });
  await press(current, PLAYER_SHEET_SPEED_ID);
  await frames();
  expect(has(current, `${PLAYER_SHEET_SPEED_ID}/menu`)).toBe(true);
  expect(lastFocus()).toBe(speedRowId(1));
  focusMock.mockClear();
  await act(async () => model.set({ options: ['auto', 720], selected: 'auto', autoHeight: null, speed: null }));
  await frames();
  expect(has(current, `${PLAYER_SHEET_SPEED_ID}/menu`)).toBe(false);
  expect(has(current, `${PLAYER_SHEET_QUALITY_ID}/menu`)).toBe(false);
  expect(has(current, PLAYER_SHEET_ID)).toBe(true);
  expect(has(current, PLAYER_SHEET_SPEED_ID)).toBe(false);
  expect(lastFocus()).toBe(PLAYER_SHEET_QUALITY_ID);
});
