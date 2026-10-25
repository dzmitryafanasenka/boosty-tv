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
import QRCode from 'react-native-qrcode-svg';
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
import { type ApiRequest, type FetchLike } from './phoneAuthApi';
import { SESSION_SERVICE } from './PhoneAuthCheck';
import {
  audioFileCandidates,
  blockTypeSummary,
  describeSignedQuery,
  describeUrlShape,
  fileCandidates,
  findSameFile,
  formatExpiry,
  mediaFileBlockCounts,
  nextPageOffset,
  redactForLog,
  sec,
  SEEK_STEP_S,
  signedQueryExpiry,
  signedQuerySummary,
  signedUrl,
  withApiProfile,
  type MediaFileCandidate,
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
 * Story 1.7 spike only (branch spike/1-7-audio-files). Scans the owner's
 * subscriptions (E2, then E4 for at most 5 blogs, up to 3 pages each, paged
 * only with the returned `extra.offset`) for accessible `audio_file` and
 * `file` blocks. A picked audio is re-fetched with E8 (reference profile)
 * and played with react-native-video as `url + signedQuery`; a picked file
 * is re-fetched the same way and its signed link is shown only as a QR
 * code. Status-only probes (`Range: bytes=0-0`, aborted on 2xx) record the
 * CDN status and content type; nothing is downloaded to the TV.
 *
 * Every log line goes through `redactForLog`. Logs carry no titles, URLs,
 * `signedQuery` values or ids; titles appear on screen only, the signed
 * link only inside the QR. URLs live in memory only. No mutations (no E9:
 * the reference keeps no audio progress), no comments endpoint.
 */

const fetchImpl: FetchLike = (url, init) =>
  (fetch as unknown as FetchLike)(url, init);

/** API requests (refreshes included) per app run. */
export const AUDIO_FILES_BUDGET = 100;
export const MAX_BLOGS = 5;
export const MAX_PAGES_PER_BLOG = 3;
export const MAX_PER_KIND = 5;

/** Per app run (module scope): survives screen re-entry, not a restart. */
const run = { api: 0, probes: 0 };

/** Test hook: reset or preset the per-run counters. */
export function __setAudioFilesRunStateForTests(api = 0) {
  run.api = api;
  run.probes = 0;
}

const PLAYER_KEYS = new Set(['left', 'right', 'select']);
const PROBE_TIMEOUT_MS = 15_000;

const is2xx = (status: number) => status >= 200 && status < 300;

const mmss = (s: number) => {
  const v = Math.max(0, Math.floor(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

type TvEvent = Parameters<Parameters<typeof useTVEventHandler>[0]>[0];

type Picked = {
  candidate: MediaFileCandidate;
  /** `url + signedQuery`. Memory only: player source or QR value. */
  url: string;
  fetchedAt: number;
};
type AudioCurrent = { key: number; url: string; startAt: number };
type Recovery = 'idle' | 'recovering' | 'used';

type ProbeResult = {
  status: number | 'network' | 'timeout';
  contentType?: string;
  /** Whether the response carried a `Content-Range` (a 206 for Range). */
  contentRange: boolean;
};

/**
 * Status-only probe (Story 1.6): `Range: bytes=0-0`, no credentials, no
 * other headers. XMLHttpRequest so a 2xx is aborted as soon as the status
 * arrives: a server that ignores `Range` cannot turn it into a download.
 * Bodies are never read.
 */
function probeStatus(url: string): Promise<ProbeResult> {
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
      finish({ status: 'timeout', contentRange: false });
      xhr.abort();
    }, PROBE_TIMEOUT_MS);
    xhr.onreadystatechange = () => {
      if (xhr.readyState < 2 || xhr.status <= 0) {
        return;
      }
      const result = {
        status: xhr.status,
        contentType: xhr.getResponseHeader('Content-Type') ?? undefined,
        contentRange: xhr.getResponseHeader('Content-Range') !== null,
      };
      // 2xx or not, the status is enough: abort before any body arrives.
      finish(result);
      xhr.abort();
    };
    xhr.onerror = () => finish({ status: 'network', contentRange: false });
    xhr.withCredentials = false;
    xhr.open('GET', url);
    xhr.setRequestHeader('Range', 'bytes=0-0');
    xhr.send();
  });
}

