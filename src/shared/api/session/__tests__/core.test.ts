import type { ReadResult, SecureStore } from '../../../platform/secureStore';
import { createLogger } from '../../../services/logger';
import type { StoredSession } from '../codec';
import { createSessionCore } from '../core';
import type { SessionStatus } from '../types';

const SESSION: StoredSession = {
  v: 1,
  accessToken: 'a'.repeat(64),
  refreshToken: 'r'.repeat(64),
  expiresAt: 1_800_000_000_000,
  accountId: '1001',
};

type Deferred = { resolve: () => void; reject: (error: Error) => void };

/** A store whose writes and clears settle only when the test says so. */
function manualStore(name: string, events: string[]) {
  const pending: Deferred[] = [];
  const op = (label: string) =>
    jest.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          events.push(`${name}.${label}:start`);
          pending.push({
            resolve: () => {
              events.push(`${name}.${label}:end`);
              resolve();
            },
            reject,
          });
        }),
    );
  const store = {
    read: jest.fn(async (): Promise<ReadResult> => ({ kind: 'empty' })),
    write: op('write'),
    clear: op('clear'),
  };
  return { store: store as SecureStore & typeof store, pending };
}

const flush = () => new Promise<void>(resolve => setImmediate(() => resolve()));

function setup() {
  const events: string[] = [];
  const session = manualStore('session', events);
  const phone = manualStore('phone', events);
  const logger = createLogger();
  const core = createSessionCore({ sessionStore: session.store, phoneStore: phone.store, logger });
  return { core, events, session, phone, logger };
}

describe('store queue', () => {
  test('runs writes and clears one at a time, in call order, across both stores', async () => {
    const { core, events, session, phone } = setup();
    const a = core.writePhone('+375291234567');
    const b = core.writeSession('{}');
    const c = core.clearSession();
    await flush();
    expect(events).toEqual(['phone.write:start']);
    phone.pending[0].resolve();
    await flush();
    expect(events).toEqual(['phone.write:start', 'phone.write:end', 'session.write:start']);
    session.pending[0].resolve();
    await flush();
    session.pending[1].resolve();
    await Promise.all([a, b, c]);
    expect(events).toEqual([
      'phone.write:start',
      'phone.write:end',
      'session.write:start',
      'session.write:end',
      'session.clear:start',
      'session.clear:end',
    ]);
  });

  test('a rejected op rejects its caller only; the next op still runs', async () => {
    const { core, events, session } = setup();
    const failed = core.writeSession('{}');
    const next = core.clearSession();
    await flush();
    session.pending[0].reject(new Error('write failed'));
    await expect(failed).rejects.toThrow('write failed');
    await flush();
    expect(events).toEqual(['session.write:start', 'session.clear:start']);
    session.pending[1].resolve();
    await expect(next).resolves.toBeUndefined();
  });

  test('writeSessionIf runs its guard inside the queued op, after earlier ops', async () => {
    const { core, session } = setup();
    core.adoptSignedIn(SESSION);
    const g = core.generation();
    const earlier = core.clearSession();
    const guarded = core.writeSessionIf(SESSION, () => core.isCurrent(g));
    // The generation changes while the earlier op holds the queue.
    core.bumpGeneration();
    await flush();
    session.pending[0].resolve();
    await earlier;
    await expect(guarded).resolves.toBe('stale');
    expect(session.store.write).not.toHaveBeenCalled();
  });

  test('writeSessionIf writes the encoded session when the guard holds', async () => {
    const { core, session } = setup();
    const saved = core.writeSessionIf(SESSION, () => true);
    await flush();
    session.pending[0].resolve();
    await expect(saved).resolves.toBe('saved');
    expect(session.store.write).toHaveBeenCalledWith(JSON.stringify(SESSION));
  });

  test('reads are not queued', async () => {
    const { core, session, phone } = setup();
    const write = core.writeSession('{}');
    await flush();
    await expect(core.readSession()).resolves.toEqual({ kind: 'empty' });
    await expect(core.readPhone()).resolves.toEqual({ kind: 'empty' });
    expect(phone.store.read).toHaveBeenCalledTimes(1);
    session.pending[0].resolve();
    await write;
  });
});

