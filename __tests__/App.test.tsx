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

  // OK opens A2: __tests__/signInFlow.test.tsx.

  await act(async () => {
    renderer.unmount();
  });
});
