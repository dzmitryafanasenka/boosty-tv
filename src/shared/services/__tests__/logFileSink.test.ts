import { createAccountScope, defineAccountScoped } from '../../account';
import type { KeyValueStore } from '../../platform/keyValueStore';
import type { LogFilePort } from '../../platform/logFile';
import {
  DIAGNOSTICS_CAPTURE_KEY,
  LOG_FILE_BATCH_MS,
  LOG_FILE_BATCH_SIZE,
  LOG_FILE_MAX_LINE,
  createDiagnosticsCapture,
  createLogFileSink,
  formatLogLine,
} from '../logFileSink';
import { createLogger, type Logger } from '../logger';

const PHONE = '+375291234567';
const TOKEN = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0';

/**
 * A fake native file: calls apply in call order (the native serial
 * thread), `lines` is the content. `failAppend` / `failClear` reject.
 */
function fakeFile() {
  const state = {
    lines: [] as string[],
    ops: [] as string[],
    failAppend: false,
    failClear: false,
  };
  const port: LogFilePort = {
    append: jest.fn((lines: readonly string[]) => {
      state.ops.push(`append:${lines.length}`);
      if (state.failAppend) {
        return Promise.reject(new Error('log file: append failed'));
      }
      state.lines.push(...lines);
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      state.ops.push('clear');
      if (state.failClear) {
        return Promise.reject(new Error('log file: clear failed'));
      }
      state.lines = [];
      return Promise.resolve();
    }),
    location: jest.fn(() => Promise.resolve(null)),
  };
  return { state, port };
}

function memoryKv(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: key => Promise.resolve(data.get(key) ?? null),
    set: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
    remove: key => {
      data.delete(key);
      return Promise.resolve();
    },
    clear: () => {
      data.clear();
      return Promise.resolve();
    },
  };
}

async function flushPromises() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

