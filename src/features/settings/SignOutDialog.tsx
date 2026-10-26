import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { t } from '../../shared/i18n';
import { Dialog } from '../../shared/ui';

/** Focus ids (docs/focus-map.md §1.5). */
export const SIGN_OUT_CANCEL_ID = 'dialog/signout/cancel';
export const SIGN_OUT_CONFIRM_ID = 'dialog/signout/confirm';

export type SignOutDialogProps = {
  /** «Отмена»: close the dialog, focus back on the row (the modal host). */
  onCancel: () => void;
  /**
   * «Выйти»: the sign-out. Resolves when it is done (the app then leaves
   * the screen); rejects when it failed and nothing was signed out.
   */
  onConfirm: () => Promise<void>;
};

/**
 * K4 sign-out confirmation (docs/focus-map.md §5), shown in the modal host.
 * «Отмена» has the initial focus; ← → move between the actions.
 *
 * «Выйти» is busy while the sign-out runs; a repeated OK is ignored (an
 * in-flight ref, not React state); Back and «Отмена» are ignored meanwhile, so the dialog
 * cannot vanish under a running sign-out. On failure the dialog stays with
 * the error line, focus stays on «Выйти» (it never left), and OK retries.
 */
export function SignOutDialog({ onCancel, onConfirm }: SignOutDialogProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Registered after the modal host's listener, so it runs first.
  useEffect(() => {
    if (!busy) {
      return undefined;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [busy]);

  const confirm = useCallback(() => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    onConfirm().then(
      () => {
        inFlight.current = false;
        if (mounted.current) {
          setBusy(false);
        }
      },
      () => {
        inFlight.current = false;
        if (mounted.current) {
          setBusy(false);
          setFailed(true);
        }
      },
    );
  }, [onConfirm]);

  return (
    <Dialog
      testID="dialog/signout"
      title={t('dialog.signOut.title')}
      body={t('dialog.signOut.body')}
      error={failed ? t('dialog.signOut.error') : undefined}
      primary={{
        testID: SIGN_OUT_CANCEL_ID,
        label: t('dialog.signOut.cancel'),
        // Ignored while the sign-out runs, like Back.
        onPress: () => {
          if (!inFlight.current) {
            onCancel();
          }
        },
      }}
      secondary={{
        testID: SIGN_OUT_CONFIRM_ID,
        label: t('dialog.signOut.confirm'),
        onPress: confirm,
        busy,
      }}
    />
  );
}
