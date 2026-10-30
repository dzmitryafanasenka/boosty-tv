import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../shared/api';
import type { Filter } from '../../shared/filters';
import {
  MAIN_SECTION,
  focusRestoration,
  useLatestRef,
  type ListRestoration,
  type OutcomeFocus,
} from '../../shared/focus';
import { submitBlogSearch } from './useBlogSearch';

export type AuthorSearchOptions = {
  client: QueryClient;
  blogUrl: string;
  /** FocusRestoration route key. */
  routeKey: string;
  /** The field's focus id. */
  fieldId: string;
  /** The route's effective Filter (read by «Готово»). */
  filter: Filter;
  focusField: () => void;
  /** The field holds the page's own focus; typing and «Готово» make it the user's. */
  fieldAuto: RefObject<boolean>;
  /** The route's Back hook (see `AuthorScreenProps.backHandlerRef`). */
  backHandlerRef?: RefObject<(() => boolean) | null>;
  /**
   * The outcome focus and the grid's restoration are composed after this
   * hook (they need the list it selects): read by the handlers only.
   */
  outcome: RefObject<Pick<OutcomeFocus, 'awaitOutcome' | 'cancel'> | null>;
  restoration: RefObject<Pick<ListRestoration, 'cancel'> | null>;
};

export type AuthorSearch = {
  /** The submitted query; null: the normal list. */
  query: string | null;
  queryRef: RefObject<string | null>;
  /** The field's text. */
  draft: string;
  setDraft: (draft: string) => void;
  /** Back to the normal list (the search memory starts over at the field). */
  leaveSearch: () => void;
  onChangeDraft: (text: string) => void;
  /** «Готово». */
  onSubmit: () => void;
};

/**
 * «Поиск в блоге» (Story 5.7, Поиск's rules): the field's draft and the
 * submitted query (local state). «Готово» runs the trimmed query afresh
 * (`submitBlogSearch`) and waits for its outcome; a blank one goes back to
 * the normal list. Back (the route asks first) clears an active search and
 * focuses the field.
 */
export function useAuthorSearch({
  client,
  blogUrl,
  routeKey,
  fieldId,
  filter,
  focusField,
  fieldAuto,
  backHandlerRef,
  outcome,
  restoration,
}: AuthorSearchOptions): AuthorSearch {
  const [query, setQuery] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const queryRef = useLatestRef(query);
  const filterRef = useLatestRef(filter);

  const leaveSearch = useCallback(() => {
    outcome.current?.cancel();
    restoration.current?.cancel();
    focusRestoration.remember(routeKey, MAIN_SECTION, fieldId, 0);
    setQuery(null);
  }, [outcome, restoration, routeKey, fieldId]);

  const onChangeDraft = useCallback(
    (text: string) => {
      // Typing is the user's: the field is theirs now.
      fieldAuto.current = false;
      setDraft(text);
    },
    [fieldAuto],
  );

  // «Готово» (Поиск's rules): the trimmed query; blank → the normal list.
  const onSubmit = useCallback(() => {
    // The system closes the keyboard; focus stays on the field explicitly.
    fieldAuto.current = false;
    focusField();
    const next = draft.trim();
    if (next === '') {
      if (queryRef.current !== null) {
        leaveSearch();
      }
      return;
    }
    restoration.current?.cancel();
    focusRestoration.remember(routeKey, MAIN_SECTION, fieldId, 0);
    outcome.current?.awaitOutcome(queryKeys.blogSearch(blogUrl, next, filterRef.current));
    submitBlogSearch(client, blogUrl, next, filterRef.current).catch(() => {});
    setQuery(next);
  }, [
    draft,
    fieldAuto,
    focusField,
    queryRef,
    leaveSearch,
    restoration,
    routeKey,
    fieldId,
    outcome,
    client,
    blogUrl,
    filterRef,
  ]);

  // Back (the route asks first): an active search is cleared, focus → the field.
  useEffect(() => {
    if (!backHandlerRef) {
      return;
    }
    backHandlerRef.current = () => {
      if (queryRef.current === null) {
        return false;
      }
      setDraft('');
      leaveSearch();
      focusField();
      return true;
    };
    return () => {
      backHandlerRef.current = null;
    };
  }, [backHandlerRef, queryRef, leaveSearch, focusField]);

  return { query, queryRef, draft, setDraft, leaveSearch, onChangeDraft, onSubmit };
}
