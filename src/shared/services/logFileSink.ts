import { accountScope as appAccountScope, defineAccountScoped, type AccountScope } from '../account';
import { asyncKeyValueStore } from '../platform/asyncKeyValueStore';
import type { KeyValueStore } from '../platform/keyValueStore';
import { logFile as appLogFile, type LogFilePort } from '../platform/logFile';
import { logger as appLogger, type LogEntry, type Logger } from './logger';

/**
 * The diagnostics log file sink (Story 8.3, SET-05, AD-14). While capture
 * is on, every Logger entry (already redacted by the Logger, before it
 * reached the ring) is formatted as one line and appended to the capped
 * native file (`../platform/logFile`), pulled over adb. No upload, no share
 * sheet, no telemetry.
 *
 * - `enable()` queues the current ring first (the moments before the
 *   problem), then attaches to the Logger and streams new entries.
 * - Writes are batched: a batch goes when it holds 20 lines, or 1 s after
 *   its first line. Each append carries at most 20 lines.
 * - Account scope (AD-4): the file is account-scoped. Each batch captures
 *   `accountScope.guard('logFile', ...)` when its first line is queued, so a
 *   batch of an older generation is dropped at write time. The store's
 *   reset (`logFileAccountStore`, registered at bootstrap) drops the queued
 *   lines and clears the native file. The guard's "undo after an async
 *   write" is that clear: the native side runs calls serially in call
 *   order, and the reset's clear is always sent after any append that was
 *   sent before the generation bump, so it wins.
 * - A failed append logs one warning per `enable()`, to the ring only
 *   (never into the file it could not write); capture stays on.
 * - `clear()` (Diagnostics «Очистить логи») empties the ring, the queue and
 *   the file.
 */

/** A batch goes at this many lines. */
export const LOG_FILE_BATCH_SIZE = 20;
/** ... or this long after its first line. */
export const LOG_FILE_BATCH_MS = 1000;
/** A longer line is cut (a batch stays far below the 256 KB file cap). */
export const LOG_FILE_MAX_LINE = 2000;

const STORE_NAME = 'logFile';

/** One entry → one line: ISO time, level, `[scope]`, the message and the fields as JSON. */
export function formatLogLine(entry: LogEntry): string {
  const fields = entry.fields && Object.keys(entry.fields).length > 0 ? ` ${JSON.stringify(entry.fields)}` : '';
  const line = `${new Date(entry.time).toISOString()} ${entry.level.toUpperCase()} [${entry.scope}] ${entry.message}${fields}`.replace(
    /[\r\n]+/g,
    ' ',
  );
  return line.length > LOG_FILE_MAX_LINE ? `${line.slice(0, LOG_FILE_MAX_LINE)}…` : line;
}

export type LogFileSink = {
  /** Queue the ring, then stream new entries. A second call does nothing. */
  enable(): void;
  /** Stop streaming; lines queued while on are still written. */
  disable(): void;
  isEnabled(): boolean;
  /** Write the queued lines now (tests, `disable`). */
  flush(): void;
  /** The ring, the queue and the file emptied. Rejects when the native clear failed. */
  clear(): Promise<void>;
  /** AccountScope reset: the queue dropped, the file cleared. Rejects when the native clear failed. */
  reset(): Promise<void>;
};

export type LogFileSinkOptions = {
  logger?: Logger;
  file?: LogFilePort;
  /** Only `guard` is used. */
  scope?: Pick<AccountScope, 'guard'>;
  batchSize?: number;
  batchMs?: number;
};

type Batch = { lines: string[]; commit: (lines: string[]) => Promise<boolean> };

export function createLogFileSink({
  logger = appLogger,
  file = appLogFile,
  scope = appAccountScope,
  batchSize = LOG_FILE_BATCH_SIZE,
  batchMs = LOG_FILE_BATCH_MS,
}: LogFileSinkOptions = {}): LogFileSink {
  let enabled = false;
  let warned = false;
  /** Logging our own failure: that entry stays in the ring only. */
  let quiet = false;
  let batch: Batch | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const onWriteFailed = () => {
    if (warned) {
      return;
    }
    warned = true;
    quiet = true;
    try {
      logger.warn('diagnostics', 'log file write failed');
    } finally {
      quiet = false;
    }
  };

  const flush = () => {
    cancelTimer();
    const current = batch;
    batch = null;
    if (current === null) {
      return;
    }
    for (let start = 0; start < current.lines.length; start += batchSize) {
      // `commit` checks the generation and calls `file.append` synchronously.
      current.commit(current.lines.slice(start, start + batchSize)).catch(onWriteFailed);
    }
  };

  const queue = (line: string) => {
    if (batch === null) {
      const guarded = scope.guard<string[]>(STORE_NAME, lines => file.append(lines));
      batch = { lines: [], commit: lines => guarded.commit(lines) };
    }
    batch.lines.push(line);
    if (batch.lines.length >= batchSize) {
      flush();
    } else if (timer === null) {
      timer = setTimeout(flush, batchMs);
    }
  };

  const sink = (entry: LogEntry) => {
    if (enabled && !quiet) {
      queue(formatLogLine(entry));
    }
  };

  const drop = () => {
    cancelTimer();
    batch = null;
  };

  return {
    enable() {
      if (enabled) {
        return;
      }
      enabled = true;
      warned = false;
      // The ring first, as one queue (written in batches of `batchSize`).
      const ring = logger.entries();
      for (const entry of ring) {
        queue(formatLogLine(entry));
      }
      logger.setSink(sink);
    },
    disable() {
      if (!enabled) {
        return;
      }
      enabled = false;
      logger.setSink(null);
      flush();
    },
    isEnabled: () => enabled,
    flush,
    clear() {
      drop();
      logger.clear();
      return file.clear();
    },
    reset() {
      drop();
      return file.clear();
    },
  };
}

