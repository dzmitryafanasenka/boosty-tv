import { DeviceEventEmitter, NativeModules } from 'react-native';

/**
 * The AppUpdater port (Story 9.2, FR-56, UPD-02, AD-2): downloads one
 * release APK into the app's private cache, verifies its SHA-256 and hands
 * it to the Android system installer (android/.../AppUpdaterModule.kt).
 * Nothing here starts on its own: the update dialog calls it only after an
 * explicit OK on «Скачать и установить», and the system installer asks
 * the user again. No PackageInstaller session, no silent install, no retry.
 *
 * - `supportedAbis()` is `Build.SUPPORTED_ABIS` (device order);
 * - `canRequestInstalls()` is `PackageManager.canRequestPackageInstalls()`;
 * - `openInstallSettings()` opens «Установка неизвестных приложений» for
 *   this package (`Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES`);
 * - `downloadUpdate()` runs one download at a time (a second one is
 *   `busy`), only from this repository's release URLs over HTTPS (the
 *   native side checks the URL again and every redirect), and reports
 *   progress; a cancel, a failure or a digest mismatch deletes the file;
 * - `installUpdate()` launches `ACTION_INSTALL_PACKAGE` with a FileProvider
 *   content URI and resolves with the installer's answer;
 * - `cleanupUpdates()` deletes old update files (on every start).
 *
 * The URL, the file path and the digests are never logged or returned; a
 * native rejection carries a fixed code only, its message is dropped.
 */

export type DownloadFailure =
  | 'busy'
  | 'cancelled'
  | 'network'
  | 'digest'
  | 'size'
  | 'url'
  | 'storage'
  | 'unavailable';

export type DownloadResult = { kind: 'done'; fileRef: string } | { kind: 'failed'; reason: DownloadFailure };

/** `installed`: the installer reported success (usually the app is replaced first and this never arrives). */
export type InstallOutcome = 'installed' | 'cancelled' | 'failed' | 'unavailable';

export type DownloadRequest = {
  url: string;
  /** Lowercase hex. */
  sha256: string;
  size: number;
};

export type DownloadProgress = { received: number; total: number };

type AppUpdaterNative = {
  supportedAbis?: unknown;
  canRequestInstalls?: () => Promise<unknown>;
  openInstallSettings?: () => Promise<unknown>;
  download?: (url: string, sha256: string, size: number) => Promise<unknown>;
  cancel?: () => void;
  install?: (fileRef: string) => Promise<unknown>;
  cleanup?: () => Promise<unknown>;
};

/** The native progress event (`{received, total}` in bytes). */
export const APP_UPDATER_PROGRESS_EVENT = 'appUpdaterProgress';

const native = () => (NativeModules as { AppUpdater?: AppUpdaterNative }).AppUpdater;

const FAILURE_CODES: Readonly<Record<string, DownloadFailure>> = {
  E_BUSY: 'busy',
  E_CANCELLED: 'cancelled',
  E_NETWORK: 'network',
  E_DIGEST: 'digest',
  E_SIZE: 'size',
  E_URL: 'url',
  E_STORAGE: 'storage',
};

/** The native module is present (Android builds). */
export function appUpdaterAvailable(): boolean {
  const module = native();
  return typeof module?.download === 'function' && typeof module?.install === 'function';
}

/** `Build.SUPPORTED_ABIS` in the device's order; [] when unknown. */
export function supportedAbis(): string[] {
  const value = native()?.supportedAbis;
  return Array.isArray(value) ? value.filter((abi): abi is string => typeof abi === 'string' && abi.length > 0) : [];
}

/**
 * Whether this app may ask the system installer to install: `allowed`,
 * `denied` (the user can grant it in the system screen), or `failed` (no
 * module, or the native call rejected: not a permission matter).
 */
export type InstallPermission = 'allowed' | 'denied' | 'failed';

export async function canRequestInstalls(): Promise<InstallPermission> {
  const call = native()?.canRequestInstalls;
  if (typeof call !== 'function') {
    return 'failed';
  }
  try {
    return (await call()) === true ? 'allowed' : 'denied';
  } catch {
    return 'failed';
  }
}

/** Opens the system «Установка неизвестных приложений» screen for this app; false when it could not. */
export async function openInstallSettings(): Promise<boolean> {
  const call = native()?.openInstallSettings;
  if (typeof call !== 'function') {
    return false;
  }
  try {
    return (await call()) === 'opened';
  } catch {
    return false;
  }
}

function failureOf(error: unknown): DownloadFailure {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && code in FAILURE_CODES ? FAILURE_CODES[code] : 'network';
}

/** Downloads and verifies the APK; `onProgress` gets byte counts until it settles. */
export async function downloadUpdate(
  request: DownloadRequest,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<DownloadResult> {
  const module = native();
  if (typeof module?.download !== 'function') {
    return { kind: 'failed', reason: 'unavailable' };
  }
  const sub = onProgress
    ? DeviceEventEmitter.addListener(APP_UPDATER_PROGRESS_EVENT, (raw: unknown) => {
        const event = raw as { received?: unknown; total?: unknown } | null;
        if (event && typeof event.received === 'number' && typeof event.total === 'number') {
          onProgress({ received: event.received, total: event.total });
        }
      })
    : null;
  try {
    const fileRef = await module.download(request.url, request.sha256, request.size);
    return typeof fileRef === 'string' && fileRef.length > 0
      ? { kind: 'done', fileRef }
      : { kind: 'failed', reason: 'storage' };
  } catch (error) {
    return { kind: 'failed', reason: failureOf(error) };
  } finally {
    sub?.remove();
  }
}

/** Stops the running download (its promise then fails with `cancelled` and the file is deleted). */
export function cancelDownload(): void {
  try {
    native()?.cancel?.();
  } catch {
    // Nothing is running or the module is gone: nothing to cancel.
  }
}

/** Opens the system installer for a downloaded file and resolves with its answer. */
export async function installUpdate(fileRef: string): Promise<InstallOutcome> {
  const install = native()?.install;
  if (typeof install !== 'function') {
    return 'unavailable';
  }
  try {
    const outcome = await install(fileRef);
    return outcome === 'installed' || outcome === 'cancelled' ? outcome : 'failed';
  } catch {
    return 'failed';
  }
}

/** Deletes every update file in the cache (start-up). Never rejects. */
export async function cleanupUpdates(): Promise<void> {
  try {
    await native()?.cleanup?.();
  } catch {
    // A file left behind is deleted on the next start.
  }
}
