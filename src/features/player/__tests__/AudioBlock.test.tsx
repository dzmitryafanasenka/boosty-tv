/**
 * Story 6.4: the AudioBlock (H, focus-map §4) over the test PlayerEngine:
 * play, pause, seek, the arbiter, unmount release, background and focus
 * loss, the engine error and its one re-resolve, the source rules.
 */
import { act } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import type { AudioSourceResult } from '../../../shared/entities/post';
import { t } from '../../../shared/i18n';
import { createPlaybackArbiter, playbackArbiter } from '../../../shared/platform/playbackArbiter';
// eslint-disable-next-line boundaries/dependencies -- test-only mock
import { engine } from '../../../test/playerEngineMock';
// eslint-disable-next-line boundaries/dependencies -- test-only mock
import { tvEvents } from '../../../test/tvEventMock';
// eslint-disable-next-line boundaries/dependencies -- test-only helpers
import { clearNativeModules, installNativeModules } from '../../../test/flow';
import {
  AUDIO_ENTRY_GUARD_MS,
  AUDIO_HOLD_REPEAT_MS,
  AUDIO_SOURCE_MAX_AGE_MS,
  AudioBlock,
  type AudioBlockProps,
} from '../AudioBlock';

jest.mock('../../../shared/platform/PlayerEngineView', () =>
  // eslint-disable-next-line boundaries/dependencies -- test-only mock
  require('../../../test/playerEngineMock'),
);
jest.mock('react-native/Libraries/Components/TV/TVEventHandler', () =>
  // eslint-disable-next-line boundaries/dependencies -- test-only mock
  require('../../../test/tvEventMock'),
);

const ID = 'post/p/block/audio_file:a1';
const URI = 'https://example.invalid/audio?sig=REDACTED';
const KEY_UP = 1;
const noop = () => {};

let appStateHandlers: Array<(state: string) => void> = [];
/** Every root a test rendered: unmounted after it (the arbiter slot is app-wide). */
const roots: Root[] = [];
const track = (root: Root) => {
  roots.push(root);
  return root;
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 29, 12).getTime());
  engine.reset();
  tvEvents.reset();
  appStateHandlers = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (s: string) => void) => {
    appStateHandlers.push(listener);
    return {
      remove: () => {
        appStateHandlers = appStateHandlers.filter(h => h !== listener);
      },
    };
  }) as unknown as typeof AppState.addEventListener);
});

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  clearNativeModules();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

type Resolver = jest.Mock<Promise<AudioSourceResult>>;
const okResolver = (): Resolver => jest.fn(async () => ({ kind: 'ok' as const, uri: URI }));

function element(props: Partial<AudioBlockProps> & { resolveSource?: AudioBlockProps['resolveSource'] }) {
  return (
    <AudioBlock
      id={ID}
      audioKey="audio_file:a1"
      title="Метроном"
      durationSec={192}
      onView={noop}
      onFocus={noop}
      {...props}
    />
  );
}

async function render(props: Partial<AudioBlockProps> = {}): Promise<Root> {
  const root = track(createRoot());
  await act(async () => root.render(element(props)));
  return root;
}

const host = (root: Root, id = ID) =>
  root.container.queryAll(n => n.props.testID === id && n.props.focusable === true)[0];
const label = (root: Root, id = ID) => host(root, id).props.accessibilityLabel as string;
const timeText = (root: Root, id = ID) =>
  JSON.stringify(root.container.queryAll(n => n.props.testID === `${id}/time`)[0].toJSON()).match(
    /"children":\["([^"]+)"\]/,
  )?.[1];
const has = (root: Root, testID: string) => root.container.queryAll(n => n.props.testID === testID).length > 0;

