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
    // A5–A8 (code form, resend countdown, wrong code, expired). Copy from
    // the A5–A8 mocks (Claude Design «Boosty TV - A B C»). A7 uses
    // `error.WrongCode` and clears the field (docs/focus-map.md overrides
    // the mock). `{phone}` is the masked number, `{time}` is m:ss.
    code: {
      step: 'Шаг 2 из 2',
      title: 'Введите код',
      sentTo: 'Код отправлен на {phone}.',
      sentBySmsTo: 'Код отправлен по SMS на {phone}.',
      channels: 'Он может прийти по SMS, в мессенджер или в приложение Boosty.',
      body: 'Код может прийти по SMS, в мессенджер или в приложение Boosty.',
      fieldLabel: 'Код из сообщения',
      fieldPlaceholder: 'Введите код',
      submit: 'Войти',
      resend: 'Выслать повторно',
      resendIn: 'через {time}',
      resendHint: 'Код не пришёл? Можно запросить ещё раз.',
      newCode: 'Выслать новый код',
      changeNumber: 'Изменить номер',
    },
    welcome: {
      /** A1 after the stored session was unreadable and wiped. */
      signInAgain: 'Войдите снова',
    },
  },
  // The signed-in Shell (Story 2.4): wordmark and sidebar sections. Labels
  // exist for every section; app/phaseFlags.ts decides which are rendered.
  shell: {
    wordmark: 'Boosty TV',
    nav: {
      home: 'Главная',
      search: 'Поиск',
      subs: 'Подписки',
      events: 'События',
      settings: 'Настройки',
    },
  },
  home: {
    // Until Epic 3 brings the feed (EXPERIENCE › Shell).
    placeholder: {
      title: 'Лента появится здесь',
      body: 'Новые посты из ваших подписок будут на этом экране.',
    },
  },
  settings: {
    title: 'Настройки',
    version: 'Версия',
    /** Shown when the native versionName cannot be read. */
    versionUnknown: 'неизвестна',
  },
  // Debug-only «Проверка фокуса» (Story 2.4, __DEV__ builds). Not product
  // copy; the screens that use it are not in the release bundle.
  dev: {
    focusCheck: {
      row: 'Проверка фокуса',
      title: 'Проверка фокуса',
      card: 'Карточка {n}',
      openDialog: 'Открыть диалог',
      refill: 'Вернуть 300 карточек',
      empty: 'Карточек нет',
      detailTitle: 'Карточка {n}',
      detailBody: 'Назад вернёт фокус на эту карточку.',
      deleteCard: 'Удалить эту карточку',
      deleteAll: 'Удалить все карточки',
      deleted: 'Удалено. Назад покажет запасной вариант фокуса.',
      dialogTitle: 'Тестовый диалог',
      dialogBody: 'Фокус не уходит за диалог. Назад закрывает его.',
      dialogOk: 'Понятно',
      dialogClose: 'Закрыть',
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
