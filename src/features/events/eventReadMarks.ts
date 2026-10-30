import { createStore, useStore } from 'zustand';
import { defineAccountScoped } from '../../shared/account';

type EventReadMarksState = {
  /** Event ids marked read on this device during this app run (OK on a row). */
  readonly ids: ReadonlySet<string>;
  mark(id: string): void;
  clear(): void;
};

/**
 * События' local read marks (Story 7.5): OK on a row marks it read for this
 * app run only, as in the design prototype. Nothing is sent to Boosty (no
 * read mutation exists, api-contract E18), nothing is persisted, and a
 * refetch keeps the marks (the server still reports the event unread).
 * Account-scoped: wiped on sign-out and account switch
 * (`eventReadMarksAccountStore`), so no mark leaks to another account.
 */
export const eventReadMarksStore = createStore<EventReadMarksState>()(set => ({
  ids: new Set<string>(),
  mark: id =>
    set(state => (state.ids.has(id) ? state : { ids: new Set([...state.ids, id]) })),
  clear: () => set({ ids: new Set<string>() }),
}));

/** The ids marked read locally. */
export function useEventReadMarks(): ReadonlySet<string> {
  return useStore(eventReadMarksStore, state => state.ids);
}

/** AD-4: sign-out and an account switch forget the marks. */
export const eventReadMarksAccountStore = defineAccountScoped('eventReadMarks', () =>
  eventReadMarksStore.getState().clear(),
);