async function press(root: Root, id = ID) {
  await act(async () => {
    host(root, id).props.onClick({ nativeEvent: {} });
  });
}
async function focus(root: Root, id = ID) {
  await act(async () => {
    host(root, id).props.onFocus({ nativeEvent: {} });
  });
}
async function blur(root: Root, id = ID) {
  await act(async () => {
    host(root, id).props.onBlur({ nativeEvent: {} });
  });
}
async function key(eventType: string) {
  await act(async () => {
    tvEvents.emit({ eventType, eventKeyAction: KEY_UP });
  });
}
async function nativeKey(dpad: 'left' | 'right', action: 'down' | 'up', repeat = 0) {
  await act(async () => {
    DeviceEventEmitter.emit('seekKey', { key: dpad, action, repeat });
  });
}
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}
async function engineEvent(fn: () => void) {
  await act(async () => fn());
}
async function background() {
  await act(async () => {
    for (const state of ['background', 'active']) {
      for (const h of [...appStateHandlers]) {
        h(state);
      }
    }
  });
}
/** Focused and past the entry guard. */
async function focusSettled(root: Root, id = ID) {
  await focus(root, id);
  await advance(AUDIO_ENTRY_GUARD_MS + 1);
}
/** OK → a fresh resolve → the engine plays and loaded. */
async function playLoaded(root: Root) {
  await press(root);
  await engineEvent(() => engine.props!.onLoad?.({ durationSec: 192 }));
}

describe('render (matrix «Render»)', () => {
  it('one focus stop: the title, «0:00 / 3:12», an empty bar; no engine before play', async () => {
    const root = await render();
    expect(root.container.queryAll(n => n.props.focusable === true)).toHaveLength(1);
    expect(timeText(root)).toBe('0:00 / 3:12');
    expect(JSON.stringify(root.container.toJSON())).toContain('Метроном');
    expect(label(root)).toBe('Аудио. Метроном. 0:00 / 3:12. Воспроизвести');
    const bar = root.container.queryAll(n => n.props.testID === `${ID}/bar`)[0];
    expect(bar.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: '0%' })]));
    expect(engine.mounts).toBe(0);
    expect(has(root, `${ID}/play`)).toBe(true);
  });

  it('no duration → «0:00 / –:––» until the engine loads it; no title → «Аудио»', async () => {
    const root = await render({ durationSec: null, title: '', resolveSource: okResolver() });
    expect(timeText(root)).toBe(`0:00 / ${t('audio.durationUnknown')}`);
    expect(label(root)).toContain('Аудио. Аудио.');
    await press(root);
    await engineEvent(() => engine.props!.onLoad?.({ durationSec: 75 }));
    expect(timeText(root)).toBe('0:00 / 1:15');
  });

  it('← → are trapped by its guide (they seek, never move focus to the sidebar)', async () => {
    const root = await render();
    const guide = root.container.queryAll(n => n.props.testID === `${ID}/guide`)[0];
    expect(guide.props.trapFocusLeft).toBe(true);
    expect(guide.props.trapFocusRight).toBe(true);
    expect(guide.props.trapFocusUp).toBeFalsy();
    expect(guide.props.trapFocusDown).toBeFalsy();
  });
});

