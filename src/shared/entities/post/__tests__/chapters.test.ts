import { createLogger } from '../../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { blockEnd, postDetail, text } from '../../../../test/postFixtures';
import {
  CHAPTER_RESTART_SEC,
  chapterAt,
  chapterIndexAt,
  chapterJumpTarget,
  chaptersWithin,
  postChapters,
  type Chapter,
} from '../chapters';
import { mapPost } from '../mapPost';
import type { Block, Post } from '../types';

/**
 * Story 10.1: chapters from a post's timestamp links (the I/O matrix of
 * spec-10-1). Blocks go through the real mapper (sanitized synthetic DTOs,
 * no live data).
 */
const BLOG = 'self-blog';
const POST = 'self-id';
const SELF = `https://boosty.to/${BLOG}/posts/${POST}`;
const mapped = (data: unknown[]) => mapPost(postDetail(BLOG, POST, data as never), createLogger()) as Post;
const link = (s: string, url: string) => ({ type: 'link', content: JSON.stringify([s, 'unstyled', []]), url });
const video = (id: string) => ({ type: 'ok_video', id, title: id });
const ts = (sec: number | string, tmid = 'v1') => `${SELF}?t=${sec}&tmid=${tmid}`;

describe('postChapters (Story 10.1)', () => {
  it('matrix «Happy path»: three chapters, names from the text after each link', () => {
    const post = mapped([
      video('v1'),
      text('Таймкоды:\n'),
      link('0:00', ts(0)),
      text(' Вступление\n'),
      link('3:45', ts(225)),
      text(' — Разбор\n'),
      link('12:10', ts(730)),
      text(' Итоги'),
      blockEnd(),
    ]);
    const chapters = postChapters(post, 'v1', 1200);
    expect(chapters).toEqual([
      { sec: 0, title: 'Вступление' },
      { sec: 225, title: 'Разбор' },
      { sec: 730, title: 'Итоги' },
    ]);
    expect(chapterAt(chapters, 300)?.title).toBe('Разбор');
    expect(chapterJumpTarget(chapters, 300, 1)).toBe(730);
  });

  it('matrix «Two videos»: a timestamp belongs to the video its `tmid` names', () => {
    const post = mapped([
      video('A'),
      video('B'),
      link('0:10', ts(10, 'A')),
      text(' Первое A'),
      blockEnd(),
      link('0:20', ts(20, 'B')),
      text(' Первое B'),
      blockEnd(),
    ]);
    expect(postChapters(post, 'A')).toEqual([{ sec: 10, title: 'Первое A' }]);
    expect(postChapters(post, 'B')).toEqual([{ sec: 20, title: 'Первое B' }]);
    // A video not in the post has none.
    expect(postChapters(post, 'C')).toEqual([]);
  });

  it('matrix «Out of range / odd»: t ≥ duration, a non-digit t, an unknown tmid, another post: ignored; the rest stays', () => {
    const post = mapped([
      video('v1'),
      link('1:00', ts(60)),
      text(' Есть'),
      blockEnd(),
      link('10:00', ts(600)),
      text(' На конце'),
      blockEnd(),
      link('99:00', ts(5940)),
      text(' За концом'),
      blockEnd(),
      link('1m2s', ts('1m2s')),
      text(' Формат'),
      blockEnd(),
      link('0:30', ts(30, 'zzz')),
      text(' Чужое видео'),
      blockEnd(),
      link('0:40', `https://boosty.to/${BLOG}/posts/other?t=40&tmid=v1`),
      text(' Другой пост'),
      blockEnd(),
      link('сайт', 'https://example.invalid/page'),
      blockEnd(),
    ]);
    expect(postChapters(post, 'v1', 600)).toEqual([{ sec: 60, title: 'Есть' }]);
    expect(() => postChapters(post, 'v1', 600)).not.toThrow();
  });

  it('no timestamps → no chapters', () => {
    const post = mapped([video('v1'), text('Просто текст'), blockEnd()]);
    expect(postChapters(post, 'v1', 600)).toEqual([]);
  });

  it('matrix «Duration unknown»: postChapters keeps all; chaptersWithin gives none until the duration is known', () => {
    const post = mapped([video('v1'), link('1:00', ts(60)), text(' A'), blockEnd(), link('2:00', ts(120)), blockEnd()]);
    const all = postChapters(post, 'v1');
    expect(all.map(c => c.sec)).toEqual([60, 120]);
    expect(chaptersWithin(all, 0)).toEqual([]);
    expect(chaptersWithin(all, null)).toEqual([]);
    expect(chaptersWithin(all, 120).map(c => c.sec)).toEqual([60]);
  });

  it('sorted by second; a repeated second keeps its first link', () => {
    const post = mapped([
      video('v1'),
      link('5:00', ts(300)),
      text(' Позже'),
      blockEnd(),
      link('1:00', ts(60)),
      text(' Раньше'),
      blockEnd(),
      link('1:00', ts(60)),
      text(' Повтор'),
      blockEnd(),
    ]);
    expect(postChapters(post, 'v1')).toEqual([
      { sec: 60, title: 'Раньше' },
      { sec: 300, title: 'Позже' },
    ]);
  });

  it('the name (owner decision 2026-11-02): leading separators trimmed, cut at the line end, the next timestamp link or a non-inline block; empty → the time', () => {
    const post = mapped([
      video('v1'),
      link('0:01', ts(1)),
      text(' — Дефис длинный'),
      blockEnd(),
      link('0:02', ts(2)),
      text(' – Короткий: и двоеточие внутри'),
      blockEnd(),
      link('0:03', ts(3)),
      text(' - .: Смешанные'),
      blockEnd(),
      link('0:04', ts(4)),
      text(': Первая строка\nвторая строка'),
      blockEnd(),
      // Two links on one line: each name ends at the next link.
      link('0:05', ts(5)),
      text(' Пятая '),
      link('0:06', ts(6)),
      text(' Шестая'),
      blockEnd(),
      // No text after the link: a name inside the link's own text after its time.
      link('0:07 текст ссылки', ts(7)),
      blockEnd(),
      link('1:01:01', ts(3661)),
      text(' — '),
      blockEnd(),
      // A non-inline block ends the line.
      link('0:08', ts(8)),
      { type: 'image', url: 'https://example.invalid/i.png', width: 10, height: 10 },
      text('После картинки'),
      blockEnd(),
      // The name spans fragments up to the paragraph end.
      link('0:09', ts(9)),
      text(' Часть '),
      text('вторая'),
      blockEnd(),
    ]);
    expect(postChapters(post, 'v1')).toEqual([
      { sec: 1, title: 'Дефис длинный' },
      { sec: 2, title: 'Короткий: и двоеточие внутри' },
      { sec: 3, title: 'Смешанные' },
      { sec: 4, title: 'Первая строка' },
      { sec: 5, title: 'Пятая' },
      { sec: 6, title: 'Шестая' },
      { sec: 7, title: '0:07' },
      { sec: 8, title: '0:08' },
      { sec: 9, title: 'Часть вторая' },
      { sec: 3661, title: '1:01:01' },
    ]);
  });

  it('another link inside the line is part of the name; only a timestamp link or a non-inline block ends it', () => {
    const post = mapped([
      video('v1'),
      link('0:10', ts(10)),
      text(' Обзор '),
      link('сайта', 'https://example.invalid/page'),
      text(' и итоги '),
      link('0:20', ts(20)),
      text(' Дальше'),
      blockEnd(),
    ]);
    expect(postChapters(post, 'v1')).toEqual([
      { sec: 10, title: 'Обзор сайта и итоги' },
      { sec: 20, title: 'Дальше' },
    ]);
  });

  it('a repeated second keeps the first link in post order, a list item before a later paragraph', () => {
    const base = mapped([video('v1')]);
    const linkBlock = (s: string, url: string): Block => ({ type: 'link', text: s, spans: [], url });
    const textBlock = (s: string, paragraphEnd = false): Block => ({ type: 'text', text: s, spans: [], paragraphEnd });
    const post: Post = {
      ...base,
      blocks: [
        ...base.blocks,
        { type: 'list', items: [{ blocks: [linkBlock('0:10', ts(10)), textBlock(' Из списка')], items: [] }] },
        linkBlock('0:10', ts(10)),
        textBlock(' Из абзаца', true),
      ],
    };
    expect(postChapters(post, 'v1')).toEqual([{ sec: 10, title: 'Из списка' }]);
  });

  it('timestamps inside list items count too (the item is the line)', () => {
    const base = mapped([video('v1')]);
    const linkBlock = (s: string, url: string): Block => ({ type: 'link', text: s, spans: [], url });
    const textBlock = (s: string): Block => ({ type: 'text', text: s, spans: [], paragraphEnd: false });
    const post: Post = {
      ...base,
      blocks: [
        ...base.blocks,
        {
          type: 'list',
          items: [
            { blocks: [linkBlock('0:10', ts(10)), textBlock(' Пункт один')], items: [] },
            {
              blocks: [textBlock('Без ссылки')],
              items: [{ blocks: [linkBlock('0:20', ts(20)), textBlock(' Вложенный')], items: [] }],
            },
          ],
        },
      ],
    };
    expect(postChapters(post, 'v1')).toEqual([
      { sec: 10, title: 'Пункт один' },
      { sec: 20, title: 'Вложенный' },
    ]);
  });
});

