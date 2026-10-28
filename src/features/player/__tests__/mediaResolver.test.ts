import { videoSourcesOf, type VideoSource } from '../../../shared/entities/post';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { e8Accessible } from '../../../test/postFixtures';
import { PROGRESSIVE_MAX_HEIGHT, chosenByQuality, pickSource, qualityOf, qualityOptions } from '../mediaResolver';

const URL = 'https://example.invalid/player';
const hls = (type = 'hls'): VideoSource => ({ format: 'hls', type, url: URL });
const dash = (type = 'dash'): VideoSource => ({ format: 'dash', type, url: URL });
const mp4 = (height: number, type = `p${height}`): VideoSource => ({
  format: 'progressive',
  type,
  height,
  url: URL,
});

describe('pickSource (Story 4.1 source order)', () => {
  it('matrix «Open from a row»: the live E8 → HLS when present', () => {
    const sources = videoSourcesOf((e8Accessible() as { data: unknown[] }).data, 'synthetic-id-7') ?? [];
    expect(pickSource(sources)).toMatchObject({ format: 'hls', type: 'hls' });
  });

  it('matrix «Source order»: only DASH + 720p/1080p progressive → DASH', () => {
    expect(pickSource([mp4(720), dash(), mp4(1080)])).toMatchObject({ format: 'dash' });
  });

  it('HLS wins over DASH whatever the order', () => {
    expect(pickSource([dash(), mp4(1080), hls()])).toMatchObject({ format: 'hls' });
  });

  it('matrix «Progressive only»: 360p, 720p, 1080p → 1080p', () => {
    expect(pickSource([mp4(360), mp4(1080), mp4(720)])).toMatchObject({ height: 1080 });
  });

  it('the device cap: 1440p and 2160p are passed over for 1080p; only above the cap → the lowest above it', () => {
    expect(PROGRESSIVE_MAX_HEIGHT).toBe(1080);
    expect(pickSource([mp4(2160), mp4(1440), mp4(1080), mp4(720)])).toMatchObject({ height: 1080 });
    expect(pickSource([mp4(2160), mp4(1440)])).toMatchObject({ height: 1440 });
    expect(pickSource([mp4(1440), mp4(720)], { maxProgressiveHeight: 2160 })).toMatchObject({ height: 1440 });
  });

  it('matrix «No usable URL»: nothing → null', () => {
    expect(pickSource([])).toBeNull();
  });

  it('a non-live adaptive type wins within a format', () => {
    expect(pickSource([hls('live_hls'), hls('hls')])).toMatchObject({ type: 'hls' });
    expect(pickSource([dash('live_dash'), dash('dash_uni')])).toMatchObject({ type: 'dash_uni' });
    expect(pickSource([hls('live_hls')])).toMatchObject({ type: 'live_hls' });
  });

  it('a preferred height (Story 4.3) wins when the video has it, else the default order (the preference is kept)', () => {
    expect(pickSource([hls(), mp4(720, 'high')], { preference: 720 })).toMatchObject({ type: 'high' });
    expect(pickSource([hls(), mp4(720, 'high')], { preference: 1080 })).toMatchObject({ type: 'hls' });
    // Above the automatic cap: an explicit pick plays it (owner decision 2026-10-28).
    expect(pickSource([hls(), mp4(1440, 'quad_hd'), mp4(1080)], { preference: 1440 })).toMatchObject({ height: 1440 });
    // Two types at one height: the first in the API's order.
    expect(pickSource([mp4(480, 'sd'), mp4(480, 'medium')], { preference: 480 })).toMatchObject({ type: 'sd' });
  });

  it('«auto» or no preference: the default order', () => {
    expect(pickSource([mp4(720), hls()], { preference: 'auto' })).toMatchObject({ format: 'hls' });
    expect(pickSource([mp4(720), mp4(360)], { preference: 'auto' })).toMatchObject({ height: 720 });
    expect(pickSource([mp4(720), hls()], { preference: null })).toMatchObject({ format: 'hls' });
  });
});

describe('qualityOptions / qualityOf (Story 4.3)', () => {
  it('matrix «List»: hls + dash + 360/720/1080 → Авто, 1080, 720, 360', () => {
    expect(qualityOptions([mp4(360), hls(), mp4(1080), dash(), mp4(720)])).toEqual(['auto', 1080, 720, 360]);
  });

  it('matrix «Progressive only»: 480 (two types) + 720 → 720, 480 (no Авто)', () => {
    expect(qualityOptions([mp4(480, 'sd'), mp4(720), mp4(480, 'medium')])).toEqual([720, 480]);
  });

  it('heights above 1080p are listed; adaptive only → Авто only; nothing → empty', () => {
    expect(qualityOptions([mp4(2160), mp4(1440), mp4(1080)])).toEqual([2160, 1440, 1080]);
    expect(qualityOptions([dash(), hls('live_hls')])).toEqual(['auto']);
    expect(qualityOptions([])).toEqual([]);
  });

  it('qualityOf: adaptive → auto, progressive → its height', () => {
    expect(qualityOf(hls())).toBe('auto');
    expect(qualityOf(dash())).toBe('auto');
    expect(qualityOf(mp4(720))).toBe(720);
  });
});

describe('recovery pick (Story 4.4)', () => {
  it('the kept quality key: the same key when the fresh E8 has it, else the default order', () => {
    const fresh = [hls(), mp4(720, 'high'), mp4(1080)];
    expect(pickSource(fresh, { preference: qualityOf(mp4(720)) })).toMatchObject({ type: 'high' });
    expect(pickSource(fresh, { preference: qualityOf(hls('live_hls')) })).toMatchObject({ type: 'hls' });
    // 720p gone from the fresh E8: HLS, else DASH, else the nearest progressive ≤ 1080p.
    expect(pickSource([dash(), mp4(1080)], { preference: 720 })).toMatchObject({ format: 'dash' });
    expect(pickSource([mp4(1440), mp4(1080), mp4(360)], { preference: 720 })).toMatchObject({ height: 1080 });
  });

  it('chosenByQuality: only a progressive source of the preferred height', () => {
    expect(chosenByQuality(mp4(1440), 1440)).toBe(true);
    expect(chosenByQuality(mp4(1080), 720)).toBe(false);
    expect(chosenByQuality(hls(), 'auto')).toBe(false);
    expect(chosenByQuality(mp4(1080), null)).toBe(false);
    expect(chosenByQuality(mp4(1080), 'auto')).toBe(false);
  });
});
