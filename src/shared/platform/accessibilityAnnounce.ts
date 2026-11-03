import { AccessibilityInfo } from 'react-native';

/**
 * Story 14.2: a one-off screen-reader announcement (TalkBack). The narrow
 * adapter over `AccessibilityInfo.announceForAccessibility`; a no-op when no
 * screen reader runs.
 */
export function announceForAccessibility(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
}
