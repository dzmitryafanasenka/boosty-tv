/**
 * Shared harness for flow tests (Epic 2 retro, action item 4): settle loops,
 * rendering, node queries, remote input (focus, OK, typing, Back), the
 * keychain mock, FixtureTransport as the global `fetch` and the native
 * modules the app reads. Test-only: no production code may import it
 * (eslint `boundaries`); a test under `src/` that does needs the documented
 * `eslint-disable-next-line boundaries/dependencies`.
 *
 * The per-file copies this replaces differed on purpose in timing, so the
 * timing is a profile: each file passes its own to `createFlow()` and gets
 * helpers bound to it. Story-specific helpers (route handlers, AppState
 * capture, call-order trackers) stay in the test files.
 *
 * Files that call `back()` must mock BackHandler with `./backHandlerMock`,
 * files that call `key()` TVEventHandler with `./tvEventMock`, and files
 * that call `advance()` use fake timers; frame counting is in `./frames`.
 * Files that call `lastFocusTarget()` or `focusTargets()` must mock
 * `shared/ui/requestHostFocus` with a `jest.fn()`. Files that read
 * `destinationIds()` or `lists` install the recorders (see «Recorders») and
 * call `resetRecorders()` in `beforeEach`.
 */
import type { ReactElement } from 'react';
import { act } from 'react';
import { NativeModules } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import {
  createFixtureTransport,
  type FixtureHandler,
  type FixtureReply,
  type FixtureTransport,
} from '../shared/api/fixtureTransport';
import { requestHostFocus } from '../shared/ui/requestHostFocus';
import { tvEvents } from './tvEventMock';

export type Node = ReturnType<Root['container']['queryAll']>[number];

// ---------------------------------------------------------------------------
// Settling

export type SettleOptions = {
  /** `act()` rounds; each one lets pending promises and renders run. */
  rounds: number;
  /**
   * How many of the first rounds also run the pending fake timers
   * (`jest.runOnlyPendingTimers()`): `0` never, `rounds` every round.
   */
  timerRounds: number;
};

/** Settles promises and renders; runs pending timers in the first `timerRounds` rounds. */
export async function settle({ rounds, timerRounds }: SettleOptions): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      if (i < timerRounds) {
        jest.runOnlyPendingTimers();
      }
      await Promise.resolve();
    });
  }
}

// ---------------------------------------------------------------------------
// Rendering and queries (no timing involved)

export async function render(element: ReactElement, settleOptions: SettleOptions): Promise<Root> {
  const root = createRoot();
  await act(async () => {
    root.render(element);
  });
  await settle(settleOptions);
  return root;
}

