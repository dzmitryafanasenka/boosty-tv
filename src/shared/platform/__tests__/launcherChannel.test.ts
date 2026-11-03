import { NativeModules } from 'react-native';
import {
  launcherChannelAvailable,
  syncLauncherChannel,
  takeLauncherOpen,
  type LauncherCard,
} from '../launcherChannel';

const native = NativeModules as Record<string, unknown>;
const REF = { blogUrl: 'blog', postId: 'p1', mediaId: 'm1' };
const CARDS: LauncherCard[] = [
  { kind: 'media', title: 'Урок 1', description: 'Автор', posterUrl: 'https://img.example.invalid/1.jpg', ref: REF },
  { kind: 'media', title: 'Урок 2', description: '', posterUrl: null, ref: { ...REF, mediaId: 'm2' } },
];

afterEach(() => {
  delete native.LauncherChannel;
});

describe('launcherChannel port (Story 12.5)', () => {
  it('without the native module: not available; sync is `unsupported`; no pending open', async () => {
    expect(launcherChannelAvailable()).toBe(false);
    await expect(syncLauncherChannel('Продолжить просмотр', CARDS)).resolves.toBe('unsupported');
    await expect(takeLauncherOpen()).resolves.toBeNull();
  });

  it('sync passes the channel name and flat cards (an empty author is no description); `synced` passes through', async () => {
    const sync = jest.fn().mockResolvedValue('synced');
    native.LauncherChannel = { sync, takePendingOpen: jest.fn() };
    expect(launcherChannelAvailable()).toBe(true);
    await expect(syncLauncherChannel('Продолжить просмотр', CARDS)).resolves.toBe('synced');
    expect(sync).toHaveBeenCalledWith('Продолжить просмотр', [
      {
        target: 'media',
        title: 'Урок 1',
        description: 'Автор',
        posterUrl: 'https://img.example.invalid/1.jpg',
        blogUrl: 'blog',
        postId: 'p1',
        mediaId: 'm1',
      },
      { target: 'media', title: 'Урок 2', description: null, posterUrl: null, blogUrl: 'blog', postId: 'p1', mediaId: 'm2' },
    ]);
  });

  it('the neutral card goes as `home` without ids or poster', async () => {
    const sync = jest.fn().mockResolvedValue('synced');
    native.LauncherChannel = { sync, takePendingOpen: jest.fn() };
    await syncLauncherChannel('Продолжить просмотр', [{ kind: 'home', title: 'Откройте Boosty TV' }]);
    expect(sync).toHaveBeenCalledWith('Продолжить просмотр', [
      { target: 'home', title: 'Откройте Boosty TV', description: null, posterUrl: null },
    ]);
  });

  it('`unsupported` (API < 26) passes through; an unknown answer or a rejection is `failed` (never thrown)', async () => {
    native.LauncherChannel = { sync: jest.fn().mockResolvedValue('unsupported'), takePendingOpen: jest.fn() };
    await expect(syncLauncherChannel('x', CARDS)).resolves.toBe('unsupported');
    native.LauncherChannel = { sync: jest.fn().mockResolvedValue('maybe'), takePendingOpen: jest.fn() };
    await expect(syncLauncherChannel('x', CARDS)).resolves.toBe('failed');
    native.LauncherChannel = {
      sync: jest.fn().mockRejectedValue(new Error('SQLiteException Урок 1')),
      takePendingOpen: jest.fn(),
    };
    await expect(syncLauncherChannel('x', CARDS)).resolves.toBe('failed');
  });

  it('takeLauncherOpen maps `media` (ids unvalidated) and `home`; anything else is null', async () => {
    const take = jest.fn();
    native.LauncherChannel = { sync: jest.fn(), takePendingOpen: take };
    take.mockResolvedValueOnce({ target: 'media', blogUrl: 'blog', postId: 'p1', mediaId: 'm1' });
    await expect(takeLauncherOpen()).resolves.toEqual({ kind: 'media', ref: REF });
    take.mockResolvedValueOnce({ target: 'home' });
    await expect(takeLauncherOpen()).resolves.toEqual({ kind: 'home' });
    take.mockResolvedValueOnce(null);
    await expect(takeLauncherOpen()).resolves.toBeNull();
    take.mockResolvedValueOnce({ target: 'other' });
    await expect(takeLauncherOpen()).resolves.toBeNull();
    take.mockResolvedValueOnce('home');
    await expect(takeLauncherOpen()).resolves.toBeNull();
    take.mockRejectedValueOnce(new Error('boom'));
    await expect(takeLauncherOpen()).resolves.toBeNull();
  });

  it('a module without both methods is not available', () => {
    native.LauncherChannel = { sync: jest.fn() };
    expect(launcherChannelAvailable()).toBe(false);
  });
});
