import { NativeModules } from 'react-native';

/**
 * The ExternalPlayer port (Story 8.2, PLAY-13, AD-2): hands one recording's
 * signed URL and title to an installed Android player
 * (android/.../ExternalPlayerModule.kt). One real player opens directly;
 * several get the chooser (owner decision 2026-10-31). No feature touches
 * the native module or intents directly.
 *
 * Two steps, so the caller can leave its screen (and restore the origin
 * focus while the app still has window focus) before the other activity
 * covers the app (Story 8.2 device run):
 * - `prepareExternalPlayer` → `'ready'` (a player resolves; the launch is
 *   kept natively, in memory) or `'none'` (only this app or the Google TV
 *   stub resolves, no module, or a failure);
 * - `launchExternalPlayer` → `'opened'`, or `'none'` (nothing prepared, no
 *   module, or the launch failed). Nothing is retried.
 *
 * The URL is never logged, stored or put in an error here; a rejection's
 * content is dropped unread.
 */

export type ExternalPlayerPrepared = 'ready' | 'none';
export type ExternalPlayerOutcome = 'opened' | 'none';

export type ExternalPlayerRequest = {
  /** The signed CDN URL of the chosen quality (memory only). */
  url: string;
  /** The title the player shows. */
  title: string;
  /** The chooser's heading (from the i18n catalog), used with several players. */
  chooserTitle: string;
};

type ExternalPlayerNative = {
  prepare?: (url: string, title: string, chooserTitle: string) => Promise<unknown>;
  launch?: () => Promise<unknown>;
};

const native = () => (NativeModules as { ExternalPlayer?: ExternalPlayerNative }).ExternalPlayer;

/** The native module is present (Android builds). */
export function externalPlayerAvailable(): boolean {
  const module = native();
  return typeof module?.prepare === 'function' && typeof module?.launch === 'function';
}

/** Resolve the players for `url`; any failure is `'none'` (the caller falls back to the built-in player). */
export async function prepareExternalPlayer({ url, title, chooserTitle }: ExternalPlayerRequest): Promise<ExternalPlayerPrepared> {
  const module = native();
  if (typeof module?.prepare !== 'function' || typeof module?.launch !== 'function') {
    return 'none';
  }
  try {
    return (await module.prepare(url, title, chooserTitle)) === 'ready' ? 'ready' : 'none';
  } catch {
    return 'none';
  }
}

/** Start the prepared player (or the chooser); any failure is `'none'`. */
export async function launchExternalPlayer(): Promise<ExternalPlayerOutcome> {
  const launch = native()?.launch;
  if (typeof launch !== 'function') {
    return 'none';
  }
  try {
    return (await launch()) === 'opened' ? 'opened' : 'none';
  } catch {
    return 'none';
  }
}
