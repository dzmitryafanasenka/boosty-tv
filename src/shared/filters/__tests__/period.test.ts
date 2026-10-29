import {
  DEFAULT_FILTER,
  activeFilterCount,
  addDays,
  clampCalendarDay,
  daysInMonth,
  formatDayKey,
  formatPeriod,
  isDefaultFilter,
  parseDayKey,
  periodBounds,
  periodEquals,
  stepCalendarField,
  type CalendarDay,
  type Period,
} from '..';
import { t } from '../../i18n';

/** Local epoch seconds of a calendar instant (the test runs in the host's zone). */
const localSec = (y: number, m: number, d: number, h = 0, min = 0, s = 0) =>
  Math.floor(new Date(y, m - 1, d, h, min, s).getTime() / 1000);
/** Local parts of epoch seconds. */
const partsOf = (sec: number) => {
  const date = new Date(sec * 1000);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];
};
const day = (year: number, month: number, d: number): CalendarDay => ({ year, month, day: d });

describe('Period model (AD-18, Story 5.4)', () => {
  it('the default Filter is «Доступные мне» + «За всё время», frozen', () => {
    expect(DEFAULT_FILTER).toEqual({ access: 'allowed', period: { kind: 'all' }, tags: [] });
    expect(Object.isFrozen(DEFAULT_FILTER)).toBe(true);
    expect(Object.isFrozen(DEFAULT_FILTER.period)).toBe(true);
  });

  it('activeFilterCount counts the access and the period sections', () => {
    expect(activeFilterCount({ access: 'allowed', period: { kind: 'all' }, tags: [] })).toBe(0);
    expect(activeFilterCount({ access: 'allowed', period: { kind: 'preset', days: 7 }, tags: [] })).toBe(1);
    expect(activeFilterCount({ access: 'all', period: { kind: 'all' }, tags: [] })).toBe(1);
    expect(
      activeFilterCount({ access: 'all', period: { kind: 'custom', fromDay: '2026-08-01', toDay: '2026-09-25' }, tags: [] }),
    ).toBe(2);
    expect(isDefaultFilter({ access: 'allowed', period: { kind: 'preset', days: 90 }, tags: [] })).toBe(false);
  });

  it('periodEquals compares the choice, not the object', () => {
    const custom: Period = { kind: 'custom', fromDay: '2026-08-01', toDay: '2026-09-25' };
    expect(periodEquals({ kind: 'all' }, { kind: 'all' })).toBe(true);
    expect(periodEquals({ kind: 'preset', days: 7 }, { kind: 'preset', days: 7 })).toBe(true);
    expect(periodEquals({ kind: 'preset', days: 7 }, { kind: 'preset', days: 30 })).toBe(false);
    expect(periodEquals(custom, { ...custom })).toBe(true);
    expect(periodEquals(custom, { ...custom, toDay: '2026-09-24' })).toBe(false);
    expect(periodEquals(custom, { kind: 'all' })).toBe(false);
  });

  it('day keys: format, parse and reject impossible dates', () => {
    expect(formatDayKey(day(2026, 8, 1))).toBe('2026-08-01');
    expect(parseDayKey('2026-09-25')).toEqual(day(2026, 9, 25));
    expect(parseDayKey('2024-02-29')).toEqual(day(2024, 2, 29));
    expect(parseDayKey('2026-02-29')).toBeNull();
    expect(parseDayKey('2026-13-01')).toBeNull();
    expect(parseDayKey('2026-8-1')).toBeNull();
    expect(parseDayKey('')).toBeNull();
  });

  it('month lengths, leap years and day arithmetic across month and year ends', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(addDays(day(2026, 3, 1), -1)).toEqual(day(2026, 2, 28));
    expect(addDays(day(2024, 3, 1), -1)).toEqual(day(2024, 2, 29));
    expect(addDays(day(2026, 1, 3), -6)).toEqual(day(2025, 12, 28));
    expect(addDays(day(2026, 10, 28), -30)).toEqual(day(2026, 9, 28));
  });
});

