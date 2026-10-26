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

/**
 * ITU-T E.164 country calling codes in service (ITU-T E.164 Annex to the
 * Operational Bulletin: geographic codes and the shared global services).
 * The set is prefix-free, so a phone has at most one matching code. Spare
 * and withdrawn codes (e.g. 259, 384, 388, 671, 684) are left out.
 */
export const CALLING_CODES: ReadonlySet<string> = new Set([
  // 1 digit
  '1', '7',
  // 2 digits
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46',
  '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63',
  '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98',
  // 3 digits, zone 2
  '211', '212', '213', '216', '218', '220', '221', '222', '223', '224', '225', '226', '227',
  '228', '229', '230', '231', '232', '233', '234', '235', '236', '237', '238', '239', '240',
  '241', '242', '243', '244', '245', '246', '247', '248', '249', '250', '251', '252', '253',
  '254', '255', '256', '257', '258', '260', '261', '262', '263', '264', '265', '266', '267',
  '268', '269', '290', '291', '297', '298', '299',
  // zones 3 and 4
  '350', '351', '352', '353', '354', '355', '356', '357', '358', '359', '370', '371', '372',
  '373', '374', '375', '376', '377', '378', '379', '380', '381', '382', '383', '385', '386',
  '387', '389', '420', '421', '423',
  // zone 5
  '500', '501', '502', '503', '504', '505', '506', '507', '508', '509', '590', '591', '592',
  '593', '594', '595', '596', '597', '598', '599',
  // zone 6
  '670', '672', '673', '674', '675', '676', '677', '678', '679', '680', '681', '682', '683',
  '685', '686', '687', '688', '689', '690', '691', '692',
  // zone 8 (with the global services 800, 808, 870, 878, 881–883, 888)
  '800', '808', '850', '852', '853', '855', '856', '870', '878', '880', '881', '882', '883',
  '886', '888',
  // zone 9 (with the global services 979, 991)
  '960', '961', '962', '963', '964', '965', '966', '967', '968', '970', '971', '972', '973',
  '974', '975', '976', '977', '979', '991', '992', '993', '994', '995', '996', '998',
]);

/**
 * Splits a stored E.164 phone into the A2 fields (A11 → A2 prefill), e.g.
 * `+375291234567` → `{ countryCode: '+375', number: '291234567' }`. The
 * country code is found in the ITU-T calling code list (prefix-free, so at
 * most one code matches). Null when the phone is not E.164, the code is not
 * in the list, or the fields would not pass `toE164` again: A2 then opens
 * empty.
 */
export function splitE164(e164: string): { countryCode: string; number: string } | null {
  if (!/^\+\d{8,15}$/.test(e164)) {
    return null;
  }
  const digits = e164.slice(1);
  for (let length = 1; length <= 3; length += 1) {
    const cc = digits.slice(0, length);
    if (CALLING_CODES.has(cc)) {
      const number = digits.slice(length);
      return toE164(`+${cc}`, number) === e164 ? { countryCode: `+${cc}`, number } : null;
    }
  }
  return null;
}
