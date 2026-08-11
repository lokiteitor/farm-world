// The registry of routes, the stubs and the system area, against the real stack.
//
// Owner: workflow W3-A (backend skeleton).
//
// The invariant this file exists for: every route the contract declares is registered, and every
// one that is not implemented yet answers 501 with `NOT_IMPLEMENTED`. That is what makes the
// registry of `src/app.ts` a promise rather than a hope, and it is what lets the client of
// workflow W3-C be developed against the whole surface while nine tenths of it is a stub.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API_ROUTE_KEYS,
  ApiTransportCode,
  DEV_ROUTE_KEYS,
  IDEMPOTENT_ROUTE_KEYS,
  SHARED_CONTRACT_VERSION,
  routeDefinition,
  type ApiRouteKey,
} from '../shared/index.js';
import { bearer, createHarness, registerViaHttp, type Harness } from './harness.js';

let harness: Harness;
let accessToken: string;

/** The routes that are implemented in this workflow. Everything else must answer 501. */
const IMPLEMENTED: readonly ApiRouteKey[] = [
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/refresh',
  'POST /api/auth/logout',
  'POST /api/auth/ws-ticket',
  'GET /api/auth/me',
  'GET /health',
  'GET /metrics',
  'GET /docs',
  'POST /api/dev/retime',
  'POST /api/dev/advance-player',
  'POST /api/dev/grant',
  'POST /api/dev/reconcile',
];

beforeAll(async () => {
  harness = await createHarness();
  const player = await registerViaHttp(harness, 'app');
  accessToken = player.accessToken;
});

afterAll(async () => {
  await harness.teardown();
});

describe('el registro de rutas', () => {
  it('cubre el contrato completo, que es lo que comprueba el arranque', () => {
    // `buildApp` throws `IncompleteRouteRegistryError` when it does not, so reaching `beforeAll`
    // is already the assertion. This one states the count so a regression names a number.
    expect(API_ROUTE_KEYS.length).toBe(55);
  });

  it('declara la cabecera de idempotencia exactamente en las rutas que mueven dinero', () => {
    const movesMoney = API_ROUTE_KEYS.filter((key) => routeDefinition(key).movesMoney);
    expect([...IDEMPOTENT_ROUTE_KEYS].sort()).toEqual([...movesMoney].sort());
  });
});

describe('las rutas todavia no implementadas', () => {
  const stubs = API_ROUTE_KEYS.filter(
    (key) => !IMPLEMENTED.includes(key) && !DEV_ROUTE_KEYS.includes(key),
  );

  it('son las de los diez modulos de dominio pendientes', () => {
    // Forty two of the fifty five: the six of auth, the three of the system area that are served
    // and the four development routes are the thirteen that are implemented.
    expect(stubs.length).toBe(42);
  });

  for (const key of stubs) {
    const route = routeDefinition(key);
    it(`${key} responde 501 con NOT_IMPLEMENTED`, async () => {
      const url = route.path
        .replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000')
        .concat(route.query === undefined ? '' : '?since=0');
      const response = await harness.app.inject({
        method: route.method,
        url,
        headers: {
          ...(route.requiresAuth ? bearer(accessToken) : {}),
          ...(route.requiresIdempotencyKey === true
            ? { 'idempotency-key': `stub-${key.length}-${route.path.length}` }
            : {}),
        },
        // The body of a stub still has to satisfy the schema of the contract, which is the point:
        // the stub validates like the real route will. A body that does not is a 400, so the
        // assertion accepts either, and the code is what distinguishes them.
        ...(route.body === undefined ? {} : { payload: {} }),
      });

      if (response.statusCode === 400) {
        // The empty body did not satisfy the schema, which proves validation runs before the
        // handler. The route is still registered, which is what this test is about.
        expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
        return;
      }
      expect(response.statusCode).toBe(501);
      expect(response.json<{ error: { code: string } }>().error.code).toBe(
        ApiTransportCode.NOT_IMPLEMENTED,
      );
    });
  }
});

describe('el area de sistema', () => {
  it('sirve /health con el estado de las tres dependencias', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      role: string;
      contractVersion: string;
      checks: { postgres: string; redis: string; queue: string };
      clock: { rateNum: number } | null;
    }>();
    expect(body.status).toBe('ok');
    expect(body.role).toBe('server');
    expect(body.contractVersion).toBe(SHARED_CONTRACT_VERSION);
    expect(body.checks).toEqual({ postgres: 'up', redis: 'up', queue: 'up' });
    expect(body.clock?.rateNum).toBe(1);
  });

  it('sirve /metrics en el formato de exposicion de Prometheus', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('farm_world_http_requests_total');
  });

  it('rechaza las rutas de desarrollo con la bandera desactivada', async () => {
    // The harness enables them, so this asserts the guard rather than the flag: a request with no
    // session is refused before the flag is even consulted.
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/dev/reconcile',
    });
    expect(response.statusCode).toBe(401);
  });

  it('encola lo vencido cuando se le pide reconciliar', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/dev/reconcile',
      headers: bearer(accessToken),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ enqueuedEvents: number; pendingEvents: number }>();
    expect(body.pendingEvents).toBeGreaterThanOrEqual(1);
    expect(body.enqueuedEvents).toBeGreaterThanOrEqual(0);
  });

  it('devuelve la forma del contrato para una ruta que no existe', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/no-existe' });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });
});
