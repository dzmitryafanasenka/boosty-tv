// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { e8Accessible } from '../../../../test/postFixtures';
import { isChosen, mapPoll, pollBarPercent, pollPercent } from '../mapPoll';

/** The live key set (api-contract §4.2 «Polls (LIVE)»), synthetic values. */
const option = (id: number, counter: number, fraction: number) => ({
  counter,
  fraction,
  id,
  text: `Option ${id}`,
  voters: { data: {}, extra: {} },
});
const rawPoll = (overrides: Record<string, unknown> = {}) => ({
  counter: 10,
  defaultLang: 'ru',
  hasOther: false,
  id: 7,
  isFinished: false,
  isMultiple: false,
  options: [option(1, 6, 60), option(2, 3, 30), option(3, 1, 10)],
  title: ['Question'],
  ...overrides,
});

describe('mapPoll (Story 6.5)', () => {
  it('maps the live shape: string ids, the joined title, counters, fractions; no `answer` → none chosen', () => {
    expect(mapPoll(rawPoll())).toEqual({
      id: '7',
      title: 'Question',
      isMultiple: false,
      isFinished: false,
      counter: 10,
      answer: [],
      options: [
        { id: '1', text: 'Option 1', counter: 6, fraction: 60 },
        { id: '2', text: 'Option 2', counter: 3, fraction: 30 },
        { id: '3', text: 'Option 3', counter: 1, fraction: 10 },
      ],
    });
  });

  it('maps the fixture poll (live-sanitized)', () => {
    const poll = mapPoll(e8Accessible().poll);
    expect(poll?.id).toBe('1020');
    expect(poll?.options.map(o => o.id)).toEqual(['1021', '1022']);
    expect(poll?.answer).toEqual([]);
  });

  it('joins a multi-part title with «, » (the reference) and skips non-strings', () => {
    expect(mapPoll(rawPoll({ title: ['A', 5, 'B', null] }))?.title).toBe('A, B');
    expect(mapPoll(rawPoll({ title: undefined }))?.title).toBe('');
    expect(mapPoll(rawPoll({ title: 'not an array' }))?.title).toBe('');
  });

  it('`answer`: the chosen option ids as strings (numbers or strings), others dropped', () => {
    const poll = mapPoll(rawPoll({ answer: [2, '3', null, {}] }));
    expect(poll?.answer).toEqual(['2', '3']);
    expect(poll && isChosen(poll, '2')).toBe(true);
    expect(poll && isChosen(poll, '1')).toBe(false);
  });

  it('string ids are kept as they are', () => {
    const poll = mapPoll(rawPoll({ id: 'p-1', options: [{ ...option(1, 1, 100), id: 'o-1' }] }));
    expect(poll?.id).toBe('p-1');
    expect(poll?.options[0].id).toBe('o-1');
  });

  it('a missing or malformed `counter` is 0 (the reference default); missing option text is empty', () => {
    expect(mapPoll(rawPoll({ counter: undefined }))?.counter).toBe(0);
    expect(mapPoll(rawPoll({ counter: 'x' }))?.counter).toBe(0);
    const noText: Record<string, unknown> = option(1, 1, 100);
    delete noText.text;
    expect(mapPoll(rawPoll({ options: [noText] }))?.options[0].text).toBe('');
  });

  it.each([
    ['no id', { id: undefined }],
    ['an empty id', { id: '' }],
    ['no isMultiple', { isMultiple: undefined }],
    ['no isFinished', { isFinished: undefined }],
    ['a non-boolean isFinished', { isFinished: 'yes' }],
    ['no options', { options: undefined }],
    ['empty options', { options: [] }],
    ['only an option without fraction', { options: [{ id: 2, counter: 1, text: 'x' }] }],
    ['only an option without counter', { options: [{ id: 2, fraction: 1, text: 'x' }] }],
    ['only an option without id', { options: [{ counter: 1, fraction: 1, text: 'x' }] }],
    ['only options that are not objects', { options: ['x', null, 5] }],
    ['every option invalid', { options: [{ id: 1, counter: 1 }, { id: 2, fraction: 'x', counter: 1 }, 'x'] }],
  ])('drops a poll with %s (the placeholder), never throws', (_name, overrides) => {
    expect(mapPoll(rawPoll(overrides))).toBeNull();
  });

  it('drops one bad option on its own (owner decision, option a): the rest of the poll is shown', () => {
    for (const bad of [
      { id: 2, counter: 1, text: 'x' },
      { id: 2, fraction: 1, text: 'x' },
      { counter: 1, fraction: 1, text: 'x' },
      { id: 2, counter: 1, fraction: Number.NaN },
      'x',
      null,
    ]) {
      const poll = mapPoll(rawPoll({ options: [option(1, 6, 60), bad, option(3, 1, 10)] }));
      expect(poll?.options.map(o => o.id)).toEqual(['1', '3']);
      expect(poll?.counter).toBe(10);
    }
  });

  it('duplicate option ids (1 and "1" alike): the first occurrence kept; `answer` deduplicated', () => {
    const poll = mapPoll(
      rawPoll({
        answer: [1, '1'],
        options: [option(1, 6, 60), { ...option(2, 3, 30), id: '1' }, option(3, 1, 10), option(3, 0, 0)],
      }),
    );
    expect(poll?.options.map(o => [o.id, o.counter])).toEqual([
      ['1', 6],
      ['3', 1],
    ]);
    expect(poll?.answer).toEqual(['1']);
  });

  it('a non-finite numeric id: the poll or the option is not usable', () => {
    expect(mapPoll(rawPoll({ id: Number.POSITIVE_INFINITY }))).toBeNull();
    expect(mapPoll(rawPoll({ id: Number.NaN }))).toBeNull();
    const poll = mapPoll(rawPoll({ options: [{ ...option(1, 1, 50), id: Number.NaN }, option(2, 1, 50)] }));
    expect(poll?.options.map(o => o.id)).toEqual(['2']);
  });

  it.each([
    ['negative', -3],
    ['fractional', 2.5],
    ['NaN', Number.NaN],
    ['a string', '7'],
  ])('a %s top-level `counter` is 0', (_name, counter) => {
    expect(mapPoll(rawPoll({ counter }))?.counter).toBe(0);
  });

  it.each([null, undefined, 'poll', 5, [], {}])('drops %p', raw => {
    expect(mapPoll(raw)).toBeNull();
  });
});

describe('poll percent and bar (Story 6.5)', () => {
  it('percent text: the fraction rounded to an integer', () => {
    expect(pollPercent(38)).toBe(38);
    expect(pollPercent(33.4)).toBe(33);
    expect(pollPercent(66.5)).toBe(67);
    expect(pollPercent(Number.NaN)).toBe(0);
  });

  it('bar width: the fraction clamped to 0…100', () => {
    expect(pollBarPercent(0)).toBe(0);
    expect(pollBarPercent(42.5)).toBe(42.5);
    expect(pollBarPercent(100)).toBe(100);
    expect(pollBarPercent(140)).toBe(100);
    expect(pollBarPercent(-5)).toBe(0);
    expect(pollBarPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
