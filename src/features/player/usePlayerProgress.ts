import { useEffect, useRef, type RefObject } from 'react';
import type { MediaRef } from '../../shared/entities/post';
import { useLatestRef } from '../../shared/focus';
import { subscribeAppBackground, subscribeAppForeground } from '../../shared/platform/appLifecycle';
import { logger } from '../../shared/services/logger';
import type { ProgressEvent, ProgressMeta, ProgressRepository } from '../../shared/services/progress';
import type { MediaSourceState } from './mediaResolver';

type Report = (event: ProgressEvent, positionOverride?: number) => void;

/**
 * The player's progress session and app lifecycle (Stories 4.2, 4.6), in
 * this effect order:
 * - `begin` once per player opening (the first ready source), with the
 *   video's meta. A recovery or a retry continues the session (Story 4.4:
 *   no `begin`, the short-visit rule is not restarted). After the session's
 *   new-resolution effect.
 * - Background (device sleep included): `onBackground` (a forced write,
 *   then the player pauses itself); foreground: `onForeground`.
 * - Unmount (any exit path): a forced `exit` write, not awaited. Declared
 *   after the live heartbeat (cleanup order).
 *
 * `progress` is null for live: nothing is ever begun or written.
 */
export function usePlayerProgress({
  progress,
  vodRef,
  readyResolution,
  readyProgressRef,
  reportRef,
  onBackground,
  onForeground,
}: {
  progress: ProgressRepository | null;
  vodRef: MediaRef | null;
  readyResolution: number | null;
  readyProgressRef: RefObject<ProgressMeta | null>;
  reportRef: RefObject<Report>;
  onBackground: () => void;
  onForeground: () => void;
}): void {
  const live = useLatestRef({ vodRef });
  const begun = useRef(false);
  useEffect(() => {
    const meta = readyProgressRef.current;
    const ref = live.current.vodRef;
    if (progress !== null && ref !== null && readyResolution !== null && meta !== null && !begun.current) {
      begun.current = true;
      progress.begin(ref, meta);
    }
  }, [progress, readyResolution, readyProgressRef, live]);

  const onBackgroundRef = useLatestRef(onBackground);
  useEffect(() => subscribeAppBackground(() => onBackgroundRef.current()), [onBackgroundRef]);
  const onForegroundRef = useLatestRef(onForeground);
  useEffect(() => subscribeAppForeground(() => onForegroundRef.current()), [onForegroundRef]);
  useEffect(() => () => reportRef.current('exit'), [reportRef]);
}

/**
 * The player's access endings, in this effect order (after the remote's
 * effects, before the live unplayable exit):
 * - Story 4.4 (owner decision 2026-10-28): a fresh E8 after playback (a
 *   recovery or a retry) says locked and the session check is done with it
 *   (`expired` opens A11 by itself): leave for the Post at once, with the
 *   usual exit report; the Post refetches and shows its own locked notice.
 * - Story 4.7 (owner decision 2026-10-28): a locked answer the session check
 *   verified (E1 ok; never offline; also the no-access exit above, after its
 *   exit report) or an unavailable video (E8 404 / the video gone) drops the
 *   video's local progress, so it leaves the Continue row. No request.
 */
export function usePlayerAccessEnd({
  state,
  everReady,
  isActive,
  reportRef,
  onNoAccess,
  progress,
  vodMediaId,
}: {
  state: MediaSourceState;
  everReady: RefObject<boolean>;
  isActive: () => boolean;
  reportRef: RefObject<Report>;
  onNoAccess: () => void;
  progress: ProgressRepository | null;
  vodMediaId: string | null;
}): void {
  const noAccessExit = state.kind === 'locked' && state.confirmed && everReady.current;
  const onNoAccessRef = useLatestRef(onNoAccess);
  useEffect(() => {
    if (!noAccessExit || !isActive()) {
      return;
    }
    logger.info('player', 'no access after a fresh source request; leaving');
    reportRef.current('exit');
    onNoAccessRef.current();
  }, [noAccessExit, isActive, reportRef, onNoAccessRef]);

  const goneForGood = state.kind === 'unavailable' || (state.kind === 'locked' && state.verified);
  useEffect(() => {
    if (goneForGood && vodMediaId !== null) {
      progress?.forget(vodMediaId);
    }
  }, [goneForGood, progress, vodMediaId]);
}
