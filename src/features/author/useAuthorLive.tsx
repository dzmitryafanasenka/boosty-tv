import { useIsFocused } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { queryKeys, type HttpClient } from '../../shared/api';
import { StreamRepository, type Stream } from '../../shared/entities/stream';
import { useLatestRef, useZoneItem, type ListRestoration, type ModalApi } from '../../shared/focus';
import { isAppActive, subscribeAppBackground, subscribeAppForeground } from '../../shared/platform/appLifecycle';
import { boostyStreamUrl } from '../../shared/entities/externalUrls';
import { t } from '../../shared/i18n';
import { QrDialog, requestHostFocus, type HostView, type NotMovedLatch } from '../../shared/ui';
import { liveCardPlayable } from './LiveCard';
import { liveFocusRole, liveReturnTarget, type LiveFocusRole } from './liveReturnTarget';
import type { AuthorFocusInfo } from './useAuthorAutoFocus';

/**
 * Story 7.1 (LIVE-01, docs/focus-map.md §4 D): the Author page's LiveCard
 * data and focus glue, kept out of AuthorScreen.
 */

/**
 * Owner decision 2026-10-30 (Q1 a): E15 is fetched again every 30 s while
 * the page is focused and a card is shown (live or scheduled), so an ended
 * stream's card goes within 30 s.
 */
export const LIVE_POLL_INTERVAL_MS = 30_000;

/**
 * E15 through the `['stream', blogUrl]` query (`entities/stream`): the
 * blog's stream, or null for none, while loading, after a failed first
 * load (no retry, no error UI) or while `enabled` (`phaseFlags.live`) is
 * off (then no request at all). A failed poll keeps the last stream
 * (TanStack keeps the data on a refetch error). Polling runs only while
 * the Author route is focused (a covered route or one leaving stops it),
 * the app is in the foreground (TanStack's focus manager is not wired to
 * AppState in RN; the resume invalidation fetches again) and a stream is
 * shown. `staleTime: 0`: every Author open sends one E15 (a cached card of
 * an ended stream, or a cached «none», is never trusted for the initial
 * focus; `answered` waits for this page's own answer).
 */
export type AuthorLiveStream = {
  stream: Stream | null;
  /** This page's own first E15 answered (a stream, none, or a failure); a cached value does not count. */
  answered: boolean;
};

export function useAuthorLiveStream(http: HttpClient, blogUrl: string, enabled: boolean): AuthorLiveStream {
  const routeFocused = useIsFocused();
  const [appActive, setAppActive] = useState(isAppActive);
  useEffect(() => {
    const offBackground = subscribeAppBackground(() => setAppActive(false));
    const offForeground = subscribeAppForeground(() => setAppActive(true));
    return () => {
      offBackground();
      offForeground();
    };
  }, []);
  const { data, isFetchedAfterMount } = useQuery({
    queryKey: queryKeys.stream(blogUrl),
    queryFn: () => StreamRepository.fetchActive(http, blogUrl),
    enabled,
    retry: false,
    staleTime: 0,
    refetchInterval: query =>
      routeFocused && appActive && isAppActive() && query.state.data !== null && query.state.data !== undefined
        ? LIVE_POLL_INTERVAL_MS
        : false,
  });
  return {
    stream: enabled ? data ?? null : null,
    answered: enabled && isFetchedAfterMount,
  };
}

export type AuthorLiveCard = {
  liveId: string;
  /** The card's host view as state (the live guide's destination). */
  liveView: HostView | null;
  /** The mounted card's host view; null while no card is shown. */
  liveViewRef: RefObject<HostView | null>;
  liveHostRef: (view: HostView | null) => void;
  /** The card is a content FocusZone item (Back, ← → zones, the route's tracking). */
  onLiveFocus: () => void;
};

/**
 * The LiveCard's view and zone item (declared before the page's auto focus,
 * which reads it). Story 7.4: «Нравится» and «Поделиться» use the same
 * shape, each with its own id (`liveId` is then the button's id).
 */
export function useAuthorLiveCard(liveId: string): AuthorLiveCard {
  const zone = useZoneItem(liveId);
  const [liveView, setLiveView] = useState<HostView | null>(null);
  const liveViewRef = useRef<HostView | null>(null);
  const liveHostRef = useCallback(
    (view: HostView | null) => {
      liveViewRef.current = view;
      setLiveView(view);
      zone.ref?.(view);
    },
    [zone],
  );
  return { liveId, liveView, liveViewRef, liveHostRef, onLiveFocus: zone.onFocus };
}

