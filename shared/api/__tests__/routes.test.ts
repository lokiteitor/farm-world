// Invariants of the route map.
//
// Owner: workflow W2 (API contract).
//
// These are not tests of behaviour: there is no behaviour here. They are the executable
// form of the rules the map states in prose, so that an entry added later cannot quietly
// break one of them. Each one corresponds to a sentence of plan section 7 or 6.3.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GAME_EVENT_TYPES, GameEventType } from '../../domain/enums.js';
import {
  API_AREAS,
  API_ROUTE_KEYS,
  API_ROUTES,
  buildPath,
  DEV_ROUTE_KEYS,
  IDEMPOTENT_ROUTE_KEYS,
  pathParamNames,
  routeDefinition,
  routeDefinitions,
  routeKey,
  routeKeysOfArea,
  SEQUENCED_ROUTE_KEYS,
} from '../routes.js';
import { HTTP_METHODS, isMutationReplySchema } from '../schemas/common.js';

/** Paths that live outside the `/api` namespace on purpose (infra/caddy/Caddyfile). */
const ROOT_PATHS = new Set(['/health', '/metrics', '/docs']);

describe('route map', () => {
  it('declares at least one route per area of plan section 7', () => {
    for (const area of API_AREAS) {
      expect(routeKeysOfArea(area).length, `area ${area}`).toBeGreaterThan(0);
    }
  });

  it('gives every route a reply schema', () => {
    for (const [key, route] of routeDefinitions()) {
      expect(route.reply, `${key} has no reply schema`).toBeInstanceOf(z.ZodType);
    }
  });

  it('keeps the key equal to the method and the path it repeats', () => {
    for (const [key, route] of routeDefinitions()) {
      expect(routeKey(route.method, route.path)).toBe(key);
    }
  });

  it('uses a known method and never repeats a method and path', () => {
    const seen = new Set<string>();
    for (const [key, route] of routeDefinitions()) {
      expect(HTTP_METHODS).toContain(route.method);
      expect(seen.has(key), `${key} declared twice`).toBe(false);
      seen.add(key);
    }
  });

  it('serves everything under /api except health, metrics and documentation', () => {
    for (const [key, route] of routeDefinitions()) {
      if (ROOT_PATHS.has(route.path)) {
        continue;
      }
      expect(route.path.startsWith('/api/'), `${key} is outside /api`).toBe(true);
    }
  });

  it('declares a parameter schema exactly for the placeholders of its path', () => {
    for (const [key, route] of routeDefinitions()) {
      const names = pathParamNames(route.path);
      if (names.length === 0) {
        expect(route.params, `${key} declares parameters it has no placeholders for`).toBe(
          undefined,
        );
        continue;
      }
      const params = route.params;
      expect(params, `${key} has placeholders and no parameter schema`).toBeInstanceOf(z.ZodObject);
      const shape = (params as z.ZodObject).shape;
      expect(Object.keys(shape).sort()).toEqual([...names].sort());
    }
  });

  it('requires the idempotency key header exactly on the routes that move money', () => {
    for (const [key, route] of routeDefinitions()) {
      expect(route.requiresIdempotencyKey === true, `${key}`).toBe(route.movesMoney);
    }
    expect(IDEMPOTENT_ROUTE_KEYS.length).toBeGreaterThan(0);
  });

  it('moves money only through POST and DELETE', () => {
    for (const [key, route] of routeDefinitions()) {
      if (!route.movesMoney) {
        continue;
      }
      expect(['POST', 'DELETE'], `${key}`).toContain(route.method);
    }
  });

  it('marks as sequenced exactly the routes whose reply is a mutation envelope', () => {
    for (const [key, route] of routeDefinitions()) {
      expect(isMutationReplySchema(route.reply), `${key}`).toBe(route.sequenced);
    }
    expect(SEQUENCED_ROUTE_KEYS.length).toBeGreaterThan(0);
  });

  it('never sequences a GET and never moves money in one', () => {
    for (const [key, route] of routeDefinitions()) {
      if (route.method !== 'GET') {
        continue;
      }
      expect(route.sequenced, `${key}`).toBe(false);
      expect(route.movesMoney, `${key}`).toBe(false);
    }
  });

  it('declares the events every sequenced route can produce', () => {
    for (const [key, route] of routeDefinitions()) {
      if (!route.sequenced) {
        expect(route.emits, `${key} declares events and is not sequenced`).toBe(undefined);
        continue;
      }
      const emits = route.emits ?? [];
      expect(emits.length, `${key} is sequenced and emits nothing`).toBeGreaterThan(0);
      for (const tag of emits) {
        expect(GAME_EVENT_TYPES, `${key} emits ${tag}`).toContain(tag);
      }
      expect(new Set(emits).size, `${key} repeats an event tag`).toBe(emits.length);
    }
  });

  it('never declares the clock as an event a route emits', () => {
    // `CLOCK` is transport only and consumes no sequence number, so no REST route can be
    // the cause of one (plan section 7).
    for (const [key, route] of routeDefinitions()) {
      expect(route.emits ?? [], `${key}`).not.toContain(GameEventType.CLOCK);
    }
  });

  it('moves money only in sequenced routes', () => {
    // A route that changes the balance must report it through the reducer; otherwise the
    // interface would show a stale balance until the WebSocket echo arrived.
    for (const [key, route] of routeDefinitions()) {
      if (route.movesMoney) {
        expect(route.sequenced, `${key}`).toBe(true);
      }
    }
  });

  it('reports the money and ledger events in every route that moves money', () => {
    for (const [key, route] of routeDefinitions()) {
      if (!route.movesMoney) {
        continue;
      }
      const emits = route.emits ?? [];
      expect(emits, `${key}`).toContain(GameEventType.PLAYER_UPSERTED);
      expect(emits, `${key}`).toContain(GameEventType.LEDGER_APPENDED);
    }
  });

  it('keeps every development route under /api/dev', () => {
    for (const [key, route] of routeDefinitions()) {
      expect(route.path.startsWith('/api/dev/'), `${key}`).toBe(route.devOnly === true);
    }
    expect(DEV_ROUTE_KEYS.length).toBeGreaterThan(0);
  });

  it('requires a session for everything except registration, login, refresh, logout and the public reads', () => {
    const anonymous = API_ROUTE_KEYS.filter((key) => !routeDefinition(key).requiresAuth);
    expect([...anonymous].sort()).toEqual(
      [
        'GET /docs',
        'GET /health',
        'GET /metrics',
        'GET /api/machines/catalog',
        'POST /api/auth/login',
        'POST /api/auth/logout',
        'POST /api/auth/refresh',
        'POST /api/auth/register',
      ].sort(),
    );
  });

  it('declares a body for every POST except the ones whose whole request is the session', () => {
    const bodyless = API_ROUTE_KEYS.filter(
      (key) => routeDefinition(key).method === 'POST' && routeDefinition(key).body === undefined,
    );
    expect([...bodyless].sort()).toEqual(
      [
        'POST /api/auth/logout',
        'POST /api/auth/refresh',
        'POST /api/auth/ws-ticket',
        'POST /api/dev/reconcile',
        'POST /api/machines/:machineId/sell',
        'POST /api/tasks/:taskId/cancel',
        'POST /api/workers/:workerId/fire',
      ].sort(),
    );
  });

  it('declares a media type only where the reply is not JSON', () => {
    for (const [key, route] of routeDefinitions()) {
      if (route.replyContentType === undefined) {
        continue;
      }
      expect(['GET /metrics', 'GET /docs'], `${key}`).toContain(key);
      expect(route.reply).toBeInstanceOf(z.ZodString);
    }
  });
});

describe('path helpers', () => {
  it('reads the placeholders of a path in order', () => {
    expect(pathParamNames('/api/forest-plots/:forestPlotId/fell')).toEqual(['forestPlotId']);
    expect(pathParamNames('/api/farms/:farmId/buildings')).toEqual(['farmId']);
    expect(pathParamNames('/api/fields')).toEqual([]);
  });

  it('substitutes and encodes the placeholders', () => {
    expect(buildPath('/api/fields/:fieldId', { fieldId: 'fld_1' })).toBe('/api/fields/fld_1');
    expect(buildPath('/api/fields/:fieldId', { fieldId: 'a/b' })).toBe('/api/fields/a%2Fb');
  });

  it('refuses to build a path with a missing parameter', () => {
    expect(() => buildPath('/api/fields/:fieldId', {})).toThrow(/fieldId/);
  });

  it('resolves every route of the map through the same key', () => {
    for (const key of API_ROUTE_KEYS) {
      expect(API_ROUTES[key]).toBe(routeDefinition(key));
    }
  });
});
