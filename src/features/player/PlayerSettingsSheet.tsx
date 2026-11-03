import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { focusSoon } from '../../shared/focus';
import { t, tf } from '../../shared/i18n';
import { SettingRow, SideSheet, spacing, type HostView } from '../../shared/ui';
import type { QualityKey } from './mediaResolver';
import { PLAYBACK_SPEEDS, speedLabel, type PlaybackSpeed } from './speedPreference';
import { sleepChoiceLabel, sleepChoices, type SleepChoice } from './useSleepTimer';

/** Focus ids (docs/focus-map.md §1.5, §4 G). */
export const PLAYER_SHEET_ID = 'player/sheet';
export const PLAYER_SHEET_QUALITY_ID = 'player/sheet/quality';
export const qualityRowId = (key: QualityKey) => `${PLAYER_SHEET_QUALITY_ID}/${key}`;
export const PLAYER_SHEET_SPEED_ID = 'player/sheet/speed';
export const speedRowId = (speed: PlaybackSpeed) => `${PLAYER_SHEET_SPEED_ID}/${speed}`;
export const PLAYER_SHEET_SLEEP_ID = 'player/sheet/sleep';
export const sleepRowId = (choice: SleepChoice) => `${PLAYER_SHEET_SLEEP_ID}/${choice}`;

/** What the sheet shows; the player updates it while the sheet is open. */
export type SettingsSheetData = {
  /**
   * Story 14.2: the «Качество» row (a recording always; live only with a
   * real quality choice, Story 7.2).
   */
  quality: boolean;
  /** `qualityOptions` of the playing video. */
  options: readonly QualityKey[];
  /** The playing source's row. */
  selected: QualityKey;
  /** The height the engine reports for the adaptive source; null before a report or for a progressive source. */
  autoHeight: number | null;
  /** Story 8.1: the current speed; null: no «Скорость» row (live, or the phase flag off). */
  speed: PlaybackSpeed | null;
  /** Story 14.2: the sleep timer's current choice (the «Таймер сна» row is always there). */
  sleep: SleepChoice;
  /** Story 14.2: «До конца видео» is offered (a recording with a known duration). */
  sleepEnd: boolean;
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
        next.quality === value.quality &&
        next.selected === value.selected &&
        next.autoHeight === value.autoHeight &&
        next.speed === value.speed &&
        next.sleep === value.sleep &&
        next.sleepEnd === value.sleepEnd &&
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
  /** Story 14.2: a sleep timer row was picked (the player starts or cancels it and closes the sheet). */
  onPickSleep: (choice: SleepChoice) => void;
  /** The sheet left the modal host (any close path: Back, a pick, the player going away). */
  onClosed: () => void;
};

type SheetRow = 'quality' | 'speed' | 'sleep';

/**
 * G Settings sheet (Story 4.3, docs/focus-map.md §4 G): a 340 dp right side
 * sheet in the one modal host (AD-13), which traps focus and closes it on
 * Back (focus → «Настройки», the initiator). Rows «Качество · <current>»
 * (live: only with a real choice), for recordings (Story 8.1) «Скорость ·
 * <current>», and (Story 14.2) «Таймер сна · <current>»; OK opens that
 * row's submenu (radio rows, initial focus on the selected one). Back in a
 * submenu returns to the sheet with focus on the row it came from (this
 * sheet's own Back listener, newer than the host's). No subtitles or audio
 * tracks.
 */
export function PlayerSettingsSheet({ model, onPick, onPickSpeed, onPickSleep, onClosed }: PlayerSettingsSheetProps) {
  const data = useSyncExternalStore(model.subscribe, model.get);
  const [level, setLevel] = useState<'sheet' | SheetRow>('sheet');
  /** The sheet row focused on the sheet level: the submenu Back came from (null: the first row). */
  const [sheetRow, setSheetRow] = useState<SheetRow | null>(null);
  const shownRows: Record<SheetRow, boolean> = {
    quality: data.quality,
    speed: data.speed !== null,
    sleep: true,
  };
  // A row went away while its submenu was open (review): show the sheet
  // with focus on its first row, never another submenu.
  const shown = level !== 'sheet' && !shownRows[level] ? 'sheet' : level;
  const levelRef = useRef(shown);
  levelRef.current = shown;
  const rowViews = {
    quality: useRef<HostView | null>(null),
    speed: useRef<HostView | null>(null),
    sleep: useRef<HostView | null>(null),
  };
  const selectedView = useRef<HostView | null>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => () => onClosedRef.current(), []);

  const levelGone = level !== 'sheet' && !shownRows[level];
  useEffect(() => {
    if (levelGone) {
      setSheetRow(null);
      setLevel('sheet');
    }
  }, [levelGone]);

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

  // Each level's initial focus: on the sheet its first row (or the row a
  // submenu's Back came from), the selected row in a submenu. Repeated two
  // frames later (the modal host's device lesson: a request in the same
  // commit as an unmount can be lost).
  const firstRow: SheetRow = data.quality ? 'quality' : data.speed !== null ? 'speed' : 'sleep';
  const focusRow: SheetRow = sheetRow !== null && shownRows[sheetRow] ? sheetRow : firstRow;
  const rowViewsRef = useRef(rowViews);
  rowViewsRef.current = rowViews;
  useEffect(() => {
    const view = shown !== 'sheet' ? selectedView : rowViewsRef.current[focusRow];
    return focusSoon(() => view.current);
  }, [shown, focusRow]);

  if (shown === 'sheet') {
    return (
      <SideSheet testID={PLAYER_SHEET_ID} variant="player" title={t('player.settings')}>
        {data.quality ? (
          <SettingRow
            ref={rowViews.quality}
            testID={PLAYER_SHEET_QUALITY_ID}
            kind="nav"
            label={t('player.quality.title')}
            value={qualityLabel(data.selected, data.selected === 'auto' ? data.autoHeight : null)}
            hasTVPreferredFocus={focusRow === 'quality'}
            onPress={() => setLevel('quality')}
          />
        ) : null}
        {data.speed !== null ? (
          <SettingRow
            ref={rowViews.speed}
            testID={PLAYER_SHEET_SPEED_ID}
            kind="nav"
            label={t('player.speed.title')}
            value={speedLabel(data.speed)}
            hasTVPreferredFocus={focusRow === 'speed'}
            onPress={() => setLevel('speed')}
          />
        ) : null}
        <SettingRow
          ref={rowViews.sleep}
          testID={PLAYER_SHEET_SLEEP_ID}
          kind="nav"
          label={t('player.sleep.title')}
          value={sleepChoiceLabel(data.sleep)}
          hasTVPreferredFocus={focusRow === 'sleep'}
          onPress={() => setLevel('sleep')}
        />
      </SideSheet>
    );
  }
  if (shown === 'sleep') {
    const current = data.sleep;
    // The current choice stays listed even if «До конца видео» stopped being offered.
    const choices = sleepChoices(data.sleepEnd || current === 'end');
    return (
      <SideSheet testID={`${PLAYER_SHEET_SLEEP_ID}/menu`} variant="player" title={t('player.sleep.title')}>
        <View accessibilityRole="radiogroup" style={styles.rows}>
          {choices.map(choice => {
            const selected = choice === current;
            return (
              <SettingRow
                key={String(choice)}
                ref={selected ? selectedView : undefined}
                testID={sleepRowId(choice)}
                kind="radio"
                selected={selected}
                label={sleepChoiceLabel(choice)}
                hasTVPreferredFocus={selected}
                onPress={() => onPickSleep(choice)}
              />
            );
          })}
        </View>
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
