import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import * as Keychain from 'react-native-keychain';
import {
  buildFixtures,
  REQUEST_BUDGET,
  runContentShapes,
} from './contentShapesApi';
import type { FetchLike } from './phoneAuthApi';
import { SESSION_SERVICE } from './PhoneAuthCheck';
import { createRefreshCoordinator } from './refreshCoordinator';
import { getInstallId, keychainStorageReset, spikeFiles } from './spikeNative';
import { createSpikeSecureStore } from './spikeSecureStore';
import {
  SpikeButton,
  SpikeLog,
  SpikeScreen,
  spikeColors,
  spikeLog,
  useBackToMenu,
} from './SpikeUi';

/**
 * Story 1.5 spike only (branch spike/1-5-entitlement-errors-events). Runs the
 * fixed read-only S5/S11 request set once with the session stored by the
 * Story 1.3 screen, shows sanitized shapes and the request count, and writes
 * sanitized fixtures to the app's external files directory for adb pull.
 * Raw bodies never reach a log line, the screen or a file.
 */

const fetchImpl: FetchLike = (url, init) =>
  (fetch as unknown as FetchLike)(url, init);

export function ContentShapesCheck({ onExit }: { onExit: () => void }) {
  useBackToMenu(onExit);

  const [status, setStatus] = useState('…');
  const [lines, setLines] = useState<string[]>([]);
  const [requests, setRequests] = useState(0);
  const [rows, setRows] = useState<string[]>([]);
  const busyRef = useRef(false);
  const ranRef = useRef(false);

  const log = useCallback((...entries: string[]) => {
    for (const entry of entries) {
      spikeLog('content', entry);
    }
    const stamp = new Date().toISOString().slice(11, 19);
    setLines(prev =>
      [...entries.map(e => `${stamp} ${e}`).reverse(), ...prev].slice(0, 400),
    );
  }, []);

  const report = useCallback(
    (line: string) => {
      setStatus(line);
      log(line);
    },
    [log],
  );

  const coordinator = useMemo(
    () =>
      createRefreshCoordinator({
        store: createSpikeSecureStore({
          service: SESSION_SERVICE,
          keychain: Keychain,
          helper: keychainStorageReset,
          log: line => log(`[store] ${line}`),
        }),
        fetchImpl,
        getDeviceId: getInstallId,
        log: line => log(`[coord] ${line}`),
      }),
    [log],
  );

  useEffect(() => {
    coordinator
      .reload()
      .then(s => report(`stored session: ${s} (no request)`))
      .catch(() => log('mount: unexpected rejection'));
  }, [coordinator, log, report]);

  const run = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    if (ranRef.current) {
      report('Уже выполнено (один запуск на сеанс экрана)');
      return;
    }
    if (coordinator.getStatus() !== 'signed-in') {
      report(`Нет сессии (${coordinator.getStatus()}): войдите по телефону`);
      return;
    }
    busyRef.current = true;
    ranRef.current = true;
    log('=== run ===');
    try {
      const result = await runContentShapes({
        caller: coordinator,
        fetchImpl,
        log,
      });
      setRequests(result.requests);
      setRows(result.rows.map(r => `${r.id}: ${r.summary}`));
      const files = buildFixtures(result.captures);
      let written = 0;
      for (const f of files) {
        try {
          await spikeFiles.write(f.name, f.text);
          written += 1;
        } catch (error) {
          log(
            `fixture ${f.name}: write failed (${
              error instanceof Error ? error.name : '?'
            })`,
          );
        }
      }
      report(
        `${result.stopped ? `Остановлено: ${result.stopped}` : 'Готово'} — ` +
          `запросов ${result.requests}/${REQUEST_BUDGET}, ` +
          `фикстур записано ${written}/${files.length}`,
      );
    } catch (error) {
      report(`unexpected ${error instanceof Error ? error.name : '?'}`);
    } finally {
      busyRef.current = false;
    }
  }, [coordinator, log, report]);

  const clear = useCallback(async () => {
    try {
      const n = await spikeFiles.clear();
      report(`Файлы фикстур удалены с устройства: ${n}`);
    } catch (error) {
      report(`clear failed (${error instanceof Error ? error.name : '?'})`);
    }
  }, [report]);

  return (
    <SpikeScreen
      title="Контент: доступ, ошибки, события (спайк 1.5)"
      controls={
        <ScrollView style={styles.controls}>
          <SpikeButton
            testID="cs-run"
            label="Запустить (один раз)"
            onPress={run}
            preferredFocus
          />
          <SpikeButton
            testID="cs-clear"
            label="Удалить файлы фикстур"
            onPress={clear}
          />
          <SpikeButton testID="cs-exit" label="Назад в меню" onPress={onExit} />
        </ScrollView>
      }
    >
      <Text style={styles.status} testID="cs-status">
        {status}
      </Text>
      <Text style={styles.counts} testID="cs-counts">
        {`Запросы: ${requests}/${REQUEST_BUDGET}`}
      </Text>
      {rows.map(r => (
        <Text key={r} style={styles.row} testID="cs-row">
          {r}
        </Text>
      ))}
      <SpikeLog lines={lines} />
    </SpikeScreen>
  );
}

const styles = StyleSheet.create({
  controls: { flex: 1 },
  status: { color: spikeColors.text, fontSize: 15, marginBottom: 6 },
  counts: { color: spikeColors.accent, fontSize: 14, marginBottom: 6 },
  row: { color: spikeColors.text, fontSize: 12, marginBottom: 2 },
});
