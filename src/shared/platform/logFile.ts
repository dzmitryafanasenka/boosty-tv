import { NativeModules } from 'react-native';

/**
 * The LogFile port (Story 8.3, SET-05, AD-2): the capped diagnostics log
 * file written by `android/.../LogFileModule.kt` in app-specific external
 * storage (`files/logs/boostytv.log`, rotated `boostytv.log.1`, 256 KB
 * each), pulled over adb. Only `src/shared/services/logFileSink.ts` uses it.
 *
 * The native side runs every call on one serial thread in call order, so a
 * `clear` made after an `append` wins. The native method is called
 * synchronously inside each function (before any `await`), so the order of
 * the calls here is the order of the native calls.
 *
 * The lines are already redacted. Nothing here logs them, and a native
 * rejection's message is dropped unread (it may hold a path).
 */

export type LogFilePort = {
  /** Appends one line per entry. Rejects when there is no module or the write failed. */
  append(lines: readonly string[]): Promise<void>;
  /** Deletes the file and its rotated copy. No module: nothing to clear (resolves). Rejects when a delete failed. */
  clear(): Promise<void>;
  /** The log directory on the device, or null (no module, no storage, a failure). */
  location(): Promise<string | null>;
};

type LogFileNative = {
  append?: (lines: string[]) => Promise<unknown>;
  clear?: () => Promise<unknown>;
  location?: () => Promise<unknown>;
};

const native = () => (NativeModules as { LogFile?: LogFileNative }).LogFile;

export async function appendLogLines(lines: readonly string[]): Promise<void> {
  const append = native()?.append;
  if (typeof append !== 'function') {
    throw new Error('log file: unavailable');
  }
  try {
    await append([...lines]);
  } catch {
    throw new Error('log file: append failed');
  }
}

export async function clearLogFile(): Promise<void> {
  const clear = native()?.clear;
  if (typeof clear !== 'function') {
    return;
  }
  try {
    await clear();
  } catch {
    throw new Error('log file: clear failed');
  }
}

export async function logFileLocation(): Promise<string | null> {
  const location = native()?.location;
  if (typeof location !== 'function') {
    return null;
  }
  try {
    const path = await location();
    return typeof path === 'string' && path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/** The app's log file. */
export const logFile: LogFilePort = {
  append: appendLogLines,
  clear: clearLogFile,
  location: logFileLocation,
};
