/**
 * Story 6.5: the PollWidget (I, focus-map §4): results, the user's choice,
 * the voters, the finished state, one focus stop with no focusable option
 * (display mode: no vote props, or a finished / multiple-choice poll).
 * Story 6.6: votable mode (the describe at the end).
 */
import { QueryClient, QueryClientProvider, notifyManager, useQuery } from '@tanstack/react-query';
import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { AppError, queryKeys, type HttpClient } from '../../../shared/api';
import type { HttpRequest, HttpResponse } from '../../../shared/api/httpClient';
import type { Poll } from '../../../shared/entities/poll';
import type { Post, PostResult } from '../../../shared/entities/post';
import { t } from '../../../shared/i18n';
import { colors } from '../../../shared/ui';
import { accountScope } from '../../../shared/account';
// eslint-disable-next-line boundaries/dependencies -- test-only helpers
import { deferred, flush } from '../../../test/async';
import { PollWidget, pollAccessibilityLabel } from '../PollWidget';
import { resetPollVotesForTests } from '../usePollVote';

const ID = 'post/p/block/poll:9';
const noop = () => {};

const poll = (overrides: Partial<Poll> = {}): Poll => ({
  id: '9',
  title: 'Какой формат удобнее?',
  isMultiple: false,
  isFinished: false,
  counter: 2521,
  answer: [],
  options: [
    { id: '1', text: 'Длинные', counter: 1210, fraction: 48 },
    { id: '2', text: 'Короткие', counter: 958, fraction: 38 },
    { id: '3', text: 'Эфиры', counter: 353, fraction: 14.4 },
  ],
  ...overrides,
});

const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
});

async function render(p: Poll, onView = noop as (id: string, view: unknown) => void, onFocus = noop) {
  const root = createRoot();
  roots.push(root);
  await act(async () => root.render(<PollWidget id={ID} poll={p} onView={onView} onFocus={onFocus} />));
  return root;
}

const focusables = (root: Root) =>
  root.container.queryAll(n => n.props.focusable === true).map(n => n.props.testID as string);
const host = (root: Root) => root.container.queryAll(n => n.props.testID === ID && n.props.focusable === true)[0];
const has = (root: Root, testID: string) => root.container.queryAll(n => n.props.testID === testID).length > 0;
const text = (root: Root) => JSON.stringify(root.container.toJSON());
const barWidth = (root: Root, optionId: string) =>
  StyleSheet.flatten(root.container.queryAll(n => n.props.testID === `${ID}/option/${optionId}/bar`)[0].props.style)
    .width;

test('matrix «Open poll»: the title, each option with a bar, its rounded percent and vote count (POLL-01), «Проголосовали: N» with a thousands separator; one focus stop', async () => {
  const root = await render(poll());
  expect(focusables(root)).toEqual([ID]);
  expect(text(root)).toContain('Какой формат удобнее?');
  for (const label of [
    'Длинные',
    'Короткие',
    'Эфиры',
    '48\u00A0% · 1\u202F210',
    '38\u00A0% · 958',
    '14\u00A0% · 353',
    'Проголосовали: 2\u202F521',
  ]) {
    expect(text(root)).toContain(label);
  }
  expect(barWidth(root, '1')).toBe('48%');
  expect(barWidth(root, '3')).toBe('14.4%');
  expect(has(root, `${ID}/finished`)).toBe(false);
  for (const id of ['1', '2', '3']) {
    expect(has(root, `${ID}/option/${id}/chosen`)).toBe(false);
  }
  expect(host(root).props.accessibilityLabel).toBe(
    'Опрос. Какой формат удобнее? Длинные, 48\u00A0%, 1\u202F210 голосов. Короткие, 38\u00A0%, 958 голосов. ' +
      'Эфиры, 14\u00A0%, 353 голоса. Проголосовали: 2\u202F521',
  );
});

test('matrix «My choice»: the chosen option carries the accent check; the label says «ваш выбор»', async () => {
  const root = await render(poll({ answer: ['2'] }));
  expect(has(root, `${ID}/option/2/chosen`)).toBe(true);
  expect(has(root, `${ID}/option/1/chosen`)).toBe(false);
  expect(host(root).props.accessibilityLabel).toContain('Короткие, 38\u00A0%, 958 голосов, ваш выбор');
  expect(host(root).props.accessibilityLabel).not.toContain('1\u202F210 голосов, ваш выбор');
});

