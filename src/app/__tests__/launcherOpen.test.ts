/**
 * Story 12.5: what a launcher card opens (`resolveLauncherOpen`) and the
 * Shell's one-time content-return handshake.
 */
import type { ProgressEntry } from '../../shared/services/progress';
import {
  clearShellContentReturn,
  requestShellContentReturn,
  resolveLauncherOpen,
  takeShellContentReturn,
} from '../launcherOpen';

const REF = { blogUrl: 'synthetic-blog', postId: 'post-1', mediaId: 'v1' };

function entry(ref: ProgressEntry['ref'], positionSec: number): ProgressEntry {
  return {
    ref,
    positionSec,
    durationSec: 3600,
    updatedAt: 1000,
    meta: { title: 'T', postTitle: 'P', authorName: 'A', previewUrl: null, durationSec: 3600 },
  };
}

function deps({ signedIn = true, entries = [entry(REF, 600)], playerEnabled = true } = {}) {
  const ready = jest.fn(async () => {});
  return { signedIn: () => signedIn, store: { ready, entries: () => entries }, playerEnabled, ready };
}

describe('resolveLauncherOpen (Story 12.5)', () => {
  it('no card: nothing', async () => {
    await expect(resolveLauncherOpen(null, deps())).resolves.toEqual({ kind: 'none' });
  });

  it('signed out: nothing (the sign-in stack stays), for any card', async () => {
    const d = deps({ signedIn: false });
    await expect(resolveLauncherOpen({ kind: 'media', ref: REF }, d)).resolves.toEqual({ kind: 'none' });
    await expect(resolveLauncherOpen({ kind: 'home' }, d)).resolves.toEqual({ kind: 'none' });
  });

  it('the neutral card or the channel link: Главная', async () => {
    await expect(resolveLauncherOpen({ kind: 'home' }, deps())).resolves.toEqual({ kind: 'home' });
  });

  it('a video card in the local Continue view: the Player for it, after the store was read', async () => {
    const d = deps();
    await expect(resolveLauncherOpen({ kind: 'media', ref: { ...REF } }, d)).resolves.toEqual({ kind: 'player', ref: REF });
    expect(d.ready).toHaveBeenCalled();
  });

  it('a stale (finished or removed), foreign or partly matching ref: Главная', async () => {
    const finished = deps({ entries: [entry(REF, 3590)] });
    await expect(resolveLauncherOpen({ kind: 'media', ref: REF }, finished)).resolves.toEqual({ kind: 'home' });
    const empty = deps({ entries: [] });
    await expect(resolveLauncherOpen({ kind: 'media', ref: REF }, empty)).resolves.toEqual({ kind: 'home' });
    for (const ref of [
      { ...REF, mediaId: 'other' },
      { ...REF, postId: 'other' },
      { ...REF, blogUrl: 'other' },
    ]) {
      await expect(resolveLauncherOpen({ kind: 'media', ref }, deps())).resolves.toEqual({ kind: 'home' });
    }
  });

  it('a malformed ref: Главная, without reading the store', async () => {
    for (const ref of [null, undefined, 'v1', { ...REF, mediaId: '' }, { ...REF, postId: 7 }, { blogUrl: 'synthetic-blog' }]) {
      const d = deps();
      await expect(resolveLauncherOpen({ kind: 'media', ref }, d)).resolves.toEqual({ kind: 'home' });
      expect(d.ready).not.toHaveBeenCalled();
    }
  });

  it('the player phase off: Главная', async () => {
    await expect(resolveLauncherOpen({ kind: 'media', ref: REF }, deps({ playerEnabled: false }))).resolves.toEqual({
      kind: 'home',
    });
  });

  it('signed out while the store was read: nothing', async () => {
    let signedIn = true;
    const d = {
      signedIn: () => signedIn,
      store: {
        ready: async () => {
          signedIn = false;
        },
        entries: () => [entry(REF, 600)],
      },
      playerEnabled: true,
    };
    await expect(resolveLauncherOpen({ kind: 'media', ref: REF }, d)).resolves.toEqual({ kind: 'none' });
  });
});

describe('Shell content-return handshake', () => {
  it('is read once; a clear drops it', () => {
    expect(takeShellContentReturn()).toBe(false);
    requestShellContentReturn();
    expect(takeShellContentReturn()).toBe(true);
    expect(takeShellContentReturn()).toBe(false);
    requestShellContentReturn();
    clearShellContentReturn();
    expect(takeShellContentReturn()).toBe(false);
  });
});
