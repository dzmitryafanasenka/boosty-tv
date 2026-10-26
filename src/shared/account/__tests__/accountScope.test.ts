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
    expect(scope.generation()).toBe(2);
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

  test('the generation is bumped as the reset starts, so in-flight writers see it', async () => {
    const { scope, store } = setup();
    const gate = deferred();
    scope.register(store('session', () => gate.promise));
    const captured = scope.generation();
    const done = scope.reset();
    expect(scope.generation()).not.toBe(captured);
    gate.resolve();
    await done;
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
