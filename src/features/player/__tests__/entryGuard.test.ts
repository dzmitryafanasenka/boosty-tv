import { ENTRY_GUARD_MS, createEntryGuard } from '../usePlayerKeys';

const clock = (start = 1_000) => {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
};

describe('createEntryGuard', () => {
  test('the mount window: the first input within ENTRY_GUARD_MS is guarded', () => {
    const c = clock();
    const guard = createEntryGuard(c.now);
    c.advance(ENTRY_GUARD_MS);
    expect(guard.guarded()).toBe(true);
  });

  test('single use: only the first input counts, guarded or not', () => {
    const c = clock();
    const guard = createEntryGuard(c.now);
    expect(guard.guarded()).toBe(true);
    expect(guard.guarded()).toBe(false);
  });

  test('expiry: the first input after ENTRY_GUARD_MS is not guarded, and uses the guard up', () => {
    const c = clock();
    const guard = createEntryGuard(c.now);
    c.advance(ENTRY_GUARD_MS + 1);
    expect(guard.guarded()).toBe(false);
    expect(guard.guarded()).toBe(false);
  });

  test('the first landing re-arms the window (also after the mount window was used)', () => {
    const c = clock();
    const guard = createEntryGuard(c.now);
    expect(guard.guarded()).toBe(true);
    c.advance(10_000);
    guard.landed();
    c.advance(ENTRY_GUARD_MS);
    expect(guard.guarded()).toBe(true);
    expect(guard.guarded()).toBe(false);
  });

  test('only the first landing counts: later landings do not re-arm or move the window', () => {
    const c = clock();
    const guard = createEntryGuard(c.now);
    guard.landed();
    c.advance(ENTRY_GUARD_MS);
    guard.landed();
    c.advance(1);
    expect(guard.guarded()).toBe(false);
    c.advance(10_000);
    guard.landed();
    expect(guard.guarded()).toBe(false);
  });
});
