import { parseJson, type Transport } from '../../shared/api/transport';
import type { Logger } from '../../shared/services/logger';
import type { DevicePreference } from '../../shared/storage/devicePreference';
import { LATEST_RELEASE_URL, parseRelease, type KnownRelease } from './releaseInfo';
import type { UpdateState, UpdateStore } from './updateStore';
import { isNewerTag, parseVersionName } from './version';

/**
 * The UpdateChecker (Story 9.2, FR-56, UPD-01, AD-16): reads the latest
 * release of the fixed repository and compares its tag with the installed
 * `versionName`.
 *
 * The request is a plain anonymous GET to `LATEST_RELEASE_URL` with only
 * GitHub's `Accept` and API-version headers, `credentials: 'omit'`, a
 * bounded timeout and no retry. It goes through its own `Transport`, never
 * the Boosty `HttpClient` (no Boosty auth, no per-attempt `http` log line
 * with a Boosty path: Epic 8 retro X7). A failure writes exactly one log
 * entry (`update check failed`, fields `reason` and `status`) and changes
 * nothing visible.
 *
 * Gates:
 * - off (`enabled` false: the `updateCheck` flag off, or the demo): no
 *   request ever;
 * - an installed version that does not parse: no request (nothing could be
 *   newer);
 * - automatic (start, return to the foreground): at most once per
 *   `AUTO_INTERVAL_MS`, persisted as `lastCheckAt` (set by every attempt,
 *   success or not, so a failing GitHub never sees a request storm); a
 *   newer release shows the plaque each time such a check finds it;
 * - manual (a single OK on «Версия»): at most once per `MANUAL_INTERVAL_MS`,
 *   in memory; a newer release is returned (the caller opens the dialog);
 * - one request at a time: an automatic check while another runs is
 *   dropped; a manual check during an automatic one awaits its answer (a
 *   newer release found there opens the dialog), and runs its own only if
 *   that one sent no request.
 */

/** Automatic checks: at most once per day. */
export const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Manual checks: at most once per 60 s. */
export const MANUAL_INTERVAL_MS = 60 * 1000;
/** The request's bound. */
export const CHECK_TIMEOUT_MS = 10 * 1000;

/** The only headers the check sends. */
export const CHECK_HEADERS: Readonly<Record<string, string>> = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

export type UpdateCheckerDeps = {
  /** Read on every call: the `updateCheck` flag on and not the demo. */
  enabled: () => boolean;
  transport: Transport;
  logger: Logger;
  /** The native `versionName`, or null. */
  installedVersion: () => string | null;
  preference: Pick<DevicePreference<UpdateState>, 'read' | 'write'> & { forget?: () => void };
  store: UpdateStore;
  now?: () => number;
  timeoutMs?: number;
};

export type UpdateChecker = {
  /**
   * App start: reads the stored state, drops a release that is no longer
   * newer (the update was installed), publishes the rest, then runs the
   * automatic check.
   */
  start(): Promise<void>;
  /** Start and return to the foreground: the daily check; a newer release → the plaque. */
  checkAuto(): Promise<void>;
  /** A single OK on «Версия»: the newer release, or null (none, throttled, failed, off). */
  checkManual(): Promise<KnownRelease | null>;
  /** Tests only: forget this run (started, the manual throttle, memory of the stored state, the known release). */
  reset(): void;
};

/** An automatic check's answer: whether it sent a request, and the newer release it found. */
type InFlight = { requested: boolean; newer: KnownRelease | null };

type FetchResult =
  | { kind: 'ok'; release: KnownRelease | null }
  | { kind: 'failed'; reason: 'network' | 'timeout' | 'http' | 'parse'; status: number | null };

