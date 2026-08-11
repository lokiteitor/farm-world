// Wiring the transport before anything uses it.
//
// Owner: W3-C.
//
// Order is the whole content of this module. The global route middleware runs before any page
// is rendered and it is the first thing that calls the API, so the transport has to be chosen
// before it: if the simulated server were installed from a component, the guard would already
// have gone to the network and the login page would flash before the mock took over.
//
// It is idempotent and cheap, so both the middleware and app.vue call it and the second call
// does nothing.

import {
  clientRuntime,
  detectMockSession,
  ensureClientRuntime,
  type ClientRuntime,
} from '~/net/runtime';

let bootstrapped = false;

export interface NuxtPublicConfig {
  readonly apiBase?: unknown;
  readonly wsPath?: unknown;
}

/**
 * Configures the transport from the Nuxt runtime configuration and installs the simulated
 * server when it is requested.
 *
 * The mock module is imported dynamically so that it is not in the production bundle: with a
 * static import, the sample world, the handler table and the fake socket would ship to every
 * player.
 */
export async function ensureClientBootstrapped(
  nuxtPublic: NuxtPublicConfig,
): Promise<ClientRuntime> {
  const runtime = ensureClientRuntime(nuxtPublic);
  if (bootstrapped) {
    return runtime;
  }
  bootstrapped = true;
  if (runtime.useMockServer) {
    const mock = await import('~/mock/index');
    mock.installMockServer({ sessionOpen: detectMockSession() });
  }
  return clientRuntime();
}

/** Whether the wiring has run. Tests only. */
export function isClientBootstrapped(): boolean {
  return bootstrapped;
}

/** Forgets the wiring, so a test can run it again. */
export function resetClientBootstrap(): void {
  bootstrapped = false;
}
