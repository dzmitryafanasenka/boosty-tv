// Вымышленные данные Boosty TV. Общие для экранов, канвы и прототипа.
export const fmt = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
};
export const leftMin = (s) => `осталось ${Math.max(1, Math.round(s / 60))} мин`;

export const AUTHORS = {
  me: { id: 'me', title: 'Дача и вокруг', name: 'Сергей Миронов', ini: 'СМ', hue: 20, mine: true },
  ml: { id: 'ml', title: 'Кухня без спешки', name: 'Марина Лебедева', ini: 'МЛ', hue: 40 },
  ik: { id: 'ik', title: 'Гаражный цех', name: 'Илья Ковалёв', ini: 'ИК', hue: 75 },
  pa: { id: 'pa', title: 'Звёздный час: история, которую не рассказывали в школе', name: 'Пётр Аникин', ini: 'ПА', hue: 255 },
  dg: { id: 'dg', title: 'Ламповый подкаст', name: 'Даша и Глеб', ini: 'ДГ', hue: 330 },
  vs: { id: 'vs', title: 'Рисуем с Верой', name: 'Вера Соколова', ini: 'ВС', hue: 150 },
  ab: { id: 'ab', title: 'Шахматы по пятницам', name: 'Артём Брагин', ini: 'АБ', hue: 200,
        live: { status: 'live', title: 'Разбор партий турнира в Вейк-ан-Зее', viewers: 1204, likes: 356, elapsed: 4350, access: true } },
  on: { id: 'on', title: 'Северные маршруты', name: 'Ольга Никитина', ini: 'ОН', hue: 225 },
  ko: { id: 'ko', title: 'Код на диване', name: 'Кирилл Орлов', ini: 'КО', hue: 110,
        live: { status: 'scheduled', title: 'Стрим: пишем фокус-менеджер для телевизора', when: '31 октября, 19:00', viewers: 0, likes: 12, access: false, level: 'Наставник' } }
};
export const SUBS_ORDER = ['me', 'ml', 'ik', 'pa', 'dg', 'vs', 'ab', 'on', 'ko'];

const V = (key, title, dur, pos = 0, localDur = false) => ({ key, title, dur, pos, localDur });
const T = (...paras) => ({ t: 'text', paras });

