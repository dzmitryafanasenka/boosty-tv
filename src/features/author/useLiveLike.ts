import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accountScope, captureGeneration, createGenerationKeyedStore } from '../../shared/account';
import { isAppError, queryKeys, type AppErrorKind, type HttpClient } from '../../shared/api';
import { StreamRepository, type Stream } from '../../shared/entities/stream';
import { useLatestRef } from '../../shared/focus';

/**
 * Story 7.4 (LIVE-04, FR24, api-contract E17): «Нравится» on the LiveCard,
 * an optimistic toggle.
 *
 * - The like shows only for a live stream with access (`liveLikeShown`).
 * - OK flips `isLiked` and moves `likes` by one (clamped at ≥ 0) at once,
 *   then sends one E17 (`POST` to like, `DELETE` to unlike).
 * - One request per blog, app-wide (module-level, as `usePollVote`): while
 *   it runs, OK is ignored (no second request, no flip).
 * - The optimistic state is an overlay over the `['stream', blogUrl]` query,
 *   tied to the stream's id (a new stream on the same blog never shows or
 *   receives it): before it is set, a running E15 of that key is cancelled,
 *   and a poll that lands while E17 runs never undoes it (the overlay holds
 *   until E17 settles).
 * - Success: a poll started meanwhile is cancelled, then the target state is
 *   written into the query relative to its current value (`isLiked` set;
 *   `likes` ± 1 only when the cached `isLiked` differs, clamped at ≥ 0) and
 *   kept; the next poll reconciles. The overlay is dropped once the page
 *   sees that write (no frame with the old value), or when the page unmounts;
 *   when the write changes nothing the page would see (a poll meanwhile
 *   already carried the target, or the cached stream is another one or
 *   gone), it is dropped at once.
 * - Failure: the overlay goes (the query's value shows again: the rollback)
 *   and `error` keeps the `AppErrorKind` (the line reads `error.<kind>`). No
 *   automatic retry; the HttpClient never replays a mutation after a 401.
 *   The next OK clears it; so does the like being hidden, another stream or
 *   another account.
 * - Account-scoped (AD-4): the toggle captures `accountScope.generation()`.
 *   After a sign-out or switch, a late result writes nothing (no query
 *   write, no rollback, no error), and the in-flight entry is keyed by
 *   generation, so it never blocks the next account.
 */

type Overlay = {
  /** The stream the toggle was made on; applied and written only to that stream. */
  streamId: string;
  isLiked: boolean;
  likes: number;
  /** E17 succeeded and the write changed the cache: held until the page's stream value changes (it then carries the write). */
  settled: boolean;
};

/** `<generation>:<blogUrl>` → the optimistic state (in flight, or settled and not yet seen). */
const overlays = createGenerationKeyedStore<Overlay>();

/** Drops this blog's settled overlay (current account), if any. */
function dropSettled(blogUrl: string) {
  if (overlays.get(blogUrl)?.settled) {
    overlays.delete(overlays.key(blogUrl));
  }
}

/** Test-only: forget every like request and overlay. */
export function resetLiveLikesForTests() {
  overlays.reset();
}

/** Owner decision Q2 a: the like shows only for a live stream with access. */
export function liveLikeShown(stream: Stream): boolean {
  return stream.status === 'live' && stream.hasAccess;
}

export type LiveLike = {
  /** The stream to show: the query's value with the optimistic like over it; null: no stream. */
  stream: Stream | null;
  /** A like request of this blog runs now (under the current account). */
  sending: boolean;
  /** The last failed toggle's kind; null when none or cleared. */
  error: AppErrorKind | null;
  /** OK on «Нравится». False when ignored (no stream, no like shown, or a request running). */
  toggle: () => boolean;
};

type LikeError = { kind: AppErrorKind; generation: number; streamId: string };

