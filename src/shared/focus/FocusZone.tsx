import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { TVFocusGuideView, type StyleProp, type ViewStyle } from 'react-native';
import { requestHostFocus } from '../ui/requestHostFocus';
import type { HostView } from '../ui/FocusableSurface';
import { focusRestoration } from './focusRestoration';

/**
 * A focus zone (docs/focus-map.md §1.2): a `TVFocusGuideView` whose
 * destination is the zone's remembered element, so a D-pad move into the
 * zone from outside (→ from the sidebar, ← from content) lands on it. Inside
 * the zone focus moves natively. `trapFocusUp/Down` keep ↑ ↓ inside the zone
 * (no wrap, no escape to a neighbor zone through the edge).
 *
 * The remembered element comes from FocusRestoration under `routeKey` +
 * `sectionId`; items report focus through `useZoneItem`. Without a remembered
 * (or still mounted) element the destination is `initialFocusId`, then the
 * first registered item. A zone without items has no destination, so focus
 * cannot enter it and stays where it is.
 *
 * Zones are for small static item sets: they remember no scroll offset or
 * index, so there is no neighbor fallback; virtualized lists use
 * `useFocusRestoration`.
 */

export type FocusZoneHandle = {
  /** Focus the zone's target element. False when the zone has none. */
  focusTarget(): boolean;
};

type ZoneApi = {
  itemRef(focusId: string): (view: HostView | null) => void;
  onItemFocus(focusId: string): void;
};

const ZoneContext = createContext<ZoneApi | null>(null);

export type FocusZoneProps = {
  routeKey: string;
  sectionId: string;
  /** The zone's initial element when nothing is remembered. */
  initialFocusId?: string;
  /** Focus the target once the zone mounts (a section opened with OK). */
  focusOnMount?: boolean;
  /** Called when one of the zone's items receives focus. */
  onItemFocus?: (focusId: string) => void;
  /**
   * False while the zone's screen is covered: focus events are then ignored
   * (Android fallback focus must not overwrite the remembered element).
   */
  isActive?: () => boolean;
  trapVertical?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children?: ReactNode;
  ref?: Ref<FocusZoneHandle>;
};

export function FocusZone({
  routeKey,
  sectionId,
  initialFocusId,
  focusOnMount = false,
  onItemFocus,
  isActive,
  trapVertical = true,
  style,
  testID,
  children,
  ref,
}: FocusZoneProps) {
  const views = useRef(new Map<string, HostView>());
  const order = useRef<string[]>([]);
  const refCallbacks = useRef(new Map<string, (view: HostView | null) => void>());
  const [destination, setDestination] = useState<HostView | null>(null);
  /** The destination last set (read without a render). */
  const destinationRef = useRef<HostView | null>(null);
  const onItemFocusRef = useRef(onItemFocus);
  onItemFocusRef.current = onItemFocus;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const targetView = useCallback((): HostView | null => {
    const remembered = focusRestoration.peek(routeKey, sectionId)?.focusId;
    const candidates = [remembered, initialFocusId, ...order.current];
    for (const id of candidates) {
      const view = id === undefined ? undefined : views.current.get(id);
      if (view) {
        return view;
      }
    }
    return null;
  }, [routeKey, sectionId, initialFocusId]);

  const refreshDestination = useCallback(() => {
    const next = targetView();
    if (next !== destinationRef.current) {
      destinationRef.current = next;
      setDestination(next);
    }
  }, [targetView]);

  /**
   * Whether an item (un)mount can change the target: the target is the first
   * mounted of [remembered, initial, ...registration order], so only these
   * cases matter. A long virtualized list mounts and unmounts rows while it
   * scrolls; other items skip the lookup and the guide update.
   */
  const affectsTarget = useCallback(
    (focusId: string, view: HostView | null) => {
      if (view === null) {
        return views.current.get(focusId) === destinationRef.current;
      }
      return (
        destinationRef.current === null ||
        focusId === focusRestoration.peek(routeKey, sectionId)?.focusId ||
        focusId === initialFocusId
      );
    },
    [routeKey, sectionId, initialFocusId],
  );

  const api = useMemo<ZoneApi>(
    () => ({
      itemRef(focusId) {
        let callback = refCallbacks.current.get(focusId);
        if (!callback) {
          callback = (view: HostView | null) => {
            const affects = affectsTarget(focusId, view);
            if (view) {
              views.current.set(focusId, view);
              if (!order.current.includes(focusId)) {
                order.current.push(focusId);
              }
            } else {
              views.current.delete(focusId);
              order.current = order.current.filter(id => id !== focusId);
            }
            if (affects) {
              refreshDestination();
            }
          };
          refCallbacks.current.set(focusId, callback);
        }
        return callback;
      },
      onItemFocus(focusId) {
        if (isActiveRef.current && !isActiveRef.current()) {
          return;
        }
        focusRestoration.remember(routeKey, sectionId, focusId, 0);
        refreshDestination();
        onItemFocusRef.current?.(focusId);
      },
    }),
    [routeKey, sectionId, refreshDestination, affectsTarget],
  );

  const focusTarget = useCallback(() => {
    const view = targetView();
    if (!view) {
      return false;
    }
    requestHostFocus(view);
    return true;
  }, [targetView]);

  useImperativeHandle(ref, () => ({ focusTarget }), [focusTarget]);

  // Item refs attach before this effect runs, so the target is mounted.
  const focusOnMountRef = useRef(focusOnMount);
  useEffect(() => {
    if (focusOnMountRef.current) {
      focusTarget();
    }
  }, [focusTarget]);

  // Always an array: an empty one clears a stale native destination.
  const destinations = useMemo(
    () => (destination ? [destination] : []),
    [destination],
  );

  return (
    <ZoneContext.Provider value={api}>
      <TVFocusGuideView
        testID={testID}
        style={style}
        destinations={destinations}
        trapFocusUp={trapVertical}
        trapFocusDown={trapVertical}
      >
        {children}
      </TVFocusGuideView>
    </ZoneContext.Provider>
  );
}

/**
 * Wire a focusable element into the enclosing FocusZone: pass `ref` and
 * `onFocus` to the element. Outside a zone both are no-ops.
 */
export function useZoneItem(focusId: string): {
  ref: ((view: HostView | null) => void) | undefined;
  onFocus: () => void;
} {
  const zone = useContext(ZoneContext);
  return useMemo(
    () => ({
      ref: zone?.itemRef(focusId),
      onFocus: () => zone?.onItemFocus(focusId),
    }),
    [zone, focusId],
  );
}
