import { act } from 'react';
import { DeviceEventEmitter, NativeModules } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { PERIOD_DONE_ID, PeriodStepper, STEPPER_ENTRY_GUARD_MS, stepperFieldId, type CalendarDay } from '..';
import { STEPPER_HOLD_REPEAT_MS } from '../PeriodStepper';
import { t } from '../../i18n';
import { requestHostFocus } from '../../ui/requestHostFocus';
// eslint-disable-next-line boundaries/dependencies -- test-only mock
import { tvEvents } from '../../../test/tvEventMock';
// eslint-disable-next-line boundaries/dependencies -- test-only recorder
import { destinationIds } from '../../../test/flow';

jest.mock('../../ui/requestHostFocus', () => ({ requestHostFocus: jest.fn() }));
jest.mock('react-native/Libraries/Components/TV/TVEventHandler', () =>
  // eslint-disable-next-line boundaries/dependencies -- test-only mock
  require('../../../test/tvEventMock'),
);
jest.mock('react-native/Libraries/Components/TV/TVFocusGuideView', () =>
  // eslint-disable-next-line boundaries/dependencies -- test-only recorder
  require('../../../test/flow').recordingFocusGuideModule(),
);

const focusMock = requestHostFocus as jest.Mock;
const day = (year: number, month: number, d: number): CalendarDay => ({ year, month, day: d });
const TODAY = day(2026, 10, 28);
const FROM_DAY = stepperFieldId('from', 'day');
const FROM_MONTH = stepperFieldId('from', 'month');
const FROM_YEAR = stepperFieldId('from', 'year');
const TO_DAY = stepperFieldId('to', 'day');
const TO_MONTH = stepperFieldId('to', 'month');

const KEY_DOWN = 0;
const KEY_UP = 1;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 28, 12).getTime());
  tvEvents.reset();
  focusMock.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

async function render(from: CalendarDay, to: CalendarDay, onDone = jest.fn()) {
  const root = createRoot();
  await act(async () => {
    root.render(<PeriodStepper initialFrom={from} initialTo={to} today={TODAY} onDone={onDone} />);
  });
  return { root, onDone };
}

/** The focusable host node of a testID. */
function host(root: Root, id: string) {
  const nodes = root.container.queryAll(n => n.props.testID === id && typeof n.props.onFocus === 'function');
  expect(nodes.length).toBeGreaterThan(0);
  return nodes[0];
}
const valueOf = (root: Root, id: string) =>
  JSON.stringify(root.container.queryAll(n => n.props.testID === `${id}/value`)[0].toJSON?.() ?? null)
    .match(/"children":\["([^"]+)"\]/)?.[1];
const textOf = (root: Root) => JSON.stringify(root.container.toJSON());

