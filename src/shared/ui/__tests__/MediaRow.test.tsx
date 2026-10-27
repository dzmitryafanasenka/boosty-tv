import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import type { VideoRow } from '../../entities/post';
import { MediaRow, mediaRowA11yLabel } from '../MediaRow';
import { colors, components, focus } from '../tokens';

const ID = 'row';
const evt = { nativeEvent: {} };
const PREVIEW = 'https://example.invalid/preview';

function row(overrides: Partial<VideoRow> = {}): VideoRow {
  return {
    ref: { blogUrl: 'blog', postId: 'post', mediaId: 'm1' },
    index: 0,
    title: 'Первая часть',
    durationSec: 754,
    previewUrl: PREVIEW,
    ...overrides,
  };
}

async function render(value: VideoRow, playable = false): Promise<Root> {
  const root = createRoot();
  await act(async () => {
    root.render(<MediaRow row={value} playable={playable} testID={ID} />);
  });
  return root;
}

const byId = (root: Root, testID: string) => root.container.queryAll(n => n.props.testID === testID);
const host = (root: Root) => byId(root, ID).filter(n => n.props.focusable !== undefined)[0];
const json = (root: Root) => JSON.stringify(root.container.toJSON());
const surface = (root: Root) =>
  StyleSheet.flatten(byId(root, `${ID}/scale`)[0].props.style) as Record<string, unknown>;

beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());

