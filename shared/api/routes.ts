// The typed route map.
//
// Owner: workflow W2 (API contract).
//
// This map is the single source from which four things derive, and the reason it exists
// at all is that those four would otherwise be written by hand four times and drift
// (plan section 7):
//
//   1. The registration in Fastify, which reads the schemas straight from here through
//      `fastify-type-provider-zod`.
//   2. The typed client of the frontend, whose request and reply types are inferred from
//      the same entries.
//   3. The simulated server the panels are developed against, which answers the same
//      keys with fixtures the reply schemas validate.
//   4. The OpenAPI documentation at `/docs`, generated from the same schemas.
//
// The key is `METHOD /path`, which is exactly what identifies an HTTP route, so no two
// entries can collide and no entry can be looked up ambiguously. The tests assert the
// key against the two fields it repeats, and assert that the parameter schema of a route
// names exactly the placeholders its path declares.
//
// Six flags carry the cross cutting rules of the plan, and each is tested rather than
// trusted:
//
//   `requiresAuth`            the route needs a valid session.
//   `advancesPlayer`          the handler runs `advancePlayer` first, which is every
//                             route that reads or writes domain state (plan section 6.3).
//   `sequenced`               the reply is a mutation envelope carrying `seq`, so the
//                             client feeds it through the same reducer as a WebSocket
//                             frame (plan section 7).
//   `movesMoney`              the route debits or credits the player.
//   `requiresIdempotencyKey`  set exactly when `movesMoney` is, which is the rule of plan
//                             section 6.3 stated as an invariant instead of a convention.
//   `devOnly`                 refused unless the development flag is on.

import { type z } from 'zod';
import { GameEventType } from '../domain/enums.js';
import { eventReplayReplySchema } from '../ws/envelope.js';
import {
  loginBodySchema,
  meReplySchema,
  refreshReplySchema,
  registerBodySchema,
  sessionReplySchema,
  logoutReplySchema,
  wsTicketReplySchema,
} from './schemas/auth.js';
import { mutationReplySchema, type HttpMethod } from './schemas/common.js';
import {
  inventoryReplySchema,
  ledgerQuerySchema,
  ledgerReplySchema,
  marketPricesReplySchema,
  sellBodySchema,
  sellResultSchema,
} from './schemas/economy.js';
import {
  buildingParamsSchema,
  createFarmBodySchema,
  createFarmResultSchema,
  farmParamsSchema,
  farmsReplySchema,
  placeBuildingBodySchema,
  placeBuildingResultSchema,
  removeBuildingResultSchema,
} from './schemas/farms.js';
import {
  createFieldBodySchema,
  extendFieldBodySchema,
  fieldDetailReplySchema,
  fieldMutationResultSchema,
  fieldParamsSchema,
  fieldsReplySchema,
  mergeFieldsBodySchema,
  mergeFieldsResultSchema,
  splitFieldBodySchema,
  splitFieldResultSchema,
} from './schemas/fields.js';
import {
  clearLandBodySchema,
  createForestPlotBodySchema,
  createForestPlotResultSchema,
  fellBodySchema,
  forestPlotDetailReplySchema,
  forestPlotParamsSchema,
  forestPlotsReplySchema,
  forestPlotTreesQuerySchema,
  replantBodySchema,
} from './schemas/forestry.js';
import {
  landPurchaseBodySchema,
  landPurchaseResultSchema,
  landQuoteBodySchema,
  landQuoteReplySchema,
} from './schemas/land.js';
import {
  buyMachineBodySchema,
  buyMachineResultSchema,
  machineCatalogReplySchema,
  machineParamsSchema,
  machinesReplySchema,
  repairMachineBodySchema,
  repairMachineResultSchema,
  sellMachineResultSchema,
} from './schemas/machinery.js';
import {
  eventsQuerySchema,
  snapshotReplySchema,
  welcomeBackAckBodySchema,
  welcomeBackAckResultSchema,
  welcomeBackReplySchema,
} from './schemas/state.js';
import {
  devAdvancePlayerBodySchema,
  devAdvancePlayerResultSchema,
  devGrantBodySchema,
  devGrantResultSchema,
  devReconcileResultSchema,
  devRetimeBodySchema,
  devRetimeResultSchema,
  docsReplySchema,
  healthReplySchema,
  metricsReplySchema,
} from './schemas/system.js';
import {
  agriculturalTaskRequestSchema,
  cancelTaskResultSchema,
  createTaskResultSchema,
  taskDetailReplySchema,
  taskEstimateReplySchema,
  taskParamsSchema,
  taskRequestSchema,
  tasksQuerySchema,
  tasksReplySchema,
} from './schemas/tasks.js';
import {
  fireWorkerResultSchema,
  hireWorkerBodySchema,
  hireWorkerResultSchema,
  workerParamsSchema,
  workerPoolReplySchema,
  workersReplySchema,
} from './schemas/workers.js';
import {
  chunkBatchBodySchema,
  chunkBatchReplySchema,
  worldInfoReplySchema,
} from './schemas/world.js';

