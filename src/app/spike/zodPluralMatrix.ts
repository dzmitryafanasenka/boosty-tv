import { z } from 'zod';
import { pluralRu, type RuPluralForms } from '../../shared/i18n/plural';

/**
 * Story 1.2 spike only. Pure check matrix for Zod 4 and the ru plural
 * selector, run in-app on the device (Hermes) and in Jest (Node).
 * Fixtures are synthetic: no Boosty content, ids or personal data.
 */

export type CheckResult = { name: string; pass: boolean; detail: string };

const blockSchema = z.object({
  type: z.string(),
  content: z.string().optional(),
});

const postSchema = z.object({
  id: z.string(),
  title: z.string(),
  hasAccess: z.boolean(),
  createdAt: z.number().int(),
  data: z.array(blockSchema),
  count: z.object({ likes: z.number().int().nonnegative() }),
});

const validFixture = {
  id: 'synthetic-post-1',
  title: 'Synthetic post',
  hasAccess: true,
  createdAt: 1761350400,
  data: [{ type: 'text', content: 'Hello' }, { type: 'image' }],
  count: { likes: 21 },
};

const extraFieldFixture = { ...validFixture, unknownFutureField: { a: 1 } };

const missingFieldFixture: Partial<typeof validFixture> = { ...validFixture };
delete missingFieldFixture.title;

/** Mirrors zod/v4/core util.allowsEval: does `new Function` work here? */
export function probeFunctionConstructor(): boolean {
  try {
    const F = Function;
    return typeof new F('return 1') === 'function';
  } catch {
    return false;
  }
}

function runZodCases(jitless: boolean): CheckResult[] {
  const suffix = jitless ? ' (jitless)' : ' (default)';
  const params = jitless ? { jitless: true } : undefined;
  const results: CheckResult[] = [];

  const valid = postSchema.safeParse(validFixture, params);
  results.push({
    name: `zod valid fixture${suffix}`,
    pass: valid.success && valid.data.count.likes === 21,
    detail: valid.success ? 'parsed' : valid.error.message,
  });

  const extra = postSchema.safeParse(extraFieldFixture, params);
  results.push({
    name: `zod unknown extra field${suffix}`,
    pass: extra.success && !('unknownFutureField' in extra.data),
    detail: extra.success
      ? 'parsed, extra field stripped'
      : extra.error.message,
  });

  const missing = postSchema.safeParse(missingFieldFixture, params);
  const missingPath = missing.success
    ? ''
    : missing.error.issues.map(issue => issue.path.join('.')).join(',');
  results.push({
    name: `zod missing required field${suffix}`,
    pass: !missing.success && missingPath === 'title',
    detail: missing.success
      ? 'unexpectedly parsed'
      : `failure at ${missingPath}`,
  });

  return results;
}

export function runZodMatrix(): CheckResult[] {
  return [...runZodCases(false), ...runZodCases(true)];
}

const LIKES: RuPluralForms = ['лайк', 'лайка', 'лайков'];

const PLURAL_CASES: ReadonlyArray<readonly [number, string]> = [
  [0, 'лайков'],
  [1, 'лайк'],
  [2, 'лайка'],
  [5, 'лайков'],
  [11, 'лайков'],
  [21, 'лайк'],
  [22, 'лайка'],
  [25, 'лайков'],
  [111, 'лайков'],
];

export function runPluralMatrix(): CheckResult[] {
  const results: CheckResult[] = PLURAL_CASES.map(([n, expected]) => {
    const actual = pluralRu(n, LIKES);
    return {
      name: `plural ${n}`,
      pass: actual === expected,
      detail: `${n} ${actual}`,
    };
  });
  for (const bad of [-1, 1.5]) {
    let threw = false;
    try {
      pluralRu(bad, LIKES);
    } catch (error) {
      threw = error instanceof RangeError;
    }
    results.push({
      name: `plural ${bad} throws`,
      pass: threw,
      detail: threw ? 'RangeError' : 'did not throw',
    });
  }
  return results;
}
