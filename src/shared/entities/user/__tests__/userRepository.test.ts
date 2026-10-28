import { AppError } from '../../../api/appError';
import { userCurrentSchema } from '../../../api/dto/userCurrent';
import { createFixtureTransport, type FixtureHandler } from '../../../api/fixtureTransport';
import { createHttpClient, fixedAccessToken } from '../../../api/httpClient';
import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e1Ok from '../../../../test/fixtures/boosty/e1-user-current.json';
import { USER_CURRENT_PATH, UserRepository } from '../userRepository';

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
  it('reads the live fixture: id and blogUrl', () => {
    expect(userCurrentSchema.parse(e1Ok.body)).toEqual({ id: 1001, blogUrl: 'synthetic-blog-1' });
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

  it('the id is still required', () => {
    expect(userCurrentSchema.safeParse({ blogUrl: 'mine' }).success).toBe(false);
  });
});

describe('UserRepository.current', () => {
  it('E1 with the content client: the id as a string and the blogUrl', async () => {
    const { http, transport } = client(() => ({ status: 200, body: e1Ok.body }));
    await expect(UserRepository.current(http)).resolves.toEqual({
      id: '1001',
      blogUrl: 'synthetic-blog-1',
    });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].method).toBe('GET');
    expect(transport.calls[0].url).toBe(`https://api.boosty.to${USER_CURRENT_PATH}`);
    expect(transport.calls[0].headers.Authorization).toBe(`Bearer ${'t'.repeat(64)}`);
  });

  it('no blogUrl: null', async () => {
    const { http } = client(() => ({ status: 200, body: { id: 'abc' } }));
    await expect(UserRepository.current(http)).resolves.toEqual({ id: 'abc', blogUrl: null });
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
