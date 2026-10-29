import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { accountScope } from '../../shared/account';
import { queryKeys, type HttpClient } from '../../shared/api';
import { PollRepository, applyPoll } from '../../shared/entities/poll';

/**
 * Story 6.6: the single-choice vote and retract (FR41, POLL-02/04).
 *
 * - One request per poll id, app-wide (module-level, AD-6): while one runs,
 *   `submit` for any option of that poll is ignored (returns false).
 * - E11 (vote) or E12 (retract), never retried and never replayed (the
 *   HttpClient sends a mutation once, also after a 401). No optimistic
 *   update: the poll changes only from E10.
 * - After a 2xx: E10, then `applyPoll` into every cached post and page.
 *   When E10 fails, the post's E8 query is invalidated (the poll comes back
 *   with the post) and no error is shown: the mutation did succeed.
 * - A failed mutation sets `error` (`vote` or `retract`); the previous poll
 *   state is kept. `clearError` (the next OK) clears it.
 * - Account-scoped (AD-4): `submit` captures `accountScope.generation()`.
 *   After a sign-out or account switch (a bump), a late E11/E12/E10 result
 *   writes nothing (no `applyPoll`, no invalidation, no error), and the
 *   in-flight entry is keyed by generation + poll id, so it never blocks
 *   the next account's vote on the same poll.
 */

/** `<generation>:<pollId>` → the option whose request is running. */
const inFlight = new Map<string, string>();
const flightKey = (pollId: string) => `${accountScope.generation()}:${pollId}`;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: whether any poll request is running (and forget them all). */
export function resetPollVotesForTests() {
  inFlight.clear();
  notify();
}

export type PollMutation = 'vote' | 'retract';

export type PollVoteTarget = {
  /** The active session's content client. */
  http: HttpClient;
  /** The post's blog (the E10 path and the E8 query key). */
  blogUrl: string;
  postId: string;
  pollId: string;
};

export type PollVote = {
  /** The option whose request is running (any instance of this poll); null when none. */
  sendingOptionId: string | null;
  /** The last failed mutation of this widget; null when none or cleared. */
  error: PollMutation | null;
  /**
   * Starts `mutation` for `optionId` (`vote` sends that option, `retract`
   * the poll's E12). False when a request for this poll is already running.
   */
  submit: (mutation: PollMutation, optionId: string) => boolean;
  /** A request of this poll runs now under the current account (read at call time). */
  isBusy: () => boolean;
  clearError: () => void;
};

export function usePollVote({ http, blogUrl, postId, pollId }: PollVoteTarget): PollVote {
  const client = useQueryClient();
  const [error, setError] = useState<PollMutation | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const snapshot = () => inFlight.get(flightKey(pollId)) ?? null;
  const sendingOptionId = useSyncExternalStore(subscribe, snapshot, snapshot);

  const submit = useCallback(
    (mutation: PollMutation, optionId: string) => {
      const generation = accountScope.generation();
      const key = `${generation}:${pollId}`;
      if (inFlight.has(key)) {
        return false;
      }
      inFlight.set(key, optionId);
      notify();
      setError(null);
      /** No sign-out or account switch since `submit`. */
      const current = () => accountScope.generation() === generation;
      const run = async () => {
        try {
          if (mutation === 'vote') {
            await PollRepository.vote(http, pollId, [optionId]);
          } else {
            await PollRepository.retract(http, pollId);
          }
        } catch {
          if (mounted.current && current()) {
            setError(mutation);
          }
          return;
        }
        let fresh;
        try {
          fresh = await PollRepository.fetchPoll(http, blogUrl, pollId);
        } catch {
          if (current()) {
            // The vote did succeed: show no error, let the post bring the poll back.
            client.invalidateQueries({ queryKey: queryKeys.post(blogUrl, postId) }).catch(() => {});
          }
          return;
        }
        if (current()) {
          applyPoll(client, fresh);
        }
      };
      run().finally(() => {
        if (inFlight.get(key) === optionId) {
          inFlight.delete(key);
          notify();
        }
      });
      return true;
    },
    [client, http, blogUrl, postId, pollId],
  );

  const clearError = useCallback(() => setError(null), []);
  const isBusy = useCallback(() => inFlight.has(flightKey(pollId)), [pollId]);

  return { sendingOptionId, error, submit, isBusy, clearError };
}
