import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, TVFocusGuideView, View } from 'react-native';
import {
  authApiClient,
  isAuthError,
  type AuthErrorKind,
  type SessionManager,
  type SignInResult,
} from '../../shared/api';
import { Screen } from '../../shared/focus';
import { t, tf } from '../../shared/i18n';
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
import { maskPhone } from './phone';

/** Focus ids (docs/focus-map.md §1.5). */
export const CODE_FIELD_ID = 'auth/code/field';
export const CODE_SUBMIT_ID = 'auth/code/submit';
export const CODE_RESEND_ID = 'auth/code/resend';
export const CODE_CHANGE_NUMBER_ID = 'auth/code/change-number';
export const CODE_NEW_CODE_ID = 'auth/code/new-code';

/** Client resend cooldown (api-contract §2.2: the reference's 60 s). */
export const RESEND_COOLDOWN_MS = 60_000;

export type CodeScreenProps = {
  /** «Изменить номер»: back to A2 with the number kept. */
  onChangeNumber: () => void;
  /**
   * The session is saved: replace the stack with the signed-in screen.
   * Also called when the sign-in finishes after A5 was left (the session
   * exists either way). `accountChanged`: the E1 id differs from the
   * previous account (Story 2.6), so the previous account's UI state goes.
   */
  onSignedIn: (result: SignInResult) => void;
  /**
   * The active session's `signIn` (`src/app/session.ts`: the real one, or
   * the demo's), so a demo sign-in never touches the keychain (Story 2.8).
   */
  signIn: SessionManager['signIn'];
};

/** A5–A7 (form) or A8 (expired). */
type Mode = 'form' | 'expired';
/** Inline errors under the field (A7, A8) or below it (the rest). */
type CodeError = Extract<
  AuthErrorKind,
  'WrongCode' | 'CodeExpired' | 'TooManyAttempts' | 'Network' | 'Unknown'
>;

const COLUMN_WIDTH = 440;
const COLUMN_TOP = 100;

