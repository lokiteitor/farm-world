// Logging: Pino, with a request identifier and sensitive headers redacted.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Structured JSON in every environment. `pino-pretty` is applied by the developer's
// shell and never by the process, so container logs stay parseable; that decision
// came with the W1 scaffolding of `server.ts` and is kept.
//
// Redaction is a list and not a judgement call at the call site. Three values must
// never reach a log line, and all three arrive as ordinary request headers:
//
//   - `authorization`, which carries the access token, that is a live session.
//   - `cookie` and `set-cookie`, which carry the refresh token, that is a longer
//     lived session.
//   - the password of a registration or login body, which is the account itself.
//
// The idempotency key is deliberately not redacted: it is client supplied, carries no
// authority, and being able to follow it through the log is the point of having it.

import { nanoid } from 'nanoid';
import { type AppConfig } from './config.js';

/** Length of a request identifier. Long enough not to collide inside a log window. */
const REQUEST_ID_LENGTH = 12;

/** Paths that are logged at `debug` instead of `info`, because they are polled. */
export const QUIET_PATHS: readonly string[] = ['/health', '/metrics'];

/**
 * Options of the Pino instance Fastify builds. Returned as a value rather than
 * applied, because `server.ts` needs them before the app exists and `worker.ts` needs
 * the same options without an app at all.
 */
export function loggerOptions(
  config: AppConfig,
  role: 'server' | 'worker',
): Record<string, unknown> {
  return {
    level: config.logLevel,
    base: { service: role },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'headers.authorization',
        'headers.cookie',
        'body.password',
        'password',
      ],
      censor: '[redacted]',
    },
    serializers: {
      // The default serialiser of Fastify logs the whole request; these two keep the
      // line small enough to read while still identifying the caller and the route.
      req(request: { id?: string; method?: string; url?: string; ip?: string }) {
        return { id: request.id, method: request.method, url: request.url, ip: request.ip };
      },
      res(reply: { statusCode?: number }) {
        return { statusCode: reply.statusCode };
      },
    },
  };
}

/**
 * Identifier of a request. Generated here and not taken from a header: an inbound
 * `x-request-id` is client controlled and would let a caller collide two requests in
 * the log on purpose. The proxy identifier, when there is one, is logged as a field
 * by the access log of the proxy itself.
 */
export function generateRequestId(): string {
  return nanoid(REQUEST_ID_LENGTH);
}

/** Whether a path is polled often enough that logging it at `info` is noise. */
export function isQuietPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return QUIET_PATHS.includes(path);
}