export type AuthorLiveFocusOptions = {
  stream: Stream | null;
  /** `AuthorLiveStream.answered`. */
  answered: boolean;
  card: AuthorLiveCard;
  /** Story 7.4: «Нравится» and «Поделиться» (card loss counts their focus as the card's). */
  like: AuthorLiveCard;
  share: AuthorLiveCard;
  /** Story 7.4: «Нравится» is shown (a live stream with access). */
  likeShown: boolean;
  focusRef: RefObject<AuthorFocusInfo>;
  modal: ModalApi;
  latch: NotMovedLatch;
  restoration: Pick<ListRestoration, 'focusInitial'>;
  /** The shown cards' focus ids. */
  idsRef: RefObject<string[]>;
  /** The user has not moved focus away from where the page may take it. */
  mayTakeFocus: () => boolean;
  /** The page's own LiveCard focus (recorded as automatic). */
  autoFocusLive: () => void;
};

/**
 * The LiveCard's own focus rules (docs/focus-map.md §4 D):
 * - Initial focus: this page's own first E15 answer with a live stream sends focus to the card while the user has
 *   not moved (focus still on the sidebar item, the StateView action or
 *   none yet, or on the first post the page focused by itself). A later
 *   refetch never moves focus, also not a scheduled stream going live.
 * - Card loss: when the card goes (a refetch found no stream) while it had
 *   focus, the first post takes it (`restoration.focusInitial`, else the
 *   nearest action above). A covered route is handled on return. Story
 *   7.4: focus on «Нравится» or «Поделиться» counts as the card's.
 * - Story 7.4: «Нравится» goes while it has focus and the card stays (the
 *   stream lost access or stopped being live): «Поделиться» takes it.
 */
export function useAuthorLiveFocus({
  stream,
  answered,
  card,
  like,
  share,
  likeShown,
  focusRef,
  modal,
  latch,
  restoration,
  idsRef,
  mayTakeFocus,
  autoFocusLive,
}: AuthorLiveFocusOptions): void {
  const shown = stream !== null;
  const live = stream?.status === 'live';
  /** The initial-focus decision was made (the first answer). */
  const settled = useRef(false);
  const mayTakeRef = useLatestRef(mayTakeFocus);
  const autoFocusLiveRef = useLatestRef(autoFocusLive);
  useEffect(() => {
    if (settled.current || !answered) {
      return;
    }
    // The first answer decides once: no stream then, no initial focus later.
    settled.current = true;
    if (!live) {
      return;
    }
    const info = focusRef.current;
    if (!info.isActive() || modal.isOpen()) {
      return;
    }
    const current = info.current();
    if (mayTakeRef.current() || (current !== null && latch.followHead(current))) {
      autoFocusLiveRef.current();
    }
  }, [answered, live, focusRef, modal, latch, mayTakeRef, autoFocusLiveRef]);

  // Whether the card had focus is read during the render where the stream
  // turns null, before the commit removes the card: on Android, removing
  // the focused view moves native focus at once (the Story 6.7 device
  // lesson), so its focus event can reach JS before this effect runs.
  const ids = { liveId: card.liveId, likeId: like.liveId, shareId: share.liveId };
  const renderedShown = useRef(shown);
  /** The live-block element focused when the card went (render-phase); null: none. */
  const lostWhileFocused = useRef<LiveFocusRole | null>(null);
  if (renderedShown.current !== shown) {
    lostWhileFocused.current = shown ? null : liveFocusRole(focusRef.current.current(), ids);
    renderedShown.current = shown;
  }
  const likeVisible = shown && likeShown;
  const renderedLike = useRef(likeVisible);
  /** «Нравится» had focus when it went with the card staying (render-phase). */
  const likeLostWhileFocused = useRef<Extract<LiveFocusRole, 'like'> | null>(null);
  if (renderedLike.current !== likeVisible) {
    likeLostWhileFocused.current =
      shown && !likeVisible && focusRef.current.current() === like.liveId ? 'like' : null;
    renderedLike.current = likeVisible;
  }
  const wasLike = useRef(likeVisible);
  useEffect(() => {
    const before = wasLike.current;
    wasLike.current = likeVisible;
    if (!before || likeVisible) {
      return;
    }
    const lost = likeLostWhileFocused.current;
    likeLostWhileFocused.current = null;
    // Without the card, the card-loss effect below decides (no grid target here).
    const target = liveReturnTarget(lost, {
      card: shown,
      like: false,
      share: share.liveViewRef.current !== null,
      grid: false,
    });
    const info = focusRef.current;
    if (target === 'share' && info.isActive() && !modal.isOpen()) {
      latch.auto(share.liveId);
      requestHostFocus(share.liveViewRef.current);
    }
  }, [likeVisible, shown, focusRef, modal, latch, share]);
  const wasShown = useRef(shown);
  useEffect(() => {
    const before = wasShown.current;
    wasShown.current = shown;
    if (!before || shown) {
      return;
    }
    const lost = lostWhileFocused.current;
    lostWhileFocused.current = null;
    // The whole block is gone; `restoration.focusInitial` falls back to the
    // nearest action above when there is no post, hence `grid: true`.
    const target = liveReturnTarget(lost, { card: false, like: false, share: false, grid: true });
    const info = focusRef.current;
    if (target === 'firstPost' && info.isActive() && !modal.isOpen()) {
      latch.auto(idsRef.current[0]);
      restoration.focusInitial();
    }
  }, [shown, focusRef, modal, card.liveId, latch, idsRef, restoration]);
}

