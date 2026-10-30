import { useCallback, useRef, useState, type RefObject } from 'react';
import { mayTakeScreenFocus, useLatestRef, useZoneItem, type ModalApi } from '../../shared/focus';
import { requestHostFocus, useNotMovedLatch, type HostView, type NotMovedLatch } from '../../shared/ui';
import { AUTHOR_STATE_ACTION_ID } from './authorIds';

/** What the route tells the Author page about focus (it owns the sidebar and zones). */
export type AuthorFocusInfo = {
  /** The Author route is the focused route; a covered or closing one never takes focus. */
  isActive(): boolean;
  /** The last focused element on the route (sidebar or content id); null: none yet. */
  current(): string | null;
  /** The sidebar's current item (the origin section, `author/nav/subs`). */
  sectionItemId: string;
  /** Focus the sidebar's current item. */
  focusSidebar(): void;
  /** Focus the content zone's remembered element; false when it has none. */
  focusZoneTarget(): boolean;
  /**
   * Listen to the route's focus events (the same ids as `current()`, while
   * the route is active); returns the unsubscribe.
   */
  onFocusChange(listener: (focusId: string) => void): () => void;
};

export type AuthorField = {
  /** The field's host view as state (the row guide's destination). */
  fieldView: HostView | null;
  fieldViewRef: RefObject<HostView | null>;
  fieldHostRef: (view: HostView | null) => void;
  onFieldFocus: () => void;
  focusField: () => void;
  /**
   * The field holds the page's own focus (content lost: the nearest action
   * above), not one the user chose: the first post may still take it when
   * posts arrive (as from the sidebar item). Cleared by any other focus.
   */
  fieldAuto: RefObject<boolean>;
};

/** The «Поиск в блоге» field: a content zone item (Back, ← → zones, the route's tracking). */
export function useAuthorField(fieldId: string): AuthorField {
  const fieldZone = useZoneItem(fieldId);
  const [fieldView, setFieldView] = useState<HostView | null>(null);
  const fieldViewRef = useRef<HostView | null>(null);
  const fieldHostRef = useCallback(
    (view: HostView | null) => {
      fieldViewRef.current = view;
      setFieldView(view);
      fieldZone.ref?.(view);
    },
    [fieldZone],
  );
  const focusField = useCallback(() => requestHostFocus(fieldViewRef.current), []);
  const fieldAuto = useRef(false);
  return { fieldView, fieldViewRef, fieldHostRef, onFieldFocus: fieldZone.onFocus, focusField, fieldAuto };
}

export type AuthorAutoFocusOptions = {
  focus: AuthorFocusInfo;
  modal: ModalApi;
  field: AuthorField;
  /** The action row is shown (its field is the nearest action above the grid). */
  rowShown: boolean;
  cardPrefix: string;
  retryId: string;
  fieldId: string;
  chipId: string;
  resetId: string;
};

export type AuthorAutoFocus = {
  /** The latest `focus` (read by callbacks and effects). */
  focusRef: RefObject<AuthorFocusInfo>;
  latch: NotMovedLatch;
  /** The StateView action: its zone item, its view and its ref. */
  stateAction: ReturnType<typeof useZoneItem>;
  stateActionView: RefObject<HostView | null>;
  stateActionRef: (view: HostView | null) => void;
  /** The page's own sidebar focus (recorded as automatic). */
  autoFocusSidebar: () => void;
  /** The page's own StateView action focus (recorded as automatic). */
  autoFocusAction: () => void;
  /** The nearest action above the grid (the restoration's last fallback). */
  focusAbove: () => void;
  /** Content focus is gone (nothing focusable left there): the field, else the sidebar. */
  focusAfterLoss: () => void;
  /** A pending card focus may land (the restoration's gate). */
  canFocus: () => boolean;
  /** The user has not moved focus away from where the page may take it. */
  mayTakeFocus: () => boolean;
};

