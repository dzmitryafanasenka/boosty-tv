/**
 * Story 12.2: a feed card's progress (local entries only, the block duration
 * fallback, the multi-video target shared with Пост) and `primaryTarget`.
 */
import type { VideoRow } from '../../../entities/post/types';
import { postCardProgress, primaryTarget } from '../cardProgress';
import { progressStatus } from '../finished';
import type { ProgressSnapshot } from '../progressStore';

const row = (n: number, durationSec: number | null = 3600): VideoRow => ({
  ref: { blogUrl: 'synthetic-blog', postId: 'p', mediaId: `v${n}` },
  index: n - 1,
  title: '',
  durationSec,
  previewUrl: null,
});
const local = (positionSec: number, durationSec: number | null = 3600): ProgressSnapshot => ({
  positionSec,
  durationSec,
  source: 'local',
});
const server = (positionSec: number): ProgressSnapshot => ({ positionSec, durationSec: null, source: 'server' });

describe('postCardProgress', () => {
  it('no rows or no entry → none', () => {
    expect(postCardProgress([], [])).toEqual({ kind: 'none' });
    expect(postCardProgress([row(1)], [null])).toEqual({ kind: 'none' });
  });

  it('one video at 12:00 of 60:00 → in progress, 20 %, 48 min left', () => {
    expect(postCardProgress([row(1)], [local(720)])).toEqual({ kind: 'inProgress', fraction: 0.2, minutesLeft: 48 });
  });

  it('finished (≥ 95 % or < 30 s left) → watched', () => {
    expect(postCardProgress([row(1)], [local(3420)])).toEqual({ kind: 'watched' });
    expect(postCardProgress([row(1, 600)], [local(575, 600)])).toEqual({ kind: 'watched' });
  });

  it('the block duration applies when the entry has none; no duration at all → none (never a fake status)', () => {
    expect(postCardProgress([row(1, 3600)], [local(720, null)])).toEqual({
      kind: 'inProgress',
      fraction: 0.2,
      minutesLeft: 48,
    });
    expect(postCardProgress([row(1, null)], [local(720, null)])).toEqual({ kind: 'none' });
  });

  it('a server-only position is ignored', () => {
    expect(postCardProgress([row(1)], [server(720)])).toEqual({ kind: 'none' });
    expect(postCardProgress([row(1)], [server(3500)])).toEqual({ kind: 'none' });
  });

  it('several videos: 1 watched, 2 in progress → the line of video 2', () => {
    expect(postCardProgress([row(1), row(2), row(3)], [local(3500), local(1800), local(600)])).toEqual({
      kind: 'inProgress',
      fraction: 0.5,
      minutesLeft: 30,
    });
  });

  it('several videos: 1 watched, 2 not started → none (even when video 3 has progress)', () => {
    expect(postCardProgress([row(1), row(2), row(3)], [local(3500), null, local(600)])).toEqual({ kind: 'none' });
  });

  it('several videos, all finished → watched; one server-only → not all finished', () => {
    expect(postCardProgress([row(1), row(2)], [local(3500), local(3590)])).toEqual({ kind: 'watched' });
    expect(postCardProgress([row(1), row(2)], [local(3500), server(3590)])).toEqual({ kind: 'none' });
  });
});

describe('primaryTarget (shared with Пост)', () => {
  const status = (pos: number | null) => progressStatus(pos, 3600);

  it('the first unfinished video; resume when it has progress', () => {
    const rows = [row(1), row(2), row(3)];
    expect(primaryTarget(rows, [status(3500), status(600), null])).toEqual({ row: rows[1], resume: true });
    expect(primaryTarget(rows, [status(3500), null, status(600)])).toEqual({ row: rows[1], resume: false });
  });

  it('all finished → the first video, no resume; no rows → null', () => {
    const rows = [row(1), row(2)];
    expect(primaryTarget(rows, [status(3500), status(3500)])).toEqual({ row: rows[0], resume: false });
    expect(primaryTarget([], [])).toBeNull();
  });
});
