/**
 * A tag (AD-8, Story 5.5), as E13 describes it and the reference's
 * `Tag(id, title)`. Portable domain type, no raw DTO fields. Structurally
 * the Filter's `TagRef`.
 */
export type Tag = {
  /** The tag id (E13 `tag.id`, as a string). */
  id: string;
  title: string;
};

/** One E13 page: its tags (deduped by id) and the next opaque cursor. */
export type TagPage = {
  tags: Tag[];
  /** null: the last page (`isLast`, or no `extra`/`offset`). */
  nextCursor: string | null;
};
