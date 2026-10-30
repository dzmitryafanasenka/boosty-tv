import { useMemo } from 'react';
import { StyleSheet, TVFocusGuideView, View } from 'react-native';
import type { chipLabels } from '../../shared/filters';
import { useZoneItem } from '../../shared/focus';
import { t } from '../../shared/i18n';
import {
  Button,
  FilterChip,
  TextField,
  components,
  spacing,
  typography,
  type HostView,
} from '../../shared/ui';

const FIELD = components['text-field'];
/** The action row: the label above the 50 dp field, and a little room under it. */
export const AUTHOR_ACTION_ROW_HEIGHT =
  typography['body-s'].lineHeight + spacing['4'] + FIELD.height + spacing['2'];
/** The gap between the header and the action row. */
export const AUTHOR_ACTION_ROW_TOP = spacing['4'];
const FIELD_WIDTH = 440;
const FIELD_MIN_WIDTH = 160;

export type AuthorActionRowProps = {
  /** «Поиск в блоге» (`phaseFlags.search`). */
  searchEnabled: boolean;
  fieldId: string;
  /** The field's host view (the row guide's destination); null: not mounted yet. */
  fieldView: HostView | null;
  fieldHostRef: (view: HostView | null) => void;
  onFieldFocus: () => void;
  draft: string;
  onChangeDraft: (text: string) => void;
  onSubmit: () => void;
  /** The «Фильтры» chip's labels; null: no chip (`phaseFlags.filters` off). */
  chip: ReturnType<typeof chipLabels> | null;
  chipId: string;
  chipRef: (view: HostView | null) => void;
  onOpenFilters: () => void;
  /** «Сбросить» is shown (a search or a filter is active). */
  showReset: boolean;
  resetId: string;
  onResetAll: () => void;
  /** Focus is on the row: the chip and «Сбросить» are focusable (see `useAuthorActionRowFocus`). */
  rowFocus: boolean;
};

/**
 * The Author action row (Story 5.7, docs/focus-map.md §4 D): «Поиск в
 * блоге», the «Фильтры» chip and «Сбросить», inside a guide that sends ↑
 * from the grid to the field.
 */
export function AuthorActionRow({
  searchEnabled,
  fieldId,
  fieldView,
  fieldHostRef,
  onFieldFocus,
  draft,
  onChangeDraft,
  onSubmit,
  chip,
  chipId,
  chipRef,
  onOpenFilters,
  showReset,
  resetId,
  onResetAll,
  rowFocus,
}: AuthorActionRowProps) {
  const chipZone = useZoneItem(chipId);
  const resetZone = useZoneItem(resetId);
  const rowDestinations = useMemo(() => (fieldView ? [fieldView] : []), [fieldView]);
  return (
    <TVFocusGuideView
      testID="author/action-row"
      destinations={rowDestinations}
      trapFocusRight
      style={styles.actionRow}
    >
      {searchEnabled ? (
        <View style={styles.fieldColumn}>
          <TextField
            testID={fieldId}
            label={t('author.search.fieldLabel')}
            placeholder={t('author.search.placeholder')}
            value={draft}
            onChangeText={onChangeDraft}
            onSubmitEditing={onSubmit}
            onFocus={onFieldFocus}
            hostRef={fieldHostRef}
          />
        </View>
      ) : null}
      {chip !== null ? (
        <View style={styles.chipColumn}>
          <FilterChip
            ref={chipRef}
            testID={chipId}
            label={chip.label}
            count={chip.count}
            accessibilityLabel={chip.a11y}
            onPress={onOpenFilters}
            onFocus={chipZone.onFocus}
            focusable={rowFocus || !searchEnabled}
          />
        </View>
      ) : null}
      {showReset ? (
        <View style={styles.chipColumn}>
          <Button
            testID={resetId}
            kind="secondary"
            size="small"
            label={t('author.search.reset')}
            accessibilityLabel={t('author.search.resetA11y')}
            onPress={onResetAll}
            onFocus={resetZone.onFocus}
            focusable={rowFocus || !searchEnabled}
          />
        </View>
      ) : null}
    </TVFocusGuideView>
  );
}

const styles = StyleSheet.create({
  // The row keeps inside the content width (device check): the field takes
  // what the chip and «Сбросить» leave, up to 440 dp (a long chip label
  // would otherwise push «Сбросить» off the screen).
  actionRow: {
    height: AUTHOR_ACTION_ROW_HEIGHT,
    width: spacing['content-width'] - 2 * spacing['focus-headroom'],
    marginTop: AUTHOR_ACTION_ROW_TOP,
    marginLeft: spacing['focus-headroom'],
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  fieldColumn: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: FIELD_WIDTH,
    minWidth: FIELD_MIN_WIDTH,
  },
  chipColumn: {
    flexShrink: 0,
    marginLeft: spacing['6'],
    // Level with the field: below the label, centred on the 50 dp field.
    marginTop:
      typography['body-s'].lineHeight +
      spacing['4'] +
      (FIELD.height - components['filter-chip'].height) / 2,
  },
});