/** The app's sink: the app Logger, the native file, the app AccountScope. */
export const logFileSink: LogFileSink = createLogFileSink();

/**
 * The log file is account-scoped (AD-4): registered in `src/app/bootstrap.ts`
 * after the Logger's ring, so a reset empties both. A failed native clear
 * rejects, and AccountScope reports it in `failed[]`.
 */
export const logFileAccountStore = defineAccountScoped('logFile', () => logFileSink.reset());

/**
 * «Запись логов» (Story 8.3): device-scoped, default off. One KeyValueStore
 * key holding `on` or `off`. It is not registered with AccountScope: the
 * toggle survives sign-out (the file itself does not).
 */
export const DIAGNOSTICS_CAPTURE_KEY = 'diagnostics.capture.v1';

export type DiagnosticsCapture = {
  /** The value in memory; `undefined` until the first read finished. */
  peek(): boolean | undefined;
  /** Read once (off when none or unreadable) and apply it to the sink. */
  read(): Promise<boolean>;
  /** Memory and the sink at once, the store in the background (a failed write is only logged). */
  set(on: boolean): void;
  /** «Очистить логи»: the ring and the file. Resolves false when the file was not cleared. */
  clearLogs(): Promise<boolean>;
  /** Tests: forget the memory copy (the store and the sink are untouched). */
  forget(): void;
};

function getStored(kv: () => KeyValueStore): Promise<string | null> {
  try {
    return kv().get(DIAGNOSTICS_CAPTURE_KEY);
  } catch (error) {
    return Promise.reject(error);
  }
}

export function createDiagnosticsCapture(
  kv: () => KeyValueStore,
  sink: LogFileSink,
  logger: Logger = appLogger,
): DiagnosticsCapture {
  let value: boolean | undefined;
  let reading: Promise<boolean> | null = null;
  const apply = (on: boolean) => (on ? sink.enable() : sink.disable());
  return {
    peek: () => value,
    read() {
      if (value !== undefined) {
        return Promise.resolve(value);
      }
      if (reading === null) {
        reading = getStored(kv)
          .then(
            raw => raw === 'on',
            () => {
              logger.warn('diagnostics', 'capture preference not read');
              return false;
            },
          )
          .then(parsed => {
            // A toggle while the read ran wins (and was applied already).
            if (value === undefined) {
              value = parsed;
              apply(parsed);
            }
            reading = null;
            return value;
          });
      }
      return reading;
    },
    set(on) {
      value = on;
      apply(on);
      try {
        kv()
          .set(DIAGNOSTICS_CAPTURE_KEY, on ? 'on' : 'off')
          .catch(() => logger.warn('diagnostics', 'capture preference not stored'));
      } catch {
        logger.warn('diagnostics', 'capture preference not stored');
      }
    },
    clearLogs() {
      return sink.clear().then(
        () => true,
        () => {
          logger.warn('diagnostics', 'log file not cleared');
          return false;
        },
      );
    },
    forget() {
      value = undefined;
      reading = null;
    },
  };
}

/** Where the toggle persists: the `device` KeyValueStore, unless the app replaced it. */
let appKeyValueStore: () => KeyValueStore = () => asyncKeyValueStore('device');

/**
 * Replaces the toggle's KeyValueStore before first use. Only the debug-only
 * demo calls it (`src/app/session.ts`): the owner's real `boostytv-device`
 * database is never touched.
 */
export function setDiagnosticsCaptureKeyValueStore(kv: KeyValueStore): void {
  appKeyValueStore = () => kv;
}

/** The app's «Запись логов» toggle, driving `logFileSink`. */
export const diagnosticsCapture: DiagnosticsCapture = createDiagnosticsCapture(() => appKeyValueStore(), logFileSink);
