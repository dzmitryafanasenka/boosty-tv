import { useCallback, useMemo, type RefObject } from 'react';
import type { HttpClient } from '../../shared/api';
import type { Stream } from '../../shared/entities/stream';
import { useLatestRef, type ListRestoration, type ModalApi } from '../../shared/focus';
import { requestHostFocus, type NotMovedLatch } from '../../shared/ui';
import { authorLiveId, authorLiveLikeId, authorLiveShareId } from './authorIds';
import type { AuthorFocusInfo } from './useAuthorAutoFocus';
import { liveFocusRole, liveReturnTarget } from './liveReturnTarget';
import { useAuthorLiveCard, useAuthorLivePress, useAuthorLiveStream, type AuthorLiveCard } from './useAuthorLive';
import { liveLikeShown, useLiveLike, type LiveLike } from './useLiveLike';

/**
 * Epic 7 retro A2: the Author page's live block (the LiveCard of Story 7.1,
 * «Нравится» and «Поделиться» of Story 7.4) and its return focus, kept out of
 * AuthorScreen. Card loss (`useAuthorLiveFocus`) and the return focus share
 * one target rule, `liveReturnTarget` (`./liveReturnTarget`).
 */

export type AuthorLiveBlock = {
  liveId: string;
  likeId: string;
  shareId: string;
  /** «Нравится» and «Поделиться» (the action row's ↓ rules). */
  liveActionIds: readonly string[];
  liveCard: AuthorLiveCard;
  /** Story 7.4: «Нравится» and «Поделиться» have the card's shape (zone item + host view). */
  likeButton: AuthorLiveCard;
  shareButton: AuthorLiveCard;
  /** This page's own first E15 answered (`AuthorLiveStream.answered`). */
  liveAnswered: boolean;
  like: LiveLike;
  /** The shown stream: the query's value with the optimistic like over it. */
  stream: Stream | null;
  likeShown: boolean;
  liveShown: boolean;
};

/**
 * The live block's ids, views and data (Stories 7.1, 7.4). Declared before
 * the page's auto focus, which reads the card.
 */
export function useAuthorLiveBlock({
  http,
  blogUrl,
  liveEnabled,
}: {
  http: HttpClient;
  blogUrl: string;
  liveEnabled: boolean;
}): AuthorLiveBlock {
  const liveId = authorLiveId(blogUrl);
  const likeId = authorLiveLikeId(blogUrl);
  const shareId = authorLiveShareId(blogUrl);
  const liveActionIds = useMemo(() => [likeId, shareId], [likeId, shareId]);
  const liveCard = useAuthorLiveCard(liveId);
  const likeButton = useAuthorLiveCard(likeId);
  const shareButton = useAuthorLiveCard(shareId);
  const { stream: queriedStream, answered: liveAnswered } = useAuthorLiveStream(http, blogUrl, liveEnabled);
  // Story 7.4: the shown stream carries the optimistic like over the query.
  const like = useLiveLike(http, blogUrl, queriedStream, liveAnswered);
  const stream = like.stream;
  return {
    liveId,
    likeId,
    shareId,
    liveActionIds,
    liveCard,
    likeButton,
    shareButton,
    liveAnswered,
    like,
    stream,
    likeShown: stream !== null && liveLikeShown(stream),
    liveShown: stream !== null,
  };
}

export type AuthorLiveActionsOptions = {
  block: AuthorLiveBlock;
  blogUrl: string;
  focusRef: RefObject<AuthorFocusInfo>;
  modal: ModalApi;
  latch: NotMovedLatch;
  restoration: Pick<ListRestoration, 'focusInitial'>;
  /** The shown cards' focus ids. */
  idsRef: RefObject<string[]>;
  /** The page shows its post grid. */
  gridShown: () => boolean;
  /** The page's own LiveCard focus (recorded as automatic). */
  autoFocusLive: () => void;
  /** `AuthorScreenProps.onOpenLive`. */
  onOpenLive?: (blogUrl: string, focusId: string) => void;
  /** `AuthorScreenProps.takeLiveQrRequest`. */
  takeLiveQrRequest?: () => boolean;
};

