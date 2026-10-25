import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import * as Keychain from 'react-native-keychain';
import {
  buildCurrentUserRequest,
  decodeSession,
  type FetchLike,
  type StoredSession,
} from './phoneAuthApi';
import { SESSION_SERVICE } from './PhoneAuthCheck';
import {
  createRefreshCoordinator,
  type CallResult,
  type RefreshOutcome,
} from './refreshCoordinator';
import {
  getInstallId,
  keychainStorageReset,
  readInstallIdUncached,
} from './spikeNative';
import { createSpikeSecureStore } from './spikeSecureStore';
import {
  SpikeButton,
  SpikeLog,
  SpikeScreen,
  spikeColors,
  spikeLog,
  useBackToMenu,
} from './SpikeUi';

/**
 * Story 1.4 spike only (branch spike/1-4-refresh-logout). Runs the S4/S10
 * matrix once each against the real API with the session stored by the
 * Story 1.3 screen, in the owner-decided order:
 * proactive → reactive → rotation → network loss → rejected refresh (then
 * restore) → other device_id → logout.
 *
 * "Corruption" only alters the stored copy of this app's own session; the
 * last valid session is kept in memory so it can be restored. Logs carry
 * statuses, shapes, counts and booleans only — never tokens or device ids.
 */

const fetchImpl: FetchLike = (url, init) =>
  (fetch as unknown as FetchLike)(url, init);

const ORDER = [
  'proactive',
  'reactive',
  'rotation',
  'network',
  'rejected',
  'deviceid',
  'logout',
] as const;
type ScenarioId = (typeof ORDER)[number];

const ALNUM = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Same length, every alphanumeric character changed. Not anyone's token. */
export function corruptToken(token: string): string {
  return token
    .split('')
    .map(c => {
      const i = ALNUM.indexOf(c);
      return i < 0 ? c : ALNUM[(i + 17) % ALNUM.length];
    })
    .join('');
}

/** Random UUIDv4 for the one `device_id` check; never stored or logged. */
export function randomUuidV4(random: () => number = Math.random): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () =>
      Math.floor(random() * 16).toString(16),
    ).join('');
  const variant = (8 + Math.floor(random() * 4)).toString(16);
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}

function describeCall(r: CallResult): string {
  switch (r.kind) {
    case 'response':
      return `HTTP ${r.sanitized.status} (refreshed=${r.refreshed}, retried=${r.retried})`;
    case 'expired':
      return `expired${
        r.refreshSanitized ? ` (refresh HTTP ${r.refreshSanitized.status})` : ''
      }`;
    case 'network':
      return `network error at ${r.stage} (${r.error})`;
    case 'refresh-failed':
      return `refresh failed: ${r.outcome} HTTP ${r.status}`;
    case 'signed-out':
      return 'signed-out (no session)';
    case 'store-error':
      return `store error (${r.error})`;
  }
}

function describeOutcome(o: RefreshOutcome): string {
  switch (o.kind) {
    case 'refreshed':
      return `refreshed HTTP 200, rotated=${o.rotated}, expires_in=${
        o.tokens.expiresIn ?? '—'
      }`;
    case 'network':
      return `network (${o.error})`;
    default:
      return `${o.kind} HTTP ${o.sanitized.status}`;
  }
}

const ok200 = (r: CallResult) =>
  r.kind === 'response' && r.sanitized.status === 200;