describe('play and pause (matrix «Play», «Pause»)', () => {
  it('OK → one fresh resolve → the hidden progressive engine plays the URI; progress advances the time and the bar; OK pauses, position kept', async () => {
    const resolve = okResolver();
    const root = await render({ resolveSource: resolve });
    await press(root);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('audio_file:a1', 'Метроном');
    expect(engine.props?.source).toEqual({ uri: URI, format: 'progressive' });
    expect(engine.props?.paused).toBe(false);
    // Never a visible surface: a 0 × 0 host, hidden from accessibility.
    const engineHost = root.container.queryAll(n => n.props.testID === `${ID}/engine`)[0];
    expect(engineHost.props.style).toEqual(expect.objectContaining({ width: 0, height: 0 }));
    expect(engineHost.props.importantForAccessibility).toBe('no-hide-descendants');
    // The URI is never in the rendered tree outside the engine's props.
    expect(JSON.stringify(root.container.toJSON())).not.toContain('REDACTED');
    expect(has(root, `${ID}/pause`)).toBe(true);
    expect(label(root)).toBe('Аудио. Метроном. 0:00 / 3:12. Пауза');

    await engineEvent(() => engine.props!.onLoad?.({ durationSec: 192 }));
    expect(engine.seek).not.toHaveBeenCalled();
    await engineEvent(() => engine.props!.onProgress?.(96));
    expect(timeText(root)).toBe('1:36 / 3:12');
    const bar = root.container.queryAll(n => n.props.testID === `${ID}/bar`)[0];
    expect(bar.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: '50%' })]));

    await press(root);
    expect(engine.props?.paused).toBe(true);
    expect(timeText(root)).toBe('1:36 / 3:12');
    expect(resolve).toHaveBeenCalledTimes(1);
    // OK again resumes the same source (no new E8).
    await press(root);
    expect(engine.props?.paused).toBe(false);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('busy while resolving: a spinner, OK ignored, nothing played until the source arrives', async () => {
    let finish: (r: AudioSourceResult) => void = () => {};
    const resolve: Resolver = jest.fn(() => new Promise<AudioSourceResult>(r => (finish = r)));
    const root = await render({ resolveSource: resolve });
    await press(root);
    expect(has(root, `${ID}/busy`)).toBe(true);
    expect(host(root).props.accessibilityState).toEqual(expect.objectContaining({ busy: true }));
    await press(root);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(engine.mounts).toBe(0);
    await act(async () => finish({ kind: 'ok', uri: URI }));
    expect(engine.props?.paused).toBe(false);
  });

  it('the end: paused at the end; OK starts over from 0', async () => {
    const root = await render({ resolveSource: okResolver() });
    await playLoaded(root);
    await engineEvent(() => engine.props!.onEnd?.());
    expect(engine.props?.paused).toBe(true);
    expect(timeText(root)).toBe('3:12 / 3:12');
    await press(root);
    expect(engine.seek).toHaveBeenLastCalledWith(0);
    expect(engine.props?.paused).toBe(false);
    expect(timeText(root)).toBe('0:00 / 3:12');
  });

  it('without a resolver OK does nothing', async () => {
    const root = await render();
    await press(root);
    expect(engine.mounts).toBe(0);
    expect(has(root, `${ID}/busy`)).toBe(false);
  });
});

