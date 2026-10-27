/**
 * Story 2.5 demo mode (debug-only) through the real App with
 * `DEMO_MODE = true`: a fixture-backed Shell, the persistent «ДЕМО» badge
 * (not focusable) and a SecureStore that is never read, written or cleared,
 * so a stored session survives. The release guard is __tests__/demoModeOff.test.js.
 */
import { act } from 'react';
import App from '../src/app/App';
import { resetQueryCache } from '../src/app/queryClient';
import { session } from '../src/app/session';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
import { components, spacing } from '../src/shared/ui';
import {
  clearNativeModules,
  createFlow,
  installNativeModules,
  keychain as keychainMock,
  resetKeychain,
  topScreen,
} from '../src/test/flow';

jest.mock('react-native-keychain');
jest.mock('../src/app/appConfig', () => ({ DEMO_MODE: true }));
jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));

const keychain = keychainMock();
const STORED = JSON.stringify({ v: 1, accessToken: 'a'.repeat(64), refreshToken: 'r'.repeat(64), expiresAt: 1, accountId: '1001' });
const noNetwork = (_url: string, _init?: unknown): Promise<unknown> =>
  Promise.reject(new Error('no network in demo mode'));
const fetchMock = jest.fn(noNetwork);

/** 20 rounds, timers in each; `press()` focuses and clicks in one `act()`. */
const { settle, render, one, press, type } = createFlow({
  settle: { rounds: 20, timerRounds: 20 },
  one: 'focusableOrInput',
  pressFocuses: 'sameAct',
  submitSettles: false,
});

beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  resetKeychain({ 'boostytv.session': STORED });
  installNativeModules({ AppInfo: { versionName: '1.0' } });
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

afterEach(async () => {
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  logger.clear();
  fetchMock.mockImplementation(noNetwork);
  jest.restoreAllMocks();
});

const renderApp = () => render(<App />);

test('fixture-backed Shell with the «ДЕМО» badge; SecureStore and the network untouched', async () => {
  const root = await renderApp();
  expect(root.container.queryAll(n => n.props.testID === 'shell').length).toBeGreaterThan(0);
  const [badge] = root.container.queryAll(n => n.props.testID === 'demo/badge');
  expect(badge).toBeDefined();
  expect(JSON.stringify(badge.toJSON())).toContain(t('demo.badge'));
  expect(badge.props.focusable).toBe(false);
  expect(badge.props.style).toMatchObject({
    position: 'absolute',
    top: spacing['safe-y'],
    right: spacing['safe-x'],
    height: components.badge.height,
    backgroundColor: components.badge.bg,
  });
  // The badge adds nothing focusable; Главная shows the demo feed (Story
  // 3.1), served by the demo's FixtureTransport.
  const focusable = root.container
    .queryAll(n => n.props.focusable === true)
    .map(n => n.props.testID as string);
  expect(focusable.slice(0, 3)).toEqual(['nav/home', 'nav/subs', 'nav/settings']);
  // Demo posts in order. (FlashList's Jest measurements report the list
  // end at once, so further demo pages may already be loaded.)
  expect(focusable.slice(3, 12)).toEqual(
    Array.from({ length: 9 }, (_, i) => `home/feed/demo-post-${i}`),
  );
  expect(focusable.slice(3).every(id => id.startsWith('home/feed/demo-post-'))).toBe(true);
  // The demo's E1 is answered by FixtureTransport: no real request, no keychain.
  expect(fetchMock).not.toHaveBeenCalled();
  expect(keychain.getGenericPassword).not.toHaveBeenCalled();
  expect(keychain.setGenericPassword).not.toHaveBeenCalled();
  expect(keychain.resetGenericPassword).not.toHaveBeenCalled();
  expect(keychain.__values.get('boostytv.session')).toBe(STORED);
  await act(async () => {
    root.unmount();
  });
});

test('Story 3.2: Подписки shows the demo authors (E2 answered by the demo transport)', async () => {
  fetchMock.mockClear();
  const root = await renderApp();
  await press(root, 'nav/subs');
  const tiles = root.container
    .queryAll(n => n.props.focusable === true)
    .map(n => n.props.testID as string)
    .filter(id => id.startsWith('subs/tile/'));
  expect(tiles.slice(0, 3)).toEqual([
    'subs/tile/demo-blog-1',
    'subs/tile/demo-blog-2',
    'subs/tile/demo-blog-3',
  ]);
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    root.unmount();
  });
});

test('Story 3.3: Автор answers E3/E4 in demo mode (2 pages, an empty blog, a missing blog)', async () => {
  fetchMock.mockClear();
  const root = await renderApp();
  const ids = () =>
    root.container.queryAll(n => n.props.focusable === true).map(n => n.props.testID as string);
  const text = () => JSON.stringify(root.container.toJSON());
  await press(root, 'nav/subs');
  await press(root, 'subs/tile/demo-blog-1');
  expect(text()).toContain('Демо-блог 1');
  expect(ids().filter(id => id.startsWith('author/demo-blog-1/post/')).length).toBeGreaterThan(0);
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    root.unmount();
  });

  await resetQueryCache();
  const empty = await renderApp();
  await press(empty, 'nav/subs');
  await press(empty, 'subs/tile/demo-blog-3');
  expect(JSON.stringify(empty.container.toJSON())).toContain(t('author.emptyTitle'));
  await act(async () => {
    empty.unmount();
  });

  await resetQueryCache();
  const missing = await renderApp();
  await press(missing, 'nav/subs');
  await press(missing, 'subs/tile/demo-blog-8');
  expect(JSON.stringify(missing.container.toJSON())).toContain(t('author.unavailableTitle'));
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    missing.unmount();
  });
});