/** Content type for logs: the media type only, no parameters. */
const safeContentType = (value?: string) => {
  const t = value?.split(';')[0].trim() ?? '';
  return /^[a-z0-9.+-]{1,40}\/[a-z0-9.+-]{1,60}$/i.test(t) ? t : '-';
};

export function AudioFilesCheck({ onExit }: { onExit: () => void }) {
  useBackToMenu(onExit);

  const [status, setStatus] = useState('…');
  const [lines, setLines] = useState<string[]>([]);
  const [apiCount, setApiCount] = useState(run.api);
  const [probeCount, setProbeCount] = useState(run.probes);
  const [audios, setAudios] = useState<MediaFileCandidate[]>([]);
  const [files, setFiles] = useState<MediaFileCandidate[]>([]);
  const [audio, setAudio] = useState<Picked | null>(null);
  const [file, setFile] = useState<Picked | null>(null);
  const [current, setCurrent] = useState<AudioCurrent | null>(null);
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [now, setNow] = useState(Date.now());
  const [playerFocused, setPlayerFocused] = useState(false);

  const busyRef = useRef(false);
  const videoRef = useRef<VideoRef>(null);
  const audioRef = useRef<Picked | null>(null);
  const fileRef = useRef<Picked | null>(null);
  const currentRef = useRef<AudioCurrent | null>(null);
  const positionRef = useRef(0);
  const pausedRef = useRef(false);
  const seekTargetRef = useRef<number | null>(null);
  const lastSeekAtRef = useRef(0);
  const startPendingRef = useRef<number | null>(null);
  const recoveryRef = useRef<Recovery>('idle');
  const keyRef = useRef(0);
  const playerFocusedRef = useRef(false);
  const appStateRef = useRef<string>(String(AppState.currentState));

  const log = useCallback((...entries: string[]) => {
    const safe = entries.map(redactForLog);
    for (const entry of safe) {
      spikeLog('audiofiles', entry);
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

  // AppState: log transitions with the player state.
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      log(
        `appstate ${prev} → ${next}; audio ${
          currentRef.current ? 'loaded' : 'none'
        } paused=${pausedRef.current} t=${sec(positionRef.current)}`,
      );
    });
    return () => sub.remove();
  }, [log]);

  // ------------------------------------------------------------ requests --

  /**
   * Authorized call through the coordinator, inside the per-run budget
   * (worst case 3 requests: 401 → refresh → retry). Null when refused.
   */
  const callApi = useCallback(
    async (build: () => ApiRequest): Promise<CallResult | null> => {
      if (run.api + 3 > AUDIO_FILES_BUDGET) {
        log(`budget: ${run.api}/${AUDIO_FILES_BUDGET} reached, not sent`);
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

  /** Fresh E8 (reference profile) and the same block (id, else url). */
  const resolve = useCallback(
    async (c: MediaFileCandidate): Promise<Picked | string> => {
      log(`E8 (${c.kind}) profile=reference`);
      const r = await callApi(() =>
        withApiProfile(buildPostRequest(c.blogUrl, c.postId), 'reference'),
      );
      if (!r) {
        return 'budget';
      }
      if (r.kind !== 'response') {
        return r.kind;
      }
      if (!is2xx(r.sanitized.status)) {
        return `E8 HTTP ${r.sanitized.status}`;
      }
      const same = findSameFile(r.json, c);
      if (same.kind !== 'found') {
        return same.kind;
      }
      const fresh = same.candidate;
      const at = Date.now();
      log(
        `E8 ${c.kind}: matched by ${same.matchedBy}; ` +
          `blockId ${fresh.blockId === undefined ? 'absent' : 'present'}; ` +
          `duration=${
            fresh.duration === undefined ? '-' : sec(fresh.duration)
          } ` +
          `size=${fresh.size === undefined ? '-' : 'present'}`,
      );
      log(`signedQuery ${c.kind}: ${describeSignedQuery(fresh.signedQuery)}`);
      log(
        `signedQuery ${c.kind} expiry: ${formatExpiry(
          signedQueryExpiry(fresh.signedQuery, at),
        )}`,
      );
      if (fresh.signedQuery.replace(/^[?&]+/, '') === '') {
        log(`signedQuery ${c.kind} empty → bare url`);
      }
      const url = signedUrl(fresh.url, fresh.signedQuery);
      log(`url shape ${c.kind}: ${describeUrlShape(url)}`);
      return { candidate: fresh, url, fetchedAt: at };
    },
    [callApi, log],
  );

  // ------------------------------------------------------------ player ---

  const startAudio = useCallback(
    (picked: Picked, startAt: number) => {
      keyRef.current += 1;
      seekTargetRef.current = null;
      startPendingRef.current = startAt > 0 ? startAt : null;
      positionRef.current = startAt;
      setPosition(startAt);
      const next = { key: keyRef.current, url: picked.url, startAt };
      currentRef.current = next;
      setCurrent(next);
      log(`audio source set, start t=${sec(startAt)}`);
    },
    [log],
  );

  const stopAudio = useCallback(
    (message: string) => {
      currentRef.current = null;
      setCurrent(null);
      setErrorText(message);
      report(`Аудио остановлено: ${message}`);
    },
    [report],
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
    },
    [log],
  );

  const seekBy = useCallback(
    (delta: number, via: string) => {
      if (!currentRef.current) {
        return;
      }
      // Presses during an in-flight seek build on its target (Story 1.6).
      const base = seekTargetRef.current ?? positionRef.current;
      const target = Math.max(0, base + delta);
      seekTargetRef.current = target;
      lastSeekAtRef.current = Date.now();
      log(`seek ${delta > 0 ? '+' : ''}${delta} via ${via} → t=${sec(target)}`);
      videoRef.current?.seek(target);
    },
    [log],
  );

  const recover = useCallback(async () => {
    const picked = audioRef.current;
    if (!picked) {
      return;
    }
    const resumeAt = positionRef.current;
    log('recovery: E8 re-resolve of the same audio block');
    const fresh = await resolve(picked.candidate);
    if (typeof fresh === 'string') {
      stopAudio(`восстановление не удалось (${fresh})`);
      return;
    }
    audioRef.current = fresh;
    setAudio(fresh);
    recoveryRef.current = 'used';
    log(`recovery: re-resolved, resume t=${sec(resumeAt)}`);
    startAudio(fresh, resumeAt);
  }, [log, resolve, startAudio, stopAudio]);

  const onError = useCallback(
    (e: OnVideoErrorData) => {
      const message = redactForLog(
        `code=${e.error.errorCode ?? '-'} ${e.error.errorString ?? ''} ${
          e.error.errorException ?? ''
        }`,
      ).slice(0, 300);
      log(`player ERROR audio: ${message}`);
      setErrorText(message);
      if (recoveryRef.current === 'idle') {
        recoveryRef.current = 'recovering';
        recover().catch(() => stopAudio('recovery threw'));
        return;
      }
      log('failure after the single re-resolve → stop');
      stopAudio(message);
    },
    [log, recover, stopAudio],
  );

  const onLoad = useCallback(
    (e: OnLoadData) => {
      setDuration(e.duration);
      log(
        `load audio duration=${sec(e.duration)} audioTracks=${
          e.audioTracks?.length ?? '-'
        } videoTracks=${e.videoTracks?.length ?? '-'}`,
      );
      const c = currentRef.current;
      if (c && c.startAt > 0) {
        log(`seek-after-load → t=${sec(c.startAt)}`);
        videoRef.current?.seek(c.startAt);
      }
    },
    [log],
  );

  const onProgress = useCallback((e: OnProgressData) => {
    const pending = startPendingRef.current;
    if (pending !== null) {
      if (Math.abs(e.currentTime - pending) > 2) {
        return; // still before the seek-after-load
      }
      startPendingRef.current = null;
    }
    positionRef.current = e.currentTime;
    setPosition(e.currentTime);
    if (
      seekTargetRef.current !== null &&
      Date.now() - lastSeekAtRef.current > 5000
    ) {
      seekTargetRef.current = null;
    }
  }, []);

  const onSeek = useCallback(
    (e: OnSeekData) => {
      log(`seek done t=${sec(e.currentTime)}`);
      const pending = startPendingRef.current;
      if (pending !== null) {
        if (Math.abs(e.currentTime - pending) > 2) {
          return;
        }
        startPendingRef.current = null;
      }
      positionRef.current = e.currentTime;
      setPosition(e.currentTime);
      if (
        seekTargetRef.current === null ||
        Math.abs(e.currentTime - seekTargetRef.current) < 2
      ) {
        seekTargetRef.current = null;
      }
    },
    [log],
  );

  // --------------------------------------------------------- TV remote ---

  const onTvEvent = useCallback(
    (evt: TvEvent) => {
      const type = evt.eventType;
      if (!playerFocusedRef.current || !PLAYER_KEYS.has(type)) {
        return;
      }
      const action = Number(evt.eventKeyAction ?? -1);
      log(`tv ${type} action=${action} (player focused)`);
      // The device delivers only key up for the D-pad here (Story 1.6).
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
    [log, seekBy],
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
        log(
          `=== find audio_file / file (E2, E4 ≤${MAX_BLOGS} blogs × ` +
            `≤${MAX_PAGES_PER_BLOG} pages) ===`,
        );
        const subs = await callApi(buildSubscriptionsRequest);
        if (
          !subs ||
          subs.kind !== 'response' ||
          !is2xx(subs.sanitized.status)
        ) {
          report(`E2 не удался (${subs ? subs.kind : 'budget'})`);
          return;
        }
        const blogs = subscriptionBlogUrls(subs.json).slice(0, MAX_BLOGS);
        const foundAudio: MediaFileCandidate[] = [];
        const foundFiles: MediaFileCandidate[] = [];
        let pages = 0;
        let failedPages = 0;
        let stopped = false;
        for (const [i, blog] of blogs.entries()) {
          let offset: string | undefined;
          for (let p = 0; p < MAX_PAGES_PER_BLOG; p += 1) {
            if (
              foundAudio.length >= MAX_PER_KIND &&
              foundFiles.length >= MAX_PER_KIND
            ) {
              break;
            }
            const page = await callApi(() =>
              buildBlogPostsRequest(blog, offset),
            );
            if (!page) {
              stopped = true;
              break;
            }
            if (page.kind !== 'response' || !is2xx(page.sanitized.status)) {
              log(
                `E4 blog #${i + 1} page #${p + 1}: failed (${
                  page.kind === 'response'
                    ? `HTTP ${page.sanitized.status}`
                    : page.kind
                })`,
              );
              failedPages += 1;
              break;
            }
            pages += 1;
            const posts = postsOf(page.json, 'E4');
            const counts = mediaFileBlockCounts(posts);
            const a = audioFileCandidates(posts, blog);
            const f = fileCandidates(posts, blog);
            const emptySq = [...a, ...f].filter(
              c => c.signedQuery.replace(/^[?&]+/, '') === '',
            ).length;
            offset = nextPageOffset(page.json);
            log(
              `E4 blog #${i + 1} page #${p + 1}: posts=${posts.length} ` +
                `locked=${counts.lockedPosts} audio_file=${counts.audio} ` +
                `file=${counts.file} accessible audio=${a.length} ` +
                `file=${f.length} emptySignedQuery=${emptySq} ` +
                `next=${offset === undefined ? 'no' : 'yes'}`,
              `E4 blog #${i + 1} page #${p + 1} block types: ${blockTypeSummary(
                posts,
              )}`,
              `E4 blog #${i + 1} page #${
                p + 1
              } signedQuery: ${signedQuerySummary(posts, Date.now())}`,
            );
            foundAudio.push(...a.slice(0, MAX_PER_KIND - foundAudio.length));
            foundFiles.push(...f.slice(0, MAX_PER_KIND - foundFiles.length));
            if (offset === undefined) {
              break;
            }
          }
          if (stopped) {
            break;
          }
        }
        setAudios(foundAudio);
        setFiles(foundFiles);
        // «no sample» only after a complete scan; a budget stop or a failed
        // page leaves unseen posts.
        const incomplete = stopped || failedPages > 0;
        const none = (n: number, what: string) =>
          n > 0
            ? `${what}: ${n}`
            : incomplete
            ? `${what}: 0 (скан неполный)`
            : `${what}: no sample`;
        report(
          `Скан${
            incomplete
              ? ` неполный (ошибок E4: ${failedPages}, бюджет: ${
                  stopped ? 'исчерпан' : 'ok'
                })`
              : ''
          }: ${blogs.length} блогов, ${pages} страниц E4. ` +
            `${none(foundAudio.length, 'audio_file')}; ` +
            `${none(foundFiles.length, 'file')}`,
        );
      }),
    [callApi, coordinator, guarded, log, report],
  );

  const pickAudio = useCallback(
    (c: MediaFileCandidate, index: number) =>
      guarded(async () => {
        log(`=== pick audio #${index + 1} (fresh E8) ===`);
        const fresh = await resolve(c);
        if (typeof fresh === 'string') {
          report(`E8 для аудио не удался (${fresh})`);
          return;
        }
        audioRef.current = fresh;
        setAudio(fresh);
        recoveryRef.current = 'idle';
        setErrorText('');
        setDuration(0);
        pausedRef.current = false;
        setPaused(false);
        startAudio(fresh, 0);
        report('Аудио: воспроизведение');
      })(),
    [guarded, log, report, resolve, startAudio],
  );

  const pickFile = useCallback(
    (c: MediaFileCandidate, index: number) =>
      guarded(async () => {
        log(`=== pick file #${index + 1} (fresh E8) ===`);
        const fresh = await resolve(c);
        if (typeof fresh === 'string') {
          report(`E8 для файла не удался (${fresh})`);
          return;
        }
        fileRef.current = fresh;
        setFile(fresh);
        log(`file QR shown (link length ${fresh.url.length})`);
        report('Файл: QR на экране');
      })(),
    [guarded, log, report, resolve],
  );

  const probe = useMemo(
    () =>
      guarded(async () => {
        const targets = [audioRef.current, fileRef.current].filter(
          (p): p is Picked => p !== null,
        );
        if (targets.length === 0) {
          report('Проба: сначала выберите аудио или файл');
          return;
        }
        for (const t of targets) {
          run.probes += 1;
          setProbeCount(run.probes);
          const r = await probeStatus(t.url);
          const age = Math.round((Date.now() - t.fetchedAt) / 60_000);
          log(
            `probe ${t.candidate.kind} (Range 0-0, age ${age} min) → ${
              typeof r.status === 'number' ? `HTTP ${r.status}` : r.status
            } type=${safeContentType(r.contentType)} contentRange=${
              r.contentRange
            }`,
          );
        }
        report(`Проба: ${targets.length} URL, см. журнал`);
      }),
    [guarded, log, report],
  );

  // ------------------------------------------------------------- render --

  const age = (p: Picked | null) =>
    p === null ? '-' : mmss((now - p.fetchedAt) / 1000);

  return (
    <SpikeScreen
      title="Аудио и файлы (спайк 1.7)"
      controls={
        <ScrollView style={styles.controls}>
          <SpikeButton
            testID="af-find"
            label="Найти аудио и файлы (E2, E4)"
            onPress={find}
            preferredFocus
          />
          {audios.map((c, i) => (
            <SpikeButton
              key={`a:${c.postId}:${c.blockId ?? i}`}
              testID={`af-audio-${i}`}
              label={`♪ ${i + 1}. ${c.title || 'без названия'}${
                c.duration === undefined ? '' : ` (${mmss(c.duration)})`
              }`}
              onPress={() => pickAudio(c, i)}
            />
          ))}
          {files.map((c, i) => (
            <SpikeButton
              key={`f:${c.postId}:${c.blockId ?? i}`}
              testID={`af-file-${i}`}
              label={`▣ ${i + 1}. ${c.title || 'без названия'}${
                c.size === undefined
                  ? ''
                  : ` (${Math.max(1, Math.round(c.size / 1_048_576))} МБ)`
              }`}
              onPress={() => pickFile(c, i)}
            />
          ))}
          <SpikeButton
            testID="af-pause"
            label={paused ? 'Играть' : 'Пауза'}
            onPress={() => setPausedBoth(!pausedRef.current, 'button')}
          />
          <SpikeButton
            testID="af-back10"
            label="−10 с"
            onPress={() => seekBy(-SEEK_STEP_S, 'button')}
          />
          <SpikeButton
            testID="af-fwd10"
            label="+10 с"
            onPress={() => seekBy(SEEK_STEP_S, 'button')}
          />
          <SpikeButton
            testID="af-probe"
            label="Проба URL (аудио, файл)"
            onPress={probe}
          />
          <SpikeButton testID="af-exit" label="Назад в меню" onPress={onExit} />
        </ScrollView>
      }
    >
      <Text style={styles.status} testID="af-status">
        {status}
      </Text>
      <Text style={styles.counts} testID="af-counts">
        {`API: ${apiCount}/${AUDIO_FILES_BUDGET} · проб: ${probeCount}`}
      </Text>
      <Text style={styles.info} testID="af-info">
        {`Аудио: ${audio ? audio.candidate.title || 'без названия' : '—'} · ${
          current ? (paused ? 'пауза' : 'игра') : 'стоп'
        }${buffering ? ' · буфер' : ''} · ${mmss(position)} / ${mmss(
          duration,
        )} · возраст URL ${age(audio)}`}
      </Text>
      <Text style={styles.info} testID="af-file-info">
        {`Файл: ${
          file ? file.candidate.title || 'без названия' : '—'
        } · возраст URL ${age(file)}`}
      </Text>
      {errorText ? (
        <Text style={styles.error} testID="af-error">
          {errorText}
        </Text>
      ) : null}
      <View style={styles.row}>
        <View>
          <TVFocusGuideView trapFocusLeft trapFocusRight>
            <Pressable
              testID="af-player"
              accessibilityRole="button"
              accessibilityLabel="Аудио: ←/→ перемотка 10 с, OK пауза"
              onPress={() => setPausedBoth(!pausedRef.current, 'Select')}
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
              <Text style={styles.hint}>
                {current
                  ? `♪ ${mmss(position)} / ${mmss(duration)}`
                  : 'Аудио не выбрано'}
              </Text>
              {current ? (
                <Video
                  key={current.key}
                  ref={videoRef}
                  source={{ uri: current.url }}
                  style={styles.video}
                  paused={paused}
                  focusable={false}
                  progressUpdateInterval={1000}
                  onLoad={onLoad}
                  onBuffer={({ isBuffering }) => {
                    setBuffering(isBuffering);
                    log(`buffer ${isBuffering} t=${sec(positionRef.current)}`);
                  }}
                  onProgress={onProgress}
                  onSeek={onSeek}
                  onPlaybackStateChanged={(e: OnPlaybackStateChangedData) =>
                    log(`playing=${e.isPlaying} t=${sec(positionRef.current)}`)
                  }
                  onAudioBecomingNoisy={() => log('audio becoming noisy')}
                  onAudioFocusChanged={({ hasAudioFocus }) =>
                    log(`audio focus ${hasAudioFocus}`)
                  }
                  onEnd={() => log('end')}
                  onError={onError}
                />
              ) : null}
            </Pressable>
          </TVFocusGuideView>
          {file ? (
            <View style={styles.quietZone} testID="af-qr">
              <QRCode
                value={file.url}
                size={200}
                ecl="M"
                onError={() => log('QR render error')}
              />
            </View>
          ) : null}
        </View>
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
    width: 232,
    height: 64,
    borderWidth: 3,
    borderColor: 'transparent',
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginBottom: 8,
  },
  playerFocused: { borderColor: spikeColors.accent },
  video: { width: 1, height: 1 },
  quietZone: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    alignSelf: 'flex-start',
  },
  side: { flex: 1 },
  hint: { color: spikeColors.muted, fontSize: 14 },
});
