/**
 * A `jest.mock('../src/app/phaseFlags', …)` factory with some flags
 * overridden (the rest are the shipped values):
 *
 *   jest.mock('../src/app/phaseFlags', () =>
 *     require('../src/test/phaseFlagsMock').phaseFlagsWith({ livePlaque: false }));
 *
 * Story 12.3: flow tests whose subject is not Главная's «в эфире» plaque
 * turn it off, so its bounded E2 + E15 pass does not change the request
 * counts they assert (the plaque has its own flow test, livePlaqueFlow).
 */
export function phaseFlagsWith(overrides: Record<string, boolean>) {
  const actual = jest.requireActual('../app/phaseFlags');
  const flags = { ...actual.phaseFlags, ...overrides };
  return {
    ...actual,
    phaseFlags: flags,
    enabledSections: (f: Record<string, boolean> = flags) => actual.enabledSections(f),
  };
}
