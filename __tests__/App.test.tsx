import { act } from 'react';
import { createRoot } from 'test-renderer';
import App from '../src/app/App';
import { t } from '../src/shared/i18n';

/** A1 Welcome (docs/focus-map.md §2). */
test('renders A1 Welcome with one focusable, initially focused sign-in button', async () => {
  const renderer = createRoot();
  await act(async () => {
    renderer.render(<App />);
  });

  const focusable = renderer.container.queryAll(
    node => node.props.focusable === true,
  );
  expect(focusable).toHaveLength(1);
  const [button] = focusable;
  expect(button.props.testID).toBe('auth/welcome/signin');
  expect(button.props.hasTVPreferredFocus).toBe(true);
  expect(button.props.accessibilityRole).toBe('button');
  expect(button.props.accessibilityLabel).toBe('Войти в Boosty');
  expect(button.props.accessibilityLabel).toBe(t('welcome.signIn'));

  const text = JSON.stringify(renderer.container.toJSON());
  expect(text).toContain(t('welcome.signIn'));
  expect(text).toContain(t('welcome.titleHead'));
  expect(text).toContain(t('welcome.titleAccent'));
  expect(text).toContain(t('welcome.body'));
  expect(text).toContain(t('welcome.disclaimer'));

  // OK does nothing yet (A2 lands in Story 2.2): the tree stays unchanged
  // after the TV press path and the click path (OK / DPAD_CENTER).
  const before = JSON.stringify(renderer.container.toJSON());
  await act(async () => {
    button.props.onPressIn({ nativeEvent: {} });
  });
  await act(async () => {
    button.props.onPressOut({ nativeEvent: {} });
  });
  await act(async () => {
    button.props.onClick({ nativeEvent: {} });
  });
  expect(JSON.stringify(renderer.container.toJSON())).toBe(before);

  await act(async () => {
    renderer.unmount();
  });
});