export type AuthorLiveActions = {
  /** Story 7.2: OK on the LiveCard (the live player, else the stream page's QR). */
  onLivePress: () => void;
  /** Story 7.4: OK on «Поделиться». */
  onSharePress: () => void;
  /** Story 7.4: OK on «Нравится» clears the last failure and toggles. */
  onLikePress: () => void;
  /**
   * The return to the route (a screen on top popped) with focus on `current`:
   * consumes the live player's QR request, then focuses the live-block target
   * (`liveReturnTarget`). Returns the cleanup (cancels a pending QR open) when
   * it handled the return, null when `current` is not on the live block or its
   * target is null (the page's own fallback then).
   */
  returnFocus: (current: string | null) => (() => void) | null;
};

/** The live block's presses and its return focus (Stories 7.1, 7.2, 7.4). */
export function useAuthorLiveActions({
  block,
  blogUrl,
  focusRef,
  modal,
  latch,
  restoration,
  idsRef,
  gridShown,
  autoFocusLive,
  onOpenLive,
  takeLiveQrRequest,
}: AuthorLiveActionsOptions): AuthorLiveActions {
  const { liveId, likeId, shareId, liveCard, likeButton, shareButton, stream, like } = block;
  const { onLivePress, onSharePress, openLiveQr } = useAuthorLivePress({
    blogUrl,
    stream,
    card: liveCard,
    share: shareButton,
    focusRef,
    modal,
    latch,
    onOpenLive,
  });
  const openLiveQrRef = useLatestRef(openLiveQr);
  const takeLiveQrRequestRef = useLatestRef(takeLiveQrRequest);
  const gridShownRef = useLatestRef(gridShown);

  const likeToggle = like.toggle;
  const onLikePress = useCallback(() => {
    const info = focusRef.current;
    if (!info.isActive() || modal.isOpen()) {
      return;
    }
    if (likeToggle()) {
      latch.move();
    }
  }, [focusRef, modal, likeToggle, latch]);

  const returnFocus = useCallback(
    (current: string | null): (() => void) | null => {
      // Story 7.2: the live player left because the stream is not playable
      // here. Consumed on every return, before the target is chosen.
      const liveQr = takeLiveQrRequestRef.current?.() === true;
      const role = liveFocusRole(current, { liveId, likeId, shareId });
      const target = liveReturnTarget(role, {
        card: liveCard.liveViewRef.current !== null,
        like: likeButton.liveViewRef.current !== null,
        share: shareButton.liveViewRef.current !== null,
        grid: gridShownRef.current(),
      });
      if (target === null) {
        return null;
      }
      let qrFrame: number | null = null;
      if (target === 'live') {
        // Story 7.1: back to the LiveCard it left from (Story 7.2: from the
        // live player too; a QR request opens over it). Story 7.4: also from
        // «Нравится» / «Поделиться» gone while covered.
        autoFocusLive();
        if (role === 'live' && liveQr) {
          // A frame later: the route's own Back listener (added in this
          // focus pass, after this child effect) must be older than the
          // modal host's, so Back closes the QR first (focus-map §1.4).
          qrFrame = requestAnimationFrame(() => openLiveQrRef.current());
        }
      } else if (target === 'like' || target === 'share') {
        // Story 7.4: back to «Нравится» / «Поделиться» while still shown; the
        // like gone while covered (it needs live + access) and the card
        // stays: «Поделиться», as when uncovered.
        latch.auto(target === 'like' ? likeId : shareId);
        requestHostFocus(target === 'like' ? likeButton.liveViewRef.current : shareButton.liveViewRef.current);
      } else {
        // The stream ended while covered (Story 7.2: e.g. the live player's
        // «Стрим завершён»): the first post, where the card was
        // (focus-map §4 D). Not `restoreOrFirst`: it would restore the
        // remembered card id.
        latch.auto(idsRef.current[0]);
        restoration.focusInitial();
      }
      return () => {
        if (qrFrame !== null) {
          cancelAnimationFrame(qrFrame);
        }
      };
    },
    [
      takeLiveQrRequestRef,
      liveId,
      likeId,
      shareId,
      liveCard.liveViewRef,
      likeButton.liveViewRef,
      shareButton.liveViewRef,
      gridShownRef,
      autoFocusLive,
      openLiveQrRef,
      latch,
      idsRef,
      restoration,
    ],
  );

  return { onLivePress, onSharePress, onLikePress, returnFocus };
}
