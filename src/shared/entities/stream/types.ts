/**
 * The Stream entity (Story 7.1, LIVE-01, api-contract «E15 (LIVE)»): an
 * author's live or scheduled stream, as the LiveCard shows it. It carries
 * no signed value, player URL or price (AD-9): Story 7.2 resolves the
 * playable URLs through E15 when the player opens.
 */

/** `live`: `isOnline`; `scheduled`: `isTemplate` and not online. */
export type StreamStatus = 'live' | 'scheduled';

export type Stream = {
  /** The stream's id as a string (the API may send a number). */
  id: string;
  /** Trimmed; empty when the API gives none. */
  title: string;
  status: StreamStatus;
  /** False: the stream needs a subscription level (never an error, never a session problem). */
  hasAccess: boolean;
  /** Epoch seconds; null when the API gives none or an invalid value. */
  startTime: number | null;
  /** Non-negative integer; 0 when the API gives none. */
  viewers: number;
  /** Non-negative integer; 0 when the API gives none. */
  likes: number;
  /** Story 7.4: the account liked the stream (E15 `isLiked`; anything but `true` is false). */
  isLiked: boolean;
  /** An http(s) cover image; null when none. */
  coverUrl: string | null;
  /** The required level's name (trimmed, never a price); null when none. */
  levelName: string | null;
  /**
   * Story 7.2: an `ok_stream` block has at least one playable live-edge URL
   * (`liveSourcesOf`). A flag only: the URLs themselves never enter the
   * entity; the player resolves them through `StreamRepository.liveSources`.
   */
  hasLiveSources: boolean;
};

/**
 * Story 7.2 (AD-9): a live item to play, by its blog only. Route params
 * carry this, never a URL or `signedQuery`; the player resolves the
 * live-edge sources through E15 when it opens. ProgressRepository never
 * sees a LiveRef.
 */
export type LiveRef = {
  kind: 'live';
  blogUrl: string;
};

/** A `LiveRef` (the player's ref is `MediaRef | LiveRef`; a MediaRef has no `kind`). */
export function isLiveRef(ref: object): ref is LiveRef {
  return 'kind' in ref && ref.kind === 'live';
}
