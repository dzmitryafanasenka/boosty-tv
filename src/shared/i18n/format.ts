import { t, tf } from './index';

/**
 * Card dates and durations. Hand-written: Hermes on Android has no full
 * `Intl` data, so no `toLocaleString` is used. Dates use the device's
 * local time zone (`Date` getters).
 */

/** Catalog keys of the months, January first (`date.month.*`, `date.monthGenitive.*`). */
export const MONTH_KEYS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Owner decision 2026-10-26: «сегодня, 14:30» / «вчера» / «12 окт» (current
 * year) / «12 окт 2025». `epochSec` is a publish time in epoch seconds;
 * `nowMs` is the current time in epoch milliseconds.
 */
export function formatCardDate(epochSec: number, nowMs: number = Date.now()): string {
  const date = new Date(epochSec * 1000);
  const now = new Date(nowMs);
  if (sameDay(date, now)) {
    return tf('date.today', {
      time: `${date.getHours()}:${pad2(date.getMinutes())}`,
    });
  }
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, yesterday)) {
    return t('date.yesterday');
  }
  const values = {
    day: String(date.getDate()),
    month: t(`date.month.${MONTH_KEYS[date.getMonth()]}`),
    year: String(date.getFullYear()),
  };
  return date.getFullYear() === now.getFullYear()
    ? tf('date.dayMonth', values)
    : tf('date.dayMonthYear', values);
}

/** `48:00`, `1:06:00`: m:ss below an hour, else h:mm:ss. */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/**
 * A file size (Story 6.3): «512 Б», «12 КБ», «4,5 МБ», «1,2 ГБ» (binary
 * units; one decimal below 10, else whole; a decimal comma).
 */
export function formatFileSize(bytes: number): string {
  const units = ['fileSize.b', 'fileSize.kb', 'fileSize.mb', 'fileSize.gb'] as const;
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // A value that rounds up to 1024 is the next unit (1048575 B → «1 МБ», not «1024 КБ»).
  if (unit < units.length - 1 && Math.round(value) >= 1024) {
    value /= 1024;
    unit += 1;
  }
  let n: string;
  if (unit === 0 || value >= 10) {
    n = String(Math.round(value));
  } else {
    const rounded = Math.round(value * 10) / 10;
    n = (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)).replace('.', ',');
  }
  return tf(units[unit], { n });
}

/** U+202F NARROW NO-BREAK SPACE: the Russian thousands separator. */
export const THOUSANDS_SEPARATOR = ' ';

/**
 * An integer count in Russian style (Story 6.5): groups of three digits
 * split by a narrow no-break space («1 643», «12 000»); 4-digit numbers are
 * grouped too («1 210»). Hand-written (no `Intl` on Hermes). A non-finite
 * or negative value is 0; a fraction is rounded.
 */
export function formatCount(n: number): string {
  const value = Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS_SEPARATOR);
}
