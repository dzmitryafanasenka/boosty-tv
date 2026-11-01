import { DeviceEventEmitter, NativeModules } from 'react-native';
import {
  APP_UPDATER_PROGRESS_EVENT,
  appUpdaterAvailable,
  canRequestInstalls,
  cancelDownload,
  cleanupUpdates,
  downloadUpdate,
  installUpdate,
  openInstallSettings,
  supportedAbis,
} from '../appUpdater';

const native = NativeModules as Record<string, unknown>;
const REQUEST = {
  url: 'https://github.com/dzmitryafanasenka/boosty-tv/releases/download/v0.9.1/boosty-tv-0.9.1.apk',
  sha256: 'e'.repeat(64),
  size: 1000,
};

function rejection(code: string) {
  return Object.assign(new Error(`message with ${REQUEST.url}`), { code });
}

afterEach(() => {
  delete native.AppUpdater;
});

describe('the AppUpdater port (Story 9.2)', () => {
  it('without the native module: nothing available, nothing installed, nothing thrown', async () => {
    expect(appUpdaterAvailable()).toBe(false);
    expect(supportedAbis()).toEqual([]);
    await expect(canRequestInstalls()).resolves.toBe('failed');
    await expect(openInstallSettings()).resolves.toBe(false);
    await expect(downloadUpdate(REQUEST)).resolves.toEqual({ kind: 'failed', reason: 'unavailable' });
    await expect(installUpdate('update.apk')).resolves.toBe('unavailable');
    expect(() => cancelDownload()).not.toThrow();
    await expect(cleanupUpdates()).resolves.toBeUndefined();
  });

  it('passes the request on and reports progress until it settles', async () => {
    let finish!: (value: unknown) => void;
    const download = jest.fn(() => new Promise(resolve => (finish = resolve)));
    native.AppUpdater = { supportedAbis: ['arm64-v8a', 'armeabi-v7a', 7], download, install: jest.fn(), cancel: jest.fn() };
    expect(appUpdaterAvailable()).toBe(true);
    expect(supportedAbis()).toEqual(['arm64-v8a', 'armeabi-v7a']);
    const progress = jest.fn();
    const result = downloadUpdate(REQUEST, progress);
    expect(download).toHaveBeenCalledWith(REQUEST.url, REQUEST.sha256, REQUEST.size);
    DeviceEventEmitter.emit(APP_UPDATER_PROGRESS_EVENT, { received: 10, total: 1000 });
    DeviceEventEmitter.emit(APP_UPDATER_PROGRESS_EVENT, { received: 'x' });
    finish('update.apk');
    await expect(result).resolves.toEqual({ kind: 'done', fileRef: 'update.apk' });
    DeviceEventEmitter.emit(APP_UPDATER_PROGRESS_EVENT, { received: 20, total: 1000 });
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith({ received: 10, total: 1000 });
  });

  it('maps the native codes; the message (it may hold the URL) is dropped', async () => {
    for (const [code, reason] of [
      ['E_BUSY', 'busy'],
      ['E_CANCELLED', 'cancelled'],
      ['E_NETWORK', 'network'],
      ['E_DIGEST', 'digest'],
      ['E_SIZE', 'size'],
      ['E_URL', 'url'],
      ['E_STORAGE', 'storage'],
      ['E_OTHER', 'network'],
    ]) {
      native.AppUpdater = { download: jest.fn(() => Promise.reject(rejection(code))), install: jest.fn() };
      const result = await downloadUpdate(REQUEST);
      expect(result).toEqual({ kind: 'failed', reason });
      expect(JSON.stringify(result)).not.toContain('github.com');
    }
  });

  it('install answers; a rejection is a failure', async () => {
    for (const [answer, outcome] of [
      ['installed', 'installed'],
      ['cancelled', 'cancelled'],
      ['failed', 'failed'],
      ['junk', 'failed'],
    ]) {
      native.AppUpdater = { download: jest.fn(), install: jest.fn(() => Promise.resolve(answer)) };
      await expect(installUpdate('update.apk')).resolves.toBe(outcome);
    }
    native.AppUpdater = { download: jest.fn(), install: jest.fn(() => Promise.reject(rejection('E_INSTALL'))) };
    await expect(installUpdate('update.apk')).resolves.toBe('failed');
  });

  it('the permission: true is allowed, false denied, a rejection failed; the settings screen only on `opened`', async () => {
    native.AppUpdater = {
      canRequestInstalls: jest.fn(() => Promise.resolve(true)),
      openInstallSettings: jest.fn(() => Promise.resolve('none')),
    };
    await expect(canRequestInstalls()).resolves.toBe('allowed');
    await expect(openInstallSettings()).resolves.toBe(false);
    native.AppUpdater = {
      canRequestInstalls: jest.fn(() => Promise.reject(rejection('E_INSTALL'))),
      openInstallSettings: jest.fn(() => Promise.resolve('opened')),
    };
    // A rejection is not a permission answer.
    await expect(canRequestInstalls()).resolves.toBe('failed');
    await expect(openInstallSettings()).resolves.toBe(true);
    native.AppUpdater = { canRequestInstalls: jest.fn(() => Promise.resolve(false)) };
    await expect(canRequestInstalls()).resolves.toBe('denied');
  });
});