describe('seek (matrix «Seek»)', () => {
  it('→ / ← on key up (no native module): ±10 s, clamped to 0…duration; focus stays (no focus call)', async () => {
    const root = await render({ resolveSource: okResolver() });
    await playLoaded(root);
    await focusSettled(root);
    await key('right');
    expect(engine.seek).toHaveBeenLastCalledWith(10);
    expect(timeText(root)).toBe('0:10 / 3:12');
    await key('left');
    await key('left');
    expect(engine.seek).toHaveBeenLastCalledWith(0);
    expect(engine.seek).toHaveBeenCalledTimes(2);
    expect(timeText(root)).toBe('0:00 / 3:12');
    await engineEvent(() => engine.props!.onSeekDone?.(0));
    await engineEvent(() => engine.props!.onProgress?.(188));
    await key('right');
    expect(engine.seek).toHaveBeenLastCalledWith(192);
    await key('right');
    expect(engine.seek).toHaveBeenCalledTimes(3);
  });

  it('a stale progress report before the seek lands does not move the shown position back', async () => {
    const root = await render({ resolveSource: okResolver() });
    await playLoaded(root);
    await engineEvent(() => engine.props!.onProgress?.(50));
    await focusSettled(root);
    await key('right');
    await engineEvent(() => engine.props!.onProgress?.(51));
    expect(timeText(root)).toBe('1:00 / 3:12');
    await engineEvent(() => engine.props!.onProgress?.(60));
    await engineEvent(() => engine.props!.onProgress?.(61));
    expect(timeText(root)).toBe('1:01 / 3:12');
  });

  it('keys reach the block only while it has focus; the first ← → within the entry guard is ignored', async () => {
    const root = await render({ resolveSource: okResolver() });
    await playLoaded(root);
    await key('right');
    expect(engine.seek).not.toHaveBeenCalled();
    await focus(root);
    await key('right');
    expect(engine.seek).not.toHaveBeenCalled();
    await key('right');
    expect(engine.seek).toHaveBeenLastCalledWith(10);
    await blur(root);
    await key('right');
    expect(engine.seek).toHaveBeenCalledTimes(1);
  });

  it('native SeekKeys while focused: a step on key down, a held key at most every 200 ms, the key up swallowed; only while focused', async () => {
    const setEnabled = jest.fn();
    installNativeModules({ SeekKeys: { setEnabled } });
    const root = await render({ resolveSource: okResolver() });
    await playLoaded(root);
    expect(setEnabled).not.toHaveBeenCalled();
    await focusSettled(root);
    expect(setEnabled).toHaveBeenLastCalledWith(true);
    await nativeKey('right', 'down');
    expect(engine.seek).toHaveBeenLastCalledWith(10);
    await nativeKey('right', 'down', 1);
    expect(engine.seek).toHaveBeenCalledTimes(1);
    await advance(AUDIO_HOLD_REPEAT_MS);
    await nativeKey('right', 'down', 2);
    expect(engine.seek).toHaveBeenLastCalledWith(20);
    await nativeKey('right', 'up');
    await key('right');
    expect(engine.seek).toHaveBeenCalledTimes(2);
    // A React Native key up without a native key down (the press that moved focus here) does nothing.
    await key('left');
    expect(engine.seek).toHaveBeenCalledTimes(2);
    await blur(root);
    expect(setEnabled).toHaveBeenLastCalledWith(false);
  });

  it('an unknown duration: → does nothing (it could pass the end), ← still works', async () => {
    const root = await render({ durationSec: null, resolveSource: okResolver() });
    await focusSettled(root);
    await key('right');
    expect(timeText(root)).toBe(`0:00 / ${t('audio.durationUnknown')}`);
    await press(root);
    // The engine reports no duration either.
    await engineEvent(() => engine.props!.onLoad?.({ durationSec: 0 }));
    await engineEvent(() => engine.props!.onProgress?.(30));
    await key('right');
    expect(engine.seek).not.toHaveBeenCalled();
    await key('left');
    expect(engine.seek).toHaveBeenLastCalledWith(20);
  });

  it('the start is clamped to the loaded duration', async () => {
    const root = await render({ resolveSource: okResolver() });
    await focusSettled(root);
    for (let i = 0; i < 15; i++) {
      await key('right');
    }
    expect(timeText(root)).toBe('2:30 / 3:12');
    await press(root);
    await engineEvent(() => engine.props!.onLoad?.({ durationSec: 100 }));
    expect(engine.seek).toHaveBeenLastCalledWith(100);
    expect(timeText(root)).toBe('1:40 / 1:40');
  });

  it('the end clears a pending seek: later progress shows again', async () => {
    const root = await render({ resolveSource: okResolver() });
    await playLoaded(root);
    await focusSettled(root);
    await key('right');
    await engineEvent(() => engine.props!.onEnd?.());
    await press(root);
    await engineEvent(() => engine.props!.onSeekDone?.(0));
    await engineEvent(() => engine.props!.onProgress?.(5));
    expect(timeText(root)).toBe('0:05 / 3:12');
  });

  it('before play, ← → move the shown start; OK then plays from there', async () => {
    const root = await render({ resolveSource: okResolver() });
    await focusSettled(root);
    await key('right');
    await key('right');
    expect(timeText(root)).toBe('0:20 / 3:12');
    await press(root);
    await engineEvent(() => engine.props!.onLoad?.({ durationSec: 192 }));
    expect(engine.seek).toHaveBeenLastCalledWith(20);
  });
});

