import { t, tp } from '..';
import { ru } from '../ru';

/** AD-5: AppError.kind and AuthError.kind (epic-2-context › Errors). */
const ERROR_KINDS = [
  'SessionExpired',
  'NoAccess',
  'MediaUrlExpired',
  'NotFound',
  'RateLimited',
  'Client',
  'Server',
  'Network',
  'Parse',
  'InvalidPhone',
  'WrongCode',
  'CodeExpired',
  'TooManyAttempts',
  'VerificationRequired',
  'Unknown',
] as const;

describe('ru catalog', () => {
  it('returns welcome copy by key', () => {
    expect(t('welcome.signIn')).toBe('Войти в Boosty');
    expect(t('welcome.body')).toBe(
      'Видео из ваших подписок Boosty на телевизоре.',
    );
  });

  it('has copy for every AD-5 error kind and nothing else', () => {
    expect(Object.keys(ru.error).sort()).toEqual([...ERROR_KINDS].sort());
    for (const kind of ERROR_KINDS) {
      expect(t(`error.${kind}`).length).toBeGreaterThan(0);
    }
  });

  it('uses the verified rate-limit copy for TooManyAttempts', () => {
    expect(t('error.TooManyAttempts')).toBe(
      'Слишком много попыток. Попробуйте позже',
    );
  });

  it.each([
    [1, 'урок'],
    [2, 'урока'],
    [5, 'уроков'],
    [21, 'урок'],
  ])('tp(test.lesson, %i) -> %s', (n, expected) => {
    expect(tp('test.lesson', n)).toBe(expected);
  });

  it.each([-1, 1.5, Number.NaN])('tp throws on invalid count %p', n => {
    expect(() => tp('test.lesson', n)).toThrow(RangeError);
  });

  it('rejects unknown and wrong-kind keys at typecheck', () => {
    // These lines exist for `npm run typecheck`; they are not executed.
    const typeOnly = () => {
      // @ts-expect-error unknown key
      t('welcome.missing');
      // @ts-expect-error a plural entry is not a plain message
      t('test.lesson');
      // @ts-expect-error a plain message is not a plural entry
      tp('welcome.signIn', 1);
    };
    expect(typeof typeOnly).toBe('function');
  });
});
