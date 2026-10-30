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
  /** An http(s) cover image; null when none. */
  coverUrl: string | null;
  /** The required level's name (trimmed, never a price); null when none. */
  levelName: string | null;
};