describe('periodBounds (request-time resolution)', () => {
  const NOW = new Date(2026, 9, 28, 14, 30, 15).getTime();

  it('«За всё время» has no bounds', () => {
    expect(periodBounds({ kind: 'all' }, NOW)).toBeNull();
  });

  it('a preset covers the last N days including today: 00:00:00 of today − (N − 1) … 23:59:59 today', () => {
    expect(periodBounds({ kind: 'preset', days: 7 }, NOW)).toEqual({
      fromTs: localSec(2026, 10, 22),
      toTs: localSec(2026, 10, 28, 23, 59, 59),
    });
    expect(periodBounds({ kind: 'preset', days: 30 }, NOW)).toEqual({
      fromTs: localSec(2026, 9, 29),
      toTs: localSec(2026, 10, 28, 23, 59, 59),
    });
    expect(periodBounds({ kind: 'preset', days: 90 }, NOW)).toEqual({
      fromTs: localSec(2026, 7, 31),
      toTs: localSec(2026, 10, 28, 23, 59, 59),
    });
  });

  it('a preset early in the year reaches into the previous year', () => {
    const jan3 = new Date(2026, 0, 3, 0, 0, 1).getTime();
    expect(periodBounds({ kind: 'preset', days: 7 }, jan3)).toEqual({
      fromTs: localSec(2025, 12, 28),
      toTs: localSec(2026, 1, 3, 23, 59, 59),
    });
  });

  it('a preset across a leap February', () => {
    const mar2 = new Date(2024, 2, 2, 9).getTime();
    expect(periodBounds({ kind: 'preset', days: 7 }, mar2)?.fromTs).toBe(localSec(2024, 2, 25));
  });

  it('a custom range: local 00:00:00 of the first day … 23:59:59 of the last (matrix «Custom»)', () => {
    expect(periodBounds({ kind: 'custom', fromDay: '2026-08-01', toDay: '2026-09-25' }, NOW)).toEqual({
      fromTs: localSec(2026, 8, 1),
      toTs: localSec(2026, 9, 25, 23, 59, 59),
    });
    // A single day.
    expect(periodBounds({ kind: 'custom', fromDay: '2024-02-29', toDay: '2024-02-29' }, NOW)).toEqual({
      fromTs: localSec(2024, 2, 29),
      toTs: localSec(2024, 2, 29, 23, 59, 59),
    });
    // A month end.
    expect(periodBounds({ kind: 'custom', fromDay: '2026-01-31', toDay: '2026-12-31' }, NOW)?.toTs).toBe(
      localSec(2026, 12, 31, 23, 59, 59),
    );
  });

  it('bounds stay on local midnight across a DST change (calendar math, never ± 86 400 s)', () => {
    // Late March and late October hold the EU change; elsewhere this is a plain range.
    for (const [fromDay, toDay] of [
      ['2026-03-20', '2026-04-05'],
      ['2026-10-20', '2026-11-05'],
    ]) {
      const bounds = periodBounds({ kind: 'custom', fromDay, toDay }, NOW)!;
      expect(partsOf(bounds.fromTs).slice(3)).toEqual([0, 0, 0]);
      expect(partsOf(bounds.toTs).slice(3)).toEqual([23, 59, 59]);
    }
    const marchPreset = periodBounds({ kind: 'preset', days: 30 }, new Date(2026, 3, 10, 12).getTime())!;
    expect(partsOf(marchPreset.fromTs)).toEqual([2026, 3, 12, 0, 0, 0]);
  });

  it('an unreadable custom day sends no bounds', () => {
    expect(periodBounds({ kind: 'custom', fromDay: '2026-02-30', toDay: '2026-03-01' }, NOW)).toBeNull();
  });

  it('matrix «Key stability»: the Filter holds no time; only the request resolves it', () => {
    const filter = { access: 'allowed', period: { kind: 'preset', days: 7 }, tags: [] } as const;
    const before = JSON.stringify(filter);
    const a = periodBounds(filter.period, NOW);
    const b = periodBounds(filter.period, NOW + 60_000);
    expect(JSON.stringify(filter)).toBe(before);
    // The same day: the same bounds; the next day: shifted by one day.
    expect(b).toEqual(a);
    const tomorrow = periodBounds(filter.period, new Date(2026, 9, 29, 0, 0, 1).getTime());
    expect(tomorrow?.fromTs).toBe(localSec(2026, 10, 23));
  });
});

