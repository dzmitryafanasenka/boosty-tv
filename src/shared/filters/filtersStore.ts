import { createStore, useStore } from 'zustand';
import { defineAccountScoped } from '../account/defineAccountScoped';
import {
  DEFAULT_FILTER,
  periodEquals,
  type AccessFilter,
  type Filter,
  type FilterScope,
  type Period,
} from './filter';

type FiltersState = {
  /** One Filter per scope; a missing scope is the default Filter. */
  readonly filters: Readonly<Partial<Record<FilterScope, Filter>>>;
  setAccess(scope: FilterScope, access: AccessFilter): void;
  /** The scope's period (Story 5.4); the same period changes nothing. */
  setPeriod(scope: FilterScope, period: Period): void;
  /** Back to the default Filter for that scope. */
  reset(scope: FilterScope): void;
  /** Every scope back to the default (AccountScope). */
  clear(): void;
};

/**
 * The one filters store (AD-18, Stories 5.3–5.4): a Filter per scope, in memory
 * only (never persisted across a restart) and account-scoped: wiped on
 * sign-out and account switch (`filtersAccountStore`), kept across a
 * same-account re-login. Zustand (ARCHITECTURE-SPINE) because the filter
 * sheet lives in the modal host, outside the screen that reads the Filter.
 */
export const filtersStore = createStore<FiltersState>()(set => ({
  filters: {},
  setAccess: (scope, access) =>
    set(state => {
      const current = state.filters[scope] ?? DEFAULT_FILTER;
      if (current.access === access) {
        return state;
      }
      return { filters: { ...state.filters, [scope]: { ...current, access } } };
    }),
  setPeriod: (scope, period) =>
    set(state => {
      const current = state.filters[scope] ?? DEFAULT_FILTER;
      if (periodEquals(current.period, period)) {
        return state;
      }
      return { filters: { ...state.filters, [scope]: { ...current, period } } };
    }),
  reset: scope =>
    set(state => {
      if (state.filters[scope] === undefined) {
        return state;
      }
      const filters = { ...state.filters };
      delete filters[scope];
      return { filters };
    }),
  clear: () => set({ filters: {} }),
}));

/** The scope's current Filter (outside React, e.g. the resume refresh). */
export function getFilter(scope: FilterScope): Filter {
  return filtersStore.getState().filters[scope] ?? DEFAULT_FILTER;
}

/** The scope's current Filter; re-renders only when that scope changes. */
export function useFilter(scope: FilterScope): Filter {
  return useStore(filtersStore, state => state.filters[scope] ?? DEFAULT_FILTER);
}

/** AD-4: sign-out and an account switch reset every scope to the default. */
export const filtersAccountStore = defineAccountScoped('filters', () =>
  filtersStore.getState().clear(),
);
