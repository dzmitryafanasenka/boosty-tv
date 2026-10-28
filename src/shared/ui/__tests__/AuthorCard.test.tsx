import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import type { Author } from '../../entities/author';
import {
  AUTHOR_CARD_HEIGHT,
  AuthorCard,
  AuthorCardSkeleton,
  authorCardA11yLabel,
  authorCardWidth,
} from '../AuthorCard';
import { t } from '../../i18n';
import { colors, components, focus, spacing } from '../tokens';

const ID = 'tile';
const evt = { nativeEvent: {} };
const WIDTH = 224;

const author = (overrides: Partial<Author> = {}): Author => ({
  blogUrl: 'synthetic-blog-1',
  title: 'Кухня без спешки',
  ownerName: 'Марина Лебедева',
  avatarUrl: 'https://example.invalid/avatar',
  ...overrides,
});

async function render(a: Author, label?: string): Promise<Root> {
  const root = createRoot();
  await act(async () => {
    root.render(<AuthorCard author={a} width={WIDTH} testID={ID} label={label} />);
  });
  return root;
}

const byId = (root: Root, testID: string) =>
  root.container.queryAll(node => node.props.testID === testID);
const host = (root: Root) => byId(root, ID).filter(node => node.props.focusable !== undefined)[0];
const json = (root: Root) => JSON.stringify(root.container.toJSON());
const avatars = (root: Root) =>
  root.container.queryAll(n => n.type === 'Image' && n.props.testID === `${ID}/avatar`);

beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());

