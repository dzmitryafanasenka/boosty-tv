import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import type { MediaRef } from '../../shared/entities/post';
import { useLatestRef } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { colors } from '../../shared/ui';
import { ExternalHandoff, HandoffLoading } from './ExternalHandoff';
import { externalPlayerPreference } from './externalPlayerPreference';
import type { QualityKey } from './mediaResolver';
import { PlayerScreen, type PlayerScreenProps } from './PlayerScreen';
import { qualityPreference } from './qualityPreference';

export type PlayerEntryProps = Omit<PlayerScreenProps, 'mediaRef' | 'notice' | 'onLiveUnplayable'> & {
  /** A recording only: live always plays in the built-in player. */
  mediaRef: MediaRef;
};

type Step = 'read' | 'handoff' | 'builtin';

/**
 * The Player route's entry for a recording while `phaseFlags.externalPlayer`
 * is on (Story 8.2, PLAY-13). It reads the device's «Системный видеоплеер»
 * value once, then:
 * - off → `PlayerScreen` exactly as before;
 * - on → `ExternalHandoff` (quality list → the installed player: one opens
 *   directly, several get the Android chooser). A player resolves →
 *   `onExit` before it starts (no progress call, no E9). No real player →
 *   the picked quality is kept in memory until the app restarts
 *   (`qualityPreference.remember`: later built-in videos start there too;
 *   the stored preference is untouched) and `PlayerScreen` with «Внешний плеер
 *   не найден» in the overlay. A non-playable E8 → `PlayerScreen`, which
 *   owns those states. Both mount PlayerScreen, which sends its own fresh
 *   E8 (fresh signed URLs) and runs the normal progress session.
 * PlayerScreen's playback logic is not touched; it only gets the notice.
 */
export function PlayerEntry(props: PlayerEntryProps) {
  const { http, mediaRef, onExit } = props;
  const [step, setStep] = useState<Step>(() => {
    const on = externalPlayerPreference.peek();
    return on === undefined ? 'read' : on ? 'handoff' : 'builtin';
  });
  const [notice, setNotice] = useState(false);
  useEffect(() => {
    if (step !== 'read') {
      return;
    }
    let alive = true;
    externalPlayerPreference.read().then(on => {
      if (alive) {
        setStep(on ? 'handoff' : 'builtin');
      }
    });
    return () => {
      alive = false;
    };
  }, [step]);

  const onExitRef = useLatestRef(onExit);
  // Back while the value is read (PlayerScreen and the hand-off own Back later).
  useFocusEffect(
    useCallback(() => {
      if (step !== 'read') {
        return undefined;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        onExitRef.current();
        return true;
      });
      return () => sub.remove();
    }, [step, onExitRef]),
  );

  const leave = useCallback(() => onExitRef.current(), [onExitRef]);
  const onFallback = useCallback((key: QualityKey) => {
    qualityPreference.remember(key);
    setNotice(true);
    setStep('builtin');
  }, []);
  const onNotReady = useCallback(() => setStep('builtin'), []);

  switch (step) {
    case 'read':
      return (
        <View testID="player/entry" style={styles.root}>
          <HandoffLoading />
        </View>
      );
    case 'handoff':
      return (
        <ExternalHandoff
          http={http}
          mediaRef={mediaRef}
          onOpened={leave}
          onBack={leave}
          onFallback={onFallback}
          onNotReady={onNotReady}
        />
      );
    case 'builtin':
      return <PlayerScreen {...props} notice={notice ? t('player.external.notFound') : undefined} />;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
