import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { tf } from '../../../shared/i18n';
import type { KnownRelease } from '../releaseInfo';
import { UPDATE_PLAQUE_MS, UpdatePlaqueHost } from '../UpdatePlaque';
import { createUpdateStore } from '../updateStore';

const RELEASE: KnownRelease = {
  tag: 'v0.9.1',
  version: '0.9.1',
  pageUrl: 'https://github.com/dzmitryafanasenka/boosty-tv/releases/tag/v0.9.1',
  notes: '',
  assets: [],
};

async function render(element: React.ReactElement): Promise<Root> {
  const root = createRoot();
  await act(async () => {
    root.render(element);
  });
  return root;
}

const plaque = (root: Root) => root.container.queryAll(n => n.props.testID === 'update/plaque');

beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());

describe('UpdatePlaqueHost (Story 9.2)', () => {
  it('shows «Доступна версия X.Y.Z · Настройки → Версия» for about 10 s; not focusable, no touches, hidden from accessibility', async () => {
    const store = createUpdateStore();
    const root = await render(<UpdatePlaqueHost store={store} suppressed={false} />);
    expect(plaque(root)).toHaveLength(0);
    await act(async () => store.showPlaque(RELEASE));
    const [view] = plaque(root);
    expect(view.props).toMatchObject({ focusable: false, pointerEvents: 'none', importantForAccessibility: 'no-hide-descendants' });
    expect(JSON.stringify(root.container.toJSON())).toContain(tf('update.plaque', { version: '0.9.1' }));
    expect(root.container.queryAll(n => n.props.focusable === true)).toHaveLength(0);
    await act(async () => {
      jest.advanceTimersByTime(UPDATE_PLAQUE_MS - 1);
    });
    expect(plaque(root)).toHaveLength(1);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(plaque(root)).toHaveLength(0);
    expect(store.get().plaque).toBeNull();
  });

  it('matrix «Player on top»: no plaque, and one that arrives meanwhile is dropped, not deferred', async () => {
    const store = createUpdateStore();
    const root = await render(<UpdatePlaqueHost store={store} suppressed />);
    await act(async () => store.showPlaque(RELEASE));
    expect(plaque(root)).toHaveLength(0);
    expect(store.get().plaque).toBeNull();
    await act(async () => root.render(<UpdatePlaqueHost store={store} suppressed={false} />));
    expect(plaque(root)).toHaveLength(0);
  });

  it('the Player opening hides a visible plaque', async () => {
    const store = createUpdateStore();
    const root = await render(<UpdatePlaqueHost store={store} suppressed={false} />);
    await act(async () => store.showPlaque(RELEASE));
    expect(plaque(root)).toHaveLength(1);
    await act(async () => root.render(<UpdatePlaqueHost store={store} suppressed />));
    expect(plaque(root)).toHaveLength(0);
    expect(store.get().plaque).toBeNull();
  });
});
