import { DEFAULT_COUNTRY_CODE, normalizeCountryCodeInput, toE164 } from '../phone';

describe('toE164', () => {
  it.each([
    ['+375 + 9 digits', '+375', '291234567', '+375291234567'],
    ['+7 + 10 digits', '+7', '9162451807', '+79162451807'],
    ['8 digits in total (shortest valid)', '+49', '123456', '+49123456'],
    ['15 digits in total (longest valid)', '+1', '23456789012345', '+123456789012345'],
    ['whitespace around both fields', ' +375 ', '  291234567 ', '+375291234567'],
    ['spaces, dashes and brackets in the number', '+7', '(916) 245-18-07', '+79162451807'],
    ['country code without +', '375', '291234567', '+375291234567'],
    ['+7 800 (10 national digits starting with 8)', '+7', '800 555-35-35', '+78005553535'],
    ['11 national digits starting with 8 for another code', '+375', '80291234567', '+37580291234567'],
  ])('valid: %s', (_name, cc, number, expected) => {
    expect(toE164(cc, number)).toBe(expected);
  });

  it.each([
    ['7 digits in total', '+7', '123456'],
    ['16 digits in total', '+1', '234567890123456'],
    ['empty number', '+7', ''],
    ['empty country code', '+', '291234567'],
    ['country code starting with 0', '+0', '291234567'],
    ['4-digit country code', '+3751', '29123456'],
    ['letters in the number', '+7', '916abc1807'],
    ['+ inside the number', '+7', '+79162451807'],
    ['+7 with the trunk prefix 8', '+7', '8 916 245-18-07'],
    ['+7 with the trunk prefix 8, no separators', '7', '89162451807'],
  ])('invalid: %s', (_name, cc, number) => {
    expect(toE164(cc, number)).toBeNull();
  });
});

describe('normalizeCountryCodeInput', () => {
  it('defaults to +7', () => {
    expect(DEFAULT_COUNTRY_CODE).toBe('+7');
  });

  it.each([
    ['+375', '+375'],
    ['375', '+375'],
    ['', '+'],
    ['+', '+'],
    ['+3a7-5', '+375'],
    ['++44', '+44'],
    ['+12345', '+123'],
  ])('%j → %j', (raw, expected) => {
    expect(normalizeCountryCodeInput(raw)).toBe(expected);
  });
});
