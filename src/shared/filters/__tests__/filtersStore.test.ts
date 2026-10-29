import {
  ACCESS_VALUES,
  DEFAULT_FILTER,
  accessValuesFor,
  authorFilterScope,
  isAuthorScope,
  activeFilterCount,
  filtersAccountStore,
  filtersStore,
  getFilter,
  isDefaultFilter,
} from '..';

afterEach(() => {
  filtersStore.getState().clear();
});

describe('Filter model (AD-18, Story 5.3)', () => {
  it('the default is «Доступные мне» (owner decision 2026-10-28)', () => {
    expect(DEFAULT_FILTER).toEqual({ access: 'allowed', period: { kind: 'all' }, tags: [] });
    expect(Object.isFrozen(DEFAULT_FILTER)).toBe(true);
    expect(ACCESS_VALUES).toEqual(['allowed', 'all', 'bought']);
  });

  it('counts a non-default access as one active filter', () => {
    const all = { kind: 'all' } as const;
    expect(activeFilterCount({ access: 'allowed', period: all, tags: [] })).toBe(0);
    expect(activeFilterCount({ access: 'all', period: all, tags: [] })).toBe(1);
    expect(activeFilterCount({ access: 'bought', period: all, tags: [] })).toBe(1);
    expect(isDefaultFilter({ access: 'allowed', period: all, tags: [] })).toBe(true);
    expect(isDefaultFilter({ access: 'bought', period: all, tags: [] })).toBe(false);
  });
});

describe('filtersStore', () => {
  it('a scope without a Filter reads the default (the same object)', () => {
    expect(getFilter('feed')).toBe(DEFAULT_FILTER);
  });

  it('setAccess changes the scope; the same value changes nothing', () => {
    const listener = jest.fn();
    const unsubscribe = filtersStore.subscribe(listener);
    filtersStore.getState().setAccess('feed', 'all');
    expect(getFilter('feed')).toEqual({ access: 'all', period: { kind: 'all' }, tags: [] });
    expect(listener).toHaveBeenCalledTimes(1);
    const before = getFilter('feed');
    filtersStore.getState().setAccess('feed', 'all');
    expect(getFilter('feed')).toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('setPeriod (Story 5.4) changes the period, keeps the access; the same period changes nothing', () => {
    const listener = jest.fn();
    const unsubscribe = filtersStore.subscribe(listener);
    filtersStore.getState().setAccess('feed', 'all');
    filtersStore.getState().setPeriod('feed', { kind: 'preset', days: 7 });
    expect(getFilter('feed')).toEqual({ access: 'all', period: { kind: 'preset', days: 7 }, tags: [] });
    expect(listener).toHaveBeenCalledTimes(2);
    const before = getFilter('feed');
    filtersStore.getState().setPeriod('feed', { kind: 'preset', days: 7 });
    expect(getFilter('feed')).toBe(before);
    filtersStore.getState().setPeriod('feed', { kind: 'custom', fromDay: '2026-08-01', toDay: '2026-09-25' });
    filtersStore.getState().setPeriod('feed', { kind: 'custom', fromDay: '2026-08-01', toDay: '2026-09-25' });
    expect(listener).toHaveBeenCalledTimes(3);
    // setAccess keeps the period.
    filtersStore.getState().setAccess('feed', 'bought');
    expect(getFilter('feed').period).toEqual({ kind: 'custom', fromDay: '2026-08-01', toDay: '2026-09-25' });
    unsubscribe();
  });

  it('reset clears the access and the period sections together', () => {
    filtersStore.getState().setAccess('feed', 'all');
    filtersStore.getState().setPeriod('feed', { kind: 'preset', days: 30 });
    filtersStore.getState().reset('feed');
    expect(getFilter('feed')).toBe(DEFAULT_FILTER);
  });

  it('reset brings the scope back to the default; a reset of the default changes nothing', () => {
    filtersStore.getState().setAccess('feed', 'bought');
    filtersStore.getState().reset('feed');
    expect(getFilter('feed')).toBe(DEFAULT_FILTER);
    const state = filtersStore.getState();
    filtersStore.getState().reset('feed');
    expect(filtersStore.getState()).toBe(state);
  });

  it('is in memory only: nothing is persisted (no storage module is used)', () => {
    filtersStore.getState().setAccess('feed', 'all');
    expect(filtersStore.getState().filters).toEqual({ feed: { access: 'all', period: { kind: 'all' }, tags: [] } });
  });

  it('the account-scoped store (AD-4) wipes every scope', async () => {
    expect(filtersAccountStore.name).toBe('filters');
    filtersStore.getState().setAccess('feed', 'bought');
    await filtersAccountStore.reset();
    expect(getFilter('feed')).toBe(DEFAULT_FILTER);
  });
});

describe('Story 5.7: the Author scope', () => {
  it('one scope per Author route; access values without «Только купленные»; reset drops the scope only', () => {
    const a = authorFilterScope('route-a');
    const b = authorFilterScope('route-b');
    expect(a).toBe('author:route-a');
    expect(isAuthorScope(a)).toBe(true);
    expect(isAuthorScope('feed')).toBe(false);
    expect(accessValuesFor(a)).toEqual(['allowed', 'all']);
    expect(accessValuesFor('feed')).toEqual(ACCESS_VALUES);
    expect(accessValuesFor('search')).toEqual(ACCESS_VALUES);
    filtersStore.getState().setAccess(a, 'all');
    filtersStore.getState().setAccess('feed', 'bought');
    expect(getFilter(a).access).toBe('all');
    expect(getFilter(b)).toBe(DEFAULT_FILTER);
    filtersStore.getState().reset(a);
    expect(filtersStore.getState().filters[a]).toBeUndefined();
    expect(getFilter('feed').access).toBe('bought');
  });

  it('the account wipe clears the Author scopes too', () => {
    filtersStore.getState().setAccess(authorFilterScope('r'), 'all');
    filtersStore.getState().clear();
    expect(filtersStore.getState().filters).toEqual({});
  });
});