describe('chapterAt / chapterJumpTarget (Story 10.1)', () => {
  const chapters: Chapter[] = [
    { sec: 60, title: 'A' },
    { sec: 225, title: 'B' },
    { sec: 730, title: 'C' },
  ];

  it('before the first chapter there is no name', () => {
    expect(chapterAt(chapters, 59)).toBeNull();
    expect(chapterIndexAt(chapters, 59)).toBe(-1);
    expect(chapterAt(chapters, 60)?.title).toBe('A');
    expect(chapterAt(chapters, 224)?.title).toBe('A');
    expect(chapterAt(chapters, 225)?.title).toBe('B');
    expect(chapterAt(chapters, 5000)?.title).toBe('C');
    expect(chapterAt([], 10)).toBeNull();
  });

  it('next: the first chapter after the position; none after the last', () => {
    expect(chapterJumpTarget(chapters, 0, 1)).toBe(60);
    expect(chapterJumpTarget(chapters, 60, 1)).toBe(225);
    expect(chapterJumpTarget(chapters, 730, 1)).toBeNull();
  });

  it('previous (YouTube rule): > 3 s into a chapter → its start; else the previous one; before the first → none', () => {
    expect(chapterJumpTarget(chapters, 225 + CHAPTER_RESTART_SEC + 1, -1)).toBe(225);
    expect(chapterJumpTarget(chapters, 225 + CHAPTER_RESTART_SEC, -1)).toBe(60);
    expect(chapterJumpTarget(chapters, 225, -1)).toBe(60);
    expect(chapterJumpTarget(chapters, 62, -1)).toBeNull();
    expect(chapterJumpTarget(chapters, 30, -1)).toBeNull();
  });
});