export function useLiveLike(http: HttpClient, blogUrl: string, stream: Stream | null): LiveLike {
  const client = useQueryClient();
  const [error, setError] = useState<LikeError | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      dropSettled(blogUrl);
    };
  }, [blogUrl]);
  const overlay = overlays.useEntry(blogUrl);

  // A settled overlay goes once the page's stream value changes after it
  // (the query write, a poll, or the stream gone): that value carries the
  // write or the newer truth.
  const seenStream = useRef(stream);
  useEffect(() => {
    if (seenStream.current === stream) {
      return;
    }
    seenStream.current = stream;
    dropSettled(blogUrl);
  }, [stream, blogUrl]);

  const shown = useMemo(
    () =>
      stream !== null && overlay !== null && overlay.streamId === stream.id
        ? { ...stream, isLiked: overlay.isLiked, likes: overlay.likes }
        : stream,
    [stream, overlay],
  );
  const shownRef = useLatestRef(shown);

  // The failure line belongs to the like it came from: a hidden like (no
  // stream, no access, not live) clears it.
  const likeVisible = shown !== null && liveLikeShown(shown);
  useEffect(() => {
    if (!likeVisible) {
      setError(null);
    }
  }, [likeVisible]);

  const toggle = useCallback(() => {
    const current = shownRef.current;
    /** No sign-out or account switch since the toggle. */
    const sameAccount = captureGeneration();
    const generation = sameAccount.generation;
    const key = overlays.key(blogUrl, generation);
    const running = overlays.getAt(key);
    if (current === null || !liveLikeShown(current) || (running !== undefined && !running.settled)) {
      return false;
    }
    const streamId = current.id;
    const isLiked = !current.isLiked;
    const likes = Math.max(0, current.likes + (isLiked ? 1 : -1));
    const queryKey = queryKeys.stream(blogUrl);
    // A poll running now would land over the optimistic state: cancel it
    // first (TanStack reverts it; the next poll runs on schedule).
    client.cancelQueries({ queryKey, exact: true }).catch(() => {});
    const entry: Overlay = { streamId, isLiked, likes, settled: false };
    overlays.set(key, entry);
    setError(null);
    const run = async () => {
      try {
        await StreamRepository.like(http, blogUrl, isLiked);
      } catch (failure) {
        if (sameAccount() && mounted.current) {
          setError({ kind: isAppError(failure) ? failure.kind : 'Client', generation, streamId });
        }
        return false;
      }
      if (sameAccount()) {
        // A poll started while E17 ran carries the pre-like value: cancel it
        // before the write, so it cannot land after it.
        await client.cancelQueries({ queryKey, exact: true }).catch(() => {});
      }
      return true;
    };
    run()
      .then(ok => {
        if (overlays.getAt(key) !== entry) {
          return;
        }
        if (ok && sameAccount()) {
          // Keep the state; the next poll reconciles. Relative to the cached
          // value (a newer poll count is kept), and only for the same stream.
          const before = client.getQueryData<Stream | null>(queryKey);
          // The page already shows the target from the cache when a poll
          // meanwhile carried it (or the cached stream is another one, or
          // gone): checked on values, not on the object identity.
          const nothingToSee = !before || before.id !== streamId || before.isLiked === isLiked;
          client.setQueryData<Stream | null>(queryKey, data =>
            data && data.id === streamId
              ? {
                  ...data,
                  isLiked,
                  likes: data.isLiked === isLiked ? data.likes : Math.max(0, data.likes + (isLiked ? 1 : -1)),
                }
              : data,
          );
          if (nothingToSee) {
            // The write changes nothing the page would see, so no later
            // stream change would drop the overlay: it goes at once (Epic 7
            // retro F1).
            overlays.delete(key);
          } else {
            overlays.set(key, { ...entry, settled: true });
          }
        } else {
          // The rollback (or an old account's entry, which nothing shows).
          overlays.delete(key);
        }
      })
      .catch(() => {});
    return true;
  }, [client, http, blogUrl, shownRef]);

  const shownError =
    error !== null &&
    likeVisible &&
    error.generation === accountScope.generation() &&
    shown !== null &&
    error.streamId === shown.id
      ? error.kind
      : null;

  return {
    stream: shown,
    sending: overlay !== null && !overlay.settled && stream !== null && overlay.streamId === stream.id,
    error: shownError,
    toggle,
  };
}
