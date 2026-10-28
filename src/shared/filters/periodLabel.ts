import { t, tf } from '../i18n';
import { MONTH_KEYS } from '../i18n/format';
import { parseDayKey, type CalendarDay, type Period } from './filter';

/** «1 августа 2026» (genitive month, Story 5.4). */
export function formatDay({ year, month, day }: CalendarDay): string {
  return tf('filters.period.day', {
    day: String(day),
    month: t(`date.monthGenitive.${MONTH_KEYS[month - 1]}`),
    year: String(year),
  });
}

/** «1 августа 2026 — 25 сентября 2026». */
export function formatRange(from: CalendarDay, to: CalendarDay): string {
  return tf('filters.period.range', { from: formatDay(from), to: formatDay(to) });
}

/**
 * The period as the «Период» row, the chip and the list show it: «За всё
 * время», a preset's name, or the custom range (an unreadable range reads
 * as «За всё время», as `periodBounds` sends it).
 */
export function formatPeriod(period: Period): string {
  switch (period.kind) {
    case 'all':
      return t('filters.period.all');
    case 'preset':
      return t(`filters.period.preset.d${period.days}`);
    case 'custom': {
      const from = parseDayKey(period.fromDay);
      const to = parseDayKey(period.toDay);
      return from && to ? formatRange(from, to) : t('filters.period.all');
    }
  }
}