export const POSTS = {
  slab: { a: 'ik', ago: 1, title: 'Стол из слэба за выходные: от распила до финишного масла. Часть 2', date: 'Вчера, 20:10', badge: 'Видео', likes: 412, tags: ['Мебель'],
    videos: [V('slab-0', 'Шлифовка и масло', 3250, 1985, true)],
    blocks: [T([['Во второй части шлифуем столешницу от 80 до 240 и наносим масло в три слоя. ', ''], ['Главное — не торопиться между слоями', 'b'], [', иначе масло ляжет пятнами.', '']], [['Список абразивов и масла — в прошлом посте.', 'i']]), { t: 'image', label: 'фото готового стола' }] },
  kapusta: { a: 'ml', ago: 5, title: 'Квашеная капуста по бабушкиному рецепту: два способа и одна ошибка', date: '20 октября', badge: '2 видео', likes: 238, tags: ['Заготовки'],
    videos: [V('kap-0', 'Способ 1. В банке за три дня', 1110, 1104, true), V('kap-1', 'Способ 2. В ведре с яблоками', 1462)],
    blocks: [T([['Два способа: быстрый в банке и долгий в ведре с антоновкой. ', ''], ['Соль только каменная', 'b'], [', йодированная даёт мягкую капусту. ', ''], ['Пропорции', 'u'], [' — 20 г соли на килограмм.', '']], [['Ведро и гнёт брала здесь: ', ''], ['магазин посуды', 'l', 'https://example.ru/vedro'], ['. ', ''], ['', 's'], ['', '']]), { t: 'image', label: 'фото: капуста в банке' }] },
  pirogi: { a: 'ml', ago: 1, title: 'Пироги на неделю: пять начинок из одного теста', date: 'Вчера, 14:10', badge: '3 видео', likes: 501, tags: ['Выпечка'],
    videos: [V('pir-0', 'Тесто', 845, 845, true), V('pir-1', 'Капуста и яйцо', 1105, 552, true), V('pir-2', 'Яблоко и брусника', 980)],
    blocks: [T([['Одно дрожжевое тесто, пять начинок. Замораживаем сырыми и печём по два в день.', '']])] },
  poll2: { a: 'ml', ago: 13, title: 'Голосуем: какой суп готовим в следующем выпуске', date: '12 октября', badge: 'Опрос', kind: 'poll', likes: 64, tags: ['Супы'], videos: [],
    blocks: [T([['Можно выбрать несколько вариантов. Итоги — в воскресенье.', '']]),
      { t: 'poll', id: 'poll2', multi: true, title: 'Какой суп готовим?', counter: 96, answer: [], options: [{ id: 1, text: 'Солянка', count: 41 }, { id: 2, text: 'Щавелевый суп', count: 18 }, { id: 3, text: 'Уха по-фински', count: 27 }, { id: 4, text: 'Грибной с перловкой', count: 52 }] }] },
  khleb: { a: 'ml', ago: 16, title: 'Хлеб на закваске: кормим, ждём, печём', date: '9 октября', badge: 'Видео', likes: 310, tags: ['Выпечка'], bought: true, videos: [V('khl-0', 'Хлеб на закваске', 2410)], blocks: [T([['Купленный выпуск. Закваска с нуля за пять дней.', '']])] },
  medovik: { a: 'ml', ago: 23, title: 'Мастер-класс: торт «Медовик» за один вечер', date: '2 октября', badge: 'Видео', likes: 277, tags: ['Выпечка', 'Десерты'], bought: true, videos: [V('med-0', 'Медовик', 3020)], blocks: [T([['Коржи, крем и сборка. Пропитка — за ночь.', '']])] },
  solyanka: { a: 'ml', ago: 27, title: 'Солянка сборная мясная: полный разбор', date: '28 сентября', badge: 'Видео', likes: 190, tags: ['Супы'], videos: [V('sol-0', 'Солянка', 1580)], blocks: [T([['Пять видов мяса и правильные огурцы.', '']])] },
  borsch: { a: 'ml', ago: 34, title: 'Борщ, который не стыдно подать гостям', date: '21 сентября', badge: 'Видео', likes: 402, tags: ['Супы'], bought: true, videos: [V('bor-0', 'Борщ', 1890)], blocks: [T([['Свёкла отдельно, уксус в конце.', '']])] },
  lecho: { a: 'ml', ago: 41, title: 'Лечо на зиму: три банки за час', date: '14 сентября', badge: 'Видео', likes: 98, tags: ['Заготовки'], videos: [V('lec-0', 'Лечо', 1240)], blocks: [T([['Перец, томаты, никакого уксуса.', '']])] },
  teriberka: { a: 'on', ago: 0, title: 'Териберка зимой: что посмотреть за два дня, если дорогу замело', date: 'Сегодня, 12:40', badge: 'Видео', likes: 356, tags: ['Север'],
    videos: [V('ter-0', 'Териберка зимой', 1938, 232, true)], blocks: [T([['Маршрут, где жить и как не застрять на перевале.', '']])] },
  murmansk: { a: 'on', ago: 10, title: 'Мурманск — Териберка: дорога, заправки и где не ловит связь', date: '15 октября', badge: 'Текст и фото', thumb: 'изображение из поста', likes: 88, tags: ['Север'], videos: [],
    blocks: [T([['130 км, одна заправка и 40 минут без связи.', '']]), { t: 'image', label: 'карта маршрута' }] },
  podcast: { a: 'dg', ago: 0, title: 'Выпуск 87. Почему мы перестали ходить в кино, а потом снова начали', date: 'Сегодня, 09:15', badge: 'Аудио', thumb: 'обложка выпуска', likes: 143, tags: [], videos: [],
    blocks: [{ t: 'audio', title: 'Выпуск 87', dur: 4325 }, T([['Обсуждаем, что изменилось в кинотеатрах за пять лет и почему мы снова туда ходим.', '']], [['Таймкоды — в описании на сайте.', 'i']])] },
  vyp86: { a: 'dg', ago: 11, title: 'Выпуск 86. Сериалы, которые мы бросили на третьей серии', date: '14 октября', badge: 'Аудио', thumb: 'обложка выпуска', likes: 120, tags: [], videos: [],
    blocks: [{ t: 'audio', title: 'Выпуск 86', dur: 3520 }] },
  akvarel: { a: 'vs', ago: 1, title: 'Акварельный скетчинг: свет и тень на городских крышах после дождя', date: 'Вчера, 21:30', badge: 'Текст и фото', thumb: 'изображение из поста', likes: 219, tags: ['Акварель'], videos: [],
    blocks: [T(
      [['Сегодня рисуем крыши после дождя. Мокрая жесть отражает небо, поэтому ', ''], ['самые светлые места оставляем белой бумагой', 'b'], [' и не трогаем до конца.', '']],
      [['Палитра: ультрамарин, жжёная сиена и немного ', ''], ['кадмия жёлтого', 'i'], [' для бликов. Чёрный не берём — тени смешиваем из ультрамарина и сиены.', '']],
      [['Сначала лёгкий карандаш, потом заливка неба по мокрому. Пока лист влажный, кладём тени на скатах.', '']],
      [['Когда лист подсох, прорисовываем трубы и антенны сухой кистью. ', ''], ['Не больше трёх касаний на деталь', 'u'], [', иначе цвет станет грязным.', '']],
      [['Последний шаг — отражения в лужах. Те же цвета, что у неба, но на тон темнее.', '']],
      [['В следующий раз попробуем ночной город с фонарями.', '']]),
      { t: 'image', label: 'скетч: крыши, шаг 1' }, { t: 'image', label: 'скетч: крыши, готово' }, { t: 'unsupported' }] },
  bumaga: { a: 'vs', ago: 7, title: 'Как выбрать бумагу для акварели и не переплатить', date: '18 октября', badge: 'Видео', likes: 160, tags: ['Акварель'], videos: [V('bum-0', 'Бумага', 1320)], blocks: [] },
  poll1: { a: 'pa', ago: 1, title: 'Какую эпоху разбираем в ноябре? Голосуем до пятницы', date: 'Вчера, 18:05', badge: 'Опрос', kind: 'poll', likes: 77, tags: [], videos: [],
    blocks: [T([['Победитель станет темой большой лекции в ноябре.', '']]),
      { t: 'poll', id: 'poll1', multi: false, title: 'Тема ноябрьской лекции', counter: 214, answer: [], options: [{ id: 1, text: 'Смутное время', count: 81 }, { id: 2, text: 'Петровские реформы', count: 58 }, { id: 3, text: 'Новгородская республика', count: 45 }, { id: 4, text: 'Золотая Орда', count: 30 }] }] },
  novgorod: { a: 'pa', ago: 3, title: 'Почему Новгород не стал столицей: торговые пути XII века', date: '22 октября', badge: 'Видео', likes: 640, tags: [], videos: [V('nov-0', 'Лекция', 4120, 2880, true)], blocks: [] },
  smuta: { a: 'pa', ago: 17, title: 'Лекция для уровня «Историк»: Смутное время глазами иностранцев', date: '8 октября', badge: 'Нет доступа', locked: true, thumb: 'тизер', likes: 95, tags: [], videos: [],
    teaser: 'Записки Маржерета, Буссова и Масы — что видели иностранцы.', blocks: [] },
  file: { a: 'ik', ago: 3, title: 'Чертежи верстака и список материалов', date: '22 октября', badge: 'Файл', kind: 'file', likes: 132, tags: ['Мебель'], videos: [],
    blocks: [T([['Чертежи в PDF, размеры в миллиметрах. Крепёж брал ', ''], ['в этом магазине', 'l', 'https://example.ru/krepezh'], ['.', '']]),
      { t: 'file', name: 'verstak_chertezhi.pdf', size: '2,4 МБ' }, { t: 'ext', host: 'YouTube', title: 'Как собрать верстак: обзор столярного зажима' }] },
  taburet: { a: 'ik', ago: 15, title: 'Табурет без единого гвоздя: соединение «ласточкин хвост»', date: '10 октября', badge: '3 видео', likes: 280, tags: ['Мебель'],
    videos: [V('tab-0', 'Разметка', 610), V('tab-1', 'Запилы', 940), V('tab-2', 'Сборка', 720)], blocks: [] },
  locked: { a: 'ko', ago: 2, title: 'Архитектура TV-клиента: закрытый разбор для уровня «Наставник»', date: '23 октября', badge: 'Нет доступа', locked: true, thumb: 'тизер', likes: 51, tags: [], videos: [],
    teaser: 'Как устроить фокус, Back и восстановление списков в приложении для телевизора.', blocks: [] },
  tvplayer: { a: 'ko', ago: 4, title: 'Пишем медиаплеер для телевизора: буферизация и сетевые ошибки', date: '21 октября', badge: 'Видео', likes: 330, tags: [], videos: [V('tvp-0', 'Медиаплеер', 2462, 2100, true)], blocks: [] },
  linter: { a: 'ko', ago: 19, title: 'Конфиг линтера и шаблон проекта из стрима', date: '6 октября', badge: 'Файл', kind: 'file', likes: 40, tags: [], videos: [], blocks: [{ t: 'file', name: 'template.zip', size: '86 КБ' }] },
  karokann: { a: 'ab', ago: 8, title: 'Дебют Каро-Канн за 40 минут: схемы для клубного уровня', date: '17 октября', badge: 'Видео', likes: 205, tags: ['Дебюты'], videos: [V('kar-0', 'Каро-Канн', 2400)], blocks: [] },
  abzap: { a: 'ab', ago: 15, title: 'Запись эфира: разбор партий 10 октября', date: '10 октября', badge: 'Видео', likes: 180, tags: ['Эфиры'], videos: [V('abz-0', 'Запись эфира', 6100)], blocks: [] },
  teplica: { a: 'me', ago: 20, title: 'Теплица из поликарбоната: итоги сезона', date: '5 октября', badge: 'Видео', likes: 14, tags: [], videos: [V('tep-0', 'Итоги сезона', 900)], blocks: [] }
};
Object.keys(POSTS).forEach((k) => { POSTS[k].id = k; });