export function SessionRefreshCheck({ onExit }: { onExit: () => void }) {
  useBackToMenu(onExit);

  const [status, setStatus] = useState('…');
  const [lines, setLines] = useState<string[]>([]);
  const [counts, setCounts] = useState({ refresh: 0, api: 0 });
  const [sessionStatus, setSessionStatus] = useState('unknown');
  const [logoutArmed, setLogoutArmed] = useState(false);
  const [doneView, setDoneView] = useState<string[]>([]);

  // Last known valid session (restore copy). Memory only; never rendered.
  const backupRef = useRef<StoredSession | null>(null);
  const installIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const doneRef = useRef(new Set<ScenarioId>());
  const stoppedRef = useRef<string | null>(null);

  const log = useCallback((...entries: string[]) => {
    for (const entry of entries) {
      spikeLog('refresh', entry);
    }
    const stamp = new Date().toISOString().slice(11, 19);
    setLines(prev =>
      [...entries.map(e => `${stamp} ${e}`).reverse(), ...prev].slice(0, 120),
    );
  }, []);

  const report = useCallback(
    (line: string) => {
      setStatus(line);
      log(line);
    },
    [log],
  );

  const store = useMemo(
    () =>
      createSpikeSecureStore({
        service: SESSION_SERVICE,
        keychain: Keychain,
        helper: keychainStorageReset,
        log: line => log(`[store] ${line}`),
      }),
    [log],
  );

  const coordinator = useMemo(
    () =>
      createRefreshCoordinator({
        store,
        fetchImpl,
        getDeviceId: getInstallId,
        log: line => log(`[coord] ${line}`),
      }),
    [store, log],
  );

  const sync = useCallback(() => {
    setCounts(coordinator.getCounts());
    setSessionStatus(coordinator.getStatus());
  }, [coordinator]);

  const e1 = useCallback(
    () => coordinator.callWithSession(() => buildCurrentUserRequest('')),
    [coordinator],
  );

  /** Writes an altered (or restored) copy to the store and reloads it. */
  const writeStored = useCallback(
    async (s: StoredSession, what: string) => {
      const saved = await store.save(JSON.stringify(s));
      const loaded = await coordinator.reload();
      log(`stored copy ${what}: save=${saved.kind}, reload=${loaded}`);
      return saved.kind === 'saved' && loaded === 'signed-in';
    },
    [coordinator, log, store],
  );

  const keepBackup = useCallback(() => {
    if (coordinator.getStatus() === 'signed-in') {
      backupRef.current = coordinator.getSession();
    }
  }, [coordinator]);

  const delta = useCallback(
    (before: { refresh: number; api: number }) => {
      const after = coordinator.getCounts();
      return {
        refresh: after.refresh - before.refresh,
        api: after.api - before.api,
      };
    },
    [coordinator],
  );

  useEffect(() => {
    (async () => {
      try {
        const id = await getInstallId();
        installIdRef.current = id;
        log(`device_id ready (…${id.slice(-4)})`);
      } catch (error) {
        log(`device_id error: ${error instanceof Error ? error.name : '?'}`);
      }
      const loaded = await coordinator.reload();
      const s = coordinator.getSession();
      backupRef.current = s;
      const left =
        s?.expiresAt == null
          ? 'unknown'
          : `${s.expiresAt - Math.floor(Date.now() / 1000)} s`;
      report(`stored session: ${loaded}; expiresAt in ${left} (no request)`);
      sync();
    })().catch(() => log('mount: unexpected rejection'));
  }, [coordinator, log, report, sync]);

  /** Runs a scenario once, in order, with an in-flight guard. */
  const run = useCallback(
    async (id: ScenarioId, body: () => Promise<void>) => {
      if (busyRef.current) {
        return;
      }
      if (doneRef.current.has(id)) {
        report(`${id}: уже выполнено (каждый сценарий — один раз)`);
        return;
      }
      const index = ORDER.indexOf(id);
      const missing = ORDER.slice(0, index).filter(
        prev => !doneRef.current.has(prev),
      );
      if (id !== 'logout' && stoppedRef.current) {
        report(`Остановлено: ${stoppedRef.current}`);
        return;
      }
      if (missing.length > 0 && !(id === 'logout' && stoppedRef.current)) {
        report(`${id}: сначала ${missing[0]}`);
        return;
      }
      if (id !== 'logout' && !backupRef.current) {
        report(`${id}: нет сохранённой сессии`);
        return;
      }
      busyRef.current = true;
      doneRef.current.add(id);
      setDoneView([...doneRef.current]);
      log(`=== ${id} ===`);
      try {
        await body();
      } catch (error) {
        report(
          `${id}: unexpected ${error instanceof Error ? error.name : '?'}`,
        );
      } finally {
        busyRef.current = false;
        sync();
      }
    },
    [log, report, sync],
  );

  const stop = useCallback(
    (reason: string) => {
      stoppedRef.current = reason;
      log(`STOP: ${reason}`);
    },
    [log],
  );

  const check = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    try {
      const before = coordinator.getCounts();
      const r = await e1();
      keepBackup();
      const d = delta(before);
      report(
        `E1: ${describeCall(r)}; requests: refresh=${d.refresh}, E1=${d.api}`,
      );
    } finally {
      busyRef.current = false;
      sync();
    }
  }, [coordinator, delta, e1, keepBackup, report, sync]);

  const proactive = () =>
    run('proactive', async () => {
      const b = backupRef.current as StoredSession;
      const nowS = Math.floor(Date.now() / 1000);
      await writeStored({ ...b, expiresAt: nowS - 60 }, 'expiry forced -60 s');
      const before = coordinator.getCounts();
      const results = await Promise.all(Array.from({ length: 5 }, () => e1()));
      const d = delta(before);
      const okCount = results.filter(ok200).length;
      results.forEach((r, i) => log(`E1[${i + 1}]: ${describeCall(r)}`));
      keepBackup();
      const pass = d.refresh === 1 && okCount === 5;
      report(
        `proactive: ${pass ? 'PASS' : 'FAIL'} — refresh requests=${
          d.refresh
        }, E1 requests=${d.api}, E1 200=${okCount}/5`,
      );
      if (coordinator.getStatus() !== 'signed-in') {
        stop('session not signed-in after proactive');
      }
    });

  const reactive = () =>
    run('reactive', async () => {
      const b = backupRef.current as StoredSession;
      await writeStored(
        { ...b, accessToken: corruptToken(b.accessToken) },
        'access token altered',
      );
      const before = coordinator.getCounts();
      const r = await e1();
      const d = delta(before);
      keepBackup();
      const pass =
        ok200(r) && r.kind === 'response' && r.retried && d.refresh === 1;
      report(
        `reactive: ${pass ? 'PASS' : 'FAIL'} — ${describeCall(r)}; ` +
          `refresh requests=${d.refresh}, E1 requests=${d.api}`,
      );
      if (coordinator.getStatus() !== 'signed-in') {
        stop('session not signed-in after reactive');
      }
    });

  const rotation = () =>
    run('rotation', async () => {
      const prev = backupRef.current as StoredSession;
      const before = coordinator.getCounts();
      const first = await coordinator.refresh();
      log(`rotation: refresh with current token → ${describeOutcome(first)}`);
      if (first.kind !== 'refreshed') {
        report(`rotation: refresh failed (${describeOutcome(first)})`);
        if (coordinator.getStatus() !== 'signed-in') {
          stop('session lost during rotation refresh');
        }
        return;
      }
      keepBackup();
      let oldResult = 'not applicable (not rotated)';
      if (first.rotated === 'yes') {
        const deviceId = await getInstallId();
        const old = await coordinator.sendRefresh({
          refreshToken: prev.refreshToken,
          deviceId,
          label: 'previous refresh token',
        });
        oldResult = describeOutcome(old);
        if (old.kind === 'refreshed') {
          // The newest issued tokens become current.
          await coordinator.adopt(old.tokens);
          keepBackup();
        }
      }
      log(`rotation: previous refresh token → ${oldResult}`);
      const r = await e1();
      keepBackup();
      const d = delta(before);
      report(
        `rotation: rotated=${first.rotated}; old token: ${oldResult}; ` +
          `E1 after: ${describeCall(r)}; refresh requests=${
            d.refresh
          }, E1 requests=${d.api}`,
      );
      if (!ok200(r)) {
        stop('session unusable after the rotation check');
      }
    });

  const network = () =>
    run('network', async () => {
      const b = backupRef.current as StoredSession;
      const nowS = Math.floor(Date.now() / 1000);
      await writeStored({ ...b, expiresAt: nowS - 60 }, 'expiry forced -60 s');
      const before = coordinator.getCounts();
      coordinator.failNextRefreshTransport();
      const r = await e1();
      const d = delta(before);
      const read = await store.read();
      const kept =
        read.kind === 'value' &&
        decodeSession(read.value)?.refreshToken === b.refreshToken &&
        decodeSession(read.value)?.accessToken === b.accessToken;
      const statusAfter = coordinator.getStatus();
      const pass =
        r.kind === 'network' &&
        r.stage === 'refresh' &&
        statusAfter === 'signed-in' &&
        kept &&
        d.api === 0;
      report(
        `network: ${pass ? 'PASS' : 'FAIL'} — ${describeCall(r)}; ` +
          `status=${statusAfter}; stored tokens kept=${kept}; ` +
          `refresh attempts=${d.refresh} (simulated, not sent), E1 requests=${d.api}`,
      );
      const restored = await writeStored(b, 'restored (real expiry)');
      if (!restored) {
        stop('restore after network check failed');
      }
    });

  const rejected = () =>
    run('rejected', async () => {
      const b = backupRef.current as StoredSession;
      await writeStored(
        {
          ...b,
          accessToken: corruptToken(b.accessToken),
          refreshToken: corruptToken(b.refreshToken),
        },
        'access + refresh tokens altered',
      );
      const before = coordinator.getCounts();
      const r = await e1();
      const d1 = delta(before);
      const again = await e1();
      const d2 = delta(before);
      const pass =
        r.kind === 'expired' &&
        d1.refresh === 1 &&
        d1.api === 1 &&
        again.kind === 'expired' &&
        d2.refresh === 1 &&
        d2.api === 1;
      report(
        `rejected: ${pass ? 'PASS' : 'FAIL'} — ${describeCall(r)}; ` +
          `status=${coordinator.getStatus()}; refresh requests=${
            d1.refresh
          }, E1 requests=${d1.api}; second call: ${describeCall(
            again,
          )}, no new request=${d2.refresh === d1.refresh && d2.api === d1.api}`,
      );
      await writeStored(b, 'restored from memory');
      const check2 = await e1();
      keepBackup();
      log(`restore check: E1 ${describeCall(check2)}`);
      if (!ok200(check2)) {
        stop('restore after the rejected-refresh check failed');
      }
    });

  const deviceIdCheck = () =>
    run('deviceid', async () => {
      const b = backupRef.current as StoredSession;
      const before = coordinator.getCounts();
      const outcome = await coordinator.sendRefresh({
        refreshToken: b.refreshToken,
        deviceId: randomUuidV4(),
        label: 'different device_id',
      });
      if (outcome.kind === 'refreshed') {
        await coordinator.adopt(outcome.tokens);
        keepBackup();
      }
      const r = await e1();
      keepBackup();
      const d = delta(before);
      report(
        `device_id: refresh with a different device_id → ${describeOutcome(
          outcome,
        )}; E1 after: ${describeCall(r)}; refresh requests=${
          d.refresh
        }, E1 requests=${d.api}`,
      );
    });

  const logout = () => {
    if (!logoutArmed) {
      setLogoutArmed(true);
      report('Выйти: нажмите ещё раз для подтверждения');
      return;
    }
    run('logout', async () => {
      const clear = await coordinator.signOut(() => store.clear());
      backupRef.current = null;
      const read = await store.read();
      let idKept = 'unknown';
      try {
        const id = await readInstallIdUncached();
        idKept = `${id === installIdRef.current} (…${id.slice(-4)})`;
      } catch (error) {
        idKept = `error ${error instanceof Error ? error.name : '?'}`;
      }
      const before = coordinator.getCounts();
      const r = await coordinator.callWithSession(() =>
        buildCurrentUserRequest(''),
      );
      const d = delta(before);
      const pass =
        clear.kind === 'cleared' &&
        read.kind === 'empty' &&
        coordinator.getSession() === null &&
        r.kind === 'signed-out' &&
        d.api === 0 &&
        d.refresh === 0 &&
        idKept.startsWith('true');
      report(
        `logout: ${pass ? 'PASS' : 'FAIL'} — store clear=${
          clear.kind
        }, read back=${read.kind}, memory session=${
          coordinator.getSession() === null ? 'none' : 'present'
        }, device_id unchanged=${idKept}; call after logout: ${describeCall(
          r,
        )}, requests=${d.refresh + d.api}`,
      );
    });
  };

  return (
    <SpikeScreen
      title="Сессия: обновление и выход (спайк 1.4)"
      controls={
        <ScrollView style={styles.controls}>
          <SpikeButton
            testID="sr-check"
            label="Проверить сессию (E1)"
            onPress={check}
            preferredFocus
          />
          <SpikeButton
            testID="sr-proactive"
            label="1. Проактивно (5×E1)"
            onPress={proactive}
          />
          <SpikeButton
            testID="sr-reactive"
            label="2. Реактивно (401)"
            onPress={reactive}
          />
          <SpikeButton
            testID="sr-rotation"
            label="3. Ротация refresh"
            onPress={rotation}
          />
          <SpikeButton
            testID="sr-network"
            label="4. Обрыв сети"
            onPress={network}
          />
          <SpikeButton
            testID="sr-rejected"
            label="5. Отклонённый refresh"
            onPress={rejected}
          />
          <SpikeButton
            testID="sr-deviceid"
            label="6. Другой device_id"
            onPress={deviceIdCheck}
          />
          <SpikeButton
            testID="sr-logout"
            label={logoutArmed ? '7. Выйти — подтвердить' : '7. Выйти'}
            onPress={logout}
          />
          <SpikeButton testID="sr-exit" label="Назад в меню" onPress={onExit} />
        </ScrollView>
      }
    >
      <Text style={styles.status} testID="sr-status">
        {status}
      </Text>
      <Text style={styles.counts} testID="sr-counts">
        {`Запросы: refresh=${counts.refresh}, API=${
          counts.api
        } · статус: ${sessionStatus} · выполнено: ${
          doneView.join(', ') || '—'
        }`}
      </Text>
      <SpikeLog lines={lines} />
    </SpikeScreen>
  );
}

const styles = StyleSheet.create({
  controls: { flex: 1 },
  status: { color: spikeColors.text, fontSize: 15, marginBottom: 6 },
  counts: { color: spikeColors.accent, fontSize: 14, marginBottom: 6 },
});
