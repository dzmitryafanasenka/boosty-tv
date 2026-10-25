import { NativeModules } from 'react-native';
import { getDeviceId, resetDeviceIdForTests } from '../deviceId';

const native = NativeModules as { InstallId?: { getOrCreate: jest.Mock } };

afterEach(() => {
  delete native.InstallId;
  resetDeviceIdForTests();
});

test('reads the install id once and memoizes it', async () => {
  const getOrCreate = jest.fn().mockResolvedValue('3f0c2a8e-1b7d-4c3a-9e2f-5a6b7c8d9e0f');
  native.InstallId = { getOrCreate };

  await expect(getDeviceId()).resolves.toBe('3f0c2a8e-1b7d-4c3a-9e2f-5a6b7c8d9e0f');
  await expect(getDeviceId()).resolves.toBe('3f0c2a8e-1b7d-4c3a-9e2f-5a6b7c8d9e0f');
  expect(getOrCreate).toHaveBeenCalledTimes(1);
});

test('concurrent first calls share one native read', async () => {
  const getOrCreate = jest.fn().mockResolvedValue('id-1');
  native.InstallId = { getOrCreate };

  await Promise.all([getDeviceId(), getDeviceId(), getDeviceId()]);
  expect(getOrCreate).toHaveBeenCalledTimes(1);
});

test('a failed read is not cached', async () => {
  const getOrCreate = jest
    .fn()
    .mockRejectedValueOnce(new Error('E_INSTALL_ID'))
    .mockResolvedValueOnce('id-2');
  native.InstallId = { getOrCreate };

  await expect(getDeviceId()).rejects.toThrow('E_INSTALL_ID');
  await expect(getDeviceId()).resolves.toBe('id-2');
  expect(getOrCreate).toHaveBeenCalledTimes(2);
});

test('an empty id is rejected and not cached', async () => {
  const getOrCreate = jest.fn().mockResolvedValueOnce('').mockResolvedValueOnce('id-3');
  native.InstallId = { getOrCreate };

  await expect(getDeviceId()).rejects.toThrow('empty id');
  await expect(getDeviceId()).resolves.toBe('id-3');
});

test('rejects when the native module is not linked', async () => {
  await expect(getDeviceId()).rejects.toThrow('not linked');
});