// ---------------------------------------------------------------------------
// The shape of an entry
// ---------------------------------------------------------------------------

/** Areas of the surface, one per schema file (plan section 7). */
export const API_AREAS = [
  'auth',
  'state',
  'world',
  'land',
  'farms',
  'fields',
  'machinery',
  'workers',
  'tasks',
  'economy',
  'forestry',
  'system',
] as const;
export type ApiArea = (typeof API_AREAS)[number];

export interface RouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly area: ApiArea;
  /** One line, in Spanish, used as the summary of the OpenAPI operation. */
  readonly summary: string;
  readonly requiresAuth: boolean;
  readonly advancesPlayer: boolean;
  readonly sequenced: boolean;
  readonly movesMoney: boolean;
  readonly requiresIdempotencyKey?: boolean;
  readonly devOnly?: boolean;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  readonly reply: z.ZodType;
  /** Media type of the reply. Absent means `application/json`. */
  readonly replyContentType?: string;
  /** Event tags the route can produce. Declared for every sequenced route. */
  readonly emits?: readonly GameEventType[];
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

export const API_ROUTES = {
  // -------------------------------------------------------------------------
  // auth
  // -------------------------------------------------------------------------
  'POST /api/auth/register': {
    method: 'POST',
    path: '/api/auth/register',
    area: 'auth',
    summary: 'Registra una cuenta, crea el jugador y abre sesion.',
    requiresAuth: false,
    advancesPlayer: false,
    sequenced: false,
    movesMoney: false,
    body: registerBodySchema,
    reply: sessionReplySchema,
  },
  'POST /api/auth/login': {
    method: 'POST',
    path: '/api/auth/login',
    area: 'auth',
    summary: 'Abre sesion con credenciales.',
    requiresAuth: false,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    body: loginBodySchema,
    reply: sessionReplySchema,
  },
  'POST /api/auth/refresh': {
    method: 'POST',
    path: '/api/auth/refresh',
    area: 'auth',
    summary: 'Rota el refresh token de la cookie y emite un nuevo token de acceso.',
    requiresAuth: false,
    advancesPlayer: false,
    sequenced: false,
    movesMoney: false,
    reply: refreshReplySchema,
  },
  'POST /api/auth/logout': {
    method: 'POST',
    path: '/api/auth/logout',
    area: 'auth',
    summary: 'Invalida el refresh token y borra la cookie.',
    requiresAuth: false,
    advancesPlayer: false,
    sequenced: false,
    movesMoney: false,
    reply: logoutReplySchema,
  },
  'POST /api/auth/ws-ticket': {
    method: 'POST',
    path: '/api/auth/ws-ticket',
    area: 'auth',
    summary: 'Emite un ticket de un solo uso para autenticar el WebSocket.',
    requiresAuth: true,
    advancesPlayer: false,
    sequenced: false,
    movesMoney: false,
    reply: wsTicketReplySchema,
  },
  'GET /api/auth/me': {
    method: 'GET',
    path: '/api/auth/me',
    area: 'auth',
    summary: 'Devuelve el jugador de la sesion y el reloj del mundo.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    reply: meReplySchema,
  },

  // -------------------------------------------------------------------------
  // state
  // -------------------------------------------------------------------------
  'GET /api/state/snapshot': {
    method: 'GET',
    path: '/api/state/snapshot',
    area: 'state',
    summary: 'Instantanea completa del estado del jugador, sin la rejilla del mundo.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    reply: snapshotReplySchema,
  },
  'GET /api/events': {
    method: 'GET',
    path: '/api/events',
    area: 'state',
    summary: 'Reproduce el anillo de eventos desde una secuencia dada.',
    requiresAuth: true,
    advancesPlayer: false,
    sequenced: false,
    movesMoney: false,
    query: eventsQuerySchema,
    reply: eventReplayReplySchema,
  },
  'GET /api/session/welcome-back': {
    method: 'GET',
    path: '/api/session/welcome-back',
    area: 'state',
    summary: 'Resumen de lo ocurrido desde el ultimo resumen confirmado.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    reply: welcomeBackReplySchema,
  },
  'POST /api/session/welcome-back/ack': {
    method: 'POST',
    path: '/api/session/welcome-back/ack',
    area: 'state',
    summary: 'Confirma el resumen de regreso y avanza la marca de resumen.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: false,
    body: welcomeBackAckBodySchema,
    reply: mutationReplySchema(welcomeBackAckResultSchema),
    emits: [GameEventType.PLAYER_UPSERTED],
  },

  // -------------------------------------------------------------------------
  // world
  // -------------------------------------------------------------------------
  'GET /api/world/info': {
    method: 'GET',
    path: '/api/world/info',
    area: 'world',
    summary: 'Semilla, escala, version del generador y ancla del reloj.',
    requiresAuth: true,
    advancesPlayer: false,
    sequenced: false,
    movesMoney: false,
    reply: worldInfoReplySchema,
  },
  'POST /api/world/chunks': {
    method: 'POST',
    path: '/api/world/chunks',
    area: 'world',
    summary: 'Carga por lote la capa de modificaciones de varios chunks.',
    requiresAuth: true,
    advancesPlayer: false,
    sequenced: false,
    movesMoney: false,
    body: chunkBatchBodySchema,
    reply: chunkBatchReplySchema,
  },

  // -------------------------------------------------------------------------
  // land
  // -------------------------------------------------------------------------
  'POST /api/land/quote': {
    method: 'POST',
    path: '/api/land/quote',
    area: 'land',
    summary: 'Presupuesto de una seleccion de celdas, con el motivo por celda bloqueada.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    body: landQuoteBodySchema,
    reply: landQuoteReplySchema,
  },
  'POST /api/land/purchase': {
    method: 'POST',
    path: '/api/land/purchase',
    area: 'land',
    summary: 'Compra las celdas comprables de una seleccion y cobra solo esas.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: true,
    requiresIdempotencyKey: true,
    body: landPurchaseBodySchema,
    reply: mutationReplySchema(landPurchaseResultSchema),
    emits: [
      GameEventType.CHUNK_PATCHED,
      GameEventType.PLAYER_UPSERTED,
      GameEventType.LEDGER_APPENDED,
    ],
  },

  // -------------------------------------------------------------------------
  // farms
  // -------------------------------------------------------------------------
  'GET /api/farms': {
    method: 'GET',
    path: '/api/farms',
    area: 'farms',
    summary: 'Granjas del jugador y sus edificios, con capacidades y ocupacion.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    reply: farmsReplySchema,
  },
  'POST /api/farms': {
    method: 'POST',
    path: '/api/farms',
    area: 'farms',
    summary: 'Crea una granja. No ocupa suelo ni mueve dinero.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: false,
    body: createFarmBodySchema,
    reply: mutationReplySchema(createFarmResultSchema),
    emits: [GameEventType.FARM_UPSERTED],
  },
  'POST /api/farms/:farmId/buildings': {
    method: 'POST',
    path: '/api/farms/:farmId/buildings',
    area: 'farms',
    summary: 'Construye un edificio sobre una huella, comprando el suelo si se pide.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: true,
    requiresIdempotencyKey: true,
    params: farmParamsSchema,
    body: placeBuildingBodySchema,
    reply: mutationReplySchema(placeBuildingResultSchema),
    emits: [
      GameEventType.BUILDING_UPSERTED,
      GameEventType.FARM_UPSERTED,
      GameEventType.CHUNK_PATCHED,
      GameEventType.PLAYER_UPSERTED,
      GameEventType.LEDGER_APPENDED,
    ],
  },
  'DELETE /api/buildings/:buildingId': {
    method: 'DELETE',
    path: '/api/buildings/:buildingId',
    area: 'farms',
    summary: 'Retira un edificio vacio y devuelve el factor de reventa.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: true,
    requiresIdempotencyKey: true,
    params: buildingParamsSchema,
    reply: mutationReplySchema(removeBuildingResultSchema),
    emits: [
      GameEventType.BUILDING_REMOVED,
      GameEventType.FARM_UPSERTED,
      GameEventType.CHUNK_PATCHED,
      GameEventType.PLAYER_UPSERTED,
      GameEventType.LEDGER_APPENDED,
    ],
  },

  // -------------------------------------------------------------------------
  // fields
  // -------------------------------------------------------------------------
  'GET /api/fields': {
    method: 'GET',
    path: '/api/fields',
    area: 'fields',
    summary: 'Campos del jugador con sus atributos proyectados.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    reply: fieldsReplySchema,
  },
  'GET /api/fields/:fieldId': {
    method: 'GET',
    path: '/api/fields/:fieldId',
    area: 'fields',
    summary: 'Detalle de un campo, incluida su geometria.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    params: fieldParamsSchema,
    reply: fieldDetailReplySchema,
  },
  'POST /api/fields': {
    method: 'POST',
    path: '/api/fields',
    area: 'fields',
    summary: 'Crea un campo sobre celdas propias, contiguas y aptas para agricultura.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: false,
    body: createFieldBodySchema,
    reply: mutationReplySchema(fieldMutationResultSchema),
    emits: [GameEventType.FIELD_UPSERTED, GameEventType.CHUNK_PATCHED],
  },
  'POST /api/fields/:fieldId/extend': {
    method: 'POST',
    path: '/api/fields/:fieldId/extend',
    area: 'fields',
    summary: 'Amplia un campo con celdas adyacentes.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: false,
    params: fieldParamsSchema,
    body: extendFieldBodySchema,
    reply: mutationReplySchema(fieldMutationResultSchema),
    emits: [GameEventType.FIELD_UPSERTED, GameEventType.CHUNK_PATCHED],
  },
  'POST /api/fields/:fieldId/split': {
    method: 'POST',
    path: '/api/fields/:fieldId/split',
    area: 'fields',
    summary: 'Divide un campo en dos, ambos contiguos y no vacios.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: false,
    params: fieldParamsSchema,
    body: splitFieldBodySchema,
    reply: mutationReplySchema(splitFieldResultSchema),
    emits: [GameEventType.FIELD_UPSERTED, GameEventType.CHUNK_PATCHED],
  },
  'POST /api/fields/merge': {
    method: 'POST',
    path: '/api/fields/merge',
    area: 'fields',
    summary: 'Fusiona campos contiguos y compatibles en uno solo.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: false,
    body: mergeFieldsBodySchema,
    reply: mutationReplySchema(mergeFieldsResultSchema),
    emits: [GameEventType.FIELD_UPSERTED, GameEventType.FIELD_REMOVED, GameEventType.CHUNK_PATCHED],
  },

  // -------------------------------------------------------------------------
  // machinery
  // -------------------------------------------------------------------------
  'GET /api/machines': {
    method: 'GET',
    path: '/api/machines',
    area: 'machinery',
    summary: 'Maquinaria del jugador, con condicion, reventa y coste de reparacion.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    reply: machinesReplySchema,
  },
  'GET /api/machines/catalog': {
    method: 'GET',
    path: '/api/machines/catalog',
    area: 'machinery',
    summary: 'Catalogo de maquinaria y tabla de compatibilidad operacion-maquina.',
    requiresAuth: false,
    advancesPlayer: false,
    sequenced: false,
    movesMoney: false,
    reply: machineCatalogReplySchema,
  },
  'POST /api/machines': {
    method: 'POST',
    path: '/api/machines',
    area: 'machinery',
    summary: 'Compra una maquina, exigiendo plaza libre de garaje.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: true,
    requiresIdempotencyKey: true,
    body: buyMachineBodySchema,
    reply: mutationReplySchema(buyMachineResultSchema),
    emits: [
      GameEventType.MACHINE_UPSERTED,
      GameEventType.BUILDING_UPSERTED,
      GameEventType.PLAYER_UPSERTED,
      GameEventType.LEDGER_APPENDED,
    ],
  },
  'POST /api/machines/:machineId/sell': {
    method: 'POST',
    path: '/api/machines/:machineId/sell',
    area: 'machinery',
    summary: 'Vende una maquina ociosa al factor de reventa por condicion.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: true,
    requiresIdempotencyKey: true,
    params: machineParamsSchema,
    reply: mutationReplySchema(sellMachineResultSchema),
    emits: [
      GameEventType.MACHINE_REMOVED,
      GameEventType.BUILDING_UPSERTED,
      GameEventType.PLAYER_UPSERTED,
      GameEventType.LEDGER_APPENDED,
    ],
  },
  'POST /api/machines/:machineId/repair': {
    method: 'POST',
    path: '/api/machines/:machineId/repair',
    area: 'machinery',
    summary: 'Programa una reparacion en taller, que ocupa la maquina mientras dura.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: true,
    requiresIdempotencyKey: true,
    params: machineParamsSchema,
    body: repairMachineBodySchema,
    reply: mutationReplySchema(repairMachineResultSchema),
    emits: [
      GameEventType.MACHINE_UPSERTED,
      GameEventType.PLAYER_UPSERTED,
      GameEventType.LEDGER_APPENDED,
    ],
  },

  // -------------------------------------------------------------------------
  // workers
  // -------------------------------------------------------------------------
  'GET /api/workers': {
    method: 'GET',
    path: '/api/workers',
    area: 'workers',
    summary: 'Plantilla del jugador y coste salarial por hora de juego.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    reply: workersReplySchema,
  },
  'GET /api/workers/pool': {
    method: 'GET',
    path: '/api/workers/pool',
    area: 'workers',
    summary: 'Pool de contratacion del jugador y momento del siguiente refresco.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    reply: workerPoolReplySchema,
  },
  'POST /api/workers/hire': {
    method: 'POST',
    path: '/api/workers/hire',
    area: 'workers',
    summary: 'Contrata a un candidato, exigiendo plaza libre de vivienda.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: false,
    body: hireWorkerBodySchema,
    reply: mutationReplySchema(hireWorkerResultSchema),
    emits: [
      GameEventType.WORKER_UPSERTED,
      GameEventType.WORKER_POOL_UPSERTED,
      GameEventType.BUILDING_UPSERTED,
    ],
  },
  'POST /api/workers/:workerId/fire': {
    method: 'POST',
    path: '/api/workers/:workerId/fire',
    area: 'workers',
    summary: 'Despide a un trabajador ocioso y libera su plaza de vivienda.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: false,
    params: workerParamsSchema,
    reply: mutationReplySchema(fireWorkerResultSchema),
    emits: [GameEventType.WORKER_REMOVED, GameEventType.BUILDING_UPSERTED],
  },

  // -------------------------------------------------------------------------
  // tasks
  // -------------------------------------------------------------------------
  'GET /api/tasks': {
    method: 'GET',
    path: '/api/tasks',
    area: 'tasks',
    summary: 'Tareas del jugador, con su progreso al instante de la respuesta.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    query: tasksQuerySchema,
    reply: tasksReplySchema,
  },
  'GET /api/tasks/:taskId': {
    method: 'GET',
    path: '/api/tasks/:taskId',
    area: 'tasks',
    summary: 'Detalle de una tarea.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    params: taskParamsSchema,
    reply: taskDetailReplySchema,
  },
  'POST /api/tasks/estimate': {
    method: 'POST',
    path: '/api/tasks/estimate',
    area: 'tasks',
    summary: 'Previsión de duracion, coste y produccion, con los motivos de bloqueo.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    body: taskRequestSchema,
    reply: taskEstimateReplySchema,
  },
  'POST /api/tasks': {
    method: 'POST',
    path: '/api/tasks',
    area: 'tasks',
    summary: 'Asigna trabajador y maquinaria a una operacion agricola.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: false,
    body: agriculturalTaskRequestSchema,
    reply: mutationReplySchema(createTaskResultSchema),
    emits: [
      GameEventType.TASK_UPSERTED,
      GameEventType.FIELD_UPSERTED,
      GameEventType.MACHINE_UPSERTED,
      GameEventType.WORKER_UPSERTED,
    ],
  },
  'POST /api/tasks/:taskId/cancel': {
    method: 'POST',
    path: '/api/tasks/:taskId/cancel',
    area: 'tasks',
    summary: 'Cancela una tarea en curso, sin reembolso y con desgaste prorrateado.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: false,
    params: taskParamsSchema,
    reply: mutationReplySchema(cancelTaskResultSchema),
    emits: [
      GameEventType.TASK_UPSERTED,
      GameEventType.FIELD_UPSERTED,
      GameEventType.FOREST_PLOT_UPSERTED,
      GameEventType.MACHINE_UPSERTED,
      GameEventType.WORKER_UPSERTED,
    ],
  },

  // -------------------------------------------------------------------------
  // economy
  // -------------------------------------------------------------------------
  'GET /api/inventory': {
    method: 'GET',
    path: '/api/inventory',
    area: 'economy',
    summary: 'Existencias por granja y recurso, con capacidad y valor de mercado.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    reply: inventoryReplySchema,
  },
  'GET /api/market/prices': {
    method: 'GET',
    path: '/api/market/prices',
    area: 'economy',
    summary: 'Precios fijos de venta por unidad almacenada.',
    requiresAuth: true,
    advancesPlayer: false,
    sequenced: false,
    movesMoney: false,
    reply: marketPricesReplySchema,
  },
  'GET /api/economy/ledger': {
    method: 'GET',
    path: '/api/economy/ledger',
    area: 'economy',
    summary: 'Asientos del libro mayor del jugador, paginados y en orden de secuencia.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    query: ledgerQuerySchema,
    reply: ledgerReplySchema,
  },
  'POST /api/market/sell': {
    method: 'POST',
    path: '/api/market/sell',
    area: 'economy',
    summary: 'Vende existencias al precio fijo. Admisible con saldo negativo.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: true,
    requiresIdempotencyKey: true,
    body: sellBodySchema,
    reply: mutationReplySchema(sellResultSchema),
    emits: [
      GameEventType.INVENTORY_UPSERTED,
      GameEventType.FARM_UPSERTED,
      GameEventType.PLAYER_UPSERTED,
      GameEventType.LEDGER_APPENDED,
    ],
  },

  // -------------------------------------------------------------------------
  // forestry
  // -------------------------------------------------------------------------
  'GET /api/forest-plots': {
    method: 'GET',
    path: '/api/forest-plots',
    area: 'forestry',
    summary: 'Parcelas forestales con recuento y volumen de arbolado en pie.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    reply: forestPlotsReplySchema,
  },
  'GET /api/forest-plots/:forestPlotId': {
    method: 'GET',
    path: '/api/forest-plots/:forestPlotId',
    area: 'forestry',
    summary: 'Detalle de una parcela y pagina de sus arboles, con fase y volumen derivados.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: false,
    movesMoney: false,
    params: forestPlotParamsSchema,
    query: forestPlotTreesQuerySchema,
    reply: forestPlotDetailReplySchema,
  },
  'POST /api/forest-plots': {
    method: 'POST',
    path: '/api/forest-plots',
    area: 'forestry',
    summary: 'Crea una parcela forestal y genera su arbolado natural una sola vez.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: false,
    body: createForestPlotBodySchema,
    reply: mutationReplySchema(createForestPlotResultSchema),
    emits: [
      GameEventType.FOREST_PLOT_UPSERTED,
      GameEventType.TREES_UPSERTED,
      GameEventType.CHUNK_PATCHED,
    ],
  },
  'POST /api/forest-plots/:forestPlotId/fell': {
    method: 'POST',
    path: '/api/forest-plots/:forestPlotId/fell',
    area: 'forestry',
    summary: 'Programa una tala por lote sobre la parcela o una subarea.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: false,
    params: forestPlotParamsSchema,
    body: fellBodySchema,
    reply: mutationReplySchema(createTaskResultSchema),
    emits: [
      GameEventType.TASK_UPSERTED,
      GameEventType.FOREST_PLOT_UPSERTED,
      GameEventType.MACHINE_UPSERTED,
      GameEventType.WORKER_UPSERTED,
    ],
  },
  'POST /api/forest-plots/:forestPlotId/replant': {
    method: 'POST',
    path: '/api/forest-plots/:forestPlotId/replant',
    area: 'forestry',
    summary: 'Programa la replantacion de celdas vacias de la parcela.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: false,
    params: forestPlotParamsSchema,
    body: replantBodySchema,
    reply: mutationReplySchema(createTaskResultSchema),
    emits: [
      GameEventType.TASK_UPSERTED,
      GameEventType.FOREST_PLOT_UPSERTED,
      GameEventType.MACHINE_UPSERTED,
      GameEventType.WORKER_UPSERTED,
    ],
  },
  'POST /api/land/clear': {
    method: 'POST',
    path: '/api/land/clear',
    area: 'forestry',
    summary: 'Programa el desmonte de celdas taladas para convertirlas en cultivables.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: false,
    body: clearLandBodySchema,
    reply: mutationReplySchema(createTaskResultSchema),
    emits: [
      GameEventType.TASK_UPSERTED,
      GameEventType.MACHINE_UPSERTED,
      GameEventType.WORKER_UPSERTED,
    ],
  },

  // -------------------------------------------------------------------------
  // system
  // -------------------------------------------------------------------------
  'GET /health': {
    method: 'GET',
    path: '/health',
    area: 'system',
    summary: 'Salud del proceso y de sus dependencias.',
    requiresAuth: false,
    advancesPlayer: false,
    sequenced: false,
    movesMoney: false,
    reply: healthReplySchema,
  },
  'GET /metrics': {
    method: 'GET',
    path: '/metrics',
    area: 'system',
    summary: 'Metricas en formato de exposicion de Prometheus.',
    requiresAuth: false,
    advancesPlayer: false,
    sequenced: false,
    movesMoney: false,
    reply: metricsReplySchema,
    replyContentType: 'text/plain; version=0.0.4; charset=utf-8',
  },
  'GET /docs': {
    method: 'GET',
    path: '/docs',
    area: 'system',
    summary: 'Documentacion OpenAPI generada de este mismo mapa de rutas.',
    requiresAuth: false,
    advancesPlayer: false,
    sequenced: false,
    movesMoney: false,
    reply: docsReplySchema,
    replyContentType: 'text/html; charset=utf-8',
  },
  'POST /api/dev/retime': {
    method: 'POST',
    path: '/api/dev/retime',
    area: 'system',
    summary: 'Cambia el multiplicador del mundo re-anclando el reloj. Solo desarrollo.',
    requiresAuth: true,
    advancesPlayer: false,
    sequenced: false,
    movesMoney: false,
    devOnly: true,
    body: devRetimeBodySchema,
    reply: devRetimeResultSchema,
  },
  'POST /api/dev/advance-player': {
    method: 'POST',
    path: '/api/dev/advance-player',
    area: 'system',
    summary: 'Avanza al jugador procesando los eventos vencidos. Solo desarrollo.',
    requiresAuth: true,
    advancesPlayer: false,
    sequenced: false,
    movesMoney: false,
    devOnly: true,
    body: devAdvancePlayerBodySchema,
    reply: devAdvancePlayerResultSchema,
  },
  'POST /api/dev/grant': {
    method: 'POST',
    path: '/api/dev/grant',
    area: 'system',
    summary: 'Registra un asiento de compensacion con importe firmado. Solo desarrollo.',
    requiresAuth: true,
    advancesPlayer: true,
    sequenced: true,
    movesMoney: true,
    requiresIdempotencyKey: true,
    devOnly: true,
    body: devGrantBodySchema,
    reply: mutationReplySchema(devGrantResultSchema),
    emits: [GameEventType.PLAYER_UPSERTED, GameEventType.LEDGER_APPENDED],
  },
  'POST /api/dev/reconcile': {
    method: 'POST',
    path: '/api/dev/reconcile',
    area: 'system',
    summary: 'Encola en orden todo evento ya vencido. Solo desarrollo.',
    requiresAuth: true,
    advancesPlayer: false,
    sequenced: false,
    movesMoney: false,
    devOnly: true,
    reply: devReconcileResultSchema,
  },
} as const satisfies Record<string, RouteDefinition>;

