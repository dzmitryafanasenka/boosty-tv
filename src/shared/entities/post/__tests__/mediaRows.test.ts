import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { e8Accessible, e8Locked, paragraph, postDetail } from '../../../../test/postFixtures';
import { mapPost } from '../mapPost';
import { mediaRefsOf, videoRowsOf } from '../mediaRows';
import type { Post } from '../types';

const mapped = (raw: unknown) => mapPost(raw, createLogger()) as Post;
const post = (data: unknown[], extra: Record<string, unknown> = {}) =>
  mapped(postDetail('blog-a', 'post-a', data as never, extra));
const video = (id: string | undefined, more: Record<string, unknown> = {}) => ({
  type: 'ok_video',
  ...(id === undefined ? {} : { id }),
  ...more,
});

/** Keys that must never leave the DTO (signed, personal or progress). */
const FORBIDDEN = ['timeCode', 'playerUrls', 'signedQuery', 'failoverHost', 'vid'];

describe('videoRowsOf / mediaRefsOf (Story 3.5)', () => {
  it('two videos + text: two rows in block order, «Видео 1», «Видео 2»', () => {
    const p = post([
      video('v1', { title: 'First', duration: 754, preview: 'https://example.invalid/p1' }),
      ...paragraph('Text'),
      video('v2', { title: '' }),
    ]);
    expect(videoRowsOf(p)).toEqual([
      {
        ref: { blogUrl: 'blog-a', postId: 'post-a', mediaId: 'v1' },
        index: 0,
        title: 'First',
        durationSec: 754,
        previewUrl: 'https://example.invalid/p1',
      },
      {
        ref: { blogUrl: 'blog-a', postId: 'post-a', mediaId: 'v2' },
        index: 1,
        title: '',
        durationSec: null,
        previewUrl: null,
      },
    ]);
    expect(mediaRefsOf(p)).toEqual([
      { blogUrl: 'blog-a', postId: 'post-a', mediaId: 'v1' },
      { blogUrl: 'blog-a', postId: 'post-a', mediaId: 'v2' },
    ]);
  });

  it('the preview falls back to `defaultPreview`; a blank title is empty', () => {
    const [row] = videoRowsOf(post([video('v1', { title: '   ', defaultPreview: 'https://example.invalid/d' })]));
    expect(row.title).toBe('');
    expect(row.previewUrl).toBe('https://example.invalid/d');
  });

  it('a video without an id has no row (and does not count for «Видео N»)', () => {
    const rows = videoRowsOf(post([video(undefined, { title: 'x' }), video(''), video('v2')]));
    expect(rows.map(r => [r.ref.mediaId, r.index])).toEqual([['v2', 0]]);
  });

  it('a duplicate id keeps the first', () => {
    const rows = videoRowsOf(post([video('v1', { title: 'a' }), video('v1', { title: 'b' }), video('v2')]));
    expect(rows.map(r => [r.ref.mediaId, r.title, r.index])).toEqual([
      ['v1', 'a', 0],
      ['v2', '', 1],
    ]);
  });

  it('a locked post has no rows (even with a teaser video)', () => {
    const locked = mapped(e8Locked());
    expect(videoRowsOf(locked)).toEqual([]);
    const withTeaser = post([], { hasAccess: false, teaser: [video('t1')] });
    expect(videoRowsOf(withTeaser)).toEqual([]);
  });

  it('domain shape (live E8 fixture): no timeCode, playerUrls, signedQuery or player URL in the Post, the rows or the refs', () => {
    const raw = e8Accessible();
    const rawVideo = (raw.data as Array<Record<string, unknown>>).find(b => b.type === 'ok_video');
    // The live fixture does carry them: the test is meaningful.
    expect(rawVideo).toHaveProperty('timeCode');
    expect(rawVideo).toHaveProperty('playerUrls');
    const p = mapped(raw);
    const rows = videoRowsOf(p);
    expect(rows).toHaveLength(1);
    expect(rows[0].durationSec).toBe(3960);
    for (const value of [p, rows, mediaRefsOf(p)]) {
      const json = JSON.stringify(value);
      for (const key of FORBIDDEN) {
        expect(json).not.toContain(`"${key}"`);
      }
      expect(json).not.toContain('example.invalid/player');
      expect(json).not.toContain(`:${String(rawVideo?.timeCode)},`);
    }
    expect(Object.keys(rows[0]).sort()).toEqual(['durationSec', 'index', 'previewUrl', 'ref', 'title']);
    expect(Object.keys(rows[0].ref).sort()).toEqual(['blogUrl', 'mediaId', 'postId']);
  });
});