describe('setStatus', () => {
  test('dedupes: the same status notifies and logs nothing', () => {
    const { core, logger } = setup();
    const listener = jest.fn();
    core.subscribe(listener);
    core.setStatus('signedOut');
    expect(listener).not.toHaveBeenCalled();
    core.setStatus('signedIn');
    core.setStatus('signedIn');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(logger.entries().filter(e => e.message === 'status')).toHaveLength(1);
  });

  test('notifies a snapshot: a listener added or removed during a notification does not change it', () => {
    const { core } = setup();
    const calls: string[] = [];
    const late = jest.fn();
    let unsubscribeSecond = () => {};
    core.subscribe(status => {
      calls.push(`first:${status}`);
      unsubscribeSecond();
      core.subscribe(late);
    });
    unsubscribeSecond = core.subscribe(status => calls.push(`second:${status}`));
    core.setStatus('signedIn');
    expect(calls).toEqual(['first:signedIn', 'second:signedIn']);
    expect(late).not.toHaveBeenCalled();
  });

  test('unsubscribe stops notifications', () => {
    const { core } = setup();
    const seen: SessionStatus[] = [];
    const unsubscribe = core.subscribe(status => seen.push(status));
    core.setStatus('signedIn');
    unsubscribe();
    core.setStatus('expired');
    expect(seen).toEqual(['signedIn']);
  });
});

describe('generation and transitions', () => {
  test('isCurrent holds only for the latest generation', () => {
    const { core } = setup();
    const g = core.generation();
    expect(core.isCurrent(g)).toBe(true);
    core.bumpGeneration();
    expect(core.isCurrent(g)).toBe(false);
    expect(core.isCurrent(g + 1)).toBe(true);
    core.resetForRestore();
    expect(core.isCurrent(g + 1)).toBe(false);
  });

  test('adoptRefreshed is false when stale, not signed in or signing out', () => {
    const { core } = setup();
    const next = { ...SESSION, accessToken: 'n'.repeat(64) };
    expect(core.adoptRefreshed(next, core.generation())).toBe(false);
    core.adoptSignedIn(SESSION);
    expect(core.adoptRefreshed(next, core.generation() - 1)).toBe(false);
    core.beginSignOut();
    expect(core.adoptRefreshed(next, core.generation())).toBe(false);
    core.endSignOut();
    expect(core.adoptRefreshed(next, core.generation())).toBe(true);
    expect(core.current()).toBe(next);
  });

  test('markExpired keeps the account id as the previous one and sets expired', () => {
    const { core } = setup();
    core.adoptSignedIn(SESSION);
    expect(core.markExpired()).toBe('1001');
    expect(core.current()).toBeNull();
    expect(core.previousAccountId()).toBe('1001');
    expect(core.getStatus()).toBe('expired');
  });
});

describe('session robustness (spec-session-robustness)', () => {
  test('the same listener subscribed twice is notified twice; after one unsubscribe, once per change', () => {
    const { core } = setup();
    const listener = jest.fn();
    const unsubscribe = core.subscribe(listener);
    core.subscribe(listener);
    core.setStatus('signedIn');
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    core.setStatus('expired');
    expect(listener).toHaveBeenCalledTimes(3);
    core.setStatus('signedOut');
    expect(listener).toHaveBeenCalledTimes(4);
  });

  test('markExpired without a session is a no-op and returns null', () => {
    const { core } = setup();
    const listener = jest.fn();
    core.subscribe(listener);
    expect(core.markExpired()).toBeNull();
    expect(core.getStatus()).toBe('signedOut');
    expect(listener).not.toHaveBeenCalled();
    core.restoreExpired('2002');
    expect(core.markExpired()).toBeNull();
    expect(core.previousAccountId()).toBe('2002');
    expect(core.getStatus()).toBe('expired');
  });

  test('overlapping sign-outs: isSigningOut holds until the last one ends', () => {
    const { core } = setup();
    core.restoreSignedIn(SESSION);
    core.beginSignOut();
    core.beginSignOut();
    core.endSignOut();
    expect(core.isSigningOut()).toBe(true);
    expect(core.adoptRefreshed(SESSION, core.generation())).toBe(false);
    core.endSignOut();
    expect(core.isSigningOut()).toBe(false);
  });
});
