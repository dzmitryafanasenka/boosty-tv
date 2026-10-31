import { NativeModules } from 'react-native';
import { externalPlayerAvailable, launchExternalPlayer, prepareExternalPlayer } from '../externalPlayer';

const native = NativeModules as Record<string, unknown>;
const REQUEST = { url: 'https://cdn.example.invalid/v.mp4?sign=secret', title: 'Видео', chooserTitle: 'Открыть в' };

afterEach(() => {
  delete native.ExternalPlayer;
});

describe('externalPlayer (Story 8.2)', () => {
  it('without the native module: not available; prepare and launch are `none`', async () => {
    expect(externalPlayerAvailable()).toBe(false);
    await expect(prepareExternalPlayer(REQUEST)).resolves.toBe('none');
    await expect(launchExternalPlayer()).resolves.toBe('none');
  });

  it('prepare passes the URL, the title and the chooser title; `ready` then `opened` are passed through', async () => {
    const prepare = jest.fn().mockResolvedValue('ready');
    const launch = jest.fn().mockResolvedValue('opened');
    native.ExternalPlayer = { prepare, launch };
    expect(externalPlayerAvailable()).toBe(true);
    await expect(prepareExternalPlayer(REQUEST)).resolves.toBe('ready');
    expect(prepare).toHaveBeenCalledWith(REQUEST.url, REQUEST.title, REQUEST.chooserTitle);
    expect(launch).not.toHaveBeenCalled();
    await expect(launchExternalPlayer()).resolves.toBe('opened');
    expect(launch).toHaveBeenCalledWith();
  });

  it('`none` from prepare (only this app or the TV stub) or from launch (nothing prepared) is `none`', async () => {
    native.ExternalPlayer = { prepare: jest.fn().mockResolvedValue('none'), launch: jest.fn().mockResolvedValue('none') };
    await expect(prepareExternalPlayer(REQUEST)).resolves.toBe('none');
    await expect(launchExternalPlayer()).resolves.toBe('none');
  });

  it('an unknown answer or a rejection is `none` (never thrown)', async () => {
    native.ExternalPlayer = { prepare: jest.fn().mockResolvedValue('maybe'), launch: jest.fn().mockResolvedValue('maybe') };
    await expect(prepareExternalPlayer(REQUEST)).resolves.toBe('none');
    await expect(launchExternalPlayer()).resolves.toBe('none');
    const error = new Error(`ActivityNotFound ${REQUEST.url}`);
    native.ExternalPlayer = { prepare: jest.fn().mockRejectedValue(error), launch: jest.fn().mockRejectedValue(error) };
    await expect(prepareExternalPlayer(REQUEST)).resolves.toBe('none');
    await expect(launchExternalPlayer()).resolves.toBe('none');
  });

  it('a module without both methods is not available; prepare is `none`', async () => {
    native.ExternalPlayer = { prepare: jest.fn().mockResolvedValue('ready') };
    expect(externalPlayerAvailable()).toBe(false);
    await expect(prepareExternalPlayer(REQUEST)).resolves.toBe('none');
  });
});
