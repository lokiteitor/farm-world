// The HTTP transport, and the seam the simulated server plugs into.
//
// Owner: W3-C.
//
// The mock server is a transport and not a patched `fetch`. That is the whole design
// decision of this module, and it buys three things: a test can install it without
// touching a global, the real path and the fake path have the same observable
// contract, and nothing in the application can accidentally bypass it by calling
// `fetch` directly, because nothing in the application calls `fetch` at all.

import { type HttpMethod } from '~/shared/index';

/** A request as the transport sees it: already serialised, already signed. */
export interface HttpRequest {
  readonly method: HttpMethod;
  /** Absolute or same origin URL, query string included. */
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** JSON text, or null for a request without a body. */
  readonly body: string | null;
  readonly signal: AbortSignal;
}

/** A reply as the transport returns it. The body stays text until it is parsed. */
export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

/**
 * The real transport.
 *
 * `credentials: 'include'` is not optional here: the refresh token is an `httpOnly`
 * cookie (stack section 6) and the whole session rotation depends on the browser
 * sending it. Both the development proxy and Caddy keep the client and the API on one
 * origin precisely so this stays a first party cookie.
 */
export const fetchTransport: HttpTransport = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: { ...request.headers },
    body: request.body,
    signal: request.signal,
    credentials: 'include',
    // A reply of this API is never cacheable: every one of them carries either a
    // sequence number or a clock reading.
    cache: 'no-store',
    redirect: 'error',
  });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return { status: response.status, headers, bodyText: await response.text() };
};

let active: HttpTransport = fetchTransport;

/** The transport in force. */
export function httpTransport(): HttpTransport {
  return active;
}

/** Replaces the transport. Used by the simulated server and by the tests. */
export function setHttpTransport(transport: HttpTransport): void {
  active = transport;
}

/** Restores the real transport. */
export function resetHttpTransport(): void {
  active = fetchTransport;
}
