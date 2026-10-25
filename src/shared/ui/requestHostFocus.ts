import type { HostView } from './FocusableSurface';

/**
 * Moves native TV focus to a host view (react-native-tvos `requestTVFocus`,
 * which calls `requestFocus()` natively). A non-focusable container hands
 * focus to its first focusable descendant. For a text field this does not
 * open the keyboard. No-op when the view is gone or not on TV.
 */
export function requestHostFocus(view: HostView | null | undefined): void {
  (view as { requestTVFocus?: () => void } | null | undefined)?.requestTVFocus?.();
}
