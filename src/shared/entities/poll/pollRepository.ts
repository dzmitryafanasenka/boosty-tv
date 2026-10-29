import { AppError } from '../../api/appError';
import { pollRefreshDtoSchema } from '../../api/dto/post';
import { blogUrlSchema } from '../../api/dto/subscriptions';
import type { HttpClient } from '../../api/httpClient';
import { mapPoll } from './mapPoll';
import type { Poll } from './types';

/**
 * PollRepository (Story 6.6, AD-1, api-contract §3 E10–E12): the only
 * caller of the poll endpoints. The HttpClient is the active session's,
 * passed in by the caller (never a singleton). The mutations go through
 * `HttpClient.request`, which never retries or replays a non-GET (AD-6,
 * also not after a 401). Nothing here logs: HttpClient logs the path only.
 */

/** A plain path segment: not empty, not `.` or `..`. */
const isSegment = (value: string) => value.length > 0 && !/^\.{1,2}$/.test(value);

/** Throws `AppError('Client')` before a request for an id that is not a plain segment. */
function segment(value: string): string {
  if (!isSegment(value)) {
    throw new AppError('Client');
  }
  return encodeURIComponent(value);
}

/**
 * E10 path. `blogUrl` must pass `blogUrlSchema` (as `postPath`) and the poll
 * id must be a plain segment; both are encoded as path segments. Anything
 * else throws `AppError('Client')` before a request is sent.
 */
export function pollPath(blogUrl: string, pollId: string): string {
  if (!blogUrlSchema.safeParse(blogUrl).success) {
    throw new AppError('Client');
  }
  return `/v1/blog/${encodeURIComponent(blogUrl)}/poll/${segment(pollId)}`;
}

/** E11 (POST) and E12 (DELETE) path. */
export function pollVotePath(pollId: string): string {
  return `/v1/poll/${segment(pollId)}/vote`;
}

/**
 * E10: the poll's current state through the one mapper (`mapPoll`). Rejects
 * with the HttpClient's `AppError`; `Parse` when the body has no
 * `data.poll`, the poll is one the mapper drops, or it is another poll
 * (its id differs from the one asked for).
 */
async function fetchPoll(http: HttpClient, blogUrl: string, pollId: string): Promise<Poll> {
  const { status, body } = await http.get(pollPath(blogUrl, pollId), pollRefreshDtoSchema);
  const poll = mapPoll(body.data.poll);
  if (poll === null || poll.id !== pollId) {
    throw new AppError('Parse', status);
  }
  return poll;
}

/**
 * E11: vote with form `answer` = the option ids, comma-joined (a single
 * choice sends one id). The body is ignored (the caller re-reads E10).
 * Rejects with `AppError`; never retried.
 */
async function vote(http: HttpClient, pollId: string, optionIds: readonly string[]): Promise<void> {
  if (optionIds.length === 0 || !optionIds.every(id => isSegment(id) && !id.includes(','))) {
    throw new AppError('Client');
  }
  await http.request({
    method: 'POST',
    path: pollVotePath(pollId),
    form: [['answer', optionIds.join(',')]],
  });
}

/** E12: retract the user's vote. The body is ignored. Rejects with `AppError`; never retried. */
async function retract(http: HttpClient, pollId: string): Promise<void> {
  await http.request({ method: 'DELETE', path: pollVotePath(pollId) });
}

export const PollRepository = { fetchPoll, vote, retract } as const;