describe('MediaRow (Story 3.5)', () => {
  it('thumbnail, «Видео N», title and duration («12:34»)', async () => {
    const root = await render(row({ index: 1 }));
    expect(byId(root, `${ID}/label`)[0].props.children).toBe('Видео 2');
    expect(byId(root, `${ID}/title`)[0].props.children).toBe('Первая часть');
    expect(byId(root, `${ID}/duration`)[0].props.children).toBe('12:34');
    const [thumb] = byId(root, `${ID}/thumb`);
    expect(StyleSheet.flatten(thumb.props.style)).toMatchObject({ width: 96, height: 54 });
    await act(async () => root.unmount());
  });

  it('no title: «Видео N» only; no duration: no duration line', async () => {
    const root = await render(row({ title: '', durationSec: null }));
    expect(byId(root, `${ID}/title`)).toHaveLength(0);
    expect(byId(root, `${ID}/duration`)).toHaveLength(0);
    expect(byId(root, `${ID}/label`)[0].props.children).toBe('Видео 1');
    await act(async () => root.unmount());
  });

  it('never a status, progress or action before Epic 4', async () => {
    const root = await render(row());
    const text = json(root);
    for (const forbidden of ['Смотреть', 'Продолжить', 'С начала', 'Не начато', 'Осталось', 'Просмотрено']) {
      expect(text).not.toContain(forbidden);
    }
    // One focusable element: the row itself.
    expect(root.container.queryAll(n => n.props.focusable === true)).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it('the thumbnail: the preview URL alone (no headers), resize, no fade', async () => {
    const root = await render(row());
    const [thumb] = byId(root, `${ID}/thumb`);
    expect(thumb.props.source).toEqual({ uri: PREVIEW });
    expect(thumb.props.resizeMethod).toBe('resize');
    expect(thumb.props.fadeDuration).toBe(0);
    await act(async () => root.unmount());
  });

  it('no preview, or a preview that fails: the neutral placeholder', async () => {
    const none = await render(row({ previewUrl: null }));
    expect(byId(none, `${ID}/thumb`)).toHaveLength(0);
    expect(byId(none, `${ID}/thumb-placeholder`)).toHaveLength(1);
    await act(async () => none.unmount());

    const failing = await render(row());
    await act(async () => byId(failing, `${ID}/thumb`)[0].props.onError({ nativeEvent: {} }));
    expect(byId(failing, `${ID}/thumb`)).toHaveLength(0);
    expect(byId(failing, `${ID}/thumb-placeholder`)).toHaveLength(1);
    await act(async () => failing.unmount());
  });

  it('states: default, focused (ring, row background, scale-row), pressed', async () => {
    const root = await render(row());
    expect(byId(root, `${ID}/ring`)).toHaveLength(0);
    expect(surface(root).backgroundColor).toBe(colors.surface);
    await act(async () => host(root).props.onFocus(evt));
    expect(byId(root, `${ID}/ring`)).toHaveLength(1);
    expect(surface(root).backgroundColor).toBe(colors['surface-focus-row']);
    expect(components['media-row'].scaleFocus).toBe(focus['scale-row']);
    expect(surface(root).height).toBe(components['media-row'].height);
    await act(async () => host(root).props.onPressIn(evt));
    expect(byId(root, `${ID}/ring`)).toHaveLength(1);
    await act(async () => host(root).props.onPressOut(evt));
    await act(async () => host(root).props.onBlur(evt));
    expect(byId(root, `${ID}/ring`)).toHaveLength(0);
    expect(surface(root).backgroundColor).toBe(colors.surface);
    await act(async () => root.unmount());
  });

  it('accessibility label «Видео N. {title}. {duration}», leaving out what is missing', async () => {
    expect(mediaRowA11yLabel(row())).toBe('Видео 1. Первая часть. 12:34');
    expect(mediaRowA11yLabel(row({ title: '' }))).toBe('Видео 1. 12:34');
    expect(mediaRowA11yLabel(row({ durationSec: null, index: 2 }))).toBe('Видео 3. Первая часть');
    expect(mediaRowA11yLabel(row({ title: '', durationSec: null }))).toBe('Видео 1');
    expect(mediaRowA11yLabel(row({ durationSec: 3960 }))).toBe('Видео 1. Первая часть. 1:06:00');
    const root = await render(row());
    expect(host(root).props.accessibilityLabel).toBe('Видео 1. Первая часть. 12:34');
    await act(async () => root.unmount());
  });

  it('player off (`playable` false): the text role, no action; on: the button role, still no action in Story 3.5', async () => {
    const off = await render(row());
    expect(host(off).props.accessibilityRole).toBe('text');
    expect(host(off).props.onPress).toBeUndefined();
    expect(host(off).props.accessibilityLabel).toBe('Видео 1. Первая часть. 12:34');
    expect(json(off)).not.toContain('Смотреть');
    await act(async () => off.unmount());
    const on = await render(row(), true);
    expect(host(on).props.accessibilityRole).toBe('button');
    expect(host(on).props.onPress).toBeUndefined();
    expect(json(on)).not.toContain('Смотреть');
    await act(async () => on.unmount());
  });

  it('a failed thumbnail starts over when the preview URL changes (same media id)', async () => {
    const OTHER = 'https://example.invalid/preview-b';
    const root = await render(row());
    await act(async () => byId(root, `${ID}/thumb`)[0].props.onError({ nativeEvent: {} }));
    expect(byId(root, `${ID}/thumb`)).toHaveLength(0);
    await act(async () => {
      root.render(<MediaRow row={row({ previewUrl: OTHER })} playable={false} testID={ID} />);
    });
    const [thumb] = byId(root, `${ID}/thumb`);
    expect(thumb.props.source).toEqual({ uri: OTHER });
    expect(byId(root, `${ID}/thumb-placeholder`)).toHaveLength(0);
    await act(async () => root.unmount());
  });

  it('the thumbnail and the ring stay inside the right column headroom when scaled', () => {
    // Right column ≈ 440 dp of row width (see PostScreen); scale-row growth + ring < 12.
    const growth = (440 * (components['media-row'].scaleFocus - 1)) / 2 + focus['ring-width'] + focus['ring-offset'];
    expect(growth).toBeLessThan(12);
  });
});

describe('MediaRow native view budget (as PostCard)', () => {
  /** Style keys that keep a View from being flattened away by Fabric. */
  const PAINT = /^(background|border|opacity|transform|overflow|shadow|elevation|zIndex)/;

  async function count(value: VideoRow) {
    const root = await render(value);
    const hosts = root.container.queryAll(n => typeof n.type === 'string');
    const native = hosts.filter(n => {
      if (n.type !== 'View') {
        return true;
      }
      const p = n.props;
      if (p.testID || p.nativeID || p.collapsable === false || p.focusable !== undefined) {
        return true;
      }
      if (Object.keys(p).some(k => k.startsWith('accessib') || k === 'pointerEvents')) {
        return true;
      }
      const style = StyleSheet.flatten(p.style) ?? {};
      return Object.keys(style).some(k => PAINT.test(k));
    });
    await act(async () => root.unmount());
    return native.length;
  }

  it('a full row (thumb, label, title, duration): ≤ 6 native views', async () => {
    expect(await count(row())).toBeLessThanOrEqual(6);
  });
});