// ---------------------------------------------------------------------------
// Derived types and helpers
// ---------------------------------------------------------------------------

export type ApiRouteKey = keyof typeof API_ROUTES;

export const API_ROUTE_KEYS = Object.keys(API_ROUTES) as readonly ApiRouteKey[];

/** The entry of one route, with its schemas at their narrow types. */
export type ApiRoute<TKey extends ApiRouteKey> = (typeof API_ROUTES)[TKey];

type InferOrNever<TSchema> = TSchema extends z.ZodType ? z.infer<TSchema> : never;

/** Path parameters of a route, or `never` when it declares none. */
export type RouteParams<TKey extends ApiRouteKey> =
  ApiRoute<TKey> extends {
    readonly params: infer TSchema;
  }
    ? InferOrNever<TSchema>
    : never;

/** Query parameters of a route, after coercion, or `never` when it declares none. */
export type RouteQuery<TKey extends ApiRouteKey> =
  ApiRoute<TKey> extends {
    readonly query: infer TSchema;
  }
    ? InferOrNever<TSchema>
    : never;

/** Request body of a route, or `never` when it declares none. */
export type RouteBody<TKey extends ApiRouteKey> =
  ApiRoute<TKey> extends {
    readonly body: infer TSchema;
  }
    ? InferOrNever<TSchema>
    : never;

