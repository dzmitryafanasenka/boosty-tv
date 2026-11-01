/**
 * Story 9.2: the update dialog's states with a fake AppUpdater port (the
 * native download, verification and installer are device checks).
 */
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { t, tf } from '../src/shared/i18n';
import type {
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  InstallOutcome,
  InstallPermission,
} from '../src/shared/platform/appUpdater';
import { createLogger } from '../src/shared/services/logger';
import { requestHostFocus } from '../src/shared/ui/requestHostFocus';
import backHandler from '../src/test/backHandlerMock';
import type { KnownRelease, ReleaseAsset } from '../src/features/update/releaseInfo';
import {
  UPDATE_CANCEL_ID,
  UPDATE_CLOSE_ID,
  UPDATE_INSTALL_ID,
  UPDATE_SETTINGS_ID,
  UpdateDialog,
  type UpdaterPort,
} from '../src/features/update/UpdateDialog';

jest.mock('../src/shared/ui/requestHostFocus', () => ({ requestHostFocus: jest.fn() }));
jest.mock('react-native/Libraries/Utilities/BackHandler', () => require('../src/test/backHandlerMock'));

const mockForegroundListeners = new Set<() => void>();
jest.mock('../src/shared/platform/appLifecycle', () => ({
  subscribeAppForeground: (listener: () => void) => {
    mockForegroundListeners.add(listener);
    return () => mockForegroundListeners.delete(listener);
  },
}));

const DIGEST = 'c'.repeat(64);
const PAGE = 'https://github.com/dzmitryafanasenka/boosty-tv/releases/tag/v0.9.1';

function asset(name: string, overrides: Partial<ReleaseAsset> = {}): ReleaseAsset {
  return {
    name,
    url: `https://github.com/dzmitryafanasenka/boosty-tv/releases/download/v0.9.1/${name}`,
    digest: `sha256:${DIGEST}`,
    size: 2000,
    ...overrides,
  };
}

function release(assets: ReleaseAsset[] = [asset('boosty-tv-0.9.1-armeabi-v7a.apk'), asset('boosty-tv-0.9.1.apk')]): KnownRelease {
  return { tag: 'v0.9.1', version: '0.9.1', pageUrl: PAGE, notes: 'Исправлено воспроизведение', assets };
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeUpdater({ allowed = ['allowed'] as InstallPermission[], abis = ['armeabi-v7a', 'armeabi'], settings = true } = {}) {
  const downloads: { request: DownloadRequest; progress?: (p: DownloadProgress) => void; done: Deferred<DownloadResult> }[] = [];
  const installs: { fileRef: string; done: Deferred<InstallOutcome> }[] = [];
  let allowIndex = 0;
  const port: UpdaterPort & { cancelDownload: jest.Mock; openInstallSettings: jest.Mock } = {
    supportedAbis: () => abis,
    canRequestInstalls: jest.fn(() => Promise.resolve(allowed[Math.min(allowIndex++, allowed.length - 1)])) as UpdaterPort['canRequestInstalls'],
    openInstallSettings: jest.fn(() => Promise.resolve(settings)),
    downloadUpdate: jest.fn((request: DownloadRequest, progress?: (p: DownloadProgress) => void) => {
      const done = deferred<DownloadResult>();
      downloads.push({ request, progress, done });
      return done.promise;
    }),
    cancelDownload: jest.fn(() => {
      downloads[downloads.length - 1]?.done.resolve({ kind: 'failed', reason: 'cancelled' });
    }),
    installUpdate: jest.fn((fileRef: string) => {
      const done = deferred<InstallOutcome>();
      installs.push({ fileRef, done });
      return done.promise;
    }),
  };
  return { port, downloads, installs };
}

/** Every root of the test, unmounted afterwards (their deferred focus requests then stop). */
const roots: Root[] = [];

async function render(element: React.ReactElement): Promise<Root> {
  const root = createRoot();
  roots.push(root);
  await act(async () => {
    root.render(element);
  });
  return root;
}

const focusables = (root: Root) =>
  root.container.queryAll(n => n.props.focusable === true && typeof n.props.testID === 'string').map(n => n.props.testID as string);
const json = (root: Root) => JSON.stringify(root.container.toJSON());
const has = (root: Root, testID: string) => root.container.queryAll(n => n.props.testID === testID).length > 0;
async function press(root: Root, testID: string) {
  const [node] = root.container.queryAll(n => n.props.testID === testID && n.props.focusable === true);
  await act(async () => {
    node.props.onClick({ nativeEvent: {} });
  });
}
const lastFocus = () => {
  const calls = (requestHostFocus as jest.Mock).mock.calls;
  return calls.length ? (calls[calls.length - 1][0] as { props?: { testID?: string } } | null) : undefined;
};
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => {
      try {
        root.unmount();
      } catch {
        // Already unmounted by the test.
      }
    });
  }
});

