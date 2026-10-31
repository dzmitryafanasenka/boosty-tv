import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Screen } from '../../shared/focus';
import { t, tf } from '../../shared/i18n';
import { logFileLocation } from '../../shared/platform/logFile';
import { diagnosticsCapture } from '../../shared/services/logFileSink';
import { SettingRow, Text, requestHostFocus, spacing, type HostView } from '../../shared/ui';

/** Focus ids (docs/focus-map.md, Diagnostics). */
export const DIAGNOSTICS_CAPTURE_ID = 'settings/diagnostics/capture';
export const DIAGNOSTICS_CLEAR_ID = 'settings/diagnostics/clear';

export type DiagnosticsScreenProps = {
  testID?: string;
};

type ClearState = 'idle' | 'clearing' | 'done' | 'failed';

/**
 * «Диагностика» (Story 8.3, SET-05): the hidden route behind seven OK
 * presses on Настройки' «Версия». For testing and debugging only:
 *
 * - «Запись логов» (toggle, device-scoped `diagnostics.capture.v1`, default
 *   off): on writes the Logger's ring, then every new redacted entry, to the
 *   capped log file; off deletes the file. OK flips it at once. The initial
 *   focus. A failed read shows «Выкл».
 * - «Очистить логи»: empties the ring and the file; a status line says
 *   whether it worked.
 * - The adb steps to pull the file (`adb pull …/files/logs/`) and, when the
 *   app can name it, the folder on the TV.
 *
 * Log lines are never shown on the TV; there is no share sheet or upload.
 * Back is the route's (App.tsx): it pops to Настройки, focus on «Версия».
 */
export function DiagnosticsScreen({ testID = 'settings/diagnostics' }: DiagnosticsScreenProps) {
  const captureRef = useRef<HostView>(null);
  const [on, setOn] = useState<boolean | undefined>(() => diagnosticsCapture.peek());
  const [clear, setClear] = useState<ClearState>('idle');
  const [folder, setFolder] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (on === undefined) {
      diagnosticsCapture
        .read()
        .catch(() => false)
        .then(value => {
          if (alive.current) {
            setOn(value);
          }
        });
    }
    logFileLocation().then(path => {
      if (alive.current) {
        setFolder(path);
      }
    });
    return () => {
      alive.current = false;
    };
    // Once per mount: the value is then kept in this screen's state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      requestHostFocus(captureRef.current);
    }, []),
  );

  const toggle = useCallback(() => {
    const current = diagnosticsCapture.peek();
    if (current === undefined) {
      // Not read yet: OK does nothing rather than guess.
      return;
    }
    diagnosticsCapture.set(!current);
    setOn(!current);
  }, []);

  const clearing = useRef(false);
  const onClear = useCallback(() => {
    if (clearing.current) {
      return;
    }
    clearing.current = true;
    setClear('clearing');
    diagnosticsCapture.clearLogs().then(ok => {
      clearing.current = false;
      if (alive.current) {
        setClear(ok ? 'done' : 'failed');
      }
    });
  }, []);

  return (
    <Screen testID={testID} style={styles.screen}>
      <Text variant="title-s" accessibilityRole="header" style={styles.title}>
        {t('settings.diagnostics.title')}
      </Text>
      <View style={styles.rows}>
        <SettingRow
          ref={captureRef}
          testID={DIAGNOSTICS_CAPTURE_ID}
          kind="toggle"
          label={t('settings.diagnostics.capture.row')}
          value={
            on === undefined
              ? undefined
              : on
                ? t('settings.diagnostics.capture.on')
                : t('settings.diagnostics.capture.off')
          }
          checked={on === true}
          description={t('settings.diagnostics.capture.description')}
          onPress={toggle}
        />
        <SettingRow
          testID={DIAGNOSTICS_CLEAR_ID}
          kind="nav"
          label={t('settings.diagnostics.clear.row')}
          onPress={onClear}
        />
      </View>
      {clear === 'done' || clear === 'failed' ? (
        <Text
          testID="settings/diagnostics/clear/status"
          variant="body-s"
          color={clear === 'done' ? 'text-secondary' : 'error-text'}
          style={styles.status}
        >
          {clear === 'done' ? t('settings.diagnostics.clear.done') : t('settings.diagnostics.clear.failed')}
        </Text>
      ) : null}
      <View testID="settings/diagnostics/adb" style={styles.steps}>
        <Text variant="body" accessibilityRole="header">
          {t('settings.diagnostics.adb.title')}
        </Text>
        <Text variant="body-s" color="text-secondary" style={styles.step}>
          {t('settings.diagnostics.adb.step1')}
        </Text>
        <Text variant="body-s" color="text-secondary" style={styles.step}>
          {t('settings.diagnostics.adb.step2')}
        </Text>
        <Text variant="body-s" color="text-secondary" style={styles.step}>
          {t('settings.diagnostics.adb.step3')}
        </Text>
        <Text testID="settings/diagnostics/adb/command" variant="body-s" style={styles.command}>
          {t('settings.diagnostics.adb.command')}
        </Text>
        <Text variant="body-s" color="text-secondary" style={styles.step}>
          {t('settings.diagnostics.adb.step4')}
        </Text>
        {folder !== null ? (
          <Text testID="settings/diagnostics/adb/folder" variant="body-s" color="text-meta" style={styles.step}>
            {tf('settings.diagnostics.adb.folder', { path: folder })}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingTop: spacing['safe-y'],
    paddingHorizontal: spacing['safe-x'],
  },
  title: {
    marginBottom: spacing['8'],
  },
  // Focus headroom: the scaled row and its ring stay inside the safe area.
  rows: {
    maxWidth: 640,
    paddingHorizontal: spacing['focus-headroom'],
  },
  status: {
    marginTop: spacing['4'],
    paddingHorizontal: spacing['focus-headroom'] + spacing['8'],
  },
  steps: {
    marginTop: spacing['10'],
    maxWidth: 720,
    paddingHorizontal: spacing['focus-headroom'] + spacing['8'],
  },
  step: {
    marginTop: spacing['3'],
  },
  command: {
    marginTop: spacing['3'],
    paddingLeft: spacing['6'],
  },
});
