/**
 * PlaybackArbiter (AD-19): one playback slot app-wide. Whoever starts
 * playing claims the slot; the previous holder is stopped first. Story 4.1's
 * player is the first holder; Epic 6's AudioBlock and Epic 7's live player
 * claim the same slot. Pure TypeScript, no native calls.
 */

export type PlaybackHolder = {
  /** Stop (pause) playback: another holder took the slot. */
  stop(): void;
};

export type PlaybackArbiter = {
  /**
   * Take the slot: the current holder (if another one) is stopped. Returns
   * the release function; a release by a holder that already lost the slot
   * does nothing.
   */
  claim(holder: PlaybackHolder): () => void;
  /** The current holder, if any. */
  current(): PlaybackHolder | null;
};

export function createPlaybackArbiter(): PlaybackArbiter {
  let holder: PlaybackHolder | null = null;
  return {
    claim(next) {
      const previous = holder;
      holder = next;
      if (previous !== null && previous !== next) {
        previous.stop();
      }
      return () => {
        if (holder === next) {
          holder = null;
        }
      };
    },
    current: () => holder,
  };
}

/** The app-wide slot. */
export const playbackArbiter = createPlaybackArbiter();
