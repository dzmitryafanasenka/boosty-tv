import type { MediaRef, Post, VideoRow } from './types';

/**
 * The MediaRows of a post (Story 3.5): one per `ok_video` block with a
 * non-empty id, in block order; a repeated id keeps the first. A locked post
 * has none (its `blocks` are empty; teaser videos stay placeholders). A
 * video without an id has no row: an `ok_video` with id `''` is skipped
 * here, and one with no id at all is already `Block.Unknown` from the
 * mapper; both stay neutral placeholders in the body.
 */
export function videoRowsOf(post: Post): VideoRow[] {
  if (!post.hasAccess) {
    return [];
  }
  const rows: VideoRow[] = [];
  const seen = new Set<string>();
  for (const block of post.blocks) {
    if (block.type !== 'ok_video' || block.id.length === 0 || seen.has(block.id)) {
      continue;
    }
    seen.add(block.id);
    rows.push({
      ref: { blogUrl: post.author.blogUrl, postId: post.id, mediaId: block.id },
      index: rows.length,
      title: block.title.trim(),
      durationSec: block.durationSec,
      previewUrl: block.previewUrl,
    });
  }
  return rows;
}

/** A post's MediaRefs in order (AD-9), deduped by media id. */
export function mediaRefsOf(post: Post): MediaRef[] {
  return videoRowsOf(post).map(row => row.ref);
}
