import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Keychain from 'react-native-keychain';
import {
  buildConfirmRequest,
  buildCurrentUserRequest,
  buildSendCodeRequest,
  decodeSession,
  execute,
  formatSanitized,
  maskPhone,
  normalizePhone,
  normalizeSmsCode,
  parseSendCode,
  parseTokens,
  sessionFromTokens,
  type Challenge,
  type ExecuteResult,
  type FetchLike,
} from './phoneAuthApi';
import { getInstallId, keychainStorageReset } from './spikeNative';
import {
  createSpikeSecureStore,
  SpikeSimulatedError,
  type ReadResult,
} from './spikeSecureStore';
import {
  SpikeButton,
  SpikeLog,
  SpikeScreen,
  spikeColors,
  spikeLog,
  useBackToMenu,
} from './SpikeUi';

/**
 * Story 1.3 spike only (branch spike/1-3-phone-auth). Phone + one-time code
 * sign-in against the real API (api-contract §2.2), then E1, then the tokens
 * go to secure storage. The debug panel shows only sanitized results (status
 * and shape). The phone, challenge, SMS code and tokens are never logged or
 * shown; the phone is shown only as a masked hint.
 */

const SESSION_SERVICE = 'io.github.dzmitryafanasenka.boostytv.spike.session';
const TEST_SERVICE = 'io.github.dzmitryafanasenka.boostytv.spike.storagetest';

type Phase = 'phone' | 'code' | 'signed-in';
type StoreName = 'session' | 'test';

// Resolved per call (not captured at import), so tests can replace fetch.
const fetchImpl: FetchLike = (url, init) =>
  (fetch as unknown as FetchLike)(url, init);

function describeRead(name: StoreName, result: ReadResult): string {
  switch (result.kind) {
    case 'value':
      return name === 'session'
        ? 'session: stored value present'
        : `test: value=${result.value}`;
    case 'empty':
      return `${name}: empty (signed-out)`;
    case 'signed-out':
      return (
        `${name}: signed-out after ${result.cause} (${result.error}); ` +
        `fileDeleted=${String(result.recovery.fileDeleted ?? 'n/a')} ` +
        `resetOk=${result.recovery.resetOk}`
      );
    case 'recoverable-error':
      return (
        `${name}: recoverable storage error (${result.error}), data kept, ` +
        `retriesLeft=${result.retriesLeft}`
      );
  }
}

