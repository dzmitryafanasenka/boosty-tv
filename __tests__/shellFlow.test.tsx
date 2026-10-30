/**
 * Story 2.4 through the real App (NavigationContainer + JS stack + modal
 * host) with a stored session: the Shell's initial focus, sections opened
 * on OK only, the AD-13 Back order, phase gating, the version row, and the
 * debug «Проверка фокуса» screen (restore by id after push/pop, the fallback
 * chain, the modal host). The keychain, BackHandler and the native focus
 * command are faked: these tests prove which element the app asks to focus,
 * not native focus movement (a device check, docs/testing.md).
 */
import { NativeModules } from 'react-native';
import { type Root } from 'test-renderer';
import App from '../src/app/App';
import { resetQueryCache } from '../src/app/queryClient';
import { devListStore } from '../src/app/dev/devFocus';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import { e5Page, e5Posts } from '../src/test/feedFixtures';
import {
  byTestId,
  clearNativeModules,
  createFlow,
  destinationIds,
  focusableIds,
  installNativeModules,
  lastFocusTarget,
  resetKeychain,
  resetRecorders,
  text,
  topScreen as topScreenOf,
  unmount,
  visible,
} from '../src/test/flow';

jest.mock('react-native-keychain');

jest.mock('react-native/Libraries/Components/TV/TVFocusGuideView', () =>
  require('../src/test/flow').recordingFocusGuideModule(),
);

jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));

jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  require('../src/test/backHandlerMock'),
);

const focusMock = requestHostFocus as jest.Mock;
const native = NativeModules as { AppInfo?: { versionName?: string } };

/** 20 rounds; timers run in the first 2. */
const { settle, render, one, focusOn, press, back } = createFlow({
  settle: { rounds: 20, timerRounds: 2 },
  one: 'focusable',
  pressFocuses: true,
  submitSettles: false,
});

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
  backHandler.reset();
  resetRecorders();
  resetKeychain({ 'boostytv.session': STORED });
  installNativeModules({ AppInfo: { versionName: '1.0' } });
  // Story 2.5: the background E1 after the boot succeeds; Story 3.1: E5
  // answers the live feed page (the last one); nothing else is sent.
  (globalThis as { fetch: unknown }).fetch = jest.fn((url: string) =>
    url === 'https://api.boosty.to/v1/user/current'
      ? Promise.resolve({
          status: 200,
          text: () => Promise.resolve('{"id":1001}'),
        })
      : url.startsWith('https://api.boosty.to/v1/feed/post/?')
        ? Promise.resolve({
            status: 200,
            text: () => Promise.resolve(JSON.stringify(e5Page())),
          })
        : Promise.reject(new Error('no request expected')),
  );
});

afterEach(async () => {
  await resetQueryCache();
  clearNativeModules();
  devListStore.refill();
  focusRestoration.clear();
  jest.restoreAllMocks();
});

const renderApp = () => render(<App />);

function topScreen(root: Root): string | undefined {
  return topScreenOf(root, ['shell', 'dev/focus', 'dev/focus/detail']);
}

function currentSection(root: Root): string[] {
  return ['nav/home', 'nav/settings'].filter(id =>
    visible(root, `${id}/current`),
  );
}

describe('Shell', () => {
  it('opens on Главная with focus on nav/home, then the feed (Story 3.1) takes it, without signing in', async () => {
    const root = await renderApp();
    expect(topScreen(root)).toBe('shell');
    expect(visible(root, 'auth/welcome')).toBe(false);
    expect(one(root, 'nav/home').props.hasTVPreferredFocus).toBe(true);
    expect(currentSection(root)).toEqual(['nav/home']);
    const first = `home/feed/${e5Posts()[0].id}`;
    expect(focusMock.mock.calls.map(c => c[0]?.props?.testID)).toEqual(['nav/home', first]);

    const content = byTestId(root, 'shell/content/home')[0];
    expect(visible(root, 'home/feed')).toBe(true);
    // «Фильтры» (Story 5.3), «Обновить» (Story 5.1), then the cards.
    expect(focusableIds(root, content)).toEqual([
      'home/filters',
      'home/refresh',
      ...e5Posts().map(p => `home/feed/${p.id}`),
    ]);
    expect(text(root)).toContain(t('shell.wordmark'));
    expect(text(root)).toContain(t('home.feed.title'));
    await unmount(root);
  });

  it('renders only the phase-enabled sections (Главная, Поиск, Подписки, События since Story 7.5, Настройки)', async () => {
    const root = await renderApp();
    const sidebar = byTestId(root, 'shell/sidebar')[0];
    expect(focusableIds(root, sidebar)).toEqual(['nav/home', 'nav/search', 'nav/subs', 'nav/events', 'nav/settings']);
    expect(one(root, 'nav/subs').props.accessibilityLabel).toBe(t('shell.nav.subs'));
    expect(one(root, 'nav/search').props.accessibilityLabel).toBe(t('shell.nav.search'));
    expect(one(root, 'nav/events').props.accessibilityLabel).toBe(t('shell.nav.events'));
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
    // Главная: sidebar → nav/home; content → the first feed card (Story 3.1).
    expect(destinationIds('shell/sidebar')).toEqual(['nav/home']);
    expect(destinationIds('shell/content/home')).toEqual([`home/feed/${e5Posts()[0].id}`]);

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

  it('OK on Главная while it is current moves focus into the feed (Story 3.1)', async () => {
    const root = await renderApp();
    await focusOn(root, `home/feed/${e5Posts()[2].id}`);
    await back();
    focusMock.mockClear();
    await press(root, 'nav/home');
    expect(currentSection(root)).toEqual(['nav/home']);
    expect(lastFocusTarget()).toBe(`home/feed/${e5Posts()[2].id}`);
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
    focusMock.mockClear();
    await back();
    expect(currentSection(root)).toEqual(['nav/home']);
    // Back focuses nav/home. (The fake timers run the query's gc timer, so
    // the feed loads again; its arrival then moves focus to the first card,
    // the skeleton rule of focus-map §1.6.)
    expect(focusMock.mock.calls[0][0]?.props?.testID).toBe('nav/home');
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
