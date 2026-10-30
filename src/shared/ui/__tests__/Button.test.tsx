import { act } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { Button, buttonInk } from '../Button';
import { colors, focus, motion } from '../tokens';

const ID = 'probe';
const evt = { nativeEvent: {}, persist: () => {} };

type ReduceMotionListener = (enabled: boolean) => void;
let reduceMotionListener: ReduceMotionListener | undefined;

function mockReduceMotion(query: Promise<boolean>) {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(query);
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockImplementation((_event, listener) => {
      reduceMotionListener = listener as ReduceMotionListener;
      return { remove: () => {} } as ReturnType<
        typeof AccessibilityInfo.addEventListener
      >;
    });
}

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
  const [node] = byId(root, ID);
  return node;
}

function surfaceBackground(root: Root): string | undefined {
  const [scaleNode] = byId(root, `${ID}/scale`);
  // The scale view is also the surface (one native view).
  return StyleSheet.flatten(scaleNode.props.style).backgroundColor as string;
}

let timing: jest.SpyInstance;

beforeEach(() => {
  reduceMotionListener = undefined;
  mockReduceMotion(Promise.resolve(false));
  timing = jest.spyOn(Animated, 'timing');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Button', () => {
  it('is a focusable button labelled with its text', async () => {
    const root = await render(<Button testID={ID} label="Войти в Boosty" />);
    const node = host(root);
    expect(node.props.focusable).toBe(true);
    expect(node.props.accessibilityRole).toBe('button');
    expect(node.props.accessibilityLabel).toBe('Войти в Boosty');
    expect(byId(root, `${ID}/ring`)).toHaveLength(0);
    expect(surfaceBackground(root)).toBe(colors.accent);
  });

  it('focused: ring, surface lift and scale-button with motion.focus', async () => {
    const root = await render(<Button testID={ID} label="A" />);
    await act(async () => {
      host(root).props.onFocus(evt);
    });
    expect(byId(root, `${ID}/ring`)).toHaveLength(1);
    expect(surfaceBackground(root)).toBe(colors['accent-focus']);
    const ring = StyleSheet.flatten(byId(root, `${ID}/ring`)[0].props.style);
    expect(ring).toMatchObject({
      position: 'absolute',
      top: -4,
      left: -4,
      right: -4,
      bottom: -4,
      borderWidth: focus['ring-width'],
      borderColor: colors['focus-ring'],
      borderRadius: 8 + 4,
    });
    expect(timing).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        toValue: focus['scale-button'],
        duration: motion.focus.duration,
        useNativeDriver: true,
      }),
    );

    await act(async () => {
      host(root).props.onBlur(evt);
    });
    expect(byId(root, `${ID}/ring`)).toHaveLength(0);
    expect(timing).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: 1 }),
    );
  });

  it('pressed: pressed-scale with motion.press; OK calls onPress once', async () => {
    const onPress = jest.fn();
    const root = await render(
      <Button testID={ID} label="A" onPress={onPress} />,
    );
    await act(async () => {
      host(root).props.onFocus(evt);
    });
    await act(async () => {
      host(root).props.onPressIn(evt);
    });
    expect(timing).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        toValue: focus['pressed-scale'],
        duration: motion.press.duration,
        useNativeDriver: true,
      }),
    );
    await act(async () => {
      host(root).props.onPressOut(evt);
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(timing).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        toValue: focus['scale-button'],
        duration: motion.press.duration,
      }),
    );
  });

  it('disabled: not focusable, no ring, text-disabled, no press', async () => {
    const onPress = jest.fn();
    const root = await render(
      <Button testID={ID} label="A" disabled onPress={onPress} />,
    );
    const node = host(root);
    expect(node.props.focusable).toBe(false);
    expect(node.props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => {
      node.props.onFocus(evt);
      node.props.onPressIn(evt);
      node.props.onPressOut(evt);
    });
    expect(byId(root, `${ID}/ring`)).toHaveLength(0);
    expect(onPress).not.toHaveBeenCalled();
    const label = root.container.queryAll(
      n => n.type === 'RCTText' || n.type === 'Text',
    )[0];
    expect(StyleSheet.flatten(label.props.style).color).toBe(
      colors['text-disabled'],
    );
  });

  it('busy: spinner, keeps focus, ignores OK, reports busy', async () => {
    const onPress = jest.fn();
    const root = await render(
      <Button testID={ID} label="A" busy onPress={onPress} />,
    );
    const node = host(root);
    expect(byId(root, `${ID}/spinner`)).toHaveLength(1);
    expect(node.props.focusable).toBe(true);
    expect(node.props.accessibilityState).toMatchObject({ busy: true });
    await act(async () => {
      node.props.onFocus(evt);
    });
    await act(async () => {
      host(root).props.onPressIn(evt);
    });
    await act(async () => {
      host(root).props.onPressOut(evt);
      host(root).props.onClick({ ...evt, currentTarget: 1, target: 1 });
    });
    expect(onPress).not.toHaveBeenCalled();
    expect(byId(root, `${ID}/ring`)).toHaveLength(1);
  });

  it('busy keeps the label rendered (hidden), so the width does not change', async () => {
    const root = await render(<Button testID={ID} label="Войти" busy />);
    const labels = root.container.queryAll(
      n =>
        (n.type === 'RCTText' || n.type === 'Text') &&
        n.children.includes('Войти'),
    );
    expect(labels).toHaveLength(1);
    expect(StyleSheet.flatten(labels[0].props.style).opacity).toBe(0);
    const [spinnerSlot] = byId(root, `${ID}/spinner`).map(n => n.parent!);
    expect(StyleSheet.flatten(spinnerSlot.props.style)).toMatchObject({
      position: 'absolute',
    });

    await act(async () => {
      root.render(<Button testID={ID} label="Войти" />);
    });
    expect(byId(root, `${ID}/spinner`)).toHaveLength(0);
    expect(StyleSheet.flatten(labels[0].props.style).opacity).toBeUndefined();
  });

  it('Story 7.4: an icon before the label; selected (secondary) uses the accent ink and reports selected', async () => {
    const icon = <Text testID="icon">♥</Text>;
    const root = await render(<Button testID={ID} label="358" kind="secondary" icon={icon} selected />);
    expect(byId(root, 'icon')).toHaveLength(1);
    expect(host(root).props.accessibilityState).toMatchObject({ selected: true });
    expect(JSON.stringify(root.container.toJSON())).toContain(colors['accent-text']);
    expect(buttonInk({ kind: 'secondary', selected: true })).toBe(colors['accent-text']);
    expect(buttonInk({ kind: 'secondary' })).toBe(colors.text);
    expect(buttonInk({ kind: 'secondary', selected: true, disabled: true })).toBe(colors['text-disabled']);
    await act(async () => {
      root.render(<Button testID={ID} label="A" />);
    });
    // Without `selected` the state carries no `selected` key (unchanged buttons).
    expect(host(root).props.accessibilityState?.selected).toBeUndefined();
    // `accessibilityBusy`: busy for accessibility, no spinner (the label kept).
    const onPress = jest.fn();
    await act(async () => {
      root.render(<Button testID={ID} label="A" accessibilityBusy onPress={onPress} />);
    });
    expect(host(root).props.accessibilityState).toMatchObject({ busy: true });
    expect(byId(root, `${ID}/spinner`)).toHaveLength(0);
  });

  it('secondary kind uses the secondary surfaces', async () => {
    const root = await render(
      <Button testID={ID} label="A" kind="secondary" />,
    );
    expect(surfaceBackground(root)).toBe(colors['surface-raised']);
    await act(async () => {
      host(root).props.onFocus(evt);
    });
    expect(surfaceBackground(root)).toBe(colors['surface-focus-button']);
  });
});

