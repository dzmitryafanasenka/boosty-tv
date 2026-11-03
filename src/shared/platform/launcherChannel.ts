import { NativeModules } from 'react-native';

/**
 * The LauncherChannel port (Story 12.5, IMP-04, FR67, ADR 0016): one
 * Android TV app preview channel «Продолжить просмотр» that the launcher
 * (Aero TV on the pinned device) shows on the Boosty TV tile
 * (android/.../LauncherChannelModule.kt, platform `TvContract`, API 26+).
 * No feature touches the native module directly.
 *
 * - `syncLauncherChannel(name, cards)` replaces the channel's programs with
 *   `cards` (the channel is created once and never deleted):
 *   `'synced'`, `'unsupported'` (no module, or API < 26) or `'failed'`.
 *   Nothing is retried here.
 * - `takeLauncherOpen()` returns the card the user opened in the launcher,
 *   once: `{kind: 'home'}`, `{kind: 'media', ref}` with the ref unvalidated
 *   (the caller checks it against its local history), or null.
 *
 * Titles, ids and intent URIs are never logged or put in an error here; a
 * rejection's content is dropped unread.
 */

export type LauncherCard =
  | {
      kind: 'media';
      title: string;
      /** The short description (the author's name); empty: none. */
      description: string;
      /** A token-free poster URL; null: the app banner. */
      posterUrl: string | null;
      ref: { blogUrl: string; postId: string; mediaId: string };
    }
  | {
      /** The neutral card: opens Главная, shows the app banner. */
      kind: 'home';
      title: string;
    };

export type LauncherSyncOutcome = 'synced' | 'unsupported' | 'failed';

export type LauncherOpen = { kind: 'home' } | { kind: 'media'; ref: unknown };

type NativeCard = {
  target: 'media' | 'home';
  title: string;
  description: string | null;
  posterUrl: string | null;
  blogUrl?: string;
  postId?: string;
  mediaId?: string;
};

type LauncherChannelNative = {
  sync?: (channelName: string, cards: NativeCard[]) => Promise<unknown>;
  takePendingOpen?: () => Promise<unknown>;
};

const native = () => (NativeModules as { LauncherChannel?: LauncherChannelNative }).LauncherChannel;

/** The native module is present (Android builds); it may still answer `'unsupported'` below API 26. */
export function launcherChannelAvailable(): boolean {
  const module = native();
  return typeof module?.sync === 'function' && typeof module?.takePendingOpen === 'function';
}

function toNative(card: LauncherCard): NativeCard {
  if (card.kind === 'home') {
    return { target: 'home', title: card.title, description: null, posterUrl: null };
  }
  return {
    target: 'media',
    title: card.title,
    description: card.description.length > 0 ? card.description : null,
    posterUrl: card.posterUrl,
    blogUrl: card.ref.blogUrl,
    postId: card.ref.postId,
    mediaId: card.ref.mediaId,
  };
}

/** Replace the channel's programs with `cards`; any failure is `'failed'`. */
export async function syncLauncherChannel(
  channelName: string,
  cards: readonly LauncherCard[],
): Promise<LauncherSyncOutcome> {
  const sync = native()?.sync;
  if (typeof sync !== 'function') {
    return 'unsupported';
  }
  try {
    const outcome = await sync(channelName, cards.map(toNative));
    return outcome === 'synced' ? 'synced' : outcome === 'unsupported' ? 'unsupported' : 'failed';
  } catch {
    return 'failed';
  }
}

/** The launcher card the user opened (once); null when none, without the module, or on a failure. */
export async function takeLauncherOpen(): Promise<LauncherOpen | null> {
  const take = native()?.takePendingOpen;
  if (typeof take !== 'function') {
    return null;
  }
  try {
    const value = (await take()) as Record<string, unknown> | null | undefined;
    if (value === null || typeof value !== 'object') {
      return null;
    }
    if (value.target === 'media') {
      return { kind: 'media', ref: { blogUrl: value.blogUrl, postId: value.postId, mediaId: value.mediaId } };
    }
    return value.target === 'home' ? { kind: 'home' } : null;
  } catch {
    return null;
  }
}
