import { Platform } from 'react-native';
import { getDeviceDescription } from '../deviceInfo';

test('manufacturer, model and the Android release', () => {
  expect(getDeviceDescription({ Manufacturer: 'Google', Model: 'Chromecast', Release: '14' })).toBe(
    'Google Chromecast, Android 14',
  );
});

test('a model that already names the manufacturer is not repeated', () => {
  expect(getDeviceDescription({ Manufacturer: 'Xiaomi', Model: 'xiaomi MiTV-MOOQ0', Release: '11' })).toBe(
    'xiaomi MiTV-MOOQ0, Android 11',
  );
});

test.each([
  ['LG', 'LGenius', 'LG LGenius, Android 9'],
  ['LG', 'LG-OLED55', 'LG-OLED55, Android 9'],
  ['LG', 'LG_TV', 'LG_TV, Android 9'],
  ['LG', 'LG', 'LG, Android 9'],
])('manufacturer %s + model %s: repeated only when not a whole-word prefix', (manufacturer, model, expected) => {
  expect(getDeviceDescription({ Manufacturer: manufacturer, Model: model, Release: '9' })).toBe(expected);
});

test.each([
  ['no release', { Manufacturer: 'Google', Model: 'Chromecast' }, 'Google Chromecast'],
  ['blank release', { Manufacturer: 'Google', Model: 'Chromecast', Release: ' ' }, 'Google Chromecast'],
  ['no manufacturer', { Model: 'Chromecast', Release: '14' }, 'Chromecast, Android 14'],
  ['no model', { Manufacturer: 'Google', Release: '14' }, 'Google, Android 14'],
  ['release only', { Release: '12' }, 'Android 12'],
  ['values trimmed', { Manufacturer: ' Google ', Model: ' Chromecast ', Release: ' 14 ' }, 'Google Chromecast, Android 14'],
])('%s', (_name, constants, expected) => {
  expect(getDeviceDescription(constants)).toBe(expected);
});

test.each([
  ['undefined', undefined],
  ['empty', {}],
  ['blank values', { Manufacturer: '', Model: '  ', Release: '' }],
  ['not strings', { Manufacturer: 1, Model: null, Release: 14 }],
])('null when %s', (_name, constants) => {
  expect(getDeviceDescription(constants as Record<string, unknown> | undefined)).toBeNull();
});

test('reads Platform.constants by default', () => {
  // Platform.constants is a getter in the jest preset, so it is spied, not replaced.
  const spy = jest
    .spyOn(Platform, 'constants', 'get')
    .mockReturnValue({ Manufacturer: 'Google', Model: 'Chromecast', Release: '14' } as unknown as typeof Platform.constants);
  try {
    expect(getDeviceDescription()).toBe('Google Chromecast, Android 14');
  } finally {
    spy.mockRestore();
  }
});
