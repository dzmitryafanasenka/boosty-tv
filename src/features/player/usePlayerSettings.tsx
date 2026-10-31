import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useLatestRef, useModal } from '../../shared/focus';
import type { HostView } from '../../shared/ui';
import { qualityOf, qualityOptions, type MediaSourceState, type QualityKey } from './mediaResolver';
import type { Phase } from './playerPhase';
import { PlayerSettingsSheet, createSettingsSheetModel, type SettingsSheetData } from './PlayerSettingsSheet';
import type { PlaybackSpeed } from './speedPreference';

type ReadySource = Extract<MediaSourceState, { kind: 'ready' }>;

export type SheetOpen = {
  /** For rendering (the overlay's auto-hide). */
  sheetOpen: boolean;
  /** For event handlers and effects (read synchronously). */
  sheetOpenRef: RefObject<boolean>;
  setSheetOpen: (open: boolean) => void;
};

/**
 * The settings sheet is open (Story 4.3): the ref for event handlers, the
 * state for rendering. Declared before the overlay timers, which read it;
 * `usePlayerSettings` owns every change.
 */
export function useSheetOpen(): SheetOpen {
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetOpenRef = useRef(false);
  return { sheetOpen, sheetOpenRef, setSheetOpen };
}

export type PlayerSettings = {
  /** «Настройки», Menu or Info: the settings sheet (the overlay shows and stays). */
  openSettings: () => void;
  /** Close the sheet (no-op when closed); `restoreFocus` → «Настройки». */
  closeSheet: (restoreFocus: boolean) => void;
  /** «Настройки» (the sheet's initiator). */
  settingsView: RefObject<HostView | null>;
};

/**
 * The player's settings sheet (Story 4.3, `PlayerSettingsSheet`, the one
 * modal host, a right side sheet). A quality pick goes to `pickQuality`
 * and a speed pick (Story 8.1) to `pickSpeed` (the session), then the sheet
 * closes with focus on «Настройки» and the overlay shows. The sheet exists only while playing: leaving that phase
 * closes it without restoring focus, before the focus effect picks its
 * target (`PlayerScreen` calls this hook before `usePlayerFocus`).
 */
export function usePlayerSettings({
  sheet,
  ready,
  autoHeight,
  phase,
  settingsShown,
  showOverlay,
  pickQuality,
  speed,
  pickSpeed,
}: {
  sheet: SheetOpen;
  ready: ReadySource | null;
  autoHeight: number | null;
  phase: Phase;
  /** The overlay shows «Настройки» (`PlaybackMode.settingsShown`). */
  settingsShown: boolean;
  showOverlay: () => void;
  pickQuality: (key: QualityKey) => void;
  /** Story 8.1: the current speed for the «Скорость» row; null: no row (`PlaybackMode.speedShown` off). */
  speed: PlaybackSpeed | null;
  pickSpeed: (speed: PlaybackSpeed) => void;
}): PlayerSettings {
  const { sheetOpenRef, setSheetOpen } = sheet;
  const playing = phase === 'playing';
  const modal = useModal();
  const settingsView = useRef<HostView | null>(null);
  /** The sheet's data (the modal host renders the sheet element once; this updates under it). */
  const [sheetModel] = useState(() =>
    createSettingsSheetModel({ options: [], selected: 'auto', autoHeight: null, speed: null }),
  );
  const sheetData = useMemo<SettingsSheetData | null>(
    () =>
      ready === null
        ? null
        : { options: qualityOptions(ready.sources), selected: qualityOf(ready.source), autoHeight, speed },
    [ready, autoHeight, speed],
  );
  useEffect(() => {
    if (sheetData !== null) {
      sheetModel.set(sheetData);
    }
  }, [sheetData, sheetModel]);
  const closeSheet = useCallback(
    (restoreFocus: boolean) => {
      if (!sheetOpenRef.current) {
        return;
      }
      sheetOpenRef.current = false;
      setSheetOpen(false);
      modal.close({ restoreFocus });
    },
    [modal, sheetOpenRef, setSheetOpen],
  );
  // The sheet exists only while playing (an engine error, a retry): closed
  // without restoring focus, before the focus effect picks the target.
  useEffect(() => {
    if (!playing) {
      closeSheet(false);
    }
  }, [playing, closeSheet]);
  // Unmount (any exit path) with the sheet open: close it.
  const closeSheetRef = useLatestRef(closeSheet);
  useEffect(() => () => closeSheetRef.current(false), [closeSheetRef]);

  const latest = useLatestRef({ phase, settingsShown });
  const onPickRef = useLatestRef((key: QualityKey) => {
    pickQuality(key);
    closeSheet(true);
    showOverlay();
  });
  const onPickSpeedRef = useLatestRef((next: PlaybackSpeed) => {
    pickSpeed(next);
    closeSheet(true);
    showOverlay();
  });

  const openSettings = useCallback(() => {
    if (latest.current.phase !== 'playing' || sheetOpenRef.current || !latest.current.settingsShown) {
      return;
    }
    sheetOpenRef.current = true;
    setSheetOpen(true);
    showOverlay();
    modal.open(
      <PlayerSettingsSheet
        model={sheetModel}
        onPick={key => onPickRef.current(key)}
        onPickSpeed={next => onPickSpeedRef.current(next)}
        onClosed={() => {
          sheetOpenRef.current = false;
          setSheetOpen(false);
        }}
      />,
      settingsView,
      { placement: 'end' },
    );
  }, [latest, sheetOpenRef, setSheetOpen, showOverlay, modal, sheetModel, onPickRef, onPickSpeedRef]);

  return { openSettings, closeSheet, settingsView };
}
