/**
 * Story 6.6: PollRepository (E10–E12) over FixtureTransport and the real
 * HttpClient: paths, the E11 form body, no retry or replay of a mutation,
 * and E10 through the one mapper.
 */
import { AppError } from '../../../api/appError';
import { createFixtureTransport, type FixtureHandler } from '../../../api/fixtureTransport';
import { createHttpClient, fixedAccessToken, type AccessTokenSource } from '../../../api/httpClient';
import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e10Poll from '../../../../test/fixtures/boosty/e10-poll.json';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import e10PollMultiple from '../../../../test/fixtures/boosty/e10-poll-multiple.json';
import { PollRepository, pollPath, pollVotePath } from '../pollRepository';

function client(handler: FixtureHandler, tokens: AccessTokenSource = fixedAccessToken('t'.repeat(64))) {
  const transport = createFixtureTransport(handler);
  const http = createHttpClient({
    transport,
    tokens,
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

const kindOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof AppError ? error.kind : 'other';
  }
};

describe('paths', () => {
  it('E10 `/v1/blog/{blogUrl}/poll/{pollId}`, E11/E12 `/v1/poll/{pollId}/vote`, segments encoded', () => {
    expect(pollPath('synthetic-blog', '1020')).toBe('/v1/blog/synthetic-blog/poll/1020');
    expect(pollVotePath('1020')).toBe('/v1/poll/1020/vote');
    expect(pollVotePath('a b')).toBe('/v1/poll/a%20b/vote');
  });

  it('an unsafe blogUrl or a poll id that is not a plain segment is `Client` before any request', () => {
    expect(() => pollPath('a/b', '1')).toThrow(AppError);
    expect(() => pollPath('synthetic-blog', '..')).toThrow(AppError);
    expect(() => pollPath('synthetic-blog', '')).toThrow(AppError);
    expect(() => pollVotePath('.')).toThrow(AppError);
  });
});

describe('E11 vote', () => {
  it('POST with form `answer` = the option id (several comma-joined); body ignored', async () => {
    const { http, transport } = client(() => ({ status: 200, body: { anything: true } }));
    await PollRepository.vote(http, '1020', ['1022']);
    await PollRepository.vote(http, '1020', ['1', '3']);
    expect(transport.calls.map(c => [c.method, c.path, c.form])).toEqual([
      ['POST', '/v1/poll/1020/vote', { answer: '1022' }],
      ['POST', '/v1/poll/1020/vote', { answer: '1,3' }],
    ]);
    expect(transport.calls[0].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it.each([
    ['5xx', { status: 503 }, 'Server'],
    ['network', { network: true as const }, 'Network'],
    ['429', { status: 429 }, 'RateLimited'],
  ])('a %s failure is sent once (never retried) and rejects', async (_name, reply, kind) => {
    const { http, transport } = client(() => reply);
    expect(await kindOf(PollRepository.vote(http, '1020', ['1']))).toBe(kind);
    expect(transport.calls).toHaveLength(1);
  });

  it('a 401 is never replayed after a renewed token', async () => {
    const renew = jest.fn(async () => 'n'.repeat(64));
    const tokens: AccessTokenSource = {
      getAccessToken: async () => ({ token: 'o'.repeat(64), refreshed: false }),
      renewAfterUnauthorized: renew,
    };
    const { http, transport } = client(() => ({ status: 401 }), tokens);
    // HttpClient asks for a renewed token once, then refuses to re-send the mutation.
    expect(await kindOf(PollRepository.vote(http, '1020', ['1']))).toBe('Client');
    expect(renew).toHaveBeenCalledTimes(1);
    expect(renew).toHaveBeenCalledWith('o'.repeat(64));
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].headers.Authorization).toBe(`Bearer ${'o'.repeat(64)}`);
    expect(transport.calls.some(c => c.headers.Authorization === `Bearer ${'n'.repeat(64)}`)).toBe(false);
  });

  it('no option, or an id with a comma, is `Client` before any request', async () => {
    const { http, transport } = client(() => ({ status: 200 }));
    expect(await kindOf(PollRepository.vote(http, '1020', []))).toBe('Client');
    expect(await kindOf(PollRepository.vote(http, '1020', ['1,2']))).toBe('Client');
    expect(transport.calls).toHaveLength(0);
  });
});

describe('E12 retract', () => {
  it('DELETE with no body; a failure is sent once', async () => {
    const ok = client(() => ({ status: 200 }));
    await PollRepository.retract(ok.http, '1020');
    expect(ok.transport.calls.map(c => [c.method, c.path, c.body])).toEqual([
      ['DELETE', '/v1/poll/1020/vote', undefined],
    ]);
    const failing = client(() => ({ status: 500 }));
    expect(await kindOf(PollRepository.retract(failing.http, '1020'))).toBe('Server');
    expect(failing.transport.calls).toHaveLength(1);
  });
});

describe('E10 fetchPoll', () => {
  it('Story 6.7: maps a multiple-choice `data.poll` with two ids in `answer` (synthetic fixture: no live multiple-choice sample)', async () => {
    const { http } = client(() => ({ status: e10PollMultiple.status, body: e10PollMultiple.body }));
    const poll = await PollRepository.fetchPoll(http, 'synthetic-blog', '1030');
    expect(poll).toMatchObject({
      id: '1030',
      isMultiple: true,
      isFinished: false,
      answer: ['1031', '1033'],
      options: [{ id: '1031' }, { id: '1032' }, { id: '1033' }],
    });
  });

  it('maps `data.poll` (the fixture: the user voted for 1022)', async () => {
    const { http, transport } = client(() => ({ status: e10Poll.status, body: e10Poll.body }));
    const poll = await PollRepository.fetchPoll(http, 'synthetic-blog', '1020');
    expect(transport.calls.map(c => [c.method, c.path])).toEqual([['GET', '/v1/blog/synthetic-blog/poll/1020']]);
    expect(poll).toMatchObject({
      id: '1020',
      isMultiple: false,
      isFinished: false,
      counter: 5,
      answer: ['1022'],
      options: [
        { id: '1021', counter: 0, fraction: 0 },
        { id: '1022', counter: 5, fraction: 100 },
      ],
    });
  });

  it.each([
    ['no `data.poll`', { poll: e10Poll.body.data.poll }],
    ['a poll the mapper drops', { data: { poll: { id: 1020, options: [] } } }],
    ['another poll', { data: { poll: { ...e10Poll.body.data.poll, id: 1030 } } }],
  ])('%s is `Parse`', async (_name, body) => {
    const { http } = client(() => ({ status: 200, body }));
    expect(await kindOf(PollRepository.fetchPoll(http, 'synthetic-blog', '1020'))).toBe('Parse');
  });

  it('a GET failure follows the HttpClient (AD-6: a 5xx is retried once)', async () => {
    const { http, transport } = client(() => ({ status: 500 }));
    expect(await kindOf(PollRepository.fetchPoll(http, 'synthetic-blog', '1020'))).toBe('Server');
    expect(transport.calls).toHaveLength(2);
  });
});
