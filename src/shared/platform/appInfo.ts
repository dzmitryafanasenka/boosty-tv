import { NativeModules } from 'react-native';

/**
 * App build facts from the app-local native module `AppInfo`
 * (android/.../AppInfoModule.kt). Constants are read synchronously.
 */

type AppInfoNative = { versionName?: unknown };

/** The native `versionName` (android/app/build.gradle), or null if unknown. */
export function getVersionName(): string | null {
  const native = (NativeModules as { AppInfo?: AppInfoNative }).AppInfo;
  const value = native?.versionName;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
