/**
 * The Filter model (AD-18, Stories 5.3–5.5). Story 5.3 added the access
 * section, Story 5.4 the period, Story 5.5 the tags. A Filter is plain,
 * serializable data: it is part of list query keys (never a resolved
 * timestamp, URL or cursor) and repositories turn it into request params.
 */

/**
 * «Доступные мне» (the reference default), «Все посты», «Только купленные»
 * (FILTER-01). The reference's `AccessType.Allowed / All / Bought`.
 */
export type AccessFilter = 'allowed' | 'all' | 'bought';

/** In sheet order. */
export const ACCESS_VALUES: readonly AccessFilter[] = ['allowed', 'all', 'bought'];

/** The presets' day counts: «Последние 7 дней», «Последние 30 дней», «Последние 3 месяца». */
export type PeriodPresetDays = 7 | 30 | 90;

/** In list order. */
export const PERIOD_PRESET_DAYS: readonly PeriodPresetDays[] = [7, 30, 90];

/**
 * The period (FILTER-02, Story 5.4), symbolic: `all` («За всё время»), a
 * preset (the last N days including today) or a custom range of local
 * calendar dates (`YYYY-MM-DD`, both inclusive). Never a timestamp: the
 * repository resolves it at request time (`periodBounds`).
 */
export type Period =
  | { readonly kind: 'all' }
  | { readonly kind: 'preset'; readonly days: PeriodPresetDays }
  | { readonly kind: 'custom'; readonly fromDay: string; readonly toDay: string };

/**
 * A selected tag (FILTER-03, Story 5.5), as the reference's `Tag(id, title)`:
 * the id goes to the request and the key, the title only labels the «Теги»
 * row and the chip.
 */
export type TagRef = { readonly id: string; readonly title: string };

export type Filter = {
  readonly access: AccessFilter;
  readonly period: Period;
  /**
   * The selected tags, in selection order (Story 5.5). The query key and
   * `tags_ids` use the sorted ids only (`tagIdsKey`), so the order and a
   * renamed tag never change the key.
   */
  readonly tags: readonly TagRef[];
};

/**
 * Where a Filter applies. Story 5.3 uses `feed` only; Stories 5.6 and 5.7
 * add `search` and `author:<blogUrl>`.
 */
export type FilterScope = 'feed';

export const ALL_TIME: Period = Object.freeze({ kind: 'all' });

/** No tag selected (one frozen array). */
export const NO_TAGS: readonly TagRef[] = Object.freeze([]);

/**
 * The default Filter (owner decision 2026-10-28: «Доступные мне», «За всё
 * время»; Story 5.5: no tags). One frozen object, so selectors stay stable.
 */
export const DEFAULT_FILTER: Filter = Object.freeze({
  access: 'allowed',
  period: ALL_TIME,
  tags: NO_TAGS,
});

/**
 * The selected tag ids, deduped and sorted (Story 5.5): the query key's and
 * `tags_ids`'s form, so A+B and B+A are the same request. Titles excluded.
 */
export function tagIdsKey(filter: Filter): string[] {
  return [...new Set(filter.tags.map(tag => tag.id))].sort();
}

/** Two periods are the same choice. */
export function periodEquals(a: Period, b: Period): boolean {
  switch (a.kind) {
    case 'all':
      return b.kind === 'all';
    case 'preset':
      return b.kind === 'preset' && a.days === b.days;
    case 'custom':
      return b.kind === 'custom' && a.fromDay === b.fromDay && a.toDay === b.toDay;
  }
}

/**
 * How many sections differ from the default (the chip's count): access,
 * period and tags (the tag section counts once, however many are checked).
 */
export function activeFilterCount(filter: Filter): number {
  return (
    (filter.access === DEFAULT_FILTER.access ? 0 : 1) +
    (filter.period.kind === 'all' ? 0 : 1) +
    (filter.tags.length === 0 ? 0 : 1)
  );
}

/** The Filter is the default one (no «Сбросить», no chip count). */
export function isDefaultFilter(filter: Filter): boolean {
  return activeFilterCount(filter) === 0;
}

// ---------------------------------------------------------------------------
// Calendar days (local time)

/** A local calendar date; `month` is 1–12. */
export type CalendarDay = { readonly year: number; readonly month: number; readonly day: number };

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** `YYYY-MM-DD`. */
export function formatDayKey({ year, month, day }: CalendarDay): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** A `YYYY-MM-DD` key back to its parts; null when it is not a real calendar date. */
export function parseDayKey(key: string): CalendarDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

/** Days in a month (`month` 1–12), leap years included. */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one (local calendar).
  return new Date(year, month, 0).getDate();
}

/** The local calendar day of an instant (epoch ms). */
export function calendarDayOf(epochMs: number): CalendarDay {
  const date = new Date(epochMs);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

/** `day` moved by `delta` calendar days (month and year ends handled by `Date`). */
export function addDays(day: CalendarDay, delta: number): CalendarDay {
  const date = new Date(day.year, day.month - 1, day.day + delta);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

/** Local 00:00:00 of a calendar day, epoch seconds. */
function startOfDaySec(day: CalendarDay): number {
  return Math.floor(new Date(day.year, day.month - 1, day.day, 0, 0, 0).getTime() / 1000);
}

/** Local 23:59:59 of a calendar day, epoch seconds. */
function endOfDaySec(day: CalendarDay): number {
  return Math.floor(new Date(day.year, day.month - 1, day.day, 23, 59, 59).getTime() / 1000);
}

/**
 * The period's request bounds (Story 5.4, api-contract §3 «E5 period»):
 * local start (00:00:00) of the first day and end (23:59:59) of the last
 * day, epoch seconds; null for «За всё время» (no params). A preset covers
 * the last `days` days including today (`nowMs`'s local day). Calendar
 * math goes through local `Date` parts, so a DST change inside the range
 * never shifts a bound off midnight. A custom range with an unreadable day
 * is treated as «За всё время» (never sent half-formed).
 */
export function periodBounds(
  period: Period,
  nowMs: number,
): { fromTs: number; toTs: number } | null {
  switch (period.kind) {
    case 'all':
      return null;
    case 'preset': {
      const today = calendarDayOf(nowMs);
      return { fromTs: startOfDaySec(addDays(today, -(period.days - 1))), toTs: endOfDaySec(today) };
    }
    case 'custom': {
      const from = parseDayKey(period.fromDay);
      const to = parseDayKey(period.toDay);
      if (from === null || to === null) {
        return null;
      }
      return { fromTs: startOfDaySec(from), toTs: endOfDaySec(to) };
    }
  }
}
