import { formatCardDate, formatDuration } from '../format';

/** Epoch seconds of a local date-time (the device's zone, like the app). */
const local = (y: number, mo: number, d: number, h = 12, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime() / 1000;
const NOW = new Date(2026, 9, 26, 18, 45).getTime();

describe('formatCardDate (owner decision 2026-10-26)', () => {
  it('today: «сегодня, 14:30»', () => {
    expect(formatCardDate(local(2026, 10, 26, 14, 30), NOW)).toBe('сегодня, 14:30');
    expect(formatCardDate(local(2026, 10, 26, 0, 5), NOW)).toBe('сегодня, 0:05');
  });

  it('yesterday: «вчера»', () => {
    expect(formatCardDate(local(2026, 10, 25, 23, 59), NOW)).toBe('вчера');
    expect(formatCardDate(local(2026, 10, 25, 0, 0), NOW)).toBe('вчера');
  });

  it('this year: «12 окт»', () => {
    expect(formatCardDate(local(2026, 10, 12), NOW)).toBe('12 окт');
    expect(formatCardDate(local(2026, 5, 3), NOW)).toBe('3 мая');
    expect(formatCardDate(local(2026, 1, 1), NOW)).toBe('1 янв');
  });

  it('another year: «12 окт 2025»', () => {
    expect(formatCardDate(local(2025, 10, 12), NOW)).toBe('12 окт 2025');
    expect(formatCardDate(local(2025, 12, 31), NOW)).toBe('31 дек 2025');
  });

  it('yesterday across a month and a year boundary', () => {
    const newYear = new Date(2027, 0, 1, 9, 0).getTime();
    expect(formatCardDate(local(2026, 12, 31, 22, 0), newYear)).toBe('вчера');
    expect(formatCardDate(local(2026, 12, 30, 22, 0), newYear)).toBe('30 дек 2026');
  });

  it('a future time today is still «сегодня»', () => {
    expect(formatCardDate(local(2026, 10, 26, 20, 0), NOW)).toBe('сегодня, 20:00');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [59, '0:59'],
    [2880, '48:00'],
    [3600, '1:00:00'],
    [3960, '1:06:00'],
    [36061, '10:01:01'],
    [61.9, '1:01'],
    [-5, '0:00'],
  ])('%p s → %s', (sec, text) => {
    expect(formatDuration(sec)).toBe(text);
  });
});
