import type { VideoSource } from '../../../shared/entities/post';
import type { ProgressRepository } from '../../../shared/services/progress';
import type { MediaSourceState } from '../mediaResolver';
import { SOURCE_REFRESH_AGE_MS, createLiveMode, createVodMode } from '../playbackMode';
import { recoveryTarget, type StartGate } from '../recovery';

const URL = 'https://example.invalid/player';
const hls: VideoSource = { format: 'hls', type: 'hls', url: URL };
const mp4 = (height: number): VideoSource => ({ format: 'progressive', type: `p${height}`, height, url: URL });

type Ready = Extract<MediaSourceState, { kind: 'ready' }>;
const readyWith = (source: VideoSource, sources: readonly VideoSource[]): Ready => ({
  kind: 'ready',
  source,
  byQuality: false,
  sources,
  meta: { authorName: 'a', authorAvatarUrl: null, postTitle: 'p', videoTitle: '' },
  progress: null,
  live: null,
  resolution: 1,
});

const repository = {} as ProgressRepository;
const vod = createVodMode(repository);
const live = createLiveMode();

const GATES: StartGate[] = [{ kind: 'load' }, { kind: 'load', target: 12 }, { kind: 'seek', target: 30 }, { kind: 'first' }, { kind: 'started' }];

describe('PlaybackMode flags (the old isLive branches)', () => {
  test('VOD: seeks, holds, timeline focus, no heartbeat, the repository', () => {
    expect(vod).toMatchObject({
      kind: 'vod',
      canSeek: true,
      holdSeeks: true,
      heartbeat: false,
      overlayFocus: 'timeline',
      progress: repository,
    });
  });

  test('live: no seek, no held target, play/pause focus, the heartbeat, no progress', () => {
    expect(live).toMatchObject({
      kind: 'live',
      canSeek: false,
      holdSeeks: false,
      heartbeat: true,
      overlayFocus: 'playPause',
      progress: null,
    });
  });

  test('a VOD without a repository keeps null progress', () => {
    expect(createVodMode(null).progress).toBeNull();
  });

  test('pickMedia: the VOD hook for VOD, the live hook for live', () => {
    expect(vod.pickMedia('vod', 'live')).toBe('vod');
    expect(live.pickMedia('vod', 'live')).toBe('live');
  });
});

describe('retryable', () => {
  const states: MediaSourceState[] = [
    { kind: 'error', error: 'Network' },
    { kind: 'noSource' },
    { kind: 'locked', confirmed: true, verified: false },
    readyWith(hls, [hls]),
  ];

  test.each(states.map(state => [state.kind, state] as const))('VOD %s: «Повторить»', (_kind, state) => {
    expect(vod.retryable(state)).toBe(true);
  });

  test('live: only a failed E15 request', () => {
    expect(states.map(state => live.retryable(state))).toEqual([true, false, false, false]);
  });
});

describe('settingsShown', () => {
  test('VOD: always', () => {
    expect(vod.settingsShown([hls])).toBe(true);
    expect(vod.settingsShown([])).toBe(true);
  });

  test('live: only with a real quality choice', () => {
    expect(live.settingsShown([hls])).toBe(false);
    expect(live.settingsShown([hls, mp4(720)])).toBe(true);
  });
});

describe('playIntent', () => {
  test('VOD: a play on a source ≥ 23 h old re-resolves it first', () => {
    expect(vod.playIntent({ play: true, paused: true, sourceAgeMs: SOURCE_REFRESH_AGE_MS })).toBe('refreshSource');
    expect(vod.playIntent({ play: true, paused: false, sourceAgeMs: SOURCE_REFRESH_AGE_MS + 1 })).toBe('refreshSource');
  });

  test('VOD: a younger source, no source, or a pause plays as it is', () => {
    expect(vod.playIntent({ play: true, paused: true, sourceAgeMs: SOURCE_REFRESH_AGE_MS - 1 })).toBe('plain');
    expect(vod.playIntent({ play: true, paused: true, sourceAgeMs: null })).toBe('plain');
    expect(vod.playIntent({ play: false, paused: false, sourceAgeMs: SOURCE_REFRESH_AGE_MS })).toBe('plain');
  });

  test('live: a play after a pause returns to the live edge, whatever the source age', () => {
    expect(live.playIntent({ play: true, paused: true, sourceAgeMs: SOURCE_REFRESH_AGE_MS })).toBe('liveEdge');
    expect(live.playIntent({ play: true, paused: true, sourceAgeMs: null })).toBe('liveEdge');
  });

  test('live: a play while playing or a pause is plain (never a refresh)', () => {
    expect(live.playIntent({ play: true, paused: false, sourceAgeMs: SOURCE_REFRESH_AGE_MS })).toBe('plain');
    expect(live.playIntent({ play: false, paused: false, sourceAgeMs: 0 })).toBe('plain');
    expect(live.playIntent({ play: false, paused: true, sourceAgeMs: 0 })).toBe('plain');
  });
});

describe('qualityIntent', () => {
  const sources = [hls, mp4(1080), mp4(720)];

  test('VOD: a pick that changes the playing source switches it', () => {
    expect(vod.qualityIntent(readyWith(hls, sources), 720)).toBe('switchSource');
    expect(vod.qualityIntent(readyWith(mp4(720), sources), 'auto')).toBe('switchSource');
  });

  test('VOD: the playing source, no ready source, or a missing height only stores the pick', () => {
    expect(vod.qualityIntent(readyWith(hls, sources), 'auto')).toBe('storeOnly');
    expect(vod.qualityIntent(null, 720)).toBe('storeOnly');
    const progressive = [mp4(1080), mp4(720)];
    // 480p is missing: the default order picks 1080p, the playing one.
    expect(vod.qualityIntent(readyWith(progressive[0], progressive), 480)).toBe('storeOnly');
  });

  test('live: another source of the same E15 replays at the edge; anything else does nothing', () => {
    expect(live.qualityIntent(readyWith(hls, sources), 720)).toBe('liveSwitch');
    expect(live.qualityIntent(readyWith(hls, sources), 'auto')).toBe('none');
    expect(live.qualityIntent(readyWith(hls, sources), 480)).toBe('none');
    expect(live.qualityIntent(null, 720)).toBe('none');
  });
});

describe('endIntent', () => {
  test('VOD: the final report; live: «Стрим завершён»', () => {
    expect(vod.endIntent()).toBe('reportEnd');
    expect(live.endIntent()).toBe('markEnded');
  });
});

describe('recoveryTarget', () => {
  test.each(GATES.map(gate => [gate.kind, gate] as const))('VOD %s: the recovery.ts target', (_kind, gate) => {
    for (const pending of [null, 42]) {
      expect(vod.recoveryTarget(gate, () => pending, 7)).toBe(recoveryTarget(gate, pending, 7));
    }
  });

  test('live: always the live edge (undefined), without reading the pending seek', () => {
    const pendingSeek = jest.fn(() => 42);
    for (const gate of GATES) {
      expect(live.recoveryTarget(gate, pendingSeek, 7)).toBeUndefined();
    }
    expect(pendingSeek).not.toHaveBeenCalled();
  });
});
