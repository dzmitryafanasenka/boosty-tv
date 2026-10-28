/**
 * The Filter model (AD-18, Story 5.3). Story 5.3 has the access section
 * only; Stories 5.4 and 5.5 add `period` and `tagIds`. A Filter is plain,
 * serializable data: it is part of list query keys (never a resolved
 * timestamp, URL or cursor) and repositories turn it into request params.
 */

/**
 * «Доступные мне» (the reference default), «Все посты», «Только купленные»
 * (FILTER-01). The reference's `AccessType.Allowed / All / Bought`.
 */
export type AccessFilter = 'allowed' | 'all' | 'bought';

/** In sheet order. */
export const ACCESS_VALUES: readonly AccessFilter[] = ['allowed', 'all', 'bought'];

export type Filter = {
  readonly access: AccessFilter;
};

/**
 * Where a Filter applies. Story 5.3 uses `feed` only; Stories 5.6 and 5.7
 * add `search` and `author:<blogUrl>`.
 */
export type FilterScope = 'feed';

/** The default Filter (owner decision 2026-10-28: «Доступные мне»). One frozen object, so selectors stay stable. */
export const DEFAULT_FILTER: Filter = Object.freeze({ access: 'allowed' });

/** How many sections differ from the default (the chip's count). */
export function activeFilterCount(filter: Filter): number {
  return filter.access === DEFAULT_FILTER.access ? 0 : 1;
}

/** The Filter is the default one (no «Сбросить», no chip count). */
export function isDefaultFilter(filter: Filter): boolean {
  return activeFilterCount(filter) === 0;
}
