/**
 * Hand-written Russian plural selector (CLDR "ru" cardinal rules for
 * non-negative integers). Hermes ships without full Intl.PluralRules data on
 * Android, so the app does not rely on Intl for plurals.
 *
 * - one:  n % 10 === 1 && n % 100 !== 11            (1, 21, 101 ...)
 * - few:  n % 10 in 2..4 && n % 100 not in 12..14   (2, 22, 104 ...)
 * - many: everything else                          (0, 5, 11, 12, 25 ...)
 *
 * Contract: counts must be validated at the API boundary (Zod: non-negative
 * integer) before they reach UI formatting; an invalid value throws here so
 * the bug surfaces in tests instead of rendering a wrong form.
 */
export type RuPluralCategory = 'one' | 'few' | 'many';

/** Forms in category order: [one, few, many], e.g. ['лайк', 'лайка', 'лайков']. */
export type RuPluralForms = readonly [one: string, few: string, many: string];

export function selectRuPluralCategory(n: number): RuPluralCategory {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(
      `selectRuPluralCategory expects a non-negative integer, got ${n}`,
    );
  }
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return 'one';
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'few';
  }
  return 'many';
}

export function pluralRu(n: number, forms: RuPluralForms): string {
  switch (selectRuPluralCategory(n)) {
    case 'one':
      return forms[0];
    case 'few':
      return forms[1];
    case 'many':
      return forms[2];
  }
}
