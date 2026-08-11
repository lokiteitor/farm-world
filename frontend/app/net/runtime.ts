// Runtime configuration of the client transport.
//
// Owner: W3-C.
//
// Why this module exists at all: `useRuntimeConfig()` is a Nuxt auto-import, which
// means it is available inside pages, layouts, middleware and components and is not
// available inside a plain Vitest run. Reaching for it from the transport would tie
// every unit test of the network layer to a Nuxt runtime it does not need.
//
// So the direction is inverted. The transport keeps a small mutable record with sane
// defaults, and the Nuxt side pushes the values in once, from the one place that
// legitimately knows them (`ensureClientRuntime`, called by the global route
// middleware and by app.vue). A test calls `configureClientRuntime` directly.

import { WS_PATH } from '~/shared/index';

/** How the client reaches the server, and how strict it is about what comes back. */
export interface ClientRuntime {
  /**
   * Origin the REST calls are prefixed with. Empty means same origin, which is both
   * the production case, where Caddy serves the client and proxies `/api`, and the
   * development case, where the Nuxt dev server proxies it (frontend/nuxt.config.ts).
   */
  readonly apiBase: string;
  /** Path of the per player WebSocket. Proxied verbatim (infra/caddy/Caddyfile). */
  readonly wsPath: string;
  /**
   * Whether the simulated server answers instead of the network. It is what lets the
   * panel agents of W4 to W6 work with no backend at all (plan section 10).
   */
  readonly useMockServer: boolean;
  /** Ceiling of a single REST call, enforced with an `AbortController`. */
  readonly requestTimeoutRealMs: number;
  /**
   * Whether every reply is parsed against the schema of its route. On by default,
   * because a contract drift that is not checked shows up as a blank panel; the flag
   * exists so that a production build can drop the cost (shared/api/README.md, 7.1).
   */
  readonly validateReplies: boolean;
}

const DEFAULT_RUNTIME: ClientRuntime = {
  apiBase: '',
  wsPath: WS_PATH,
  useMockServer: false,
  requestTimeoutRealMs: 15_000,
  validateReplies: true,
};

let current: ClientRuntime = DEFAULT_RUNTIME;
let configured = false;

/** Vite exposes `import.meta.env` in the browser bundle and in Vitest alike. */
function viteEnv(): Readonly<Record<string, string | boolean | undefined>> {
  const meta = import.meta as unknown as {
    readonly env?: Readonly<Record<string, string | boolean | undefined>>;
  };
  return meta.env ?? {};
}

function isTruthyFlag(value: string | boolean | undefined): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === undefined) {
    return false;
  }
  const normalised = value.trim().toLowerCase();
  return normalised === '1' || normalised === 'true' || normalised === 'on';
}

/**
 * Whether the simulated server is requested.
 *
 * Three sources, in order of precedence, and the last two exist for a concrete
 * reason: a panel agent developing a component wants to switch the fake server on
 * without restarting the dev server, and an automated check wants to do it from the
 * URL without touching the environment at all.
 *
 *   1. `VITE_FARM_WORLD_MOCK=1` in the environment of the build or the dev server.
 *   2. `?mock=1` or `?mock=0` in the query string of the page.
 *   3. `farm-world.mock` in `localStorage`, which the query string sets so the choice
 *      survives a reload.
 */
export function detectMockServer(): boolean {
  const fromEnv = isTruthyFlag(viteEnv()['VITE_FARM_WORLD_MOCK']);
  if (typeof window === 'undefined') {
    return fromEnv;
  }
  const STORAGE_KEY = 'farm-world.mock';
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // A browser with storage denied is not a reason to fail to boot.
    stored = null;
  }
  const requested = new URL(window.location.href).searchParams.get('mock');
  if (requested !== null) {
    const enabled = isTruthyFlag(requested);
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      // Same as above: the query string still wins for this page load.
    }
    return enabled;
  }
  if (stored !== null) {
    return isTruthyFlag(stored);
  }
  return fromEnv;
}

/**
 * Whether the simulated server should start with a session already open.
 *
 * `?mockSession=1` or `VITE_FARM_WORLD_MOCK_SESSION=1`. It exists for two concrete uses: a panel
 * agent of W4 to W6 who wants the game page on every reload without filling the login form, and
 * an automated check that has no way to type into it. Without the flag the mock demands a
 * session, which is the right default, because otherwise the authentication page would never be
 * exercised at all.
 */
export function detectMockSession(): boolean {
  const fromEnv = isTruthyFlag(viteEnv()['VITE_FARM_WORLD_MOCK_SESSION']);
  if (typeof window === 'undefined') {
    return fromEnv;
  }
  const requested = new URL(window.location.href).searchParams.get('mockSession');
  return requested === null ? fromEnv : isTruthyFlag(requested);
}

/** The configuration in force. */
export function clientRuntime(): ClientRuntime {
  return current;
}

/** Overrides part of the configuration. Idempotent and cumulative. */
export function configureClientRuntime(patch: Partial<ClientRuntime>): ClientRuntime {
  current = { ...current, ...patch };
  configured = true;
  return current;
}

/** Restores the defaults. Used by the tests between cases. */
export function resetClientRuntime(): void {
  current = DEFAULT_RUNTIME;
  configured = false;
}

/**
 * Configures the transport once from the values Nuxt holds, and detects the
 * simulated server. Called by the global route middleware, which runs before any
 * page, and again by app.vue; the second call is a no-op.
 */
export function ensureClientRuntime(nuxtPublic: {
  readonly apiBase?: unknown;
  readonly wsPath?: unknown;
}): ClientRuntime {
  if (configured) {
    return current;
  }
  return configureClientRuntime({
    apiBase: typeof nuxtPublic.apiBase === 'string' ? nuxtPublic.apiBase : DEFAULT_RUNTIME.apiBase,
    wsPath: typeof nuxtPublic.wsPath === 'string' ? nuxtPublic.wsPath : DEFAULT_RUNTIME.wsPath,
    useMockServer: detectMockServer(),
  });
}
