import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { captureGeneration, createGenerationKeyedStore } from '../../shared/account';
import { queryKeys, type HttpClient } from '../../shared/api';
import { PollRepository, applyPoll } from '../../shared/entities/poll';

/**
 * Story 6.6: the single-choice vote and retract (FR41, POLL-02/04); Story
 * 6.7: the multiple-choice vote (every checked id) and retract (POLL-03).
 *
 * - One request per poll id, app-wide (module-level, AD-6): while one runs,
 *   `submit` for any option of that poll is ignored (returns false).
 * - E11 (vote) or E12 (retract), never retried and never replayed (the
 *   HttpClient sends a mutation once, also after a 401). No optimistic
 *   update: the poll changes only from E10.
 * - After a 2xx: E10, then `applyPoll` into every cached post and page. A
 *   running E8 of this post is cancelled first: it started before the vote
 *   and would bring the pre-vote poll back over the E10. A list page fetch
 *   running at that moment is not cancelled (list cards show no results).
 *   When E10 fails, the post's E8 query is invalidated (the poll comes back
 *   with the post) and no error is shown: the mutation did succeed.
 * - A failed mutation sets `error` (`vote` or `retract`); the previous poll
 *   state is kept. `clearError` (the next OK) clears it.
 * - Account-scoped (AD-4): `submit` captures `accountScope.generation()`.
 *   After a sign-out or account switch (a bump), a late E11/E12/E10 result
 *   writes nothing (no `applyPoll`, no invalidation, no error), a late
 *   E11/E12 sends no E10, and the in-flight entry is keyed by generation +
 *   poll id, so it never blocks the next account's vote on the same poll.
 */

/** `<generation>:<pollId>` → the key of the control whose request is running. */
const inFlight = createGenerationKeyedStore<string>();

/** Test-only: whether any poll request is running (and forget them all). */
export function resetPollVotesForTests() {
  inFlight.reset();
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
  /**
   * The key of the control whose request is running (any instance of this
   * poll): an option id (single choice), `submit` or `retract` (Story 6.7
   * multiple choice); null when none.
   */
  sendingKey: string | null;
  /** The last failed mutation of this widget; null when none or cleared. */
  error: PollMutation | null;
  /**
   * Starts `mutation` (`vote` sends `optionIds`, comma-joined in the given
   * order; `retract` the poll's E12 and ignores them). `sendingKey` names
   * the control that sent (see `sendingKey`). False when a request for this
   * poll is already running.
   */
  submit: (mutation: PollMutation, optionIds: readonly string[], sendingKey: string) => boolean;
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
  const sendingKey = inFlight.useEntry(pollId);

  const submit = useCallback(
    (mutation: PollMutation, optionIds: readonly string[], controlKey: string) => {
      /** No sign-out or account switch since `submit`. */
      const current = captureGeneration();
      const key = inFlight.key(pollId, current.generation);
      if (inFlight.getAt(key) !== undefined) {
        return false;
      }
      inFlight.set(key, controlKey);
      setError(null);
      const run = async () => {
        try {
          if (mutation === 'vote') {
            await PollRepository.vote(http, pollId, optionIds);
          } else {
            await PollRepository.retract(http, pollId);
          }
        } catch {
          if (mounted.current && current()) {
            setError(mutation);
          }
          return;
        }
        if (!current()) {
          // Signed out or switched: the old account's poll is not read with
          // another session (or none).
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
        if (!current()) {
          return;
        }
        // An E8 of this post started before the vote would land with the
        // pre-vote poll over the fresher E10: cancel it (TanStack reverts it).
        // The key is not account-scoped, hence the generation checks around.
        await client.cancelQueries({ queryKey: queryKeys.post(blogUrl, postId), exact: true });
        if (current()) {
          applyPoll(client, fresh);
        }
      };
      run().finally(() => {
        inFlight.deleteIf(key, controlKey);
      });
      return true;
    },
    [client, http, blogUrl, postId, pollId],
  );

  const clearError = useCallback(() => setError(null), []);
  const isBusy = useCallback(() => inFlight.get(pollId) !== undefined, [pollId]);

  return { sendingKey, error, submit, isBusy, clearError };
}
