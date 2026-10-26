/**
 * Phone input rules for A2 (docs/focus-map.md §2, epic 2 "Sign-in"). The
 * country code is editable (any E.164 country code, `+7` by default).
 * Validation follows E.164: country code + national number, 8–15 digits in
 * total. Not a fixed digit count.
 */

export const DEFAULT_COUNTRY_CODE = '+7';

const MIN_DIGITS = 8;
const MAX_DIGITS = 15;
/** Separators the owner may type in the number; removed before checking. */
const NUMBER_SEPARATORS = /[\s()-]/g;

/** Country code field value: always `+` followed by digits only (at most 3). */
export function normalizeCountryCodeInput(raw: string): string {
  return `+${raw.replace(/\D/g, '').slice(0, 3)}`;
}

/**
 * E.164 (`+<digits>`) from the two fields, or null when invalid.
 * Whitespace is trimmed; the number may contain spaces, dashes and brackets.
 */
export function toE164(countryCode: string, nationalNumber: string): string | null {
  const cc = countryCode.trim().replace(/^\+/, '');
  if (!/^[1-9]\d{0,2}$/.test(cc)) {
    return null;
  }
  const national = nationalNumber.trim().replace(NUMBER_SEPARATORS, '');
  if (!/^\d+$/.test(national)) {
    return null;
  }
  // `+7` with the domestic trunk prefix (`8 916 245-18-07`): 11 national
  // digits starting with 8 would be a different, wrong number. `+7` national
  // numbers are 10 digits (`+7 800 …` stays valid).
  if (cc === '7' && national.length === 11 && national.startsWith('8')) {
    return null;
  }
  const total = cc.length + national.length;
  if (total < MIN_DIGITS || total > MAX_DIGITS) {
    return null;
  }
  return `+${cc}${national}`;
}

/**
 * The A5 hint: the country code and the last two digits only. The hidden
 * digits are `•`, grouped from the right as 2, then 3, then all the rest in
 * one group, for example `+375291234567` with `+375` → `+375 •• ••• •• 67`
 * and `+79162451807` with `+7` → `+7 ••• ••• •• 07`. `countryCode` is
 * the A2 country code field the phone was built from. Returns '' when the
 * phone does not start with that code or is not E.164.
 */
export function maskPhone(e164: string, countryCode: string): string {
  const cc = countryCode.trim().replace(/^\+/, '');
  if (!/^\+\d{8,15}$/.test(e164) || !/^\d{1,3}$/.test(cc) || !e164.startsWith(`+${cc}`)) {
    return '';
  }
  const national = e164.slice(1 + cc.length);
  if (national.length < 3) {
    return '';
  }
  const shown = national.slice(-2);
  let hidden = national.length - 2;
  const groups: number[] = [];
  for (const size of [2, 3]) {
    if (hidden <= 0) {
      break;
    }
    const take = Math.min(size, hidden);
    groups.unshift(take);
    hidden -= take;
  }
  if (hidden > 0) {
    groups.unshift(hidden);
  }
  return [`+${cc}`, ...groups.map(n => '•'.repeat(n)), shown].join(' ');
}
