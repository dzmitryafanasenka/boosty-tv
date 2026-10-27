/**
 * Story 3.6 «Teaser fits the screen» (owner decision 2026-10-27): the pure
 * cap and the teaser image box (narrow column, a new URL starts over).
 */
import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import type { PostBodyItem } from '../../../shared/entities/post';
import { PostBody } from '../PostBody';
import { TEASER_IMAGE_MIN_HEIGHT, teaserImageMaxHeight } from '../PostScreen';

describe('teaserImageMaxHeight', () => {
  it('viewport − copy bottom − gaps (16 + 12) − bottom padding (27)', () => {
    expect(teaserImageMaxHeight(486, 192)).toBe(239);
    expect(teaserImageMaxHeight(666, 192)).toBe(419);
  });

  it('copy not measured yet: half the viewport; viewport not measured: the minimum', () => {
    expect(teaserImageMaxHeight(486, null)).toBe(243);
    expect(teaserImageMaxHeight(null, 192)).toBe(TEASER_IMAGE_MIN_HEIGHT);
  });

  it('never below the minimum (a long title or level name)', () => {
    expect(teaserImageMaxHeight(486, 470)).toBe(TEASER_IMAGE_MIN_HEIGHT);
    expect(teaserImageMaxHeight(100, null)).toBe(TEASER_IMAGE_MIN_HEIGHT);
  });
});

describe('teaser image box', () => {
  const ID = 'post/p/block/image:i';
  const item = (url: string, width: number | null = 16, height: number | null = 9): PostBodyItem => ({
    kind: 'image',
    key: 'image:i',
    url,
    width,
    height,
  });
  const noop = () => {};
  const body = (items: PostBodyItem[], columnWidth: number | null) => (
    <PostBody
      items={items}
      idPrefix="post/p/block/"
      onParagraphView={noop}
      onParagraphFocus={noop}
      imageMaxHeight={239}
      columnWidth={columnWidth}
    />
  );
  async function render(items: PostBodyItem[], columnWidth: number | null): Promise<Root> {
    const root = createRoot();
    await act(async () => root.render(body(items, columnWidth)));
    return root;
  }
  const byId = (root: Root, testID: string) => root.container.queryAll(n => n.props.testID === testID);
  const box = (root: Root) => StyleSheet.flatten(byId(root, ID)[0].props.style);

  it('the smallest of the column, the measure and the height cap; height = width / aspect', async () => {
    const wide = await render([item('https://example.invalid/a')], 696);
    expect(box(wide).width).toBeCloseTo(239 * (16 / 9));
    expect(box(wide).height).toBeCloseTo(239);
    const narrow = await render([item('https://example.invalid/a')], 300);
    expect(box(narrow).width).toBe(300);
    expect(box(narrow).height).toBeCloseTo(300 / (16 / 9));
    const unmeasured = await render([item('https://example.invalid/a', 4, 1)], null);
    expect(box(unmeasured).width).toBe(600);
    expect(box(unmeasured).height).toBe(150);
  });

  it('a new URL resets the failed and the loaded state', async () => {
    const root = await render([item('https://example.invalid/a')], 696);
    await act(async () =>
      byId(root, `${ID}/image`)[0].props.onLoad({ nativeEvent: { source: { width: 4, height: 3 } } }),
    );
    expect(box(root).width / box(root).height).toBeCloseTo(4 / 3);
    await act(async () => root.render(body([item('https://example.invalid/b')], 696)));
    expect(box(root).width / box(root).height).toBeCloseTo(16 / 9);
    await act(async () => byId(root, `${ID}/image`)[0].props.onError({ nativeEvent: {} }));
    expect(byId(root, `${ID}/image`)).toHaveLength(0);
    await act(async () => root.render(body([item('https://example.invalid/c')], 696)));
    expect(byId(root, `${ID}/image`)[0].props.source).toEqual({ uri: 'https://example.invalid/c' });
  });
});
