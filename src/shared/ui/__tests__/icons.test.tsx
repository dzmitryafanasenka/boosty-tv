/**
 * The SVG icons (ADR 0013, react-native-svg 15.15.5, mocked by
 * `__mocks__/react-native-svg.js`): the ink colors the
 * strokes and fills, the ±10 icon carries «10» and mirrors for forward, and
 * the icons are hidden from accessibility (the control has the label).
 * Native drawing is a device check.
 */
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import {
  AudioIcon,
  FileIcon,
  GearIcon,
  HeartIcon,
  PollIcon,
  SkipIcon,
  TextPhotoIcon,
  VideoIcon,
  VideosIcon,
} from '../icons';

async function render(element: React.ReactElement): Promise<Root> {
  const root = createRoot();
  await act(async () => {
    root.render(element);
  });
  return root;
}

const all = (root: Root) => root.container.queryAll(() => true);

describe('SVG icons', () => {
  it.each([-1, 1] as const)('SkipIcon %p: «10» inside, ink everywhere, 24 dp by default, hidden from a11y', async direction => {
    const root = await render(<SkipIcon testID="i" direction={direction} color="#123456" />);
    const nodes = all(root);
    const svg = nodes.find(n => n.props.testID === 'i');
    expect(svg?.props.importantForAccessibility).toBe('no-hide-descendants');
    const digits = nodes.find(n => n.type === 'SvgText');
    expect(digits?.props.children).toBe('10');
    expect(digits?.props.textAnchor).toBe('middle');
    expect(svg?.props.width).toBe(24);
    const inked = nodes.filter(n => n.props.stroke === '#123456' || n.props.fill === '#123456');
    expect(inked.length).toBeGreaterThan(0);
    const mirrored = nodes.some(n => typeof n.props.transform === 'string' && n.props.transform.startsWith('matrix(-1'));
    expect(mirrored).toBe(direction === 1);
    await act(async () => root.unmount());
  });

  it('GearIcon: ring and teeth in the ink, custom size', async () => {
    const root = await render(<GearIcon testID="g" color="#abcdef" size={30} />);
    const nodes = all(root);
    expect(nodes.filter(n => n.props.fill === '#abcdef' && n.props.transform !== undefined)).toHaveLength(8);
    expect(nodes.some(n => n.props.stroke === '#abcdef')).toBe(true);
    await act(async () => root.unmount());
  });

  it.each([false, true])('HeartIcon (Story 7.4) filled=%p: the outline in the ink, filled only when liked', async filled => {
    const root = await render(<HeartIcon testID="h" color="#e8914a" filled={filled} size={16} />);
    const nodes = all(root);
    expect(nodes.find(n => n.props.testID === 'h')?.props.width).toBe(16);
    const heart = nodes.find(n => n.props.stroke === '#e8914a');
    expect(heart?.props.fill).toBe(filled ? '#e8914a' : 'none');
    await act(async () => root.unmount());
  });

  it.each([
    ['VideoIcon', VideoIcon],
    ['VideosIcon', VideosIcon],
    ['AudioIcon', AudioIcon],
    ['TextPhotoIcon', TextPhotoIcon],
    ['PollIcon', PollIcon],
    ['FileIcon', FileIcon],
  ])('%s (PostCard placeholder, 2026-10-30): drawn in the ink, sized, hidden from a11y', async (_name, Icon) => {
    const root = await render(<Icon testID="p" color="#b7b0a6" size={37} />);
    const nodes = all(root);
    const svg = nodes.find(n => n.props.testID === 'p');
    expect(svg?.props.width).toBe(37);
    expect(svg?.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(svg?.props.accessibilityElementsHidden).toBe(true);
    expect(nodes.some(n => n.props.stroke === '#b7b0a6' || n.props.fill === '#b7b0a6')).toBe(true);
    await act(async () => root.unmount());
  });
});
