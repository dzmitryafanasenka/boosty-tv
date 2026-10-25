import { act } from 'react';
import { createRoot } from 'test-renderer';
import App from '../src/app/App';

// Spike branch: the menu imports native-backed libraries that Jest cannot load.
jest.mock('../src/app/spike/JsStackCheck', () => ({
  JsStackCheck: () => null,
}));
jest.mock('../src/app/spike/KeychainCheck', () => ({
  KeychainCheck: () => null,
}));
jest.mock('../src/app/spike/NavigationCheck', () => ({
  NavigationCheck: () => null,
}));
jest.mock('../src/app/spike/PhoneAuthCheck', () => ({
  PhoneAuthCheck: () => null,
}));
jest.mock('../src/app/spike/SessionRefreshCheck', () => ({
  SessionRefreshCheck: () => null,
}));
jest.mock('../src/app/spike/ContentShapesCheck', () => ({
  ContentShapesCheck: () => null,
}));
jest.mock('../src/app/spike/PlaybackCheck', () => ({
  PlaybackCheck: () => null,
}));
jest.mock('../src/app/spike/QrCheck', () => ({ QrCheck: () => null }));
jest.mock('../src/app/spike/VideoCheck', () => ({ VideoCheck: () => null }));

test('renders the spike menu with one D-pad focusable entry per check', async () => {
  const renderer = createRoot();
  await act(async () => {
    renderer.render(<App />);
  });

  const ids = [
    'playback',
    'contentshapes',
    'sessionrefresh',
    'phoneauth',
    'navigation',
    'jsstack',
    'keychain',
    'video',
    'zod',
    'qr',
  ];
  for (const id of ids) {
    const entry = renderer.container.queryAll(
      node => node.props.testID === `menu-${id}`,
    );
    expect(entry).toHaveLength(1);
    expect(entry[0].props.focusable).toBe(true);
    expect(Boolean(entry[0].props.hasTVPreferredFocus)).toBe(
      id === 'playback',
    );
  }

  await act(async () => {
    renderer.unmount();
  });
});
