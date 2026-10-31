import { act, useState } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { usePendingConfirm, type PendingConfirm } from '../usePendingConfirm';

let api: PendingConfirm<string>;
let renders = 0;
function Probe() {
  api = usePendingConfirm<string>();
  renders += 1;
  return null;
}

let root: Root;
beforeEach(async () => {
  renders = 0;
  root = createRoot();
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
});

async function run<T>(fn: () => T): Promise<T> {
  let result!: T;
  await act(async () => {
    result = fn();
  });
  return result;
}

describe('usePendingConfirm', () => {
  it('arms on the 1st OK and confirms on the 2nd OK on the same key', async () => {
    expect(api.pending).toBeNull();
    expect(await run(() => api.press('a'))).toBe('armed');
    expect(api.pending).toBe('a');
    expect(await run(() => api.press('a'))).toBe('confirm');
    // A confirm does not disarm by itself: the caller cancels once the send is accepted.
    expect(api.pending).toBe('a');
    await run(() => api.cancel());
    expect(api.pending).toBeNull();
  });

  it('an OK on another key re-arms on that key instead of confirming', async () => {
    await run(() => api.press('a'));
    expect(await run(() => api.press('b'))).toBe('armed');
    expect(api.pending).toBe('b');
    expect(await run(() => api.press('a'))).toBe('armed');
    expect(api.pending).toBe('a');
  });

  it('cancel(key) disarms only that key; cancel() disarms any', async () => {
    await run(() => api.press('a'));
    await run(() => api.cancel('b'));
    expect(api.pending).toBe('a');
    await run(() => api.cancel('a'));
    expect(api.pending).toBeNull();
    await run(() => api.press('b'));
    await run(() => api.cancel());
    expect(api.pending).toBeNull();
  });

  it('a cancel with nothing armed causes no re-render', async () => {
    const before = renders;
    await run(() => api.cancel());
    await run(() => api.cancel('a'));
    expect(renders).toBe(before);
  });

  it('two presses on the same key in one tick: armed, then confirm (no re-render between them)', async () => {
    const results: string[] = [];
    await act(async () => {
      results.push(api.press('a'), api.press('a'));
    });
    expect(results).toEqual(['armed', 'confirm']);
    expect(api.pending).toBe('a');
  });

  it('a cancel then a press in one tick arms again instead of confirming', async () => {
    await run(() => api.press('a'));
    const results: string[] = [];
    await act(async () => {
      api.cancel();
      results.push(api.press('a'));
    });
    expect(results).toEqual(['armed']);
    expect(api.pending).toBe('a');
  });

  it('press and cancel are stable across renders', async () => {
    const { press, cancel } = api;
    await run(() => api.press('a'));
    expect(api.press).toBe(press);
    expect(api.cancel).toBe(cancel);
  });
});

describe('usePendingConfirm: a render-phase cancel on a mode change (as MultipleChoicePoll)', () => {
  let modeApi: PendingConfirm<'retract'>;
  let modeRenders = 0;
  function ModeProbe({ voted }: { voted: boolean }) {
    modeApi = usePendingConfirm<'retract'>();
    const [shown, setShown] = useState(voted);
    if (shown !== voted) {
      setShown(voted);
      modeApi.cancel();
    }
    modeRenders += 1;
    return null;
  }

  it('the prop flips: pending resets in the same update, a bounded number of renders, and a later press arms again', async () => {
    const modeRoot = createRoot();
    await act(async () => modeRoot.render(<ModeProbe voted />));
    await act(async () => {
      modeApi.press('retract');
    });
    expect(modeApi.pending).toBe('retract');
    modeRenders = 0;
    await act(async () => modeRoot.render(<ModeProbe voted={false} />));
    expect(modeApi.pending).toBeNull();
    // The render with the old state, then one re-render for the reset.
    expect(modeRenders).toBeLessThanOrEqual(3);
    let result = '';
    await act(async () => {
      result = modeApi.press('retract');
    });
    expect(result).toBe('armed');
    await act(async () => modeRoot.unmount());
  });
});