describe('one playback (matrix «Arbiter»)', () => {
  it('playing claims the app-wide slot; another holder (the Player) pauses it, drops the source, keeps the position', async () => {
    const resolve = okResolver();
    const root = await render({ resolveSource: resolve });
    await playLoaded(root);
    await engineEvent(() => engine.props!.onProgress?.(42));
    expect(playbackArbiter.current()).not.toBeNull();
    const player = { stop: jest.fn() };
    let release: () => void = () => {};
    await act(async () => {
      release = playbackArbiter.claim(player);
    });
    expect(engine.mounts).toBe(1);
    expect(engine.unmounts).toBe(1);
    expect(timeText(root)).toBe('0:42 / 3:12');
    expect(has(root, `${ID}/play`)).toBe(true);
    expect(player.stop).not.toHaveBeenCalled();
    release();
    // OK plays again: a fresh resolve, from 0:42.
    await press(root);
    expect(resolve).toHaveBeenCalledTimes(2);
    await engineEvent(() => engine.props!.onLoad?.({ durationSec: 192 }));
    expect(engine.seek).toHaveBeenLastCalledWith(42);
  });

  it('a second AudioBlock taking the slot stops the first (it pauses and keeps its shown position)', async () => {
    const second = 'post/p/block/audio_file:a2';
    const root = track(createRoot());
    const resolve = okResolver();
    await act(async () =>
      root.render(
        <>
          {element({ resolveSource: resolve })}
          <AudioBlock
            id={second}
            audioKey="audio_file:a2"
            title="Второй"
            durationSec={60}
            resolveSource={resolve}
            onView={noop}
            onFocus={noop}
          />
        </>,
      ),
    );
    await playLoaded(root);
    await engineEvent(() => engine.props!.onProgress?.(30));
    await press(root, second);
    expect(timeText(root)).toBe('0:30 / 3:12');
    expect(has(root, `${ID}/engine`)).toBe(false);
    expect(has(root, `${second}/engine`)).toBe(true);
    expect(has(root, `${second}/pause`)).toBe(true);
    expect(has(root, `${ID}/play`)).toBe(true);
  });

  it('the arbiter itself: a claim stops the previous holder (pure)', () => {
    const arbiter = createPlaybackArbiter();
    const a = { stop: jest.fn() };
    const b = { stop: jest.fn() };
    arbiter.claim(a);
    arbiter.claim(b);
    expect(a.stop).toHaveBeenCalledTimes(1);
    expect(b.stop).not.toHaveBeenCalled();
  });
});

