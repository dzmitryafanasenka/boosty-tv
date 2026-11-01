/**
 * Story 9.3 through the real App with a stored session: the time-to-first-
 * frame line. OK on a post's video row (or a timestamp chip) marks the
 * opening; the Player's first rendered frame (`onReadyForDisplay` through
 * the mocked PlayerEngine port) logs one `first frame` line with the
 * elapsed time, the origin and the stream kind, and nothing that names the
 * content or the account. The «Продолжить» origin is covered in
 * homeFeedFlow.test.tsx, live in liveFlow.test.tsx. The port is mocked:
 * this proves when the line is written, not native frame timing.
 */
import { act } from 'react';
import { logger } from '../src/shared/services/logger';
import { playerOpenMark } from '../src/shared/services/perfMark';
import { engine } from '../src/test/playerEngineMock';
import { lastFocusTarget, unmount } from '../src/test/flow';
import { blockEnd, postDetail, text as textBlock } from '../src/test/postFixtures';
import {
  focusOn,
  press,
  back,
  advance,
  key,
  FEED_BLOG,
  POST,
  VIDEO,
  SURFACE,
  SETTINGS,
  URL,
  RETRY,
  PRIMARY,
  ONE,
  okVideo,
  ALL,
  withData,
  currentRoute,
  fire,
  openPost,
  openPlayer,
  handlers,
  setupPlayerFlowHarness,
  type Root,
} from '../src/test/playerFlowHarness';

jest.mock('react-native-keychain');
jest.mock('../src/shared/ui/requestHostFocus', () => ({
  requestHostFocus: jest.fn(),
}));
jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  require('../src/test/backHandlerMock'),
);
jest.mock('react-native/Libraries/Components/TV/TVEventHandler', () =>
  require('../src/test/tvEventMock'),
);
jest.mock('react-native/Libraries/Components/TV/TVFocusGuideView', () =>
  require('../src/test/flow').recordingFocusGuideModule(),
);
jest.mock('@shopify/flash-list', () => require('../src/test/flow').recordingFlashListModule());
jest.mock('../src/shared/platform/PlayerEngineView', () => require('../src/test/playerEngineMock'));

setupPlayerFlowHarness();

const firstFrames = () => logger.entries().filter(entry => entry.message === 'first frame');
const frame = () => act(async () => engine.props?.onReadyForDisplay?.());

