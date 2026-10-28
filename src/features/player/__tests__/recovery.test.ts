import {
  MAX_PLAY_STEP_SEC,
  RECOVERY_BUDGET_SEC,
  countPlayback,
  createRecoveryBudget,
  recoveryTarget,
  takeRecovery,
} from '../recovery';

describe('recoveryTarget (Story 4.4)', () => {
  it('started: the current position, or a pending seek target', () => {
    expect(recoveryTarget({ kind: 'started' }, null, 312)).toBe(312);
    expect(recoveryTarget({ kind: 'started' }, 400, 312)).toBe(400);
  });

  it('before the start: the pending start (an explicit target, the initial seek, 0, else the resume point)', () => {
    expect(recoveryTarget({ kind: 'load', target: 120 }, null, 0)).toBe(120);
    expect(recoveryTarget({ kind: 'load' }, null, 0)).toBeUndefined();
    expect(recoveryTarget({ kind: 'seek', target: 300 }, null, 0)).toBe(300);
    expect(recoveryTarget({ kind: 'first' }, null, 0)).toBe(0);
  });
});

describe('the recovery budget (Story 4.4)', () => {
  it('one automatic recovery; it comes back after 30 s of playback of the started source', () => {
    const budget = createRecoveryBudget();
    expect(takeRecovery(budget)).toBe(true);
    expect(takeRecovery(budget)).toBe(false);
    countPlayback(budget, 100);
    for (let sec = 101; sec < 100 + RECOVERY_BUDGET_SEC; sec += 1) {
      countPlayback(budget, sec);
    }
    expect(budget.available).toBe(false);
    countPlayback(budget, 100 + RECOVERY_BUDGET_SEC);
    expect(budget.available).toBe(true);
    expect(takeRecovery(budget)).toBe(true);
  });

  it('a jump (a seek) or a step back is not playback', () => {
    const budget = createRecoveryBudget();
    takeRecovery(budget);
    countPlayback(budget, 10);
    countPlayback(budget, 10 + MAX_PLAY_STEP_SEC + 1);
    countPlayback(budget, 5);
    expect(budget.played).toBe(0);
    countPlayback(budget, 5 + MAX_PLAY_STEP_SEC);
    expect(budget.played).toBe(MAX_PLAY_STEP_SEC);
  });

  it('nothing counts while the budget is available', () => {
    const budget = createRecoveryBudget();
    countPlayback(budget, 1);
    countPlayback(budget, 2);
    expect(budget).toEqual({ available: true, played: 0, last: 2 });
  });
});
