/**
 * The real PlayerEngine adapter over a mocked `react-native-video` (Story
 * 4.1): the source type hint, the 1080p adaptive cap after `onLoad`, integer
 * seconds across the port. Native playback is a device check.
 */
import { act, createRef } from 'react';
import { createRoot, type Root } from 'test-renderer';
import type { PlayerEngineHandle } from '../playerEngine';
import { PlayerEngineView } from '../PlayerEngineView';

const mockVideo: { props: Record<string, any> | null; seek: jest.Mock } = {
  props: null,
  seek: jest.fn(),
};

jest.mock('react-native-video', () => {
  const React = jest.requireActual('react');
  function Video(props: Record<string, any>) {
    mockVideo.props = props;
    React.useImperativeHandle(props.ref, () => ({ seek: mockVideo.seek }), []);
    return null;
  }
  return { __esModule: true, default: Video };
});

const URL = 'https://example.invalid/player';
const TRACKS = [
  { height: 360, bitrate: 800_000 },
  { height: 1080, bitrate: 4_500_000 },
  { height: 1440, bitrate: 8_000_000 },
];

async function render(format: 'hls' | 'dash' | 'progressive', ref = createRef<PlayerEngineHandle>()) {
  const onLoad = jest.fn();
  let root!: Root;
  await act(async () => {
    root = createRoot();
    root.render(<PlayerEngineView ref={ref} source={{ uri: URL, format }} paused={false} onLoad={onLoad} />);
  });
  return { root, ref, onLoad };
}

async function load() {
  await act(async () => {
    mockVideo.props?.onLoad({ duration: 600.7, currentTime: 0, videoTracks: TRACKS });
  });
}

beforeEach(() => {
  mockVideo.props = null;
  mockVideo.seek.mockClear();
});

describe('PlayerEngineView (react-native-video adapter)', () => {
  it.each([
    ['hls', 'm3u8'],
    ['dash', 'mpd'],
    ['progressive', undefined],
  ] as const)('%s: source type %p, no headers', async (format, type) => {
    const { root } = await render(format);
    expect(mockVideo.props?.source).toEqual({ uri: URL, type });
    expect(mockVideo.props?.focusable).toBe(false);
    expect(mockVideo.props?.playInBackground).toBe(false);
    await act(async () => root.unmount());
  });

  it.each(['hls', 'dash'] as const)('%s: no cap until onLoad, then maxBitRate = the highest bitrate at or below 1080p', async format => {
    const { root, onLoad } = await render(format);
    expect(mockVideo.props?.maxBitRate).toBe(0);
    await load();
    expect(mockVideo.props?.maxBitRate).toBe(4_500_000);
    expect(onLoad).toHaveBeenCalledWith({ durationSec: 600 });
    await act(async () => root.unmount());
  });

  it('progressive: never capped (maxBitRate 0)', async () => {
    const { root } = await render('progressive');
    await load();
    expect(mockVideo.props?.maxBitRate).toBe(0);
    await act(async () => root.unmount());
  });

  it('seek takes integer seconds: seek(12.9) → 12', async () => {
    const { root, ref } = await render('hls');
    ref.current?.seek(12.9);
    expect(mockVideo.seek).toHaveBeenCalledWith(12);
    await act(async () => root.unmount());
  });

  it.each(['hls', 'dash'] as const)('%s: onResolution from onBandwidthUpdate (reportBandwidth), only known and changed heights', async format => {
    const onResolution = jest.fn();
    let root!: Root;
    await act(async () => {
      root = createRoot();
      root.render(
        <PlayerEngineView source={{ uri: URL, format }} paused={false} onResolution={onResolution} />,
      );
    });
    expect(mockVideo.props?.reportBandwidth).toBe(true);
    const sample = async (height: number | undefined) =>
      act(async () => {
        mockVideo.props?.onBandwidthUpdate({ bitrate: 1_000_000, height, width: 0 });
      });
    await sample(0);
    await sample(undefined);
    expect(onResolution).not.toHaveBeenCalled();
    await sample(1080);
    await sample(1080);
    await sample(720);
    expect(onResolution.mock.calls).toEqual([[1080], [720]]);
    await act(async () => root.unmount());
  });

  it('progressive or no listener: no bandwidth reports', async () => {
    let root!: Root;
    await act(async () => {
      root = createRoot();
      root.render(<PlayerEngineView source={{ uri: URL, format: 'progressive' }} paused={false} onResolution={jest.fn()} />);
    });
    expect(mockVideo.props?.reportBandwidth).toBe(false);
    expect(mockVideo.props?.onBandwidthUpdate).toBeUndefined();
    await act(async () => root.unmount());
    const { root: other } = await render('hls');
    expect(mockVideo.props?.reportBandwidth).toBe(false);
    await act(async () => other.unmount());
  });
});
