// The health of the process and of its dependencies.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// The three states of `healthReplySchema` are not decoration, they encode which
// dependency the design can survive without (plan section 6.4):
//
//   `ok`        everything answers.
//   `degraded`  PostgreSQL answers and Redis does not. Nothing is lost: the
//               authoritative list of what must happen is `scheduled_events`, the
//               reconciliation sweep re-enqueues everything due, and a client that
//               cannot receive frames falls back to a snapshot. Punctuality and
//               liveness suffer; correctness does not.
//   `down`      PostgreSQL does not answer. There is nothing this process can do
//               correctly, so the orchestrator should replace it.
//
// The queue check is separate from the Redis one, because the queue has its own
// connection: a Redis that answers while the queue connection is broken is a real state
// and reporting it as `ok` would hide it.
//
// The clock is included because it is the cheapest way to see, from outside, that the
// process is reading the world it should: a wrong seed shows up as a null clock rather
// than as a mystery in the simulation.

import { pingPostgres } from '../plugins/prisma.js';
import { pingRedis } from '../plugins/redis.js';
import { SHARED_CONTRACT_VERSION, type HealthReply } from '../shared/index.js';
import { type ServiceContext } from './context.js';
import { toClockDto } from './playerView.js';

/** Version of the service. Read from the package at build time is not worth a dependency. */
export const SERVICE_VERSION = '0.1.0';

/** Builds the reply of `/health`. Never throws: a probe that throws is a probe that lies. */
export async function buildHealthReply(
  services: ServiceContext,
  startedAtRealMs: bigint,
): Promise<HealthReply> {
  const [postgres, redis] = await Promise.all([
    pingPostgres(services.prisma),
    pingRedis(services.redis),
  ]);

  let queue = false;
  try {
    // A cheap command on the queue's own connection. `isPaused` reads a key, so it
    // exercises the connection and not only the object.
    await services.queue.queue.isPaused();
    queue = true;
  } catch {
    queue = false;
  }

  let clock: HealthReply['clock'] = null;
  if (postgres) {
    try {
      clock = toClockDto(await services.clock.read());
    } catch {
      // A world that is not seeded yet is not a failure of the process: `make seed` has
      // not run. PostgreSQL answered, so the status stays `ok` and the clock stays null,
      // which is exactly what the contract says the field means during boot.
      clock = null;
    }
  }

  const status: HealthReply['status'] = !postgres ? 'down' : redis && queue ? 'ok' : 'degraded';

  return {
    status,
    role: services.role,
    version: SERVICE_VERSION,
    contractVersion: SHARED_CONTRACT_VERSION,
    uptimeRealMs: Number(services.clock.nowRealMs() - startedAtRealMs),
    checks: {
      postgres: postgres ? 'up' : 'down',
      redis: redis ? 'up' : 'down',
      queue: queue ? 'up' : 'down',
    },
    clock,
  };
}

/** HTTP status of a health reply: 200 while the process can serve, 503 when it cannot. */
export function healthStatusCode(reply: HealthReply): number {
  return reply.status === 'down' ? 503 : 200;
}
