import { act } from 'react';
import { View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import type { HostView } from '../../ui/FocusableSurface';
import { useColumnStop } from '../useColumnStop';

/** Every call the hook makes, in order: the zone's and the screen's. */
const calls: string[] = [];
const kind = (view: unknown) => (view === null ? 'null' : 'view');

jest.mock('../FocusZone', () => ({
  useZoneItem: (focusId: string) => {
    const React = jest.requireActual('react');
    return React.useMemo(
      () => ({
        ref: (view: unknown) => calls.push(`zone.ref(${focusId}, ${view === null ? 'null' : 'view'})`),
        onFocus: () => calls.push(`zone.onFocus(${focusId})`),
      }),
      [focusId],
    );
  },
}));

const onView = (id: string, view: HostView | null) => calls.push(`screen.onView(${id}, ${kind(view)})`);
const onFocus = (id: string) => calls.push(`screen.onFocus(${id})`);

let api: ReturnType<typeof useColumnStop>;
/** A stop as the post blocks use it: the hook's ref on a host view. */
function Probe({ id }: { id: string }) {
  api = useColumnStop(id, onView, onFocus);
  return <View testID={id} ref={api.ref} />;
}

let root: Root;
beforeEach(() => {
  calls.length = 0;
  root = createRoot();
});

describe('useColumnStop', () => {
  it('mount: the view registers with the zone, then the screen, and is kept in viewRef', async () => {
    await act(async () => root.render(<Probe id="a" />));
    expect(calls).toEqual(['zone.ref(a, view)', 'screen.onView(a, view)']);
    expect(api.viewRef.current).not.toBeNull();
    await act(async () => root.unmount());
  });

  it('handleFocus tells the zone first, then the screen', async () => {
    await act(async () => root.render(<Probe id="a" />));
    calls.length = 0;
    await act(async () => api.handleFocus());
    expect(calls).toEqual(['zone.onFocus(a)', 'screen.onFocus(a)']);
    await act(async () => root.unmount());
  });

  it('an id change: the old id is dropped first (null), then the same view registers under the new id', async () => {
    await act(async () => root.render(<Probe id="a" />));
    const mounted = api.viewRef.current;
    calls.length = 0;
    await act(async () => root.render(<Probe id="b" />));
    expect(calls).toEqual(['zone.ref(a, null)', 'screen.onView(a, null)', 'zone.ref(b, view)', 'screen.onView(b, view)']);
    expect(api.viewRef.current).toBe(mounted);
    calls.length = 0;
    await act(async () => api.handleFocus());
    expect(calls).toEqual(['zone.onFocus(b)', 'screen.onFocus(b)']);
    await act(async () => root.unmount());
  });

  it('unmount: unregisters from the zone and the screen and clears viewRef', async () => {
    await act(async () => root.render(<Probe id="a" />));
    calls.length = 0;
    await act(async () => root.unmount());
    expect(calls).toEqual(['zone.ref(a, null)', 'screen.onView(a, null)']);
    expect(api.viewRef.current).toBeNull();
  });
});