/** Reply body of a route. Every route declares one. */
export type RouteReply<TKey extends ApiRouteKey> = z.infer<ApiRoute<TKey>['reply']>;

/** Builds the key of a route from its method and path. */
export function routeKey(method: HttpMethod, path: string): string {
  return `${method} ${path}`;
}

/** Placeholder of a path parameter: a colon followed by an identifier. */
export const PATH_PARAM_PATTERN = /:([A-Za-z][A-Za-z0-9]*)/g;

/** Names of the placeholders a path declares, in order of appearance. */
export function pathParamNames(path: string): readonly string[] {
  return [...path.matchAll(PATH_PARAM_PATTERN)].map((match) => match[1] as string);
}

/**
 * Substitutes the placeholders of a path. Used by the typed client, which therefore
 * never concatenates a URL by hand and cannot forget to encode a value.
 */
export function buildPath(path: string, params: Readonly<Record<string, string>>): string {
  return path.replace(PATH_PARAM_PATTERN, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing path parameter ${name} for ${path}`);
    }
    return encodeURIComponent(value);
  });
}

/**
 * The entry of a route at the widened interface type. The map keeps every entry at its
 * literal type, which is what makes `RouteReply` and its siblings precise; iterating it
 * needs the common shape instead, and this is the one place that widens.
 */
export function routeDefinition(key: ApiRouteKey): RouteDefinition {
  return API_ROUTES[key];
}

/** Every entry, widened, in declaration order. Convenient for registration and tests. */
export function routeDefinitions(): readonly (readonly [ApiRouteKey, RouteDefinition])[] {
  return API_ROUTE_KEYS.map((key) => [key, routeDefinition(key)] as const);
}

/** Routes that require the idempotency key header, which are exactly those moving money. */
export const IDEMPOTENT_ROUTE_KEYS: readonly ApiRouteKey[] = API_ROUTE_KEYS.filter(
  (key) => routeDefinition(key).requiresIdempotencyKey === true,
);

/** Routes whose reply goes through the reducer of the client. */
export const SEQUENCED_ROUTE_KEYS: readonly ApiRouteKey[] = API_ROUTE_KEYS.filter(
  (key) => routeDefinition(key).sequenced,
);

/** Routes only served with the development flag on. */
export const DEV_ROUTE_KEYS: readonly ApiRouteKey[] = API_ROUTE_KEYS.filter(
  (key) => routeDefinition(key).devOnly === true,
);

/** Keys of one area, in declaration order. */
export function routeKeysOfArea(area: ApiArea): readonly ApiRouteKey[] {
  return API_ROUTE_KEYS.filter((key) => routeDefinition(key).area === area);
}