export function createUpdateChecker({
  enabled,
  transport,
  logger,
  installedVersion,
  preference,
  store,
  // Looked up per call (not captured), so a replaced clock is seen.
  now = () => Date.now(),
  timeoutMs = CHECK_TIMEOUT_MS,
}: UpdateCheckerDeps): UpdateChecker {
  let inFlight = false;
  /** The running automatic check (a manual call during it awaits it). */
  let current: Promise<InFlight> | null = null;
  let lastManualAt: number | null = null;
  let started = false;

  const canCheck = () => enabled() && parseVersionName(installedVersion()) !== null;

  const fetchLatest = async (): Promise<FetchResult> => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await transport(LATEST_RELEASE_URL, {
        method: 'GET',
        headers: { ...CHECK_HEADERS },
        credentials: 'omit',
        signal: controller.signal,
      });
      if (response.status !== 200) {
        return { kind: 'failed', reason: 'http', status: response.status };
      }
      const release = parseRelease(parseJson(await response.text()));
      return release ? { kind: 'ok', release } : { kind: 'failed', reason: 'parse', status: 200 };
    } catch {
      return { kind: 'failed', reason: timedOut ? 'timeout' : 'network', status: null };
    } finally {
      clearTimeout(timer);
    }
  };

  /** One request; the log entry; the known release updated. Null: failed. */
  const run = async (): Promise<{ newer: KnownRelease | null } | null> => {
    const result = await fetchLatest();
    if (result.kind === 'failed') {
      logger.warn('update', 'update check failed', { reason: result.reason, status: result.status });
      return null;
    }
    const newer = result.release && isNewerTag(result.release.tag, installedVersion()) ? result.release : null;
    logger.info('update', 'update check done', {
      status: 200,
      tag: result.release?.tag ?? null,
      newer: newer !== null,
    });
    store.setKnown(newer);
    return { newer };
  };

  const readState = (): Promise<UpdateState> =>
    preference.read().catch(() => ({ lastCheckAt: null, release: null }));

  const checker: UpdateChecker = {
    async start() {
      if (!enabled() || started) {
        return;
      }
      started = true;
      const state = await readState();
      if (state.release && !isNewerTag(state.release.tag, installedVersion())) {
        preference.write({ ...state, release: null });
        store.setKnown(null);
      } else {
        store.setKnown(state.release);
      }
      await checker.checkAuto();
    },
    async checkAuto() {
      if (!canCheck() || inFlight) {
        return;
      }
      inFlight = true;
      const pending = (async (): Promise<InFlight> => {
        try {
          const state = await readState();
          const at = now();
          if (state.lastCheckAt !== null && state.lastCheckAt <= at && at - state.lastCheckAt < AUTO_INTERVAL_MS) {
            return { requested: false, newer: null };
          }
          preference.write({ ...state, lastCheckAt: at });
          const result = await run();
          if (result) {
            preference.write({ lastCheckAt: at, release: result.newer });
            if (result.newer) {
              store.showPlaque(result.newer);
            }
          }
          return { requested: true, newer: result?.newer ?? null };
        } finally {
          inFlight = false;
          current = null;
        }
      })();
      current = pending;
      await pending;
    },
    async checkManual() {
      if (!canCheck()) {
        return null;
      }
      // An automatic check is running (e.g. right after a resume): its
      // answer is this one's, with no second request.
      const running = current;
      if (running) {
        const answer = await running;
        if (answer.requested) {
          return answer.newer;
        }
      }
      if (inFlight) {
        return null;
      }
      const at = now();
      if (lastManualAt !== null && lastManualAt <= at && at - lastManualAt < MANUAL_INTERVAL_MS) {
        return null;
      }
      lastManualAt = at;
      inFlight = true;
      try {
        const result = await run();
        if (!result) {
          return null;
        }
        const state = await readState();
        preference.write({ ...state, release: result.newer });
        return result.newer;
      } finally {
        inFlight = false;
      }
    },
    reset() {
      started = false;
      inFlight = false;
      current = null;
      lastManualAt = null;
      preference.forget?.();
      store.setKnown(null);
    },
  };
  return checker;
}