export function PhoneAuthCheck({ onExit }: { onExit: () => void }) {
  useBackToMenu(onExit);

  const [phase, setPhase] = useState<Phase>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [status, setStatus] = useState('…');
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [captchaBlocked, setCaptchaBlocked] = useState(false);
  const [retryStore, setRetryStore] = useState<StoreName | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [focusedField, setFocusedField] = useState<'phone' | 'code' | null>(
    null,
  );

  // Secrets: in memory only, never rendered or logged.
  const phoneRef = useRef<string | null>(null);
  const challengeRef = useRef<Challenge | null>(null);

  const log = useCallback((...entries: string[]) => {
    for (const entry of entries) {
      spikeLog('phoneauth', entry);
    }
    const stamp = new Date().toISOString().slice(11, 19);
    setLines(prev =>
      [...entries.map(e => `${stamp} ${e}`).reverse(), ...prev].slice(0, 80),
    );
  }, []);

  const report = useCallback(
    (line: string) => {
      setStatus(line);
      log(line);
    },
    [log],
  );

  const stores = useMemo(
    () => ({
      session: createSpikeSecureStore({
        service: SESSION_SERVICE,
        keychain: Keychain,
        helper: keychainStorageReset,
        log: line => log(`[store:session] ${line}`),
      }),
      test: createSpikeSecureStore({
        service: TEST_SERVICE,
        username: 'storagetest',
        keychain: Keychain,
        helper: keychainStorageReset,
        log: line => log(`[store:test] ${line}`),
      }),
    }),
    [log],
  );

  const readStore = useCallback(
    async (name: StoreName): Promise<ReadResult> => {
      const result = await stores[name].read();
      setRetryStore(
        result.kind === 'recoverable-error' && result.retriesLeft > 0
          ? name
          : null,
      );
      return result;
    },
    [stores],
  );

  useEffect(() => {
    // On mount: report what is stored (no network), so kill / cold start /
    // reboot and the corruption matrix need no extra key presses.
    (async () => {
      try {
        const id = await getInstallId();
        log(`device_id ready (…${id.slice(-4)})`);
      } catch (error) {
        log(`device_id error: ${error instanceof Error ? error.name : '?'}`);
      }
      const session = await readStore('session');
      report(describeRead('session', session));
      log(describeRead('test', await readStore('test')));
    })().catch(() => log('mount read: unexpected rejection'));
  }, [log, readStore, report]);

  useEffect(() => {
    if (phase !== 'code') {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const logResult = useCallback(
    (result: ExecuteResult): boolean => {
      if (result.kind === 'network') {
        log(`${result.request} → network error (${result.error})`);
        return false;
      }
      log(...formatSanitized(result.sanitized));
      if (result.sanitized.captchaMentioned) {
        setCaptchaBlocked(true);
        report(
          'КАПЧА: Boosty требует доп. проверку. Попытки входа остановлены — ' +
            'это блокер, сообщите владельцу.',
        );
        return true;
      }
      return false;
    },
    [log, report],
  );

  const sendCode = useCallback(
    async (resend: boolean) => {
      if (busy || captchaBlocked) {
        return;
      }
      const phone = resend ? phoneRef.current : normalizePhone(phoneInput);
      if (!phone) {
        report('Номер не распознан: нужен международный формат, 11–15 цифр');
        return;
      }
      setBusy(true);
      try {
        const deviceId = await getInstallId();
        const request = buildSendCodeRequest({
          phone,
          deviceId,
          transport: resend ? 'gate' : undefined,
        });
        const sinceLast =
          resend && sentAt
            ? ` (${Math.round((Date.now() - sentAt) / 1000)} s after last send)`
            : '';
        log(`${request.name}: request sent${sinceLast}`);
        const result = await execute(request, fetchImpl);
        if (logResult(result)) {
          return;
        }
        const challenge =
          result.kind === 'response' && result.sanitized.status === 200
            ? parseSendCode(result.json)
            : null;
        if (!challenge) {
          report(
            result.kind === 'response'
              ? `Код не отправлен: HTTP ${result.sanitized.status}`
              : `Код не отправлен: сеть (${result.error})`,
          );
          return;
        }
        phoneRef.current = phone;
        challengeRef.current = challenge;
        setPhoneInput('');
        setCodeInput('');
        setSentAt(Date.now());
        setNow(Date.now());
        setPhase('code');
        const details =
          `sentTransport=${challenge.sentTransport ?? '—'}, ` +
          `expiresIn=${challenge.expiresIn ?? '—'}`;
        // The masked hint (country code + last 4 digits) stays on screen
        // only; logs (logcat, debug panel) never carry any phone digits.
        setStatus(`Код отправлен на ${maskPhone(phone)}: ${details}`);
        log(`Код отправлен (phone hint shown): ${details}`);
      } catch (error) {
        report(`Ошибка: ${error instanceof Error ? error.name : '?'}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, captchaBlocked, phoneInput, sentAt, log, logResult, report],
  );

  const confirm = useCallback(async () => {
    if (busy || captchaBlocked) {
      return;
    }
    const phone = phoneRef.current;
    const challenge = challengeRef.current;
    const smsCode = normalizeSmsCode(codeInput);
    if (!phone || !challenge) {
      report('Сначала запросите код');
      return;
    }
    if (!smsCode) {
      report('Код не распознан: нужны 4–8 цифр');
      return;
    }
    setBusy(true);
    try {
      const deviceId = await getInstallId();
      const age = sentAt ? Math.round((Date.now() - sentAt) / 1000) : -1;
      log(`confirm: request sent (${age} s after send)`);
      const result = await execute(
        buildConfirmRequest({
          phone,
          challenge: challenge.challenge,
          smsCode,
          deviceId,
        }),
        fetchImpl,
      );
      setCodeInput('');
      if (logResult(result)) {
        return;
      }
      const tokens =
        result.kind === 'response' && result.sanitized.status === 200
          ? parseTokens(result.json)
          : null;
      if (!tokens) {
        report(
          result.kind === 'response'
            ? `Вход не выполнен: HTTP ${result.sanitized.status}. Можно ввести код снова`
            : `Вход не выполнен: сеть (${result.error})`,
        );
        return;
      }
      log(`tokens received: expires_in=${tokens.expiresIn ?? '—'}`);
      const e1 = await execute(
        buildCurrentUserRequest(tokens.accessToken),
        fetchImpl,
      );
      logResult(e1);
      if (e1.kind !== 'response' || e1.sanitized.status !== 200) {
        report('E1 не прошёл — сессия НЕ сохранена');
        return;
      }
      const session = sessionFromTokens(tokens, Date.now());
      const saved = await stores.session.save(JSON.stringify(session));
      if (saved.kind !== 'saved') {
        report(`E1 OK, но сохранить не удалось (${saved.errorKind})`);
        return;
      }
      const readBack = await readStore('session');
      if (
        readBack.kind !== 'value' ||
        decodeSession(readBack.value)?.accessToken !== tokens.accessToken
      ) {
        report(`Сохранено, но чтение не совпало (${readBack.kind})`);
        return;
      }
      challengeRef.current = null;
      setPhase('signed-in');
      report(`Сессия сохранена (E1 HTTP 200, storage=${saved.storage})`);
    } catch (error) {
      report(`Ошибка: ${error instanceof Error ? error.name : '?'}`);
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    captchaBlocked,
    codeInput,
    sentAt,
    log,
    logResult,
    readStore,
    report,
    stores,
  ]);

  const checkSession = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const result = await readStore('session');
      if (result.kind !== 'value') {
        report(describeRead('session', result));
        return;
      }
      const session = decodeSession(result.value);
      if (!session) {
        report('session: stored value malformed');
        return;
      }
      const left =
        session.expiresAt === null
          ? 'unknown'
          : `${session.expiresAt - Math.floor(Date.now() / 1000)} s`;
      log(`session: expiresAt in ${left}`);
      const e1 = await execute(
        buildCurrentUserRequest(session.accessToken),
        fetchImpl,
      );
      logResult(e1);
      report(
        e1.kind === 'response'
          ? e1.sanitized.status === 200
            ? 'Сессия действительна (E1 HTTP 200)'
            : `E1 HTTP ${e1.sanitized.status}`
          : `E1: сеть (${e1.error})`,
      );
      if (e1.kind === 'response' && e1.sanitized.status === 200) {
        setPhase('signed-in');
      }
    } finally {
      setBusy(false);
    }
  }, [busy, log, logResult, readStore, report]);

  const testSave = useCallback(async () => {
    const result = await stores.test.save(`dummy-${Date.now()}`);
    report(
      result.kind === 'saved'
        ? `test: saved (storage=${result.storage}, afterRecovery=${result.afterRecovery})`
        : `test: save failed (${result.errorKind}: ${result.error})`,
    );
  }, [report, stores]);

  const testRead = useCallback(async () => {
    report(describeRead('test', await readStore('test')));
  }, [readStore, report]);

  const testTransientError = useCallback(async () => {
    stores.test.injectNextReadError(new SpikeSimulatedError());
    report(describeRead('test', await readStore('test')));
  }, [readStore, report, stores]);

  const retryRead = useCallback(async () => {
    if (retryStore) {
      report(describeRead(retryStore, await readStore(retryStore)));
    }
  }, [readStore, report, retryStore]);

  const changeNumber = useCallback(() => {
    phoneRef.current = null;
    challengeRef.current = null;
    setCodeInput('');
    setSentAt(null);
    setPhase('phone');
    report('Введите номер заново');
  }, [report]);

  const typedPhone = normalizePhone(phoneInput);
  const elapsed = sentAt ? Math.round((now - sentAt) / 1000) : 0;

  return (
    <SpikeScreen
      title="Вход по телефону (спайк 1.3)"
      controls={
        <ScrollView style={styles.controls}>
          {phase === 'phone' ? (
            <>
              <TextInput
                testID="pa-phone"
                value={phoneInput}
                onChangeText={setPhoneInput}
                placeholder="Номер с кодом страны: 375…"
                placeholderTextColor={spikeColors.muted}
                // number-pad + secureTextEntry gives an Android numberPassword
                // field; phone-pad ignores the password flag and shows digits.
                keyboardType="number-pad"
                secureTextEntry
                autoComplete="off"
                autoCorrect={false}
                importantForAutofill="no"
                onFocus={() => setFocusedField('phone')}
                onBlur={() => setFocusedField(null)}
                style={[
                  styles.input,
                  focusedField === 'phone' && styles.inputFocused,
                ]}
              />
              <SpikeButton
                testID="pa-send"
                label={busy ? '…' : 'Получить код'}
                onPress={() => sendCode(false)}
                preferredFocus
              />
            </>
          ) : null}
          {phase === 'code' ? (
            <>
              <TextInput
                testID="pa-code"
                value={codeInput}
                onChangeText={setCodeInput}
                placeholder="Код из SMS"
                placeholderTextColor={spikeColors.muted}
                keyboardType="number-pad"
                secureTextEntry
                autoComplete="off"
                autoCorrect={false}
                importantForAutofill="no"
                onFocus={() => setFocusedField('code')}
                onBlur={() => setFocusedField(null)}
                style={[
                  styles.input,
                  focusedField === 'code' && styles.inputFocused,
                ]}
              />
              <SpikeButton
                testID="pa-confirm"
                label={busy ? '…' : 'Войти'}
                onPress={confirm}
                preferredFocus
              />
              <SpikeButton
                testID="pa-resend"
                label="Отправить код повторно"
                onPress={() => sendCode(true)}
              />
              <SpikeButton
                testID="pa-change"
                label="Сменить номер"
                onPress={changeNumber}
              />
            </>
          ) : null}
          <SpikeButton
            testID="pa-check"
            label="Проверить сессию"
            onPress={checkSession}
            preferredFocus={phase === 'signed-in'}
          />
          <SpikeButton
            testID="pa-test-save"
            label="Тест хранилища: записать"
            onPress={testSave}
          />
          <SpikeButton
            testID="pa-test-read"
            label="Тест хранилища: прочитать"
            onPress={testRead}
          />
          <SpikeButton
            testID="pa-test-transient"
            label="Тест: временная ошибка"
            onPress={testTransientError}
          />
          {/* Always mounted, so focus does not jump when it becomes unavailable. */}
          <SpikeButton
            testID="pa-retry"
            label={
              retryStore
                ? `Повторить чтение (${retryStore})`
                : 'Повторить чтение (недоступно)'
            }
            onPress={retryRead}
          />
          <SpikeButton testID="pa-exit" label="Назад в меню" onPress={onExit} />
        </ScrollView>
      }
    >
      <Text style={[styles.status, captchaBlocked && styles.blocked]}>
        {status}
      </Text>
      <View style={styles.hints}>
        {phase === 'phone' ? (
          <Text style={styles.hint} testID="pa-phone-hint">
            {phoneInput.length === 0
              ? '↑ поле номера: OK открывает клавиатуру'
              : typedPhone
              ? `Номер: ${maskPhone(typedPhone)}`
              : 'Номер не распознан (нужны код страны и 11–15 цифр)'}
          </Text>
        ) : null}
        {phase === 'code' && phoneRef.current ? (
          <Text style={styles.hint} testID="pa-code-hint">
            {`Номер: ${maskPhone(
              phoneRef.current,
            )} · код отправлен ${elapsed} с назад · ` +
              `введено цифр: ${codeInput.replace(/\D/g, '').length}`}
          </Text>
        ) : null}
      </View>
      <SpikeLog lines={lines} />
    </SpikeScreen>
  );
}

const styles = StyleSheet.create({
  controls: { flex: 1 },
  input: {
    color: spikeColors.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 8,
    borderRadius: 6,
    borderWidth: 3,
    borderColor: '#3A3A3A',
    backgroundColor: '#1E1E1E',
  },
  inputFocused: { borderColor: spikeColors.accent },
  status: { color: spikeColors.text, fontSize: 15, marginBottom: 6 },
  blocked: { color: spikeColors.fail },
  hints: { marginBottom: 6 },
  hint: { color: spikeColors.accent, fontSize: 14 },
});
