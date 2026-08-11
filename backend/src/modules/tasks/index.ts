// Modulo `tasks`. Motor de tareas: validacion de §90 y §104, agendado, finalizacion y cancelacion.
//
// Andamiaje creado por W3-A con la ruta y la firma definitivas. Propietario del contenido:
// W6-A, que sustituye el cuerpo de este fichero sin tocar `src/app.ts` ni el registro de
// rutas (plan seccion 11, regla 3).
//
// Rutas del area `tasks` que le corresponden, en el orden del contrato:
//
//   GET /api/tasks
//   GET /api/tasks/:taskId
//   POST /api/tasks/estimate
//   POST /api/tasks
//   POST /api/tasks/:taskId/cancel
//
// Cada una responde hoy 501 con el codigo `NOT_IMPLEMENTED` y su clave en los detalles, y ya
// valida su peticion, arrastra sus guardas y figura en la documentacion OpenAPI: lo unico que
// falta es el cuerpo.
//
// La peticion es una union discriminada por operacion, de modo que sembrar sin cultivo o talar
// contra un campo son peticiones mal formadas y no conflictos de dominio: la validacion de
// dominio solo comprueba compatibilidad real contra `OPERATION_REQUIREMENTS`, estado del
// campo, reserva de recursos y capacidad de almacenamiento (docs/handoff/NOTES-W2c.md, 2.4).
//
// Como sustituirlo: cambiar cada `defineStubRoute(app, clave)` por
// `defineRoute(app, clave, manejador)` con el manejador tipado, que recibe la peticion con
// `params`, `query` y `body` ya validados y devuelve exactamente `RouteReply<clave>`. Todo
// camino mutante pasa por `withPlayerAdvanced` de `lib/advancePlayer.ts`, que es lo que
// devuelve el `seq` que la respuesta secuenciada tiene que llevar.

import { type FastifyInstance } from 'fastify';
import { defineStubRoute } from '../../plugins/routes.js';
import { routeKeysOfArea } from '../../shared/index.js';

/** Registra las rutas del area `tasks`. Invocada una vez por `src/app.ts`. */
export function registerTasksRoutes(app: FastifyInstance): void {
  for (const key of routeKeysOfArea('tasks')) {
    defineStubRoute(app, key);
  }
}
