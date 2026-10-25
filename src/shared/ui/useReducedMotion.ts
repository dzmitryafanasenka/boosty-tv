import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * True while the system «reduce motion» setting is on. Starts false (motion
 * on) and stays false if the query rejects; a later change event wins over a
 * slow initial query.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let active = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      enabled => {
        changed = true;
        if (active) {
          setReduced(enabled);
        }
      },
    );
    AccessibilityInfo.isReduceMotionEnabled().then(
      enabled => {
        if (active && !changed) {
          setReduced(enabled);
        }
      },
      () => {
        // Keep motion on when the setting cannot be read.
      },
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
