import { act } from 'react';
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

  it('press and cancel are stable across renders', async () => {
    const { press, cancel } = api;
    await run(() => api.press('a'));
    expect(api.press).toBe(press);
    expect(api.cancel).toBe(cancel);
  });
});
