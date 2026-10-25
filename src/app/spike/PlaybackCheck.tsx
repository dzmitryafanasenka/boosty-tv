import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TVFocusGuideView,
  useTVEventHandler,
  View,
} from 'react-native';
import * as Keychain from 'react-native-keychain';
import Video, {
  type OnLoadData,
  type OnPlaybackStateChangedData,
  type OnProgressData,
  type OnSeekData,
  type OnVideoErrorData,
  type VideoRef,
} from 'react-native-video';
import {
  buildBlogPostsRequest,
  buildPostRequest,
  buildSubscriptionsRequest,
  postsOf,
  subscriptionBlogUrls,
} from './contentShapesApi';
import {
  DESKTOP_USER_AGENT,
  execute,
  formatSanitized,
  type ApiRequest,
  type FetchLike,
} from './phoneAuthApi';
import { SESSION_SERVICE } from './PhoneAuthCheck';
import {
  buildBadTokenPostRequest,
  buildProgressRequest,
  describeUrlShape,
  withApiProfile,
  type ApiProfile,
  expiresInS,
  findSameMedia,
  MAX_CANDIDATES,
  ProgressThrottle,
  redactForLog,
  RUN_REQUEST_BUDGET,
  sec,
  SEEK_STEP_S,
  videoCandidates,
  type PlayerSource,
  type VideoCandidate,
  type WriteReason,
} from './playbackApi';
import {
  createRefreshCoordinator,
  type CallResult,
} from './refreshCoordinator';
import { getInstallId, keychainStorageReset } from './spikeNative';
import { createSpikeSecureStore } from './spikeSecureStore';
import {
  SpikeButton,
  SpikeLog,
  SpikeScreen,
  spikeColors,
  spikeLog,
  useBackToMenu,
} from './SpikeUi';

/**
 * Story 1.6 spike only (branch spike/1-6-playback). Finds accessible
 * `ok_video` posts (E2 + E4, at most 5 blogs), lets the owner pick one, and
 * plays its signed `playerUrls` with react-native-video (HLS, each MP4
 * quality, DASH) with the position kept across switches. Records time to
 * first frame, a header-less URL probe, one automatic E8 re-resolve after a
 * player error, the E9 cadence, AppState transitions, remote events, and one
 * E8 with a synthetic Bearer.
 *
 * Every log line and on-screen error text goes through `redactForLog`. Logs
 * carry no titles, ids, URLs or tokens; the title and the URL age are shown
 * on screen only. Media URLs live in memory only.
 */

const fetchImpl: FetchLike = (url, init) =>
  (fetch as unknown as FetchLike)(url, init);

/** Per app run (module scope): survives screen re-entry, not a restart. */
const run = { api: 0, probes: 0 };
/** Last successful E9 write, in memory only (for the round-trip check). */
let lastWrite: { mediaId: string; seconds: number } | null = null;

/** Test hook: reset or preset the per-run counters. */
export function __setRunStateForTests(api = 0) {
  run.api = api;
  run.probes = 0;
  lastWrite = null;
}

const MEDIA_KEYS = new Set([
  'play',
  'pause',
  'playPause',
  'rewind',
  'fastForward',
  'stop',
  'next',
  'previous',
]);
const PLAYER_KEYS = new Set(['left', 'right', 'select']);
/** Position movement that re-arms the single automatic recovery. */
const RECOVERY_REARM_S = 5;
const PROBE_TIMEOUT_MS = 15_000;

type Selected = VideoCandidate & { sources: PlayerSource[] };
type Current = { source: PlayerSource; key: number; startAt: number };
type Recovery = 'idle' | 'recovering' | 'recovered';

type TvEvent = Parameters<Parameters<typeof useTVEventHandler>[0]>[0];

