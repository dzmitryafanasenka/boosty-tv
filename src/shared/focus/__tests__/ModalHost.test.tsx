import { act, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { createRoot } from 'test-renderer';
import { Button, colors, type HostView } from '../../ui';
import { requestHostFocus } from '../../ui/requestHostFocus';
// eslint-disable-next-line boundaries/dependencies -- a test under src/shared may use the src/test harness
import backHandler from '../../../test/backHandlerMock';
// eslint-disable-next-line boundaries/dependencies -- a test under src/shared may use the src/test harness
import { byTestId as byId, createFlow, lastFocusTarget } from '../../../test/flow';
import { ModalHostProvider, useModal, type ModalApi } from '../ModalHost';

jest.mock('../../ui/requestHostFocus', () => ({ requestHostFocus: jest.fn() }));

jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  // eslint-disable-next-line boundaries/dependencies -- as above
  require('../../../test/backHandlerMock'),
);

const focusMock = requestHostFocus as jest.Mock;

let api: ModalApi;

function Probe() {
  api = useModal();
  const initiator = useRef<HostView>(null);
  return (
    <View>
      <Button
        ref={initiator}
        testID="probe/open"
        label="open"
        onPress={() =>
          api.open(
            <Button
              testID="probe/dialog/ok"
              label="ok"
              onPress={() => api.close()}
            />,
            initiator,
          )
        }
      />
      <Button testID="probe/other" label="other" />
    </View>
  );
}

/** No settling: every step here is synchronous inside `act()`. */
const flow = createFlow({
  settle: { rounds: 0, timerRounds: 0 },
  one: 'focusable',
  pressFocuses: false,
  submitSettles: false,
});
const { press } = flow;

function render() {
  return flow.render(
    <ModalHostProvider>
      <Probe />
    </ModalHostProvider>,
  );
}

beforeEach(() => {
  focusMock.mockClear();
  backHandler.reset();
});

test('closed: no overlay, no Back listener, background visible to accessibility', async () => {
  const root = await render();
  expect(byId(root, 'modal/scrim')).toHaveLength(0);
  expect(api.isOpen()).toBe(false);
  expect(backHandler.count()).toBe(0);
  expect(
    byId(root, 'modal/background')[0].props.importantForAccessibility,
  ).toBe('auto');
  await act(async () => root.unmount());
});

test('open: content on the scrim inside a 4-side trap, focus moves into it, background hidden', async () => {
  const root = await render();
  await press(root, 'probe/open');

  expect(api.isOpen()).toBe(true);
  const [scrim] = byId(root, 'modal/scrim');
  expect(StyleSheet.flatten(scrim.props.style).backgroundColor).toBe(
    colors.scrim,
  );
  const [trap] = byId(root, 'modal/trap');
  expect(trap.props).toMatchObject({
    trapFocusUp: true,
    trapFocusDown: true,
    trapFocusLeft: true,
    trapFocusRight: true,
  });
  expect(
    trap.queryAll(node => node.props.testID === 'probe/dialog/ok').length,
  ).toBeGreaterThan(0);
  // Focus is requested on the trap's content container (→ first focusable).
  expect(lastFocusTarget()).toBe('modal/content');
  expect(
    trap.queryAll(node => node.props.testID === 'modal/content'),
  ).toHaveLength(1);
  expect(
    byId(root, 'modal/background')[0].props.importantForAccessibility,
  ).toBe('no-hide-descendants');
  // The stack underneath stays mounted.
  expect(byId(root, 'probe/other').length).toBeGreaterThan(0);
  await act(async () => root.unmount());
});

