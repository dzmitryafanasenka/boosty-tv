import { NativeModules } from 'react-native';
import type { StorageResetHelper } from './spikeSecureStore';

/**
 * Story 1.3 spike only. JS access to the app-local native modules registered
 * by BoostyNativePackage (android/app/src/main/java/.../boostytv).
 */

type KeychainStorageResetNative = { deleteKeychainStorage(): Promise<boolean> };
type InstallIdNative = { getOrCreate(): Promise<string> };

const native = NativeModules as {
  KeychainStorageReset?: KeychainStorageResetNative;
  InstallId?: InstallIdNative;
};

export const keychainStorageReset: StorageResetHelper = {
  deleteKeychainStorage() {
    if (!native.KeychainStorageReset) {
      return Promise.reject(new Error('KeychainStorageReset not linked'));
    }
    return native.KeychainStorageReset.deleteKeychainStorage();
  },
};

let installId: Promise<string> | null = null;

/** Install-scoped UUIDv4 `device_id`, generated once per install. */
export function getInstallId(): Promise<string> {
  if (!native.InstallId) {
    return Promise.reject(new Error('InstallId not linked'));
  }
  if (!installId) {
    installId = native.InstallId.getOrCreate().catch(error => {
      installId = null;
      throw error;
    });
  }
  return installId;
}
