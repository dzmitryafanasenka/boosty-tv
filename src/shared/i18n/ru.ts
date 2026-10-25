import type { RuPluralForms } from './plural';

/**
 * Russian UI copy (EXPERIENCE.md › Voice and Tone: plain, calm, «вы»).
 * The only source of user-facing strings; components read it through
 * `t` / `tp` (./index.ts). Plural entries are [one, few, many] tuples.
 *
 * `error.<kind>` covers every AD-5 kind (AppError, then AuthError). Each line
 * says what happened; the screen adds the one action. Unverified server
 * details use the generic copy («Не удалось войти»).
 */
export const ru = {
  welcome: {
    titleHead: 'Boosty',
    titleAccent: ' TV',
    body: 'Видео из ваших подписок Boosty на телевизоре.',
    signIn: 'Войти в Boosty',
    disclaimer:
      'Неофициальный клиент, не связан с Boosty. Вход по номеру телефона и коду.',
  },
  error: {
    // AppError.kind
    SessionExpired: 'Сессия истекла. Войдите снова',
    NoAccess: 'Нет доступа к этому материалу',
    MediaUrlExpired: 'Ссылка на видео устарела. Попробуйте ещё раз',
    NotFound: 'Материал недоступен',
    RateLimited: 'Слишком много запросов. Попробуйте через минуту',
    Client: 'Не удалось выполнить запрос',
    Server: 'Boosty сейчас не отвечает. Попробуйте позже',
    Network: 'Нет подключения к интернету. Проверьте подключение',
    Parse: 'Не удалось загрузить данные',
    // AuthError.kind
    InvalidPhone: 'Проверьте номер телефона',
    WrongCode: 'Код не подошёл',
    CodeExpired: 'Код больше не действует. Запросите новый',
    TooManyAttempts: 'Слишком много попыток. Попробуйте позже',
    VerificationRequired: 'Boosty просит дополнительную проверку',
    Unknown: 'Не удалось войти',
  },
  test: {
    /** Fixture for the plural contract test; never rendered. */
    lesson: ['урок', 'урока', 'уроков'] as RuPluralForms,
  },
} as const;

export type Catalog = typeof ru;