describe('leave and lifecycle (matrix «Leave», «Background»)', () => {
  it('unmount (leaving the post) stops it and releases the slot; nothing persisted', async () => {
    const root = await render({ resolveSource: okResolver() });
    await playLoaded(root);
    expect(playbackArbiter.current()).not.toBeNull();
    await act(async () => root.unmount());
    expect(engine.unmounts).toBe(1);
    expect(playbackArbiter.current()).toBeNull();
  });

  it('a resolve that lands after unmount plays nothing', async () => {
    let finish: (r: AudioSourceResult) => void = () => {};
    const root = await render({ resolveSource: jest.fn(() => new Promise<AudioSourceResult>(r => (finish = r))) });
    await press(root);
    await act(async () => root.unmount());
    await act(async () => finish({ kind: 'ok', uri: URI }));
    expect(engine.mounts).toBe(0);
    expect(playbackArbiter.current()).toBeNull();
  });

  it('background (Home, sleep) pauses; no auto-resume on return', async () => {
    const root = await render({ resolveSource: okResolver() });
    await playLoaded(root);
    await background();
    expect(engine.props?.paused).toBe(true);
    await advance(5000);
    expect(engine.props?.paused).toBe(true);
  });

  it('an audio-focus loss pauses; no auto-resume', async () => {
    const root = await render({ resolveSource: okResolver() });
    await playLoaded(root);
    await engineEvent(() => engine.props!.onAudioFocusLost?.());
    expect(engine.props?.paused).toBe(true);
  });

  it('the post losing route focus (`active` false: the Player or another Пост on top) pauses; back → still paused', async () => {
    const resolve = okResolver();
    const root = await render({ resolveSource: resolve });
    await playLoaded(root);
    await act(async () => root.render(element({ resolveSource: resolve, active: false })));
    expect(engine.props?.paused).toBe(true);
    await act(async () => root.render(element({ resolveSource: resolve, active: true })));
    expect(engine.props?.paused).toBe(true);
  });

  it('background during the resolve: the source arrives paused', async () => {
    let finish: (r: AudioSourceResult) => void = () => {};
    const root = await render({ resolveSource: jest.fn(() => new Promise<AudioSourceResult>(r => (finish = r))) });
    await press(root);
    await background();
    await act(async () => finish({ kind: 'ok', uri: URI }));
    expect(engine.props?.paused).toBe(true);
  });

  it('a source older than 23 h is resolved again before a resume', async () => {
    const resolve = okResolver();
    const root = await render({ resolveSource: resolve });
    await playLoaded(root);
    await press(root);
    jest.setSystemTime(Date.now() + AUDIO_SOURCE_MAX_AGE_MS);
    await press(root);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});

describe('errors (matrix «Engine error», «Play» errors)', () => {
  it('an engine error re-resolves once and resumes at the last position; a second error before the new source loads → «Не удалось воспроизвести», OK retries', async () => {
    const resolve = okResolver();
    const root = await render({ resolveSource: resolve });
    await playLoaded(root);
    await engineEvent(() => engine.props!.onProgress?.(70));
    await engineEvent(() => engine.props!.onError?.('22004'));
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(engine.props?.paused).toBe(false);
    expect(has(root, `${ID}/error`)).toBe(false);

    await engineEvent(() => engine.props!.onError?.(null));
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(has(root, `${ID}/error`)).toBe(true);
    expect(JSON.stringify(root.container.toJSON())).toContain(t('audio.error'));
    expect(label(root)).toBe(`Аудио. Метроном. 1:10 / 3:12. ${t('audio.error')}. Повторить`);
    expect(has(root, `${ID}/engine`)).toBe(false);
    expect(playbackArbiter.current()).toBeNull();

    await press(root);
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(has(root, `${ID}/error`)).toBe(false);
    // A user retry restores the one automatic re-resolve.
    await engineEvent(() => engine.props!.onError?.(null));
    expect(resolve).toHaveBeenCalledTimes(4);
  });

  it('a source that loaded after a recovery gets the re-resolve again for a later error', async () => {
    const resolve = okResolver();
    const root = await render({ resolveSource: resolve });
    await playLoaded(root);
    await engineEvent(() => engine.props!.onError?.(null));
    expect(resolve).toHaveBeenCalledTimes(2);
    await engineEvent(() => engine.props!.onLoad?.({ durationSec: 192 }));
    await engineEvent(() => engine.props!.onError?.(null));
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(has(root, `${ID}/error`)).toBe(false);
  });

  it.each([
    ['paused by the user (OK)', async (root: Root) => press(root)],
    ['backgrounded (Home, sleep)', async () => background()],
    ['after an audio-focus loss', async () => engineEvent(() => engine.props!.onAudioFocusLost?.())],
  ])('an engine error while %s: the re-resolved source stays paused (never a resume by itself)', async (_name, pause) => {
    const resolve = okResolver();
    const root = await render({ resolveSource: resolve });
    await playLoaded(root);
    await pause(root);
    expect(engine.props?.paused).toBe(true);
    await engineEvent(() => engine.props!.onError?.(null));
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(engine.props?.paused).toBe(true);
    expect(has(root, `${ID}/play`)).toBe(true);
  });

  it('a locked fresh E8 → «Нет доступа к аудио» (not the generic error), no retry offered in the label', async () => {
    const root = await render({ resolveSource: jest.fn(async () => ({ kind: 'locked' as const })) });
    await press(root);
    expect(JSON.stringify(root.container.toJSON())).toContain(t('audio.locked'));
    expect(JSON.stringify(root.container.toJSON())).not.toContain(t('audio.error'));
    expect(label(root)).toBe(`Аудио. Метроном. 0:00 / 3:12. ${t('audio.locked')}`);
  });

  it('two OKs before a re-render send one E8', async () => {
    const resolve: Resolver = jest.fn(() => new Promise<AudioSourceResult>(() => {}));
    const root = await render({ resolveSource: resolve });
    await act(async () => {
      const node = host(root);
      node.props.onClick({ nativeEvent: {} });
      node.props.onClick({ nativeEvent: {} });
    });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['unavailable (no signedQuery, the audio gone)', async () => ({ kind: 'unavailable' as const })],
    ['locked', async () => ({ kind: 'locked' as const })],
    ['an E8 failure', async () => Promise.reject(new Error('x'))],
  ])('%s → the error on the block, nothing played', async (_name, impl) => {
    const resolve: Resolver = jest.fn(impl as (key: string, title: string) => Promise<AudioSourceResult>);
    const root = await render({ resolveSource: resolve });
    await press(root);
    expect(engine.mounts).toBe(0);
    expect(has(root, `${ID}/error`)).toBe(true);
    expect(playbackArbiter.current()).toBeNull();
  });

  it('logs no URI', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const root = await render({ resolveSource: okResolver() });
    await playLoaded(root);
    await engineEvent(() => engine.props!.onError?.('22004'));
    await engineEvent(() => engine.props!.onError?.(null));
    const logged = JSON.stringify([...warn.mock.calls, ...log.mock.calls]);
    expect(logged).not.toContain('example.invalid');
    expect(logged).not.toContain('REDACTED');
  });
});
