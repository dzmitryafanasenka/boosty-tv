import { accountScope, defineAccountScoped, type AccountScope } from '../shared/account';
import { videoDisplayTitle } from '../shared/entities/post';
import { t } from '../shared/i18n';
import { subscribeAppForeground } from '../shared/platform/appLifecycle';
import {
  launcherChannelAvailable,
  syncLauncherChannel,
  type LauncherCard,
  type LauncherSyncOutcome,
} from '../shared/platform/launcherChannel';
import { logger as appLogger, type Logger } from '../shared/services/logger';
import {
  continueEntries,
  persistablePreviewUrl,
  progressStore,
  type ProgressEntry,
  type ProgressStore,
} from '../shared/services/progress';
import { phaseFlags } from './phaseFlags';
import { DEMO_ACTIVE } from './session';

/**
 * «Продолжить просмотр» in the launcher (Story 12.5, IMP-04, FR67, ADR 0016):
 * the local Continue history mirrored to one app preview channel through
 * the LauncherChannel port.
 *
 * - The cards are `continueEntries(store.entries())` (same order, at most
 *   `MAX_CONTINUE_ENTRIES`): the Continue card's title rule, the author as
 *   the short description, a token-free poster (`persistablePreviewUrl`),
 *   else the app banner (native side). An empty list is one neutral card
 *   «Откройте Boosty TV» (Aero ignores an empty channel and keeps the old
 *   cards, Story 12.4/12.5 device check).
 * - A sync runs only when the projection key (order, ids, titles, authors,
 *   posters) changes, and only once the store has read its disk: periodic
 *   progress ticks change positions only and never sync.
 * - Syncs run one at a time; only the latest wanted list is sent, and a
 *   request made under an older AccountScope generation is dropped, so an
 *   old account is never republished after a wipe.
 * - A failed sync is logged (outcome and count only) and retried on the
 *   next change or the next return to the foreground (the current list, or
 *   the failed neutral card while the store is not read yet).
 * - The AccountScope wipe (`launcherChannelAccountStore`, registered after
 *   `progressAccountStore`) publishes the neutral card and waits for it. A
 *   failure does not fail the wipe (the session is already gone); it is
 *   retried as above.
 * - Off in the demo, without the player phase and without the native
 *   module: the channel is never written.
 * - Logs outcomes and counts only: never titles, ids or URLs.
 */

export type LauncherChannelDeps = {
  store: Pick<ProgressStore, 'entries' | 'isReady' | 'ready' | 'subscribe'>;
  sync: (channelName: string, cards: readonly LauncherCard[]) => Promise<LauncherSyncOutcome>;
  enabled: () => boolean;
  scope?: Pick<AccountScope, 'generation'>;
  logger?: Logger;
  /** The app's return to the foreground (retries a failed sync). */
  onForeground?: (listener: () => void) => () => void;
};

export type LauncherChannel = {
  /** Subscribes to the store and syncs the current list; returns the stop function. No-op when disabled. */
  start(): () => void;
  /** The AccountScope wipe: publishes the neutral card (once started). Never rejects. */
  reset(): Promise<void>;
  /** Sends again after a failed sync (no-op otherwise). Called on the return to the foreground. */
  retry(): void;
};

/** The neutral card of an empty history (opens Главная). */
export function neutralCards(): LauncherCard[] {
  return [{ kind: 'home', title: t('launcher.openApp') }];
}

function card(entry: ProgressEntry): LauncherCard {
  const { ref, meta } = entry;
  return {
    kind: 'media',
    // The Continue card's rule (HomeScreen `continueItem`).
    title: videoDisplayTitle(meta.title, meta.postTitle) || t('postCard.untitled'),
    description: meta.authorName,
    posterUrl: persistablePreviewUrl(meta.previewUrl),
    ref: { blogUrl: ref.blogUrl, postId: ref.postId, mediaId: ref.mediaId },
  };
}

/** The channel's cards for `entries` (the neutral card when the Continue view is empty). */
export function launcherCards(entries: readonly ProgressEntry[]): LauncherCard[] {
  const view = continueEntries(entries);
  return view.length > 0 ? view.map(card) : neutralCards();
}

type Request = { cards: LauncherCard[]; generation: number };

export function createLauncherChannel({
  store,
  sync,
  enabled,
  scope = accountScope,
  logger = appLogger,
  onForeground = subscribeAppForeground,
}: LauncherChannelDeps): LauncherChannel {
  let started = false;
  /** The key of the last list asked for; null: none yet. */
  let lastKey: string | null = null;
  /** The latest wanted list not yet sent. */
  let next: Request | null = null;
  let running: Promise<void> | null = null;
  /** The cards of the last sync when it failed; null after a success. */
  let failed: LauncherCard[] | null = null;

  function run(): Promise<void> {
    if (running === null) {
      running = (async () => {
        // Always async first, so `running` is assigned before the loop can end.
        await Promise.resolve();
        try {
          while (next !== null) {
            const request = next;
            next = null;
            if (request.generation !== scope.generation()) {
              logger.info('launcherChannel', 'stale sync dropped');
              continue;
            }
            const outcome = await sync(t('launcher.channel'), request.cards);
            if (outcome === 'failed') {
              // Not sent: the same list must not count as published.
              lastKey = null;
              failed = request.cards;
              logger.warn('launcherChannel', 'sync', { outcome, count: request.cards.length });
            } else {
              failed = null;
              logger.info('launcherChannel', 'sync', { outcome, count: request.cards.length });
            }
          }
        } finally {
          // In the same step as the last `next` check: a list wanted later starts a new run.
          running = null;
        }
      })();
    }
    return running;
  }

  function want(cards: LauncherCard[]): Promise<void> {
    next = { cards, generation: scope.generation() };
    return run();
  }

  function onChange() {
    if (!started || !store.isReady()) {
      return;
    }
    const cards = launcherCards(store.entries());
    const key = JSON.stringify(cards);
    if (key === lastKey) {
      return;
    }
    lastKey = key;
    want(cards).catch(() => {});
  }

  /** Sends again after a failed sync (no-op otherwise). */
  function retry() {
    const cards = failed;
    if (!started || cards === null || running !== null) {
      return;
    }
    if (store.isReady()) {
      // The current list (the failure cleared `lastKey`).
      onChange();
    } else {
      // The store is not read (after a wipe): the failed neutral card again.
      lastKey = JSON.stringify(cards);
      want(cards).catch(() => {});
    }
  }

  return {
    start() {
      if (started || !enabled()) {
        return () => {};
      }
      started = true;
      const unsubscribe = store.subscribe(onChange);
      const unsubscribeForeground = onForeground(retry);
      store.ready().then(onChange, () => {});
      onChange();
      return () => {
        unsubscribe();
        unsubscribeForeground();
        started = false;
      };
    },
    async reset() {
      if (!started) {
        return;
      }
      const cards = neutralCards();
      lastKey = JSON.stringify(cards);
      await want(cards).catch(() => {});
    },
    retry,
  };
}

/** The app's launcher channel over the account-scoped `progressStore`. */
export const launcherChannel: LauncherChannel = createLauncherChannel({
  store: progressStore,
  sync: syncLauncherChannel,
  enabled: () => !DEMO_ACTIVE && phaseFlags.player && launcherChannelAvailable(),
});

/** AD-4: the launcher shows nothing of the account after a sign-out or an account switch. */
export const launcherChannelAccountStore = defineAccountScoped('launcherChannel', () => launcherChannel.reset());
