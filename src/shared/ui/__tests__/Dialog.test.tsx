import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { Dialog } from '../Dialog';
import { components } from '../tokens';

type Node = ReturnType<Root['container']['queryAll']>[number];

async function render(element: React.ReactElement): Promise<Root> {
  const root = createRoot();
  await act(async () => {
    root.render(element);
  });
  return root;
}

function focusable(root: Root, testID: string): Node {
  const nodes = root.container.queryAll(
    n => n.props.testID === testID && n.props.focusable === true,
  );
  expect(nodes).toHaveLength(1);
  return nodes[0];
}

function json(root: Root): string {
  return JSON.stringify(root.container.toJSON());
}

const actions = () => ({
  primary: { testID: 'd/cancel', label: 'Отмена', onPress: jest.fn() },
  secondary: { testID: 'd/confirm', label: 'Выйти', onPress: jest.fn() },
});

test('title, body and two actions in order; the first action is the preferred focus', async () => {
  const a = actions();
  const root = await render(<Dialog testID="d" title="Заголовок" body="Текст" {...a} />);
  const text = json(root);
  expect(text).toContain('Заголовок');
  expect(text).toContain('Текст');
  const ids = root.container
    .queryAll(n => n.props.focusable === true)
    .map(n => n.props.testID);
  expect(ids).toEqual(['d/cancel', 'd/confirm']);
  expect(focusable(root, 'd/cancel').props.hasTVPreferredFocus).toBe(true);
  expect(focusable(root, 'd/confirm').props.hasTVPreferredFocus).toBeFalsy();
  expect(focusable(root, 'd/cancel').props.accessibilityLabel).toBe('Отмена');
  expect(root.container.queryAll(n => n.props.testID === 'd/error')).toHaveLength(0);
});

test('DESIGN Dialog tokens: max width 560, rounded.xl, surface', async () => {
  const root = await render(<Dialog testID="d" title="T" body="B" {...actions()} />);
  const [box] = root.container.queryAll(n => n.props.testID === 'd');
  const style = StyleSheet.flatten(box.props.style);
  expect(style.maxWidth).toBe(components.dialog.maxWidth);
  expect(style.borderRadius).toBe(components.dialog.radius);
  expect(style.backgroundColor).toBe(components.dialog.bg);
});

test('OK runs the action; a busy action shows a spinner and ignores OK', async () => {
  const a = actions();
  const root = await render(<Dialog testID="d" title="T" body="B" {...a} />);
  await act(async () => {
    focusable(root, 'd/confirm').props.onClick({ nativeEvent: {} });
  });
  expect(a.secondary.onPress).toHaveBeenCalledTimes(1);
  await act(async () => {
    root.render(
      <Dialog testID="d" title="T" body="B" primary={a.primary} secondary={{ ...a.secondary, busy: true }} />,
    );
  });
  expect(root.container.queryAll(n => n.props.testID === 'd/confirm/spinner').length).toBeGreaterThan(0);
  const confirm = focusable(root, 'd/confirm');
  expect(confirm.props.accessibilityState).toMatchObject({ busy: true });
  await act(async () => {
    confirm.props.onClick?.({ nativeEvent: {} });
  });
  expect(a.secondary.onPress).toHaveBeenCalledTimes(1);
});

test('the error line is a polite live region', async () => {
  const root = await render(
    <Dialog testID="d" title="T" body="B" error="Не удалось" {...actions()} />,
  );
  const [line] = root.container.queryAll(n => n.props.testID === 'd/error');
  expect(line.props.accessibilityLiveRegion).toBe('polite');
  expect(json(root)).toContain('Не удалось');
});
