import type { Transport, TransportInit } from './transport';

/**
 * FixtureTransport (epic 2 "FixtureTransport"): the one replacement for the
 * network layer of `HttpClient` and `AuthApiClient`. Integration tests and
 * the debug-only demo mode use it; no other HTTP mocking library exists in
 * this project. Everything above the transport (profiles, timeouts, AD-6
 * retries, error mapping, the refresh coordinator) runs unchanged.
 *
 * A handler answers each request with a sanitized reply (shaped like
 * `src/test/fixtures/boosty/*.json`: `{status, body}`), a transport failure
 * or a hang that only the client's timeout ends. Requests are recorded for
 * assertions; nothing is logged.
 *
 * Not imported by release code: the demo requires it under `__DEV__` only.
 */

export type FixtureReply =
  | { status: number; body?: unknown; delayMs?: number }
  /** A transport failure (offline, DNS, reset). */
  | { network: true; delayMs?: number }
  /** Never answers; the client's `AbortController` timeout ends it. */
  | { hang: true };

export type FixtureRequest = {
  method: string;
  url: string;
  /** The URL path without host and query. */
  path: string;
  headers: Record<string, string>;
  body?: string;
  /** The form-encoded body, decoded (empty for no body). */
  form: Record<string, string>;
};

export type FixtureHandler = (
  request: FixtureRequest,
) => FixtureReply | undefined | Promise<FixtureReply | undefined>;

export type FixtureTransport = Transport & {
  /** Every request so far, oldest first. */
  readonly calls: FixtureRequest[];
  /** Calls whose path is `path`. */
  callsTo(path: string): FixtureRequest[];
};

/** A sanitized fixture file (`{case, status, body}`) as a reply. */
export function fixtureReply(fixture: { status: number; body?: unknown }): FixtureReply {
  return { status: fixture.status, body: fixture.body };
}

function decodeForm(body: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!body) {
    return out;
  }
  for (const pair of body.split('&')) {
    const [k, v = ''] = pair.split('=');
    const dec = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '));
    out[dec(k)] = dec(v);
  }
  return out;
}

function pathOf(url: string): string {
  return url.replace(/^https?:\/\/[^/]*/i, '').replace(/[?#].*$/, '');
}

class FixtureNetworkError extends TypeError {
  constructor() {
    super('Network request failed');
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new FixtureNetworkError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new FixtureNetworkError());
    });
  });
}

export function createFixtureTransport(handler: FixtureHandler): FixtureTransport {
  const calls: FixtureRequest[] = [];

  async function transport(url: string, init: TransportInit) {
    const request: FixtureRequest = {
      method: init.method,
      url,
      path: pathOf(url),
      headers: { ...init.headers },
      body: init.body,
      form: decodeForm(init.body),
    };
    calls.push(request);
    const reply = await handler(request);
    if (!reply) {
      // A missing fixture is a test bug: fail like the network, path only.
      throw new FixtureNetworkError();
    }
    if ('hang' in reply) {
      return new Promise<never>((_resolve, reject) => {
        if (init.signal.aborted) {
          reject(new FixtureNetworkError());
          return;
        }
        init.signal.addEventListener('abort', () => reject(new FixtureNetworkError()));
      });
    }
    const delayMs = 'delayMs' in reply ? reply.delayMs ?? 0 : 0;
    if (delayMs > 0) {
      await wait(delayMs, init.signal);
    } else if (init.signal.aborted) {
      throw new FixtureNetworkError();
    }
    if ('network' in reply) {
      throw new FixtureNetworkError();
    }
    const text = reply.body === undefined ? '' : JSON.stringify(reply.body);
    return { status: reply.status, text: () => Promise.resolve(text) };
  }

  return Object.assign(transport, {
    calls,
    callsTo: (path: string) => calls.filter(call => call.path === path),
  });
}
