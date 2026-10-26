/**
 * Story 2.4 through the real App (NavigationContainer + JS stack + modal
 * host) with a stored session: the Shell's initial focus, sections opened
 * on OK only, the AD-13 Back order, phase gating, the version row, and the
 * debug «Проверка фокуса» screen (restore by id after push/pop, the fallback
 * chain, the modal host). The keychain, BackHandler and the native focus
 * command are faked: these tests prove which element the app asks to focus,
 * not native focus movement (a device check, docs/testing.md).
 */
import { act } from 'react';
import { NativeModules } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import App from '../src/app/App';
import { devListStore } from '../src/app/dev/devFocus';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';

jest.mock('react-native-keychain');

/** The last `destinations` each focus guide received, by testID. */
const mockGuideDestinations = new Map<string, unknown[] | undefined>();

// A thin wrapper that records the destinations (the real guide passes them
// to a native command only, not to its host view).
jest.mock('react-native/Libraries/Components/TV/TVFocusGuideView', () => {
  const actual = jest.requireActual(
    'react-native/Libraries/Components/TV/TVFocusGuideView',
  );
  const React = jest.requireActual('react');
  const Real = actual.default;
  function RecordingGuide(props: {
    testID?: string;
    destinations?: unknown[];
  }) {
    if (props.testID) {
      mockGuideDestinations.set(props.testID, props.destinations);
    }
    return React.createElement(Real, props);
  }
  return { __esModule: true, default: RecordingGuide };
});

jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));

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

type KeychainMock = { __values: Map<string, string>; __reset(): void };
type Node = ReturnType<Root['container']['queryAll']>[number];

const keychain = jest.requireMock('react-native-keychain') as KeychainMock;
const backHandler = jest.requireMock(
  'react-native/Libraries/Utilities/BackHandler',
).default as { pressBack: () => boolean; exitApp: jest.Mock };
const focusMock = requestHostFocus as jest.Mock;
const native = NativeModules as { AppInfo?: { versionName?: string } };

const STORED = JSON.stringify({
  v: 1,
  accessToken: 'a'.repeat(64),
  refreshToken: 'r'.repeat(64),
  expiresAt: 1_900_000_000_000,
  accountId: '1001',
});

beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  focusMock.mockClear();
  backHandler.exitApp.mockClear();
  keychain.__reset();
  keychain.__values.set('boostytv.session', STORED);
  native.AppInfo = { versionName: '1.0' };
  // Story 2.5: the background E1 after the boot succeeds; nothing else is sent.
  (globalThis as { fetch: unknown }).fetch = jest.fn((url: string) =>
    url === 'https://api.boosty.to/v1/user/current'
      ? Promise.resolve({
          status: 200,
          text: () => Promise.resolve('{"id":1001}'),
        })
      : Promise.reject(new Error('no request expected')),
  );
});

afterEach(() => {
  delete native.AppInfo;
  devListStore.refill();
  focusRestoration.clear();
  jest.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 20; i += 1) {
    await act(async () => {
      if (i < 2) {
        jest.runOnlyPendingTimers();
      }
      await Promise.resolve();
    });
  }
}

async function renderApp() {
  const root = createRoot();
  await act(async () => {
    root.render(<App />);
  });
  await settle();
  return root;
}

async function unmount(root: Root) {
  await act(async () => {
    root.unmount();
  });
}

function byTestId(root: Root, testID: string): Node[] {
  return root.container.queryAll(node => node.props.testID === testID);
}

function visible(root: Root, testID: string): boolean {
  return byTestId(root, testID).length > 0;
}

/** The focusable host view with this testID. */
function one(root: Root, testID: string): Node {
  const nodes = byTestId(root, testID).filter(
    node => node.props.focusable === true,
  );
  expect(nodes).toHaveLength(1);
  return nodes[0];
}

function focusableIds(root: Root, within?: Node): string[] {
  return (within ?? root.container)
    .queryAll(node => node.props.focusable === true)
    .map(node => node.props.testID as string);
}

