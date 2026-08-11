// Modulo `forestry`. Silvicultura: parcelas, tala por lote, replantacion y desmonte.
//
// Andamiaje creado por W3-A con la ruta y la firma definitivas. Propietario del contenido:
// W6-C, que sustituye el cuerpo de este fichero sin tocar `src/app.ts` ni el registro de
// rutas (plan seccion 11, regla 3).
//
// Rutas del area `forestry` que le corresponden, en el orden del contrato:
//
//   GET /api/forest-plots
//   GET /api/forest-plots/:forestPlotId
//   POST /api/forest-plots
//   POST /api/forest-plots/:forestPlotId/fell
//   POST /api/forest-plots/:forestPlotId/replant
//   POST /api/land/clear
//
// Cada una responde hoy 501 con el codigo `NOT_IMPLEMENTED` y su clave en los detalles, y ya
// valida su peticion, arrastra sus guardas y figura en la documentacion OpenAPI: lo unico que
// falta es el cuerpo.
//
// `POST /api/land/clear` vive en el espacio de nombres de `land` y lo registra este modulo, que es
// literal respecto al plan y respeta las zonas de ESLint: `forestry` y `tasks` son hermanos de
// la misma fase y no pueden importarse (docs/handoff/NOTES-W2c.md, apartado 2.5).
//
// Como sustituirlo: cambiar cada `defineStubRoute(app, clave)` por
// `defineRoute(app, clave, manejador)` con el manejador tipado, que recibe la peticion con
// `params`, `query` y `body` ya validados y devuelve exactamente `RouteReply<clave>`. Todo
// camino mutante pasa por `withPlayerAdvanced` de `lib/advancePlayer.ts`, que es lo que
// devuelve el `seq` que la respuesta secuenciada tiene que llevar.

import { type FastifyInstance } from 'fastify';
import { defineStubRoute } from '../../plugins/routes.js';
import { routeKeysOfArea } from '../../shared/index.js';

/** Registra las rutas del area `forestry`. Invocada una vez por `src/app.ts`. */
export function registerForestryRoutes(app: FastifyInstance): void {
  for (const key of routeKeysOfArea('forestry')) {
    defineStubRoute(app, key);
  }
}