test('Back closes the dialog first and focus returns to the initiator', async () => {
  const root = await render();
  await press(root, 'probe/open');
  focusMock.mockClear();

  await act(async () => {
    backHandler.pressBack();
  });
  expect(api.isOpen()).toBe(false);
  expect(byId(root, 'modal/scrim')).toHaveLength(0);
  expect(lastFocusTarget()).toBe('probe/open');
  expect(backHandler.exitApp).not.toHaveBeenCalled();
  expect(backHandler.count()).toBe(0);

  // The next Back is not the modal's.
  await act(async () => {
    backHandler.pressBack();
  });
  expect(backHandler.exitApp).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

test('focus is sent to the initiator before the unmount, after it, and two frames later', async () => {
  const root = await render();
  await press(root, 'probe/open');
  const scrimAtCall: boolean[] = [];
  focusMock.mockClear();
  focusMock.mockImplementation(target => {
    // The open's passive effect can be flushed late, after the close has
    // detached the dialog container: its `requestHostFocus(null)` is a no-op.
    if (target != null) {
      scrimAtCall.push(byId(root, 'modal/scrim').length > 0);
    }
  });
  jest.useFakeTimers();
  await act(async () => {
    api.close();
  });
  expect(scrimAtCall).toEqual([true, false]);
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
  jest.useRealTimers();
  expect(
    focusMock.mock.calls
      .filter(([target]) => target != null)
      .map(c => (c[0] as { props: { testID: string } }).props.testID),
  ).toEqual(['probe/open', 'probe/open', 'probe/open']);
  expect(scrimAtCall).toEqual([true, false, false]);
  focusMock.mockImplementation(() => {});
  await act(async () => root.unmount());
});

test('a dialog opened again within those two frames: the late request to the first initiator is skipped', async () => {
  const root = await render();
  await press(root, 'probe/open');
  jest.useFakeTimers();
  await act(async () => {
    api.close();
  });
  // Opened again before the two frames passed.
  await press(root, 'probe/open');
  expect(api.isOpen()).toBe(true);
  focusMock.mockClear();
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
  const toInitiator = focusMock.mock.calls.filter(
    ([target]) => (target as { props?: { testID?: string } } | null)?.props?.testID === 'probe/open',
  );
  expect(toInitiator).toHaveLength(0);
  // Close the second dialog and let its frames run before real timers return.
  await act(async () => {
    api.close();
  });
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
  jest.useRealTimers();
  await act(async () => root.unmount());
});

test('closing from inside (OK on a dialog button) also returns focus to the initiator', async () => {
  const root = await render();
  await press(root, 'probe/open');
  focusMock.mockClear();
  await press(root, 'probe/dialog/ok');
  expect(api.isOpen()).toBe(false);
  expect(lastFocusTarget()).toBe('probe/open');
  await act(async () => root.unmount());
});

test('close({ restoreFocus: false }) closes without any focus request (Story 2.6: the screen behind goes away)', async () => {
  const root = await render();
  await press(root, 'probe/open');
  focusMock.mockClear();
  jest.useFakeTimers();
  await act(async () => {
    api.close({ restoreFocus: false });
  });
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
  jest.useRealTimers();
  expect(api.isOpen()).toBe(false);
  expect(byId(root, 'modal/scrim')).toHaveLength(0);
  // No focus request reaches a view. The open's passive effect can be
  // flushed late, after this close has detached the dialog container; its
  // `requestHostFocus(null)` is a no-op, so only non-null targets count.
  expect(focusMock.mock.calls.filter(([target]) => target != null)).toEqual([]);
  expect(backHandler.count()).toBe(0);
  await act(async () => root.unmount());
});

test('close() and isOpen() right after open(), before the commit, see the modal', async () => {
  const root = await render();
  let seen: boolean[] = [];
  await act(async () => {
    api.open(null);
    seen = [api.isOpen()];
    api.close();
    seen.push(api.isOpen());
  });
  expect(seen).toEqual([true, false]);
  expect(byId(root, 'modal/scrim')).toHaveLength(0);
  expect(backHandler.count()).toBe(0);
  await act(async () => root.unmount());
});

test('the modal listener is the newest, so it wins over listeners added before it', async () => {
  const root = await render();
  const screenHandler = jest.fn(() => true);
  const sub = backHandler.addEventListener('hardwareBackPress', screenHandler);
  await press(root, 'probe/open');
  await act(async () => {
    backHandler.pressBack();
  });
  expect(screenHandler).not.toHaveBeenCalled();
  expect(api.isOpen()).toBe(false);
  sub.remove();
  await act(async () => root.unmount());
});

test('useModal outside the provider throws', () => {
  function Bare() {
    useModal();
    return null;
  }
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const root = createRoot();
  expect(() =>
    act(() => {
      root.render(<Bare />);
    }),
  ).toThrow('useModal must be used inside ModalHostProvider');
  spy.mockRestore();
});
