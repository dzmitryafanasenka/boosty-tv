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
  auth: {
    // A2 (form), A4 (invalid number), A9 (too many attempts), A10 (extra
    // verification). Copy from the A2/A4/A9/A10 mocks (Claude Design
    // «Boosty TV - A B C»), with the any-country-code field split.
    phone: {
      step: 'Шаг 1 из 2',
      title: 'Номер телефона',
      body: 'Номер, привязанный к вашему аккаунту Boosty. На него придёт код для входа.',
      countryLabel: 'Код страны',
      numberLabel: 'Номер телефона',
      numberPlaceholder: '900 000-00-00',
      send: 'Получить код',
      back: 'Назад',
      tooManyBody: 'Boosty временно ограничил вход по этому номеру.',
      verificationBody:
        'Boosty попросил подтвердить, что входит человек. Пройти эту проверку с телевизора сейчас нельзя.',
      verificationBody2:
        'Попробуйте войти позже. Если проверка появляется снова, вход через приложение временно недоступен.',
      changeNumber: 'Изменить номер',
      toWelcome: 'На первый экран',
      retry: 'Попробовать снова',
    },
    // A5, minimal in Story 2.2 (the code field and confirm are Story 2.3).
    code: {
      step: 'Шаг 2 из 2',
      title: 'Код из сообщения',
      body: 'Код может прийти по SMS, в мессенджер или в приложение Boosty.',
      changeNumber: 'Изменить номер',
    },
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