export type AuthorLivePressOptions = {
  blogUrl: string;
  stream: Stream | null;
  card: AuthorLiveCard;
  /** Story 7.4: «Поделиться» (the share QR's initiator). */
  share: AuthorLiveCard;
  focusRef: RefObject<AuthorFocusInfo>;
  modal: ModalApi;
  latch: NotMovedLatch;
  /** `AuthorScreenProps.onOpenLive`: the live Player for this blog, return focus on the card. */
  onOpenLive?: (blogUrl: string, focusId: string) => void;
};

export type AuthorLivePress = {
  /** OK on the LiveCard. */
  onLivePress: () => void;
  /** Story 7.4: OK on «Поделиться»: the stream page's QR, focus back on «Поделиться» on close. */
  onSharePress: () => void;
  /**
   * The stream page's QR, focus back to `initiator` on close (default the
   * card: also the player's not-playable return); false when it did not open.
   */
  openLiveQr: (initiator?: RefObject<HostView | null>) => boolean;
};

/**
 * Story 7.2 (LIVE-02, docs/focus-map.md §4 D): OK on the LiveCard. A
 * playable card (`liveCardPlayable`: live, `hasAccess`, a live-edge URL)
 * opens the live player through `onOpenLive` (the route's callback; no
 * feature edge). Every other card (scheduled, needs a level, no URL) shows
 * the QrDialog with the stream page (`boostyStreamUrl`); «Закрыть» or Back
 * returns focus to the card. Only while Автор is the focused route and no
 * modal is open. OK is a move (the reopen rule).
 */
export function useAuthorLivePress({
  blogUrl,
  stream,
  card,
  share,
  focusRef,
  modal,
  latch,
  onOpenLive,
}: AuthorLivePressOptions): AuthorLivePress {
  const streamRef = useLatestRef(stream);
  const onOpenLiveRef = useLatestRef(onOpenLive);
  /** Opens the stream page's QR; false when it cannot (no URL, no card, not active, a modal open). */
  const openLiveQr = useCallback(
    (initiator: RefObject<HostView | null> = card.liveViewRef): boolean => {
      const url = boostyStreamUrl(blogUrl);
      if (url === null || !focusRef.current.isActive() || modal.isOpen() || initiator.current === null) {
        return false;
      }
      modal.open(
        <QrDialog title={t('player.live.qrTitle')} value={url} onClose={() => modal.close()} />,
        initiator,
      );
      return true;
    },
    [blogUrl, focusRef, modal, card.liveViewRef],
  );
  const onSharePress = useCallback(() => {
    if (streamRef.current !== null && openLiveQr(share.liveViewRef)) {
      latch.move();
    }
  }, [streamRef, openLiveQr, share.liveViewRef, latch]);
  const onLivePress = useCallback(() => {
    const current = streamRef.current;
    if (current === null || !focusRef.current.isActive() || modal.isOpen()) {
      return;
    }
    // OK is a move only when the Player or the QR actually opens.
    const open = onOpenLiveRef.current;
    if (liveCardPlayable(current) && open) {
      latch.move();
      open(blogUrl, card.liveId);
      return;
    }
    if (openLiveQr()) {
      latch.move();
    }
  }, [streamRef, focusRef, modal, latch, onOpenLiveRef, blogUrl, card.liveId, openLiveQr]);
  return { onLivePress, onSharePress, openLiveQr };
}
