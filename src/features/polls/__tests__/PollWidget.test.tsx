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

  it('a sign-out / account switch while E11 runs: its late 200 sends no E10 (Epic 6 retro A1)', async () => {
    let generation = 1;
    jest.spyOn(accountScope, 'generation').mockImplementation(() => generation);
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const root = await renderVotable(poll());
    await ok(root, '2');
    await ok(root, '2');
    generation = 2;
    await answer(0, { status: 200, body: undefined });
    expect(sent()).toEqual([['POST', VOTE_PATH, [['answer', '2']]]]);
    expect(invalidate).not.toHaveBeenCalled();
    // The old request is over: the new account's vote is sent at once.
    await ok(root, '1');
    await ok(root, '1');
    expect(sent()[1]).toEqual(['POST', VOTE_PATH, [['answer', '1']]]);
  });

  it('a sign-out / account switch while E10 runs: the post query of the new account is not cancelled (Epic 6 retro A1)', async () => {
    let generation = 1;
    jest.spyOn(accountScope, 'generation').mockImplementation(() => generation);
    const cancel = jest.spyOn(client, 'cancelQueries');
    const root = await renderVotable(poll());
    await ok(root, '2');
    await ok(root, '2');
    await answer(0, { status: 200, body: undefined });
    generation = 2;
    await answer(1, e10(poll({ answer: ['2'] })));
    expect(cancel).not.toHaveBeenCalled();
  });

  it('an E8 of the post started before the vote and landing after E10 does not undo the vote (Epic 6 retro A1)', async () => {
    const root = await renderVotable(poll());
    const e8 = deferred<PostResult>();
    // A fetch of the post's query (as the screen's refetch): the hook cancels
    // the query's running fetch, whoever started it (TanStack reverts it).
    const cancel = jest.spyOn(client, 'cancelQueries');
    const stale = client
      .fetchQuery({ queryKey: queryKeys.post(BLOG, POST), queryFn: () => e8.promise })
      .catch(() => undefined);
    await ok(root, '2');
    await ok(root, '2');
    await answer(0, { status: 200, body: undefined });
    await answer(1, e10(poll({ answer: ['2'] })));
    await act(async () => {
      e8.resolve({ kind: 'ok', post: { id: POST, poll: poll() } as unknown as Post });
      await stale;
      await flush();
    });
    const cached = client.getQueryData<PostResult>(queryKeys.post(BLOG, POST));
    expect(cancel).toHaveBeenCalledWith({ queryKey: queryKeys.post(BLOG, POST), exact: true });
    expect(cached?.kind === 'ok' && cached.post.poll?.answer).toEqual(['2']);
    expect(has(root, `${ID}/option/2/chosen`)).toBe(true);
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

/**
 * Story 6.7: an open multiple-choice poll (focus-map §4 I «Poll, multiple
 * choice»), every row of the spec's matrix. As «Story 6.6»: the poll is read
 * from a seeded E8 query, so E10 through `applyPoll` shows on screen, and the
 * HttpClient is a fake the test answers.
 */
describe('Story 6.7: multiple-choice poll', () => {
  const BLOG = 'synthetic-blog';
  const POST = 'p';
  const PREFIX = `post/${POST}/poll/option/`;
  const OPT = (optionId: string) => `${PREFIX}${optionId}`;
  const SUBMIT = `post/${POST}/poll/submit`;
  const RETRACT = `post/${POST}/poll/retract`;
  const VOTE_PATH = '/v1/poll/9/vote';
  const E10_PATH = `/v1/blog/${BLOG}/poll/9`;
  const evt = { nativeEvent: {} };

  type Pending = { request: HttpRequest<unknown>; d: ReturnType<typeof deferred<HttpResponse<unknown>>> };

  let client: QueryClient;
  let calls: Pending[];
  let http: HttpClient;
  /** The host views reported by focus id, and the focus ids reported (the screen's view). */
  let onViewSpy: jest.Mock;
  let onFocusSpy: jest.Mock;

  beforeAll(() => {
    jest.useFakeTimers();
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
    onViewSpy = jest.fn();
    onFocusSpy = jest.fn();
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

  const multi = (overrides: Partial<Poll> = {}) => poll({ isMultiple: true, ...overrides });

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
        onView={onViewSpy}
        onFocus={onFocusSpy}
        http={http}
        blogUrl={BLOG}
        postId={POST}
        optionIdPrefix={PREFIX}
        submitId={SUBMIT}
        retractId={RETRACT}
      />
    ) : null;
  }

  const seed = (p: Poll) =>
    client.setQueryData(queryKeys.post(BLOG, POST), { kind: 'ok', post: { id: POST, poll: p } as unknown as Post });

  async function renderMulti(p: Poll, twice = false) {
    seed(p);
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

  /** The node with this testID (the focusable one when `focusable`). */
  const node = (root: Root, testID: string, nth = 0) =>
    root.container.queryAll(n => n.props.testID === testID && n.props.accessibilityRole !== undefined)[nth];
  const ok = async (root: Root, testID: string, nth = 0) => {
    await act(async () => {
      node(root, testID, nth).props.onFocus(evt);
      node(root, testID, nth).props.onClick?.(evt);
    });
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
  const checked = (root: Root) =>
    ['1', '2', '3'].filter(optionId => has(root, `${ID}/option/${optionId}/checked`));
  const chosenMarks = (root: Root) =>
    ['1', '2', '3'].filter(optionId => has(root, `${ID}/option/${optionId}/chosen`));
  const voted13 = multi({
    counter: 2522,
    answer: ['1', '3'],
    options: [
      { id: '1', text: 'Длинные', counter: 1211, fraction: 48 },
      { id: '2', text: 'Короткие', counter: 958, fraction: 38 },
      { id: '3', text: 'Эфиры', counter: 354, fraction: 14 },
    ],
  });

  it('not voted: each option a checkbox stop (ring, no scale); «Проголосовать» shown disabled and not focusable (matrix «Submit disabled»)', async () => {
    const root = await renderMulti(multi());
    expect(focusables(root)).toEqual([OPT('1'), OPT('2'), OPT('3')]);
    expect(root.container.queryAll(n => n.props.testID === ID)[0].props.focusable).toBe(false);
    const submit = node(root, SUBMIT);
    expect(submit.props.focusable).toBe(false);
    expect(submit.props.accessibilityState).toMatchObject({ disabled: true });
    expect(text(root)).toContain(t('poll.submit'));
    const first = node(root, OPT('1'));
    expect(first.props.accessibilityRole).toBe('checkbox');
    expect(first.props.accessibilityState).toMatchObject({ checked: false });
    expect(first.props.accessibilityLabel).toBe(
      'Опрос. Какой формат удобнее? Длинные, 48 %, 1 210 голосов. не отмечено',
    );
    expect(node(root, OPT('3')).props.accessibilityLabel).toBe(
      'Эфиры, 14 %, 353 голоса. не отмечено. Затем выберите «Проголосовать» под вариантами. Проголосовали: 2 521',
    );
    // The submit hint is the last option's only (and only before the vote).
    expect(node(root, OPT('2')).props.accessibilityLabel).not.toContain(t('poll.submitHint'));
    // Results are visible before the vote; no answered check yet.
    expect(text(root)).toContain('48 % · 1 210');
    expect(chosenMarks(root)).toEqual([]);
    await act(async () => first.props.onFocus(evt));
    expect(has(root, `${OPT('1')}/ring`)).toBe(true);
    const scale = StyleSheet.flatten(root.container.queryAll(n => n.props.testID === `${OPT('1')}/scale`)[0].props.style);
    expect(scale.transform).toEqual([{ scale: 1 }]);
  });

  it('matrix «Toggle»: OK on 1, OK on 3, OK on 1 → only 3 checked (accent box, a11y «отмечено»); nothing sent, no pending step', async () => {
    const root = await renderMulti(multi());
    await ok(root, OPT('1'));
    expect(checked(root)).toEqual(['1']);
    expect(node(root, SUBMIT).props.focusable).toBe(true);
    await ok(root, OPT('3'));
    await ok(root, OPT('1'));
    expect(checked(root)).toEqual(['3']);
    expect(node(root, OPT('3')).props.accessibilityState).toMatchObject({ checked: true });
    expect(node(root, OPT('3')).props.accessibilityLabel).toContain('353 голоса. отмечено');
    expect(node(root, OPT('1')).props.accessibilityState).toMatchObject({ checked: false });
    const box = root.container.queryAll(n => n.props.testID === `${ID}/option/3/box`)[0];
    expect(StyleSheet.flatten(box.props.style).backgroundColor).toBe(colors.accent);
    const empty = root.container.queryAll(n => n.props.testID === `${ID}/option/1/box`)[0];
    expect(StyleSheet.flatten(empty.props.style).backgroundColor).toBeUndefined();
    expect(has(root, `${ID}/option/1/pending`)).toBe(false);
    expect(has(root, `${ID}/option/1/outline`)).toBe(false);
    expect(calls).toHaveLength(0);
    // Unchecking the last one disables «Проголосовать» again.
    await ok(root, OPT('3'));
    expect(checked(root)).toEqual([]);
    expect(node(root, SUBMIT).props.focusable).toBe(false);
  });

  it('matrix «Vote»: 1 and 3 checked (in any order); OK on «Проголосовать» → sending, E11 `answer=1,3`, then E10; results with the checks, «Отозвать голос» the only stop', async () => {
    const root = await renderMulti(multi());
    await ok(root, OPT('3'));
    await ok(root, OPT('1'));
    await ok(root, SUBMIT);
    // Comma-joined in option order, no extra confirmation.
    expect(sent()).toEqual([['POST', VOTE_PATH, [['answer', '1,3']]]]);
    expect(has(root, `${SUBMIT}/sending`)).toBe(true);
    expect(node(root, SUBMIT).props.accessibilityState).toMatchObject({ busy: true });
    expect(node(root, SUBMIT).props.accessibilityLabel).toBe('Проголосовать. Отправка');
    await answer(0, { status: 200, body: { ignored: true } });
    expect(sent()[1]).toEqual(['GET', E10_PATH, null]);
    const submitView = onViewSpy.mock.calls.filter(([fid, view]) => fid === SUBMIT && view !== null).pop()?.[1];
    expect(submitView).toBeDefined();
    onViewSpy.mockClear();
    onFocusSpy.mockClear();
    await answer(1, e10(voted13));
    expect(focusables(root)).toEqual([RETRACT]);
    expect(has(root, SUBMIT)).toBe(false);
    // Device fix: one action control, never unmounted. The focused host view
    // is re-registered under the new id and the tracked focus id follows it.
    expect(onViewSpy).toHaveBeenCalledWith(SUBMIT, null);
    expect(onViewSpy).toHaveBeenCalledWith(RETRACT, submitView);
    expect(onFocusSpy.mock.calls.map(([fid]) => fid)).toEqual([RETRACT]);
    expect(chosenMarks(root)).toEqual(['1', '3']);
    expect(checked(root)).toEqual([]);
    expect(text(root)).toContain('Проголосовали: 2 522');
    expect(text(root)).toContain(t('poll.retract'));
    const retract = node(root, RETRACT);
    expect(retract.props.accessibilityRole).toBe('button');
    expect(retract.props.accessibilityLabel).toMatch(/^Опрос\. Какой формат удобнее\? Длинные, 48 %, 1 211 голосов, ваш выбор\. /);
    expect(retract.props.accessibilityLabel).toMatch(/Проголосовали: 2 522\. Отозвать голос$/);
    expect(has(root, `${ID}/error`)).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('matrix «Vote fails»: inline error, the checks kept, 1 request; the next OK clears the error', async () => {
    const root = await renderMulti(multi());
    await ok(root, OPT('1'));
    await ok(root, OPT('3'));
    await ok(root, SUBMIT);
    await answer(0, new AppError('Server', 503));
    expect(calls).toHaveLength(1);
    const errorNode = root.container.queryAll(n => n.props.testID === `${ID}/error`)[0];
    expect(errorNode.props.children).toBe(t('poll.voteFailed'));
    expect(errorNode.props.accessibilityLiveRegion).toBe('polite');
    expect(checked(root)).toEqual(['1', '3']);
    expect(chosenMarks(root)).toEqual([]);
    expect(has(root, `${SUBMIT}/sending`)).toBe(false);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    // The next OK (here a toggle) clears the error.
    await ok(root, OPT('2'));
    expect(has(root, `${ID}/error`)).toBe(false);
    expect(checked(root)).toEqual(['1', '2', '3']);
    expect(calls).toHaveLength(1);
  });

  it('single flight: while the vote runs, toggles and more OKs on «Проголосовать» are ignored; a second widget of the poll too', async () => {
    const root = await renderMulti(multi(), true);
    await ok(root, OPT('1'));
    await ok(root, SUBMIT);
    expect(calls).toHaveLength(1);
    await ok(root, SUBMIT);
    await ok(root, OPT('2'));
    expect(checked(root)).toEqual(['1']);
    // The other instance shows the running request and ignores OK.
    expect(root.container.queryAll(n => n.props.testID === `${SUBMIT}/sending`)).toHaveLength(2);
    await ok(root, OPT('2'), 1);
    expect(root.container.queryAll(n => n.props.testID === `${ID}/option/2/checked`)).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it('matrix «Retract»: answer [1, 3]; OK → the pending outline and hint on the button; OK → E12, then E10; options without checks', async () => {
    const root = await renderMulti(voted13);
    expect(focusables(root)).toEqual([RETRACT]);
    await ok(root, RETRACT);
    expect(root.container.queryAll(n => n.props.testID === `${RETRACT}/pending`)[0].props.children).toBe(
      t('poll.pendingRetract'),
    );
    const outline = root.container.queryAll(n => n.props.testID === `${RETRACT}/outline`)[0];
    expect(StyleSheet.flatten(outline.props.style).borderColor).toBe(colors.accent);
    expect(node(root, RETRACT).props.accessibilityLabel).toMatch(/Отозвать голос\. Нажмите OK ещё раз, чтобы отозвать$/);
    expect(calls).toHaveLength(0);
    await ok(root, RETRACT);
    expect(sent()).toEqual([['DELETE', VOTE_PATH, null]]);
    expect(has(root, `${RETRACT}/sending`)).toBe(true);
    expect(has(root, `${RETRACT}/pending`)).toBe(false);
    await answer(0, { status: 200, body: undefined });
    expect(sent()[1]).toEqual(['GET', E10_PATH, null]);
    const actionView = onViewSpy.mock.calls.filter(([fid, view]) => fid === RETRACT && view !== null).pop()?.[1];
    await answer(1, e10(multi()));
    // Device fix: the focused control becomes «Проголосовать» (nothing checked)
    // but stays focusable (drawn disabled) while focus moves to the first option.
    expect(focusables(root)).toEqual([OPT('1'), OPT('2'), OPT('3'), SUBMIT]);
    expect(onViewSpy).toHaveBeenCalledWith(SUBMIT, actionView);
    // Drawn disabled and inert (OK sends nothing).
    const actionText = root.container
      .queryAll(n => n.props.children === t('poll.submit') && n.props.style !== undefined)
      .map(n => StyleSheet.flatten(n.props.style).color);
    expect(actionText).toContain(colors['text-disabled']);
    expect(actionText.every(color => color === colors['text-disabled'])).toBe(true);
    const surface = root.container.queryAll(n => n.props.testID === `${SUBMIT}/scale`)[0];
    expect(StyleSheet.flatten(surface.props.style).backgroundColor).toBe(colors['surface-raised']);
    await act(async () => node(root, SUBMIT).props.onClick?.(evt));
    expect(calls).toHaveLength(2);
    // The first option reports focus → the control turns non-focusable.
    await act(async () => {
      node(root, SUBMIT).props.onBlur(evt);
      node(root, OPT('1')).props.onFocus(evt);
    });
    expect(focusables(root)).toEqual([OPT('1'), OPT('2'), OPT('3')]);
    expect(chosenMarks(root)).toEqual([]);
    expect(checked(root)).toEqual([]);
    expect(has(root, RETRACT)).toBe(false);
  });

  it('matrix «Retract» failure: inline error «Не удалось отозвать голос», the vote kept', async () => {
    const root = await renderMulti(voted13);
    await ok(root, RETRACT);
    await ok(root, RETRACT);
    await answer(0, new AppError('Network'));
    expect(calls).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.testID === `${ID}/error`)[0].props.children).toBe(t('poll.retractFailed'));
    expect(chosenMarks(root)).toEqual(['1', '3']);
    expect(focusables(root)).toEqual([RETRACT]);
    // The next OK clears it and starts pending again.
    await ok(root, RETRACT);
    expect(has(root, `${ID}/error`)).toBe(false);
    expect(has(root, `${RETRACT}/pending`)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('matrix «Cancel retract»: OK on «Отозвать голос», then focus leaves (blur) → pending cleared; nothing sent', async () => {
    const root = await renderMulti(voted13);
    await ok(root, RETRACT);
    expect(has(root, `${RETRACT}/pending`)).toBe(true);
    await act(async () => node(root, RETRACT).props.onBlur(evt));
    expect(has(root, `${RETRACT}/pending`)).toBe(false);
    expect(has(root, `${RETRACT}/outline`)).toBe(false);
    expect(text(root)).toContain(t('poll.retract'));
    // The next OK is a first OK again.
    await ok(root, RETRACT);
    expect(has(root, `${RETRACT}/pending`)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('retract hand-off: without the first option`s focus, the requests stop after a bounded number of frames but the focused control stays focusable until it blurs', async () => {
    const root = await renderMulti(voted13);
    await ok(root, RETRACT);
    await ok(root, RETRACT);
    await answer(0, { status: 200, body: undefined });
    await answer(1, e10(multi()));
    expect(focusables(root)).toContain(SUBMIT);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    // Turning the focused control non-focusable would drop focus to the author (device).
    expect(focusables(root)).toEqual([OPT('1'), OPT('2'), OPT('3'), SUBMIT]);
    await act(async () => node(root, SUBMIT).props.onBlur(evt));
    expect(focusables(root)).toEqual([OPT('1'), OPT('2'), OPT('3')]);
  });

  it('the spinner follows any running request of the poll, also when the mode flipped meanwhile', async () => {
    const root = await renderMulti(multi());
    await ok(root, OPT('1'));
    await ok(root, SUBMIT);
    expect(calls).toHaveLength(1);
    // Another source (E8) shows the poll voted while the E11 still runs.
    await act(async () => seed(voted13));
    expect(has(root, `${RETRACT}/sending`)).toBe(true);
    expect(node(root, RETRACT).props.accessibilityState).toMatchObject({ busy: true });
  });

  it('a retract while the control is not focused: «Проголосовать» is non-focusable at once (no hand-off)', async () => {
    const root = await renderMulti(voted13);
    await ok(root, RETRACT);
    await ok(root, RETRACT);
    await act(async () => node(root, RETRACT).props.onBlur(evt));
    await answer(0, { status: 200, body: undefined });
    await answer(1, e10(multi()));
    expect(focusables(root)).toEqual([OPT('1'), OPT('2'), OPT('3')]);
  });

  it('a refetched poll without a checked option drops its check (it does not come back with the option)', async () => {
    const root = await renderMulti(multi());
    await ok(root, OPT('3'));
    expect(node(root, SUBMIT).props.focusable).toBe(true);
    const [one, two] = multi().options;
    await act(async () => seed(multi({ options: [one, two] })));
    expect(node(root, SUBMIT).props.focusable).toBe(false);
    await act(async () => seed(multi()));
    expect(checked(root)).toEqual([]);
  });

  it('matrix «Finished multi»: one inert stop (6.5), even with the vote props', async () => {
    const root = await renderMulti(multi({ isFinished: true, answer: ['1'] }));
    expect(focusables(root)).toEqual([ID]);
    await act(async () => host(root).props.onClick?.(evt));
    expect(calls).toHaveLength(0);
  });

  it('an open single-choice poll with the 6.7 ids keeps the 6.6 flow (option stops with the button role, no «Проголосовать»)', async () => {
    const root = await renderMulti(poll());
    expect(focusables(root)).toEqual([OPT('1'), OPT('2'), OPT('3')]);
    expect(node(root, OPT('1')).props.accessibilityRole).toBe('button');
    expect(has(root, SUBMIT)).toBe(false);
    await ok(root, OPT('2'));
    expect(has(root, `${ID}/option/2/pending`)).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
