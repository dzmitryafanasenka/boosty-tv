import { act } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { FocusableSurface } from '../FocusableSurface';
import { focus } from '../tokens';

const ID = 'probe';
const evt = { nativeEvent: {}, persist: () => {} };

let timing: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue({ remove: () => {} } as ReturnType<typeof AccessibilityInfo.addEventListener>);
  timing = jest.spyOn(Animated, 'timing');
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function pressIn(scalePressed?: number): Promise<Root> {
  const root = createRoot();
  await act(async () => {
    root.render(<FocusableSurface testID={ID} radius={4} scaleFocus={1} scalePressed={scalePressed} />);
  });
  const [host] = root.container.queryAll(node => node.props.testID === ID);
  await act(async () => host.props.onFocus(evt));
  await act(async () => host.props.onPressIn(evt));
  return root;
}

describe('FocusableSurface pressed scale', () => {
  it('defaults to focus.pressed-scale', async () => {
    const root = await pressIn();
    expect(timing).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: focus['pressed-scale'] }),
    );
    await act(async () => root.unmount());
  });

  it('scalePressed={1} (the player timeline): OK does not «click» the surface', async () => {
    const root = await pressIn(1);
    const pressedTo = timing.mock.calls.map(([, config]) => config.toValue);
    expect(pressedTo).not.toContain(focus['pressed-scale']);
    await act(async () => root.unmount());
  });
});