/** A fake AppState: `emit(state)` calls the live listeners. */
function fakeAppState() {
  const listeners = new Set<(state: string) => void>();
  return {
    listeners,
    emit: (state: string) => [...listeners].forEach(listener => listener(state)),
    addEventListener: (_type: 'change', listener: (state: string) => void) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
}

function setup() {
  const logger: Logger = createLogger({ now: () => Date.UTC(2026, 9, 31, 12, 0, 0) });
  const scope = createAccountScope({ logger: () => logger });
  const file = fakeFile();
  const appState = fakeAppState();
  const sink = createLogFileSink({ logger, file: file.port, scope, appState });
  return { logger, scope, file, sink, appState };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('formatLogLine', () => {
  it('ISO time, level, scope, message and the fields as JSON on one line', () => {
    expect(
      formatLogLine({ time: Date.UTC(2026, 9, 31), level: 'warn', scope: 'net', message: 'a\nb', fields: { status: '500' } }),
    ).toBe('2026-10-31T00:00:00.000Z WARN [net] a b {"status":"500"}');
    expect(formatLogLine({ time: 0, level: 'info', scope: 's', message: 'm' })).toBe('1970-01-01T00:00:00.000Z INFO [s] m');
  });

  it('cuts a long line', () => {
    const line = formatLogLine({ time: 0, level: 'info', scope: 's', message: 'x'.repeat(5000) });
    expect(line.length).toBe(LOG_FILE_MAX_LINE + 1);
  });
});

describe('createLogFileSink (Story 8.3)', () => {
  it('capture off: nothing goes to the file; the ring works as before', () => {
    const { logger, file } = setup();
    logger.info('t', 'one');
    jest.advanceTimersByTime(LOG_FILE_BATCH_MS * 3);
    expect(file.port.append).not.toHaveBeenCalled();
    expect(logger.entries()).toHaveLength(1);
  });

  it('enable: the ring is written first, then new entries', async () => {
    const { logger, file, sink } = setup();
    logger.info('t', 'before 1');
    logger.info('t', 'before 2');
    sink.enable();
    logger.info('t', 'after');
    expect(file.port.append).not.toHaveBeenCalled();
    jest.advanceTimersByTime(LOG_FILE_BATCH_MS);
    await flushPromises();
    expect(file.state.lines.map(l => l.replace(/^\S+ \S+ /, ''))).toEqual(['[t] before 1', '[t] before 2', '[t] after']);
    expect(file.port.append).toHaveBeenCalledTimes(1);
  });

  it('batches: 20 lines go at once, fewer after 1 s; a full ring goes in batches of 20', async () => {
    const { logger, file, sink } = setup();
    for (let i = 0; i < 45; i += 1) {
      logger.debug('t', `ring ${i}`);
    }
    sink.enable();
    // 40 of the 45 went at once (two full batches); 5 wait for the timer.
    expect((file.port.append as jest.Mock).mock.calls.map(c => c[0].length)).toEqual([20, 20]);
    for (let i = 0; i < 15; i += 1) {
      logger.debug('t', `new ${i}`);
    }
    expect((file.port.append as jest.Mock).mock.calls.map(c => c[0].length)).toEqual([20, 20, 20]);
    logger.debug('t', 'tail');
    jest.advanceTimersByTime(LOG_FILE_BATCH_MS - 1);
    expect(file.port.append).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(1);
    expect((file.port.append as jest.Mock).mock.calls.map(c => c[0].length)).toEqual([20, 20, 20, 1]);
    await flushPromises();
    expect(file.state.lines).toHaveLength(61);
  });

  it('every line in the file is redacted', async () => {
    const { logger, file, sink } = setup();
    sink.enable();
    logger.info('auth', `to ${PHONE} Cookie: s=${TOKEN}`, { phone: PHONE, token: 'short', url: 'https://cdn.example/v.mp4?sig=s3cr3t' });
    logger.warn('net', 'Authorization: Basic dXNlcjpwYXNz');
    logger.info('player', 'src expires=17&sig=abc123');
    sink.flush();
    await flushPromises();
    const dump = file.state.lines.join('\n');
    for (const secret of [PHONE, TOKEN, 'short', 's3cr3t', 'dXNlcjpwYXNz', 'abc123']) {
      expect(dump).not.toContain(secret);
    }
    expect(file.state.lines).toHaveLength(3);
  });

  it('disable (review): drops the queue and deletes the file; the ring stays; nothing after', async () => {
    const { logger, file, sink } = setup();
    sink.enable();
    logger.info('t', 'written');
    sink.flush();
    logger.info('t', 'queued');
    await sink.disable();
    logger.info('t', 'while off');
    jest.advanceTimersByTime(LOG_FILE_BATCH_MS * 2);
    await flushPromises();
    expect(file.state.ops).toEqual(['append:1', 'clear']);
    expect(file.state.lines).toEqual([]);
    expect(logger.entries().map(e => e.message)).toEqual(['written', 'queued', 'while off']);
    expect(sink.isEnabled()).toBe(false);
  });

  it('disable rejects when the native clear failed', async () => {
    const { file, sink } = setup();
    file.state.failClear = true;
    await expect(sink.disable()).rejects.toThrow('log file: clear failed');
  });

  it('review: going to the background writes the waiting batch at once; the listener goes with disable', async () => {
    const { logger, file, sink, appState } = setup();
    sink.enable();
    expect(appState.listeners.size).toBe(1);
    logger.info('t', 'waiting');
    appState.emit('inactive');
    expect(file.port.append).not.toHaveBeenCalled();
    appState.emit('background');
    expect(file.port.append).toHaveBeenCalledTimes(1);
    await flushPromises();
    expect(file.state.lines[0]).toContain('waiting');
    await sink.disable();
    expect(appState.listeners.size).toBe(0);
  });

  it('a failed append logs one warning to the ring only; capture stays on', async () => {
    const { logger, file, sink } = setup();
    file.state.failAppend = true;
    sink.enable();
    logger.info('t', 'a');
    sink.flush();
    await flushPromises();
    logger.info('t', 'b');
    sink.flush();
    await flushPromises();
    const warnings = logger.entries().filter(e => e.message === 'log file write failed');
    expect(warnings).toHaveLength(1);
    expect(sink.isEnabled()).toBe(true);
    // The warning itself was never queued for the file.
    file.state.failAppend = false;
    sink.flush();
    expect((file.port.append as jest.Mock).mock.calls.flatMap(c => c[0]).join('\n')).not.toContain('log file write failed');
  });

  it('clear: the ring, the queue and the file are empty', async () => {
    const { logger, file, sink } = setup();
    sink.enable();
    logger.info('t', 'written');
    sink.flush();
    logger.info('t', 'queued');
    await sink.clear();
    jest.advanceTimersByTime(LOG_FILE_BATCH_MS * 2);
    await flushPromises();
    expect(logger.entries()).toEqual([]);
    expect(file.state.lines).toEqual([]);
    expect(file.state.ops).toEqual(['append:1', 'clear']);
  });

  it('a batch of an older generation is dropped (accountScope.guard)', async () => {
    const { logger, file, sink, scope } = setup();
    // Only a gate: the reset bumps the generation without the sink's own reset.
    scope.register(defineAccountScoped('session', () => {}));
    sink.enable();
    logger.info('t', 'old account');
    await scope.reset();
    sink.flush();
    await flushPromises();
    expect(file.state.lines.join('\n')).not.toContain('old account');
  });
});

describe('account reset with capture on (acceptance)', () => {
  function registered() {
    const ctx = setup();
    const loggerStore = defineAccountScoped('logger', () => ctx.logger.clear());
    const fileStore = defineAccountScoped('logFile', () => ctx.sink.reset());
    ctx.scope.register(defineAccountScoped('session', () => {}), loggerStore, fileStore);
    return ctx;
  }

  it('after a sign-out, the file holds no line of the previous account; the next account logs', async () => {
    const { logger, file, sink, scope } = registered();
    sink.enable();
    logger.info('t', 'account A written');
    sink.flush();
    logger.info('t', 'account A queued');
    const { failed } = await scope.reset();
    expect(failed).toEqual([]);
    logger.info('t', 'account B');
    sink.flush();
    await flushPromises();
    const dump = file.state.lines.join('\n');
    expect(dump).not.toContain('account A');
    expect(dump).toContain('account B');
    expect(logger.entries().map(e => e.message)).not.toContain('account A written');
  });

  it('an append sent before the reset is cleared by it (the clear is ordered after)', async () => {
    const { logger, file, sink, scope } = registered();
    sink.enable();
    logger.info('t', 'account A in flight');
    sink.flush(); // sent, not yet "done"
    await scope.reset();
    sink.flush();
    await flushPromises();
    expect(file.state.ops).toEqual(['append:1', 'clear', 'append:1']);
    // The last append is the reset's own log line, of the next account.
    expect(file.state.lines).toHaveLength(1);
    expect(file.state.lines[0]).toContain('[account] reset');
  });

  it('a failed native clear is reported in failed[]', async () => {
    const { file, scope } = registered();
    file.state.failClear = true;
    const { failed } = await scope.reset();
    expect(failed).toEqual(['logFile']);
  });
});

describe('createDiagnosticsCapture (Story 8.3)', () => {
  it('default off: nothing stored means off and the sink stays off', async () => {
    const { sink, logger } = setup();
    const capture = createDiagnosticsCapture(() => memoryKv(), sink, logger);
    expect(capture.peek()).toBeUndefined();
    await expect(capture.read()).resolves.toBe(false);
    expect(sink.isEnabled()).toBe(false);
  });

  it('a stored `on` turns the sink on at read', async () => {
    const { sink, logger } = setup();
    const capture = createDiagnosticsCapture(() => memoryKv({ [DIAGNOSTICS_CAPTURE_KEY]: 'on' }), sink, logger);
    await expect(capture.read()).resolves.toBe(true);
    expect(sink.isEnabled()).toBe(true);
  });

  it('set stores the device key and applies at once; a toggle during the read wins', async () => {
    const { sink, logger } = setup();
    const kv = memoryKv({ [DIAGNOSTICS_CAPTURE_KEY]: 'off' });
    const capture = createDiagnosticsCapture(() => kv, sink, logger);
    const reading = capture.read();
    capture.set(true);
    await expect(reading).resolves.toBe(true);
    expect(sink.isEnabled()).toBe(true);
    await flushPromises();
    expect(kv.data.get(DIAGNOSTICS_CAPTURE_KEY)).toBe('on');
    capture.set(false);
    expect(sink.isEnabled()).toBe(false);
    await flushPromises();
    expect(kv.data.get(DIAGNOSTICS_CAPTURE_KEY)).toBe('off');
  });

  it('review: off deletes the log file; a failed delete is logged', async () => {
    const { sink, logger, file } = setup();
    const capture = createDiagnosticsCapture(() => memoryKv(), sink, logger);
    capture.set(true);
    logger.info('t', 'line');
    sink.flush();
    await flushPromises();
    expect(file.state.lines).toHaveLength(1);
    capture.set(false);
    await flushPromises();
    expect(file.state.lines).toEqual([]);
    expect(file.state.ops[file.state.ops.length - 1]).toBe('clear');

    file.state.failClear = true;
    capture.set(true);
    capture.set(false);
    await flushPromises();
    expect(logger.entries().map(e => e.message)).toContain('log file not cleared');
  });

  it('an unreadable or junk value is off; a failed write is only logged', async () => {
    const { sink, logger } = setup();
    const broken: KeyValueStore = {
      get: () => Promise.reject(new Error('io')),
      set: () => Promise.reject(new Error('io')),
      remove: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const capture = createDiagnosticsCapture(() => broken, sink, logger);
    await expect(capture.read()).resolves.toBe(false);
    capture.set(true);
    await flushPromises();
    expect(sink.isEnabled()).toBe(true);
    const messages = logger.entries().map(e => e.message);
    expect(messages).toContain('capture preference not read');
    expect(messages).toContain('capture preference not stored');

    const junk = createDiagnosticsCapture(() => memoryKv({ [DIAGNOSTICS_CAPTURE_KEY]: 'true' }), setup().sink, logger);
    await expect(junk.read()).resolves.toBe(false);
  });

  it('clearLogs resolves true, or false (and logs) when the file was not cleared', async () => {
    const { sink, logger, file } = setup();
    const capture = createDiagnosticsCapture(() => memoryKv(), sink, logger);
    await expect(capture.clearLogs()).resolves.toBe(true);
    file.state.failClear = true;
    await expect(capture.clearLogs()).resolves.toBe(false);
    expect(logger.entries().map(e => e.message)).toContain('log file not cleared');
  });

  it('the batch constants match the spec', () => {
    expect(LOG_FILE_BATCH_SIZE).toBe(20);
    expect(LOG_FILE_BATCH_MS).toBe(1000);
  });
});