describe('AuthorCard', () => {
  it('avatar, the owner name first (2 lines), the blog title under it (1 line); one focusable element', async () => {
    const root = await render(author());
    const [title] = byId(root, `${ID}/title`);
    const [owner] = byId(root, `${ID}/owner`);
    expect(owner.props.children).toBe('Марина Лебедева');
    expect(owner.props.numberOfLines).toBe(2);
    expect(title.props.children).toBe('Кухня без спешки');
    expect(title.props.numberOfLines).toBe(1);
    // The name line comes before the title line.
    const texts = root.container.queryAll(n => n.props.testID === `${ID}/owner` || n.props.testID === `${ID}/title`);
    expect(texts.map(n => n.props.testID)).toEqual([`${ID}/owner`, `${ID}/title`]);
    const [avatar] = avatars(root);
    expect(avatar.props.source.uri).toBe('https://example.invalid/avatar');
    // List images: decoded at the view size, no fade (Story 3.1 device lessons).
    expect(avatar.props.resizeMethod).toBe('resize');
    expect(avatar.props.fadeDuration).toBe(0);
    expect(root.container.queryAll(n => n.props.focusable === true)).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it('accessibility label «{name}. {title}», role button', async () => {
    const root = await render(author());
    expect(host(root).props.accessibilityLabel).toBe('Марина Лебедева. Кухня без спешки');
    expect(host(root).props.accessibilityRole).toBe('button');
    await act(async () => root.unmount());
  });

  it('no owner: no owner line, the label is the title alone', async () => {
    const root = await render(author({ ownerName: null }));
    expect(byId(root, `${ID}/owner`)).toHaveLength(0);
    expect(host(root).props.accessibilityLabel).toBe('Кухня без спешки');
    expect(authorCardA11yLabel(author({ ownerName: null }))).toBe('Кухня без спешки');
    await act(async () => root.unmount());
  });

  it('no avatar: the placeholder; a failed avatar falls back to it', async () => {
    const without = await render(author({ avatarUrl: null }));
    expect(avatars(without)).toHaveLength(0);
    expect(byId(without, `${ID}/avatar-placeholder`)).toHaveLength(1);
    await act(async () => without.unmount());

    const failing = await render(author());
    await act(async () => avatars(failing)[0].props.onError({ nativeEvent: {} }));
    expect(avatars(failing)).toHaveLength(0);
    expect(byId(failing, `${ID}/avatar-placeholder`)).toHaveLength(1);
    await act(async () => failing.unmount());
  });

  it('no price, currency, subscribe or comment text', async () => {
    const root = await render(author());
    const text = json(root);
    for (const forbidden of ['₽', 'RUB', 'USD', 'Оформить', 'Подписаться', 'руб', 'коммент']) {
      expect(text).not.toContain(forbidden);
    }
    await act(async () => root.unmount());
  });

  it('focus states: ring, lifted surface and the author-card scale on focus; none on blur', async () => {
    const root = await render(author());
    const surface = () => StyleSheet.flatten(byId(root, `${ID}/scale`)[0].props.style);
    const rest = surface().backgroundColor;
    expect(byId(root, `${ID}/ring`)).toHaveLength(0);
    await act(async () => host(root).props.onFocus(evt));
    expect(byId(root, `${ID}/ring`)).toHaveLength(1);
    expect(surface().backgroundColor).not.toBe(rest);
    await act(async () => host(root).props.onBlur(evt));
    expect(byId(root, `${ID}/ring`)).toHaveLength(0);
    expect(surface().backgroundColor).toBe(rest);
    expect(components['author-card'].scaleFocus).toBe(1.05);
    await act(async () => root.unmount());
  });

  it('no title: the name alone, no second line; no owner either: «Без названия» (as PostCard)', async () => {
    const root = await render(author({ title: '' }));
    expect(byId(root, `${ID}/title`)).toHaveLength(0);
    expect(host(root).props.accessibilityLabel).toBe('Марина Лебедева');
    await act(async () => root.unmount());
    const neither = await render(author({ title: '', ownerName: null }));
    expect(byId(neither, `${ID}/title`)[0].props.children).toBe(t('postCard.untitled'));
    expect(host(neither).props.accessibilityLabel).toBe(t('postCard.untitled'));
    await act(async () => neither.unmount());
  });

  it('a title equal to the name is not repeated', async () => {
    const root = await render(author({ title: 'марина  Лебедева' }));
    expect(byId(root, `${ID}/title`)).toHaveLength(0);
    expect(host(root).props.accessibilityLabel).toBe('Марина Лебедева');
    await act(async () => root.unmount());
  });

  it('a recycled cell: a new author has no ring and shows its avatar again after a failure', async () => {
    const root = await render(author());
    await act(async () => host(root).props.onFocus(evt));
    await act(async () => avatars(root)[0].props.onError({ nativeEvent: {} }));
    expect(byId(root, `${ID}/ring`)).toHaveLength(1);
    expect(avatars(root)).toHaveLength(0);
    await act(async () => {
      root.render(
        <AuthorCard
          author={author({ blogUrl: 'synthetic-blog-2', avatarUrl: 'https://example.invalid/avatar-b' })}
          width={WIDTH}
          testID={ID}
        />,
      );
    });
    expect(byId(root, `${ID}/ring`)).toHaveLength(0);
    expect(avatars(root)).toHaveLength(1);
    expect(avatars(root)[0].props.source.uri).toBe('https://example.invalid/avatar-b');
    await act(async () => root.unmount());
  });
});

describe('AuthorCard geometry', () => {
  it('3 tiles fit 720 dp with focus headroom on both sides; the scaled tile stays inside it', () => {
    const width = authorCardWidth(spacing['content-width'], 3);
    expect(width).toBe(224);
    const used = 3 * width + 2 * spacing['author-tile-gap'] + 2 * spacing['focus-headroom'];
    expect(used).toBeLessThanOrEqual(spacing['content-width']);
    // Scale growth on each side plus the ring (offset + width).
    const ring = focus['ring-offset'] + focus['ring-width'];
    const growthX = (width * (components['author-card'].scaleFocus - 1)) / 2 + ring;
    expect(growthX).toBeLessThan(spacing['focus-headroom']);
    // Vertically, half the row gap (the slot padding) holds it.
    const growthY = (AUTHOR_CARD_HEIGHT * (components['author-card'].scaleFocus - 1)) / 2 + ring;
    expect(growthY).toBeLessThanOrEqual(spacing['author-tile-gap'] / 2);
  });

  it('the skeleton has the tile geometry and is not focusable', async () => {
    const root = createRoot();
    await act(async () => {
      root.render(<AuthorCardSkeleton width={WIDTH} testID="sk" />);
    });
    const [sk] = byId(root, 'sk');
    expect(StyleSheet.flatten(sk.props.style)).toMatchObject({
      width: WIDTH,
      height: AUTHOR_CARD_HEIGHT,
    });
    expect(sk.props.focusable).toBe(false);
    expect(root.container.queryAll(n => n.props.focusable === true)).toHaveLength(0);
    await act(async () => root.unmount());
  });
});

describe('AuthorCard native view budget (Story 3.1 device profiling)', () => {
  /** Style keys that keep a View from being flattened away by Fabric. */
  const PAINT = /^(background|border|opacity|transform|overflow|shadow|elevation|zIndex)/;

  async function count(a: Author, label?: string) {
    const root = await render(a, label);
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
    return { hosts: hosts.length, native: native.length };
  }

  it('a tile with avatar, title and owner: ≤ 5 native views', async () => {
    const { hosts, native } = await count(author());
    expect(native).toBeLessThanOrEqual(5);
    expect(hosts).toBeLessThanOrEqual(6);
  });

  it('a labelled tile («Мой блог»): the label adds its tint view and its text only (≤ 7 native views)', async () => {
    const { hosts, native } = await count(author(), 'Мой блог');
    expect(native).toBeLessThanOrEqual(7);
    expect(hosts).toBeLessThanOrEqual(8);
  });
});

describe('AuthorCard «Мой блог» label (Story 5.2, UX-DR7)', () => {
  it('a tinted label above the name: accent-tint background, accent-text text; first in the a11y label', async () => {
    const root = await render(author(), t('subs.myBlog'));
    const [label] = byId(root, `${ID}/label`);
    expect(label).toBeDefined();
    expect(StyleSheet.flatten(label.props.style).backgroundColor).toBe(colors['accent-tint']);
    expect(json(root)).toContain('Мой блог');
    expect(json(root)).toContain(colors['accent-text']);
    expect(host(root).props.accessibilityLabel).toBe('Мой блог. Марина Лебедева. Кухня без спешки');
    expect(authorCardA11yLabel(author({ ownerName: null }), 'Мой блог')).toBe(
      'Мой блог. Кухня без спешки',
    );
    // Still one focusable element; the label is not focusable.
    expect(root.container.queryAll(n => n.props.focusable === true)).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it('a long owner name with the label: one name line (fits the fixed card height); two without', async () => {
    const long = author({ ownerName: 'Очень длинное имя владельца блога, которое не помещается в одну строку' });
    const nameLines = (root: Root) => byId(root, `${ID}/owner`)[0].props.numberOfLines;
    const labelled = await render(long, 'Мой блог');
    expect(nameLines(labelled)).toBe(1);
    expect(byId(labelled, `${ID}/title`)[0].props.numberOfLines).toBe(1);
    // label (badge 13 + 2 × 1) + gap 2 + one name line 16 + gap 2 + title 15 ≤ 76.
    await act(async () => labelled.unmount());
    const plain = await render(long);
    expect(nameLines(plain)).toBe(2);
    await act(async () => plain.unmount());
  });

  it('no label prop: no label view', async () => {
    const root = await render(author());
    expect(byId(root, `${ID}/label`)).toHaveLength(0);
    await act(async () => root.unmount());
  });
});
