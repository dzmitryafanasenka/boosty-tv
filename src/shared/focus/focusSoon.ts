import type { HostView } from '../ui/FocusableSurface';
import { requestHostFocus } from '../ui/requestHostFocus';

export type FocusSoonOptions = {
  /** Run now as well (default true). The guard never applies to this call. */
  now?: boolean;
  /** Frames to wait before the deferred run (default 2; clamped to an integer ≥ 1). */
  frames?: number;
  /** Checked at the deferred run only: false skips it (focus moved meanwhile, a modal opened…). */
  guard?: () => boolean;
};

/**
 * Runs `action` now and again `frames` frames later (default: now + 2
 * frames); returns the cancel, which stops the pending frames (callers that
 * never cancelled may ignore it). The scheduler behind `focusSoon`, for a
 * caller that moves focus itself (PostScreen's helpers).
 */
export function focusSoonRun(
  action: () => void,
  { now = true, frames = 2, guard }: FocusSoonOptions = {},
): () => void {
  const total = Number.isFinite(frames) ? Math.max(1, Math.floor(frames)) : 1;
  // Declared before the first schedule: a requestAnimationFrame that calls
  // back synchronously must not reach it in its temporal dead zone.
  let frame = 0;
  let cancelled = false;
  if (now) {
    action();
  }
  let remaining = total;
  const step = () => {
    if (cancelled) {
      return;
    }
    remaining -= 1;
    if (remaining > 0) {
      frame = requestAnimationFrame(step);
      return;
    }
    if (guard === undefined || guard()) {
      action();
    }
  };
  frame = requestAnimationFrame(step);
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
  };
}

/**
 * Focus a view now and again `frames` frames later (default: now + 2
 * frames). The device lessons behind it: a focus request sent in the same
 * commit as the focused view's unmount is lost (ModalHost, Story 2.4;
 * PostScreen, Story 6.7), and Android drops a request to a view with no
 * layout yet (Story 6.7, the author's LiveCard in Story 7.1). Two frames
 * later the native side has caught up and the request sticks.
 *
 * `view` is resolved at each run; null is still sent (a no-op natively), as
 * the sites did before. Returns the cancel (see `focusSoonRun`).
 */
export function focusSoon(view: () => HostView | null, options?: FocusSoonOptions): () => void {
  return focusSoonRun(() => requestHostFocus(view()), options);
}
