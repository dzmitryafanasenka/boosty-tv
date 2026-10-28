import { DeviceEventEmitter, NativeModules } from 'react-native';
import { parseSeekKey, seekKeysAvailable, subscribeSeekKeys } from '../seekKeys';

const native = NativeModules as Record<string, unknown>;

afterEach(() => {
  delete native.SeekKeys;
});

describe('seekKeys (Story 4.1; ↑ ↓ added in Story 5.4)', () => {
  it('parses left, right, up and down key downs and key ups with the repeat count', () => {
    for (const key of ['left', 'right', 'up', 'down'] as const) {
      expect(parseSeekKey({ key, action: 'down', repeat: 3 })).toEqual({ key, action: 'down', repeat: 3 });
      expect(parseSeekKey({ key, action: 'up', repeat: 0 })).toEqual({ key, action: 'up', repeat: 0 });
    }
    // A missing or bad repeat count is 0.
    expect(parseSeekKey({ key: 'up', action: 'down' })).toEqual({ key: 'up', action: 'down', repeat: 0 });
    expect(parseSeekKey({ key: 'up', action: 'down', repeat: NaN })?.repeat).toBe(0);
  });

  it('rejects malformed events', () => {
    expect(parseSeekKey(null)).toBeNull();
    expect(parseSeekKey({ key: 'select', action: 'down', repeat: 0 })).toBeNull();
    expect(parseSeekKey({ key: 'up', action: 'long', repeat: 0 })).toBeNull();
  });

  it('without the native module: not available, subscribing does nothing', () => {
    expect(seekKeysAvailable()).toBe(false);
    const listener = jest.fn();
    const unsubscribe = subscribeSeekKeys(listener);
    DeviceEventEmitter.emit('seekKey', { key: 'up', action: 'down', repeat: 0 });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('with the module: enabled while a subscriber listens; every subscriber gets ↑ ↓ too', () => {
    const setEnabled = jest.fn();
    native.SeekKeys = { setEnabled };
    expect(seekKeysAvailable()).toBe(true);
    const a = jest.fn();
    const b = jest.fn();
    const offA = subscribeSeekKeys(a);
    const offB = subscribeSeekKeys(b);
    expect(setEnabled).toHaveBeenLastCalledWith(true);
    DeviceEventEmitter.emit('seekKey', { key: 'down', action: 'down', repeat: 1 });
    expect(a).toHaveBeenCalledWith({ key: 'down', action: 'down', repeat: 1 });
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    expect(setEnabled).not.toHaveBeenLastCalledWith(false);
    offB();
    expect(setEnabled).toHaveBeenLastCalledWith(false);
  });
});
