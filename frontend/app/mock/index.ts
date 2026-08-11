// Installing the simulated server.
//
// Owner: W3-C.
//
// Two seams and no globals: the HTTP transport of net/transport.ts and the socket factory of
// net/ws.ts. Nothing in the application constructs a `fetch` or a `WebSocket` of its own, so
// replacing those two is enough and cannot be bypassed.
//
// It is activated by `VITE_FARM_WORLD_MOCK=1`, by `?mock=1` in the URL or by the
// `farm-world.mock` key of `localStorage` (net/runtime.ts). The query string is what a panel
// agent of W4 to W6 will actually use: it needs no restart of the dev server and it survives
// a reload.

import { handleMockRequest } from '~/mock/handlers';
import { createMockServer, type MockServer, type MockServerOptions } from '~/mock/server';
import { createMockSocket } from '~/mock/socket';
import { setHttpTransport, resetHttpTransport, type HttpTransport } from '~/net/transport';
import {
  resetWsSocketFactory,
  setWsSocketFactory,
  type WsSocketFactory,
  type WsSocketLike,
} from '~/net/ws';

export { createMockServer, type MockServer } from '~/mock/server';
export { createMockWorld, type MockWorld } from '~/mock/world';
export { handleMockRequest } from '~/mock/handlers';
export { createMockSocket } from '~/mock/socket';

export interface MockInstallation {
  readonly server: MockServer;
  readonly transport: HttpTransport;
  readonly socketFactory: WsSocketFactory;
  /** Restores the real transport and the real socket factory. */
  uninstall: () => void;
}

export interface MockInstallOptions extends MockServerOptions {
  /** Artificial latency of every call, in real milliseconds. */
  readonly latencyRealMs?: number;
}

let installed: MockInstallation | null = null;

/** The transport that answers from the simulated server instead of from the network. */
export function createMockTransport(server: MockServer, latencyRealMs = 0): HttpTransport {
  return async (request) => {
    if (latencyRealMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, latencyRealMs);
      });
    }
    if (request.signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const reply = handleMockRequest(
      server,
      request.method,
      request.url,
      request.body,
      request.headers,
    );
    const contentType = reply.contentType ?? 'application/json';
    const bodyText =
      typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? null);
    return {
      status: reply.status,
      headers: { 'content-type': contentType },
      bodyText,
    };
  };
}

/** Installs both seams. Idempotent: a second call returns the existing installation. */
export function installMockServer(options: MockInstallOptions = {}): MockInstallation {
  if (installed !== null) {
    return installed;
  }
  const server = createMockServer(options);
  const transport = createMockTransport(server, options.latencyRealMs ?? 0);
  const socketFactory: WsSocketFactory = (url): WsSocketLike => createMockSocket(server, url);
  setHttpTransport(transport);
  setWsSocketFactory(socketFactory);
  installed = {
    server,
    transport,
    socketFactory,
    uninstall: () => {
      resetHttpTransport();
      resetWsSocketFactory();
      installed = null;
    },
  };
  console.warn('[mock] servidor simulado activo: ninguna peticion sale a la red');
  return installed;
}

/** The installation in force, or null. */
export function mockServer(): MockServer | null {
  return installed?.server ?? null;
}

export function uninstallMockServer(): void {
  installed?.uninstall();
}