/** `m:ss` for the resend sub-label. */
function formatCountdown(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function errorKind(error: unknown): AuthErrorKind {
  return isAuthError(error) ? error.kind : 'Unknown';
}

/**
 * A5–A8 Code (docs/focus-map.md §2).
 *
 * Focus: the code field initially and whenever A5 is the focused route
 * again; ↓ enters the button row on «Войти» (focus guide destinations),
 * ← → between buttons, ↑ back to the field. «Выслать повторно» is disabled
 * (not focusable) during the 60 s countdown and shows «через 0:42».
 * IME «Готово» with a non-empty code submits. Busy keeps focus.
 *
 * - «Войти» → `signIn` (the active session: confirm → E1 → SecureStore). One
 *   request per attempt (in-flight ref); never retried.
 * - A7 (`WrongCode`): inline error, the field cleared and focused.
 * - Resend (`transport=gate`): every attempt, success or failure, restarts
 *   the 60 s countdown; focus to the field. 429 → inline `TooManyAttempts`.
 * - A8 layout: «Выслать новый код» focused, «Войти» hidden. Shown for
 *   `CodeExpired` (nothing maps to it yet: no verified shape) and, with
 *   `error.Unknown`, when confirm succeeded but E1 or the save failed (the
 *   challenge is spent and cleared). After a resend attempt from A8 the
 *   button is locked by the countdown and focus goes to the field.
 * - Back (stack pop) or «Изменить номер» → A2 with the number kept. The
 *   challenge lives in `authFlow` and is cleared when A5 is left.
 */
export function CodeScreen({ onChangeNumber, onSignedIn, signIn }: CodeScreenProps) {
  const [pending, setPending] = useState(() => authFlow.getChallenge());
  const [countryCode] = useState(() => authFlow.getDraft().countryCode);
  const [code, setCode] = useState('');
  const [error, setError] = useState<CodeError | null>(null);
  const [mode, setMode] = useState<Mode>('form');
  const [busy, setBusy] = useState<'submit' | 'resend' | null>(null);
  const [deadline, setDeadline] = useState(() => Date.now() + RESEND_COOLDOWN_MS);
  const [now, setNow] = useState(() => Date.now());
  /**
   * The current countdown follows a resend attempt (not the first send).
   * Only then does it also lock A8's «Выслать новый код».
   */
  const [afterResend, setAfterResend] = useState(false);
  // The phone of this attempt; kept after a spent challenge is cleared.
  const phoneRef = useRef(pending?.phone ?? null);

  // Blocks a second confirm or resend; React state would let a held key
  // fire twice. Confirm and resend never run together.
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const codeRef = useRef<TextFieldHandle>(null);
  const submitRef = useRef<HostView>(null);
  const newCodeRef = useRef<HostView>(null);
  const [fieldHost, setFieldHost] = useState<HostView | null>(null);
  const [submitHost, setSubmitHost] = useState<HostView | null>(null);
  const fieldDestinations = useMemo(
    () => (fieldHost ? [fieldHost] : undefined),
    [fieldHost],
  );
  const buttonDestinations = useMemo(
    () => (submitHost ? [submitHost] : undefined),
    [submitHost],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      authFlow.clearChallenge();
    };
  }, []);

  const remainingS = Math.ceil((deadline - now) / 1000);
  const countingDown = remainingS > 0;
  const newCodeLocked = countingDown && afterResend;
  const newCodeLockedRef = useRef(newCodeLocked);
  newCodeLockedRef.current = newCodeLocked;

  // One tick per second while the countdown runs.
  useEffect(() => {
    if (!countingDown) {
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [countingDown, deadline]);

  const modeRef = useRef(mode);
  modeRef.current = mode;

  const focusTarget = useCallback(() => {
    if (modeRef.current === 'expired' && !newCodeLockedRef.current) {
      requestHostFocus(newCodeRef.current);
    } else {
      codeRef.current?.focus();
    }
  }, []);

  // Focus guide routes and the focus target whenever the mode changes.
  useEffect(() => {
    setFieldHost(codeRef.current?.host() ?? null);
    setSubmitHost(mode === 'form' ? submitRef.current : newCodeRef.current);
    focusTarget();
  }, [mode, focusTarget]);

  // Explicit restoration when A5 is the focused route again: never
  // Android's fallback focus (ADR 0007).
  useFocusEffect(
    useCallback(() => {
      focusTarget();
    }, [focusTarget]),
  );

  const submit = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    const smsCode = code.replace(/\s/g, '');
    if (smsCode.length === 0) {
      codeRef.current?.focus();
      return;
    }
    const challenge = authFlow.getChallenge();
    if (!challenge) {
      setError('Unknown');
      return;
    }
    inFlight.current = true;
    setBusy('submit');
    setError(null);
    try {
      const result = await signIn({
        phone: challenge.phone,
        challenge: challenge.challenge,
        smsCode,
      });
      authFlow.clearChallenge();
      onSignedIn(result);
    } catch (failure) {
      if (!mounted.current) {
        return;
      }
      const kind = errorKind(failure);
      if (isAuthError(failure) && failure.challengeSpent) {
        // Confirm succeeded but E1 or the save failed: the challenge is
        // consumed. A8 layout: only a new code can help.
        authFlow.clearChallenge();
        setError('Unknown');
        setMode('expired');
      } else if (kind === 'WrongCode') {
        setCode('');
        setError('WrongCode');
        codeRef.current?.focus();
      } else if (kind === 'CodeExpired') {
        setError('CodeExpired');
        setMode('expired');
      } else {
        setError(kind === 'Network' ? 'Network' : 'Unknown');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setBusy(null);
      }
    }
  }, [code, onSignedIn, signIn]);

  const resend = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    const phone = phoneRef.current;
    if (!phone) {
      setError('Unknown');
      return;
    }
    inFlight.current = true;
    setBusy('resend');
    setError(null);
    try {
      const result = await authApiClient.resendCode(phone);
      if (!mounted.current) {
        return;
      }
      const next = { phone, ...result };
      authFlow.setChallenge(next);
      setPending(next);
      setCode('');
      if (modeRef.current === 'expired') {
        // The [mode] effect focuses the field once the form is back.
        setMode('form');
      } else {
        codeRef.current?.focus();
      }
    } catch (failure) {
      if (!mounted.current) {
        return;
      }
      const kind = errorKind(failure);
      setError(
        kind === 'TooManyAttempts' || kind === 'Network' ? kind : 'Unknown',
      );
      // Also on A8: «Выслать новый код» is locked by the countdown below.
      codeRef.current?.focus();
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setBusy(null);
        // Every attempt, success or failure, restarts the cooldown, so a
        // rate-limited endpoint cannot be hammered.
        const at = Date.now();
        setNow(at);
        setDeadline(at + RESEND_COOLDOWN_MS);
        setAfterResend(true);
      }
    }
  }, []);

  const onCodeChange = (text: string) => {
    setCode(text);
    if (error === 'WrongCode' || error === 'Unknown' || error === 'Network') {
      setError(null);
    }
  };

  const onSubmitEditing = () => {
    if (code.trim().length > 0) {
      submit();
    } else {
      codeRef.current?.focus();
    }
  };

  const masked = pending ? maskPhone(pending.phone, countryCode) : '';
  const body = !masked
    ? t('auth.code.body')
    : pending?.sentTransport === 'sms'
      ? tf('auth.code.sentBySmsTo', { phone: masked })
      : `${tf('auth.code.sentTo', { phone: masked })} ${t('auth.code.channels')}`;

  const fieldError =
    error === 'WrongCode' || error === 'CodeExpired' ? t(`error.${error}`) : null;
  const lineError =
    error && !fieldError ? t(`error.${error}`) : null;

  const resendIn = (
    <Text
      testID="auth/code/resend-in"
      variant="meta"
      color="text-tertiary"
      style={styles.sub}
    >
      {tf('auth.code.resendIn', { time: formatCountdown(remainingS) })}
    </Text>
  );

  return (
    <Screen testID="auth/code">
      <View style={styles.columnSlot}>
        <View style={styles.column}>
          <Text variant="body-s" color="text-tertiary" style={styles.step}>
            {t('auth.code.step')}
          </Text>
          <Text variant="title-l" accessibilityRole="header">
            {t('auth.code.title')}
          </Text>
          <Text
            testID="auth/code/body"
            variant="body"
            color="text-secondary"
            style={styles.body}
          >
            {body}
          </Text>
          <TVFocusGuideView destinations={fieldDestinations} style={styles.field}>
            <TextField
              ref={codeRef}
              testID={CODE_FIELD_ID}
              label={t('auth.code.fieldLabel')}
              value={code}
              onChangeText={onCodeChange}
              onSubmitEditing={onSubmitEditing}
              placeholder={t('auth.code.fieldPlaceholder')}
              error={fieldError}
              keyboardType="number-pad"
              maxLength={12}
            />
          </TVFocusGuideView>
          {lineError ? (
            <Text
              testID="auth/code/error"
              accessibilityLiveRegion="polite"
              variant="body-s"
              color="error-text"
              style={styles.lineError}
            >
              {lineError}
            </Text>
          ) : null}
          {mode === 'form' && !countingDown ? (
            <Text
              testID="auth/code/resend-hint"
              accessibilityLiveRegion="polite"
              variant="body-s"
              color="text-secondary"
              style={styles.hint}
            >
              {t('auth.code.resendHint')}
            </Text>
          ) : null}
          <TVFocusGuideView
            destinations={buttonDestinations}
            style={styles.buttons}
          >
            {mode === 'form' ? (
              <>
                <Button
                  ref={submitRef}
                  testID={CODE_SUBMIT_ID}
                  label={t('auth.code.submit')}
                  onPress={submit}
                  busy={busy === 'submit'}
                />
                <View>
                  <Button
                    testID={CODE_RESEND_ID}
                    kind="secondary"
                    label={t('auth.code.resend')}
                    onPress={resend}
                    busy={busy === 'resend'}
                    disabled={countingDown}
                  />
                  {countingDown ? resendIn : null}
                </View>
              </>
            ) : (
              <View>
                <Button
                  ref={newCodeRef}
                  testID={CODE_NEW_CODE_ID}
                  label={t('auth.code.newCode')}
                  onPress={resend}
                  busy={busy === 'resend'}
                  disabled={newCodeLocked}
                />
                {newCodeLocked ? resendIn : null}
              </View>
            )}
            <Button
              testID={CODE_CHANGE_NUMBER_ID}
              kind="secondary"
              label={t('auth.code.changeNumber')}
              onPress={onChangeNumber}
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
  column: {
    width: COLUMN_WIDTH,
  },
  step: {
    marginBottom: spacing['4'],
  },
  body: {
    marginTop: spacing['6'],
  },
  field: {
    marginTop: spacing['10'],
  },
  lineError: {
    marginTop: spacing['6'],
  },
  hint: {
    marginTop: spacing['6'],
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing['6'],
    marginTop: spacing['10'],
  },
  sub: {
    marginTop: spacing['2'],
    textAlign: 'center',
  },
});
