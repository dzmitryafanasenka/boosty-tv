/**
 * Test-only BackHandler mock: a handler stack like Android's (the newest
 * handler first) plus `pressBack()` to simulate the remote's Back key.
 * Each test file opts in explicitly (no root `__mocks__`, so other suites
 * keep the real module):
 *
 *   jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
 *     require('../src/test/backHandlerMock'),
 *   );
 *
 * and reads the same instance with `import backHandler from
 * '../src/test/backHandlerMock'`. The handler stack lives for the whole
 * test file, as in the per-file copies this replaces.
 */
type Handler = () => boolean | null | undefined;

const handlers: Handler[] = [];

const backHandler = {
  exitApp: jest.fn(),
  addEventListener: (_name: string, handler: Handler) => {
    handlers.push(handler);
    return {
      remove: () => {
        const index = handlers.lastIndexOf(handler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
      },
    };
  },
  /** Test-only: empties the handler stack and clears `exitApp` (call in `beforeEach`). */
  reset: () => {
    handlers.length = 0;
    backHandler.exitApp.mockClear();
  },
  /** Test-only: the number of registered handlers. */
  count: () => handlers.length,
  /** Test-only: like Android, the newest handler first; none handled → `exitApp`. */
  pressBack: () => {
    for (let i = handlers.length - 1; i >= 0; i -= 1) {
      if (handlers[i]()) {
        return true;
      }
    }
    backHandler.exitApp();
    return false;
  },
};

export default backHandler;
