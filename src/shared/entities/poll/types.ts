/**
 * The Poll entity (Story 6.5, FR40, POLL-01/05; api-contract §4.2). Ids are
 * strings (the API sends numbers). The poll lives inside its cached Post:
 * there is no separate poll query key (epic 6 «Poll state»).
 */

export type PollOption = {
  /** The option's identity (keys, `answer`); never an index. */
  id: string;
  /** Empty when the API gives none. */
  text: string;
  /** Votes for this option. */
  counter: number;
  /** The option's share in percent, as the API gives it (live: an integer). */
  fraction: number;
};

export type Poll = {
  id: string;
  /** The `title` strings joined with «, » (the reference's `joinToString()`). */
  title: string;
  isMultiple: boolean;
  isFinished: boolean;
  /** Voters; 0 when the API gives none (the reference's default). */
  counter: number;
  /** The user's chosen option ids; empty before a vote (live: no `answer` key). */
  answer: string[];
  /** Never empty. */
  options: PollOption[];
};
