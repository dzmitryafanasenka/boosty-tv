import { AppState } from 'react-native';

/**
 * A minimal AppLifecycle port (Story 4.2): the app went to the background.
 * Features subscribe here instead of importing `AppState`; Story 4.6 adds
 * foreground and audio-focus loss.
 */

/** Calls `listener` every time the app leaves the foreground. Returns the unsubscribe function. */
export function subscribeAppBackground(listener: () => void): () => void {
  let last: string | null | undefined = AppState.currentState;
  const sub = AppState.addEventListener('change', state => {
    const previous = last;
    last = state;
    if (state === 'background' && previous !== 'background') {
      listener();
    }
  });
  return () => sub.remove();
}
