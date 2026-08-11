// OpenAPI at /docs, generated from the same Zod schemas the routes validate with.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// The documentation is not written: it is the fourth consumer of the route map, together with
// the registration in Fastify, the typed client of the frontend and the simulated server
// (plan section 7). `jsonSchemaTransform` of `fastify-type-provider-zod` turns each Zod schema
// into the JSON Schema of the operation, so a schema that changes cannot leave a stale
// description behind.
//
// Two routes are excluded from the document rather than described badly. `/metrics` answers the
// Prometheus exposition format and `/docs` answers HTML, so neither has a JSON body to
// describe; they are registered without a response schema, and the skip list keeps them out of
// the operation list as well.

import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { type FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { API_AREAS, SHARED_CONTRACT_VERSION } from '../shared/index.js';

/** Where the viewer is served. The contract declares `GET /docs`. */
export const DOCS_PREFIX = '/docs';

/** Paths that carry no JSON body and are therefore not described. */
const SKIP_LIST = ['/metrics', DOCS_PREFIX];

/** One line per area, so the operation list is navigable instead of alphabetical. */
const AREA_DESCRIPTIONS: Readonly<Record<string, string>> = {
  auth: 'Registro, sesion, rotacion de refresh y ticket del WebSocket.',
  state: 'Instantanea, reproduccion de eventos y resumen de regreso.',
  world: 'Informacion del mundo y carga por lote de la capa de modificaciones.',
  land: 'Presupuesto y compra de suelo.',
  farms: 'Granjas, edificios y capacidades.',
  fields: 'Campos, geometria y maquina de estados del ciclo de cultivo.',
  machinery: 'Catalogo, compra, venta y reparacion de maquinaria.',
  workers: 'Plantilla y pool de contratacion.',
  tasks: 'Prevision, asignacion y cancelacion de tareas.',
  economy: 'Existencias, precios de mercado, libro mayor y venta.',
  forestry: 'Parcelas forestales, tala, replantacion y desmonte.',
  system: 'Salud, metricas, documentacion y rutas de desarrollo.',
};

/**
 * Registers the document and the viewer. Called before the routes, because
 * `@fastify/swagger` collects them through the `onRoute` hook.
 */
export async function registerSwagger(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Farming Management Simulator Online',
        description:
          'Superficie REST generada del mapa de rutas de shared/api. Los importes viajan como ' +
          'cadena decimal, los instantes de juego como cadena de entero y los porcentajes en ' +
          'puntos base (shared/api/README.md).',
        version: SHARED_CONTRACT_VERSION,
      },
      tags: API_AREAS.map((area) => ({
        name: area,
        description: AREA_DESCRIPTIONS[area] ?? area,
      })),
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: DOCS_PREFIX,
    uiConfig: { docExpansion: 'list', deepLinking: true },
    staticCSP: true,
  });

  app.addHook('onRoute', (route) => {
    if (SKIP_LIST.includes(route.url)) {
      route.schema = { ...route.schema, hide: true };
    }
  });
}
