import type { VideoRow } from '../../entities/post/types';
import { progressStatus, type ProgressStatus } from './finished';
import type { ProgressSnapshot } from './progressStore';

/**
 * The primary's target (Story 4.2): the first unfinished video; `resume`
 * when it has progress > 0 («Продолжить», «С начала»). All finished: the
 * first video, no resume («Смотреть», it starts at 0). Null without rows.
 * Shared by Пост («Продолжить · Видео N») and the feed cards (Story 12.2).
 */
export function primaryTarget(
  rows: readonly VideoRow[],
  statuses: readonly (ProgressStatus | null)[],
): { row: VideoRow; resume: boolean } | null {
  for (let i = 0; i < rows.length; i += 1) {
    const status = statuses[i];
    if (status?.kind !== 'watched') {
      return {
        row: rows[i],
        resume: status?.kind === 'inProgress' || status?.kind === 'unknown',
      };
    }
  }
  return rows.length > 0 ? { row: rows[0], resume: false } : null;
}

/** What a feed card shows (Story 12.2, IMP-02). */
export type PostCardProgress =
  /** No local progress for the target video, or an unknown duration: the card is unchanged. */
  | { kind: 'none' }
  /** The target video is started: the line at `fraction`, «осталось N мин». */
  | { kind: 'inProgress'; fraction: number; minutesLeft: number }
  /** Every video of the post is finished: a full line and «Просмотрено». */
  | { kind: 'watched' };

const NONE: PostCardProgress = { kind: 'none' };
const WATCHED: PostCardProgress = { kind: 'watched' };

/**
 * A post card's progress (Story 12.2): `rows` are the post's MediaRows,
 * `snapshots` their `useProgress` values in the same order. Only local
 * entries count (a server `timeCode` is ignored: the feed shows what was
 * watched on this device); the duration is the local entry's, else the
 * row's. All finished → «watched»; else the target is Пост's
 * («Продолжить · Видео N», `primaryTarget`), shown only when in progress.
 */
export function postCardProgress(
  rows: readonly VideoRow[],
  snapshots: readonly (ProgressSnapshot | null)[],
): PostCardProgress {
  if (rows.length === 0) {
    return NONE;
  }
  const statuses = rows.map((row, i) => {
    const snap = snapshots[i] ?? null;
    const local = snap !== null && snap.source === 'local' ? snap : null;
    return progressStatus(local?.positionSec ?? null, local?.durationSec ?? row.durationSec);
  });
  if (statuses.every(status => status.kind === 'watched')) {
    return WATCHED;
  }
  const target = primaryTarget(rows, statuses);
  const status = target === null ? null : statuses[rows.indexOf(target.row)];
  return status?.kind === 'inProgress'
    ? { kind: 'inProgress', fraction: status.fraction, minutesLeft: status.minutesLeft }
    : NONE;
}
