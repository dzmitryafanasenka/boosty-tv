import { createLogger } from '../../services/logger';
import { createAccountScope } from '../accountScope';
import { defineAccountScoped } from '../defineAccountScoped';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const logger = createLogger();
  const scope = createAccountScope({ logger: () => logger });
  const calls: string[] = [];
  const store = (name: string, reset?: () => void | Promise<void>) =>
    defineAccountScoped(name, () => {
      calls.push(name);
      return reset?.();
    });
  return { scope, logger, calls, store };
}

describe('AccountScope', () => {
  test('reset: the gate (first registered) first, then the others in order; generation +1', async () => {
    const { scope, calls, store } = setup();
    scope.register(store('session'), store('focusRestoration'), store('authFlow'));
    expect(scope.registeredNames()).toEqual(['session', 'focusRestoration', 'authFlow']);
    expect(scope.generation()).toBe(0);
    await expect(scope.reset()).resolves.toEqual({ failed: [] });
    expect(calls).toEqual(['session', 'focusRestoration', 'authFlow']);
    expect(scope.generation()).toBe(1);
  });

  test('the other stores start only after the gate resolved', async () => {
    const { scope, calls, store } = setup();
    const gate = deferred();
    scope.register(store('session', () => gate.promise), store('other'));
    const done = scope.reset();
    await Promise.resolve();
    expect(calls).toEqual(['session']);
    gate.resolve();
    await done;
    expect(calls).toEqual(['session', 'other']);
  });

  test('a gate failure rejects and touches no other store; a retry runs again', async () => {
    const { scope, calls, store, logger } = setup();
    const error = new Error('keychain');
    let fail = true;
    scope.register(
      store('session', () => {
        if (fail) {
          throw error;
        }
      }),
      store('other'),
    );
    await expect(scope.reset()).rejects.toBe(error);
    expect(calls).toEqual(['session']);
    expect(JSON.stringify(logger.entries())).toContain('"outcome":"kept"');
    fail = false;
    await expect(scope.reset()).resolves.toEqual({ failed: [] });
    expect(calls).toEqual(['session', 'session', 'other']);
    // The failed attempt did not bump it.
    expect(scope.generation()).toBe(1);
  });

  test('a failing non-gate store is reported; the rest still reset', async () => {
    const { scope, calls, store, logger } = setup();
    scope.register(
      store('session'),
      store('broken', () => Promise.reject(new Error('x'))),
      store('last'),
    );
    await expect(scope.reset()).resolves.toEqual({ failed: ['broken'] });
    expect(calls).toEqual(['session', 'broken', 'last']);
    const [entry] = logger.entries();
    expect(entry.fields).toEqual({
      stores: 'session,broken,last',
      outcome: 'partial',
      failed: 'broken',
    });
  });

  test('single flight: a reset while one runs gets the same promise', async () => {
    const { scope, calls, store } = setup();
    const gate = deferred();
    scope.register(store('session', () => gate.promise));
    const first = scope.reset();
    const second = scope.reset();
    expect(second).toBe(first);
    gate.resolve();
    await first;
    expect(calls).toEqual(['session']);
    expect(scope.generation()).toBe(1);
  });

  test('the generation is bumped once the gate succeeded, before the other stores run', async () => {
    const { scope } = setup();
    const gate = deferred();
    const captured = scope.generation();
    const seenByOther: number[] = [];
    scope.register(
      defineAccountScoped('session', () => gate.promise),
      defineAccountScoped('other', () => {
        seenByOther.push(scope.generation());
      }),
    );
    const done = scope.reset();
    await Promise.resolve();
    expect(scope.generation()).toBe(captured);
    gate.resolve();
    await done;
    expect(seenByOther).toEqual([captured + 1]);
    expect(scope.generation()).toBe(captured + 1);
  });

  test('a failed gate leaves the generation unchanged', async () => {
    const { scope, store } = setup();
    scope.register(store('session', () => Promise.reject(new Error('keychain'))));
    await expect(scope.reset()).rejects.toThrow('keychain');
    expect(scope.generation()).toBe(0);
  });

  test('a duplicate name and a registration after seal() throw', () => {
    const { scope, store } = setup();
    scope.register(store('session'));
    expect(() => scope.register(store('session'))).toThrow(/twice/);
    scope.seal();
    expect(() => scope.register(store('late'))).toThrow(/sealed/);
    expect(scope.registeredNames()).toEqual(['session']);
  });

  test('logs only the store names and the outcome, after the stores were reset', async () => {
    const { scope, store, logger } = setup();
    logger.info('auth', 'old account entry');
    scope.register(store('session'), defineAccountScoped('logger', () => logger.clear()));
    await scope.reset();
    expect(logger.entries()).toHaveLength(1);
    expect(logger.entries()[0]).toMatchObject({
      scope: 'account',
      message: 'reset',
      fields: { stores: 'session,logger', outcome: 'ok' },
    });
  });
});

describe('AccountScope.guard (Story 2.8)', () => {
  test('no reset since guard(): the value is committed', async () => {
    const { scope, store } = setup();
    scope.register(store('session'));
    const written: string[] = [];
    const write = scope.guard<string>('progress', value => {
      written.push(value);
    });
    expect(write.isCurrent()).toBe(true);
    await expect(write.commit('A')).resolves.toBe(true);
    expect(written).toEqual(['A']);
  });

  test('a reset in between: the value is dropped, logged with the store name and no data', async () => {
    const { scope, store, logger } = setup();
    scope.register(store('session'));
    const written: string[] = [];
    const write = scope.guard<string>('progress', value => {
      written.push(value);
    });
    await scope.reset();
    expect(write.isCurrent()).toBe(false);
    await expect(write.commit('secret-value')).resolves.toBe(false);
    expect(written).toEqual([]);
    const dropped = logger.entries().filter(e => e.message === 'stale write dropped');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ scope: 'account', fields: { store: 'progress' } });
    expect(JSON.stringify(logger.entries())).not.toContain('secret-value');
  });

  test('a guard taken after the reset commits', async () => {
    const { scope, store } = setup();
    scope.register(store('session'));
    await scope.reset();
    const written: number[] = [];
    const write = scope.guard<number>('progress', v => {
      written.push(v);
    });
    await expect(write.commit(7)).resolves.toBe(true);
    expect(written).toEqual([7]);
  });

  test('a failed gate does not invalidate the guard', async () => {
    const { scope, store } = setup();
    scope.register(store('session', () => Promise.reject(new Error('keychain'))));
    const write = scope.guard<string>('progress', () => {});
    await expect(scope.reset()).rejects.toThrow('keychain');
    await expect(write.commit('A')).resolves.toBe(true);
  });

  test("the writer's rejection propagates", async () => {
    const { scope } = setup();
    const write = scope.guard<string>('progress', () => Promise.reject(new Error('disk')));
    await expect(write.commit('A')).rejects.toThrow('disk');
  });
});
