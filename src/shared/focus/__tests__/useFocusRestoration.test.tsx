import { act } from 'react';
import { createRoot } from 'test-renderer';
import type { HostView } from '../../ui';
import { requestHostFocus } from '../../ui/requestHostFocus';
import { focusRestoration } from '../focusRestoration';
import {
  useFocusRestoration,
  type ListRestoration,
  type RestorableList,
} from '../useFocusRestoration';

jest.mock('../../ui/requestHostFocus', () => ({ requestHostFocus: jest.fn() }));

const focusMock = requestHostFocus as jest.Mock;
const ROUTE = 'DevFocus-1';
const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `dev/list/${i + 1}`);
const view = (id: string) => ({ id } as unknown as HostView);

let hook: ListRestoration;
let calls: string[];
let list: RestorableList;
const focusAbove = jest.fn(() => calls.push('above'));

function Probe({ data }: { data: readonly string[] }) {
  hook = useFocusRestoration({
    routeKey: ROUTE,
    ids: data,
    listRef: { current: list },
    focusAbove,
  });
  return null;
}

async function render(data: readonly string[]) {
  const root = createRoot();
  await act(async () => {
    root.render(<Probe data={data} />);
  });
  return root;
}

function scroll(y: number) {
  hook.onScroll({ nativeEvent: { contentOffset: { x: 0, y } } } as never);
}

beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  focusRestoration.clear();
  focusMock.mockClear();
  focusAbove.mockClear();
  calls = [];
  focusMock.mockImplementation((v: { id: string }) =>
    calls.push(`focus ${v.id}`),
  );
  list = {
    scrollToOffset: jest.fn(({ offset }) => calls.push(`offset ${offset}`)),
    scrollToIndex: jest.fn(({ index }) => calls.push(`index ${index}`)),
  };
});

test('remembers id, index and the latest scroll offset on focus and on scroll', async () => {
  const root = await render(ids(300));
  scroll(5000);
  hook.onItemFocus('dev/list/150', 149);
  expect(focusRestoration.peek(ROUTE, 'main')).toEqual({
    focusId: 'dev/list/150',
    scrollOffset: 5000,
    index: 149,
  });
  scroll(5200);
  expect(focusRestoration.peek(ROUTE, 'main')?.scrollOffset).toBe(5200);
  await act(async () => root.unmount());
});