export const CONT = [['slab', 0], ['novgorod', 0], ['pirogi', 1], ['tvplayer', 0], ['teriberka', 0]];
export const FEED = ['teriberka', 'live:ab', 'podcast', 'akvarel', 'poll1', 'locked', 'file', 'kapusta'];
export const OLD = ['bumaga', 'karokann', 'murmansk', 'vyp86', 'poll2', 'taburet', 'smuta', 'linter'];
export const ALL_FEED = [...FEED, ...OLD];

export const authorPosts = (aid) => aid === 'ml'
  ? ['pirogi', 'kapusta', 'poll2', 'khleb', 'medovik', 'solyanka', 'borsch', 'lecho']
  : Object.keys(POSTS).filter((k) => POSTS[k].a === aid);
export const authorTags = (aid) => aid === 'ml' ? ['Выпечка', 'Супы', 'Заготовки', 'Десерты'] : [...new Set(authorPosts(aid).flatMap((k) => POSTS[k].tags))];

export const vidPos = (v, prog = {}) => prog[v.key] ?? v.pos;
export const hasDur = (v, prog = {}) => v.localDur || prog[v.key] != null;

export function card(id) {
  if (id.startsWith('live:')) {
    const a = AUTHORS[id.slice(5)];
    return { id, name: a.name, ini: a.ini, hue: a.hue, title: a.live.title, badge: 'LIVE', live: true, date: 'эфир идёт' };
  }
  const p = POSTS[id], a = AUTHORS[p.a];
  const c = { id, title: p.title, name: a.name, ini: a.ini, hue: a.hue, date: p.date, badge: p.badge, kind: p.kind, locked: !!p.locked, thumbLabel: p.thumb };
  const au = p.blocks.find((b) => b.t === 'audio');
  if (au) c.dur = fmt(au.dur);
  return c;
}
export function contCard(id, idx, prog = {}) {
  const c = card(id), p = POSTS[id], v = p.videos[idx], pos = vidPos(v, prog);
  c.dur = fmt(v.dur); c.prog = Math.min(1, pos / v.dur);
  c.sub = p.videos.length > 1 ? `видео ${idx + 1} из ${p.videos.length}` : leftMin(v.dur - pos);
  return c;
}