test('matrix «Finished»: «Опрос завершен» and the results; still one stop', async () => {
  const root = await render(poll({ isFinished: true, answer: ['1'] }));
  expect(focusables(root)).toEqual([ID]);
  expect(has(root, `${ID}/finished`)).toBe(true);
  expect(text(root)).toContain(t('poll.finished'));
  expect(text(root)).toContain('48\u00A0%');
  expect(host(root).props.accessibilityLabel).toMatch(/Опрос завершен$/);
});

test('matrix «Zero voters»: 0 % bars, «Проголосовали: 0»', async () => {
  const root = await render(
    poll({
      counter: 0,
      options: [
        { id: '1', text: 'A', counter: 0, fraction: 0 },
        { id: '2', text: 'B', counter: 0, fraction: 0 },
      ],
    }),
  );
  expect(barWidth(root, '1')).toBe('0%');
  expect(barWidth(root, '2')).toBe('0%');
  expect(text(root)).toContain('0\u00A0%');
  expect(text(root)).toContain('Проголосовали: 0');
});

test('a fraction out of range: the bar is clamped to 0…100, the text shows the API value rounded', async () => {
  const root = await render(
    poll({
      options: [
        { id: '1', text: 'A', counter: 1, fraction: 140 },
        { id: '2', text: 'B', counter: 0, fraction: -3 },
      ],
    }),
  );
  expect(barWidth(root, '1')).toBe('100%');
  expect(barWidth(root, '2')).toBe('0%');
  expect(text(root)).toContain('140\u00A0%');
});

test('an empty title reads «Опрос»; the label says it once («Опрос. Длинные, …»)', async () => {
  const root = await render(poll({ title: '  ' }));
  expect(text(root)).toContain(t('poll.untitled'));
  expect(host(root).props.accessibilityLabel).toMatch(/^Опрос\. Длинные, /);
  expect(pollAccessibilityLabel(poll({ title: '' }))).not.toContain('Опрос. Опрос');
});

test('an option without text reads «Вариант N» (its position) in the row and the label', async () => {
  const root = await render(
    poll({
      options: [
        { id: '1', text: 'Длинные', counter: 1, fraction: 50 },
        { id: '2', text: '  ', counter: 1, fraction: 50 },
      ],
    }),
  );
  expect(text(root)).toContain('Вариант 2');
  expect(host(root).props.accessibilityLabel).toContain('Вариант 2, 50\u00A0%, 1 голос');
});

test('the label adds no period after a part that already ends a sentence («?», «!», «.», «…»)', () => {
  const one = (title: string, optionText: string) =>
    pollAccessibilityLabel(
      poll({ title, counter: 1, options: [{ id: '1', text: optionText, counter: 1, fraction: 100 }] }),
    );
  expect(one('Что лучше?', 'Да')).toBe('Опрос. Что лучше? Да, 100\u00A0%, 1 голос. Проголосовали: 1');
  expect(one('Голосуем!', 'Да')).toBe('Опрос. Голосуем! Да, 100\u00A0%, 1 голос. Проголосовали: 1');
  expect(one('Итоги.', 'Да')).toBe('Опрос. Итоги. Да, 100\u00A0%, 1 голос. Проголосовали: 1');
  expect(one('Итак…', 'Да')).toBe('Опрос. Итак… Да, 100\u00A0%, 1 голос. Проголосовали: 1');
  expect(one('Вопрос', 'Да')).toBe('Опрос. Вопрос. Да, 100\u00A0%, 1 голос. Проголосовали: 1');
  expect(pollAccessibilityLabel(poll({ title: 'Что лучше?', isFinished: true }))).toMatch(
    /Проголосовали: 2\u202F521\. Опрос завершен$/,
  );
});

