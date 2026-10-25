import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot } from 'test-renderer';
import { colors } from '../../ui/tokens';
import { Screen } from '../Screen';

test('Screen is a full-size TVFocusGuideView trapping all four sides', async () => {
  const root = createRoot();
  await act(async () => {
    root.render(<Screen testID="probe-screen" />);
  });

  const nodes = root.container.queryAll(
    node => node.props.testID === 'probe-screen',
  );
  expect(nodes).toHaveLength(1);
  const props = nodes[0].props;
  // Host props set only by TVFocusGuideView.
  expect(props).toHaveProperty('isTVSelectable');
  expect(props).toMatchObject({
    trapFocusUp: true,
    trapFocusDown: true,
    trapFocusLeft: true,
    trapFocusRight: true,
  });
  expect(StyleSheet.flatten(props.style)).toMatchObject({
    flex: 1,
    backgroundColor: colors.bg,
  });

  await act(async () => {
    root.unmount();
  });
});
