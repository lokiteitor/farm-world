// Modulo `land`. Tierra: presupuesto de una seleccion y compra de las celdas comprables.
//
// Andamiaje creado por W3-A con la ruta y la firma definitivas. Propietario del contenido:
// W4-A, que sustituye el cuerpo de este fichero sin tocar `src/app.ts` ni el registro de
// rutas (plan seccion 11, regla 3).
//
// Rutas del area `land` que le corresponden, en el orden del contrato:
//
//   POST /api/land/quote
//   POST /api/land/purchase
//
// Cada una responde hoy 501 con el codigo `NOT_IMPLEMENTED` y su clave en los detalles, y ya
// valida su peticion, arrastra sus guardas y figura en la documentacion OpenAPI: lo unico que
// falta es el cuerpo.
//
// Dos puntos que el contrato ya declara y el modulo debe honrar: `expectedTotal` del cuerpo de
// la compra se compara con el total propio y se rechaza con `VALIDATION_FAILED` si difieren
// (docs/handoff/NOTES-W2c.md, apartado 1.3), y la doble compra de la misma celda se resuelve
// con insercion que ignora conflictos, cobrando solo lo realmente adquirido (plan 5.4).
//
// Como sustituirlo: cambiar cada `defineStubRoute(app, clave)` por
// `defineRoute(app, clave, manejador)` con el manejador tipado, que recibe la peticion con
// `params`, `query` y `body` ya validados y devuelve exactamente `RouteReply<clave>`. Todo
// camino mutante pasa por `withPlayerAdvanced` de `lib/advancePlayer.ts`, que es lo que
// devuelve el `seq` que la respuesta secuenciada tiene que llevar.

import { type FastifyInstance } from 'fastify';
import { defineStubRoute } from '../../plugins/routes.js';
import { routeKeysOfArea } from '../../shared/index.js';

/** Registra las rutas del area `land`. Invocada una vez por `src/app.ts`. */
export function registerLandRoutes(app: FastifyInstance): void {
  for (const key of routeKeysOfArea('land')) {
    defineStubRoute(app, key);
  }
}
