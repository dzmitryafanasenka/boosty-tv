/**
 * Test-only TVEventHandler mock (Story 4.1): the listeners `useTVEventHandler`
 * adds, plus `emit()` to simulate a remote key. Each test file opts in:
 *
 *   jest.mock('react-native/Libraries/Components/TV/TVEventHandler', () =>
 *     require('../src/test/tvEventMock'),
 *   );
 *
 * and reads the same instance with `import { tvEvents } from '../src/test/tvEventMock'`.
 */
type TvEvent = { eventType: string; eventKeyAction?: number; tag?: number };
type Listener = (event: TvEvent) => void;

const listeners = new Set<Listener>();

export const tvEvents = {
  /** Test-only: forget every listener (call in `beforeEach`). */
  reset: () => listeners.clear(),
  /** Test-only: the number of subscribed listeners. */
  count: () => listeners.size,
  /** Test-only: deliver one event to every listener. */
  emit: (event: TvEvent) => {
    for (const listener of [...listeners]) {
      listener(event);
    }
  },
};

const TVEventHandler = {
  addListener: (listener: Listener) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  },
};

export default TVEventHandler;
