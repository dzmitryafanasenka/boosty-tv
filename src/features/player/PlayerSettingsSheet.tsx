import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { t, tf } from '../../shared/i18n';
import { SettingRow, SideSheet, requestHostFocus, spacing, type HostView } from '../../shared/ui';
import type { QualityKey } from './mediaResolver';

/** Focus ids (docs/focus-map.md §1.5, §4 G). */
export const PLAYER_SHEET_ID = 'player/sheet';
export const PLAYER_SHEET_QUALITY_ID = 'player/sheet/quality';
export const qualityRowId = (key: QualityKey) => `${PLAYER_SHEET_QUALITY_ID}/${key}`;

/** What the sheet shows; the player updates it while the sheet is open. */
export type SettingsSheetData = {
  /** `qualityOptions` of the playing video. */
  options: readonly QualityKey[];
  /** The playing source's row. */
  selected: QualityKey;
  /** The height the engine reports for the adaptive source; null before a report or for a progressive source. */
  autoHeight: number | null;
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
  /** The sheet left the modal host (any close path: Back, a pick, the player going away). */
  onClosed: () => void;
};

/**
 * G Settings sheet (Story 4.3, docs/focus-map.md §4 G): a 340 dp right side
 * sheet in the one modal host (AD-13), which traps focus and closes it on
 * Back (focus → «Настройки», the initiator). One row «Качество · <current>»;
 * OK opens the quality submenu (radio rows, initial focus on the selected
 * one). Back in the submenu returns to the sheet with focus on «Качество»
 * (this sheet's own Back listener, newer than the host's). No speed row
 * (Epic 8), no subtitles or audio tracks.
 */
export function PlayerSettingsSheet({ model, onPick, onClosed }: PlayerSettingsSheetProps) {
  const data = useSyncExternalStore(model.subscribe, model.get);
  const [level, setLevel] = useState<'sheet' | 'quality'>('sheet');
  const levelRef = useRef(level);
  levelRef.current = level;
  const qualityView = useRef<HostView | null>(null);
  const selectedView = useRef<HostView | null>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => () => onClosedRef.current(), []);

  // The submenu is the deepest Back layer: Back there returns to the sheet.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (levelRef.current === 'quality') {
        setLevel('sheet');
        return true;
      }
      // The modal host closes the sheet.
      return false;
    });
    return () => sub.remove();
  }, []);

  // Each level's initial focus: «Качество» on the sheet, the selected row in
  // the submenu. Repeated two frames later (the modal host's device lesson:
  // a request in the same commit as an unmount can be lost).
  useEffect(() => {
    const view = level === 'sheet' ? qualityView : selectedView;
    requestHostFocus(view.current);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => requestHostFocus(view.current));
    });
    return () => cancelAnimationFrame(frame);
  }, [level]);

  if (level === 'sheet') {
    return (
      <SideSheet testID={PLAYER_SHEET_ID} variant="player" title={t('player.settings')}>
        <SettingRow
          ref={qualityView}
          testID={PLAYER_SHEET_QUALITY_ID}
          kind="nav"
          label={t('player.quality.title')}
          value={qualityLabel(data.selected, data.selected === 'auto' ? data.autoHeight : null)}
          hasTVPreferredFocus
          onPress={() => setLevel('quality')}
        />
      </SideSheet>
    );
  }
  return (
    <SideSheet testID={`${PLAYER_SHEET_QUALITY_ID}/menu`} variant="player" title={t('player.quality.title')}>
      <View accessibilityRole="radiogroup" style={styles.rows}>
        {data.options.map(key => {
          const selected = key === data.selected;
          return (
            <SettingRow
              key={String(key)}
              ref={selected ? selectedView : undefined}
              testID={qualityRowId(key)}
              kind="radio"
              selected={selected}
              label={qualityLabel(key, key === 'auto' && selected ? data.autoHeight : null)}
              hasTVPreferredFocus={selected}
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
