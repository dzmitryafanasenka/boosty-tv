import { act } from 'react';
import { createRoot } from 'test-renderer';
import type { RestoreTarget } from '../focusRestoration';
import {
  mayTakeScreenFocus,
  restoreElseFirst,
  useLatestRef,
  usePhaseChange,
  type ScreenFocusGate,
} from '../screenFocus';

const ACTION = 'state/x/action';
const gate = (active: boolean, current: string | null): ScreenFocusGate => ({
  isActive: () => active,
  current: () => current,
  sectionItemId: 'nav/x',
});

describe('mayTakeScreenFocus', () => {
  it('is open while nothing, the sidebar item or the StateView action has focus', () => {
    expect(mayTakeScreenFocus(gate(true, null), ACTION)).toBe(true);
    expect(mayTakeScreenFocus(gate(true, 'nav/x'), ACTION)).toBe(true);
    expect(mayTakeScreenFocus(gate(true, ACTION), ACTION)).toBe(true);
  });

  it('is closed after a move elsewhere or while the route is not active', () => {
    expect(mayTakeScreenFocus(gate(true, 'nav/y'), ACTION)).toBe(false);
    expect(mayTakeScreenFocus(gate(true, 'x/card/1'), ACTION)).toBe(false);
    expect(mayTakeScreenFocus(gate(false, null), ACTION)).toBe(false);
    expect(mayTakeScreenFocus(gate(false, 'nav/x'), ACTION)).toBe(false);
  });
});

describe('restoreElseFirst', () => {
  const restoration = (target: RestoreTarget, calls: string[]) => ({
    restore: () => {
      calls.push('restore');
      return target;
    },
    focusInitial: () => calls.push('initial'),
  });

  it('keeps a restored item and does not focus the first one', () => {
    const calls: string[] = [];
    const target: RestoreTarget = { kind: 'item', id: 'a', index: 0, fallback: 'none' };
    expect(restoreElseFirst(restoration(target, calls), () => calls.push('before'))).toBe(target);
    expect(calls).toEqual(['restore']);
  });

  it('keeps the action above (fallback) and does not focus the first one', () => {
    const calls: string[] = [];
    expect(restoreElseFirst(restoration({ kind: 'above' }, calls)).kind).toBe('above');
    expect(calls).toEqual(['restore']);
  });

  it('with nothing to restore, runs beforeFirst, then focuses the first item', () => {
    const calls: string[] = [];
    expect(restoreElseFirst(restoration({ kind: 'none' }, calls), () => calls.push('before')).kind).toBe(
      'none',
    );
    expect(calls).toEqual(['restore', 'before', 'initial']);
  });
});

describe('useLatestRef and usePhaseChange', () => {
  let changes: Array<[string, string | null, string]>;
  let latest: { current: string } | null;

  function Probe({ phase, tag }: { phase: string; tag: string }) {
    latest = useLatestRef(tag);
    usePhaseChange(phase, (now, previous) => changes.push([now, previous, tag]));
    return null;
  }

  beforeEach(() => {
    changes = [];
    latest = null;
  });

  it('runs on the first phase and on every change, with the latest callback', async () => {
    const root = createRoot();
    const render = async (phase: string, tag: string) => {
      await act(async () => {
        root.render(<Probe phase={phase} tag={tag} />);
      });
    };
    await render('loading', 'r1');
    expect(changes).toEqual([['loading', null, 'r1']]);
    // Same phase, a new callback: nothing runs.
    await render('loading', 'r2');
    expect(changes).toHaveLength(1);
    expect(latest?.current).toBe('r2');
    await render('grid', 'r3');
    expect(changes).toEqual([
      ['loading', null, 'r1'],
      ['grid', 'loading', 'r3'],
    ]);
    await render('loading', 'r4');
    expect(changes[2]).toEqual(['loading', 'grid', 'r4']);
    await act(async () => {
      root.unmount();
    });
  });
});
