import { createStore, useStore } from 'zustand';
import { defineAccountScoped } from '../../shared/account';

type SearchQueryState = {
  /**
   * The last submitted query, trimmed and non-empty; null: none (the hint).
   * Never the field's draft text.
   */
  readonly query: string | null;
  /** «Готово» with a non-empty trimmed query. */
  submit(query: string): void;
  /** «Готово» on a blank field, AccountScope: back to the hint. */
  clear(): void;
};

/**
 * The submitted «Поиск по подпискам» query (Story 5.6, owner decision
 * 2026-10-29 Q1 a): in memory only (never persisted across a restart, never
 * logged) and account-scoped: wiped on sign-out and account switch
 * (`searchQueryAccountStore`), kept across a same-account re-login. Leaving
 * Поиск through the sidebar and coming back shows the same query and its
 * cached results. Zustand (as `filtersStore`) because it outlives the
 * screen, which unmounts on a section switch.
 */
export const searchQueryStore = createStore<SearchQueryState>()(set => ({
  query: null,
  submit: query => set({ query }),
  clear: () => set({ query: null }),
}));

/** The submitted query; null: none. */
export function useSubmittedQuery(): string | null {
  return useStore(searchQueryStore, state => state.query);
}

/** AD-4: sign-out and an account switch forget the query. */
export const searchQueryAccountStore = defineAccountScoped('searchQuery', () =>
  searchQueryStore.getState().clear(),
);
