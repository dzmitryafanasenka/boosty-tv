import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { focusSoon } from '../../shared/focus';
import { t, tf } from '../../shared/i18n';
import { SettingRow, SideSheet, spacing, type HostView } from '../../shared/ui';
import type { QualityKey } from './mediaResolver';
import { PLAYBACK_SPEEDS, speedLabel, type PlaybackSpeed } from './speedPreference';

/** Focus ids (docs/focus-map.md §1.5, §4 G). */
export const PLAYER_SHEET_ID = 'player/sheet';
export const PLAYER_SHEET_QUALITY_ID = 'player/sheet/quality';
export const qualityRowId = (key: QualityKey) => `${PLAYER_SHEET_QUALITY_ID}/${key}`;
export const PLAYER_SHEET_SPEED_ID = 'player/sheet/speed';
export const speedRowId = (speed: PlaybackSpeed) => `${PLAYER_SHEET_SPEED_ID}/${speed}`;

/** What the sheet shows; the player updates it while the sheet is open. */
export type SettingsSheetData = {
  /** `qualityOptions` of the playing video. */
  options: readonly QualityKey[];
  /** The playing source's row. */
  selected: QualityKey;
  /** The height the engine reports for the adaptive source; null before a report or for a progressive source. */
  autoHeight: number | null;
  /** Story 8.1: the current speed; null: no «Скорость» row (live, or the phase flag off). */
  speed: PlaybackSpeed | null;
};

/** A tiny observable value: the modal host renders the sheet element once, the data changes under it. */
export type SettingsSheetModel = {
  get(): SettingsSheetData;
  set(next: SettingsSheetData): void;
  subscribe(listener: () => void): () => void;
};

