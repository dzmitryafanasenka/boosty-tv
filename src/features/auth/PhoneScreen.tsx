import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, TVFocusGuideView, View } from 'react-native';
import { isAuthError, type AuthApiClient, type AuthErrorKind } from '../../shared/api';
import { Screen } from '../../shared/focus';
import { t } from '../../shared/i18n';
import {
  Button,
  Text,
  TextField,
  requestHostFocus,
  spacing,
  type HostView,
  type TextFieldHandle,
} from '../../shared/ui';
import { authFlow } from './authFlow';
import { normalizeCountryCodeInput, toE164 } from './phone';

/** Focus ids (docs/focus-map.md §1.5). */
export const PHONE_COUNTRY_ID = 'auth/phone/country';
export const PHONE_NUMBER_ID = 'auth/phone/number';
export const PHONE_SEND_ID = 'auth/phone/send';
export const PHONE_BACK_ID = 'auth/phone/back';
export const PHONE_CHANGE_NUMBER_ID = 'auth/phone/change-number';
export const PHONE_TO_WELCOME_ID = 'auth/phone/to-welcome';
export const PHONE_RETRY_ID = 'auth/phone/retry';

export type PhoneScreenProps = {
  /** A code was sent; the challenge is in `authFlow`. Open A5. */
  onCodeSent: () => void;
  /** «Назад» or «На первый экран»: back to the previous screen (A1, or A11). */
  onExit: () => void;
  /**
   * Opened from A11 (Story 2.6): the draft may hold the stored phone. With
   * a valid prefilled draft the initial focus is «Получить код».
   */
  fromExpired?: boolean;
  /**
   * The active session's send-code (`src/app/session.ts`: the real one, or
   * the demo's), so a demo run sends nothing to Boosty (Epic 2 retro).
   */
  sendCode: AuthApiClient['sendCode'];
};

/** A2 form (with A4 and the inline send errors), A9 or A10. */
type Mode = 'form' | 'tooManyAttempts' | 'verificationRequired';
/** Send errors shown on the A2 form itself. */
type FormError = Extract<AuthErrorKind, 'Network' | 'Unknown'>;

const COLUMN_WIDTH = 440;
const COLUMN_TOP = 100;
const STATE_TOP = 120;
const COUNTRY_WIDTH = 96;

/**
 * A2 Phone (docs/focus-map.md §2): editable country code (`+7` default) and
 * the number, E.164 validation, «Получить код» sends the code.
 *
 * Focus: the number field initially and whenever A2 is the focused route
 * again; ← reaches the country code. ↓ from a field enters the button row on
 * «Получить код», ↑ from the buttons enters the field row on the number
 * (focus guide destinations). IME «Готово»: «Получить код» if the number is
 * valid, otherwise the field. Busy keeps focus on the button.
 *
 * A4: invalid number → field error, no request, focus on the number.
 * A9 (`TooManyAttempts`): «Изменить номер» focused, no countdown, no retry.
 * A10 (`VerificationRequired`): «Попробовать снова» focused, one send retry;
 * after a failed retry «Изменить номер». Nothing maps to A10 yet, because no
 * captcha shape is verified (docs/api-contract.md §2.2).
 * Every state switch focuses its target explicitly (`requestHostFocus`).
 * Back: A9/A10 → the form; the form → A1 (stack pop), or A11 when opened
 * from it.
 *
 * Opened from A11 with a valid prefilled draft, the initial focus is
 * «Получить код» (focus-map §2 «A2 after A11»); every later return to A2
 * focuses the number field as usual.
 */
