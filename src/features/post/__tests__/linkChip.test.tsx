/**
 * Story 6.3: a Boosty post link chip without an `onOpenPost` (no route to
 * push) falls back to the QR chip: the QR label and OK → the QrDialog.
 */
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import type { PostBodyItem } from '../../../shared/entities/post';
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

test('a timestamp chip with `onPlayAt`: «… · Смотреть», OK plays that video from that second (the chip id for the return)', async () => {
  const onOpenQr = jest.fn();
  const onPlayAt = jest.fn();
  const root = await render(onOpenQr, jest.fn(), [TIMESTAMP], onPlayAt);
  expect(chip(root).props.accessibilityLabel).toBe('3:45 Тема. Смотреть видео с этого момента');
  expect(JSON.stringify(root.container.queryAll(n => n.props.testID === `${ID}/action`)[0].toJSON())).toContain('· Смотреть');
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
