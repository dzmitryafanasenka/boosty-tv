import { useCallback, useRef } from 'react';
import type { HostView } from '../ui/FocusableSurface';
import { useZoneItem } from './FocusZone';

/** Reports a stop's host view by focus id (null when it unmounts). */
export type StopViewHandler = (id: string, view: HostView | null) => void;
/** Reports that the stop with this focus id took native focus. */
export type StopFocusHandler = (id: string) => void;

/**
 * One focus stop of a screen column (Пост's rows, blocks, chips and poll
 * stops): a content zone item whose host view is reported to the screen by
 * focus id (initial focus, the column guide, the refetch fallback) and kept
 * in `viewRef` (e.g. the modal host returns focus to it). `handleFocus`
 * tells the zone, then the screen. A changed `id` gives a new `ref`
 * callback, so the view re-registers under the new id (the old one is
 * dropped first).
 */
export function useColumnStop(id: string, onView: StopViewHandler, onFocus: StopFocusHandler) {
  const zone = useZoneItem(id);
  const zoneRef = zone.ref;
  const zoneOnFocus = zone.onFocus;
  const viewRef = useRef<HostView | null>(null);
  const ref = useCallback(
    (view: HostView | null) => {
      viewRef.current = view;
      zoneRef?.(view);
      onView(id, view);
    },
    [zoneRef, onView, id],
  );
  const handleFocus = useCallback(() => {
    zoneOnFocus();
    onFocus(id);
  }, [zoneOnFocus, onFocus, id]);
  return { ref, viewRef, handleFocus };
}
