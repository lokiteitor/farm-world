// Modulo `farms`. Granjas y edificios, con capacidad por contador.
//
// Andamiaje creado por W3-A con la ruta y la firma definitivas. Propietario del contenido:
// W4-B, que sustituye el cuerpo de este fichero sin tocar `src/app.ts` ni el registro de
// rutas (plan seccion 11, regla 3).
//
// Rutas del area `farms` que le corresponden, en el orden del contrato:
//
//   GET /api/farms
//   POST /api/farms
//   POST /api/farms/:farmId/buildings
//   DELETE /api/buildings/:buildingId
//
// Cada una responde hoy 501 con el codigo `NOT_IMPLEMENTED` y su clave en los detalles, y ya
// valida su peticion, arrastra sus guardas y figura en la documentacion OpenAPI: lo unico que
// falta es el cuerpo.
//
// La capacidad de garaje y de vivienda es un `CHECK` sobre un contador de la fila del edificio,
// incrementado por disparador en la misma transaccion, de modo que la segunda compra
// concurrente con una sola plaza libre reevalua y falla (plan 5.4). El modulo no la
// reimplementa: la traduce a `GARAGE_CAPACITY_EXCEEDED` y `HOME_CAPACITY_EXCEEDED`.
//
// Como sustituirlo: cambiar cada `defineStubRoute(app, clave)` por
// `defineRoute(app, clave, manejador)` con el manejador tipado, que recibe la peticion con
// `params`, `query` y `body` ya validados y devuelve exactamente `RouteReply<clave>`. Todo
// camino mutante pasa por `withPlayerAdvanced` de `lib/advancePlayer.ts`, que es lo que
// devuelve el `seq` que la respuesta secuenciada tiene que llevar.

import { type FastifyInstance } from 'fastify';
import { defineStubRoute } from '../../plugins/routes.js';
import { routeKeysOfArea } from '../../shared/index.js';

/** Registra las rutas del area `farms`. Invocada una vez por `src/app.ts`. */
export function registerFarmsRoutes(app: FastifyInstance): void {
  for (const key of routeKeysOfArea('farms')) {
    defineStubRoute(app, key);
  }
}
