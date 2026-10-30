/**
 * The Event entity (Story 7.5, EVT-01, api-contract «E18 (LIVE)»): one row
 * of События. It carries no URL other than the avatar, and no money field.
 */

/** `stream`: `video_stream_start` («Начался эфир» and the «Эфир» chip); `generic`: every other shown type. */
export type EventKind = 'stream' | 'generic';

export type Event = {
  /** The event's id as a string (the API sends a number); the row's identity. */
  id: string;
  /** The raw E18 type (`video_stream_start`, `post_new`, …): the row's text. */
  type: string;
  kind: EventKind;
  /** Epoch seconds. */
  time: number;
  /** False: the row shows the unread dot. */
  isRead: boolean;
  /** The author's trimmed name; null when the API gives none. */
  authorName: string | null;
  /** An http(s) avatar; null when none (or `hasAvatar: false`). */
  avatarUrl: string | null;
  /** The blog that OK opens (passed `blogUrlSchema`); null: OK does nothing. */
  blogUrl: string | null;
};