describe('Story 9.3: the `first frame` line', () => {
  it('matrix «TTFF from post»: one line, origin «post», the elapsed ms and the kind; no id, URL or title', async () => {
    const root = await openPost();
    await press(root, VIDEO('v1'));
    expect(currentRoute()).toBe('Player');
    await focusOn(root, SURFACE);
    await advance(800);
    await frame();
    // Media3 reports «ready» again after every rebuffer and seek: one line only.
    await fire('onLoad', { durationSec: 600 });
    await frame();
    await fire('onBuffering', true);
    await fire('onBuffering', false);
    await frame();
    const lines = firstFrames();
    expect(lines).toEqual([
      expect.objectContaining({
        level: 'info',
        scope: 'player',
        fields: { ms: expect.any(String), origin: 'post', kind: 'hls' },
      }),
    ]);
    expect(Number(lines[0].fields?.ms)).toBeGreaterThanOrEqual(800);
    expect(JSON.stringify(lines)).not.toMatch(/example\.invalid|feed-post|synthetic-blog|v1|Title/);
    await unmount(root);
  });

  it('«Смотреть» opens with origin «post»', async () => {
    const root = await openPost();
    await press(root, PRIMARY);
    expect(currentRoute()).toBe('Player');
    await frame();
    expect(firstFrames().map(e => e.fields)).toEqual([{ ms: expect.any(String), origin: 'post', kind: 'hls' }]);
    await unmount(root);
  });

  it('an E8 failure (the error state), then «Повторить» and a first frame: no line (the error screen is never timed)', async () => {
    const root = await openPost();
    handlers.e8 = () => ({ status: 503, body: {} });
    await press(root, VIDEO('v1'), { settle: { timerRounds: 30 } });
    expect(lastFocusTarget()).toBe(RETRY);
    handlers.e8 = () => ({ status: 200, body: postDetail(FEED_BLOG, POST, ONE) });
    await press(root, RETRY);
    expect(engine.props?.source.format).toBe('hls');
    await fire('onLoad', { durationSec: 600 });
    await frame();
    expect(firstFrames()).toEqual([]);
    await unmount(root);
  });

  it('the kind follows the playing source: progressive is «mp4», DASH «dash»', async () => {
    withData([okVideo('v1', [{ type: 'full_hd', url: URL }])]);
    let root: Root = await openPlayer();
    await frame();
    await unmount(root);
    withData([okVideo('v1', [{ type: 'dash', url: URL }])]);
    root = await openPlayer();
    await frame();
    expect(firstFrames().map(e => e.fields?.kind)).toEqual(['mp4', 'dash']);
    await unmount(root);
  });

  it('a timestamp chip opens with origin «timestamp»', async () => {
    const link = (s: string, url: string) => ({ type: 'link', content: JSON.stringify([s, 'unstyled', []]), url });
    withData([
      okVideo('v1', ALL),
      textBlock('Таймкоды: '),
      link('1:00 Тема', `https://boosty.to/${FEED_BLOG}/posts/${POST}?t=60&tmid=v1`),
      blockEnd(),
    ]);
    const root = await openPost();
    await press(root, `post/${POST}/block/text@1/link/0`);
    expect(currentRoute()).toBe('Player');
    await frame();
    expect(firstFrames().map(e => e.fields?.origin)).toEqual(['timestamp']);
    await unmount(root);
  });

  it('matrix «TTFF re-entry»: a quality switch remounts the engine without a second line', async () => {
    withData([
      okVideo('v1', [
        { type: 'hls', url: `${URL}-hls` },
        { type: 'high', url: `${URL}-720` },
      ]),
    ]);
    const root = await openPlayer();
    await frame();
    const mounts = engine.mounts;
    await key('up');
    await focusOn(root, SETTINGS);
    await press(root, SETTINGS);
    await advance(50);
    await press(root, 'player/sheet/quality');
    await advance(50);
    await press(root, 'player/sheet/quality/720');
    await advance(50);
    expect(engine.mounts).toBe(mounts + 1);
    expect(engine.props?.source.format).toBe('progressive');
    await fire('onLoad', { durationSec: 600 });
    await frame();
    expect(firstFrames()).toHaveLength(1);
    await unmount(root);
  });

  it('matrix «TTFF re-entry»: the automatic recovery after an error logs nothing (an opening that failed has no line)', async () => {
    const root = await openPlayer();
    await frame();
    await fire('onError', 'decoder');
    await fire('onLoad', { durationSec: 600 });
    await frame();
    expect(firstFrames()).toHaveLength(1);
    await unmount(root);
  });

  it('an error before the first frame: no line, also when the recovered source then shows its first frame', async () => {
    const root = await openPlayer();
    const mounts = engine.mounts;
    await fire('onError', 'decoder');
    expect(engine.mounts).toBe(mounts + 1);
    await fire('onLoad', { durationSec: 600 });
    await frame();
    expect(firstFrames()).toEqual([]);
    await unmount(root);
  });

  it('matrix «Back before first frame»: no line; the next opening is timed from its own press', async () => {
    const root = await openPost();
    await press(root, VIDEO('v1'));
    expect(currentRoute()).toBe('Player');
    await focusOn(root, SURFACE);
    await back();
    expect(currentRoute()).toBe('Post');
    expect(firstFrames()).toEqual([]);
    // The mark was taken by the closed player: nothing is left for a later one.
    expect(playerOpenMark.take()).toBeNull();
    await advance(5_000);
    await press(root, VIDEO('v1'));
    await advance(300);
    await frame();
    const lines = firstFrames();
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].fields?.ms)).toBeLessThan(5_000);
    await unmount(root);
  });
});