/** Native focus arrived on an element (what Android does on a D-pad move). */
async function focusOn(root: Root, testID: string) {
  const node = one(root, testID);
  await act(async () => {
    node.props.onFocus({ nativeEvent: {} });
  });
}

/** OK on an element: the same click path the TV press uses. */
async function press(root: Root, testID: string) {
  await focusOn(root, testID);
  const node = one(root, testID);
  await act(async () => {
    node.props.onClick({ nativeEvent: {} });
  });
  await settle();
}

async function back() {
  await act(async () => {
    backHandler.pressBack();
  });
  await settle();
}

function lastFocusTarget(): string | undefined {
  const calls = focusMock.mock.calls;
  const view = calls[calls.length - 1]?.[0] as
    | { props?: { testID?: string } }
    | undefined;
  return view?.props?.testID;
}

/** testIDs of the host views a guide currently routes to. */
function destinationIds(guide: string): string[] {
  return (mockGuideDestinations.get(guide) ?? []).map(
    view => (view as { props?: { testID?: string } }).props?.testID as string,
  );
}

function topScreen(root: Root): string | undefined {
  const ids = ['shell', 'dev/focus', 'dev/focus/detail'];
  const present = ids.filter(id => visible(root, id));
  return present[present.length - 1];
}

function currentSection(root: Root): string[] {
  return ['nav/home', 'nav/settings'].filter(id =>
    visible(root, `${id}/current`),
  );
}

function text(node: Node | Root): string {
  const json = 'container' in node ? node.container.toJSON() : node.toJSON?.();
  return JSON.stringify(json ?? null);
}

