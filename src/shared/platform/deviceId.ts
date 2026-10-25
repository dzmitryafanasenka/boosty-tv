import { NativeModules } from 'react-native';

/**
 * Install-scoped `device_id` (UUIDv4) from the app-local native module
 * `InstallId` (android/.../InstallIdModule.kt). Device-scoped: created once
 * per install, survives sign-out. Not a secret, but it identifies the
 * install, so it is never logged.
 */

type InstallIdNative = { getOrCreate(): Promise<string> };

let cached: Promise<string> | null = null;

function nativeModule(): InstallIdNative | undefined {
  return (NativeModules as { InstallId?: InstallIdNative }).InstallId;
}

/** Memoized; a failed read is not cached, so the next call tries again. */
export function getDeviceId(): Promise<string> {
  if (!cached) {
    const native = nativeModule();
    if (!native) {
      return Promise.reject(new Error('InstallId native module not linked'));
    }
    cached = native.getOrCreate().then(
      id => {
        if (typeof id !== 'string' || id.length === 0) {
          throw new Error('InstallId returned an empty id');
        }
        return id;
      },
    );
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

/** Test-only: forget the memoized id. */
export function resetDeviceIdForTests(): void {
  cached = null;
}