const is2xx = (status: number) => status >= 200 && status < 300;

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Probe User-Agent variants for the CDN 400 diagnosis (status only). */
const WEB_CONTEXT = {
  Referer: 'https://boosty.to/',
  Origin: 'https://boosty.to',
};
const PROBE_VARIANTS: ReadonlyArray<{
  id: string;
  headers?: Record<string, string>;
}> = [
  { id: 'default' },
  { id: 'chrome', headers: { 'User-Agent': DESKTOP_USER_AGENT } },
  { id: 'referer', headers: { Referer: WEB_CONTEXT.Referer } },
  {
    id: 'chrome+referer',
    headers: { 'User-Agent': DESKTOP_USER_AGENT, Referer: WEB_CONTEXT.Referer },
  },
  {
    id: 'chrome+referer+origin',
    headers: { 'User-Agent': DESKTOP_USER_AGENT, ...WEB_CONTEXT },
  },
];

type ProbeResult = {
  status: number | 'network' | 'timeout';
  contentType?: string;
  /** Redacted start of a non-2xx body; empty for 2xx. */
  body: string;
};

/**
 * Status-only probe of the current media URL: only `Range` (and, per
 * variant, `User-Agent`), no credentials. XMLHttpRequest (the transport
 * under RN `fetch`) is used so a 2xx is aborted as soon as the status
 * arrives: a server that ignores `Range` must not turn the probe into a
 * download. A non-2xx body (a short CDN error) is read, redacted and cut.
 */
function probeStatus(
  url: string,
  headers: Record<string, string> = {},
): Promise<ProbeResult> {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    let done = false;
    const finish = (r: ProbeResult) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(r);
      }
    };
    const timer = setTimeout(() => {
      finish({ status: 'timeout', body: '' });
      xhr.abort();
    }, PROBE_TIMEOUT_MS);
    xhr.onreadystatechange = () => {
      if (xhr.readyState < 2 || xhr.status <= 0) {
        return;
      }
      const contentType = xhr.getResponseHeader('Content-Type') ?? undefined;
      if (xhr.status >= 200 && xhr.status < 300) {
        finish({ status: xhr.status, contentType, body: '' });
        xhr.abort();
      } else if (xhr.readyState === 4) {
        finish({
          status: xhr.status,
          contentType,
          body: redactForLog(String(xhr.responseText ?? '')).slice(0, 160),
        });
      }
    };
    xhr.onerror = () => finish({ status: 'network', body: '' });
    xhr.withCredentials = false;
    xhr.open('GET', url);
    xhr.setRequestHeader('Range', 'bytes=0-0');
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.send();
  });
}

