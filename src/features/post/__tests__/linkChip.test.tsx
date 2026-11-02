/**
 * Story 6.3: a Boosty post link chip without an `onOpenPost` (no route to
 * push) falls back to the QR chip: the QR label and OK → the QrDialog.
 */
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import type { PostBodyItem } from '../../../shared/entities/post';
import { colors } from '../../../shared/ui';
import { PostBody, type OpenPost, type PlayAt } from '../PostBody';

const ID = 'post/p/block/text@0/link/0';
const ITEM: PostBodyItem = {
  kind: 'paragraph',
  key: 'text@0',
  text: 'См. другой пост',
  segments: [{ kind: 'text', text: 'См. другой пост', bold: false, italic: false, underline: false }],
  links: [
    {
      key: 'text@0/link/0',
      text: 'другой пост',
      url: 'https://boosty.to/blog/posts/other',
      post: { blogUrl: 'blog', postId: 'other' },
      timestamp: null,
    },
  ],
};
const noop = () => {};

async function render(onOpenQr: jest.Mock, onOpenPost?: OpenPost, items: PostBodyItem[] = [ITEM], onPlayAt?: PlayAt): Promise<Root> {
  const root = createRoot();
  await act(async () =>
    root.render(
      <PostBody
        items={items}
        idPrefix="post/p/block/"
        onParagraphView={noop}
        onParagraphFocus={noop}
        imageMaxHeight={239}
        columnWidth={600}
        onOpenQr={onOpenQr}
        onOpenPost={onOpenPost}
        onPlayAt={onPlayAt}
      />,
    ),
  );
  return root;
}

const chip = (root: Root) =>
  root.container.queryAll(n => n.props.testID === ID && n.props.focusable === true)[0];
const press = async (root: Root) => act(async () => chip(root).props.onClick({ nativeEvent: {} }));

test('with `onOpenPost`: «… · Открыть», OK opens the post, no QR', async () => {
  const onOpenQr = jest.fn();
  const onOpenPost = jest.fn();
  const root = await render(onOpenQr, onOpenPost);
  expect(chip(root).props.accessibilityLabel).toBe('другой пост. Открыть пост');
  expect(JSON.stringify(root.container.queryAll(n => n.props.testID === `${ID}/action`)[0].toJSON())).toContain('· Открыть');
  await press(root);
  expect(onOpenPost).toHaveBeenCalledWith('blog', 'other');
  expect(onOpenQr).not.toHaveBeenCalled();
});

test('without `onOpenPost`: the QR chip (label, «QR» suffix) and OK opens the QR', async () => {
  const onOpenQr = jest.fn();
  const root = await render(onOpenQr);
  expect(chip(root).props.accessibilityLabel).toBe('другой пост. Показать QR-код');
  const json = JSON.stringify(root.container.toJSON());
  expect(json).not.toContain('Открыть');
  expect(json).toContain('"QR"');
  await press(root);
  expect(onOpenQr).toHaveBeenCalledWith('другой пост', 'https://boosty.to/blog/posts/other', expect.anything());
});

const TIMESTAMP: PostBodyItem = {
  ...ITEM,
  links: [
    {
      key: 'text@0/link/0',
      text: '3:45 Тема',
      url: 'https://boosty.to/blog/posts/p?t=225&tmid=v1',
      post: { blogUrl: 'blog', postId: 'p' },
      timestamp: { mediaId: 'v1', seconds: 225 },
    },
  ],
};

test('a timestamp chip with `onPlayAt` (Story 13.2): «▶ 3:45» (no link text, no «Смотреть»), OK plays that video from that second (the chip id for the return)', async () => {
  const onOpenQr = jest.fn();
  const onPlayAt = jest.fn();
  const root = await render(onOpenQr, jest.fn(), [TIMESTAMP], onPlayAt);
  expect(chip(root).props.accessibilityLabel).toBe('Смотреть с 3:45');
  const chipJson = JSON.stringify(root.container.queryAll(n => n.props.testID === `${ID}/scale`)[0].toJSON());
  expect(chipJson).toContain('"3:45"');
  expect(chipJson).not.toContain('Тема');
  expect(chipJson).not.toContain('Смотреть');
  expect(root.container.queryAll(n => n.props.testID === `${ID}/play`)).not.toHaveLength(0);
  expect(root.container.queryAll(n => n.props.testID === `${ID}/title`)).toHaveLength(0);
  await press(root);
  expect(onPlayAt).toHaveBeenCalledWith('v1', 225, ID);
  expect(onOpenQr).not.toHaveBeenCalled();
});

test('a timestamp chip without `onPlayAt` (player off): the QR chip', async () => {
  const onOpenQr = jest.fn();
  const root = await render(onOpenQr, undefined, [TIMESTAMP]);
  expect(chip(root).props.accessibilityLabel).toBe('3:45 Тема. Показать QR-код');
  await press(root);
  expect(onOpenQr).toHaveBeenCalledTimes(1);
});

