import { runPluralMatrix, runZodMatrix } from '../zodPluralMatrix';

test('Zod matrix passes in Node (default and jitless)', () => {
  const results = runZodMatrix();
  expect(results).toHaveLength(6);
  expect(results.filter(r => !r.pass)).toEqual([]);
});

test('plural matrix passes in Node', () => {
  const results = runPluralMatrix();
  expect(results).toHaveLength(11);
  expect(results.filter(r => !r.pass)).toEqual([]);
});
