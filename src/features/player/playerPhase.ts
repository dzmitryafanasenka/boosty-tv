import { t } from '../../shared/i18n';
import type { MediaSourceState } from './mediaResolver';
import type { PlaybackKind } from './playbackMode';

/** `ended` (Story 7.2): live only, the stream ended or is gone («Стрим завершён»). */
export type Phase = 'loading' | 'playing' | 'recovering' | 'error' | 'locked' | 'unavailable' | 'ended';

type ReadySource = Extract<MediaSourceState, { kind: 'ready' }>;

/**
 * «Восстанавливаем воспроизведение…» (Story 4.4) stays while the fresh E8
 * runs and while the recovered source loads and seeks to its start.
 * `recovery`: the broken source's resolution, null without a recovery.
 */
export function isRecovering({
  recovery,
  state,
  failed,
  everReady,
}: {
  recovery: { from: number } | null;
  state: MediaSourceState;
  /** The ready source's resolution is the one that failed. */
  failed: boolean;
  /** A source of this opening was ready once. */
  everReady: boolean;
}): boolean {
  const ready: ReadySource | null = state.kind === 'ready' ? state : null;
  return (
    recovery !== null &&
    ((ready !== null && (ready.resolution === recovery.from || !failed)) || (state.kind === 'locked' && everReady))
  );
}

/** The player's phase from the media state and the session's recovery state. */
export function derivePhase({
  kind,
  liveEnded,
  state,
  recovering,
  failed,
  everReady,
}: {
  kind: PlaybackKind;
  /** Live only: the engine reported the end of the stream. */
  liveEnded: boolean;
  state: MediaSourceState;
  recovering: boolean;
  failed: boolean;
  everReady: boolean;
}): Phase {
  const live = kind === 'live';
  return live && (liveEnded || state.kind === 'unavailable')
    ? 'ended'
    : state.kind === 'loading' || (live && state.kind === 'noSource')
      ? // Live and not playable here: the player leaves at once (the origin's QR).
        'loading'
      : recovering
        ? 'recovering'
        : state.kind === 'locked'
          ? // A locked retry after playback waits for its session check, then leaves.
            everReady
            ? 'error'
            : 'locked'
          : state.kind === 'unavailable'
            ? 'unavailable'
            : state.kind === 'ready' && !failed
              ? 'playing'
              : 'error';
}

/** The state panel's focused action: «Повторить», «Назад», or none (no panel). */
export type ErrorTarget = 'retry' | 'back' | null;

/** `retryable`: the error state offers «Повторить» (`PlaybackMode.retryable`). */
export function errorTarget(phase: Phase, retryable: boolean): ErrorTarget {
  return phase === 'error'
    ? retryable
      ? 'retry'
      : 'back'
    : phase === 'locked' || phase === 'unavailable' || phase === 'ended'
      ? 'back'
      : null;
}

/** The state panel's copy; `liveState` (from `liveCopy`) replaces it for a live stream. */
export function errorCopy(
  phase: Phase,
  state: MediaSourceState,
  liveState: { title: string; body: string } | null,
): { title: string; body: string } {
  return liveState !== null
    ? liveState
    : phase === 'locked'
      ? { title: t('player.noAccessTitle'), body: t('player.noAccessBody') }
      : phase === 'unavailable'
        ? { title: t('player.unavailableTitle'), body: t('player.unavailableBody') }
        : {
            title: t('player.errorTitle'),
            body: state.kind === 'error' ? t(`error.${state.error}`) : t('player.errorBody'),
          };
}
