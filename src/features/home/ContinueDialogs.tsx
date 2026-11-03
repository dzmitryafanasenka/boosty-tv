import { t } from '../../shared/i18n';
import { Dialog } from '../../shared/ui';

/** Focus ids (docs/focus-map.md §1.5). */
export const CONTINUE_REMOVE_CANCEL_ID = 'dialog/continue-remove/cancel';
export const CONTINUE_REMOVE_CONFIRM_ID = 'dialog/continue-remove/confirm';
export const CONTINUE_CLEAR_CANCEL_ID = 'dialog/continue-clear/cancel';
export const CONTINUE_CLEAR_CONFIRM_ID = 'dialog/continue-clear/confirm';

export type ContinueDialogProps = {
  /** «Отмена» (Back closes through the modal host the same way). */
  onCancel: () => void;
  /** The local removal; runs at once (no request, nothing to wait for). */
  onConfirm: () => void;
};

/**
 * Story 12.1: a long OK on a «Продолжить просмотр» card. «Отмена» has the
 * initial focus (the shared Dialog's primary action); «Убрать из списка»
 * drops the video from the local history only.
 */
export function ContinueRemoveDialog({ onCancel, onConfirm }: ContinueDialogProps) {
  return (
    <Dialog
      testID="dialog/continue-remove"
      title={t('dialog.continueRemove.title')}
      body={t('dialog.continueRemove.body')}
      primary={{ testID: CONTINUE_REMOVE_CANCEL_ID, label: t('dialog.continueRemove.cancel'), onPress: onCancel }}
      secondary={{ testID: CONTINUE_REMOVE_CONFIRM_ID, label: t('dialog.continueRemove.confirm'), onPress: onConfirm }}
    />
  );
}

/** Story 12.1: OK on «Очистить всё». «Отмена» has the initial focus. */
export function ContinueClearDialog({ onCancel, onConfirm }: ContinueDialogProps) {
  return (
    <Dialog
      testID="dialog/continue-clear"
      title={t('dialog.continueClear.title')}
      body={t('dialog.continueClear.body')}
      primary={{ testID: CONTINUE_CLEAR_CANCEL_ID, label: t('dialog.continueClear.cancel'), onPress: onCancel }}
      secondary={{ testID: CONTINUE_CLEAR_CONFIRM_ID, label: t('dialog.continueClear.confirm'), onPress: onConfirm }}
    />
  );
}
