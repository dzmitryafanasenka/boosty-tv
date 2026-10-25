import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import * as Keychain from 'react-native-keychain';
import {
  SpikeButton,
  SpikeLog,
  SpikeScreen,
  spikeColors,
  spikeLog,
  useBackToMenu,
} from './SpikeUi';

/**
 * Story 1.2 spike only. Exercises react-native-keychain 10 the way the future
 * SecureStore port will (ADR 0002): any read error wipes the store and yields
 * «signed-out». The stored value is a non-secret marker, never a token.
 */

const SERVICE = 'io.github.dzmitryafanasenka.boostytv.spike';
const USERNAME = 'spike';

type ReadResult =
  | { kind: 'value'; value: string }
  | { kind: 'empty' }
  | { kind: 'signed-out'; reason: string; wiped: boolean };

let forceNextReadError = false;

async function readMarker(): Promise<ReadResult> {
  try {
    if (forceNextReadError) {
      forceNextReadError = false;
      throw new Error('Simulated storage corruption (forced error path)');
    }
    const credentials = await Keychain.getGenericPassword({ service: SERVICE });
    if (!credentials) {
      return { kind: 'empty' };
    }
    return { kind: 'value', value: credentials.password };
  } catch (error) {
    let wiped = false;
    try {
      wiped = await Keychain.resetGenericPassword({ service: SERVICE });
    } catch (wipeError) {
      spikeLog('keychain', `wipe failed: ${errorName(wipeError)}`);
    }
    return { kind: 'signed-out', reason: errorName(error), wiped };
  }
}

function errorName(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 200);
  }
  return String(error).slice(0, 200);
}

function describe(result: ReadResult): string {
  switch (result.kind) {
    case 'value':
      return `read: value=${result.value}`;
    case 'empty':
      return 'read: empty (nothing stored)';
    case 'signed-out':
      return `read: signed-out (wiped=${result.wiped}) after ${result.reason}`;
  }
}

export function KeychainCheck({ onExit }: { onExit: () => void }) {
  useBackToMenu(onExit);
  const [status, setStatus] = useState('…');
  const [lines, setLines] = useState<string[]>([]);

  const log = useCallback((line: string) => {
    spikeLog('keychain', line);
    setStatus(line);
    setLines(prev =>
      [`${new Date().toISOString().slice(11, 19)} ${line}`, ...prev].slice(
        0,
        30,
      ),
    );
  }, []);

  const read = useCallback(async () => {
    log(describe(await readMarker()));
  }, [log]);

  useEffect(() => {
    // Read on mount, so a kill / cold start / reboot check needs one press.
    Keychain.getSecurityLevel()
      .then(level => log(`securityLevel=${String(level)}`))
      .catch(error => log(`securityLevel error: ${errorName(error)}`))
      .finally(() => {
        read().catch(error => log(`unexpected: ${errorName(error)}`));
      });
  }, [log, read]);

  const save = useCallback(async () => {
    const marker = `marker-${Date.now()}`;
    try {
      const result = await Keychain.setGenericPassword(USERNAME, marker, {
        service: SERVICE,
      });
      log(
        result
          ? `saved: value=${marker} storage=${result.storage}`
          : 'save: returned false',
      );
    } catch (error) {
      log(`save error: ${errorName(error)}`);
    }
  }, [log]);

  const corrupt = useCallback(() => {
    forceNextReadError = true;
    log('next read will hit the forced error path; press «Прочитать»');
  }, [log]);

  const wipe = useCallback(async () => {
    try {
      log(
        `reset: ${await Keychain.resetGenericPassword({ service: SERVICE })}`,
      );
    } catch (error) {
      log(`reset error: ${errorName(error)}`);
    }
  }, [log]);

  return (
    <SpikeScreen
      title="react-native-keychain 10"
      controls={
        <>
          <SpikeButton
            label="Сохранить"
            onPress={save}
            preferredFocus
            testID="kc-save"
          />
          <SpikeButton label="Прочитать" onPress={read} testID="kc-read" />
          <SpikeButton
            label="Симулировать порчу"
            onPress={corrupt}
            testID="kc-corrupt"
          />
          <SpikeButton label="Стереть" onPress={wipe} testID="kc-wipe" />
          <SpikeButton label="Назад в меню" onPress={onExit} />
        </>
      }
    >
      <Text
        style={[
          styles.status,
          status.includes('error') || status.includes('signed-out')
            ? { color: spikeColors.accent }
            : null,
        ]}
      >
        {status}
      </Text>
      <SpikeLog lines={lines} />
    </SpikeScreen>
  );
}

const styles = StyleSheet.create({
  status: { color: spikeColors.text, fontSize: 15, marginBottom: 8 },
});
