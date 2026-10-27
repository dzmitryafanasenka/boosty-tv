import { isDistinctVideoTitle } from '../PlayerOverlay';

describe('the overlay video title (Story 4.1 owner decision)', () => {
  it.each(['Video', 'video', ' VIDEO ', 'Видео', 'видео', 'Видео 1', 'видео 12', ''])(
    'generic or empty %p: hidden',
    title => {
      expect(isDistinctVideoTitle(title, 'Пост')).toBe(false);
    },
  );

  it('equal to the post title (trimmed): hidden; anything else: shown', () => {
    expect(isDistinctVideoTitle(' Пост ', 'Пост')).toBe(false);
    expect(isDistinctVideoTitle('Часть первая', 'Пост')).toBe(true);
    expect(isDistinctVideoTitle('Видео про рынок', 'Пост')).toBe(true);
  });
});