test('Story 3.4: Пост answers E8 in demo mode (paragraphs and likes, mixed blocks, a missing post)', async () => {
  fetchMock.mockClear();
  const root = await renderApp();
  const ids = () =>
    root.container.queryAll(n => n.props.focusable === true).map(n => n.props.testID as string);
  const text = () => JSON.stringify(root.container.toJSON());
  await press(root, 'home/feed/demo-post-1');
  // demo-post-1: 4 paragraphs, then the mixed placeholders and one more paragraph.
  expect(ids().filter(id => id.startsWith('post/demo-post-1/block/'))).toHaveLength(5);
  expect(text()).toContain('лайк');
  expect(text()).toContain(t('post.block.poll'));
  await act(async () => {
    root.unmount();
  });

  await resetQueryCache();
  const missing = await renderApp();
  await press(missing, 'home/feed/demo-post-9');
  expect(JSON.stringify(missing.container.toJSON())).toContain(t('post.unavailableTitle'));
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    missing.unmount();
  });
});

test('Story 3.5: a demo post with two videos shows two MediaRows on top (the second without a title)', async () => {
  fetchMock.mockClear();
  const root = await renderApp();
  const ids = () =>
    root.container.queryAll(n => n.props.focusable === true).map(n => n.props.testID as string);
  await press(root, 'home/feed/demo-post-4');
  const rows = ids().filter(id => id.startsWith('post/demo-post-4/video/'));
  expect(rows).toEqual([
    'post/demo-post-4/video/demo-video-4-0',
    'post/demo-post-4/video/demo-video-4-1',
  ]);
  const label = (id: string) =>
    root.container.queryAll(n => n.props.testID === id && n.props.focusable === true)[0].props
      .accessibilityLabel;
  expect(label(rows[0])).toMatch(/^Видео 1\. Демо-ролик 5\. \d+:\d\d$/);
  expect(label(rows[1])).toMatch(/^Видео 2\. \d+:\d\d$/);
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    root.unmount();
  });
});

test('Story 2.8: demo expiry → A11 → A2 → A5 → sign-in with another id: the demo hook wipes the stores; the keychain is never touched', async () => {
  // PhoneScreen's send still goes through the real AuthApiClient (global
  // fetch); answer it here. Confirm and E1 go to the demo's FixtureTransport.
  const SEND = '/auth/phone/verification_code/send';
  fetchMock.mockImplementation((url: string) =>
    url.endsWith(SEND)
      ? Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                data: { phoneCode: { code: 'c'.repeat(64), expiresIn: 604800, phone: '+375291234567', sentTransport: 'gate' } },
              }),
            ),
        })
      : noNetwork(url),
  );
  installNativeModules({ InstallId: { getOrCreate: jest.fn().mockResolvedValue('0f8fad5b-d9cb-469f-a165-70867728950e') } });
  fetchMock.mockClear();
  keychain.getGenericPassword.mockClear();
  keychain.setGenericPassword.mockClear();
  keychain.resetGenericPassword.mockClear();
  const root = await renderApp();
  const top = () => topScreen(root, ['auth/expired', 'auth/phone', 'auth/code', 'shell']);

  await press(root, 'nav/settings');
  focusRestoration.remember('shell', 'settings', 'settings/row/version', 0);
  logger.info('test', 'demo account line');
  await press(root, 'settings/row/expired-check');
  expect(top()).toBe('auth/expired');
  await press(root, 'auth/expired/relogin');
  expect(top()).toBe('auth/phone');
  await type(root, 'auth/phone/country', '+375');
  await type(root, 'auth/phone/number', '291234567');
  await press(root, 'auth/phone/send');
  expect(top()).toBe('auth/code');
  await type(root, 'auth/code/field', '482193');
  const field = one(root, 'auth/code/field');
  await act(async () => {
    field.props.onSubmitEditing({ nativeEvent: { text: '482193' } });
  });
  await settle();

  // Signed in on the demo session (E1 id 1001 ≠ stored `demo`): the hook ran.
  expect(top()).toBe('shell');
  expect(session.getStatus()).toBe('signedIn');
  expect(focusRestoration.peek('shell', 'settings')).toBeUndefined();
  expect(JSON.stringify(logger.entries())).not.toContain('demo account line');
  expect(logger.entries().some(e => e.scope === 'account' && e.message === 'reset')).toBe(true);
  // The keychain was never touched and the stored session survives.
  expect(keychain.getGenericPassword).not.toHaveBeenCalled();
  expect(keychain.setGenericPassword).not.toHaveBeenCalled();
  expect(keychain.resetGenericPassword).not.toHaveBeenCalled();
  expect(keychain.__values.get('boostytv.session')).toBe(STORED);
  // Nothing reached the global fetch: the send went through the demo
  // session's fixture transport (Epic 2 retro, item 1).
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    root.unmount();
  });
});
