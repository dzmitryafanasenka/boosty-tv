import { t } from '../../../shared/i18n';
import type { VideoSource } from '../../../shared/entities/post';
import type { MediaSourceState } from '../mediaResolver';
import { createLiveMode, createVodMode } from '../playbackMode';
import { derivePhase, errorCopy, errorTarget, isRecovering, type Phase } from '../playerPhase';

const source: VideoSource = { format: 'hls', type: 'hls', url: 'https://example.invalid/player' };
const ready = (resolution: number): MediaSourceState => ({
  kind: 'ready',
  source,
  byQuality: false,
  sources: [source],
  meta: { authorName: 'a', authorAvatarUrl: null, postTitle: 'p', videoTitle: '' },
  progress: null,
  live: null,
  resolution,
});
const LOCKED: MediaSourceState = { kind: 'locked', confirmed: true, verified: true };
const base = { liveEnded: false, recovering: false, failed: false, everReady: false };

describe('derivePhase (VOD)', () => {
  const phase = (state: MediaSourceState, extra: Partial<typeof base> = {}) =>
    derivePhase({ mode: createVodMode(null), state, ...base, ...extra });

  test('the media states', () => {
    expect(phase({ kind: 'loading' })).toBe('loading');
    expect(phase(ready(1))).toBe('playing');
    expect(phase({ kind: 'unavailable' })).toBe('unavailable');
    expect(phase({ kind: 'noSource' })).toBe('error');
    expect(phase({ kind: 'error', error: 'Network' })).toBe('error');
  });

  test('a failed ready source is an error; a recovery shows recovering', () => {
    expect(phase(ready(1), { failed: true })).toBe('error');
    expect(phase(ready(1), { failed: true, recovering: true })).toBe('recovering');
  });

  test('locked: before playback the no-access state, after it the error (session check, then leave)', () => {
    expect(phase(LOCKED)).toBe('locked');
    expect(phase(LOCKED, { everReady: true })).toBe('error');
    expect(phase(LOCKED, { everReady: true, recovering: true })).toBe('recovering');
  });

  test('liveEnded never ends a VOD', () => {
    expect(phase(ready(1), { liveEnded: true })).toBe('playing');
  });

  test('loading wins over a recovery', () => {
    expect(phase({ kind: 'loading' }, { recovering: true })).toBe('loading');
  });
});

describe('derivePhase (live)', () => {
  const phase = (state: MediaSourceState, extra: Partial<typeof base> = {}) =>
    derivePhase({ mode: createLiveMode(), state, ...base, ...extra });

  test('the end of the stream, or no stream: «Стрим завершён»', () => {
    expect(phase(ready(1), { liveEnded: true })).toBe('ended');
    expect(phase({ kind: 'unavailable' })).toBe('ended');
    expect(phase({ kind: 'loading' }, { liveEnded: true })).toBe('ended');
  });

  test('not playable here stays loading (the player leaves for the QR)', () => {
    expect(phase({ kind: 'noSource' })).toBe('loading');
  });

  test('the shared states', () => {
    expect(phase({ kind: 'loading' })).toBe('loading');
    expect(phase(ready(1))).toBe('playing');
    expect(phase(ready(1), { failed: true })).toBe('error');
    expect(phase(ready(1), { failed: true, recovering: true })).toBe('recovering');
    expect(phase({ kind: 'error', error: 'Network' })).toBe('error');
  });
});

describe('isRecovering', () => {
  test('no recovery: never', () => {
    expect(isRecovering({ recovery: null, state: ready(1), failed: true, everReady: true })).toBe(false);
  });

  test('the broken source still shown, or a fresh source that has not failed', () => {
    expect(isRecovering({ recovery: { from: 1 }, state: ready(1), failed: true, everReady: true })).toBe(true);
    expect(isRecovering({ recovery: { from: 1 }, state: ready(2), failed: false, everReady: true })).toBe(true);
  });

  test('a fresh source that failed too ends it', () => {
    expect(isRecovering({ recovery: { from: 1 }, state: ready(2), failed: true, everReady: true })).toBe(false);
  });

  test('a locked answer after playback waits (its session check); before playback it does not', () => {
    expect(isRecovering({ recovery: { from: 1 }, state: LOCKED, failed: false, everReady: true })).toBe(true);
    expect(isRecovering({ recovery: { from: 1 }, state: LOCKED, failed: false, everReady: false })).toBe(false);
  });

  test('loading, an error or no source: not recovering', () => {
    for (const state of [{ kind: 'loading' }, { kind: 'noSource' }, { kind: 'error', error: 'Network' }] as MediaSourceState[]) {
      expect(isRecovering({ recovery: { from: 1 }, state, failed: false, everReady: true })).toBe(false);
    }
  });
});

describe('errorTarget', () => {
  test.each([
    ['error', true, 'retry'],
    ['error', false, 'back'],
    ['locked', false, 'back'],
    ['unavailable', false, 'back'],
    ['ended', false, 'back'],
    ['loading', false, null],
    ['playing', true, null],
    ['recovering', false, null],
  ] as [Phase, boolean, string | null][])('%s (retryable %s) → %s', (phase, retryable, expected) => {
    expect(errorTarget(phase, retryable)).toBe(expected);
  });
});

describe('errorCopy', () => {
  test('the live copy replaces the VOD copy', () => {
    const liveState = { title: 'x', body: 'y' };
    expect(errorCopy('ended', { kind: 'unavailable' }, liveState)).toBe(liveState);
  });

  test('locked and unavailable', () => {
    expect(errorCopy('locked', LOCKED, null)).toEqual({ title: t('player.noAccessTitle'), body: t('player.noAccessBody') });
    expect(errorCopy('unavailable', { kind: 'unavailable' }, null)).toEqual({
      title: t('player.unavailableTitle'),
      body: t('player.unavailableBody'),
    });
  });

  test("an E8 failure: the error kind's body; any other error: the generic body", () => {
    expect(errorCopy('error', { kind: 'error', error: 'Network' }, null)).toEqual({
      title: t('player.errorTitle'),
      body: t('error.Network'),
    });
    expect(errorCopy('error', ready(1), null)).toEqual({ title: t('player.errorTitle'), body: t('player.errorBody') });
  });
});
