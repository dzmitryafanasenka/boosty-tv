import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { BackHandler, StyleSheet, TVFocusGuideView, View } from 'react-native';
import type { HostView } from '../ui/FocusableSurface';
import { requestHostFocus } from '../ui/requestHostFocus';
import { colors } from '../ui/tokens';

/**
 * The one modal host (AD-13, docs/focus-map.md §1.3–1.4), rendered above the
 * navigation stack. `open(content, initiatorRef)` shows `content` on
 * `colors.scrim` inside a `TVFocusGuideView` that traps all four sides.
 * Focus is moved into the trap on open, so the D-pad cannot reach the
 * background (the same mechanism as the per-screen trap, ADR 0007). The
 * background is hidden from accessibility while it is open. It is not made
 * natively unfocusable: `TVFocusGuideView focusable` maps to the
 * `tvFocusable` prop, and turning it back on (or removing it) makes the
 * background container itself focusable (or keeps descendants blocked).
 * Back closes it first (its BackHandler listener is the newest), then focus
 * goes back to the initiator explicitly. The host's listener is added in
 * `open()` itself, before the content mounts, so a listener the content
 * adds on mount (e.g. the sign-out dialog swallowing Back while busy,
 * Story 2.7) is newer and sees Back first; it returns false to let the
 * host close. Focus goes back to the initiator before the unmount, right after it
 * and two frames later (the only request that stuck on the device).
 */

export type ModalApi = {
  open(content: ReactNode, initiatorRef?: RefObject<HostView | null>): void;
  /**
   * Close the overlay. Focus returns to the initiator, unless
   * `restoreFocus: false` (the screen behind is going away, e.g. the
   * session expired and the stack is reset to A11, Story 2.6).
   */
  close(options?: { restoreFocus?: boolean }): void;
  isOpen(): boolean;
};

const ModalContext = createContext<ModalApi | null>(null);

type Modal = { content: ReactNode; initiator?: RefObject<HostView | null> };

export function ModalHostProvider({ children }: { children?: ReactNode }) {
  const [modal, setModal] = useState<Modal | null>(null);
  const modalRef = useRef<Modal | null>(null);
  modalRef.current = modal;
  const containerRef = useRef<HostView>(null);
  /** The initiator to focus after the overlay is gone. */
  const returnTo = useRef<RefObject<HostView | null> | undefined>(undefined);
  /** The host's Back listener while an overlay is open. */
  const backSub = useRef<{ remove(): void } | null>(null);
  const closeRef = useRef<ModalApi['close']>(() => {});

  const open = useCallback<ModalApi['open']>((content, initiatorRef) => {
    returnTo.current = undefined;
    const next = { content, initiator: initiatorRef };
    // Set now, so close() / isOpen() right after open() see it before the commit.
    modalRef.current = next;
    // Registered now, before the content's mount effects (see above).
    if (!backSub.current) {
      backSub.current = BackHandler.addEventListener('hardwareBackPress', () => {
        closeRef.current();
        return true;
      });
    }
    setModal(next);
  }, []);

  const close = useCallback<ModalApi['close']>(options => {
    if (!modalRef.current) {
      return;
    }
    const initiator =
      options?.restoreFocus === false ? undefined : modalRef.current.initiator;
    returnTo.current = initiator;
    modalRef.current = null;
    backSub.current?.remove();
    backSub.current = null;
    // Focus the initiator before the dialog is unmounted, so the removed
    // dialog does not hold focus; the effect below repeats the request after
    // the unmount (device: Story 2.4).
    if (initiator) {
      requestHostFocus(initiator.current);
    }
    setModal(null);
  }, []);

  closeRef.current = close;

  const isOpen = useCallback(() => modalRef.current !== null, []);

  // Unmounted while open: drop the listener.
  useEffect(
    () => () => {
      backSub.current?.remove();
      backSub.current = null;
    },
    [],
  );

  const visible = modal !== null;

  useEffect(() => {
    if (visible) {
      // Move focus into the dialog: the container hands it to its first
      // focusable descendant (or the content's preferred focus).
      requestHostFocus(containerRef.current);
      return undefined;
    }
    const initiator = returnTo.current;
    returnTo.current = undefined;
    if (initiator) {
      requestHostFocus(initiator.current);
      // Device (Story 2.4): a request sent in the same commit as the unmount
      // was lost (nothing focused afterwards). Two frames later the overlay
      // is gone natively and the request sticks. Skipped if a new dialog
      // opened meanwhile.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!modalRef.current) {
            requestHostFocus(initiator.current);
          }
        }),
      );
    }
    return undefined;
  }, [visible, close]);

  const api = useMemo<ModalApi>(
    () => ({ open, close, isOpen }),
    [open, close, isOpen],
  );

  return (
    <ModalContext.Provider value={api}>
      <View
        testID="modal/background"
        style={styles.fill}
        importantForAccessibility={visible ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {modal ? (
        <View testID="modal/scrim" style={styles.scrim}>
          <TVFocusGuideView
            testID="modal/trap"
            trapFocusUp
            trapFocusDown
            trapFocusLeft
            trapFocusRight
            style={styles.trap}
          >
            <View testID="modal/content" ref={containerRef} collapsable={false}>
              {modal.content}
            </View>
          </TVFocusGuideView>
        </View>
      ) : null}
    </ModalContext.Provider>
  );
}

/** The modal host API. Throws outside `ModalHostProvider`. */
export function useModal(): ModalApi {
  const api = useContext(ModalContext);
  if (!api) {
    throw new Error('useModal must be used inside ModalHostProvider');
  }
  return api;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
