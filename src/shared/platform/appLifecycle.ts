import { AppState } from 'react-native';

/**
 * A minimal AppLifecycle port (Stories 4.2, 4.6): the app went to the
 * background (device sleep included: the activity stops) and came back to
 * the foreground. Features subscribe here instead of importing `AppState`.
 * Audio-focus loss comes from the engine (`PlayerEngine.onAudioFocusLost`),
 * which owns the audio focus request.
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

/** Calls `listener` every time the app returns to the foreground after leaving it. Returns the unsubscribe function. */
export function subscribeAppForeground(listener: () => void): () => void {
  let last: string | null | undefined = AppState.currentState;
  const sub = AppState.addEventListener('change', state => {
    const previous = last;
    last = state;
    if (state === 'active' && (previous === 'background' || previous === 'inactive')) {
      listener();
    }
  });
  return () => sub.remove();
}
