import { NativeModules } from 'react-native';

/**
 * The ExternalPlayer port (Story 8.2, PLAY-13, AD-2): hands one recording's
 * signed URL and title to an installed Android player through the system
 * chooser (android/.../ExternalPlayerModule.kt). No feature touches the
 * native module or intents directly.
 *
 * - `'opened'`: the chooser opened (the URL has left the app; nothing is
 *   retried).
 * - `'none'`: no real player resolves (only this app or the Google TV stub),
 *   the module is missing (tests, other platforms) or the launch failed.
 *
 * The URL is never logged, stored or put in an error here; the rejection's
 * content is dropped unread.
 */

export type ExternalPlayerOutcome = 'opened' | 'none';

export type ExternalPlayerRequest = {
  /** The signed CDN URL of the chosen quality (memory only). */
  url: string;
  /** The title the player shows. */
  title: string;
  /** The chooser's heading (from the i18n catalog). */
  chooserTitle: string;
};

type ExternalPlayerNative = {
  open?: (url: string, title: string, chooserTitle: string) => Promise<unknown>;
};

const native = () => (NativeModules as { ExternalPlayer?: ExternalPlayerNative }).ExternalPlayer;

/** The native module is present (Android builds). */
export function externalPlayerAvailable(): boolean {
  return typeof native()?.open === 'function';
}

/** Open the chooser for `url`; any failure is `'none'` (the caller falls back to the built-in player). */
export async function openExternalPlayer({ url, title, chooserTitle }: ExternalPlayerRequest): Promise<ExternalPlayerOutcome> {
  const open = native()?.open;
  if (typeof open !== 'function') {
    return 'none';
  }
  try {
    const outcome = await open(url, title, chooserTitle);
    return outcome === 'opened' ? 'opened' : 'none';
  } catch {
    return 'none';
  }
}
