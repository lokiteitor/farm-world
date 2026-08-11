// The guard of the development routes.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Two guards and not one, for the same reason the seed of the development player has two
// (backend/prisma/seed.ts): the flag says what is wanted and `NODE_ENV` says where it is
// wanted. `POST /api/dev/retime` can move the clock of every player of the world and
// `POST /api/dev/grant` can create money, so being one environment variable away from
// enabling them in production is not an acceptable distance.
//
// The first guard is `loadConfig`, which refuses `DEV_ENDPOINTS=true` together with
// `NODE_ENV=production` at start-up. The second is this one, which refuses at request time
// and does not trust the configuration to have been loaded by the same code path.
//
// The routes exist in the contract regardless of the flag, and answer 403
// `DEV_ENDPOINT_DISABLED` when it is off. Hiding them instead, with a 404, would make a
// misconfigured deployment indistinguishable from a client using a route that never existed.

import { type FastifyRequest } from 'fastify';
import { ApiError, ApiTransportCode } from '../shared/index.js';

/** Whether the development routes are served by this process. */
export function devEndpointsEnabled(options: {
  readonly devEndpoints: boolean;
  readonly isProduction: boolean;
}): boolean {
  return options.devEndpoints && !options.isProduction;
}

/** The `preHandler` of every route the map marks `devOnly`. */
export async function devGuard(request: FastifyRequest): Promise<void> {
  const config = request.server.services.config;
  if (!devEndpointsEnabled(config)) {
    throw new ApiError(ApiTransportCode.DEV_ENDPOINT_DISABLED, {
      field: `${request.method} ${request.routeOptions.url ?? request.url}`,
    });
  }
  await Promise.resolve();
}