export function PlaybackCheck({ onExit }: { onExit: () => void }) {
  useBackToMenu(onExit);

  const [status, setStatus] = useState('…');
  const [lines, setLines] = useState<string[]>([]);
  const [apiCount, setApiCount] = useState(run.api);
  const [probeCount, setProbeCount] = useState(run.probes);
  const [candidates, setCandidates] = useState<VideoCandidate[]>([]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [current, setCurrent] = useState<Current | null>(null);
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState(0);
  const [errorText, setErrorText] = useState('');
  const [urlFetchedAt, setUrlFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [playerFocused, setPlayerFocused] = useState(false);

  const busyRef = useRef(false);
  const profileRef = useRef<ApiProfile>('reference');
  const [profile, setProfile] = useState<ApiProfile>('reference');
  const videoRef = useRef<VideoRef>(null);
  const positionRef = useRef(0);
  const seekTargetRef = useRef<number | null>(null);
  const lastSeekAtRef = useRef(0);
  /**
   * Start position of a newly set source until the player reaches it. A
   * new source reports t=0 before the seek-after-load, which must neither
   * be written to E9 nor become the kept position.
   */
  const startPendingRef = useRef<number | null>(null);
  const durationRef = useRef(0);
  const pausedRef = useRef(false);
  const selectedRef = useRef<Selected | null>(null);
  const currentRef = useRef<Current | null>(null);
  const throttleRef = useRef(new ProgressThrottle());
  const loadStartRef = useRef<{ at: number; logged: boolean } | null>(null);
  const recoveryRef = useRef<{ state: Recovery; at: number }>({
    state: 'idle',
    at: 0,
  });
  const keyRef = useRef(0);
  const playerFocusedRef = useRef(false);
  const appStateRef = useRef<string>(String(AppState.currentState));

  const log = useCallback((...entries: string[]) => {
    const safe = entries.map(redactForLog);
    for (const entry of safe) {
      spikeLog('playback', entry);
    }
    const stamp = new Date().toISOString().slice(11, 19);
    setLines(prev =>
      [...safe.map(e => `${stamp} ${e}`).reverse(), ...prev].slice(0, 400),
    );
  }, []);

  const report = useCallback(
    (line: string) => {
      setStatus(redactForLog(line));
      log(line);
    },
    [log],
  );

  const coordinator = useMemo(
    () =>
      createRefreshCoordinator({
        store: createSpikeSecureStore({
          service: SESSION_SERVICE,
          keychain: Keychain,
          helper: keychainStorageReset,
          log: line => log(`[store] ${line}`),
        }),
        fetchImpl,
        getDeviceId: getInstallId,
        log: line => log(`[coord] ${line}`),
      }),
    [log],
  );

  useEffect(() => {
    coordinator
      .reload()
      .then(s => report(`stored session: ${s} (no request)`))
      .catch(() => log('mount: unexpected rejection'));
  }, [coordinator, log, report]);

  // URL age on screen (1 s tick).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ------------------------------------------------------------ requests --

  /**
   * Authorized call through the coordinator, inside the per-run budget
   * (worst case 3 requests: 401 → refresh → retry). Null when refused.
   */
  const callApi = useCallback(
    async (build: () => ApiRequest): Promise<CallResult | null> => {
      if (run.api + 3 > RUN_REQUEST_BUDGET) {
        log(`budget: ${run.api}/${RUN_REQUEST_BUDGET} reached, not sent`);
        return null;
      }
      const before = coordinator.getCounts();
      try {
        return await coordinator.callWithSession(build);
      } finally {
        const after = coordinator.getCounts();
        run.api += after.api - before.api + (after.refresh - before.refresh);
        setApiCount(run.api);
      }
    },
    [coordinator, log],
  );

  const resolvePost = useCallback(
    async (c: VideoCandidate, type?: string) => {
      log(`E8 profile=${profileRef.current}`);
      const r = await callApi(() =>
        withApiProfile(
          buildPostRequest(c.blogUrl, c.postId),
          profileRef.current,
        ),
      );
      if (!r) {
        return { kind: 'budget' as const };
      }
      if (r.kind !== 'response') {
        log(`E8: ${r.kind}`);
        return { kind: 'session' as const };
      }
      if (!is2xx(r.sanitized.status)) {
        return { kind: 'http' as const, status: r.sanitized.status };
      }
      return {
        kind: 'post' as const,
        media: findSameMedia(r.json, c.mediaId, type),
      };
    },
    [callApi, log],
  );

  // ------------------------------------------------------------- E9 ------

  const writeProgress = useCallback(
    async (reason: WriteReason) => {
      const media = selectedRef.current;
      if (!media || !currentRef.current) {
        return;
      }
      const throttle = throttleRef.current;
      const s = throttle.next(positionRef.current, reason);
      if (s === null) {
        if (reason !== 'progress') {
          log(`E9 ${reason}: skipped (t=${sec(positionRef.current)})`);
        }
        return;
      }
      throttle.begin();
      let ok = false;
      let outcome = 'not sent';
      try {
        const r = await callApi(() => buildProgressRequest(media.mediaId, s));
        if (r?.kind === 'response') {
          ok = is2xx(r.sanitized.status);
          outcome = `HTTP ${r.sanitized.status}`;
          if (!ok) {
            log(...formatSanitized(r.sanitized));
          }
        } else if (r) {
          outcome = r.kind;
        }
      } finally {
        throttle.done(s, ok);
      }
      if (ok) {
        lastWrite = { mediaId: media.mediaId, seconds: s };
      }
      log(`E9 ${reason} t=${s} → ${outcome}${ok ? '' : ' (not retried)'}`);
    },
    [callApi, log],
  );

  // Exit (Back or unmount): one E9 write with the last position.
  useEffect(() => {
    return () => {
      writeProgress('exit').catch(() => spikeLog('playback', 'E9 exit threw'));
    };
  }, [writeProgress]);

  // AppState: log transitions and the player state; write on background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      log(
        `appstate ${prev} → ${next}; player ${
          currentRef.current ? currentRef.current.source.type : 'none'
        } paused=${pausedRef.current} t=${sec(positionRef.current)}`,
      );
      if (next === 'background') {
        writeProgress('background').catch(() => log('E9 background threw'));
      }
    });
    return () => sub.remove();
  }, [log, writeProgress]);

  // ------------------------------------------------------------ player ---

  const startSource = useCallback(
    (source: PlayerSource, startAt: number) => {
      keyRef.current += 1;
      seekTargetRef.current = null;
      const next = { source, key: keyRef.current, startAt };
      currentRef.current = next;
      setCurrent(next);
      loadStartRef.current = { at: Date.now(), logged: false };
      startPendingRef.current = startAt > 0 ? startAt : null;
      positionRef.current = startAt;
      log(`source set ${source.type} (${source.kind}) start t=${sec(startAt)}`);
      log(`url shape ${source.type}: ${describeUrlShape(source.url)}`);
      log(`url expires in ${expiresInS(source.url, Date.now()) ?? '-'} s`);
    },
    [log],
  );

  const setPausedBoth = useCallback(
    (value: boolean, via: string) => {
      if (pausedRef.current === value) {
        return;
      }
      pausedRef.current = value;
      setPaused(value);
      log(
        `${value ? 'pause' : 'play'} via ${via} t=${sec(positionRef.current)}`,
      );
      if (value) {
        writeProgress('pause').catch(() => log('E9 pause threw'));
      }
    },
    [log, writeProgress],
  );

  const togglePause = useCallback(
    (via: string) => setPausedBoth(!pausedRef.current, via),
    [setPausedBoth],
  );

  const seekBy = useCallback(
    (delta: number, via: string) => {
      if (!currentRef.current) {
        return;
      }
      // Presses during an in-flight seek build on its target, not on the
      // stale playback position (onProgress lags until the seek is done).
      const base = seekTargetRef.current ?? positionRef.current;
      const target = Math.max(0, base + delta);
      seekTargetRef.current = target;
      lastSeekAtRef.current = Date.now();
      log(`seek ${delta > 0 ? '+' : ''}${delta} via ${via} → t=${sec(target)}`);
      videoRef.current?.seek(target);
    },
    [log],
  );

  const selectSource = useCallback(
    (source: PlayerSource) => {
      const from = currentRef.current?.source.type ?? 'none';
      const keep = positionRef.current;
      log(`switch ${from} → ${source.type} keep t=${sec(keep)}`);
      startSource(source, keep);
    },
    [log, startSource],
  );

  const stopWithError = useCallback(
    (message: string) => {
      currentRef.current = null;
      setCurrent(null);
      setErrorText(message);
      report(`Остановлено: ${message}`);
    },
    [report],
  );

  const recover = useCallback(
    async (type: string) => {
      const media = selectedRef.current;
      if (!media) {
        return;
      }
      const resumeAt = positionRef.current;
      log(`recovery: E8 re-fetch for the same media, type ${type}`);
      const r = await resolvePost(media, type);
      if (r.kind === 'post' && r.media.kind === 'found') {
        const { source, sources } = r.media;
        const fresh = { ...media, sources };
        selectedRef.current = fresh;
        setSelected(fresh);
        setUrlFetchedAt(Date.now());
        recoveryRef.current = { state: 'recovered', at: resumeAt };
        log(`recovery: re-resolved ${source.type}, resume t=${sec(resumeAt)}`);
        startSource(source, resumeAt);
        return;
      }
      const why =
        r.kind === 'post'
          ? `re-resolve ${r.media.kind}`
          : r.kind === 'http'
          ? `E8 HTTP ${r.status}`
          : r.kind;
      stopWithError(`восстановление не удалось (${why})`);
    },
    [log, resolvePost, startSource, stopWithError],
  );

  const onError = useCallback(
    (e: OnVideoErrorData) => {
      const type = currentRef.current?.source.type ?? 'none';
      const message = redactForLog(
        `code=${e.error.errorCode ?? '-'} ${e.error.errorString ?? ''} ${
          e.error.errorException ?? ''
        }`,
      ).slice(0, 300);
      log(`player ERROR ${type}: ${message}`);
      setErrorText(message);
      if (recoveryRef.current.state === 'idle') {
        recoveryRef.current = { state: 'recovering', at: positionRef.current };
        recover(type).catch(() => stopWithError('recovery threw'));
        return;
      }
      log('second failure → stop (no further automatic recovery)');
      stopWithError(message);
    },
    [log, recover, stopWithError],
  );

  const onLoad = useCallback(
    (e: OnLoadData) => {
      const c = currentRef.current;
      durationRef.current = e.duration;
      log(
        `load ${c?.source.type ?? '-'} duration=${sec(e.duration)} size=${
          e.naturalSize.width
        }x${e.naturalSize.height}`,
      );
      if (c && c.startAt > 0) {
        log(`seek-after-load → t=${sec(c.startAt)}`);
        videoRef.current?.seek(c.startAt);
      }
    },
    [log],
  );

  const onReadyForDisplay = useCallback(() => {
    const start = loadStartRef.current;
    if (start && !start.logged) {
      start.logged = true;
      log(
        `TTFF ${currentRef.current?.source.type ?? '-'} ${
          Date.now() - start.at
        } ms`,
      );
    }
  }, [log]);

  const onProgress = useCallback(
    (e: OnProgressData) => {
      const pending = startPendingRef.current;
      if (pending !== null) {
        if (Math.abs(e.currentTime - pending) > 2) {
          return; // still before the seek-after-load: not a real position
        }
        startPendingRef.current = null;
      }
      positionRef.current = e.currentTime;
      setPosition(e.currentTime);
      // A seek that landed away from its target (keyframe snap) must not
      // pin later presses to that target.
      if (
        seekTargetRef.current !== null &&
        Date.now() - lastSeekAtRef.current > 5000
      ) {
        seekTargetRef.current = null;
      }
      const rec = recoveryRef.current;
      if (
        rec.state === 'recovered' &&
        e.currentTime >= rec.at + RECOVERY_REARM_S
      ) {
        recoveryRef.current = { state: 'idle', at: 0 };
        log(`recovery: playback resumed past t=${sec(rec.at)}; re-armed`);
      }
      if (!pausedRef.current) {
        writeProgress('progress').catch(() => log('E9 progress threw'));
      }
    },
    [log, writeProgress],
  );

  // --------------------------------------------------------- TV remote ---

  const onTvEvent = useCallback(
    (evt: TvEvent) => {
      const type = evt.eventType;
      const action = Number(evt.eventKeyAction ?? -1);
      if (MEDIA_KEYS.has(type)) {
        log(`tv ${type} action=${action}`);
        if (action === 1) {
          return; // act on key down only
        }
        if (type === 'playPause') {
          togglePause(`media key ${type}`);
        } else if (type === 'play') {
          setPausedBoth(false, 'media key play');
        } else if (type === 'pause') {
          setPausedBoth(true, 'media key pause');
        } else if (type === 'rewind') {
          seekBy(-SEEK_STEP_S, 'media key rewind');
        } else if (type === 'fastForward') {
          seekBy(SEEK_STEP_S, 'media key fastForward');
        }
        return;
      }
      if (!playerFocusedRef.current || !PLAYER_KEYS.has(type)) {
        return;
      }
      log(`tv ${type} action=${action} (player focused)`);
      // The physical remote delivers only key up (action=1) for the D-pad
      // here: the native focus engine consumes key down. Act on key up.
      if (action !== 1) {
        return;
      }
      if (type === 'left') {
        seekBy(-SEEK_STEP_S, 'D-pad');
      } else if (type === 'right') {
        seekBy(SEEK_STEP_S, 'D-pad');
      }
      // Select is handled by the player Pressable's onPress.
    },
    [log, seekBy, setPausedBoth, togglePause],
  );
  useTVEventHandler(onTvEvent);

  // ----------------------------------------------------------- actions ---

  const guarded = useCallback(
    (fn: () => Promise<void>) => async () => {
      if (busyRef.current) {
        return;
      }
      busyRef.current = true;
      try {
        await fn();
      } catch (error) {
        report(`unexpected ${error instanceof Error ? error.name : '?'}`);
      } finally {
        busyRef.current = false;
      }
    },
    [report],
  );

  const find = useMemo(
    () =>
      guarded(async () => {
        if (coordinator.getStatus() !== 'signed-in') {
          report(
            `Нет сессии (${coordinator.getStatus()}): войдите по телефону`,
          );
          return;
        }
        log('=== find videos (E2, E4 ≤5 blogs) ===');
        const subs = await callApi(buildSubscriptionsRequest);
        if (
          !subs ||
          subs.kind !== 'response' ||
          !is2xx(subs.sanitized.status)
        ) {
          report(`E2 не удался (${subs ? subs.kind : 'budget'})`);
          return;
        }
        const blogs = subscriptionBlogUrls(subs.json).slice(0, 5);
        const found: VideoCandidate[] = [];
        for (const [i, blog] of blogs.entries()) {
          if (found.length >= MAX_CANDIDATES) {
            break;
          }
          const page = await callApi(() => buildBlogPostsRequest(blog));
          if (!page) {
            break;
          }
          if (page.kind !== 'response' || !is2xx(page.sanitized.status)) {
            log(`E4 blog #${i + 1}: failed`);
            continue;
          }
          const c = videoCandidates(postsOf(page.json, 'E4'), blog);
          log(`E4 blog #${i + 1}: accessible ok_video ${c.length}`);
          found.push(...c.slice(0, MAX_CANDIDATES - found.length));
        }
        setCandidates(found);
        if (found.length === 0) {
          report(`Нет доступного ok_video в ${blogs.length} блогах — стоп`);
        } else {
          report(`Найдено видео: ${found.length}. Выберите одно пультом`);
        }
      }),
    [callApi, coordinator, guarded, log, report],
  );

  const pick = useCallback(
    (c: VideoCandidate, index: number) =>
      guarded(async () => {
        log(`=== pick candidate #${index + 1} (fresh E8) ===`);
        const r = await resolvePost(c);
        if (r.kind !== 'post' || r.media.kind !== 'found') {
          const why =
            r.kind === 'http'
              ? `HTTP ${r.status}`
              : r.kind === 'post'
              ? r.media.kind
              : r.kind;
          report(`E8 для выбранного видео не удался (${why})`);
          return;
        }
        const found = r.media;
        const sel: Selected = { ...c, sources: found.sources };
        selectedRef.current = sel;
        setSelected(sel);
        setUrlFetchedAt(Date.now());
        throttleRef.current = new ProgressThrottle();
        recoveryRef.current = { state: 'idle', at: 0 };
        setErrorText('');
        const timeCode = found.timeCode;
        log(
          `E8: sources [${found.sources.map(s => s.type).join(',')}] ` +
            `timeCode=${timeCode === undefined ? 'absent' : sec(timeCode)} ` +
            `duration=${
              found.duration === undefined ? '-' : sec(found.duration)
            }`,
        );
        if (lastWrite && lastWrite.mediaId === c.mediaId) {
          log(
            `round-trip: last E9 ok t=${lastWrite.seconds}, ` +
              `E8 timeCode=${
                timeCode === undefined ? 'absent' : sec(timeCode)
              }, ` +
              `match=${
                timeCode !== undefined && sec(timeCode) === lastWrite.seconds
              }`,
          );
        }
        positionRef.current = timeCode ?? 0;
        setPosition(positionRef.current);
        pausedRef.current = false;
        setPaused(false);
        startSource(found.source, timeCode ?? 0);
        report(`Воспроизведение: ${found.source.label}`);
      })(),
    [guarded, log, report, resolvePost, startSource],
  );

  const probe = useMemo(
    () =>
      guarded(async () => {
        // The current source, or after a stop the selected video's first.
        const source =
          currentRef.current?.source ?? selectedRef.current?.sources[0];
        const c = source ? { source } : null;
        if (!c) {
          report('Проба: нет источника');
          return;
        }
        log(`url shape ${c.source.type}: ${describeUrlShape(c.source.url)}`);
        for (const v of PROBE_VARIANTS) {
          run.probes += 1;
          setProbeCount(run.probes);
          const r = await probeStatus(c.source.url, v.headers);
          log(
            `probe ${c.source.type} hdr=${v.id} (Range 0-0) → ${
              typeof r.status === 'number' ? `HTTP ${r.status}` : r.status
            } type=${r.contentType ?? '-'}${r.body ? ` body="${r.body}"` : ''}`,
          );
        }
        report(
          `probe ${c.source.type}: ${PROBE_VARIANTS.length} variants logged`,
        );
      }),
    [guarded, log, report],
  );

  const badToken = useMemo(
    () =>
      guarded(async () => {
        const target = selectedRef.current ?? candidates[0];
        if (!target) {
          report('Сначала найдите видео');
          return;
        }
        if (run.api + 1 > RUN_REQUEST_BUDGET) {
          report(`budget: ${run.api}/${RUN_REQUEST_BUDGET} reached, not sent`);
          return;
        }
        run.api += 1;
        setApiCount(run.api);
        log('=== E8 with a synthetic Bearer (direct, no refresh) ===');
        const r = await execute(
          buildBadTokenPostRequest(target.blogUrl, target.postId),
          fetchImpl,
        );
        if (r.kind === 'network') {
          report(`E8-badtoken → network (${r.error})`);
          return;
        }
        log(...formatSanitized(r.sanitized));
        const body = r.json as Record<string, unknown> | undefined;
        const data = body && Array.isArray(body.data) ? body.data.length : '-';
        report(
          `E8-badtoken → HTTP ${r.sanitized.status}; hasAccess=${
            typeof body?.hasAccess === 'boolean' ? body.hasAccess : '-'
          } data=${data} error=${
            typeof body?.error === 'string' ? body.error : '-'
          }`,
        );
      }),
    [candidates, guarded, log, report],
  );

  // ------------------------------------------------------------- render --

  const urlAge = urlFetchedAt === null ? '-' : mmss(now - urlFetchedAt);

  return (
    <SpikeScreen
      title="Плеер: доступ, истечение, прогресс (спайк 1.6)"
      controls={
        <ScrollView style={styles.controls}>
          <SpikeButton
            testID="pb-find"
            label="Найти видео (E2, E4)"
            onPress={find}
            preferredFocus
          />
          {candidates.map((c, i) => (
            <SpikeButton
              key={`${c.postId}:${c.mediaId}`}
              testID={`pb-pick-${i}`}
              label={`${i + 1}. ${c.title || 'без названия'}`}
              onPress={() => pick(c, i)}
            />
          ))}
          {(selected?.sources ?? []).map(s => (
            <SpikeButton
              key={s.type}
              testID={`pb-src-${s.type}`}
              label={`${current?.source.type === s.type ? '● ' : ''}${s.label}`}
              onPress={() => selectSource(s)}
            />
          ))}
          <SpikeButton
            testID="pb-middle"
            label="В середину"
            onPress={() => {
              if (currentRef.current && durationRef.current > 0) {
                const target = Math.floor(durationRef.current / 2);
                seekTargetRef.current = target;
                lastSeekAtRef.current = Date.now();
                log(`seek to middle → t=${target}`);
                videoRef.current?.seek(target);
              }
            }}
          />
          <SpikeButton
            testID="pb-pause"
            label={paused ? 'Играть' : 'Пауза'}
            onPress={() => togglePause('button')}
          />
          <SpikeButton testID="pb-probe" label="Проба URL" onPress={probe} />
          <SpikeButton
            testID="pb-badtoken"
            label="E8 с поддельным токеном"
            onPress={badToken}
          />
          <SpikeButton testID="pb-exit" label="Назад в меню" onPress={onExit} />
          <SpikeButton
            testID="pb-profile"
            label={`Профиль E8: ${profile}`}
            onPress={() => {
              const next: ApiProfile =
                profileRef.current === 'web' ? 'reference' : 'web';
              profileRef.current = next;
              setProfile(next);
              log(`E8 profile → ${next} (applies to the next E8)`);
            }}
          />
        </ScrollView>
      }
    >
      <Text style={styles.status} testID="pb-status">
        {status}
      </Text>
      <Text style={styles.counts} testID="pb-counts">
        {`API: ${apiCount}/${RUN_REQUEST_BUDGET} · проб: ${probeCount}`}
      </Text>
      <Text style={styles.info} testID="pb-info">
        {`${selected ? selected.title || 'без названия' : '—'} · ${
          current?.source.type ?? '-'
        } · t=${sec(position)} · ${
          paused ? 'пауза' : 'игра'
        } · возраст URL ${urlAge}`}
      </Text>
      {errorText ? (
        <Text style={styles.error} testID="pb-error">
          {errorText}
        </Text>
      ) : null}
      <View style={styles.row}>
        <TVFocusGuideView trapFocusLeft trapFocusRight>
          <Pressable
            testID="pb-player"
            accessibilityRole="button"
            accessibilityLabel="Плеер: ←/→ перемотка 10 с, OK пауза"
            onPress={() => togglePause('Select')}
            onFocus={() => {
              playerFocusedRef.current = true;
              setPlayerFocused(true);
            }}
            onBlur={() => {
              playerFocusedRef.current = false;
              setPlayerFocused(false);
            }}
            style={[styles.player, playerFocused && styles.playerFocused]}
          >
            {current ? (
              <Video
                key={current.key}
                ref={videoRef}
                source={{
                  uri: current.source.url,
                  type:
                    current.source.kind === 'hls'
                      ? 'm3u8'
                      : current.source.kind === 'dash'
                      ? 'mpd'
                      : undefined,
                }}
                style={styles.video}
                paused={paused}
                resizeMode="contain"
                focusable={false}
                progressUpdateInterval={1000}
                onLoad={onLoad}
                onReadyForDisplay={onReadyForDisplay}
                onBuffer={({ isBuffering }) =>
                  log(`buffer ${isBuffering} t=${sec(positionRef.current)}`)
                }
                onProgress={onProgress}
                onSeek={(e: OnSeekData) => {
                  log(`seek done t=${sec(e.currentTime)}`);
                  const pending = startPendingRef.current;
                  if (pending !== null) {
                    if (Math.abs(e.currentTime - pending) > 2) {
                      return;
                    }
                    startPendingRef.current = null;
                  }
                  positionRef.current = e.currentTime;
                  if (
                    seekTargetRef.current === null ||
                    Math.abs(e.currentTime - seekTargetRef.current) < 2
                  ) {
                    seekTargetRef.current = null;
                  }
                }}
                onPlaybackStateChanged={(e: OnPlaybackStateChangedData) =>
                  log(`playing=${e.isPlaying} t=${sec(positionRef.current)}`)
                }
                onEnd={() => log('end')}
                onError={onError}
              />
            ) : (
              <Text style={styles.hint}>
                {selected ? 'Остановлено' : 'Выберите видео'}
              </Text>
            )}
          </Pressable>
        </TVFocusGuideView>
        <View style={styles.side}>
          <SpikeLog lines={lines} />
        </View>
      </View>
    </SpikeScreen>
  );
}

const styles = StyleSheet.create({
  controls: { flex: 1 },
  status: { color: spikeColors.text, fontSize: 14, marginBottom: 4 },
  counts: { color: spikeColors.accent, fontSize: 13, marginBottom: 4 },
  info: { color: spikeColors.text, fontSize: 13, marginBottom: 4 },
  error: { color: spikeColors.fail, fontSize: 12, marginBottom: 4 },
  row: { flex: 1, flexDirection: 'row' },
  player: {
    width: 390,
    height: 222,
    borderWidth: 3,
    borderColor: 'transparent',
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  playerFocused: { borderColor: spikeColors.accent },
  video: { width: 384, height: 216 },
  side: { flex: 1 },
  hint: { color: spikeColors.muted, fontSize: 14 },
});
