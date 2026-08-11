// One refresh for a whole burst of concurrent 401s.
//
// Owner: W3-C.
//
// This is the test of the failure that would otherwise be discovered in production. The refresh
// token rotates on use and rotation invalidates the token it consumed, so three calls that each
// refreshed on their own 401 would produce three rotations, of which two would be rejected, and
// the recovery would destroy the session it was trying to save. The assertion is therefore a
// count and not a behaviour: exactly one `POST /api/auth/refresh` for three simultaneous 401s.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apiCall } from '~/net/api';
import { isApiClientError } from '~/net/errors';
import { configureClientRuntime, resetClientRuntime } from '~/net/runtime';
import { refreshAttemptCount, resetSession, setSession, hasSession } from '~/net/session';
import { resetHttpTransport, setHttpTransport, type HttpRequest } from '~/net/transport';
import { ACCESS_TOKEN_TTL_REAL_MS, ValidationCode, apiErrorReply } from '~/shared/index';

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
}

function jsonReply(status: number, body: unknown) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    bodyText: JSON.stringify(body),
  };
}

/**
 * A transport that answers 401 to the protected route until the token has been rotated, and
 * counts every request. It is the smallest thing that reproduces the burst.
 */
function buildTransport(options: { refreshSucceeds: boolean }) {
  const calls: Recorded[] = [];
  let rotated = false;
  return {
    calls,
    transport: async (request: HttpRequest) => {
      calls.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
      });
      if (request.url.endsWith('/api/auth/refresh')) {
        if (!options.refreshSucceeds) {
          return jsonReply(401, apiErrorReply(ValidationCode.AUTH_REQUIRED));
        }
        rotated = true;
        return jsonReply(200, {
          accessToken: 'rotated-access-token-000000',
          accessTokenExpiresInRealMs: ACCESS_TOKEN_TTL_REAL_MS,
          accessTokenExpiresAtRealMs: String(Date.now() + ACCESS_TOKEN_TTL_REAL_MS),
        });
      }
      if (!rotated) {
        return jsonReply(401, apiErrorReply(ValidationCode.AUTH_TOKEN_EXPIRED));
      }
      return jsonReply(200, { farms: [], buildings: [] });
    },
  };
}

beforeEach(() => {
  resetSession();
  resetClientRuntime();
  configureClientRuntime({ validateReplies: true, requestTimeoutRealMs: 1_000 });
  setSession({ accessToken: 'expired-access-token-00000', expiresAtRealMs: Date.now() + 1_000 });
});

afterEach(() => {
  resetHttpTransport();
  resetSession();
  resetClientRuntime();
});

describe('el refresco ante varios 401 simultaneos', () => {
  it('rota el token una sola vez y reintenta cada llamada', async () => {
    const { calls, transport } = buildTransport({ refreshSucceeds: true });
    setHttpTransport(transport);

    const replies = await Promise.all([
      apiCall('GET /api/farms'),
      apiCall('GET /api/farms'),
      apiCall('GET /api/farms'),
    ]);

    expect(replies).toHaveLength(3);
    const refreshes = calls.filter((call) => call.url.endsWith('/api/auth/refresh'));
    expect(refreshes).toHaveLength(1);
    expect(refreshAttemptCount()).toBe(1);

    // Tres primeros intentos, un refresco y tres reintentos.
    expect(calls).toHaveLength(7);
    const retried = calls.slice(4);
    for (const call of retried) {
      expect(call.authorization).toBe('Bearer rotated-access-token-000000');
    }
  });

  it('reutiliza la clave de idempotencia en el reintento', async () => {
    const seen: (string | undefined)[] = [];
    let rotated = false;
    setHttpTransport(async (request) => {
      seen.push(request.headers['idempotency-key']);
      if (request.url.endsWith('/api/auth/refresh')) {
        rotated = true;
        return jsonReply(200, {
          accessToken: 'rotated-access-token-000000',
          accessTokenExpiresInRealMs: ACCESS_TOKEN_TTL_REAL_MS,
          accessTokenExpiresAtRealMs: String(Date.now() + ACCESS_TOKEN_TTL_REAL_MS),
        });
      }
      if (!rotated) {
        return jsonReply(401, apiErrorReply(ValidationCode.AUTH_TOKEN_EXPIRED));
      }
      return jsonReply(200, {
        seq: 1,
        atGameMs: '0',
        result: {
          purchasedCells: [],
          purchasedCount: 0,
          skippedCount: 0,
          totalPaid: '0.0000',
          balanceAfter: '0.0000',
        },
      });
    });

    await apiCall('POST /api/land/purchase', {
      body: { cells: [{ cellX: 1, cellY: 1 }], allowPartial: false },
      idempotencyKey: 'attempt-key-0001',
    });

    const withKey = seen.filter((key) => key !== undefined);
    // El primer intento y el reintento presentan la misma clave; el refresco no lleva ninguna.
    expect(withKey).toEqual(['attempt-key-0001', 'attempt-key-0001']);
  });

  it('cierra la sesion y propaga el 401 cuando el refresco falla', async () => {
    const { calls, transport } = buildTransport({ refreshSucceeds: false });
    setHttpTransport(transport);

    const results = await Promise.allSettled([
      apiCall('GET /api/farms'),
      apiCall('GET /api/farms'),
    ]);

    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(isApiClientError(result.reason)).toBe(true);
      }
    }
    expect(calls.filter((call) => call.url.endsWith('/api/auth/refresh'))).toHaveLength(1);
    expect(hasSession()).toBe(false);
  });
});