describe('Shell', () => {
  it('opens on Главная with focus on nav/home and the placeholder StateView, without signing in', async () => {
    const root = await renderApp();
    expect(topScreen(root)).toBe('shell');
    expect(visible(root, 'auth/welcome')).toBe(false);
    expect(lastFocusTarget()).toBe('nav/home');
    expect(one(root, 'nav/home').props.hasTVPreferredFocus).toBe(true);
    expect(currentSection(root)).toEqual(['nav/home']);

    const content = byTestId(root, 'shell/content/home')[0];
    expect(text(content)).toContain(t('home.placeholder.title'));
    expect(text(content)).toContain(t('home.placeholder.body'));
    expect(focusableIds(root, content)).toEqual([]);
    expect(text(root)).toContain(t('shell.wordmark'));
    await unmount(root);
  });

  it('renders only the phase-enabled sections (Главная, Настройки)', async () => {
    const root = await renderApp();
    expect(focusableIds(root)).toEqual(['nav/home', 'nav/settings']);
    for (const hidden of ['nav/search', 'nav/subs', 'nav/events']) {
      expect(visible(root, hidden)).toBe(false);
    }
    expect(one(root, 'nav/home').props.accessibilityLabel).toBe(
      t('shell.nav.home'),
    );
    expect(one(root, 'nav/settings').props.accessibilityLabel).toBe(
      t('shell.nav.settings'),
    );
    expect(one(root, 'nav/home').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(one(root, 'nav/settings').props.accessibilityState).toMatchObject({
      selected: false,
    });
    await unmount(root);
  });

  it('the sidebar traps ↑ ↓ ← (no wrap, no escape) and the content zone traps ↑ ↓', async () => {
    const root = await renderApp();
    const [sidebar] = byTestId(root, 'shell/sidebar');
    expect(sidebar.props).toMatchObject({
      trapFocusUp: true,
      trapFocusDown: true,
      trapFocusLeft: true,
    });
    // → must reach the content zone.
    expect(sidebar.props.trapFocusRight).toBeFalsy();
    const [content] = byTestId(root, 'shell/content/home');
    expect(content.props).toMatchObject({
      trapFocusUp: true,
      trapFocusDown: true,
    });
    await unmount(root);
  });

  it('zone destinations: the current item for ←, the remembered content element for →', async () => {
    const root = await renderApp();
    // Главная: sidebar → nav/home; the content has no focusable, so no destination.
    expect(destinationIds('shell/sidebar')).toEqual(['nav/home']);
    expect(destinationIds('shell/content/home')).toEqual([]);

    await press(root, 'nav/settings');
    expect(destinationIds('shell/sidebar')).toEqual(['nav/settings']);
    expect(destinationIds('shell/content/settings')).toEqual([
      'settings/row/version',
    ]);

    await focusOn(root, 'settings/row/focus-check');
    expect(destinationIds('shell/content/settings')).toEqual([
      'settings/row/focus-check',
    ]);
    await unmount(root);
  });

  it('focus alone does not switch the section', async () => {
    const root = await renderApp();
    await focusOn(root, 'nav/settings');
    await settle();
    expect(currentSection(root)).toEqual(['nav/home']);
    expect(visible(root, 'shell/content/home')).toBe(true);
    await unmount(root);
  });

  it('OK on Настройки opens it and moves focus to settings/row/version («Версия 1.0»)', async () => {
    const root = await renderApp();
    focusMock.mockClear();
    await press(root, 'nav/settings');
    expect(currentSection(root)).toEqual(['nav/settings']);
    expect(visible(root, 'shell/content/home')).toBe(false);
    expect(visible(root, 'shell/content/settings')).toBe(true);
    expect(lastFocusTarget()).toBe('settings/row/version');

    const row = one(root, 'settings/row/version');
    expect(row.props.accessibilityLabel).toBe(`${t('settings.version')} 1.0`);
    expect(text(row)).toContain('1.0');
    // OK on the info row does nothing.
    focusMock.mockClear();
    await press(root, 'settings/row/version');
    expect(topScreen(root)).toBe('shell');
    expect(currentSection(root)).toEqual(['nav/settings']);
    expect(focusMock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('an unknown native version shows «неизвестна»', async () => {
    delete native.AppInfo;
    const root = await renderApp();
    await press(root, 'nav/settings');
    expect(one(root, 'settings/row/version').props.accessibilityLabel).toBe(
      `${t('settings.version')} ${t('settings.versionUnknown')}`,
    );
    await unmount(root);
  });

  it('OK on Главная while it is current keeps focus on the sidebar (no content focus)', async () => {
    const root = await renderApp();
    focusMock.mockClear();
    await press(root, 'nav/home');
    expect(currentSection(root)).toEqual(['nav/home']);
    expect(focusMock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('Back order: content → current item → Главная (nav/home) → exit', async () => {
    const root = await renderApp();
    await press(root, 'nav/settings');
    await focusOn(root, 'settings/row/version');

    focusMock.mockClear();
    await back();
    expect(lastFocusTarget()).toBe('nav/settings');
    expect(currentSection(root)).toEqual(['nav/settings']);
    expect(backHandler.exitApp).not.toHaveBeenCalled();

    await focusOn(root, 'nav/settings');
    await back();
    expect(currentSection(root)).toEqual(['nav/home']);
    expect(lastFocusTarget()).toBe('nav/home');
    expect(visible(root, 'shell/content/home')).toBe(true);
    expect(backHandler.exitApp).not.toHaveBeenCalled();

    await focusOn(root, 'nav/home');
    await back();
    expect(backHandler.exitApp).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it('Back on the sidebar of Настройки with focus moved to nav/home still selects Главная', async () => {
    const root = await renderApp();
    await press(root, 'nav/settings');
    await focusOn(root, 'nav/home');
    await back();
    expect(currentSection(root)).toEqual(['nav/home']);
    expect(lastFocusTarget()).toBe('nav/home');
    expect(backHandler.exitApp).not.toHaveBeenCalled();
    await unmount(root);
  });

  it('reopening a section returns to its remembered content focus', async () => {
    const root = await renderApp();
    await press(root, 'nav/settings');
    await focusOn(root, 'settings/row/focus-check');
    await back(); // → nav/settings
    await back(); // → Главная
    focusMock.mockClear();
    await press(root, 'nav/settings');
    expect(lastFocusTarget()).toBe('settings/row/focus-check');
    await unmount(root);
  });
});

describe('«Проверка фокуса» (debug builds)', () => {
  async function openCheck() {
    const root = await renderApp();
    await press(root, 'nav/settings');
    expect(one(root, 'settings/row/focus-check').props.accessibilityLabel).toBe(
      t('dev.focusCheck.row'),
    );
    focusMock.mockClear();
    await press(root, 'settings/row/focus-check');
    expect(topScreen(root)).toBe('dev/focus');
    return root;
  }

  it('opens from Настройки with focus on the first card of a virtualized 300-card list', async () => {
    const root = await openCheck();
    expect(lastFocusTarget()).toBe('dev/list/1');
    const [list] = byTestId(root, 'dev/list');
    expect(list.props.data).toHaveLength(300);
    expect(list.props.removeClippedSubviews).toBe(false);
    // Virtualized: far fewer than 300 cards are mounted.
    const mounted = focusableIds(root).filter(id => id.startsWith('dev/list/'));
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(300);
    await unmount(root);
  });

  it('push from a card, Back: the same card is focused again', async () => {
    const root = await openCheck();
    await press(root, 'dev/list/5');
    expect(topScreen(root)).toBe('dev/focus/detail');
    expect(lastFocusTarget()).toBe('dev/detail/delete');

    focusMock.mockClear();
    await back();
    expect(topScreen(root)).toBe('dev/focus');
    expect(lastFocusTarget()).toBe('dev/list/5');
    await unmount(root);
  });

  it('the card was deleted before Back: its neighbor by index is focused', async () => {
    const root = await openCheck();
    await press(root, 'dev/list/5');
    await press(root, 'dev/detail/delete');
    expect(text(root)).toContain(t('dev.focusCheck.deleted'));
    focusMock.mockClear();
    await back();
    expect(visible(root, 'dev/list/5')).toBe(false);
    expect(lastFocusTarget()).toBe('dev/list/6');
    await unmount(root);
  });

  it('all cards deleted before Back: the nearest action above is focused', async () => {
    const root = await openCheck();
    await press(root, 'dev/list/3');
    await press(root, 'dev/detail/delete-all');
    focusMock.mockClear();
    await back();
    expect(visible(root, 'dev/list/empty')).toBe(true);
    expect(lastFocusTarget()).toBe('dev/action/dialog');
    await unmount(root);
  });

  it('the test dialog: trapped, Back closes it first and focus returns to the initiator', async () => {
    const root = await openCheck();
    await press(root, 'dev/action/dialog');
    expect(visible(root, 'modal/scrim')).toBe(true);
    const [trap] = byTestId(root, 'modal/trap');
    expect(focusableIds(root, trap)).toEqual([
      'dev/dialog/ok',
      'dev/dialog/close',
    ]);

    focusMock.mockClear();
    await back();
    expect(visible(root, 'modal/scrim')).toBe(false);
    expect(topScreen(root)).toBe('dev/focus');
    expect(lastFocusTarget()).toBe('dev/action/dialog');

    // Closing with a dialog button behaves the same.
    await press(root, 'dev/action/dialog');
    focusMock.mockClear();
    await press(root, 'dev/dialog/close');
    expect(visible(root, 'modal/scrim')).toBe(false);
    expect(lastFocusTarget()).toBe('dev/action/dialog');
    await unmount(root);
  });

  it('fallback focus landing on the covered Shell does not change what it restores', async () => {
    const root = await openCheck();
    // Android moved focus into the covered Shell (e.g. a focused view was removed).
    await focusOn(root, 'nav/home');
    await focusOn(root, 'settings/row/version');
    await focusOn(root, 'dev/list/1');
    focusMock.mockClear();
    await back();
    expect(topScreen(root)).toBe('shell');
    expect(lastFocusTarget()).toBe('settings/row/focus-check');
    await unmount(root);
  });

  it('Back from the check returns to the Shell with focus on its row', async () => {
    const root = await openCheck();
    focusMock.mockClear();
    await back();
    expect(topScreen(root)).toBe('shell');
    expect(currentSection(root)).toEqual(['nav/settings']);
    expect(lastFocusTarget()).toBe('settings/row/focus-check');
    await unmount(root);
  });
});
