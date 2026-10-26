import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Screen } from '../../shared/focus';
import { t } from '../../shared/i18n';
import {
  Button,
  Text,
  requestHostFocus,
  spacing,
  type HostView,
} from '../../shared/ui';
import { DEFAULT_COUNTRY_CODE, splitE164 } from './phone';
import { authFlow } from './authFlow';

/** Focus id (docs/focus-map.md §1.5) of the only focusable element. */
export const EXPIRED_RELOGIN_ID = 'auth/expired/relogin';

const COLUMN_WIDTH = 440;
/** The A11 mock places the column at 280 in the 1920 × 1080 frame. */
const COLUMN_TOP = 140;

export type ExpiredScreenProps = {
  /**
   * The stored phone (E.164) for the prefill, or null (SessionManager's
   * status-gated accessor). Never rejects.
   */
  loadPhone: () => Promise<string | null>;
  /** The A2 draft is set (prefilled or empty): open A2. */
  onRelogin: () => void;
};

/**
 * A11 Session expired (docs/focus-map.md §2, Story 2.6). One focusable
 * element, «Войти снова», with initial focus; whenever A11 is the focused
 * route again (Back from A2) focus is put back on it explicitly. Back is not
 * intercepted: A11 is the stack root, so Android exits the app.
 *
 * OK reads the stored phone, splits it into the A2 fields (ITU-T calling
 * code list) and puts it into `authFlow`'s in-memory draft, never into
 * route params, logs or storage; an unknown code or no phone leaves the
 * draft empty. The button is busy while the phone is read; a second OK is
 * ignored.
 */
export function ExpiredScreen({ loadPhone, onRelogin }: ExpiredScreenProps) {
  const reloginRef = useRef<HostView>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      requestHostFocus(reloginRef.current);
    }, []),
  );

  const relogin = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const phone = await loadPhone();
      if (!mounted.current) {
        return;
      }
      const split = phone ? splitE164(phone) : null;
      authFlow.reset();
      authFlow.setDraft(split ?? { countryCode: DEFAULT_COUNTRY_CODE, number: '' });
      onRelogin();
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }, [loadPhone, onRelogin]);

  return (
    <Screen testID="auth/expired">
      <View style={styles.columnSlot}>
        <View style={styles.column}>
          <Text variant="title-l" accessibilityRole="header">
            {t('auth.expired.title')}
          </Text>
          <Text variant="body" color="text-secondary" style={styles.body}>
            {t('auth.expired.body')}
          </Text>
          <Button
            ref={reloginRef}
            testID={EXPIRED_RELOGIN_ID}
            label={t('auth.expired.relogin')}
            onPress={relogin}
            busy={busy}
            hasTVPreferredFocus
            style={styles.button}
          />
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
  body: {
    marginTop: spacing['6'],
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: spacing['10'],
  },
});