export function PhoneScreen({
  onCodeSent,
  onExit,
  fromExpired = false,
  sendCode,
}: PhoneScreenProps) {
  const [countryCode, setCountryCode] = useState(
    () => authFlow.getDraft().countryCode,
  );
  const [number, setNumber] = useState(() => authFlow.getDraft().number);
  const [invalid, setInvalid] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [mode, setMode] = useState<Mode>('form');
  const [busy, setBusy] = useState(false);
  const [retryUsed, setRetryUsed] = useState(false);

  // Blocks a second send; React state would let a held key fire twice.
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;

  const countryRef = useRef<TextFieldHandle>(null);
  const numberRef = useRef<TextFieldHandle>(null);
  const sendRef = useRef<HostView>(null);
  const changeNumberRef = useRef<HostView>(null);
  const retryRef = useRef<HostView>(null);
  // Focus guide destinations: the number field for the field row, «Получить
  // код» for the button row. Hosts exist only after the form mounts.
  const [numberHost, setNumberHost] = useState<HostView | null>(null);
  const [sendHost, setSendHost] = useState<HostView | null>(null);
  const fieldsDestinations = useMemo(
    () => (numberHost ? [numberHost] : undefined),
    [numberHost],
  );
  const buttonsDestinations = useMemo(
    () => (sendHost ? [sendHost] : undefined),
    [sendHost],
  );
  /**
   * Where focus goes when the form (re)appears. `none`: the form comes back
   * under A5 (after a successful A10 retry) and must not take focus from it.
   */
  const initialTarget = useRef<'number' | 'send'>(
    fromExpired &&
      toE164(authFlow.getDraft().countryCode, authFlow.getDraft().number)
      ? 'send'
      : 'number',
  );
  const formFocus = useRef<'number' | 'send' | 'none'>(initialTarget.current);
  /** The first route focus applies `initialTarget`; later ones the number. */
  const firstRouteFocus = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Leaving A2 for A1 ends this sign-in attempt.
      authFlow.reset();
    };
  }, []);

  useEffect(() => {
    authFlow.setDraft({ countryCode, number });
  }, [countryCode, number]);

  // Focus guide routes and the focus target whenever the form is shown.
  useEffect(() => {
    if (mode !== 'form') {
      return;
    }
    setNumberHost(numberRef.current?.host() ?? null);
    setSendHost(sendRef.current);
    if (formFocus.current === 'send') {
      requestHostFocus(sendRef.current);
    } else if (formFocus.current === 'number') {
      numberRef.current?.focus();
    }
    formFocus.current = 'number';
  }, [mode]);

  const modeRef = useRef(mode);
  modeRef.current = mode;

  /** A9/A10 target: «Попробовать снова» while offered, else «Изменить номер». */
  const focusStateTarget = useCallback(() => {
    requestHostFocus(retryRef.current ?? changeNumberRef.current);
  }, []);

  // A9/A10 focus after the switch, and on A10 after the retry button goes.
  // While a retry is busy, focus stays on it.
  useEffect(() => {
    if (mode !== 'form' && !busy) {
      focusStateTarget();
    }
  }, [mode, busy, retryUsed, focusStateTarget]);

  // Initial focus, and explicit restoration when A2 is the focused route
  // again (Back from A5): never Android's fallback focus (ADR 0007).
  useFocusEffect(
    useCallback(() => {
      const first = firstRouteFocus.current;
      firstRouteFocus.current = false;
      if (modeRef.current === 'form') {
        if (first && initialTarget.current === 'send') {
          requestHostFocus(sendRef.current);
        } else {
          numberRef.current?.focus();
        }
      } else {
        focusStateTarget();
      }
    }, [focusStateTarget]),
  );

  /** Show the form (if needed) and focus the number or «Получить код». */
  const showForm = useCallback((focusOn: 'number' | 'send') => {
    if (modeRef.current !== 'form') {
      // The form mounts again; the [mode] effect focuses the target.
      formFocus.current = focusOn;
      setRetryUsed(false);
      setMode('form');
    } else if (focusOn === 'send') {
      requestHostFocus(sendRef.current);
    } else {
      numberRef.current?.focus();
    }
  }, []);

  // Back on A9/A10 returns to the form; on the form the stack pops to A1.
  useFocusEffect(
    useCallback(() => {
      if (mode === 'form') {
        return undefined;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        showForm('number');
        return true;
      });
      return () => sub.remove();
    }, [mode, showForm]),
  );

  const send = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    const phone = toE164(countryCode, number);
    if (!phone) {
      setInvalid(true);
      setFormError(null);
      numberRef.current?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setFormError(null);
    try {
      const result = await sendCode(phone);
      // Back was pressed while sending: drop the result, open nothing.
      if (!mounted.current || !isFocusedRef.current) {
        return;
      }
      // `phone` is the E.164 captured when this send started.
      authFlow.setChallenge({ phone, ...result });
      if (modeRef.current !== 'form') {
        // Back from A5 must land on the A2 form, not on A10; the form must
        // not take focus from A5 now (restored by useFocusEffect on return).
        formFocus.current = 'none';
        setRetryUsed(false);
        setMode('form');
      }
      onCodeSent();
    } catch (error) {
      if (!mounted.current) {
        return;
      }
      const kind: AuthErrorKind = isAuthError(error) ? error.kind : 'Unknown';
      if (kind === 'TooManyAttempts') {
        setMode('tooManyAttempts');
      } else if (kind === 'VerificationRequired') {
        setMode('verificationRequired');
      } else {
        setFormError(kind === 'Network' ? 'Network' : 'Unknown');
        showForm('send');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }, [countryCode, number, onCodeSent, sendCode, showForm]);

  const retry = useCallback(() => {
    if (retryUsed || inFlight.current) {
      return;
    }
    setRetryUsed(true);
    send();
  }, [retryUsed, send]);

  const onSubmit = useCallback(
    (field: 'country' | 'number') => {
      if (toE164(countryCode, number)) {
        requestHostFocus(sendRef.current);
      } else if (field === 'country') {
        countryRef.current?.focus();
      } else {
        numberRef.current?.focus();
      }
    },
    [countryCode, number],
  );

  const onCountryChange = (text: string) => {
    setCountryCode(normalizeCountryCodeInput(text));
    setInvalid(false);
    setFormError(null);
  };
  const onNumberChange = (text: string) => {
    setNumber(text);
    setInvalid(false);
    setFormError(null);
  };

  if (mode === 'tooManyAttempts') {
    return (
      <Screen testID="auth/phone/too-many-attempts">
        <View style={[styles.columnSlot, styles.stateSlot]}>
          <View style={styles.column}>
            <Text variant="title-l" accessibilityRole="header">
              {t('error.TooManyAttempts')}
            </Text>
            <Text variant="body" color="text-secondary" style={styles.body}>
              {t('auth.phone.tooManyBody')}
            </Text>
            <View style={styles.buttons}>
              <Button
                ref={changeNumberRef}
                testID={PHONE_CHANGE_NUMBER_ID}
                label={t('auth.phone.changeNumber')}
                onPress={() => showForm('number')}
                hasTVPreferredFocus
              />
              <Button
                testID={PHONE_TO_WELCOME_ID}
                kind="secondary"
                label={t('auth.phone.toWelcome')}
                onPress={onExit}
              />
            </View>
          </View>
        </View>
      </Screen>
    );
  }

  if (mode === 'verificationRequired') {
    return (
      <Screen testID="auth/phone/verification-required">
        <View style={[styles.columnSlot, styles.stateSlot]}>
          <View style={styles.column}>
            <Text variant="title-l" accessibilityRole="header">
              {t('error.VerificationRequired')}
            </Text>
            <Text variant="body" color="text-secondary" style={styles.body}>
              {t('auth.phone.verificationBody')}
            </Text>
            <Text variant="body" color="text-secondary" style={styles.body2}>
              {t('auth.phone.verificationBody2')}
            </Text>
            <View style={styles.buttons}>
              {retryUsed && !busy ? null : (
                <Button
                  ref={retryRef}
                  testID={PHONE_RETRY_ID}
                  label={t('auth.phone.retry')}
                  onPress={retry}
                  busy={busy}
                  hasTVPreferredFocus
                />
              )}
              <Button
                ref={changeNumberRef}
                testID={PHONE_CHANGE_NUMBER_ID}
                kind="secondary"
                label={t('auth.phone.changeNumber')}
                onPress={() => showForm('number')}
                hasTVPreferredFocus={retryUsed && !busy}
              />
            </View>
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen testID="auth/phone">
      <View style={styles.columnSlot}>
        <View style={styles.column}>
          <Text variant="body-s" color="text-tertiary" style={styles.step}>
            {t('auth.phone.step')}
          </Text>
          <Text variant="title-l" accessibilityRole="header">
            {t('auth.phone.title')}
          </Text>
          <Text variant="body" color="text-secondary" style={styles.body}>
            {t('auth.phone.body')}
          </Text>
          <TVFocusGuideView
            destinations={fieldsDestinations}
            style={styles.fields}
          >
            <TextField
              ref={countryRef}
              testID={PHONE_COUNTRY_ID}
              label={t('auth.phone.countryLabel')}
              value={countryCode}
              onChangeText={onCountryChange}
              onSubmitEditing={() => onSubmit('country')}
              keyboardType="phone-pad"
              maxLength={4}
              style={styles.country}
            />
            <TextField
              ref={numberRef}
              testID={PHONE_NUMBER_ID}
              label={t('auth.phone.numberLabel')}
              value={number}
              onChangeText={onNumberChange}
              onSubmitEditing={() => onSubmit('number')}
              placeholder={t('auth.phone.numberPlaceholder')}
              error={invalid ? t('error.InvalidPhone') : null}
              keyboardType="phone-pad"
              maxLength={20}
              style={styles.number}
            />
          </TVFocusGuideView>
          {formError ? (
            <Text
              testID="auth/phone/error"
              variant="body-s"
              color="error-text"
              style={styles.formError}
            >
              {t(`error.${formError}`)}
            </Text>
          ) : null}
          <TVFocusGuideView
            destinations={buttonsDestinations}
            style={styles.buttons}
          >
            <Button
              ref={sendRef}
              testID={PHONE_SEND_ID}
              label={t('auth.phone.send')}
              onPress={send}
              busy={busy}
            />
            <Button
              testID={PHONE_BACK_ID}
              kind="secondary"
              label={t('auth.phone.back')}
              onPress={onExit}
            />
          </TVFocusGuideView>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  columnSlot: {
    position: 'absolute',
    top: COLUMN_TOP,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  stateSlot: {
    top: STATE_TOP,
  },
  column: {
    width: COLUMN_WIDTH,
  },
  step: {
    marginBottom: spacing['4'],
  },
  body: {
    marginTop: spacing['6'],
  },
  body2: {
    marginTop: spacing['4'],
  },
  fields: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing['6'],
    marginTop: spacing['10'],
  },
  country: {
    width: COUNTRY_WIDTH,
  },
  number: {
    flex: 1,
  },
  formError: {
    marginTop: spacing['6'],
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['6'],
    marginTop: spacing['10'],
  },
});
