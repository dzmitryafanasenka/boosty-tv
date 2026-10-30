import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { subscribeSeekKeys, type SeekKeyEvent } from '../platform/seekKeys';
import { StyleSheet, TVFocusGuideView, View, useTVEventHandler } from 'react-native';
import { t, tf } from '../i18n';
import { MONTH_KEYS } from '../i18n/format';
import {
  Button,
  FocusableSurface,
  SideSheet,
  Text,
  colors,
  focus as focusTokens,
  rounded,
  spacing,
  type HostView,
  type SurfaceState,
} from '../ui';
import { daysInMonth, formatDayKey, type CalendarDay } from './filter';
import { focusSoon } from '../focus';
import { formatRange } from './periodLabel';

/** Focus ids (docs/focus-map.md §1.5, D10). */
export const PERIOD_STEPPER_ID = 'filters/period/stepper';
export const PERIOD_DONE_ID = 'filters/period/custom/done';
export type StepperGroup = 'from' | 'to';
export type StepperField = 'day' | 'month' | 'year';
export const stepperFieldId = (group: StepperGroup, field: StepperField) =>
  `filters/period/custom/${group}/${field}`;

/** The earliest year the year field reaches (Story 5.4). */
export const PERIOD_MIN_YEAR = 2015;
/**
 * The first ↑ or ↓ press this soon after focus entered the fields from
 * «Готово» is ignored: it belongs to the press that moved focus here
 * (focus-map §1.1, as the player's entry guard). Not armed on the open: the
 * press that opens the stepper is OK, never an arrow.
 */
export const STEPPER_ENTRY_GUARD_MS = 500;
/** Android KeyEvent.ACTION_UP: the stepper acts on key up only (device: Story 5.4, docs/testing.md). */
const KEY_UP = 1;

/**
 * Raw ↑ / ↓ as react-native-tvos reports them (device: Story 5.4): a press
 * is `up` / `down` with key up only; a held key is `longUp` / `longDown`
 * (key down, then key up) instead, and counts as one step.
 */
const STEP_KEYS: Readonly<Record<string, 1 | -1>> = { up: 1, longUp: 1, down: -1, longDown: -1 };

/**
 * A held ↑ / ↓ (native key-down repeats, Android ≈ every 50 ms after ≈ 500
 * ms) steps at most this often (owner decision 2026-10-28: holding keeps
 * changing the value, like the player's hold-to-seek).
 */
export const STEPPER_HOLD_REPEAT_MS = 150;

const FIELDS: readonly StepperField[] = ['day', 'month', 'year'];
const GROUPS: readonly StepperGroup[] = ['from', 'to'];

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** The last day a month offers: its length, or today in the current month (no future dates). */
function maxDay(year: number, month: number, today: CalendarDay): number {
  return year === today.year && month === today.month ? today.day : daysInMonth(year, month);
}

/** The last month a year offers: 12, or the current month in the current year. */
function maxMonth(year: number, today: CalendarDay): number {
  return year === today.year ? today.month : 12;
}

/**
 * A day brought inside the stepper's limits: year 2015…today's year, month
 * up to today's in the current year, day 1…the month's length (or today):
 * so a date after today is never reachable.
 */
export function clampCalendarDay(value: CalendarDay, today: CalendarDay): CalendarDay {
  const year = clamp(value.year, PERIOD_MIN_YEAR, today.year);
  const month = clamp(value.month, 1, maxMonth(year, today));
  const day = clamp(value.day, 1, maxDay(year, month, today));
  return { year, month, day };
}

/**
 * One ↑ (+1) or ↓ (−1) on a field (Story 5.4). No wrap-around: a field at
 * its limit stays. Changing the month or the year clamps the day (31 →
 * 28/29 in February) and, in the current year, the month.
 */
export function stepCalendarField(
  value: CalendarDay,
  field: StepperField,
  delta: 1 | -1,
  today: CalendarDay,
): CalendarDay {
  switch (field) {
    case 'year':
      return clampCalendarDay({ ...value, year: clamp(value.year + delta, PERIOD_MIN_YEAR, today.year) }, today);
    case 'month':
      return clampCalendarDay(
        { ...value, month: clamp(value.month + delta, 1, maxMonth(value.year, today)) },
        today,
      );
    case 'day':
      return clampCalendarDay(
        { ...value, day: clamp(value.day + delta, 1, maxDay(value.year, value.month, today)) },
        today,
      );
  }
}

