import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Video, {
  type OnLoadData,
  type OnPlaybackRateChangeData,
  type OnProgressData,
  type OnSeekData,
  type OnVideoErrorData,
  type VideoRef,
} from 'react-native-video';
import {
  SpikeButton,
  SpikeLog,
  SpikeScreen,
  spikeColors,
  spikeLog,
  useBackToMenu,
} from './SpikeUi';

/**
 * Story 1.2 spike only. Public test streams, no Boosty media or credentials.
 */
const SOURCES = [
  {
    id: 'hls',
    label: 'HLS (mux test stream)',
    uri: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  },
  {
    id: 'dash',
    label: 'DASH (Akamai BBB)',
    uri: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd',
  },
  {
    id: 'mp4',
    label: 'MP4 (W3C Sintel trailer)',
    uri: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
  },
  {
    id: 'invalid',
    label: 'Неверный URL',
    uri: 'https://example.invalid/missing/stream.m3u8',
  },
] as const;

type SourceId = (typeof SOURCES)[number]['id'];

export function VideoCheck({ onExit }: { onExit: () => void }) {
  useBackToMenu(onExit);
  const videoRef = useRef<VideoRef>(null);
  const [sourceId, setSourceId] = useState<SourceId | null>(null);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(1);
  const [position, setPosition] = useState(0);
  const [lines, setLines] = useState<string[]>([]);

  const source = SOURCES.find(s => s.id === sourceId);

  const log = useCallback(
    (line: string) => {
      spikeLog('video', `${sourceId ?? '-'} ${line}`);
      setLines(prev =>
        [`${new Date().toISOString().slice(11, 19)} ${line}`, ...prev].slice(
          0,
          40,
        ),
      );
    },
    [sourceId],
  );

  const select = (id: SourceId) => {
    setSourceId(id);
    setPaused(false);
    setRate(1);
    setPosition(0);
    setLines([]);
    spikeLog('video', `select ${id}`);
  };

  const seekBy = (delta: number) => {
    const target = Math.max(0, position + delta);
    log(`seek request ${position.toFixed(1)} -> ${target.toFixed(1)}`);
    videoRef.current?.seek(target);
  };

  return (
    <SpikeScreen
      title="react-native-video 6.19"
      controls={
        <>
          {SOURCES.map((s, index) => (
            <SpikeButton
              key={s.id}
              label={s.label}
              onPress={() => select(s.id)}
              preferredFocus={index === 0}
              testID={`video-${s.id}`}
            />
          ))}
          <SpikeButton label="−10 с" onPress={() => seekBy(-10)} />
          <SpikeButton label="+10 с" onPress={() => seekBy(10)} />
          <SpikeButton
            label={rate === 1 ? 'Скорость 1.5×' : 'Скорость 1×'}
            onPress={() => setRate(r => (r === 1 ? 1.5 : 1))}
          />
          <SpikeButton
            label={paused ? 'Играть' : 'Пауза'}
            onPress={() => setPaused(p => !p)}
          />
          <SpikeButton label="Назад в меню" onPress={onExit} />
        </>
      }
    >
      <View style={styles.row}>
        <View style={styles.player}>
          {source ? (
            <Video
              key={source.id}
              ref={videoRef}
              source={{ uri: source.uri }}
              style={styles.video}
              paused={paused}
              rate={rate}
              resizeMode="contain"
              focusable={false}
              progressUpdateInterval={1000}
              onLoadStart={() => log('loadStart')}
              onLoad={(e: OnLoadData) =>
                log(
                  `load duration=${e.duration.toFixed(1)} size=${
                    e.naturalSize.width
                  }x${e.naturalSize.height} videoTracks=${
                    e.videoTracks?.length ?? 0
                  }`,
                )
              }
              onReadyForDisplay={() => log('readyForDisplay (first frame)')}
              onBuffer={({ isBuffering }) => log(`buffer ${isBuffering}`)}
              onProgress={(e: OnProgressData) => setPosition(e.currentTime)}
              onSeek={(e: OnSeekData) =>
                log(`seek done at ${e.currentTime.toFixed(1)}`)
              }
              onPlaybackRateChange={(e: OnPlaybackRateChangeData) =>
                log(`rate ${e.playbackRate}`)
              }
              onEnd={() => log('end')}
              onError={(e: OnVideoErrorData) =>
                log(
                  `ERROR code=${e.error.errorCode ?? '-'} ${
                    e.error.errorString ?? ''
                  } ${e.error.errorException ?? ''}`.slice(0, 240),
                )
              }
            />
          ) : (
            <Text style={styles.hint}>Выберите источник</Text>
          )}
        </View>
        <View style={styles.side}>
          <Text style={styles.state}>
            {`${source?.id ?? '-'} pos=${position.toFixed(1)} rate=${rate} ${
              paused ? 'paused' : 'playing'
            }`}
          </Text>
          <SpikeLog lines={lines} />
        </View>
      </View>
    </SpikeScreen>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  player: {
    width: 384,
    height: 216,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  video: { width: 384, height: 216 },
  side: { flex: 1 },
  hint: { color: spikeColors.muted, fontSize: 14 },
  state: { color: spikeColors.text, fontSize: 14, marginBottom: 8 },
});
