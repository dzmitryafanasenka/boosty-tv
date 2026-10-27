import { DeviceEventEmitter, NativeModules } from 'react-native';

/**
 * Hold-to-seek keys (Story 4.1, owner decision): the app-local native module
 * `SeekKeys` (android/.../SeekKeysModule.kt) forwards D-pad left/right key
 * down (with Android's repeat count) and key up as the `seekKey` device
 * event while a subscriber is active. React Native itself delivers these
 * keys to JS only as key up on the pinned remote. Without the module (tests,
 * other platforms) subscribing does nothing.
 */

export type SeekKeyEvent = {
  key: 'left' | 'right';
  action: 'down' | 'up';
  /** Android `KeyEvent.repeatCount`: 0 for the first key down of a press. */
  repeat: number;
};

type SeekKeysNative = { setEnabled?: (enabled: boolean) => void };

const native = () => (NativeModules as { SeekKeys?: SeekKeysNative }).SeekKeys;

let subscribers = 0;

function parse(raw: unknown): SeekKeyEvent | null {
  const e = raw as { key?: unknown; action?: unknown; repeat?: unknown } | null;
  if (
    !e ||
    (e.key !== 'left' && e.key !== 'right') ||
    (e.action !== 'down' && e.action !== 'up')
  ) {
    return null;
  }
  const repeat = typeof e.repeat === 'number' && Number.isFinite(e.repeat) ? e.repeat : 0;
  return { key: e.key, action: e.action, repeat };
}

/** Forward seek keys to `listener` until the returned function is called. */
export function subscribeSeekKeys(listener: (event: SeekKeyEvent) => void): () => void {
  const module = native();
  if (!module?.setEnabled) {
    return () => {};
  }
  const sub = DeviceEventEmitter.addListener('seekKey', (raw: unknown) => {
    const event = parse(raw);
    if (event) {
      listener(event);
    }
  });
  subscribers += 1;
  module.setEnabled(true);
  let active = true;
  return () => {
    if (!active) {
      return;
    }
    active = false;
    sub.remove();
    subscribers -= 1;
    if (subscribers === 0) {
      module.setEnabled?.(false);
    }
  };
}
