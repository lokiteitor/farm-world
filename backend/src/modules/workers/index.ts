// Modulo `workers`. Trabajadores y pool de contratacion por jugador.
//
// Andamiaje creado por W3-A con la ruta y la firma definitivas. Propietario del contenido:
// W5-B, que sustituye el cuerpo de este fichero sin tocar `src/app.ts` ni el registro de
// rutas (plan seccion 11, regla 3).
//
// Rutas del area `workers` que le corresponden, en el orden del contrato:
//
//   GET /api/workers
//   GET /api/workers/pool
//   POST /api/workers/hire
//   POST /api/workers/:workerId/fire
//
// Cada una responde hoy 501 con el codigo `NOT_IMPLEMENTED` y su clave en los detalles, y ya
// valida su peticion, arrastra sus guardas y figura en la documentacion OpenAPI: lo unico que
// falta es el cuerpo.
//
// El pool es por jugador, con `region` reservado: un pool global introduciria contencion entre
// jugadores que el MVP evita explicitamente (plan 5.2). El salario se negocia por candidato,
// que es la unica tasa de coste que vive en una fila y no en el catalogo.
//
// Como sustituirlo: cambiar cada `defineStubRoute(app, clave)` por
// `defineRoute(app, clave, manejador)` con el manejador tipado, que recibe la peticion con
// `params`, `query` y `body` ya validados y devuelve exactamente `RouteReply<clave>`. Todo
// camino mutante pasa por `withPlayerAdvanced` de `lib/advancePlayer.ts`, que es lo que
// devuelve el `seq` que la respuesta secuenciada tiene que llevar.

import { type FastifyInstance } from 'fastify';
import { defineStubRoute } from '../../plugins/routes.js';
import { routeKeysOfArea } from '../../shared/index.js';

/** Registra las rutas del area `workers`. Invocada una vez por `src/app.ts`. */
export function registerWorkersRoutes(app: FastifyInstance): void {
  for (const key of routeKeysOfArea('workers')) {
    defineStubRoute(app, key);
  }
}
