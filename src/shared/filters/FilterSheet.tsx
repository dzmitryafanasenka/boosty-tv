import { useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import type { HttpClient } from '../api';
import { t } from '../i18n';
import { SettingRow, SideSheet, Text, spacing, type HostView } from '../ui';
import {
  PERIOD_PRESET_DAYS,
  accessValuesFor,
  addDays,
  calendarDayOf,
  formatDayKey,
  isDefaultFilter,
  parseDayKey,
  type AccessFilter,
  type CalendarDay,
  type FilterScope,
  type Period,
  type PeriodPresetDays,
} from './filter';
import { filtersStore, useFilter } from './filtersStore';
import { focusSoon } from './focusSoon';
import { formatPeriod } from './periodLabel';
import { PeriodStepper } from './PeriodStepper';
import { TagList } from './TagList';

/** Focus ids (docs/focus-map.md §1.5, D8–D10). */
export const FILTERS_SHEET_ID = 'filters/sheet';
export const FILTERS_RESET_ID = 'filters/reset';
export const FILTERS_PERIOD_ID = 'filters/period';
export const PERIOD_LIST_ID = 'filters/period/list';
export const PERIOD_ALL_ID = 'filters/period/all';
export const PERIOD_CUSTOM_ID = 'filters/period/custom';
export const FILTERS_TAGS_ID = 'filters/tags';
export const filterAccessId = (access: AccessFilter) => `filters/access/${access}`;
export const periodPresetId = (days: PeriodPresetDays) => `filters/period/${days}d`;

/** The stepper's default range when no custom range is active: today − 30 → today. */
export const CUSTOM_DEFAULT_SPAN_DAYS = 30;

export type FilterSheetProps = {
  /** Whose Filter the sheet edits (Story 5.3: `feed`; 5.6 `search`; 5.7 `author:<routeKey>`). */
  scope: FilterScope;
  /** The active session's client: the tag level's E13 (Story 5.5) or E14 (Story 5.7). */
  http: HttpClient;
  /**
   * Story 5.7 (an Author scope): the blog whose tags the tag level lists
   * (E14); absent: the feed's tags (E13).
   */
  blogUrl?: string;
};

type Level = 'sheet' | 'period' | 'custom' | 'tags';

/** The list row of a period (its focus id). */
function periodRowId(period: Period): string {
  switch (period.kind) {
    case 'all':
      return PERIOD_ALL_ID;
    case 'preset':
      return periodPresetId(period.days);
    case 'custom':
      return PERIOD_CUSTOM_ID;
  }
}

/** The stepper's opening range: the active custom range, else today − 30 → today. */
function stepperRange(period: Period, today: CalendarDay): { from: CalendarDay; to: CalendarDay } {
  if (period.kind === 'custom') {
    const from = parseDayKey(period.fromDay);
    const to = parseDayKey(period.toDay);
    if (from && to) {
      return { from, to };
    }
  }
  return { from: addDays(today, -CUSTOM_DEFAULT_SPAN_DAYS), to: today };
}

/**
 * The filter SideSheet (Stories 5.3–5.5, FILTER-01/02/03, EXPERIENCE.md
 * «FilterChip → filter SideSheet»): 320 dp, opened through the one modal
 * host with `placement: 'end'` (focus trapped, ← → do nothing, Back closes
 * it and focus returns to the chip). Four levels:
 *
 * - **sheet (D8):** the «Доступ» values as radio rows (an Author scope:
 *   «Доступные мне» and «Все посты» only, Story 5.7), the «Период» row
 *   (its value: the current period), the «Теги» row (its value: the
 *   checked titles, else «Все»), then «Сбросить» while the Filter is not
 *   the default. Opens with focus on the selected access value. OK on a
 *   value applies it at once (no Apply button), focus stays; OK on
 *   «Сбросить» resets every section, the row goes and focus moves to
 *   «Доступные мне». OK on «Период» → the list; OK on «Теги» → the tags.
 * - **period (D9):** «За всё время», the three presets (radio) and «Свой
 *   период…» (nav; its value is the active custom range). Opens on the
 *   current period. A preset applies at once and returns to the sheet with
 *   focus on «Период»; «Свой период…» → the stepper.
 * - **custom (D10):** `PeriodStepper`; «Готово» applies the range and
 *   returns to the sheet on «Период».
 * - **tags (D11, Story 5.5):** `TagList` (the feed's E13 tags as check
 *   rows, its own «Сбросить», «Загрузить ещё» / «Повторить»).
 *
 * Back closes the deepest level first (this sheet's own BackHandler
 * listener, newer than the modal host's): stepper → list (on «Свой
 * период…», edits discarded), list → sheet (on «Период»), tags → sheet (on
 * «Теги»), sheet → the host closes it. It reads the Filter from
 * `filtersStore` itself: the modal host renders this element once, the
 * Filter changes under it.
 */
export function FilterSheet({ scope, http, blogUrl }: FilterSheetProps) {
  const filter = useFilter(scope);
  const showReset = !isDefaultFilter(filter);
  const [level, setLevel] = useState<Level>('sheet');
  const levelRef = useRef(level);
  levelRef.current = level;
  /** Every row's host view, by focus id. */
  const rows = useRef(new Map<string, HostView | null>());
  const rowRef = (id: string) => (view: HostView | null) => {
    rows.current.set(id, view);
  };
  /**
   * The row the current level focuses (set before the level changes): on
   * open the selected access value, on a return the row that led away.
   */
  const levelFocus = useRef(filterAccessId(filter.access));
  /** «Сбросить» was pressed: its row goes away, focus → «Доступные мне». */
  const focusAfterReset = useRef(false);
  /** Today's date for the stepper, read when it opens (never stored in the Filter). */
  const [today, setToday] = useState<CalendarDay | null>(null);

  const goTo = (next: Level, focusId: string) => {
    levelFocus.current = focusId;
    setLevel(next);
  };
  const toSheetOnPeriod = () => goTo('sheet', FILTERS_PERIOD_ID);
  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  // The deeper levels are Back layers of their own.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      switch (levelRef.current) {
        case 'custom':
          goToRef.current('period', PERIOD_CUSTOM_ID);
          return true;
        case 'period':
          goToRef.current('sheet', FILTERS_PERIOD_ID);
          return true;
        case 'tags':
          goToRef.current('sheet', FILTERS_TAGS_ID);
          return true;
        case 'sheet':
          // The modal host closes the sheet.
          return false;
      }
    });
    return () => sub.remove();
  }, []);

  // Each level's focus. The stepper and the tag list focus their own first row.
  useEffect(() => {
    if (level === 'custom' || level === 'tags') {
      return undefined;
    }
    return focusSoon(() => rows.current.get(levelFocus.current) ?? null);
  }, [level]);

  useEffect(() => {
    if (!showReset && focusAfterReset.current) {
      focusAfterReset.current = false;
      return focusSoon(() => rows.current.get(filterAccessId('allowed')) ?? null);
    }
    return undefined;
  }, [showReset]);

  const pickPeriod = (period: Period) => {
    filtersStore.getState().setPeriod(scope, period);
    toSheetOnPeriod();
  };

  if (level === 'period') {
    const currentId = periodRowId(filter.period);
    const custom = filter.period.kind === 'custom';
    return (
      <SideSheet testID={PERIOD_LIST_ID} variant="filters" title={t('filters.period.title')}>
        <View accessibilityRole="radiogroup" style={styles.rows}>
          <SettingRow
            ref={rowRef(PERIOD_ALL_ID)}
            testID={PERIOD_ALL_ID}
            kind="radio"
            selected={filter.period.kind === 'all'}
            label={t('filters.period.all')}
            hasTVPreferredFocus={levelFocus.current === PERIOD_ALL_ID}
            onPress={() => pickPeriod({ kind: 'all' })}
          />
          {PERIOD_PRESET_DAYS.map(days => {
            const id = periodPresetId(days);
            return (
              <SettingRow
                key={id}
                ref={rowRef(id)}
                testID={id}
                kind="radio"
                selected={currentId === id}
                label={t(`filters.period.preset.d${days}`)}
                hasTVPreferredFocus={levelFocus.current === id}
                onPress={() => pickPeriod({ kind: 'preset', days })}
              />
            );
          })}
          <SettingRow
            ref={rowRef(PERIOD_CUSTOM_ID)}
            testID={PERIOD_CUSTOM_ID}
            kind="nav"
            label={t('filters.period.custom')}
            value={custom ? formatPeriod(filter.period) : undefined}
            valueLines={2}
            hasTVPreferredFocus={levelFocus.current === PERIOD_CUSTOM_ID}
            onPress={() => {
              setToday(calendarDayOf(Date.now()));
              goTo('custom', PERIOD_CUSTOM_ID);
            }}
          />
        </View>
      </SideSheet>
    );
  }

  if (level === 'tags') {
    return <TagList scope={scope} http={http} blogUrl={blogUrl} />;
  }

  if (level === 'custom' && today !== null) {
    const range = stepperRange(filter.period, today);
    return (
      <PeriodStepper
        initialFrom={range.from}
        initialTo={range.to}
        today={today}
        onDone={(from, to) =>
          pickPeriod({ kind: 'custom', fromDay: formatDayKey(from), toDay: formatDayKey(to) })
        }
      />
    );
  }

  return (
    <SideSheet testID={FILTERS_SHEET_ID} variant="filters" title={t('filters.title')}>
      <Text variant="body-s" color="text-meta" style={styles.section}>
        {t('filters.accessTitle')}
      </Text>
      <View accessibilityRole="radiogroup" style={styles.rows}>
        {accessValuesFor(scope).map(access => {
          const id = filterAccessId(access);
          return (
            <SettingRow
              key={access}
              ref={rowRef(id)}
              testID={id}
              kind="radio"
              selected={access === filter.access}
              label={t(`filters.access.${access}`)}
              hasTVPreferredFocus={levelFocus.current === id}
              onPress={() => filtersStore.getState().setAccess(scope, access)}
            />
          );
        })}
      </View>
      <View style={styles.period}>
        <SettingRow
          ref={rowRef(FILTERS_PERIOD_ID)}
          testID={FILTERS_PERIOD_ID}
          kind="nav"
          label={t('filters.period.title')}
          value={formatPeriod(filter.period)}
          valueLines={2}
          hasTVPreferredFocus={levelFocus.current === FILTERS_PERIOD_ID}
          onPress={() => goTo('period', periodRowId(filter.period))}
        />
      </View>
      <View style={styles.tags}>
        <SettingRow
          ref={rowRef(FILTERS_TAGS_ID)}
          testID={FILTERS_TAGS_ID}
          kind="nav"
          label={t('filters.tags.title')}
          value={
            filter.tags.length === 0
              ? t('filters.tags.none')
              : filter.tags.map(tag => tag.title).join(t('filters.tags.separator'))
          }
          valueLines={2}
          hasTVPreferredFocus={levelFocus.current === FILTERS_TAGS_ID}
          onPress={() => goTo('tags', FILTERS_TAGS_ID)}
        />
      </View>
      {showReset ? (
        <View style={styles.reset}>
          <SettingRow
            testID={FILTERS_RESET_ID}
            kind="nav"
            label={t('filters.reset')}
            onPress={() => {
              focusAfterReset.current = true;
              filtersStore.getState().reset(scope);
            }}
          />
        </View>
      ) : null}
    </SideSheet>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing['2'],
  },
  rows: {
    gap: spacing['3'],
  },
  period: {
    marginTop: spacing['6'],
  },
  tags: {
    marginTop: spacing['3'],
  },
  reset: {
    marginTop: spacing['8'],
  },
});
