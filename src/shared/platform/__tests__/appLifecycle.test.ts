import { AppState } from 'react-native';
import { subscribeAppBackground, subscribeAppForeground } from '../appLifecycle';

/** Story 4.6: the AppLifecycle port reports transitions only. */

let handlers: Array<(state: string) => void> = [];
beforeEach(() => {
  handlers = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (s: string) => void) => {
    handlers.push(listener);
    return {
      remove: () => {
        handlers = handlers.filter(h => h !== listener);
      },
    };
  }) as unknown as typeof AppState.addEventListener);
});
afterEach(() => {
  jest.restoreAllMocks();
});
const emit = (state: string) => handlers.forEach(h => h(state));

it('background: once per transition, not again while it stays in the background', () => {
  const listener = jest.fn();
  subscribeAppBackground(listener);
  emit('background');
  emit('background');
  emit('active');
  emit('background');
  expect(listener).toHaveBeenCalledTimes(2);
});

it('foreground: only after leaving the foreground; unsubscribe stops it', () => {
  const listener = jest.fn();
  const off = subscribeAppForeground(listener);
  emit('active');
  expect(listener).not.toHaveBeenCalled();
  emit('background');
  emit('active');
  emit('active');
  expect(listener).toHaveBeenCalledTimes(1);
  off();
  emit('background');
  emit('active');
  expect(listener).toHaveBeenCalledTimes(1);
});