describe('reduced motion', () => {
  it('applies the scale without animation when the setting is on', async () => {
    jest.restoreAllMocks();
    mockReduceMotion(Promise.resolve(true));
    timing = jest.spyOn(Animated, 'timing');
    const root = await render(<Button testID={ID} label="A" />);
    timing.mockClear();
    const setValue = jest.spyOn(Animated.Value.prototype, 'setValue');
    await act(async () => {
      host(root).props.onFocus(evt);
    });
    expect(timing).not.toHaveBeenCalled();
    expect(setValue).toHaveBeenLastCalledWith(focus['scale-button']);
  });

  it('follows a change event', async () => {
    const root = await render(<Button testID={ID} label="A" />);
    await act(async () => {
      reduceMotionListener?.(true);
    });
    timing.mockClear();
    const setValue = jest.spyOn(Animated.Value.prototype, 'setValue');
    await act(async () => {
      host(root).props.onFocus(evt);
    });
    expect(timing).not.toHaveBeenCalled();
    expect(setValue).toHaveBeenLastCalledWith(focus['scale-button']);
  });

  it('a change event wins over a slower initial query', async () => {
    jest.restoreAllMocks();
    let resolveQuery: (enabled: boolean) => void = () => {};
    mockReduceMotion(
      new Promise<boolean>(resolve => {
        resolveQuery = resolve;
      }),
    );
    timing = jest.spyOn(Animated, 'timing');
    const root = await render(<Button testID={ID} label="A" />);
    await act(async () => {
      reduceMotionListener?.(true);
    });
    await act(async () => {
      resolveQuery(false);
    });
    timing.mockClear();
    const setValue = jest.spyOn(Animated.Value.prototype, 'setValue');
    await act(async () => {
      host(root).props.onFocus(evt);
    });
    expect(timing).not.toHaveBeenCalled();
    expect(setValue).toHaveBeenLastCalledWith(focus['scale-button']);
  });

  it('keeps motion on when the query rejects', async () => {
    jest.restoreAllMocks();
    mockReduceMotion(Promise.reject(new Error('unavailable')));
    timing = jest.spyOn(Animated, 'timing');
    const root = await render(<Button testID={ID} label="A" />);
    await act(async () => {
      host(root).props.onFocus(evt);
    });
    expect(timing).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: focus['scale-button'] }),
    );
  });

  it('busyLabel (Story 5.1): the busy label instead of the spinner; both labels keep their place; OK ignored', async () => {
    const onPress = jest.fn();
    const root = await render(
      <Button
        testID={ID}
        label="Обновить"
        busyLabel="Обновляем…"
        accessibilityLabel="Обновить ленту"
        onPress={onPress}
      />,
    );
    const textNode = (value: string) =>
      root.container.queryAll(
        n =>
          (n.type === 'RCTText' || n.type === 'Text') &&
          n.children.includes(value),
      )[0];
    expect(host(root).props.accessibilityLabel).toBe('Обновить ленту');
    expect(
      StyleSheet.flatten(textNode('Обновить').props.style).opacity,
    ).toBeUndefined();
    expect(StyleSheet.flatten(textNode('Обновляем…').props.style).opacity).toBe(
      0,
    );

    await act(async () => {
      root.render(
        <Button
          testID={ID}
          label="Обновить"
          busyLabel="Обновляем…"
          accessibilityLabel="Обновить ленту"
          busy
          onPress={onPress}
        />,
      );
    });
    expect(byId(root, `${ID}/spinner`)).toHaveLength(0);
    expect(host(root).props.accessibilityLabel).toBe('Обновляем…');
    expect(host(root).props.focusable).toBe(true);
    expect(StyleSheet.flatten(textNode('Обновить').props.style).opacity).toBe(
      0,
    );
    expect(
      StyleSheet.flatten(textNode('Обновляем…').props.style).opacity,
    ).toBeUndefined();
    await act(async () => {
      host(root).props.onClick({ ...evt, currentTarget: 1, target: 1 });
    });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('focusable={false}: not focusable, drawn as enabled', async () => {
    const root = await render(
      <Button testID={ID} label="A" kind="secondary" focusable={false} />,
    );
    expect(host(root).props.focusable).toBe(false);
    expect(surfaceBackground(root)).toBe(colors['surface-raised']);
  });

  it('busyAccessibilityLabel: read while busy; the visible busy label unchanged', async () => {
    const root = await render(
      <Button
        testID={ID}
        label="Обновить"
        busyLabel="Обновляем…"
        busyAccessibilityLabel="Обновляем ленту…"
        accessibilityLabel="Обновить ленту"
        busy
      />,
    );
    expect(host(root).props.accessibilityLabel).toBe('Обновляем ленту…');
    expect(byId(root, `${ID}/busy-label`)[0].children).toContain('Обновляем…');
  });
});
