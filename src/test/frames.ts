/**
 * A manual animation-frame queue for tests that count frames (focus
 * deferrals: `focusSoon`, the poll hand-off, the Author QR open). The RN
 * Jest preset's `requestAnimationFrame` is a 0 ms timeout, and a fake-timer
 * advance runs a chain of them in one go, so these tests queue the frames
 * here instead. Each frame runs only the callbacks queued before it.
 *
 * Call `installFrameQueue()` in a test or `beforeEach`; it spies on
 * `requestAnimationFrame` / `cancelAnimationFrame`, so the file's
 * `jest.restoreAllMocks()` removes it. Each callback gets `Date.now()` as
 * its timestamp (the per-file copies this replaces passed 0; no app code
 * reads it). Test-only (eslint `boundaries`).
 */
import { act } from 'react';

let queue = new Map<number, (time: number) => void>();
let nextId = 1;

/** Replaces `requestAnimationFrame` / `cancelAnimationFrame` with the queue (emptied). */
export function installFrameQueue(): void {
  queue = new Map();
  nextId = 1;
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: (time: number) => void) => {
    const id = nextId++;
    queue.set(id, callback);
    return id;
  });
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id?: number | null) => {
    if (id !== undefined && id !== null) {
      queue.delete(id);
    }
  });
}

/** Runs one frame synchronously: the callbacks queued before this call. */
export function frame(): void {
  const due = [...queue.values()];
  queue.clear();
  for (const callback of due) {
    callback(Date.now());
  }
}

/** Runs `n` frames, each in its own `act()` (then a resolved promise, so effects and renders settle). */
export async function frames(n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await act(async () => {
      frame();
      await Promise.resolve();
    });
  }
}

/** The number of queued frame callbacks. */
export function queuedFrames(): number {
  return queue.size;
}
