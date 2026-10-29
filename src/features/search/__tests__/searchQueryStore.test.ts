import { searchQueryAccountStore, searchQueryStore } from '../searchQueryStore';

afterEach(() => {
  searchQueryStore.getState().clear();
});

describe('searchQueryStore (Story 5.6, owner decision Q1 a)', () => {
  it('starts with no query; submit stores it; clear forgets it', () => {
    expect(searchQueryStore.getState().query).toBeNull();
    searchQueryStore.getState().submit('капуста');
    expect(searchQueryStore.getState().query).toBe('капуста');
    searchQueryStore.getState().clear();
    expect(searchQueryStore.getState().query).toBeNull();
  });

  it('is account-scoped: the AccountScope reset wipes it', async () => {
    searchQueryStore.getState().submit('капуста');
    expect(searchQueryAccountStore.name).toBe('searchQuery');
    await searchQueryAccountStore.reset();
    expect(searchQueryStore.getState().query).toBeNull();
  });

  it('is in memory only: nothing persists it', () => {
    // The store has no persist middleware: its API is the plain Zustand one.
    expect('persist' in searchQueryStore).toBe(false);
  });
});
