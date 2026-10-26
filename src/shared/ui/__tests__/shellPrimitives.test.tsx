import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { NavItem } from '../NavItem';
import { SettingRow } from '../SettingRow';
import { StateView } from '../StateView';
import { colors, components, focus } from '../tokens';

const ID = 'probe';

async function render(element: React.ReactElement): Promise<Root> {
  const root = createRoot();
  await act(async () => {
    root.render(element);
  });
  return root;
}

function byId(root: Root, testID: string) {
  return root.container.queryAll(node => node.props.testID === testID);
}

function host(root: Root) {
  const nodes = byId(root, ID).filter(node => node.props.focusable !== undefined);
  expect(nodes).toHaveLength(1);
  return nodes[0];
}

function surface(root: Root) {
  const [scaleNode] = byId(root, `${ID}/scale`);
  const node = scaleNode.children[0];
  if (typeof node === 'string') {
    throw new Error('unexpected text node');
  }
  return StyleSheet.flatten(node.props.style);
}

async function setFocused(root: Root, focused: boolean) {
  await act(async () => {
    host(root).props[focused ? 'onFocus' : 'onBlur']({ nativeEvent: {} });
  });
}

describe('NavItem', () => {
  it('current: surface-current + accent bar; not current: transparent, no bar', async () => {
    const current = await render(<NavItem testID={ID} label="Главная" current />);
    expect(surface(current).backgroundColor).toBe(components['nav-item'].currentBg);
    const [mark] = byId(current, `${ID}/current`);
    expect(StyleSheet.flatten(mark.props.style).backgroundColor).toBe(colors.accent);
    expect(host(current).props.accessibilityState).toMatchObject({ selected: true });
    expect(byId(current, `${ID}/ring`)).toHaveLength(0);

    const other = await render(<NavItem testID={ID} label="Настройки" current={false} />);
    expect(surface(other).backgroundColor).toBe('transparent');
    expect(byId(other, `${ID}/current`)).toHaveLength(0);
    expect(host(other).props.accessibilityState).toMatchObject({ selected: false });
  });

  it('focused: ring + surface-focus-row; a focused current item keeps its bar', async () => {
    const root = await render(<NavItem testID={ID} label="Главная" current />);
    await setFocused(root, true);
    expect(surface(root).backgroundColor).toBe(colors['surface-focus-row']);
    expect(byId(root, `${ID}/ring`)).toHaveLength(1);
    expect(byId(root, `${ID}/current`)).toHaveLength(1);
    await setFocused(root, false);
    expect(surface(root).backgroundColor).toBe(components['nav-item'].currentBg);
    expect(byId(root, `${ID}/ring`)).toHaveLength(0);
  });

  it('has the nav-item size and the button label', async () => {
    const root = await render(<NavItem testID={ID} label="Главная" current={false} />);
    expect(surface(root)).toMatchObject({
      width: components['nav-item'].width,
      height: components['nav-item'].height,
      borderRadius: components['nav-item'].radius,
    });
    expect(host(root).props.accessibilityLabel).toBe('Главная');
    expect(host(root).props.accessibilityRole).toBe('button');
  });
});

describe('SettingRow', () => {
  it('info: focusable, label + value, OK does nothing, setting-row tokens', async () => {
    const onPress = jest.fn();
    const root = await render(
      <SettingRow testID={ID} kind="info" label="Версия" value="1.0" onPress={onPress} />,
    );
    const node = host(root);
    expect(node.props.focusable).toBe(true);
    expect(node.props.accessibilityLabel).toBe('Версия 1.0');
    expect(surface(root)).toMatchObject({
      minHeight: components['setting-row'].minHeight,
      borderRadius: components['setting-row'].radius,
    });
    await act(async () => {
      host(root).props.onClick({ nativeEvent: {} });
    });
    expect(onPress).not.toHaveBeenCalled();

    await setFocused(root, true);
    expect(surface(root).backgroundColor).toBe(components['setting-row'].bgFocus);
    expect(byId(root, `${ID}/ring`)).toHaveLength(1);
    expect(focus['scale-row']).toBe(components['setting-row'].scaleFocus);
  });

  it('nav: OK calls onPress', async () => {
    const onPress = jest.fn();
    const root = await render(
      <SettingRow testID={ID} kind="nav" label="Проверка фокуса" onPress={onPress} />,
    );
    expect(host(root).props.accessibilityRole).toBe('button');
    await act(async () => {
      host(root).props.onClick({ nativeEvent: {} });
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('StateView', () => {
  it('without an action: title-s title, body-s body, nothing focusable', async () => {
    const root = await render(<StateView testID="state" title="Лента появится здесь" body="Текст" />);
    const texts = root.container.queryAll(node => typeof node.props.children === 'string');
    const title = texts.find(node => node.props.children === 'Лента появится здесь');
    const body = texts.find(node => node.props.children === 'Текст');
    expect(StyleSheet.flatten(title?.props.style)).toMatchObject(components['state-view'].title);
    expect(StyleSheet.flatten(body?.props.style)).toMatchObject(components['state-view'].body);
    expect(root.container.queryAll(node => node.props.focusable === true)).toHaveLength(0);
  });

  it('with an action: one secondary button', async () => {
    const onPress = jest.fn();
    const root = await render(
      <StateView title="Ошибка" action={{ label: 'Повторить', onPress, testID: 'state/action' }} />,
    );
    const buttons = root.container.queryAll(node => node.props.focusable === true);
    expect(buttons.map(node => node.props.testID)).toEqual(['state/action']);
    await act(async () => {
      buttons[0].props.onClick({ nativeEvent: {} });
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
