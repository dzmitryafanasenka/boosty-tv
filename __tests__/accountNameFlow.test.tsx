/**
 * Story 15.2 (IMP-10, FR-66) through the real App over FixtureTransport as
 * the global `fetch`: Настройки' «Выйти из аккаунта» shows the E1 `name`
 * as its right-aligned value and in its spoken label; a missing, blank,
 * non-string or phone-like name, a pending or failed E1 leave the row as
 * before; a `me` cache that Подписки filled sends no E1; sign-out and a
 * sign-in as another account never show the previous account's name; a
 * long name stays on one line. The keychain, BackHandler and the native
 * focus command are faked: these tests prove what the app renders and
 * asks for, not native layout, ellipsis or focus.
 */
import { StyleSheet } from 'react-native';
import { type Root } from 'test-renderer';
import App from '../src/app/App';
import { QUERY_GC_TIME_MS, queryClient, resetQueryCache } from '../src/app/queryClient';
import { queryKeys } from '../src/shared/api';
import { authFlow } from '../src/features/auth/authFlow';
import {
  type FixtureReply,
  type FixtureRequest,
  type FixtureTransport,
} from '../src/shared/api/fixtureTransport';
import { focusRestoration } from '../src/shared/focus';
import { t } from '../src/shared/i18n';
import { logger } from '../src/shared/services/logger';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import e1Unauthorized from '../src/test/fixtures/boosty/e1-no-token.json';
import backHandler from '../src/test/backHandlerMock';
import { E5_PATH, e5Page } from '../src/test/feedFixtures';
import { E2_PATH, subscriptionsBody } from '../src/test/subscriptionFixtures';
import {
  byTestId,
  clearNativeModules,
  createFlow,
  focusableIds,
  installFixtureTransport,
  installNativeModules,
  lastFocusTarget,
  resetKeychain,
  resetRecorders,
  text,
  unmount,
  visible,
} from '../src/test/flow';

jest.mock('react-native-keychain');
jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));

jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  require('../src/test/backHandlerMock'),
);

const focusMock = requestHostFocus as jest.Mock;

const { render, one, press, type, submit } = createFlow({
  settle: { rounds: 30, timerRounds: 30 },
  one: 'focusableOrInput',
  pressFocuses: true,
  submitSettles: true,
});

const PHONE = '+375291234567';
const OLD_ACCESS = 'a'.repeat(64);
const NEW_ACCESS = 'n'.repeat(64);
const STORED = JSON.stringify({
  v: 1,
  accessToken: OLD_ACCESS,
  refreshToken: 'r'.repeat(64),
  expiresAt: 4_000_000_000_000,
  accountId: '1001',
});
const E1 = '/v1/user/current';

const ROW = 'settings/row/signout';
const VALUE = `${ROW}/value`;
const VERSION = 'settings/row/version';
const CONFIRM = 'dialog/signout/confirm';
const LABEL = t('settings.signOut.row');

/** Synthetic names (not fixtures: never a real account's value). */
const NAME_A = 'Анна';
const NAME_B = 'Борис';

/** A's E1 body (the stored session's token); `name` omitted when undefined. */
let nameA: unknown;
/** B's E1 body (the token of a later sign-in). */
let nameB: unknown;
/** Overrides the E1 reply after the cold-start validate (the first E1). */
let laterE1: ((req: FixtureRequest) => FixtureReply | Promise<FixtureReply>) | null;
let transport: FixtureTransport;

function e1Body(id: number, name: unknown) {
  return name === undefined ? { id, blogUrl: 'synthetic-blog-1' } : { id, blogUrl: 'synthetic-blog-1', name };
}

function route(req: FixtureRequest): FixtureReply | Promise<FixtureReply> | undefined {
  switch (req.path) {
    case E1: {
      const auth = req.headers.Authorization;
      if (laterE1 && transport.callsTo(E1).length > 1) {
        return laterE1(req);
      }
      if (auth === `Bearer ${OLD_ACCESS}`) {
        return { status: 200, body: e1Body(1001, nameA) };
      }
      if (auth === `Bearer ${NEW_ACCESS}`) {
        return { status: 200, body: e1Body(2002, nameB) };
      }
      return { status: e1Unauthorized.status, body: e1Unauthorized.body };
    }
    case E5_PATH:
      return { status: 200, body: e5Page() };
    case E2_PATH:
      return { status: 200, body: subscriptionsBody(3) };
    case '/auth/phone/verification_code/send':
      return {
        status: 200,
        body: { data: { phoneCode: { code: 'c'.repeat(64), expiresIn: 604800, phone: PHONE, sentTransport: 'gate' } } },
      };
    case '/auth/phone/verification_code/confirm':
      return { status: 200, body: { access_token: NEW_ACCESS, refresh_token: 'm'.repeat(64), expires_in: 2592000 } };
    default:
      return undefined;
  }
}

beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  focusMock.mockClear();
  backHandler.reset();
  resetRecorders();
  resetKeychain({ 'boostytv.session': STORED, 'boostytv.phone': PHONE });
  installNativeModules({
    AppInfo: { versionName: '1.2.0' },
    InstallId: { getOrCreate: jest.fn().mockResolvedValue('0f8fad5b-d9cb-469f-a165-70867728950e') },
  });
  logger.clear();
  nameA = NAME_A;
  nameB = NAME_B;
  laterE1 = null;
  transport = installFixtureTransport(route);
});

afterEach(async () => {
  queryClient.setQueryDefaults(queryKeys.me(), { gcTime: QUERY_GC_TIME_MS });
  await resetQueryCache();
  clearNativeModules();
  focusRestoration.clear();
  authFlow.reset();
  jest.restoreAllMocks();
});

async function openSettings(root: Root) {
  await press(root, 'nav/settings');
  expect(lastFocusTarget()).toBe(VERSION);
}

/**
 * The flow's settle runs every pending timer, so an unobserved query would
 * be garbage-collected at once; in the app it stays for `gcTime` (10 min).
 * Keeps `me` while no screen observes it.
 */
function keepMeCached() {
  queryClient.setQueryDefaults(queryKeys.me(), { gcTime: Infinity });
}

/** The row's shown value, or null when the row has none. */
function shownName(root: Root): string | null {
  const [value] = byTestId(root, VALUE);
  if (!value) {
    return null;
  }
  return value.props.children as string;
}

/** The row as before Story 15.2: no value, the label alone is spoken. */
function expectPlainRow(root: Root) {
  expect(visible(root, VALUE)).toBe(false);
  expect(one(root, ROW).props.accessibilityLabel).toBe(LABEL);
}

/** The name is never written into the log ring. */
function expectNotLogged(name: string) {
  expect(JSON.stringify(logger.entries())).not.toContain(name);
}

describe('the name is known', () => {
  it('right-aligned on «Выйти из аккаунта», spoken with the label; one E1 on a cold cache; the rows unchanged', async () => {
    const root = await render(<App />);
    // The cold-start validate only.
    expect(transport.callsTo(E1)).toHaveLength(1);
    await openSettings(root);
    expect(transport.callsTo(E1)).toHaveLength(2);
    expect(shownName(root)).toBe(NAME_A);
    expect(one(root, ROW).props.accessibilityLabel).toBe(`${LABEL} ${NAME_A}`);
    // The row keeps its id, kind and order (Story 15.1 row order).
    const [settings] = byTestId(root, 'settings');
    expect(focusableIds(settings).slice(0, 5)).toEqual([
      'settings/row/external-player',
      VERSION,
      'settings/row/about',
      'settings/row/report',
      ROW,
    ]);
    expect(one(root, ROW).props.accessibilityRole).toBe('button');
    expect(text(root)).not.toContain(PHONE);
    expectNotLogged(NAME_A);
    await unmount(root);
  });

  it('a padded name is trimmed', async () => {
    nameA = `  ${NAME_A}  `;
    const root = await render(<App />);
    await openSettings(root);
    expect(shownName(root)).toBe(NAME_A);
    await unmount(root);
  });

  it('OK still opens the sign-out dialog', async () => {
    const root = await render(<App />);
    await openSettings(root);
    await press(root, ROW);
    expect(visible(root, 'dialog/signout')).toBe(true);
    await unmount(root);
  });

  it('a long name stays on one line, the value yields to the label', async () => {
    const long = 'Очень длинное имя аккаунта '.repeat(3).slice(0, 80);
    expect(long).toHaveLength(80);
    nameA = long;
    const root = await render(<App />);
    await openSettings(root);
    const [value] = byTestId(root, VALUE);
    expect(value.props.children).toBe(long.trim());
    expect(value.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(value.props.style)).toMatchObject({ flexShrink: 1 });
    // The label keeps its width (SettingRow `valueYields`: `labelKept`).
    const [row] = byTestId(root, ROW);
    const label = row.queryAll(node => node.props.children === LABEL && node.props.numberOfLines === 1)[0];
    expect(StyleSheet.flatten(label.props.style)).toMatchObject({ flexShrink: 0 });
    // No description line: the row keeps its height.
    expect(visible(root, `${ROW}/description`)).toBe(false);
    await unmount(root);
  });
});

