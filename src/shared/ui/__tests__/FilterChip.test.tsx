import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { FilterChip } from '../FilterChip';
import { colors, components, focus } from '../tokens';

const ID = 'chip';
const evt = { nativeEvent: {}, persist: () => {} };

async function render(element: React.ReactElement): Promise<Root> {
  const root = createRoot();
  await act(async () => {
    root.render(element);
  });
  return root;
}

const byId = (root: Root, testID: string) => root.container.queryAll(n => n.props.testID === testID);
const host = (root: Root) => byId(root, ID)[0];
const surface = (root: Root) => StyleSheet.flatten(byId(root, `${ID}/scale`)[0].props.style);
const textOf = (root: Root) => JSON.stringify(root.container.toJSON());

describe('FilterChip (DESIGN.md FilterChip, Story 5.3)', () => {
  it('default: a 32 dp pill on surface-raised with the label; no badge without a count', async () => {
    const root = await render(<FilterChip testID={ID} label="Фильтры · Доступные мне" />);
    expect(host(root).props.focusable).toBe(true);
    expect(host(root).props.accessibilityRole).toBe('button');
    expect(host(root).props.accessibilityLabel).toBe('Фильтры · Доступные мне');
    expect(surface(root)).toMatchObject({
      height: components['filter-chip'].height,
      backgroundColor: components['filter-chip'].bg,
    });
    expect(textOf(root)).toContain('Фильтры · Доступные мне');
    expect(byId(root, `${ID}/count`)).toHaveLength(0);
    await act(async () => root.unmount());
  });

  it('a count shows the accent-tint badge; the TalkBack label is the given one', async () => {
    const root = await render(
      <FilterChip testID={ID} label="Фильтры · Все посты" count={1} accessibilityLabel="a11y" />,
    );
    const [badge] = byId(root, `${ID}/count`);
    expect(StyleSheet.flatten(badge.props.style).backgroundColor).toBe(components['filter-chip'].countBg);
    expect(JSON.stringify(badge.toJSON?.() ?? null)).toContain('1');
    expect(host(root).props.accessibilityLabel).toBe('a11y');
    await act(async () => root.unmount());
  });

  it('focused: surface-focus-button and the button scale; OK presses', async () => {
    const onPress = jest.fn();
    const root = await render(<FilterChip testID={ID} label="x" onPress={onPress} />);
    await act(async () => {
      host(root).props.onFocus(evt);
    });
    expect(surface(root).backgroundColor).toBe(colors['surface-focus-button']);
    await act(async () => {
      host(root).props.onClick(evt);
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(focus['scale-button']).toBeGreaterThan(1);
    await act(async () => root.unmount());
  });

  it('focusable={false}: drawn as usual, not focusable', async () => {
    const root = await render(<FilterChip testID={ID} label="x" focusable={false} />);
    expect(host(root).props.focusable).toBe(false);
    expect(surface(root).backgroundColor).toBe(components['filter-chip'].bg);
    await act(async () => root.unmount());
  });
});
