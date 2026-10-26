import { createAppQueryClient, resetQueryCache } from '../queryClient';

/**
 * The account-scoped reset (sign-out and account switch both run it through
 * `AccountScope.reset()`): a reply of the previous account still in flight
 * is cancelled first and never lands in the cleared cache.
 */
test('an in-flight query of the previous account never lands after the reset', async () => {
  const client = createAppQueryClient();
  let release: (value: string[]) => void = () => {};
  const pending = client
    .fetchQuery({
      queryKey: ['feed', 'subscriptions'],
      queryFn: () =>
        new Promise<string[]>(resolve => {
          release = resolve;
        }),
    })
    .catch(() => 'cancelled');
  await resetQueryCache(client);
  release(['post of account A']);
  await expect(pending).resolves.toBe('cancelled');
  expect(client.getQueryData(['feed', 'subscriptions'])).toBeUndefined();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});
