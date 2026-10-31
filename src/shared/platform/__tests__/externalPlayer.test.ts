import { NativeModules } from 'react-native';
import { externalPlayerAvailable, openExternalPlayer } from '../externalPlayer';

const native = NativeModules as Record<string, unknown>;
const REQUEST = { url: 'https://cdn.example.invalid/v.mp4?sign=secret', title: 'Видео', chooserTitle: 'Открыть в' };

afterEach(() => {
  delete native.ExternalPlayer;
});

describe('externalPlayer (Story 8.2)', () => {
  it('without the native module: not available, and opening is `none`', async () => {
    expect(externalPlayerAvailable()).toBe(false);
    await expect(openExternalPlayer(REQUEST)).resolves.toBe('none');
  });

  it('passes the URL, the title and the chooser title to the module; `opened` is passed through', async () => {
    const open = jest.fn().mockResolvedValue('opened');
    native.ExternalPlayer = { open };
    expect(externalPlayerAvailable()).toBe(true);
    await expect(openExternalPlayer(REQUEST)).resolves.toBe('opened');
    expect(open).toHaveBeenCalledWith(REQUEST.url, REQUEST.title, REQUEST.chooserTitle);
  });

  it('`none` from the module (only this app or the TV stub resolves) is `none`', async () => {
    native.ExternalPlayer = { open: jest.fn().mockResolvedValue('none') };
    await expect(openExternalPlayer(REQUEST)).resolves.toBe('none');
  });

  it('an unknown answer or a rejection is `none` (never thrown)', async () => {
    native.ExternalPlayer = { open: jest.fn().mockResolvedValue('maybe') };
    await expect(openExternalPlayer(REQUEST)).resolves.toBe('none');
    native.ExternalPlayer = { open: jest.fn().mockRejectedValue(new Error(`ActivityNotFound ${REQUEST.url}`)) };
    await expect(openExternalPlayer(REQUEST)).resolves.toBe('none');
  });

  it('a module without `open` is not available', async () => {
    native.ExternalPlayer = {};
    expect(externalPlayerAvailable()).toBe(false);
    await expect(openExternalPlayer(REQUEST)).resolves.toBe('none');
  });
});