describe('no name: the row as before', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['a number', 42],
    ['null', null],
    ['an object', { first: NAME_A }],
  ])('%s', async (_case, raw) => {
    nameA = raw;
    const root = await render(<App />);
    await openSettings(root);
    expectPlainRow(root);
    expect(visible(root, 'shell')).toBe(true);
    await unmount(root);
  });

  it.each(['+7 900 123-45-67', PHONE, '8 (900) 123 45 67'])('a phone-like name %p is not shown', async raw => {
    nameA = raw;
    const root = await render(<App />);
    await openSettings(root);
    expectPlainRow(root);
    expect(text(root)).not.toContain(raw);
    expect(text(root)).not.toContain(PHONE);
    await unmount(root);
  });
});

describe('E1 pending or failed', () => {
  it('pending: the row as before', async () => {
    laterE1 = () => new Promise<FixtureReply>(() => {});
    const root = await render(<App />);
    await openSettings(root);
    expect(transport.callsTo(E1)).toHaveLength(2);
    expectPlainRow(root);
    await unmount(root);
  });

  it('failed: the row as before, no error UI; leaving and coming back sends no new E1', async () => {
    laterE1 = () => ({ status: 404, body: {} });
    keepMeCached();
    const root = await render(<App />);
    await openSettings(root);
    expect(transport.callsTo(E1)).toHaveLength(2);
    expectPlainRow(root);
    expect(text(root)).not.toContain(t('error.Unknown'));
    await press(root, 'nav/home');
    await openSettings(root);
    expect(transport.callsTo(E1)).toHaveLength(2);
    expectPlainRow(root);
    await unmount(root);
  });

  it('a body with no valid id (Parse): the row as before, still signed in', async () => {
    laterE1 = () => ({ status: 200, body: { name: NAME_A } });
    const root = await render(<App />);
    await openSettings(root);
    expectPlainRow(root);
    expect(visible(root, 'shell')).toBe(true);
    await unmount(root);
  });
});

describe('the cache', () => {
  it('Подписки filled `me` earlier: the name is shown with no extra E1', async () => {
    keepMeCached();
    const root = await render(<App />);
    await press(root, 'nav/subs');
    const sent = transport.callsTo(E1).length;
    expect(sent).toBe(2);
    await openSettings(root);
    expect(transport.callsTo(E1)).toHaveLength(sent);
    expect(shownName(root)).toBe(NAME_A);
    await unmount(root);
  });
});

describe('sign out, then another account', () => {
  async function signOutAndSignInAsB(root: Root) {
    await openSettings(root);
    expect(shownName(root)).toBe(NAME_A);
    await press(root, ROW);
    await press(root, CONFIRM);
    expect(visible(root, 'auth/welcome')).toBe(true);
    expect(text(root)).not.toContain(NAME_A);
    await press(root, 'auth/welcome/signin');
    await type(root, 'auth/phone/country', '+375');
    await type(root, 'auth/phone/number', '291234567');
    await press(root, 'auth/phone/send');
    await type(root, 'auth/code/field', '482193');
    await submit(root, 'auth/code/field');
    expect(visible(root, 'shell')).toBe(true);
  }

  it("B's name, never A's", async () => {
    const root = await render(<App />);
    await signOutAndSignInAsB(root);
    const before = transport.callsTo(E1).length;
    await openSettings(root);
    // The reset cleared `me`: Настройки asks E1 again, with B's token.
    expect(transport.callsTo(E1)).toHaveLength(before + 1);
    expect(transport.callsTo(E1)[before].headers.Authorization).toBe(`Bearer ${NEW_ACCESS}`);
    expect(shownName(root)).toBe(NAME_B);
    expect(text(root)).not.toContain(NAME_A);
    expectNotLogged(NAME_A);
    expectNotLogged(NAME_B);
    await unmount(root);
  });

  it("B has no name: the row as before, A's name never shown", async () => {
    nameB = undefined;
    const root = await render(<App />);
    await signOutAndSignInAsB(root);
    await openSettings(root);
    expectPlainRow(root);
    expect(text(root)).not.toContain(NAME_A);
    await unmount(root);
  });

  it("B's E1 still pending: A's name is not shown meanwhile", async () => {
    const root = await render(<App />);
    await signOutAndSignInAsB(root);
    laterE1 = () => new Promise<FixtureReply>(() => {});
    await openSettings(root);
    expectPlainRow(root);
    expect(text(root)).not.toContain(NAME_A);
    await unmount(root);
  });
});
