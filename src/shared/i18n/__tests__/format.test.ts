import { formatCardDate, formatCount, formatDuration, formatFileSize, formatStreamStart } from '../format';

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

describe('formatStreamStart (Story 7.1, a scheduled stream)', () => {
  it('today, tomorrow, this year, another year; minutes padded, hours not', () => {
    expect(formatStreamStart(local(2026, 10, 26, 19, 0), NOW)).toBe('сегодня в 19:00');
    expect(formatStreamStart(local(2026, 10, 27, 9, 5), NOW)).toBe('завтра в 9:05');
    expect(formatStreamStart(local(2026, 11, 3, 20, 30), NOW)).toBe('3 ноя в 20:30');
    expect(formatStreamStart(local(2027, 1, 2, 20, 30), NOW)).toBe('2 янв 2027 в 20:30');
  });

  it('a start already past today is still «сегодня»; tomorrow across a year boundary', () => {
    expect(formatStreamStart(local(2026, 10, 26, 8, 0), NOW)).toBe('сегодня в 8:00');
    const lastDay = new Date(2026, 11, 31, 22, 0).getTime();
    expect(formatStreamStart(local(2027, 1, 1, 0, 30), lastDay)).toBe('завтра в 0:30');
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

describe('formatFileSize (Story 6.3)', () => {
  it('binary units; one decimal below 10, else whole; a decimal comma', () => {
    expect(formatFileSize(0)).toBe('0 Б');
    expect(formatFileSize(512)).toBe('512 Б');
    expect(formatFileSize(1024)).toBe('1 КБ');
    expect(formatFileSize(1536)).toBe('1,5 КБ');
    expect(formatFileSize(204800)).toBe('200 КБ');
    expect(formatFileSize(4.5 * 1024 * 1024)).toBe('4,5 МБ');
    expect(formatFileSize(1.2 * 1024 ** 3)).toBe('1,2 ГБ');
    expect(formatFileSize(5000 * 1024 ** 3)).toBe('5000 ГБ');
    expect(formatFileSize(-1)).toBe('0 Б');
    // A value that rounds to 1024 moves to the next unit.
    expect(formatFileSize(1048575)).toBe('1 МБ');
    expect(formatFileSize(1023)).toBe('1023 Б');
  });
});

describe('formatCount (Story 6.5)', () => {
  it('groups thousands with a narrow no-break space', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1210)).toBe('1 210');
    expect(formatCount(1643)).toBe('1 643');
    expect(formatCount(1234567)).toBe('1 234 567');
  });

  it('rounds a fraction; a negative or non-finite value is 0', () => {
    expect(formatCount(12.6)).toBe('13');
    expect(formatCount(-5)).toBe('0');
    expect(formatCount(Number.NaN)).toBe('0');
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('0');
  });
});
