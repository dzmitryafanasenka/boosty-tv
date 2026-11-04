import { AppError } from '../../../api/appError';
import { userCurrentSchema } from '../../../api/dto/userCurrent';
import { createFixtureTransport, type FixtureHandler } from '../../../api/fixtureTransport';
import { createHttpClient, fixedAccessToken } from '../../../api/httpClient';
import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e1Ok from '../../../../test/fixtures/boosty/e1-user-current.json';
import { USER_CURRENT_PATH, UserRepository, accountDisplayName } from '../userRepository';

function client(handler: FixtureHandler) {
  const transport = createFixtureTransport(handler);
  const http = createHttpClient({
    transport,
    tokens: fixedAccessToken('t'.repeat(64)),
    sleep: () => Promise.resolve(),
    logger: createLogger(),
  });
  return { http, transport };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('userCurrentSchema (E1, Story 5.2 `blogUrl`)', () => {
  it('reads the live fixture: id, blogUrl and name', () => {
    expect(userCurrentSchema.parse(e1Ok.body)).toEqual({
      id: 1001,
      blogUrl: 'synthetic-blog-1',
      name: 'redacted',
    });
  });

  it.each([
    ['missing', {}],
    ['null', { blogUrl: null }],
    ['blank', { blogUrl: '   ' }],
    ['a number', { blogUrl: 7 }],
    ['with a slash', { blogUrl: 'a/b' }],
    ['with ..', { blogUrl: '..' }],
    ['with a query', { blogUrl: 'a?b' }],
    ['with %', { blogUrl: 'a%2F' }],
  ])('a %s blogUrl is absent, never a parse failure', (_name, extra) => {
    const parsed = userCurrentSchema.safeParse({ id: 1001, ...extra });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.blogUrl).toBeUndefined();
  });

  it('a padded blogUrl is trimmed', () => {
    expect(userCurrentSchema.parse({ id: 1, blogUrl: ' mine ' }).blogUrl).toBe('mine');
  });

  it.each([
    ['missing', {}],
    ['null', { name: null }],
    ['a number', { name: 7 }],
    ['an object', { name: { first: 'x' } }],
    ['an array', { name: ['x'] }],
  ])('a %s name (Story 15.2) is absent, never a parse failure', (_name, extra) => {
    const parsed = userCurrentSchema.safeParse({ id: 1001, blogUrl: 'mine', ...extra });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.name).toBeUndefined();
    expect(parsed.data?.blogUrl).toBe('mine');
  });

  it('the id is still required', () => {
    expect(userCurrentSchema.safeParse({ blogUrl: 'mine' }).success).toBe(false);
  });
});

describe('accountDisplayName (Story 15.2, IMP-10)', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['tabs and newlines', '\t\n '],
  ])('%s → null', (_name, raw) => {
    expect(accountDisplayName(raw)).toBeNull();
  });

  it('a padded name is trimmed', () => {
    expect(accountDisplayName('  Анна  ')).toBe('Анна');
  });

  it.each([
    '+7 900 123-45-67',
    '+79001234567',
    '8 (900) 123 45 67',
    '375291234567',
    '1234567',
    ' +375 (29) 123-45-67 ',
    '900.123.45.67',
    '900/123/45/67',
    '900–123–45–67',
    '900—123—45—67',
    '+7 900 ***-**-67',
    '+7•••••4567',
    '+7 *** *** 45 67',
  ])('a phone-like name %p → null', raw => {
    expect(accountDisplayName(raw)).toBeNull();
  });

  it.each([
    ['six digits only', '123456'],
    ['letters and digits', 'Анна 1234567'],
    ['a plain name', 'Анна'],
    ['a nickname with digits', 'user_2002'],
    ['a masked value with three digits', '***-**-67 1'],
    ['stars only', '***'],
    ['a dotted date-like value with six digits', '12.03.25'],
  ])('%s is kept', (_name, raw) => {
    expect(accountDisplayName(raw)).toBe(raw);
  });
});

describe('UserRepository.current', () => {
  it('E1 with the content client: the id as a string and the blogUrl', async () => {
    const { http, transport } = client(() => ({ status: 200, body: e1Ok.body }));
    await expect(UserRepository.current(http)).resolves.toEqual({
      id: '1001',
      blogUrl: 'synthetic-blog-1',
      name: 'redacted',
    });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].method).toBe('GET');
    expect(transport.calls[0].url).toBe(`https://api.boosty.to${USER_CURRENT_PATH}`);
    expect(transport.calls[0].headers.Authorization).toBe(`Bearer ${'t'.repeat(64)}`);
  });

  it('no blogUrl and no name: null', async () => {
    const { http } = client(() => ({ status: 200, body: { id: 'abc' } }));
    await expect(UserRepository.current(http)).resolves.toEqual({ id: 'abc', blogUrl: null, name: null });
  });

  it.each([
    ['padded', ' Анна ', 'Анна'],
    ['blank', '  ', null],
    ['phone-like', '+7 900 123-45-67', null],
    ['not a string', 42, null],
  ])('a %s name maps to %p', async (_name, raw, expected) => {
    const { http } = client(() => ({ status: 200, body: { id: 'abc', name: raw } }));
    await expect(UserRepository.current(http)).resolves.toMatchObject({ id: 'abc', name: expected });
  });

  it.each([
    ['Parse', { status: 200, body: { blogUrl: 'mine' } }],
    ['NotFound', { status: 404, body: {} }],
  ])('rejects with AppError %s', async (kind, reply) => {
    const { http } = client(() => reply);
    const error = await UserRepository.current(http).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe(kind);
  });
});
