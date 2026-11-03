import type { MediaRef } from '../shared/entities/post';
import type { LauncherOpen } from '../shared/platform/launcherChannel';
import {
  continueEntries,
  progressRefSchema,
  type ProgressStore,
} from '../shared/services/progress';

/**
 * Story 12.5 (ADR 0016, docs/focus-map.md «Launcher entry»): what a card of
 * the launcher channel opens. The ids come from an intent (outside input):
 * they are checked with the progress ref schema and must match an entry of
 * the current local Continue view, else Главная. Nothing opens while the
 * app is not signed in (the sign-in stack stays as it is; Welcome on a cold
 * start).
 */
export type LauncherTarget =
  | { kind: 'none' }
  | { kind: 'home' }
  | { kind: 'player'; ref: MediaRef };

export type ResolveLauncherOpenDeps = {
  signedIn: () => boolean;
  store: Pick<ProgressStore, 'ready' | 'entries'>;
  /** The player phase is on (`phaseFlags.player`); off: Главная. */
  playerEnabled: boolean;
};

export async function resolveLauncherOpen(
  open: LauncherOpen | null,
  { signedIn, store, playerEnabled }: ResolveLauncherOpenDeps,
): Promise<LauncherTarget> {
  if (open === null || !signedIn()) {
    return { kind: 'none' };
  }
  if (open.kind === 'home' || !playerEnabled) {
    return { kind: 'home' };
  }
  const parsed = progressRefSchema.safeParse(open.ref);
  if (!parsed.success) {
    return { kind: 'home' };
  }
  const { blogUrl, postId, mediaId } = parsed.data;
  // A cold start: the local history may not have been read yet.
  await store.ready();
  if (!signedIn()) {
    return { kind: 'none' };
  }
  const entry = continueEntries(store.entries()).find(
    e => e.ref.mediaId === mediaId && e.ref.blogUrl === blogUrl && e.ref.postId === postId,
  );
  return entry ? { kind: 'player', ref: entry.ref } : { kind: 'home' };
}

/**
 * The Shell's side of a launcher open: the Shell under the Player was never
 * focused, so its return goes to Главная's content (the remembered Continue
 * card, or its neighbour) instead of the sidebar. Read once, on the Shell's
 * next focus; cleared by every stack reset that is not a launcher open.
 */
let contentReturn = false;

export function requestShellContentReturn(): void {
  contentReturn = true;
}

export function clearShellContentReturn(): void {
  contentReturn = false;
}

export function takeShellContentReturn(): boolean {
  const pending = contentReturn;
  contentReturn = false;
  return pending;
}