/**
 * The Author page's own focus moves and their gates (docs/focus-map.md §4
 * D): every element the page focuses by itself is recorded as automatic in
 * the "not moved" latch (reopen focus, owner decision 2026-10-27).
 */
export function useAuthorAutoFocus({
  focus,
  modal,
  field,
  rowShown,
  cardPrefix,
  retryId,
  fieldId,
  chipId,
  resetId,
}: AuthorAutoFocusOptions): AuthorAutoFocus {
  const { fieldViewRef, focusField, fieldAuto } = field;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const stateAction = useZoneItem(AUTHOR_STATE_ACTION_ID);
  const stateActionView = useRef<HostView | null>(null);
  const stateActionRef = useCallback(
    (view: HostView | null) => {
      stateActionView.current = view;
      stateAction.ref?.(view);
    },
    [stateAction],
  );

  // "The user has not moved since the page opened" (reopen focus, owner
  // decision 2026-10-27; shared with Главная, `useNotMovedLatch`): armed
  // from the start; every element the page focuses by itself (the sidebar
  // item, the StateView action, a card, the field) is recorded as automatic.
  const latch = useNotMovedLatch(focus.onFocusChange, { armed: true });
  const autoFocusSidebar = useCallback(() => {
    latch.auto(focusRef.current.sectionItemId);
    focusRef.current.focusSidebar();
  }, [latch]);
  const autoFocusAction = useCallback(() => {
    latch.auto(AUTHOR_STATE_ACTION_ID);
    requestHostFocus(stateActionView.current);
  }, [latch]);
  /** The page's own field focus (recorded as automatic). */
  const autoFocusField = useCallback(() => {
    latch.auto(fieldId);
    fieldAuto.current = true;
    focusField();
  }, [latch, fieldId, fieldAuto, focusField]);
  // The nearest action above the grid: the field (Story 5.7) when the action
  // row is shown, else the StateView action when shown, else the sidebar's
  // current item.
  const rowShownRef = useLatestRef(rowShown);
  const focusAbove = useCallback(() => {
    if (rowShownRef.current && fieldViewRef.current) {
      autoFocusField();
    } else if (stateActionView.current) {
      autoFocusAction();
    } else {
      autoFocusSidebar();
    }
  }, [autoFocusAction, autoFocusSidebar, autoFocusField, rowShownRef, fieldViewRef]);
  const focusAfterLoss = useCallback(() => {
    if (rowShownRef.current && fieldViewRef.current) {
      autoFocusField();
    } else {
      autoFocusSidebar();
    }
  }, [autoFocusField, autoFocusSidebar, rowShownRef, fieldViewRef]);
  // A pending card focus lands only while the route is active, no modal is
  // open and focus is still where the page may take it: none yet, the
  // sidebar's current item, a card, the StateView action, the load-more
  // «Повторить» or the action row (Story 5.7: the row is content).
  const canFocus = useCallback(() => {
    const info = focusRef.current;
    if (!info.isActive() || modal.isOpen()) {
      return false;
    }
    const current = info.current();
    return (
      current === null ||
      current === info.sectionItemId ||
      current === AUTHOR_STATE_ACTION_ID ||
      current === retryId ||
      current === fieldId ||
      current === chipId ||
      current === resetId ||
      current.startsWith(cardPrefix)
    );
  }, [cardPrefix, retryId, fieldId, chipId, resetId, modal]);
  const mayTakeFocus = useCallback(() => {
    if (modal.isOpen()) {
      return false;
    }
    const info = focusRef.current;
    return (
      mayTakeScreenFocus(info, AUTHOR_STATE_ACTION_ID) ||
      (fieldAuto.current && info.isActive() && info.current() === fieldId)
    );
  }, [modal, fieldId, fieldAuto]);

  return {
    focusRef,
    latch,
    stateAction,
    stateActionView,
    stateActionRef,
    autoFocusSidebar,
    autoFocusAction,
    focusAbove,
    focusAfterLoss,
    canFocus,
    mayTakeFocus,
  };
}
