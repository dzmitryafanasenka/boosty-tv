import type { Transport, TransportInit } from '../../../shared/api/transport';
import { createLogger, type Logger } from '../../../shared/services/logger';
import { LATEST_RELEASE_URL } from '../releaseInfo';
import { AUTO_INTERVAL_MS, CHECK_TIMEOUT_MS, MANUAL_INTERVAL_MS, createUpdateChecker } from '../updateChecker';
import { createUpdateStore, parseUpdateState, serializeUpdateState, type UpdateState } from '../updateStore';

const DIGEST = 'b'.repeat(64);
const DAY = AUTO_INTERVAL_MS;

function releaseBody(tag: string) {
  const version = tag.slice(1);
  return {
    tag_name: tag,
    html_url: `https://github.com/dzmitryafanasenka/boosty-tv/releases/tag/${tag}`,
    body: 'Новое\n\n---\n\nNew',
    assets: [
      {
        name: `boosty-tv-${version}.apk`,
        browser_download_url: `https://github.com/dzmitryafanasenka/boosty-tv/releases/download/${tag}/boosty-tv-${version}.apk`,
        digest: `sha256:${DIGEST}`,
        size: 1000,
      },
    ],
  };
}

type Call = { url: string; init: TransportInit };

function setup({
  tag = 'v0.9.1',
  installed = '0.9.0' as string | null,
  status = 200,
  stored = null as UpdateState | null,
  enabled = true,
  fail = null as null | 'network' | 'hang',
} = {}) {
  let now = 1_800_000_000_000;
  const calls: Call[] = [];
  const transport: Transport = (url, init) => {
    calls.push({ url, init });
    if (fail === 'network') {
      return Promise.reject(new TypeError('Network request failed'));
    }
    if (fail === 'hang') {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return Promise.resolve({ status, text: () => Promise.resolve(JSON.stringify(releaseBody(tag))) });
  };
  let state: UpdateState | null = stored;
  const writes: UpdateState[] = [];
  const preference = {
    read: jest.fn(() => Promise.resolve(state ?? { lastCheckAt: null, release: null })),
    write: jest.fn((next: UpdateState) => {
      state = next;
      writes.push(next);
    }),
  };
  const logger: Logger = createLogger();
  const store = createUpdateStore();
  const version = { current: installed };
  const checker = createUpdateChecker({
    enabled: () => enabled,
    transport,
    logger,
    installedVersion: () => version.current,
    preference,
    store,
    now: () => now,
  });
  return {
    checker,
    calls,
    store,
    logger,
    writes,
    version,
    state: () => state,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

describe('UpdateChecker (Story 9.2)', () => {
  it('matrix «Newer on start»: one request, the plaque, the known release, stored with the check time', async () => {
    const t = setup();
    await t.checker.start();
    expect(t.calls).toHaveLength(1);
    expect(t.store.get().known?.tag).toBe('v0.9.1');
    expect(t.store.get().plaque?.version).toBe('0.9.1');
    expect(t.state()).toMatchObject({ lastCheckAt: t.now(), release: { tag: 'v0.9.1', notes: 'Новое' } });
  });

  it('acceptance: a plain anonymous GET to the fixed URL with only the GitHub headers', async () => {
    const t = setup();
    await t.checker.start();
    const [{ url, init }] = t.calls;
    expect(url).toBe(LATEST_RELEASE_URL);
    expect(url).toBe('https://api.github.com/repos/dzmitryafanasenka/boosty-tv/releases/latest');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('omit');
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  });

  it('matrix «Within a day»: no second request; after 24 h one more, and the plaque again while newer', async () => {
    const t = setup();
    await t.checker.start();
    t.store.hidePlaque();
    t.advance(DAY - 1);
    await t.checker.checkAuto();
    expect(t.calls).toHaveLength(1);
    expect(t.store.get().plaque).toBeNull();
    t.advance(1);
    await t.checker.checkAuto();
    expect(t.calls).toHaveLength(2);
    expect(t.store.get().plaque?.version).toBe('0.9.1');
  });

  it('the daily gate is persisted: a new run within a day sends nothing but shows the stored release', async () => {
    const t = setup({
      stored: { lastCheckAt: 1_800_000_000_000 - 1000, release: null },
    });
    await t.checker.start();
    expect(t.calls).toHaveLength(0);
    const first = setup();
    await first.checker.start();
    const again = setup({ stored: first.state() });
    await again.checker.start();
    expect(again.calls).toHaveLength(0);
    expect(again.store.get().known?.tag).toBe('v0.9.1');
    expect(again.store.get().plaque).toBeNull();
  });

  it('a check time in the future (clock moved back) does not block the check', async () => {
    const t = setup({ stored: { lastCheckAt: 1_800_000_000_000 + DAY, release: null } });
    await t.checker.start();
    expect(t.calls).toHaveLength(1);
  });

  it('matrix «Same»: latest = installed shows nothing', async () => {
    const t = setup({ tag: 'v0.9.0' });
    await t.checker.start();
    expect(t.calls).toHaveLength(1);
    expect(t.store.get()).toEqual({ known: null, plaque: null });
    expect(t.state()).toMatchObject({ release: null });
  });

  it('a stored release is dropped once the installed version is equal or higher (acceptance: «Версия» shows the new version)', async () => {
    const first = setup();
    await first.checker.start();
    const after = setup({ installed: '0.9.1', stored: first.state() });
    await after.checker.start();
    expect(after.calls).toHaveLength(0);
    expect(after.store.get().known).toBeNull();
    expect(after.state()?.release).toBeNull();
  });

  it('a failure shows nothing and writes exactly one log entry with fixed fields', async () => {
    for (const [options, reason, status] of [
      [{ status: 403 }, 'http', '403'],
      [{ status: 404 }, 'http', '404'],
      [{ fail: 'network' as const }, 'network', null],
    ] as const) {
      const t = setup(options);
      await t.checker.start();
      expect(t.store.get()).toEqual({ known: null, plaque: null });
      const entries = t.logger.entries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ level: 'warn', scope: 'update', message: 'update check failed', fields: { reason, status } });
      // The attempt counts for the daily gate: no request storm against a failing GitHub.
      await t.checker.checkAuto();
      expect(t.calls).toHaveLength(1);
    }
  });

  it('a body that is not a release (no valid tag) is a parse failure', async () => {
    const t = setup({ tag: 'vnext' });
    await t.checker.start();
    expect(t.logger.entries()).toEqual([expect.objectContaining({ fields: { reason: 'parse', status: '200' } })]);
    expect(t.store.get().known).toBeNull();
  });

  it('the request is bounded by the timeout and not retried', async () => {
    jest.useFakeTimers();
    try {
      const t = setup({ fail: 'hang' });
      const done = t.checker.start();
      await jest.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
      await done;
      expect(t.calls).toHaveLength(1);
      expect(t.logger.entries()[0]).toMatchObject({ fields: { reason: 'timeout', status: null } });
    } finally {
      jest.useRealTimers();
    }
  });

  it('matrix «Manual OK»: one request; newer → returned; within 60 s → no request', async () => {
    const t = setup({ stored: { lastCheckAt: 1_800_000_000_000, release: null } });
    await t.checker.start();
    expect(t.calls).toHaveLength(0);
    await expect(t.checker.checkManual()).resolves.toMatchObject({ tag: 'v0.9.1' });
    expect(t.calls).toHaveLength(1);
    expect(t.store.get().known?.tag).toBe('v0.9.1');
    // A manual check never shows the plaque.
    expect(t.store.get().plaque).toBeNull();
    t.advance(MANUAL_INTERVAL_MS - 1);
    await expect(t.checker.checkManual()).resolves.toBeNull();
    expect(t.calls).toHaveLength(1);
    t.advance(1);
    await t.checker.checkManual();
    expect(t.calls).toHaveLength(2);
  });

  it('a manual check with no newer version, or a failed one, returns nothing', async () => {
    const same = setup({ tag: 'v0.9.0', stored: { lastCheckAt: 1_800_000_000_000, release: null } });
    await expect(same.checker.checkManual()).resolves.toBeNull();
    const failed = setup({ status: 500, stored: { lastCheckAt: 1_800_000_000_000, release: null } });
    await expect(failed.checker.checkManual()).resolves.toBeNull();
    expect(failed.logger.entries()).toHaveLength(1);
  });

  it('one request at a time; a manual check during an automatic one gets its answer without a second request', async () => {
    const t = setup();
    const a = t.checker.checkAuto();
    const b = t.checker.checkManual();
    const c = t.checker.checkAuto();
    const [, manual] = await Promise.all([a, b, c]);
    expect(t.calls).toHaveLength(1);
    expect(manual).toMatchObject({ tag: 'v0.9.1' });
  });

  it('a manual check during an automatic one that sent nothing (within a day) runs its own request', async () => {
    const t = setup({ stored: { lastCheckAt: 1_800_000_000_000, release: null } });
    const a = t.checker.checkAuto();
    const manual = t.checker.checkManual();
    await a;
    await expect(manual).resolves.toMatchObject({ tag: 'v0.9.1' });
    expect(t.calls).toHaveLength(1);
  });

  it('matrix «Demo» / flag off, or an unparsable installed version: no request ever', async () => {
    for (const options of [{ enabled: false }, { installed: '1.0' }, { installed: null }]) {
      const t = setup(options);
      await t.checker.start();
      await t.checker.checkAuto();
      t.advance(MANUAL_INTERVAL_MS * 2);
      await t.checker.checkManual();
      expect(t.calls).toHaveLength(0);
      expect(t.store.get()).toEqual({ known: null, plaque: null });
    }
  });

  it('no logger field is redacted (the success entry keeps status, tag and newer)', async () => {
    const t = setup();
    await t.checker.start();
    expect(t.logger.entries()).toEqual([
      expect.objectContaining({ level: 'info', fields: { status: '200', tag: 'v0.9.1', newer: true } }),
    ]);
  });
});

describe('the stored update state', () => {
  it('round-trips and rejects junk', () => {
    const state: UpdateState = { lastCheckAt: 5, release: null };
    expect(parseUpdateState(serializeUpdateState(state))).toEqual(state);
    expect(parseUpdateState(null)).toBeNull();
    expect(parseUpdateState('{')).toBeNull();
    expect(parseUpdateState('"x"')).toBeNull();
    expect(parseUpdateState('{"lastCheckAt":"x","release":{"tag":1}}')).toEqual({ lastCheckAt: null, release: null });
  });
});