describe('formatPeriod (ru)', () => {
  it('names the presets and spells a custom range with genitive months', () => {
    expect(formatPeriod({ kind: 'all' })).toBe('За всё время');
    expect(formatPeriod({ kind: 'preset', days: 7 })).toBe('Последние 7 дней');
    expect(formatPeriod({ kind: 'preset', days: 30 })).toBe('Последние 30 дней');
    expect(formatPeriod({ kind: 'preset', days: 90 })).toBe('Последние 3 месяца');
    expect(formatPeriod({ kind: 'custom', fromDay: '2026-08-01', toDay: '2026-09-25' })).toBe(
      '1 августа 2026 — 25 сентября 2026',
    );
    expect(formatPeriod({ kind: 'custom', fromDay: 'x', toDay: '2026-09-25' })).toBe(t('filters.period.all'));
  });
});

describe('stepper field rules', () => {
  const TODAY = day(2026, 10, 28);

  it('day 1…the month’s length; no wrap-around', () => {
    expect(stepCalendarField(day(2026, 8, 31), 'day', 1, TODAY)).toEqual(day(2026, 8, 31));
    expect(stepCalendarField(day(2026, 8, 1), 'day', -1, TODAY)).toEqual(day(2026, 8, 1));
    expect(stepCalendarField(day(2026, 8, 30), 'day', 1, TODAY)).toEqual(day(2026, 8, 31));
    expect(stepCalendarField(day(2024, 2, 28), 'day', 1, TODAY)).toEqual(day(2024, 2, 29));
    expect(stepCalendarField(day(2026, 2, 28), 'day', 1, TODAY)).toEqual(day(2026, 2, 28));
  });

  it('matrix «Day clamp»: 31 + the month → February → 28 (29 in a leap year)', () => {
    expect(stepCalendarField(day(2026, 3, 31), 'month', -1, TODAY)).toEqual(day(2026, 2, 28));
    expect(stepCalendarField(day(2024, 3, 31), 'month', -1, TODAY)).toEqual(day(2024, 2, 29));
    expect(stepCalendarField(day(2026, 1, 31), 'month', 1, TODAY)).toEqual(day(2026, 2, 28));
    // The year: 29 Feb 2024 → 2025 → 28 Feb.
    expect(stepCalendarField(day(2024, 2, 29), 'year', 1, TODAY)).toEqual(day(2025, 2, 28));
  });

  it('month 1–12; year 2015…the current year; no date after today', () => {
    expect(stepCalendarField(day(2025, 12, 1), 'month', 1, TODAY)).toEqual(day(2025, 12, 1));
    expect(stepCalendarField(day(2025, 1, 1), 'month', -1, TODAY)).toEqual(day(2025, 1, 1));
    expect(stepCalendarField(day(2015, 5, 5), 'year', -1, TODAY)).toEqual(day(2015, 5, 5));
    expect(stepCalendarField(day(2026, 5, 5), 'year', 1, TODAY)).toEqual(day(2026, 5, 5));
    // The current month is the last one of the current year…
    expect(stepCalendarField(day(2026, 10, 1), 'month', 1, TODAY)).toEqual(day(2026, 10, 1));
    // …today the last day of it…
    expect(stepCalendarField(day(2026, 10, 28), 'day', 1, TODAY)).toEqual(day(2026, 10, 28));
    // …and a year step into the current year pulls a later month and day back to today.
    expect(stepCalendarField(day(2025, 12, 31), 'year', 1, TODAY)).toEqual(day(2026, 10, 28));
    expect(stepCalendarField(day(2026, 9, 30), 'month', 1, TODAY)).toEqual(day(2026, 10, 28));
  });

  it('clampCalendarDay brings an out-of-range day inside the limits', () => {
    expect(clampCalendarDay(day(2014, 1, 1), TODAY)).toEqual(day(2015, 1, 1));
    expect(clampCalendarDay(day(2027, 1, 1), TODAY)).toEqual(day(2026, 1, 1));
    expect(clampCalendarDay(day(2026, 11, 30), TODAY)).toEqual(day(2026, 10, 28));
  });
});
