import {
  pluralRu,
  selectRuPluralCategory,
  type RuPluralForms,
} from '../plural';

const LIKES: RuPluralForms = ['лайк', 'лайка', 'лайков'];

describe('pluralRu', () => {
  it.each([
    [0, 'лайков'],
    [1, 'лайк'],
    [2, 'лайка'],
    [5, 'лайков'],
    [11, 'лайков'],
    [21, 'лайк'],
    [22, 'лайка'],
    [25, 'лайков'],
    [111, 'лайков'],
  ])('%i -> %s', (n, expected) => {
    expect(pluralRu(n, LIKES)).toBe(expected);
  });

  it.each([
    [12, 'many'],
    [13, 'many'],
    [14, 'many'],
    [101, 'one'],
    [104, 'few'],
    [112, 'many'],
    [1001, 'one'],
  ] as const)('category of %i is %s', (n, expected) => {
    expect(selectRuPluralCategory(n)).toBe(expected);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws on %p',
    n => {
      expect(() => pluralRu(n, LIKES)).toThrow(RangeError);
    },
  );
});
