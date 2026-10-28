import type { Post } from '../../../shared/entities/post';
import type { ProgressSnapshot } from '../../../shared/services/progress';
import { endedReturnFocusId } from '../PostScreen';

/** Story 4.5: where focus lands on the Post after a video's natural end. */

const video = (id: string, durationSec: number | null = 600) => ({
  type: 'ok_video' as const,
  id,
  title: '',
  durationSec,
  previewUrl: null,
});

const post = (blocks: Post['blocks']): Post => ({
  id: 'p1',
  intId: 1,
  title: 'Title',
  publishedAt: 0,
  author: { name: 'Author', blogUrl: 'blog', avatarUrl: null },
  hasAccess: true,
  blocks,
  teaser: [],
  kind: { kind: 'video' },
  previewUrl: null,
  durationSec: null,
  levelName: null,
  likeCount: null,
  pinned: false,
});

const snapshots =
  (map: Record<string, ProgressSnapshot>) =>
  (mediaId: string): ProgressSnapshot | null =>
    map[mediaId] ?? null;

const local = (positionSec: number, durationSec: number | null = 600): ProgressSnapshot => ({
  positionSec,
  durationSec,
  source: 'local',
});

it('the first unfinished row after the ended one', () => {
  const p = post([video('v1'), video('v2'), video('v3')]);
  expect(endedReturnFocusId(p, 'v1', snapshots({ v1: local(600), v2: local(590) }))).toBe('post/p1/video/v3');
});

it('a not-started next row is unfinished', () => {
  const p = post([video('v1'), video('v2')]);
  expect(endedReturnFocusId(p, 'v1', snapshots({ v1: local(600) }))).toBe('post/p1/video/v2');
});

it('a started row without any known duration counts as unfinished', () => {
  const p = post([video('v1'), video('v2', null)]);
  expect(endedReturnFocusId(p, 'v1', snapshots({ v2: { positionSec: 120, durationSec: null, source: 'server' } }))).toBe(
    'post/p1/video/v2',
  );
});

it('a server snapshot (no duration) uses the row duration for the finished rule', () => {
  const p = post([video('v1'), video('v2', 600), video('v3')]);
  expect(
    endedReturnFocusId(p, 'v1', snapshots({ v2: { positionSec: 590, durationSec: null, source: 'server' } })),
  ).toBe('post/p1/video/v3');
});

it('the last video, or only finished rows after it: the primary (even if an earlier one is unfinished)', () => {
  const p = post([video('v1'), video('v2')]);
  expect(endedReturnFocusId(p, 'v2', snapshots({}))).toBe('post/p1/primary');
  expect(endedReturnFocusId(p, 'v1', snapshots({ v2: local(600) }))).toBe('post/p1/primary');
});

it('an ended id that is not in the post, or a post without rows: the primary', () => {
  expect(endedReturnFocusId(post([video('v1')]), 'gone', snapshots({}))).toBe('post/p1/primary');
  expect(endedReturnFocusId(post([]), 'v1', snapshots({}))).toBe('post/p1/primary');
});
