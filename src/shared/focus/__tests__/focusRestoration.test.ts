import {
  MAIN_SECTION,
  createFocusRestoration,
  resolveRestoreTarget,
} from '../focusRestoration';

const ids = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `dev/list/${from + i}`);

describe('FocusRestoration store', () => {
  it('keeps one entry per route key + section', () => {
    const store = createFocusRestoration();
    store.remember('Shell-1', 'home', 'home/feed/1', 120, 0);
    store.remember('Shell-1', 'settings', 'settings/row/version', 0);
    store.remember('Post-9', MAIN_SECTION, 'post/9/primary', 0);

    expect(store.restore('Shell-1', 'home')).toEqual({
      focusId: 'home/feed/1',
      scrollOffset: 120,
      index: 0,
    });
    expect(store.restore('Shell-1', 'settings')).toEqual({
      focusId: 'settings/row/version',
      scrollOffset: 0,
    });
    expect(store.restore('Post-9', MAIN_SECTION)?.focusId).toBe('post/9/primary');
    expect(store.restore('Shell-1', 'search')).toBeUndefined();
    expect(store.restore('Shell-2', 'home')).toBeUndefined();
  });

  it('remember overwrites; restore does not consume a plain entry', () => {
    const store = createFocusRestoration();
    store.remember('A', 'main', 'x/1', 10, 0);
    store.remember('A', 'main', 'x/2', 20, 1);
    expect(store.restore('A', 'main')).toEqual({ focusId: 'x/2', scrollOffset: 20, index: 1 });
    expect(store.restore('A', 'main')).toEqual({ focusId: 'x/2', scrollOffset: 20, index: 1 });
  });

  it('sanitizes the offset and the index', () => {
    const store = createFocusRestoration();
    store.remember('A', 'main', 'x/1', Number.NaN, -1);
    expect(store.restore('A', 'main')).toEqual({ focusId: 'x/1', scrollOffset: 0 });
    store.remember('A', 'main', 'x/1', -5, 1.5);
    expect(store.restore('A', 'main')).toEqual({ focusId: 'x/1', scrollOffset: 0 });
  });

  it('setReturnFocus wins once, keeps the remembered scroll, and peek does not consume it', () => {
    const store = createFocusRestoration();
    store.remember('Post-9', 'main', 'post/9/video/a', 300, 2);
    store.setReturnFocus('Post-9', 'post/9/video/b');

    expect(store.peek('Post-9', 'main')).toEqual({ focusId: 'post/9/video/b', scrollOffset: 300 });
    expect(store.restore('Post-9', 'main')).toEqual({ focusId: 'post/9/video/b', scrollOffset: 300 });
    expect(store.restore('Post-9', 'main')).toEqual({
      focusId: 'post/9/video/a',
      scrollOffset: 300,
      index: 2,
    });
  });

  it('setReturnFocus without an entry restores with scroll 0', () => {
    const store = createFocusRestoration();
    store.setReturnFocus('Post-1', 'post/1/primary');
    expect(store.restore('Post-1', 'main')).toEqual({ focusId: 'post/1/primary', scrollOffset: 0 });
  });

  it('forget removes every section of one route; clear removes everything', () => {
    const store = createFocusRestoration();
    store.remember('Shell-1', 'home', 'a', 0);
    store.remember('Shell-1', 'settings', 'b', 0);
    store.remember('Shell-10', 'home', 'c', 0);
    store.setReturnFocus('Shell-1', 'd');
    store.forget('Shell-1');
    expect(store.restore('Shell-1', 'home')).toBeUndefined();
    expect(store.restore('Shell-1', 'settings')).toBeUndefined();
    expect(store.restore('Shell-10', 'home')?.focusId).toBe('c');

    store.setReturnFocus('Shell-10', 'e');
    store.clear();
    expect(store.restore('Shell-10', 'home')).toBeUndefined();
  });
});

describe('resolveRestoreTarget (fallback chain)', () => {
  it('nothing remembered → none', () => {
    expect(resolveRestoreTarget(undefined, ids(1, 3))).toEqual({ kind: 'none' });
  });

  it('the remembered id at its current index (found by id, not by the old index)', () => {
    const entry = { focusId: 'dev/list/150', scrollOffset: 0, index: 149 };
    expect(resolveRestoreTarget(entry, ids(1, 300))).toEqual({
      kind: 'item',
      id: 'dev/list/150',
      index: 149,
      fallback: 'none',
    });
    // Items were removed above it: same id, new index.
    expect(resolveRestoreTarget(entry, ids(11, 300))).toEqual({
      kind: 'item',
      id: 'dev/list/150',
      index: 139,
      fallback: 'none',
    });
  });

  it('removed → the neighbor by the remembered index', () => {
    const entry = { focusId: 'dev/list/150', scrollOffset: 0, index: 149 };
    const data = ids(1, 300).filter(id => id !== 'dev/list/150');
    expect(resolveRestoreTarget(entry, data)).toEqual({
      kind: 'item',
      id: 'dev/list/151',
      index: 149,
      fallback: 'neighbor',
    });
  });

  it('removed last item → the new last item', () => {
    const entry = { focusId: 'dev/list/300', scrollOffset: 0, index: 299 };
    expect(resolveRestoreTarget(entry, ids(1, 299))).toMatchObject({
      id: 'dev/list/299',
      index: 298,
      fallback: 'neighbor',
    });
  });

  it('removed and no index known → the first item of the zone', () => {
    expect(
      resolveRestoreTarget({ focusId: 'gone', scrollOffset: 0 }, ids(5, 7)),
    ).toEqual({ kind: 'item', id: 'dev/list/5', index: 0, fallback: 'first' });
  });

  it('empty list → the nearest action above', () => {
    expect(
      resolveRestoreTarget({ focusId: 'dev/list/1', scrollOffset: 0, index: 0 }, []),
    ).toEqual({ kind: 'above' });
  });
});