beforeEach(() => {
  backHandler.reset();
  mockForegroundListeners.clear();
  (requestHostFocus as jest.Mock).mockClear();
});

describe('UpdateDialog (Story 9.2)', () => {
  it('info: title, Russian notes, «Скачать и установить» and «Закрыть»; «Закрыть» has the focus; nothing is downloaded', async () => {
    const { port } = fakeUpdater();
    const onClose = jest.fn();
    const root = await render(<UpdateDialog release={release()} onClose={onClose} updater={port} />);
    expect(json(root)).toContain(tf('update.dialog.title', { version: '0.9.1' }));
    expect(json(root)).toContain('Исправлено воспроизведение');
    expect(focusables(root)).toEqual([UPDATE_INSTALL_ID, UPDATE_CLOSE_ID]);
    const close = root.container.queryAll(n => n.props.testID === UPDATE_CLOSE_ID && n.props.focusable === true)[0];
    expect(close.props.hasTVPreferredFocus).toBe(true);
    expect(port.downloadUpdate).not.toHaveBeenCalled();
    expect(port.canRequestInstalls).not.toHaveBeenCalled();
    expect(has(root, 'dialog/update/qr/code')).toBe(false);
    // Back outside a download: the modal host closes it (not handled here).
    expect(backHandler.pressBack()).toBe(false);
    await press(root, UPDATE_CLOSE_ID);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('matrix «Install, allowed»: progress → verify → the system installer; the per-ABI asset', async () => {
    const { port, downloads, installs } = fakeUpdater();
    const logger = createLogger();
    const root = await render(<UpdateDialog release={release()} onClose={jest.fn()} updater={port} logger={logger} />);
    await press(root, UPDATE_INSTALL_ID);
    await flush();
    expect(downloads).toHaveLength(1);
    expect(downloads[0].request).toEqual({
      name: 'boosty-tv-0.9.1-armeabi-v7a.apk',
      url: 'https://github.com/dzmitryafanasenka/boosty-tv/releases/download/v0.9.1/boosty-tv-0.9.1-armeabi-v7a.apk',
      sha256: DIGEST,
      size: 2000,
    });
    expect(json(root)).toContain(tf('update.dialog.downloading', { percent: '0' }));
    expect(focusables(root)).toEqual([UPDATE_CANCEL_ID]);
    await act(async () => downloads[0].progress?.({ received: 900, total: 2000 }));
    expect(json(root)).toContain(tf('update.dialog.downloading', { percent: '45' }));
    await act(async () => downloads[0].progress?.({ received: 2000, total: 2000 }));
    expect(json(root)).toContain(t('update.dialog.verifying'));
    await act(async () => downloads[0].done.resolve({ kind: 'done', fileRef: 'update.apk' }));
    await flush();
    expect(installs.map(i => i.fileRef)).toEqual(['update.apk']);
    expect(json(root)).toContain(t('update.dialog.installing'));
    // Logs status and reason fields only: no URL, path or digest.
    const logged = JSON.stringify(logger.entries());
    expect(logged).not.toContain('github.com');
    expect(logged).not.toContain(DIGEST);
    expect(logged).not.toContain('update.apk');
  });

  it('matrix «Installer cancelled»: back in the dialog with the reason and the QR', async () => {
    const { port, downloads, installs } = fakeUpdater();
    const root = await render(<UpdateDialog release={release()} onClose={jest.fn()} updater={port} />);
    await press(root, UPDATE_INSTALL_ID);
    await flush();
    await act(async () => downloads[0].done.resolve({ kind: 'done', fileRef: 'update.apk' }));
    await flush();
    await act(async () => installs[0].done.resolve('cancelled'));
    await flush();
    expect(json(root)).toContain(t('update.dialog.failed.installCancelled'));
    expect(has(root, 'dialog/update/qr/code')).toBe(true);
    expect(focusables(root)).toEqual([UPDATE_CLOSE_ID]);
    expect(json(root)).not.toContain(PAGE);
  });

  it('matrix «Digest mismatch» and «Network loss»: the error text and the QR; nothing retried', async () => {
    for (const [reason, message] of [
      ['digest', 'update.dialog.failed.digest'],
      ['network', 'update.dialog.failed.network'],
      ['storage', 'update.dialog.failed.storage'],
    ] as const) {
      const { port, downloads } = fakeUpdater();
      const logger = createLogger();
      const root = await render(<UpdateDialog release={release()} onClose={jest.fn()} updater={port} logger={logger} />);
      await press(root, UPDATE_INSTALL_ID);
      await flush();
      await act(async () => downloads[0].done.resolve({ kind: 'failed', reason }));
      await flush();
      expect(json(root)).toContain(t(message));
      expect(has(root, 'dialog/update/qr/code')).toBe(true);
      expect(port.downloadUpdate).toHaveBeenCalledTimes(1);
      expect(port.installUpdate).not.toHaveBeenCalled();
      expect(logger.entries().filter(e => e.message === 'update download failed')).toEqual([
        expect.objectContaining({ fields: { reason } }),
      ]);
    }
  });

  it('matrix «Cancel»: Back during the download cancels it and the dialog stays', async () => {
    const { port, downloads } = fakeUpdater();
    const onClose = jest.fn();
    const root = await render(<UpdateDialog release={release()} onClose={onClose} updater={port} />);
    await press(root, UPDATE_INSTALL_ID);
    await flush();
    let handled = false;
    await act(async () => {
      handled = backHandler.pressBack();
    });
    await flush();
    expect(handled).toBe(true);
    expect(port.cancelDownload).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(focusables(root)).toEqual([UPDATE_INSTALL_ID, UPDATE_CLOSE_ID]);
    expect(downloads).toHaveLength(1);
    expect(port.installUpdate).not.toHaveBeenCalled();
    // «Отменить» does the same.
    await press(root, UPDATE_INSTALL_ID);
    await flush();
    await press(root, UPDATE_CANCEL_ID);
    await flush();
    expect(port.cancelDownload).toHaveBeenCalledTimes(2);
    expect(focusables(root)).toEqual([UPDATE_INSTALL_ID, UPDATE_CLOSE_ID]);
  });

  it('closing the dialog (e.g. the session expired) during a download cancels it', async () => {
    const { port } = fakeUpdater();
    const root = await render(<UpdateDialog release={release()} onClose={jest.fn()} updater={port} />);
    await press(root, UPDATE_INSTALL_ID);
    await flush();
    await act(async () => root.unmount());
    expect(port.cancelDownload).toHaveBeenCalledTimes(1);
  });

  it('matrix «Not allowed»: the explanation → the system screen → on return allowed → the download', async () => {
    const { port, downloads } = fakeUpdater({ allowed: ['denied', 'allowed'] });
    const root = await render(<UpdateDialog release={release()} onClose={jest.fn()} updater={port} />);
    await press(root, UPDATE_INSTALL_ID);
    await flush();
    expect(json(root)).toContain(t('update.dialog.permission'));
    expect(focusables(root)).toEqual([UPDATE_SETTINGS_ID, UPDATE_CLOSE_ID]);
    expect(downloads).toHaveLength(0);
    await press(root, UPDATE_SETTINGS_ID);
    await flush();
    expect(port.openInstallSettings).toHaveBeenCalledTimes(1);
    await act(async () => {
      for (const listener of [...mockForegroundListeners]) {
        listener();
      }
    });
    await flush();
    expect(downloads).toHaveLength(1);
  });

  it('matrix «Not allowed», still false on return: stays with the QR; a foreground without the settings visit does nothing', async () => {
    const { port, downloads } = fakeUpdater({ allowed: ['denied', 'denied'] });
    const root = await render(<UpdateDialog release={release()} onClose={jest.fn()} updater={port} />);
    await press(root, UPDATE_INSTALL_ID);
    await flush();
    await act(async () => {
      for (const listener of [...mockForegroundListeners]) {
        listener();
      }
    });
    expect(port.canRequestInstalls).toHaveBeenCalledTimes(1);
    await press(root, UPDATE_SETTINGS_ID);
    await flush();
    await act(async () => {
      for (const listener of [...mockForegroundListeners]) {
        listener();
      }
    });
    await flush();
    expect(json(root)).toContain(t('update.dialog.permissionDenied'));
    expect(has(root, 'dialog/update/qr/code')).toBe(true);
    // «Открыть настройки» stays (the focus target stays valid), and it was the last focus request.
    expect(focusables(root)).toEqual([UPDATE_SETTINGS_ID, UPDATE_CLOSE_ID]);
    expect(lastFocus()?.props?.testID).toBe(UPDATE_SETTINGS_ID);
    expect(downloads).toHaveLength(0);
  });

  it('a failed permission check (a native error, not a «no") is an install failure with the QR, not the permission phase', async () => {
    const { port, downloads } = fakeUpdater({ allowed: ['failed'] });
    const root = await render(<UpdateDialog release={release()} onClose={jest.fn()} updater={port} />);
    await press(root, UPDATE_INSTALL_ID);
    await flush();
    expect(json(root)).toContain(t('update.dialog.failed.install'));
    expect(json(root)).not.toContain(t('update.dialog.permission'));
    expect(has(root, 'dialog/update/qr/code')).toBe(true);
    expect(focusables(root)).toEqual([UPDATE_CLOSE_ID]);
    expect(downloads).toHaveLength(0);
  });

  it('a quick second OK on «Скачать и установить» starts one download', async () => {
    const { port, downloads } = fakeUpdater();
    const root = await render(<UpdateDialog release={release()} onClose={jest.fn()} updater={port} />);
    const [node] = root.container.queryAll(n => n.props.testID === UPDATE_INSTALL_ID && n.props.focusable === true);
    await act(async () => {
      node.props.onClick({ nativeEvent: {} });
      node.props.onClick({ nativeEvent: {} });
    });
    await flush();
    expect(port.canRequestInstalls).toHaveBeenCalledTimes(1);
    expect(downloads).toHaveLength(1);
  });

  it('closed during the permission check: no orphan download', async () => {
    const { port, downloads } = fakeUpdater();
    const permission = deferred<InstallPermission>();
    port.canRequestInstalls = jest.fn(() => permission.promise);
    const root = await render(<UpdateDialog release={release()} onClose={jest.fn()} updater={port} />);
    await press(root, UPDATE_INSTALL_ID);
    await act(async () => root.unmount());
    await act(async () => permission.resolve('allowed'));
    await flush();
    expect(downloads).toHaveLength(0);
  });

  it('a cancel at 100 % (verifying) skips the installer and returns to the info phase', async () => {
    const { port, downloads } = fakeUpdater();
    const root = await render(<UpdateDialog release={release()} onClose={jest.fn()} updater={port} />);
    await press(root, UPDATE_INSTALL_ID);
    await flush();
    await act(async () => downloads[0].progress?.({ received: 2000, total: 2000 }));
    expect(json(root)).toContain(t('update.dialog.verifying'));
    // The native side finished the digest just before the cancel arrived.
    port.cancelDownload.mockImplementationOnce(() => {});
    await act(async () => {
      backHandler.pressBack();
    });
    await act(async () => downloads[0].done.resolve({ kind: 'done', fileRef: 'update.apk' }));
    await flush();
    expect(port.cancelDownload).toHaveBeenCalledTimes(1);
    expect(port.installUpdate).not.toHaveBeenCalled();
    expect(focusables(root)).toEqual([UPDATE_INSTALL_ID, UPDATE_CLOSE_ID]);
  });

  it('the installer reports success: the dialog closes', async () => {
    const { port, downloads, installs } = fakeUpdater();
    const onClose = jest.fn();
    const root = await render(<UpdateDialog release={release()} onClose={onClose} updater={port} />);
    await press(root, UPDATE_INSTALL_ID);
    await flush();
    await act(async () => downloads[0].done.resolve({ kind: 'done', fileRef: 'update.apk' }));
    await flush();
    await act(async () => installs[0].done.resolve('installed'));
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the system screen cannot open: the QR', async () => {
    const { port } = fakeUpdater({ allowed: ['denied'], settings: false });
    const root = await render(<UpdateDialog release={release()} onClose={jest.fn()} updater={port} />);
    await press(root, UPDATE_INSTALL_ID);
    await flush();
    await press(root, UPDATE_SETTINGS_ID);
    await flush();
    expect(has(root, 'dialog/update/qr/code')).toBe(true);
  });

  it('matrix «ABI fallback»: no asset for the device ABI → the universal APK', async () => {
    const { port, downloads } = fakeUpdater({ abis: ['x86_64'] });
    const root = await render(<UpdateDialog release={release()} onClose={jest.fn()} updater={port} />);
    await press(root, UPDATE_INSTALL_ID);
    await flush();
    expect(downloads[0].request).toMatchObject({ name: 'boosty-tv-0.9.1.apk' });
  });

  it('matrix «No digest / foreign URL» / no asset: no install button, the QR at once', async () => {
    for (const assets of [
      [asset('boosty-tv-0.9.1.apk', { digest: null })],
      [asset('boosty-tv-0.9.1.apk', { url: 'https://example.com/boosty-tv-0.9.1.apk' })],
      [],
    ]) {
      const { port } = fakeUpdater();
      const root = await render(<UpdateDialog release={release(assets)} onClose={jest.fn()} updater={port} />);
      expect(focusables(root)).toEqual([UPDATE_CLOSE_ID]);
      expect(json(root)).toContain(t('update.dialog.unavailable'));
      expect(has(root, 'dialog/update/qr/code')).toBe(true);
      expect(port.downloadUpdate).not.toHaveBeenCalled();
    }
  });

  it('empty notes: the placeholder text', async () => {
    const { port } = fakeUpdater();
    const root = await render(<UpdateDialog release={{ ...release(), notes: '' }} onClose={jest.fn()} updater={port} />);
    expect(json(root)).toContain(t('update.dialog.noNotes'));
  });

  it('each phase asks focus for its own element', async () => {
    const { port } = fakeUpdater({ allowed: ['denied'] });
    const root = await render(<UpdateDialog release={release()} onClose={jest.fn()} updater={port} />);
    expect(lastFocus()).toBeTruthy();
    (requestHostFocus as jest.Mock).mockClear();
    await press(root, UPDATE_INSTALL_ID);
    await flush();
    expect(requestHostFocus).toHaveBeenCalled();
    expect(lastFocus()).toBeTruthy();
  });
});
