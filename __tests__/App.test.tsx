import { act } from 'react';
import { createRoot } from 'test-renderer';
import App from '../src/app/App';

test('renders the placeholder screen with one focusable button', async () => {
  const renderer = createRoot();
  await act(async () => {
    renderer.render(<App />);
  });

  const button = renderer.container.queryAll(
    node => node.props.testID === 'placeholder-button',
  );
  expect(button).toHaveLength(1);
  expect(button[0].props.hasTVPreferredFocus).toBe(true);
  expect(button[0].props.focusable).toBe(true);
  expect(JSON.stringify(renderer.container.toJSON())).toContain(
    'Проверить фокус',
  );

  await act(async () => {
    // Pressable forwards a press (OK / DPAD_CENTER) to the host view as onClick.
    button[0].props.onClick({ nativeEvent: {} });
  });
  expect(JSON.stringify(renderer.container.toJSON())).toContain('Нажато: 1');

  await act(async () => {
    renderer.unmount();
  });
});
