import { NativeModules } from 'react-native';
import { appendLogLines, clearLogFile, logFile, logFileLocation } from '../logFile';

const native = NativeModules as Record<string, unknown>;

afterEach(() => {
  delete native.LogFile;
});

describe('logFile (Story 8.3)', () => {
  it('without the native module: append rejects, clear resolves (nothing to clear), location is null', async () => {
    await expect(appendLogLines(['a'])).rejects.toThrow('log file: unavailable');
    await expect(clearLogFile()).resolves.toBeUndefined();
    await expect(logFileLocation()).resolves.toBeNull();
  });

  it('passes the lines as a new array and resolves', async () => {
    const append = jest.fn().mockResolvedValue(true);
    native.LogFile = { append, clear: jest.fn(), location: jest.fn() };
    const lines = ['one', 'two'];
    await expect(logFile.append(lines)).resolves.toBeUndefined();
    expect(append).toHaveBeenCalledWith(['one', 'two']);
    expect(append.mock.calls[0][0]).not.toBe(lines);
  });

  it('calls the native methods synchronously, in call order (a clear after an append stays after it)', () => {
    const calls: string[] = [];
    native.LogFile = {
      append: jest.fn(() => {
        calls.push('append');
        return Promise.resolve(true);
      }),
      clear: jest.fn(() => {
        calls.push('clear');
        return Promise.resolve(true);
      }),
    };
    logFile.append(['x']).catch(() => {});
    logFile.clear().catch(() => {});
    expect(calls).toEqual(['append', 'clear']);
  });

  it('a native rejection becomes a fixed error; its message is dropped', async () => {
    const secret = '/storage/emulated/0/Android/data/x/files/logs/boostytv.log';
    native.LogFile = {
      append: jest.fn().mockRejectedValue(new Error(secret)),
      clear: jest.fn().mockRejectedValue(new Error(secret)),
      location: jest.fn().mockRejectedValue(new Error(secret)),
    };
    const append = await logFile.append(['x']).catch((error: Error) => error.message);
    const clear = await logFile.clear().catch((error: Error) => error.message);
    expect(append).toBe('log file: append failed');
    expect(clear).toBe('log file: clear failed');
    await expect(logFile.location()).resolves.toBeNull();
  });

  it('location passes a path through; anything else is null', async () => {
    native.LogFile = { location: jest.fn().mockResolvedValue('/storage/emulated/0/Android/data/p/files/logs') };
    await expect(logFile.location()).resolves.toBe('/storage/emulated/0/Android/data/p/files/logs');
    native.LogFile = { location: jest.fn().mockResolvedValue(null) };
    await expect(logFile.location()).resolves.toBeNull();
  });
});