export function createSettingsSheetModel(initial: SettingsSheetData): SettingsSheetModel {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (
        next.selected === value.selected &&
        next.autoHeight === value.autoHeight &&
        next.speed === value.speed &&
        next.options.length === value.options.length &&
        next.options.every((key, i) => key === value.options[i])
      ) {
        return;
      }
      value = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** «Авто», «Авто · 1080p» (only with a reported height) or «720p». */
export function qualityLabel(key: QualityKey, autoHeight: number | null): string {
  if (key === 'auto') {
    return autoHeight !== null && autoHeight > 0
      ? tf('player.quality.autoAt', { height: String(autoHeight) })
      : t('player.quality.auto');
  }
  return tf('player.quality.height', { height: String(key) });
}

export type PlayerSettingsSheetProps = {
  model: SettingsSheetModel;
  /** A quality row was picked (the player reloads, stores the preference and closes the sheet). */
  onPick: (key: QualityKey) => void;
  /** Story 8.1: a speed row was picked (the player applies and stores it and closes the sheet). */
  onPickSpeed: (speed: PlaybackSpeed) => void;
  /** The sheet left the modal host (any close path: Back, a pick, the player going away). */
  onClosed: () => void;
};

/**
 * G Settings sheet (Story 4.3, docs/focus-map.md §4 G): a 340 dp right side
 * sheet in the one modal host (AD-13), which traps focus and closes it on
 * Back (focus → «Настройки», the initiator). Rows «Качество · <current>»
 * and, for recordings (Story 8.1), «Скорость · <current>» under it; OK opens
 * that row's submenu (radio rows, initial focus on the selected one). Back
 * in a submenu returns to the sheet with focus on the row it came from (this
 * sheet's own Back listener, newer than the host's). No subtitles or audio
 * tracks.
 */
export function PlayerSettingsSheet({ model, onPick, onPickSpeed, onClosed }: PlayerSettingsSheetProps) {
  const data = useSyncExternalStore(model.subscribe, model.get);
  const [level, setLevel] = useState<'sheet' | 'quality' | 'speed'>('sheet');
  /** The sheet row focused on the sheet level: the submenu Back came from. */
  const [sheetRow, setSheetRow] = useState<'quality' | 'speed'>('quality');
  const speedRow = data.speed !== null;
  // The speed row went away while its submenu was open (review): show the
  // sheet with focus on its first row, never the quality submenu.
  const shown = level === 'speed' && !speedRow ? 'sheet' : level;
  const levelRef = useRef(shown);
  levelRef.current = shown;
  const qualityView = useRef<HostView | null>(null);
  const speedView = useRef<HostView | null>(null);
  const selectedView = useRef<HostView | null>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => () => onClosedRef.current(), []);

  useEffect(() => {
    if (level === 'speed' && !speedRow) {
      setSheetRow('quality');
      setLevel('sheet');
    }
  }, [level, speedRow]);

  // The submenu is the deepest Back layer: Back there returns to the sheet.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const from = levelRef.current;
      if (from !== 'sheet') {
        setSheetRow(from);
        setLevel('sheet');
        return true;
      }
      // The modal host closes the sheet.
      return false;
    });
    return () => sub.remove();
  }, []);

  // Each level's initial focus: on the sheet «Качество» (or the row a
  // submenu's Back came from), the selected row in a submenu. Repeated two
  // frames later (the modal host's device lesson: a request in the same
  // commit as an unmount can be lost).
  const backToSpeed = sheetRow === 'speed' && speedRow;
  useEffect(() => {
    const view = shown !== 'sheet' ? selectedView : backToSpeed ? speedView : qualityView;
    return focusSoon(() => view.current);
  }, [shown, backToSpeed]);

  if (shown === 'sheet') {
    return (
      <SideSheet testID={PLAYER_SHEET_ID} variant="player" title={t('player.settings')}>
        <SettingRow
          ref={qualityView}
          testID={PLAYER_SHEET_QUALITY_ID}
          kind="nav"
          label={t('player.quality.title')}
          value={qualityLabel(data.selected, data.selected === 'auto' ? data.autoHeight : null)}
          hasTVPreferredFocus={!backToSpeed}
          onPress={() => setLevel('quality')}
        />
        {data.speed !== null ? (
          <SettingRow
            ref={speedView}
            testID={PLAYER_SHEET_SPEED_ID}
            kind="nav"
            label={t('player.speed.title')}
            value={speedLabel(data.speed)}
            hasTVPreferredFocus={backToSpeed}
            onPress={() => setLevel('speed')}
          />
        ) : null}
      </SideSheet>
    );
  }
  if (shown === 'speed' && data.speed !== null) {
    const current = data.speed;
    return (
      <SideSheet testID={`${PLAYER_SHEET_SPEED_ID}/menu`} variant="player" title={t('player.speed.title')}>
        <View accessibilityRole="radiogroup" style={styles.rows}>
          {PLAYBACK_SPEEDS.map(speed => {
            const selected = speed === current;
            return (
              <SettingRow
                key={String(speed)}
                ref={selected ? selectedView : undefined}
                testID={speedRowId(speed)}
                kind="radio"
                selected={selected}
                label={speedLabel(speed)}
                hasTVPreferredFocus={selected}
                onPress={() => onPickSpeed(speed)}
              />
            );
          })}
        </View>
      </SideSheet>
    );
  }
  return (
    <QualityMenu
      testID={`${PLAYER_SHEET_QUALITY_ID}/menu`}
      rowId={qualityRowId}
      options={data.options}
      selected={data.selected}
      autoHeight={data.autoHeight}
      selectedRef={selectedView}
      onPick={onPick}
    />
  );
}

export type QualityMenuProps = {
  testID: string;
  /** Each row's focus id. */
  rowId: (key: QualityKey) => string;
  /** `qualityOptions` of the video. */
  options: readonly QualityKey[];
  /** The checked row (initial focus). */
  selected: QualityKey;
  /** «Авто · 1080p» on the selected «Авто» row; null: «Авто». */
  autoHeight: number | null;
  /** The selected row's host view (the caller moves focus to it). */
  selectedRef: RefObject<HostView | null>;
  onPick: (key: QualityKey) => void;
};

/**
 * The «Качество» radio list (Story 4.3), a `player` SideSheet: the player
 * settings sheet's quality submenu and, since Story 8.2, the system-player
 * hand-off list (`ExternalHandoff`). Initial focus on the selected row.
 */
export function QualityMenu({ testID, rowId, options, selected, autoHeight, selectedRef, onPick }: QualityMenuProps) {
  return (
    <SideSheet testID={testID} variant="player" title={t('player.quality.title')}>
      <View accessibilityRole="radiogroup" style={styles.rows}>
        {options.map(key => {
          const isSelected = key === selected;
          return (
            <SettingRow
              key={String(key)}
              ref={isSelected ? selectedRef : undefined}
              testID={rowId(key)}
              kind="radio"
              selected={isSelected}
              label={qualityLabel(key, key === 'auto' && isSelected ? autoHeight : null)}
              hasTVPreferredFocus={isSelected}
              onPress={() => onPick(key)}
            />
          );
        })}
      </View>
    </SideSheet>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: spacing['3'],
  },
});
