import { act, createRef } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { TextField, type TextFieldHandle } from '../TextField';
import { colors, components } from '../tokens';
import { requestHostFocus } from '../requestHostFocus';

jest.mock('../requestHostFocus', () => ({ requestHostFocus: jest.fn() }));

const FIELD = components['text-field'];

function input(root: Root) {
  const [node] = root.container.queryAll(n => n.props.testID === 'probe');
  return node;
}

async function render(props: Partial<Parameters<typeof TextField>[0]> = {}) {
  const root = createRoot();
  const ref = createRef<TextFieldHandle>();
  await act(async () => {
    root.render(
      <TextField
        ref={ref}
        testID="probe"
        label="Номер телефона"
        value="291234567"
        onChangeText={() => {}}
        {...props}
      />,
    );
  });
  return { root, ref };
}

test('idle: border token, design height and border width, plain text, labels', async () => {
  const { root } = await render();
  const node = input(root);
  expect(StyleSheet.flatten(node.props.style)).toMatchObject({
    height: FIELD.height,
    borderWidth: FIELD.borderWidth,
    borderRadius: FIELD.radius,
    backgroundColor: FIELD.bg,
    borderColor: FIELD.border,
    color: colors.text,
  });
  expect(node.props.secureTextEntry).toBeFalsy();
  expect(node.props.accessibilityLabel).toBe('Номер телефона');
  expect(node.props.accessibilityHint).toBeUndefined();
  expect(JSON.stringify(root.container.toJSON())).toContain('Номер телефона');
  expect(root.container.queryAll(n => n.props.testID === 'probe/error')).toHaveLength(0);
});

test('focused: focus-ring border, no scale', async () => {
  const { root } = await render();
  await act(async () => {
    input(root).props.onFocus({ nativeEvent: {} });
  });
  const style = StyleSheet.flatten(input(root).props.style);
  expect(style.borderColor).toBe(FIELD.borderFocus);
  expect(style.transform).toBeUndefined();
  expect(FIELD.scaleFocus).toBe(1);
  // Without an error the focus-ring border is the focus state; no extra ring.
  expect(root.container.queryAll(n => n.props.testID === 'probe/ring')).toHaveLength(0);

  await act(async () => {
    input(root).props.onBlur({ nativeEvent: {} });
  });
  expect(StyleSheet.flatten(input(root).props.style).borderColor).toBe(FIELD.border);
});

test('error: error border (also when focused), error text and accessibility hint', async () => {
  const { root } = await render({ error: 'Проверьте номер телефона' });
  expect(StyleSheet.flatten(input(root).props.style).borderColor).toBe(FIELD.borderError);
  await act(async () => {
    input(root).props.onFocus({ nativeEvent: {} });
  });
  expect(StyleSheet.flatten(input(root).props.style).borderColor).toBe(FIELD.borderError);
  // Focus stays visible on an error field: the ring outside the red border.
  const [ring] = root.container.queryAll(n => n.props.testID === 'probe/ring');
  expect(StyleSheet.flatten(ring.props.style).borderColor).toBe(colors['focus-ring']);

  const [message] = root.container.queryAll(n => n.props.testID === 'probe/error');
  expect(StyleSheet.flatten(message.props.style).color).toBe(colors['error-text']);
  expect(JSON.stringify(message.toJSON?.() ?? root.container.toJSON())).toContain('Проверьте номер телефона');
  expect(input(root).props.accessibilityHint).toBe('Проверьте номер телефона');
});

test('focus() moves native focus to the non-collapsable host, not TextInput.focus()', async () => {
  const { root, ref } = await render();
  const [host] = root.container.queryAll(n => n.props.testID === 'probe/host');
  expect(host.props.collapsable).toBe(false);
  await act(async () => {
    ref.current?.focus();
  });
  const mock = requestHostFocus as jest.Mock;
  expect(mock).toHaveBeenCalledTimes(1);
  expect((mock.mock.calls[0][0] as { props: { testID: string } }).props.testID).toBe('probe/host');
  expect(ref.current?.host()).toBe(mock.mock.calls[0][0]);
});

test('passes input, submit and IME options through', async () => {
  const onChangeText = jest.fn();
  const onSubmitEditing = jest.fn();
  const { root } = await render({ onChangeText, onSubmitEditing, keyboardType: 'phone-pad', maxLength: 4 });
  const node = input(root);
  node.props.onChangeText('1');
  node.props.onSubmitEditing({ nativeEvent: { text: '1' } });
  expect(onChangeText).toHaveBeenCalledWith('1');
  expect(onSubmitEditing).toHaveBeenCalledTimes(1);
  expect(node.props).toMatchObject({
    keyboardType: 'phone-pad',
    maxLength: 4,
    returnKeyType: 'done',
    autoCorrect: false,
  });
});
