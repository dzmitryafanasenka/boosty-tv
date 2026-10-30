import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys, type HttpClient } from '../../shared/api';
import {
  DEFAULT_FILTER,
  FilterSheet,
  authorFilterScope,
  filtersStore,
  isDefaultFilter,
  useFilter,
  type Filter,
} from '../../shared/filters';
import { useLatestRef, type ModalApi, type OutcomeFocus } from '../../shared/focus';
import { requestHostFocus, type HostView } from '../../shared/ui';
import type { AuthorSearch } from './useAuthorSearch';
import { submitBlogSearch } from './useBlogSearch';

export type AuthorFiltersOptions = {
  http: HttpClient;
  client: QueryClient;
  blogUrl: string;
  /** The route's own Filter scope comes from it (`author:<routeKey>`). */
  routeKey: string;
  /** `phaseFlags.filters`: off → the default Filter. */
  filtersEnabled: boolean;
  modal: ModalApi;
  focusField: () => void;
  /**
   * The search and the outcome focus are composed after this hook (the
   * search needs its Filter): read by the handlers only.
   */
  search: RefObject<Pick<AuthorSearch, 'queryRef' | 'setDraft' | 'leaveSearch'> | null>;
  outcome: RefObject<Pick<OutcomeFocus, 'awaitOutcome'> | null>;
};

export type AuthorFilters = {
  /** The effective Filter (the stored one while the chip is on, else the default). */
  filter: Filter;
  /** The effective Filter is not the default. */
  filtered: boolean;
  chipRef: (view: HostView | null) => void;
  /** «Фильтры». */
  onOpenFilters: () => void;
  /** «Сбросить фильтры» in the filtered «Ничего не найдено». */
  onResetFilters: () => void;
  /** «Сбросить» in the action row. */
  onResetAll: () => void;
};

/**
 * The Author route's Filter (Story 5.7; owner decision 2026-10-29 Q3 b):
 * its own scope `author:<routeKey>`, dropped on unmount; the «Фильтры»
 * chip opens the shared sheet with the blog's tags (Back returns to the
 * chip); the two reset actions.
 */
export function useAuthorFilters({
  http,
  client,
  blogUrl,
  routeKey,
  filtersEnabled,
  modal,
  focusField,
  search,
  outcome,
}: AuthorFiltersOptions): AuthorFilters {
  const scope = authorFilterScope(routeKey);
  const storedFilter = useFilter(scope);
  const filter = filtersEnabled ? storedFilter : DEFAULT_FILTER;
  const filtered = !isDefaultFilter(filter);
  useEffect(() => () => filtersStore.getState().reset(scope), [scope]);

  // «Сбросить фильтры» in the filtered «Ничего не найдено»: the action goes
  // with the empty view, so the field keeps focus while the list reloads.
  // While searching, the query runs again under the default Filter (a
  // cached result for it is not reused).
  const onResetFilters = useCallback(() => {
    focusField();
    const query = search.current?.queryRef.current ?? null;
    outcome.current?.awaitOutcome(
      query !== null
        ? queryKeys.blogSearch(blogUrl, query, DEFAULT_FILTER)
        : queryKeys.authorPosts(blogUrl, DEFAULT_FILTER),
    );
    if (query !== null) {
      submitBlogSearch(client, blogUrl, query, DEFAULT_FILTER).catch(() => {});
    }
    filtersStore.getState().reset(scope);
  }, [focusField, search, outcome, scope, client, blogUrl]);

  // «Фильтры»: the shared sheet with the route's scope and the blog's tags;
  // Back returns to the chip.
  const chipView = useRef<HostView | null>(null);
  const chipRef = useCallback((view: HostView | null) => {
    chipView.current = view;
  }, []);
  const httpRef = useLatestRef(http);
  const onOpenFilters = useCallback(() => {
    if (modal.isOpen()) {
      return;
    }
    modal.open(<FilterSheet scope={scope} http={httpRef.current} blogUrl={blogUrl} />, chipView, {
      placement: 'end',
    });
  }, [modal, httpRef, scope, blogUrl]);

  // «Сбросить» (shown while a search or a filter is active): both cleared,
  // focus → the chip (it stays; «Сбросить» goes away).
  const onResetAll = useCallback(() => {
    if (chipView.current) {
      requestHostFocus(chipView.current);
    } else {
      focusField();
    }
    const current = search.current;
    current?.setDraft('');
    if (current && current.queryRef.current !== null) {
      current.leaveSearch();
    }
    filtersStore.getState().reset(scope);
  }, [focusField, search, scope]);

  return { filter, filtered, chipRef, onOpenFilters, onResetFilters, onResetAll };
}
