import { videoSourcesOf, type VideoSource } from '../../../shared/entities/post';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { e8Accessible } from '../../../test/postFixtures';
import { PROGRESSIVE_MAX_HEIGHT, pickSource } from '../mediaResolver';

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

  it('the preferred quality (Story 4.3) wins when it exists, else the order applies', () => {
    expect(pickSource([hls(), mp4(720, 'high')], { preferredType: 'high' })).toMatchObject({ type: 'high' });
    expect(pickSource([hls(), mp4(720, 'high')], { preferredType: 'full_hd' })).toMatchObject({ type: 'hls' });
  });
});
