import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { SettingRow, SideSheet, Text, requestHostFocus, spacing, type HostView } from '../ui';
import { ACCESS_VALUES, isDefaultFilter, type AccessFilter, type FilterScope } from './filter';
import { filtersStore, useFilter } from './filtersStore';

/** Focus ids (docs/focus-map.md §1.5, D8). */
export const FILTERS_SHEET_ID = 'filters/sheet';
export const FILTERS_RESET_ID = 'filters/reset';
export const filterAccessId = (access: AccessFilter) => `filters/access/${access}`;

/** Focus a view now and again two frames later (the modal host's device lesson). */
function focusSoon(view: () => HostView | null): () => void {
  requestHostFocus(view());
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => requestHostFocus(view()));
  });
  return () => cancelAnimationFrame(frame);
}

export type FilterSheetProps = {
  /** Whose Filter the sheet edits (Story 5.3: `feed`). */
  scope: FilterScope;
};

/**
 * The filter SideSheet (Story 5.3, FILTER-01, EXPERIENCE.md «FilterChip →
 * filter SideSheet»): 320 dp, opened through the one modal host with
 * `placement: 'end'` (focus trapped, ← → do nothing, Back closes it and
 * focus returns to the chip). One column: the «Доступ» values as radio
 * rows, then «Сбросить» while the Filter is not the default.
 *
 * - Opens with focus on the selected access value.
 * - OK on a value applies it at once (no Apply button): the store changes,
 *   the list behind refetches; focus stays on that row.
 * - OK on «Сбросить» resets the scope; the row goes away and focus moves to
 *   «Доступные мне».
 *
 * It reads the Filter from `filtersStore` itself: the modal host renders
 * this element once, the Filter changes under it.
 */
export function FilterSheet({ scope }: FilterSheetProps) {
  const filter = useFilter(scope);
  const showReset = !isDefaultFilter(filter);
  const rows = useRef(new Map<AccessFilter, HostView | null>());
  const selectedAtOpen = useRef(filter.access);
  /** «Сбросить» was pressed: its row goes away, focus → «Доступные мне». */
  const focusAfterReset = useRef(false);

  // Initial focus: the selected value.
  useEffect(() => focusSoon(() => rows.current.get(selectedAtOpen.current) ?? null), []);

  useEffect(() => {
    if (!showReset && focusAfterReset.current) {
      focusAfterReset.current = false;
      return focusSoon(() => rows.current.get('allowed') ?? null);
    }
    return undefined;
  }, [showReset]);

  return (
    <SideSheet testID={FILTERS_SHEET_ID} variant="filters" title={t('filters.title')}>
      <Text variant="body-s" color="text-meta" style={styles.section}>
        {t('filters.accessTitle')}
      </Text>
      <View accessibilityRole="radiogroup" style={styles.rows}>
        {ACCESS_VALUES.map(access => {
          const selected = access === filter.access;
          return (
            <SettingRow
              key={access}
              ref={view => {
                rows.current.set(access, view);
              }}
              testID={filterAccessId(access)}
              kind="radio"
              selected={selected}
              label={t(`filters.access.${access}`)}
              hasTVPreferredFocus={access === selectedAtOpen.current}
              onPress={() => filtersStore.getState().setAccess(scope, access)}
            />
          );
        })}
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
  reset: {
    marginTop: spacing['8'],
  },
});
