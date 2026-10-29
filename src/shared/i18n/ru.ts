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
    // A11 Session expired (Story 2.6). Copy from the approved A11 mock.
    expired: {
      title: 'Сессия истекла',
      body: 'Boosty завершил вход на этом телевизоре. Войдите снова — позиции просмотра хранятся в Boosty и не потеряются.',
      relogin: 'Войти снова',
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
    // «Новое в подписках» (Story 3.1, E5). Empty: owner decision 2026-10-26
    // (StateView with one action «Обновить»).
    feed: {
      title: 'Новое в подписках',
      loading: 'Загружаем ленту',
      emptyTitle: 'Новых постов нет',
      emptyBody: 'Когда авторы из ваших подписок опубликуют посты, они появятся здесь.',
      refresh: 'Обновить',
      errorTitle: 'Не удалось загрузить ленту',
      loadMoreError: 'Не удалось загрузить следующие посты.',
      // A non-default filter and an empty page 1 (Story 5.3, FILTER-01).
      filteredEmptyTitle: 'Ничего не найдено',
      filteredEmptyBody: 'С этими фильтрами постов нет.',
      filteredEmptyReset: 'Сбросить фильтры',
    },
    // «Обновить» in the feed's title row (Story 5.1, FEED-03): a forced head
    // refresh of the feed and the subscriptions. The label reads
    // `refreshing` while it runs; a failure shows `refreshFailed` inline.
    refresh: 'Обновить',
    refreshing: 'Обновляем…',
    refreshFailed: 'Не удалось обновить',
    refreshA11y: 'Обновить ленту',
    refreshingA11y: 'Обновляем ленту…',
    // «Продолжить просмотр» (Story 4.7, FR15): the local history of this
    // device (scope label, EXPERIENCE › Voice). `{left}` is «Осталось N мин»
    // (`post.video.status.left`); without a known duration it is left out.
    continue: {
      title: 'Продолжить просмотр · на этом устройстве',
      metaLeft: ' · {left}',
      a11y: '{title}. {author}. {left}',
      a11yNoLeft: '{title}. {author}',
      a11yNoAuthor: '{title}. {left}',
    },
    // Cold start with a stored session and no network (Story 2.5). The
    // session is kept; this is never «Сессия истекла».
    offline: {
      title: 'Нет подключения к интернету',
      body: 'Проверьте подключение телевизора к сети и попробуйте снова.',
    },
  },
  // The filter sheet and its chip (Story 5.3, FILTER-01; AD-18). Every
  // change applies at once (no Apply button). `{value}` is the access
  // label, `{count}` the active filters with its plural word.
  filters: {
    title: 'Фильтры',
    chip: 'Фильтры · {value}',
    chipA11y: 'Фильтры: {value}',
    chipA11yCount: 'Фильтры: {value}. {count}',
    activeCount: ['активный фильтр', 'активных фильтра', 'активных фильтров'] as RuPluralForms,
    accessTitle: 'Доступ',
    access: {
      allowed: 'Доступные мне',
      all: 'Все посты',
      bought: 'Только купленные',
    },
    reset: 'Сбросить',
    // Story 5.4: two or more active sections, the chip reads «Фильтры» and
    // the count; `{count}` is the count with its plural word.
    chipA11yMany: 'Фильтры. {count}',
    // Story 5.4 (FILTER-02): the «Период» row, its list (D9) and the
    // custom-period stepper (D10). `{from}`/`{to}` are `day` values.
    period: {
      title: 'Период',
      all: 'За всё время',
      preset: {
        d7: 'Последние 7 дней',
        d30: 'Последние 30 дней',
        d90: 'Последние 3 месяца',
      },
      custom: 'Свой период…',
      customTitle: 'Свой период',
      hint: '↑ ↓ меняют значение, ← → переход между полями, OK — готово',
      from: 'С',
      to: 'По',
      done: 'Готово',
      invalid: 'Дата «по» раньше даты «с»',
      range: '{from} — {to}',
      day: '{day} {month} {year}',
      field: {
        day: 'день',
        month: 'месяц',
        year: 'год',
      },
      // TalkBack on a stepper field: «С, день: 1».
      fieldA11y: '{group}, {field}: {value}',
    },
    // Story 5.5 (FILTER-03): the «Теги» row (value: the checked titles
    // joined by `separator`, else `none`), its level (D11) and the chip
    // when tags are the one active section (`chipMany`: `{n}` tags).
    tags: {
      title: 'Теги',
      none: 'Все',
      separator: ', ',
      reset: 'Сбросить',
      loading: 'Загружаем теги',
      empty: 'Тегов нет',
      loadMore: 'Загрузить ещё',
      loadingMore: 'Загружаем…',
      retry: 'Повторить',
      error: 'Не удалось загрузить теги',
      chipMany: 'Теги: {n}',
    },
  },
  // Поиск по подпискам (Story 5.6, E6; docs/focus-map.md §4 E): the search
  // runs on «Готово» only; the hint shows before the first query.
  search: {
    fieldLabel: 'Поиск по подпискам',
    placeholder: 'Название или текст публикации',
    hint: 'Введите запрос и нажмите «Готово». Фильтры тоже сужают поиск.',
    loading: 'Ищем…',
    emptyTitle: 'Ничего не найдено',
    emptyBody: 'Проверьте написание или сократите запрос.',
    filteredEmptyBody: 'Проверьте написание или сократите запрос. Фильтры тоже влияют на поиск.',
    resetFilters: 'Сбросить фильтры',
    errorTitle: 'Не удалось выполнить поиск',
    loadMoreError: 'Не удалось загрузить следующие результаты.',
  },
  // Подписки (Story 3.2, E2; docs/focus-map.md §3 C1–C3). Empty: no CTA
  // (C3). `{n}` is the number of tiles shown.
  subs: {
    title: 'Подписки',
    loading: 'Загружаем подписки',
    emptyTitle: 'Подписок пока нет',
    emptyBody: 'Подписаться на авторов можно на сайте или в приложении Boosty. После этого авторы появятся здесь.',
    errorTitle: 'Не удалось загрузить подписки',
    firstOnly: 'Показаны первые {n}',
    // Story 5.2: the label on the account's own blog tile (AuthorCard).
    myBlog: 'Мой блог',
  },
  // Автор (Story 3.3, E3 + E4; docs/focus-map.md §4 D). Missing blog (any
  // E3 404; only `blog_not_found` is verified): «Назад» only, no retry. The header reads
  // «Автор: {title}. {owner}» (or without the owner).
  author: {
    loading: 'Загружаем страницу автора',
    loadingPosts: 'Загружаем публикации',
    a11yHeader: 'Автор: {name}. {title}',
    a11yHeaderNameOnly: 'Автор: {name}',
    emptyTitle: 'Публикаций нет',
    emptyBody: 'Когда автор опубликует посты, они появятся здесь.',
    errorTitle: 'Не удалось загрузить страницу автора',
    postsErrorTitle: 'Не удалось загрузить публикации',
    unavailableTitle: 'Автор недоступен',
    unavailableBody: 'Этой страницы нет или она закрыта.',
    loadMoreError: 'Не удалось загрузить следующие публикации.',
  },
  // Пост (Story 3.4, E8; docs/focus-map.md §4 F). Missing post (E8 404,
  // `not_found` verified): «Назад» only, no retry. Videos are MediaRows
  // (Story 3.5); other blocks are neutral placeholders until Epic 6. `likes` forms carry
  // `{n}`. No comment count anywhere.
  post: {
    loading: 'Загружаем пост',
    unavailableTitle: 'Пост недоступен',
    unavailableBody: 'Этого поста нет или он удалён.',
    errorTitle: 'Не удалось загрузить пост',
    likes: ['{n} лайк', '{n} лайка', '{n} лайков'] as RuPluralForms,
    meta: '{date} · {likes}',
    a11yAuthor: 'Автор: {name}. Открыть страницу автора',
    // Locked post (Story 3.6, EXPERIENCE.md «Honest limits»): plain text,
    // never a price, a subscribe button or a payment link. `{level}` is the
    // post's subscription level name.
    locked: {
      withLevel:
        'Нет доступа. Этот пост доступен подписчикам уровня «{level}». Оформить подписку можно на сайте или в приложении Boosty.',
      noLevel:
        'Нет доступа. Этот пост доступен подписчикам автора. Оформить подписку можно на сайте или в приложении Boosty.',
    },
    block: {
      video: 'Видео',
      image: 'Изображение',
      file: 'Файл',
      audio: 'Аудио',
      poll: 'Опрос',
      unknown: 'Блок',
    },
    // DESIGN.md MediaRow (Story 3.5): «Видео N», the title, the duration.
    // Story 4.2: the status from the ProgressRepository (never a fake one);
    // `{n}` in `left` is whole minutes, rounded up. The row's label ends with
    // the status (`a11yStatus`).
    video: {
      label: 'Видео {n}',
      a11y: '{label}. {title}. {duration}',
      a11yNoTitle: '{label}. {duration}',
      a11yNoDuration: '{label}. {title}',
      a11yLabelOnly: '{label}',
      a11yStatus: '{base}. {status}',
      status: {
        notStarted: 'Не начато',
        left: 'Осталось {n} мин',
        watched: 'Просмотрено',
      },
    },
    // The primary button under the header (Story 4.1, owner decision
    // 2026-10-27, option A). A multi-video post names the target video
    // (Story 4.2: the first unfinished one). «Продолжить» when it has
    // progress; «С начала» (to its right) starts it at 0.
    watch: 'Смотреть',
    watchVideo: 'Смотреть · {label}',
    continue: 'Продолжить',
    continueVideo: 'Продолжить · {label}',
    restart: 'С начала',
  },
  // G Плеер (Story 4.1, docs/focus-map.md §4 G). «Настройки» and the
  // quality sheet are Story 4.3. Times are `formatDuration`; `{remaining}`
  // already carries no sign. `{height}` is a progressive height in pixels.
  player: {
    loading: 'Загружаем видео',
    buffering: 'Загрузка',
    surface: 'Видео. OK — пауза, влево и вправо — перемотка',
    timeline: 'Позиция {elapsed} из {duration}',
    timelineNoDuration: 'Позиция {elapsed}',
    remaining: '−{remaining}',
    seekTarget: 'Перемотка к {time}',
    play: 'Воспроизвести',
    pause: 'Пауза',
    errorTitle: 'Не удалось воспроизвести видео',
    errorBody: 'Попробуйте ещё раз или вернитесь к посту.',
    noAccessTitle: 'Нет доступа к этому видео',
    noAccessBody: 'Этот пост сейчас недоступен для вашей подписки.',
    unavailableTitle: 'Видео недоступно',
    unavailableBody: 'Этого видео больше нет в посте.',
    // Story 4.4: the one automatic recovery after an engine error (no action).
    recovering: 'Восстанавливаем воспроизведение…',
    settings: 'Настройки',
    // The ±10 s controls (Story 4.3 owner decision 2026-10-28).
    back10: 'Назад на 10 секунд',
    forward10: 'Вперёд на 10 секунд',
    // The digits inside the ±10 s SVG icons (ADR 0013).
    glyph: {
      ten: '10',
    },
    quality: {
      title: 'Качество',
      auto: 'Авто',
      autoAt: 'Авто · {height}p',
      height: '{height}p',
    },
  },
  common: {
    retry: 'Повторить',
    back: 'Назад',
  },
  // DESIGN.md PostCard (Story 3.1). `{n}` is the video count. The card's
  // accessibility label reads «Видео. {title}. {author}, {date}.».
  postCard: {
    badge: {
      video: 'Видео',
      videos: '{n} видео',
      audio: 'Аудио',
      text: 'Текст и фото',
      poll: 'Опрос',
      file: 'Файл',
      locked: 'Нет доступа',
    },
    untitled: 'Без названия',
    /** After the author name, which ellipsizes; the date never does. */
    metaDate: ' · {date}',
    // The pin badge on a pinned card's preview, top right (the Author page;
    // Boosty keeps the pinned post first; owner decisions 2026-10-27).
    pinned: '📌',
    a11yPinned: 'Закреплено. {label}',
    a11y: '{badge}. {title}. {author}, {date}.',
    a11yDuration: '{badge}. {title}. {author}, {date}. Длительность {duration}.',
  },
  // DESIGN.md AuthorCard: «{name}. {title}» — the owner's name first, the
  // blog title second (owner decision 2026-10-27); the main line alone when
  // there is no second line.
  authorCard: {
    a11y: '{name}. {title}',
    // A labelled tile («Мой блог», Story 5.2): «Мой блог. {name}. {title}».
    a11yLabelled: '{label}. {rest}',
  },
  // Card dates (owner decision 2026-10-26), device local time:
  // «сегодня, 14:30» / «вчера» / «12 окт» (current year) / «12 окт 2025».
  date: {
    today: 'сегодня, {time}',
    yesterday: 'вчера',
    dayMonth: '{day} {month}',
    dayMonthYear: '{day} {month} {year}',
    month: {
      jan: 'янв',
      feb: 'фев',
      mar: 'мар',
      apr: 'апр',
      may: 'мая',
      jun: 'июн',
      jul: 'июл',
      aug: 'авг',
      sep: 'сен',
      oct: 'окт',
      nov: 'ноя',
      dec: 'дек',
    },
    // Story 5.4: full month names, genitive («1 августа 2026») and
    // nominative (the stepper's month field for TalkBack).
    monthGenitive: {
      jan: 'января',
      feb: 'февраля',
      mar: 'марта',
      apr: 'апреля',
      may: 'мая',
      jun: 'июня',
      jul: 'июля',
      aug: 'августа',
      sep: 'сентября',
      oct: 'октября',
      nov: 'ноября',
      dec: 'декабря',
    },
    monthName: {
      jan: 'январь',
      feb: 'февраль',
      mar: 'март',
      apr: 'апрель',
      may: 'май',
      jun: 'июнь',
      jul: 'июль',
      aug: 'август',
      sep: 'сентябрь',
      oct: 'октябрь',
      nov: 'ноябрь',
      dec: 'декабрь',
    },
  },
  // The persistent badge of the debug-only demo mode (Story 2.5).
  demo: {
    badge: 'ДЕМО',
  },
  settings: {
    title: 'Настройки',
    version: 'Версия',
    /** Shown when the native versionName cannot be read. */
    versionUnknown: 'неизвестна',
    signOut: {
      row: 'Выйти из аккаунта',
    },
  },
  // The sign-out confirmation (Story 2.7, docs/focus-map.md K4); copy from
  // the approved Settings mock.
  dialog: {
    signOut: {
      title: 'Выйти из аккаунта?',
      body: 'Чтобы снова войти, понадобятся номер телефона и код из сообщения. Это коснётся всех, кто смотрит на этом телевизоре.',
      cancel: 'Отмена',
      confirm: 'Выйти',
      error: 'Не удалось выйти из аккаунта. Попробуйте ещё раз.',
    },
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
    // Debug-only live refresh check (Story 2.5): corrupts the in-memory
    // access token, then E1 → 401 → refresh → retry.
    sessionCheck: {
      row: 'Проверка обновления сессии',
    },
    // Debug-only A11 trigger (Story 2.6): `expired` in memory only.
    expiredCheck: {
      row: 'Проверка: сессия истекла',
    },
    // Debug-only player recovery check (Story 4.4): the next video source
    // gets a broken URL in memory (one engine error → the recovery).
    breakVideo: {
      row: 'Сломать следующую ссылку видео',
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