export type PeriodStepperProps = {
  /** The values it opens on (the active custom range, else today − 30 → today). */
  initialFrom: CalendarDay;
  initialTo: CalendarDay;
  /** Today's local date (the limits), read once when the stepper opened. */
  today: CalendarDay;
  /** «Готово» on a valid range. */
  onDone: (from: CalendarDay, to: CalendarDay) => void;
};

type Focused = { group: StepperGroup; field: StepperField } | 'done' | null;

/**
 * D10 «Свой период» (Story 5.4, FILTER-02; DESIGN.md PeriodStepper): two
 * groups «С» and «По» of day / month / year boxes, the range in words, then
 * «Готово». One of the three places allowed raw D-pad keys (AD-12,
 * focus-map §1.1):
 *
 * - ↑ / ↓ change the focused field's value: one step on the native key
 *   down, then a step at most every 150 ms while held (`SeekKeys` key-down
 *   repeats; owner decision 2026-10-28). React Native's own key up of that
 *   press is then skipped (no double step). Without the native module
 *   (tests) a step on the React Native key up of `up` / `down` / `longUp` /
 *   `longDown` (raw keys, `useTVEventHandler`). Each row is a
 *   `TVFocusGuideView` trapped on every side, so ↑ ↓ never move focus
 *   natively, also while held.
 * - ← → move between the fields natively; → from «С: год» reaches «По:
 *   день» and ← from «По: день» reaches «С: год» through a thin band guide
 *   at the row's end.
 * - OK on a field → «Готово»; ↑ from «Готово» → «С: день» (the «По» row's
 *   guide destination while «Готово» has focus); entering the fields from
 *   outside ignores the first ↑ / ↓ key up within 500 ms (the entry guard).
 * - From later than to: «Готово» is disabled (not focusable) and the hint
 *   shows; values never change on their own (owner decision 2026-10-28).
 *
 * Back belongs to `FilterSheet` (stepper → period list, edits discarded).
 */
