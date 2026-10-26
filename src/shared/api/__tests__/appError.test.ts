import { AppError, errorCode, isAppError, kindForStatus, retriesFor } from '../appError';

test.each([
  [404, 'NotFound'],
  [429, 'RateLimited'],
  [500, 'Server'],
  [599, 'Server'],
  [400, 'Client'],
  [401, 'Client'],
  [403, 'Client'],
  [410, 'Client'],
  [302, 'Client'],
])('HTTP %s → %s (403 is never SessionExpired)', (status, kind) => {
  expect(kindForStatus(status)).toBe(kind);
});

test('AD-6: GET Network 2, Server 1, nothing else; mutations never', () => {
  expect(retriesFor('GET', 'Network')).toBe(2);
  expect(retriesFor('GET', 'Server')).toBe(1);
  for (const kind of ['Client', 'RateLimited', 'NotFound', 'Parse', 'SessionExpired'] as const) {
    expect(retriesFor('GET', kind)).toBe(0);
  }
  for (const method of ['POST', 'PUT', 'DELETE']) {
    expect(retriesFor(method, 'Network')).toBe(0);
    expect(retriesFor(method, 'Server')).toBe(0);
  }
});

test('the message is the kind only; errorCode reads only `error`', () => {
  const error = new AppError('Server', 503);
  expect(error.message).toBe('Server');
  expect(error.status).toBe(503);
  expect(isAppError(error)).toBe(true);
  expect(isAppError(new Error('Server'))).toBe(false);
  expect(errorCode({ error: 'invalid_grant', error_description: 'x' })).toBe('invalid_grant');
  expect(errorCode({ error_description: 'invalid_grant' })).toBeUndefined();
  expect(errorCode(['x'])).toBeUndefined();
});
