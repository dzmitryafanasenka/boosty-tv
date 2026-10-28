/**
 * The signed-in account's profile (AD-8), as E1 describes it. Portable
 * domain type, no raw DTO fields; only what a feature reads.
 */
export type CurrentUser = {
  /** The account id (E1 `id`, as a string). */
  id: string;
  /**
   * The account's own blog (E1 `blogUrl`, Story 5.2 «Мой блог»); null when
   * the account has none or the value is not a safe `blogUrl`.
   */
  blogUrl: string | null;
};
