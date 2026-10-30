import { liveFocusRole, liveReturnTarget, type LiveBlockShown } from '../liveReturnTarget';

const ALL: LiveBlockShown = { card: true, like: true, share: true, grid: true };
const NONE: LiveBlockShown = { card: false, like: false, share: false, grid: false };

describe('liveFocusRole', () => {
  const ids = { liveId: 'live', likeId: 'like', shareId: 'share' };
  test('maps the live block ids to their role, anything else to null', () => {
    expect(liveFocusRole('live', ids)).toBe('live');
    expect(liveFocusRole('like', ids)).toBe('like');
    expect(liveFocusRole('share', ids)).toBe('share');
    expect(liveFocusRole('author/card/1', ids)).toBeNull();
    expect(liveFocusRole(null, ids)).toBeNull();
  });
});

describe('liveReturnTarget', () => {
  test("not on the live block: null (the caller's own fallback)", () => {
    expect(liveReturnTarget(null, ALL)).toBeNull();
  });

  test('branch 1: the card while shown', () => {
    expect(liveReturnTarget('live', ALL)).toBe('live');
    expect(liveReturnTarget('live', { ...NONE, card: true })).toBe('live');
  });

  test('branch 2: «Нравится» / «Поделиться» while still shown', () => {
    expect(liveReturnTarget('like', ALL)).toBe('like');
    expect(liveReturnTarget('share', ALL)).toBe('share');
    expect(liveReturnTarget('share', { ...NONE, share: true })).toBe('share');
  });

  test('branch 3: «Нравится» gone, «Поделиться» shown → «Поделиться»', () => {
    expect(liveReturnTarget('like', { ...ALL, like: false })).toBe('share');
    expect(liveReturnTarget('like', { ...NONE, share: true })).toBe('share');
  });

  test('branch 4: «Нравится» / «Поделиться» gone, the card shown → the card', () => {
    expect(liveReturnTarget('like', { ...NONE, card: true, grid: true })).toBe('live');
    expect(liveReturnTarget('share', { ...NONE, card: true, grid: true })).toBe('live');
  });

  test('branch 5: everything gone with the grid shown → the first post', () => {
    const grid = { ...NONE, grid: true };
    expect(liveReturnTarget('live', grid)).toBe('firstPost');
    expect(liveReturnTarget('like', grid)).toBe('firstPost');
    expect(liveReturnTarget('share', grid)).toBe('firstPost');
    // The card gone, but its buttons still mounted (never together): the card's id still goes to the grid.
    expect(liveReturnTarget('live', { ...ALL, card: false })).toBe('firstPost');
  });

  test('everything gone without the grid: null (branches 6–7 stay with the caller)', () => {
    expect(liveReturnTarget('live', NONE)).toBeNull();
    expect(liveReturnTarget('like', NONE)).toBeNull();
    expect(liveReturnTarget('share', NONE)).toBeNull();
  });

  test('like loss (the card stays, «Поделиться» with it) → «Поделиться»; card loss → the first post, never the card', () => {
    expect(liveReturnTarget('like', { card: true, like: false, share: true, grid: false })).toBe('share');
    expect(liveReturnTarget('like', { card: false, like: false, share: false, grid: false })).toBeNull();
    for (const role of ['live', 'like', 'share'] as const) {
      expect(liveReturnTarget(role, { card: false, like: false, share: false, grid: true })).toBe('firstPost');
    }
  });
});