test('restore, same index: the remembered offset only (no recentring), then focus once mounted', async () => {
  const root = await render(ids(300));
  scroll(6000);
  hook.onItemFocus('dev/list/150', 149);

  // Back on the list: the card is not mounted yet (virtualized).
  const target = hook.restore();
  expect(target).toEqual({
    kind: 'item',
    id: 'dev/list/150',
    index: 149,
    fallback: 'none',
  });
  expect(calls).toEqual(['offset 6000']);
  expect(list.scrollToIndex).not.toHaveBeenCalled();

  // It mounts two frames later.
  await act(async () => {
    jest.advanceTimersByTime(20);
  });
  hook.itemRef('dev/list/150')(view('dev/list/150'));
  await act(async () => {
    jest.advanceTimersByTime(40);
  });
  expect(calls).toEqual(['offset 6000', 'focus dev/list/150']);
  expect(focusAbove).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

test('restore, index shifted: offset first, then the item by its current index', async () => {
  let root = await render(ids(300));
  scroll(6000);
  hook.onItemFocus('dev/list/150', 149);
  await act(async () => root.unmount());

  // Ten items above it were removed: same id, new index.
  root = await render(ids(300).slice(10));
  hook.itemRef('dev/list/150')(view('dev/list/150'));
  expect(hook.restore()).toMatchObject({
    id: 'dev/list/150',
    index: 139,
    fallback: 'none',
  });
  expect(calls).toEqual(['offset 6000', 'index 139', 'focus dev/list/150']);
  expect(list.scrollToIndex).toHaveBeenCalledWith({
    index: 139,
    animated: false,
    viewPosition: 0.5,
  });
  await act(async () => root.unmount());
});

test('restore, an override without an index (first fallback): scrolls to the item', async () => {
  const root = await render(ids(5));
  focusRestoration.setReturnFocus(ROUTE, 'gone');
  hook.itemRef('dev/list/1')(view('dev/list/1'));
  expect(hook.restore()).toMatchObject({
    id: 'dev/list/1',
    index: 0,
    fallback: 'first',
  });
  expect(calls).toEqual(['offset 0', 'index 0', 'focus dev/list/1']);
  await act(async () => root.unmount());
});

test('the remembered card was deleted → its neighbor by index', async () => {
  let root = await render(ids(300));
  hook.onItemFocus('dev/list/150', 149);
  await act(async () => root.unmount());

  root = await render(ids(300).filter(id => id !== 'dev/list/150'));
  hook.itemRef('dev/list/151')(view('dev/list/151'));
  expect(hook.restore()).toMatchObject({
    id: 'dev/list/151',
    index: 149,
    fallback: 'neighbor',
  });
  expect(calls).toEqual(['offset 0', 'focus dev/list/151']);
  await act(async () => root.unmount());
});

test('the list is empty → the nearest action above, no scroll', async () => {
  let root = await render(ids(3));
  hook.onItemFocus('dev/list/2', 1);
  await act(async () => root.unmount());

  root = await render([]);
  expect(hook.restore()).toEqual({ kind: 'above' });
  expect(calls).toEqual(['above']);
  await act(async () => root.unmount());
});

test('nothing remembered → none; focusInitial focuses the first item, or the action above', async () => {
  let root = await render(ids(3));
  expect(hook.restore()).toEqual({ kind: 'none' });
  expect(calls).toEqual([]);
  hook.itemRef('dev/list/1')(view('dev/list/1'));
  hook.focusInitial();
  expect(calls).toEqual(['focus dev/list/1']);
  await act(async () => root.unmount());

  calls = [];
  root = await render([]);
  hook.focusInitial();
  expect(calls).toEqual(['above']);
  await act(async () => root.unmount());
});

test('an item that never mounts → the action above after the frame budget', async () => {
  const root = await render(ids(300));
  hook.onItemFocus('dev/list/150', 149);
  hook.restore();
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(calls).toEqual(['offset 0', 'above']);
  await act(async () => root.unmount());
});

test('a newer restore cancels the pending focus loop of an older one', async () => {
  const root = await render(ids(300));
  hook.onItemFocus('dev/list/150', 149);
  hook.restore();
  hook.onItemFocus('dev/list/2', 1);
  hook.itemRef('dev/list/2')(view('dev/list/2'));
  hook.restore();
  hook.itemRef('dev/list/150')(view('dev/list/150'));
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
  expect(calls.filter(c => c.startsWith('focus'))).toEqual([
    'focus dev/list/2',
  ]);
  await act(async () => root.unmount());
});

test('the user moves focus during the wait: the pending focus does not steal it back', async () => {
  const root = await render(ids(300));
  hook.onItemFocus('dev/list/150', 149);
  hook.restore();
  // The user pressed a key: native focus lands on another card.
  hook.onItemFocus('dev/list/151', 150);
  hook.itemRef('dev/list/150')(view('dev/list/150'));
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(calls).toEqual(['offset 0']);
  expect(focusAbove).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

test('cancel (blur) stops the pending focus, including the action-above fallback', async () => {
  const root = await render(ids(300));
  hook.onItemFocus('dev/list/150', 149);
  hook.restore();
  hook.cancel();
  hook.itemRef('dev/list/150')(view('dev/list/150'));
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(calls).toEqual(['offset 0']);
  expect(focusAbove).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

test('unmount stops the pending focus', async () => {
  const root = await render(ids(300));
  hook.onItemFocus('dev/list/150', 149);
  hook.restore();
  await act(async () => root.unmount());
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(calls).toEqual(['offset 0']);
  expect(focusAbove).not.toHaveBeenCalled();
});
