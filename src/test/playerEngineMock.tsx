/**
 * Test-only PlayerEngine (Story 4.1): stands in for the react-native-video
 * adapter behind the PlayerEngine port. It renders a plain View, records the
 * props of the mounted engine (`engine.props`), counts mounts and unmounts,
 * and its handle's `seek` is a `jest.fn()`. Each test file opts in:
 *
 *   jest.mock('../src/shared/platform/PlayerEngineView', () =>
 *     require('../src/test/playerEngineMock'),
 *   );
 *
 * Tests drive the engine's events through `engine.props` (`onLoad`,
 * `onProgress`, `onBuffering`, `onSeekDone`, `onEnd`, `onError`) and read
 * what the player asks of it there (`source`, `paused`, Story 8.1 `rate`).
 */
import { useImperativeHandle, useLayoutEffect } from 'react';
import { View } from 'react-native';
import type { PlayerEngineProps } from '../shared/platform/playerEngine';

export const engine: {
  props: PlayerEngineProps | null;
  mounts: number;
  unmounts: number;
  seek: jest.Mock;
  reset(): void;
} = {
  props: null,
  mounts: 0,
  unmounts: 0,
  seek: jest.fn(),
  reset() {
    engine.props = null;
    engine.mounts = 0;
    engine.unmounts = 0;
    engine.seek.mockClear();
  },
};

export function PlayerEngineView(props: PlayerEngineProps) {
  useImperativeHandle(props.ref, () => ({ seek: (sec: number) => engine.seek(sec) }), []);
  useLayoutEffect(() => {
    engine.props = props;
  });
  useLayoutEffect(() => {
    engine.mounts += 1;
    return () => {
      engine.unmounts += 1;
      engine.props = null;
    };
  }, []);
  return <View testID={props.testID} />;
}