export function PeriodStepper({ initialFrom, initialTo, today, onDone }: PeriodStepperProps) {
  const [values, setValues] = useState(() => ({
    from: clampCalendarDay(initialFrom, today),
    to: clampCalendarDay(initialTo, today),
  }));
  const valid = formatDayKey(values.from) <= formatDayKey(values.to);
  const views = useRef(new Map<string, HostView | null>());
  const doneView = useRef<HostView | null>(null);
  // Guide destinations are views in state (a guide reads them on render).
  const [fromDayView, setFromDayView] = useState<HostView | null>(null);
  const [fromYearView, setFromYearView] = useState<HostView | null>(null);
  const [toDayView, setToDayView] = useState<HostView | null>(null);
  const [doneFocused, setDoneFocused] = useState(false);
  const focused = useRef<Focused>(null);
  /** When focus entered the fields from «Готово», and whether a key used the guard up. */
  const entry = useRef({ at: 0, used: true });
  /**
   * When an ↑ / ↓ key up arrived while no field had focus (device: the key
   * up of the press that leaves «Готово» can reach JS before the field's
   * focus event): that press already spent the entry guard.
   */
  const strayKeyAt = useRef(-Infinity);

  // Initial focus: «С: день».
  useEffect(() => focusSoon(() => views.current.get(stepperFieldId('from', 'day')) ?? null), []);

  const onFieldFocus = useCallback((group: StepperGroup, field: StepperField) => {
    const previous = focused.current;
    if (previous === 'done') {
      const now = Date.now();
      entry.current = { at: now, used: now - strayKeyAt.current <= STEPPER_ENTRY_GUARD_MS };
    }
    focused.current = { group, field };
    setDoneFocused(false);
  }, []);

  const onDoneFocus = useCallback(() => {
    focused.current = 'done';
    setDoneFocused(true);
  }, []);

  /** The entry guard: true for the first ↑ / ↓ right after focus entered the fields (used up once). */
  const entryGuarded = useCallback(() => {
    if (entry.current.used) {
      return false;
    }
    entry.current.used = true;
    return Date.now() - entry.current.at <= STEPPER_ENTRY_GUARD_MS;
  }, []);

  /**
   * The native path (`SeekKeys`, Story 5.4 owner decision): per direction,
   * whether a native key down was seen since the last React Native key up
   * (that key up is then not a step: no double step), whether the press is
   * ignored (it started off the fields or inside the entry guard), and when
   * the last step of a hold was taken.
   */
  const nativeKeys = useRef({
    up: { seen: false, ignored: false, lastAt: 0 },
    down: { seen: false, ignored: false, lastAt: 0 },
  });

  const onNativeKey = useCallback(
    (event: SeekKeyEvent) => {
      if (event.key !== 'up' && event.key !== 'down') {
        return;
      }
      const press = nativeKeys.current[event.key];
      if (event.action === 'up') {
        press.ignored = false;
        return;
      }
      press.seen = true;
      const current = focused.current;
      const now = Date.now();
      if (event.repeat === 0) {
        if (current === null || current === 'done') {
          // The press that leaves «Готово» (focus moves after this key down).
          strayKeyAt.current = now;
          press.ignored = true;
          return;
        }
        press.ignored = entryGuarded();
        if (press.ignored) {
          return;
        }
      } else if (press.ignored || current === null || current === 'done' || now - press.lastAt < STEPPER_HOLD_REPEAT_MS) {
        return;
      }
      press.lastAt = now;
      const delta = event.key === 'up' ? 1 : -1;
      setValues(v => ({ ...v, [current.group]: stepCalendarField(v[current.group], current.field, delta, today) }));
    },
    [entryGuarded, today],
  );
  useEffect(() => subscribeSeekKeys(onNativeKey), [onNativeKey]);

  const onTvEvent = useCallback(
    (event: { eventType: string; eventKeyAction?: number | string }) => {
      const type = event.eventType;
      const delta = Object.prototype.hasOwnProperty.call(STEP_KEYS, type) ? STEP_KEYS[type] : undefined;
      if (delta === undefined || Number(event.eventKeyAction) !== KEY_UP) {
        return;
      }
      // The native key down already stepped (or ignored) this press.
      const press = nativeKeys.current[delta === 1 ? 'up' : 'down'];
      if (press.seen) {
        press.seen = false;
        return;
      }
      // Fallback (no native module): one step on key up.
      const current = focused.current;
      if (current === null || current === 'done') {
        strayKeyAt.current = Date.now();
        return;
      }
      if (entryGuarded()) {
        return;
      }
      setValues(v => ({ ...v, [current.group]: stepCalendarField(v[current.group], current.field, delta, today) }));
    },
    [entryGuarded, today],
  );
  useTVEventHandler(onTvEvent);

  const onFieldPress = useCallback(() => {
    // OK on a field → «Готово» (not focusable while the range is invalid).
    if (doneView.current !== null && valid) {
      focusSoon(() => doneView.current);
    }
  }, [valid]);

  const toRowDestinations = useMemo(
    () => (doneFocused && fromDayView ? [fromDayView] : []),
    [doneFocused, fromDayView],
  );
  const fromBand = useMemo(() => (toDayView ? [toDayView] : []), [toDayView]);
  const toBand = useMemo(() => (fromYearView ? [fromYearView] : []), [fromYearView]);

  return (
    <SideSheet testID={PERIOD_STEPPER_ID} variant="filters" title={t('filters.period.customTitle')}>
      <Text variant="body-s" color="text-tertiary" style={styles.hint}>
        {t('filters.period.hint')}
      </Text>
      {GROUPS.map(group => (
        <View key={group} style={styles.group}>
          <Text variant="body" color="text-secondary">
            {t(`filters.period.${group}`)}
          </Text>
          <TVFocusGuideView
            testID={`filters/period/custom/${group}/row`}
            style={styles.row}
            destinations={group === 'to' ? toRowDestinations : undefined}
            trapFocusUp
            trapFocusDown
            trapFocusLeft
            trapFocusRight
          >
            {group === 'to' ? (
              <TVFocusGuideView
                testID="filters/period/custom/to/band"
                destinations={toBand}
                style={styles.band}
              />
            ) : (
              // The «По» row's band width, so the two rows' boxes line up.
              <View style={styles.band} />
            )}
            {FIELDS.map(field => {
              const id = stepperFieldId(group, field);
              const value = values[group];
              return (
                <StepperBox
                  key={field}
                  id={id}
                  field={field}
                  value={value}
                  group={group}
                  hasTVPreferredFocus={group === 'from' && field === 'day'}
                  viewRef={view => {
                    views.current.set(id, view);
                    if (group === 'from' && field === 'day') {
                      setFromDayView(view);
                    } else if (group === 'from' && field === 'year') {
                      setFromYearView(view);
                    } else if (group === 'to' && field === 'day') {
                      setToDayView(view);
                    }
                  }}
                  onFocus={() => onFieldFocus(group, field)}
                  onPress={onFieldPress}
                  onAdjust={delta =>
                    setValues(v => ({ ...v, [group]: stepCalendarField(v[group], field, delta, today) }))
                  }
                />
              );
            })}
            {group === 'from' ? (
              <TVFocusGuideView
                testID="filters/period/custom/from/band"
                destinations={fromBand}
                style={styles.band}
              />
            ) : null}
          </TVFocusGuideView>
        </View>
      ))}
      <Text testID="filters/period/custom/summary" variant="body" color="accent-text" style={styles.summary}>
        {formatRange(values.from, values.to)}
      </Text>
      {valid ? null : (
        <Text
          testID="filters/period/custom/invalid"
          variant="body-s"
          color="text-secondary"
          accessibilityLiveRegion="polite"
          style={styles.invalid}
        >
          {t('filters.period.invalid')}
        </Text>
      )}
      <View style={styles.doneRow}>
        <Button
          ref={doneView}
          testID={PERIOD_DONE_ID}
          kind="primary"
          label={t('filters.period.done')}
          disabled={!valid}
          onFocus={onDoneFocus}
          onPress={() => onDone(values.from, values.to)}
        />
      </View>
    </SideSheet>
  );
}

