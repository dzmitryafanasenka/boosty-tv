import { act, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { Button, colors, type HostView } from '../../ui';
import { requestHostFocus } from '../../ui/requestHostFocus';
import { ModalHostProvider, useModal, type ModalApi } from '../ModalHost';

jest.mock('../../ui/requestHostFocus', () => ({ requestHostFocus: jest.fn() }));

jest.mock('react-native/Libraries/Utilities/BackHandler', () => {
  const handlers: Array<() => boolean | null | undefined> = [];
  const backHandler = {
    exitApp: jest.fn(),
    addEventListener: (
      _name: string,
      handler: () => boolean | null | undefined,
    ) => {
      handlers.push(handler);
      return {
        remove: () => {
          const index = handlers.lastIndexOf(handler);
          if (index >= 0) {
            handlers.splice(index, 1);
          }
        },
      };
    },
    count: () => handlers.length,
    pressBack: () => {
      for (let i = handlers.length - 1; i >= 0; i -= 1) {
        if (handlers[i]()) {
          return true;
        }
      }
      backHandler.exitApp();
      return false;
    },
  };
  return { __esModule: true, default: backHandler };
});

const backHandler = jest.requireMock(
  'react-native/Libraries/Utilities/BackHandler',
).default as {
  pressBack: () => boolean;
  exitApp: jest.Mock;
  count: () => number;
};
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

function byId(root: Root, testID: string) {
  return root.container.queryAll(node => node.props.testID === testID);
}

function focusable(root: Root, testID: string) {
  const nodes = byId(root, testID).filter(
    node => node.props.focusable === true,
  );
  expect(nodes).toHaveLength(1);
  return nodes[0];
}

function lastFocusTarget(): string | undefined {
  const calls = focusMock.mock.calls;
  return (
    calls[calls.length - 1]?.[0] as { props?: { testID?: string } } | undefined
  )?.props?.testID;
}

async function render() {
  const root = createRoot();
  await act(async () => {
    root.render(
      <ModalHostProvider>
        <Probe />
      </ModalHostProvider>,
    );
  });
  return root;
}

async function press(root: Root, testID: string) {
  const node = focusable(root, testID);
  await act(async () => {
    node.props.onClick({ nativeEvent: {} });
  });
}

beforeEach(() => {
  focusMock.mockClear();
  backHandler.exitApp.mockClear();
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
  const BackHandler = jest.requireMock(
    'react-native/Libraries/Utilities/BackHandler',
  ).default;
  const screenHandler = jest.fn(() => true);
  const sub = BackHandler.addEventListener('hardwareBackPress', screenHandler);
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