export function filterPosts(ids, f = {}) {
  const tags = f.tags || [];
  return ids.filter((k) => {
    const p = POSTS[k];
    if ((f.access ?? 'allowed') === 'allowed' && p.locked) return false;
    if (f.access === 'bought' && !p.bought) return false;
    if (tags.length && !p.tags.some((t) => tags.includes(t))) return false;
    if (f.period === 7 && p.ago > 7) return false;
    if (f.period === 30 && p.ago > 30) return false;
    if (f.period === 90 && p.ago > 90) return false;
    if (f.period === 'custom' && f.range && (p.ago > f.range[0] || p.ago < f.range[1])) return false;
    if (f.q && !p.title.toLowerCase().includes(f.q.toLowerCase())) return false;
    return true;
  });
}
export const activeCount = (f = {}) => ((f.access ?? 'allowed') !== 'allowed' ? 1 : 0) + (f.period && f.period !== 'all' ? 1 : 0) + (f.tags || []).length;
export const PERIODS = [['all', 'За всё время'], [7, 'Последние 7 дней'], [30, 'Последние 30 дней'], [90, 'Последние 3 месяца'], ['custom', 'Свой период…']];
export const ACCESS = [['allowed', 'Доступные мне'], ['all', 'Все посты'], ['bought', 'Только купленные']];
export const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const periodLabel = (f = {}) => {
  if (f.period === 'custom' && f.custom) { const [a, b] = f.custom; return `${a[0]} ${MONTHS[a[1]]} — ${b[0]} ${MONTHS[b[1]]} ${b[2]}`; }
  return (PERIODS.find((p) => p[0] === (f.period ?? 'all')) || PERIODS[0])[1];
};

