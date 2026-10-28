import { SESSION_CHECK_COOLDOWN_MS, createSessionCheck } from '../sessionCheck';
import type { ValidateResult } from '../sessionManager';

/** A validate() whose results the test releases, counting the E1s it stands for. */
function fakeValidate() {
  const pending: Array<(result: ValidateResult) => void> = [];
  const validate = jest.fn(
    () =>
      new Promise<ValidateResult>(resolve => {
        pending.push(resolve);
      }),
  );
  const resolveLast = (result: ValidateResult) =>
    pending[pending.length - 1](result);
  return { validate, resolveLast };
}

describe('createSessionCheck', () => {
  let time: number;
  const now = () => time;

  beforeEach(() => {
    time = 1_000_000;
  });

  it('ok → `refetch` once; a second check in the window sends no E1 and is `locked`', async () => {
    const { validate, resolveLast } = fakeValidate();
    const port = createSessionCheck({ validate, now });
    const first = port.check('post');
    resolveLast({ kind: 'ok' });
    await expect(first).resolves.toBe('refetch');
    await expect(port.check('post')).resolves.toBe('locked');
    time += SESSION_CHECK_COOLDOWN_MS - 1;
    await expect(port.check('post')).resolves.toBe('locked');
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('after the cooldown: a new E1 and one more `refetch`', async () => {
    const { validate, resolveLast } = fakeValidate();
    const port = createSessionCheck({ validate, now });
    const first = port.check('feed');
    resolveLast({ kind: 'ok' });
    await first;
    time += SESSION_CHECK_COOLDOWN_MS;
    const second = port.check('feed');
    expect(validate).toHaveBeenCalledTimes(2);
    resolveLast({ kind: 'ok' });
    await expect(second).resolves.toBe('refetch');
  });

  it('concurrent checks share one E1; only the first gets `refetch`', async () => {
    const { validate, resolveLast } = fakeValidate();
    const port = createSessionCheck({ validate, now });
    const a = port.check('player');
    const b = port.check('player');
    expect(validate).toHaveBeenCalledTimes(1);
    resolveLast({ kind: 'ok' });
    await expect(Promise.all([a, b])).resolves.toEqual(['refetch', 'locked']);
  });

  it('keys are independent windows', async () => {
    const { validate, resolveLast } = fakeValidate();
    const port = createSessionCheck({ validate, now });
    const post = port.check('post');
    resolveLast({ kind: 'ok' });
    const feed = port.check('feed');
    resolveLast({ kind: 'ok' });
    await expect(Promise.all([post, feed])).resolves.toEqual([
      'refetch',
      'refetch',
    ]);
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('expired → `expired`, and no E1 again within the window', async () => {
    const { validate, resolveLast } = fakeValidate();
    const port = createSessionCheck({ validate, now });
    const first = port.check('post');
    resolveLast({ kind: 'expired' });
    await expect(first).resolves.toBe('expired');
    await port.check('post');
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it.each<[ValidateResult]>([
    [{ kind: 'failed', error: 'Network' }],
    [{ kind: 'failed', error: 'Server' }],
    [{ kind: 'skipped' }],
  ])('%j → `unverified` for every sharer, and the window is dropped: the next check sends E1 again', async result => {
    const { validate, resolveLast } = fakeValidate();
    const port = createSessionCheck({ validate, now });
    const a = port.check('post');
    const b = port.check('post');
    resolveLast(result);
    await expect(Promise.all([a, b])).resolves.toEqual(['unverified', 'unverified']);
    const next = port.check('post');
    expect(validate).toHaveBeenCalledTimes(2);
    resolveLast({ kind: 'ok' });
    await expect(next).resolves.toBe('refetch');
  });

  it('a caller that can no longer refetch gets `locked` and leaves the `refetch` for the next one', async () => {
    const { validate, resolveLast } = fakeValidate();
    const port = createSessionCheck({ validate, now });
    const gone = port.check('player', () => false);
    resolveLast({ kind: 'ok' });
    await expect(gone).resolves.toBe('locked');
    await expect(port.check('player')).resolves.toBe('refetch');
    await expect(port.check('player')).resolves.toBe('locked');
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('a clock that moved back ends the window: a new E1', async () => {
    const { validate, resolveLast } = fakeValidate();
    const port = createSessionCheck({ validate, now });
    const first = port.check('feed');
    resolveLast({ kind: 'ok' });
    await first;
    time -= 1;
    const second = port.check('feed');
    expect(validate).toHaveBeenCalledTimes(2);
    resolveLast({ kind: 'ok' });
    await expect(second).resolves.toBe('refetch');
  });

  it('a rejecting validate (never expected) is `unverified`', async () => {
    const port = createSessionCheck({
      validate: () => Promise.reject(new Error('x')),
      now,
    });
    await expect(port.check('post')).resolves.toBe('unverified');
  });

  it('reset(): the next check sends a new E1; a check in flight across it gives no `refetch`', async () => {
    const { validate, resolveLast } = fakeValidate();
    const port = createSessionCheck({ validate, now });
    const inFlight = port.check('post');
    port.reset();
    resolveLast({ kind: 'ok' });
    await expect(inFlight).resolves.toBe('locked');
    const next = port.check('post');
    expect(validate).toHaveBeenCalledTimes(2);
    resolveLast({ kind: 'ok' });
    await expect(next).resolves.toBe('refetch');
  });
});
