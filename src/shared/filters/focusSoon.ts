import { requestHostFocus, type HostView } from '../ui';

/**
 * Focus a view now and again two frames later (the modal host's device
 * lesson: a request in the same commit as an unmount can be lost). Returns
 * the cleanup that cancels the repeat.
 */
export function focusSoon(view: () => HostView | null): () => void {
  requestHostFocus(view());
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => requestHostFocus(view()));
  });
  return () => cancelAnimationFrame(frame);
}
