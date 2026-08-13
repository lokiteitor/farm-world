// The configuration, and the accounting of `.env.example`.
//
// Owner: workflow W3-A (backend skeleton).
//
// The first test is the one that matters and it is not about parsing: it asserts that every
// variable declared in `.env.example` is accounted for, either as a variable the process reads or
// as one that belongs to Compose, to the host tooling or to the seed. The brief of this agent asked
// for a configuration that "fails at start-up if any is missing", and taken literally that would
// mean the backend refusing to boot because Grafana has no password. This is the stronger reading
// of the same requirement: nothing in the template can be silently ignored, and adding a variable
// without deciding who reads it fails the suite.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONTAINER_ENV_VARS,
  ConfigError,
  DEVELOPMENT_JWT_SECRET,
  INFRASTRUCTURE_ENV_VARS,
  SERVICE_ENV_VARS,
  loadConfig,
  type RawEnv,
} from '../config.js';

/** The names `.env.example` declares, commented ones included. */
function declaredEnvVars(): readonly string[] {
  const file = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    '.env.example',
  );
  const text = readFileSync(file, 'utf8');
  const names = new Set<string>();
  for (const line of text.split('\n')) {
    // A declaration is `NAME=value`, and a commented declaration is `# NAME=value`. A comment that
    // merely mentions a name in prose is not a declaration, which is why the pattern is anchored
    // and requires the equals sign.
    const match = /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line.trim());
    if (match?.[1] !== undefined) {
      names.add(match[1]);
    }
  }
  return [...names];
}

/** The minimum a valid environment carries: the three values that have no default. */
const MINIMAL_ENV: RawEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:55432/db?schema=public',
  REDIS_URL: 'redis://localhost:56379',
  JWT_SECRET: 'un-secreto-suficientemente-largo',
};

describe('el reparto de las variables de .env.example', () => {
  it('cubre todas las variables declaradas y ninguna dos veces', () => {
    const declared = declaredEnvVars();
    const accounted = new Set([...SERVICE_ENV_VARS, ...INFRASTRUCTURE_ENV_VARS]);

    const unaccounted = declared.filter((name) => !accounted.has(name as never));
    expect(unaccounted).toEqual([]);

    // The other direction: nothing is claimed that the template does not declare, except the
    // variables the compose files inject and the template deliberately does not carry.
    const declaredSet = new Set(declared);
    const claimedButAbsent = [...accounted].filter((name) => !declaredSet.has(name));
    expect(claimedButAbsent).toEqual([]);

    const overlap = SERVICE_ENV_VARS.filter((name) =>
      (INFRASTRUCTURE_ENV_VARS as readonly string[]).includes(name),
    );
    expect(overlap).toEqual([]);
  });

  it('declara las variables que inyectan los ficheros de Compose y no la plantilla', () => {
    const declared = new Set(declaredEnvVars());
    for (const name of CONTAINER_ENV_VARS) {
      expect(declared.has(name)).toBe(false);
    }
    // `METRICS_PORT` was one of these until W7: the template now declares it, because
    // `docker-compose.yml` injects it into the worker and Prometheus scrapes the port it
    // names (docs/handoff/NOTES-w3a.md 1.2). What the assertion protects is the direction of
    // the move: it belongs to the variables the service reads, not to the injected ones.
    expect(CONTAINER_ENV_VARS).not.toContain('METRICS_PORT');
    expect(SERVICE_ENV_VARS).toContain('METRICS_PORT');
    expect(declared.has('METRICS_PORT')).toBe(true);
  });
});

describe('la validacion', () => {
  it('aplica los valores por omision de la plantilla', () => {
    const config = loadConfig(MINIMAL_ENV);
    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.metricsPort).toBe(9464);
    expect(config.logLevel).toBe('info');
    expect(config.devEndpoints).toBe(false);
    expect(config.gameRateNum).toBe(24);
    expect(config.gameRateDen).toBe(1);
    expect(config.jwtAccessTtlSeconds).toBe(900);
    expect(config.scheduleHorizonRealMs).toBe(86_400_000);
    expect(config.corsOrigins).toEqual(['http://localhost:3100', 'http://localhost:8080']);
    expect(config.isProduction).toBe(false);
  });

  it('nombra de una vez todas las variables que faltan', () => {
    let error: unknown;
    try {
      loadConfig({});
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const issues = (error as ConfigError).issues.join('\n');
    // One boot, one complete list: fixing them one restart at a time is the slowest possible way
    // to configure a service.
    expect(issues).toContain('DATABASE_URL');
    expect(issues).toContain('REDIS_URL');
    expect(issues).toContain('JWT_SECRET');
  });

  it('rechaza un entero mal formado indicando su variable', () => {
    expect(() => loadConfig({ ...MINIMAL_ENV, PORT: '3000.5' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...MINIMAL_ENV, GAME_RATE_DEN: '0' })).toThrow(/GAME_RATE_DEN/);
    expect(() => loadConfig({ ...MINIMAL_ENV, DEV_ENDPOINTS: 'yes' })).toThrow(/DEV_ENDPOINTS/);
    expect(() => loadConfig({ ...MINIMAL_ENV, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('admite el mundo pausado, que es rateNum cero', () => {
    const config = loadConfig({ ...MINIMAL_ENV, GAME_RATE_NUM: '0' });
    expect(config.gameRateNum).toBe(0);
  });

  it('rechaza el secreto de la plantilla en produccion', () => {
    expect(() =>
      loadConfig({ ...MINIMAL_ENV, NODE_ENV: 'production', JWT_SECRET: DEVELOPMENT_JWT_SECRET }),
    ).toThrow(/JWT_SECRET/);
  });

  it('rechaza las rutas de desarrollo en produccion', () => {
    expect(() =>
      loadConfig({ ...MINIMAL_ENV, NODE_ENV: 'production', DEV_ENDPOINTS: 'true' }),
    ).toThrow(/DEV_ENDPOINTS/);
    // The same flag in development is fine, which is the point of having two guards.
    expect(loadConfig({ ...MINIMAL_ENV, DEV_ENDPOINTS: 'true' }).devEndpoints).toBe(true);
  });

  it('exige un secreto de longitud suficiente', () => {
    expect(() => loadConfig({ ...MINIMAL_ENV, JWT_SECRET: 'corto' })).toThrow(/JWT_SECRET/);
  });

  it('devuelve un objeto inmutable', () => {
    const config = loadConfig(MINIMAL_ENV);
    expect(Object.isFrozen(config)).toBe(true);
  });
});
