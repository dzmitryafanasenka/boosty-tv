import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { z } from 'zod';
import {
  SpikeButton,
  SpikeLog,
  SpikeScreen,
  spikeColors,
  spikeLog,
  useBackToMenu,
} from './SpikeUi';
import {
  probeFunctionConstructor,
  runPluralMatrix,
  runZodMatrix,
  type CheckResult,
} from './zodPluralMatrix';

type Engine = { hermes: boolean; dev: boolean };

function engineInfo(): Engine {
  return {
    hermes:
      typeof (globalThis as { HermesInternal?: unknown }).HermesInternal ===
      'object',
    dev: __DEV__,
  };
}

export function ZodPluralCheck({ onExit }: { onExit: () => void }) {
  useBackToMenu(onExit);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [summary, setSummary] = useState('Не запускалось');

  const run = useCallback(() => {
    const engine = engineInfo();
    const functionCtor = probeFunctionConstructor();
    let all: CheckResult[];
    try {
      all = [...runZodMatrix(), ...runPluralMatrix()];
    } catch (error) {
      all = [{ name: 'matrix crashed', pass: false, detail: String(error) }];
    }
    const failed = all.filter(r => !r.pass).length;
    const text =
      `${failed === 0 ? 'PASS' : 'FAIL'} ${all.length - failed}/${
        all.length
      }; ` +
      `hermes=${engine.hermes} dev=${engine.dev} ` +
      `newFunction=${functionCtor} zodJitlessConfig=${String(
        z.config().jitless,
      )}`;
    setSummary(text);
    setResults(all);
    spikeLog('zod', text);
    all.forEach(r =>
      spikeLog('zod', `${r.pass ? 'PASS' : 'FAIL'} ${r.name}: ${r.detail}`),
    );
  }, []);

  return (
    <SpikeScreen
      title="Zod 4 + русские множественные формы"
      controls={
        <>
          <SpikeButton
            label="Запустить"
            onPress={run}
            preferredFocus
            testID="zod-run"
          />
          <SpikeButton label="Назад в меню" onPress={onExit} />
        </>
      }
    >
      <Text
        style={[
          styles.summary,
          {
            color: summary.startsWith('PASS')
              ? spikeColors.pass
              : summary.startsWith('FAIL')
              ? spikeColors.fail
              : spikeColors.muted,
          },
        ]}
      >
        {summary}
      </Text>
      <SpikeLog
        lines={results.map(
          r => `${r.pass ? 'PASS' : 'FAIL'} ${r.name}: ${r.detail}`,
        )}
      />
    </SpikeScreen>
  );
}

const styles = StyleSheet.create({
  summary: { fontSize: 15, marginBottom: 8 },
});
