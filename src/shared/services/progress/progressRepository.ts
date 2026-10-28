import { accountScope as appAccountScope, type AccountScope } from '../../account/accountScope';
import type { HttpClient, SessionStatus } from '../../api';
import type { MediaRef } from '../../entities/post/types';
import { logger as appLogger, type Logger } from '../logger';
import { isFinished } from './finished';
import type { ProgressMeta, ProgressStore } from './progressStore';

/**
 * ProgressRepository (Story 4.2, AD-10, ADR 0004): the only writer of E9
 * (`PUT /v1/viewstat/video/{mediaId}/timecode/`, form `time_code`, integer
 * seconds, content profile, the active session's client) and of the local
 * progress store, and the only reader of the server `timeCode` (the E8
 * sink `onServerProgress`).
 *
 * Writes (per media id):
 * - The player calls `report` only after the start position was reached
 *   (never a new source's pre-seek `t=0`). Short visits (owner decision
 *   2026-10-28): a player session writes nothing, locally or by E9, until
 *   it moved ≥ `WRITE_MOVEMENT_SEC` from its first reported position or the
 *   user paused; a forced exit, background or end before that writes
 *   nothing. Then: the first report sets the mark;
 *   a `tick` triggers when the position moved ≥ `WRITE_MOVEMENT_SEC` from
 *   the last trigger; `pause`, `background`, `exit` and `end` always trigger
 *   (unless that exact position is already written). A trigger updates the
 *   local entry (memory at once; the disk debounced, at once when forced)
 *   and asks for an E9 write.
 * - One E9 in flight; a trigger meanwhile is remembered and the latest
 *   position is sent when it lands. A failed write is re-sent only with the
 *   latest position, no sooner than `WRITE_RETRY_MS` after the failure, at
 *   most `MAX_AUTO_RETRIES` times by itself (a later trigger sends again).
 *   No other mutation is ever replayed (AD-6).
 * - A write that fails while the session is `expired` (or asked for while
 *   it is) is held, latest position only, and sent when the session is
 *   `signedIn` again with the same `AccountScope.generation()`; a reset
 *   (sign-out, account switch) drops it.
 * - A write that lands after a reset is ignored.
 * - Logs outcomes only: no ids, no positions, no URLs.
 */

export const WRITE_MOVEMENT_SEC = 10;
export const WRITE_RETRY_MS = 10_000;
export const MAX_AUTO_RETRIES = 5;

/** Why the player reports a position. Every event but `tick` forces a write. */
export type ProgressEvent = 'tick' | 'pause' | 'background' | 'exit' | 'end';

export type ProgressSession = {
  /** The active session's content client. */
  readonly http: HttpClient;
  getStatus(): SessionStatus;
  subscribe(listener: (status: SessionStatus) => void): () => void;
};

export type ProgressRepository = {
  /** The local store (read by `useProgress`). */
  readonly store: ProgressStore;
  /** Loads the local store (the player waits for it before it starts). */
  ready(): Promise<void>;
  /** A player session for `ref` starts (its source is ready). */
  begin(ref: MediaRef, meta: ProgressMeta): void;
  /** The current position (integer seconds); `durationSec` when the engine knows it. */
  report(ref: MediaRef, positionSec: number, event: ProgressEvent, durationSec?: number | null): void;
  /**
   * Where playback starts: the local position when a local entry exists,
   * else the server `timeCode`; 0 when there is none or it is finished
   * (or at/after the end). Call after `ready()`.
   */
  resumePoint(ref: MediaRef, durationSec?: number | null): number;
  /** The E8 sink: a video's server `timeCode` (never stored on the post). */
  onServerProgress(mediaId: string, positionSec: number): void;
  /**
   * Story 4.7 (owner decision 2026-10-28): the video's post is locked
   * (session checked) or gone: drop its local entry (it leaves the Continue
   * row) and its writer, so this player session writes nothing more. No
   * request is sent.
   */
  forget(mediaId: string): void;
  /** Stops listening to the session and drops timers (tests). */
  dispose(): void;
};

export type ProgressRepositoryDeps = {
  session: ProgressSession;
  store: ProgressStore;
  scope?: Pick<AccountScope, 'generation'>;
  logger?: Logger;
  now?: () => number;
};

/** E9 path; the media id is one path segment. */
export function timecodePath(mediaId: string): string {
  return `/v1/viewstat/video/${encodeURIComponent(mediaId)}/timecode/`;
}

