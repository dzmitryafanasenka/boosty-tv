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
