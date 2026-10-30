import { useEffect, useRef, useState, type RefObject } from 'react';
import { useLatestRef, type ListRestoration } from '../../shared/focus';
import type { HostView } from '../../shared/ui';

export type AuthorActionRowFocusOptions = {
  /** The route's focus events (`AuthorFocusInfo.onFocusChange`). */
  focus: { onFocusChange(listener: (focusId: string) => void): () => void };
  cardPrefix: string;
  fieldId: string;
  chipId: string;
  resetId: string;
  /** Story 7.1: the LiveCard's focus id. */
  liveId: string;
  /** Story 7.1: the LiveCard is shown (between the row and the grid). */
  liveShown: boolean;
  /** The field holds the page's own focus; any other focus clears it. */
  fieldAuto: RefObject<boolean>;
  /** The shown cards' focus ids. */
  ids: string[];
  /** The grid is shown. */
  gridShown: boolean;
  restoration: Pick<ListRestoration, 'viewOf'>;
};

export type AuthorActionRowFocus = {
  /** Focus is on the action row (the field, the chip or «Сбросить»). */
  rowFocus: boolean;
  /**
   * ↓ into the grid: the card the grid guide points to; null: none. Set
   * while focus is on the row with no LiveCard shown, or on the LiveCard
   * (Story 7.1: with the card shown, ↓ from the row reaches the card, the
   * nearest stop below, through its own guide).
   */
  downTarget: HostView | null;
};

/**
 * The action row's focus (Story 5.7). The chip and «Сбросить» are focusable
 * only while the row has focus (Поиск's device lesson, Story 5.6: ↑ from a
 * later column would otherwise find them first and the row guide never
 * redirects to the field). ↓ from the row: the last focused card, else its
 * neighbour by index, else the first (the guide around the grid). Story
 * 7.1: with the LiveCard shown, the same grid target applies to ↓ from the
 * card instead, and ↓ from the row lands on the card.
 */
export function useAuthorActionRowFocus({
  focus,
  cardPrefix,
  fieldId,
  chipId,
  resetId,
  liveId,
  liveShown,
  fieldAuto,
  ids,
  gridShown,
  restoration,
}: AuthorActionRowFocusOptions): AuthorActionRowFocus {
  const idsRef = useLatestRef(ids);
  const lastCard = useRef<{ id: string; index: number } | null>(null);
  const [rowFocus, setRowFocus] = useState(false);
  const [liveFocus, setLiveFocus] = useState(false);
  useEffect(
    () =>
      focus.onFocusChange(focusId => {
        if (focusId.startsWith(cardPrefix)) {
          lastCard.current = { id: focusId, index: Math.max(idsRef.current.indexOf(focusId), 0) };
        }
        if (focusId !== fieldId) {
          fieldAuto.current = false;
        }
        setRowFocus(focusId === fieldId || focusId === chipId || focusId === resetId);
        setLiveFocus(focusId === liveId);
      }),
    [focus, cardPrefix, fieldId, chipId, resetId, liveId, idsRef, fieldAuto],
  );
  const [downTarget, setDownTarget] = useState<HostView | null>(null);
  const aboveGrid = liveShown ? liveFocus : rowFocus;
  useEffect(() => {
    if (!aboveGrid || !gridShown) {
      setDownTarget(null);
      return;
    }
    const pick = () => {
      const remembered = lastCard.current;
      const id =
        remembered === null
          ? ids[0]
          : ids.includes(remembered.id)
            ? remembered.id
            : ids[Math.min(remembered.index, ids.length - 1)];
      return (
        (id !== undefined ? restoration.viewOf(id) : null) ??
        (ids[0] !== undefined ? restoration.viewOf(ids[0]) : null)
      );
    };
    setDownTarget(pick());
    // A row that mounts after the list's layout pass: look again next frame.
    const frame = requestAnimationFrame(() => setDownTarget(pick()));
    return () => cancelAnimationFrame(frame);
  }, [aboveGrid, gridShown, ids, restoration]);
  return { rowFocus, downTarget };
}