export async function unmount(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

function containerOf(target: Root | Node): Node {
  return 'container' in target ? target.container : target;
}

export function byTestId(root: Root, testID: string): Node[] {
  return root.container.queryAll(node => node.props.testID === testID);
}

export function visible(root: Root, testID: string): boolean {
  return byTestId(root, testID).length > 0;
}

/** The rendered JSON of the whole tree or of one node, as a string. */
export function text(target: Root | Node): string {
  const json = 'container' in target ? target.container.toJSON() : target.toJSON?.();
  return JSON.stringify(json ?? null);
}

/**
 * testIDs of the focusable host views in the tree or under one node; takes
 * either `(rootOrNode)` or `(root, within?)`.
 */
export function focusableIds(target: Root | Node, within?: Node): string[] {
  return containerOf(within ?? target)
    .queryAll(node => node.props.focusable === true)
    .map(node => node.props.testID as string);
}

/** The topmost of `ids` that is mounted (the JS stack keeps covered screens mounted). */
export function topScreen(root: Root, ids: readonly string[]): string | undefined {
  const present = ids.filter(id => visible(root, id));
  return present[present.length - 1];
}

/** testID of the last view that `requestHostFocus` (mocked) targeted. */
export function lastFocusTarget(): string | undefined {
  const calls = (requestHostFocus as jest.Mock).mock.calls;
  const view = calls[calls.length - 1]?.[0] as { props?: { testID?: string } } | undefined;
  return view?.props?.testID;
}

/** testIDs of every view that `requestHostFocus` (mocked) targeted, in call order. */
export function focusTargets(): Array<string | undefined> {
  return (requestHostFocus as jest.Mock).mock.calls.map(
    call => (call[0] as { props?: { testID?: string } } | null)?.props?.testID,
  );
}

/** A promise with its resolver, for a reply the test releases later. */
export function deferred<T = FixtureReply>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

// ---------------------------------------------------------------------------
// Recorders (installed per file through `jest.mock` factories)

/**
 * The last `destinations` each focus guide received, by testID. Recorded
 * by `recordingFocusGuideModule()`; clear it in `beforeEach` where needed.
 */
export const guideDestinations = new Map<string, unknown[] | undefined>();

/**
 * A `TVFocusGuideView` module whose guide records its `destinations` (the
 * real guide passes them to a native command only, not to its host view):
 *
 *   jest.mock('react-native/Libraries/Components/TV/TVFocusGuideView', () =>
 *     require('../src/test/flow').recordingFocusGuideModule(),
 *   );
 */
export function recordingFocusGuideModule() {
  const actual = jest.requireActual('react-native/Libraries/Components/TV/TVFocusGuideView');
  const React = jest.requireActual('react');
  const Real = actual.default;
  function RecordingGuide(props: { testID?: string; destinations?: unknown[] }) {
    if (props.testID) {
      guideDestinations.set(props.testID, props.destinations);
    }
    return React.createElement(Real, props);
  }
  return { __esModule: true, default: RecordingGuide };
}

/** testIDs of the last `destinations` of the focus guide `guide`. */
export function destinationIds(guide: string): string[] {
  return (guideDestinations.get(guide) ?? []).map(
    view => (view as { props?: { testID?: string } }).props?.testID as string,
  );
}

/**
 * What `recordingFlashListModule()` records: the last props of each list
 * with a testID (by testID), and the scroll calls made through a list's ref.
 */
export const lists: {
  props: Map<string, Record<string, any>>;
  scrollToOffset: jest.Mock;
  scrollToIndex: jest.Mock;
} = { props: new Map(), scrollToOffset: jest.fn(), scrollToIndex: jest.fn() };

/** The last props of the recorded list `testID`; throws when it has not rendered. */
export function listProps(testID: string): Record<string, any> {
  const props = lists.props.get(testID);
  if (!props) {
    throw new Error(`no list rendered: ${testID}`);
  }
  return props;
}

/**
 * The items of a recorded grid list `testID` whose rows hold them under
 * `field` (e.g. PostGrid's `posts`, Подписки's `authors`), flattened in order.
 */
export function gridRowItems<T = any>(testID: string, field: string): T[] {
  return (listProps(testID).data as Array<Record<string, unknown>>).flatMap(row => {
    const items = row[field];
    if (!Array.isArray(items)) {
      throw new Error(`grid ${testID}: row field "${field}" is not an array`);
    }
    return items as T[];
  });
}

/** Empties every recorder (list props, both scroll mocks, guide destinations); call in `beforeEach`. */
export function resetRecorders(): void {
  lists.props.clear();
  lists.scrollToOffset.mockClear();
  lists.scrollToIndex.mockClear();
  guideDestinations.clear();
}

/**
 * The `@shopify/flash-list` module with the real FlashList behind a
 * recorder (`lists`). `onEndReached` is held back from the real list and
 * called by the test: FlashList's Jest setup measures every item 100 × 100
 * in a 400 × 900 parent, so the end would always be "reached" and every
 * page would load at once (the device measures the real rows). Paging by
 * focus is unchanged.
 *
 *   jest.mock('@shopify/flash-list', () => require('../src/test/flow').recordingFlashListModule());
 */
export function recordingFlashListModule() {
  const actual = jest.requireActual('@shopify/flash-list');
  const React = jest.requireActual('react');
  function RecordingFlashList(props: Record<string, any>) {
    if (typeof props.testID === 'string') {
      lists.props.set(props.testID, props);
    }
    const inner = React.useRef(null);
    React.useImperativeHandle(
      props.ref,
      () => ({
        scrollToOffset: (params: unknown) => {
          lists.scrollToOffset(params);
          return inner.current?.scrollToOffset(params);
        },
        scrollToIndex: (params: unknown) => {
          lists.scrollToIndex(params);
          return inner.current?.scrollToIndex(params) ?? Promise.resolve();
        },
      }),
      [],
    );
    return React.createElement(actual.FlashList, { ...props, ref: inner, onEndReached: undefined });
  }
  return { ...actual, FlashList: RecordingFlashList };
}

// ---------------------------------------------------------------------------
// Profile-bound input helpers

/**
 * Which nodes with a testID count as "the" element `one()` returns:
 * - `focusable`: `focusable === true` only;
 * - `focusableOrInput`: also text inputs (`onChangeText`);
 * - `declaredOrInput`: any declared `focusable` (disabled buttons too) or a text input.
 */
export type OneFilter = 'focusable' | 'focusableOrInput' | 'declaredOrInput';

export type FlowProfile = {
  /** The default `settle()` of this file. */
  settle: SettleOptions;
  /** Overrides of the default after `render()` (default: `settle`). */
  renderSettle?: Partial<SettleOptions>;
  /** Overrides of the default after `back()` (default: `settle`). */
  backSettle?: Partial<SettleOptions>;
  one: OneFilter;
  /**
   * `press()` sends native focus to the element before OK: `true` in its own
   * `act()`, `'sameAct'` in the same `act()` as OK, `false` not at all.
   */
  pressFocuses: boolean | 'sameAct';
  /** `submit()` settles afterwards. */
  submitSettles: boolean;
};

const ONE_FILTERS: Record<OneFilter, (node: Node) => boolean> = {
  focusable: node => node.props.focusable === true,
  focusableOrInput: node => node.props.focusable === true || Boolean(node.props.onChangeText),
  declaredOrInput: node => node.props.focusable !== undefined || Boolean(node.props.onChangeText),
};

export type PressOptions = {
  /** Overrides the profile's `pressFocuses`. */
  focus?: boolean | 'sameAct';
  /** Overrides of the profile's settle after OK. */
  settle?: Partial<SettleOptions>;
};

export function createFlow(profile: FlowProfile) {
  const settleWith = (overrides?: Partial<SettleOptions>) =>
    settle({ ...profile.settle, ...overrides });

  /** The single host node with this testID that matches the profile's filter. */
  function one(root: Root, testID: string): Node {
    const nodes = byTestId(root, testID).filter(ONE_FILTERS[profile.one]);
    expect(nodes).toHaveLength(1);
    return nodes[0];
  }

  /** Native focus arrived on an element (what Android does on a D-pad move). */
  async function focusOn(root: Root, testID: string) {
    const node = one(root, testID);
    await act(async () => {
      node.props.onFocus({ nativeEvent: {} });
    });
  }

  /** OK on an element: the same click path the TV press uses. */
  async function press(root: Root, testID: string, options: PressOptions = {}) {
    const focus = options.focus ?? profile.pressFocuses;
    if (focus === true) {
      await focusOn(root, testID);
    }
    const node = one(root, testID);
    await act(async () => {
      if (focus === 'sameAct') {
        node.props.onFocus({ nativeEvent: {} });
      }
      node.props.onClick({ nativeEvent: {} });
    });
    await settleWith(options.settle);
  }

  async function type(root: Root, testID: string, value: string) {
    const node = one(root, testID);
    await act(async () => {
      node.props.onChangeText(value);
    });
  }

  async function submit(root: Root, testID: string) {
    const node = one(root, testID);
    await act(async () => {
      node.props.onSubmitEditing({ nativeEvent: { text: node.props.value } });
    });
    if (profile.submitSettles) {
      await settleWith();
    }
  }

  /** The remote's Back key (needs the `backHandlerMock` BackHandler mock). */
  async function back(overrides?: Partial<SettleOptions>) {
    const backHandler = (
      jest.requireMock('react-native/Libraries/Utilities/BackHandler') as {
        default: { pressBack: () => boolean };
      }
    ).default;
    await act(async () => {
      backHandler.pressBack();
    });
    await settleWith({ ...profile.backSettle, ...overrides });
  }

  /** Advances fake time (timers and `Date.now`) by `ms`, then settles. */
  async function advance(ms: number, overrides?: Partial<SettleOptions>) {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
    await settleWith(overrides);
  }

  /**
   * A raw remote key through the TVEventHandler mock (key up, `action` 1,
   * unless said otherwise), then settles. Needs the `./tvEventMock` mock.
   */
  async function key(eventType: string, action = 1) {
    await act(async () => {
      tvEvents.emit({ eventType, eventKeyAction: action });
    });
    await settleWith();
  }

  return {
    settle: settleWith,
    advance,
    key,
    render: (element: ReactElement, overrides?: Partial<SettleOptions>) =>
      render(element, { ...profile.settle, ...profile.renderSettle, ...overrides }),
    one,
    focusOn,
    press,
    type,
    submit,
    back,
  };
}

// ---------------------------------------------------------------------------
// Keychain (the root `__mocks__/react-native-keychain.js`)

export type KeychainMock = {
  __values: Map<string, string>;
  __failNext(method: string, error: unknown): void;
  __reset(): void;
  getGenericPassword: jest.Mock;
  setGenericPassword: jest.Mock;
  resetGenericPassword: jest.Mock;
};

/** The in-memory keychain mock, typed. */
export function keychain(): KeychainMock {
  return jest.requireMock('react-native-keychain') as KeychainMock;
}

/** Empties the keychain mock, clears its three call records, then stores `seed` (service → value). */
export function resetKeychain(seed: Record<string, string> = {}): KeychainMock {
  const mock = keychain();
  mock.__reset();
  mock.getGenericPassword.mockClear();
  mock.setGenericPassword.mockClear();
  mock.resetGenericPassword.mockClear();
  for (const [service, value] of Object.entries(seed)) {
    mock.__values.set(service, value);
  }
  return mock;
}

// ---------------------------------------------------------------------------
// Network and native modules

/** Installs a FixtureTransport over `handler` as the global `fetch` and returns it. */
export function installFixtureTransport(handler: FixtureHandler): FixtureTransport {
  const transport = createFixtureTransport(handler);
  (globalThis as { fetch: unknown }).fetch = transport;
  return transport;
}

/** Known modules are typed; any other native module name is accepted too. */
export type NativeModuleFakes = {
  AppInfo?: { versionName?: string };
  InstallId?: { getOrCreate: jest.Mock };
  KeychainStorageReset?: { deleteKeychainStorage: jest.Mock };
  [name: string]: unknown;
};

const native = NativeModules as Record<string, unknown>;
const installed = new Set<string>();

/** Sets fake native modules the app reads; `clearNativeModules()` removes them. */
export function installNativeModules(fakes: NativeModuleFakes): void {
  for (const [name, value] of Object.entries(fakes)) {
    native[name] = value;
    installed.add(name);
  }
}

/** Deletes every native module set by `installNativeModules()`. */
export function clearNativeModules(): void {
  for (const name of installed) {
    delete native[name];
  }
  installed.clear();
}
