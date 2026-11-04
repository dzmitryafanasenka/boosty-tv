import { useQuery } from '@tanstack/react-query';
import { queryKeys, type HttpClient } from '../../shared/api';
import { UserRepository } from '../../shared/entities/user';

/**
 * The signed-in account's display name for «Выйти из аккаунта» (Story
 * 15.2, IMP-10, FR-66): an observer of the shared `me` query (the same key
 * and fn as `useMyBlog`'s «Мой блог»). A cold cache sends one E1; a cache
 * that Подписки (or an earlier visit) filled sends none, also once stale
 * (`refetchOnMount: false`, this observer only: the name rarely changes,
 * and `useMyBlog`'s own options are unchanged). The query lives in the
 * account-scoped cache, which `AccountScope.reset()` clears on sign-out and
 * account switch, so another account never sees this name. `retry: false`
 * and `retryOnMount: false`: a failed E1 is settled (no name) and not
 * asked again when Настройки mounts again. Loading, an error or no name
 * (`CurrentUser.name` null: missing, blank or phone-like) → undefined.
 * The name is personal data: never logged.
 */
export function useAccountName(http: HttpClient): string | undefined {
  const me = useQuery({
    queryKey: queryKeys.me(),
    queryFn: () => UserRepository.current(http),
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
  });
  return me.data?.name ?? undefined;
}
