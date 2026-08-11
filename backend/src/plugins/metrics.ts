// Metrics: prom-client with an own registry and the counters of the whole backend.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Every counter of the project is declared here, once, including the ones later
// workflows increment. Declaring them where they are used would mean that a
// dashboard breaks whenever a module is not exercised, because a counter that has
// never been incremented does not appear in the exposition at all; declared up front
// with their labels, they are all present from the first scrape at zero.
//
// The registry is an instance and not the global default one. Two processes expose
// `/metrics` from the same code (`infra/prometheus/prometheus.yml` scrapes
// `backend:3000/metrics` and `worker:9464/metrics`), and the integration tests build
// several apps in one process; a global registry would make the second registration
// of the same metric throw.
//
// Naming follows the Prometheus convention: `farm_world_` prefix, `_total` on
// counters, base units in the name of a histogram.

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** Buckets of the request duration histogram, in seconds. */
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/** Every metric of the backend, plus the registry that exposes them. */
export interface Metrics {
  readonly registry: Registry;
  /** HTTP requests served, by method, route template and status class. */
  readonly httpRequests: Counter<'method' | 'route' | 'status'>;
  readonly httpDuration: Histogram<'method' | 'route'>;
  /** Queue jobs, by job name. Processed and failed are separate series, not a label. */
  readonly jobsProcessed: Counter<'job'>;
  readonly jobsFailed: Counter<'job'>;
  /** Scheduled events that came due and were applied, by kind (plan section 6.4). */
  readonly scheduledEventsDue: Counter<'kind'>;
  /** Due events whose kind has no handler registered yet. Should be zero in production. */
  readonly scheduledEventsUnhandled: Counter<'kind'>;
  /** Live WebSocket connections. */
  readonly wsConnections: Gauge;
  /** Frames published to the live channel, and frames suppressed by the storm guard. */
  readonly wsFramesPublished: Counter<'type'>;
  readonly wsFramesSuppressed: Counter;
  /** Ledger entries written, by kind. The economic audit trail of the process. */
  readonly ledgerEntries: Counter<'type'>;
  /** Accrual settlements, and the game hours they covered. */
  readonly accrualSettlements: Counter;
  /** Replays of a stored response for a repeated idempotency key (plan section 6.3). */
  readonly idempotentReplays: Counter;
}

/**
 * Builds the registry and every metric. `collectDefaultMetrics` adds the process
 * metrics of the Node runtime, which is what plan section 10 means by observability
 * from the start.
 */
export function createMetrics(role: 'server' | 'worker'): Metrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service: role });
  collectDefaultMetrics({ register: registry, prefix: 'farm_world_' });

  return {
    registry,
    httpRequests: new Counter({
      name: 'farm_world_http_requests_total',
      help: 'Peticiones HTTP servidas.',
      labelNames: ['method', 'route', 'status'] as const,
      registers: [registry],
    }),
    httpDuration: new Histogram({
      name: 'farm_world_http_request_duration_seconds',
      help: 'Duracion de las peticiones HTTP.',
      labelNames: ['method', 'route'] as const,
      buckets: DURATION_BUCKETS,
      registers: [registry],
    }),
    jobsProcessed: new Counter({
      name: 'farm_world_jobs_processed_total',
      help: 'Trabajos de la cola de dominio completados.',
      labelNames: ['job'] as const,
      registers: [registry],
    }),
    jobsFailed: new Counter({
      name: 'farm_world_jobs_failed_total',
      help: 'Trabajos de la cola de dominio fallidos.',
      labelNames: ['job'] as const,
      registers: [registry],
    }),
    scheduledEventsDue: new Counter({
      name: 'farm_world_scheduled_events_due_total',
      help: 'Eventos agendados vencidos y aplicados.',
      labelNames: ['kind'] as const,
      registers: [registry],
    }),
    scheduledEventsUnhandled: new Counter({
      name: 'farm_world_scheduled_events_unhandled_total',
      help: 'Eventos vencidos cuyo tipo no tiene manejador registrado.',
      labelNames: ['kind'] as const,
      registers: [registry],
    }),
    wsConnections: new Gauge({
      name: 'farm_world_ws_connections',
      help: 'Conexiones WebSocket activas.',
      registers: [registry],
    }),
    wsFramesPublished: new Counter({
      name: 'farm_world_ws_frames_published_total',
      help: 'Sobres publicados al canal en vivo.',
      labelNames: ['type'] as const,
      registers: [registry],
    }),
    wsFramesSuppressed: new Counter({
      name: 'farm_world_ws_frames_suppressed_total',
      help: 'Sobres omitidos del canal en vivo por la guarda de tormenta.',
      registers: [registry],
    }),
    ledgerEntries: new Counter({
      name: 'farm_world_ledger_entries_total',
      help: 'Asientos escritos en el libro mayor.',
      labelNames: ['type'] as const,
      registers: [registry],
    }),
    accrualSettlements: new Counter({
      name: 'farm_world_accrual_settlements_total',
      help: 'Liquidaciones de devengo ejecutadas.',
      registers: [registry],
    }),
    idempotentReplays: new Counter({
      name: 'farm_world_idempotent_replays_total',
      help: 'Respuestas reproducidas para una clave de idempotencia repetida.',
      registers: [registry],
    }),
  };
}

/** The exposition format of Prometheus, and its content type. */
export async function renderMetrics(
  metrics: Metrics,
): Promise<{ readonly body: string; readonly contentType: string }> {
  return {
    body: await metrics.registry.metrics(),
    contentType: metrics.registry.contentType,
  };
}