async function focus(root: Root, id: string) {
  await act(async () => {
    host(root, id).props.onFocus({ nativeEvent: {} });
  });
}
async function press(root: Root, id: string) {
  await act(async () => {
    host(root, id).props.onClick({ nativeEvent: {} });
  });
}
async function key(eventType: string, eventKeyAction = KEY_UP) {
  await act(async () => {
    tvEvents.emit({ eventType, eventKeyAction });
  });
}
/** Past the entry guard window. */
async function wait(ms = STEPPER_ENTRY_GUARD_MS + 1) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('PeriodStepper (Story 5.4, D10)', () => {
  it('opens on «С: день» with the given range and the range in words', async () => {
    const { root } = await render(day(2026, 8, 1), day(2026, 9, 25));
    const targets = focusMock.mock.calls.map(c => (c[0] as { props?: { testID?: string } } | null)?.props?.testID);
    expect(targets[0]).toBe(FROM_DAY);
    expect(host(root, FROM_DAY).props.accessibilityLabel).toBe('С, день: 1');
    expect(host(root, FROM_MONTH).props.accessibilityLabel).toBe('С, месяц: август');
    expect(host(root, TO_MONTH).props.accessibilityLabel).toBe('По, месяц: сентябрь');
    expect(valueOf(root, FROM_MONTH)).toBe('авг');
    expect(textOf(root)).toContain('1 августа 2026 — 25 сентября 2026');
    expect(host(root, PERIOD_DONE_ID).props.focusable).toBe(true);
    await act(async () => root.unmount());
  });

  it('↑ / ↓ change the focused field on key up only; key down does nothing', async () => {
    const { root } = await render(day(2026, 8, 1), day(2026, 9, 25));
    await focus(root, FROM_DAY);
    await wait();
    await key('up', KEY_DOWN);
    expect(valueOf(root, FROM_DAY)).toBe('1');
    await key('up');
    expect(valueOf(root, FROM_DAY)).toBe('2');
    await key('down');
    await key('down');
    // No wrap-around below 1.
    expect(valueOf(root, FROM_DAY)).toBe('1');
    // ← → are native focus moves, never a value change.
    await key('left');
    await key('right');
    expect(valueOf(root, FROM_DAY)).toBe('1');
    // A held key (device: `longUp`, key down then key up) is one step.
    await key('longUp', KEY_DOWN);
    await key('longUp');
    expect(valueOf(root, FROM_DAY)).toBe('2');
    await key('longDown');
    expect(valueOf(root, FROM_DAY)).toBe('1');
    // The month field of the other group.
    await focus(root, TO_MONTH);
    await key('up');
    expect(valueOf(root, TO_MONTH)).toBe('окт');
    // In the current year October is the last month (no future dates).
    await key('up');
    expect(valueOf(root, TO_MONTH)).toBe('окт');
    await act(async () => root.unmount());
  });

  it('the entry guard: entering the fields from «Готово» ignores the first ↑ within 500 ms', async () => {
    const { root } = await render(day(2026, 8, 1), day(2026, 9, 25));
    await focus(root, FROM_DAY);
    await press(root, FROM_DAY);
    await focus(root, PERIOD_DONE_ID);
    // ↑ from «Готово» lands on «С: день»; that press's key up arrives.
    await focus(root, FROM_DAY);
    await key('up');
    expect(valueOf(root, FROM_DAY)).toBe('1');
    // The next press counts, even inside the window.
    await key('up');
    expect(valueOf(root, FROM_DAY)).toBe('2');
    // After the window the guard is not applied (a fresh entry, a late key).
    await focus(root, PERIOD_DONE_ID);
    await focus(root, FROM_DAY);
    await wait();
    await key('up');
    expect(valueOf(root, FROM_DAY)).toBe('3');
    await act(async () => root.unmount());
  });

  it('no entry guard on the open: an ↑ right after the stepper opened steps (the open press is OK)', async () => {
    const { root } = await render(day(2026, 8, 1), day(2026, 9, 25));
    await focus(root, FROM_DAY);
    await key('up');
    expect(valueOf(root, FROM_DAY)).toBe('2');
    await act(async () => root.unmount());
  });

  it('TalkBack: each box is adjustable with increment / decrement, one step of its own field within the limits', async () => {
    const { root } = await render(day(2026, 8, 31), day(2026, 10, 28));
    const box = host(root, TO_DAY);
    expect(box.props.accessibilityRole).toBe('adjustable');
    expect(box.props.accessibilityActions).toEqual([{ name: 'increment' }, { name: 'decrement' }]);
    const adjust = async (id: string, actionName: string) => {
      await act(async () => {
        host(root, id).props.onAccessibilityAction({ nativeEvent: { actionName } });
      });
    };
    // 28 Oct is today: no step into the future.
    await adjust(TO_DAY, 'increment');
    expect(valueOf(root, TO_DAY)).toBe('28');
    await adjust(TO_DAY, 'decrement');
    expect(valueOf(root, TO_DAY)).toBe('27');
    // The month box clamps its day (31 Aug → 30 Sep); other boxes are untouched.
    await adjust(FROM_MONTH, 'increment');
    expect(valueOf(root, FROM_MONTH)).toBe('сен');
    expect(valueOf(root, FROM_DAY)).toBe('30');
    expect(valueOf(root, TO_DAY)).toBe('27');
    await adjust(FROM_MONTH, 'activate');
    expect(valueOf(root, FROM_MONTH)).toBe('сен');
    await act(async () => root.unmount());
  });

  it('the entry guard: a key up that reached JS before the focus event already spent it', async () => {
    const { root } = await render(day(2026, 8, 1), day(2026, 9, 25));
    await focus(root, PERIOD_DONE_ID);
    // Device order: the key up first (on «Готово»: nothing), then the focus.
    await key('up');
    await focus(root, FROM_DAY);
    expect(valueOf(root, FROM_DAY)).toBe('1');
    await key('up');
    expect(valueOf(root, FROM_DAY)).toBe('2');
    await act(async () => root.unmount());
  });

  it('← → between the groups: the «С» row ends in a band to «По: день», the «По» row starts with one to «С: год»', async () => {
    const { root } = await render(day(2026, 8, 1), day(2026, 9, 25));
    expect(destinationIds('filters/period/custom/from/band')).toEqual([TO_DAY]);
    expect(destinationIds('filters/period/custom/to/band')).toEqual([FROM_YEAR]);
    // ↑ from «Готово» → «С: день»: the «По» row's destination only while «Готово» has focus.
    expect(destinationIds('filters/period/custom/to/row')).toEqual([]);
    await focus(root, PERIOD_DONE_ID);
    expect(destinationIds('filters/period/custom/to/row')).toEqual([FROM_DAY]);
    await focus(root, TO_DAY);
    expect(destinationIds('filters/period/custom/to/row')).toEqual([]);
    // Both rows trap every side (↑ ↓ never move focus natively).
    const rows = root.container.queryAll(n => n.props.testID === 'filters/period/custom/from/row');
    expect(rows[0].props).toEqual(
      expect.objectContaining({ trapFocusUp: true, trapFocusDown: true, trapFocusLeft: true, trapFocusRight: true }),
    );
    await act(async () => root.unmount());
  });

  it('OK on a field → «Готово»; «Готово» hands the range back', async () => {
    const { root, onDone } = await render(day(2026, 8, 1), day(2026, 9, 25));
    await focus(root, TO_DAY);
    focusMock.mockClear();
    await press(root, TO_DAY);
    expect((focusMock.mock.calls[0][0] as { props: { testID: string } }).props.testID).toBe(PERIOD_DONE_ID);
    await press(root, PERIOD_DONE_ID);
    expect(onDone).toHaveBeenCalledWith(day(2026, 8, 1), day(2026, 9, 25));
    await act(async () => root.unmount());
  });

  it('matrix «Invalid»: from after to disables «Готово» and shows the hint; values never change on their own', async () => {
    const { root, onDone } = await render(day(2026, 9, 25), day(2026, 9, 25));
    expect(textOf(root)).not.toContain(t('filters.period.invalid'));
    await focus(root, FROM_DAY);
    await wait();
    await key('up');
    expect(textOf(root)).toContain(t('filters.period.invalid'));
    expect(host(root, PERIOD_DONE_ID).props.focusable).toBe(false);
    expect(host(root, PERIOD_DONE_ID).props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    // The «по» date stayed as it was.
    expect(valueOf(root, TO_DAY)).toBe('25');
    // OK on a field does not reach «Готово»; pressing it does nothing.
    focusMock.mockClear();
    await press(root, FROM_DAY);
    expect(focusMock).not.toHaveBeenCalled();
    await act(async () => {
      host(root, PERIOD_DONE_ID).props.onClick?.({ nativeEvent: {} });
    });
    expect(onDone).not.toHaveBeenCalled();
    // Back to valid: the hint goes, «Готово» is focusable again.
    await key('down');
    expect(textOf(root)).not.toContain(t('filters.period.invalid'));
    expect(host(root, PERIOD_DONE_ID).props.focusable).toBe(true);
    await act(async () => root.unmount());
  });

  it('matrix «Day clamp»: 31 March, month ↓ → 28 February (29 in a leap year)', async () => {
    const { root } = await render(day(2026, 3, 31), day(2026, 9, 25));
    await focus(root, FROM_MONTH);
    await wait();
    await key('down');
    expect(valueOf(root, FROM_MONTH)).toBe('фев');
    expect(valueOf(root, FROM_DAY)).toBe('28');
    await act(async () => root.unmount());

    const leap = await render(day(2024, 3, 31), day(2026, 9, 25));
    await focus(leap.root, FROM_MONTH);
    await wait();
    await key('down');
    expect(valueOf(leap.root, FROM_DAY)).toBe('29');
    // Year ↑ to 2025 → 28.
    await focus(leap.root, FROM_YEAR);
    await key('up');
    expect(valueOf(leap.root, FROM_YEAR)).toBe('2025');
    expect(valueOf(leap.root, FROM_DAY)).toBe('28');
    await act(async () => leap.root.unmount());
  });

  it('year 2015…the current year', async () => {
    const { root } = await render(day(2015, 1, 1), day(2026, 9, 25));
    await focus(root, FROM_YEAR);
    await wait();
    await key('down');
    expect(valueOf(root, FROM_YEAR)).toBe('2015');
    await focus(root, stepperFieldId('to', 'year'));
    await key('up');
    expect(valueOf(root, stepperFieldId('to', 'year'))).toBe('2026');
    await act(async () => root.unmount());
  });

  it('no key acts after unmount (the listener goes)', async () => {
    const { root } = await render(day(2026, 8, 1), day(2026, 9, 25));
    expect(tvEvents.count()).toBe(1);
    await act(async () => root.unmount());
    expect(tvEvents.count()).toBe(0);
  });
});

describe('PeriodStepper hold (native SeekKeys, owner decision 2026-10-28)', () => {
  const native = NativeModules as Record<string, unknown>;
  const setEnabled = jest.fn();

  beforeEach(() => {
    setEnabled.mockClear();
    native.SeekKeys = { setEnabled };
  });

  afterEach(() => {
    delete native.SeekKeys;
  });

  async function nativeKey(keyName: string, action: 'down' | 'up', repeat = 0) {
    await act(async () => {
      DeviceEventEmitter.emit('seekKey', { key: keyName, action, repeat });
    });
  }

  it('subscribes while mounted', async () => {
    const { root } = await render(day(2026, 8, 1), day(2026, 9, 25));
    expect(setEnabled).toHaveBeenLastCalledWith(true);
    await act(async () => root.unmount());
    expect(setEnabled).toHaveBeenLastCalledWith(false);
  });

  it('one step on the key down, then a step per repeat (at most every 150 ms); the React Native key up adds none', async () => {
    const { root } = await render(day(2026, 8, 1), day(2026, 9, 25));
    await focus(root, FROM_DAY);
    await wait();
    await nativeKey('up', 'down', 0);
    expect(valueOf(root, FROM_DAY)).toBe('2');
    // Android repeats: ≈ 500 ms later, then every ≈ 50 ms.
    await wait(500);
    await nativeKey('up', 'down', 1);
    expect(valueOf(root, FROM_DAY)).toBe('3');
    await wait(50);
    await nativeKey('up', 'down', 2);
    expect(valueOf(root, FROM_DAY)).toBe('3');
    await wait(STEPPER_HOLD_REPEAT_MS);
    await nativeKey('up', 'down', 3);
    expect(valueOf(root, FROM_DAY)).toBe('4');
    await nativeKey('up', 'up');
    // The release: React Native's key up (a hold: `longUp`) is no step.
    await key('longUp');
    expect(valueOf(root, FROM_DAY)).toBe('4');
    // A short press: native down + RN key up = one step.
    await nativeKey('down', 'down', 0);
    await nativeKey('down', 'up');
    await key('down');
    expect(valueOf(root, FROM_DAY)).toBe('3');
    // ← → from the native path are ignored here.
    await nativeKey('left', 'down', 0);
    expect(valueOf(root, FROM_DAY)).toBe('3');
    await act(async () => root.unmount());
  });

  it('the press that leaves «Готово» is ignored, also while held; the next press steps', async () => {
    const { root } = await render(day(2026, 8, 1), day(2026, 9, 25));
    await focus(root, PERIOD_DONE_ID);
    // The key down reaches JS before focus moves to «С: день».
    await nativeKey('up', 'down', 0);
    await focus(root, FROM_DAY);
    await wait(600);
    await nativeKey('up', 'down', 1);
    await nativeKey('up', 'up');
    await key('up');
    expect(valueOf(root, FROM_DAY)).toBe('1');
    await nativeKey('up', 'down', 0);
    await key('up');
    expect(valueOf(root, FROM_DAY)).toBe('2');
    await act(async () => root.unmount());
  });

  it('the entry guard: a key down within 500 ms after focus entered from «Готово» is ignored with its repeats', async () => {
    const { root } = await render(day(2026, 8, 1), day(2026, 9, 25));
    await focus(root, PERIOD_DONE_ID);
    await focus(root, FROM_DAY);
    await nativeKey('up', 'down', 0);
    await wait(STEPPER_HOLD_REPEAT_MS);
    await nativeKey('up', 'down', 1);
    expect(valueOf(root, FROM_DAY)).toBe('1');
    await nativeKey('up', 'up');
    await key('up');
    await nativeKey('up', 'down', 0);
    expect(valueOf(root, FROM_DAY)).toBe('2');
    await act(async () => root.unmount());
  });
});