type Writer = {
  ref: MediaRef;
  meta: ProgressMeta | null;
  durationSec: number | null;
  /** The latest reported position. */
  latest: number | null;
  /** The position of the last trigger (the movement baseline). */
  mark: number | null;
  /** The first position this player session reported (the short-visit baseline). */
  start: number | null;
  /**
   * The session may write: it moved ≥ `WRITE_MOVEMENT_SEC` from `start` or
   * the user paused (owner decision 2026-10-28, short visits).
   */
  armed: boolean;
  /** The last position E9 accepted. */
  lastSuccess: number | null;
  inFlight: boolean;
  /** A write is owed (sent with `latest` when allowed). */
  pending: boolean;
  /** When the last write failed (the retry gate). */
  failedAt: number | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  autoRetries: number;
  /** Held while the session is expired: the generation it was held under. */
  held: number | null;
};

const wholeSec = (value: number) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

export function createProgressRepository({
  session,
  store,
  scope = appAccountScope,
  logger = appLogger,
  now = () => Date.now(),
}: ProgressRepositoryDeps): ProgressRepository {
  let writers = new Map<string, Writer>();

  function writerFor(ref: MediaRef): Writer {
    let writer = writers.get(ref.mediaId);
    if (writer === undefined) {
      writer = {
        ref,
        meta: null,
        durationSec: null,
        latest: null,
        mark: null,
        start: null,
        armed: false,
        lastSuccess: null,
        inFlight: false,
        pending: false,
        failedAt: null,
        retryTimer: null,
        autoRetries: 0,
        held: null,
      };
      writers.set(ref.mediaId, writer);
    }
    return writer;
  }

  function clearRetry(writer: Writer) {
    if (writer.retryTimer !== null) {
      clearTimeout(writer.retryTimer);
      writer.retryTimer = null;
    }
  }

  function requestWrite(writer: Writer) {
    if (writer.latest === null) {
      return;
    }
    if (!writer.inFlight && writer.latest === writer.lastSuccess) {
      // Already accepted: nothing owed.
      writer.pending = false;
      return;
    }
    if (session.getStatus() === 'expired') {
      // Never sent with a dead session: held until the same account is back.
      writer.pending = false;
      writer.held = scope.generation();
      return;
    }
    if (writer.inFlight) {
      writer.pending = true;
      return;
    }
    if (writer.failedAt !== null && now() - writer.failedAt < WRITE_RETRY_MS) {
      writer.pending = true;
      scheduleRetry(writer, false);
      return;
    }
    send(writer, writer.latest);
  }

  function scheduleRetry(writer: Writer, automatic: boolean) {
    if (writer.retryTimer !== null || writer.failedAt === null) {
      return;
    }
    if (automatic && writer.autoRetries >= MAX_AUTO_RETRIES) {
      // Bounded: the next trigger (movement, pause, exit) sends again.
      return;
    }
    const wait = Math.max(0, writer.failedAt + WRITE_RETRY_MS - now());
    writer.retryTimer = setTimeout(() => {
      writer.retryTimer = null;
      if (writer.pending && writers.get(writer.ref.mediaId) === writer) {
        writer.autoRetries += automatic ? 1 : 0;
        writer.pending = false;
        requestWrite(writer);
      }
    }, wait);
  }

  function send(writer: Writer, positionSec: number) {
    const generation = scope.generation();
    writer.inFlight = true;
    writer.pending = false;
    clearRetry(writer);
    session.http
      .request({
        method: 'PUT',
        path: timecodePath(writer.ref.mediaId),
        form: [['time_code', String(positionSec)]],
      })
      .then(
        () => {
          if (generation !== scope.generation() || writers.get(writer.ref.mediaId) !== writer) {
            return;
          }
          writer.inFlight = false;
          writer.lastSuccess = positionSec;
          writer.failedAt = null;
          writer.autoRetries = 0;
          if (writer.pending) {
            writer.pending = false;
            requestWrite(writer);
          }
        },
        () => {
          if (generation !== scope.generation() || writers.get(writer.ref.mediaId) !== writer) {
            return;
          }
          writer.inFlight = false;
          if (session.getStatus() === 'expired') {
            writer.pending = false;
            writer.held = generation;
            logger.info('progress', 'write held', { outcome: 'expired' });
            return;
          }
          logger.info('progress', 'write failed', { outcome: 'retry' });
          writer.failedAt = now();
          writer.pending = true;
          scheduleRetry(writer, true);
        },
      );
  }

  function putLocal(writer: Writer, positionSec: number, flush: boolean) {
    const existing = store.get(writer.ref.mediaId);
    const meta = writer.meta ?? existing?.meta;
    if (meta === undefined) {
      return;
    }
    store.put(
      {
        ref: writer.ref,
        positionSec,
        durationSec: writer.durationSec ?? meta.durationSec ?? existing?.durationSec ?? null,
        updatedAt: now(),
        meta,
      },
      { flush },
    );
  }

  const unsubscribeSession = session.subscribe(status => {
    if (status !== 'signedIn') {
      return;
    }
    const generation = scope.generation();
    for (const writer of writers.values()) {
      if (writer.held === null) {
        continue;
      }
      const same = writer.held === generation;
      writer.held = null;
      if (same) {
        logger.info('progress', 'held write flushed');
        requestWrite(writer);
      }
    }
  });

  const unsubscribeReset = store.onReset(() => {
    for (const writer of writers.values()) {
      clearRetry(writer);
    }
    writers = new Map();
  });

  return {
    store,
    ready: () => store.ready(),
    begin(ref, meta) {
      const writer = writerFor(ref);
      writer.ref = ref;
      writer.meta = meta;
      if (meta.durationSec !== null && meta.durationSec > 0) {
        writer.durationSec = meta.durationSec;
      }
      // A new player session: the first report sets the baseline again.
      writer.mark = null;
      writer.start = null;
      writer.armed = false;
    },
    report(ref, positionSec, event, durationSec) {
      const writer = writers.get(ref.mediaId);
      if (writer === undefined || writer.meta === null) {
        return;
      }
      const position = wholeSec(positionSec);
      if (durationSec !== undefined && durationSec !== null && durationSec > 0) {
        writer.durationSec = Math.floor(durationSec);
      }
      const forced = event !== 'tick';
      if (writer.start === null) {
        writer.start = position;
        writer.mark = position;
      }
      if (!writer.armed) {
        // A short visit (a finished video reopened, a replay, «С начала»)
        // never erases progress: nothing is written, locally or by E9, until
        // the session moved ≥ 10 s from its start or the user paused; exit,
        // background and end before that write nothing (owner decision
        // 2026-10-28). `latest` stays untouched, so an owed write of an
        // earlier session never sends this session's position.
        if (event !== 'pause' && Math.abs(position - writer.start) < WRITE_MOVEMENT_SEC) {
          return;
        }
        writer.armed = true;
      }
      writer.latest = position;
      if (!forced && Math.abs(position - (writer.mark ?? position)) < WRITE_MOVEMENT_SEC) {
        return;
      }
      if (forced && writer.mark === position && writer.lastSuccess === position && !writer.inFlight) {
        // Nothing new since the last accepted write; still persist the disk.
        store.flush().catch(() => {});
        return;
      }
      writer.mark = position;
      putLocal(writer, position, forced);
      if (writer.held !== null) {
        // Held: the flush after re-login sends `latest`.
        return;
      }
      requestWrite(writer);
    },
    resumePoint(ref, durationSec) {
      const engineDuration = durationSec !== undefined && durationSec !== null && durationSec > 0 ? durationSec : null;
      const entry = store.get(ref.mediaId);
      if (entry !== undefined) {
        const duration = engineDuration ?? entry.durationSec;
        return startAt(entry.positionSec, duration);
      }
      const serverSec = store.serverPosition(ref.mediaId);
      return serverSec === undefined ? 0 : startAt(serverSec, engineDuration);
    },
    onServerProgress(mediaId, positionSec) {
      store.setServerPosition(mediaId, wholeSec(positionSec));
    },
    forget(mediaId) {
      const writer = writers.get(mediaId);
      if (writer !== undefined) {
        clearRetry(writer);
        writers.delete(mediaId);
      }
      store.remove(mediaId);
    },
    dispose() {
      unsubscribeSession();
      unsubscribeReset();
      for (const writer of writers.values()) {
        clearRetry(writer);
      }
    },
  };
}

/** 0 for no progress, a finished one, or a position at/after the end. */
function startAt(positionSec: number, durationSec: number | null): number {
  if (positionSec <= 0 || isFinished(positionSec, durationSec)) {
    return 0;
  }
  if (durationSec !== null && positionSec >= durationSec) {
    return 0;
  }
  return positionSec;
}
