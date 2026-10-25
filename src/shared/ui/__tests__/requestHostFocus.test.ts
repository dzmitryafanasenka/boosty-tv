import type { HostView } from '../FocusableSurface';
import { requestHostFocus } from '../requestHostFocus';

/** The real module: every screen test mocks it, so its contract is proven here. */
test('calls requestTVFocus once on a view that has it', () => {
  const requestTVFocus = jest.fn();
  requestHostFocus({ requestTVFocus } as unknown as HostView);
  expect(requestTVFocus).toHaveBeenCalledTimes(1);
});

test('null, undefined or a view without the method: no throw', () => {
  expect(() => requestHostFocus(null)).not.toThrow();
  expect(() => requestHostFocus(undefined)).not.toThrow();
  expect(() => requestHostFocus({} as unknown as HostView)).not.toThrow();
});