export function pollView(poll, ui = {}) {
  const answer = ui.answer ?? poll.answer;
  const voted = answer.length > 0;
  const base = poll.answer;
  const opts = poll.options.map((o) => {
    let count = o.count + (answer.includes(o.id) ? 1 : 0) - (base.includes(o.id) ? 1 : 0);
    return { ...o, count };
  });
  const counter = poll.counter + (voted ? 1 : 0) - (base.length ? 1 : 0);
  return { opts: opts.map((o) => ({ ...o, pct: Math.round((o.count / Math.max(1, counter)) * 100), voted: answer.includes(o.id) })), counter, voted };
}

export const EVENTS = [
  { a: 'ab', text: 'начал эфир «Разбор партий турнира в Вейк-ан-Зее»', time: 'Сегодня, 19:02', unread: true, kind: 'stream' },
  { a: 'ko', text: 'запланировал эфир на 31 октября, 19:00', time: 'Сегодня, 11:30', unread: true, kind: 'generic' },
  { a: 'ab', text: 'начал эфир «Блиц с подписчиками»', time: '18 октября, 20:00', unread: false, kind: 'stream' },
  { a: 'ml', text: 'новое событие в блоге', time: '12 октября, 09:40', unread: false, kind: 'generic' },
  { a: 'ab', text: 'начал эфир «Разбор партий 10 октября»', time: '10 октября, 19:00', unread: false, kind: 'stream' }
];
