import {
  DEFAULT_FILTER,
  NO_TAGS,
  activeFilterCount,
  filtersStore,
  getFilter,
  isDefaultFilter,
  tagIdsKey,
  type Filter,
} from '..';

const A = { id: '12', title: 'Выпечка' };
const B = { id: '3', title: 'Супы' };
const ALL_TIME = { kind: 'all' } as const;

afterEach(() => {
  filtersStore.getState().clear();
});

describe('Filter tags (Story 5.5)', () => {
  it('the default has no tags (one frozen array)', () => {
    expect(DEFAULT_FILTER.tags).toBe(NO_TAGS);
    expect(Object.isFrozen(NO_TAGS)).toBe(true);
    expect(NO_TAGS).toEqual([]);
  });

  it('tagIdsKey: the ids, deduped and sorted; titles left out', () => {
    const filter: Filter = { access: 'allowed', period: ALL_TIME, tags: [A, B, { ...A, title: 'x' }] };
    expect(tagIdsKey(filter)).toEqual(['12', '3']);
    expect(tagIdsKey({ ...filter, tags: [B, A] })).toEqual(tagIdsKey({ ...filter, tags: [A, B] }));
    expect(tagIdsKey(DEFAULT_FILTER)).toEqual([]);
  });

  it('the tag section counts once, however many tags are checked', () => {
    expect(activeFilterCount({ access: 'allowed', period: ALL_TIME, tags: [A] })).toBe(1);
    expect(activeFilterCount({ access: 'allowed', period: ALL_TIME, tags: [A, B] })).toBe(1);
    expect(activeFilterCount({ access: 'all', period: { kind: 'preset', days: 7 }, tags: [A, B] })).toBe(3);
    expect(isDefaultFilter({ access: 'allowed', period: ALL_TIME, tags: [A] })).toBe(false);
    expect(isDefaultFilter({ access: 'allowed', period: ALL_TIME, tags: [] })).toBe(true);
  });
});

describe('filtersStore tags (Story 5.5)', () => {
  it('toggleTag checks in selection order and unchecks by id', () => {
    const store = filtersStore.getState();
    store.toggleTag('feed', A);
    store.toggleTag('feed', B);
    expect(getFilter('feed').tags).toEqual([A, B]);
    store.toggleTag('feed', { id: A.id, title: 'renamed' });
    expect(getFilter('feed').tags).toEqual([B]);
    store.toggleTag('feed', B);
    expect(getFilter('feed').tags).toBe(NO_TAGS);
    expect(isDefaultFilter(getFilter('feed'))).toBe(true);
  });

  it('toggleTag keeps access and period', () => {
    const store = filtersStore.getState();
    store.setAccess('feed', 'all');
    store.setPeriod('feed', { kind: 'preset', days: 30 });
    store.toggleTag('feed', A);
    expect(getFilter('feed')).toEqual({ access: 'all', period: { kind: 'preset', days: 30 }, tags: [A] });
  });

  it('clearTags clears the tags only; with no tag it changes nothing', () => {
    const store = filtersStore.getState();
    const listener = jest.fn();
    const unsubscribe = filtersStore.subscribe(listener);
    store.clearTags('feed');
    expect(listener).not.toHaveBeenCalled();
    store.setAccess('feed', 'bought');
    store.toggleTag('feed', A);
    store.toggleTag('feed', B);
    listener.mockClear();
    store.clearTags('feed');
    expect(getFilter('feed')).toEqual({ access: 'bought', period: ALL_TIME, tags: [] });
    expect(listener).toHaveBeenCalledTimes(1);
    const before = getFilter('feed');
    store.clearTags('feed');
    expect(getFilter('feed')).toBe(before);
    unsubscribe();
  });

  it('reset clears the tags with every other section', () => {
    const store = filtersStore.getState();
    store.setAccess('feed', 'all');
    store.toggleTag('feed', A);
    store.reset('feed');
    expect(getFilter('feed')).toBe(DEFAULT_FILTER);
  });
});
