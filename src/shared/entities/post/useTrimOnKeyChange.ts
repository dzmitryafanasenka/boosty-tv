import { useEffect, useRef } from 'react';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { trimPostsToFirstPage } from './postsHeadRefresh';

/**
 * The shown paged post list changed its key (a Filter change, a new query):
 * the list left behind keeps its first page only (`trimPostsToFirstPage`),
 * so switching back to it while stale sends one page-1 request, not one per
 * page it had loaded. Keys are compared by their JSON string; the first
 * render never trims; the previous key is trimmed as committed (parsed from that string);
 * errors are swallowed (the trim is best effort).
 */
export function useTrimOnKeyChange(client: QueryClient, key: QueryKey): void {
  const keyString = JSON.stringify(key);
  const shown = useRef<{ keyString: string; key: QueryKey }>({ keyString, key });
  useEffect(() => {
    const previous = shown.current;
    if (previous.keyString === keyString) {
      return;
    }
    // The committed key (as the JSON the effect ran for), never a discarded render's.
    shown.current = { keyString, key: JSON.parse(keyString) as QueryKey };
    trimPostsToFirstPage(client, previous.key).catch(() => {});
  }, [client, keyString]);
}
