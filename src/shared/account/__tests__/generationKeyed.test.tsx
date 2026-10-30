import { act } from 'react';
import { createRoot } from 'test-renderer';
import { accountScope } from '../accountScope';
import { captureGeneration, createGenerationKeyedStore, type GenerationKeyedStore } from '../generationKeyed';

let generation = 0;
beforeEach(() => {
  generation = 0;
  jest.spyOn(accountScope, 'generation').mockImplementation(() => generation);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('createGenerationKeyedStore', () => {
  test('keys by the current generation by default, or the given one', () => {
    const store = createGenerationKeyedStore<string>();
    expect(store.key('poll')).toBe('0:poll');
    generation = 3;
    expect(store.key('poll')).toBe('3:poll');
    expect(store.key('poll', 1)).toBe('1:poll');
  });

  test('`get` reads the current generation only; `getAt` any key', () => {
    const store = createGenerationKeyedStore<string>();
    const key = store.key('poll');
    store.set(key, 'option-1');
    expect(store.get('poll')).toBe('option-1');
    generation = 1;
    expect(store.get('poll')).toBeUndefined();
    expect(store.getAt(key)).toBe('option-1');
  });

  test('every change notifies once; deleting nothing does not', () => {
    const store = createGenerationKeyedStore<string>();
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);
    const key = store.key('poll');
    store.set(key, 'a');
    expect(listener).toHaveBeenCalledTimes(1);
    store.delete(key);
    expect(listener).toHaveBeenCalledTimes(2);
    store.delete(key);
    expect(listener).toHaveBeenCalledTimes(2);
    store.set(key, 'b');
    store.reset();
    expect(listener).toHaveBeenCalledTimes(4);
    expect(store.getAt(key)).toBeUndefined();
    unsubscribe();
    store.set(key, 'c');
    expect(listener).toHaveBeenCalledTimes(4);
  });

  test('`deleteIf` deletes only while the entry is still the expected one (identity)', () => {
    const store = createGenerationKeyedStore<{ n: number }>();
    const listener = jest.fn();
    store.subscribe(listener);
    const key = store.key('blog');
    const first = { n: 1 };
    const second = { n: 1 };
    store.set(key, first);
    store.set(key, second);
    expect(store.deleteIf(key, first)).toBe(false);
    expect(store.getAt(key)).toBe(second);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.deleteIf(key, second)).toBe(true);
    expect(store.getAt(key)).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  test('`deleteIf` on a missing key does nothing, also with `expected` undefined', () => {
    const store = createGenerationKeyedStore<string | undefined>();
    const listener = jest.fn();
    store.subscribe(listener);
    expect(store.deleteIf(store.key('poll'), undefined)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  test("an old generation's entry never shows or blocks under the next one", () => {
    const store = createGenerationKeyedStore<string>();
    const oldKey = store.key('poll');
    store.set(oldKey, 'old');
    generation = 1;
    store.set(store.key('poll'), 'new');
    expect(store.deleteIf(oldKey, 'old')).toBe(true);
    expect(store.get('poll')).toBe('new');
  });

  test("`useEntry` renders the current generation's entry and follows changes", async () => {
    const store: GenerationKeyedStore<string> = createGenerationKeyedStore<string>();
    const seen: Array<string | null> = [];
    function Probe() {
      seen.push(store.useEntry('poll'));
      return null;
    }
    const root = createRoot();
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      store.set(store.key('poll'), 'option-2');
    });
    await act(async () => {
      store.delete(store.key('poll'));
    });
    expect(seen).toEqual([null, 'option-2', null]);
    await act(async () => {
      root.unmount();
    });
  });
});

describe('captureGeneration', () => {
  test('true until the generation changes', () => {
    const same = captureGeneration();
    expect(same()).toBe(true);
    generation = 1;
    expect(same()).toBe(false);
    expect(captureGeneration()()).toBe(true);
  });

  test('exposes the generation it captured (read once)', () => {
    generation = 4;
    const same = captureGeneration();
    generation = 5;
    expect(same.generation).toBe(4);
  });
});
