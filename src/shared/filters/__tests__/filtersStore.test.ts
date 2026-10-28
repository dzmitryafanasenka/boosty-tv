import {
  ACCESS_VALUES,
  DEFAULT_FILTER,
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
    expect(DEFAULT_FILTER).toEqual({ access: 'allowed' });
    expect(Object.isFrozen(DEFAULT_FILTER)).toBe(true);
    expect(ACCESS_VALUES).toEqual(['allowed', 'all', 'bought']);
  });

  it('counts a non-default access as one active filter', () => {
    expect(activeFilterCount({ access: 'allowed' })).toBe(0);
    expect(activeFilterCount({ access: 'all' })).toBe(1);
    expect(activeFilterCount({ access: 'bought' })).toBe(1);
    expect(isDefaultFilter({ access: 'allowed' })).toBe(true);
    expect(isDefaultFilter({ access: 'bought' })).toBe(false);
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
    expect(getFilter('feed')).toEqual({ access: 'all' });
    expect(listener).toHaveBeenCalledTimes(1);
    const before = getFilter('feed');
    filtersStore.getState().setAccess('feed', 'all');
    expect(getFilter('feed')).toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
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
    expect(filtersStore.getState().filters).toEqual({ feed: { access: 'all' } });
  });

  it('the account-scoped store (AD-4) wipes every scope', async () => {
    expect(filtersAccountStore.name).toBe('filters');
    filtersStore.getState().setAccess('feed', 'bought');
    await filtersAccountStore.reset();
    expect(getFilter('feed')).toBe(DEFAULT_FILTER);
  });
});
