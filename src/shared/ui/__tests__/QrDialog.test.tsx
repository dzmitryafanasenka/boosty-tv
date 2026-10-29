import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { QR_QUIET_ZONE } from '../../platform/qrRenderer';
import { QR_CLOSE_ID, QrDialog } from '../QrDialog';
import { requestHostFocus } from '../requestHostFocus';
import { colors, components } from '../tokens';

jest.mock('../requestHostFocus', () => ({ requestHostFocus: jest.fn() }));

async function render(element: React.ReactElement): Promise<Root> {
  const root = createRoot();
  await act(async () => {
    root.render(element);
  });
  return root;
}

const byId = (root: Root, testID: string) => root.container.queryAll(n => n.props.testID === testID);
const json = (root: Root) => JSON.stringify(root.container.toJSON());
const VALUE = 'https://example.invalid/file?sig=SECRET-VALUE';

beforeEach(() => (requestHostFocus as jest.Mock).mockClear());

test('title, the QR (200 dp, ecl M, white quiet zone), «Откроется на телефоне», «Закрыть» focused; the value is never text', async () => {
  const onClose = jest.fn();
  const root = await render(<QrDialog title="report.pdf" value={VALUE} onClose={onClose} />);
  const text = json(root);
  expect(text).toContain('report.pdf');
  expect(text).toContain('Откроется на телефоне');
  expect(text).not.toContain('SECRET-VALUE');
  expect(text).not.toContain('example.invalid');
  // The library's SVG: 200 dp, the quiet zone in the viewBox, white background, black modules.
  const [svg] = root.container.queryAll(n => n.type === 'Svg');
  expect(svg.props.width).toBe(components['qr-dialog'].qrSize);
  expect(svg.props.height).toBe(200);
  expect(svg.props.viewBox).toBe(`${-QR_QUIET_ZONE} ${-QR_QUIET_ZONE} ${200 + 2 * QR_QUIET_ZONE} ${200 + 2 * QR_QUIET_ZONE}`);
  const [bg] = root.container.queryAll(n => n.type === 'Rect');
  expect(bg.props.fill).toBe(colors['qr-bg']);
  const [path] = root.container.queryAll(n => n.type === 'Path');
  expect(path.props.stroke).toBe('#000000');
  expect(String(path.props.d).length).toBeGreaterThan(100);
  // The code box sits on `qr-bg`.
  expect(StyleSheet.flatten(byId(root, 'dialog/qr/code')[0].props.style)).toMatchObject({
    width: 200,
    height: 200,
    backgroundColor: colors['qr-bg'],
  });
  // «Закрыть»: the only focusable element, preferred focus and an explicit request.
  const focusable = root.container.queryAll(n => n.props.focusable === true).map(n => n.props.testID);
  expect(focusable).toEqual([QR_CLOSE_ID]);
  const [close] = root.container.queryAll(n => n.props.testID === QR_CLOSE_ID && n.props.focusable === true);
  expect(close.props.hasTVPreferredFocus).toBe(true);
  expect(close.props.accessibilityLabel).toBe('Закрыть');
  expect(requestHostFocus).toHaveBeenCalledTimes(1);
  await act(async () => close.props.onClick({ nativeEvent: {} }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('different values draw different codes (generated on the device)', async () => {
  const a = await render(<QrDialog title="t" value="https://example.invalid/a" onClose={() => {}} />);
  const b = await render(<QrDialog title="t" value="https://example.invalid/b" onClose={() => {}} />);
  const d = (root: Root) => root.container.queryAll(n => n.type === 'Path')[0].props.d;
  expect(d(a)).not.toBe(d(b));
});

test('a value that does not fit a QR code: «Не удалось показать QR-код», «Закрыть» still works; no render-phase update warning', async () => {
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  const root = await render(<QrDialog title="t" value={'x'.repeat(5000)} onClose={() => {}} />);
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
  expect(json(root)).toContain('Не удалось показать QR-код');
  expect(root.container.queryAll(n => n.type === 'Svg')).toHaveLength(0);
  expect(root.container.queryAll(n => n.props.testID === QR_CLOSE_ID && n.props.focusable === true)).toHaveLength(1);
});