type StepperBoxProps = {
  id: string;
  group: StepperGroup;
  field: StepperField;
  value: CalendarDay;
  hasTVPreferredFocus: boolean;
  viewRef: (view: HostView | null) => void;
  onFocus: () => void;
  onPress: () => void;
  /** TalkBack's adjust gestures: one step of this box (+1 / −1). */
  onAdjust: (delta: 1 | -1) => void;
};

const ADJUST_ACTIONS = [
  { name: 'increment' as const },
  { name: 'decrement' as const },
];

const BOX = { day: 75, month: 90, year: 75 } as const;
const BOX_HEIGHT = 66;

/** One value box: ▲ / value / ▼ (the arrows only while focused). */
function StepperBox({
  id,
  group,
  field,
  value,
  hasTVPreferredFocus,
  viewRef,
  onFocus,
  onPress,
  onAdjust,
}: StepperBoxProps) {
  const monthKey = MONTH_KEYS[value.month - 1];
  const shown =
    field === 'day' ? String(value.day) : field === 'year' ? String(value.year) : t(`date.month.${monthKey}`);
  const spoken = field === 'month' ? t(`date.monthName.${monthKey}`) : shown;
  const surfaceStyle = ({ focused }: SurfaceState) => [
    styles.box,
    { width: BOX[field], backgroundColor: focused ? colors['surface-focus-row'] : colors.surface },
  ];
  return (
    <FocusableSurface
      ref={viewRef}
      testID={id}
      radius={rounded.xl}
      scaleFocus={focusTokens['scale-button']}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="adjustable"
      accessibilityLabel={tf('filters.period.fieldA11y', {
        group: t(`filters.period.${group}`),
        field: t(`filters.period.field.${field}`),
        value: spoken,
      })}
      accessibilityActions={ADJUST_ACTIONS}
      onAccessibilityAction={event => {
        const name = event.nativeEvent.actionName;
        if (name === 'increment' || name === 'decrement') {
          onAdjust(name === 'increment' ? 1 : -1);
        }
      }}
      onFocus={onFocus}
      onPress={onPress}
      surfaceStyle={surfaceStyle}
    >
      {({ focused }) => (
        <View style={styles.boxContent}>
          <Text variant="meta" color={focused ? 'text' : 'surface'}>
            ▲
          </Text>
          <Text testID={`${id}/value`} variant="title-s">
            {shown}
          </Text>
          <Text variant="meta" color={focused ? 'text' : 'surface'}>
            ▼
          </Text>
        </View>
      )}
    </FocusableSurface>
  );
}

const styles = StyleSheet.create({
  hint: {
    marginBottom: spacing['5'],
  },
  group: {
    gap: spacing['3'],
    marginBottom: spacing['6'],
  },
  row: {
    flexDirection: 'row',
    gap: spacing['5'],
  },
  band: {
    width: 2,
    height: BOX_HEIGHT,
  },
  box: {
    height: BOX_HEIGHT,
    borderRadius: rounded.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  boxContent: {
    alignItems: 'center',
  },
  summary: {
    marginBottom: spacing['4'],
  },
  invalid: {
    marginBottom: spacing['4'],
  },
  doneRow: {
    flexDirection: 'row',
    marginTop: spacing['4'],
  },
});
