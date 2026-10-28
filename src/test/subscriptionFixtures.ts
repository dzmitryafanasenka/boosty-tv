/**
 * E2 subscriptions fixtures for tests (Story 3.2), built in memory from the
 * sanitized live shape in `./fixtures/boosty/e2-subscriptions.json` (no new
 * fixture files: the fixture check allows only sanitized JSON there).
 * Test-only.
 *
 * - `e2Body()`: the live E2 body (3 items, `total` 5).
 * - `subscription(n)`: item `n` cloned from a live item with a synthetic
 *   `blogUrl` (`synthetic-blog-<n>`) and title (`Blog <n>`).
 * - `subscriptionsBody(count, total)`: `count` synthetic items and `total`.
 * - `e1NoBlogBody()`: E1 without `blogUrl` (no «Мой блог», Story 5.2).
 */
import e1UserCurrent from './fixtures/boosty/e1-user-current.json';
import e2Subscriptions from './fixtures/boosty/e2-subscriptions.json';

export const E2_PATH = '/v1/user/subscriptions';
export const E2_URL = 'https://api.boosty.to/v1/user/subscriptions?limit=30&with_follow=true';

type Json = Record<string, unknown>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The live E2 body. */
export function e2Body(): Json & { data: Json[] } {
  return clone(e2Subscriptions.body) as unknown as Json & { data: Json[] };
}

/** Synthetic blog url of item `n` (1-based keeps the live `synthetic-blog-<n>` form). */
export const blogUrlOf = (n: number) => `synthetic-blog-${n}`;

/** Item `n`: a live item with `blogUrl` `synthetic-blog-<n>` and title `Blog <n>`. */
export function subscription(n: number, blog: Json = {}): Json {
  const item = e2Body().data[0];
  const liveBlog = item.blog as Json;
  return {
    ...item,
    blog: {
      ...liveBlog,
      title: `Blog ${n}`,
      blogUrl: blogUrlOf(n),
      owner: { ...(liveBlog.owner as Json), name: `Owner ${n}` },
      ...blog,
    },
  };
}

/** An E2 body with `count` synthetic items (1…count) and `total`. */
export function subscriptionsBody(count: number, total: number = count): Json {
  return {
    offset: 0,
    limit: 30,
    total,
    data: Array.from({ length: count }, (_, i) => subscription(i + 1)),
  };
}

/**
 * The E1 body of an account without its own blog (Story 5.2): the live E1
 * fixture without `blogUrl`, so Подписки shows no «Мой блог» and sends no
 * E3/E4 for it. Flows that are not about «Мой блог» answer E1 with it.
 */
export function e1NoBlogBody(): Json {
  const body = clone(e1UserCurrent.body) as Json;
  delete body.blogUrl;
  return body;
}
