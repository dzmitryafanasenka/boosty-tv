/**
 * Story 4.7: the «Продолжить просмотр» card — the feed card's size, the
 * title, author and «Осталось N мин», the progress line, the neutral plate,
 * and the accessibility label.
 */
import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { ContinueCard, continueCardA11yLabel } from '../ContinueCard';
import { postCardHeight } from '../PostCard';

const ID = 'home/continue/m1';
let root: Root | null = null;

async function mount(props: Partial<Parameters<typeof ContinueCard>[0]> = {}) {
  root = createRoot();
  await act(async () => {
    root!.render(
      <ContinueCard
        testID={ID}
        resetKey="m1"
        title="Урок 3"
        authorName="Автор"
        previewUrl="https://example.invalid/preview.jpg"
        status={{ kind: 'inProgress', minutesLeft: 48, fraction: 0.2 }}
        width={221}
        {...props}
      />,
    );
  });
  return root;
}
const find = (r: Root, testID: string) => r.container.queryAll(n => n.props.testID === testID);

afterEach(async () => {
  const current = root;
  root = null;
  if (current) {
    await act(async () => current.unmount());
  }
});

it('the feed card size; title, author · «Осталось N мин»; the progress line at the fraction', async () => {
  const r = await mount();
  const scale = StyleSheet.flatten(find(r, `${ID}/scale`)[0].props.style) as { width: number; height: number };
  expect(scale).toMatchObject({ width: 221, height: postCardHeight(221) });
  const host = r.container.queryAll(n => n.props.testID === ID && n.props.focusable !== undefined)[0];
  expect(host.props.accessibilityLabel).toBe('Урок 3. Автор. Осталось 48 мин');
  expect(host.props.accessibilityRole).toBe('button');
  const [fill] = find(r, `${ID}/progress`)[0].queryAll(n => n.props.style !== undefined && n.props.testID === undefined);
  expect(StyleSheet.flatten(fill.props.style)).toMatchObject({ width: Math.round(221 * 0.2) });
  expect(find(r, `${ID}/preview`)[0].props.source).toEqual({ uri: 'https://example.invalid/preview.jpg' });
});

it('no preview, or a failed one → a neutral plate', async () => {
  const r = await mount({ previewUrl: null });
  expect(find(r, `${ID}/preview-placeholder`)).toHaveLength(1);
  await act(async () => r.unmount());
  root = null;
  const r2 = await mount();
  await act(async () => find(r2, `${ID}/preview`)[0].props.onError());
  expect(find(r2, `${ID}/preview`)).toHaveLength(0);
  expect(find(r2, `${ID}/preview-placeholder`)).toHaveLength(1);
});

it('an unknown duration: no remaining time, no line, label without it', async () => {
  const r = await mount({ status: { kind: 'unknown' } });
  expect(find(r, `${ID}/left`)).toHaveLength(0);
  expect(find(r, `${ID}/progress`)).toHaveLength(0);
  expect(continueCardA11yLabel('Урок', 'Автор', { kind: 'unknown' })).toBe('Урок. Автор');
});

it('an empty author is left out of the label and the meta line', async () => {
  expect(continueCardA11yLabel('Урок', ' ', { kind: 'inProgress', minutesLeft: 5, fraction: 0.5 })).toBe('Урок. Осталось 5 мин');
  expect(continueCardA11yLabel('Урок', '', { kind: 'unknown' })).toBe('Урок');
  const r = await mount({ authorName: '' });
  const [left] = find(r, `${ID}/left`);
  expect(left.children.join('')).toBe('Осталось 48 мин');
});