describe('Story 13.2: the chapter chip «▶ time title»', () => {
  const chapter = (key: string, seconds: number, title: string): PostBodyItem => ({
    kind: 'timestamp',
    key,
    mediaId: 'v1',
    seconds,
    title,
    url: `https://boosty.to/blog/posts/p?t=${seconds}&tmid=v1`,
  });
  const ITEMS: PostBodyItem[] = [
    chapter('text@0/time/0', 20, 'Что тут происходит?'),
    chapter('text@0/time/1', 90, '1:30'),
    ITEM,
    chapter('text@3/time/0', 255, 'Как перестать тревожиться'),
  ];
  const CH = (key: string) => `post/p/block/${key}`;
  const node = (root: Root, testID: string) => root.container.queryAll(n => n.props.testID === testID)[0];
  const flat = (style: unknown) => Object.assign({}, ...[style].flat(4).filter(Boolean)) as Record<string, unknown>;

  test('consecutive chapters are one list, a later one its own; the time, the title (none when it is the time) and the label', async () => {
    const root = await render(jest.fn(), undefined, ITEMS, jest.fn());
    const list = node(root, `${CH('text@0/time/0')}/list`);
    expect(list.queryAll(n => n.props.testID === CH('text@0/time/1'))).not.toHaveLength(0);
    expect(list.queryAll(n => n.props.testID === CH('text@3/time/0'))).toHaveLength(0);
    expect(node(root, `${CH('text@3/time/0')}/list`)).toBeDefined();
    expect(node(root, `${CH('text@0/time/0')}/time`).props.children).toBe('0:20');
    expect(node(root, `${CH('text@0/time/0')}/title`).props.children).toBe('Что тут происходит?');
    expect(node(root, `${CH('text@0/time/1')}/title`)).toBeUndefined();
    const focusable = (key: string) => root.container.queryAll(n => n.props.testID === CH(key) && n.props.focusable === true)[0];
    expect(focusable('text@0/time/0').props.accessibilityLabel).toBe('Смотреть с 0:20: Что тут происходит?');
    expect(focusable('text@0/time/1').props.accessibilityLabel).toBe('Смотреть с 1:30');
  });

  test('adjacent chapters from two paragraphs (`link@1`, `link@4`) are one list', async () => {
    const root = await render(jest.fn(), undefined, [chapter('link@1/time/0', 0, 'А'), chapter('link@4/time/0', 20, 'Б')], jest.fn());
    const list = node(root, `${CH('link@1/time/0')}/list`);
    expect(list.queryAll(n => n.props.testID === CH('link@4/time/0'))).not.toHaveLength(0);
    expect(node(root, `${CH('link@4/time/0')}/list`)).toBeUndefined();
  });

  test('focused: the chip inverts (light fill, dark ink) and the time loses its accent', async () => {
    const root = await render(jest.fn(), undefined, ITEMS, jest.fn());
    const id = CH('text@0/time/0');
    const host = root.container.queryAll(n => n.props.testID === id && n.props.focusable === true)[0];
    expect(flat(node(root, `${id}/scale`).props.style).backgroundColor).toBe(colors['surface-raised']);
    expect(flat(node(root, `${id}/time`).props.style).color).toBe(colors['accent-text']);
    await act(async () => host.props.onFocus({ nativeEvent: {} }));
    expect(flat(node(root, `${id}/scale`).props.style).backgroundColor).toBe(colors.text);
    expect(flat(node(root, `${id}/time`).props.style).color).toBe(colors.bg);
    expect(flat(node(root, `${id}/title`).props.style).color).toBe(colors.bg);
    expect(node(root, `${id}/ring`)).toBeDefined();
  });

  test('OK plays from that second with the chip id; without `onPlayAt` OK opens the link QR', async () => {
    const onPlayAt = jest.fn();
    const played = await render(jest.fn(), undefined, ITEMS, onPlayAt);
    const id = CH('text@0/time/0');
    await act(async () =>
      played.container.queryAll(n => n.props.testID === id && n.props.focusable === true)[0].props.onClick({ nativeEvent: {} }),
    );
    expect(onPlayAt).toHaveBeenCalledWith('v1', 20, id);
    const onOpenQr = jest.fn();
    const off = await render(onOpenQr, undefined, ITEMS);
    const host = off.container.queryAll(n => n.props.testID === id && n.props.focusable === true)[0];
    expect(host.props.accessibilityLabel).toBe('0:20 Что тут происходит? Показать QR-код');
    await act(async () => host.props.onClick({ nativeEvent: {} }));
    expect(onOpenQr).toHaveBeenCalledWith('0:20 Что тут происходит?', 'https://boosty.to/blog/posts/p?t=20&tmid=v1', expect.anything());
  });
});