test('focus: a ring and no scale; onFocus and onView report the focus id; OK does nothing', async () => {
  const onFocus = jest.fn();
  const onView = jest.fn();
  const root = await render(poll(), onView, onFocus);
  expect(onView).toHaveBeenCalledWith(ID, expect.anything());
  expect(has(root, `${ID}/ring`)).toBe(false);
  await act(async () => {
    host(root).props.onFocus({ nativeEvent: {} });
  });
  expect(onFocus).toHaveBeenCalledWith(ID);
  expect(has(root, `${ID}/ring`)).toBe(true);
  const scale = StyleSheet.flatten(root.container.queryAll(n => n.props.testID === `${ID}/scale`)[0].props.style);
  expect(scale.transform).toEqual([{ scale: 1 }]);
  await act(async () => {
    host(root).props.onClick?.({ nativeEvent: {} });
  });
  expect(focusables(root)).toEqual([ID]);
});

/**
 * Story 6.6: votable mode (an open single-choice poll with the vote props;
 * focus-map §4 I «Poll, single choice»), every row of the spec's matrix. The
 * poll is read from a seeded E8 query (as PostScreen does), so E10 through
 * `applyPoll` shows on screen. The HttpClient is a fake the test answers.
 */
describe('Story 6.6: vote and retract (votable mode)', () => {
  const BLOG = 'synthetic-blog';
  const POST = 'p';
  const PREFIX = `post/${POST}/poll/option/`;
  const OPT = (optionId: string) => `${PREFIX}${optionId}`;
  const evt = { nativeEvent: {} };

  type Pending = { request: HttpRequest<unknown>; d: ReturnType<typeof deferred<HttpResponse<unknown>>> };

  let client: QueryClient;
  let calls: Pending[];
  let http: HttpClient;

  beforeAll(() => {
    jest.useFakeTimers();
    // Query observers notify on a microtask (as the flow tests), not a fake timer.
    notifyManager.setScheduler(callback => {
      Promise.resolve().then(callback);
    });
  });
  afterAll(() => {
    jest.useRealTimers();
    notifyManager.setScheduler(callback => setTimeout(callback, 0));
  });

  beforeEach(() => {
    resetPollVotesForTests();
    client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    calls = [];
    const send = (request: HttpRequest<unknown>) => {
      const d = deferred<HttpResponse<unknown>>();
      calls.push({ request, d });
      return d.promise;
    };
    http = {
      request: (request: HttpRequest<unknown>) => send(request),
      get: (path: string) => send({ method: 'GET', path }),
    } as unknown as HttpClient;
  });

  afterEach(() => {
    client.clear();
    jest.restoreAllMocks();
  });

  /** The E10 body of `p` (domain → the API shape). */
  const e10 = (p: Poll): HttpResponse<unknown> => ({
    status: 200,
    body: {
      data: {
        poll: {
          id: Number(p.id),
          title: [p.title],
          isMultiple: p.isMultiple,
          isFinished: p.isFinished,
          counter: p.counter,
          answer: p.answer.map(Number),
          options: p.options.map(o => ({ ...o, id: Number(o.id) })),
        },
      },
    },
  });

  function Harness() {
    const { data } = useQuery<PostResult>({
      queryKey: queryKeys.post(BLOG, POST),
      queryFn: () => new Promise<PostResult>(() => {}),
      enabled: false,
    });
    const p = data?.kind === 'ok' ? data.post.poll : null;
    return p ? (
      <PollWidget
        id={ID}
        poll={p}
        onView={noop}
        onFocus={noop}
        http={http}
        blogUrl={BLOG}
        postId={POST}
        optionIdPrefix={PREFIX}
      />
    ) : null;
  }

  async function renderVotable(p: Poll, twice = false) {
    client.setQueryData(queryKeys.post(BLOG, POST), { kind: 'ok', post: { id: POST, poll: p } as unknown as Post });
    const root = createRoot();
    roots.push(root);
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Harness />
          {twice ? <Harness /> : null}
        </QueryClientProvider>,
      ),
    );
    return root;
  }

  const stop = (root: Root, optionId: string, nth = 0) =>
    root.container.queryAll(n => n.props.testID === OPT(optionId) && n.props.focusable === true)[nth];
  const ok = async (root: Root, optionId: string, nth = 0) => {
    await act(async () => {
      stop(root, optionId, nth).props.onFocus(evt);
      stop(root, optionId, nth).props.onClick(evt);
    });
  };
  const blur = async (root: Root, optionId: string) => {
    await act(async () => stop(root, optionId).props.onBlur(evt));
  };
  const answer = async (i: number, reply: HttpResponse<unknown> | Error) => {
    await act(async () => {
      if (reply instanceof Error) {
        calls[i].d.reject(reply);
      } else {
        calls[i].d.resolve(reply);
      }
      await flush();
    });
  };
  const sent = () => calls.map(c => [c.request.method ?? 'GET', c.request.path, c.request.form ?? null]);
  const pendingHint = (root: Root, optionId: string) =>
    root.container.queryAll(n => n.props.testID === `${ID}/option/${optionId}/pending`)[0]?.props.children ?? null;
  const VOTE_PATH = '/v1/poll/9/vote';
  const E10_PATH = `/v1/blog/${BLOG}/poll/9`;

  it('each option is a stop (`post/<postId>/poll/option/<id>`); the root is not focusable; a ring, no scale', async () => {
    const root = await renderVotable(poll());
    expect(focusables(root)).toEqual([OPT('1'), OPT('2'), OPT('3')]);
    expect(root.container.queryAll(n => n.props.testID === ID)[0].props.focusable).toBe(false);
    await act(async () => stop(root, '1').props.onFocus(evt));
    expect(has(root, `${OPT('1')}/ring`)).toBe(true);
    const scale = StyleSheet.flatten(root.container.queryAll(n => n.props.testID === `${OPT('1')}/scale`)[0].props.style);
    expect(scale.transform).toEqual([{ scale: 1 }]);
    expect(stop(root, '1').props.accessibilityLabel).toBe(
      'Опрос. Какой формат удобнее? Длинные, 48 %, 1 210 голосов',
    );
    expect(stop(root, '2').props.accessibilityLabel).toBe('Короткие, 38 %, 958 голосов');
    // The voters line is off-screen at the last option: its label ends with it.
    expect(stop(root, '3').props.accessibilityLabel).toBe('Эфиры, 14 %, 353 голоса. Проголосовали: 2 521');
    await ok(root, '3');
    expect(stop(root, '3').props.accessibilityLabel).toBe(
      'Эфиры, 14 %, 353 голоса. Нажмите OK ещё раз. Проголосовали: 2 521',
    );
  });

  it('matrix «Vote»: OK → pending (outline, hint); OK → sending (spinner), E11 `answer=2`, then E10; results and the check update, focus stays', async () => {
    const root = await renderVotable(poll());
    await ok(root, '2');
    expect(pendingHint(root, '2')).toBe(t('poll.pendingVote'));
    expect(has(root, `${ID}/option/2/outline`)).toBe(true);
    // In the result's place, one line (the option's height never changes); the other options keep their result.
    const hintNode = root.container.queryAll(n => n.props.testID === `${ID}/option/2/pending`)[0];
    expect(hintNode.props.numberOfLines).toBe(1);
    expect(text(root)).not.toContain('38 % · 958');
    expect(text(root)).toContain('48 % · 1 210');
    expect(stop(root, '2').props.accessibilityLabel).toMatch(/Нажмите OK ещё раз$/);
    expect(calls).toHaveLength(0);
    await ok(root, '2');
    expect(sent()).toEqual([['POST', VOTE_PATH, [['answer', '2']]]]);
    expect(has(root, `${ID}/option/2/sending`)).toBe(true);
    expect(pendingHint(root, '2')).toBeNull();
    expect(stop(root, '2').props.accessibilityState).toMatchObject({ selected: false, busy: true });
    await answer(0, { status: 200, body: { ignored: true } });
    expect(sent()[1]).toEqual(['GET', E10_PATH, null]);
    const voted = poll({
      counter: 2522,
      answer: ['2'],
      options: [
        { id: '1', text: 'Длинные', counter: 1210, fraction: 48 },
        { id: '2', text: 'Короткие', counter: 959, fraction: 38 },
        { id: '3', text: 'Эфиры', counter: 353, fraction: 14 },
      ],
    });
    await answer(1, e10(voted));
    expect(has(root, `${ID}/option/2/chosen`)).toBe(true);
    expect(has(root, `${ID}/option/2/sending`)).toBe(false);
    expect(text(root)).toContain('Проголосовали: 2 522');
    expect(has(root, `${OPT('2')}/ring`)).toBe(true);
    expect(has(root, `${ID}/error`)).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('matrix «Cancel»: OK on 1, then focus moves to 2 → 1 leaves pending; nothing is sent', async () => {
    const root = await renderVotable(poll());
    await ok(root, '1');
    expect(pendingHint(root, '1')).toBe(t('poll.pendingVote'));
    expect(text(root)).not.toContain('48 % · 1 210');
    await blur(root, '1');
    await act(async () => stop(root, '2').props.onFocus(evt));
    expect(pendingHint(root, '1')).toBeNull();
    // The result is back in its place.
    expect(text(root)).toContain('48 % · 1 210');
    expect(has(root, `${ID}/option/1/outline`)).toBe(false);
    // The next OK on 2 is a first OK again.
    await ok(root, '2');
    expect(pendingHint(root, '2')).toBe(t('poll.pendingVote'));
    expect(calls).toHaveLength(0);
  });

  it('matrix «Retract»: answer [2]; OK → «…, чтобы отозвать»; OK → E12, then E10; no check', async () => {
    const root = await renderVotable(poll({ answer: ['2'] }));
    await ok(root, '2');
    expect(pendingHint(root, '2')).toBe(t('poll.pendingRetract'));
    expect(stop(root, '2').props.accessibilityLabel).toContain('ваш выбор. Нажмите OK ещё раз, чтобы отозвать');
    await ok(root, '2');
    expect(sent()).toEqual([['DELETE', VOTE_PATH, null]]);
    await answer(0, { status: 200, body: undefined });
    expect(sent()[1]).toEqual(['GET', E10_PATH, null]);
    await answer(1, e10(poll({ answer: [] })));
    expect(has(root, `${ID}/option/2/chosen`)).toBe(false);
  });

  it('matrix «Change vote» (owner decision Q1 a): answer [1]; OK, OK on 2 → «Нажмите OK ещё раз», then E11 `answer=2`, then E10', async () => {
    const root = await renderVotable(poll({ answer: ['1'] }));
    await ok(root, '2');
    expect(pendingHint(root, '2')).toBe(t('poll.pendingVote'));
    await ok(root, '2');
    expect(sent()).toEqual([['POST', VOTE_PATH, [['answer', '2']]]]);
    await answer(0, { status: 200, body: undefined });
    await answer(1, e10(poll({ answer: ['2'] })));
    expect(has(root, `${ID}/option/2/chosen`)).toBe(true);
    expect(has(root, `${ID}/option/1/chosen`)).toBe(false);
  });

  it.each([
    ['network', new AppError('Network')],
    ['5xx', new AppError('Server', 503)],
    ['429', new AppError('RateLimited', 429)],
    ['server refusal (change vote)', new AppError('Client', 400)],
  ])('matrix «Mutation fails» (%s): inline error, previous state, 1 request; the next OK clears it and starts pending', async (_name, failure) => {
    const root = await renderVotable(poll({ answer: ['1'] }));
    await ok(root, '2');
    await ok(root, '2');
    await answer(0, failure);
    expect(calls).toHaveLength(1);
    const errorNode = root.container.queryAll(n => n.props.testID === `${ID}/error`)[0];
    expect(errorNode.props.children).toBe(t('poll.voteFailed'));
    // Announced (focus stays on the option).
    expect(errorNode.props.accessibilityLiveRegion).toBe('polite');
    expect(has(root, `${ID}/option/1/chosen`)).toBe(true);
    expect(has(root, `${ID}/option/2/chosen`)).toBe(false);
    expect(has(root, `${ID}/option/2/sending`)).toBe(false);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    await ok(root, '2');
    expect(has(root, `${ID}/error`)).toBe(false);
    expect(pendingHint(root, '2')).toBe(t('poll.pendingVote'));
    expect(calls).toHaveLength(1);
  });

  it('a failed retract reads «Не удалось отозвать голос»', async () => {
    const root = await renderVotable(poll({ answer: ['2'] }));
    await ok(root, '2');
    await ok(root, '2');
    await answer(0, new AppError('Server', 500));
    expect(root.container.queryAll(n => n.props.testID === `${ID}/error`)[0].props.children).toBe(t('poll.retractFailed'));
    expect(has(root, `${ID}/option/2/chosen`)).toBe(true);
  });

  it('matrix «Double press while sending»: more OKs (same or another option) during the request are ignored; still 1 request', async () => {
    const root = await renderVotable(poll());
    await ok(root, '2');
    await ok(root, '2');
    await ok(root, '2');
    await ok(root, '2');
    await ok(root, '1');
    await ok(root, '1');
    expect(calls).toHaveLength(1);
    expect(pendingHint(root, '1')).toBeNull();
  });

  it('single flight per poll id, app-wide: a second widget of the same poll ignores OK while the first one sends', async () => {
    const root = await renderVotable(poll(), true);
    await ok(root, '2', 0);
    await ok(root, '2', 0);
    expect(calls).toHaveLength(1);
    // The other instance shows the running request and ignores OK.
    expect(root.container.queryAll(n => n.props.testID === `${ID}/option/2/sending`)).toHaveLength(2);
    await ok(root, '1', 1);
    await ok(root, '1', 1);
    expect(calls).toHaveLength(1);
  });

  it('a sign-out / account switch between E11 and E10 (generation bump): no cache write, no invalidation; the new account is not blocked', async () => {
    let generation = 1;
    jest.spyOn(accountScope, 'generation').mockImplementation(() => generation);
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const root = await renderVotable(poll());
    await ok(root, '2');
    await ok(root, '2');
    await answer(0, { status: 200, body: undefined });
    expect(sent()[1]).toEqual(['GET', E10_PATH, null]);
    generation = 2;
    // The new account votes on the same poll while the old request still runs.
    await ok(root, '1');
    await ok(root, '1');
    expect(sent()[2]).toEqual(['POST', VOTE_PATH, [['answer', '1']]]);
    await answer(1, e10(poll({ answer: ['2'] })));
    const cached = client.getQueryData<PostResult>(queryKeys.post(BLOG, POST));
    expect(cached?.kind === 'ok' && cached.post.poll?.answer).toEqual([]);
    expect(has(root, `${ID}/option/2/chosen`)).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('a late failure after an account switch shows no error', async () => {
    let generation = 1;
    jest.spyOn(accountScope, 'generation').mockImplementation(() => generation);
    const root = await renderVotable(poll());
    await ok(root, '2');
    await ok(root, '2');
    generation = 2;
    await answer(0, new AppError('Network'));
    expect(has(root, `${ID}/error`)).toBe(false);
  });

  it('matrix «E10 fails»: E11 200, E10 error → the post`s E8 query is invalidated; no error shown', async () => {
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const root = await renderVotable(poll());
    await ok(root, '2');
    await ok(root, '2');
    await answer(0, { status: 200, body: undefined });
    await answer(1, new AppError('Network'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.post(BLOG, POST) });
    expect(has(root, `${ID}/error`)).toBe(false);
    expect(has(root, `${ID}/option/2/sending`)).toBe(false);
    // The request is over: a new OK is accepted again (pending).
    await ok(root, '1');
    expect(pendingHint(root, '1')).toBe(t('poll.pendingVote'));
  });

  it.each([
    ['finished', { isFinished: true }],
    ['multiple choice (Story 6.7)', { isMultiple: true }],
  ])('matrix «Finished / multiple» (%s): one stop, OK inert, even with the vote props', async (_name, overrides) => {
    const root = await renderVotable(poll(overrides));
    expect(focusables(root)).toEqual([ID]);
    await act(async () => host(root).props.onClick?.(evt));
    expect(calls).toHaveLength(0);
  });

  it('the pending outline is drawn in the accent', async () => {
    const root = await renderVotable(poll());
    await ok(root, '3');
    const outline = root.container.queryAll(n => n.props.testID === `${ID}/option/3/outline`)[0];
    expect(outline).toBeDefined();
    expect(StyleSheet.flatten(outline.props.style).borderColor).toBe(colors.accent);
  });
});
