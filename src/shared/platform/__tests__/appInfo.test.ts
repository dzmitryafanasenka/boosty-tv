import { NativeModules } from 'react-native';
import { getVersionName } from '../appInfo';

const native = NativeModules as { AppInfo?: { versionName?: unknown } };

afterEach(() => {
  delete native.AppInfo;
});

test('reads the native versionName constant', () => {
  native.AppInfo = { versionName: '1.0' };
  expect(getVersionName()).toBe('1.0');
});

test.each([
  ['no module', undefined],
  ['no constant', {}],
  ['empty', { versionName: '' }],
  ['not a string', { versionName: 1 }],
])('null when %s', (_name, value) => {
  native.AppInfo = value as { versionName?: unknown } | undefined;
  expect(getVersionName()).toBeNull();
});
